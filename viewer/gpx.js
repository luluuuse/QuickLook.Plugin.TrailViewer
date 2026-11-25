// Parses GPX 1.0 and 1.1 with DOMParser and computes the summary shown in the info box.
// Elements are matched by local name, so files with or without the GPX namespace both work.

import { t } from './i18n.js';
import { findTrackGaps, movementSummary } from './track-analysis.js';
import { createRouteModel } from './route-model.js';
import { cleanWaypointDescription } from './waypoint-description.js';

/** @typedef {import('./types.js').TrackPoint} TrackPoint */
/** @typedef {import('./types.js').ParsedTrack} ParsedTrack */
/** @typedef {import('./types.js').TrackSummary} TrackSummary */

export class GpxError extends Error {}

/** An absolute HTTPS URL with no whitespace -- safe to load as a remote photo or hand to the browser. */
const MEDIA_URL_RE = /^https:\/\/[^\s<>"]+$/i;
const IMAGE_EXT_RE = /\.(?:jpe?g|png|gif|webp|avif|bmp|heic|heif)$/i;
const IMAGE_LINK_TEXT_RE = /^(?:media|photo|image|img|picture)$/i;
const MAX_IMAGES = 9;

function isImageLinkElement(linkEl, href) {
  if (!MEDIA_URL_RE.test(href)) return false;
  const linkType = childText(linkEl, 'type');
  if (linkType && /^image\//i.test(linkType)) return true;
  const linkText = childText(linkEl, 'text');
  if (linkText && IMAGE_LINK_TEXT_RE.test(linkText)) return true;
  const pathPart = href.split(/[?#]/)[0];
  return IMAGE_EXT_RE.test(pathPart);
}

function children(parent, name) {
  return Array.from(parent.children).filter((el) => el.localName === name);
}

function childText(parent, name) {
  const el = children(parent, name)[0];
  const text = el?.textContent.trim();
  return text || null;
}

function extensionHeartRate(extensions) {
  for (const extension of extensions) {
    for (const node of extension.getElementsByTagName('*')) {
      const name = node.localName.toLowerCase();
      if (name !== 'hr' && name !== 'heartrate' && name !== 'heartratebpm') continue;
      const raw = name === 'heartratebpm'
        ? Array.from(node.children).find((el) => el.localName.toLowerCase() === 'value')?.textContent.trim() || null
        : node.textContent.trim();
      const value = Number(raw);
      if (Number.isFinite(value) && value > 0 && value < 255) return value;
    }
  }
  return null;
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
  const direct = new Map();
  const extensions = [];
  const imageLinks = [];
  for (const child of el.children) {
    if (child.localName === 'extensions') extensions.push(child);
    if (child.localName === 'link') {
      const href = (child.getAttribute('href') || '').trim();
      if (isImageLinkElement(child, href)) imageLinks.push(href);
    }
    if (!direct.has(child.localName)) direct.set(child.localName, child.textContent.trim());
  }
  const text = (name) => direct.get(name) || null;
  // Some exporters (2bulu) put the photo URL into <desc> as its only content. That is not a remark:
  // lift it into point.images so the waypoint behaves like any other photo waypoint.
  const urlOnly = (value) => {
    if (value === null) return null;
    const parts = value.split(/\s+/).filter(Boolean);
    return parts.length > 0 && parts.every((part) => MEDIA_URL_RE.test(part)) ? parts : null;
  };
  let rawDescValue = text('desc');
  let rawCmtValue = text('cmt');
  const descUrls = urlOnly(rawDescValue);
  if (descUrls) { imageLinks.push(...descUrls); rawDescValue = null; }
  const cmtUrls = urlOnly(rawCmtValue);
  if (cmtUrls) { imageLinks.push(...cmtUrls); rawCmtValue = null; }
  if (imageLinks.length > 0) point.images = [...new Set(imageLinks)].slice(0, MAX_IMAGES);
  const ele = text('ele');
  if (ele !== null && Number.isFinite(Number(ele))) point.ele = Number(ele);
  const time = text('time');
  if (time !== null && !Number.isNaN(Date.parse(time))) point.time = new Date(time);
  const name = text('name');
  if (name !== null) point.name = name;
  const rawDesc = rawDescValue;
  const rawCmt = rawCmtValue;
  if (rawDesc !== null || rawCmt !== null) {
    const cleanedDesc = rawDesc !== null ? cleanWaypointDescription(rawDesc, { html: false }) : null;
    const cleanedCmt = !cleanedDesc?.text && rawCmt !== null && rawCmt !== rawDesc
      ? cleanWaypointDescription(rawCmt, { html: false })
      : null;
    const description = cleanedDesc?.text || cleanedCmt?.text || null;
    if (description !== null) {
      point.description = description;
      point.insightText = description;
    }
    const fallbackTime = cleanedDesc?.time || cleanedCmt?.time;
    if (!point.time && fallbackTime) point.time = fallbackTime;
  }
  const symbol = text('sym');
  if (symbol !== null) point.icon = symbol;
  const heartRate = extensionHeartRate(extensions);
  if (heartRate !== null) point.heartRate = heartRate;
  return point;
}

function readPoints(parent, name) {
  return children(parent, name).map(readPoint).filter(Boolean);
}

export { distanceMeters } from './geo.js';

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
    description: childText(trk, 'desc'),
    type: childText(trk, 'type'),
    segments: children(trk, 'trkseg').map((seg) => readPoints(seg, 'trkpt')).filter((pts) => pts.length > 0),
  }));
  const routes = children(root, 'rte')
    .map((rte) => ({
      name: childText(rte, 'name'),
      description: childText(rte, 'desc'),
      type: childText(rte, 'type'),
      points: readPoints(rte, 'rtept'),
    }))
    .filter((rte) => rte.points.length > 0);
  const waypoints = readPoints(root, 'wpt');

  const description = (metadata && childText(metadata, 'desc'))
    || childText(root, 'desc')
    || (tracks.length === 1 && routes.length === 0 ? tracks[0].description : null)
    || (routes.length === 1 && tracks.length === 0 ? routes[0].description : null)
    || null;
  const activityType = tracks.find((trk) => trk.type)?.type
    || routes.find((rte) => rte.type)?.type
    || null;

  return {
    version: root.getAttribute('version'),
    // The file's own name, else the name of its only track or route; several tracks show the file name.
    name: (metadata && childText(metadata, 'name')) || childText(root, 'name')
      || (tracks.length === 1 && routes.length === 0 ? tracks[0].name : null)
      || (routes.length === 1 && tracks.length === 0 ? routes[0].name : null),
    description,
    activityType,
    tracks: tracks.map(({ name, segments }) => ({ name, segments })),
    routes: routes.map(({ name, points }) => ({ name, points })),
    waypoints,
  };
}

