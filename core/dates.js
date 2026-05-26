// core/dates.js — trip date math: night counts, durations, and the title-plate
// date range. Shared by index.html + mobile.html. No DOM, no globals — every
// function here is pure. Loaded as plain globals.
//
// City dates are optional ISO date strings ("2024-05-12") or null. All helpers
// tolerate null / partial / malformed input and degrade quietly — a trip with
// no dates must behave exactly as before E3.

// --- parse an ISO "YYYY-MM-DD" to a UTC-midnight timestamp, or null. We parse
// by hand (not new Date(str)) so the result is timezone-independent: a date is
// a calendar day, not an instant. ---
  const parseISODate = (s) => {
    if (typeof s !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const t = Date.UTC(y, mo - 1, d);
    const back = new Date(t);
    // reject impossible dates that Date rolled over (e.g. 2024-02-31)
    if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
    return t;
  };

  const MS_PER_DAY = 86400000;

// --- whole nights between two ISO dates. null if either is missing/invalid or
// depart is before arrive (a soft-invalid range contributes no duration). ---
  const nightsBetween = (arrive, depart) => {
    const a = parseISODate(arrive), d = parseISODate(depart);
    if (a == null || d == null) return null;
    const n = Math.round((d - a) / MS_PER_DAY);
    return n >= 0 ? n : null;
  };

// --- "3 nights" / "1 night" / "" (for null or 0 — a same-day stop has no
// overnight to show). ---
  const formatNights = (n) => {
    if (typeof n !== 'number' || n <= 0) return '';
    return n === 1 ? '1 night' : n + ' nights';
  };

// --- the trip's overall span: earliest arrive, latest depart, across all
// cities. Partial dates still count (a city with only `arrive` extends the
// start). Returns { start, end } as ISO strings, or null if no dates at all. ---
  const tripDateRange = (cities) => {
    if (!Array.isArray(cities)) return null;
    let min = Infinity, max = -Infinity, minS = null, maxS = null;
    for (const c of cities) {
      if (!c) continue;
      for (const key of ['arrive', 'depart']) {
        const t = parseISODate(c[key]);
        if (t == null) continue;
        if (t < min) { min = t; minS = c[key]; }
        if (t > max) { max = t; maxS = c[key]; }
      }
    }
    return minS == null ? null : { start: minS, end: maxS };
  };

  const MONTHS_UC = [
    'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
    'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
  ];

// --- the title-plate string from a { start, end } range, in the artifact's
// register: month names + Arabic year. Examples:
//   same month/year   -> "MAY · 2024"
//   spans months      -> "MAY — JUNE · 2024"
//   spans years       -> "DECEMBER 2023 — JANUARY 2024"
// Returns "" for a null/empty range so callers can fall back to the static
// subtitle. ---
// --- E24: a per-stop "stay line" for reading surfaces (album, mobile card,
// StopSheet). Reading register is IM Fell — Sentence-cased months, not the
// caps/Roman of the title plate. Examples:
//   same month       -> "12–17 May 2024 · 5 nights"
//   spans months     -> "28 May – 3 June 2024 · 6 nights"
//   spans years      -> "30 Dec 2023 – 4 Jan 2024 · 5 nights"
//   same day         -> "12 May 2024"  (no nights)
//   one date only    -> "Arrived 12 May 2024"  /  "Departed 17 May 2024"
//   neither set      -> ""
// Year is shown unconditionally — souvenir surfaces are read out of context.
  const MONTHS_S = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const MONTHS_SHORT = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const formatStayLine = (arrive, depart) => {
    const a = parseISODate(arrive), d = parseISODate(depart);
    if (a == null && d == null) return '';
    if (a != null && d == null) {
      const ad = new Date(a);
      return 'Arrived ' + ad.getUTCDate() + ' ' +
        MONTHS_S[ad.getUTCMonth()] + ' ' + ad.getUTCFullYear();
    }
    if (a == null && d != null) {
      const dd = new Date(d);
      return 'Departed ' + dd.getUTCDate() + ' ' +
        MONTHS_S[dd.getUTCMonth()] + ' ' + dd.getUTCFullYear();
    }
    // both dates present
    const ad = new Date(a), dd = new Date(d);
    const aDay = ad.getUTCDate(), aMo = ad.getUTCMonth(), aY = ad.getUTCFullYear();
    const dDay = dd.getUTCDate(), dMo = dd.getUTCMonth(), dY = dd.getUTCFullYear();
    const nights = nightsBetween(arrive, depart);
    const nightsTail = nights && nights > 0 ? ' · ' + formatNights(nights) : '';
    if (aY === dY && aMo === dMo && aDay === dDay) {
      // same calendar day — no nights, just the date
      return aDay + ' ' + MONTHS_S[aMo] + ' ' + aY;
    }
    if (aY === dY && aMo === dMo) {
      // same month + year — "12–17 May 2024 · 5 nights"
      return aDay + '–' + dDay + ' ' + MONTHS_S[aMo] + ' ' + aY + nightsTail;
    }
    if (aY === dY) {
      // spans months, same year — "28 May – 3 June 2024 · 6 nights"
      return aDay + ' ' + MONTHS_SHORT[aMo] + ' – ' +
             dDay + ' ' + MONTHS_SHORT[dMo] + ' ' + aY + nightsTail;
    }
    // spans years — "30 Dec 2023 – 4 Jan 2024 · 5 nights"
    return aDay + ' ' + MONTHS_SHORT[aMo] + ' ' + aY + ' – ' +
           dDay + ' ' + MONTHS_SHORT[dMo] + ' ' + dY + nightsTail;
  };

  const formatRangePlate = (range) => {
    if (!range) return '';
    const s = parseISODate(range.start);
    const e = parseISODate(range.end != null ? range.end : range.start);
    if (s == null) return '';
    const sd = new Date(s), ed = new Date(e == null ? s : e);
    const sMo = sd.getUTCMonth(), sY = sd.getUTCFullYear();
    const eMo = ed.getUTCMonth(), eY = ed.getUTCFullYear();
    if (sY !== eY) {
      return MONTHS_UC[sMo] + ' ' + sY + ' — ' +
             MONTHS_UC[eMo] + ' ' + eY;
    }
    if (sMo !== eMo) {
      return MONTHS_UC[sMo] + ' — ' + MONTHS_UC[eMo] + ' · ' + sY;
    }
    return MONTHS_UC[sMo] + ' · ' + sY;
  };
