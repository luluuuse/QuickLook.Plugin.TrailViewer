import assert from 'node:assert/strict';
import test from 'node:test';

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { languages: ['en-US'], language: 'en-US' },
});
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
};

function decodeXmlEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseAttributes(raw) {
  const attrs = new Map();
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = re.exec(raw))) {
    attrs.set(match[1], decodeXmlEntities(match[2] ?? match[3] ?? ''));
  }
  return attrs;
}

function createXmlElement(tagName, attrs) {
  const colon = tagName.indexOf(':');
  return {
    tagName,
    localName: colon >= 0 ? tagName.slice(colon + 1) : tagName,
    attrs,
    children: [],
    textParts: [],
    get id() {
      return this.attrs.get('id') || '';
    },
    get textContent() {
      return this.textParts.join('');
    },
    hasAttribute(name) {
      return this.attrs.has(name);
    },
    getAttribute(name) {
      return this.attrs.has(name) ? this.attrs.get(name) : null;
    },
    getElementsByTagName(name) {
      const matches = [];
      const visit = (node) => {
        for (const child of node.children) {
          if (name === '*' || child.tagName === name || child.localName === name) matches.push(child);
          visit(child);
        }
      };
      visit(this);
      return matches;
    },
    querySelector(selector) {
      if (selector !== 'div') return null;
      return this.getElementsByTagName('div')[0] || null;
    },
  };
}

function parseXmlMock(xmlText) {
  const text = String(xmlText || '');
  const rootWrapper = createXmlElement('#document', new Map());
  const stack = [rootWrapper];
  let index = 0;
  let malformed = null;

  while (index < text.length) {
    const lt = text.indexOf('<', index);
    if (lt < 0) {
      const trailing = text.slice(index).trim();
      if (trailing && stack.length > 1) {
        const decoded = decodeXmlEntities(trailing);
        for (const node of stack.slice(1)) node.textParts.push(decoded);
      }
      break;
    }
    if (lt > index) {
      const chunk = text.slice(index, lt);
      if (stack.length > 1) {
        const decoded = decodeXmlEntities(chunk);
        for (const node of stack.slice(1)) node.textParts.push(decoded);
      }
    }
    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      if (end < 0) { malformed = 'unterminated processing instruction'; break; }
      index = end + 2;
      continue;
    }
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end < 0) { malformed = 'unterminated comment'; break; }
      index = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      if (end < 0) { malformed = 'unterminated CDATA'; break; }
      const cdata = text.slice(lt + 9, end);
      for (const node of stack.slice(1)) node.textParts.push(cdata);
      index = end + 3;
      continue;
    }
    const gt = text.indexOf('>', lt + 1);
    if (gt < 0) { malformed = 'unclosed tag'; break; }
    const rawTag = text.slice(lt + 1, gt).trim();
    if (rawTag.startsWith('/')) {
      const closeName = rawTag.slice(1).trim();
      const top = stack.pop();
      if (!top || top.tagName !== closeName) { malformed = `mismatched closing tag </${closeName}>`; break; }
    } else {
      const selfClosing = rawTag.endsWith('/');
      const body = selfClosing ? rawTag.slice(0, -1).trim() : rawTag;
      const space = body.search(/\s/);
      const name = space < 0 ? body : body.slice(0, space);
      const attrs = space < 0 ? new Map() : parseAttributes(body.slice(space + 1));
      const el = createXmlElement(name, attrs);
      stack[stack.length - 1].children.push(el);
      if (!selfClosing) stack.push(el);
    }
    index = gt + 1;
  }

  if (stack.length !== 1 || rootWrapper.children.length !== 1) {
    malformed = malformed || 'unexpected end of document';
  }
  if (malformed) {
    const errDoc = createXmlElement('#document', new Map());
    const parsererror = createXmlElement('parsererror', new Map());
    const div = createXmlElement('div', new Map());
    div.textParts.push(malformed);
    parsererror.children.push(div);
    parsererror.textParts.push(malformed);
    errDoc.children.push(parsererror);
    return {
      documentElement: parsererror,
      getElementsByTagName: (tag) => (tag === 'parsererror' ? [parsererror] : errDoc.getElementsByTagName(tag)),
    };
  }
  return {
    documentElement: rootWrapper.children[0],
    getElementsByTagName: (tag) => rootWrapper.getElementsByTagName(tag),
  };
}

