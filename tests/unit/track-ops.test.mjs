import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SPLIT_COLORS,
  addWaypoint,
  appendExternalTrack,
  applyDrawnPath,
  cleanAnomalies,
  closeLoop,
  createSegmentColorResolver,
  cropTrack,
  dedupeWaypoints,
  deleteTrackSegment,
  deleteTrackVertex,
  deleteWaypoint,
  eraseTrackPointsInBounds,
  generateMilestoneWaypoints,
  generateVirtualTimeline,
  insertTrackVertex,
  isTrackClosedLoop,
  makeOutAndBack,
  mergeTrackSegments,
  moveTrackVertex,
  moveWaypoint,
  reverseTrack,
  rotateLoopStart,
  shiftTrackTimestamps,
  simplifyTrack,
  smoothTrackElevation,
  sortWaypointsAlongTrack,
  sortWaypointsByRoute,
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

test('mergeTrackSegments combines split tracks into one continuous segment', () => {
  const base = sampleTrack();
  const split = splitTrackAt(base, trackTotalDistance(base) * 0.5);
  assert.equal(split.tracks.length, 2);
  const { track: merged } = mergeTrackSegments(split);
  assert.equal(merged.tracks.length, 1);
  assert.equal(merged.tracks[0].segments.length, 1);
});

test('rotateLoopStart moves loop start/end to closest point along track', () => {
  const { track: looped } = closeLoop(sampleTrack());
  const total = trackTotalDistance(looped);
  const { track: rotated, rotated: ok } = rotateLoopStart(looped, total * 0.45);
  assert.equal(ok, true);
  const seg = rotated.tracks[0].segments[0];
  assert.equal(seg[0].lat, seg[seg.length - 1].lat);
  assert.equal(seg[0].time, undefined);
});

test('simplifyTrack reduces collinear points while keeping endpoints', () => {
  const base = {
    name: 'Straight',
    tracks: [{
      name: 'S',
      segments: [[
        { lat: 39.9, lon: 116.3, ele: 100 },
        { lat: 39.901, lon: 116.3, ele: 105 },
        { lat: 39.902, lon: 116.3, ele: 110 },
        { lat: 39.903, lon: 116.3, ele: 115 },
      ]],
    }],
    routes: [],
    waypoints: [],
    areas: [],
  };
  const { track: simplified, beforeCount, afterCount } = simplifyTrack(base, 5);
  assert.equal(beforeCount, 4);
  assert.equal(afterCount, 2);
  assert.equal(simplified.tracks[0].segments[0].length, 2);
});

test('vertex move, insert, delete and box erase mutate segments safely', () => {
  const base = sampleTrack();
  const moved = moveTrackVertex(base, 0, 1, 39.91, 116.31);
  assert.equal(moved.tracks[0].segments[0][1].lat, 39.91);

  const inserted = insertTrackVertex(moved, 0, 0, 39.905, 116.305, 150);
  assert.equal(inserted.tracks[0].segments[0].length, 4);

  const deleted = deleteTrackVertex(inserted, 0, 1);
  assert.equal(deleted.tracks[0].segments[0].length, 3);

  const { track: erased, removedCount } = eraseTrackPointsInBounds(base, {
    south: 39.908, north: 39.91, west: 116.299, east: 116.301,
  });
  assert.equal(removedCount, 1);
  assert.equal(erased.tracks[0].segments[0].length, 2);
});

test('shiftTrackTimestamps and generateVirtualTimeline update point times monotonically', () => {
  const base = sampleTrack();
  const { track: shifted, shiftedCount } = shiftTrackTimestamps(base, 600);
  assert.equal(shiftedCount, 3); // 3 track points
  assert.equal(shifted.tracks[0].segments[0][0].time.toISOString(), '2026-10-01T08:10:00.000Z');

  const startMs = Date.parse('2026-10-01T09:00:00Z');
  const { track: virt, durationSeconds, pointCount } = generateVirtualTimeline(base, startMs, 2);
  assert.equal(pointCount, 3);
  assert.ok(durationSeconds > 900);
  assert.equal(virt.tracks[0].segments[0][0].time.getTime(), startMs);
  assert.ok(virt.tracks[0].segments[0][2].time.getTime() > virt.tracks[0].segments[0][1].time.getTime());
});

