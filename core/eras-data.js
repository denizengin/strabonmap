// core/eras-data.js — era taxonomy DATA, part A (eras 1-5: Anatolia →
// Byzantium). Extracted from core/eras.js (#136 split) so the parent
// stays under the LOC ceiling. The ERAS array is large enough that the
// data is split across TWO sibling files: this one declares ERAS_PART_A
// (eras 1-5); core/eras-data-2.js declares ERAS_PART_B (eras 6-10) plus
// the small key→value maps. core/eras.js then stitches them into the
// published ERAS global (const ERAS = ERAS_PART_A.concat(ERAS_PART_B)).
//
// Load order (all <script defer>): eras-data.js → eras-data-2.js →
// eras.js. ERAS_PART_A / ERAS_PART_B are internal staging globals; the
// PUBLISHED globals consumed by boot.js (ERAS, eraByKey, …) are unchanged.
//
// Tokens are transcribed from per-era-designs/project/era-sheets-data.jsx
// — see that file for the rendered design reference.

  const ERAS_PART_A = [
    /* ============= 1. ANATOLIA · 1200 BCE ============= */
    {
      key: 'bronze-age',
      name: 'Anatolia',
      year: '1200 BCE',
      // 17 May 2026 — contiguous era ranges (council pivot). yearStart /
      // yearEnd are signed integers (negative = BCE). Era boundaries
      // are touching: each era starts where the previous ends. See the
      // "Revisit era taxonomy" epic for the planned refinement
      // (carving hellenic out of classical, etc.).
      yearStart: -1700, yearEnd: -1100,
      sub: 'Late Bronze Age · Hittite Empire · Trojan War',
      font: { family: "'Cormorant Unicase', serif", weight: 700, style: 'normal', tracking: '0.16em' },
      themes: [
        {
          key: 'bronze-age-limestone',
          name: 'Limestone',
          ground: '#d9cdb1', ink: '#2a1d10', inkFaded: 'rgba(42,29,16,0.55)',
          route: '#7a7a3a', routeDash: { width: 2.4, dash: 8, gap: 5 },
          sea: '#2a4a6a', land: '#c2b393', accent: '#c2723c',
          transport: { sea: 'galley', land: 'chariot', air: null },
          flourish: 'sun-disc',
        },
        {
          key: 'bronze-age-terracotta',
          name: 'Terracotta',
          ground: '#a93b2c', ink: '#1a0d08', inkFaded: 'rgba(232,213,178,0.30)',
          route: '#1a0d08', routeDash: { width: 2.4, dash: 8, gap: 5 },
          sea: '#6e3325', land: '#a93b2c', accent: '#e8d5b2',
          transport: { sea: 'galley', land: 'chariot', air: null },
          flourish: 'sun-disc-ringed',
        },
        {
          key: 'bronze-age-bronze',
          name: 'Bronze',
          ground: '#5e6e4a', ink: '#e8d5b2', inkFaded: 'rgba(232,213,178,0.30)',
          route: '#c69a3d', routeDash: { width: 2.6, dash: 9, gap: 4 },
          sea: '#2a4a6a', land: '#5e6e4a', accent: '#c69a3d',
          transport: { sea: 'galley', land: 'chariot', air: null },
          flourish: 'sun-disc-bronze',
        },
      ],
    },
    /* ============= 2. CLASSICAL · 125 CE =============
     * Covers 1100 BCE -> 284 CE. The user explicitly chose to stick
     * with the original 10-era taxonomy; a planned hellenic carve-out
     * was reverted on 2026-05-17. Compression accepted: this era
     * spans Archaic Greece + Achaemenid + Alexander + Roman Republic +
     * Empire, with the anchor year (125 CE) sitting in Pax Romana.
     * Place-name and theme accuracy is best near the anchor, looser
     * at the edges. */
    {
      key: 'classical',
      name: 'Classical',
      year: '125 CE',
      yearStart: -1100, yearEnd: 284,
      sub: 'Pax Romana · Hadrian · Roman Imperial register',
      font: { family: "'Cinzel', serif", weight: 700, style: 'normal', tracking: '0.12em' },
      themes: [
        {
          key: 'classical-marble',
          name: 'Marble',
          ground: '#ede5d3', ink: '#2a1d10', inkFaded: 'rgba(42,29,16,0.40)',
          route: '#6e1c1c', routeDash: { width: 2.4, dash: 8, gap: 4 },
          sea: '#1d3a78', land: '#ede5d3', accent: '#6e1c1c',
          transport: { sea: 'trireme', land: 'roman-cart', air: null },
          flourish: 'laurel-wreath',
        },
        {
          key: 'classical-pompeian',
          name: 'Pompeian-red',
          ground: '#a93b2c', ink: '#e8d5b2', inkFaded: 'rgba(232,213,178,0.30)',
          route: '#1a0d04', routeDash: { width: 2.4, dash: 7, gap: 3 },
          sea: '#5e2e1e', land: '#a93b2c', accent: '#e8d5b2',
          transport: { sea: 'trireme', land: 'roman-cart', air: null },
          flourish: 'trajan-cols',
        },
        {
          key: 'classical-mosaic',
          name: 'Mosaic-tile',
          ground: '#e3d6ad', ink: '#2a1d10', inkFaded: 'rgba(42,29,16,0.45)',
          route: '#6e1c1c', routeDash: { width: 3, dash: 9, gap: 6 },
          sea: '#1d3a78', land: '#e3d6ad', accent: '#a8804a',
          transport: { sea: 'liburna', land: 'roman-cart', air: null },
          flourish: 'mosaic-cross',
        },
      ],
    },
    /* ============= 3. LATE ANTIQUITY · 476 CE ============= */
    {
      key: 'late-antiquity',
      name: 'Late Antiquity',
      year: '476 CE',
      yearStart: 284, yearEnd: 700,
      sub: 'Fall of Western Rome · Early Christian · Peutinger',
      font: { family: "'UnifrakturCook', serif", weight: 700, style: 'normal', tracking: '0.04em' },
      themes: [
        {
          key: 'lateantiquity-mosaic-gold',
          name: 'Mosaic-gold',
          ground: '#cba146', ink: '#3a0f12', inkFaded: 'rgba(58,15,18,0.35)',
          route: '#4d1018', routeDash: { width: 3, dash: 8, gap: 5 },
          sea: '#1d3a78', land: '#cba146', accent: '#6b1a26',
          transport: { sea: 'liburna', land: 'pack-mule', air: null },
          flourish: 'chi-rho',
        },
        {
          key: 'lateantiquity-marble',
          name: 'Late-Roman-marble',
          ground: '#d3c9b0', ink: '#2a1d10', inkFaded: 'rgba(42,29,16,0.40)',
          route: '#6e1c1c', routeDash: { width: 2.2, dash: 7, gap: 4 },
          sea: '#3a5a78', land: '#d3c9b0', accent: '#5a6532',
          transport: { sea: 'liburna', land: 'pack-mule', air: null },
          flourish: 'chi-rho',
          font: { family: "'Cardo', serif", weight: 700, style: 'italic', tracking: '0.04em' },
        },
      ],
    },
    /* ============= 4. ITINERARIA · 800 CE ============= */
    {
      key: 'dark-ages',
      name: 'Itineraria',
      year: '800 CE',
      yearStart: 700, yearEnd: 867,
      sub: 'Carolingian + Abbasid simultaneous peaks · road-route MSS',
      font: { family: "'EB Garamond', serif", weight: 700, style: 'normal', tracking: '0.02em' },
      themes: [
        {
          key: 'dark-ages-carolingian',
          name: 'Carolingian-vellum',
          ground: '#ede0c1', ink: '#3a1e10', inkFaded: 'rgba(58,30,16,0.35)',
          route: '#3a1e10', routeDash: { width: 2.0, dash: 6, gap: 3 },
          sea: '#6e7c8a', land: '#ede0c1', accent: '#b62a1c',
          transport: { sea: 'dhow', land: 'pack-mule', air: null },
          flourish: 'carolingian-initial',
        },
        {
          key: 'dark-ages-abbasid',
          name: 'Abbasid-indigo',
          ground: '#1a2a6e', ink: '#f8f0d8', inkFaded: 'rgba(248,240,216,0.25)',
          route: '#e8c860', routeDash: { width: 2.6, dash: 10, gap: 5 },
          sea: '#3a4a8a', land: '#1a2a6e', accent: '#e8c860',
          transport: { sea: 'dhow', land: 'pack-mule', air: null },
          flourish: 'kufic-stamp',
          font: { family: "'Source Sans 3', sans-serif", weight: 700, style: 'normal', tracking: '0.20em' },
        },
      ],
    },
    /* ============= 5. BYZANTIUM · 1025 CE ============= */
    {
      key: 'byzantium',
      name: 'Byzantium',
      year: '1025 CE',
      yearStart: 867, yearEnd: 1100,
      sub: 'Death of Basil II · peak extent · Macedonian Renaissance',
      font: { family: "'GFS Didot', serif", weight: 400, style: 'normal', tracking: '0.12em' },
      themes: [
        {
          key: 'byzantium-gold',
          name: 'Gold-ground',
          ground: '#cba146', ink: '#2a0f12', inkFaded: 'rgba(42,15,18,0.35)',
          route: '#4d1018', routeDash: { width: 2.8, dash: 8, gap: 4 },
          sea: '#4a1a52', land: '#cba146', accent: '#fff5e0',
          transport: { sea: 'dromon', land: 'pack-mule', air: null },
          flourish: 'double-eagle',
        },
        {
          key: 'byzantium-porphyry',
          name: 'Porphyry-purple',
          ground: '#4a1a52', ink: '#fff5e0', inkFaded: 'rgba(255,245,224,0.20)',
          route: '#cba146', routeDash: { width: 2.6, dash: 8, gap: 4 },
          sea: '#2a1030', land: '#4a1a52', accent: '#cba146',
          transport: { sea: 'dromon', land: 'pack-mule', air: null },
          flourish: 'double-eagle-gold',
        },
      ],
    },
  ];

  /* E-rename (council decision 2, 17 May 2026): internal era keys are
   * mechanical / sortable; user-facing strings remain the curated names
   * that ship in each era's `name` field. ERA_DISPLAY_NAMES is the
   * canonical key→display-name map for any boundary that wants to
   * render a label without holding the full era record. Internally
   * `era.name` continues to work exactly as before. (Lives here, in the
   * part-A data file, to balance LOC across the two split halves.) */
  const ERA_DISPLAY_NAMES = {
    'bronze-age':        'Anatolia',
    'classical':         'Classical',
    'late-antiquity':    'Late Antiquity',
    'dark-ages':         'Itineraria',
    'byzantium':         'Byzantium',
    'high-medieval':     'Scriptorium',
    'atlas':             'Atlas',
    'industrial':        'Industrial',
    'nineteen-thirties': 'Adventure',
    'modern':            'Modern',
  };

  /* Constants for migration + defaults. */
  // MVP-9 ERA COLLAPSE (owner sign-off 3 Jul 2026) — with the era picker off
  // the front door, new trips default to the Adventure identity instead
  // of 'modern'. The full 10-era choice remains in the trip editor; the era
  // taxonomy itself is unchanged (reversible).
  const DEFAULT_ERA_KEY = 'nineteen-thirties';  // new trips default here
  const LEGACY_ERA_KEY = 'nineteen-thirties';   // pre-E70 trips migrate here
