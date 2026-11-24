import { distanceMeters } from './geo.js';
import { serializeGpx } from './gpx-serializer.js';
import { isValidHeartRate } from './track-analysis.js';

/** @typedef {import('./types.js').ParsedTrack} ParsedTrack */
/** @typedef {import('./types.js').TrackPoint} TrackPoint */

/** @type {ReadonlyArray<{ id: 'gpx' | 'kml' | 'kmz' | 'geojson' | 'tcx' | 'csv', ext: string, label: string }>} */
export const EXPORT_FORMATS = Object.freeze([
  { id: 'gpx', ext: '.gpx', label: 'GPX 1.1 (.gpx)' },
  { id: 'kml', ext: '.kml', label: 'KML 2.2 (.kml)' },
  { id: 'kmz', ext: '.kmz', label: 'KMZ (.kmz)' },
  { id: 'geojson', ext: '.geojson', label: 'GeoJSON (.geojson)' },
  { id: 'tcx', ext: '.tcx', label: 'Garmin TCX (.tcx)' },
  { id: 'csv', ext: '.csv', label: 'CSV (.csv)' },
]);

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function escapeCdata(value) {
  return String(value ?? '').replaceAll(']]>', ']]]]><![CDATA[>');
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

function formatNumber(value, decimals) {
  if (!Number.isFinite(value)) return 0;
  return Number(Number(value).toFixed(decimals));
}

function formatTime(value) {
  if (!(value instanceof Date)) return '';
  const ms = value.getTime();
  return Number.isFinite(ms) ? value.toISOString() : '';
}

function isValidPoint(pt) {
  return Boolean(pt && Number.isFinite(pt.lat) && Number.isFinite(pt.lon));
}

/**
 * Normalizes tracks from a ParsedTrack, falling back to routes if tracks contain no valid points.
 * @param {ParsedTrack} parsed
 * @returns {Array<{ name: string | null, segments: TrackPoint[][] }>}
 */
function collectTracks(parsed) {
  const rawTracks = Array.isArray(parsed?.tracks) ? parsed.tracks : [];
  const hasTrackPoints = rawTracks.some(
    (trk) => Array.isArray(trk?.segments) && trk.segments.some((seg) => Array.isArray(seg) && seg.some(isValidPoint)),
  );
  const source = hasTrackPoints
    ? rawTracks
    : (Array.isArray(parsed?.routes) ? parsed.routes : []).map((r) => ({
      name: r?.name ?? null,
      segments: [Array.isArray(r?.points) ? r.points : []],
    }));

  const normalized = [];
  for (const trk of source) {
    const segments = [];
    for (const seg of trk?.segments || []) {
      const valid = (Array.isArray(seg) ? seg : []).filter(isValidPoint);
      if (valid.length > 0) segments.push(valid);
    }
    if (segments.length > 0) {
      normalized.push({
        name: trk?.name ? String(trk.name) : null,
        segments,
      });
    }
  }
  return normalized;
}

/**
 * Returns true when at least one valid track/route point carries a valid Date timestamp.
 * @param {ParsedTrack} parsed
 * @returns {boolean}
 */
export function hasTrackTimestamps(parsed) {
  for (const trk of collectTracks(parsed)) {
    for (const seg of trk.segments) {
      for (const pt of seg) {
        if (formatTime(pt.time)) return true;
      }
    }
  }
  return false;
}

function formatKmlCoords(points) {
  return points
    .map((pt) => {
      const lon = formatCoord(normalizeLon(pt.lon));
      const lat = formatCoord(pt.lat);
      return Number.isFinite(pt.ele) ? `${lon},${lat},${formatEle(pt.ele)}` : `${lon},${lat}`;
    })
    .join(' ');
}

function formatGxCoord(pt) {
  const lon = formatCoord(normalizeLon(pt.lon));
  const lat = formatCoord(pt.lat);
  return Number.isFinite(pt.ele) ? `${lon} ${lat} ${formatEle(pt.ele)}` : `${lon} ${lat}`;
}

function segmentHasTimestamps(seg) {
  return Array.isArray(seg) && seg.some((pt) => Boolean(formatTime(pt.time)));
}

function segmentHasHeartRate(seg) {
  return Array.isArray(seg) && seg.some((pt) => Number.isFinite(pt.heartRate) && pt.heartRate > 0 && pt.heartRate < 255);
}

function pushKmlSegment(lines, seg, indent) {
  const hasTime = segmentHasTimestamps(seg);
  const hasHr = segmentHasHeartRate(seg);
  if (hasTime || hasHr) {
    lines.push(`${indent}<gx:Track>`);
    for (const pt of seg) {
      const iso = formatTime(pt.time);
      lines.push(iso ? `${indent}  <when>${iso}</when>` : `${indent}  <when/>`);
    }
    for (const pt of seg) {
      lines.push(`${indent}  <gx:coord>${formatGxCoord(pt)}</gx:coord>`);
    }
    if (hasHr) {
      lines.push(
        `${indent}  <ExtendedData>`,
        `${indent}    <SchemaData schemaUrl="#trailviewer-track">`,
        `${indent}      <gx:SimpleArrayData name="heartrate">`,
      );
      for (const pt of seg) {
        const hr = Number.isFinite(pt.heartRate) && pt.heartRate > 0 && pt.heartRate < 255
          ? Math.round(pt.heartRate)
          : null;
        lines.push(hr !== null ? `${indent}        <gx:value>${hr}</gx:value>` : `${indent}        <gx:value/>`);
      }
      lines.push(
        `${indent}      </gx:SimpleArrayData>`,
        `${indent}    </SchemaData>`,
        `${indent}  </ExtendedData>`,
      );
    }
    lines.push(`${indent}</gx:Track>`);
    return;
  }
  lines.push(
    `${indent}<LineString>`,
    `${indent}  <tessellate>1</tessellate>`,
    `${indent}  <coordinates>${formatKmlCoords(seg)}</coordinates>`,
    `${indent}</LineString>`,
  );
}

function closeKmlRing(ring) {
  if (ring.length < 3) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first.lat === last.lat && normalizeLon(first.lon) === normalizeLon(last.lon)) {
    return ring;
  }
  return [...ring, first];
}