test('vertex ops target exact flatSegIndex when degenerate 1-point segment precedes it', () => {
  const base = {
    name: 'with-degenerate',
    tracks: [{
      name: 't',
      segments: [
        [{ lat: 39.9, lon: 116.3 }],
        [
          { lat: 39.91, lon: 116.31, ele: 100 },
          { lat: 39.92, lon: 116.32, ele: 120 },
          { lat: 39.93, lon: 116.33, ele: 140 },
        ],
      ],
    }],
    routes: [],
    waypoints: [],
    areas: [],
  };
  const moved = moveTrackVertex(base, 1, 1, 39.925, 116.325);
  assert.equal(moved.tracks[0].segments[0].length, 1);
  assert.equal(moved.tracks[0].segments[1][1].lat, 39.925);

  const inserted = insertTrackVertex(moved, 1, 0, 39.915, 116.315, 110);
  assert.equal(inserted.tracks[0].segments[1].length, 4);

  const deleted = deleteTrackVertex(inserted, 1, 1);
  assert.equal(deleted.tracks[0].segments[1].length, 3);
});

test('eraseTrackPointsInBounds removes start/end spurs while keeping >= 2 points', () => {
  const base = sampleTrack();
  const { track: erasedStart, removedCount } = eraseTrackPointsInBounds(base, {
    south: 39.899, north: 39.901, west: 116.299, east: 116.301,
  });
  assert.equal(removedCount, 1);
  assert.equal(erasedStart.tracks[0].segments[0].length, 2);
  assert.equal(erasedStart.tracks[0].segments[0][0].lat, 39.909);

  // If box covers all points, protect at least one valid segment instead of emptying track
  const { removedCount: blocked } = eraseTrackPointsInBounds(base, {
    south: 39.0, north: 40.0, west: 116.0, east: 117.0,
  });
  assert.equal(blocked, 0);
});

test('isTrackClosedLoop accepts 20m GPS gap and rotateLoopStart reports timestampsCleared', () => {
  const nearLoop = {
    name: 'near-loop',
    tracks: [{
      name: 't',
      segments: [[
        { lat: 39.9000, lon: 116.3000, time: new Date('2026-10-01T08:00:00Z') },
        { lat: 39.9050, lon: 116.3000, time: new Date('2026-10-01T08:10:00Z') },
        { lat: 39.9050, lon: 116.3050, time: new Date('2026-10-01T08:20:00Z') },
        { lat: 39.90015, lon: 116.3001, time: new Date('2026-10-01T08:30:00Z') },
      ]],
    }],
    routes: [],
    waypoints: [],
    areas: [],
  };
  assert.equal(isTrackClosedLoop(nearLoop), true);
  const total = trackTotalDistance(nearLoop);
  const { track: rotated, rotated: ok, timestampsCleared } = rotateLoopStart(nearLoop, total * 0.5);
  assert.equal(ok, true);
  assert.equal(timestampsCleared, true);
  const seg = rotated.tracks[0].segments[0];
  assert.equal(seg.length, 5);
  assert.equal(seg[0].lat, seg[seg.length - 1].lat);
  assert.equal(seg[0].time, undefined);
});

test('insertTrackVertex interpolates time and heartRate between adjacent vertices', () => {
  const base = {
    name: 'hr-time',
    tracks: [{
      name: 't',
      segments: [[
        { lat: 39.900, lon: 116.300, ele: 100, heartRate: 120, time: new Date('2026-10-01T08:00:00Z') },
        { lat: 39.910, lon: 116.300, ele: 200, heartRate: 160, time: new Date('2026-10-01T08:10:00Z') },
      ]],
    }],
    routes: [],
    waypoints: [],
    areas: [],
  };
  const next = insertTrackVertex(base, 0, 0, 39.905, 116.300);
  const mid = next.tracks[0].segments[0][1];
  assert.equal(mid.heartRate, 140);
  assert.equal(mid.time.toISOString(), '2026-10-01T08:05:00.000Z');
  assert.ok(Math.abs(mid.ele - 150) < 1);
});

