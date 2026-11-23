import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  DEFAULT_PROBE_TIMEOUT_MS,
  PROBE_CONCURRENCY,
  probeTileNode,
  runWithConcurrency,
} from '../../viewer/layer-nodes.js';

test('runWithConcurrency caps in-flight tasks at the configured limit', async () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  let active = 0;
  let maxActive = 0;
  const completed = [];

  await runWithConcurrency(items, PROBE_CONCURRENCY, async (item) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await delay(10);
    completed.push(item);
    active -= 1;
  });

  assert.equal(maxActive, PROBE_CONCURRENCY);
  assert.equal(completed.length, items.length);
});

test('probeTileNode delegates to hostProbe when provided', async () => {
  const calls = [];
  const result = await probeTileNode('https://tile.openstreetmap.org/10/832/404.png', {
    hostProbe: async (url, timeoutMs) => {
      calls.push({ url, timeoutMs });
      return { ok: true, ms: 312, reason: 'ok' };
    },
  });

  assert.deepEqual(calls, [
    { url: 'https://tile.openstreetmap.org/10/832/404.png', timeoutMs: DEFAULT_PROBE_TIMEOUT_MS },
  ]);
  assert.deepEqual(result, { ok: true, ms: 312, reason: 'ok' });
});
