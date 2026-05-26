// core/people.js — co-traveler name formatting (E4). Turns a list of companion
// names into the artifact's credit-line register. Shared by index.html +
// mobile.html. No DOM, no globals — every function here is pure. Loaded as
// plain globals.
//
// Names are plain trimmed strings (sanitized at the storage boundary by
// sanitizeCompanions in the app). These helpers only format; they assume the
// list is already clean but still tolerate stray empties / non-strings.

// --- normalize: drop non-strings and blanks, keep order. A defensive pass so
// formatting never emits "undefined" or a stray comma. ---
  const cleanNames = (list) => {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const n of list) {
      if (typeof n !== 'string') continue;
      const t = n.trim();
      if (t) out.push(t);
    }
    return out;
  };

// --- join names the way a credit line reads:
//   []                -> ""
//   [a]               -> "a"
//   [a, b]            -> "a & b"
//   [a, b, c]         -> "a, b & c"
// Oxford-free, ampersand before the last — matches the design screens. ---
  const joinNames = (list) => {
    const names = cleanNames(list);
    if (names.length === 0) return '';
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + ' & ' + names[1];
    return names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1];
  };

// --- the FIN / title-plate credit line: an em-dash lead-in, e.g.
//   "— Deniz, Mira & Yannis". Empty string for no companions so callers can
// omit the line entirely. ---
  const formatCreditLine = (list) => {
    const joined = joinNames(list);
    return joined ? '— ' + joined : '';
  };

// --- a compact "with X" tag for a per-city presence list, e.g.
//   "with Mira & Yannis". Empty string for none. ---
  const formatPresentTag = (list) => {
    const joined = joinNames(list);
    return joined ? 'with ' + joined : '';
  };

// --- E27 information cascade: who was present at this stop?
// Rule: if the stop has its own present list, use that (the user said
// who was actually there). Otherwise, fall back to the trip-level
// companions (the trip was "of" them, so by default they were on every
// stop). Returns { names, source } where source is 'stop' or 'trip'
// — callers can use the source to render inherited values differently
// from explicit ones (e.g. faded chips).
  const effectivePresent = (stop, trip) => {
    const own = cleanNames(stop && stop.present);
    if (own.length > 0) return { names: own, source: 'stop' };
    const trip_ = cleanNames(trip && trip.companions);
    if (trip_.length > 0) return { names: trip_, source: 'trip' };
    return { names: [], source: null };
  };
