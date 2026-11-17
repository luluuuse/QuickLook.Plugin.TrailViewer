const STEP_KEYS = { arrowright: 1, arrowleft: -1, d: 1, a: -1 };
const LAYER_KEYS = { q: -1, e: 1 };

export function createKeyboardController({
  LAYERS,
  photoViewer,
  waypointController,
  measurement: getMeasurement,
  overlay: getOverlay,
  layerSwitch: getLayerSwitch,
  fit,
  toggleChrome,
}) {
  function cycleLayer(step) {
    const switcher = getLayerSwitch();
    if (!switcher) return;
    if (switcher.current() === 'none' && switcher.resumeMap) {
      switcher.resumeMap();
      return;
    }
    // A category with no provider (Custom, until the user adds one) is not a stop on the Q/E walk: landing
    // there would show an empty source list and leave the map unchanged. A category that declares no provider
    // map at all is left alone, so a caller that only names categories still cycles through all of them.
    const keys = Object.keys(LAYERS)
      .filter((key) => !LAYERS[key].settingsOnly)
      .filter((key) => LAYERS[key].providers === undefined
        || Object.keys(LAYERS[key].providers).length > 0);
    if (keys.length === 0) return;
    const at = keys.indexOf(switcher.currentCategory());
    switcher.select(keys[(at + step + keys.length) % keys.length], true);
  }

  function pressKey(name) {
    if (photoViewer.isOpen()) return;
    const measurement = getMeasurement?.();
    if (name === 'm') {
      if (measurement?.active()) measurement.stop();
      else measurement?.start();
      return;
    }
    if (name === 'z' || name === 'Z') {
      if (name === 'z') measurement?.undo();
      else measurement?.redo();
      return;
    }
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
    const target = event.target;
    if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    const key = event.key.toLowerCase();
    const photoOpen = photoViewer.isOpen();
    const measurement = getMeasurement?.();
    if (!photoOpen && event.ctrlKey && !event.altKey && !event.metaKey
      && key === 'z' && measurement?.active()) {
      event.preventDefault();
      if (event.repeat) return;
      if (event.shiftKey) measurement.redo();
      else measurement.undo();
      return;
    }
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const shiftedExport = key === 'x' && event.shiftKey;
    const plainShortcut = !event.shiftKey
      && (key === 'w' || key === 'x' || key === 's' || key === 'c' || key === 'm' || LAYER_KEYS[key]);
    if (!photoOpen && (plainShortcut || shiftedExport)) {
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
