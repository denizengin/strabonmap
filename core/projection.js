// core/projection.js — pure projection math, deterministic jitter seed, and
// point-in-polygon primitives. Shared by index.html + mobile.html. No DOM,
// no globals — every function here is pure. Loaded as plain globals.

// --- Web Mercator longitude/latitude -> unit-square coordinates ---
  const lonToMercX = (lon) => (lon + 180) / 360;
  const latToMercY = (lat) => {
    // E-F1 — clamp to the Web-Mercator limit (±85.0511°). Beyond it
    // tan(π/4 + φ/2) → ±∞ and log(...) → NaN, which propagated into
    // segment length → routeState.totalLength/progress = NaN (p07's
    // pole-to-pole silent-NaN). A pole is meaningless on Mercator anyway.
    const clamped = lat > 85.0511 ? 85.0511 : (lat < -85.0511 ? -85.0511 : lat);
    const phi = clamped * Math.PI / 180;
    return 0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI);
  };

// --- E73 — zoom-aware furniture scaling.
// Geography grows linearly with zoom; without this helper, every map
// "furniture" element (city dots, labels, plane silhouette, route
// dash width, dwell badges) stays a fixed pixel size and the world
// reads as stickers on a stretching backdrop. furnitureScale grows
// SUB-linearly so the furniture moves WITH the geography but slower,
// keeping density and readability at every zoom.
//
// Curve fitted to the design package's reference table:
//   zoom 4 → 0.85 (floor)
//   zoom 6 → ~1.11
//   zoom 8 → ~1.34
//   zoom 10 → ~1.56
//   zoom 12 → 1.70 (ceiling)
// Formula: clamp(0.85, 0.85 * (max(zoom, 4) / 4)^0.66, 1.7)
//
// TIER_2_ZOOM = 7 is exposed for callers that want the same threshold
// constant for non-scaling logic (region-pack detail kicks in here).
//
// Critical property: every element (label fontSize, dot radius,
// stroke width, etc.) multiplies by the SAME scale, so proportions
// between elements stay constant — a label that's 4.5× the dot at
// zoom 4 is still 4.5× the dot at zoom 8. ---
  const TIER_2_ZOOM = 7;
  const furnitureScale = (zoom) => {
    if (!isFinite(zoom)) return 0.85;
    const z = Math.max(0, zoom);
    const v = 0.85 * Math.pow(Math.max(z, 4) / 4, 0.66);
    return Math.max(0.85, Math.min(1.7, v));
  };

// --- WS-17 (19 May 2026) — zoomScale(zoom). Drives sprite/icon size for
// the vehicle silhouette, landmark icons, and city dots. Distinct from
// furnitureScale because at the high end (zoom 11) furnitureScale clamps
// at 1.7× which leaves the vehicle and icons visibly small against the
// coastline. zoomScale grows further: floor 0.7 at zoom 2, ceiling 2.5
// at zoom 11 (the engine clamps view.zoom to [2, 11]). Linear in zoom
// for monotonic predictability — testing zoom 2/5/11 must grow the
// sprite area monotonically.
//
// Why not just stretch furnitureScale? Labels at 2.5× start dominating
// the map; the design has wanted labels SMALLER than icons. Keep the
// two scales separate so future label tuning doesn't fight icon size.
//
// Range:    zoom  2 → 0.70
//           zoom  5 → 1.30
//           zoom  8 → 1.90
//           zoom 11 → 2.50
//
// Outside [2, 11] the function clamps at the endpoint values.
  const zoomScale = (zoom) => {
    if (!isFinite(zoom)) return 0.7;
    const z = Math.max(2, Math.min(11, zoom));
    const v = 0.7 + (2.5 - 0.7) * ((z - 2) / 9);
    return v;
  };