test('mergeTrackSegments reorders out-of-order segments and reports maxGapMeters', () => {
  const base = {
    name: 'multi',
    tracks: [
      {
        name: 'later',
        segments: [[
          { lat: 39.920, lon: 116.300, time: new Date('2026-10-01T09:00:00Z') },
          { lat: 39.925, lon: 116.300, time: new Date('2026-10-01T09:10:00Z') },
        ]],
      },
      {
        name: 'earlier',
        segments: [[
          { lat: 39.900, lon: 116.300, time: new Date('2026-10-01T08:00:00Z') },
          { lat: 39.905, lon: 116.300, time: new Date('2026-10-01T08:10:00Z') },
        ]],
      },
    ],
    routes: [],
    waypoints: [],
    areas: [],
  };
  const { track, reorderedByTime, maxGapMeters } = mergeTrackSegments(base);
  assert.equal(reorderedByTime, true);
  assert.ok(maxGapMeters > 500);
  assert.equal(track.tracks[0].segments[0][0].lat, 39.900);
});

test('generateVirtualTimeline advances by at least 1000ms across segment boundaries', () => {
  const base = {
    name: 'two-seg',
    tracks: [{
      name: 't',
      segments: [
        [{ lat: 39.900, lon: 116.300 }, { lat: 39.905, lon: 116.300 }],
        [{ lat: 39.906, lon: 116.300 }, { lat: 39.910, lon: 116.300 }],
      ],
    }],
    routes: [],
    waypoints: [],
    areas: [],
  };
  const { track } = generateVirtualTimeline(base, Date.parse('2026-10-01T08:00:00Z'), 2);
  const seg0End = track.tracks[0].segments[0][1].time.getTime();
  const seg1Start = track.tracks[0].segments[1][0].time.getTime();
  assert.ok(seg1Start - seg0End >= 1000);
});

test('eraseTrackPointsInBounds prunes only waypoints inside bounds and reports removedWaypointCount', () => {
  const base = sampleTrack();
  // Waypoint outside box (very close to erased point) must be preserved
  base.waypoints.push({ lat: 39.9092, lon: 116.3015, name: 'w-outside-close' });
  base.waypoints.push({ lat: 39.918, lon: 116.3, name: 'w-kept' });
  const { track: erased, removedCount, removedWaypointCount } = eraseTrackPointsInBounds(base, {
    south: 39.908, north: 39.910, west: 116.299, east: 116.301,
  });
  assert.equal(removedCount, 1);
  assert.equal(removedWaypointCount, 1);
  assert.equal(erased.waypoints.length, 2);
  assert.equal(erased.waypoints[0].name, 'w-outside-close');
  assert.equal(erased.waypoints[1].name, 'w-kept');
});

test('mergeTrackSegments clears timestamps when segments have overlapping time ranges', () => {
  const overlapping = {
    name: 'overlap',
    tracks: [{
      name: 't',
      segments: [
        [
          { lat: 39.900, lon: 116.300, time: new Date('2026-10-01T08:00:00Z') },
          { lat: 39.905, lon: 116.300, time: new Date('2026-10-01T08:20:00Z') },
        ],
        [
          { lat: 39.910, lon: 116.300, time: new Date('2026-10-01T08:10:00Z') },
          { lat: 39.915, lon: 116.300, time: new Date('2026-10-01T08:30:00Z') },
        ],
      ],
    }],
    routes: [],
    waypoints: [],
    areas: [],
  };
  const { track, timestampsCleared } = mergeTrackSegments(overlapping);
  assert.equal(timestampsCleared, true);
  assert.equal(track.tracks[0].segments[0][0].time, undefined);
});

