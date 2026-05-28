// core/version-refresh.js — two tiny shared button-wirers used by index.html +
// mobile.html for the post-#19-fix "Version" + "Force refresh" controls.
//
// Both buttons live on the picker-landing surfaces (desktop: id="versionBtn" +
// "forceRefreshBtn"; mobile: id="mobileVersionBtn" + "mobileForceRefreshBtn").
// Pure classic-script globals so neither bundle has to grow for this.
//
// "Version" — alert() the build SHA + builtAt + current SW cache name(s) so a
// user can see whether they're on a stale cached bundle.
//
// "Force refresh" — for when iOS's hard-refresh isn't enough. Unregisters every
// service worker, deletes every Cache API cache, reloads. Trips + photos in
// localStorage / IndexedDB are PRESERVED — the wipe is code-only.

  const wireVersionButton = (btnId) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const b = window.__STRABON_BUILD || { sha: '(dev)', builtAt: '(no banner)' };
      let cacheNames = 'unavailable';
      try { cacheNames = (await caches.keys()).join(', ') || 'none'; } catch {}
      const msg = `Build: ${b.sha}\nBuilt at: ${b.builtAt}\nSW cache: ${cacheNames}`;
      try { alert(msg); } catch {}
    });
  };

  const wireForceRefreshButton = (btnId) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const ok = (() => { try { return confirm('Force refresh? This clears the local code cache and reloads.\n\nYour trips + photos are kept.'); } catch { return true; } })();
      if (!ok) return;
      const original = btn.textContent;
      btn.textContent = '↺ Refreshing…';
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister().catch(() => null)));
        }
      } catch {}
      try {
        if (typeof caches !== 'undefined') {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k).catch(() => null)));
        }
      } catch {}
      try { location.reload(); }
      catch { btn.textContent = original; location.href = location.href; }
    });
  };

  // "Erase all data" — the nuclear option. Wipes localStorage + IndexedDB. The
  // SW + Cache API are LEFT ALONE (that's what Force refresh is for). Use this
  // when you want a clean slate to test imports, NOT when you suspect a stale
  // bundle. Confirms with strong wording and the current trip count so the
  // user knows exactly what's about to vanish.
  const wireEraseDataButton = (btnId) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      let tripCount = '?';
      try {
        const raw = localStorage.getItem('strabonMap.v3');
        if (raw) tripCount = String((JSON.parse(raw).trips || []).length);
      } catch {}
      const ok = (() => {
        try {
          return confirm(`Erase ALL local data?\n\nThis deletes ${tripCount} trip(s) and ALL photographs from this device. The deletion is permanent and cannot be undone.\n\nThe app code stays installed — only your trips + photos are wiped.`);
        } catch { return false; }
      })();
      if (!ok) return;
      const original = btn.textContent;
      btn.textContent = '✗ Erasing…';
      try { localStorage.clear(); } catch {}
      // Delete known IDB dbs. strabonMap is the photo store. If we ever add
      // others, list them here so a single tap wipes everything.
      const dbs = ['strabonMap'];
      await Promise.all(dbs.map((name) => new Promise((resolve) => {
        try {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = req.onerror = req.onblocked = () => resolve();
          setTimeout(resolve, 3000); // bail after 3s — onblocked can hang if a tab still holds the connection
        } catch { resolve(); }
      })));
      try { location.reload(); }
      catch { btn.textContent = original; location.href = location.href; }
    });
  };

  // Auto-wire both desktop + mobile IDs on DOMContentLoaded so neither HTML
  // file needs its own inline glue. Idempotent: each wirer no-ops on a
  // missing button, so a page that only has the mobile variants (or vice
  // versa) just wires what's present.
  const _autoWire = () => {
    wireVersionButton('versionBtn');
    wireVersionButton('mobileVersionBtn');
    wireForceRefreshButton('forceRefreshBtn');
    wireForceRefreshButton('mobileForceRefreshBtn');
    wireEraseDataButton('eraseDataBtn');
    wireEraseDataButton('mobileEraseDataBtn');
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _autoWire, { once: true });
  } else {
    _autoWire();
  }
