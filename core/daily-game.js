// core/daily-game.js — "Place & Period" daily game logic (GAME_DESIGN_COUNCIL).
// Pure, deterministic-by-date, no DOM, no network, no globals beyond the
// bare names below (classic-script pattern, same as the other core/*.js).
//
// The daily picks ONE mystery place (shown by its period name) from the
// era-place dataset; the player pins it on the map (distance + 8-way
// bearing scored, Worldle-style) and places it on the 10-era timeline.
// Everything here is the deterministic engine — UI lives in boot.js.
//
// Slice 1 (this file): seeded pick + haversine + bearing + scoring +
// share-grid emoji. Unit-tested in tests/unit/daily-game.spec.js.

  // 10-era timeline order (storage keys) — the chronology axis.
  const DAILY_ERAS = [
    'bronze-age', 'classical', 'late-antiquity', 'dark-ages', 'byzantium',
    'high-medieval', 'atlas', 'industrial', 'nineteen-thirties', 'modern',
  ];

  // Day number since a fixed epoch (UTC) — the puzzle seed. Same integer
  // on every device for a given calendar day, so the puzzle is identical
  // with zero network. Epoch: 2026-01-01.
  const DAILY_EPOCH_MS = Date.UTC(2026, 0, 1);
  const dailyDayNumber = (date) => {
    const d = (date instanceof Date) ? date : new Date(date || Date.now());
    const utcMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return Math.floor((utcMidnight - DAILY_EPOCH_MS) / 86400000);
  };

  // mulberry32 — tiny deterministic PRNG seeded by the day number.
  const mulberry32 = (seed) => {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // Deterministically pick the day's mystery place from a candidate list.
  // Candidates are era-place entries: { id, lat, lon, aliases:{<era>:name}, activeFrom, activeTo }.
  // Returns { place, era, name } — era is the era whose alias is shown
  // (a non-null, non-modern alias preferred so the period name is evocative).
  const pickDailyPlace = (places, dayNum) => {
    if (!Array.isArray(places) || !places.length) return null;
    const rand = mulberry32((dayNum * 2654435761) >>> 0);
    // Only places that HAVE at least one non-null era alias are eligible.
    const eligible = places.filter((p) => p && p.aliases &&
      DAILY_ERAS.some((e) => typeof p.aliases[e] === 'string' && p.aliases[e]));
    if (!eligible.length) return null;
    const place = eligible[Math.floor(rand() * eligible.length)];
    // Choose the era to quiz: prefer a non-modern era with a distinctive alias.
    const eras = DAILY_ERAS.filter((e) => typeof place.aliases[e] === 'string' && place.aliases[e]);
    const preferred = eras.filter((e) => e !== 'modern');
    const pool = preferred.length ? preferred : eras;
    const era = pool[Math.floor(rand() * pool.length)];
    return { place, era, name: place.aliases[era] };
  };

  // Haversine great-circle distance in km between two {lat,lon}.
  const haversineKm = (a, b) => {
    const R = 6371;
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
    const la1 = toRad(a.lat), la2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };

  // Initial bearing in degrees (0=N, 90=E) from guess→answer.
  const bearingDeg = (from, to) => {
    const toRad = (d) => d * Math.PI / 180;
    const y = Math.sin(toRad(to.lon - from.lon)) * Math.cos(toRad(to.lat));
    const x = Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
              Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(to.lon - from.lon));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  };

  // Snap a bearing to one of 8 compass arrows (points guess→answer).
  const ARROWS = ['⬆️', '↗️', '➡️', '↘️', '⬇️', '↙️', '⬅️', '↖️'];
  const bearingArrow = (deg) => ARROWS[Math.round(((deg % 360) / 45)) % 8];

  // Proximity 0..1 (1 = bullseye). Halves roughly every ~2000km — tuned so
  // a continent-away guess still reads as "warm-ish" and a same-region
  // guess reads "hot". Used for the proximity bar + the win threshold.
  const proximity = (km) => Math.max(0, 1 - Math.min(1, km / 20000)) ** 1.6;

  // A guess is correct if within WIN_KM of the answer.
  const WIN_KM = 60;
  const isWin = (km) => km <= WIN_KM;

  // Build a Wordle-style emoji result grid from the per-guess distances
  // (km) — 🟩 win, 🟨 close (<500km), 🟧 warm (<2000km), ⬛ far. Plus the
  // era guess row (🟩 right era / 🟨 adjacent / ⬛ off).
  const shareGrid = (guessKms, eraResult) => {
    const dist = guessKms.map((km) => isWin(km) ? '🟩' : km < 500 ? '🟨' : km < 2000 ? '🟧' : '⬛').join('');
    const eraRow = eraResult === 'exact' ? '🟩' : eraResult === 'adjacent' ? '🟨' : '⬛';
    return { dist, eraRow };
  };

  // Era-axis result vs the answer era (exact / adjacent on the timeline / off).
  const eraGuessResult = (guessEra, answerEra) => {
    const gi = DAILY_ERAS.indexOf(guessEra), ai = DAILY_ERAS.indexOf(answerEra);
    if (gi < 0 || ai < 0) return 'off';
    if (gi === ai) return 'exact';
    if (Math.abs(gi - ai) === 1) return 'adjacent';
    return 'off';
  };

  const DailyGame = {
    ERAS: DAILY_ERAS,
    dayNumber: dailyDayNumber,
    mulberry32,
    pickDailyPlace,
    haversineKm,
    bearingDeg,
    bearingArrow,
    proximity,
    isWin,
    WIN_KM,
    shareGrid,
    eraGuessResult,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = { DailyGame };
