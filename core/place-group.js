// core/place-group.js — return-visit coalescing (MULTIDAY_STAYS_COUNCIL P0).
//
// A trip's stops are a FLAT sequence — the single source of truth for
// geometry, order, and routing. When the same place appears more than once
// (Rome → Naples → Rome), the map should draw ONE pin with a "×N" badge while
// the geometry layer still sees every stop. This module is the pure grouping
// logic: it never touches the canvas, the DOM, or storage.
//
// Coalescing key (per the council): a stop's `placeId` if present, else a
// rounded lat/lon string. The rounding tolerance matches autocomplete's
// `sameCityKey` (< 0.001°), so two stops the editor would treat as the same
// city also coalesce here — and legacy trips with duped coords de-pile for
// free, with no migration and no schema bump.
//
// Pure, no DOM. Loaded as a plain global: defines `const PlaceGroup = ...` at
// 2-space indent so tests/core-loader.js can scrape it (same convention as
// core/photo-cluster.js).

  const PlaceGroup = (() => {
    // Rounded-coords fallback key. 3 decimal places ≈ 110 m, matching the
    // 0.001° tolerance sameCityKey uses to decide "same city".
    const coordKey = (stop) =>
      'c:' + (Math.round((stop.lat || 0) * 1e3) / 1e3) + ',' +
      (Math.round((stop.lon || 0) * 1e3) / 1e3);

    // The grouping key for one stop: prefer the stable placeId, else coords.
    const placeKey = (stop) => (stop && stop.placeId) ? 'p:' + stop.placeId : coordKey(stop || {});

    // Group a flat stop list by place, preserving first-appearance order.
    // Returns an array of groups: { key, stops:[...], indices:[...], count }.
    // `count` is the number of visits — drives the "×N" badge (>1 = return).
    const coalesceStops = (stops) => {
      const byKey = new Map();
      const order = [];
      (stops || []).forEach((stop, i) => {
        const key = placeKey(stop);
        let g = byKey.get(key);
        if (!g) { g = { key, stops: [], indices: [] }; byKey.set(key, g); order.push(key); }
        g.stops.push(stop);
        g.indices.push(i);
      });
      return order.map((key) => {
        const g = byKey.get(key);
        return { key, stops: g.stops, indices: g.indices, count: g.stops.length };
      });
    };

    // #77 P1 — "split into days". A merged stay (mergeSameCity folded N
    // day-clusters into one stop, recording each in stop.dayClusters) can be
    // expanded into presentation-only `days[]` chapters: one { date, title,
    // note, photoIds } per folded day, photos pre-attached. Pure + reversible:
    // returns a NEW days[] array; never mutates the stop, never touches coords
    // or routing (chapters carry no lat/lon — a located venue is a stop, not a
    // chapter, per the council). Returns null when there's nothing to split
    // (no dayClusters, or fewer than 2 days).
    const splitIntoDays = (stop) => {
      const dc = stop && stop.dayClusters;
      if (!Array.isArray(dc) || dc.length < 2) return null;
      const isoDay = (ts) => (ts == null ? '' : new Date(ts).toISOString().slice(0, 10));
      return dc.map((d, i) => ({
        date: isoDay(d.start),
        title: 'Day ' + (i + 1),
        note: '',
        photoIds: Array.isArray(d.photoIds) ? d.photoIds.slice() : [],
      }));
    };

    return { placeKey, coordKey, coalesceStops, splitIntoDays };
  })();
