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

  // Clamp an intro body to a display budget WITHOUT cutting mid-word (the
  // opening cover's char-slice used to strand fragments like "…IV.44. Th…",
  // which reads as a truncation error mid-sentence). Prefer to end on a
  // completed SENTENCE when one closes past ~60% of the budget — a natural
  // full stop reads as finished, not clipped; otherwise fall back to the last
  // whole WORD and a proper ellipsis. Short-enough bodies pass through
  // untouched (byte-identical to before), so only over-budget intros change.
  const clampIntroBody = (body, max) => {
    const s = _introStr(body);
    const budget = (typeof max === 'number' && max > 0) ? max : 220;
    if (s.length <= budget) return s;
    // Never split a word: back up to the last space within the budget.
    let cut = s.slice(0, budget);
    const sp = cut.lastIndexOf(' ');
    if (sp > 0) cut = cut.slice(0, sp);
    // If a sentence closes late enough in the kept text, end there — no ellipsis
    // needed, the passage reads as a complete thought. `.!?` optionally followed
    // by a closing quote/bracket, at or past 60% of the budget.
    const sentence = /[.!?]["'”’)\]]?(?=\s|$)/g;
    let lastEnd = -1, m;
    while ((m = sentence.exec(cut)) !== null) lastEnd = m.index + m[0].length;
    if (lastEnd >= budget * 0.6) return cut.slice(0, lastEnd).trim();
    return cut.replace(/[\s.,;:—-]+$/, '') + '…';
  };
