import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrackEditorStore } from '../../viewer/track-editor-store.js';
import { reverseTrack } from '../../viewer/track-ops.js';

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
