// core/sea-router-geo.js — geo helpers + land classifiers + sampling for the
// sea router (extracted from core/sea-router.js, #136 core-split).
//
// PURE + FRAMEWORK-FREE, same bare 2-space-indent `const` style as the parent:
// each top-level const becomes a browser global on load. MUST load BEFORE
// core/sea-router.js (the parent's routeSeaLeg references chordCrossesLand;
// the A* file references _seaHaversineKm + _segOverLand) AND before
// core/sea-router-astar.js. No IIFE, no exports.
//
// Published globals consumed downstream (KEEP byte-identical): makeFCLandClassifier.
// The rest (makePackLandClassifier / regionPackVersion / chordCrossesLand /
// _seaHaversineKm / _segOverLand / _simplifyPath …) are sea-router-internal
// helpers that simply happen to live at top level.

  // ── small geo helpers ────────────────────────────────────────────────────
  const _seaHaversineKm = (alat, alon, blat, blon) => {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(blat - alat);
    const dLon = toRad(blon - alon);
    const la1 = toRad(alat), la2 = toRad(blat);
    const hav = Math.sin(dLat / 2) ** 2 +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(hav)));
  };

  // Ray-cast point-in-ring. ring = [[lon,lat],...] (synthetic 3rd element on
  // bbox-edge verts is ignored). Mirrors core/trip-modality.js:_pointInRing.
  const _seaPointInRing = (lon, lat, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > lat) !== (yj > lat)) &&
        (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };

  // ── region-pack land classifier ───────────────────────────────────────────
  // makePackLandClassifier(pack) → (lon,lat) => boolean.
  //
  // A region pack (data/regions/<id>.json) carries `coast: [ring, ring, ...]`
  // where each ring is [[lon,lat],...]. Per the pack format, the FIRST ring is
  // a synthetic bbox rectangle (its verts are tagged [lon,lat,1]) used by the
  // renderer to clip; the real landmass coastlines are the subsequent rings.
  // We treat every ring whose verts are NOT all synthetic as a land polygon
  // and test point-in-any-ring. A point inside any real coast ring is land.
  //
  // (The pack coast rings are closed loops around landmasses; a sea point in
  // the bbox is inside NONE of them.)
  const _ringIsSynthetic = (ring) => {
    if (!ring || ring.length === 0) return true;
    for (const p of ring) { if (p[2] !== 1) return false; }
    return true;
  };
  const makePackLandClassifier = (pack) => {
    const rings = (pack && Array.isArray(pack.coast) ? pack.coast : [])
      .filter((r) => Array.isArray(r) && r.length >= 3 && !_ringIsSynthetic(r));
    // Pre-compute each ring's bbox for a cheap reject.
    const bins = rings.map((ring) => {
      let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const p of ring) {
        if (p[0] < minLon) minLon = p[0];
        if (p[0] > maxLon) maxLon = p[0];
        if (p[1] < minLat) minLat = p[1];
        if (p[1] > maxLat) maxLat = p[1];
      }
      return { ring, minLon, maxLon, minLat, maxLat };
    });
    return (lon, lat) => {
      for (const b of bins) {
        if (lon < b.minLon || lon > b.maxLon || lat < b.minLat || lat > b.maxLat) continue;
        if (_seaPointInRing(lon, lat, b.ring)) return true;
      }
      return false;
    };
  };

  // ── coarse global land classifier ─────────────────────────────────────────
  // makeFCLandClassifier(landFC) → (lon,lat) => boolean over a GeoJSON
  // FeatureCollection of Polygon / MultiPolygon land features (the coarse
  // NATURAL_EARTH_FC set, [lon,lat] coords, ring[0]=outer, rest=holes). Self-
  // contained so sea-router does not have to depend on core/trip-modality.js
  // being script-loaded first (it is added to index.html by a sibling agent;
  // load order between two new <script> tags must not be a hard dependency).
  // Pre-bins each polygon by bbox for a cheap reject. Equivalent in behaviour
  // to trip-modality.js:makeLandClassifier.
  const makeFCLandClassifier = (landFC) => {
    const feats = (landFC && Array.isArray(landFC.features)) ? landFC.features : [];
    const bins = [];
    const addPoly = (rings) => {
      if (!Array.isArray(rings) || !rings.length) return;
      const outer = rings[0];
      let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const p of outer) {
        if (p[0] < minLon) minLon = p[0];
        if (p[0] > maxLon) maxLon = p[0];
        if (p[1] < minLat) minLat = p[1];
        if (p[1] > maxLat) maxLat = p[1];
      }
      bins.push({ rings, minLon, maxLon, minLat, maxLat });
    };
    for (const f of feats) {
      const g = f && f.geometry;
      if (!g) continue;
      if (g.type === 'Polygon') addPoly(g.coordinates);
      else if (g.type === 'MultiPolygon') (g.coordinates || []).forEach(addPoly);
    }
    return (lon, lat) => {
      for (const b of bins) {
        if (lon < b.minLon || lon > b.maxLon || lat < b.minLat || lat > b.maxLat) continue;
        if (!_seaPointInRing(lon, lat, b.rings[0])) continue;
        let inHole = false;
        for (let h = 1; h < b.rings.length; h++) {
          if (_seaPointInRing(lon, lat, b.rings[h])) { inHole = true; break; }
        }
        if (!inHole) return true;
      }
      return false;
    };
  };

  // regionPackVersion(pack) → a string that changes when the pack content does.
  // Prefer the pack's `generated` date; fall back to a cheap content hash over
  // the coast rings so an unstamped pack still busts the cache on edit. A null
  // pack (coarse global fallback) versions as 'global'.
  const regionPackVersion = (pack) => {
    if (!pack) return 'global';
    if (typeof pack.generated === 'string' && pack.generated) {
      return (pack.region || 'pack') + '@' + pack.generated;
    }
    // content hash (djb2) over coast vertex count + a few sampled coords
    const coast = Array.isArray(pack.coast) ? pack.coast : [];
    let h = 5381;
    let n = 0;
    for (const ring of coast) {
      n += ring.length;
      const step = Math.max(1, Math.floor(ring.length / 8));
      for (let i = 0; i < ring.length; i += step) {
        h = ((h << 5) + h + ring[i][0] * 1000 + ring[i][1]) | 0;
      }
    }
    return (pack.region || 'pack') + '#' + n + ':' + (h >>> 0).toString(36);
  };

  // ── sampling ───────────────────────────────────────────────────────────────
  // Walk the via-expanded chord at `stepKm` spacing, INCLUDING endpoints.
  // Returns [{lat,lon,t}] (t∈[0,1]).
  const _sampleChord = (verts, stepKm, maxSamples) => {
    const segLens = [];
    let total = 0;
    for (let i = 0; i < verts.length - 1; i++) {
      const d = _seaHaversineKm(verts[i].lat, verts[i].lon, verts[i + 1].lat, verts[i + 1].lon);
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

  // chordCrossesLand(verts, isLand, opts) → boolean. True if any INTERIOR
  // sample (endpoints excluded — ports sit a pixel onshore in coarse data) is
  // on land.
  const chordCrossesLand = (verts, isLand, opts) => {
    const o = opts || {};
    const stepKm = o.stepKm || 40;
    const maxSamples = o.maxSamples || 400;
    const samples = _sampleChord(verts, stepKm, maxSamples);
    for (let i = 1; i < samples.length - 1; i++) {
      if (isLand(samples[i].lon, samples[i].lat)) return true;
    }
    return false;
  };

  // Does the straight segment a→b pass over land? Samples it finely. Used both
  // by the A* edge-land check (#112) and to keep simplification land-AWARE: we
  // only drop a waypoint when the shortcut it creates stays over water, so
  // simplification can never re-introduce a land crossing by chording across a
  // coast concavity.
  const _segOverLand = (a, b, isLand, stepDeg) => {
    const step = stepDeg || 0.08;
    const dLon = b.lon - a.lon, dLat = b.lat - a.lat;
    const n = Math.max(1, Math.ceil(Math.hypot(dLon, dLat) / step));
    for (let i = 1; i < n; i++) {
      const f = i / n;
      if (isLand(a.lon + dLon * f, a.lat + dLat * f)) return true;
    }
    return false;
  };

  // Land-aware collinear simplification: drop a vertex when the path deviates
  // from the chord by less than `tolDeg` AND the shortcut chord stays over
  // water. Keeps the waypoint list small (a believable handful, not the full
  // grid trail) without ever cutting across a coast.
  const _simplifyPath = (pts, tolDeg, isLand) => {
    if (pts.length <= 2) return pts.slice();
    const tol = tolDeg || 0.06;
    const out = [pts[0]];
    let anchor = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[anchor], b = pts[i + 1], p = pts[i];
      // perpendicular distance of p to line a-b, in degrees (small-area ok)
      const dx = b.lon - a.lon, dy = b.lat - a.lat;
      const len = Math.hypot(dx, dy) || 1e-9;
      const dist = Math.abs((p.lon - a.lon) * dy - (p.lat - a.lat) * dx) / len;
      const wouldCutLand = (typeof isLand === 'function') && _segOverLand(a, b, isLand);
      if (dist > tol || wouldCutLand) { out.push(p); anchor = i; }
    }
    out.push(pts[pts.length - 1]);
    return out;
  };