test('sortWaypointsByRoute orders waypoints along route distance including loop ends', () => {
  const base = closeLoop(sampleTrack()).track;
  base.waypoints = [
    { lat: 39.900, lon: 116.300, name: '终点' },
    { lat: 39.900, lon: 116.300, name: '起点' },
    { lat: 39.909, lon: 116.300, name: '中途垭口' },
  ];
  const ordered = sortWaypointsByRoute(base);
  assert.deepEqual(ordered.map((item) => item.wpt.name), ['起点', '中途垭口', '终点']);
  assert.deepEqual(ordered.map((item) => item.index), [1, 2, 0]);
});

test('applyDrawnPath replaces same-segment span forward with interpolated elevation and clears timestamps', () => {
  const base = {
    name: 'gap',
    tracks: [{
      name: 'Main',
      segments: [[
        { lat: 39.900, lon: 116.300, ele: 100, time: new Date('2026-10-01T08:00:00Z') },
        { lat: 39.905, lon: 116.300, ele: 150, time: new Date('2026-10-01T08:05:00Z') },
        { lat: 39.910, lon: 116.300, ele: 200, time: new Date('2026-10-01T08:10:00Z') },
        { lat: 39.920, lon: 116.300, ele: 300, time: new Date('2026-10-01T08:20:00Z') },
      ]],
    }],
    routes: [],
    waypoints: [],
    areas: [],
  };
  const drawn = [
    { lat: 39.900, lon: 116.300 },
    { lat: 39.905, lon: 116.302 },
    { lat: 39.910, lon: 116.300 },
  ];
  const res = applyDrawnPath(base, drawn, {
    startSnap: { flatSegIndex: 0, ptIndex: 0 },
    endSnap: { flatSegIndex: 0, ptIndex: 2 },
  });
  assert.equal(res.mode, 'replace');
  assert.equal(res.addedPoints, 1);
  assert.equal(res.timestampsCleared, true);
  const seg = res.track.tracks[0].segments[0];
  assert.equal(seg.length, 4);
  assert.equal(seg[1].lon, 116.302);
  assert.ok(Math.abs(seg[1].ele - 150) < 2);
  assert.equal(seg[0].time, undefined);
});

test('applyDrawnPath reverses drawn middle points when endSnap precedes startSnap', () => {
  const base = {
    name: 'reverse-gap',
    tracks: [{
      name: 'Main',
      segments: [[
        { lat: 39.900, lon: 116.300, ele: 100 },
        { lat: 39.905, lon: 116.300, ele: 150 },
        { lat: 39.910, lon: 116.300, ele: 200 },
        { lat: 39.920, lon: 116.300, ele: 300 },
      ]],
    }],
    routes: [],
    waypoints: [],
    areas: [],
  };
  const drawn = [
    { lat: 39.910, lon: 116.300 },
    { lat: 39.907, lon: 116.303 },
    { lat: 39.903, lon: 116.303 },
    { lat: 39.900, lon: 116.300 },
  ];
  const res = applyDrawnPath(base, drawn, {
    startSnap: { flatSegIndex: 0, ptIndex: 2 },
    endSnap: { flatSegIndex: 0, ptIndex: 0 },
  });
  assert.equal(res.mode, 'replace');
  const seg = res.track.tracks[0].segments[0];
  assert.equal(seg.length, 5);
  assert.equal(seg[1].lat, 39.903);
  assert.equal(seg[2].lat, 39.907);
  assert.ok(seg[1].ele < seg[2].ele);
});

test('applyDrawnPath extends segment endpoints without fabricating elevation', () => {
  const base = {
    name: 'ext',
    tracks: [{
      name: 'Main',
      segments: [[
        { lat: 39.900, lon: 116.300, ele: 100 },
        { lat: 39.910, lon: 116.300, ele: 200 },
      ]],
    }],
    routes: [],
    waypoints: [],
    areas: [],
  };
  const res = applyDrawnPath(base, [
    { lat: 39.910, lon: 116.300 },
    { lat: 39.915, lon: 116.305 },
    { lat: 39.920, lon: 116.310 },
  ], { startSnap: { flatSegIndex: 0, ptIndex: 1 }, endSnap: null });
  assert.equal(res.mode, 'extend-end');
  const seg = res.track.tracks[0].segments[0];
  assert.equal(seg.length, 4);
  assert.equal(seg[2].ele, undefined);
  assert.equal(seg[3].lat, 39.920);
});

