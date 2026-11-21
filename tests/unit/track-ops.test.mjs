import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addWaypoint,
  cleanAnomalies,
  closeLoop,
  cropTrack,
  deleteTrackSegment,
  deleteWaypoint,
  isTrackClosedLoop,
  makeOutAndBack,
  moveWaypoint,
  reverseTrack,
  splitTrackAt,
  trackTotalDistance,
  updateWaypoint,
} from '../../viewer/track-ops.js';

function sampleTrack() {
  return {
    name: 'Ridge Loop',
    tracks: [{
      name: 'Main',
      segments: [[
        { lat: 39.9, lon: 116.3, ele: 100, time: new Date('2026-10-01T08:00:00Z'), heartRate: 130 },
        { lat: 39.909, lon: 116.3, ele: 200, time: new Date('2026-10-01T08:15:00Z'), heartRate: 145 },
        { lat: 39.918, lon: 116.3, ele: 300, time: new Date('2026-10-01T08:30:00Z'), heartRate: 155 },
      ]],
    }],
    routes: [],
    waypoints: [
      { lat: 39.909, lon: 116.3, ele: 200, name: 'Spring', icon: 'water' },
    ],
    areas: [],
  };
}

test('cropTrack trims to cumulative distance, clears KML summary metadata and preserves point metadata', () => {
  const base = { ...sampleTrack(), timeUsedSeconds: 1800, pauseSeconds: 120 };
  const total = trackTotalDistance(base);
  const cropped = cropTrack(base, total * 0.25, total * 0.75);
  const croppedDist = trackTotalDistance(cropped);
  assert.ok(Math.abs(croppedDist - total * 0.5) < 5);
  assert.equal(cropped.tracks[0].segments[0][0].heartRate, 138);
  assert.equal(cropped.timeUsedSeconds, undefined);
  assert.equal(cropped.pauseSeconds, undefined);
  assert.equal(base.tracks[0].segments[0].length, 3);
});

test('splitTrackAt produces two tracks and deleteTrackSegment removes one', () => {
  const base = sampleTrack();
  const total = trackTotalDistance(base);
  const split = splitTrackAt(base, total * 0.5);
  assert.equal(split.tracks.length, 2);
  assert.ok(Math.abs(trackTotalDistance({ ...split, tracks: [split.tracks[0]] }) - total * 0.5) < 5);

  const single = deleteTrackSegment(split, 1);
  assert.equal(single.tracks.length, 1);
});

test('deleteTrackSegment works on route-only GPX after normalizing routes', () => {
  const routeOnly = {
    name: 'RouteOnly',
    tracks: [],
    routes: [
      { name: 'R1', points: [{ lat: 39.9, lon: 116.3 }, { lat: 39.91, lon: 116.3 }] },
      { name: 'R2', points: [{ lat: 39.91, lon: 116.3 }, { lat: 39.92, lon: 116.3 }] },
    ],
    waypoints: [],
    areas: [],
  };
  const deleted = deleteTrackSegment(routeOnly, 1);
  assert.equal(deleted.tracks.length, 1);
  assert.equal(deleted.routes.length, 0);
  assert.equal(deleted.tracks[0].name, 'R1');
});

test('reverseTrack reverses points and clears timestamps', () => {
  const base = sampleTrack();
  const { track, clearedTimestamps } = reverseTrack(base);
  assert.equal(clearedTimestamps, true);
  assert.equal(track.tracks[0].segments[0][0].ele, 300);
  assert.equal(track.tracks[0].segments[0][0].time, undefined);
});

test('makeOutAndBack doubles distance, clears all timestamps and closeLoop connects ends', () => {
  const base = sampleTrack();
  const total = trackTotalDistance(base);
  const { track: roundtrip, clearedTimestamps } = makeOutAndBack(base);
  assert.equal(clearedTimestamps, true);
  assert.ok(Math.abs(trackTotalDistance(roundtrip) - total * 2) < 5);
  assert.ok(roundtrip.tracks[0].segments[0].every((p) => p.time === undefined));

  const { track: looped, closureMeters } = closeLoop(base);
  assert.ok(closureMeters > 1000);
  const pts = looped.tracks[0].segments[0];
  assert.equal(pts[pts.length - 1].lat, pts[0].lat);
});

test('cleanAnomalies removes only isolated spike B in A->B->C without deleting normal point C', () => {
  const base = {
    name: 'Spike',
    tracks: [{
      name: 'Main',
      segments: [[
        { lat: 39.9000, lon: 116.3000, ele: 100, time: new Date('2026-10-01T08:00:00Z') },
        { lat: 39.9010, lon: 116.3000, ele: 110, time: new Date('2026-10-01T08:01:00Z') },
        { lat: 40.5000, lon: 116.3000, ele: 120, time: new Date('2026-10-01T08:01:05Z') },
        { lat: 39.9012, lon: 116.3000, ele: 112, time: new Date('2026-10-01T08:02:00Z') },
      ]],
    }],
    routes: [],
    waypoints: [],
    areas: [],
  };
  const { track, removedCount } = cleanAnomalies(base);
  assert.equal(removedCount, 1);
  assert.equal(track.tracks[0].segments[0].length, 3);
  assert.ok(track.tracks[0].segments[0].some((p) => p.lat === 39.9012));
});

test('waypoint CRUD helpers stay immutable', () => {
  const base = sampleTrack();
  const added = addWaypoint(base, { lat: 39.91, lon: 116.31, name: 'Camp', icon: 'camp' });
  assert.equal(added.waypoints.length, 2);
  assert.equal(base.waypoints.length, 1);

  const updated = updateWaypoint(added, 1, { name: 'High Camp' });
  assert.equal(updated.waypoints[1].name, 'High Camp');

  const moved = moveWaypoint(updated, 1, 39.92, 116.32);
  assert.equal(moved.waypoints[1].lat, 39.92);

  const removed = deleteWaypoint(moved, 0);
  assert.equal(removed.waypoints.length, 1);
  assert.equal(removed.waypoints[0].name, 'High Camp');
});

test('cropTrack and deleteTrackSegment prune waypoints on removed sections', () => {
  const base = {
    name: 'Long Trail',
    tracks: [{
      name: 'Main',
      segments: [[
        { lat: 39.900, lon: 116.300, ele: 100 },
        { lat: 39.910, lon: 116.300, ele: 200 },
        { lat: 39.920, lon: 116.300, ele: 300 },
      ]],
    }],
    routes: [],
    waypoints: [
      { lat: 39.901, lon: 116.300, name: 'Start Wpt' },
      { lat: 39.910, lon: 116.300, name: 'Mid Wpt' },
      { lat: 39.919, lon: 116.300, name: 'End Wpt' },
    ],
    areas: [],
  };
  const total = trackTotalDistance(base);
  const cropped = cropTrack(base, total * 0.35, total * 0.65);
  assert.deepEqual(cropped.waypoints.map((w) => w.name), ['Mid Wpt']);

  const split = splitTrackAt(base, total * 0.5);
  const afterDel = deleteTrackSegment(split, 0);
  assert.deepEqual(afterDel.waypoints.map((w) => w.name), ['Mid Wpt', 'End Wpt']);
});

test('isTrackClosedLoop detects open vs closed tracks', () => {
  const base = sampleTrack();
  assert.equal(isTrackClosedLoop(base), false);
  const { track: looped } = closeLoop(base);
  assert.equal(isTrackClosedLoop(looped), true);
});
