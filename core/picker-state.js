// core/picker-state.js — E69 / E70. Pure state-machine for the era + theme
// pickers. No DOM, no window, no localStorage — those wire-ups live in
// index.html / mobile.html. This file is the testable kernel underneath them.
//
// Concepts:
//   - Era and Theme are independent axes; theme is gated by current era.
//   - Selecting an incompatible era auto-swaps theme to that era's default.
//   - Selecting a theme that's not valid for the current era is a no-op.
//   - Boot-time state is reconstructed from two stored values; missing or
//     mismatched values are repaired without throwing.
//
// Depends on core/eras.js: ERAS, eraByKey, themeByKey, themesForEra,
// DEFAULT_THEME_OF_ERA, LEGACY_ERA_KEY.

  /* Internal: is themeKey a valid theme for eraKey?
   * Uses availableThemesForEra() so universal themes (parchment,
   * meadow) count as valid on every era — council verdict
   * 16 May 2026. Falls back to themesForEra if the new helper isn't
   * available (older loader contexts). */
  const _isThemeValidForEra = (eraKey, themeKey) => {
    const themes = (typeof availableThemesForEra === 'function')
      ? availableThemesForEra(eraKey)
      : themesForEra(eraKey);
    return themes.some((t) => t.key === themeKey);
  };

  /* Internal: which era owns a given theme key? null if not found. */
  const _eraOfTheme = (themeKey) => {
    const hit = themeByKey(themeKey);
    return hit ? hit.era.key : null;
  };

  /* selectEra(state, eraKey)
   * Returns { era, theme }. If eraKey is unknown, returns the input
   * state unchanged. If the current theme is valid for the new era,
   * keeps it; otherwise auto-swaps to that era's default theme. */
  const selectEra = (state, eraKey) => {
    if (!eraByKey(eraKey)) return { era: state.era, theme: state.theme };
    const themeStaysValid = _isThemeValidForEra(eraKey, state.theme);
    return {
      era: eraKey,
      theme: themeStaysValid ? state.theme : DEFAULT_THEME_OF_ERA(eraKey),
    };
  };

  /* selectTheme(state, themeKey)
   * Returns { era, theme }. No-op if themeKey is unknown OR not valid
   * for the current era. */
  const selectTheme = (state, themeKey) => {
    if (!_isThemeValidForEra(state.era, themeKey)) {
      return { era: state.era, theme: state.theme };
    }
    return { era: state.era, theme: themeKey };
  };

  /* migrateTrip(trip)
   * In-place migration. Adds .era + .theme if missing. Infers era from
   * theme when only theme is set (e.g. legacy 'parchment' / 'meadow' /
   * 'hc' → nineteen-thirties). Repairs missing theme using era default. */
  const migrateTrip = (trip) => {
    if (!trip.era && trip.theme) {
      trip.era = _eraOfTheme(trip.theme) || LEGACY_ERA_KEY;
    }
    if (!trip.era) trip.era = LEGACY_ERA_KEY;
    if (!trip.theme) trip.theme = DEFAULT_THEME_OF_ERA(trip.era);
    // E-per-trip-bbox — normalise SHAPE only. Council backward-compat
    // says: missing bbox stays missing on disk; the renderer derives
    // one from stops at load time and caches in memory. We just make
    // sure the fields exist with null defaults so callers can always
    // read trip.bbox / trip.bboxPresetId without an undefined check.
    if (!('bbox' in trip)) trip.bbox = null;
    if (!('bboxPresetId' in trip)) trip.bboxPresetId = null;
    // E-era-ranges-v2 (17 May 2026) — optional per-trip year override.
    // Lets a chronicle pin to a specific moment inside its era
    // (Constantinople 1453 vs 1025 inside byzantium, etc.). null
    // means "use the era's midpoint". Readers handle the fallback.
    if (!('year' in trip)) trip.year = null;
    return trip;
  };

  /* resolveBootState({storedEra, storedTheme})
   * Build a sane { era, theme } from raw localStorage values. Repairs
   * unknown era → LEGACY_ERA_KEY; unknown theme → era default; valid
   * theme that doesn't belong to stored era → era default. */
  const resolveBootState = ({ storedEra, storedTheme }) => {
    let era = (storedEra && eraByKey(storedEra)) ? storedEra : null;
    if (!era && storedTheme) era = _eraOfTheme(storedTheme);
    if (!era) era = LEGACY_ERA_KEY;
    let theme = (storedTheme && _isThemeValidForEra(era, storedTheme))
      ? storedTheme
      : DEFAULT_THEME_OF_ERA(era);
    return { era, theme };
  };
