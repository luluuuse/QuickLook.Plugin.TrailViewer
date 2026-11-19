import { writeStored } from './storage.js';

/** Chooses one provider and updates the map, persistence and menu state around it. */
export function applyLayerSelection({
  value, remember, keepMenu = false, restoreFocus = false,
  current, lastProvider, layers, allLayers, providers, keyReady,
  normalizeLayer, defaultProvider, activeKey, map, ensureCustomLayer, menuOpen,
  openMenu, showSettings, closeMenu, onRemember, setPendingKeyProvider, setNoMapReturn,
}) {
  const category = typeof value === 'string' && value in allLayers ? value : null;
  const key = category ? (lastProvider[category] || defaultProvider(category)) : normalizeLayer(value);
  if (!key) return null;
  const target = providers[key];
  if (!target) return null;
  if (target.provider.requiresKey && !keyReady) {
    setPendingKeyProvider(key);
    openMenu({ focus: false });
    showSettings({ focus: true });
    return null;
  }
  const changed = key !== current;
  if (changed) {
    if (current) map.removeLayer(layers[current]);
    if (target.category === 'custom') ensureCustomLayer(key);
    if (!layers[key]) return null;
    layers[key].addTo(map);
    document.body.classList.toggle('no-map', key === 'none');
    if (key !== 'none') setNoMapReturn(key);
  }
  lastProvider[target.category] = key;
  if (remember) {
    writeStored(activeKey, key);
    onRemember?.();
  }
  if (menuOpen) {
    if (keepMenu) return { key, category: target.category, changed, keepMenu: true };
    closeMenu({ restoreFocus });
  }
  return { key, category: target.category, changed, keepMenu: false };
}
