import { formatCoord } from './format.js';
import { highestPoint } from './weather.js';

function valid(point) {
  return point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lon))
    ? point
    : null;
}

function routeSummary(gpx) {
  let first = null;
  let last = null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  const include = (point) => {
    const coordinate = valid(point);
    if (!coordinate) return;
    const lat = Number(coordinate.lat);
    const lon = Number(coordinate.lon);
    if (!first) first = coordinate;
    last = coordinate;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  };
  for (const track of gpx?.tracks || []) {
    for (const segment of track.segments || []) {
      for (const point of segment || []) include(point);
    }
  }
  for (const route of gpx?.routes || []) {
    for (const point of route.points || []) include(point);
  }
  if (!first) {
    for (const point of gpx?.waypoints || []) include(point);
  }
  const center = first
    ? { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 }
    : null;
  return { first, last, center };
}

/** The four fixed coordinate sources. An arbitrary map point is supplied by the picker itself. */
export function coordinateTargets(gpx) {
  const summary = routeSummary(gpx);
  return {
    start: summary.first,
    end: summary.last,
    highest: valid(highestPoint(gpx)),
    center: summary.center,
  };
}

export function coordinateText(point) {
  return formatCoord(point);
}
