import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPACT_ICON_SIZE,
  DATA_SYMBOL_NAMES,
  DEFAULT_ICON_SIZE,
  ICON_STROKE,
  ICON_VIEWBOX,
  UI_ICON_NAMES,
  iconMarkup,
  symbolMarkup,
} from '../../viewer/icons.js';

test('the icon registry is unique and covers every shared control', () => {
  assert.equal(new Set(UI_ICON_NAMES).size, UI_ICON_NAMES.length);
  assert.equal(new Set(DATA_SYMBOL_NAMES).size, DATA_SYMBOL_NAMES.length);
  for (const name of [
    'toolbox', 'ruler', 'image-down', 'plus', 'minus', 'locate', 'layers', 'settings',
    'chevron-down', 'chevron-left', 'close', 'check', 'pin', 'list', 'finish-section',
    'center-point', 'undo', 'redo', 'clear', 'stop', 'route', 'filter', 'edit',
    'arrow-left', 'arrow-right', 'warning', 'activity',
  ]) {
    assert.ok(UI_ICON_NAMES.includes(name), name);
  }
  for (const name of ['waypoint', 'camera', 'direction', 'warning', 'anomaly']) {
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

test('unknown names fail visibly through the local fallback icon', () => {
  assert.match(iconMarkup('not-an-icon'), /data-icon="circle-help"/);
  assert.match(symbolMarkup('not-a-symbol'), /data-symbol="warning"/);
});

test('semantic data symbols opt into fills without changing UI icon rules', () => {
  const pin = symbolMarkup('waypoint', { width: 24, height: 27 });
  assert.match(pin, /viewBox="0 0 30 34"/);
  assert.match(pin, /class="data-symbol"/);
  assert.match(pin, /class="symbol-fill"/);
  assert.match(pin, /class="symbol-hole"/);
  assert.doesNotMatch(pin, /fill="none"/);
});