function formatGeoJsonCoord(pt) {
  const lon = formatNumber(normalizeLon(pt.lon), 7);
  const lat = formatNumber(pt.lat, 7);
  return Number.isFinite(pt.ele) ? [lon, lat, formatNumber(pt.ele, 2)] : [lon, lat];
}

/**
 * Serializes a ParsedTrack to UTF-8 (without BOM) KML 2.2 XML.
 * @param {ParsedTrack} parsed
 * @param {{ includeImages?: boolean }} [options]
 * @returns {string}
 */
export function serializeKml(parsed, { includeImages = true } = {}) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">',
    '  <Document>',
  ];

  const docName = parsed?.name ? String(parsed.name).trim() : '';
  if (docName) {
    lines.push(`    <name>${escapeXml(docName)}</name>`);
  }

  const tracksToWrite = collectTracks(parsed);
  const anyHeartRate = tracksToWrite.some((trk) => trk.segments.some(segmentHasHeartRate));

  lines.push(
    '    <Style id="trail-line">',
    '      <LineStyle>',
    '        <color>ff1673f9</color>',
    '        <width>3</width>',
    '      </LineStyle>',
    '    </Style>',
  );
  if (anyHeartRate) {
    lines.push(
      '    <Schema id="trailviewer-track">',
      '      <gx:SimpleArrayField name="heartrate" type="int">',
      '        <displayName>Heart Rate</displayName>',
      '      </gx:SimpleArrayField>',
      '    </Schema>',
    );
  }

  for (const trk of tracksToWrite) {
    lines.push('    <Placemark>');
    if (trk.name) lines.push(`      <name>${escapeXml(trk.name)}</name>`);
    lines.push('      <styleUrl>#trail-line</styleUrl>');
    if (trk.segments.length === 1) {
      pushKmlSegment(lines, trk.segments[0], '      ');
    } else {
      lines.push('      <MultiGeometry>');
      for (const seg of trk.segments) {
        pushKmlSegment(lines, seg, '        ');
      }
      lines.push('      </MultiGeometry>');
    }
    lines.push('    </Placemark>');
  }

  for (const wpt of parsed?.waypoints || []) {
    if (!isValidPoint(wpt)) continue;
    lines.push('    <Placemark>');
    if (wpt.name) lines.push(`      <name>${escapeXml(wpt.name)}</name>`);
    if (wpt.icon) {
      lines.push(
        '      <Style>',
        '        <IconStyle>',
        `          <Icon><href>${escapeXml(String(wpt.icon))}</href></Icon>`,
        '        </IconStyle>',
        '      </Style>',
      );
    }
    const images = includeImages && Array.isArray(wpt.images) ? wpt.images.filter(Boolean) : [];
    const desc = wpt.description ? String(wpt.description) : '';
    if (images.length > 0) {
      const parts = [];
      if (desc) parts.push(`<p>${escapeXml(desc)}</p>`);
      for (const url of images) {
        parts.push(`<img src="${escapeXml(url)}" />`);
      }
      lines.push(`      <description><![CDATA[${escapeCdata(parts.join(''))}]]></description>`);
    } else if (desc) {
      lines.push(`      <description>${escapeXml(desc)}</description>`);
    }
    const iso = formatTime(wpt.time);
    if (iso) {
      lines.push(`      <TimeStamp><when>${iso}</when></TimeStamp>`);
    }
    lines.push(
      '      <Point>',
      `        <coordinates>${formatKmlCoords([wpt])}</coordinates>`,
      '      </Point>',
      '    </Placemark>',
    );
  }

  for (const area of parsed?.areas || []) {
    const validRings = (Array.isArray(area?.rings) ? area.rings : [])
      .map((ring) => (Array.isArray(ring) ? ring : []).filter(isValidPoint))
      .filter((ring) => ring.length >= 3);
    if (validRings.length === 0) continue;
    lines.push('    <Placemark>');
    if (area?.name) lines.push(`      <name>${escapeXml(area.name)}</name>`);
    lines.push('      <Polygon>');
    validRings.forEach((ring, idx) => {
      const tag = idx === 0 ? 'outerBoundaryIs' : 'innerBoundaryIs';
      const closedRing = closeKmlRing(ring);
      lines.push(
        `        <${tag}>`,
        '          <LinearRing>',
        `            <coordinates>${formatKmlCoords(closedRing)}</coordinates>`,
        '          </LinearRing>',
        `        </${tag}>`,
      );
    });
    lines.push('      </Polygon>', '    </Placemark>');
  }

  lines.push('  </Document>', '</kml>');
  return `${lines.join('\n')}\n`;
}

