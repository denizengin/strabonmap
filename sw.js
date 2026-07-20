// sw.js — Service Worker for Strabon Map PWA (E52). Cache-first strategy
// over the static runtime set so a second visit works fully offline.
// Updates land on the NEXT online visit: a new SW activates, the old
// cache is cleared by the keys check below, the user sees fresh content.
//
// CACHE_VERSION is content-derived. The pre-commit hook
// (tools/git-hooks/pre-commit → tools/bump-cache-version.sh) recomputes
// it as a sha256 of every runtime file's content whenever a runtime
// file is staged for commit, then re-stages sw.js so the bump lands
// in the same commit as the change that caused it. Run
// ./tools/install-hooks.sh once after cloning to wire it up.
//
// Manual edits are pointless — the hook will overwrite this constant
// on the next commit that touches a runtime file. If you need to
// force-invalidate caches (e.g. unrelated to a runtime change),
// add a no-op touch like a trailing newline to sw.js itself and commit.
const CACHE_VERSION = 'strabon-map-7ff5ca11e8';

// #97 tiered loading (PERF_OFFLINE_ADDONS_COUNCIL). Two buckets:
//   • CACHE_VERSION  — Tier-1 precache + content-versioned runtime assets.
//                      PURGED on every version bump (they change per deploy).
//   • ADDONS_CACHE   — Tier-2 on-demand downloads (the refined detail map, and
//                      future large datasets). A STABLE name (NOT content-
//                      hashed) that is WHITELISTED from the activate purge, so
//                      a deploy does NOT wipe detail the user already downloaded
//                      — they don't re-pay the megabytes on every release.
// Bump ADDONS_CACHE's suffix only if a Tier-2 asset's FORMAT changes
// incompatibly (rare); a content change to geo-refined keeps the same bucket
// and is re-fetched lazily by URL.
const ADDONS_CACHE = 'strabon-addons-v1';
// A request is a Tier-2 add-on if its path matches one of these. Keep in sync
// with the geo-upgrade loader + future lazy datasets (era-places-full, etc.).
const isAddonRequest = (url) => /\/(geo-refined|era-places-full|city-dict-full)\b/.test(url.pathname)
  || /\/data\/regions\//.test(url.pathname)
  || /\.mp3$/i.test(url.pathname)   // #99 — background music: on-demand Tier-2 add-on
  // #111 P1 — per-trip sample-chronicle JSON (data/sample-trips/<era>/<id>.json),
  // fetched on tap. Route to ADDONS_CACHE so a played chronicle survives deploys.
  // NOTE: the era-segment + filename shape EXCLUDES the top-level index.json
  // (data/sample-trips/index.json) — that stays Tier-1 precached in CACHE_VERSION.
  || /\/data\/sample-trips\/[^/]+\/[^/]+\.json$/.test(url.pathname);

