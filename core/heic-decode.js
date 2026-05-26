// core/heic-decode.js — HEIC pixel decoding via the lazy-loaded
// libheif-js library (E61).
//
// Why this exists: PhotoStore.ingest's existing pipeline (new Image() →
// canvas → JPEG re-encode) works for JPEG/PNG everywhere, but for HEIC
// it ONLY works on Safari, which natively decodes the format in
// <img> elements. Chrome / Firefox / Edge on desktop don't, so an
// imported iPhone HEIC photo silently dropped before E61. This module
// closes the gap by routing HEIC blobs through libheif when present.
//
// Shared by index.html + mobile.html. No DOM mutation other than the
// canvas it returns. Loaded as a plain global; tests/core-loader.js
// scrapes the top-level const.
//
// Why lazy-load: libheif-bundle.js is 1.4 MB (self-contained
// WASM-as-base64). Most users never import HEIC. We pay the weight
// only on the first HEIC import; the service worker (E52) caches it
// for the second.

  // Two layers of caching: _libheifLoadPromise gates duplicate <script>
  // injections; _libheifApiPromise gates duplicate factory invocations
  // (the wasm-bundle exposes a factory function — calling it returns a
  // Promise<api> with HeifDecoder etc. — and we want one shared API
  // instance, not one per decode call).
  let _libheifLoadPromise = null;
  let _libheifApiPromise = null;

  const _injectLibheifScript = () => {
    if (typeof window === 'undefined') {
      return Promise.reject(new Error('libheif requires a browser environment'));
    }
    if (typeof window.libheif !== 'undefined') return Promise.resolve(window.libheif);
    if (_libheifLoadPromise) return _libheifLoadPromise;
    _libheifLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'vendor/libheif/libheif-bundle.js';
      script.async = true;
      script.onload = () => {
        if (typeof window.libheif !== 'undefined') {
          resolve(window.libheif);
        } else {
          reject(new Error('libheif-bundle.js loaded but did not expose libheif'));
        }
      };
      script.onerror = () => reject(new Error('failed to load libheif-bundle.js'));
      document.head.appendChild(script);
    });
    return _libheifLoadPromise;
  };

  // _ensureLibheifLoaded — returns Promise<api> where `api` has a
  // HeifDecoder constructor. The wasm-bundle exposes a factory: the
  // global `libheif` is a function we call once, and it returns a
  // Promise that resolves to the actual API (HeifDecoder, etc.).
  // We accept both shapes (factory function OR already-the-api) so
  // a future bundle change that switches back to a plain-object
  // export doesn't break us.
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

  // decodeHeicToCanvas(blob) — returns Promise<HTMLCanvasElement>
  //
  // The returned canvas holds the decoded pixels at the HEIC's native
  // resolution. Callers can then drawImage it into a smaller canvas
  // (downscale) and toBlob('image/jpeg') to re-encode — exactly the
  // pipeline PhotoStore.ingest already uses for JPEG.
  //
  // Throws if libheif fails to load OR if the blob isn't a valid HEIC.
  // Callers should catch and degrade gracefully (E38 already has the
  // "couldn't be read" toast for this class of failure).
  const decodeHeicToCanvas = async (blob) => {
    if (!blob || typeof blob.arrayBuffer !== 'function') {
      throw new Error('decodeHeicToCanvas: blob is not a Blob');
    }
    const libheif = await _ensureLibheifLoaded();
    const buf = await blob.arrayBuffer();
    const decoder = new libheif.HeifDecoder();
    const images = decoder.decode(new Uint8Array(buf));
    if (!images || images.length === 0) {
      throw new Error('HEIC contained no images');
    }
    // Primary image — the first entry is the cover image in every HEIC
    // we've seen. Multi-image HEICs (Live Photos, burst sequences) are
    // out of scope for E61; we take the primary and ignore the rest.
    const image = images[0];
    const width = image.get_width();
    const height = image.get_height();
    if (width <= 0 || height <= 0 || width > 16384 || height > 16384) {
      throw new Error(`HEIC dimensions out of range: ${width}x${height}`);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);
    // libheif's `display` is callback-style; wrap it in a Promise.
    await new Promise((resolve, reject) => {
      image.display(imageData, (rendered) => {
        if (!rendered) reject(new Error('HEIF processing error'));
        else resolve();
      });
    });
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  };

  // Quick magic-byte test — does this look like a HEIC/HEIF/AVIF buffer?
  // Mirrors core/exif.js's isHeicArrayBuffer but takes a Blob and reads
  // just the first 12 bytes (cheap probe before kicking off a full decode).
  const isHeicBlob = async (blob) => {
    try {
      if (!blob || typeof blob.slice !== 'function' || blob.size < 12) return false;
      const head = await blob.slice(0, 12).arrayBuffer();
      const b = new Uint8Array(head);
      // bytes 4-7 = 'ftyp'
      return b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;
    } catch { return false; }
  };
