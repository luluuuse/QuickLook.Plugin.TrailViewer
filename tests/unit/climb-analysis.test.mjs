import assert from 'node:assert/strict';
import test from 'node:test';
import { detectClimbs, summariseRange } from '../../viewer/climb-analysis.js';

test('detectClimbs finds sustained ClimbPro climbs and ignores small bumps', () => {
  const samples = [];
  for (let d = 0; d <= 3000; d += 25) {
    let ele = 100;
    if (d <= 400) ele = 100 + (d / 400) * 10; // small 10 m bump -> ignored
    else if (d <= 1400) ele = 110 + ((d - 400) / 1000) * 120; // 1 km, +120 m (12%) -> Climb #1
    else if (d <= 1800) ele = 230 - ((d - 1400) / 400) * 30; // descent -> ignored
    else if (d <= 2700) ele = 200 + ((d - 1800) / 900) * 90; // 900 m, +90 m (10%) -> Climb #2
    else ele = 290;
    samples.push({ along: d, ele });
  }

  const climbs = detectClimbs(samples);
  assert.equal(climbs.length, 2);
  assert.equal(climbs[0].index, 1);
  assert.ok(climbs[0].lengthMeters >= 800 && climbs[0].ascent >= 90);
  assert.ok(climbs[0].avgGrade >= 0.08 && climbs[0].maxGrade >= climbs[0].avgGrade);
  assert.equal(climbs[1].index, 2);
  assert.ok(climbs[1].ascent >= 70);
});

test('summariseRange computes distance, elevation gain, grade, duration, speed and HR', () => {
  const startMs = Date.parse('2026-11-20T08:00:00Z');
  const points = [];
  for (let i = 0; i <= 20; i += 1) {
    const along = i * 100;
    points.push({
      along,
      ele: 100 + i * 10, // +200 m over 2000 m = 10%
      time: new Date(startMs + i * 60_000), // 1200 s over 2000 m = 6.0 km/h
      heartRate: 140 + (i % 3) * 5,
      segmentIndex: 0,
    });
  }
  const stats = summariseRange(points, points, 500, 1500);
  assert.ok(stats);
  assert.equal(stats.distanceMeters, 1000);
  assert.equal(stats.ascent, 100);
  assert.equal(stats.descent, 0);
  assert.ok(Math.abs(stats.avgGrade - 0.1) < 1e-6);
  assert.equal(stats.durationSeconds, 600);
  assert.ok(Math.abs(stats.avgSpeedMps - 1000 / 600) < 1e-6);
  assert.ok(stats.avgHeartRate >= 140 && stats.avgHeartRate <= 150);
  assert.equal(summariseRange(points, points, 500, 500), null);
});
