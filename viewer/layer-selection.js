import { writeStored } from './storage.js';

function resolveMapTone(target, key) {
  if (!target) return 'dark';
  if (target.category === 'satellite' || target.category === 'none') return 'dark';
  if (target.category === 'road' || target.category === 'terrain') return 'light';
  const hint = `${key || ''} ${target.provider?.name || ''} ${target.provider?.label || ''}`.toLowerCase();
  return /(satellite|imagery|aerial|hybrid|dark|night|卫星|影像|暗色|夜)/.test(hint) ? 'dark' : 'light';
}

/** Chooses one provider and updates the map, persistence and menu state around it. */
export function applyLayerSelection({
  value, remember, keepMenu = false, restoreFocus = false,
  current, lastProvider, layers, allLayers, providers, keyReady,
  normalizeLayer, defaultProvider, activeKey, map, ensureCustomLayer, menuOpen,
  openMenu, showSettings, closeMenu, setPendingKeyProvider, setNoMapReturn,
}) {
  const category = typeof value === 'string' && Object.hasOwn(allLayers, value) ? value : null;
  const cachedKey = category ? lastProvider[category] : null;
  const key = category
    ? (cachedKey && Object.hasOwn(providers, cachedKey) ? cachedKey : defaultProvider(category))
    : normalizeLayer(value);
  if (!key || !Object.hasOwn(providers, key)) return null;
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
    if (target.category === 'custom') ensureCustomLayer(key);
    if (!layers[key]) return null;
    if (current && layers[current]) map.removeLayer(layers[current]);
    layers[key].addTo(map);
    document.body.classList.toggle('no-map', key === 'none');
    if (key !== 'none') setNoMapReturn(key);
  }
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dataset.mapTone = resolveMapTone(target, key);
  }
  lastProvider[target.category] = key;
  if (remember) {
    writeStored(activeKey, key);
  }
  if (menuOpen) {
    if (keepMenu) return { key, category: target.category, changed, keepMenu: true };
    closeMenu({ restoreFocus });
  }
  return { key, category: target.category, changed, keepMenu: false };
}