test('applyDrawnPath appends a new branch segment when not anchored to one segment', () => {
  const base = sampleTrack();
  const res = applyDrawnPath(base, [
    { lat: 39.95, lon: 116.35 },
    { lat: 39.96, lon: 116.36 },
  ]);
  assert.equal(res.mode, 'branch');
  assert.equal(res.track.tracks[0].segments.length, 2);
  assert.equal(res.track.tracks[0].segments[1].length, 2);
});

test('generateVirtualTimeline gradeAdjusted adds Naismith climb time and falls back when elevation is missing', () => {
  const climbing = {
    name: 'climb',
    tracks: [{
      name: 't',
      segments: [[
        { lat: 39.900, lon: 116.300, ele: 100 },
        { lat: 39.909, lon: 116.300, ele: 400 },
      ]],
    }],
    routes: [],
    waypoints: [],
    areas: [],
  };
  const start = Date.parse('2026-10-01T08:00:00Z');
  const flat = generateVirtualTimeline(climbing, start, 1.25, { gradeAdjusted: false });
  const graded = generateVirtualTimeline(climbing, start, 1.25, { gradeAdjusted: true });
  // +300m climb adds ~1800s under Naismith (+6 s/m).
  assert.ok(graded.durationSeconds - flat.durationSeconds >= 1790);

  const noEle = {
    name: 'flat',
    tracks: [{
      name: 't',
      segments: [[
        { lat: 39.900, lon: 116.300 },
        { lat: 39.909, lon: 116.300 },
      ]],
    }],
    routes: [],
    waypoints: [],
    areas: [],
  };
  const noEleFlat = generateVirtualTimeline(noEle, start, 1.25, { gradeAdjusted: false });
  const noEleGraded = generateVirtualTimeline(noEle, start, 1.25, { gradeAdjusted: true });
  assert.equal(noEleGraded.durationSeconds, noEleFlat.durationSeconds);
});

test('smoothTrackElevation removes isolated spikes, keeps endpoints and non-ele fields intact', () => {
  const noisy = {
    name: 'noisy',
    tracks: [{
      name: 't',
      segments: [[
        { lat: 39.900, lon: 116.300, ele: 100, heartRate: 120, time: new Date('2026-10-01T08:00:00Z') },
        { lat: 39.901, lon: 116.300, ele: 110, heartRate: 125, time: new Date('2026-10-01T08:01:00Z') },
        { lat: 39.902, lon: 116.300, ele: 450, heartRate: 130, time: new Date('2026-10-01T08:02:00Z') },
        { lat: 39.903, lon: 116.300, ele: 125, heartRate: 132, time: new Date('2026-10-01T08:03:00Z') },
        { lat: 39.904, lon: 116.300, ele: 0, heartRate: 135, time: new Date('2026-10-01T08:04:00Z') },
        { lat: 39.905, lon: 116.300, ele: 140, heartRate: 138, time: new Date('2026-10-01T08:05:00Z') },
        { lat: 39.906, lon: 116.300, ele: 150, heartRate: 140, time: new Date('2026-10-01T08:06:00Z') },
      ]],
    }],
    routes: [],
    waypoints: [],
    areas: [],
  };
  const res = smoothTrackElevation(noisy, { windowSize: 5, spikeThresholdMeters: 30 });
  const seg = res.track.tracks[0].segments[0];
  assert.equal(seg[0].ele, 100);
  assert.equal(seg[seg.length - 1].ele, 150);
  assert.ok(seg[2].ele < 200);
  assert.ok(seg[4].ele > 100);
  assert.ok(res.afterAscent < res.beforeAscent);
  assert.ok(res.adjustedCount >= 2);
  assert.equal(seg[2].heartRate, 130);
  assert.equal(seg[2].time.toISOString(), '2026-10-01T08:02:00.000Z');
});