globalThis.DOMParser = class MockDOMParser {
  parseFromString(text) {
    return parseXmlMock(text);
  }
};

const { parseKml } = await import('../../viewer/kml.js');
const {
  EXPORT_FORMATS,
  hasTrackTimestamps,
  serializeCsv,
  serializeGeoJson,
  serializeKml,
  serializeTcx,
  serializeTrack,
} = await import('../../viewer/track-serializers.js');

const SAMPLE_TRACK = {
  name: 'Ridge & <Pass>',
  tracks: [
    {
      name: 'Main Leg',
      segments: [
        [
          { lat: 30.5, lon: 114.3, ele: 120.5, time: new Date('2026-10-01T08:00:00Z'), heartRate: 135 },
          { lat: 30.501, lon: 114.301, ele: 155, time: new Date('2026-10-01T08:02:00Z'), heartRate: 148 },
        ],
        [
          { lat: 30.502, lon: 114.302, ele: 200, time: new Date('2026-10-01T08:05:00Z'), heartRate: 162 },
          { lat: 30.503, lon: 114.303, ele: 210, time: new Date('2026-10-01T08:07:00Z') },
        ],
      ],
    },
  ],
  routes: [],
  waypoints: [
    {
      lat: 30.5015,
      lon: 114.3015,
      ele: 175,
      name: 'Spring & Camp',
      description: 'Cold water ]]><!-- note -->',
      icon: 'water',
      time: new Date('2026-10-01T08:03:00Z'),
      images: ['files/spring.jpg', 'https://example.com/a.jpg?w=1&h=2'],
    },
    {
      lat: 30.5025,
      lon: 114.3025,
      name: 'Text Only',
      description: 'Plain ridge & camp note',
    },
    {
      lat: 30.5035,
      lon: 114.3035,
      name: 'Escaped Desc',
      description: 'Safe <tag> & quote',
    },
  ],
  areas: [
    {
      name: 'Camp Zone',
      rings: [
        [
          { lat: 30.5, lon: 114.3 },
          { lat: 30.51, lon: 114.3 },
          { lat: 30.51, lon: 114.31 },
          { lat: 30.5, lon: 114.3 },
        ],
      ],
    },
  ],
};

test('serializeKml outputs valid KML 2.2 with gx:Track/LineString/MultiGeometry and round-trips via parseKml', () => {
  const untimedSingleTrack = {
    name: 'Single Line',
    tracks: [{
      name: 'Leg 1',
      segments: [[
        { lat: 30.5, lon: 114.3, ele: 120.5 },
        { lat: 30.51, lon: 114.31, ele: 150.2 },
      ]],
    }],
    routes: [],
    waypoints: [],
    areas: [],
  };
  const singleKml = serializeKml(untimedSingleTrack);
  assert.ok(!singleKml.startsWith('\uFEFF'));
  assert.ok(singleKml.includes('<LineString>'));
  assert.ok(!singleKml.includes('<MultiGeometry>'));

  const timedSingleTrack = {
    name: 'Timed Single',
    tracks: [{ name: 'Leg 1', segments: [SAMPLE_TRACK.tracks[0].segments[0]] }],
    routes: [],
    waypoints: [],
    areas: [],
  };
  const timedSingleKml = serializeKml(timedSingleTrack);
  assert.ok(timedSingleKml.includes('<gx:Track>'));
  assert.ok(!timedSingleKml.includes('<MultiGeometry>'));

  const kmlText = serializeKml(SAMPLE_TRACK);
  assert.ok(kmlText.includes('<MultiGeometry>'));
  assert.ok(kmlText.includes('<name>Ridge &amp; &lt;Pass&gt;</name>'));
  assert.ok(kmlText.includes('<Polygon>'));

  assert.ok(kmlText.includes('<description>Safe &lt;tag&gt; &amp; quote</description>'));

  const reparsed = parseKml(kmlText);
  assert.equal(reparsed.name, 'Ridge & <Pass>');
  assert.equal(reparsed.tracks.length, 1);
  assert.equal(reparsed.tracks[0].segments.length, 2);
  assert.equal(reparsed.tracks[0].segments[0][0].lat, 30.5);
  assert.equal(reparsed.tracks[0].segments[0][0].lon, 114.3);
  assert.equal(reparsed.tracks[0].segments[0][0].ele, 120.5);
  assert.equal(reparsed.areas.length, 1);
  assert.equal(reparsed.waypoints.length, 3);
  assert.equal(reparsed.waypoints[0].name, 'Spring & Camp');
  assert.equal(reparsed.waypoints[0].time?.toISOString(), '2026-10-01T08:03:00.000Z');
  assert.deepEqual(reparsed.waypoints[0].images, ['files/spring.jpg', 'https://example.com/a.jpg?w=1&h=2']);
  assert.equal(reparsed.waypoints[1].description, 'Plain ridge & camp note');
});

