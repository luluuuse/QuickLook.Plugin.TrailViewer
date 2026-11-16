import { distanceMeters } from './geo.js';

/**
 * Immutable geometry index shared by the summary, map, profile and analysis code. Distance is measured once
 * per recorded point pair; cumulative arrays keep consumers from rebuilding the same route walk.
 * @param {import('./types.js').ParsedTrack} gpx
 */
export function createRouteModel(gpx) {
  let trackDistanceMeters = 0;
  let routeDistanceMeters = 0;
  const trackGroups = [];
  const tracks = [];

  for (const track of gpx.tracks || []) {
    const lines = [];
    for (let segmentIndex = 0; segmentIndex < track.segments.length; segmentIndex += 1) {
      const points = track.segments[segmentIndex];
      const cumulative = new Float64Array(points.length);
      for (let index = 1; index < points.length; index += 1) {
        cumulative[index] = cumulative[index - 1] + distanceMeters(points[index - 1], points[index]);
      }
      const length = cumulative[points.length - 1] || 0;
      const line = {
        kind: 'track',
        points,
        cumulative,
        startMeters: trackDistanceMeters,
        length,
        track,
        segmentIndex,
      };
      lines.push(line);
      tracks.push(line);
      trackDistanceMeters += length;
    }
    trackGroups.push({ track, segments: lines });
  }

  const routes = [];
  let routeOffset = trackDistanceMeters;
  for (const route of gpx.routes || []) {
    const points = route.points;
    const cumulative = new Float64Array(points.length);
    for (let index = 1; index < points.length; index += 1) {
      cumulative[index] = cumulative[index - 1] + distanceMeters(points[index - 1], points[index]);
    }
    const length = cumulative[points.length - 1] || 0;
    routes.push({
      kind: 'route',
      points,
      cumulative,
      startMeters: routeOffset,
      length,
      route,
    });
    routeOffset += length;
    routeDistanceMeters += length;
  }

  return {
    trackGroups,
    tracks,
    routes,
    lines: [...tracks, ...routes],
    trackDistanceMeters,
    routeDistanceMeters,
    distanceMeters: tracks.length > 0 ? trackDistanceMeters : routeDistanceMeters,
  };
}

export function lineDistanceAt(line, index) {
  return line.startMeters + (line.cumulative[index] || 0);
}
