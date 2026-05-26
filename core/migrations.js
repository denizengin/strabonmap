// core/migrations.js — E-migration-versioning + E-rename.
// Tiny forward-only schema runner for the persisted store. The store
// is a plain object held in localStorage; this file owns the
// "what version are we on, and how do we walk older stores up to it"
// question.
//
// Wired in from index.html / mobile.html's getStore() path: after the
// shape-level migrate(s) (cities[] / landmarks[] / s.version=3 / etc.)
// runs, runMigrations(s) walks s.schemaVersion → SCHEMA_VERSION and
// applies each step in order. Idempotent: a store already at the
// latest version is a no-op.
//
// Migration entries live in MIGRATIONS as { from, to, run(s) } records,
// ordered by `from`. Each run() mutates the store IN PLACE and returns
// nothing (the runner stamps s.schemaVersion = to after each step).
//
// Loads as a script-tag global (no module wrapper). Depends on nothing.

  const SCHEMA_VERSION = 2;

  // E-rename (council decision 2, 17 May 2026): internal era keys
  // renamed to mechanical/sortable values. User-facing display names
  // are unchanged — see ERA_DISPLAY_NAMES in core/eras.js.
  //
  // Theme-key rename map covers the four affected era prefixes only.
  // Legacy standalone keys (parchment / meadow / hc / parchment-linen)
  // are untouched — they predate the era taxonomy and remain valid.
  const ERA_KEY_RENAME_V0_TO_V1 = {
    'anatolia':    'bronze-age',
    'itineraria':  'dark-ages',
    'scriptorium': 'high-medieval',
    'adventure':   'nineteen-thirties',
  };
  const THEME_KEY_RENAME_V0_TO_V1 = {
    'anatolia-limestone':       'bronze-age-limestone',
    'anatolia-terracotta':      'bronze-age-terracotta',
    'anatolia-bronze':          'bronze-age-bronze',
    'itineraria-carolingian':   'dark-ages-carolingian',
    'itineraria-abbasid':       'dark-ages-abbasid',
    'scriptorium-illumination': 'high-medieval-illumination',
    'scriptorium-tournament':   'high-medieval-tournament',
  };

  const MIGRATIONS = [
    {
      from: 0,
      to: 1,
      run(s) {
        // Walk every trip's era + theme, remap if present in the table.
        if (Array.isArray(s.trips)) {
          for (const t of s.trips) {
            if (t && typeof t === 'object') {
              if (typeof t.era === 'string' && ERA_KEY_RENAME_V0_TO_V1[t.era]) {
                t.era = ERA_KEY_RENAME_V0_TO_V1[t.era];
              }
              if (typeof t.theme === 'string' && THEME_KEY_RENAME_V0_TO_V1[t.theme]) {
                t.theme = THEME_KEY_RENAME_V0_TO_V1[t.theme];
              }
            }
          }
        }
        // Global active theme key (the picker writes this on selection).
        if (typeof s.theme === 'string' && THEME_KEY_RENAME_V0_TO_V1[s.theme]) {
          s.theme = THEME_KEY_RENAME_V0_TO_V1[s.theme];
        }
      },
    },
    {
      // E83 / E-hc-toggle (18 May 2026): HC was a theme variant under
      // the (then) adventure era; now it's a global body.hc accessibility
      // flag. Trips with theme:'hc' get remapped to a real visual theme;
      // the user's HC preference is hoisted to settings.hc.
      from: 1,
      to: 2,
      run(s) {
        if (!s.settings || typeof s.settings !== 'object') s.settings = {};
        let sawHC = false;
        // The legacy 'hc' theme key lived under the adventure era, which
        // E-rename just renamed to 'nineteen-thirties'. Promote to that
        // era's parchment theme so the chronicle still renders coherently.
        const HC_TARGET = 'nineteen-thirties-parchment';
        if (Array.isArray(s.trips)) {
          for (const t of s.trips) {
            if (t && typeof t === 'object' && t.theme === 'hc') {
              t.theme = HC_TARGET;
              sawHC = true;
            }
          }
        }
        if (s.theme === 'hc') {
          s.theme = 'parchment';
          sawHC = true;
        }
        if (sawHC) s.settings.hc = true;
      },
    },
  ];

  /* runMigrations(s)
   * Walk s.schemaVersion → SCHEMA_VERSION, applying each migration
   * step in order. Mutates s in place; also returns it for ergonomics.
   * Treats missing/non-numeric schemaVersion as 0. Stamps the new
   * version after each step. Safe to call on an already-current store. */
  const runMigrations = (s) => {
    if (!s || typeof s !== 'object') return s;
    let current = (typeof s.schemaVersion === 'number') ? s.schemaVersion : 0;
    while (current < SCHEMA_VERSION) {
      const step = MIGRATIONS.find((m) => m.from === current);
      if (!step) {
        // No migration registered for this version — bail to avoid an
        // infinite loop on a misconfigured table. Stamp the highest
        // version we DID reach so we don't keep retrying on next boot.
        break;
      }
      step.run(s);
      s.schemaVersion = step.to;
      current = step.to;
    }
    return s;
  };
