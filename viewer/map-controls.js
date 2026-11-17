// Leaflet controls and layer definitions. Dependencies are injected so this module does not reach into the map
// application's globals.

import { readStored, writeStored } from './storage.js';
import { iconElement, iconMarkup, setIcon } from './icons.js';
import {
  CUSTOM_LIMITS,
  createCustomLayer,
  loadCustomLayers,
  normalizeEntry,
  saveCustomLayers,
  validateTemplate,
} from './custom-layers.js';

export const LAYERS = {
  road: {
    label: 'layer.road',
    short: 'layer.shortRoad',
    title: 'layer.roadTitle',
    providers: {
      osm: {
        key: 'road.osm',
        label: 'layer.osm',
        url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
        options: {
          subdomains: 'abc',
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors, '
            + 'style <a href="https://www.hotosm.org/" target="_blank">HOT</a>, '
            + 'hosted by <a href="https://openstreetmap.fr/" target="_blank">OSM France</a>',
        },
      },
      tianditu: {
        key: 'road.tianditu',
        label: 'layer.tiandituRoad',
        requiresKey: 'tianditu',
        layers: [
          {
            layer: 'vec',
            options: {
              maxZoom: 19,
              maxNativeZoom: 18,
              zIndex: 5,
              attribution: '&copy; <a href="https://www.tianditu.gov.cn/" target="_blank">天地图</a>',
            },
          },
          {
            layer: 'cva',
            options: { maxZoom: 19, maxNativeZoom: 18, zIndex: 10 },
          },
        ],
      },
    },
  },
  terrain: {
    label: 'layer.terrain',
    short: 'layer.shortTerrain',
    title: 'layer.terrainTitle',
    providers: {
      cyclosm: {
        key: 'terrain.cyclosm',
        label: 'layer.cyclosm',
        url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
        options: {
          subdomains: 'abc',
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors, '
            + 'style <a href="https://www.cyclosm.org/" target="_blank">CyclOSM</a>, '
            + 'hosted by <a href="https://openstreetmap.fr/" target="_blank">OSM France</a>',
        },
      },
      openHiking: {
        key: 'terrain.openHiking',
        label: 'layer.openHiking',
        url: 'https://tile.openmaps.fr/openhikingmap/{z}/{x}/{y}.png',
        options: {
          maxZoom: 19,
          maxNativeZoom: 18,
          attribution: '<a href="https://wiki.openstreetmap.org/wiki/OpenHikingMap" target="_blank">'
            + '&copy; OpenHikingMap</a> '
            + '<a href="https://openmaps.fr/donate" target="_blank">Donation</a> '
            + '<a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap</a>',
        },
      },
      openTopo: {
        key: 'terrain.openTopo',
        label: 'layer.openTopo',
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        options: {
          subdomains: 'abc',
          maxZoom: 19,
          maxNativeZoom: 17,
          attribution: 'Map data &copy; '
            + '<a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors, '
            + '<a href="https://viewfinderpanoramas.org/" target="_blank">SRTM</a> | Map style &copy; '
            + '<a href="https://opentopomap.org/" target="_blank">OpenTopoMap</a> '
            + '(<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank">CC-BY-SA</a>)',
        },
      },
    },
  },
  satellite: {
    label: 'layer.satellite',
    short: 'layer.shortSatellite',
    title: 'layer.satelliteTitle',
    providers: {
      esri: {
        key: 'satellite.esri',
        label: 'layer.esri',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        options: {
          maxZoom: 19,
          attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics and the GIS User Community',
        },
      },
      tianditu: {
        key: 'satellite.tianditu',
        label: 'layer.tiandituSatellite',
        requiresKey: 'tianditu',
        layers: [
          {
            layer: 'img',
            options: {
              maxZoom: 19,
              maxNativeZoom: 18,
              zIndex: 5,
              attribution: '&copy; <a href="https://www.tianditu.gov.cn/" target="_blank">天地图</a>',
            },
          },
          {
            layer: 'cia',
            options: { maxZoom: 19, maxNativeZoom: 18, zIndex: 10 },
          },
        ],
      },
    },
  },
  // Filled at runtime from the user's own list. The plugin ships no third-party endpoint, so this category is
  // empty until someone adds one.
  custom: {
    label: 'layer.custom',
    short: 'layer.shortCustom',
    title: 'layer.customTitle',
    providers: {},
  },
  none: {
    label: 'layer.none',
    short: 'layer.shortNone',
    title: 'layer.noneTitle',
    settingsOnly: true,
    providers: {
      none: { key: 'none', label: 'layer.none' },
    },
  },
};

const CATEGORY_ICONS = Object.freeze({
  road: 'layer-road',
  terrain: 'layer-terrain',
  satellite: 'layer-satellite',
  custom: 'layer-custom',
});

const LAYER_KEY = 'layer';
const LEGACY_LAYERS = {
  map: 'road.osm',
  terrain: 'terrain.cyclosm',
  satellite: 'satellite.esri',
  none: 'none',
};

const PROVIDERS = Object.fromEntries(Object.entries(LAYERS).flatMap(([category, definition]) =>
  Object.values(definition.providers).map((provider) => [provider.key, { category, provider }])));

/** Registers one user entry so the rest of the switcher can treat it like any other provider. */
function registerCustomProvider(entry) {
  LAYERS.custom.providers[entry.id] = {
    key: entry.id,
    label: entry.name,
    custom: entry,
  };
  PROVIDERS[entry.id] = { category: 'custom', provider: LAYERS.custom.providers[entry.id] };
}

function unregisterCustomProvider(id) {
  delete LAYERS.custom.providers[id];
  delete PROVIDERS[id];
}

function defaultProvider(category) {
  return Object.values(LAYERS[category]?.providers || {})[0]?.key;
}

export function normalizeLayer(value) {
  if (typeof value !== 'string') return null;
  if (value in PROVIDERS) return value;
  if (value in LEGACY_LAYERS) return LEGACY_LAYERS[value];
  if (value in LAYERS) return defaultProvider(value);
  return null;
}

/** Loads the user's own sources and makes them selectable before the switcher is built. */
export function loadCustomProviders(read = readStored, hosted = null) {
  const entries = loadCustomLayers(read, hosted);
  for (const entry of entries) registerCustomProvider(entry);
  return entries;
}

