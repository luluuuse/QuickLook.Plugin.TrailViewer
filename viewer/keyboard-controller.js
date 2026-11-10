const STEP_KEYS = { arrowright: 1, arrowleft: -1, d: 1, a: -1 };
const LAYER_KEYS = { q: -1, e: 1 };

export function createKeyboardController({
  LAYERS,
  photoViewer,
  waypointController,
  overlay: getOverlay,
  layerSwitch: getLayerSwitch,
  fit,
  toggleChrome,
}) {
  function cycleLayer(step) {
    const switcher = getLayerSwitch();
    if (!switcher) return;
    const keys = Object.keys(LAYERS);
    const at = keys.indexOf(switcher.currentCategory());
    switcher.select(keys[(at + step + keys.length) % keys.length], true);
  }

  function pressKey(name) {
    if (photoViewer.isOpen()) return;
    if (name === 'c') {
      fit();
      return;
    }
    if (name === 'x' || name === 'X') {
      const overlay = getOverlay();
      if (name === 'X') {
        overlay?.togglePanel();
      } else {
        overlay?.close();
        void overlay?.save();
      }
      return;
    }
    if (name === 's') {
      toggleChrome();
      return;
    }
    if (name === 'w') {
      if (waypointController.hasControl()) waypointController.toggle();
      return;
    }
    const turn = LAYER_KEYS[name];
    if (turn) cycleLayer(turn);
  }

  function onKeyDown(event) {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target;
    if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    const key = event.key.toLowerCase();
    const photoOpen = photoViewer.isOpen();
    if (!photoOpen && (key === 'w' || key === 'x' || key === 's' || key === 'c' || LAYER_KEYS[key])) {
      if (event.repeat) return;
      event.preventDefault();
      pressKey(key === 'x' && event.shiftKey ? 'X' : key);
      return;
    }
    const delta = STEP_KEYS[key];
    if (!delta) return;
    event.preventDefault();
    waypointController.stepByKey(delta);
  }

  return { pressKey, onKeyDown };
}
