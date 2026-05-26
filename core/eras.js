// core/eras.js — E70 / E69. Single source of truth for the era +
// theme taxonomy. Each chronicle has a trip.era field; each era owns
// a list of themes (palette + font + route + transport + flourish +
// paper-texture-class), one of which is the user's current visual
// pick.
//
// Era = WHEN the chronicle is set (historical period).
// Theme = HOW it renders (colour variant within the era).
//
// Modern is the default era for NEW trips. Existing pre-rename trips
// migrate to Adventure (which is the 1936 pulp-adventure register
// the artifact previously shipped as its only register).
//
// HC is implemented as a sibling theme inside each era's themes list
// (so Adventure's HC stays where E46 put it; each new era picks its
// own HC variant when designs land).
//
// #136 split: the big pure-data tables moved out so this file stays
// under the LOC ceiling. The ERAS array is split across two sibling
// data files (which MUST load first, in this order):
//   core/eras-data.js    → ERAS_PART_A (eras 1-5)
//   core/eras-data-2.js  → ERAS_PART_B (eras 6-10) + ERA_DISPLAY_NAMES,
//                          DEFAULT_ERA_KEY, LEGACY_ERA_KEY, ERA_MODE,
//                          UNIVERSAL_THEME_KEYS
// This file stitches the published ERAS global from the two halves and
// keeps ALL the lookup/helper FUNCTIONS. Published global NAMES consumed
// by boot.js (ERAS, eraByKey, themeByKey, …) are byte-identical to before.
//
// Tokens are transcribed from per-era-designs/project/era-sheets-data.jsx
// — see that file for the rendered design reference.

  /* Published era list — stitched from the two data halves
   * (ERAS_PART_A + ERAS_PART_B, declared in core/eras-data*.js, which
   * load first). Order is 1..10 (Anatolia → Modern), unchanged. */
  const ERAS = ERAS_PART_A.concat(ERAS_PART_B);

  const DEFAULT_THEME_OF_ERA = (eraKey) => {
    const e = ERAS.find((x) => x.key === eraKey);
    return (e && e.themes[0]) ? e.themes[0].key : 'parchment';
  };

  /* Lookup helpers. */
  const eraByKey = (k) => ERAS.find((e) => e.key === k) || null;
  const themeByKey = (k) => {
    for (const e of ERAS) {
      const t = e.themes.find((th) => th.key === k);
      if (t) return { era: e, theme: t };
    }
    return null;
  };
  const themesForEra = (eraKey) => {
    const e = eraByKey(eraKey);
    return e ? e.themes : [];
  };
  const allEraKeys = () => ERAS.map((e) => e.key);
  const allThemeKeys = () => {
    const out = [];
    for (const e of ERAS) for (const t of e.themes) out.push(t.key);
    return out;
  };

  const eraMode = (eraKey) => ERA_MODE[eraKey] || 'loose';
  const isEraStrict = (eraKey) => eraMode(eraKey) === 'strict';

  /* The picker's authoritative theme list per era: this era's own
   * themes, PLUS any universal themes not already in the era's list.
   * Returns the SAME theme objects as themeByKey() — no clones, no
   * synthetic entries. */
  const availableThemesForEra = (eraKey) => {
    const eraThemes = themesForEra(eraKey);
    const eraKeys = new Set(eraThemes.map((t) => t.key));
    const universal = UNIVERSAL_THEME_KEYS
      .filter((k) => !eraKeys.has(k))
      .map((k) => {
        const hit = themeByKey(k);
        return hit ? hit.theme : null;
      })
      .filter(Boolean);
    return [...eraThemes, ...universal];
  };

  /* Does this theme come from the universal pool (rather than the
   * current era's own themes)? Used by the picker to render a small
   * group divider. */
  const isUniversalTheme = (themeKey) => UNIVERSAL_THEME_KEYS.includes(themeKey);

  /* 17 May 2026 — era year-range helpers. Eras now carry yearStart /
   * yearEnd (signed; negative = BCE). Boundaries are contiguous:
   * each era starts where the previous ends. Helpers below answer
   * "what era covers year X?" and "is year X inside era Y's window?"
   * Used by inferVehicle() to year-gate biplane / train / etc., and
   * (future) by per-trip year overrides for tighter place-name aliases.
   */
  const eraRange = (eraKey) => {
    const e = eraByKey(eraKey);
    if (!e || typeof e.yearStart !== 'number' || typeof e.yearEnd !== 'number') return null;
    return { start: e.yearStart, end: e.yearEnd };
  };
  const eraCoversYear = (eraKey, year) => {
    const r = eraRange(eraKey);
    if (!r || typeof year !== 'number') return false;
    return year >= r.start && year < r.end;
  };
  const eraForYear = (year) => {
    if (typeof year !== 'number') return null;
    for (const e of ERAS) {
      if (typeof e.yearStart !== 'number' || typeof e.yearEnd !== 'number') continue;
      if (year >= e.yearStart && year < e.yearEnd) return e;
    }
    return null;
  };
  /* Era's midpoint year — what inferVehicle uses when the trip has no
   * explicit year of its own. Negative = BCE. */
  const eraMidYear = (eraKey) => {
    const r = eraRange(eraKey);
    if (!r) return null;
    return Math.round((r.start + r.end) / 2);
  };
