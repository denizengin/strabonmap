// core/vehicle-inventory-data.js — pure data tables for the per-era
// vehicle picker. Extracted from core/vehicle-inventory.js (#136 split)
// so the parent stays under the LOC ceiling. This file declares the
// big lookup tables as bare-name globals; it MUST load BEFORE
// core/vehicle-inventory.js (script load order = dependency order),
// because getVehiclesForEra() / resolvePickerGlyph() reference these
// by bare global name.
//
// Published globals (unchanged names): VEHICLES_BY_ERA, VEHICLE_PICKER_META.
// See core/vehicle-inventory.js for the picker contract + glyph-aliasing
// rationale (HARD CONSTRAINTS comment lives there).

  /* Per-era allowed vehicles, ordered by typical-use prominence.
   * Keys MUST be the internal era keys from core/eras.js (NOT display
   * names). Vehicles are referenced by their canonical key (matches
   * VEHICLE_GLYPH_ALIAS keys in boot.js + VEHICLE_PICKER_META below). */
  const VEHICLES_BY_ERA = {
    // 1. ANATOLIA · 1700-1100 BCE
    'bronze-age': [
      'foot', 'donkey', 'chariot', 'ox-cart', 'raft', 'galley',
    ],
    // 2. CLASSICAL · 1100 BCE - 284 CE (Greek + Persian + Roman)
    'classical': [
      'foot', 'horse', 'chariot', 'roman-cart', 'trireme', 'liburna',
      'merchantman', 'camel',
    ],
    // 3. LATE ANTIQUITY · 284-700 CE
    'late-antiquity': [
      'foot', 'horse', 'camel', 'pack-mule', 'ox-cart', 'liburna',
      'dromon',
    ],
    // 4. ITINERARIA · 700-867 CE (Carolingian + Abbasid = islamic-golden)
    // dromon: the Byzantine war-galley was in continuous service across this
    // window (it bookends the era — late-antiquity + byzantium both list it), so
    // a Byzantine campaign filed here (Justinian/Heraclius) uses the dromon, not
    // the Arab dhow. Added 8 Jul for the sample-catalog sea-leg fix.
    'dark-ages': [
      'foot', 'horse', 'camel', 'pack-mule', 'donkey', 'dhow', 'dromon',
    ],
    // 5. BYZANTIUM · 867-1100 CE
    'byzantium': [
      'foot', 'horse', 'camel', 'pack-mule', 'donkey', 'dromon',
    ],
    // 6. SCRIPTORIUM · 1100-1500 CE (high medieval + crusader window)
    'high-medieval': [
      'foot', 'horse', 'palfrey', 'knight-horse', 'camel', 'caravan',
      'cog', 'galley',
    ],
    // 7. ATLAS · 1500-1830 CE (age of sail + early ottoman + enlightenment)
    'atlas': [
      'foot', 'horse', 'palfrey', 'carriage', 'caravan', 'camel',
      'caravel', 'galleon', 'frigate', 'schooner', 'balloon',
    ],
    // 8. INDUSTRIAL · 1830-1920 CE
    'industrial': [
      'foot', 'horse', 'carriage', 'bicycle', 'locomotive', 'steamer',
      'ferry', 'biplane', 'balloon',
    ],
    // 9. ADVENTURE · 1920-1945 CE (pulp register / Verne+kin)
    'nineteen-thirties': [
      'foot', 'car', 'locomotive', 'steamer', 'ferry', 'bicycle',
      'prop-plane', 'balloon', 'horse', 'elephant', 'schooner', 'junk',
      'windsledge',
    ],
    // 10. MODERN · 1945-present
    'modern': [
      'foot', 'car', 'bicycle', 'locomotive', 'ferry', 'steamer',
      'airliner', 'balloon', 'battleship',
    ],
  };

  /* Per-vehicle picker metadata. `glyph` is the rendered icon family
   * (matches boot.js's VEHICLE_GLYPH_ALIAS values + the 5 _ICON_SMALL
   * SVGs). `label` is the picker button tooltip. `minYear` is the
   * earliest year the vehicle plausibly exists; getVehiclesForEra()
   * filters by trip year if provided, else by era midpoint year. */
  const VEHICLE_PICKER_META = {
    // Land — feet + animals
    'foot':         { glyph: 'foot',     label: 'On foot' },
    'horse':        { glyph: 'horse',    label: 'Horse' },
    'donkey':       { glyph: 'donkey',   label: 'Donkey' },
    'palfrey':      { glyph: 'horse',    label: 'Palfrey' },
    'knight-horse': { glyph: 'horse',    label: 'Mounted knight' },
    'pack-mule':    { glyph: 'pack-mule', label: 'Pack-mule' },
    'camel':        { glyph: 'camel',    label: 'Camel' },
    'caravan':      { glyph: 'camel',    label: 'Caravan' },
    'elephant':     { glyph: 'elephant', label: 'Elephant' },
    // Land — wheeled. pair-11A (19 May 2026): 'chariot' promoted to its
    // own glyph (2 spoked wheels + yoke-pole + driver). 'roman-cart' +
    // 'cart' still alias to the generic 'cart' family (no dedicated
    // sprite yet — they fall back to 'car'). ox-cart + carriage have
    // their own picker sprites (pair-9B).
    'chariot':      { glyph: 'chariot',  label: 'Chariot' },
    'ox-cart':      { glyph: 'ox-cart',  label: 'Ox-cart' },
    'roman-cart':   { glyph: 'cart',     label: 'Roman cart' },
    'cart':         { glyph: 'cart',     label: 'Cart' },
    'carriage':     { glyph: 'carriage', label: 'Carriage' },
    'bicycle':      { glyph: 'bicycle',  label: 'Bicycle' },
    'car':          { glyph: 'car',      label: 'Automobile' },
    'automobile':   { glyph: 'car',      label: 'Automobile' },
    'modern-car':   { glyph: 'car',      label: 'Car' },
    // Land — rail
    'locomotive':   { glyph: 'train',    label: 'Locomotive' },
    'train':        { glyph: 'train',    label: 'Train' },
    // Sea. pair-11A: period vessels promoted to dedicated glyphs so they
    // no longer alias to 'boat' (which used to render as a vintage
    // steamship). 'boat' is now a period-NEUTRAL sailing vessel; the
    // steamship art lives in the new 'steamer' glyph family.
    'raft':         { glyph: 'raft',        label: 'Raft' },
    'galley':       { glyph: 'galley',      label: 'Galley' },
    'trireme':      { glyph: 'trireme',     label: 'Trireme' },
    'liburna':      { glyph: 'galley',      label: 'Liburna' },
    'merchantman':  { glyph: 'merchantman', label: 'Merchantman' },
    'dromon':       { glyph: 'dromon',      label: 'Dromon' },
    'dhow':         { glyph: 'dhow',        label: 'Dhow' },
    'cog':          { glyph: 'cog',         label: 'Cog' },
    'caravel':      { glyph: 'caravel',     label: 'Caravel' },
    'galleon':      { glyph: 'caravel',     label: 'Galleon' },
    'frigate':      { glyph: 'caravel',     label: 'Frigate' },
    'schooner':     { glyph: 'schooner',    label: 'Schooner' },
    'steamer':      { glyph: 'steamer',     label: 'Steamship' },
    'steamship':    { glyph: 'steamer',     label: 'Steamship' },
    'ferry':        { glyph: 'ferry',       label: 'Ferry' },
    'junk':         { glyph: 'junk',        label: 'Junk' },
    'windsledge':   { glyph: 'windsledge',  label: 'Wind-sledge' },
    'battleship':   { glyph: 'battleship', label: 'Battleship', minYear: 1906 },
    // Air
    'balloon':      { glyph: 'balloon',  label: 'Balloon',  minYear: 1783 },
    'biplane':      { glyph: 'plane',    label: 'Biplane',  minYear: 1903 },
    'prop-plane':   { glyph: 'plane',    label: 'Prop plane', minYear: 1903 },
    'airliner':     { glyph: 'plane',    label: 'Airliner', minYear: 1914 },
    'jet':          { glyph: 'plane',    label: 'Jet',      minYear: 1952 },
    'plane':        { glyph: 'plane',    label: 'Aeroplane', minYear: 1903 },
  };