/**
 * Serializes a ParsedTrack to RFC 7946 GeoJSON FeatureCollection.
 * @param {ParsedTrack} parsed
 * @returns {string}
 */
export function serializeGeoJson(parsed) {
  /** @type {any[]} */
  const features = [];

  for (const trk of collectTracks(parsed)) {
    const lineSegs = trk.segments.filter((seg) => seg.length >= 2);
    if (lineSegs.length === 0) continue;

    let pointCount = 0;
    let totalDist = 0;
    let startTime = '';
    let endTime = '';
    /** @type {number | null} */
    let minEle = null;
    /** @type {number | null} */
    let maxEle = null;

    const coordsList = lineSegs.map((seg) => seg.map((pt, idx) => {
      pointCount += 1;
      if (idx > 0) totalDist += distanceMeters(seg[idx - 1], pt);
      const iso = formatTime(pt.time);
      if (iso) {
        if (!startTime) startTime = iso;
        endTime = iso;
      }
      if (Number.isFinite(pt.ele)) {
        const eleVal = formatNumber(pt.ele, 2);
        if (minEle === null || eleVal < minEle) minEle = eleVal;
        if (maxEle === null || eleVal > maxEle) maxEle = eleVal;
      }
      return formatGeoJsonCoord(pt);
    }));

    /** @type {Record<string, any>} */
    const properties = {
      type: 'track',
      ...(trk.name ? { name: trk.name } : {}),
      segmentCount: lineSegs.length,
      pointCount,
      distanceMeters: formatNumber(totalDist, 2),
      ...(startTime ? { startTime } : {}),
      ...(endTime ? { endTime } : {}),
      ...(minEle !== null ? { minEle, maxEle } : {}),
    };

    features.push({
      type: 'Feature',
      geometry: lineSegs.length === 1
        ? { type: 'LineString', coordinates: coordsList[0] }
        : { type: 'MultiLineString', coordinates: coordsList },
      properties,
    });
  }

  for (const wpt of parsed?.waypoints || []) {
    if (!isValidPoint(wpt)) continue;
    const iso = formatTime(wpt.time);
    /** @type {Record<string, any>} */
    const properties = {
      type: 'waypoint',
      ...(wpt.name ? { name: String(wpt.name) } : {}),
      ...(wpt.description ? { description: String(wpt.description) } : {}),
      ...(wpt.icon ? { icon: String(wpt.icon) } : {}),
      ...(iso ? { time: iso } : {}),
      ...(Number.isFinite(wpt.ele) ? { ele: formatNumber(wpt.ele, 2) } : {}),
    };
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: formatGeoJsonCoord(wpt),
      },
      properties,
    });
  }

  for (const area of parsed?.areas || []) {
    const validRings = (Array.isArray(area?.rings) ? area.rings : [])
      .map((ring) => (Array.isArray(ring) ? ring : []).filter(isValidPoint))
      .filter((ring) => ring.length >= 3);
    if (validRings.length === 0) continue;

    const closedRings = validRings.map((ring) => {
      const coords = ring.map(formatGeoJsonCoord);
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        coords.push([...first]);
      }
      return coords;
    });

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: closedRings,
      },
      properties: {
        type: 'area',
        ...(area?.name ? { name: String(area.name) } : {}),
      },
    });
  }

  const docName = parsed?.name ? String(parsed.name).trim() : '';
  const collection = {
    type: 'FeatureCollection',
    ...(docName ? { name: docName } : {}),
    features,
  };
  return `${JSON.stringify(collection, null, 2)}\n`;
}

