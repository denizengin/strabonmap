// core/heic-decode.js — HEIC pixel decoding via the lazy-loaded libheif-js
// library (E61), WORKER-ISOLATED with periodic termination (BUG #20) and a
// SMALL POOL for parallel decode throughput (post-#20 follow-up).
//
// History:
//   E61 (original):  direct decode on the main thread. Worked, but libheif's
//                    WASM linear memory only grows (emscripten allocator
//                    never shrinks), so a 250-photo import accumulated
//                    ~1 GB of WASM heap in the renderer and OOM'd the tab
//                    at ~4.3 minutes. The JS heap stayed flat at 326 MB —
//                    the leak was outside V8, invisible to performance.memory.
//   #20 v1:          one Web Worker, recycled every N decodes. terminate()
//                    returns the WASM linear memory to the OS; new worker
//                    spins up in ~5-10ms. 250 HEICs: 4m 39s, flat 117 MB.
//   #20 v2 (this):   POOL of POOL_SIZE workers, each independently recycled
//                    every WORKER_RECYCLE_EVERY decodes, each handling one
//                    decode at a time. Callers that issue concurrent decodes
//                    get 2× throughput; serial callers see no change (the
//                    pool just round-robins to the same idle worker). Peak
//                    native memory roughly doubles (two libheif heaps live
//                    at once) — still well under any reasonable cap (250
//                    HEICs single-worker peaked at ~117 MB; pool ≈234 MB).
//
// Public API unchanged: decodeHeicToCanvas(blob) → Promise<HTMLCanvasElement>.
// One caller (src/storage/photo-store.js). Shared by index.html + mobile.html.
// tests/core-loader.js scrapes the top-level const, so keep declarations bare.

  // Tunables. POOL_SIZE picked to match a typical iPhone's performance-core
  // count (2-3) without saturating the OS scheduler with too many WASM
  // instances. BUG #19 follow-up (28 May 2026): on iOS Safari/Chrome (both
  // WebKit), the renderer process is killed by the OS around 1-1.5 GB total
  // memory. Two parallel libheif workers + the canvas + the encoded blob
  // pushes over that wall around the 100-photo mark — user saw a white-
  // screen-then-reload at ~100/213. So on iOS WebKit we DROP TO 1 WORKER,
  // halving peak WASM heap (the dominant native-memory consumer). Throughput
  // halves too — the user's user-experience says "it works" beats "it's
  // 1.7× faster but crashes."
  const _isIOSWebKit = (() => {
    try {
      const ua = navigator.userAgent || '';
      // iPhone/iPod/iPad → all WebKit on iOS, regardless of "Chrome"/"Safari"
      // in the UA. Also catches iPadOS-as-Mac (where MaxTouchPoints > 1).
      return /iPhone|iPad|iPod/.test(ua)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    } catch { return false; }
  })();
  const POOL_SIZE = _isIOSWebKit ? 1 : 2;
  // iOS stamping wall (29 May 2026): recycle the worker twice as often on iOS
  // WebKit (4 vs 8 decodes). Each recycle terminate()s the Worker, returning
  // the libheif WASM heap to the OS — the dominant native-memory consumer.
  // Halving the recycle interval halves the peak WASM heap held between
  // recycles, the suspected ceiling that crashed the tab mid-stamp at ~209.
  const WORKER_RECYCLE_EVERY = _isIOSWebKit ? 4 : 8;

  // Each slot owns one Worker, its in-flight count (0 or 1; we never queue
  // two decodes onto the same worker at once — libheif inside is serial),
  // its decode count for recycle, and the pending response handlers keyed
  // by request id (so an error blast can reject every pending request).
  let _pool = null; // lazily built on first decode

  const _spawnSlot = () => {
    const slot = {
      worker: null,
      busy: false,
      decodeCount: 0,
      pending: new Map(), // id → { resolve, reject }
      waiters: [],        // resolvers waiting for this slot to free up
    };
    const w = new Worker('core/heic-decode-worker.js');
    w.onmessage = (e) => {
      const msg = e.data || {};
      const pending = slot.pending.get(msg.id);
      if (!pending) return;
      slot.pending.delete(msg.id);
      if (msg.type === 'ok') pending.resolve({ buf: msg.buf, w: msg.w, h: msg.h });
      else pending.reject(new Error(msg.message || 'HEIC decode failed'));
    };
    w.onerror = (e) => {
      const err = new Error((e && e.message) || 'HEIC worker error');
      for (const p of slot.pending.values()) p.reject(err);
      slot.pending.clear();
      _terminateSlot(slot);
    };
    slot.worker = w;
    return slot;
  };

  const _terminateSlot = (slot) => {
    if (!slot || !slot.worker) return;
    try { slot.worker.terminate(); } catch { /* already gone */ }
    slot.worker = null;
    slot.decodeCount = 0;
    slot.busy = false;
    // Wake any waiters — they'll re-pick and we'll re-spawn lazily.
    const waiters = slot.waiters.splice(0);
    for (const w of waiters) w();
  };

  const _ensurePool = () => {
    if (!_pool) {
      _pool = [];
      for (let i = 0; i < POOL_SIZE; i++) _pool.push(_spawnSlot());
    }
    return _pool;
  };

  // Pick an idle slot, or wait for one. Returns a reserved (busy=true) slot
  // so two concurrent callers never race onto the same worker.
  const _acquireSlot = async () => {
    const pool = _ensurePool();
    while (true) {
      const idleIdx = pool.findIndex((s) => !s.busy);
      if (idleIdx >= 0) {
        let slot = pool[idleIdx];
        if (!slot.worker) {
          // Slot was terminated post-recycle; replace it with a fresh one.
          // The fresh slot's onmessage/onerror handlers close over `fresh`,
          // so we swap the WHOLE object in (no handler stitching).
          slot = _spawnSlot();
          pool[idleIdx] = slot;
        }
        slot.busy = true;
        return slot;
      }
      // All busy — park on the pool's shared waiter list.
      await new Promise((resolve) => pool[0].waiters.push(resolve));
    }
  };

  const _releaseSlot = (slot) => {
    slot.busy = false;
    slot.decodeCount++;
    if (slot.decodeCount >= WORKER_RECYCLE_EVERY) {
      _terminateSlot(slot); // wakes its own waiters
      return;
    }
    // Hand the slot to a waiter if any are parked.
    const next = slot.waiters.shift();
    if (next) next();
  };

  let _seq = 0;

  // decodeHeicToCanvas(blob) — returns Promise<HTMLCanvasElement>.
  //
  // The returned canvas holds the decoded pixels at the HEIC's native
  // resolution. PhotoStore.ingest then drawImage's it into a smaller canvas
  // and toBlob('image/jpeg')-re-encodes. Same pipeline as before — only
  // the decode itself moved to a worker pool.
  const decodeHeicToCanvas = async (blob) => {
    if (!blob || typeof blob.arrayBuffer !== 'function') {
      throw new Error('decodeHeicToCanvas: blob is not a Blob');
    }
    if (typeof Worker === 'undefined') {
      // No Worker support (very old browser): fall back to inline decode.
      return _decodeInline(blob);
    }
    const slot = await _acquireSlot();
    const id = ++_seq;
    let reply;
    try {
      const buf = await blob.arrayBuffer();
      reply = await new Promise((resolve, reject) => {
        slot.pending.set(id, { resolve, reject });
        try { slot.worker.postMessage({ type: 'decode', id, buf }, [buf]); }
        catch (e) { slot.pending.delete(id); reject(e); }
      });
    } finally {
      _releaseSlot(slot);
    }
    // Paint the transferred RGBA into a fresh canvas. createImageData wants
    // a Uint8ClampedArray view onto the buffer we just got back.
    const canvas = document.createElement('canvas');
    canvas.width = reply.w; canvas.height = reply.h;
    const ctx = canvas.getContext('2d');
    const px = new Uint8ClampedArray(reply.buf);
    ctx.putImageData(new ImageData(px, reply.w, reply.h), 0, 0);
    return canvas;
  };

  // ── Inline fallback (pre-#20 path) ─────────────────────────────────────
  // Kept verbatim from E61, only reached when window.Worker is undefined.
  let _libheifLoadPromise = null;
  let _libheifApiPromise = null;
  const _injectLibheifScript = () => {
    if (typeof window === 'undefined') return Promise.reject(new Error('libheif requires a browser environment'));
    if (typeof window.libheif !== 'undefined') return Promise.resolve(window.libheif);
    if (_libheifLoadPromise) return _libheifLoadPromise;
    _libheifLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'vendor/libheif/libheif-bundle.js';
      script.async = true;
      script.onload = () => {
        if (typeof window.libheif !== 'undefined') resolve(window.libheif);
        else reject(new Error('libheif-bundle.js loaded but did not expose libheif'));
      };
      script.onerror = () => reject(new Error('failed to load libheif-bundle.js'));
      document.head.appendChild(script);
    });
    return _libheifLoadPromise;
  };
  const _ensureLibheifLoaded = async () => {
    if (_libheifApiPromise) return _libheifApiPromise;
    _libheifApiPromise = (async () => {
      const raw = await _injectLibheifScript();
      if (raw && typeof raw.HeifDecoder === 'function') return raw;
      if (typeof raw === 'function') {
        const api = await raw();
        if (api && typeof api.HeifDecoder === 'function') return api;
        throw new Error('libheif factory did not return HeifDecoder');
      }
      throw new Error('libheif global has unexpected shape');
    })();
    return _libheifApiPromise;
  };
  const _decodeInline = async (blob) => {
    const libheif = await _ensureLibheifLoaded();
    const buf = await blob.arrayBuffer();
    const decoder = new libheif.HeifDecoder();
    const images = decoder.decode(new Uint8Array(buf));
    if (!images || images.length === 0) throw new Error('HEIC contained no images');
    const image = images[0];
    const width = image.get_width();
    const height = image.get_height();
    if (width <= 0 || height <= 0 || width > 16384 || height > 16384) {
      throw new Error(`HEIC dimensions out of range: ${width}x${height}`);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);
    await new Promise((resolve, reject) => {
      image.display(imageData, (rendered) => { if (!rendered) reject(new Error('HEIF processing error')); else resolve(); });
    });
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  };

  // Magic-byte test — does this look like a HEIC/HEIF/AVIF buffer?
  // Mirrors core/exif.js's isHeicArrayBuffer but takes a Blob (cheap probe).
  const isHeicBlob = async (blob) => {
    try {
      if (!blob || typeof blob.slice !== 'function' || blob.size < 12) return false;
      const head = await blob.slice(0, 12).arrayBuffer();
      const b = new Uint8Array(head);
      return b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;
    } catch { return false; }
  };