function graticule(L, map) {
  const group = L.layerGroup();
  const steps = [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30];
  const style = { color: '#ffffff', opacity: 0.12, weight: 1, interactive: false };

  function redraw() {
    group.clearLayers();
    const bounds = map.getBounds();
    const span = Math.max(bounds.getNorth() - bounds.getSouth(), 1e-6);
    const step = steps.find((candidate) => span / candidate <= 10) ?? 30;
    const south = Math.max(-90, bounds.getSouth());
    const north = Math.min(90, bounds.getNorth());
    for (let lat = Math.ceil(south / step) * step; lat <= north; lat += step) {
      group.addLayer(L.polyline([[lat, bounds.getWest()], [lat, bounds.getEast()]], style));
    }
    for (let lon = Math.ceil(bounds.getWest() / step) * step; lon <= bounds.getEast(); lon += step) {
      group.addLayer(L.polyline([[south, lon], [north, lon]], style));
    }
  }

  group.on('add', () => {
    map.on('moveend', redraw);
    redraw();
  });
  group.on('remove', () => map.off('moveend', redraw));
  return group;
}

function tiandituDirectUrl(layer, key) {
  return `https://t{s}.tianditu.gov.cn/${layer}_w/wmts`
    + '?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
    + `&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles`
    + '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'
    + `&tk=${encodeURIComponent(key)}`;
}

function createProviderLayer(L, map, provider, directKey, onDirectError) {
  if (provider.custom) return createCustomLayer(L, provider.custom);
  if (provider.requiresKey === 'tianditu') {
    if (!directKey) return L.layerGroup();
    const tileLayers = provider.layers.map(({ layer, options }) =>
      L.tileLayer(tiandituDirectUrl(layer, directKey), {
        ...(options || {}),
        subdomains: '01234567',
      }));
    const retryDelays = [800, 2500];
    let consecutiveErrors = 0;
    let retryAttempt = 0;
    let retryTimer = null;
    const retry = () => {
      if (retryTimer || retryAttempt >= retryDelays.length) return;
      const delay = retryDelays[retryAttempt];
      retryAttempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        for (const layer of tileLayers) {
          if (layer._map) layer.redraw();
        }
      }, delay);
    };
    const failed = () => {
      consecutiveErrors += 1;
      if (consecutiveErrors < 3) return;
      onDirectError({ count: consecutiveErrors, retrying: retryAttempt < retryDelays.length });
      retry();
    };
    const loaded = () => {
      consecutiveErrors = 0;
      retryAttempt = 0;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
    };
    for (const layer of tileLayers) {
      layer.on('tileerror', failed);
      layer.on('tileload', loaded);
    }
    return L.layerGroup(tileLayers);
  }
  if (!provider.url) return graticule(L, map);
  return L.tileLayer(provider.url, { ...(provider.options || {}) });
}

export function savedLayer(params) {
  const fromHost = normalizeLayer(params.get('layer'));
  if (fromHost) return fromHost;
  return normalizeLayer(readStored(LAYER_KEY)) || 'road.osm';
}

