import assert from 'node:assert/strict';
import test from 'node:test';

Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined });

import { overlayFileName } from '../../viewer/overlay-export.js';

test('overlay file names keep every visual option distinct', () => {
  assert.equal(
    overlayFileName('西湖徒步.gpx', '1:1', 'black', 'none', '轨迹'),
    '西湖徒步-轨迹-1x1-black-none.png',
  );
  assert.equal(
    overlayFileName('西湖徒步.gpx', '1:1', 'white', 'soft', '轨迹'),
    '西湖徒步-轨迹-1x1-white-soft.png',
  );
  assert.notEqual(
    overlayFileName('track', '9:16', 'black', 'none', 'track'),
    overlayFileName('track', '9:16', 'black', 'soft', 'track'),
  );
});
