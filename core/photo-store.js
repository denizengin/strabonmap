// core/photo-store.js — IndexedDB photo backend (E11, schema v3).
//
// Why this exists: strabonMap.v2 kept base64 photo bytes inline in the trip JSON
// in localStorage. At ~5MB the WHOLE store — trip structure included — fails
// to save, so a photo-rich trip could silently lose your work. Schema v3
// moves the bytes into IndexedDB; the trip JSON keeps only a tiny reference
// {id, ref:'idb', w, h, addedAt}. Trip JSON itself stays in localStorage
// (small, structured, fine there).
//
// Shared by index.html + mobile.html. Loaded as a plain global: the file
// defines `const IDBPhotoStore = ...` at 2-space indent (the core/*.js
// convention) and tests/core-loader.js scrapes it.
//
// The hard constraint: the renderers call safePhotoSrc(photo) SYNCHRONOUSLY
// inside template strings. IDB reads are async. So IDBPhotoStore keeps a
// synchronous in-memory cache of object URLs — call hydrate() once at startup
// to populate it, then srcFor(id) is a sync Map lookup.

  const IDBPhotoStore = (() => {
    const DB_NAME = 'strabonMap';
    const LEGACY_DB_NAME = 'indyMap'; // E65 — pre-rename db name
    const DB_VERSION = 1;
    const STORE = 'photos';

    let _dbPromise = null;
    // id -> object URL, populated by hydrate()/put(). Synchronous read path.
    const _urlCache = new Map();

    // E65 — one-time migration from the legacy 'indyMap' IDB to 'strabonMap'.
    // Idempotent: once the new DB has any keys (or the legacy DB is gone),
    // this is a no-op. Runs serially before any other IDB operation.
    const _migrateFromLegacy = async () => {
      try {
        // Open the legacy DB without forcing a version bump.
        const legacyDb = await new Promise((resolve) => {
          if (typeof indexedDB === 'undefined') return resolve(null);
          const req = indexedDB.open(LEGACY_DB_NAME);
          req.onupgradeneeded = (e) => {
            // If the legacy DB doesn't exist, this fires with an empty
            // schema. We DON'T want to create it just to migrate from it —
            // abort the transaction so the DB remains uncreated.
            try { e.target.transaction.abort(); } catch {}
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
          req.onblocked = () => resolve(null);
        });
        if (!legacyDb) return;
        // If the legacy DB exists but has no 'photos' store, just close + delete.
        if (!legacyDb.objectStoreNames.contains(STORE)) {
          legacyDb.close();
          try { indexedDB.deleteDatabase(LEGACY_DB_NAME); } catch {}
          return;
        }
        // Pull every photo out of the legacy DB.
        const photos = await new Promise((resolve) => {
          const tx = legacyDb.transaction(STORE, 'readonly');
          const store = tx.objectStore(STORE);
          const keysReq = store.getAllKeys();
          const valsReq = store.getAll();
          tx.oncomplete = () => {
            const keys = keysReq.result || [];
            const vals = valsReq.result || [];
            const pairs = [];
            for (let i = 0; i < keys.length; i++) pairs.push([keys[i], vals[i]]);
            resolve(pairs);
          };
          tx.onerror = () => resolve([]);
          tx.onabort = () => resolve([]);
        });
        legacyDb.close();
        if (photos.length === 0) {
          try { indexedDB.deleteDatabase(LEGACY_DB_NAME); } catch {}
          return;
        }
        // Open the NEW DB and write every photo in. If the key already
        // exists we don't overwrite — the new DB takes precedence.
        const newDb = await new Promise((resolve, reject) => {
          const req = indexedDB.open(DB_NAME, DB_VERSION);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        await new Promise((resolve) => {
          const tx = newDb.transaction(STORE, 'readwrite');
          const store = tx.objectStore(STORE);
          for (const [k, v] of photos) {
            try { store.put(v, k); } catch {}
          }
          tx.oncomplete = () => resolve();
          tx.onerror    = () => resolve();
          tx.onabort    = () => resolve();
        });
        newDb.close();
        // Drop the legacy DB so subsequent boots are fast.
        try { indexedDB.deleteDatabase(LEGACY_DB_NAME); } catch {}
      } catch { /* migration is best-effort; the app still works either way */ }
    };
    let _migrationPromise = null;

    const _openDb = () => {
      if (_dbPromise) return _dbPromise;
      _dbPromise = (async () => {
        // Run the legacy migration once, then open the new DB normally.
        if (!_migrationPromise) _migrationPromise = _migrateFromLegacy();
        await _migrationPromise;
        return new Promise((resolve, reject) => {
          if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB unavailable'));
            return;
          }
          const req = indexedDB.open(DB_NAME, DB_VERSION);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
              db.createObjectStore(STORE); // key = photo id, value = Blob
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error || new Error('IDB open failed'));
        });
      })();
      return _dbPromise;
    };

    // A typed error so callers can recognize quota-exceeded and stop trying,
    // rather than burning N more rejected writes on the same exhausted store.
    const _isQuotaError = (e) => !!(e && (e.name === 'QuotaExceededError'
      || e.code === 22 || /quota/i.test(e.message || '')));

    const _tx = async (mode, fn) => {
      const db = await _openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let result;
        let captured = null; // request-level error (often more specific than tx.error)
        Promise.resolve(fn(store, (e) => { captured = e; }))
          .then((r) => { result = r; })
          .catch((e) => { if (!captured) captured = e; reject(e); });
        tx.oncomplete = () => resolve(result);
        tx.onerror    = () => reject(captured || tx.error || new Error('IDB tx failed'));
        tx.onabort    = () => {
          // Quota aborts can leave the connection wedged on some browsers — drop
          // the cached open so the NEXT call gets a fresh handle. Single-tx fail.
          if (_isQuotaError(captured) || _isQuotaError(tx.error)) _dbPromise = null;
          reject(captured || tx.error || new Error('IDB tx aborted'));
        };
      });
    };

    const _reqToPromise = (req, onErr) => new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = (ev) => {
        const err = req.error;
        if (typeof onErr === 'function') onErr(err);
        // preventDefault stops the error bubbling up to abort the WHOLE tx — for a
        // quota failure on one put, this keeps the tx alive so its oncomplete can
        // still fire if other requests in it succeed (defensive — most of our txs
        // are single-request, so it mostly just makes tx.onerror reach reject).
        try { ev.preventDefault(); } catch {}
        reject(err);
      };
    });

    return {
      STORE,

      // open the DB eagerly — lets callers fail fast / probe availability.
      open() { return _openDb(); },

      // write a Blob under `id`. Also caches an object URL so srcFor(id) is
      // immediately usable without a round-trip. On a quota-exceeded write the
      // rejected error carries `.isQuotaExceeded = true` so callers (the bulk
      // import) can detect the storage wall and stop further attempts cleanly,
      // instead of burning N more rejected writes on the same exhausted store.
      //
      // BUG #20 — opts.cacheUrl=false skips the object-URL cache. Bulk imports
      // (250-photo confirm) hit a real heap wall: each cached URL pins its ~250KB
      // re-encoded JPEG blob alive, so 250 puts = ~60MB of blobs held just for
      // the cache. The viewer hydrates lazily on trip open, so the eager cache
      // is wasted there. Single-photo paths leave the default (cacheUrl=true) so
      // the just-added photo renders instantly.
      async put(id, blob, opts) {
        // BUG #19 (iOS Chrome): some Blobs returned from canvas.toBlob() can't
        // be structured-cloned into IDB on iOS Chrome under bulk-import load,
        // failing with `UnknownError: Error preparing Blob/File data to be
        // stored in object store`. The fix is to re-pack the bytes into a
        // FRESH Blob via arrayBuffer() before the put — the round-trip gives
        // WebKit a clean cloneable buffer. Costs one extra Uint8Array copy
        // per photo (~250KB at re-encode size). Negligible; this unblocks a
        // class that otherwise silently loses every photo at stamping.
        const _stable = async (b) => {
          try { return new Blob([await b.arrayBuffer()], { type: b.type || 'image/jpeg' }); }
          catch { return b; /* fall back to original if even arrayBuffer fails */ }
        };
        const safe = await _stable(blob);
        try {
          await _tx('readwrite', (store) => _reqToPromise(store.put(safe, id)));
        } catch (e) {
          if (_isQuotaError(e)) {
            const err = new Error('IDB storage full');
            err.isQuotaExceeded = true;
            err.cause = e;
            throw err;
          }
          throw e;
        }
        if (!opts || opts.cacheUrl !== false) {
          const old = _urlCache.get(id);
          if (old) URL.revokeObjectURL(old);
          _urlCache.set(id, URL.createObjectURL(safe));
        }
        return id;
      },

      // Exposed so callers that catch a put-rejected error can match by signature
      // without leaking IDB error-type knowledge.
      isQuotaError(e) { return _isQuotaError(e); },

      // read a Blob back. Returns null if absent.
      async get(id) {
        const blob = await _tx('readonly', (store) => _reqToPromise(store.get(id)));
        return blob || null;
      },

      async has(id) {
        const key = await _tx('readonly', (store) => _reqToPromise(store.getKey(id)));
        return key !== undefined;
      },

      async delete(id) {
        await _tx('readwrite', (store) => _reqToPromise(store.delete(id)));
        const url = _urlCache.get(id);
        if (url) { URL.revokeObjectURL(url); _urlCache.delete(id); }
      },

      // every key currently in the store.
      async allIds() {
        const keys = await _tx('readonly', (store) => _reqToPromise(store.getAllKeys()));
        return keys || [];
      },

      // load object URLs for a set of ids into the sync cache. Call once at
      // startup with every photo id referenced by the loaded store, so the
      // synchronous srcFor() path works during the first render.
      async hydrate(ids) {
        const want = [...new Set(ids)].filter((id) => id && !_urlCache.has(id));
        for (const id of want) {
          try {
            const blob = await this.get(id);
            if (blob) _urlCache.set(id, URL.createObjectURL(blob));
          } catch { /* a missing photo just renders blank — never throw */ }
        }
      },

      // SYNCHRONOUS object-URL lookup for the render path. Empty string if the
      // id is not hydrated/known — the <img> then renders blank, same as the
      // old safePhotoSrc reject path.
      srcFor(id) {
        return _urlCache.get(id) || '';
      },

      // test/diagnostic: is this id in the sync cache?
      isHydrated(id) { return _urlCache.has(id); },

      // drop every cached object URL (does not touch the DB). For teardown.
      _clearCache() {
        for (const url of _urlCache.values()) URL.revokeObjectURL(url);
        _urlCache.clear();
      },
    };
  })();
