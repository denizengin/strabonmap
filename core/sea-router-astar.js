// core/sea-router-astar.js — the A*-over-water pathfinder for the sea router
// (extracted from core/sea-router.js, #136 core-split).
//
// PURE + FRAMEWORK-FREE, same bare 2-space-indent `const` style as the parent:
// _astarWaterPath becomes a browser global on load. MUST load AFTER
// core/sea-router-geo.js (it references _seaHaversineKm + _segOverLand by bare
// name) and BEFORE core/sea-router.js (whose routeSeaLeg calls it). No IIFE,
// no exports. _astarWaterPath is a sea-router-internal helper.

  // ── A* over a water grid ────────────────────────────────────────────────────
  // The chosen method (see core/sea-router.js header). Build a regular lon/lat
  // grid covering the leg's bounding box (expanded by a margin so the path can
  // bow out around a peninsula). Classify each cell centre land/water ONCE. A*
  // from the cell nearest `from` to the cell nearest `to`, moving 8-connected
  // through WATER cells only, cost = great-circle distance + a small coast-hug
  // bonus that rewards cells one ring off the coast (so the path follows the
  // shore rather than fleeing to open ocean). Then simplify collinear runs to a
  // short waypoint list. Endpoints (the authored stops) are kept verbatim.
  //
  // Bounded: the grid resolution ADAPTS to the leg's span — it targets a max
  // cell size (`cellDeg`, default 0.08° ≈ 7 km, fine enough for the Aegean's
  // straits — see #112) and a hard cell-count cap (`maxCells`, default
  // 14400 ≈ 120×120). On a short island-dense leg the fine cells fit the budget
  // and let A* thread the gaps; on a transcontinental/transoceanic chord the
  // cap auto-coarsens the cells (Tahiti→NZ ~324° → ~25 km cells — fine, open
  // ocean with nothing to thread). The classify + A* runs once per route
  // computation (cache miss only), NEVER per frame. The A* step itself also
  // edge-checks land between cell centres so even a coarse cell can't chord a
  // routed edge across a coastline that weaves through the gap.
  const _astarWaterPath = (from, to, isLand, opts) => {
    const o = opts || {};
    // Bounding box of the chord, padded so the detour has room.
    let minLon = Math.min(from.lon, to.lon), maxLon = Math.max(from.lon, to.lon);
    let minLat = Math.min(from.lat, to.lat), maxLat = Math.max(from.lat, to.lat);
    // Pad generously: the detour must be able to clear the obstacle, so the
    // box has to extend well past the chord. A thin near-meridional chord
    // (Δlon≈0) still needs lateral room to round a landmass, hence the
    // absolute floor (default 1.6°, ~150 km) in BOTH axes.
    const padFrac = (o.padFrac != null) ? o.padFrac : 0.8;
    const padFloor = (o.padFloorDeg != null) ? o.padFloorDeg : 1.6;
    const padLon = Math.max(padFloor, (maxLon - minLon) * padFrac);
    const padLat = Math.max(padFloor, (maxLat - minLat) * padFrac);
    minLon -= padLon; maxLon += padLon;
    minLat -= padLat; maxLat += padLat;
    const spanLon = maxLon - minLon, spanLat = maxLat - minLat;
    // Adaptive resolution: aim for cells ≤ cellDeg, but clamp the grid to a
    // total cell budget and a sane min so a tiny box still has a usable grid.
    //
    // #112 (Aulis→Tenedos): the previous 0.33° (~25 km) default was far coarser
    // than the Aegean's island/strait scale (5–15 km straits). A* hopped between
    // water-classified cell CENTRES whose connecting edge sliced across an island
    // that fell entirely between two cell centres, so the routed line cut across
    // land. The cell budget (`maxCells`) still auto-coarsens a transoceanic leg
    // (Tahiti→NZ ~324° span clamps to ~120×120 ≈ 25 km cells — fine, it is open
    // ocean with no islands to thread), so a fine default only takes effect on
    // SHORT legs where it both fits the budget and is needed to find the gaps.
    const cellDeg = o.cellDeg || 0.08;
    const maxCells = o.maxCells || 14400;
    let cols = Math.max(24, Math.ceil(spanLon / cellDeg) + 1);
    let rows = Math.max(24, Math.ceil(spanLat / cellDeg) + 1);
    if (cols * rows > maxCells) {
      const k = Math.sqrt(maxCells / (cols * rows));
      cols = Math.max(24, Math.floor(cols * k));
      rows = Math.max(24, Math.floor(rows * k));
    }
    const gridW = cols, gridH = rows;
    const dLon = spanLon / (gridW - 1);
    const dLat = spanLat / (gridH - 1);
    const cellLon = (c) => minLon + c * dLon;
    const cellLat = (r) => minLat + r * dLat;
    const idx = (r, c) => r * gridW + c;

    // Classify every cell once. land[i] = true if the cell centre is on land.
    const land = new Uint8Array(gridW * gridH);
    for (let r = 0; r < gridH; r++) {
      for (let c = 0; c < gridW; c++) {
        land[idx(r, c)] = isLand(cellLon(c), cellLat(r)) ? 1 : 0;
      }
    }
    // A "coast-adjacency" map: a water cell touching ≥1 land cell. Routing
    // through these is slightly cheaper so the path hugs the shore.
    const nearCoast = new Uint8Array(gridW * gridH);
    for (let r = 0; r < gridH; r++) {
      for (let c = 0; c < gridW; c++) {
        if (land[idx(r, c)]) continue;
        let touch = false;
        for (let dr = -1; dr <= 1 && !touch; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nc < 0 || nr >= gridH || nc >= gridW) continue;
            if (land[idx(nr, nc)]) { touch = true; break; }
          }
        }
        nearCoast[idx(r, c)] = touch ? 1 : 0;
      }
    }

    // Snap a coord to the nearest WATER cell (start/goal stops may classify as
    // land in coarse data — a port sits onshore by ONE cell — so search outward
    // a SHORT way only).
    //
    // TD-24 BOUNDED SNAP (mirror of land-router-astar): the snap fixes a port
    // the coarse grid classifies onshore by a cell or two; it must NOT relocate
    // a genuinely-inland endpoint to a far coast. Pre-fix the search ran to the
    // grid edge with NO goal-degrade guard at all (the land router at least had
    // an `if(!land[goalCell])` bail), so a boat leg ending deep inland snapped
    // its goal to a coast 100+ km away and A* routed a real sea path to that
    // wrong cell — a sea-then-overland chord that visibly cut across land. We
    // cap the search at `maxSnapRings` cells. The cell size adapts to the leg
    // span, so a CELL-relative bound auto-scales; a measured audit puts every
    // legitimate near-coast port snap at ≤1 ring while the impossible inland
    // legs sit 7+ rings out. 2 rings cleanly separates them. Beyond the cap
    // there is no WATER near the endpoint → return -1 so the caller degrades to
    // the straight chord (honest off-medium leg; the warn-chip already flags it).
    const maxSnapRings = (o.maxSnapRings != null) ? o.maxSnapRings : 2;
    const snapToWater = (lat, lon) => {
      let c0 = Math.round((lon - minLon) / dLon);
      let r0 = Math.round((lat - minLat) / dLat);
      c0 = Math.max(0, Math.min(gridW - 1, c0));
      r0 = Math.max(0, Math.min(gridH - 1, r0));
      if (!land[idx(r0, c0)]) return r0 * gridW + c0;
      const maxR = Math.min(maxSnapRings, Math.max(gridW, gridH));
      for (let radius = 1; radius <= maxR; radius++) {
        for (let dr = -radius; dr <= radius; dr++) {
          for (let dc = -radius; dc <= radius; dc++) {
            if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue;
            const nr = r0 + dr, nc = c0 + dc;
            if (nr < 0 || nc < 0 || nr >= gridH || nc >= gridW) continue;
            if (!land[idx(nr, nc)]) return nr * gridW + nc;
          }
        }
      }
      return -1; // no WATER within the snap cap — endpoint is genuinely inland
    };

    const startCell = snapToWater(from.lat, from.lon);
    const goalCell = snapToWater(to.lat, to.lon);
    // TD-24 goal/start degrade guard (was MISSING here — latent in the sea
    // router): an endpoint with no WATER within the snap cap is genuinely
    // landlocked — bail (caller falls back to the chord; honest degradation,
    // NEVER an invented over-land detour to a far coast).
    if (startCell < 0 || goalCell < 0) return null;
    if (startCell === goalCell) return null;
    // Defensive: if either snapped cell is somehow LAND, bail too.
    if (land[startCell] || land[goalCell]) return null;

    const gr = (i) => Math.floor(i / gridW);
    const gc = (i) => i % gridW;
    const goalLat = cellLat(gr(goalCell)), goalLon = cellLon(gc(goalCell));
    const heur = (i) => _seaHaversineKm(cellLat(gr(i)), cellLon(gc(i)), goalLat, goalLon);

    const N = gridW * gridH;
    const gScore = new Float64Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);

    // Binary min-heap keyed on fScore — O(log n) pop, so a 14k-cell grid stays
    // fast (a linear-scan open set would be O(n) per pop and jank a big leg).
    const heapItem = []; // cell index
    const heapF = [];     // its fScore
    const heapPush = (cell, f) => {
      let i = heapItem.length;
      heapItem.push(cell); heapF.push(f);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapF[p] <= heapF[i]) break;
        [heapF[p], heapF[i]] = [heapF[i], heapF[p]];
        [heapItem[p], heapItem[i]] = [heapItem[i], heapItem[p]];
        i = p;
      }
    };
    const heapPop = () => {
      const top = heapItem[0];
      const last = heapItem.length - 1;
      heapItem[0] = heapItem[last]; heapF[0] = heapF[last];
      heapItem.pop(); heapF.pop();
      let i = 0; const n = heapItem.length;
      while (true) {
        const l = 2 * i + 1, r = 2 * i + 2; let s = i;
        if (l < n && heapF[l] < heapF[s]) s = l;
        if (r < n && heapF[r] < heapF[s]) s = r;
        if (s === i) break;
        [heapF[s], heapF[i]] = [heapF[i], heapF[s]];
        [heapItem[s], heapItem[i]] = [heapItem[i], heapItem[s]];
        i = s;
      }
      return top;
    };

    gScore[startCell] = 0;
    heapPush(startCell, heur(startCell));

    while (heapItem.length > 0) {
      const cur = heapPop();
      if (cur === goalCell) {
        const cells = [];
        let p = cur;
        while (p !== -1) { cells.push(p); p = came[p]; }
        cells.reverse();
        return cells.map((ci) => ({ lat: cellLat(gr(ci)), lon: cellLon(gc(ci)) }));
      }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const r = gr(cur), c = gc(cur);
      const curLat = cellLat(r), curLon = cellLon(c);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= gridH || nc >= gridW) continue;
          const ni = idx(nr, nc);
          if (land[ni] || closed[ni]) continue;          // WATER ONLY
          if (dr !== 0 && dc !== 0) {                     // no diagonal squeeze
            if (land[idx(r, nc)] && land[idx(nr, c)]) continue;
          }
          // #112 EDGE-LAND CHECK: both cell CENTRES are water, but the straight
          // edge between them can still cross land when the coastline weaves
          // through the gap at a finer scale than the grid (an island sitting
          // entirely between two water cell centres). Reject the step if the
          // segment cuts land. Sample at ~half a cell so a thin isthmus between
          // the centres can't slip through; this is the guarantee that a routed
          // edge stays wet regardless of grid coarseness.
          if (_segOverLand(
                { lat: curLat, lon: curLon },
                { lat: cellLat(nr), lon: cellLon(nc) },
                isLand,
                Math.min(dLon, dLat) * 0.5)) continue;
          const stepCost = _seaHaversineKm(curLat, curLon, cellLat(nr), cellLon(nc));
          const hug = nearCoast[ni] ? 0.92 : 1.0;        // coast-hug bonus
          const tentative = gScore[cur] + stepCost * hug;
          if (tentative < gScore[ni]) {
            came[ni] = cur;
            gScore[ni] = tentative;
            heapPush(ni, tentative + heur(ni));
          }
        }
      }
    }
    return null; // no water path found within the box
  };