/** Totals for the info box. Distance is the track length, or the route length when there are no tracks. */
/** @param {ParsedTrack} gpx @param {ReturnType<typeof createRouteModel>} [routeModel] @returns {TrackSummary} */
export function summarize(gpx, routeModel = null) {
  let segmentCount = 0;
  let trackPointCount = 0;
  let lowest = Infinity;
  let highest = -Infinity;
  let trackStart = null;
  let trackEnd = null;
  let routeStart = null;
  let routeEnd = null;
  let waypointStart = null;
  let waypointEnd = null;
  const model = routeModel || createRouteModel(gpx);
  if (gpx.network) {
    const points = model.tracks.reduce((sum, line) => sum + line.points.length, 0);
    return {
      tracks: gpx.tracks.length,
      segments: model.tracks.length,
      routes: gpx.routes.length,
      waypoints: gpx.waypoints.length,
      areas: gpx.areas?.length || 0,
      points,
      distanceMeters: model.distanceMeters,
      start: null,
      end: null,
      durationSeconds: null,
      movingDurationSeconds: null,
      pausedSeconds: null,
      movingTimeSource: 'network',
      stops: 0,
      gaps: 0,
      gapEvents: 0,
      gapDistanceMeters: 0,
      anomalies: 0,
      anomalyEvents: 0,
      anomalyDistanceMeters: 0,
      elevation: false,
      network: true,
    };
  }
  for (const line of model.tracks) {
    segmentCount += 1;
    trackPointCount += line.points.length;
    for (const point of line.points) {
      if (point.time) {
        if (!trackStart || point.time < trackStart) trackStart = point.time;
        if (!trackEnd || point.time > trackEnd) trackEnd = point.time;
      }
      if (point.ele === undefined) continue;
      if (point.ele < lowest) lowest = point.ele;
      if (point.ele > highest) highest = point.ele;
    }
  }
  for (const line of model.routes) {
    for (const point of line.points) {
      if (point.time) {
        if (!routeStart || point.time < routeStart) routeStart = point.time;
        if (!routeEnd || point.time > routeEnd) routeEnd = point.time;
      }
    }
  }
  for (const point of gpx.waypoints) {
    if (!point.time) continue;
    if (!waypointStart || point.time < waypointStart) waypointStart = point.time;
    if (!waypointEnd || point.time > waypointEnd) waypointEnd = point.time;
  }

  const distance = model.distanceMeters;

  // Use the measured route first, without flattening its points into temporary arrays. Waypoint timestamps
  // often describe a planned stop and can sit outside the recording.
  const timeline = trackPointCount > 0 ? 'track' : model.routes.length > 0 ? 'route' : 'waypoint';
  const start = timeline === 'track' ? trackStart : timeline === 'route' ? routeStart : waypointStart;
  const end = timeline === 'track' ? trackEnd : timeline === 'route' ? routeEnd : waypointEnd;
  const movement = movementSummary(gpx.tracks);
  const gaps = findTrackGaps(gpx.tracks);
  const measuredDuration = start && end
    ? Math.round((end.getTime() - start.getTime()) / 1000)
    : null;
  const duration = Number.isFinite(gpx.timeUsedSeconds)
    ? Math.round(gpx.timeUsedSeconds)
    : measuredDuration;
  const metadataPause = Number.isFinite(gpx.pauseSeconds) && duration !== null
    ? Math.min(duration, Math.max(0, Math.round(gpx.pauseSeconds)))
    : null;
  const movingDuration = metadataPause !== null ? duration - metadataPause : movement.movingDurationSeconds;
  const pausedDuration = duration !== null && movingDuration !== null
    ? Math.max(0, duration - movingDuration)
    : movement.pausedSeconds;

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
    pausedSeconds: pausedDuration,
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
