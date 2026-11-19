import { setIcon } from './icons.js';

export function relabelKeyActions({ configureButton, removeButton, keyReady, t }) {
  if (configureButton) {
    setIcon(configureButton, keyReady ? 'edit' : 'plus');
    configureButton.title = t(keyReady ? 'layer.changeTiandituKey' : 'layer.configureTiandituKey');
    configureButton.setAttribute('aria-label', configureButton.title);
  }
  if (removeButton) {
    removeButton.title = t('layer.removeTiandituKey');
    removeButton.setAttribute('aria-label', removeButton.title);
  }
}

export function rebuildKeyedProviders({
  keyedProviders, layers, current, map, L, directKey, onDirectError, createProviderLayer,
}) {
  for (const [key, entry] of keyedProviders) {
    const previous = layers[key];
    const active = current === key && previous && map.hasLayer(previous);
    if (active) map.removeLayer(previous);
    layers[key] = createProviderLayer(L, map, entry.provider, directKey, onDirectError);
    if (active) layers[key].addTo(map);
  }
}

export function activatePendingProvider({ pendingKeyProvider, keyReady, select, clearPending }) {
  clearPending();
  if (keyReady && pendingKeyProvider) select(pendingKeyProvider, true);
}

export function updateDirectKey({
  key, setDirectKey, setKeyReady, rebuild, current, providers, currentCategory,
  select, defaultProvider, activatePending, menuOpen, renderMenu, relabelActions,
}) {
  const normalized = /^[0-9a-fA-F]{32}$/.test(key || '') ? key : '';
  setDirectKey(normalized);
  setKeyReady(Boolean(normalized));
  rebuild();
  if (!normalized && current && providers[current].provider.requiresKey) {
    select(defaultProvider(currentCategory), true);
  }
  activatePending();
  if (menuOpen()) renderMenu();
  else relabelActions();
}

export function toggleNoMap({ enabled, current, noMapReturn, select, setNoMapReturn }) {
  if (enabled) {
    if (current !== 'none') setNoMapReturn(current);
    select('none', true, { keepMenu: true });
  } else {
    select(noMapReturn || 'road.osm', true, { keepMenu: true });
  }
}