export function createLayerSwitcher({
  L, map, el, t, initial, onRemember, tiandituDirectKey = '',
  onConfigureTianditu = () => {}, onRemoveTianditu = () => {},
  onTiandituDirectError = () => {}, onCustomError = () => {},
  onOpen = () => {}, onCustomSave, customSources = null,
}) {
  let directKey = tiandituDirectKey;
  let keyReady = Boolean(directKey);
  const layers = {};
  const keyedProviders = Object.entries(PROVIDERS)
    .filter(([, entry]) => entry.provider.requiresKey === 'tianditu');
  for (const definition of Object.values(LAYERS)) {
    for (const provider of Object.values(definition.providers)) {
      if (provider.custom) continue;
      layers[provider.key] = createProviderLayer(
        L, map, provider, directKey, onTiandituDirectError,
      );
    }
  }
  const initialKey = normalizeLayer(initial) || 'road.osm';
  let pendingKeyProvider = null;
  let current = null;
  let currentCategory = PROVIDERS[initialKey].category;
  let menuOpen = false;
  const categoryButtons = {};
  const categoryLabels = {};
  const providerButtons = {};
  const providerLabels = {};
  const lastProvider = {};
  for (const category of Object.keys(LAYERS)) lastProvider[category] = defaultProvider(category);
  let menuToggle;
  let menuIcon;
  let menuLabel;
  let menu;
  let mainView;
  let settingsView;
  let menuHeading;
  let backButton;
  let settingsButton;
  let closeButton;
  let noMapButton;
  let keyStatus;
  let sourceSection;
  let sourceEmpty;
  let providerList;
  let configureButton;
  let removeButton;
  let settingsViewOpen = false;
  let customView;
  let customViewOpen = false;
  let customList;
  let customForm;
  let customEmpty;
  let customEmptyAction;
  let customCount;
  let customError;
  let customUrlStatus;
  let customAddButton;
  let customManageButton;
  let customEntries = customSources || loadCustomLayers(readStored);
  const customErrors = new Set();
  const customStates = new Map();
  let editingId = null;
  let pendingDelete = null;
  let noMapReturn = 'road.osm';


  // ---- custom sources ---------------------------------------------------------------------------------
  // The list is the user's; the plugin only validates the template and hands it to Leaflet. Anything that
  // fails validation is dropped on read, so a corrupt entry can never break the preview.

  function refreshCustomProviders() {
    for (const id of Object.keys(LAYERS.custom.providers)) unregisterCustomProvider(id);
    for (const entry of customEntries) registerCustomProvider(entry);
  }

  function customProviderLayer(entry) {
    const layer = createCustomLayer(L, entry);
    let warned = false;
    let loadedTiles = 0;
    let failedTiles = 0;
    const setState = (state) => {
      if (customStates.get(entry.id) === state) return;
      customStates.set(entry.id, state);
      renderCustomList();
    };
    setState('loading');
    layer.on('tileerror', () => {
      failedTiles += 1;
      customErrors.add(entry.id);
      setState(loadedTiles > 0 ? 'limited' : 'error');
      renderCustomList();
      renderMenu();
      if (!warned) {
        warned = true;
        onCustomError();
      }
    });
    layer.on('tileload', () => {
      loadedTiles += 1;
      customErrors.delete(entry.id);
      setState(failedTiles > 0 ? 'limited' : 'ready');
      renderCustomList();
      renderMenu();
    });
    return layer;
  }

  function ensureCustomLayer(id) {
    const entry = LAYERS.custom.providers[id]?.custom;
    if (!entry) return null;
    if (!layers[id]) layers[id] = customProviderLayer(entry);
    return layers[id];
  }

  function persistCustom(previousId = null) {
    const wasCurrent = Boolean(previousId && current === previousId);
    if (wasCurrent) map.removeLayer(layers[previousId]);
    customErrors.delete(previousId);
    customStates.delete(previousId);
    customEntries = saveCustomLayers(writeStored, customEntries);
    onCustomSave?.(customEntries);
    refreshCustomProviders();
    renderProviderList();
    if (wasCurrent && PROVIDERS[current]) {
      delete layers[current];
      ensureCustomLayer(current).addTo(map);
      updateMenuButton();
    }
    if (currentCategory === 'custom' && !PROVIDERS[current]) {
      select('road.osm', true);
    }
    renderMenu();
  }

  function clearCustomForm() {
    editingId = null;
    if (!customForm) return;
    for (const field of customForm.querySelectorAll('input')) {
      if (field.type === 'checkbox') field.checked = false;
      else if (field.type === 'radio') field.checked = field.value === '256';
      else if (field.name === 'minZoom') field.value = '1';
      else if (field.name === 'maxZoom') field.value = '19';
      else field.value = '';
    }
    customUrlStatus.hidden = true;
    customForm.querySelector('[name="url"]')?.removeAttribute('data-invalid');
    customForm.hidden = true;
    if (customError) customError.hidden = true;
    if (menuHeading) menuHeading.textContent = t('layer.customHeading');
    renderCustomList();
  }

  function readCustomForm() {
    const value = (name) => customForm.querySelector(`[name="${name}"]`)?.value ?? '';
    return {
      id: editingId || undefined,
      name: value('name').trim(),
      url: value('url').trim(),
      tileSize: Number(customForm.querySelector('[name="tileSize"]:checked')?.value || 256),
      minZoom: Number(value('minZoom') || 1),
      maxZoom: Number(value('maxZoom') || 19),
      subdomains: value('subdomains').trim(),
      attribution: value('attribution').trim(),
      tms: Boolean(customForm.querySelector('[name="tms"]')?.checked),
    };
  }

  function showCustomError(code) {
    if (!customError) return;
    const key = {
      empty: 'layer.customInvalidEmpty',
      scheme: 'layer.customInvalidScheme',
      token: 'layer.customInvalidToken',
      space: 'layer.customInvalidSpace',
      syntax: 'layer.customInvalidSyntax',
      subdomain: 'layer.customSubdomainRequired',
      duplicate: 'layer.customDuplicate',
      name: 'layer.customInvalidName',
    }[code] || 'layer.customInvalidToken';
    customError.textContent = t(key);
    customError.hidden = false;
  }

  function submitCustomForm() {
    const draft = readCustomForm();
    if (!draft.name) { showCustomError('name'); return; }
    const checked = validateTemplate(draft.url);
    if (!checked.ok) { showCustomError(checked.code); return; }
    if (checked.url.includes('{s}') && !draft.subdomains) {
      showCustomError('subdomain');
      return;
    }
    const duplicate = customEntries.some((entry) => entry.id !== editingId
      && entry.name.toLocaleLowerCase() === draft.name.toLocaleLowerCase());
    if (duplicate) {
      showCustomError('duplicate');
      return;
    }

    const previousId = editingId;
    const next = customEntries.filter((entry) => entry.id !== editingId);
    const saved = normalizeEntry(draft, next.length);
    if (!saved) { showCustomError('token'); return; }
    next.push(saved);
    customEntries = next;
    persistCustom(previousId);
    clearCustomForm();
    select(saved.id, true, { keepMenu: true });
    showCustomView({ focus: false });
    customAddButton?.focus({ preventScroll: true });
  }

  function editCustom(id) {
    const entry = customEntries.find((candidate) => candidate.id === id);
    if (!entry || !customForm) return;
    pendingDelete = null;
    editingId = id;
    const set = (name, value) => {
      const field = customForm.querySelector(`[name="${name}"]`);
      if (field) field.value = value;
    };
    set('name', entry.name);
    set('url', entry.url);
    set('minZoom', String(entry.minZoom));
    set('maxZoom', String(entry.maxZoom));
    set('subdomains', entry.subdomains);
    set('attribution', entry.attribution);
    const size = customForm.querySelector(`[name="tileSize"][value="${entry.tileSize}"]`);
    if (size) size.checked = true;
    const tms = customForm.querySelector('[name="tms"]');
    if (tms) tms.checked = entry.tms;
    openCustomForm();
  }

  function removeCustom(id) {
    const wasCurrent = current === id;
    const remaining = customEntries.filter((entry) => entry.id !== id);
    if (wasCurrent) {
      if (noMapReturn === id) noMapReturn = remaining[0]?.id || 'road.osm';
      select(remaining[0]?.id || 'road.osm', true);
    }
    delete layers[id];
    customErrors.delete(id);
    customStates.delete(id);
    if (pendingDelete === id) pendingDelete = null;
    customEntries = remaining;
    persistCustom();
    renderCustomList();
    if (menuOpen) renderMenu();
  }


  /** Rebuilds the source list so newly added custom providers appear without a reload. */
  function renderProviderList() {
    if (!providerList) return;
    for (const key of Object.keys(providerButtons)) delete providerButtons[key];
    for (const key of Object.keys(providerLabels)) delete providerLabels[key];
    providerList.replaceChildren();
    for (const [category, definition] of Object.entries(LAYERS)) {
      for (const provider of Object.values(definition.providers)) {
        const button = el('button', 'layer-provider-option');
        button.type = 'button';
        button.setAttribute('role', 'radio');
        button.dataset.provider = provider.key;
        button.dataset.category = category;
        button.setAttribute('aria-checked', 'false');
        button.hidden = true;
        const check = el('span', 'layer-selected-icon');
        check.hidden = true;
        check.append(iconElement('check', { size: 12 }));
        const label = el('span', 'layer-provider-label', t(provider.label));
        button.append(check, label);
        button.addEventListener('click', () => select(provider.key, true, { restoreFocus: true }));
        providerButtons[provider.key] = button;
        providerLabels[provider.key] = { check, label };
        providerList.append(button);
      }
    }
  }

  function addCustom() {
    editingId = null;
    pendingDelete = null;
    clearCustomForm();
    openCustomForm();
  }

  /** Shows the form and hides the list/add button, so the settings page stays short. */
  function openCustomForm() {
    if (!customForm) return;
    customForm.hidden = false;
    customForm.querySelector('.layer-custom-advanced')?.removeAttribute('open');
    if (customList) customList.hidden = true;
    if (customEmpty) customEmpty.hidden = true;
    if (customAddButton) customAddButton.hidden = true;
    if (customCount) customCount.hidden = true;
    if (menuHeading) {
      menuHeading.textContent = t(editingId
        ? 'layer.customEditTitle' : 'layer.customAddTitle');
    }
    customForm.querySelector('[name="name"]')?.focus({ preventScroll: true });
    // The page scrolls inside the menu; bring the form to the top so its fields are not half hidden above the fold.
    customForm.scrollIntoView({ block: 'nearest' });
  }

  function renderCustomList() {
    if (!customList) return;
    const editing = Boolean(customForm && !customForm.hidden);
    customList.hidden = editing;
    if (customAddButton) customAddButton.hidden = !customViewOpen || editing;
    if (customEmpty) customEmpty.hidden = editing || customEntries.length > 0;
    if (customCount) {
      customCount.hidden = editing || !customViewOpen;
      customCount.textContent = `${customEntries.length}/${CUSTOM_LIMITS.maxEntries}`;
    }
    customList.replaceChildren();
    for (const entry of customEntries) {
      const state = customStates.get(entry.id) || '';
      const row = el('div', `layer-custom-row${entry.id === current ? ' active' : ''}`);
      const choose = el('button', 'layer-custom-select');
      choose.type = 'button';
      choose.dataset.customSelect = entry.id;
      choose.setAttribute('role', 'radio');
      choose.setAttribute('aria-checked', String(entry.id === current));
      const check = el('span', 'layer-custom-check');
      if (entry.id === current) check.append(iconElement('check', { size: 12 }));
      choose.append(check);
      const copy = el('div', 'layer-custom-copy');
      const title = el('span', 'layer-custom-name', entry.name);
      title.title = entry.url;
      let host = '';
      try { host = new URL(entry.url.replaceAll('{s}', 'a')).host; } catch { host = entry.url; }
      const meta = el('span', 'layer-custom-meta');
      meta.append(el('span', 'layer-custom-host', host));
      if (state) {
        meta.append(el('span', `layer-custom-status ${state}`, t({
          loading: 'layer.customStatusLoading',
          ready: 'layer.customStatusReady',
          limited: 'layer.customStatusLimited',
          error: 'layer.customStatusError',
        }[state])));
      }
      copy.append(title, meta);
      choose.append(copy);
      choose.addEventListener('click', (event) => {
        event.stopPropagation();
        pendingDelete = null;
        select(entry.id, true, { keepMenu: true });
        renderCustomList();
      });
      const actions = el('div', 'layer-custom-actions');
      const edit = el('button', 'layer-custom-action');
      edit.type = 'button';
      edit.dataset.customEdit = entry.id;
      setIcon(edit, 'edit', { size: 12 });
      edit.title = t('layer.customEdit');
      edit.setAttribute('aria-label', edit.title);
      edit.addEventListener('click', () => editCustom(entry.id));
      const remove = el('button', `layer-custom-action danger${pendingDelete === entry.id ? ' confirm' : ''}`);
      remove.type = 'button';
      remove.dataset.customRemove = entry.id;
      setIcon(remove, pendingDelete === entry.id ? 'check' : 'clear', { size: 12 });
      remove.title = t(pendingDelete === entry.id
        ? 'layer.customRemoveConfirm' : 'layer.customRemove');
      remove.setAttribute('aria-label', remove.title);
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        if (pendingDelete !== entry.id) {
          pendingDelete = entry.id;
          renderCustomList();
          return;
        }
        removeCustom(entry.id);
      });
      actions.append(edit, remove);
      row.append(choose, actions);
      customList.append(row);
    }
  }

  function updateMenuButton() {
    if (!menuToggle || !menuLabel || !current || !currentCategory) return;
    const category = PROVIDERS[current].category;
    const providerLabel = t(PROVIDERS[current].provider.label);
    const iconName = current === 'none' ? 'map-grid' : CATEGORY_ICONS[category];
    if (menuIcon?.dataset.icon !== iconName) {
      const next = iconElement(iconName);
      menuIcon?.replaceWith(next);
      menuIcon = next;
    }
    menuLabel.textContent = t(LAYERS[category].label);
    menuToggle.dataset.short = t(LAYERS[category].short);
    menuToggle.dataset.category = category;
    const description = `${t('layer.menuTitle')} · ${providerLabel} · ${t(LAYERS[category].title)}`;
    menuToggle.title = description;
    menuToggle.setAttribute('aria-label', description);
  }

  function updateNoMapButton() {
    if (!noMapButton) return;
    const active = current === 'none';
    noMapButton.setAttribute('aria-checked', String(active));
    noMapButton.classList.toggle('active', active);
    noMapButton.title = t(active ? 'layer.noMapEnabled' : 'layer.noMapModeHint');
    noMapButton.setAttribute('aria-label', t(active
      ? 'layer.noMapEnabled' : 'layer.noMapMode'));
  }

  function updateChoices() {
    for (const [candidate, button] of Object.entries(categoryButtons)) {
      const checked = candidate === currentCategory;
      button.classList.toggle('active', checked);
      button.setAttribute('aria-checked', String(checked));
    }
    for (const [candidate, button] of Object.entries(providerButtons)) {
      const checked = candidate === current;
      button.classList.toggle('selected', checked);
      button.setAttribute('aria-checked', String(checked));
      providerLabels[candidate].check.hidden = !checked;
    }
  }

  function select(value, remember, { keepMenu = false, restoreFocus = false } = {}) {
    const category = typeof value === 'string' && value in LAYERS ? value : null;
    const key = category ? (lastProvider[category] || defaultProvider(category)) : normalizeLayer(value);
    if (!key) return;
    const target = PROVIDERS[key];
    if (!target) return false;
    if (target.provider.requiresKey && !keyReady) {
      pendingKeyProvider = key;
      openMenu({ focus: false });
      showSettings({ focus: true });
      return false;
    }
    const changed = key !== current;
    if (changed) {
      if (current) map.removeLayer(layers[current]);
      // A custom source is created on first use, so an edited URL always renders the current template.
      if (target.category === 'custom') ensureCustomLayer(key);
      if (!layers[key]) return false;
      layers[key].addTo(map);
      document.body.classList.toggle('no-map', key === 'none');
      if (key !== 'none') noMapReturn = key;
    }
    current = key;
    currentCategory = target.category;
    lastProvider[currentCategory] = key;
    updateChoices();
    updateMenuButton();
    updateNoMapButton();
    if (remember) {
      writeStored(LAYER_KEY, key);
      onRemember?.();
    }
    if (menuOpen) {
      if (keepMenu) renderMenu();
      else closeMenu({ restoreFocus });
    }
    return true;
  }

  function closeMenu({ restoreFocus = false } = {}) {
    if (!menu || !menuOpen) return;
    menuOpen = false;
    settingsViewOpen = false;
    customViewOpen = false;
    menu.hidden = true;
    menuToggle?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) menuToggle?.focus({ preventScroll: true });
  }

  function showLayers({ focus = true, focusSettings = false } = {}) {
    if (!mainView || !settingsView) return;
    settingsViewOpen = false;
    customViewOpen = false;
    mainView.hidden = false;
    settingsView.hidden = true;
    if (customView) customView.hidden = true;
    backButton.hidden = true;
    settingsButton.hidden = false;
    menuHeading.textContent = t('layer.menuTitle');
    renderMenu();
    if (focus) {
      (focusSettings
        ? settingsButton
        : categoryButtons[currentCategory] || noMapButton)?.focus({ preventScroll: true });
    }
  }

  function showSettings({ focus = true } = {}) {
    if (!mainView || !settingsView) return;
    settingsViewOpen = true;
    customViewOpen = false;
    mainView.hidden = true;
    settingsView.hidden = false;
    if (customView) customView.hidden = true;
    backButton.hidden = false;
    settingsButton.hidden = true;
    menuHeading.textContent = t('layer.settingsTitle');
    renderMenu();
    if (focus) configureButton?.focus({ preventScroll: true });
  }

  function showCustomView({ focus = true } = {}) {
    if (!customView) return;
    settingsViewOpen = false;
    customViewOpen = true;
    mainView.hidden = true;
    settingsView.hidden = true;
    customView.hidden = false;
    backButton.hidden = false;
    settingsButton.hidden = true;
    menuHeading.textContent = t('layer.customHeading');
    renderCustomList();
    if (focus) customAddButton?.focus({ preventScroll: true });
  }

  function backFromCurrentView() {
    if (customViewOpen) {
      if (customForm && !customForm.hidden) {
        clearCustomForm();
        customAddButton?.focus({ preventScroll: true });
      } else {
        showLayers({ focus: true });
      }
      return;
    }
    showLayers({ focusSettings: true });
  }

  function renderMenu() {
    if (!menu || !currentCategory) return;
    updateChoices();
    for (const [key, button] of Object.entries(providerButtons)) {
      const visible = PROVIDERS[key].category === currentCategory;
      button.hidden = !visible;
      const locked = visible && PROVIDERS[key].provider.requiresKey && !keyReady;
      button.classList.toggle('locked', locked);
      button.dataset.locked = String(locked);
      button.removeAttribute('aria-disabled');
    }
    const noSource = currentCategory === 'none';
    if (providerList) providerList.hidden = noSource;
    if (sourceEmpty) sourceEmpty.hidden = !noSource;
    if (sourceSection) sourceSection.hidden = noSource;
    if (customManageButton) {
      customManageButton.hidden = currentCategory !== 'custom' || customEntries.length === 0;
    }
    if (keyStatus) {
      keyStatus.textContent = t(keyReady ? 'layer.keyConfigured' : 'layer.keyMissing');
      keyStatus.dataset.configured = String(keyReady);
    }
    if (removeButton) removeButton.hidden = !keyReady;
    relabelKeyActions();
    renderCustomList();
  }

  function openMenu({ focus = true } = {}) {
    if (!menu) return;
    onOpen?.();
    menuOpen = true;
    menu.hidden = false;
    menuToggle?.setAttribute('aria-expanded', 'true');
    if (currentCategory === 'custom' && customEntries.length === 0) showCustomView({ focus });
    else showLayers({ focus });
  }

  function relabelKeyActions() {
    if (configureButton) {
      setIcon(configureButton, keyReady ? 'edit' : 'plus');
      configureButton.title = t(keyReady
        ? 'layer.changeTiandituKey' : 'layer.configureTiandituKey');
      configureButton.setAttribute('aria-label', configureButton.title);
    }
    if (removeButton) {
      removeButton.title = t('layer.removeTiandituKey');
      removeButton.setAttribute('aria-label', removeButton.title);
    }
  }

  function rebuildKeyedProviders() {
    for (const [key, entry] of keyedProviders) {
      const previous = layers[key];
      const active = current === key && previous && map.hasLayer(previous);
      if (active) map.removeLayer(previous);
      layers[key] = createProviderLayer(
        L, map, entry.provider, directKey, onTiandituDirectError,
      );
      if (active) layers[key].addTo(map);
    }
  }

  function activatePendingProvider() {
    const pending = pendingKeyProvider;
    pendingKeyProvider = null;
    if (keyReady && pending) select(pending, true);
  }

  function setDirectKey(key) {
    directKey = /^[0-9a-fA-F]{32}$/.test(key || '') ? key : '';
    keyReady = Boolean(directKey);
    rebuildKeyedProviders();
    if (!keyReady && current && PROVIDERS[current].provider.requiresKey) {
      select(defaultProvider(currentCategory), true);
    }
    activatePendingProvider();
    if (menuOpen) renderMenu();
    else relabelKeyActions();
  }

  function toggleNoMap(enabled) {
    if (enabled) {
      if (current !== 'none') noMapReturn = current;
      select('none', true, { keepMenu: true });
    } else {
      select(noMapReturn || 'road.osm', true, { keepMenu: true });
    }
  }

  const Control = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const bar = el('div', 'layer-switch leaflet-bar');
      menuToggle = el('button', 'layer-menu-toggle');
      menuToggle.type = 'button';
      menuToggle.dataset.layer = 'menu';
      menuToggle.setAttribute('aria-haspopup', 'dialog');
      menuToggle.setAttribute('aria-expanded', 'false');
      menuToggle.setAttribute('aria-controls', 'layer-source-menu');
      menuToggle.innerHTML = iconMarkup('layers');
      menuIcon = menuToggle.firstElementChild;
      menuLabel = el('span', 'layer-menu-label');
      const menuChevron = iconElement('chevron-down', { size: 12 });
      menuChevron.classList.add('layer-menu-chevron');
      menuToggle.append(menuLabel, menuChevron);
      menuToggle.addEventListener('click', () => {
        if (menuOpen) closeMenu({ restoreFocus: true });
        else openMenu();
      });
      bar.append(menuToggle);

      menu = el('div', 'layer-source-menu');
      menu.id = 'layer-source-menu';
      menu.hidden = true;
      menu.setAttribute('role', 'dialog');
      const headingId = 'layer-source-heading';
      menu.setAttribute('aria-labelledby', headingId);
      const header = el('div', 'layer-menu-header');
      backButton = el('button', 'layer-menu-icon-button layer-menu-back');
      backButton.type = 'button';
      setIcon(backButton, 'chevron-left');
      backButton.hidden = true;
      backButton.title = t('layer.backToLayers');
      backButton.setAttribute('aria-label', t('layer.backToLayers'));
      backButton.addEventListener('click', backFromCurrentView);
      menuHeading = el('strong', 'layer-source-heading', t('layer.menuTitle'));
      menuHeading.id = headingId;
      const headerActions = el('div', 'layer-menu-header-actions');
      settingsButton = el('button', 'layer-menu-icon-button layer-settings-button');
      settingsButton.type = 'button';
      settingsButton.title = t('layer.openSettings');
      settingsButton.setAttribute('aria-label', t('layer.openSettings'));
      setIcon(settingsButton, 'settings');
      settingsButton.addEventListener('click', () => showSettings());
      noMapButton = el('button', 'layer-menu-icon-button layer-nomap-button');
      noMapButton.type = 'button';
      noMapButton.dataset.noMap = '';
      noMapButton.setAttribute('role', 'switch');
      noMapButton.setAttribute('aria-checked', 'false');
      noMapButton.title = t('layer.noMapModeHint');
      noMapButton.setAttribute('aria-label', t('layer.noMapMode'));
      setIcon(noMapButton, 'map-grid');
      noMapButton.addEventListener('click', () => toggleNoMap(current !== 'none'));
      closeButton = el('button', 'layer-menu-icon-button layer-menu-close');
      closeButton.type = 'button';
      setIcon(closeButton, 'close');
      closeButton.title = t('layer.closeMenu');
      closeButton.setAttribute('aria-label', t('layer.closeMenu'));
      closeButton.addEventListener('click', () => closeMenu({ restoreFocus: true }));
      headerActions.append(noMapButton, settingsButton, closeButton);
      header.append(backButton, menuHeading, headerActions);
      menu.append(header);

      mainView = el('div', 'layer-main-view');

      const typeSection = el('section', 'layer-menu-section');
      const typeHeading = el('span', 'layer-section-label', t('layer.typeHeading'));
      typeHeading.dataset.labelKey = 'layer.typeHeading';
      typeSection.append(typeHeading);
      const categoryGrid = el('div', 'layer-category-grid');
      categoryGrid.setAttribute('role', 'radiogroup');
      categoryGrid.setAttribute('aria-label', t('layer.typeHeading'));
      for (const [category, definition] of Object.entries(LAYERS)) {
        if (definition.settingsOnly) continue;
        const button = el('button', 'layer-category-button');
        button.type = 'button';
        button.setAttribute('role', 'radio');
        button.setAttribute('aria-checked', 'false');
        button.setAttribute('aria-label', t(definition.title));
        button.title = t(definition.title);
        button.dataset.layer = category;
        button.innerHTML = iconMarkup(CATEGORY_ICONS[category]);
        const label = el('span', 'layer-category-label', t(definition.label));
        button.append(label);
        button.addEventListener('click', () => {
          if (category === 'custom' && customEntries.length === 0) {
            showCustomView();
            return;
          }
          select(category, true, { keepMenu: true });
        });
        categoryButtons[category] = button;
        categoryLabels[category] = label;
        categoryGrid.append(button);
      }
      typeSection.append(categoryGrid);
      mainView.append(typeSection);

      sourceSection = el('section', 'layer-menu-section');
      const sourceHeading = el('span', 'layer-section-label', t('layer.sourceHeading'));
      sourceHeading.dataset.labelKey = 'layer.sourceHeading';
      const sourceHeadingRow = el('div', 'layer-section-heading-row');
      customManageButton = el('button', 'layer-custom-manage', t('layer.customManage'));
      customManageButton.type = 'button';
      customManageButton.dataset.customManage = '';
      customManageButton.dataset.labelKey = 'layer.customManage';
      customManageButton.hidden = true;
      customManageButton.addEventListener('click', (event) => {
        event.stopPropagation();
        showCustomView();
      });
      sourceHeadingRow.append(sourceHeading, customManageButton);
      sourceSection.append(sourceHeadingRow);
      providerList = el('div', 'layer-provider-list');
      providerList.setAttribute('role', 'radiogroup');
      providerList.setAttribute('aria-label', t('layer.sourceHeading'));
      sourceEmpty = el('p', 'layer-source-empty', t('layer.noMapHint'));
      sourceEmpty.dataset.labelKey = 'layer.noMapHint';
      sourceEmpty.hidden = true;
      sourceSection.append(providerList, sourceEmpty);
      mainView.append(sourceSection);
      renderProviderList();
      menu.append(mainView);

      settingsView = el('section', 'layer-settings-view');
      settingsView.hidden = true;

      const keySection = el('section', 'layer-settings-section');
      const keyRow = el('div', 'layer-key-row');
      const keyIdentity = el('div', 'layer-key-identity');
      const keyHeading = el('span', 'layer-section-label', t('layer.keyHeading'));
      keyHeading.dataset.labelKey = 'layer.keyHeading';
      keyStatus = el('span', 'layer-setting-status', t('layer.keyMissing'));
      keyStatus.dataset.configured = 'false';
      keyIdentity.append(keyHeading, keyStatus);
      const settingsActions = el('div', 'layer-key-actions');
      configureButton = el('button', 'layer-key-action');
      configureButton.type = 'button';
      setIcon(configureButton, 'plus');
      configureButton.title = t('layer.configureTiandituKey');
      configureButton.setAttribute('aria-label', configureButton.title);
      configureButton.addEventListener('click', () => onConfigureTianditu());
      settingsActions.append(configureButton);
      removeButton = el('button', 'layer-key-action danger');
      removeButton.type = 'button';
      removeButton.hidden = true;
      setIcon(removeButton, 'clear');
      removeButton.title = t('layer.removeTiandituKey');
      removeButton.setAttribute('aria-label', removeButton.title);
      removeButton.addEventListener('click', () => onRemoveTianditu());
      settingsActions.append(removeButton);
      keyRow.append(keyIdentity, settingsActions);
      keySection.append(keyRow);
      settingsView.append(keySection);

      customView = el('section', 'layer-custom-view');
      customView.hidden = true;

      // Custom sources: the plugin ships none, so this section starts empty and is filled by the user.
      const customSection = el('section', 'layer-custom-section');
      customCount = el('span', 'layer-custom-count');
      customEmpty = el('div', 'layer-custom-empty');
      const emptyIcon = el('span', 'layer-custom-empty-icon');
      emptyIcon.append(iconElement('layers', { size: 18 }));
      const emptyText = el('p', null, t('layer.customEmpty'));
      emptyText.dataset.labelKey = 'layer.customEmpty';
      customEmptyAction = el('button', 'layer-custom-empty-action', t('layer.customAdd'));
      customEmptyAction.type = 'button';
      customEmptyAction.dataset.labelKey = 'layer.customAdd';
      customEmptyAction.addEventListener('click', addCustom);
      customEmpty.append(emptyIcon, emptyText, customEmptyAction);
      customList = el('div', 'layer-custom-list');
      customList.setAttribute('role', 'radiogroup');
      customAddButton = el('button', 'layer-menu-icon-button layer-custom-add');
      customAddButton.type = 'button';
      customAddButton.dataset.customAdd = '';
      customAddButton.title = t('layer.customAdd');
      customAddButton.setAttribute('aria-label', customAddButton.title);
      setIcon(customAddButton, 'plus');
      customAddButton.addEventListener('click', addCustom);
      headerActions.insertBefore(customAddButton, closeButton);
      customAddButton.hidden = true;

      customForm = el('form', 'layer-custom-form');
      customForm.hidden = true;
      // Builds a labelled field and returns both the wrapper and the input, so callers can place the whole
      // field wherever it belongs. Returning only the input used to leave the label behind in the form.
      const buildField = (name, labelKey, type = 'text', extra = {}) => {
        const wrap = el('label', 'layer-custom-field');
        const label = el('span', null, t(labelKey));
        label.dataset.labelKey = labelKey;
        wrap.append(label);
        const input = el('input');
        input.type = type;
        input.name = name;
        for (const [key, value] of Object.entries(extra)) input.setAttribute(key, value);
        wrap.append(input);
        return { wrap, input, label };
      };
      const nameField = buildField('name', 'layer.customName', 'text', {
        maxlength: String(CUSTOM_LIMITS.maxNameLength), required: '',
      });
      const urlField = buildField('url', 'layer.customUrl', 'url', {
        maxlength: String(CUSTOM_LIMITS.maxUrlLength),
        placeholder: 'https://host/{z}/{x}/{y}.png',
        required: '',
      });
      customForm.append(nameField.wrap, urlField.wrap);
      const urlHint = el('p', 'layer-setting-note', t('layer.customUrlHint'));
      urlHint.dataset.labelKey = 'layer.customUrlHint';
      customForm.append(urlHint);

      // Live format feedback: the same validator the save button uses, so the message cannot disagree with it.
      customUrlStatus = el('p', 'layer-custom-url-status');
      customUrlStatus.dataset.customUrlStatus = '';
      customUrlStatus.hidden = true;
      customForm.append(customUrlStatus);
      const checkUrl = () => {
        const raw = urlField.input.value.trim();
        if (!raw) {
          customUrlStatus.hidden = true;
          urlField.input.removeAttribute('data-invalid');
          return null;
        }
        const result = validateTemplate(raw);
        if (result.ok) {
          customUrlStatus.hidden = true;
          urlField.input.removeAttribute('data-invalid');
          if (result.url !== raw) urlField.input.value = result.url;
          if (/(?:%40|@)2x/i.test(result.url)) {
            customForm.querySelector('[name="tileSize"][value="512"]').checked = true;
          }
          return result;
        }
        customUrlStatus.hidden = false;
        customUrlStatus.textContent = t({
          empty: 'layer.customInvalidEmpty',
          scheme: 'layer.customInvalidScheme',
          token: 'layer.customInvalidToken',
          space: 'layer.customInvalidSpace',
          syntax: 'layer.customInvalidSyntax',
        }[result.code] || 'layer.customInvalidToken');
        urlField.input.setAttribute('data-invalid', 'true');
        return result;
      };
      urlField.input.addEventListener('input', checkUrl);
      urlField.input.addEventListener('blur', checkUrl);

      const sizeWrap = el('div', 'layer-custom-field');
      sizeWrap.append(el('span', null, t('layer.customTileSize')));
      const sizeGroup = el('div', 'layer-custom-inline');
      for (const size of CUSTOM_LIMITS.tileSizes) {
        const option = el('label', 'layer-custom-radio');
        const radio = el('input');
        radio.type = 'radio';
        radio.name = 'tileSize';
        radio.value = String(size);
        radio.checked = size === 256;
        option.append(radio, el('span', null, String(size)));
        sizeGroup.append(option);
      }
      sizeWrap.append(sizeGroup);

      const zoomWrap = el('div', 'layer-custom-field');
      zoomWrap.append(el('span', null, t('layer.customZoom')));
      const zoomInline = el('div', 'layer-custom-inline');
      const minZoom = el('input');
      minZoom.type = 'number';
      minZoom.name = 'minZoom';
      minZoom.min = '0';
      minZoom.max = '22';
      minZoom.value = '1';
      const maxZoom = el('input');
      maxZoom.type = 'number';
      maxZoom.name = 'maxZoom';
      maxZoom.min = '0';
      maxZoom.max = '22';
      maxZoom.value = '19';
      zoomInline.append(minZoom, el('span', 'layer-custom-dash', '–'), maxZoom);
      zoomWrap.append(zoomInline);

      // Advanced fields collapse by default: the form has to fit a short preview window, and most sources only
      // need a name and an address.
      const advanced = el('details', 'layer-custom-advanced');
      const advancedSummary = el('summary', 'layer-custom-advanced-summary', t('layer.customAdvanced'));
      advancedSummary.dataset.labelKey = 'layer.customAdvanced';
      advanced.append(advancedSummary);
      const advancedBody = el('div', 'layer-custom-advanced-body');
      // Each advanced field keeps its own label: appending only the input left bare, unlabelled boxes behind.
      advancedBody.append(
        buildField('subdomains', 'layer.customSubdomains', 'text', {
          maxlength: '16', placeholder: t('layer.customSubdomainsHint'),
        }).wrap,
      );
      advancedBody.append(
        buildField('attribution', 'layer.customAttribution', 'text', {
          maxlength: String(CUSTOM_LIMITS.maxAttributionLength),
          placeholder: t('layer.customAttributionHint'),
        }).wrap,
      );
      const tmsWrap = el('label', 'layer-custom-field layer-custom-toggle');
      const tmsBox = el('input');
      tmsBox.type = 'checkbox';
      tmsBox.name = 'tms';
      tmsWrap.append(tmsBox, el('span', null, t('layer.customTms')));
      advancedBody.append(tmsWrap);
      advanced.append(advancedBody);
      const basics = el('div', 'layer-custom-basics');
      basics.append(sizeWrap, zoomWrap);
      customForm.append(basics, advanced);

      customError = el('p', 'layer-custom-error', '');
      customError.hidden = true;
      customError.dataset.customError = '';
      customForm.append(customError);

      const formActions = el('div', 'layer-custom-form-actions');
      const saveButton = el('button', 'layer-custom-save', t('layer.customSave'));
      saveButton.type = 'submit';
      saveButton.dataset.customSave = '';
      saveButton.dataset.labelKey = 'layer.customSave';
      const cancelButton = el('button', 'layer-custom-cancel', t('layer.customCancel'));
      cancelButton.type = 'button';
      cancelButton.dataset.labelKey = 'layer.customCancel';
      cancelButton.addEventListener('click', () => clearCustomForm());
      formActions.append(cancelButton, saveButton);
      customForm.append(formActions);
      customForm.addEventListener('submit', (event) => {
        event.preventDefault();
        submitCustomForm();
      });

      const customHelp = el('details', 'layer-custom-help');
      const customHelpTitle = el('summary', null, t('layer.customDisclaimerTitle'));
      customHelpTitle.dataset.labelKey = 'layer.customDisclaimerTitle';
      const customDisclaimer = el('p', 'layer-setting-note', t('layer.customDisclaimer'));
      customDisclaimer.dataset.labelKey = 'layer.customDisclaimer';
      customHelp.append(customHelpTitle, customDisclaimer);
      customSection.append(customEmpty, customList, customForm, customHelp);
      customView.append(customCount, customSection);
      menu.append(settingsView, customView);

      bar.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !menuOpen) return;
        event.preventDefault();
        if (settingsViewOpen || customViewOpen) backFromCurrentView();
        else closeMenu({ restoreFocus: true });
      });
      bar.append(menu);
      L.DomEvent.disableClickPropagation(bar);
      // Close on the initial map press. A text selection can begin inside the form and end over the map, which
      // produces a click on the map; that completion click must not dismiss the editor mid-drag.
      map.getContainer().addEventListener('pointerdown', (event) => {
        if (!event.target.closest('.leaflet-control')) closeMenu();
      });
      return bar;
    },
  });
  map.addControl(new Control());
  const safeInitial = PROVIDERS[initialKey].provider.requiresKey && !keyReady
    ? defaultProvider(PROVIDERS[initialKey].category)
    : initialKey;
  select(safeInitial, false);

  return {
    select,
    close: () => closeMenu(),
    resumeMap: () => select(noMapReturn || 'road.osm', true),
    setDirectKey,
    keyRejected() {
      pendingKeyProvider = null;
      directKey = '';
      keyReady = false;
      rebuildKeyedProviders();
      if (current && PROVIDERS[current].provider.requiresKey) {
        select(defaultProvider(currentCategory), true);
      }
      if (menuOpen) renderMenu();
      else relabelKeyActions();
    },
    current: () => current,
    currentCategory: () => currentCategory,
    relabel() {
      for (const [key, button] of Object.entries(categoryButtons)) {
        categoryLabels[key].textContent = t(LAYERS[key].label);
        button.title = t(LAYERS[key].title);
        button.setAttribute('aria-label', t(LAYERS[key].title));
      }
      if (menuHeading) {
        menuHeading.textContent = t(customViewOpen
          ? (customForm && !customForm.hidden
            ? (editingId ? 'layer.customEditTitle' : 'layer.customAddTitle')
            : 'layer.customHeading')
          : settingsViewOpen ? 'layer.settingsTitle' : 'layer.menuTitle');
      }
      if (backButton) {
        backButton.title = t('layer.backToLayers');
        backButton.setAttribute('aria-label', t('layer.backToLayers'));
      }
      if (settingsButton) {
        settingsButton.title = t('layer.openSettings');
        settingsButton.setAttribute('aria-label', t('layer.openSettings'));
      }
      if (closeButton) {
        closeButton.title = t('layer.closeMenu');
        closeButton.setAttribute('aria-label', t('layer.closeMenu'));
      }
      for (const [key] of Object.entries(providerButtons)) {
        providerLabels[key].label.textContent = t(PROVIDERS[key].provider.label);
      }
      for (const node of menu?.querySelectorAll('[data-label-key]') || []) {
        node.textContent = t(node.dataset.labelKey);
      }
      if (customAddButton) {
        customAddButton.title = t('layer.customAdd');
        customAddButton.setAttribute('aria-label', customAddButton.title);
      }
      if (customManageButton) {
        customManageButton.title = t('layer.customManage');
        customManageButton.setAttribute('aria-label', customManageButton.title);
      }
      if (sourceEmpty) sourceEmpty.textContent = t('layer.noMapHint');
      updateNoMapButton();
      updateMenuButton();
      relabelKeyActions();
      renderCustomList();
      if (menuOpen) renderMenu();
    },
  };
}

