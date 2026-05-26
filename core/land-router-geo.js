// core/land-router-geo.js — geo + sampling + simplify helpers for the land
// router (extracted from core/land-router.js, #136 core-split).
//
// PURE + FRAMEWORK-FREE, same bare 2-space-indent `const` style as the parent:
// each top-level const becomes a browser global on load. MUST load BEFORE
// core/land-router.js (its routeLandLeg references chordCrossesWater /
// _lrSimplifyPath) AND before core/land-router-astar.js (which references
// _lrHaversineKm + _lrSegOverWater). No IIFE, no exports. Every helper keeps
// its `LR` suffix so it cannot collide with sea-router / trip-modality /
// route-geometry top-level symbols (the slice-1 const-collision trap).

  // ── small geo helper ───────────────────────────────────────────────────────
  const _lrHaversineKm = (alat, alon, blat, blon) => {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(blat - alat);
    const dLon = toRad(blon - alon);
    const la1 = toRad(alat), la2 = toRad(blat);
    const hav = Math.sin(dLat / 2) ** 2 +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(hav)));
  };

  // ── sampling (mirrors sea-router._sampleChord) ─────────────────────────────
  // Walk the via-expanded chord at `stepKm` spacing, INCLUDING endpoints.
  // Returns [{lat,lon,t}].
  const _lrSampleChord = (verts, stepKm, maxSamples) => {
    const segLens = [];
    let total = 0;
    for (let i = 0; i < verts.length - 1; i++) {
      const d = _lrHaversineKm(verts[i].lat, verts[i].lon, verts[i + 1].lat, verts[i + 1].lon);
      segLens.push(d);
      total += d;
    }
    if (total <= 0) return verts.map((v, i) => ({ lat: v.lat, lon: v.lon, t: i }));
    let n = Math.round(total / stepKm);
    if (n < 2) n = 2;
    if (n > maxSamples) n = maxSamples;
    const out = [];
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const target = t * total;
      let acc = 0, si = 0;
      while (si < segLens.length - 1 && acc + segLens[si] < target) { acc += segLens[si]; si++; }
      const segLen = segLens[si] || 1e-9;
      const f = Math.max(0, Math.min(1, (target - acc) / segLen));
      const a = verts[si], b = verts[si + 1];
      out.push({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, t });
    }
    return out;
  };

  // chordCrossesWater(verts, isLand, opts) → boolean. True if any INTERIOR
  // sample (endpoints excluded — a coastal stop sits a pixel offshore in coarse
  // data) is on WATER. This is the MIRROR of sea-router.chordCrossesLand: the
  // sea-router asks "does this water leg touch land?"; we ask "does this land
  // leg touch water?".
  const chordCrossesWater = (verts, isLand, opts) => {
    const o = opts || {};
    const stepKm = o.stepKm || 40;
    const maxSamples = o.maxSamples || 400;
    const samples = _lrSampleChord(verts, stepKm, maxSamples);
    for (let i = 1; i < samples.length - 1; i++) {
      if (!isLand(samples[i].lon, samples[i].lat)) return true;
    }
    return false;
  };

  // Does the straight segment a→b pass over water? Samples it finely. Used both
  // by the A* edge-water check (#112-mirror) and to keep simplification water-
  // AWARE: we only drop a waypoint when the shortcut it creates stays over
  // land, so simplification can never re-introduce a water crossing by chording
  // across a bay concavity.
  const _lrSegOverWater = (a, b, isLand, stepDeg) => {
    const step = stepDeg || 0.08;
    const dLon = b.lon - a.lon, dLat = b.lat - a.lat;
    const n = Math.max(1, Math.ceil(Math.hypot(dLon, dLat) / step));
    for (let i = 1; i < n; i++) {
      const f = i / n;
      if (!isLand(a.lon + dLon * f, a.lat + dLat * f)) return true;
    }
    return false;
  };

  // Water-aware collinear simplification: drop a vertex when the path deviates
  // from the chord by less than `tolDeg` AND the shortcut chord stays over
  // land. Keeps the waypoint list a believable handful without cutting across
  // a bay.
  const _lrSimplifyPath = (pts, tolDeg, isLand) => {
    if (pts.length <= 2) return pts.slice();
    const tol = tolDeg || 0.06;
    const out = [pts[0]];
    let anchor = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[anchor], b = pts[i + 1], p = pts[i];
      const dx = b.lon - a.lon, dy = b.lat - a.lat;
      const len = Math.hypot(dx, dy) || 1e-9;
      const dist = Math.abs((p.lon - a.lon) * dy - (p.lat - a.lat) * dx) / len;
      const wouldCutWater = (typeof isLand === 'function') && _lrSegOverWater(a, b, isLand);
      if (dist > tol || wouldCutWater) { out.push(p); anchor = i; }
    }
    out.push(pts[pts.length - 1]);
    return out;
  };