test('applyDrawnPath supports snapping onto arbitrary interpolated points along a segment', () => {
  const base = {
    name: 'mid-seg',
    tracks: [{
      name: 'Main',
      segments: [[
        { lat: 39.900, lon: 116.300, ele: 100 },
        { lat: 39.910, lon: 116.300, ele: 200 },
        { lat: 39.920, lon: 116.300, ele: 300 },
      ]],
    }],
    routes: [],
    waypoints: [],
    areas: [],
  };
  const res = applyDrawnPath(base, [
    { lat: 39.905, lon: 116.300 },
    { lat: 39.910, lon: 116.305 },
    { lat: 39.915, lon: 116.300 },
  ], {
    startSnap: { flatSegIndex: 0, ptIndex: 0, segT: 0.5 },
    endSnap: { flatSegIndex: 0, ptIndex: 1, segT: 0.5 },
  });
  assert.equal(res.mode, 'replace');
  const seg = res.track.tracks[0].segments[0];
  // Original start + interpolated anchorLo + drawn middle + interpolated anchorHi + original end = 5 points.
  assert.equal(seg.length, 5);
  assert.ok(Math.abs(seg[1].lat - 39.905) < 1e-6);
  assert.ok(Math.abs(seg[1].ele - 150) < 1e-6);
  assert.equal(seg[2].lon, 116.305);
  assert.ok(Math.abs(seg[2].ele - 200) < 2);
  assert.ok(Math.abs(seg[3].lat - 39.915) < 1e-6);
  assert.ok(Math.abs(seg[3].ele - 250) < 1e-6);
});

test('applyDrawnPath closes loop instead of erasing track when snapping segment end to start', () => {
  const base = {
    name: 'almost-loop',
    tracks: [{
      name: 'Main',
      segments: [[
        { lat: 39.900, lon: 116.300, ele: 100, time: new Date('2026-10-01T08:00:00Z') },
        { lat: 39.910, lon: 116.300, ele: 200, time: new Date('2026-10-01T08:10:00Z') },
        { lat: 39.910, lon: 116.310, ele: 220, time: new Date('2026-10-01T08:20:00Z') },
        { lat: 39.901, lon: 116.302, ele: 120, time: new Date('2026-10-01T08:30:00Z') },
      ]],
    }],
    routes: [],
    waypoints: [],
    areas: [],
  };
  // Draw from end (ptIndex 3) back to start (ptIndex 0) with 1 middle point.
  const res = applyDrawnPath(base, [
    { lat: 39.901, lon: 116.302 },
    { lat: 39.9005, lon: 116.301 },
    { lat: 39.900, lon: 116.300 },
  ], {
    startSnap: { flatSegIndex: 0, ptIndex: 3, segT: 0 },
    endSnap: { flatSegIndex: 0, ptIndex: 0, segT: 0 },
  });
  assert.equal(res.mode, 'close-loop');
  assert.equal(res.timestampsCleared, true);
  const seg = res.track.tracks[0].segments[0];
  // All 4 original points kept + 1 middle + 1 closing start point = 6 points.
  assert.equal(seg.length, 6);
  assert.equal(seg[1].lat, 39.910);
  assert.equal(seg[4].lat, 39.9005);
  assert.ok(seg[4].ele > 100 && seg[4].ele < 120);
  assert.equal(seg[5].lat, 39.900);
  assert.equal(seg[5].lon, 116.300);
});

