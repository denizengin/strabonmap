// core/viewports.js — E-per-trip-bbox. Named viewport presets (Wave I council
// 2026-05-16). Each preset carries a bbox [minLon, minLat, maxLon, maxLat]
// in the same lon/lat space as core/geo-data.js, plus the region packs that
// preset wants auto-loaded.
//
// The preset list is intentionally short. Curator's call (council):
// "Black Sea" + "Levant" earn their place over British Isles + Scandinavia,
// which would render mostly empty rectangles against the current source
// data. Add the latter pair when source coverage warrants.

  const VIEWPORTS = [
    {
      id: 'cyprus',
      label: 'Cyprus',
      bbox: [32.0, 34.4, 34.7, 35.8],
      regionPacks: ['cyprus'],
    },
    {
      id: 'turkey',
      label: 'Turkey',
      bbox: [25.6, 35.8, 44.9, 42.2],
      regionPacks: ['turkey'],
    },
    {
      id: 'eastern-med',
      label: 'Eastern Mediterranean',
      bbox: [19.0, 30.0, 37.0, 42.5],
      regionPacks: ['cyprus', 'turkey', 'aegean', 'levant'],
    },
    {
      id: 'western-med',
      label: 'Western Mediterranean',
      bbox: [-6.0, 35.0, 18.0, 45.0],
      regionPacks: ['tyrrhenian', 'adriatic'],
    },
    {
      id: 'iberia-maghreb',
      label: 'Iberia + Maghreb',
      bbox: [-10.0, 28.0, 6.0, 44.0],
      regionPacks: [],
    },
    {
      id: 'black-sea',
      label: 'Black Sea',
      bbox: [27.0, 40.0, 43.0, 47.5],
      regionPacks: [],
    },
    {
      id: 'levant',
      label: 'Levant',
      bbox: [33.0, 30.0, 39.0, 38.0],
      regionPacks: ['levant', 'cyprus'],
    },
    {
      id: 'hanno',
      label: "Hanno's Voyage",
      bbox: [-18.0, 5.0, 12.0, 38.0],
      regionPacks: [],
    },
    {
      id: 'skylax',
      label: "Skylax's Survey",
      bbox: [30.0, 5.0, 75.0, 40.0],
      regionPacks: [],
    },
  ];

  /* Lookups. */
  const viewportById = (id) => VIEWPORTS.find((v) => v.id === id) || null;
  const allViewportIds = () => VIEWPORTS.map((v) => v.id);

  /* Era → suggested viewport. Era proposes, user disposes (council
   * verdict). Returns a viewport id or null if no strong default. */
  const ERA_VIEWPORT_HINTS = {
    'bronze-age':        'turkey',
    'classical':         'eastern-med',
    'late-antiquity':    'eastern-med',
    'dark-ages':         'eastern-med',
    'byzantium':         'eastern-med',
    'high-medieval':     'eastern-med',
    'atlas':             'western-med',
    'industrial':        'western-med',
    'nineteen-thirties': 'eastern-med',
    'modern':            null,
  };
  const suggestViewportForEra = (eraKey) => ERA_VIEWPORT_HINTS[eraKey] || null;
