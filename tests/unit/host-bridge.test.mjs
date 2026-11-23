import assert from 'node:assert/strict';
import test from 'node:test';

const posted = [];
const webviewListeners = new Map();
const docListeners = new Map();
let clipboardText = null;
let clipboardAvailable = true;

globalThis.window = {
  chrome: {
    webview: {
      postMessage(msg) {
        posted.push(msg);
      },
      addEventListener(type, fn) {
        if (!webviewListeners.has(type)) webviewListeners.set(type, new Set());
        webviewListeners.get(type).add(fn);
      },
    },
  },
};

globalThis.document = {
  addEventListener(type, fn) {
    if (!docListeners.has(type)) docListeners.set(type, new Set());
    docListeners.get(type).add(fn);
  },
};

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    get clipboard() {
      return clipboardAvailable
        ? { writeText: async (text) => { clipboardText = text; } }
        : undefined;
    },
  },
});

const { createHostBridge } = await import('../../viewer/host-bridge.js');

function emitWebMessage(data) {
  for (const fn of webviewListeners.get('message') || []) {
    fn({ data });
  }
}

test('installViewerMessages routes pressKey, setTiandituKey, attachmentResult and overlay errors safely', () => {
  posted.length = 0;
  webviewListeners.clear();
  const bridge = createHostBridge();
  const calls = [];
  const api = {
    attachments: { result: (...args) => calls.push(['attachment', ...args]) },
    attachmentResume: (...args) => calls.push(['resume', ...args]),
    exported: (path) => calls.push(['exported', path]),
    exportFailed: (detail) => calls.push(['exportFailed', detail]),
    tiandituResponse: (status) => calls.push(['tianditu', status]),
    setTiandituKey: (key) => calls.push(['setKey', key]),
    pressKey: (key) => calls.push(['key', key]),
    tileCacheStats: (bytes, count) => calls.push(['cacheStats', bytes, count]),
    tileCacheCleared: (bytes, count) => calls.push(['cacheCleared', bytes, count]),
  };
  bridge.installViewerMessages(api, (...args) => calls.push(['clipboard', ...args]));

  emitWebMessage({ unexpected: true });
  emitWebMessage('pressKey\tm');
  emitWebMessage('setTiandituKey\tabcd1234');
  emitWebMessage('setTiandituKey\t');
  emitWebMessage('tianditu-response\t403');
  emitWebMessage('tileCacheStats\t5242880\t120');
  emitWebMessage('tileCacheCleared\t0\t0');
  emitWebMessage('clipboardResult\tc1\t0\tdenied%20access');
  emitWebMessage('attachmentResult\tb1\t2\t0\tC%3A%5Ctmp%5Ca%20b.jpg\thttp%20404');
  emitWebMessage('attachmentResume\tb1\t0,1\tC%3A%5Cphotos');
  emitWebMessage('overlayExported\tC%3A%5Ctrack%201.png');
  emitWebMessage('overlayFailed\tdisk%20full');

  assert.deepEqual(calls, [
    ['key', 'm'],
    ['setKey', 'abcd1234'],
    ['setKey', ''],
    ['tianditu', 403],
    ['cacheStats', 5242880, 120],
    ['cacheCleared', 0, 0],
    ['clipboard', 'c1', false, 'denied%20access'],
    ['attachment', 'b1', 2, false, 'C:\\tmp\\a b.jpg', 'http 404'],
    ['resume', 'b1', '0,1', 'C:\\photos'],
    ['exported', 'C:\\track 1.png'],
    ['exportFailed', 'disk full'],
  ]);
});

test('host clipboard coalesces concurrent requests and propagates decoded errors', async () => {
  posted.length = 0;
  const bridge = createHostBridge();

  await assert.rejects(() => bridge.copyText('x'.repeat(32001)), /too large/);

  const first = bridge.copyText('first');
  const second = bridge.copyText('second');
  const third = bridge.copyText('third');
  assert.equal(posted.length, 1);
  const firstMsg = posted.shift();
  const id1 = firstMsg.split('\t')[1];
  bridge.clipboardResult(id1, true);
  await first;

  // Coalescing drops the intermediate 'second' write and sends only 'third' after 'first' finishes.
  assert.equal(posted.length, 1);
  const nextMsg = posted.shift();
  assert.equal(decodeURIComponent(nextMsg.split('\t')[2]), 'third');
  const id2 = nextMsg.split('\t')[1];
  bridge.clipboardResult(id2, true);
  await Promise.all([second, third]);

  const failPromise = bridge.copyText('fourth');
  const failMsg = posted.shift();
  const id3 = failMsg.split('\t')[1];
  bridge.clipboardResult(id3, false, 'locked%20clipboard');
  await assert.rejects(() => failPromise, /locked clipboard/);

  // Unknown ids do not throw.
  bridge.clipboardResult('missing-id', false, 'ignored');
});

test('installTextInputReporting deduplicates state transitions', () => {
  posted.length = 0;
  docListeners.clear();
  const bridge = createHostBridge();
  bridge.installTextInputReporting((node) => Boolean(node?.isInput));

  for (const fn of docListeners.get('focusin') || []) fn({ target: { isInput: true } });
  for (const fn of docListeners.get('focusin') || []) fn({ target: { isInput: true } });
  for (const fn of docListeners.get('focusout') || []) fn({ relatedTarget: { isInput: true } });
  for (const fn of docListeners.get('focusout') || []) fn({ relatedTarget: null });
  for (const fn of docListeners.get('focusout') || []) fn({ relatedTarget: null });

  assert.deepEqual(posted, ['text-input\t1', 'text-input\t0']);
});

test('copyText falls back to navigator.clipboard when host is absent', async () => {
  const prevWindow = globalThis.window;
  globalThis.window = {};
  try {
    const bridge = createHostBridge();
    assert.equal(bridge.hasHost, false);
    await bridge.copyText('30.500000, 114.300000');
    assert.equal(clipboardText, '30.500000, 114.300000');

    clipboardAvailable = false;
    await assert.rejects(() => bridge.copyText('nope'), /unavailable/);
  } finally {
    clipboardAvailable = true;
    globalThis.window = prevWindow;
  }
});

test('probeNode exchanges probe-node and nodeProbeResult messages with host', async () => {
  posted.length = 0;
  webviewListeners.clear();
  const bridge = createHostBridge();
  bridge.installViewerMessages({ attachments: { result() {} } }, () => {});

  const okPromise = bridge.probeNode('https://tile.openstreetmap.org/10/832/404.png', 10000);
  assert.equal(posted.length, 1);
  const [cmd, id, timeoutStr, encodedUrl] = posted.shift().split('\t');
  assert.equal(cmd, 'probe-node');
  assert.equal(timeoutStr, '10000');
  assert.equal(decodeURIComponent(encodedUrl), 'https://tile.openstreetmap.org/10/832/404.png');

  emitWebMessage(`nodeProbeResult\t${id}\t1\t245\tok`);
  assert.deepEqual(await okPromise, { ok: true, ms: 245, reason: 'ok' });

  const timeoutPromise = bridge.probeNode('https://tile.openstreetmap.de/10/832/404.png', 10000);
  const timeoutId = posted.shift().split('\t')[1];
  emitWebMessage(`nodeProbeResult\t${timeoutId}\t0\t10002\ttimeout`);
  assert.deepEqual(await timeoutPromise, { ok: false, ms: 10002, reason: 'timeout' });
});
