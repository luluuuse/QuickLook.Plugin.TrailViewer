import assert from 'node:assert/strict';
import test from 'node:test';
import { createKeyboardController } from '../../viewer/keyboard-controller.js';

function makeController(overrides = {}) {
  const calls = [];
  let selectedLayer = 'map';
  const controller = createKeyboardController({
    LAYERS: { map: {}, terrain: {}, satellite: {}, none: {} },
    photoViewer: { isOpen: () => overrides.photoOpen ?? false },
    waypointController: {
      hasControl: () => true,
      toggle: () => calls.push('pins'),
      stepByKey: (delta) => calls.push(`step:${delta}`),
    },
    overlay: () => ({
      togglePanel: () => calls.push('panel'),
      close: () => calls.push('close-panel'),
      save: () => calls.push('export'),
    }),
    layerSwitch: () => ({
      current: () => selectedLayer,
      select: (layer) => {
        selectedLayer = layer;
        calls.push(`layer:${layer}`);
      },
    }),
    fit: () => calls.push('fit'),
    toggleChrome: () => calls.push('chrome'),
  });
  return { controller, calls, layer: () => selectedLayer };
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
    'layer:map',
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
    'layer:map',
    'chrome',
    'fit',
    'close-panel',
    'export',
    'panel',
  ]);
});
