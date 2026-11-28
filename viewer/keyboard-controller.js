const STEP_KEYS = { arrowright: 1, arrowleft: -1, d: 1, a: -1 };
const LAYER_KEYS = { q: -1, e: 1 };

export function createKeyboardController({
  LAYERS,
  photoViewer,
  waypointController,
  measurement: getMeasurement,
  layerSwitch: getLayerSwitch,
  toolbox: getToolbox,
  trackColor: getTrackColor,
  profile: getProfile,
  editor: getEditor,
  fit,
  toggleChrome,
  toggle3d,
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
    const editor = getEditor?.();
    if (editor?.isActive?.()) {
      if (name === 'z') {
        editor.undo();
        return;
      }
      if (name === 'Z') {
        editor.redo();
        return;
      }
      if (name === 'ctrl+s') {
        editor.save();
        return;
      }
      if (name === 'l' || name === 'm' || name === 't' || name === 's' || name === '3') {
        return;
      }
    }
    if (name === '3') {
      toggle3d?.();
      return;
    }
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
    if (name === 't') {
      getToolbox?.()?.toggle();
      return;
    }
    if (name === 'p') {
      getProfile?.()?.toggleCollapsed?.();
      return;
    }
    if (name === 'l') {
      getTrackColor?.()?.cycle?.();
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
    if (name === 'x') {
      const switcher = getLayerSwitch();
      if (!switcher) return;
      if (switcher.toggleNoMap) switcher.toggleNoMap();
      else if (switcher.current?.() === 'none') switcher.resumeMap?.();
      else switcher.select?.('none', true);
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
    const plainShortcut = !event.shiftKey
      && (key === 'w' || key === 's' || key === 'c' || key === 'm' || key === 't'
        || key === 'p' || key === 'l' || key === 'x' || key === '3' || LAYER_KEYS[key]);
    if (!photoOpen && plainShortcut) {
      if (event.repeat) return;
      event.preventDefault();
      pressKey(key);
      return;
    }
    const delta = STEP_KEYS[key];
    if (!delta) return;
    if (getEditor?.()?.isActive?.()) return;
    event.preventDefault();
    waypointController.stepByKey(delta);
  }

  return { pressKey, onKeyDown };
}
