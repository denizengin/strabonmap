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

  /* Which LANDMASS a point sits on — a stable key for the Natural Earth
   * polygon that contains it, or null when it sits on no known land.
   * Two stops on different landmasses cannot be joined by a road, which is
   * the honest way to tell a shore DRIVE from an island HOP: it works at any
   * distance and inside a single country (the Greek-islands failure, 25 Jul,
   * where every open-sea ferry between islands guessed "by motor-car"
   * because the legs were short and domestic).
   */
  const _landmassAt = (lat, lon) => {
    if (typeof NATURAL_EARTH_FC === 'undefined') return null;
    const features = NATURAL_EARTH_FC.features || [];
    for (let fi = 0; fi < features.length; fi++) {
      const g = features[fi].geometry;
      if (!g) continue;
      const polys = (g.type === 'MultiPolygon') ? g.coordinates : [g.coordinates];
      for (let pi = 0; pi < polys.length; pi++) {
        const rings = polys[pi];
        if (!_pointInRingVI(lon, lat, rings[0])) continue;
        let inHole = false;
        for (let i = 1; i < rings.length; i++) {
          if (_pointInRingVI(lon, lat, rings[i])) { inHole = true; break; }
        }
        if (!inHole) return fi + ':' + pi;
      }
    }
    return null;
  };

  /* A coastal stop's coordinates often fall in the SEA at 1:50m (Piraeus,
   * Dover, West Wittering all do), so the containing-polygon test alone
   * answers "no land" for perfectly ordinary harbours. Walk outward in rings
   * and report BOTH the landmass found and how far we had to reach for it —
   * the reach is the confidence: a harbour snaps within a couple of km, while
   * an island the coastline doesn't carry only snaps from much further out.
   */
  const _landmassKey = (lat, lon) => {
    const here = _landmassAt(lat, lon);
    if (here) return { key: here, snapKm: 0 };
    const KM_PER_DEG = 111;
    for (const km of [2, 5, 10, 20]) {
      const dLat = km / KM_PER_DEG;
      const dLon = km / (KM_PER_DEG * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
      for (let a = 0; a < 8; a++) {
        const th = a * Math.PI / 4;
        const hit = _landmassAt(lat + dLat * Math.sin(th), lon + dLon * Math.cos(th));
        if (hit) return { key: hit, snapKm: km };
      }
    }
    return null;
  };

  /* true  — both stops sit on the SAME landmass (a road can exist)
   * false — they sit on DIFFERENT landmasses (only a crossing joins them)
   * null  — undecidable: at least one stop only found land far away, which is
   *         what a small island missing from the coarse coastline looks like.
   *         The caller decides, and should keep the boat.
   */
  const SNAP_TRUST_KM = 10;
  // Test/diagnostic seam: which landmass a point resolved to, and from how far.
  const landmassInfo = (lat, lon) => _landmassKey(lat, lon);
  const sameLandmass = (aLat, aLon, bLat, bLon) => {
    const a = _landmassKey(aLat, aLon);
    const b = _landmassKey(bLat, bLon);
    if (!a || !b) return null;
    if (a.snapKm > SNAP_TRUST_KM || b.snapKm > SNAP_TRUST_KM) return null;
    return a.key === b.key;
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

  /* How much of the straight line between two points is off land (0..1) —
   * exposed so other layers can ask "is there sea between these two places?"
   * (the photo clusterer uses it to refuse to merge two stops across water).
   */
  const waterFractionBetween = (aLat, aLon, bLat, bLon, samples) =>
    _waterFraction(aLat, aLon, bLat, bLon, samples);

  /* inferVehicle({fromLat, fromLon, toLat, toLon, eraKey})
   * Returns a string suggestion: 'foot' | 'air' | era's land vehicle |
   * era's sea vehicle. Falls back to 'plane' if era / transport can't
   * be resolved (existing default — never crashes a caller).
   */
  const inferVehicle = ({ fromLat, fromLon, toLat, toLon, eraKey, year, seaWaterFraction }) => {
    if (!isFinite(fromLat) || !isFinite(fromLon)
        || !isFinite(toLat)   || !isFinite(toLon)) return 'plane';
    const distKm = _distanceKm(fromLat, fromLon, toLat, toLon);
    if (distKm < 5) return 'foot';
    const transport = _transportForEra(eraKey) || { sea: 'boat', land: 'car', air: 'plane' };
    // Optional caller bias (additive; default keeps the historical 0.5): the
    // photo-import passes a HIGH threshold because a coast-parallel drive's
    // straight line runs over the coarse 1:50m "sea" (owner's West Wittering→
    // Worthing guessed a boat) — for imports, only an overwhelmingly-water
    // crossing should read as a ferry.
    const seaThreshold = (typeof seaWaterFraction === 'number') ? seaWaterFraction : 0.5;
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
    if (water > seaThreshold) {
      // W21 (loop wave 15): Kyrenia→Rizokarpaso — 100km along the north coast
      // of ONE island — sampled 86% water on its straight chord (the coast
      // curves, the chord doesn't) and sailed. A mostly-water chord whose ends
      // sit on the SAME landmass within driving range is a COAST ROAD, not a
      // ferry: the road exists precisely where the chord cannot. Distance
      // keeps the real ferries: Brindisi→Igoumenitsa (315km) shares the
      // Eurasian landmass at this map scale but nobody drives around the
      // Adriatic — a long open-water crossing stays a sail. Hand-set ferries
      // (legs[].vehicle) override all of this upstream.
      // …but sameLandmass SNAPS an off-map point to the nearest carried
      // landmass, so two tiny islands the 1:50m coastline does not hold
      // (Hydra, Spetses) both "snap" to the Peloponnese and would drive
      // across the strait. A coast-road endpoint lives ON a carried landmass;
      // an uncarried island floats in pure water. Measure each endpoint's
      // LOCAL LAND SHARE (four short segments through it): Kyrenia 1.0,
      // Rizokarpaso 0.82 vs Hydra 0.0, Spetses 0.0 — a clean separation.
      const localLand = (lat, lon) => {
        const d = 0.03;
        let water = 0;
        water += _waterFraction(lat - d, lon, lat + d, lon, 8);
        water += _waterFraction(lat, lon - d, lat, lon + d, 8);
        water += _waterFraction(lat - d, lon - d, lat + d, lon + d, 8);
        water += _waterFraction(lat - d, lon + d, lat + d, lon - d, 8);
        return 1 - water / 4;
      };
      // …and the SHORT case (owner session: the 5.4km drive from Larnaka to
      // Larnaka Havaalanı sailed — the airport sits on the shoreline, the
      // whole chord samples sea and sameLandmass fails on the offshore snap,
      // so his film ended with a steamer to his own departure gate). No ferry
      // exists at town-to-its-airport scale: under 12km, if EITHER endpoint
      // sits on carried land, the leg is the shore road. Genuine short island
      // hops keep sailing — both their endpoints float in pure water
      // (Hydra 0.0), and real straits are wider than this anyway.
      const shortShore = distKm < 12
        && (localLand(fromLat, fromLon) >= 0.25 || localLand(toLat, toLon) >= 0.25);
      const coastal = distKm < 150
        && sameLandmass(fromLat, fromLon, toLat, toLon) === true
        && localLand(fromLat, fromLon) >= 0.3
        && localLand(toLat, toLon) >= 0.3;
      if (!coastal && !shortShore) return transport.sea;
    }
    if (airCapable && distKm >= 2500) return transport.air;
    // Stress finding (25 Jul, the Greek islands): a 20km strait between two
    // islands samples as mostly LAND at 1:50m, so the water test never fired
    // and a motor-car drove across the Aegean. Landmasses settle it — you
    // cannot drive from one island to another, however short the gap.
    if (sameLandmass(fromLat, fromLon, toLat, toLon) === false) return transport.sea;
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
