import assert from 'node:assert/strict';
import test from 'node:test';
import { LAYERS, normalizeLayer } from '../../viewer/map-controls.js';

test('legacy layer categories map to the new grouped providers', () => {
  assert.equal(normalizeLayer('map'), 'road.osm');
  assert.equal(normalizeLayer('terrain'), 'terrain.cyclosm');
  assert.equal(normalizeLayer('satellite'), 'satellite.esri');
  assert.equal(normalizeLayer('none'), 'none');
});

test('terrain offers CyclOSM, OpenHikingMap and OpenTopoMap', () => {
  assert.deepEqual(Object.keys(LAYERS.terrain.providers), ['cyclosm', 'openHiking', 'openTopo']);
  assert.equal(normalizeLayer('terrain.openHiking'), 'terrain.openHiking');
  assert.equal(normalizeLayer('terrain.openTopo'), 'terrain.openTopo');
  assert.equal(
    LAYERS.terrain.providers.openHiking.url,
    'https://tile.openmaps.fr/openhikingmap/{z}/{x}/{y}.png',
  );
  assert.equal(LAYERS.terrain.providers.openTopo.options.maxNativeZoom, 17);
});

test('the former map category now belongs to the road group', () => {
  assert.equal(LAYERS.road.providers.osm.key, 'road.osm');
  assert.equal(LAYERS.road.providers.osm.url, 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png');
});

test('Tianditu sources describe official WMTS layer pairs without embedded keys', () => {
  assert.deepEqual(Object.keys(LAYERS.road.providers), ['osm', 'tianditu']);
  assert.deepEqual(Object.keys(LAYERS.satellite.providers), ['esri', 'tianditu']);
  assert.deepEqual(LAYERS.road.providers.tianditu.layers.map((layer) => layer.layer), ['vec', 'cva']);
  assert.deepEqual(LAYERS.satellite.providers.tianditu.layers.map((layer) => layer.layer), ['img', 'cia']);
  const specs = [
    ...LAYERS.road.providers.tianditu.layers,
    ...LAYERS.satellite.providers.tianditu.layers,
  ];
  assert.equal(specs.every((layer) => !('url' in layer) && !('hostLayer' in layer)), true);
});

test('unknown and missing layer values are rejected', () => {
  assert.equal(normalizeLayer('track'), null);
  assert.equal(normalizeLayer(null), null);
  assert.equal(normalizeLayer(undefined), null);
});