test('serializeKml and serializeGeoJson round-trip track description and activityType', () => {
  const track = {
    name: 'Alpine Loop',
    description: 'Snow traverse with water at 3200m',
    activityType: 'mountaineering',
    tracks: [{
      name: 'Main',
      segments: [[
        { lat: 30.5, lon: 114.3, ele: 100 },
        { lat: 30.51, lon: 114.31, ele: 200 },
      ]],
    }],
    routes: [],
    waypoints: [],
    areas: [],
  };

  const kml = serializeKml(track);
  assert.ok(kml.includes('<description>Snow traverse with water at 3200m</description>'));
  assert.ok(kml.includes('<Data name="activityType"><value>mountaineering</value></Data>'));
  const reparsed = parseKml(kml);
  assert.equal(reparsed.name, 'Alpine Loop');
  assert.equal(reparsed.description, 'Snow traverse with water at 3200m');
  assert.equal(reparsed.activityType, 'mountaineering');

  const geo = JSON.parse(serializeGeoJson(track));
  assert.equal(geo.name, 'Alpine Loop');
  assert.equal(geo.description, 'Snow traverse with water at 3200m');
  assert.equal(geo.activityType, 'mountaineering');
});

test('serializeGeoJson outputs valid RFC 7946 FeatureCollection with 3D/2D coords and filters invalid points', () => {
  const jsonText = serializeGeoJson({
    name: 'Geo Test',
    tracks: [
      {
        name: 'Track A',
        segments: [
          [
            { lat: 30.5, lon: 114.3, ele: 100, time: new Date('2026-10-01T08:00:00Z') },
            { lat: Number.NaN, lon: 114.301 },
            { lat: 30.51, lon: 114.31, time: new Date('2026-10-01T08:10:00Z') },
          ],
          [
            { lat: 30.52, lon: 114.32, ele: 150 },
          ],
        ],
      },
      {
        name: 'Multi',
        segments: [
          [{ lat: 30.6, lon: 114.4 }, { lat: 30.61, lon: 114.41 }],
          [{ lat: 30.62, lon: 114.42 }, { lat: 30.63, lon: 114.43 }],
        ],
      },
    ],
    routes: [],
    waypoints: [
      { lat: 30.505, lon: 114.305, name: 'Hut', icon: 'camp', description: 'Shelter' },
    ],
    areas: [
      {
        name: 'Open Ring',
        rings: [[{ lat: 30.5, lon: 114.3 }, { lat: 30.51, lon: 114.3 }, { lat: 30.51, lon: 114.31 }]],
      },
    ],
  });

  const geo = JSON.parse(jsonText);
  assert.equal(geo.type, 'FeatureCollection');
  assert.equal(geo.name, 'Geo Test');
  assert.equal(geo.features.length, 4);

  const singleFeature = geo.features[0];
  assert.equal(singleFeature.geometry.type, 'LineString');
  assert.deepEqual(singleFeature.geometry.coordinates, [
    [114.3, 30.5, 100],
    [114.31, 30.51],
  ]);
  assert.equal(singleFeature.properties.pointCount, 2);
  assert.equal(singleFeature.properties.segmentCount, 1);
  assert.equal(singleFeature.properties.minEle, 100);
  assert.equal(singleFeature.properties.maxEle, 100);
  assert.ok(singleFeature.properties.distanceMeters > 0);

  const multiFeature = geo.features[1];
  assert.equal(multiFeature.geometry.type, 'MultiLineString');
  assert.equal(multiFeature.geometry.coordinates.length, 2);

  const wptFeature = geo.features[2];
  assert.equal(wptFeature.geometry.type, 'Point');
  assert.deepEqual(wptFeature.geometry.coordinates, [114.305, 30.505]);
  assert.equal(wptFeature.properties.icon, 'camp');

  const areaFeature = geo.features[3];
  assert.equal(areaFeature.geometry.type, 'Polygon');
  const ring = areaFeature.geometry.coordinates[0];
  assert.deepEqual(ring[0], ring[ring.length - 1]);
});

