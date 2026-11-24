import assert from 'node:assert/strict';
import test from 'node:test';
import { findGarminWaypointWarnings, serializeGpx } from '../../viewer/gpx-serializer.js';

test('serializeGpx outputs UTF-8 GPX 1.1 XML preserving ele, time, heartRate and waypoints while cleaning NaN/dups', () => {
  const input = {
    name: 'Test & <Trail>',
    tracks: [{
      name: 'Seg 1',
      segments: [[
        { lat: 39.9, lon: 116.3, ele: 100, time: new Date('2026-10-01T08:00:00Z'), heartRate: 132 },
        { lat: 39.9, lon: 116.3, ele: 100, time: new Date('2026-10-01T08:00:00Z'), heartRate: 132 },
        { lat: Number.NaN, lon: 116.3 },
        { lat: 39.91, lon: 116.31, ele: 250, time: new Date('2026-10-01T08:10:00Z'), heartRate: 158 },
      ]],
    }],
    routes: [],
    waypoints: [
      { lat: 39.905, lon: 116.305, ele: 175, name: 'Water', description: 'Clean spring', icon: 'water' },
      { lat: 39.906, lon: 116.306, name: 'Photo', images: ['https://example.com/f?a=1&b=2'] },
    ],
    areas: [],
  };

  const xml = serializeGpx(input, { watchFriendly: true });
  assert.ok(!xml.startsWith('\uFEFF'));
  assert.ok(xml.includes('<metadata><name>Test &amp; &lt;Trail&gt;</name></metadata>'));
  assert.ok(xml.includes('<sym>water</sym>'));
  assert.ok(xml.includes('<link href="https://example.com/f?a=1&amp;b=2"><text>media</text></link>'));
  assert.ok(xml.includes('<gpxtpx:hr>132</gpxtpx:hr>'));
  assert.ok(xml.includes('<gpxtpx:hr>158</gpxtpx:hr>'));
  assert.equal((xml.match(/<trkpt /g) || []).length, 2);
  assert.ok(!xml.includes('NaN'));
});

test('findGarminWaypointWarnings detects >15 char names and truncated collisions', () => {
  const result = findGarminWaypointWarnings([
    { name: 'Checkpoint_Alpha_One' },
    { name: 'Checkpoint_Alpha_Two' },
    { name: 'Camp' },
  ]);
  assert.equal(result.tooLongCount, 2);
  assert.equal(result.collisionCount, 1);
});
