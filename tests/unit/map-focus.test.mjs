import test from 'node:test';
import assert from 'node:assert/strict';
import {
  comfortRect,
  focusOffset,
  makeRect,
  revealOffset,
  safeMapRect,
  unionRects,
} from '../../viewer/map-focus.js';

test('safe map rectangle subtracts measured overlay insets', () => {
  const safe = safeMapRect(1000, 700, { left: 20, top: 120, right: 340, bottom: 180 });
  assert.deepEqual(safe, {
    left: 20, top: 120, right: 660, bottom: 520, width: 640, height: 400,
  });
});

test('a point in the comfort rectangle does not move the map', () => {
  const safe = makeRect(100, 100, 900, 600);
  const result = focusOffset(makeRect(450, 300, 500, 350), safe);
  assert.equal(result.needed, false);
  assert.equal(result.x, 0);
  assert.equal(result.y, 0);
});

test('an edge point is centred in the safe area', () => {
  const safe = makeRect(100, 100, 900, 600);
  const result = focusOffset(makeRect(110, 250, 150, 290), safe);
  assert.equal(result.needed, true);
  assert.equal(result.x, 370);
  assert.equal(result.y, 80);
});

test('focus considers a popup union rather than only the marker', () => {
  const safe = makeRect(0, 80, 800, 600);
  const marker = makeRect(390, 420, 410, 440);
  const popup = makeRect(250, 440, 550, 700);
  const result = focusOffset(unionRects([marker, popup]), safe);
  assert.equal(result.needed, true);
  assert.ok(result.y < 0);
});

test('continuous reveal applies only the minimum movement', () => {
  const safe = makeRect(80, 120, 720, 500);
  const result = revealOffset(makeRect(700, 300, 736, 324), safe);
  assert.deepEqual(result, { x: -16, y: 0, needed: true });
});

test('a target larger than the safe area is centred', () => {
  const safe = makeRect(100, 100, 500, 300);
  const result = revealOffset(makeRect(200, 40, 700, 360), safe);
  assert.deepEqual(result, { x: -150, y: 0, needed: true });
});

test('comfort rectangle never collapses in a small safe area', () => {
  const safe = makeRect(10, 20, 90, 100);
  const comfort = comfortRect(safe);
  assert.ok(comfort.width > 0 && comfort.height > 0);
});
