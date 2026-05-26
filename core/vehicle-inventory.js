// core/vehicle-inventory.js — per-era vehicle picker allowlist.
//
// PURPOSE
// The leg-picker in the trip editor used to read transport vocab from
// eras.js (one sea + one land + maybe one air per era) and render only
// the 5 hardcoded glyphs {plane, balloon, boat, train, car}. Result:
//   - Classical era's land vehicle 'roman-cart' aliases to the 'cart'
//     glyph which isn't in the picker, so the user saw ONLY 'boat'.
//   - Worse: 'trireme' aliases to 'boat' which renders as a STEAMSHIP
//     silhouette (smokestack + smoke puff) — anachronistic + a single
//     wrong choice.
//
// This file is the canonical per-era vehicle inventory. The picker
// iterates VEHICLES_BY_ERA[eraKey] and renders one button per entry,
// using VEHICLE_PICKER_META for label + glyph. Year-gated vehicles
// (balloon 1783+, biplane 1903+) are filtered by getVehiclesForEra().
//
// #136 split: the two big data tables (VEHICLES_BY_ERA + VEHICLE_PICKER_META)
// now live in core/vehicle-inventory-data.js, which MUST load first.
// This file keeps the FUNCTIONS + the glyph-fallback tables and reads
// the data tables by bare global name.
//
// HARD CONSTRAINTS
// - 10-era taxonomy only (bronze-age .. modern). Do NOT add carve-outs.
// - 'foot' is in every pre-industrial era (UI affordance for <5km legs).
// - 'battleship' is 20th-century — modern only.
// - Glyph aliasing stays in boot.js's VEHICLE_GLYPH_ALIAS for rendering
//   on the canvas / vehicle layer. THIS file declares the picker's
//   vocabulary; the glyph mapping is a separate concern.
//
// Ambient globals consumed: VEHICLES_BY_ERA, VEHICLE_PICKER_META (from
// core/vehicle-inventory-data.js); eraMidYear (from core/eras.js).
// Consumed by: src/ui/editor-cities.js (leg picker render).

  /* getVehiclesForEra(eraKey, year)
   *
   * Returns the picker-allowed vehicle keys for the era, with year-gate
   * applied. `year` is optional: when omitted, falls back to the era's
   * midpoint year (via eraMidYear from core/eras.js) when available,
   * otherwise treats all gated vehicles as out-of-range.
   *
   * Returns an empty array for an unknown era (caller renders an
   * empty picker — fail-safe; never throws).
   */
  const getVehiclesForEra = (eraKey, year) => {
    const list = VEHICLES_BY_ERA[eraKey];
    if (!Array.isArray(list)) return [];
    let yr = (typeof year === 'number') ? year : null;
    if (yr == null && typeof eraMidYear === 'function') {
      const m = eraMidYear(eraKey);
      if (typeof m === 'number') yr = m;
    }
    return list.filter((vk) => {
      const meta = VEHICLE_PICKER_META[vk];
      if (!meta) return false;
      if (typeof meta.minYear !== 'number') return true;
      // Year-gated: include only if we have a year and it's >= minYear.
      // If no year is resolvable, exclude (conservative — better to
      // hide a 1783 balloon than show one in 800 CE).
      return (typeof yr === 'number' && yr >= meta.minYear);
    });
  };

  /* PICKER_GLYPH_FALLBACK — when a vehicle's declared `glyph` does not
   * have a matching _ICON_SMALL sprite in boot.js, the picker falls
   * back to one of the supported glyph families. This keeps the picker
   * render lossless: every era-allowed vehicle gets a visible button.
   * The mapping below is conservative — domain-correct rather than
   * aesthetic:
   *   - lighter-than-air → balloon
   *   - any winged aircraft → plane
   *   - rail → train
   *   - automobile / wheeled mech → car
   *   - everything water-borne → boat
   *   - period land (horse / camel / cart / elephant / foot) → car
   * Update VEHICLE_SUPPORTED_PICKER_GLYPHS below when a real sprite is
   * added to boot.js so the warn stops firing for it.
   *
   * pair-9B (19 May 2026): expanded supported set from 5 → 15. Added
   * dedicated picker sprites for foot, bicycle, ferry, battleship,
   * horse, camel, donkey, pack-mule, ox-cart, carriage.
   *
   * pair-11A (19 May 2026): expanded 15 → 25. Added galley, trireme,
   * dromon, dhow, cog, caravel, merchantman, raft, chariot, plus a
   * dedicated steamer glyph (the old `boat` art). Simultaneously
   * reframed the generic `boat` sprite as a period-neutral sailing
   * vessel so the residual fallback is no longer a 1930s steamship.
   * Closes the "bronze-age galley renders as a steamship" + "chariot
   * renders as a modern automobile" bugs.
   */
  const VEHICLE_SUPPORTED_PICKER_GLYPHS = new Set([
    // Base 5 (shipped before pair-9B)
    'plane', 'boat', 'car', 'train', 'balloon',
    // pair-9B: 10 new sprites
    'foot', 'bicycle', 'ferry', 'battleship',
    'horse', 'camel', 'donkey', 'pack-mule',
    'ox-cart', 'carriage',
    // pair-11A: 10 new sprites — period vessels + chariot + dedicated
    // steamer. Closes the "bronze-age galley renders as 1930s steamship"
    // bug. 'boat' was simultaneously reframed (one mast + square sail,
    // no funnel) so the generic fallback is no longer anachronistic.
    'steamer', 'galley', 'trireme', 'dromon',
    'dhow', 'cog', 'caravel', 'merchantman',
    'raft', 'chariot',
  ]);
  const PICKER_GLYPH_FALLBACK = {
    // lighter-than-air variants
    'hot-air-balloon': 'balloon', 'gas-balloon': 'balloon',
    // winged
    'biplane': 'plane', 'prop-plane': 'plane', 'jet': 'plane',
    'airliner': 'plane', 'aeroplane': 'plane',
    // sea — pair-11A: period vessels now have dedicated glyphs. The
    // generic 'boat' fallback is only hit for unknown sea keys + the
    // reframed (period-neutral) sailing vessel. Steamships route to
    // the dedicated 'steamer' glyph, not the generic boat.
    'liburna': 'galley',
    'galleon': 'caravel', 'frigate': 'caravel',
    'steamship': 'steamer', 'liner': 'steamer', 'ocean-liner': 'steamer',
    'schooner': 'boat', 'junk': 'boat', 'windsledge': 'boat',
    // rail
    'locomotive': 'train',
    // land — animals + wheeled period vehicles. pair-11A: 'chariot'
    // promoted to its own glyph; only true unknown carts fall to 'car'.
    'foot': 'car', 'horse': 'car', 'donkey': 'car', 'palfrey': 'car',
    'knight-horse': 'car', 'pack-mule': 'car',
    'camel': 'car', 'caravan': 'car', 'elephant': 'car',
    'ox-cart': 'car', 'roman-cart': 'car',
    'cart': 'car', 'carriage': 'car', 'bicycle': 'car',
    'automobile': 'car', 'modern-car': 'car',
  };

  /* resolvePickerGlyph(vehicleKey, opts)
   *
   * Returns one of the 5 supported picker glyph keys (plane / boat /
   * car / train / balloon) for any allowed vehicle. Logs ONE warn per
   * vehicle key the first time we fall back, so missing-sprite work
   * surfaces in the console without spamming.
   */
  const _pickerWarned = new Set();
  const resolvePickerGlyph = (vehicleKey, opts) => {
    const meta = VEHICLE_PICKER_META[vehicleKey];
    const declared = meta && meta.glyph;
    if (declared && VEHICLE_SUPPORTED_PICKER_GLYPHS.has(declared)) return declared;
    const fallback = PICKER_GLYPH_FALLBACK[vehicleKey]
      || PICKER_GLYPH_FALLBACK[declared]
      || 'car';
    if (!_pickerWarned.has(vehicleKey)) {
      _pickerWarned.add(vehicleKey);
      const silent = opts && opts.silent;
      if (!silent && typeof console !== 'undefined' && console.warn) {
        console.warn(
          `[vehicle-inventory] no _ICON_SMALL sprite for "${vehicleKey}" `
          + `(declared glyph "${declared}"); using fallback "${fallback}". `
          + `Add a sprite in boot.js or update VEHICLE_SUPPORTED_PICKER_GLYPHS.`
        );
      }
    }
    return fallback;
  };
