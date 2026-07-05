// core/photo-cluster.js — cluster a batch of geotagged photos into trip stops
// (E12). Given photos that each carry { lat, lon, timestamp }, group them into
// an ordered list of stops by location proximity AND time gaps, so a folder of
// 600 photos becomes a recognizable draft itinerary.
//
// The rule, in plain terms: photos taken close together in PLACE and close in
// TIME belong to the same stop. A big jump in either starts a new stop. We
// sort by time, then walk: a photo joins the current stop if it is within
// CLUSTER_RADIUS_KM of the stop's running centroid and within CLUSTER_GAP_HRS
// of the previous photo; otherwise it opens a new stop.
//
// Pure, no DOM. Loaded as a plain global: defines `const PhotoCluster = ...`
// at 2-space indent so tests/core-loader.js can scrape it.

  const PhotoCluster = (() => {
    // tunables — clusters must be VISIT-SITE-sized, because stops are NAMED by
    // the nearest gazetteer city. EASTBOURNE_INCIDENT (Jul 2026): at 60km a
    // South-of-England trip chain-merged into ONE stop via the running centroid
    // and 124 photos got labelled "Eastbourne". The owner's actual stops
    // (Worthing / Arundel / West Wittering / Chichester) sit 9-15km apart, so
    // even a town-scale 15km still blobs them: 6km ≈ one village/beach/site.
    // Big cities that now split in two are folded back by mergeSameCity's
    // NAME-equality rule (both halves resolve to "Rome" → one stop) — split
    // resolution comes from the radius, merge truth comes from the gazetteer.
    const CLUSTER_RADIUS_KM = 6;    // photos within this of the stop centroid join it
    const CLUSTER_GAP_HRS = 14;     // a gap longer than this starts a new stop
    const MIN_PHOTOS_PER_STOP = 1;  // keep even single-photo stops (user can merge)

    // haversine great-circle distance in km
    const distanceKm = (aLat, aLon, bLat, bLon) => {
      const R = 6371;
      const toRad = (d) => d * Math.PI / 180;
      const dLat = toRad(bLat - aLat);
      const dLon = toRad(bLon - aLon);
      const s = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
    };

    // running centroid of a stop's photos (simple lat/lon mean — fine at trip
    // scale; we are not navigating, just naming a stop's rough position).
    const centroid = (photos) => {
      let lat = 0, lon = 0;
      for (const p of photos) { lat += p.lat; lon += p.lon; }
      return { lat: lat / photos.length, lon: lon / photos.length };
    };

    // cluster an array of photos into ordered stops.
    //   input photo:  { lat, lon, timestamp, ...anything else (kept) }
    //   opts.cityKey: optional (lat,lon)=>string — the nearest-gazetteer-city
    //     resolver the caller will NAME stops with; lets the same-city merge
    //     use name equality (see mergeSameCity).
    //   output stop:  { photos:[...], lat, lon, start, end }
    //     - photos: the photos assigned to this stop, in time order
    //     - lat/lon: the stop centroid
    //     - start/end: min/max timestamp across the stop's photos (ms, or null)
    // Photos missing GPS are dropped (can't be placed). Photos missing a
    // timestamp still cluster by location — they just don't gate on time.
    const cluster = (photos, opts) => {
      const placed = (photos || []).filter(
        (p) => p && typeof p.lat === 'number' && typeof p.lon === 'number');
      if (placed.length === 0) return [];

      // sort by timestamp; undated photos sink to the end (still placeable)
      const sorted = placed.slice().sort((a, b) => {
        const ta = a.timestamp == null ? Infinity : a.timestamp;
        const tb = b.timestamp == null ? Infinity : b.timestamp;
        return ta - tb;
      });

      const stops = [];
      let current = null;
      let prevTs = null;

      for (const photo of sorted) {
        let startNew = false;
        if (!current) {
          startNew = true;
        } else {
          const c = centroid(current.photos);
          const farInSpace = distanceKm(c.lat, c.lon, photo.lat, photo.lon) > CLUSTER_RADIUS_KM;
          let farInTime = false;
          if (photo.timestamp != null && prevTs != null) {
            farInTime = (photo.timestamp - prevTs) > CLUSTER_GAP_HRS * 3600 * 1000;
          }
          startNew = farInSpace || farInTime;
        }
        if (startNew) {
          current = { photos: [] };
          stops.push(current);
        }
        current.photos.push(photo);
        if (photo.timestamp != null) prevTs = photo.timestamp;
      }

      // finalize each stop: centroid + time span
      const finalized = stops
        .filter((s) => s.photos.length >= MIN_PHOTOS_PER_STOP)
        .map((s) => {
          const c = centroid(s.photos);
          const times = s.photos.map((p) => p.timestamp).filter((t) => t != null);
          return {
            photos: s.photos,
            lat: c.lat,
            lon: c.lon,
            start: times.length ? Math.min(...times) : null,
            end: times.length ? Math.max(...times) : null,
          };
        });
      return mergeSameCity(finalized, opts && opts.cityKey);
    };

    // SAME_CITY_CLUSTER_COUNCIL (#70) — the time-gap rule (CLUSTER_GAP_HRS)
    // splits an overnight stay in ONE city into multiple clusters (the user
    // saw "3 Kayseris"). Council verdict: auto-MERGE consecutive clusters
    // whose centroids sit within CLUSTER_RADIUS_KM of each other (i.e. the
    // same city) into one stop spanning the full date range. No schema
    // change — the flat { photos, lat, lon, start, end } shape already
    // expresses a multi-day stay (wider start/end, longer photos[]). A
    // there-and-back route (A→B→A) is NOT merged because B sits between the
    // two A clusters, so they aren't CONSECUTIVE.
    // Two ways consecutive clusters count as "the same place":
    //  (a) NAME equality — when the caller provides cityKey(lat,lon) (the
    //      nearest-gazetteer-city resolver the import uses for naming), two
    //      consecutive clusters that resolve to the SAME name merge, capped at
    //      SAME_NAME_KM so an ultra-sparse dict region (two towns 200km apart
    //      both nearest "Tripoli") doesn't fold genuinely distinct stops.
    //      This is what folds an overnight stay (the "3 Kayseris" council fix)
    //      AND a big city the 6km radius split in halves.
    //  (b) geometric fallback — no cityKey (older callers/tests): merge only
    //      when centroids are within SAME_CITY_KM. Tight, because at 6km
    //      cluster radius the owner's real stops sit 9-15km apart.
    const SAME_CITY_KM = 5;
    const SAME_NAME_KM = 30;
    const mergeSameCity = (clusters, cityKey) => {
      if (!Array.isArray(clusters) || clusters.length < 2) return clusters || [];
      const keyOf = (lat, lon) => {
        if (typeof cityKey !== 'function') return null;
        try { return cityKey(lat, lon) || null; } catch { return null; }
      };
      const samePlace = (a, b) => {
        const d = distanceKm(a.lat, a.lon, b.lat, b.lon);
        const ka = keyOf(a.lat, a.lon);
        const kb = keyOf(b.lat, b.lon);
        if (ka != null && kb != null) return ka === kb && d <= SAME_NAME_KM;
        return d <= SAME_CITY_KM;
      };
      // One day-cluster's reconstruction record: the date span + the photos
      // that fell in it. #77 P1 "split into days" replays these to rebuild the
      // day chapters losslessly (merged:N alone was just a count). photoIds is
      // preferred; we also keep the photo objects so a split can re-attach them
      // without re-reading EXIF.
      const dayRec = (cl) => {
        const times = cl.photos.map((p) => p.timestamp).filter((t) => t != null);
        return {
          start: times.length ? Math.min(...times) : (cl.start ?? null),
          end: times.length ? Math.max(...times) : (cl.end ?? null),
          photoIds: cl.photos.map((p) => p.id).filter((x) => x != null),
          photos: cl.photos,
        };
      };
      const out = [];
      for (const c of clusters) {
        const prev = out[out.length - 1];
        if (prev && samePlace(prev, c)) {
          // same city as the immediately-preceding stop → merge in place
          const photos = prev.photos.concat(c.photos);
          const ctr = centroid(photos);
          const times = photos.map((p) => p.timestamp).filter((t) => t != null);
          // seed dayClusters from prev (its own record if not yet merged) then
          // append this cluster's record — preserves per-day boundaries in order.
          const dayClusters = (prev.dayClusters || [dayRec(prev)]).concat([dayRec(c)]);
          out[out.length - 1] = {
            photos,
            lat: ctr.lat,
            lon: ctr.lon,
            start: times.length ? Math.min(...times) : null,
            end: times.length ? Math.max(...times) : null,
            merged: (prev.merged || 1) + 1, // how many day-clusters folded in (for an undoable "split into days")
            dayClusters, // per-day reconstruction records for "split into days"
          };
        } else {
          out.push(c);
        }
      }
      return out;
    };

    // E33 — same logic but also returns the photos that did NOT make it
    // onto any kept cluster. A photo can fall out here for two reasons:
    //  (a) the parent cluster failed the MIN_PHOTOS_PER_STOP filter — a
    //      lone photo in a place by itself (a layover, an in-flight snap);
    //  (b) it has no GPS at all (filtered before clustering even starts).
    // Callers should feed (b) separately into the returned unallocated
    // array — cluster() only sees photos with valid GPS.
    const clusterWithUnallocated = (photos, opts) => {
      const all = photos || [];
      const placed = all.filter(
        (p) => p && typeof p.lat === 'number' && typeof p.lon === 'number');
      const noGps = all.filter(
        (p) => !p || typeof p.lat !== 'number' || typeof p.lon !== 'number');

      const sorted = placed.slice().sort((a, b) => {
        const ta = a.timestamp == null ? Infinity : a.timestamp;
        const tb = b.timestamp == null ? Infinity : b.timestamp;
        return ta - tb;
      });

      const stopsRaw = [];
      let current = null;
      let prevTs = null;
      for (const photo of sorted) {
        let startNew = false;
        if (!current) {
          startNew = true;
        } else {
          const c = centroid(current.photos);
          const farInSpace = distanceKm(c.lat, c.lon, photo.lat, photo.lon) > CLUSTER_RADIUS_KM;
          let farInTime = false;
          if (photo.timestamp != null && prevTs != null) {
            farInTime = (photo.timestamp - prevTs) > CLUSTER_GAP_HRS * 3600 * 1000;
          }
          startNew = farInSpace || farInTime;
        }
        if (startNew) {
          current = { photos: [] };
          stopsRaw.push(current);
        }
        current.photos.push(photo);
        if (photo.timestamp != null) prevTs = photo.timestamp;
      }

      const keptStops = [];
      const orphans = [];
      for (const s of stopsRaw) {
        if (s.photos.length >= MIN_PHOTOS_PER_STOP) {
          const c = centroid(s.photos);
          const times = s.photos.map((p) => p.timestamp).filter((t) => t != null);
          keptStops.push({
            photos: s.photos,
            lat: c.lat, lon: c.lon,
            start: times.length ? Math.min(...times) : null,
            end:   times.length ? Math.max(...times) : null,
          });
        } else {
          for (const p of s.photos) orphans.push(p);
        }
      }
      // #70 — same-city merge applies here too (the mobile-import path).
      return { stops: mergeSameCity(keptStops, opts && opts.cityKey),
               unallocated: [...orphans, ...noGps] };
    };

    return { cluster, clusterWithUnallocated, mergeSameCity, distanceKm,
             CLUSTER_RADIUS_KM, CLUSTER_GAP_HRS };
  })();
