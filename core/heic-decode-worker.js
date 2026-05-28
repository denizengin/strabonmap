// core/heic-decode-worker.js — Worker-isolated libheif decode (BUG #20).
//
// Why this file exists: libheif-js's WASM heap grows monotonically (emscripten
// linear memory only grows, never shrinks). 250 HEICs decoded on the main
// thread OOM'd the tab at ~4.3 minutes because the WASM heap held every
// decoded photo's intermediates until the whole renderer ran out of native
// memory (the JS heap stayed flat at 326 MB — the leak was outside V8).
//
// Moving decode into a Worker lets us TERMINATE the worker periodically;
// terminate() returns ALL of the worker's WASM linear memory to the OS
// immediately. The main thread is unaffected, and a fresh worker spins up
// for the next batch in ~5-10ms.
//
// Protocol (kept tiny):
//   main → worker: { type: 'decode', id, buf (ArrayBuffer) }     transferable
//   worker → main: { type: 'ok',  id, buf, w, h }                transferable
//   worker → main: { type: 'err', id, message }
//
// The decoded RGBA pixels travel as a Transferable ArrayBuffer — zero-copy.
// The main side wraps the buffer in a Uint8ClampedArray + paints it onto a
// fresh HTMLCanvasElement (workers can't create HTMLCanvasElements). On
// browsers without OffscreenCanvas it's the simplest cross-browser path.

/* eslint-env worker */
/* global libheif, importScripts */

let _libheifApi = null;

const _loadLibheif = async () => {
  if (_libheifApi) return _libheifApi;
  // Same bundle the main thread used to load — co-located in vendor/.
  importScripts('../vendor/libheif/libheif-bundle.js');
  // The bundle either exposes a factory function we call once (returning a
  // Promise<api>), or attaches the api directly. Mirror core/heic-decode.js's
  // shape-tolerant load so a future bundle change doesn't break us.
  if (typeof libheif === 'function') {
    _libheifApi = await libheif();
  } else if (libheif && typeof libheif.HeifDecoder === 'function') {
    _libheifApi = libheif;
  } else {
    throw new Error('libheif global has unexpected shape inside worker');
  }
  if (!_libheifApi || typeof _libheifApi.HeifDecoder !== 'function') {
    throw new Error('libheif factory did not return HeifDecoder');
  }
  return _libheifApi;
};

const _decode = async (buf) => {
  const api = await _loadLibheif();
  const decoder = new api.HeifDecoder();
  const images = decoder.decode(new Uint8Array(buf));
  if (!images || images.length === 0) throw new Error('HEIC contained no images');
  const image = images[0];
  const width = image.get_width();
  const height = image.get_height();
  if (width <= 0 || height <= 0 || width > 16384 || height > 16384) {
    throw new Error(`HEIC dimensions out of range: ${width}x${height}`);
  }
  // Allocate the RGBA buffer in the worker so we can transfer it back
  // zero-copy. ImageData here is a plain {data, width, height} the
  // libheif `display` callback writes into — works without DOM.
  const data = new Uint8ClampedArray(width * height * 4);
  await new Promise((resolve, reject) => {
    image.display({ data, width, height }, (rendered) => {
      if (!rendered) reject(new Error('HEIF processing error'));
      else resolve();
    });
  });
  return { buf: data.buffer, w: width, h: height };
};

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type !== 'decode') return;
  const id = msg.id;
  try {
    const { buf, w, h } = await _decode(msg.buf);
    // Transfer the pixel buffer back — main thread paints it onto a canvas.
    self.postMessage({ type: 'ok', id, buf, w, h }, [buf]);
  } catch (err) {
    self.postMessage({ type: 'err', id, message: (err && err.message) || String(err) });
  }
};
