import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPACT_ICON_SIZE,
  DATA_SYMBOL_NAMES,
  DEFAULT_ICON_SIZE,
  ICON_STROKE,
  ICON_VIEWBOX,
  UI_ICON_NAMES,
  WEATHER_MARK_NAMES,
  iconMarkup,
  symbolMarkup,
  weatherMarkMarkup,
} from '../../viewer/icons.js';

test('the icon registry is unique and covers every shared control', () => {
  assert.equal(new Set(UI_ICON_NAMES).size, UI_ICON_NAMES.length);
  assert.equal(new Set(DATA_SYMBOL_NAMES).size, DATA_SYMBOL_NAMES.length);
  for (const name of [
    'toolbox', 'ruler', 'overlay-export', 'photo-export', 'image-export-all', 'image-export-local',
    'copy', 'coordinates',
    'plus', 'minus', 'locate', 'layers', 'settings',
    'chevron-down', 'chevron-left', 'close', 'check', 'pin', 'list', 'finish-section',
    'center-point', 'undo', 'redo', 'clear', 'stop', 'route', 'filter', 'edit',
    'arrow-left', 'arrow-right', 'warning', 'activity',
    'layer-road', 'layer-terrain', 'layer-satellite', 'layer-custom', 'map-grid',
    'editor-crop', 'editor-split', 'editor-merge', 'editor-clean', 'editor-box-erase',
    'editor-simplify', 'editor-reverse', 'editor-roundtrip', 'editor-loop-start',
    'editor-vertex', 'editor-waypoint-add', 'editor-save', 'editor-time',
  ]) {
    assert.ok(UI_ICON_NAMES.includes(name), name);
  }
  for (const name of [
    'waypoint', 'camera', 'direction', 'warning', 'anomaly',
    'snap-marker', 'snap-measure', 'snap-track',
  ]) {
    assert.ok(DATA_SYMBOL_NAMES.includes(name), name);
  }
});

test('default UI icons use the shared open-stroke geometry', () => {
  const svg = iconMarkup('ruler');
  assert.match(svg, new RegExp(`viewBox="${ICON_VIEWBOX}"`));
  assert.match(svg, new RegExp(`width="${DEFAULT_ICON_SIZE}"`));
  assert.match(svg, new RegExp(`height="${DEFAULT_ICON_SIZE}"`));
  assert.match(svg, new RegExp(`stroke-width="${ICON_STROKE}"`));
  assert.match(svg, /fill="none"/);
  assert.match(svg, /stroke-linecap="round"/);
  assert.match(svg, /stroke-linejoin="round"/);
  assert.match(svg, /data-icon="ruler"/);
  assert.match(svg, /aria-hidden="true"/);
});

test('compact icons stay on the same geometry with the documented size', () => {
  const svg = iconMarkup('check', { size: COMPACT_ICON_SIZE });
  assert.match(svg, new RegExp(`width="${COMPACT_ICON_SIZE}"`));
  assert.match(svg, /icon-compact/);
  assert.match(svg, new RegExp(`stroke-width="${ICON_STROKE}"`));
});

test('the weather picker has one marker per target', () => {
  assert.deepEqual([...WEATHER_MARK_NAMES], ['start', 'end', 'highest']);
  for (const name of WEATHER_MARK_NAMES) {
    const svg = weatherMarkMarkup(name);
    assert.match(svg, new RegExp(`data-weather-mark="${name}"`), name);
    assert.match(svg, new RegExp(`viewBox="${ICON_VIEWBOX}"`), name);
    assert.match(svg, /aria-hidden="true"/, name);
  }
});

test('weather markers use the selected coloured map pins and fall back to start', () => {
  assert.match(weatherMarkMarkup('start'), /#6ab58b/);
  assert.match(weatherMarkMarkup('end'), /#cc7a7d/);
  assert.match(weatherMarkMarkup('highest'), /#cfa95b/);
  for (const name of WEATHER_MARK_NAMES) {
    assert.match(weatherMarkMarkup(name), /stroke-width="1\.7"/, name);
  }
  assert.match(weatherMarkMarkup('not-a-mode'), /data-weather-mark="start"/);
});

test('the map settings registry uses the outlined gear', () => {
  const svg = iconMarkup('settings');
  assert.match(svg, /M9\.4 3h5\.2/);
  assert.match(svg, /<circle cx="12" cy="12" r="3\.2"\/>/);
  assert.doesNotMatch(svg, /M12\.22 2/);
});

test('fit-bounds uses a framing outline rather than a coordinate crosshair', () => {
  const svg = iconMarkup('locate');
  assert.match(svg, /M9 4H6/);
  assert.doesNotMatch(svg, /M12 2v3/);
});

test('unknown names fail visibly through the local fallback icon', () => {
  assert.match(iconMarkup('not-an-icon'), /data-icon="circle-help"/);
  assert.match(symbolMarkup('not-a-symbol'), /data-symbol="warning"/);
});

test('semantic data symbols opt into fills without changing UI icon rules', () => {
  const pin = symbolMarkup('waypoint', { width: 24, height: 27 });
  assert.match(pin, /viewBox="0 0 24 32"/);
  assert.match(pin, /class="data-symbol"/);
  assert.match(pin, /class="symbol-fill"/);
  assert.match(pin, /class="symbol-hole"/);
  assert.doesNotMatch(pin, /fill="none"/);
});

test('standardized snap symbols share the 18 px double-stroked reticle structure', () => {
  for (const name of ['snap-marker', 'snap-measure', 'snap-track']) {
    const svg = symbolMarkup(name, { width: 18, height: 18, className: 'data-symbol snap-symbol' });
    assert.match(svg, new RegExp(`data-symbol="${name}"`), name);
    assert.match(svg, /viewBox="0 0 18 18"/, name);
    assert.match(svg, /class="snap-casing"/, name);
    assert.match(svg, /class="snap-stroke"/, name);
    assert.match(svg, /class="snap-dot"/, name);
  }
});
