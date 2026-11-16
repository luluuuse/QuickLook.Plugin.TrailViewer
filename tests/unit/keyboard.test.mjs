import assert from 'node:assert/strict';
import test from 'node:test';
import { createKeyboardController } from '../../viewer/keyboard-controller.js';

function makeController(overrides = {}) {
  const calls = [];
  let selectedLayer = 'road.osm';
  let selectedCategory = 'road';
  let measurementActive = overrides.measurementActive ?? false;
  const measurement = {
    active: () => measurementActive,
    start: () => {
      measurementActive = true;
      calls.push('measure-start');
    },
    stop: () => {
      measurementActive = false;
      calls.push('measure-stop');
    },
    undo: () => calls.push('measure-undo'),
    redo: () => calls.push('measure-redo'),
  };
  const controller = createKeyboardController({
    LAYERS: { road: {}, terrain: {}, satellite: {}, none: {} },
    photoViewer: { isOpen: () => overrides.photoOpen ?? false },
    waypointController: {
      hasControl: () => true,
      toggle: () => calls.push('pins'),
      stepByKey: (delta) => calls.push(`step:${delta}`),
    },
    measurement: () => measurement,
    overlay: () => ({
      togglePanel: () => calls.push('panel'),
      close: () => calls.push('close-panel'),
      save: () => calls.push('export'),
    }),
    layerSwitch: () => ({
      current: () => selectedLayer,
      currentCategory: () => selectedCategory,
      select: (layer) => {
        selectedLayer = layer;
        selectedCategory = layer;
        calls.push(`layer:${layer}`);
      },
    }),
    fit: () => calls.push('fit'),
    toggleChrome: () => calls.push('chrome'),
  });
  return { controller, calls, layer: () => selectedLayer, measurement };
}

function keyEvent(key, extra = {}) {
  const event = {
    key,
    repeat: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    target: null,
    prevented: 0,
    preventDefault() {
      this.prevented += 1;
    },
    ...extra,
  };
  return event;
}

test('viewer shortcuts route to their owning controllers', () => {
  const { controller, calls } = makeController();

  for (const key of ['w', 'q', 'e', 's', 'c', 'x', 'X']) {
    const event = keyEvent(key, { shiftKey: key === 'X' });
    controller.onKeyDown(event);
    assert.equal(event.prevented, 1, key);
  }

  assert.deepEqual(calls, [
    'pins',
    'layer:none',
    'layer:road',
    'chrome',
    'fit',
    'close-panel',
    'export',
    'panel',
  ]);
});

test('modified, repeated and editable-target keys belong to the host', () => {
  const { controller, calls } = makeController();
  const editable = { closest: (selector) => selector.includes('input') };

  for (const event of [
    keyEvent('w', { repeat: true }),
    keyEvent('w', { ctrlKey: true }),
    keyEvent('q', { altKey: true }),
    keyEvent('e', { metaKey: true }),
    keyEvent('w', { target: editable }),
    keyEvent('z'),
  ]) {
    controller.onKeyDown(event);
    assert.equal(event.prevented, 0);
  }

  assert.deepEqual(calls, []);
});

test('arrow navigation remains available while a photo is open', () => {
  const { controller, calls } = makeController({ photoOpen: true });
  const event = keyEvent('ArrowLeft');

  controller.onKeyDown(event);

  assert.equal(event.prevented, 1);
  assert.deepEqual(calls, ['step:-1']);
});

test('map shortcuts stand down behind a full-size photo', () => {
  const { controller, calls } = makeController({ photoOpen: true });

  for (const key of ['w', 'q', 'e', 's', 'c', 'x']) {
    controller.onKeyDown(keyEvent(key));
  }
  controller.pressKey('w');
  controller.pressKey('c');

  assert.deepEqual(calls, []);
});

test('direct host keys follow the same guarded routing', () => {
  const { controller, calls } = makeController();

  controller.pressKey('w');
  controller.pressKey('q');
  controller.pressKey('e');
  controller.pressKey('s');
  controller.pressKey('c');
  controller.pressKey('x');
  controller.pressKey('X');

  assert.deepEqual(calls, [
    'pins',
    'layer:none',
    'layer:road',
    'chrome',
    'fit',
    'close-panel',
    'export',
    'panel',
  ]);
});

test('M toggles measurement through both the page and host routes', () => {
  const { controller, calls, measurement } = makeController();

  controller.onKeyDown(keyEvent('m'));
  assert.equal(measurement.active(), true);
  controller.pressKey('m');
  assert.equal(measurement.active(), false);

  assert.deepEqual(calls, ['measure-start', 'measure-stop']);
});

test('measurement history uses Ctrl+Z and Ctrl+Shift+Z only while active', () => {
  const inactive = makeController();
  const ignored = keyEvent('z', { ctrlKey: true });
  inactive.controller.onKeyDown(ignored);
  assert.equal(ignored.prevented, 0);
  assert.deepEqual(inactive.calls, []);

  const { controller, calls } = makeController({ measurementActive: true });
  const undo = keyEvent('z', { ctrlKey: true });
  const redo = keyEvent('z', { ctrlKey: true, shiftKey: true });
  controller.onKeyDown(undo);
  controller.onKeyDown(redo);
  controller.pressKey('z');
  controller.pressKey('Z');

  assert.equal(undo.prevented, 1);
  assert.equal(redo.prevented, 1);
  assert.deepEqual(calls, ['measure-undo', 'measure-redo', 'measure-undo', 'measure-redo']);
});
