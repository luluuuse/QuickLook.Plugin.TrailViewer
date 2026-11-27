import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrackEditorStore } from '../../viewer/track-editor-store.js';
import { addWaypoint, reverseTrack, sortWaypointsAlongTrack, updateWaypoint } from '../../viewer/track-ops.js';

function makeTrack() {
  return {
    name: 'Demo',
    tracks: [{
      name: 'Main',
      segments: [[
        { lat: 39.9, lon: 116.3, ele: 100 },
        { lat: 39.91, lon: 116.3, ele: 220 },
      ]],
    }],
    routes: [],
    waypoints: [],
    areas: [],
  };
}

test('store tracks dirty state, bounded 50-step undo/redo and reset', () => {
  let changes = 0;
  const store = createTrackEditorStore({
    maxHistory: 50,
    onChange: () => { changes += 1; },
  });
  const base = makeTrack();
  store.enter(base);
  assert.equal(store.isActive(), true);
  assert.equal(store.isDirty(), false);

  for (let i = 0; i < 55; i += 1) {
    const { track } = reverseTrack(store.getCurrent());
    store.apply(`rev-${i}`, track);
  }
  assert.equal(store.snapshot().undoCount, 50);
  assert.equal(store.isDirty(), true);

  assert.equal(store.undo(), true);
  assert.equal(store.snapshot().redoCount, 1);
  assert.equal(store.redo(), true);
  assert.equal(store.snapshot().redoCount, 0);

  assert.equal(store.reset(), true);
  assert.equal(store.getCurrent().tracks[0].segments[0][0].ele, 100);

  store.markSaved();
  assert.equal(store.isDirty(), false);
  assert.ok(changes > 50);

  store.exit();
  assert.equal(store.isActive(), false);
});

test('waypoint edits share immutable track geometry while keeping waypoint history isolated', () => {
  const store = createTrackEditorStore();
  store.enter(makeTrack());
  const initialTracks = store.getCurrent().tracks;

  const added = addWaypoint(store.getCurrent(), { lat: 39.905, lon: 116.3, name: 'Camp A' });
  store.apply('add-wpt', added);
  assert.equal(store.getCurrent().tracks, initialTracks);
  assert.equal(store.getCurrent().waypoints.length, 1);

  const renamed = updateWaypoint(store.getCurrent(), 0, { name: 'Camp B' });
  store.apply('rename-wpt', renamed);
  assert.equal(store.getCurrent().tracks, initialTracks);
  assert.equal(store.getCurrent().waypoints[0].name, 'Camp B');

  assert.equal(store.undo(), true);
  assert.equal(store.getCurrent().waypoints[0].name, 'Camp A');
  assert.equal(store.undo(), true);
  assert.equal(store.getCurrent().waypoints.length, 0);
  assert.equal(store.redo(), true);
  assert.equal(store.getCurrent().waypoints[0].name, 'Camp A');
});

test('large tracks cap undo history at 20 steps and sort 200 waypoints on 30k points quickly', () => {
  const pts = [];
  for (let i = 0; i < 30000; i += 1) {
    pts.push({ lat: 39.0 + i * 0.00001, lon: 116.0 + Math.sin(i * 0.01) * 0.001, ele: 500 + (i % 100) });
  }
  const wpts = [];
  for (let i = 0; i < 200; i += 1) {
    const idx = ((199 - i) * 149) % pts.length;
    wpts.push({ lat: pts[idx].lat + 0.00002, lon: pts[idx].lon, name: `W${i}` });
  }
  const large = { name: 'Long', tracks: [{ name: 'T1', segments: [pts] }], routes: [], waypoints: wpts, areas: [] };

  const started = performance.now();
  const sorted = sortWaypointsAlongTrack(large);
  const elapsedMs = performance.now() - started;
  assert.equal(sorted.changed, true);
  assert.equal(sorted.track.waypoints.length, 200);
  assert.ok(elapsedMs < 200, `expected fast waypoint sort, took ${elapsedMs.toFixed(1)} ms`);

  const store = createTrackEditorStore({ maxHistory: 50 });
  store.enter(large);
  for (let i = 0; i < 25; i += 1) {
    store.apply(`wpt-${i}`, updateWaypoint(store.getCurrent(), 0, { name: `Step ${i}` }));
  }
  assert.equal(store.snapshot().undoCount, 20);
});
