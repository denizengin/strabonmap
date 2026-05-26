// core/eras-data-2.js — era taxonomy DATA, part B (eras 6-10:
// Scriptorium → Modern) PLUS the small key→value maps. Extracted from
// core/eras.js (#136 split); see core/eras-data.js for the part-A
// rationale + the stitch contract.
//
// Load order: eras-data.js → eras-data-2.js → eras.js. This file
// declares ERAS_PART_B (eras 6-10) and the pure-data maps ERA_MODE +
// UNIVERSAL_THEME_KEYS. The other small maps (ERA_DISPLAY_NAMES,
// DEFAULT_ERA_KEY, LEGACY_ERA_KEY) live in core/eras-data.js to keep
// both data files under the LOC ceiling. core/eras.js owns the
// published ERAS global (ERAS = ERAS_PART_A.concat(ERAS_PART_B)) + all
// lookup functions. PUBLISHED globals consumed by boot.js stay
// byte-identical names.

  const ERAS_PART_B = [
    /* ============= 6. SCRIPTORIUM · 1191 CE ============= */
    {
      key: 'high-medieval',
      name: 'Scriptorium',
      year: '1191 CE',
      yearStart: 1100, yearEnd: 1500,
      sub: 'Third Crusade · High Medieval · illuminated codex',
      font: { family: "'Cardo', serif", weight: 700, style: 'normal', tracking: '0.02em' },
      themes: [
        {
          key: 'high-medieval-illumination',
          name: 'Illumination',
          ground: '#ede0c1', ink: '#1f1409', inkFaded: 'rgba(31,20,9,0.35)',
          route: '#1d3a78', routeDash: { width: 2.4, dash: 8, gap: 4 },
          sea: '#1d3a78', land: '#ede0c1', accent: '#b6892a',
          transport: { sea: 'cog', land: 'palfrey', air: null },
          flourish: 'illuminated-a',
        },
        {
          key: 'high-medieval-tournament',
          name: 'Tournament-burgundy',
          ground: '#6b1a26', ink: '#ede0c1', inkFaded: 'rgba(237,224,193,0.25)',
          route: '#b6892a', routeDash: { width: 2.6, dash: 9, gap: 4 },
          sea: '#1d3a78', land: '#6b1a26', accent: '#b6892a',
          transport: { sea: 'cog', land: 'palfrey', air: null },
          flourish: 'heraldic-shield',
          font: { family: "'Cardo', serif", weight: 700, style: 'italic', tracking: '0.02em' },
        },
      ],
    },
    /* ============= 7. ATLAS · 1573 CE =============
     * Covers 1500 -> 1830. The user explicitly chose to stick with
     * the original 10-era taxonomy; a planned enlightenment carve-out
     * was reverted on 2026-05-17. Compression accepted: this era
     * spans printed atlas + Age of Sail + Enlightenment, with the
     * anchor (1573 CE) sitting in the Ortelius / Lepanto moment.
     * Cook (1770s) and Diderot fall on the looser late edge. */
    {
      key: 'atlas',
      name: 'Atlas',
      year: '1573 CE',
      yearStart: 1500, yearEnd: 1830,
      sub: 'Post-Lepanto · Ortelius · copperplate atlas',
      font: { family: "'IM Fell English', serif", weight: 400, style: 'italic', tracking: '0.02em' },
      themes: [
        {
          key: 'atlas-cream',
          name: 'Engraving-cream',
          ground: '#ead8b2', ink: '#2a1a0c', inkFaded: 'rgba(42,26,12,0.40)',
          route: '#6b3a18', routeDash: { width: 2.2, dash: 7, gap: 4 },
          sea: '#ead8b2', land: '#ead8b2', accent: '#b62a1c',
          // E88 / E-balloon-vocab (18 May 2026): air:'balloon' gated to
          // year >= 1783 (Montgolfier). inferVehicle reads transport.air
          // + the trip year; pre-1783 atlas legs fall back to no-air.
          transport: { sea: 'caravel', land: 'palfrey', air: 'balloon' },
          flourish: 'cartouche',
        },
        {
          key: 'atlas-tobacco',
          name: 'Engraving-tobacco',
          ground: '#b89055', ink: '#1f1208', inkFaded: 'rgba(31,18,8,0.45)',
          route: '#1f1208', routeDash: { width: 2.2, dash: 7, gap: 4 },
          sea: '#a07a40', land: '#b89055', accent: '#9c2a14',
          transport: { sea: 'galleon', land: 'palfrey', air: 'balloon' },
          flourish: 'sea-monster',
        },
      ],
    },
    /* ============= 8. INDUSTRIAL · 1885 CE ============= */
    {
      key: 'industrial',
      name: 'Industrial',
      year: '1885 CE',
      yearStart: 1830, yearEnd: 1920,
      sub: 'Transcontinental rail · Imperial cartography · Ordnance',
      font: { family: "'Source Sans 3', sans-serif", weight: 600, style: 'normal', tracking: '0.18em' },
      themes: [
        {
          key: 'industrial-cyanotype',
          name: 'Cyanotype',
          ground: '#0e3a78', ink: '#f0eadb', inkFaded: 'rgba(240,234,219,0.25)',
          route: '#d4a04a', routeDash: { width: 2.6, dash: 9, gap: 5 },
          sea: '#082850', land: '#0e3a78', accent: '#d4a04a',
          transport: { sea: 'steamer', land: 'locomotive', air: 'biplane' },
          flourish: 'surveyor-compass',
        },
        {
          key: 'industrial-sepia',
          name: 'Sepia-photograph',
          ground: '#c2935e', ink: '#2a1408', inkFaded: 'rgba(42,20,8,0.45)',
          route: '#3a2010', routeDash: { width: 2.0, dash: 5, gap: 3 },
          sea: '#c2935e', land: '#c2935e', accent: '#3a2010',
          transport: { sea: 'steamer', land: 'locomotive', air: 'biplane' },
          flourish: 'sextant',
          font: { family: "'Old Standard TT', serif", weight: 400, style: 'italic', tracking: '0.04em' },
        },
      ],
    },
    /* ============= 9. ADVENTURE · 1936 (EXISTING - PRESERVE) ============= */
    {
      key: 'nineteen-thirties',
      name: 'Adventure',
      year: '1936',
      yearStart: 1920, yearEnd: 1945,
      sub: 'Pulp field-journal · the shipping register before E70',
      font: { family: "'IM Fell DW Pica', serif", weight: 400, style: 'italic', tracking: '0.02em' },
      themes: [
        {
          key: 'parchment',     /* legacy id — body.theme-parchment still works */
          name: 'Parchment-cream',
          ground: '#e1cc9f', ink: '#3a2817', inkFaded: 'rgba(58,40,23,0.40)',
          route: '#a8302a', routeDash: { width: 2.4, dash: 8, gap: 4 },
          sea: '#b8c4a0', land: '#e1cc9f', accent: '#a8302a',
          transport: { sea: 'adventure-boat', land: 'adventure-car', air: 'prop-plane' },
          flourish: 'compass-rose',
        },
        {
          key: 'parchment-linen',
          name: 'Parchment-linen',
          ground: '#ede2c2', ink: '#3a2817', inkFaded: 'rgba(58,40,23,0.40)',
          route: '#a8302a', routeDash: { width: 2.4, dash: 8, gap: 4 },
          sea: '#a8b8a0', land: '#ede2c2', accent: '#a8302a',
          transport: { sea: 'adventure-boat', land: 'adventure-car', air: 'prop-plane' },
          flourish: 'compass-rose',
        },
        {
          key: 'meadow',       /* legacy id */
          name: 'Meadow',
          ground: '#2a3819', ink: '#f1ead2', inkFaded: 'rgba(241,234,210,0.30)',
          route: '#b94a2d', routeDash: { width: 2.4, dash: 8, gap: 4 },
          sea: '#1b2510', land: '#2a3819', accent: '#d39a3a',
          transport: { sea: 'adventure-boat', land: 'adventure-car', air: 'prop-plane' },
          flourish: 'compass-rose-gold',
        },
        // E83 / E-hc-toggle (18 May 2026): the 'hc' theme variant was
        // removed. HC is now a global accessibility flag (body.hc)
        // orthogonal to era + theme. See themeOverlay in index.html.
        // Migration in core/migrations.js maps trips with theme:'hc'
        // to theme:'parchment' + settings.hc = true.
      ],
    },
    /* ============= 10. MODERN · 2024 (DEFAULT FOR NEW TRIPS) ============= */
    {
      key: 'modern',
      name: 'Modern',
      year: '2024',
      yearStart: 1945, yearEnd: 9999,
      sub: 'Default for new trips · contemporary digital cartography',
      font: { family: "'Inter', sans-serif", weight: 600, style: 'normal', tracking: '-0.01em' },
      themes: [
        {
          key: 'modern-linen-flat',
          name: 'Linen-flat',
          ground: '#f3eee3', ink: '#1a1a1a', inkFaded: 'rgba(26,26,26,0.20)',
          route: '#d75a30', routeDash: { width: 3.4, dash: 9, gap: 5 },
          sea: '#b8c4d4', land: '#f3eee3', accent: '#d75a30',
          transport: { sea: 'steamer', land: 'modern-car', air: 'airliner' },
          flourish: 'modern-arrow',
        },
        {
          // E-era-theme-v1 (#117) — pushed distinctly warmer + greener so it
          // reads as a RELIEF/contour map, clearly different from the cool
          // off-white Linen-flat. Was a near-identical pale tan that made the
          // theme switch look like a no-op.
          key: 'modern-topo',
          name: 'Topo-relief',
          ground: '#dcc89a', ink: '#403019', inkFaded: 'rgba(64,48,25,0.28)',
          route: '#bf4326', routeDash: { width: 3, dash: 10, gap: 5 },
          sea: '#88b0a0', land: '#dcc89a', accent: '#3f7d5a',
          transport: { sea: 'steamer', land: 'modern-car', air: 'airliner' },
          flourish: 'topo-north',
        },
        {
          // E-era-theme-v1 (#117) — strengthened the cool blue ink/accent so
          // the white-paper sketch reads unmistakably as a blue-pen field
          // sketch, distinct from the two warm modern themes.
          key: 'modern-sketch',
          name: 'Field-sketch',
          ground: '#fbfaf6', ink: '#1f3352', inkFaded: 'rgba(31,51,82,0.30)',
          route: '#b5301a', routeDash: { width: 2.6, dash: 7, gap: 4 },
          sea: '#e7eef6', land: '#fbfaf6', accent: '#23508f',
          transport: { sea: 'steamer', land: 'modern-train', air: 'airliner' },
          flourish: 'sketch-n',
          font: { family: "'Caveat', cursive", weight: 700, style: 'normal', tracking: '0.01em' },
        },
      ],
    },
  ];

  /* Era mode (council #43 verdict, 17 May 2026):
   *   'strict' — historical eras where the search box answers
   *              "places that existed THEN." Filters to ERA_PLACES
   *              entries active in the era's year window. No modern-
   *              gazetteer fallback. Empty search field surfaces
   *              era + bbox candidates as suggestions.
   *   'loose'  — registers (Adventure, Modern) where the user is
   *              plotting their actual modern trip; the era is a
   *              lens, not a gate. Modern gazetteer is allowed.
   *
   * A per-trip override (allowAnachronisticPlaces) flips a strict era
   * to loose for ONE chronicle. Default off; surfaced as a trip
   * setting, not a search affordance. */
  const ERA_MODE = {
    'bronze-age':        'strict',
    'classical':         'strict',
    'late-antiquity':    'strict',
    'dark-ages':         'strict',
    'byzantium':         'strict',
    'high-medieval':     'strict',
    'atlas':             'strict',
    'industrial':        'strict',
    'nineteen-thirties': 'loose',
    'modern':            'loose',
  };

  /* Universal themes — the app's drawing language, valid on every era.
   * Council verdict (16 May 2026): parchment + meadow are the original
   * register and predate the era taxonomy. They live as Adventure-era
   * themes for canonical-home + legacy-resolution reasons, but the
   * theme picker offers them on every era via availableThemesForEra().
   * HC stays out of this list — it'll become a global a11y flag via
   * E-hc-toggle; bolting it on as "universal" now would block that. */
  const UNIVERSAL_THEME_KEYS = ['parchment', 'meadow'];