test('serializeTcx outputs TCX v2 XML and gracefully omits Time tags when track lacks timestamps', () => {
  assert.equal(hasTrackTimestamps(SAMPLE_TRACK), true);
  const tcxWithTime = serializeTcx(SAMPLE_TRACK);
  assert.ok(tcxWithTime.includes('<TrainingCenterDatabase'));
  assert.ok(tcxWithTime.includes('<Id>2026-10-01T08:00:00.000Z</Id>'));
  assert.ok(tcxWithTime.includes('<Lap StartTime="2026-10-01T08:00:00.000Z">'));
  assert.ok(tcxWithTime.includes('<TotalTimeSeconds>420</TotalTimeSeconds>'));
  assert.ok(tcxWithTime.includes('<HeartRateBpm><Value>135</Value></HeartRateBpm>'));
  assert.ok(tcxWithTime.includes('<HeartRateBpm><Value>162</Value></HeartRateBpm>'));
  assert.ok(tcxWithTime.includes('<Notes>Ridge &amp; &lt;Pass&gt;</Notes>'));
  assert.equal((tcxWithTime.match(/<Trackpoint>/g) || []).length, 4);

  const noTimeTrack = {
    name: 'Planned Route',
    tracks: [{
      name: 'Leg',
      segments: [[
        { lat: 30.5, lon: 114.3, ele: 100 },
        { lat: 30.501, lon: 114.301, ele: 110 },
      ]],
    }],
    routes: [],
    waypoints: [],
  };
  assert.equal(hasTrackTimestamps(noTimeTrack), false);
  const tcxNoTime = serializeTcx(noTimeTrack);
  assert.ok(!tcxNoTime.includes('<Time>'));
  assert.ok(!tcxNoTime.includes('<Id>'));
  assert.ok(tcxNoTime.includes('<Lap>'));
  assert.ok(tcxNoTime.includes('<TotalTimeSeconds>0</TotalTimeSeconds>'));
  assert.ok(tcxNoTime.includes('<LatitudeDegrees>30.5</LatitudeDegrees>'));
  assert.ok(tcxNoTime.includes('<AltitudeMeters>100</AltitudeMeters>'));
});

test('serializeCsv outputs UTF-8 CSV with exact header, segment numbering, cumulative distance and empty missing fields', () => {
  const csv = serializeCsv({
    name: 'CSV Track',
    tracks: [{
      name: 'Main',
      segments: [
        [
          { lat: 30.5, lon: 114.3, ele: 100, time: new Date('2026-10-01T08:00:00Z'), heartRate: 130 },
          { lat: 30.501, lon: 114.301 },
        ],
        [
          { lat: 30.502, lon: 114.302, ele: 120, heartRate: 999 },
        ],
      ],
    }],
    routes: [],
    waypoints: [],
  });

  assert.ok(!csv.startsWith('\uFEFF'));
  assert.ok(!csv.includes('NaN'));
  const rows = csv.trimEnd().split('\n');
  assert.equal(rows.length, 4);
  assert.equal(rows[0], 'seg,index,lat,lon,ele,time,hr,dist_m');
  assert.equal(rows[1], '1,1,30.5,114.3,100,2026-10-01T08:00:00.000Z,130,0');
  const row2Parts = rows[2].split(',');
  assert.equal(row2Parts[0], '1');
  assert.equal(row2Parts[1], '2');
  assert.equal(row2Parts[4], '');
  assert.equal(row2Parts[5], '');
  assert.equal(row2Parts[6], '');
  assert.ok(Number(row2Parts[7]) > 100);
  const row3Parts = rows[3].split(',');
  assert.equal(row3Parts[0], '2');
  assert.equal(row3Parts[1], '1');
  assert.equal(row3Parts[4], '120');
  assert.equal(row3Parts[6], '');
  assert.equal(row3Parts[7], row2Parts[7]);
});

