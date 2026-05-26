// core/serializer.js — safe JSON embedding, privacy manifest, and the
// standalone-HTML wrapper used by E30 (Souvenir Cut). E35 ships these
// primitives as a pure module so the safety gate is in place BEFORE any
// export-flow UI lands. Shared by index.html + mobile.html. No DOM, no
// globals — every function here is pure. Loaded as plain browser globals;
// the test loader scrapes the top-level consts.
//
// Why this module exists
// ----------------------
// A portable my-trip.html souvenir (E30) is the first surface where private
// trip data leaves the maker's browser as a file. A hostile trip name or
// note containing </script> can break the export or, worse, be injected
// back into the page when the souvenir opens. This module is the gate.

// --- 1. safeJsonEmbed: JSON.stringify, then sanitize the four sequences
// that break <script>-embedded JSON. The recovered value is byte-for-byte
// equal to the original (we encode the dangerous chars as \uXXXX escapes
// inside JSON string literals — JSON.parse decodes them back).
  const safeJsonEmbed = (obj) => {
    const json = JSON.stringify(obj);
    // Replace four specific sequences. Order matters: do </script> first so
    // it doesn't get partially-escaped by the <! rule. Each substitution
    // emits a JSON-string-valid \uXXXX escape, so JSON.parse round-trips.
    return json
      // </script> in any case — match closing tag specifically
      .replace(/<\/(script)/gi, '\\u003c/$1')
      // <!-- and --> are HTML comment delimiters that can confuse the parser
      .replace(/<!--/g, '\\u003c!--')
      .replace(/-->/g, '--\\u003e')
      // U+2028 LINE SEPARATOR + U+2029 PARAGRAPH SEPARATOR are valid in JSON
      // strings but JS treats them as line terminators, so a <script>-embedded
      // JSON literal containing one is a syntax error.
      .replace(new RegExp('\u2028', 'g'), '\\u2028')
      .replace(new RegExp('\u2029', 'g'), '\\u2029');
  };

// --- 2. buildPrivacyManifest: describe what a given export tier carries.
// Tier "full" includes everything. Tier "public" strips notes and exact
// coordinates (the photo + the trip title + the dates + the companion
// names still travel — the rest doesn't).
  const buildPrivacyManifest = (trip, tier) => {
    const cities = (trip && trip.cities) || [];
    const companions = (trip && trip.companions) || [];
    const photoCount = cities.reduce(
      (n, c) => n + ((c && c.photos && c.photos.length) || 0), 0);
    const noteCount = cities.reduce(
      (n, c) => n + (c && typeof c.note === 'string' && c.note.trim() ? 1 : 0), 0);
    const dateCount = cities.reduce(
      (n, c) => n + (c && (c.arrive || c.depart) ? 1 : 0), 0);
    const items = [];
    if (photoCount > 0)         items.push({ label: 'Photographs', count: photoCount });
    if (tier !== 'public' && noteCount > 0)
                                items.push({ label: 'Journal notes', count: noteCount });
    if (dateCount > 0)          items.push({ label: 'Travel dates', count: dateCount });
    if (companions.length > 0)  items.push({ label: 'Companions', count: companions.length });
    if (cities.length > 0 && tier !== 'public')
                                items.push({ label: 'Coordinates', count: cities.length });
    // Even on public tier, the *fact* that there are stops is visible — the
    // map renders them — but the exact lat/lon doesn't ship. So a separate
    // (rounded) "Approximate locations" row for public tier:
    if (cities.length > 0 && tier === 'public')
                                items.push({ label: 'Approximate locations', count: cities.length });
    return { items, tier };
  };

// --- 3. wrapStandaloneHtml: build a complete <!doctype html>...</html>
// document with a strict CSP, a self-contained <style>, the body fragment,
// and the data payload embedded safely. No fetch(), no localStorage, no
// IDB, no third-party script tags.
  const escapeHtmlSafe = (s) => String(s == null ? '' : s).replace(
    /[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));

  const wrapStandaloneHtml = (opts) => {
    const title = escapeHtmlSafe((opts && opts.title) || 'A chronicle');
    const bodyHtml = (opts && opts.bodyHtml) || '';
    const dataPayload = (opts && opts.dataPayload) || {};
    const inlineCss = (opts && opts.inlineCss) || '';
    const embedded = safeJsonEmbed(dataPayload);
    // Strict CSP:
    //   default-src 'none'   — nothing loads by default
    //   img-src data:        — only inline data: images (photos travel as base64)
    //   style-src 'unsafe-inline' — our inline <style> block
    //   script-src 'unsafe-inline' — our inline <script> data island
    // No 'self', no http(s):* — the file is fully air-gapped from the network.
    return '<!doctype html>\n' +
      '<html lang="en">\n' +
      '<head>\n' +
      '<meta charset="utf-8">\n' +
      '<meta http-equiv="Content-Security-Policy" content="' +
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'" +
        '">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + title + '</title>\n' +
      '<style>' + inlineCss + '</style>\n' +
      '</head>\n' +
      '<body>\n' +
      bodyHtml + '\n' +
      '<script id="trip-data" type="application/json">' + embedded + '</script>\n' +
      '</body>\n' +
      '</html>\n';
  };

// --- 4. renderManifest: a tiny "this file contains…" HTML block the export
// modal can show before the user commits. Pure string. Escapes every label
// for defence in depth (callers should pass clean labels but we don't
// trust that).
  const renderManifest = (manifest) => {
    const items = (manifest && manifest.items) || [];
    if (!items.length) {
      return '<div class="manifest empty">This file is empty.</div>';
    }
    const rows = items.map(it =>
      '<li class="manifest-row">' +
        '<span class="manifest-label">' + escapeHtmlSafe(it.label) + '</span>' +
        '<span class="manifest-count">' + (it.count | 0) + '</span>' +
      '</li>'
    ).join('');
    return '<ul class="manifest">' + rows + '</ul>';
  };
