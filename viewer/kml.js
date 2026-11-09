// Parses KML 2.0-2.3 into the same model the GPX parser produces, so one drawing path covers both files.
// Handles LineString, gx:Track, MultiGeometry, nested Folder/Document, Point and Polygon.
// KML writes coordinates as "lon,lat,alt" - the opposite order of GPX - which is the easiest thing to get wrong here.

import { parseXml } from './gpx.js';
import { t } from './i18n.js';

/** @typedef {import('./types.js').TrackPoint} TrackPoint */
/** @typedef {import('./types.js').ParsedTrack} ParsedTrack */

export class KmlError extends Error {}

const MAX_DESCRIPTION = 200;
const MAX_INSIGHT_TEXT = 12000;
// Enough for an album, few enough that a pathological description cannot queue hundreds of requests.
const MAX_IMAGES = 9;
// Two pins closer than this are the same place: several apps write an automatic start/end pin next to the named one.
const PIN_PRECISION = 5;

function children(parent, name) {
  return Array.from(parent.children).filter((el) => el.localName === name);
}

function child(parent, name) {
  return children(parent, name)[0] || null;
}

function textOf(el) {
  const text = el?.textContent.trim();
  return text || null;
}

function childText(parent, name) {
  return textOf(child(parent, name));
}

/** Some exporters carry measured totals beside the geometry. TwoBulu uses milliseconds for these values. */
function metricSeconds(container, name) {
  if (!container) return undefined;
  for (const data of Array.from(container.getElementsByTagName('Data'))) {
    if (data.getAttribute('name') !== name) continue;
    const value = Number(childText(data, 'value'));
    if (Number.isFinite(value) && value >= 0) return value / 1000;
  }
  return undefined;
}

function isLatLon(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

/** <coordinates> holds "lon,lat[,alt]" tuples separated by whitespace. */
/** @returns {TrackPoint[]} */
export function parseCoordinates(raw) {
  const points = [];
  for (const tuple of (raw || '').trim().split(/\s+/)) {
    if (!tuple) continue;
    const parts = tuple.split(',');
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!isLatLon(lat, lon)) continue;
    const point = { lat, lon };
    const alt = Number(parts[2]);
    if (parts[2] !== undefined && parts[2].trim() !== '' && Number.isFinite(alt)) point.ele = alt;
    points.push(point);
  }
  return points;
}

/** gx:coord holds "lon lat alt", space separated. */
function parseGxCoord(raw) {
  const parts = (raw || '').trim().split(/\s+/);
  const point = parseCoordinates(`${parts[0]},${parts[1]},${parts[2] ?? ''}`);
  return point[0] || null;
}

function readTime(placemark) {
  const stamp = child(placemark, 'TimeStamp');
  const when = stamp && childText(stamp, 'when');
  if (when) {
    const time = Date.parse(when);
    if (!Number.isNaN(time)) return new Date(time);
  }
  const span = child(placemark, 'TimeSpan');
  const begin = span && childText(span, 'begin');
  if (begin) {
    const time = Date.parse(begin);
    if (!Number.isNaN(time)) return new Date(time);
  }
  return undefined;
}

/**
 * A description may carry HTML with photos. The text is flattened to plain text and the photo links are
 * kept apart, so the viewer can show them as images instead of guessing at markup.
 */
function readDescription(placemark) {
  const raw = childText(placemark, 'description');
  if (!raw) return { text: undefined, insightText: undefined, images: [] };
  const plain = raw.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const insightText = plain.length > MAX_INSIGHT_TEXT
    ? `${plain.slice(0, MAX_INSIGHT_TEXT - 1)}…`
    : plain;
  return {
    text: plain ? (plain.length > MAX_DESCRIPTION ? `${plain.slice(0, MAX_DESCRIPTION - 1)}…` : plain) : undefined,
    insightText: insightText || undefined,
    images: readImages(raw),
  };
}

/**
 * Photo links in document order. Absolute URLs, data URIs and paths relative to the document are kept;
 * any other scheme is dropped, so a description can never smuggle a javascript: or file: URL into the page.
 */