/**
 * Serializes a ParsedTrack to Garmin TCX v2 XML.
 * Points without valid timestamps omit `<Time>` gracefully.
 * @param {ParsedTrack} parsed
 * @returns {string}
 */
export function serializeTcx(parsed) {
  const tracks = collectTracks(parsed);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">',
    '  <Activities>',
  ];

  if (tracks.length > 0) {
    let firstIso = '';
    for (const trk of tracks) {
      for (const seg of trk.segments) {
        for (const pt of seg) {
          const iso = formatTime(pt.time);
          if (iso) {
            firstIso = iso;
            break;
          }
        }
        if (firstIso) break;
      }
      if (firstIso) break;
    }

    lines.push('    <Activity Sport="Other">');
    if (firstIso) lines.push(`      <Id>${firstIso}</Id>`);

    let cumulativeMeters = 0;
    for (const trk of tracks) {
      let lapDist = 0;
      /** @type {Date | null} */
      let lapStart = null;
      /** @type {Date | null} */
      let lapEnd = null;
      for (const seg of trk.segments) {
        for (let i = 0; i < seg.length; i += 1) {
          const pt = seg[i];
          if (i > 0) lapDist += distanceMeters(seg[i - 1], pt);
          if (pt.time instanceof Date && Number.isFinite(pt.time.getTime())) {
            if (!lapStart) lapStart = pt.time;
            lapEnd = pt.time;
          }
        }
      }
      const lapStartIso = formatTime(lapStart);
      const lapSeconds = lapStart && lapEnd
        ? Math.max(0, (lapEnd.getTime() - lapStart.getTime()) / 1000)
        : 0;

      lines.push(lapStartIso ? `      <Lap StartTime="${lapStartIso}">` : '      <Lap>');
      lines.push(
        `        <TotalTimeSeconds>${formatEle(lapSeconds)}</TotalTimeSeconds>`,
        `        <DistanceMeters>${formatEle(lapDist)}</DistanceMeters>`,
        '        <Intensity>Active</Intensity>',
        '        <TriggerMethod>Manual</TriggerMethod>',
      );

      for (const seg of trk.segments) {
        lines.push('        <Track>');
        for (let i = 0; i < seg.length; i += 1) {
          const pt = seg[i];
          if (i > 0) cumulativeMeters += distanceMeters(seg[i - 1], pt);
          const iso = formatTime(pt.time);
          lines.push('          <Trackpoint>');
          if (iso) lines.push(`            <Time>${iso}</Time>`);
          lines.push(
            '            <Position>',
            `              <LatitudeDegrees>${formatCoord(pt.lat)}</LatitudeDegrees>`,
            `              <LongitudeDegrees>${formatCoord(normalizeLon(pt.lon))}</LongitudeDegrees>`,
            '            </Position>',
          );
          if (Number.isFinite(pt.ele)) {
            lines.push(`            <AltitudeMeters>${formatEle(pt.ele)}</AltitudeMeters>`);
          }
          lines.push(`            <DistanceMeters>${formatEle(cumulativeMeters)}</DistanceMeters>`);
          if (isValidHeartRate(pt.heartRate)) {
            lines.push(`            <HeartRateBpm><Value>${Math.round(pt.heartRate)}</Value></HeartRateBpm>`);
          }
          lines.push('          </Trackpoint>');
        }
        lines.push('        </Track>');
      }
      lines.push('      </Lap>');
    }

    const docName = parsed?.name ? String(parsed.name).trim() : '';
    if (docName) lines.push(`      <Notes>${escapeXml(docName)}</Notes>`);
    lines.push('    </Activity>');
  }

  lines.push('  </Activities>', '</TrainingCenterDatabase>');
  return `${lines.join('\n')}\n`;
}

