// core/exif.js — minimal JPEG EXIF reader (E12). Pulls just two things out of
// a photo: GPS latitude/longitude and the capture timestamp
// (DateTimeOriginal). That is everything the photo-import flow needs to
// cluster a folder of photos into a draft itinerary.
//
// Why hand-rolled: browsers expose no EXIF API, and a full EXIF library is
// far more than this needs. We walk the APP1 marker, the TIFF header, the
// IFD0 / EXIF-IFD / GPS-IFD entries, and read the handful of tags that
// matter. Pure: takes an ArrayBuffer, returns plain data. No DOM.
//
// Loaded as a plain global: defines `const EXIF = ...` at 2-space indent
// (the core/*.js convention) so tests/core-loader.js can scrape it.
//
// IMPORTANT — the photo pipeline strips EXIF on re-encode (canvas re-encode
// drops all metadata, deliberately, so phone photos don't leak GPS). E12's
// rule is READ-BEFORE-STRIP: call EXIF.read() on the original File's bytes
// FIRST, keep the lat/lon/timestamp, THEN run the existing ingest. The bytes
// that land in storage are still metadata-free.

  const EXIF = (() => {
    // tag ids we care about
    const TAG_EXIF_IFD = 0x8769;
    const TAG_GPS_IFD = 0x8825;
    const TAG_DATETIME_ORIGINAL = 0x9003;
    const TAG_GPS_LAT_REF = 0x0001;
    const TAG_GPS_LAT = 0x0002;
    const TAG_GPS_LON_REF = 0x0003;
    const TAG_GPS_LON = 0x0004;

    // EXIF value-type byte sizes (index = type id)
    const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

    // read one IFD's entries into a { tagId: {type, count, valueOffset} } map.
    // `tiffStart` is the byte offset of the TIFF header (all IFD offsets are
    // relative to it). `little` is the endianness flag.
    const readIfd = (dv, tiffStart, ifdOffset, little) => {
      const entries = {};
      const base = tiffStart + ifdOffset;
      if (base + 2 > dv.byteLength) return entries;
      const count = dv.getUint16(base, little);
      for (let i = 0; i < count; i++) {
        const e = base + 2 + i * 12;
        if (e + 12 > dv.byteLength) break;
        const tag = dv.getUint16(e, little);
        const type = dv.getUint16(e + 2, little);
        const num = dv.getUint32(e + 4, little);
        const size = (TYPE_SIZE[type] || 1) * num;
        // values <= 4 bytes are inline at e+8, otherwise e+8 holds an offset
        const valueOffset = size <= 4 ? e + 8 : tiffStart + dv.getUint32(e + 8, little);
        entries[tag] = { type, count: num, valueOffset };
      }
      return entries;
    };

    // read an ASCII string value
    const readAscii = (dv, entry) => {
      let s = '';
      for (let i = 0; i < entry.count; i++) {
        const c = dv.getUint8(entry.valueOffset + i);
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      return s;
    };

    // read `n` RATIONAL values (each is two uint32: numerator / denominator)
    const readRationals = (dv, entry, little) => {
      const out = [];
      for (let i = 0; i < entry.count; i++) {
        const o = entry.valueOffset + i * 8;
        const numr = dv.getUint32(o, little);
        const den = dv.getUint32(o + 4, little);
        out.push(den === 0 ? 0 : numr / den);
      }
      return out;
    };

    // GPS coords are stored as [degrees, minutes, seconds] rationals + a
    // hemisphere ref ('N'/'S'/'E'/'W'). Convert to a signed decimal degree.
    const dmsToDecimal = (dms, ref) => {
      if (!dms || dms.length < 3) return null;
      let dec = dms[0] + dms[1] / 60 + dms[2] / 3600;
      if (ref === 'S' || ref === 'W') dec = -dec;
      return dec;
    };

    // "YYYY:MM:DD HH:MM:SS" (EXIF format) -> a JS timestamp (ms), or null.
    // Treated as a local wall-clock time — EXIF has no timezone, and for
    // clustering "the day the photo was taken" is what matters.
    const parseExifDate = (s) => {
      const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s || '');
      if (!m) return null;
      const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
      return isNaN(t) ? null : t;
    };

    // the public entry point. Takes a JPEG's ArrayBuffer; returns
    //   { lat, lon, timestamp }  — any field is null if not present.
    // Never throws: a photo with no EXIF, or a non-JPEG, returns all-null.
    const read = (arrayBuffer) => {
      const empty = { lat: null, lon: null, timestamp: null };
      try {
        const dv = new DataView(arrayBuffer);
        if (dv.byteLength < 4 || dv.getUint16(0) !== 0xffd8) return empty; // not a JPEG

        // walk JPEG markers to find APP1 (0xffe1) carrying "Exif\0\0"
        let offset = 2;
        let app1 = -1;
        while (offset + 4 < dv.byteLength) {
          const marker = dv.getUint16(offset);
          if (marker === 0xffe1) { app1 = offset; break; }
          if ((marker & 0xff00) !== 0xff00) break; // not a marker — bail
          offset += 2 + dv.getUint16(offset + 2); // skip this segment
        }
        if (app1 < 0) return empty;

        const segStart = app1 + 4; // past marker + length
        // "Exif\0\0"
        if (dv.getUint32(segStart) !== 0x45786966) return empty;
        const tiffStart = segStart + 6;

        // TIFF header: endianness ('II'/'MM') then 0x002A then IFD0 offset
        const endian = dv.getUint16(tiffStart);
        const little = endian === 0x4949;
        if (!little && endian !== 0x4d4d) return empty;
        const ifd0Offset = dv.getUint32(tiffStart + 4, little);

        const ifd0 = readIfd(dv, tiffStart, ifd0Offset, little);

        // timestamp lives in the EXIF sub-IFD
        let timestamp = null;
        if (ifd0[TAG_EXIF_IFD]) {
          const exifIfd = readIfd(dv, tiffStart,
            dv.getUint32(ifd0[TAG_EXIF_IFD].valueOffset, little), little);
          if (exifIfd[TAG_DATETIME_ORIGINAL]) {
            timestamp = parseExifDate(readAscii(dv, exifIfd[TAG_DATETIME_ORIGINAL]));
          }
        }

        // GPS lives in the GPS sub-IFD
        let lat = null, lon = null;
        if (ifd0[TAG_GPS_IFD]) {
          const gps = readIfd(dv, tiffStart,
            dv.getUint32(ifd0[TAG_GPS_IFD].valueOffset, little), little);
          if (gps[TAG_GPS_LAT] && gps[TAG_GPS_LAT_REF]) {
            lat = dmsToDecimal(
              readRationals(dv, gps[TAG_GPS_LAT], little),
              readAscii(dv, gps[TAG_GPS_LAT_REF]));
          }
          if (gps[TAG_GPS_LON] && gps[TAG_GPS_LON_REF]) {
            lon = dmsToDecimal(
              readRationals(dv, gps[TAG_GPS_LON], little),
              readAscii(dv, gps[TAG_GPS_LON_REF]));
          }
        }

        // sanity: a 0,0 fix or out-of-range value is treated as "no GPS"
        if (lat != null && (lat < -90 || lat > 90)) lat = null;
        if (lon != null && (lon < -180 || lon > 180)) lon = null;
        if (lat === 0 && lon === 0) { lat = null; lon = null; }

        return { lat, lon, timestamp };
      } catch {
        return empty;
      }
    };

    // E38 — detect HEIC magic bytes so readFile() can route those through
    // the vendored exifr library (which understands the HEIF EXIF box).
    // Returns true for any HEIC/HEIF/AVIF-shaped file.
    const isHeicArrayBuffer = (buf) => {
      try {
        if (!buf || buf.byteLength < 12) return false;
        const b = new Uint8Array(buf, 0, 12);
        // bytes 4-7 = 'ftyp'
        return b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;
      } catch { return false; }
    };

    // E38 — convert exifr's output shape into our { lat, lon, timestamp }
    // contract. exifr returns GPS as { latitude, longitude } and the date
    // as a Date object on the .DateTimeOriginal field (or sometimes as a
    // plain Map with numeric keys; we handle both).
    const fromExifrResult = (r) => {
      if (!r) return { lat: null, lon: null, timestamp: null };
      let lat = null, lon = null, timestamp = null;
      if (typeof r.latitude === 'number') lat = r.latitude;
      if (typeof r.longitude === 'number') lon = r.longitude;
      const dt = r.DateTimeOriginal || r.CreateDate || r.ModifyDate;
      if (dt instanceof Date && !isNaN(dt.getTime())) timestamp = dt.getTime();
      else if (typeof dt === 'string') timestamp = parseExifDate(dt);
      if (lat != null && (lat < -90 || lat > 90)) lat = null;
      if (lon != null && (lon < -180 || lon > 180)) lon = null;
      if (lat === 0 && lon === 0) { lat = null; lon = null; }
      return { lat, lon, timestamp };
    };

    // convenience: read straight from a File/Blob. Returns a Promise.
    // E38 — HEIC files route through the vendored exifr library when it's
    // present on `window` (loaded via <script src="vendor/exifr/...">).
    // Fall back to the local JPEG-only reader otherwise.
    const readFile = (file) => new Promise((resolve) => {
      if (!file || typeof file.arrayBuffer !== 'function') {
        resolve({ lat: null, lon: null, timestamp: null });
        return;
      }
      file.arrayBuffer()
        .then(async (buf) => {
          if (isHeicArrayBuffer(buf) &&
              typeof window !== 'undefined' && window.exifr && window.exifr.parse) {
            try {
              // NOTE: do NOT use exifr's `pick` option here — the vendored LITE build
              // (vendor/exifr/exifr.lite.umd.js) doesn't support it, and combining it
              // with the derived latitude/longitude fields throws "undefined is not
              // iterable", which the catch below swallowed → every geotagged HEIC
              // silently lost its GPS + date (the iPhone-import path was dead). With
              // gps:true alone, lite returns latitude/longitude + DateTimeOriginal,
              // which fromExifrResult reads. (Verified on tests/fixtures/sample.heic.)
              const r = await window.exifr.parse(buf, { gps: true });
              resolve(fromExifrResult(r));
              return;
            } catch {
              // TD-29 — a THROWN parse error means we couldn't read this HEIC at
              // all (corrupt / unsupported codec), which is distinct from a clean
              // "this file has no GPS" read that also returns all-nulls. Surface a
              // distinguishable signal so the import status / future code can tell
              // them apart. Backward-compatible: lat/lon/timestamp keep the same
              // all-null shape existing callers read; readError is purely additive
              // and only present on this error path.
              resolve({ lat: null, lon: null, timestamp: null, readError: true });
              return;
            }
          }
          resolve(read(buf));
        })
        .catch(() => resolve({ lat: null, lon: null, timestamp: null }));
    });

    return { read, readFile, parseExifDate, dmsToDecimal, isHeicArrayBuffer, fromExifrResult };
  })();