function readImages(raw) {
  const seen = new Set();
  const images = [];
  for (const match of raw.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    const url = match[1].trim().replace(/&amp;/g, '&');
    if (url === '' || seen.has(url)) continue;
    // A relative path has no colon before its first slash, question mark or hash.
    if (!/^(?:https?:\/\/|data:image\/|\/|[^:/?#]+(?:[/?#]|$))/i.test(url)) continue;
    seen.add(url);
    images.push(url);
    if (images.length === MAX_IMAGES) break;
  }
  return images;
}

/** A gx:Track keeps its times and its coordinates in two parallel lists that are matched by index. */
function readTrack(track) {
  const times = children(track, 'when').map((when) => Date.parse(when.textContent.trim()));
  const coords = [];
  let lastTime = null;
  // Keep the time index tied to the original coordinate. Filtering invalid coordinates first shifted every
  // later time by one when a malformed point appeared in the middle of the track.
  children(track, 'coord').forEach((coord, i) => {
    if (Number.isFinite(times[i])) lastTime = times[i];
    const point = parseGxCoord(coord.textContent);
    if (!point) return;
    if (lastTime !== null) point.time = new Date(lastTime);
    coords.push(point);
  });
  return coords;
}

/** First ring is the outline, the rest are holes; Leaflet draws a list of rings exactly that way. */
function readPolygon(polygon) {
  const rings = [];
  for (const boundary of ['outerBoundaryIs', 'innerBoundaryIs']) {
    for (const container of children(polygon, boundary)) {
      const ring = child(container, 'LinearRing');
      const points = ring ? parseCoordinates(childText(ring, 'coordinates') || '') : [];
      if (points.length > 2) rings.push(points);
    }
  }
  return rings;
}

function addWaypoint(waypoints, seen, point) {
  const key = `${point.lat.toFixed(PIN_PRECISION)},${point.lon.toFixed(PIN_PRECISION)}`;
  const existing = seen.get(key);
  if (!existing) {
    seen.set(key, point);
    waypoints.push(point);
    return;
  }
  // Same spot, two pins: keep the one that actually says something. Photos beat a bare name.
  const weight = (p) => (p.images && p.images.length > 0 ? 2 : 0) + (p.description ? 1 : 0);
  if (weight(point) > weight(existing)) {
    waypoints[waypoints.indexOf(existing)] = point;
    seen.set(key, point);
  }
}

function readPlacemark(placemark, out, styles) {
  const name = childText(placemark, 'name');
  const time = readTime(placemark);
  const { text: description, insightText, images } = readDescription(placemark);
  const styleUrl = childText(placemark, 'styleUrl');
  const inlineStyle = child(placemark, 'Style');
  const inlineIcon = inlineStyle && child(child(inlineStyle, 'Icon'), 'href');
  const icon = textOf(inlineIcon) || styles.get((styleUrl || '').replace(/^#/, '')) || styleUrl;

  const collect = (node) => {
    for (const geometry of node.children) {
      switch (geometry.localName) {
        case 'LineString': {
          const points = parseCoordinates(childText(geometry, 'coordinates') || '');
          if (points.length > 0) out.segments.push(points);
          break;
        }
        case 'Track': {
          const points = readTrack(geometry);
          if (points.length > 0) out.segments.push(points);
          break;
        }
        case 'MultiGeometry':
        case 'MultiTrack':
          collect(geometry);
          break;
        case 'Polygon': {
          const rings = readPolygon(geometry);
          if (rings.length > 0) out.areas.push({ name, rings });
          break;
        }
        case 'LinearRing': {
          const points = parseCoordinates(childText(geometry, 'coordinates') || '');
          if (points.length > 2) out.areas.push({ name, rings: [points] });
          break;
        }
        case 'Point': {
          const point = parseCoordinates(childText(geometry, 'coordinates') || '')[0];
          if (point) {
            out.points.push({
              ...point,
              name: name || undefined,
              time,
              description,
              insightText,
              images,
              icon: icon || undefined,
            });
          }
          break;
        }
        default:
          break;
      }
    }
  };

  collect(placemark);
}

/** Parses an already parsed KML document. Throws KmlError with a readable message. */
/** @returns {ParsedTrack} */
export function parseKmlDocument(doc) {
  const root = doc?.documentElement;
  if (!root || root.localName !== 'kml') throw new KmlError(t('error.notKml'));

  const tracks = [];
  const areas = [];
  const waypoints = [];
  const seen = new Map();
  const styles = new Map();
  for (const style of Array.from(doc.getElementsByTagName('Style'))) {
    if (!style.id) continue;
    const icon = child(style, 'Icon');
    const href = icon && child(icon, 'href');
    if (href) styles.set(style.id, textOf(href));
  }

  const visit = (node) => {
    for (const element of node.children) {
      if (element.localName === 'Placemark') {
        const found = { segments: [], areas: [], points: [] };
        readPlacemark(element, found, styles);
        if (found.segments.length > 0) {
          tracks.push({ name: childText(element, 'name'), segments: found.segments });
        }
        areas.push(...found.areas);
        for (const point of found.points) addWaypoint(waypoints, seen, point);
      } else if (element.localName === 'Folder' || element.localName === 'Document' || element.localName === 'kml') {
        visit(element);
      }
    }
  };
  visit(root);

  const documentNode = child(root, 'Document');
  const documentName = documentNode ? childText(documentNode, 'name') : null;
  const extended = documentNode || root;

  return {
    version: '2.2',
    // Same rule as the GPX parser: the document's own name, else the name of its only track.
    name: documentName
      || (tracks.length === 1 && areas.length === 0 ? tracks[0].name : null)
      || null,
    tracks,
    routes: [],
    waypoints,
    areas,
    timeUsedSeconds: metricSeconds(extended, 'TimeUsed'),
    pauseSeconds: metricSeconds(extended, 'PauseTime'),
  };
}

/** Parses KML text; the XML itself is parsed by gpx.js so both formats report errors the same way. */
export function parseKml(text) {
  return parseKmlDocument(parseXml(text));
}