test('appendExternalTrack appends segments and deduplicates waypoints', () => {
  const base = sampleTrack();
  const incoming = {
    name: 'Part 2',
    tracks: [{
      name: 'Extra',
      segments: [[
        { lat: 39.930, lon: 116.300, ele: 320 },
        { lat: 39.940, lon: 116.300, ele: 350 },
      ]],
    }],
    routes: [],
    waypoints: [
      // Duplicate of existing waypoint in sampleTrack
      { ...base.waypoints[0] },
      // Brand new waypoint
      { lat: 39.935, lon: 116.3, name: 'Camp 2' },
    ],
    areas: [],
  };
  const res = appendExternalTrack(base, incoming, { mergeIntoSingle: false, mergeWaypoints: true });
  assert.equal(res.addedSegments, 1);
  assert.equal(res.addedWaypoints, 1);
  assert.equal(res.track.tracks.length, 2);
  assert.equal(res.track.waypoints.length, base.waypoints.length + 1);
});

test('appendExternalTrack keeps segments separate when endpoints are too far apart and auto-reverses when close', () => {
  const segA = {
    name: 'Part A',
    tracks: [{
      name: 'A',
      segments: [[
        { lat: 39.900, lon: 116.300 },
        { lat: 39.910, lon: 116.300 },
      ]],
    }],
    routes: [],
    waypoints: [],
    areas: [],
  };
  // Far away segment (> 500 m): must NOT draw a long straight line across map.
  const farB = {
    name: 'Far B',
    tracks: [{
      name: 'B',
      segments: [[
        { lat: 39.950, lon: 116.300 },
        { lat: 39.960, lon: 116.300 },
      ]],
    }],
    routes: [],
    waypoints: [],
    areas: [],
  };
  const farRes = appendExternalTrack(segA, farB, { mergeIntoSingle: true });
  assert.equal(farRes.merged, false);
  assert.ok(farRes.skippedMergeGapMeters > 500);
  assert.equal(farRes.track.tracks.length, 2);

  // Close reversed segment (its end matches A's end within ~110 m): auto-reverses and merges cleanly.
  const closeRevB = {
    name: 'Close Rev B',
    tracks: [{
      name: 'B2',
      segments: [[
        { lat: 39.920, lon: 116.300 },
        { lat: 39.911, lon: 116.300 },
      ]],
    }],
    routes: [],
    waypoints: [],
    areas: [],
  };
  const closeRes = appendExternalTrack(segA, closeRevB, { mergeIntoSingle: true });
  assert.equal(closeRes.merged, true);
  assert.equal(closeRes.reversedIncoming, true);
  assert.equal(closeRes.track.tracks.length, 1);
  const merged = closeRes.track.tracks[0].segments[0];
  assert.equal(merged.length, 4);
  assert.equal(merged[2].lat, 39.911);
  assert.equal(merged[3].lat, 39.920);
});

test('sortWaypointsAlongTrack sorts on-track waypoints and places far off-track waypoints last', () => {
  const base = sampleTrack();
  base.waypoints = [
    { lat: 39.915, lon: 116.300, name: 'Late' },
    { lat: 39.950, lon: 116.400, name: 'Far Off' },
    { lat: 39.902, lon: 116.300, name: 'Early' },
  ];
  const res = sortWaypointsAlongTrack(base);
  assert.equal(res.changed, true);
  assert.deepEqual(res.track.waypoints.map((w) => w.name), ['Early', 'Late', 'Far Off']);
});

test('dedupeWaypoints merges nearby duplicates and prefers richer metadata', () => {
  const base = sampleTrack();
  base.waypoints = [
    { lat: 39.90500, lon: 116.30000, name: '' },
    { lat: 39.90505, lon: 116.30002, name: 'Water Source', description: 'Clean spring' },
    { lat: 39.91500, lon: 116.30000, name: 'Ridge' },
  ];
  const res = dedupeWaypoints(base, { radiusMeters: 20 });
  assert.equal(res.removedCount, 1);
  assert.equal(res.track.waypoints.length, 2);
  assert.equal(res.track.waypoints[0].name, 'Water Source');
});