/**
 * Serializes a ParsedTrack to UTF-8 CSV (without BOM).
 * @param {ParsedTrack} parsed
 * @returns {string}
 */
export function serializeCsv(parsed) {
  const lines = ['seg,index,lat,lon,ele,time,hr,dist_m'];
  let flatSeg = 0;
  let cumulativeMeters = 0;

  for (const trk of collectTracks(parsed)) {
    for (const seg of trk.segments) {
      flatSeg += 1;
      for (let i = 0; i < seg.length; i += 1) {
        const pt = seg[i];
        if (i > 0) cumulativeMeters += distanceMeters(seg[i - 1], pt);
        const eleStr = Number.isFinite(pt.ele) ? formatEle(pt.ele) : '';
        const timeStr = formatTime(pt.time);
        const hrStr = isValidHeartRate(pt.heartRate) ? String(Math.round(pt.heartRate)) : '';
        const distStr = formatEle(cumulativeMeters);
        lines.push(
          `${flatSeg},${i + 1},${formatCoord(pt.lat)},${formatCoord(normalizeLon(pt.lon))},${eleStr},${timeStr},${hrStr},${distStr}`,
        );
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Dispatches serialization across supported export formats.
 * @param {ParsedTrack} parsed
 * @param {string} [format]
 * @param {{ creator?: string, watchFriendly?: boolean, includeImages?: boolean }} [options]
 * @returns {string}
 */
export function serializeTrack(parsed, format = 'gpx', options = {}) {
  const fmt = String(format || 'gpx').toLowerCase();
  if (fmt === 'gpx') return serializeGpx(parsed, options);
  if (fmt === 'kml' || fmt === 'kmz') return serializeKml(parsed, options);
  if (fmt === 'geojson') return serializeGeoJson(parsed);
  if (fmt === 'tcx') return serializeTcx(parsed);
  if (fmt === 'csv') return serializeCsv(parsed);
  throw new Error(`Unsupported export format: ${format}`);
}