// Every URL the page expects to load. Conservative — anything missing
// here will be a network fetch (fine in normal use; broken offline).
// Mirrors tools/build-publish.sh's runtime set + the two main HTML pages.
// E-pwa-paths (17 May 2026) — paths are now SCOPE-RELATIVE strings
// (no leading slash). Resolved to absolute URLs against the SW's
// own scope at install time, so the precache works under any
// deployment subpath (root /, GitHub project page /repo/, sandbox
// /staging/, anywhere). Was: leading-slash absolute paths, only
// worked at the domain root.
const RUNTIME_URLS = [
  './',
  'index.html',
  // MVP-10 succession: mobile.html is the promoted MVP app; mobile-mvp.html is its
  // byte-identical alias (transition bookmarks); mobile-classic.html is the legacy
  // escape hatch (kept precached this release). All join the offline contract.
  'mobile.html',
  'mobile-mvp.html',
  'mobile-classic.html',
  'manifest.webmanifest',
  'manifest-mobile.webmanifest',
  // core modules (alphabetical; updated 17 May 2026 to include era +
  // vehicle + picker modules shipped over E69-E80 + E81 migrations)
  'core/bbox-utils.js',
  'core/city-dict.js',
  'core/density-budget.js',
  'core/dates.js',
  'core/easing.js',
  'core/era-places.js',
  // #135 — era-places DATA extracted to JSON (era-places.js was 10,564 lines);
  // precache it so curated aliases work offline.
  'data/era-places.data.json',
  'core/eras-data.js',
  'core/eras-data-2.js',
  'core/eras.js',
  'core/exif.js',
  'core/geo-data.js',
  'core/heic-decode.js',
  // BUG #20 — Worker-isolated HEIC decode. Must be precached so offline HEIC
  // imports still work on the 2nd+ load (main thread does new Worker(core/...)
  // — no single-quotes in this comment; the build-publish.sh drift guard's
  // awk-extractor would treat them as a precached URL.
  'core/heic-decode-worker.js',
  // 15 Jul — owner field report (blank app offline): these eleven classic
  // scripts are loaded by the HTML pages but were MISSING here. Online they
  // load fine and get runtime-cached — but every deploy purges the old cache
  // bucket, so the first offline launch after a deploy had no copy and boot
  // died under the veil. The offline probe could not catch it because its
  // online warm-up runtime-cached them into the same bucket (blind spot now
  // fixed in tools/check-offline-precache.mjs).
  'core/land-router.js',
  'core/land-router-astar.js',
  'core/land-router-geo.js',
  'core/migrations.js',
  'core/people.js',
  'core/photo-cluster.js',
  'core/place-group.js',
  'core/photo-store.js',
  'core/picker-state.js',
  'core/projection.js',
  'core/romanize.js',
  'core/route-geometry.js',
  'core/sea-router.js',
  'core/sea-router-astar.js',
  'core/sea-router-geo.js',
  'core/serializer.js',
  'core/sfx.js',
  'core/theme.js',
  'core/trip-intro.js',
  'core/trip-modality.js',
  'core/trip-modality-geom.js',
  'core/vehicle-infer.js',
  'core/vehicle-inventory.js',
  'core/vehicle-inventory-data.js',
  // 28 May — Version + Force-refresh button wirers used by both HTML files.
  'core/version-refresh.js',
  'core/viewports.js',
  // E103 — esbuild bundles src/boot.js (+ future src/ slices) into
  // dist/strabon-map.js. The bundled file is what ships; src/ stays
  // out of the runtime set so we don't double-cache.
  'dist/strabon-map.js',
  // E108 — mobile entry bundled from src/mobile-boot.js (now the mobile-classic
  // page's bundle post-succession).
  'dist/strabon-map-mobile.js',
  // MVP-10 — the promoted mobile app's bundle (src/mobile-mvp-boot.js). This is
  // what mobile.html + mobile-mvp.html load; precache so the hero + own trips work
  // offline.
  'dist/strabon-map-mvp.js',
  // vendor
  'vendor/exifr/exifr.lite.umd.js',
  // E61 — libheif-bundle.js (1.4 MB) is intentionally NOT pre-cached on
  // install. Most users never import a HEIC and shouldn't pay the cost
  // on every offline install. The fetch handler below auto-caches OK
  // GETs, so the bundle lands in the cache the first time a HEIC is
  // imported and is offline-available from then on.
  // fonts — #84: subset WOFF2 (preferred, ~72/79KB) precached so offline
  // first-paint uses the small face; TTFs kept as the legacy-UA fallback.
  'fonts/im-fell-dw-pica/im-fell-dw-pica-regular.woff2',
  'fonts/im-fell-dw-pica/im-fell-dw-pica-italic.woff2',
  'fonts/IMFellDWPica-regular.ttf',
  'fonts/IMFellDWPica-italic.ttf',
  'fonts/SpecialElite-regular.woff2',
  'fonts/SpecialElite-regular.ttf',
  // E91 — self-hosted era fonts (Google Fonts mirror, latin + latin-ext).
  // Generated by tools/fetch-era-fonts.mjs; keep this list in sync if you
  // re-run that tool against a different family set.
  'fonts/era-fonts.css',
  // E-css-extract — desktop + mobile app stylesheets hoisted out of the inline
  // <style> blocks into external files (shrinks the HTML; precached for offline
  // parity with the old inline blocks).
  'assets/app.css',
  'assets/mobile.css',
  // MVP-10 — the promoted mobile app's stylesheets (mobile.css above is the
  // shared base; mobile-mvp.css is the MVP surface; mvp-fonts.css declares the
  // hero IM Fell + Special Elite faces). Precached so the MVP renders offline.
  'assets/mobile-mvp.css',
  'assets/mvp-fonts.css',
  'fonts/cardo/cardo-700-latin.woff2',
  'fonts/cardo/cardo-700-latin-ext.woff2',
  'fonts/caveat/caveat-700-latin.woff2',
  'fonts/caveat/caveat-700-latin-ext.woff2',
  'fonts/cinzel/cinzel-700-latin.woff2',
  'fonts/cinzel/cinzel-700-latin-ext.woff2',
  'fonts/cormorant-unicase/cormorant-unicase-700-latin.woff2',
  'fonts/cormorant-unicase/cormorant-unicase-700-latin-ext.woff2',
  'fonts/eb-garamond/eb-garamond-700-latin.woff2',
  'fonts/eb-garamond/eb-garamond-700-latin-ext.woff2',
  'fonts/gfs-didot/gfs-didot-400-latin.woff2',
  'fonts/im-fell-english/im-fell-english-400i-latin.woff2',
  'fonts/inter/inter-600-latin.woff2',
  'fonts/inter/inter-600-latin-ext.woff2',
  'fonts/old-standard-tt/old-standard-tt-400i-latin.woff2',
  'fonts/old-standard-tt/old-standard-tt-400i-latin-ext.woff2',
  'fonts/source-sans-3/source-sans-3-600-latin.woff2',
  'fonts/source-sans-3/source-sans-3-600-latin-ext.woff2',
  'fonts/source-sans-3/source-sans-3-700-latin.woff2',
  'fonts/source-sans-3/source-sans-3-700-latin-ext.woff2',
  'fonts/unifrakturcook/unifrakturcook-700-latin.woff2',
  // region packs
  'data/regions/cyprus.json',
  'data/regions/turkey.json',
  'data/regions/aegean.json',
  'data/regions/levant.json',
  'data/regions/adriatic.json',
  'data/regions/tyrrhenian.json',
  'data/regions/britain.json',
  // E86 — deferred city gazetteer (1566 entries hydrated on idle)
  'data/cities.full.json',
  // #111 — sample-chronicle MANIFEST (the 50-trip catalog index). Tiny; precache
  // it so the welcome catalog lists offline. The per-trip JSONs are NOT precached
  // (large) — fetched on tap + runtime-cached. (Trip JSONs aren't in
  // isAddonRequest yet — that's the P1 Tier-2 cache slice; for now they
  // runtime-cache into CACHE_VERSION via the fetch handler.)
  'data/sample-trips/index.json',
  // MVP-10 — the hero DEMO reel's trips. Unlike the sample-trips per-trip JSONs
  // (large, runtime-cached on tap), these 3 are small + drive the landing's
  // looping showcase, so precache the manifest + all three so the hero animates
  // offline on the 2nd+ load.
  // assets + icons
  'assets/og-image.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  // #99 — the 3 background-music MP3s (~11 MB) are deliberately NOT precached
  // on install. They're a Tier-2 ADD-ON (music is non-essential): pulling ~11 MB
  // up front on the first visit dominated install + total transfer for a track
  // most users may never start. They load on demand when the user starts music
  // (bgm.src is set synchronously in the play handler) and the fetch handler
  // below caches them into ADDONS_CACHE (isAddonRequest matches .mp3), so a
  // played track is offline-available afterwards AND survives deploys.
];

