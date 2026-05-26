// core/route-geometry.js — WS-16 / route-direction.
//
// Pure helpers for route directionality:
//   1. Antimeridian unwrap. The route polyline is drawn in projected
//      Web-Mercator pixel space (see project() in src/boot.js). The
//      Mercator world is a unit square — a leg from Yokohama (lon
//      +139.7) to San Francisco (lon -122.4) projected naively walks
//      LEFT across the whole map. Detecting |Δlon| > 180 and shifting
//      the destination lon by ±360° before projecting puts the leg
//      across the Pacific, exiting the right edge as expected.
//   2. bearingHint. For trips with historical directionality (Verne's
//      Fogg goes EAST around the world) a leg can pin the chosen arc
//      with `bearingHint: "east" | "west" | "north" | "south"` (or
//      `{ degreesFromNorth }`). When set, the unwrap respects the hint
//      even if |Δlon| < 180 — useful for a leg like Hong Kong → Tokyo
//      where the short path is east but the hint just makes intent
//      explicit.
//   3. via expansion. `leg.via = [{lat, lon}, ...]` injects ordered
//      intermediate waypoints between stops[i] and stops[i+1]. The
//      polyline becomes stop[i] -> via[0] -> via[1] -> ... -> stop[i+1].
//      Each sub-segment runs through the same unwrap so transpacific
//      via points (lon -170) stay east of Yokohama (lon +139).
//
// Backwards-compatible: legs with neither `via` nor `bearingHint`
// produce the exact same single sub-segment as the pre-WS-16 code path
// (linear in projected pixel space, no longitude shift).

  // Normalise a bearingHint into a sign-of-Δlon expectation:
  //   +1 → destination lon must be > source lon (east-of)
  //   -1 → destination lon must be < source lon (west-of)
  //    0 → no longitudinal preference (north/south or none)
  const _bearingLonSign = (hint) => {
    if (!hint) return 0;
    if (typeof hint === 'string') {
      const h = hint.toLowerCase();
      if (h === 'east') return +1;
      if (h === 'west') return -1;
      if (h === 'north' || h === 'south') return 0;
      return 0;
    }
    if (typeof hint === 'object' && typeof hint.degreesFromNorth === 'number') {
      // 0 = N, 90 = E, 180 = S, 270 = W. Normalise to [0, 360).
      let d = hint.degreesFromNorth % 360;
      if (d < 0) d += 360;
      if (d > 0 && d < 180) return +1;       // eastward arc
      if (d > 180 && d < 360) return -1;     // westward arc
      return 0;                              // due north / south
    }
    return 0;
  };

  // Unwrap the destination longitude relative to the source so the
  // pixel-space straight line goes the intended way around the globe.
  //
  // Rules:
  //   * If a bearingHint pins a direction, force the sign of (toLon - fromLon)
  //     to match — adding/subtracting 360 once is enough since |Δlon| < 360.
  //   * Else, if the raw |Δlon| > 180, shift by ±360 so the unwrapped
  //     Δlon is the short way around. This is the antimeridian fix.
  //   * Else, return toLon unchanged. Existing trips are byte-identical.
  const unwrapLonForLeg = (fromLon, toLon, bearingHint) => {
    const sign = _bearingLonSign(bearingHint);
    let dest = toLon;
    if (sign === +1) {
      // dest must be east of source → dest > fromLon
      while (dest <= fromLon) dest += 360;
    } else if (sign === -1) {
      while (dest >= fromLon) dest -= 360;
    } else {
      // no hint: pick the short way around
      const d = dest - fromLon;
      if (d > 180) dest -= 360;
      else if (d < -180) dest += 360;
    }
    return dest;
  };

  // Expand a leg into an ordered list of {lat, lon} polyline vertices,
  // with longitudes already unwrapped relative to the previous vertex
  // so sub-segments project to straight lines that respect direction.
  //
  // Input:
  //   from         = { lat, lon }      — stops[i]
  //   to           = { lat, lon }      — stops[i+1]
  //   leg          = { via?: [{lat,lon}], bearingHint?: ... }
  //
  // Output: an array of length 2 + (via?.length || 0). [0] is the
  // source vertex (unchanged), each subsequent vertex's lon is unwrapped
  // relative to the previous vertex's (already-unwrapped) lon. The
  // bearingHint applies to the WHOLE leg — the unwrap of the first via
  // and of every subsequent vertex respects the hinted sign.
  const expandLegVertices = (from, to, leg) => {
    const out = [{ lat: from.lat, lon: from.lon }];
    const hint = leg && leg.bearingHint;
    const via = (leg && Array.isArray(leg.via)) ? leg.via : [];
    let prevLon = from.lon;
    for (const v of via) {
      if (!v || typeof v.lat !== 'number' || typeof v.lon !== 'number') continue;
      const lon = unwrapLonForLeg(prevLon, v.lon, hint);
      out.push({ lat: v.lat, lon });
      prevLon = lon;
    }
    const destLon = unwrapLonForLeg(prevLon, to.lon, hint);
    out.push({ lat: to.lat, lon: destLon });
    return out;
  };

  // Maximum |Δlon| within a polyline (post-unwrap). Used by tests to
  // assert no sub-segment is itself an antimeridian-class wrap (every
  // sub-segment should be < 180° wide after expansion).
  const maxSubLegDeltaLon = (verts) => {
    let m = 0;
    for (let i = 1; i < verts.length; i++) {
      const d = Math.abs(verts[i].lon - verts[i-1].lon);
      if (d > m) m = d;
    }
    return m;
  };
