import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CUSTOM_LIMITS,
  createCustomLayer,
  loadCustomLayers,
  normalizeEntry,
  saveCustomLayers,
  validateTemplate,
} from '../../viewer/custom-layers.js';

const readStored = (value) => () => value;
const writeStored = () => {
  const box = { value: null };
  return { box, write: (name, data) => { box.value = data; } };
};

test('a template needs HTTPS and the three tile tokens', () => {
  assert.equal(validateTemplate('https://host/{z}/{x}/{y}.png').ok, true);
  assert.equal(validateTemplate('http://host/{z}/{x}/{y}.png').code, 'scheme');
  assert.equal(validateTemplate('').code, 'empty');
  assert.equal(validateTemplate('ftp://host/{z}/{x}/{y}.png').code, 'scheme');
  assert.equal(validateTemplate('javascript:alert(1)').code, 'scheme');
  assert.equal(validateTemplate('https://host/tiles.png').code, 'token');
  assert.equal(validateTemplate('https://host/{z}/{x}.png').code, 'token');
  assert.equal(validateTemplate('https://host/{z}/{x}/{y}.png extra').code, 'space');
  assert.equal(validateTemplate('https://[bad/{z}/{x}/{y}.png').code, 'syntax');
});

test('two-step navigation placeholders are normalised for Leaflet', () => {
  const checked = validateTemplate(
    'https://mts1.google.com/vt/lyrs=y&hl=zh-CN&gl=cn&scale=2&x={$x}&y={$y}&z={$z}',
  );
  assert.equal(checked.ok, true);
  assert.match(checked.url, /\{[xyz]\}/);
  assert.doesNotMatch(checked.url, /\{\$/);
});

test('an entry is normalised with sensible defaults', () => {
  const entry = normalizeEntry({ url: 'https://host/{z}/{x}/{y}.png', name: ' Hills ' });
  assert.equal(entry.name, 'Hills');
  assert.equal(entry.tileSize, 256);
  assert.equal(entry.minZoom, 1);
  assert.equal(entry.maxZoom, 19);
  assert.equal(entry.tms, false);
  assert.ok(entry.id.startsWith('custom.'));
});

test('zoom bounds are clamped and ordered', () => {
  const entry = normalizeEntry({ url: 'https://h/{z}/{x}/{y}.png', minZoom: 18, maxZoom: 3 });
  assert.equal(entry.minZoom, 3);
  assert.equal(entry.maxZoom, 18);
  const wild = normalizeEntry({ url: 'https://h/{z}/{x}/{y}.png', minZoom: -5, maxZoom: 99 });
  assert.equal(wild.minZoom, 0);
  assert.equal(wild.maxZoom, 22);
});

test('only the documented tile sizes survive', () => {
  assert.equal(normalizeEntry({ url: 'https://h/{z}/{x}/{y}.png', tileSize: 512 }).tileSize, 512);
  assert.equal(normalizeEntry({ url: 'https://h/{z}/{x}/{y}.png', tileSize: 300 }).tileSize, 256);
  assert.deepEqual([...CUSTOM_LIMITS.tileSizes], [256, 512]);
});

test('the Windy outdoor 512 px template is accepted', () => {
  const entry = normalizeEntry({
    name: 'Windy',
    url: 'https://tiles.windy.com/v1/maptiles/outdoor/256%402x/{z}/{x}/{y}/?lang=en',
    tileSize: 512,
    minZoom: 1,
    maxZoom: 20,
  });
  assert.equal(entry.tileSize, 512);
  assert.equal(entry.minZoom, 1);
  assert.equal(entry.maxZoom, 20);
});

test('entries without a usable template are dropped', () => {
  assert.equal(normalizeEntry({ url: '' }), null);
  assert.equal(normalizeEntry({ url: 'not a url' }), null);
  assert.equal(normalizeEntry(null), null);
});

test('stored JSON is filtered on read, including corrupt input', () => {
  const good = JSON.stringify([
    { url: 'https://h/{z}/{x}/{y}.png', name: 'A' },
    { url: 'broken', name: 'B' },
  ]);
  const list = loadCustomLayers(readStored(good));
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'A');
  assert.deepEqual(loadCustomLayers(readStored('not json')), []);
  assert.deepEqual(loadCustomLayers(readStored('{"a":1}')), []);
  assert.deepEqual(loadCustomLayers(readStored('')), []);
});

test('host-owned sources survive the versioned browser origin and win over local fallback', () => {
  const local = JSON.stringify([{ id: 'custom.local', name: 'Local', url: 'https://local/{z}/{x}/{y}' }]);
  const hosted = [{ id: 'custom.host', name: 'Hosted', url: 'https://host/{z}/{x}/{y}' }];
  const entries = loadCustomLayers(readStored(local), hosted);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'custom.host');
  assert.deepEqual(loadCustomLayers(readStored(local), []), []);
});

test('saving writes the normalised list only', () => {
  const { box, write } = writeStored();
  const saved = saveCustomLayers(write, [
    { url: 'https://h/{z}/{x}/{y}.png', name: 'A' },
    { url: 'nope' },
  ]);
  assert.equal(saved.length, 1);
  const stored = JSON.parse(box.value);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].name, 'A');
});

test('a 512 px source becomes a retina layer with a zoom offset', () => {
  const calls = [];
  const L = { tileLayer: (url, options) => { calls.push({ url, options }); return { url, options }; } };
  const layer = createCustomLayer(L, normalizeEntry({
    url: 'https://h/{z}/{x}/{y}.png', tileSize: 512, minZoom: 2, maxZoom: 18,
  }));
  assert.equal(layer.options.zoomOffset, -1);
  assert.equal(layer.options.tileSize, 512);
  assert.equal(layer.options.minZoom, 2);
  assert.equal(layer.options.maxZoom, 18);
});

test('a 256 px source has no zoom offset', () => {
  const L = { tileLayer: (url, options) => ({ url, options }) };
  const layer = createCustomLayer(L, normalizeEntry({ url: 'https://h/{z}/{x}/{y}.png' }));
  assert.equal(layer.options.zoomOffset, undefined);
  assert.equal(layer.options.tileSize, 256);
});

test('user attribution is rendered as text, not markup', () => {
  const L = { tileLayer: (url, options) => ({ url, options }) };
  const layer = createCustomLayer(L, normalizeEntry({
    url: 'https://h/{z}/{x}/{y}.png',
    attribution: '<img src=x onerror=alert(1)>',
  }));
  assert.equal(layer.options.attribution, '&lt;img src=x onerror=alert(1)&gt;');
});