// Resolve each scope-relative URL to an absolute URL against the SW's
// own scope so cache.addAll() gets fully-qualified URLs that match
// what the page will fetch later. self.registration.scope is the
// directory the SW controls (always ends with /).
const _resolvedRuntimeURLs = () => {
  const base = self.registration.scope;
  return RUNTIME_URLS.map((u) => new URL(u, base).href);
};

// Install: pre-cache the full runtime set so the first offline visit
// has everything it needs without a network round-trip.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // Use addAll for atomicity (any single 404 fails the install).
    // For local-first dev this means a missing music file fails install
    // — that's the desired strictness.
    await cache.addAll(_resolvedRuntimeURLs());
    // Skip waiting: next page navigation gets the new SW immediately
    // rather than after a tab close + reopen.
    await self.skipWaiting();
  })());
});

// Activate: clear any older cache versions so a bumped CACHE_VERSION
// purges the previous set. Without this we'd keep stale assets forever.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // #97 — purge stale CACHE_VERSION buckets, but KEEP the current version AND
    // the stable ADDONS_CACHE (downloaded Tier-2 detail survives the deploy).
    const keep = new Set([CACHE_VERSION, ADDONS_CACHE]);
    const hadOlder = keys.some((k) => !keep.has(k));
    await Promise.all(
      keys
        .filter((k) => !keep.has(k))
        .map((k) => caches.delete(k))
    );
    // Take control of any open clients immediately.
    await self.clients.claim();
    // E66 — broadcast an update notification to every controlled client
    // ONLY when this activation actually superseded an older cache (i.e.
    // a real version bump, not the very first install). The page listens
    // for { type: 'sw-updated', version } and shows a refresh toast.
    if (hadOlder) {
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      for (const c of clients) {
        try { c.postMessage({ type: 'sw-updated', version: CACHE_VERSION }); } catch {}
      }
    }
  })());
});

