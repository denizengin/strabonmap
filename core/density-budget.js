// core/density-budget.js — E-density-budget slice 1.
//
// Per-zoom visible-point budget for ambient map furniture. Blocks
// E76 Show-Everything mode and any future render path that wants
// to draw "all the points" without producing visual static at low
// zoom.
//
// Pure module. No DOM. Lives in core/ alongside other classic-script
// helpers (era-places, picker-state, etc.). Loaded by index.html +
// mobile.html before the bundled boot.
//
// Spec: BACKLOG.html#e-density-budget (full design + acceptance).

  // Budget table. Each entry: zoom < maxZoom → cap applies. The list
  // is walked in order; the first matching entry wins. The final
  // entry's maxZoom of 99 means "unlimited from this point up".
  //
  // Tuned for desktop + mobile readable density:
  //   z < 3  → world view; only the giants (regional capitals only)
  //   z < 5  → continental; provincial capitals + major sites
  //   z < 7  → country; everything notable
  //   z < 9  → sub-region; most of the gazetteer + landmarks
  //   z+    → street zoom; unlimited
  const VISIBLE_BUDGET = [
    { maxZoom: 3,  cap:   30 },
    { maxZoom: 5,  cap:  100 },
    { maxZoom: 7,  cap:  300 },
    { maxZoom: 9,  cap:  800 },
    { maxZoom: 99, cap: 9999 },
  ];

  // capForZoom(zoom) → number. Returns the budget cap at this zoom.
  // Walks the table in order; first entry whose maxZoom > zoom wins.
  const capForZoom = (zoom) => {
    for (const tier of VISIBLE_BUDGET) {
      if (zoom < tier.maxZoom) return tier.cap;
    }
    return VISIBLE_BUDGET[VISIBLE_BUDGET.length - 1].cap;
  };

  // rankCandidates(candidates, viewportCenter) → array
  //
  // candidates: [{ id, lat, lon, score (0..1), kind, exempt }]
  //   - score: importance ranking, 0 = least important, 1 = most.
  //     Cities use normalised log population; major landmarks 0.8 flat;
  //     era-place suggestions 0.9; trip-own custom landmarks 1.0.
  //   - exempt: if true, the candidate skips the cap entirely and is
  //     always included. Use for route stops + visited landmarks +
  //     hovered/selected items.
  //
  // viewportCenter: { lat, lon } — tie-breaker when scores collide
  // (closer to centre wins).
  //
  // Returns the survivors after ranking + budget cap. Exempt entries
  // are NOT counted against the cap; they always pass through.
  const rankCandidates = (candidates, viewportCenter, zoom) => {
    if (!Array.isArray(candidates)) return [];
    const cap = capForZoom(zoom);

    const exempt = [];
    const rankable = [];
    for (const c of candidates) {
      if (c && c.exempt) exempt.push(c);
      else if (c) rankable.push(c);
    }

    // Score + viewport-distance for ranking. Distance is the squared
    // euclidean of lat/lon deltas — cheap and stable.
    const centreLat = (viewportCenter && viewportCenter.lat) || 0;
    const centreLon = (viewportCenter && viewportCenter.lon) || 0;
    const distSq = (c) => {
      const dl = (c.lat || 0) - centreLat;
      const dn = (c.lon || 0) - centreLon;
      return dl * dl + dn * dn;
    };

    rankable.sort((a, b) => {
      // Higher score first.
      const ds = (b.score || 0) - (a.score || 0);
      if (ds !== 0) return ds;
      // Tie: closer to viewport centre first.
      return distSq(a) - distSq(b);
    });

    // Apply the cap to rankable. Exempt always passes.
    const capped = rankable.slice(0, cap);
    return exempt.concat(capped);
  };

  // Normalise a city population (in thousands) to a [0, 1] importance
  // score. log-scale so Istanbul (11,000) and a 50k-pop town don't
  // collapse to the same neighbourhood after normalisation.
  //
  //   pop=11000  → ~1.0   (Istanbul — biggest in dataset)
  //   pop=1000   → ~0.65
  //   pop=200    → ~0.40
  //   pop=50     → ~0.25
  const POP_REF_HIGH = 11000;  // top of dataset, in thousands
  const POP_REF_LOW  = 30;     // floor; below this we still give a small score
  const scoreCityPop = (popThousands) => {
    if (typeof popThousands !== 'number' || popThousands <= 0) return 0;
    const p = Math.max(popThousands, POP_REF_LOW);
    return Math.min(1, Math.log(p) / Math.log(POP_REF_HIGH));
  };

  // No explicit globalThis publishing — classic-script top-level
  // `const`s share their script-lexical-environment across other
  // classic scripts in the same realm. boot.js can read these as
  // bare identifiers from within the bundled IIFE. Tests that need
  // them go through window-level test seams (see boot.js).