// --- WS-5 (19 May 2026) — orientVehicle(vehicleType, headingRad).
// Single source of truth for "which way does this vehicle's sprite
// point on screen given the leg's heading?" Returns a rotation angle
// in radians to apply at the canvas/DOM draw site.
//
// The SVG glyphs in src/boot.js are all drawn with the "front" pointing
// UP in the SVG frame (negative Y). When we want the sprite to face
// the heading vector (heading 0 rad = +X = east), we need to rotate
// by headingRad + PI/2 — that turns "up in SVG" into "along +X" for
// heading=0, and tracks the heading from there.
//
// Three orientation classes:
//   - fixed-north: balloon-family. A hot-air balloon's envelope is
//     always vertical because it's lifted by hot air, not propelled
//     along a heading. Return 0 regardless of headingRad.
//   - follows-heading: every powered/propelled/animal vehicle.
//     Return headingRad + PI/2.
//   - follows-heading-mirrored: a placeholder for left-facing SVG
//     assets. Same as follows-heading today; the registry below is
//     the place to flip a future asset.
//
// Pre-19-May regression: the canvas path was always applying
// headingRad + PI/2 to ALL vehicles, which spun the balloon envelope
// sideways at the first non-zero bearing and kept the chariot showing
// broadside while it travelled. orientVehicle fixes both.
  const FIXED_NORTH_VEHICLES = new Set([
    'balloon', 'hot-air-balloon', 'hydrogen-balloon', 'gas-balloon',
    'blimp', 'zeppelin',
  ]);
  const orientVehicle = (vehicleType, headingRad) => {
    if (FIXED_NORTH_VEHICLES.has(vehicleType)) return 0;
    if (!isFinite(headingRad)) return 0;
    // E-icons-v3 — the hand-authored masters face RIGHT (east) in their SVG
    // frame, so a sprite facing the heading vector needs NO quarter-turn: at
    // headingRad=0 (due east) the right-facing sprite already points correctly.
    // (The pre-v3 inline glyphs pointed UP and used headingRad + PI/2.)
    return headingRad;
  };

// --- Deterministic per-vertex jitter seed. NEVER use Math.random() for
// coastline/route jitter: it would shimmer on every redraw. seedRand is a
// stable hash of (vertex index, salt) so the hand-drawn wobble is fixed. ---
  const seedRand = (i, salt = 0) => {
    // small deterministic hash → -1..1
    let x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
  };

// --- Stable per-feature salt for jitter. Prefers ne_id from the geo data,
// falls back to the feature's array index. ---
  const featureSalt = (feature, index) => {
    const id = feature.properties && feature.properties.ne_id;
    return (typeof id === 'number' ? id : index) * 17 + 3;
  };

// --- Point-in-polygon: bbox-indexed ring test. buildPolygonIndex prebuilds
// a bbox index over a FeatureCollection; pointInRing is even-odd ray casting;
// inAnyPolygon tests a lon/lat against an index (outer ring minus holes). ---
  const buildPolygonIndex = (fc) => {
    const idx = [];
    for (const f of fc.features) {
      const g = f.geometry;
      if (!g) continue;
      const polys = g.type === 'Polygon' ? [g.coordinates]
                  : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const poly of polys) {
        const rings = poly.map(ring => {
          let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
          for (const p of ring) {
            const x = p[0], y = p[1];
            if (x < xMin) xMin = x; if (y < yMin) yMin = y;
            if (x > xMax) xMax = x; if (y > yMax) yMax = y;
          }
          return { ring, xMin, yMin, xMax, yMax };
        });
        // outer = rings[0], holes = rings[1..]. Polygon bbox = outer bbox.
        idx.push({ outer: rings[0], holes: rings.slice(1) });
      }
    }
    return idx;
  };

  const pointInRing = (lon, lat, ring) => {
    let inside = false;
    const pts = ring.ring;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1];
      const xj = pts[j][0], yj = pts[j][1];
      const intersect = ((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };
  const inAnyPolygon = (lon, lat, idx) => {
    for (const poly of idx) {
      const o = poly.outer;
      if (lon < o.xMin || lon > o.xMax || lat < o.yMin || lat > o.yMax) continue;
      if (!pointInRing(lon, lat, o)) continue;
      // inside outer — confirm not in a hole
      let inHole = false;
      for (const h of poly.holes) {
        if (lon < h.xMin || lon > h.xMax || lat < h.yMin || lat > h.yMax) continue;
        if (pointInRing(lon, lat, h)) { inHole = true; break; }
      }
      if (!inHole) return true;
    }
    return false;
  };
