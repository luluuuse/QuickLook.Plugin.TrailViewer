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
  const documentElement = rootWrapper.children[0];
  return {
    documentElement,
    getElementsByTagName: (tag) => rootWrapper.getElementsByTagName(tag),
  };
}

globalThis.DOMParser = class MockDOMParser {
  parseFromString(text) {
    return parseXmlMock(text);
  }
};

const { GpxError, parseGpx, summarize } = await import('../../viewer/gpx.js');

test('parseGpx reads GPX 1.1 tracks, waypoints, heart-rate extensions and drops invalid coords', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
  <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"
       xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
    <metadata><name>Ridge Loop</name></metadata>
    <wpt lat="30.5000" lon="114.3000"><ele>120</ele><name>Camp</name><desc>Flat meadow</desc><sym>Camp</sym></wpt>
    <wpt lat="95.0" lon="114.3"><name>Invalid lat</name></wpt>
    <trk>
      <name>Ignored track name</name>
      <trkseg>
        <trkpt lat="30.5000" lon="114.3000"><ele>100</ele><time>2026-01-01T08:00:00Z</time>
          <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>132</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>
        </trkpt>
        <trkpt lat="30.5010" lon="not-a-number"><ele>110</ele></trkpt>
        <trkpt lat="30.5050" lon="114.3050"><ele>145</ele><time>2026-01-01T08:05:00Z</time>
          <extensions><heartratebpm><value>148</value></heartratebpm></extensions>
        </trkpt>
        <trkpt lat="30.5080" lon="114.3080">
          <extensions><heartrate>999</heartrate></extensions>
        </trkpt>
      </trkseg>
    </trk>
  </gpx>`;

  const gpx = parseGpx(xml);
  assert.equal(gpx.version, '1.1');
  assert.equal(gpx.name, 'Ridge Loop');
  assert.equal(gpx.waypoints.length, 1);
  assert.equal(gpx.waypoints[0].icon, 'Camp');
  assert.equal(gpx.tracks.length, 1);
  assert.equal(gpx.tracks[0].segments[0].length, 3);
  assert.equal(gpx.tracks[0].segments[0][0].heartRate, 132);
  assert.equal(gpx.tracks[0].segments[0][1].heartRate, 148);
  assert.equal(gpx.tracks[0].segments[0][2].heartRate, undefined);
  assert.equal(gpx.tracks[0].segments[0][2].ele, undefined);
  assert.equal(gpx.tracks[0].segments[0][2].time, undefined);

  const summary = summarize(gpx);
  assert.equal(summary.points, 3);
  assert.equal(summary.waypoints, 1);
  assert.equal(summary.durationSeconds, 300);
  assert.equal(summary.elevation, true);
  assert.ok(summary.distanceMeters > 500);
});

test('parseGpx handles namespace-free GPX 1.0 route fallback naming and flat elevation', () => {
  const xml = `<gpx version="1.0">
    <rte>
      <name>Valley Plan</name>
      <rtept lat="31.0" lon="121.0"><ele>10.0</ele></rtept>
      <rtept lat="31.01" lon="121.0"><ele>10.4</ele></rtept>
    </rte>
  </gpx>`;
  const gpx = parseGpx(xml);
  assert.equal(gpx.version, '1.0');
  assert.equal(gpx.name, 'Valley Plan');
  assert.equal(gpx.tracks.length, 0);
  assert.equal(gpx.routes.length, 1);

  const summary = summarize(gpx);
  assert.ok(summary.distanceMeters > 1000);
  assert.equal(summary.elevation, false);
});

test('parseGpx throws GpxError on malformed XML or wrong root element', () => {
  assert.throws(() => parseGpx('<gpx><trk></gpx>'), GpxError);
  assert.throws(() => parseGpx('<kml></kml>'), GpxError);
});

test('parseGpx lifts URL-only waypoint desc and <link> into images instead of a description', () => {
  const url = 'https://down-files.2bulu.com/f/d1?downParams=abc%3D%3D%0A';
  const xml = `<gpx version="1.1">
    <wpt lat="27.45" lon="114.11">
      <name>Start</name>
      <desc>${url}</desc>
      <link href="${url}"><text>media</text></link>
    </wpt>
    <wpt lat="27.46" lon="114.12"><name>Note</name><desc>Turn left at ${url}</desc></wpt>
    <wpt lat="27.47" lon="114.13"><name>Plain</name></wpt>
    <trk><trkseg><trkpt lat="27.45" lon="114.11"/><trkpt lat="27.46" lon="114.12"/></trkseg></trk>
  </gpx>`;
  const gpx = parseGpx(xml);
  const [start, note, plain] = gpx.waypoints;
  assert.deepEqual(start.images, [url]);
  assert.equal(start.description, undefined);
  assert.equal(note.description, `Turn left at ${url}`);
  assert.equal(note.images, undefined);
  assert.equal(plain.images, undefined);
});

test('parseGpx ignores non-image webpage <link> elements while keeping image links', () => {
  const xml = `<gpx version="1.1">
    <wpt lat="27.45" lon="114.11">
      <name>Trailhead</name>
      <link href="https://example.com/trails/wugong"><text>Trail page</text></link>
      <link href="https://example.com/photos/view.jpg"><text>View</text></link>
      <link href="https://cdn.example.com/raw/123"><type>image/png</type></link>
    </wpt>
  </gpx>`;
  const gpx = parseGpx(xml);
  assert.deepEqual(gpx.waypoints[0].images, [
    'https://example.com/photos/view.jpg',
    'https://cdn.example.com/raw/123',
  ]);
});

test('parseGpx strips waypoint telemetry, falls back to cmt, backfills missing time and keeps placeholders', () => {
  const xml = `<gpx version="1.1">
    <wpt lat="30.5000" lon="114.3000">
      <name>Telemetry Only</name>
      <desc>Lon: 114.3000, Lat: 30.5000, Alt: 420 m, Time: 2026-10-03T12:24:22Z</desc>
    </wpt>
    <wpt lat="30.5100" lon="114.3100">
      <name>Cmt Fallback</name>
      <time>2026-10-03T06:00:00Z</time>
      <desc>经度：114.31, 纬度：30.51, 时间：2026-10-03T09:00:00Z</desc>
      <cmt>Reliable spring</cmt>
    </wpt>
    <wpt lat="30.5200" lon="114.3200">
      <name>Placeholder</name>
      <desc>Auto-generated</desc>
    </wpt>
  </gpx>`;

  const gpx = parseGpx(xml);
  assert.equal(gpx.waypoints.length, 3);
  assert.equal(gpx.waypoints[0].description, undefined);
  assert.equal(gpx.waypoints[0].insightText, undefined);
  assert.equal(gpx.waypoints[0].time?.toISOString(), '2026-10-03T12:24:22.000Z');

  assert.equal(gpx.waypoints[1].description, 'Reliable spring');
  assert.equal(gpx.waypoints[1].insightText, 'Reliable spring');
  assert.equal(gpx.waypoints[1].time?.toISOString(), '2026-10-03T06:00:00.000Z');

  assert.equal(gpx.waypoints[2].description, 'Auto-generated');
  assert.equal(gpx.waypoints[2].time, undefined);
});
