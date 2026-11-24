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

test('listSiblingTracks and importExternalTrack exchange host messages safely', async () => {
  posted.length = 0;
  webviewListeners.clear();
  const bridge = createHostBridge();
  bridge.installViewerMessages({ attachments: { result() {} } }, () => {});

  const listPromise = bridge.listSiblingTracks();
  const [listCmd, listId] = posted.shift().split('\t');
  assert.equal(listCmd, 'track-import-list');
  emitWebMessage(`trackImportList\t${listId}\t${encodeURIComponent(JSON.stringify([{ name: 'day2.gpx', size: 1024 }]))}`);
  assert.deepEqual(await listPromise, [{ name: 'day2.gpx', size: 1024 }]);

  const importPromise = bridge.importExternalTrack({ mode: 'sibling', name: 'day2.gpx' });
  const [impCmd, impId, impMode, impName] = posted.shift().split('\t');
  assert.equal(impCmd, 'track-import-read');
  assert.equal(impMode, 'sibling');
  assert.equal(decodeURIComponent(impName), 'day2.gpx');
  const b64 = globalThis.Buffer.from('<gpx>轨迹</gpx>', 'utf8').toString('base64');
  emitWebMessage(`trackImportChunk\t${impId}\t0\t2\t${b64.slice(0, 8)}`);
  emitWebMessage(`trackImportChunk\t${impId}\t1\t2\t${b64.slice(8)}`);
  emitWebMessage(`trackImportResult\t${impId}\t0\t${encodeURIComponent('day2.gpx')}\t`);
  assert.deepEqual(await importPromise, { ok: true, cancelled: false, name: 'day2.gpx', text: '<gpx>轨迹</gpx>', detail: '' });
});

test('saveTrackGpx includes export format and allows overwrite for GPX/KML/KMZ only', async () => {
  posted.length = 0;
  webviewListeners.clear();
  const bridge = createHostBridge();
  bridge.installViewerMessages({ attachments: { result() {} } }, () => {});

  const gpxPromise = bridge.saveTrackGpx({
    id: 'save-gpx',
    fileName: 'route-edited.gpx',
    content: '<gpx/>',
    format: 'gpx',
    overwrite: true,
  });
  const gpxBegin = posted[0].split('\t');
  assert.equal(gpxBegin[0], 'trackbegin');
  assert.equal(gpxBegin[3], '1');
  assert.equal(decodeURIComponent(gpxBegin[4]), 'route-edited.gpx');
  assert.equal(gpxBegin[5], 'gpx');
  emitWebMessage('trackSaveResult\tsave-gpx\t0\tC%3A%5Croute-edited.gpx\toverwrote');
  assert.equal((await gpxPromise).overwrote, true);

  for (const fmt of ['kml', 'kmz', 'geojson', 'tcx', 'csv']) {
    posted.length = 0;
    const progressEvents = [];
    const p = bridge.saveTrackGpx({
      id: `save-${fmt}`,
      fileName: `route-edited.${fmt}`,
      content: 'payload',
      format: fmt,
      overwrite: true,
      packRemoteImages: true,
      onProgress: (info) => progressEvents.push(info),
    });
    const begin = posted[0].split('\t');
    assert.equal(begin[0], 'trackbegin');
    assert.equal(begin[3], (fmt === 'kml' || fmt === 'kmz') ? '1' : '0');
    assert.equal(begin[5], fmt);
    assert.equal(begin[6], fmt === 'kmz' ? '1' : '0');
    if (fmt === 'kmz') {
      emitWebMessage(`trackSaveProgress\tsave-${fmt}\t0\t3\t0`);
      emitWebMessage(`trackSaveProgress\tsave-${fmt}\t2\t3\t1`);
      assert.deepEqual(progressEvents, [
        { completed: 0, total: 3, failed: 0 },
        { completed: 2, total: 3, failed: 1 },
      ]);
    }
    emitWebMessage(`trackSaveResult\tsave-${fmt}\t0\tC%3A%5Croute-edited.${fmt}\t`);
    const res = await p;
    assert.equal(res.ok, true);
    assert.equal(res.overwrote, false);
  }
});

test('host bridge routes update check, download, ignore, open and host update callbacks', () => {
  posted.length = 0;
  webviewListeners.clear();
  const bridge = createHostBridge();
  const events = [];
  bridge.installViewerMessages({
    attachments: { result() {} },
    updateStatus: (info) => events.push(['status', info]),
    updateProgress: (done, total) => events.push(['progress', done, total]),
    updateDownloadResult: (ok, detail) => events.push(['done', ok, detail]),
  }, () => {});

  assert.equal(bridge.checkUpdate(false), true);
  assert.equal(bridge.checkUpdate(true), true);
  assert.equal(bridge.downloadUpdate('https://github.com/a/b.qlplugin', 'b.qlplugin'), true);
  assert.equal(bridge.ignoreUpdate('1.30.0'), true);
  assert.equal(bridge.openUpdateRelease('https://github.com/luluuuse/QuickLook.Plugin.TrailViewer/releases'), true);
  assert.equal(posted[0], 'update-check\t0');
  assert.equal(posted[1], 'update-check\t1');
  assert.equal(posted[2], `update-download\t${encodeURIComponent('https://github.com/a/b.qlplugin')}\tb.qlplugin`);
  assert.equal(posted[3], 'update-ignore\t1.30.0');
  assert.equal(posted[4], `update-open\t${encodeURIComponent('https://github.com/luluuuse/QuickLook.Plugin.TrailViewer/releases')}`);

  emitWebMessage(`updateStatus\t${encodeURIComponent(JSON.stringify({ Status: 'available', LatestVersion: '1.30.0', HasUpdate: true }))}`);
  emitWebMessage('updateProgress\t1024\t4096');
  emitWebMessage('updateDownloadResult\t1\tC%3A%5Ctemp%5Cb.qlplugin');
  assert.deepEqual(events, [
    ['status', { Status: 'available', LatestVersion: '1.30.0', HasUpdate: true }],
    ['progress', 1024, 4096],
    ['done', true, 'C:\\temp\\b.qlplugin'],
  ]);
});
