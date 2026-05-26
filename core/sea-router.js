// core/sea-router.js — P1 coastal-hugging sea router (pair-18B / routing-council).
//
// TRIP_ROUTING_COUNCIL.html, P1: for a BOAT-class leg the straight-chord
// render erases the single most characteristic fact about pre-modern
// seafaring — it followed the shore. This module turns a boat leg's authored
// stops (+ optional via) into a polyline of waypoints that stays OVER WATER,
// hugging the coast rather than charging across a peninsula.
//
// PURE + FRAMEWORK-FREE. No DOM, no globals consumed at module scope. The
// land/sea test is injected as a function argument (`isLand(lon,lat)=>bool`),
// so the same module routes against a fine region-pack coastline OR the coarse
// global Natural Earth set — the CALLER picks which classifier to pass. Loaded
// via tests/core-loader.js (bare 2-space-indent `const` style, same as the
// other core/*.js files) and re-used by tools/check-sea-router.mjs.
//
// It does NOT project, NOT unwrap the antimeridian, NOT draw: it produces the
// {lat,lon} WAYPOINTS only; core/route-geometry.js:expandLegVertices() still
// owns the via-expansion / unwrap / projection downstream.
//
// ── #136 core-split ───────────────────────────────────────────────────────
//   The geo helpers + land classifiers + sampling/simplify helpers live in
//   core/sea-router-geo.js, and the A* water pathfinder in
//   core/sea-router-astar.js. BOTH load BEFORE this file (geo first, then
//   astar) so the bare-name globals they declare — _seaHaversineKm,
//   makeFCLandClassifier, makePackLandClassifier, regionPackVersion,
//   chordCrossesLand, _segOverLand, _simplifyPath, _astarWaterPath — are
//   already defined when routeSeaLeg runs here. Published-global set is
//   byte-identical to before the split.
//
// ── PERF REALIST HARD GATE (council, panellist 4) ────────────────────────
//   "memoize routed geometry by (fromStop, toStop, vehicleClass,
//    regionPackVersion) and recompute only when an input changes. Pan and
//    zoom must reuse the cached polyline and only re-project it."
// So this module ALSO owns the memo cache (memoSeaRoute / makeSeaRouteCache).
// The render loop calls the cache, NEVER the router, every frame — a cache
// hit is a Map.get on a string key. Routing only runs on a miss (a trip edit
// that changes an endpoint/vehicle, or a region-pack version bump). Routing
// inside requestAnimationFrame is REJECTED by the council; the cache is the
// boundary that prevents it.
//
// ── NEVER persist (council, cartographer) ────────────────────────────────
//   The returned polyline is render-time geometry. It is NEVER written back
//   into the trip JSON / store. The saved trip stays human-authored stops
//   (+ optional via) only. A pack refinement busts the cache key and the path
//   regenerates; a frozen path baked into the trip would orphan that.

  // ── vehicle classifier (self-contained) ───────────────────────────────────
  // seaVehicleClass(vehicleKey) → 'boat' | 'land' | 'air'. Mirrors
  // core/trip-modality.js:classifyVehicleModality EXACTLY (same sets, same
  // unknown→land default) but is duplicated here ON PURPOSE: trip-modality.js
  // is added to index.html by a SIBLING agent and its <script> load order
  // relative to this one must not be a hard runtime dependency. Boats-only is
  // the gate that keeps land/air legs untouched, so it has to work even if
  // trip-modality.js is absent. Keep the two sets in sync.
  const _SEA_BOAT = new Set([
    'galley', 'trireme', 'dromon', 'dhow', 'cog', 'liburna', 'caravel',
    'galleon', 'frigate', 'merchantman', 'junk', 'schooner', 'raft',
    'steamer', 'steamship', 'ferry', 'ocean-liner', 'liner', 'battleship',
    'ship', 'boat',
  ]);
  const _SEA_LAND = new Set([
    'foot', 'horse', 'camel', 'donkey', 'pack-mule', 'chariot', 'ox-cart',
    'roman-cart', 'cart', 'carriage', 'caravan', 'knight-horse', 'palfrey',
    'car', 'automobile', 'modern-car', 'train', 'locomotive', 'bicycle',
    'elephant', 'windsledge',
  ]);
  const _SEA_AIR = new Set([
    'balloon', 'biplane', 'prop-plane', 'airliner', 'jet', 'plane',
    'zeppelin', 'blimp', 'aeroplane',
  ]);
  const seaVehicleClass = (vehicleKey) => {
    if (typeof vehicleKey !== 'string') return 'land';
    const v = vehicleKey.toLowerCase().trim();
    if (_SEA_AIR.has(v)) return 'air';
    if (_SEA_BOAT.has(v)) return 'boat';
    if (_SEA_LAND.has(v)) return 'land';
    return 'land';
  };

  // ── the router ─────────────────────────────────────────────────────────────
  // routeSeaLeg({from,to,via?}, isLand, opts) → [{lat,lon},...] waypoints
  // (always includes from as [0] and to as the last). The CALLER must only
  // invoke this for BOAT legs — it does not classify the vehicle (that is the
  // cache layer's job, which short-circuits non-boat legs to the straight
  // chord). Uses chordCrossesLand / _astarWaterPath / _simplifyPath from the
  // sea-router-geo.js + sea-router-astar.js sub-files. Behaviour:
  //   * Build the via-expanded chord vertices (from → via... → to).
  //   * If no interior sample is on land → return the chord UNCHANGED (the
  //     cheap, common open-water case).
  //   * Else A* a water path across the leg bbox, splice the simplified detour
  //     waypoints between from and to, and return.
  //   * If A* finds no water path (land-locked / coarse-data gap) → fall back
  //     to the straight chord (honest degradation; never throws, never hangs).
  const routeSeaLeg = (leg, isLand, opts) => {
    const o = opts || {};
    const from = { lat: leg.from.lat, lon: leg.from.lon };
    const to = { lat: leg.to.lat, lon: leg.to.lon };
    const via = (leg.via && Array.isArray(leg.via)) ? leg.via.filter(
      (v) => v && typeof v.lat === 'number' && typeof v.lon === 'number') : [];
    const chord = [from, ...via.map((v) => ({ lat: v.lat, lon: v.lon })), to];

    if (typeof isLand !== 'function') return chord;
    if (!chordCrossesLand(chord, isLand, o)) return chord;

    // Route around. We route each chord SEGMENT that crosses land; a leg with
    // authored via points keeps those via points and only details the wet
    // segments between them.
    const out = [chord[0]];
    for (let i = 0; i < chord.length - 1; i++) {
      const a = chord[i], b = chord[i + 1];
      if (!chordCrossesLand([a, b], isLand, o)) {
        out.push(b);
        continue;
      }
      const path = _astarWaterPath(a, b, isLand, o);
      if (!path || path.length < 2) { out.push(b); continue; }
      const simplified = _simplifyPath(path, o.tolDeg, isLand);
      // path[0] ≈ a snapped to its nearest WATER cell, path[last] ≈ b snapped.
      // We KEEP these snapped entry/exit waypoints (only dropping them if they
      // coincide with the authored endpoint) so the leg goes authored-stop →
      // first water cell → detour, rather than chording straight from an
      // onshore port into the interior. The authored endpoints (a already in
      // `out`, b pushed after) still bracket the path so the line touches the
      // real stops.
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
  // makeSeaRouteCache() → { get, size, clear, _calls }.
  //   get({ leg, vehicleClass, isLand, packVersion, opts }) → waypoints[]
  // Key: `${fromKey}|${toKey}|${vehicleClass}|${packVersion}` where from/to keys
  // prefer a stop id and fall back to rounded lat,lon. NON-boat vehicleClass
  // short-circuits to the straight chord (and is NOT cached as a route — there
  // is nothing to route). On a hit the SAME array reference is returned, which
  // is the memo proof the render loop relies on: pan/zoom rebuild the same key,
  // get the same array, and only re-project it. `_calls` counts genuine router
  // invocations (cache misses) so probes can assert pan/zoom adds zero.
  const _stopKey = (stop) => {
    if (stop && stop.id != null) return String(stop.id);
    const lat = Math.round((stop.lat || 0) * 1e4) / 1e4;
    const lon = Math.round((stop.lon || 0) * 1e4) / 1e4;
    return lat + ',' + lon;
  };
  const _viaKey = (via) => {
    if (!via || !via.length) return '';
    return ';' + via.map((v) => (Math.round(v.lat * 1e3) / 1e3) + ',' + (Math.round(v.lon * 1e3) / 1e3)).join('_');
  };
  const makeSeaRouteCache = () => {
    const map = new Map();
    let calls = 0;
    const get = (req) => {
      const leg = req.leg;
      const vehicleClass = req.vehicleClass;
      const key = _stopKey(leg.from) + _viaKey(leg.via) + '|' +
        _stopKey(leg.to) + '|' + vehicleClass + '|' + (req.packVersion || 'global');
      const hit = map.get(key);
      if (hit) return hit;
      let result;
      if (vehicleClass !== 'boat') {
        // Land/air legs are NEVER routed — straight chord (incl. authored via).
        const from = { lat: leg.from.lat, lon: leg.from.lon };
        const to = { lat: leg.to.lat, lon: leg.to.lon };
        const via = (leg.via || []).map((v) => ({ lat: v.lat, lon: v.lon }));
        result = [from, ...via, to];
      } else {
        calls++;
        result = routeSeaLeg(leg, req.isLand, req.opts);
      }
      map.set(key, result);
      return result;
    };
    return {
      get,
      size: () => map.size,
      clear: () => { map.clear(); },
      // route-only call count (boat cache misses). Probe asserts pan/zoom == 0.
      routerCalls: () => calls,
    };
  };
