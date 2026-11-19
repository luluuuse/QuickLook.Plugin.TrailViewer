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

const { GpxError } = await import('../../viewer/gpx.js');
const { KmlError, parseKml } = await import('../../viewer/kml.js');

test('parseKml reads LineString, Polygon holes, gx:Track alignment and sanitizes photo links', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
  <kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
    <Document>
      <name>Canyon Survey</name>
      <Placemark>
        <name>Track</name>
        <LineString><coordinates>114.3,30.5,120 114.31,30.51,140</coordinates></LineString>
      </Placemark>
      <Placemark>
        <name>Timed gx</name>
        <gx:Track>
          <when>2026-01-01T08:00:00Z</when>
          <when>2026-01-01T08:01:00Z</when>
          <when>2026-01-01T08:02:00Z</when>
          <gx:coord>114.30 30.50 100</gx:coord>
          <gx:coord>bad 999 0</gx:coord>
          <gx:coord>114.32 30.52 150</gx:coord>
        </gx:Track>
      </Placemark>
      <Placemark>
        <name>Zone</name>
        <Polygon>
          <outerBoundaryIs><LinearRing><coordinates>114,30 114.1,30 114.1,30.1 114,30</coordinates></LinearRing></outerBoundaryIs>
          <innerBoundaryIs><LinearRing><coordinates>114.02,30.02 114.04,30.02 114.04,30.04 114.02,30.02</coordinates></LinearRing></innerBoundaryIs>
        </Polygon>
      </Placemark>
      <Placemark>
        <name>Start duplicate</name>
        <Point><coordinates>114.300001,30.500001,10</coordinates></Point>
      </Placemark>
      <Placemark>
        <name>Photo Stop</name>
        <description><![CDATA[
          <p>Lookout &nbsp;<b>ridge</b></p>
          <img src="https://example.com/a.jpg?w=1&amp;h=2" />
          <img src="javascript:alert(1)" />
          <img src="file:///C:/secret.png" />
          <img src="data:text/html;base64,PHNjcmlwdD4=" />
          <img src="photos/local.jpg" />
          <img src="data:image/png;base64,AAAA" />
          <img src="https://example.com/a.jpg?w=1&amp;h=2" />
        ]]></description>
        <Point><coordinates>114.300002,30.500002,10</coordinates></Point>
      </Placemark>
    </Document>
  </kml>`;

  const kml = parseKml(xml);
  assert.equal(kml.name, 'Canyon Survey');
  assert.equal(kml.network, false);
  assert.equal(kml.tracks.length, 2);
  assert.equal(kml.tracks[0].segments[0].length, 2);
  assert.deepEqual(kml.tracks[1].segments[0].map((p) => p.time.toISOString()), [
    '2026-01-01T08:00:00.000Z',
    '2026-01-01T08:02:00.000Z',
  ]);
  assert.equal(kml.areas.length, 1);
  assert.equal(kml.areas[0].rings.length, 2);
  assert.equal(kml.waypoints.length, 1);
  assert.equal(kml.waypoints[0].name, 'Photo Stop');
  assert.equal(kml.waypoints[0].description, 'Lookout ridge');
  assert.deepEqual(kml.waypoints[0].images, [
    'https://example.com/a.jpg?w=1&h=2',
    'photos/local.jpg',
    'data:image/png;base64,AAAA',
  ]);
});

test('parseKml detects route networks, strips network time/ele and reads TwoBulu totals', () => {
  const xml = `<kml>
    <Document>
      <ExtendedData>
        <Data name="segment_count"><value>25</value></Data>
        <Data name="duration_seconds"><value>0</value></Data>
        <Data name="distance_meters"><value>150000</value></Data>
        <Data name="TimeUsed"><value>3600000</value></Data>
        <Data name="PauseTime"><value>600000</value></Data>
      </ExtendedData>
      <Placemark>
        <gx:Track>
          <when>2026-01-01T08:00:00Z</when>
          <gx:coord>114.3 30.5 220</gx:coord>
        </gx:Track>
      </Placemark>
    </Document>
  </kml>`;

  const kml = parseKml(xml);
  assert.equal(kml.network, true);
  assert.equal(kml.timeUsedSeconds, 3600);
  assert.equal(kml.pauseSeconds, 600);
  assert.equal(kml.tracks[0].segments[0][0].time, undefined);
  assert.equal(kml.tracks[0].segments[0][0].ele, undefined);
});

test('parseKml rejects malformed XML with GpxError and non-kml roots with KmlError', () => {
  assert.throws(() => parseKml('<kml><Document></kml>'), GpxError);
  assert.throws(() => parseKml('<gpx></gpx>'), KmlError);
});