test('generateMilestoneWaypoints creates interval and summit waypoints while skipping nearby existing ones', () => {
  const base = {
    name: 'long',
    tracks: [{
      name: 'Main',
      segments: [[
        { lat: 39.900, lon: 116.300, ele: 100 },
        { lat: 39.920, lon: 116.300, ele: 520 },
        { lat: 39.940, lon: 116.300, ele: 300 },
      ]],
    }],
    routes: [],
    waypoints: [
      // Right on top of the summit so summit candidate should be skipped
      { lat: 39.920, lon: 116.300, name: 'Existing Peak' },
    ],
    areas: [],
  };
  const res = generateMilestoneWaypoints(base, { intervalKm: 2, includeSummit: true, minDistanceMeters: 50 });
  // Track is ~4.45 km -> 2 km and 4 km milestones added, summit skipped due to existing waypoint < 50m.
  assert.equal(res.addedCount, 2);
  assert.equal(res.track.waypoints.length, 3);
  assert.equal(res.track.waypoints[1].name, '2 km');
  assert.equal(res.track.waypoints[2].name, '4 km');
});

test('createSegmentColorResolver provides 12 unique colors and preserves colors when earlier segments are deleted', () => {
  assert.equal(SPLIT_COLORS.length, 12);
  const resolver = createSegmentColorResolver();
  const tracks = Array.from({ length: 12 }, (_, i) => ({
    name: `Seg ${i + 1}`,
    segments: [[
      { lat: 30 + i * 0.01, lon: 114 + i * 0.01 },
      { lat: 30 + i * 0.01 + 0.005, lon: 114 + i * 0.01 + 0.005 },
    ]],
  }));
  const initialColors = resolver.resolve(tracks);
  assert.equal(new Set(initialColors).size, 12);

  // Deleting segment 0 must NOT shift colors of remaining segments 1..11
  const afterDelete = resolver.resolve(tracks.slice(1));
  assert.deepEqual(afterDelete, initialColors.slice(1));

  // Undoing delete restores segment 0's original color
  const afterUndo = resolver.resolve(tracks);
  assert.deepEqual(afterUndo, initialColors);
});

test('appendExternalTrack clears timestamps on non-reversed merge with backwards timestamps', () => {
  const base = {
    tracks: [{
      name: 'Day 2',
      segments: [[
        { lat: 30.0, lon: 114.0, ele: 100, time: new Date('2026-05-02T08:00:00.000Z') },
        { lat: 30.001, lon: 114.0, ele: 110, time: new Date('2026-05-02T08:05:00.000Z') },
      ]],
    }],
    routes: [],
    waypoints: [],
  };
  const incoming = {
    tracks: [{
      name: 'Day 1',
      segments: [[
        { lat: 30.0011, lon: 114.0, ele: 112, time: new Date('2026-05-01T08:00:00.000Z') },
        { lat: 30.002, lon: 114.0, ele: 120, time: new Date('2026-05-01T08:05:00.000Z') },
      ]],
    }],
    routes: [],
    waypoints: [],
  };
  const res = appendExternalTrack(base, incoming, { mergeIntoSingle: true });
  assert.equal(res.merged, true);
  assert.equal(res.reversedIncoming, false);
  assert.equal(res.timestampsCleared, true);
  assert.equal(res.track.tracks[0].segments[0].every((pt) => pt.time === undefined), true);
});

test('generateMilestoneWaypoints respects minDistanceMeters: 0', () => {
  const pts = [];
  for (let i = 0; i <= 20; i += 1) {
    pts.push({ lat: 30.0 + i * 0.001, lon: 114.0, ele: 100 + i * 5 });
  }
  const base = {
    tracks: [{ name: 'T', segments: [pts] }],
    routes: [],
    waypoints: [{ lat: pts[10].lat, lon: pts[10].lon, name: 'Existing' }],
  };
  const withDefault = generateMilestoneWaypoints(base, { intervalKm: 1, includeSummit: false, minDistanceMeters: 50 });
  const withZero = generateMilestoneWaypoints(base, { intervalKm: 1, includeSummit: false, minDistanceMeters: 0 });
  assert.ok(withZero.addedCount >= withDefault.addedCount);
  assert.equal(withZero.addedCount, 2);
});
