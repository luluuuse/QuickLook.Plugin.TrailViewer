import { isValidHeartRate } from './track-analysis.js';

const GARMIN_NAME_LIMIT = 15;

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function normalizeLon(value) {
  let lon = Number(value);
  if (!Number.isFinite(lon)) return lon;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return lon;
}

function formatCoord(value) {
  return Number(value).toFixed(7).replace(/\.?0+$/, '');
}

function formatEle(value) {
  return Number(value).toFixed(2).replace(/\.?0+$/, '');
}

function formatTime(value) {
  if (!(value instanceof Date)) return '';
  const ms = value.getTime();
  return Number.isFinite(ms) ? value.toISOString() : '';
}

function cleanSegmentPoints(points, watchFriendly) {
  const cleaned = [];
  for (const pt of points || []) {
    if (!Number.isFinite(pt?.lat) || !Number.isFinite(pt?.lon)) continue;
    if (watchFriendly && cleaned.length > 0) {
      const prev = cleaned[cleaned.length - 1];
      if (Math.abs(prev.lat - pt.lat) < 1e-8 && Math.abs(prev.lon - pt.lon) < 1e-8
        && prev.ele === pt.ele) {
        continue;
      }
    }
    cleaned.push(pt);
  }
  return cleaned;
}

/**
 * Checks whether waypoint names exceed Garmin's 15-character limit or collide after truncation.
 * @param {import('./types.js').TrackPoint[]} waypoints
 */
export function findGarminWaypointWarnings(waypoints) {
  const truncatedCounts = new Map();
  let tooLongCount = 0;
  for (const wpt of waypoints || []) {
    const name = String(wpt?.name || '').trim();
    if (!name) continue;
    if (name.length > GARMIN_NAME_LIMIT) tooLongCount += 1;
    const key = name.slice(0, GARMIN_NAME_LIMIT).toLowerCase();
    truncatedCounts.set(key, (truncatedCounts.get(key) || 0) + 1);
  }
  let collisionCount = 0;
  for (const count of truncatedCounts.values()) {
    if (count > 1) collisionCount += 1;
  }
  return { tooLongCount, collisionCount };
}

/**
 * Serializes a ParsedTrack to UTF-8 (without BOM) GPX 1.1 XML.
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {{ creator?: string, watchFriendly?: boolean }} [options]
 */
export function serializeGpx(parsed, {
  creator = 'QuickLook.Plugin.TrailViewer',
  watchFriendly = true,
} = {}) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="${escapeXml(creator)}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">`,
  ];

  const docName = parsed?.name ? String(parsed.name).trim() : '';
  if (docName) {
    lines.push(`  <metadata><name>${escapeXml(docName)}</name></metadata>`);
  }

  for (const wpt of parsed?.waypoints || []) {
    if (!Number.isFinite(wpt?.lat) || !Number.isFinite(wpt?.lon)) continue;
    lines.push(`  <wpt lat="${formatCoord(wpt.lat)}" lon="${formatCoord(normalizeLon(wpt.lon))}">`);
    if (Number.isFinite(wpt.ele)) lines.push(`    <ele>${formatEle(wpt.ele)}</ele>`);
    const iso = formatTime(wpt.time);
    if (iso) lines.push(`    <time>${iso}</time>`);
    if (wpt.name) lines.push(`    <name>${escapeXml(wpt.name)}</name>`);
    if (wpt.description) lines.push(`    <desc>${escapeXml(wpt.description)}</desc>`);
    for (const href of Array.isArray(wpt.images) ? wpt.images : []) {
      if (typeof href === 'string' && /^https:\/\//i.test(href)) {
        lines.push(`    <link href="${escapeXml(href)}"><text>media</text></link>`);
      }
    }
    if (wpt.icon) lines.push(`    <sym>${escapeXml(wpt.icon)}</sym>`);
    lines.push('  </wpt>');
  }

  const hasTrackPoints = Array.isArray(parsed?.tracks)
    && parsed.tracks.some((trk) => Array.isArray(trk?.segments) && trk.segments.some((seg) => seg.length > 0));
  const tracks = hasTrackPoints
    ? parsed.tracks
    : (parsed?.routes || []).map((r) => ({ name: r.name ?? null, segments: [r.points || []] }));

  for (const track of tracks) {
    const segs = (track.segments || [])
      .map((seg) => cleanSegmentPoints(seg, watchFriendly))
      .filter((seg) => seg.length > 0);
    if (segs.length === 0) continue;
    lines.push('  <trk>');
    if (track.name) lines.push(`    <name>${escapeXml(track.name)}</name>`);
    for (const seg of segs) {
      lines.push('    <trkseg>');
      for (const pt of seg) {
        const hasEle = Number.isFinite(pt.ele);
        const iso = formatTime(pt.time);
        const hasHr = isValidHeartRate(pt.heartRate);
        const lonStr = formatCoord(normalizeLon(pt.lon));
        if (!hasEle && !iso && !hasHr) {
          lines.push(`      <trkpt lat="${formatCoord(pt.lat)}" lon="${lonStr}"/>`);
          continue;
        }
        lines.push(`      <trkpt lat="${formatCoord(pt.lat)}" lon="${lonStr}">`);
        if (hasEle) lines.push(`        <ele>${formatEle(pt.ele)}</ele>`);
        if (iso) lines.push(`        <time>${iso}</time>`);
        if (hasHr) {
          lines.push('        <extensions><gpxtpx:TrackPointExtension>'
            + `<gpxtpx:hr>${Math.round(pt.heartRate)}</gpxtpx:hr>`
            + '</gpxtpx:TrackPointExtension></extensions>');
        }
        lines.push('      </trkpt>');
      }
      lines.push('    </trkseg>');
    }
    lines.push('  </trk>');
  }

  if (hasTrackPoints && Array.isArray(parsed?.routes) && parsed.routes.length > 0) {
    for (const route of parsed.routes) {
      const pts = cleanSegmentPoints(route.points || [], watchFriendly);
      if (pts.length === 0) continue;
      lines.push('  <rte>');
      if (route.name) lines.push(`    <name>${escapeXml(route.name)}</name>`);
      for (const pt of pts) {
        const hasEle = Number.isFinite(pt.ele);
        const iso = formatTime(pt.time);
        const lonStr = formatCoord(normalizeLon(pt.lon));
        if (!hasEle && !iso && !pt.name) {
          lines.push(`    <rtept lat="${formatCoord(pt.lat)}" lon="${lonStr}"/>`);
          continue;
        }
        lines.push(`    <rtept lat="${formatCoord(pt.lat)}" lon="${lonStr}">`);
        if (hasEle) lines.push(`      <ele>${formatEle(pt.ele)}</ele>`);
        if (iso) lines.push(`      <time>${iso}</time>`);
        if (pt.name) lines.push(`      <name>${escapeXml(pt.name)}</name>`);
        lines.push('    </rtept>');
      }
      lines.push('  </rte>');
    }
  }

  lines.push('</gpx>');
  return `${lines.join('\n')}\n`;
}
