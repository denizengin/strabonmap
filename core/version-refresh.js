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
    // BUG #19 follow-up (28 May 2026): on iOS WebKit, confirm() inside an async
    // chain plus IDB deleteDatabase + reload can silently no-op in any of three
    // ways (confirm returning undefined in PWA contexts, deleteDatabase blocking
    // forever because the page itself holds an open connection, location.reload
    // not firing after a stale dialog). So we DO THIS DEFENSIVELY:
    //   1. confirm() at the very top, never inside an IIFE wrapper.
    //   2. localStorage.clear() FIRST — sync, can't fail silently.
    //   3. Update button text + alert visible immediately so the user knows
    //      something is happening even if the reload stalls.
    //   4. Try-and-race the IDB delete with a 1.5s timeout (was 3s — quicker).
    //   5. Reload via TWO mechanisms: location.reload() then a 100ms fallback
    //      to location.href = location.pathname. On iOS one of them will land.
    btn.addEventListener('click', () => {
      let tripCount = '?';
      try {
        const raw = localStorage.getItem('strabonMap.v3');
        if (raw) tripCount = String((JSON.parse(raw).trips || []).length);
      } catch {}
      const ok = confirm(`Erase ALL local data?\n\nThis deletes ${tripCount} trip(s) and ALL photographs from this device. Permanent.`);
      if (!ok) return;
      btn.textContent = '✗ Erasing…';
      // STEP 1 — synchronous localStorage wipe. Can't fail silently in any
      // browser; if it throws we surface that.
      let lsErr = null;
      try { localStorage.clear(); } catch (e) { lsErr = e; }
      // STEP 1.5 — close the app's own IDB connection BEFORE deleteDatabase.
      // The Strabon Map page opens `strabonMap` at boot via IDBPhotoStore.open
      // and keeps the handle alive for the session. If we leave it open, the
      // delete fires `onblocked` and never actually deletes — and after reload
      // the data is STILL there. So we explicitly drop the connection first.
      // Then STEP 2 — IDB delete with hard race-timeout.
      // Then STEP 3 — reload, twice, to defeat iOS's silent-no-op.
      const finish = () => {
        try { location.reload(); } catch {}
        setTimeout(() => { try { location.href = location.pathname; } catch {} }, 100);
      };
      const wipeIdb = async () => {
        try {
          if (typeof IDBPhotoStore !== 'undefined' && typeof IDBPhotoStore.close === 'function') {
            await IDBPhotoStore.close();
          }
        } catch {}
        await new Promise((resolve) => {
          try {
            const req = indexedDB.deleteDatabase('strabonMap');
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
          } catch { resolve(); }
          setTimeout(resolve, 1500);
        });
        finish();
      };
      wipeIdb();
      // Surface synchronous failure if localStorage didn't clear.
      if (lsErr) {
        try { alert('localStorage.clear() failed: ' + (lsErr.message || lsErr)); } catch {}
      }
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
