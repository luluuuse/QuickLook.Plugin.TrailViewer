import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { FitError, fitCrc, isFit, parseFit } from '../../viewer/fit.js';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name));

test('FIT activity reads records, compressed timestamps, elevation and a course point', () => {
  const bytes = fixture('synthetic.fit');
  assert.equal(isFit(bytes), true);
  assert.equal(fitCrc(bytes, 0, bytes.length - 2), bytes.readUInt16LE(bytes.length - 2));

  const track = parseFit(bytes);
  const points = track.tracks[0].segments[0];
  assert.equal(track.version, 'FIT');
  assert.equal(track.name, 'Synthetic FIT');
  assert.equal(points.length, 5);
  assert.equal(track.waypoints.length, 1);
  assert.equal(track.waypoints[0].name, 'Hut');
  assert.deepEqual(points.map((point) => point.ele), [1500, 1505, 1510, 1515, 1520]);
  assert.deepEqual(points.map((point) => point.heartRate), [118, 119, 120, 121, 122]);
  assert.deepEqual(points.map((point) => point.time.toISOString()), [
    '2026-01-06T09:00:00.000Z',
    '2026-01-06T09:00:15.000Z',
    '2026-01-06T09:00:30.000Z',
    '2026-01-06T09:00:45.000Z',
    '2026-01-06T09:01:00.000Z',
  ]);
  assert.equal(track.timeUsedSeconds, 3600);
  assert.equal(track.pauseSeconds, 300);
});

test('FIT optional developer bytes do not shift later records', () => {
  const points = parseFit(fixture('synthetic.fit')).tracks[0].segments[0];
  assert.ok(Math.abs(points[4].lat - 46.5008) < 1e-6);
  assert.ok(Math.abs(points[4].lon - 7.9012) < 1e-6);
});

test('FIT errors distinguish truncation, checksum damage and a workout without GPS', () => {
  const cases = [
    ['truncated.fit', 'truncated'],
    ['bad-crc.fit', 'crc'],
    ['no-gps.fit', 'workoutNoGps'],
  ];
  for (const [name, code] of cases) {
    assert.throws(() => parseFit(fixture(name)), (error) => {
      assert.ok(error instanceof FitError);
      assert.equal(error.code, code);
      return true;
    });
  }
});

test('FIT rejects trailing data and non-FIT text without using XML errors', () => {
  const valid = fixture('synthetic.fit');
  const trailing = new Uint8Array(valid.length + 1);
  trailing.set(valid);
  assert.throws(() => parseFit(trailing), (error) => error instanceof FitError && error.code === 'corrupt');

  const text = Buffer.from('<gpx version="1.1"></gpx>');
  assert.equal(isFit(text), false);
  assert.throws(() => parseFit(text), (error) => error instanceof FitError && error.code === 'notFit');
});
