// core/era-places.js — E78 / E79. Curated dataset of place-ids mapped to
// per-era aliases, lat/lon, kind, and activeFrom/activeTo year bounds.
//
// #135 (23 May 2026) — the 492-entry DATA array was extracted to
// data/era-places.data.json (the source of truth; this file was 10,564 lines).
// This module is now the loader + the alias helpers. ERA_PLACES is declared
// empty and populated IN PLACE once the JSON resolves, so every existing
// bare-name reference sees the same array object fill in. All readers already
// go through late-arrival-tolerant getters (getEraPlaces / acSearch re-reads
// per keystroke), so the async fill is safe. window.whenEraPlacesReady is a
// promise callers can await (boot's ensureEraPlaces does).
//
// Schema (per data/era-places.data.json entry):
//   { id, kind, lat, lon, activeFrom, activeTo,
//     aliases: { <eraKey>: string|null, ... modern: string } }
//
// Era keys: bronze-age, classical, late-antiquity, dark-ages, byzantium,
// high-medieval, atlas, industrial, nineteen-thirties, modern. See core/eras.js.
//
// Loads as a script-tag global (no module wrapper).

  // ERA_PLACES — populated in place from data/era-places.data.json.
  const ERA_PLACES = [];
  window.ERA_PLACES = ERA_PLACES;  // explicit: this file's whole job is to publish it
  // Resolve the data URL relative to THIS script so it works under any deploy
  // subpath (root /, GitHub project page /repo/, sandbox /staging/).
  const _eraPlacesDataUrl = (() => {
    try {
      const cur = document.currentScript && document.currentScript.src;
      if (cur) return new URL('../data/era-places.data.json', cur).href;
    } catch {}
    return 'data/era-places.data.json';
  })();
  window.whenEraPlacesReady = fetch(_eraPlacesDataUrl)
    .then((r) => (r.ok ? r.json() : []))
    .then((arr) => {
      if (Array.isArray(arr) && arr.length) {
        // Fill IN PLACE so existing references to ERA_PLACES see the data.
        for (const e of arr) ERA_PLACES.push(e);
      }
      return ERA_PLACES;
    })
    .catch(() => ERA_PLACES); // offline / missing → empty; editor still works, no curated aliases

  // eraYear(eraKey) — representative year for an era, used to test whether a
  // place was "active" in a given chronicle. Parses the year string from
  // core/eras.js (e.g. "1200 BCE" → -1200, "125 CE" → 125, "2024" → 2024).
  const eraYear = (eraKey) => {
    if (typeof eraByKey !== 'function') return null;
    const era = eraByKey(eraKey);
    if (!era) return null;
    const s = String(era.year || '').trim();
    const m = s.match(/(-?\d+)/);
    if (!m) return null;
    let y = parseInt(m[1], 10);
    if (/BCE/i.test(s)) y = -Math.abs(y);
    return y;
  };

  // E84 / E-alias-schema-v2 (18 May 2026) — settle the alias record
  // shape. Two legal forms:
  //   1. Bare string: "Constantinople" — shorthand for "active throughout
  //      the era's year window" (the v0 form, retained for ergonomics).
  //   2. Object: { name: "Constantinople", activeFrom?: int, activeTo?: int }
  //      — explicit year window inside the era. Signed ints; negative = BCE.
  //      Either bound may be omitted to mean "unbounded on that side".
  // normaliseAlias hides the difference at the reader boundary.
  //
  // @typedef {Object} AliasRecord
  // @property {string} name - display name
  // @property {number|null} activeFrom - start year (inclusive); null = -∞
  // @property {number|null} activeTo - end year (exclusive); null = +∞
  const normaliseAlias = (raw) => {
    if (raw == null) return null;
    if (typeof raw === 'string') {
      return raw.length > 0 ? { name: raw, activeFrom: null, activeTo: null } : null;
    }
    if (typeof raw === 'object' && typeof raw.name === 'string' && raw.name.length > 0) {
      return {
        name: raw.name,
        activeFrom: (typeof raw.activeFrom === 'number') ? raw.activeFrom : null,
        activeTo:   (typeof raw.activeTo === 'number')   ? raw.activeTo   : null,
      };
    }
    return null;
  };

  // aliasForEra(placeId, eraKey) — resolves the era-appropriate display name.
  //   1. Direct match on placeId in ERA_PLACES.
  //   2. If aliases[eraKey] is set (string or object), return its name via normaliseAlias.
  //   3. Otherwise fall back to aliases.modern (the "didn't exist / unknown" case).
  //   4. Returns null if the placeId is unknown.
  const aliasForEra = (placeId, eraKey) => {
    const place = ERA_PLACES.find((p) => p.id === placeId);
    if (!place) return null;
    const a = normaliseAlias(place.aliases && place.aliases[eraKey]);
    if (a) return a.name;
    const fallback = normaliseAlias(place.aliases && place.aliases.modern);
    return fallback ? fallback.name : null;
  };

  // aliasForEraYear(placeId, eraKey, year) — year-aware alias lookup.
  // E85a hook (E-trip-year-aliases). If the era's alias entry is the
  // legacy bare string OR object with no year bounds, behaves exactly
  // like aliasForEra. When bounds are present, returns the alias only
  // if `year` falls inside [activeFrom, activeTo); otherwise falls
  // through to aliases.modern (matching the "didn't exist" semantics).
  // When `year` is null/undefined, treats as legacy lookup.
  const aliasForEraYear = (placeId, eraKey, year) => {
    if (year == null) return aliasForEra(placeId, eraKey);
    const place = ERA_PLACES.find((p) => p.id === placeId);
    if (!place) return null;
    const a = normaliseAlias(place.aliases && place.aliases[eraKey]);
    if (a) {
      const fromOk = (a.activeFrom == null) || (year >= a.activeFrom);
      const toOk   = (a.activeTo   == null) || (year <  a.activeTo);
      if (fromOk && toOk) return a.name;
    }
    const fallback = normaliseAlias(place.aliases && place.aliases.modern);
    return fallback ? fallback.name : null;
  };
