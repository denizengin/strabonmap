// core/airport-detect.js — a tiny AIRPORT / port recogniser (P1/P2, two-journeys).
//
// Both real journeys start where the PHOTOS start — at an airport (Heathrow /
// Larnaca / Gatwick / Bodrum / Rhodes), not at home. Two folio items need to
// know "is this stop an airport?": the London car-bookends (#175 — prepend a
// home→airport car leg, append airport→home) and the airport-aware inference
// bias (#185 — force the long adjacent leg to air, the airport→city leg to car).
//
// PURE, no DOM. Recognises by NAME: an explicit airport gazetteer of the places
// these journeys touch, plus generic word patterns ("Airport", "Aéroport",
// "Havalimanı", a trailing " (LHR)"-style IATA code). Deliberately conservative —
// a false positive would mangle a real city leg, so we only fire on clear signals.
//
// Loaded as a plain global: `const airportDetect = ...` at 2-space indent so
// tests/core-loader.js scrapes it and the classic-script page reaches it by name.

  const airportDetect = (() => {
    // Named airports the two journeys (and common UK/Med travel) touch. Lower-cased,
    // accent-folded keys; a stop whose folded name CONTAINS one of these is an
    // airport. Kept short + specific; the generic patterns below catch the rest.
    const NAMED = [
      'heathrow', 'gatwick', 'stansted', 'luton', 'london city airport',
      'larnaca', 'paphos', 'ercan',
      'bodrum', 'milas', 'dalaman', 'antalya',
      'rhodes airport', 'diagoras',
      'stansted', 'manchester airport', 'edinburgh airport',
    ];
    // Generic tokens that mark an airport in any language the app is likely to see.
    const TOKENS = ['airport', 'aeroport', 'aéroport', 'havalimani', 'havalimanı',
      'flughafen', 'aeropuerto', 'aeroporto'];

    const fold = (s) => {
      let out = String(s == null ? '' : s).toLowerCase();
      try { out = out.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
      return out;
    };

    // Is this stop an airport? Accepts a stop object or a bare name string.
    const isAirport = (stopOrName) => {
      const raw = (stopOrName && typeof stopOrName === 'object')
        ? (stopOrName.displayName || stopOrName.name || '')
        : stopOrName;
      const n = fold(raw);
      if (!n) return false;
      // An explicit flag wins (author or importer may set it).
      if (stopOrName && typeof stopOrName === 'object' && stopOrName.isAirport) return true;
      for (let i = 0; i < TOKENS.length; i++) if (n.indexOf(TOKENS[i]) !== -1) return true;
      for (let i = 0; i < NAMED.length; i++) if (n.indexOf(NAMED[i]) !== -1) return true;
      // A trailing IATA-style code in parens: "London Heathrow (LHR)".
      if (/\([a-z]{3}\)\s*$/.test(n)) return true;
      return false;
    };

    return { isAirport, NAMED: NAMED.slice(), TOKENS: TOKENS.slice() };
  })();

  try { (typeof globalThis !== 'undefined' ? globalThis : this).airportDetect = airportDetect; } catch (e) {}
