// core/hub-detect.js — the home-HUB model (P1, two-journeys folio).
//
// A HUB is a base a journey keeps returning to: Kazafana across a Cyprus
// holiday, or Bodrum then Rhodes across the Aegean. The council + Fable's
// director pass hinge on it — the come-home heartbeat, the brightening hearth,
// petal day-trips, day-trip grouping, and the "Based in <place>" title/FIN all
// ask "which stop is the base, and how many times did we come home to it?".
//
// PURE detector — no DOM, no store. Takes a trip's `cities` and returns hub info
// by COORDINATE PROXIMITY (not name equality): sub-gazetteer villages pin-dropped
// a few metres apart on different days still fold into one base (the council's
// core insight — name-equality merge can't do it). Respects an explicit
// `stop.isHub`/`hubId` when the author has declared one.
//
// Loaded as a plain global: defines `const hubDetect = ...` at 2-space indent so
// tests/core-loader.js can scrape it and the classic-script page reaches it by
// bare name.

  const hubDetect = (() => {
    const HUB_RADIUS_KM = 1.0;   // stops within 1 km are "the same base"
    const MIN_VISITS = 3;        // a base is a stop returned to >= 3 times

    const toRad = (d) => (d * Math.PI) / 180;
    // Great-circle km — cheap + monotonic; matches core/photo-cluster's haversine.
    const distKm = (a, b) => {
      if (!a || !b || typeof a.lat !== 'number' || typeof b.lat !== 'number'
          || typeof a.lon !== 'number' || typeof b.lon !== 'number') return Infinity;
      const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
      const la1 = toRad(a.lat), la2 = toRad(b.lat);
      const h = Math.sin(dLat / 2) * Math.sin(dLat / 2)
        + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
      return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
    };

    // Group stop indices by proximity into candidate bases. Greedy single pass:
    // each stop joins the first group whose anchor is within radiusKm (or shares
    // an explicit hubId), else opens a new group. Deterministic (index order).
    const proximityGroups = (cities, radiusKm) => {
      const groups = []; // { anchorIdx, indices: [] }
      for (let i = 0; i < cities.length; i++) {
        const c = cities[i];
        if (!c || typeof c.lat !== 'number' || typeof c.lon !== 'number') continue;
        let joined = false;
        for (let g = 0; g < groups.length; g++) {
          const anchor = cities[groups[g].anchorIdx];
          if (c.hubId && anchor.hubId && c.hubId === anchor.hubId) {
            groups[g].indices.push(i); joined = true; break;
          }
          if (distKm(anchor, c) <= radiusKm) { groups[g].indices.push(i); joined = true; break; }
        }
        if (!joined) groups.push({ anchorIdx: i, indices: [i] });
      }
      return groups;
    };

    // Detect the trip's hub(s). Returns:
    //   { hubs: [ { key, indices, count, name, lat, lon, declared, primary } ], primaryKey }
    // A hub is a proximity group visited >= MIN_VISITS times, OR any group whose
    // stops carry isHub (author-declared, even a single visit). `primary` = the
    // most-visited base. `key` = 'hub:<anchorIdx>' — a stable id needing no new field.
    const detectHubs = (cities, opts) => {
      cities = Array.isArray(cities) ? cities : [];
      const radius = (opts && typeof opts.radiusKm === 'number') ? opts.radiusKm : HUB_RADIUS_KM;
      const minVisits = (opts && typeof opts.minVisits === 'number') ? opts.minVisits : MIN_VISITS;
      const groups = proximityGroups(cities, radius);
      const hubs = [];
      for (let g = 0; g < groups.length; g++) {
        const idxs = groups[g].indices;
        const declared = idxs.some((i) => cities[i] && cities[i].isHub);
        if (idxs.length < minVisits && !declared) continue;
        const anchor = cities[groups[g].anchorIdx];
        hubs.push({
          key: 'hub:' + groups[g].anchorIdx,
          indices: idxs.slice(),
          count: idxs.length,
          name: (anchor.displayName || anchor.name || '').trim(),
          lat: anchor.lat, lon: anchor.lon,
          declared,
          primary: false,
        });
      }
      let primaryKey = null, best = -1;
      for (let h = 0; h < hubs.length; h++) {
        if (hubs[h].count > best) { best = hubs[h].count; primaryKey = hubs[h].key; }
      }
      for (let k = 0; k < hubs.length; k++) hubs[k].primary = (hubs[k].key === primaryKey);
      return { hubs, primaryKey };
    };

    // Is stop `idx` part of ANY detected hub? Returns the hub or null.
    const hubForStop = (detection, idx) => {
      if (!detection || !detection.hubs) return null;
      for (let h = 0; h < detection.hubs.length; h++) {
        if (detection.hubs[h].indices.indexOf(idx) !== -1) return detection.hubs[h];
      }
      return null;
    };

    // P2 (#183) proximity-snap: the EXISTING stop nearest to a dropped point,
    // within `radiusKm` (default 0.8km), excluding `exceptIdx` (the stop being
    // moved). Returns { idx, name, lat, lon, km } or null. Lets the pin-drop
    // commit offer "this looks like <existing> — snap to it?" so a base
    // pin-dropped a few metres off doesn't spawn a spurious duplicate ring.
    const nearestOtherStop = (cities, lat, lon, exceptIdx, radiusKm) => {
      cities = Array.isArray(cities) ? cities : [];
      const r = (typeof radiusKm === 'number') ? radiusKm : 0.8;
      if (typeof lat !== 'number' || typeof lon !== 'number') return null;
      let best = null;
      for (let i = 0; i < cities.length; i++) {
        if (i === exceptIdx) continue;
        const c = cities[i];
        if (!c || typeof c.lat !== 'number' || typeof c.lon !== 'number') continue;
        const km = distKm({ lat, lon }, c);
        if (km <= r && (!best || km < best.km)) {
          best = { idx: i, name: (c.displayName || c.name || '').trim(), lat: c.lat, lon: c.lon, km };
        }
      }
      return best;
    };

    // P2 (#184) day-trip grouping: split a hub trip into EXCURSION segments —
    // each run of stops BETWEEN two hub visits (base → spoke(s) → back to base).
    // Returns [{ startIdx, endIdx, spokeIdxs: [...], label }] where start/end are
    // the bracketing hub rows and spokeIdxs are the non-hub stops in between; the
    // label names the excursion ("to Nicosia & back", or "to Nicosia, Kyrenia &
    // back"). Only segments with >= 1 spoke count (a hub→hub with nothing between
    // is not a day-trip). Empty when there is no hub. Pure — the editor renders
    // foldable group headers off this; playback/FIN can reuse it.
    const dayTripSegments = (cities) => {
      cities = Array.isArray(cities) ? cities : [];
      const det = detectHubs(cities);
      if (!det.primaryKey) return [];
      // A stop is "at the base" if it belongs to the PRIMARY hub (the main base).
      const primary = det.hubs.find((h) => h.primary);
      if (!primary) return [];
      const atBase = new Set(primary.indices);
      const segs = [];
      let i = 0;
      while (i < cities.length) {
        if (!atBase.has(i)) { i++; continue; }
        // i is a base visit; scan forward for spokes until the next base visit.
        let j = i + 1;
        const spokes = [];
        while (j < cities.length && !atBase.has(j)) { spokes.push(j); j++; }
        if (spokes.length && j < cities.length) {
          const names = spokes
            .map((k) => (cities[k].displayName || cities[k].name || '').trim())
            .filter(Boolean);
          let label = 'day-trip';
          if (names.length === 1) label = `to ${names[0]} & back`;
          else if (names.length === 2) label = `to ${names[0]} & ${names[1]} & back`;
          else if (names.length > 2) label = `to ${names[0]}, ${names[1]} & ${names.length - 2} more & back`;
          segs.push({ startIdx: i, endIdx: j, spokeIdxs: spokes.slice(), label });
        }
        i = j; // continue from the closing base visit
      }
      return segs;
    };

    return { detectHubs, hubForStop, nearestOtherStop, dayTripSegments, distKm, HUB_RADIUS_KM, MIN_VISITS };
  })();

  // Publish the bare-name global for classic-script consumers + the bundles.
  try { (typeof globalThis !== 'undefined' ? globalThis : this).hubDetect = hubDetect; } catch (e) {}
