import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanWaypointDescription } from '../../viewer/waypoint-description.js';

test('strips TwoBulu HTML telemetry block and backfills local timestamp', () => {
  const raw = '<div>经度：114.300000</div><div>纬度：30.500000</div>'
    + '<div>海拔：856.123456</div><div>时间：2026-10-03 12:24:22</div>';
  const cleaned = cleanWaypointDescription(raw, { html: true });
  assert.equal(cleaned.text, undefined);
  assert.ok(cleaned.time instanceof Date);
  assert.equal(cleaned.time.getFullYear(), 2026);
  assert.equal(cleaned.time.getMonth(), 9);
  assert.equal(cleaned.time.getDate(), 3);
  assert.equal(cleaned.time.getHours(), 12);
  assert.equal(cleaned.time.getMinutes(), 24);
  assert.equal(cleaned.time.getSeconds(), 22);
});

test('strips HTML photo wrapper plus telemetry when no user note exists', () => {
  const raw = '<div><a href="https://example.test/p/1" target="_blank">'
    + '<img width="320px" src="https://example.test/1.jpg" /></a></div></br>'
    + '<div>经度：114.300000</div><div>纬度：30.500000</div>'
    + '<div>海拔：800.5</div><div>时间：2026-10-02 09:27:44</div>';
  const cleaned = cleanWaypointDescription(raw, { html: true });
  assert.equal(cleaned.text, undefined);
  assert.equal(cleaned.time?.getHours(), 9);
  assert.equal(cleaned.time?.getMinutes(), 27);
});

test('preserves genuine user notes around or inside telemetry blocks', () => {
  const before = cleanWaypointDescription(
    '<div>Steep rock step!</div><div>经度：114.3</div><div>纬度：30.5</div><div>海拔：720</div><div>时间：2026-10-03 08:15:00</div>',
    { html: true },
  );
  assert.equal(before.text, 'Steep rock step!');
  assert.equal(before.time?.getHours(), 8);

  const insideAnchor = cleanWaypointDescription(
    '<div><a href="" target="_blank"><img src="https://example.test/1.jpg" />Water spring here</a></div></br>'
    + '<div>经度：114.3</div><div>纬度：30.5</div><div>海拔：720</div>',
    { html: true },
  );
  assert.equal(insideAnchor.text, 'Water spring here');
  assert.equal(insideAnchor.time, undefined);

  const inline = cleanWaypointDescription(
    'Note before | Lon: 114.3, Lat: 30.5, Alt: 500 m | Note after。经度：114.3，纬度：30.5',
    { html: false },
  );
  assert.equal(inline.text, 'Note before Note after。');

  const sentenceBefore = cleanWaypointDescription('陡坡小心！经度：114.3，纬度：30.5', { html: false });
  assert.equal(sentenceBefore.text, '陡坡小心！');
});

test('strips English telemetry and combined coordinate pairs while parsing Z/offset times', () => {
  const english = cleanWaypointDescription(
    'Lon: 114.3000, Lat: 30.5000, Alt: 546 m, Speed: 3.2 km/h, Time: 2026-10-03T12:24:22Z',
    { html: false },
  );
  assert.equal(english.text, undefined);
  assert.equal(english.time?.toISOString(), '2026-10-03T12:24:22.000Z');

  const pair = cleanWaypointDescription(
    '坐标：30.5000°N, 114.3000°E, 500m 时间：2026-10-03T12:24:22+08:00\nTake the left fork',
    { html: false },
  );
  assert.equal(pair.text, 'Take the left fork');
  assert.equal(pair.time?.toISOString(), '2026-10-03T04:24:22.000Z');
});

test('strips space-less CJK telemetry chains', () => {
  const cleaned = cleanWaypointDescription(
    '经度：114.3000纬度：30.5000海拔：1032.04时间：2026-10-03 12:24:22',
    { html: false },
  );
  assert.equal(cleaned.text, undefined);
  assert.equal(cleaned.time?.getHours(), 12);
});

test('leaves natural prose, placeholders, invalid coordinates and bad words untouched', () => {
  const cases = [
    '海拔3200米垭口风很大',
    '海拔：1800m，营地可扎5顶帐篷',
    '海拔：1800m 时间：2026-10-03 08:00 集合',
    'Auto-generated',
    'Lat: 95.0, Lon: 114.3, Alt: 500',
    'Coordinates: 190, 200',
    'plate: 12, salt: 5, realtime: 2026-10-03 12:00:00, update: 2026-10-03',
  ];
  for (const input of cases) {
    const cleaned = cleanWaypointDescription(input, { html: false });
    assert.equal(cleaned.text, input);
    assert.equal(cleaned.time, undefined);
  }
});

test('handles date-only telemetry and invalid calendar dates safely', () => {
  const dateOnly = cleanWaypointDescription(
    'Lon: 114.3, Lat: 30.5, Date: 2026-10-03',
    { html: false },
  );
  assert.equal(dateOnly.text, undefined);
  assert.equal(dateOnly.time, undefined);

  const badCalendarDate = cleanWaypointDescription(
    'Lon: 114.3, Lat: 30.5, Time: 2026-02-31 12:00:00',
    { html: false },
  );
  assert.equal(badCalendarDate.text, 'Time: 2026-02-31 12:00:00');
  assert.equal(badCalendarDate.time, undefined);
});
