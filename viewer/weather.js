// Weather hand-off for the current track. The viewer does not embed a third-party map: it builds a Windy
// deep link for a chosen point of the route and lets the host open it in the default browser. That keeps the
// page free of extra network origins and of any API key.
//
// Windy accepts one URL shape, /lat/lon?lat,lon,zoom. The query string alone only pans the map; repeating the
// point in the path is what makes the site expand its point-forecast panel. The zoom decides whether the
// place is recognisable, so every target here is opened at street level.

const WINDY_BASE = 'https://www.windy.com/';

// Street level. A whole-route overview would need a wider level, but all three targets are single places.
export const POINT_ZOOM = 14;

export const WEATHER_TARGETS = Object.freeze(['start', 'end', 'highest']);

function trackPoints(gpx) {
  const list = [];
  for (const track of gpx?.tracks || []) {
    for (const segment of track.segments || []) {
      for (const point of segment || []) list.push(point);
    }
  }
  for (const route of gpx?.routes || []) {
    for (const point of route.points || []) list.push(point);
  }
  return list;
}

function valid(point) {
  if (!point) return null;
  const lat = Number(point.lat);
  const lon = Number(point.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/**
 * The point Windy should open on.
 * @param {'start'|'end'|'highest'} mode
 */
export function weatherTarget(gpx, mode = 'start') {
  const all = trackPoints(gpx);
  const first = all[0] || gpx?.waypoints?.[0] || null;
  const last = all[all.length - 1] || gpx?.waypoints?.[gpx.waypoints.length - 1] || null;
  if (mode === 'end') return valid(last);
  if (mode === 'highest') return valid(highestPoint(gpx));
  return valid(first);
}

/**
 * The recorded point with the greatest elevation. Network KML skips elevation on purpose, and many 2D tracks
 * carry none either, so a file without any height simply has no highest point rather than a guessed one.
 *
 * A flat file that writes the same height everywhere (0 m exports, for instance) has no summit worth naming:
 * the "highest" point would be an arbitrary first sample, which reads as a wrong answer rather than a fallback.
 */
export function highestPoint(gpx) {
  let best = null;
  let bestEle = -Infinity;
  let lowestEle = Infinity;
  let count = 0;
  for (const point of trackPoints(gpx)) {
    const ele = Number(point.ele);
    if (!Number.isFinite(ele)) continue;
    count += 1;
    if (ele < lowestEle) lowestEle = ele;
    if (ele > bestEle) {
      bestEle = ele;
      best = point;
    }
  }
  if (best === null || count < 2) return null;
  // Less than a metre of relief across the whole route is a flat file, not a summit.
  return bestEle - lowestEle >= 1 ? best : null;
}

/** True when the file carries elevation at all; the highest-point target is unavailable otherwise. */
export function hasElevation(gpx) {
  return highestPoint(gpx) !== null;
}

/** Which targets this file can actually open. */
export function availableTargets(gpx) {
  const hasPoint = trackPoints(gpx).length > 0 || (gpx?.waypoints?.length || 0) > 0;
  return WEATHER_TARGETS.filter((mode) => {
    if (mode === 'highest') return hasElevation(gpx);
    return hasPoint;
  });
}

/** Every target opens at the same level: they are all one place. */
export function zoomFor(mode = 'start') {
  void mode;
  return POINT_ZOOM;
}

// Cloud cover is the layer that answers "will I be in the fog or under the sun", which is what a hiker opens
// the weather for. Windy accepts it as the first query segment and keeps the point-forecast panel either way.
export const WINDY_OVERLAY = 'clouds';

/**
 * Windy share URL. The point appears both as the path and in the query string; the path is what expands the
 * point-forecast panel, the overlay segment picks the layer, and the coordinates give the map its centre and
 * zoom. Windy normalises the order itself, so the segments go in its documented order.
 */
export function windyUrl(target, zoom = POINT_ZOOM, overlay = WINDY_OVERLAY) {
  if (!target) return null;
  const lat = target.lat.toFixed(4);
  const lon = target.lon.toFixed(4);
  const layer = overlay ? `${overlay},` : '';
  return `${WINDY_BASE}${lat}/${lon}?${layer}${lat},${lon},${zoom}`;
}

/** Opens a URL in the default browser. The host cancels in-page navigation and hands https links to the OS. */
export function openExternal(url) {
  if (!url) return false;
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.append(link);
  link.click();
  link.remove();
  return true;
}