// E66b — let the PAGE activate a waiting SW on demand. The page's update banner
// posts { type: 'SKIP_WAITING' } when the user clicks Refresh; we skipWaiting so
// the new SW takes over WITHOUT a close-all-tabs cycle, then the page reloads on
// controllerchange. (install also calls skipWaiting, but a worker that finished
// installing while the page stayed open can sit "waiting" until prompted.)
self.addEventListener('message', (event) => {
  if (event && event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch: cache-first. On hit, return cached. On miss, fetch + cache for
// next time (lets late-loaded assets — e.g. a fresh region pack — get
// captured without bumping the version).
self.addEventListener('fetch', (event) => {
  // Only handle same-origin GETs. Other origins (none today by design)
  // pass through to the network so we don't accidentally cache analytics.
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    // #97 — Tier-2 add-ons (refined geo, future large datasets) live in the
    // purge-whitelisted ADDONS_CACHE; everything else in CACHE_VERSION. Both
    // are cache-first: a downloaded add-on serves offline from then on, and
    // survives deploys.
    const bucket = isAddonRequest(url) ? ADDONS_CACHE : CACHE_VERSION;
    const cache = await caches.open(bucket);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const response = await fetch(req);
      // Only cache OK responses; never cache opaque / error responses.
      if (response && response.ok) {
        cache.put(req, response.clone()).catch(() => {});
      }
      return response;
    } catch (err) {
      // Network failed AND nothing in cache. For a navigation request
      // (i.e. an HTML page), fall back to the cached index.html so the
      // app still launches into its empty state offline.
      if (req.mode === 'navigate') {
        const fallback = await cache.match(new URL('index.html', self.registration.scope).href);
        if (fallback) return fallback;
      }
      throw err;
    }
  })());
});
