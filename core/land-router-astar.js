// core/land-router-astar.js — the A*-over-land pathfinder for the land router
// (extracted from core/land-router.js, #136 core-split).
//
// PURE + FRAMEWORK-FREE, same bare 2-space-indent `const` style as the parent:
// _lrAstarLandPath becomes a browser global on load. MUST load AFTER
// core/land-router-geo.js (it references _lrHaversineKm + _lrSegOverWater by
// bare name) and BEFORE core/land-router.js (whose routeLandLeg calls it).
// No IIFE, no exports. The `LR` suffix keeps it collision-free.

  // ── A* over a LAND grid ─────────────────────────────────────────────────────
  // Mirror of sea-router._astarWaterPath but moving through LAND cells only
  // (avoiding water). Build a regular lon/lat grid over the leg's padded bbox,
  // classify each cell centre land/water ONCE, A* from the cell nearest `from`
  // to the cell nearest `to`, 8-connected through LAND cells, cost = great-
  // circle distance + a small coast-hug bonus rewarding cells one ring off the
  // water (so a coastal route prefers hugging the shore rather than fleeing
  // deep inland). Then simplify collinear runs. Endpoints kept verbatim.
  //
  // Adaptive resolution + a hard cell-count cap keep the one-time classify +
  // A* bounded (same numbers as the sea-router). Classified once per route
  // computation (cache miss only), NEVER per frame. The A* step also edge-checks
  // WATER between cell centres (the inverse of sea-router #112) so even a coarse
  // cell can't chord a routed land edge across a strait that weaves through the
  // gap.
  const _lrAstarLandPath = (from, to, isLand, opts) => {
    const o = opts || {};
    let minLon = Math.min(from.lon, to.lon), maxLon = Math.max(from.lon, to.lon);
    let minLat = Math.min(from.lat, to.lat), maxLat = Math.max(from.lat, to.lat);
    const padFrac = (o.padFrac != null) ? o.padFrac : 0.8;
    const padFloor = (o.padFloorDeg != null) ? o.padFloorDeg : 1.6;
    const padLon = Math.max(padFloor, (maxLon - minLon) * padFrac);
    const padLat = Math.max(padFloor, (maxLat - minLat) * padFrac);
    minLon -= padLon; maxLon += padLon;
    minLat -= padLat; maxLat += padLat;
    const spanLon = maxLon - minLon, spanLat = maxLat - minLat;
    // Adaptive resolution: aim for cells ≤ cellDeg, but clamp the grid to a
    // total cell budget (`maxCells`) so a transcontinental land leg auto-
    // coarsens and stays bounded.
    //
    // #112-MIRROR: the previous 0.33° (~25 km) default was far coarser than the
    // strait/isthmus scale a land vehicle has to thread (the same coarse-grid
    // bug as sea-router #112, INVERTED). A* hopped between land-classified cell
    // CENTRES whose connecting edge sliced across WATER that fell entirely
    // between two cell centres, so the routed line chorded a strait/gulf while
    // still "on land" by the grid's own centre test. The cell budget still
    // auto-coarsens a transcontinental leg (its span clamps to ~120×120 cells —
    // fine, it is a wide land mass with no narrow corridor to thread), so a fine
    // default only takes effect on SHORT legs where it both fits the budget and
    // is needed to thread the gaps. Paired with the edge-water check below.
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
    // "Coast-adjacency": a LAND cell touching ≥1 WATER cell. Routing through
    // these costs slightly MORE so a route prefers to keep an inland buffer
    // and not skim the waterline (the land mirror of sea-router's hug bonus,
    // which rewarded water-near-coast). A coastal-only corridor still works —
    // the penalty is small (×1.04), it just nudges the path off the very edge.
    const nearWater = new Uint8Array(gridW * gridH);
    for (let r = 0; r < gridH; r++) {
      for (let c = 0; c < gridW; c++) {
        if (!land[idx(r, c)]) continue;
        let touch = false;
        for (let dr = -1; dr <= 1 && !touch; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nc < 0 || nr >= gridH || nc >= gridW) continue;
            if (!land[idx(nr, nc)]) { touch = true; break; }
          }
        }
        nearWater[idx(r, c)] = touch ? 1 : 0;
      }
    }

    // Snap a coord to the nearest LAND cell (an authored stop may classify as
    // water in coarse data — a coastal town sits offshore by ONE cell — so
    // search outward a SHORT way only).
    //
    // TD-24 BOUNDED SNAP: the snap exists to fix a coastal port that the coarse
    // grid happens to classify offshore by a cell or two; it must NOT relocate a
    // genuinely-offshore endpoint to a far coast. Pre-fix the search ran to the
    // grid edge, so an open-water endpoint (a foot leg that ends in the sea)
    // snapped to land 80+ km away and A* then routed a real coastal path to that
    // wrong cell — a coast-then-open-sea chord that visibly crossed water (the
    // honest-degrade guard below was defeated because the snap had already made
    // goalCell land). We cap the search at `maxSnapRings` cells from the
    // authored cell. The cell size adapts to the leg span (≈7 km on a short
    // pack leg, up to ~25 km on a transcontinental one), so a CELL-relative
    // bound auto-scales: a measured audit puts every legitimate near-coast snap
    // at ≤1 ring (≤~25 km) while the impossible legs sit 7+ rings out
    // (80–170 km). 2 rings cleanly separates them with margin. Beyond the cap
    // there is no LAND near the endpoint → return -1 so the caller degrades to
    // the straight chord (honest off-medium leg; the warn-chip already flags it).
    const maxSnapRings = (o.maxSnapRings != null) ? o.maxSnapRings : 2;
    const snapToLand = (lat, lon) => {
      let c0 = Math.round((lon - minLon) / dLon);
      let r0 = Math.round((lat - minLat) / dLat);
      c0 = Math.max(0, Math.min(gridW - 1, c0));
      r0 = Math.max(0, Math.min(gridH - 1, r0));
      if (land[idx(r0, c0)]) return r0 * gridW + c0;
      const maxR = Math.min(maxSnapRings, Math.max(gridW, gridH));
      for (let radius = 1; radius <= maxR; radius++) {
        for (let dr = -radius; dr <= radius; dr++) {
          for (let dc = -radius; dc <= radius; dc++) {
            if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue;
            const nr = r0 + dr, nc = c0 + dc;
            if (nr < 0 || nc < 0 || nr >= gridH || nc >= gridW) continue;
            if (land[idx(nr, nc)]) return nr * gridW + nc;
          }
        }
      }
      return -1; // no LAND within the snap cap — endpoint is genuinely off-land
    };

    const startCell = snapToLand(from.lat, from.lon);
    const goalCell = snapToLand(to.lat, to.lon);
    // An endpoint with no LAND within the snap cap is genuinely over water —
    // bail (caller falls back to the chord; honest degradation, NEVER an
    // invented over-water detour to a far coast). This is the TD-24 guard.
    if (startCell < 0 || goalCell < 0) return null;
    if (startCell === goalCell) return null;
    // Defensive: if either snapped cell is somehow NON-land, bail too.
    if (!land[startCell] || !land[goalCell]) return null;

    const gr = (i) => Math.floor(i / gridW);
    const gc = (i) => i % gridW;
    const goalLat = cellLat(gr(goalCell)), goalLon = cellLon(gc(goalCell));
    const heur = (i) => _lrHaversineKm(cellLat(gr(i)), cellLon(gc(i)), goalLat, goalLon);

    const N = gridW * gridH;
    const gScore = new Float64Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);

    // Binary min-heap keyed on fScore (same as sea-router) — O(log n) pop.
    const heapItem = [];
    const heapF = [];
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
          if (!land[ni] || closed[ni]) continue;         // LAND ONLY
          if (dr !== 0 && dc !== 0) {                     // no diagonal squeeze
            if (!land[idx(r, nc)] && !land[idx(nr, c)]) continue;
          }
          // #112-MIRROR EDGE-WATER CHECK: both cell CENTRES are land, but the
          // straight edge between them can still cross water when the coastline
          // weaves through the gap at a finer scale than the grid (a strait or
          // gulf sitting entirely between two land cell centres). Reject the
          // step if the segment cuts water. Sample at ~half a cell so a thin
          // channel between the centres can't slip through; this is the
          // guarantee that a routed land edge stays dry-shod regardless of grid
          // coarseness (the inverse of sea-router's stay-wet edge check).
          if (_lrSegOverWater(
                { lat: curLat, lon: curLon },
                { lat: cellLat(nr), lon: cellLon(nc) },
                isLand,
                Math.min(dLon, dLat) * 0.5)) continue;
          const stepCost = _lrHaversineKm(curLat, curLon, cellLat(nr), cellLon(nc));
          const hug = nearWater[ni] ? 1.04 : 1.0;         // small inland-buffer nudge
          const tentative = gScore[cur] + stepCost * hug;
          if (tentative < gScore[ni]) {
            came[ni] = cur;
            gScore[ni] = tentative;
            heapPush(ni, tentative + heur(ni));
          }
        }
      }
    }
    return null; // no land path found within the box
  };