export function createLanguageControl({ L, map, el, t, label, toggle }) {
  let button = null;
  const Control = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const bar = el('div', 'lang-switch leaflet-bar');
      button = el('button', null, label());
      button.type = 'button';
      button.title = t('switch.title');
      button.setAttribute('aria-label', t('switch.title'));
      button.dataset.lang = 'switch';
      button.addEventListener('click', () => toggle());
      bar.append(button);
      L.DomEvent.disableClickPropagation(bar);
      return bar;
    },
  });
  map.addControl(new Control());

  return {
    relabel() {
      if (!button) return;
      button.textContent = label();
      button.title = t('switch.title');
      button.setAttribute('aria-label', t('switch.title'));
    },
  };
}

export function createLocateControl({ L, map, el, t, onLocate }) {
  let button = null;
  const Control = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const bar = el('div', 'locate-switch leaflet-bar');
      button = el('button');
      button.type = 'button';
      button.title = t('locate.title');
      button.setAttribute('aria-label', t('locate.title'));
      button.dataset.locate = 'route';
      setIcon(button, 'locate');
      button.addEventListener('click', () => onLocate());
      bar.append(button);
      L.DomEvent.disableClickPropagation(bar);
      return bar;
    },
  });
  map.addControl(new Control());

  return {
    relabel() {
      if (!button) return;
      button.title = t('locate.title');
      button.setAttribute('aria-label', t('locate.title'));
    },
  };
}
