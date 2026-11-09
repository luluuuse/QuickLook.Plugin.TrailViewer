// Parses GPX 1.0 and 1.1 with DOMParser and computes the summary shown in the info box.
// Elements are matched by local name, so files with or without the GPX namespace both work.

import { t } from './i18n.js';
import { distanceMeters } from './geo.js';
import { findTrackGaps, movementSummary } from './track-analysis.js';

/** @typedef {import('./types.js').TrackPoint} TrackPoint */
/** @typedef {import('./types.js').ParsedTrack} ParsedTrack */
/** @typedef {import('./types.js').TrackSummary} TrackSummary */

export class GpxError extends Error {}

function children(parent, name) {
  return Array.from(parent.children).filter((el) => el.localName === name);
}

function childText(parent, name) {
  const el = children(parent, name)[0];
  const text = el?.textContent.trim();
  return text || null;
}

/** @returns {TrackPoint | null} */
function readPoint(el) {
  const lat = Number(el.getAttribute('lat'));
  const lon = Number(el.getAttribute('lon'));
  if (!el.hasAttribute('lat') || !el.hasAttribute('lon') || !Number.isFinite(lat) || !Number.isFinite(lon)
      || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return null;
  }
  const point = { lat, lon };
  const ele = childText(el, 'ele');
  if (ele !== null && Number.isFinite(Number(ele))) point.ele = Number(ele);
  const time = childText(el, 'time');
  if (time !== null && !Number.isNaN(Date.parse(time))) point.time = new Date(time);
  const name = childText(el, 'name');
  if (name !== null) point.name = name;
  const description = childText(el, 'desc') || childText(el, 'cmt');
  if (description !== null) {
    point.description = description;
    point.insightText = description;
  }
  const symbol = childText(el, 'sym');
  if (symbol !== null) point.icon = symbol;
  return point;
}

function readPoints(parent, name) {
  return children(parent, name).map(readPoint).filter(Boolean);
}

export { distanceMeters } from './geo.js';

function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceMeters(points[i - 1], points[i]);
  return total;
}

/** Parses XML text once, for either format. Throws GpxError when the text is not well-formed XML. */
export function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const error = doc.getElementsByTagName('parsererror')[0];
  if (error) {
    // Chromium puts the parser message in a <div> inside <parsererror>.
    const detail = (error.querySelector('div')?.textContent || error.textContent || '').trim().split('\n')[0];
    throw new GpxError(t('error.notXml', { detail }));
  }
  return doc;
}

/** Parses GPX text. Throws GpxError with a readable message when the file cannot be shown. */
export function parseGpx(text) {
  return parseGpxDocument(parseXml(text));
}

/** Parses an already parsed GPX document. */
/** @returns {ParsedTrack} */
export function parseGpxDocument(doc) {
  const root = doc?.documentElement;
  if (!root || root.localName !== 'gpx') throw new GpxError(t('error.notGpx'));

  const metadata = children(root, 'metadata')[0];
  const tracks = children(root, 'trk').map((trk) => ({
    name: childText(trk, 'name'),
    segments: children(trk, 'trkseg').map((seg) => readPoints(seg, 'trkpt')).filter((pts) => pts.length > 0),
  }));
  const routes = children(root, 'rte')
    .map((rte) => ({ name: childText(rte, 'name'), points: readPoints(rte, 'rtept') }))
    .filter((rte) => rte.points.length > 0);
  const waypoints = readPoints(root, 'wpt');

  return {
    version: root.getAttribute('version'),
    // The file's own name, else the name of its only track or route; several tracks show the file name.
    name: (metadata && childText(metadata, 'name')) || childText(root, 'name')
      || (tracks.length === 1 && routes.length === 0 ? tracks[0].name : null)
      || (routes.length === 1 && tracks.length === 0 ? routes[0].name : null),
    tracks,
    routes,
    waypoints,
  };
}

/** Totals for the info box. Distance is the track length, or the route length when there are no tracks. */
/** @param {ParsedTrack} gpx @returns {TrackSummary} */
export function summarize(gpx) {
  let segmentCount = 0;
  let trackPointCount = 0;
  let trackDistance = 0;
  let routeDistance = 0;
  let lowest = Infinity;
  let highest = -Infinity;
  for (const track of gpx.tracks) {
    for (const segment of track.segments) {
      segmentCount += 1;
      trackPointCount += segment.length;
      trackDistance += pathLength(segment);
      for (const point of segment) {
        if (point.ele === undefined) continue;
        if (point.ele < lowest) lowest = point.ele;
        if (point.ele > highest) highest = point.ele;
      }
    }
  }
  for (const route of gpx.routes) routeDistance += pathLength(route.points);

  const distance = segmentCount > 0 ? trackDistance : routeDistance;

  // Use the measured route first, without flattening its points into temporary arrays. Waypoint timestamps
  // often describe a planned stop and can sit outside the recording.
  let start = null;
  let end = null;
  const timeline = trackPointCount > 0 ? 'track' : gpx.routes.some((route) => route.points.length > 0) ? 'route' : 'waypoint';
  const consider = (point) => {
    if (!point.time) return;
    if (!start || point.time < start) start = point.time;
    if (!end || point.time > end) end = point.time;
  };
  if (timeline === 'track') {
    for (const track of gpx.tracks) for (const segment of track.segments) for (const point of segment) consider(point);
  } else if (timeline === 'route') {
    for (const route of gpx.routes) for (const point of route.points) consider(point);
  } else {
    for (const point of gpx.waypoints) consider(point);
  }
  const movement = movementSummary(gpx.tracks);
  const gaps = findTrackGaps(gpx.tracks);
  const measuredDuration = start && end ? Math.round((end - start) / 1000) : null;
  const duration = Number.isFinite(gpx.timeUsedSeconds)
    ? Math.round(gpx.timeUsedSeconds)
    : measuredDuration;
  const metadataPause = Number.isFinite(gpx.pauseSeconds) && duration !== null
    ? Math.min(duration, Math.max(0, Math.round(gpx.pauseSeconds)))
    : null;
  const movingDuration = metadataPause !== null ? duration - metadataPause : movement.movingDurationSeconds;

  return {
    tracks: gpx.tracks.length,
    segments: segmentCount,
    routes: gpx.routes.length,
    waypoints: gpx.waypoints.length,
    areas: gpx.areas?.length || 0,
    points: trackPointCount,
    distanceMeters: distance,
    start,
    end,
    durationSeconds: duration,
    movingDurationSeconds: movingDuration,
    pausedSeconds: metadataPause ?? movement.pausedSeconds,
    movingTimeSource: metadataPause !== null ? 'metadata' : 'estimated',
    stops: movement.stops + movement.timeGaps,
    gaps: gaps.segmentCount,
    gapEvents: gaps.items.filter((item) => item.kind === 'segment').length,
    gapDistanceMeters: gaps.segmentDistanceMeters,
    anomalies: gaps.jumpCount,
    anomalyEvents: gaps.items.filter((item) => item.kind === 'jump').length,
    anomalyDistanceMeters: gaps.jumpDistanceMeters,
    elevation: Number.isFinite(lowest) && Number.isFinite(highest) && highest - lowest >= 1,
  };
}
