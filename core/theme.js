// core/theme.js — landmark-icon CSS style strings, shared by index.html +
// mobile.html. These are injected into the inline <svg> blocks that get
// rasterised to landmark icons. NOTE: the THEMES palette object is NOT here
// yet — index and mobile have divergent palette key sets; reconciling them
// into one superset is a deliberate follow-up (see EPIC_BACKLOG.html). For
// now THEMES stays duplicated in each file; only the icon styles are shared.

  const LANDMARK_ICON_STYLE_INK = `
    .ink { fill: none; stroke: #2a1a0c; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    .ink-thin  { stroke-width: 1.6; }
    .ink-thick { stroke-width: 2.8; }
    .hatch { stroke: #3a2817; stroke-width: 1.1; opacity: 0.7; fill: none; }
    .accent-fill { fill: #a8302a; }
  `;

  const LANDMARK_ICON_STYLE_EARTH = `
    .roof   { fill: #b94a2d; }
    .roof-s { fill: #8a3320; }
    .roof-l { fill: #d76a48; }
    .wall   { fill: #efe0bd; }
    .wall-s { fill: #c7b387; }
    .wood   { fill: #5a3a1f; }
    .wood-l { fill: #7b5530; }
    .stone  { fill: #b7a78a; }
    .stone-s{ fill: #877a60; }
    .stone-l{ fill: #d3c4a4; }
    .gold   { fill: #d9a648; }
    .gold-s { fill: #9c7426; }
    .copper { fill: #6f9e7e; }
    .win    { fill: #2b3a4c; }
    .glint  { fill: #f0d97a; }
    .smoke  { fill: #e7d9b8; }
    .grass  { fill: #7aa148; }
    .grass-d{ fill: #5f8636; }
    .water  { fill: #6fa6b8; }
    .water-d{ fill: #4d8499; }
    .foam   { fill: #cfe4ec; }
    .path   { fill: #e3c98a; }
    .red    { fill: #b94a2d; }
    .fire   { fill: #e07a2a; }
    .lava   { fill: #d44318; }
    .ash    { fill: #5a4632; }
    .dirt   { fill: #8a6a3a; }
    .out      { fill: none; stroke: #5a3a1f; stroke-width: 1.8; stroke-linejoin: round; stroke-linecap: round; }
    .out-thin { fill: none; stroke: #5a3a1f; stroke-width: 1.2; stroke-linejoin: round; stroke-linecap: round; opacity: 0.85; }
    .hi     { fill: rgba(255, 240, 200, 0.45); }
    .sh     { fill: rgba(40, 25, 8, 0.25); }
  `;

  // E-icons-v3 — parchment-toned palette for the hand-authored tinted-master
  // icons (assets/icons/<key>.svg, injected as ic-* symbols). Same FROZEN
  // class vocabulary as EARTH, retoned for the warm parchment ground: deep
  // sepia contour, warm stone/wall, the one red-gold accent. Used by the
  // parchment + high-contrast themes so the authored art tints on paper the
  // same way it tints on moss.
  const LANDMARK_ICON_STYLE_PARCHMENT = `
    .roof   { fill: #b04a2c; }
    .roof-s { fill: #862f1c; }
    .roof-l { fill: #cc6442; }
    .wall   { fill: #ead7af; }
    .wall-s { fill: #c8b184; }
    .wood   { fill: #6a4422; }
    .wood-l { fill: #8a5e33; }
    .stone  { fill: #cabfa0; }
    .stone-s{ fill: #a4977a; }
    .stone-l{ fill: #e2d6b6; }
    .gold   { fill: #c98a2e; }
    .gold-s { fill: #9a6420; }
    .copper { fill: #9a6a3a; }
    .win    { fill: #3a2a1a; }
    .glint  { fill: #e8c870; }
    .smoke  { fill: #cdb98e; }
    .grass  { fill: #8a9a52; }
    .grass-d{ fill: #6c7e3c; }
    .water  { fill: #8aa8bc; }
    .water-d{ fill: #6a8aa0; }
    .foam   { fill: #d8e4ea; }
    .path   { fill: #d8be84; }
    .red    { fill: #a8302a; }
    .fire   { fill: #d2562a; }
    .lava   { fill: #c0331c; }
    .ash    { fill: #5a4632; }
    .dirt   { fill: #8a6a3a; }
    .out      { fill: none; stroke: #3a2817; stroke-width: 1.9; stroke-linejoin: round; stroke-linecap: round; }
    .out-thin { fill: none; stroke: #3a2817; stroke-width: 1.2; stroke-linejoin: round; stroke-linecap: round; opacity: 0.85; }
    .hi     { fill: rgba(255, 248, 228, 0.5); }
    .sh     { fill: rgba(58, 40, 23, 0.22); }
  `;
