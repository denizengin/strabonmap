// core/easing.js — shared named easing curves + the distance-aware leg
// duration helper used by the inter-card mini-route animation on mobile
// and (later, E23 layer 2) the trip-load pan on desktop.
//
// Shared by index.html + mobile.html. No DOM, no globals — every function
// here is pure. Loaded as plain browser globals; tests/core-loader.js
// scrapes the top-level consts.
//
// Why named curves: the same easing math was being re-typed inline in
// several places (e.g. mobile.html L4649: `t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2`)
// and the spec calls for new curves landing in both surfaces. Putting
// the math in one tiny module keeps the call sites readable and the
// behavior consistent across the artifact.

  // --- 1. Standard easing curves. All take t in [0, 1] and return the
  // eased value in [0, 1]. The unclamped path (t < 0 or t > 1) is
  // explicitly NOT supported — callers must clamp first.

  // Linear — included for completeness and as the explicit-no-easing path.
  const linear = (t) => t;

  // Cubic ease-in: slow start, fast end. Good for fading IN.
  const easeInCubic = (t) => t * t * t;

  // Cubic ease-out: fast start, slow end. Good for arrivals (e.g. the
  // settle at a stop after a pan).
  const easeOutCubic = (t) => {
    const u = 1 - t;
    return 1 - u * u * u;
  };

  // Cubic ease-in-out: slow start, fast middle, slow end. The canonical
  // "cinematic" curve. Used for trip-load pans and the inter-card route
  // mini-animation. Same shape as the inlined math at mobile.html ~L4649
  // (a quadratic ease-in-out) but cubic — slightly stronger settle.
  const easeInOutCubic = (t) => {
    if (t < 0.5) return 4 * t * t * t;
    const u = -2 * t + 2;
    return 1 - (u * u * u) / 2;
  };

  // Quadratic ease-in-out (the curve mobile.html was inlining before).
  // Kept available for cases where a softer S-curve is wanted.
  const easeInOutQuad = (t) => {
    if (t < 0.5) return 2 * t * t;
    const u = -2 * t + 2;
    return 1 - (u * u) / 2;
  };

  // --- 2. Distance-aware leg duration.
  //
  // Problem this solves: mobile.html's inter-card route animation was
  // a fixed 1800ms regardless of how far apart the two cities were. A
  // continental leg blurred past at the same pace as a short hop.
  //
  // Scale duration by the on-screen route length (in pixels) so the
  // plane reads at a roughly-consistent visual speed. Clamp to a sane
  // min and max — a tiny hop shouldn't be instant, and a continental
  // leg shouldn't drag past the user's patience.
  //
  // Tuned constants:
  //   baseDuration: the duration we'd use for a "typical" leg (the
  //     midpoint of the clamp range below). 1800ms matches the prior
  //     fixed mobile value so existing scenarios stay close to today.
  //   pxPerMs:      visual speed target. 0.30 px/ms = a 300px leg
  //     takes ~1000ms; a 1000px leg takes ~3.3s before clamping.
  //   minMs/maxMs:  clamp range. 800ms keeps short hops readable;
  //     3000ms is the upper limit before the animation drags.
  //
  // The `reduced` flag halves the result (so prefers-reduced-motion
  // users get the same proportional scaling, just compressed) without
  // duplicating the formula at every call site.
  const legDurationMs = (lengthPx, reduced) => {
    const pxPerMs = 0.30;
    const minMs   = 800;
    const maxMs   = 3000;
    const raw     = Math.max(0, lengthPx | 0) / pxPerMs;
    const clamped = Math.max(minMs, Math.min(maxMs, raw));
    return reduced ? Math.max(400, Math.round(clamped * 0.5)) : Math.round(clamped);
  };

  // --- 3. Convenience: pick a curve by name. Lets callers parametrize
  // (e.g. "use easeInOutCubic for trip-load pans, easeOutCubic for the
  // settle-at-stop") without each surface importing every name.
  const CURVES = {
    linear,
    easeInCubic,
    easeOutCubic,
    easeInOutCubic,
    easeInOutQuad,
  };
  const ease = (name, t) => {
    const fn = CURVES[name] || easeInOutCubic;
    return fn(Math.max(0, Math.min(1, t)));
  };
