// core/sfx.js — E-SFX-v1. Period-foley interaction sounds, per the
// E68 council verdict (2026-05-16). Foley-only palette: pen scratch,
// page turn, wooden stamp, typewriter carriage return + bell, paper
// crumple. Default-on with a visible mute toggle; respects
// prefers-reduced-motion as an auto-off signal until an explicit
// reduced-sound preference exists.
//
// API:
//   Sfx.play(id)          — fire-and-forget one-shot, gain auto-attenuated
//   Sfx.muted()           — bool, current mute state
//   Sfx.setMuted(v)       — persist to localStorage and broadcast
//   Sfx.onMuteChange(fn)  — subscribe; returns unsub
//
// Assets are loaded lazily on first call. A missing file is a silent
// no-op (assets/sfx/README.md documents what to drop in). No file
// blocks playback; the audio context unlocks on first user gesture.

  // Registry values are null until the foley assets are actually
  // shipped in assets/sfx/ — _loadBuffer treats a null URL as a
  // silent no-op (no fetch, no 404). When a real file lands, swap
  // the null for `'assets/sfx/<name>.opus'`. See assets/sfx/README.md
  // for the council's source/encoding spec.
  // #18 (owner GO 21 Jul) — clips SHIPPED. NOTE: these are tasteful synthesized
  // foley-STYLE clips (tools/gen-foley-sfx.mjs), a deliberate deviation from the
  // E68 "recorded foley only" spec because real recording/licensing wasn't
  // possible; they are drop-in replaceable (swap the file, keep the name) with
  // recorded foley later. A missing/renamed file is still a silent no-op.
  const SFX_ASSETS = {
    'pen-scratch':    'assets/sfx/pen-scratch.wav',
    'page-turn':      'assets/sfx/page-turn.wav',
    'typewriter-fin': 'assets/sfx/typewriter-fin.wav',
    'stamp-thud':     'assets/sfx/stamp-thud.wav',
    'paper-crumple':  'assets/sfx/paper-crumple.wav',
    'ui-mute-toggle': 'assets/sfx/ui-mute-toggle.wav',
  };

  const SFX_GAIN_DB = -9;                          // council: 9dB below the music bed
  const SFX_GAIN_LINEAR = Math.pow(10, SFX_GAIN_DB / 20);
  const SFX_MUTE_KEY = 'strabonMap.sfxMuted';

  const Sfx = (() => {
    let ctx = null;
    const buffers = {};
    const pending = {};
    const muteSubs = new Set();
    let unlocked = false;

    const _prefersReducedMotion = () => {
      try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
      catch { return false; }
    };

    const _storedMute = () => {
      try { return localStorage.getItem(SFX_MUTE_KEY) === '1'; }
      catch { return false; }
    };
    const _setStoredMute = (v) => {
      try { localStorage.setItem(SFX_MUTE_KEY, v ? '1' : '0'); }
      catch {}
    };

    let mutedState = _storedMute();
    const isMuted = () => mutedState || _prefersReducedMotion();

    const _ensureContext = () => {
      if (ctx) return ctx;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      } catch { ctx = null; }
      return ctx;
    };

    const _unlock = () => {
      if (unlocked) return;
      const c = _ensureContext();
      if (!c) return;
      if (c.state === 'suspended') c.resume().catch(() => {});
      unlocked = true;
    };

    // Lazy-load + decode an asset; cache the AudioBuffer. Returns
    // null on any failure (missing file, decode error, no context).
    const _loadBuffer = (id) => {
      if (buffers[id]) return Promise.resolve(buffers[id]);
      if (pending[id]) return pending[id];
      const url = SFX_ASSETS[id];
      if (!url) return Promise.resolve(null);
      const c = _ensureContext();
      if (!c) return Promise.resolve(null);
      const p = fetch(url)
        .then((r) => r.ok ? r.arrayBuffer() : null)
        .then((ab) => ab ? c.decodeAudioData(ab) : null)
        .then((buf) => { if (buf) buffers[id] = buf; return buf; })
        .catch(() => null);
      pending[id] = p;
      return p;
    };

    const play = (id, opts) => {
      if (isMuted()) return;
      _unlock();
      _loadBuffer(id).then((buf) => {
        if (!buf || !ctx) return;
        try {
          const src  = ctx.createBufferSource();
          const gain = ctx.createGain();
          src.buffer = buf;
          gain.gain.value = (opts && typeof opts.gain === 'number')
            ? opts.gain : SFX_GAIN_LINEAR;
          src.connect(gain).connect(ctx.destination);
          src.start(0);
        } catch { /* silent — sound is non-load-bearing */ }
      });
    };

    const setMuted = (v) => {
      const wasMuted = mutedState;
      mutedState = !!v;
      _setStoredMute(mutedState);
      // Play the toggle sound only WHEN MUTING (council: "the sound of
      // muting, never when unmuting"). Sneak it in before the mute
      // takes effect by passing through play() — but play() now
      // returns early on muted. Override locally for this one cue.
      if (!wasMuted && mutedState) {
        _unlock();
        _loadBuffer('ui-mute-toggle').then((buf) => {
          if (!buf || !ctx) return;
          try {
            const src  = ctx.createBufferSource();
            const gain = ctx.createGain();
            src.buffer = buf;
            gain.gain.value = SFX_GAIN_LINEAR;
            src.connect(gain).connect(ctx.destination);
            src.start(0);
          } catch {}
        });
      }
      for (const fn of muteSubs) { try { fn(mutedState); } catch {} }
    };

    const onMuteChange = (fn) => {
      muteSubs.add(fn);
      return () => muteSubs.delete(fn);
    };

    return { play, muted: isMuted, setMuted, onMuteChange };
  })();
