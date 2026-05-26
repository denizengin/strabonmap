// core/land-router.js — P2 land-routing / water-avoidance for LAND vehicles.
//
// TRIP_ROUTING_COUNCIL.html, P2: for a LAND-class leg (foot / horse / camel /
// cart / train / car / bicycle …) the straight-chord render can cut a corner
// of open sea — a foot-leg that strides across a strait, a road leg that
// chords a gulf. There is NO shipped road network, so this is NOT road-
// snapping: the achievable, defensible objective is "land vehicles avoid
// crossing open water, and (where cheap) prefer staying on land/coast". This
// module is the MIRROR of core/sea-router.js: where the sea-router A*-routes a
// boat OVER WATER avoiding land, this A*-routes a land leg OVER LAND avoiding
// water, for the authored endpoints.
//
// PURE + FRAMEWORK-FREE. No DOM, no globals consumed at module scope. The
// land/water test is injected as `isLand(lon,lat)=>bool` exactly like the
// sea-router — the CALLER picks the fine region-pack coastline OR the coarse
// global Natural Earth set. Loaded via tests/core-loader.js (bare 2-space-
// indent `const` style) and re-used by tools/check-land-router.mjs.
//
// It does NOT project, NOT unwrap the antimeridian, NOT draw: it produces the
// {lat,lon} WAYPOINTS only; core/route-geometry.js:expandLegVertices() still
// owns via-expansion / unwrap / projection downstream.
//
// ── #136 core-split ───────────────────────────────────────────────────────
//   The geo + sampling + simplify helpers live in core/land-router-geo.js, and
//   the A* land pathfinder in core/land-router-astar.js. BOTH load BEFORE this
//   file (geo first, then astar) so their bare-name globals — _lrHaversineKm,
//   _lrSampleChord, chordCrossesWater, _lrSegOverWater, _lrSimplifyPath,
//   _lrAstarLandPath — are already defined when routeLandLeg runs here. Every
//   helper keeps its `LR` suffix so it cannot collide with sea-router /
//   trip-modality / route-geometry symbols (the slice-1 const-collision trap).
//
// REUSE: regionPackVersion / makeFCLandClassifier / makePackLandClassifier
// already exist in core/sea-router-geo.js (loaded BEFORE this file). We do NOT
// re-declare them — sharing a global lexical scope means a second top-level
// `const` of the same name would throw "already declared".
//
// ── PERF REALIST HARD GATE (council, panellist 4) ────────────────────────
//   memoize by (fromStop, toStop, vehicleClass, regionPackVersion); recompute
//   only on an input change; pan/zoom reuse the cached polyline + re-project.
// So this module ALSO owns the memo cache (makeLandRouteCache). The render
// loop calls the cache, NEVER the router, every frame — a hit is a Map.get.
// Routing inside requestAnimationFrame is REJECTED; the cache is the boundary.
//
// ── NEVER persist (council, cartographer) ────────────────────────────────
//   The returned polyline is render-time geometry, NEVER written back into the
//   trip JSON / store. A pack refinement busts the cache key and the path
//   regenerates.
//
// ── HONESTY / fuzziness caveat (council) ──────────────────────────────────
//   If a land leg genuinely REQUIRES crossing water (island → mainland on
//   foot — physically impossible without a ferry) there may be NO all-land
//   path. Then we return the straight chord (degrade gracefully). We do NOT
//   invent a land bridge and do NOT auto-insert a ferry — the existing warn-
//   chip ("foot · ~120km open sea") is the council's answer for those.

  // ── vehicle classifier (self-contained) ───────────────────────────────────
  // landVehicleClass(vehicleKey) → 'boat' | 'land' | 'air'. Mirrors
  // core/trip-modality.js:classifyVehicleModality (and sea-router's seaVehicle-
  // Class) EXACTLY — same sets, same unknown→land default. Duplicated on
  // purpose so this wiring never depends on trip-modality.js / sea-router.js
  // <script> load order. Land-only is the gate that keeps boat/air legs
  // untouched. Keep the three taxonomies in sync.
  const _LR_BOAT = new Set([
    'galley', 'trireme', 'dromon', 'dhow', 'cog', 'liburna', 'caravel',
    'galleon', 'frigate', 'merchantman', 'junk', 'schooner', 'raft',
    'steamer', 'steamship', 'ferry', 'ocean-liner', 'liner', 'battleship',
    'ship', 'boat',
  ]);
  const _LR_LAND = new Set([
    'foot', 'horse', 'camel', 'donkey', 'pack-mule', 'chariot', 'ox-cart',
    'roman-cart', 'cart', 'carriage', 'caravan', 'knight-horse', 'palfrey',
    'car', 'automobile', 'modern-car', 'train', 'locomotive', 'bicycle',
    'elephant', 'windsledge',
  ]);
  const _LR_AIR = new Set([
    'balloon', 'biplane', 'prop-plane', 'airliner', 'jet', 'plane',
    'zeppelin', 'blimp', 'aeroplane',
  ]);
  const landVehicleClass = (vehicleKey) => {
    if (typeof vehicleKey !== 'string') return 'land';
    const v = vehicleKey.toLowerCase().trim();
    if (_LR_AIR.has(v)) return 'air';
    if (_LR_BOAT.has(v)) return 'boat';
    if (_LR_LAND.has(v)) return 'land';
    return 'land';
  };

  // ── the router ─────────────────────────────────────────────────────────────
  // routeLandLeg({from,to,via?}, isLand, opts) → [{lat,lon},...] waypoints
  // (always includes from as [0] and to as the last). The CALLER must only
  // invoke this for LAND legs — it does not classify the vehicle (the cache
  // layer short-circuits non-land legs to the straight chord). Uses
  // chordCrossesWater / _lrAstarLandPath / _lrSimplifyPath from the
  // land-router-geo.js + land-router-astar.js sub-files. Behaviour:
  //   * Build the via-expanded chord vertices (from → via... → to).
  //   * If no interior sample is on water → return the chord UNCHANGED (the
  //     cheap, common all-land case).
  //   * Else A* a LAND path across the leg bbox, splice the simplified detour
  //     waypoints between from and to, and return.
  //   * If A* finds no land path (island → mainland — physically requires a
  //     ferry) → fall back to the straight chord (honest degradation; the
  //     warn-chip flags it). NEVER invents a land bridge, NEVER inserts a
  //     ferry, NEVER throws, NEVER hangs.
  const routeLandLeg = (leg, isLand, opts) => {
    const o = opts || {};
    const from = { lat: leg.from.lat, lon: leg.from.lon };
    const to = { lat: leg.to.lat, lon: leg.to.lon };
    const via = (leg.via && Array.isArray(leg.via)) ? leg.via.filter(
      (v) => v && typeof v.lat === 'number' && typeof v.lon === 'number') : [];
    const chord = [from, ...via.map((v) => ({ lat: v.lat, lon: v.lon })), to];

    if (typeof isLand !== 'function') return chord;
    if (!chordCrossesWater(chord, isLand, o)) return chord;

    // Route around. We route each chord SEGMENT that crosses water; authored
    // via points are kept and only the wet segments between them are detailed.
    const out = [chord[0]];
    for (let i = 0; i < chord.length - 1; i++) {
      const a = chord[i], b = chord[i + 1];
      if (!chordCrossesWater([a, b], isLand, o)) {
        out.push(b);
        continue;
      }
      const path = _lrAstarLandPath(a, b, isLand, o);
      if (!path || path.length < 2) { out.push(b); continue; } // impossible → chord
      const simplified = _lrSimplifyPath(path, o.tolDeg, isLand);
      const near = (p, q) => Math.abs(p.lat - q.lat) < 1e-4 && Math.abs(p.lon - q.lon) < 1e-4;
      for (let k = 0; k < simplified.length; k++) {
        const p = simplified[k];
        if (near(p, a) || near(p, b)) continue;
        out.push(p);
      }
      out.push(b);
    }
    return out;
  };

  // ── the cache boundary (perf realist HARD GATE) ────────────────────────────
  // makeLandRouteCache() → { get, size, clear, routerCalls }.
  //   get({ leg, vehicleClass, isLand, packVersion, opts }) → waypoints[]
  // Key: `${fromKey}${viaKey}|${toKey}|${vehicleClass}|${packVersion}`. NON-
  // land vehicleClass short-circuits to the straight chord (boat → sea-router's
  // job; air → straight) and is NOT routed. On a hit the SAME array reference
  // is returned — the memo proof the render loop relies on. routerCalls()
  // counts genuine router invocations (land cache misses) so probes assert
  // pan/zoom adds zero.
  const _lrStopKey = (stop) => {
    if (stop && stop.id != null) return String(stop.id);
    const lat = Math.round((stop.lat || 0) * 1e4) / 1e4;
    const lon = Math.round((stop.lon || 0) * 1e4) / 1e4;
    return lat + ',' + lon;
  };
  const _lrViaKey = (via) => {
    if (!via || !via.length) return '';
    return ';' + via.map((v) => (Math.round(v.lat * 1e3) / 1e3) + ',' + (Math.round(v.lon * 1e3) / 1e3)).join('_');
  };
  const makeLandRouteCache = () => {
    const map = new Map();
    let calls = 0;
    const get = (req) => {
      const leg = req.leg;
      const vehicleClass = req.vehicleClass;
      const key = _lrStopKey(leg.from) + _lrViaKey(leg.via) + '|' +
        _lrStopKey(leg.to) + '|' + vehicleClass + '|' + (req.packVersion || 'global');
      const hit = map.get(key);
      if (hit) return hit;
      let result;
      if (vehicleClass !== 'land') {
        // Boat/air legs are NEVER land-routed — straight chord (incl. via).
        const from = { lat: leg.from.lat, lon: leg.from.lon };
        const to = { lat: leg.to.lat, lon: leg.to.lon };
        const via = (leg.via || []).map((v) => ({ lat: v.lat, lon: v.lon }));
        result = [from, ...via, to];
      } else {
        calls++;
        result = routeLandLeg(leg, req.isLand, req.opts);
      }
      map.set(key, result);
      return result;
    };
    return {
      get,
      size: () => map.size,
      clear: () => { map.clear(); },
      // route-only call count (land cache misses). Probe asserts pan/zoom == 0.
      routerCalls: () => calls,
    };
  };
