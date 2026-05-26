// core/trip-modality.js — P0 vehicle-modality routing validator (detection only).
//
// EPIC #20 / routing-council (pair-18B). The route engine draws straight
// lines in projected Mercator pixel space between consecutive stops (see
// core/route-geometry.js + src/boot.js). Nothing constrains a leg to its
// vehicle's medium: a galley (sea vehicle) can cross a peninsula, and a
// foot-leg can stride across open sea.
//
// This module is the P0 DETECTION layer agreed by the routing council
// (TRIP_ROUTING_COUNCIL.html). It does NOT route, snap, auto-correct, or
// render. It QUANTIFIES the problem: given a trip and the coarse Natural
// Earth land polygons (NATURAL_EARTH_FC from core/geo-data.js), it classifies
// each leg by (vehicle modality × sampled-path land/sea profile) and returns
// a list of modality-violation findings.
//
// PURE + FRAMEWORK-FREE. No DOM, no globals consumed at module scope. The
// land/sea classifier takes the polygon FeatureCollection as an argument so
// the module is testable in plain Node (loaded via tests/core-loader.js, the
// same bare-`const` pattern as the other core/*.js files) and reusable by the
// dev tool tools/audit-trip-modality.mjs.
//
// NOT wired into index.html / mobile.html / boot.js — P0 is tooling + tests.
//
// ── Two trip schemas it understands ──────────────────────────────────────
//   A. sample-trips/<era>/*.json  — stops[] with {lat,lon,vehicleToNext}.
//      The vehicle on stop[i] is the leg stop[i] → stop[i+1].
//   B. verne-eighty-days.json     — cities[] + parallel legs[] with
//      {vehicle, via?, bearingHint?}. legs[i] is cities[i] → cities[i+1].
//   normaliseTripLegs() flattens both into a common {from,to,vehicle,via}.

  // ── Vehicle modality taxonomy ───────────────────────────────────────────
  // Mirrors the routing-council brief. Keys are canonical vehicle keys from
  // core/vehicle-inventory.js. Anything not listed defaults to 'land' (the
  // safe assumption — a never-flagged 'air' default would hide real bugs).
  const BOAT_VEHICLES = new Set([
    'galley', 'trireme', 'dromon', 'dhow', 'cog', 'liburna', 'caravel',
    'galleon', 'frigate', 'merchantman', 'junk', 'schooner', 'raft',
    'steamer', 'steamship', 'ferry', 'ocean-liner', 'liner', 'battleship',
    'ship', 'boat',
  ]);
  const LAND_VEHICLES = new Set([
    'foot', 'horse', 'camel', 'donkey', 'pack-mule', 'chariot', 'ox-cart',
    'roman-cart', 'cart', 'carriage', 'caravan', 'knight-horse', 'palfrey',
    'car', 'automobile', 'modern-car', 'train', 'locomotive', 'bicycle',
    'elephant', 'windsledge',
  ]);
  const AIR_VEHICLES = new Set([
    'balloon', 'biplane', 'prop-plane', 'airliner', 'jet', 'plane',
    'zeppelin', 'blimp', 'aeroplane',
  ]);

  // classifyVehicleModality(vehicleKey) → 'boat' | 'land' | 'air'
  // Unknown / null vehicles → 'land' (conservative; never silently 'air').
  const classifyVehicleModality = (vehicleKey) => {
    if (typeof vehicleKey !== 'string') return 'land';
    const v = vehicleKey.toLowerCase().trim();
    if (AIR_VEHICLES.has(v)) return 'air';
    if (BOAT_VEHICLES.has(v)) return 'boat';
    if (LAND_VEHICLES.has(v)) return 'land';
    return 'land';
  };

  // ── Land / sea classifier + haversine ────────────────────────────────────
  // _pointInRing / makeLandClassifier / _haversineKm now live in
  // core/trip-modality-geom.js (#136 core-split), loaded BEFORE this file so
  // their bare-name globals are already defined here. makeLandClassifier stays
  // a published global; the parent's sampler + validator use _haversineKm.

  // ── Leg normalisation ────────────────────────────────────────────────────
  // Flatten either trip schema into [{ index, vehicle, from:{lat,lon},
  // to:{lat,lon}, via:[{lat,lon}], fromName, toName }].
  const _isCoord = (p) => p && typeof p.lat === 'number' && typeof p.lon === 'number';

  const normaliseTripLegs = (trip) => {
    if (!trip || typeof trip !== 'object') return [];
    const out = [];
    // Schema A: stops[] with vehicleToNext.
    if (Array.isArray(trip.stops) && trip.stops.length >= 2) {
      const stops = trip.stops;
      for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i], b = stops[i + 1];
        if (!_isCoord(a) || !_isCoord(b)) continue;
        out.push({
          index: i,
          vehicle: a.vehicleToNext || null,
          from: { lat: a.lat, lon: a.lon },
          to: { lat: b.lat, lon: b.lon },
          via: Array.isArray(a.viaToNext) ? a.viaToNext.filter(_isCoord) : [],
          fromName: a.name || `stop-${i + 1}`,
          toName: b.name || `stop-${i + 2}`,
        });
      }
      return out;
    }
    // Schema B: cities[] + parallel legs[].
    if (Array.isArray(trip.cities) && Array.isArray(trip.legs) && trip.cities.length >= 2) {
      const c = trip.cities, legs = trip.legs;
      for (let i = 0; i < c.length - 1; i++) {
        const a = c[i], b = c[i + 1];
        if (!_isCoord(a) || !_isCoord(b)) continue;
        const leg = legs[i] || {};
        out.push({
          index: i,
          vehicle: leg.vehicle || null,
          from: { lat: a.lat, lon: a.lon },
          to: { lat: b.lat, lon: b.lon },
          via: Array.isArray(leg.via) ? leg.via.filter(_isCoord) : [],
          fromName: a.name || `city-${i + 1}`,
          toName: b.name || `city-${i + 2}`,
        });
      }
      return out;
    }
    return [];
  };

  // ── Path sampling ────────────────────────────────────────────────────────
  // Sample the leg's straight-line path (through any via points) at roughly
  // even spacing. We sample in plain lat/lon space — the validator answers
  // "does the straight line between these stops cross the wrong medium?", and
  // a great-circle vs Mercator distinction does not change land-vs-sea at the
  // coarse 1:50m resolution we classify against. Returns INTERIOR sample
  // points only (excludes the two endpoints) plus their fractional position
  // t∈(0,1) along the leg, so callers can decide endpoint tolerance separately.
  // (_haversineKm lives in core/trip-modality-geom.js — see #136 core-split.)

  // sampleLegPath(leg, opts) → [{ lat, lon, t }] interior samples.
  //   opts.stepKm   — target spacing between samples (default 40 km).
  //   opts.minSamples / opts.maxSamples — clamp the sample count.
  const sampleLegPath = (leg, opts) => {
    const o = opts || {};
    const stepKm = o.stepKm || 40;
    const minSamples = o.minSamples || 3;
    const maxSamples = o.maxSamples || 400;
    // Build the full vertex list: from → via... → to.
    const verts = [leg.from, ...(leg.via || []), leg.to];
    // Per-segment length to distribute samples by distance.
    const segs = [];
    let total = 0;
    for (let i = 0; i < verts.length - 1; i++) {
      const len = _haversineKm(verts[i], verts[i + 1]);
      segs.push(len);
      total += len;
    }
    if (total <= 0) return [];
    let n = Math.round(total / stepKm);
    if (n < minSamples) n = minSamples;
    if (n > maxSamples) n = maxSamples;
    const out = [];
    // Walk fractional distance d∈(0,total) at n interior points.
    for (let s = 1; s <= n; s++) {
      const t = s / (n + 1); // strictly interior (0,1)
      let target = t * total;
      // Find the segment containing target.
      let acc = 0, si = 0;
      while (si < segs.length - 1 && acc + segs[si] < target) { acc += segs[si]; si++; }
      const segLen = segs[si] || 1e-9;
      const f = Math.max(0, Math.min(1, (target - acc) / segLen));
      const a = verts[si], b = verts[si + 1];
      out.push({
        lat: a.lat + (b.lat - a.lat) * f,
        lon: a.lon + (b.lon - a.lon) * f,
        t,
      });
    }
    return out;
  };

  // ── Per-leg validation ────────────────────────────────────────────────────
  // validateLeg(leg, isLand, opts) → finding | null.
  // A finding is { index, vehicle, modality, fromName, toName, kind, ratio,
  //   sampleCount, offendingCount, lengthKm, examples:[{lat,lon,t}] }.
  //
  //   - modality 'air'  → never flagged (returns null).
  //   - modality 'boat' → flagged if a fraction > opts.tolerance of interior
  //                       samples are on LAND (the galley-over-peninsula case).
  //   - modality 'land' → flagged if a fraction > opts.tolerance of interior
  //                       samples are on open SEA (the foot-over-strait case).
  //
  // tolerance defaults to 0.15: a short coastal hop or single island-bridge
  // crossing whose path nicks the wrong medium for a vertex or two is NOT a
  // violation; a leg whose MAJORITY (or a large minority) is in the wrong
  // medium is. Endpoints are excluded from sampling (ports/islands routinely
  // classify as the opposite medium in coarse polygons).
  const validateLeg = (leg, isLand, opts) => {
    const o = opts || {};
    const tolerance = (typeof o.tolerance === 'number') ? o.tolerance : 0.15;
    const modality = classifyVehicleModality(leg.vehicle);
    if (modality === 'air') return null;

    const samples = sampleLegPath(leg, o);
    if (samples.length === 0) return null;

    const wantLand = (modality === 'land');
    const offending = [];
    for (const s of samples) {
      const land = isLand(s.lon, s.lat);
      // boat → offending sample is on land; land → offending sample is on sea.
      if (wantLand ? !land : land) offending.push(s);
    }
    const ratio = offending.length / samples.length;
    const verts = [leg.from, ...(leg.via || []), leg.to];
    let lengthKm = 0;
    for (let i = 0; i < verts.length - 1; i++) lengthKm += _haversineKm(verts[i], verts[i + 1]);

    if (ratio <= tolerance) return null;

    return {
      index: leg.index,
      vehicle: leg.vehicle,
      modality,
      fromName: leg.fromName,
      toName: leg.toName,
      kind: wantLand ? 'land-vehicle-over-sea' : 'boat-over-land',
      ratio: Math.round(ratio * 1000) / 1000,
      sampleCount: samples.length,
      offendingCount: offending.length,
      lengthKm: Math.round(lengthKm),
      examples: offending.slice(0, 3).map((s) => ({
        lat: Math.round(s.lat * 1000) / 1000,
        lon: Math.round(s.lon * 1000) / 1000,
        t: Math.round(s.t * 100) / 100,
      })),
    };
  };

  // auditTrip(trip, isLand, opts) → { tripId, legCount, findings:[] }.
  const auditTrip = (trip, isLand, opts) => {
    const legs = normaliseTripLegs(trip);
    const findings = [];
    for (const leg of legs) {
      const f = validateLeg(leg, isLand, opts);
      if (f) findings.push(f);
    }
    return {
      tripId: (trip && (trip.id || trip.name)) || '(unknown)',
      legCount: legs.length,
      findings,
    };
  };
