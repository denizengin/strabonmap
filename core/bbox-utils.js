// core/bbox-utils.js — E-per-trip-bbox. Pure helpers used by the trip
// editor + camera. No DOM. The renderer wires these in; the unit suite
// covers the math.
//
// bbox is always [minLon, minLat, maxLon, maxLat] in lon/lat degrees,
// matching the rest of the project (core/viewports.js, geo-data.js).

  /* bboxFromStops(cities, padPct = 0.20)
   *
   * Auto-derive a bbox from a list of stops, padded by `padPct` of the
   * span on each side. Council backward-compat rule: existing trips
   * with no bbox get this at load time, in memory only — not persisted
   * unless the user saves a preset.
   *
   * Returns null if `cities` is empty. Single-stop trips get a tiny
   * synthetic span (0.5° each side) so the camera doesn't divide by
   * zero. Pad is symmetric in degrees, not relative — Cyprus stays
   * Cyprus-shaped, not stretched into a rectangle.
   */
  const bboxFromStops = (cities, padPct) => {
    const arr = (cities || []).filter((c) => c && typeof c.lon === 'number' && typeof c.lat === 'number');
    if (!arr.length) return null;
    const pad = (typeof padPct === 'number') ? padPct : 0.20;
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const c of arr) {
      if (c.lon < minLon) minLon = c.lon;
      if (c.lon > maxLon) maxLon = c.lon;
      if (c.lat < minLat) minLat = c.lat;
      if (c.lat > maxLat) maxLat = c.lat;
    }
    let dLon = maxLon - minLon;
    let dLat = maxLat - minLat;
    if (dLon < 0.5) dLon = 0.5;       // single stop / coincident stops
    if (dLat < 0.5) dLat = 0.5;
    return [
      minLon - dLon * pad,
      minLat - dLat * pad,
      maxLon + dLon * pad,
      maxLat + dLat * pad,
    ];
  };

  /* bboxIsValid(bbox)
   * Shape + ordering check. minLon < maxLon, minLat < maxLat, all
   * finite, lon in [-180,180], lat in [-90,90]. Returns boolean.
   */
  const bboxIsValid = (bbox) => {
    if (!Array.isArray(bbox) || bbox.length !== 4) return false;
    const [w, s, e, n] = bbox;
    for (const v of bbox) if (typeof v !== 'number' || !isFinite(v)) return false;
    if (w >= e || s >= n) return false;
    if (w < -180 || e > 180) return false;
    if (s < -90 || n > 90) return false;
    return true;
  };

  /* bboxCenter(bbox) -> { lat, lon }
   * Plain centroid of the rectangle. Camera initial-frame uses this.
   */
  const bboxCenter = (bbox) => ({
    lon: (bbox[0] + bbox[2]) / 2,
    lat: (bbox[1] + bbox[3]) / 2,
  });

  /* clampCenterToBbox(center, bbox)
   * Council verdict: pan is locked to the bbox. The renderer keeps the
   * VIEW CENTRE inside the bbox so the user can't pan into pure ocean
   * outside their trip's frame. Returns a new {lat,lon}, never mutates.
   *
   * NB: this is a centre-clamp, not a viewport-edge clamp. A future
   * pass can tighten it to "no edge of the canvas leaves the bbox" once
   * the renderer exposes the per-zoom screen-to-world ratio. For v1 a
   * centre-clamp is the cheap, predictable rule the user sees.
   */
  const clampCenterToBbox = (center, bbox) => {
    if (!bboxIsValid(bbox)) return center;
    return {
      lat: Math.min(bbox[3], Math.max(bbox[1], center.lat)),
      lon: Math.min(bbox[2], Math.max(bbox[0], center.lon)),
    };
  };

  /* fitZoomForBbox(bbox, w, h)
   * Returns the zoom value at which `bbox` fills `w x h` (canvas px),
   * with letterboxing on the shorter axis (council verdict — preserve
   * the storyteller's framing). Matches the rest of the app's Mercator-
   * at-256px-tile assumption: pxPerUnit = 256 * 2^zoom.
   *
   * The returned zoom may include the slider's 2-11 range; callers
   * should clamp.
   */
  const fitZoomForBbox = (bbox, w, h) => {
    if (!bboxIsValid(bbox) || !w || !h) return 4.4;
    const lonSpan = bbox[2] - bbox[0];
    const latSpan = bbox[3] - bbox[1];
    // Mercator: lat span at high latitudes is wider in projected pixels.
    // Use the bbox centre's latitude factor as an approximation — fine
    // for the scales this app cares about (canvas widths < 2000px).
    const cLat = (bbox[1] + bbox[3]) / 2;
    const latRad = cLat * Math.PI / 180;
    const mercLatStretch = 1 / Math.cos(latRad);
    const lonZoom = Math.log2(w / (256 * (lonSpan / 360)));
    const latZoom = Math.log2(h / (256 * (latSpan / 360) * mercLatStretch));
    // Letterbox: pick the SMALLER zoom so both axes fit; the shorter
    // axis gets ocean padding.
    return Math.min(lonZoom, latZoom);
  };
