import { formatCoord } from './format.js';
import { highestPoint } from './weather.js';

export const COORDINATE_MODES = Object.freeze(['start', 'end', 'highest']);

function valid(point) {
  return point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lon))
    ? point
    : null;
}

function routeEnds(gpx) {
  let first = null;
  let last = null;
  for (const track of gpx?.tracks || []) {
    for (const segment of track.segments || []) {
      for (const point of segment || []) {
        const coordinate = valid(point);
        if (!coordinate) continue;
        if (!first) first = coordinate;
        last = coordinate;
      }
    }
  }
  for (const route of gpx?.routes || []) {
    for (const point of route.points || []) {
      const coordinate = valid(point);
      if (!coordinate) continue;
      if (!first) first = coordinate;
      last = coordinate;
    }
  }
  if (!first) {
    const waypoints = (gpx?.waypoints || []).map(valid).filter(Boolean);
    first = waypoints[0] || null;
    last = waypoints[waypoints.length - 1] || null;
  }
  return { first, last };
}

/** The four fixed coordinate sources. An arbitrary map point is supplied by the picker itself. */
export function coordinateTargets(gpx) {
  const ends = routeEnds(gpx);
  return {
    start: ends.first,
    end: ends.last,
    highest: valid(highestPoint(gpx)),
  };
}

export function coordinateText(point) {
  return formatCoord(point);
}
