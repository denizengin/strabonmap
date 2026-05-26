// core/vehicle-infer.js — E-vehicle-infer. Pure helper: given a leg
// (fromLat/lon → toLat/lon) and an era, suggest the most period-
// appropriate travel vehicle.
//
// Replaces the silent default of "plane" everywhere. User can still
// override; this is the SUGGESTION the editor + auto-populate paths
// reach for when no explicit vehicle is set.
//
// Rules (decision tree, evaluated top-down):
//   1. Same-point-ish or tiny leg (<5km)                → 'foot'
//   2. Long trans-oceanic (>=4000km) in air-capable era → 'air'
//   3. Majority of midpoints over water                 → era's sea vehicle
//   4. Anywhere within an air-capable era at >2500km    → 'air'
//   5. Otherwise                                        → era's land vehicle
//
// "Air-capable era" = era's defaultTheme.transport.air is non-null
// (Industrial / Adventure / Modern in current eras.js).
//
// "Over water" is a heuristic: sample ~12 midpoints along the linear
// great-circle approximation and check each against the bbox-indexed
// NATURAL_EARTH_FC land polygons. >50% off-land → call it sea.

  /* Haversine distance, km. Cheap enough for per-leg evaluation. */
  const _distanceKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const toRad = (x) => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  };

  /* Lookup era's default transport vocabulary. Returns {sea, land, air}
   * or null if era / theme cannot be resolved. Pulls from eras.js. */
  const _transportForEra = (eraKey) => {
    if (typeof eraByKey !== 'function') return null;
    const era = eraByKey(eraKey);
    if (!era) return null;
    const themeKey = (typeof DEFAULT_THEME_OF_ERA === 'function')
      ? DEFAULT_THEME_OF_ERA(era.key) : null;
    if (!themeKey || typeof themeByKey !== 'function') return null;
    const hit = themeByKey(themeKey);
    return (hit && hit.theme && hit.theme.transport) ? hit.theme.transport : null;
  };

  /* Approximate "is this point on land?" using the bbox-indexed
   * NATURAL_EARTH_FC polygons. Returns boolean. Returns true (assume
   * land) if the geo-data layer isn't loaded — fail-safe for non-
   * browser callers / unit-test contexts that don't load geo-data.
   */
  const _isOnLand = (lat, lon) => {
    if (typeof NATURAL_EARTH_FC === 'undefined') return true;
    const features = NATURAL_EARTH_FC.features || [];
    for (const f of features) {
      const g = f.geometry;
      if (!g) continue;
      // Polygon: rings = g.coordinates; outer + optional holes.
      // MultiPolygon: g.coordinates is array of [rings...].
      const polys = (g.type === 'MultiPolygon') ? g.coordinates : [g.coordinates];
      for (const rings of polys) {
        const outer = rings[0];
        if (!_pointInRingVI(lon, lat, outer)) continue;
        // Inside outer; subtract holes.
        let inHole = false;
        for (let i = 1; i < rings.length; i++) {
          if (_pointInRingVI(lon, lat, rings[i])) { inHole = true; break; }
        }
        if (!inHole) return true;
      }
    }
    return false;
  };

  /* Ray-cast point-in-ring on a closed lon/lat ring. */
  const _pointInRingVI = (x, y, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const hit = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi);
      if (hit) inside = !inside;
    }
    return inside;
  };

  /* Sample N midpoints along the linear (not great-circle — close
   * enough at the scales this app cares about) from→to segment and
   * return the fraction of samples that are NOT on land. */
  const _waterFraction = (fromLat, fromLon, toLat, toLon, samples) => {
    const n = samples || 12;
    let water = 0;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const lat = fromLat + (toLat - fromLat) * t;
      const lon = fromLon + (toLon - fromLon) * t;
      if (!_isOnLand(lat, lon)) water++;
    }
    return water / (n - 1);
  };

  /* inferVehicle({fromLat, fromLon, toLat, toLon, eraKey})
   * Returns a string suggestion: 'foot' | 'air' | era's land vehicle |
   * era's sea vehicle. Falls back to 'plane' if era / transport can't
   * be resolved (existing default — never crashes a caller).
   */
  const inferVehicle = ({ fromLat, fromLon, toLat, toLon, eraKey, year }) => {
    if (!isFinite(fromLat) || !isFinite(fromLon)
        || !isFinite(toLat)   || !isFinite(toLon)) return 'plane';
    const distKm = _distanceKm(fromLat, fromLon, toLat, toLon);
    if (distKm < 5) return 'foot';
    const transport = _transportForEra(eraKey) || { sea: 'boat', land: 'car', air: 'plane' };
    // 17/18 May 2026 — air-vehicle year gates. Each entry in
    // VEHICLE_MIN_YEAR is the earliest year that vehicle plausibly
    // exists. Atlas-era balloon: Montgolfier 1783. Industrial-era
    // biplane: Wright Bros 1903. Anything before the gate falls
    // back to no-air for that era. If the vocab declares an air
    // vehicle not in the gate table, treat as always available
    // (no regression for future-era additions).
    let airCapable = !!transport.air;
    if (airCapable) {
      let yr = (typeof year === 'number') ? year : null;
      if (yr == null && typeof eraMidYear === 'function') yr = eraMidYear(eraKey);
      const minYr = VEHICLE_MIN_YEAR[transport.air];
      if (typeof yr === 'number' && typeof minYr === 'number' && yr < minYr) airCapable = false;
    }
    if (airCapable && distKm >= 4000) return transport.air;
    const water = _waterFraction(fromLat, fromLon, toLat, toLon);
    if (water > 0.5) return transport.sea;
    if (airCapable && distKm >= 2500) return transport.air;
    return transport.land;
  };

  // E88 / E-balloon-vocab (18 May 2026) — per-air-vehicle earliest-year
  // gate. Lookup table so future additions (Zeppelin 1900,
  // Wright biplane 1903, airliner 1958, ...) plug in without
  // touching inferVehicle's decision tree.
  const VEHICLE_MIN_YEAR = {
    balloon: 1783,   // Montgolfier first manned ascent
    biplane: 1903,   // Wright Brothers Kitty Hawk
    airliner: 1914,  // first scheduled passenger airline (St Petersburg-Tampa)
    jet: 1952,       // de Havilland Comet enters service
    'prop-plane': 1903,
  };
