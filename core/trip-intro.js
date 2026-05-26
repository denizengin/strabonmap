// core/trip-intro.js — E-trip-intro.
//
// Pure helpers for the optional per-trip intro screen.
//
//   trip.intro = {
//     title:    string,   // e.g. "Hadrian's Inspection"
//     dateline: string,   // e.g. "AD 122" — Arabic numerals only
//     body:     string    // 1–3 paragraphs of plaintext
//   }
//
// All three fields are optional. If the entire intro is missing or every
// field is empty after trim, the trip has NO intro and the viewer must
// skip the intro card. This module is pure (no DOM, no DOM-side state)
// so the unit tests can prove the contract without a browser.
//
// Loaded as a classic script before dist/strabon-map.js; publishes
// hasIntro + sanitizeIntro as top-level `const` bindings into the
// classic-script Script Record. The boot bundle reads them by bare name
// (NOT via globalThis — see CRITICAL LESSON in the session handoff).

  // Coerce any one field to a trimmed string; non-strings become ''.
  const _introStr = (v) => (typeof v === 'string' ? v.trim() : '');

  // True iff `trip.intro` exists AND at least one of its three fields
  // has non-whitespace content.
  const hasIntro = (trip) => {
    if (!trip || !trip.intro || typeof trip.intro !== 'object') return false;
    const t = _introStr(trip.intro.title);
    const d = _introStr(trip.intro.dateline);
    const b = _introStr(trip.intro.body);
    return !!(t || d || b);
  };

  // Returns a clean { title, dateline, body } trio with all fields
  // trimmed to strings. Always returns an object — never null — so the
  // viewer's textContent assignments never crash on `.title` etc. Pass
  // `hasIntro()` first to decide whether to show the card at all.
  const sanitizeIntro = (trip) => {
    const src = (trip && trip.intro && typeof trip.intro === 'object')
      ? trip.intro : {};
    return {
      title:    _introStr(src.title),
      dateline: _introStr(src.dateline),
      body:     _introStr(src.body),
    };
  };