test('serializeTrack dispatches all 6 formats, supports route-only fallback, and rejects unknown format', () => {
  const routeOnly = {
    name: 'Route Only',
    tracks: [],
    routes: [{
      name: 'Planned',
      points: [
        { lat: 30.5, lon: 114.3, ele: 100 },
        { lat: 30.501, lon: 114.301, ele: 120 },
      ],
    }],
    waypoints: [],
  };

  assert.equal(EXPORT_FORMATS.map((f) => f.id).join(','), 'gpx,kml,kmz,geojson,tcx,csv');
  assert.ok(serializeTrack(routeOnly, 'gpx').includes('<gpx'));
  assert.ok(serializeTrack(routeOnly, 'kml').includes('<kml'));
  assert.ok(serializeTrack(routeOnly, 'kmz').includes('<kml'));
  assert.equal(JSON.parse(serializeTrack(routeOnly, 'geojson')).features.length, 1);
  assert.ok(serializeTrack(routeOnly, 'tcx').includes('<TrainingCenterDatabase'));
  assert.equal(serializeTrack(routeOnly, 'csv').trimEnd().split('\n').length, 3);
  assert.throws(() => serializeTrack(routeOnly, 'fit'), /Unsupported export format/);
});

test('KML promotes URL-only description and legacy mediaLink ExtendedData into waypoint photos and round-trips as <img>', () => {
  const url1 = 'https://down-files.2bulu.com/f/d1?downParams=abc%3D%3D%0A';
  const url2 = 'https://down-files.2bulu.com/f/d1?downParams=def%3D%3D%0A';
  const legacy = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
    <Placemark><name>Start</name><description>${url1}</description><Point><coordinates>114.11,27.45,609</coordinates></Point></Placemark>
    <Placemark><name>Legacy</name><ExtendedData><Data name="mediaLink"><value>${url2}</value></Data></ExtendedData><Point><coordinates>114.115,27.455,609</coordinates></Point></Placemark>
    <Placemark><name>Note</name><description>Turn left</description><Point><coordinates>114.12,27.46,610</coordinates></Point></Placemark>
    <Placemark><name>Line</name><LineString><coordinates>114.11,27.45 114.12,27.46</coordinates></LineString></Placemark>
  </Document></kml>`;
  const parsed = parseKml(legacy);
  const start = parsed.waypoints.find((w) => w.name === 'Start');
  const legacyWpt = parsed.waypoints.find((w) => w.name === 'Legacy');
  const note = parsed.waypoints.find((w) => w.name === 'Note');
  assert.deepEqual(start.images, [url1]);
  assert.equal(start.description, undefined);
  assert.deepEqual(legacyWpt.images, [url2]);
  assert.equal(legacyWpt.description, undefined);
  assert.equal(note.description, 'Turn left');
  assert.deepEqual(note.images, []);

  const xml = serializeKml(parsed);
  assert.ok(xml.includes(`<img src="${url1}" />`));
  assert.ok(xml.includes(`<img src="${url2}" />`));
  assert.ok(!xml.includes(`<description>${url1}`));
  const again = parseKml(xml).waypoints.find((w) => w.name === 'Start');
  assert.deepEqual(again.images, [url1]);
  assert.equal(again.description, undefined);
});

test('serializeKml preserves track timestamps and heartRate via gx:Track, waypoint icons, and closes polygon LinearRing', () => {
  const track = {
    name: 'Timed KML',
    tracks: [
      {
        name: 'Day 1',
        segments: [
          [
            { lat: 30.5, lon: 114.3, ele: 100, heartRate: 142, time: new Date('2026-05-01T08:00:00.000Z') },
            { lat: 30.51, lon: 114.31, ele: 150, heartRate: 158, time: new Date('2026-05-01T08:10:00.000Z') },
          ],
        ],
      },
    ],
    routes: [],
    waypoints: [
      { lat: 30.505, lon: 114.305, ele: 120, name: 'Camp', icon: 'camp-icon.png' },
    ],
    areas: [
      {
        name: 'Zone',
        rings: [[
          { lat: 30.5, lon: 114.3 },
          { lat: 30.51, lon: 114.3 },
          { lat: 30.51, lon: 114.31 },
        ]],
      },
    ],
  };

  const xml = serializeKml(track);
  assert.ok(xml.includes('<gx:Track>'));
  assert.ok(xml.includes('<when>2026-05-01T08:00:00.000Z</when>'));
  assert.ok(xml.includes('<gx:SimpleArrayData name="heartrate">'));
  assert.ok(xml.includes('<gx:value>142</gx:value>'));
  assert.ok(xml.includes('<Icon><href>camp-icon.png</href></Icon>'));

  const reparsed = parseKml(xml);
  assert.equal(reparsed.tracks[0].segments[0][0].time.toISOString(), '2026-05-01T08:00:00.000Z');
  assert.equal(reparsed.tracks[0].segments[0][1].time.toISOString(), '2026-05-01T08:10:00.000Z');
  assert.equal(reparsed.tracks[0].segments[0][0].heartRate, 142);
  assert.equal(reparsed.tracks[0].segments[0][1].heartRate, 158);
  assert.equal(reparsed.waypoints[0].icon, 'camp-icon.png');
  const ring = reparsed.areas[0].rings[0];
  assert.equal(ring.length, 4);
  assert.equal(ring[0].lat, ring[ring.length - 1].lat);
  assert.equal(ring[0].lon, ring[ring.length - 1].lon);
});

test('serializeTcx maps activityType to standard Sport attribute', () => {
  const baseTrack = {
    name: 'Sport Test',
    tracks: [{
      name: 'Main',
      segments: [[
        { lat: 30.5, lon: 114.3, ele: 100, time: new Date('2026-05-01T08:00:00Z') },
        { lat: 30.51, lon: 114.31, ele: 150, time: new Date('2026-05-01T08:10:00Z') },
      ]],
    }],
    routes: [],
    waypoints: [],
  };
  assert.ok(serializeTcx({ ...baseTrack, activityType: 'running' }).includes('<Activity Sport="Running">'));
  assert.ok(serializeTcx({ ...baseTrack, activityType: 'trail_running' }).includes('<Activity Sport="Running">'));
  assert.ok(serializeTcx({ ...baseTrack, activityType: 'cycling' }).includes('<Activity Sport="Biking">'));
  assert.ok(serializeTcx({ ...baseTrack, activityType: 'biking' }).includes('<Activity Sport="Biking">'));
  assert.ok(serializeTcx({ ...baseTrack, activityType: 'hiking' }).includes('<Activity Sport="Other">'));
  assert.ok(serializeTcx({ ...baseTrack, activityType: null }).includes('<Activity Sport="Other">'));
});

test('serializeKml writes internal icon keys to ExtendedData instead of broken Icon href and round-trips cleanly', () => {
  const track = {
    name: 'Icon Keys',
    tracks: [{ name: 'Main', segments: [[{ lat: 30.5, lon: 114.3 }, { lat: 30.51, lon: 114.31 }]] }],
    routes: [],
    waypoints: [
      { lat: 30.502, lon: 114.302, name: 'Spring', icon: 'water' },
      { lat: 30.506, lon: 114.306, name: 'Remote Icon', icon: 'https://example.com/pin.png' },
    ],
  };
  const xml = serializeKml(track);
  assert.ok(!xml.includes('<href>water</href>'));
  assert.ok(xml.includes('<Data name="icon"><value>water</value></Data>'));
  assert.ok(xml.includes('<Icon><href>https://example.com/pin.png</href></Icon>'));

  const reparsed = parseKml(xml);
  assert.equal(reparsed.waypoints.find((w) => w.name === 'Spring')?.icon, 'water');
  assert.equal(reparsed.waypoints.find((w) => w.name === 'Remote Icon')?.icon, 'https://example.com/pin.png');
});
