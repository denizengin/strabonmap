// core/trip-modality-geom.js — geometry primitives for core/trip-modality.js.
//
// Extracted from core/trip-modality.js (#136 core-split) to keep both files
// under the LOC budget. PURE + FRAMEWORK-FREE, same bare 2-space-indent
// `const` style as the parent: each top-level const becomes a browser global
// on load. MUST load BEFORE core/trip-modality.js (the parent references
// makeLandClassifier + _haversineKm by bare name). No IIFE, no exports.
//
// Holds the ray-cast point-in-ring test, the binned land classifier, and the
// haversine helper. makeLandClassifier is a published global consumed
// downstream; _pointInRing / _haversineKm are file-private-by-convention
// helpers shared with trip-modality.js's sampler + validator.

  // ── Land / sea classifier ───────────────────────────────────────────────
  // Ray-casting point-in-polygon over the coarse Natural Earth land polygons.
  // Coords are [lon, lat, synthetic?]; the synthetic 3rd element is ignored
  // (it only marks bbox-clip vertices for the renderer). NATURAL_EARTH_FC is
  // all simple Polygons; the first ring is the outer boundary, any further
  // rings are holes (e.g. a sea inlet inside a landmass) — a point in a hole
  // is NOT land.
  const _pointInRing = (lon, lat, ring) => {
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

  // makeLandClassifier(landFC) → (lon, lat) => boolean (true === land).
  // Pre-bins polygons by lon/lat bounding box so the per-point scan skips the
  // ~99% of features that cannot contain the point — cheap enough to sample
  // every leg of every sample trip in a fraction of a second.
  const makeLandClassifier = (landFC) => {
    const feats = (landFC && Array.isArray(landFC.features)) ? landFC.features : [];
    const bins = feats.map((f) => {
      const rings = f.geometry.coordinates;
      let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
      const outer = rings[0];
      for (const p of outer) {
        if (p[0] < minLon) minLon = p[0];
        if (p[0] > maxLon) maxLon = p[0];
        if (p[1] < minLat) minLat = p[1];
        if (p[1] > maxLat) maxLat = p[1];
      }
      return { rings, minLon, maxLon, minLat, maxLat };
    });
    return (lon, lat) => {
      for (const b of bins) {
        if (lon < b.minLon || lon > b.maxLon || lat < b.minLat || lat > b.maxLat) continue;
        if (!_pointInRing(lon, lat, b.rings[0])) continue;
        let inHole = false;
        for (let h = 1; h < b.rings.length; h++) {
          if (_pointInRing(lon, lat, b.rings[h])) { inHole = true; break; }
        }
        if (!inHole) return true;
      }
      return false;
    };
  };

  // ── haversine ───────────────────────────────────────────────────────────
  // Great-circle distance in km between two {lat,lon}. Shared by the parent's
  // sampleLegPath (sample spacing) + validateLeg (leg length).
  const _haversineKm = (a, b) => {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const la1 = toRad(a.lat), la2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };
