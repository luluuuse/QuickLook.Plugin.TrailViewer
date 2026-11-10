// Leaflet controls and layer definitions. Dependencies are injected so this module does not reach into the map
// application's globals.

import { readStored, writeStored } from './storage.js';

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
  none: {
    label: 'layer.none',
    short: 'layer.shortNone',
    title: 'layer.noneTitle',
    providers: {
      none: { key: 'none', label: 'layer.none' },
    },
  },
};

const LAYER_KEY = 'layer';
const LEGACY_LAYERS = {
  map: 'road.osm',
  terrain: 'terrain.cyclosm',
  satellite: 'satellite.esri',
  none: 'none',
};

const PROVIDERS = Object.fromEntries(Object.entries(LAYERS).flatMap(([category, definition]) =>
  Object.values(definition.providers).map((provider) => [provider.key, { category, provider }])));

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
  onTiandituDirectError = () => {},
}) {
  let directKey = tiandituDirectKey;
  let keyReady = Boolean(directKey);
  const layers = {};
  const keyedProviders = Object.entries(PROVIDERS)
    .filter(([, entry]) => entry.provider.requiresKey === 'tianditu');
  for (const definition of Object.values(LAYERS)) {
    for (const provider of Object.values(definition.providers)) {
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
  const providerButtons = {};
  const lastProvider = {};
  for (const category of Object.keys(LAYERS)) lastProvider[category] = defaultProvider(category);
  let menuToggle;
  let menuLabel;
  let menu;
  let mainView;
  let settingsView;
  let menuHeading;
  let backButton;
  let settingsButton;
  let closeButton;
  let keyStatus;
  let keyScope;
  let sourceEmpty;
  let providerList;
  let configureButton;
  let removeButton;
  let settingsViewOpen = false;

  function updateMenuButton() {
    if (!menuToggle || !menuLabel || !current || !currentCategory) return;
    const providerLabel = t(PROVIDERS[current].provider.label);
    menuLabel.textContent = t(LAYERS[currentCategory].label);
    menuToggle.dataset.short = t(LAYERS[currentCategory].short);
    menuToggle.dataset.category = currentCategory;
    const description = `${t('layer.menuTitle')} · ${providerLabel} · ${t(LAYERS[currentCategory].title)}`;
    menuToggle.title = description;
    menuToggle.setAttribute('aria-label', description);
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
    }
  }

  function select(value, remember, { keepMenu = false, restoreFocus = false } = {}) {
    const category = typeof value === 'string' && value in LAYERS ? value : null;
    const key = category ? (lastProvider[category] || defaultProvider(category)) : normalizeLayer(value);
    if (!key) return;
    const target = PROVIDERS[key];
    if (target.provider.requiresKey && !keyReady) {
      pendingKeyProvider = key;
      openMenu({ focus: false });
      showSettings({ focus: true });
      return false;
    }
    const changed = key !== current;
    if (changed) {
      if (current) map.removeLayer(layers[current]);
      layers[key].addTo(map);
      document.body.classList.toggle('no-map', key === 'none');
    }
    current = key;
    currentCategory = target.category;
    lastProvider[currentCategory] = key;
    updateChoices();
    updateMenuButton();
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
    menu.hidden = true;
    menuToggle?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) menuToggle?.focus({ preventScroll: true });
  }

  function showLayers({ focus = true, focusSettings = false } = {}) {
    if (!mainView || !settingsView) return;
    settingsViewOpen = false;
    mainView.hidden = false;
    settingsView.hidden = true;
    backButton.hidden = true;
    settingsButton.hidden = false;
    menuHeading.textContent = t('layer.menuTitle');
    renderMenu();
    if (focus) {
      (focusSettings ? settingsButton : categoryButtons[currentCategory])?.focus({ preventScroll: true });
    }
  }

  function showSettings({ focus = true } = {}) {
    if (!mainView || !settingsView) return;
    settingsViewOpen = true;
    mainView.hidden = true;
    settingsView.hidden = false;
    backButton.hidden = false;
    settingsButton.hidden = true;
    menuHeading.textContent = t('layer.settingsTitle');
    renderMenu();
    if (focus) configureButton?.focus({ preventScroll: true });
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
    if (keyStatus) {
      keyStatus.textContent = t(keyReady ? 'layer.keyConfigured' : 'layer.keyMissing');
      keyStatus.dataset.configured = String(keyReady);
    }
    if (keyScope) keyScope.textContent = t('layer.keyScope');
    if (removeButton) removeButton.hidden = !keyReady;
    relabelKeyActions();
  }

  function openMenu({ focus = true } = {}) {
    if (!menu) return;
    menuOpen = true;
    menu.hidden = false;
    menuToggle?.setAttribute('aria-expanded', 'true');
    showLayers({ focus });
  }

  function relabelKeyActions() {
    if (configureButton) {
      configureButton.textContent = t(keyReady
        ? 'layer.changeTiandituKey' : 'layer.configureTiandituKey');
    }
    if (removeButton) removeButton.textContent = t('layer.removeTiandituKey');
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
      menuToggle.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">'
        + '<path d="M8 1.8l6 3.1-6 3.1-6-3.1 6-3.1zM2 8l6 3.1L14 8M2 11.2l6 3.1 6-3.1"'
        + ' fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"'
        + ' stroke-linecap="round"/></svg>';
      menuLabel = el('span', 'layer-menu-label');
      menuToggle.append(menuLabel);
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
      backButton = el('button', 'layer-menu-icon-button layer-menu-back', '‹');
      backButton.type = 'button';
      backButton.hidden = true;
      backButton.title = t('layer.backToLayers');
      backButton.setAttribute('aria-label', t('layer.backToLayers'));
      backButton.addEventListener('click', () => showLayers({ focusSettings: true }));
      menuHeading = el('strong', 'layer-source-heading', t('layer.menuTitle'));
      menuHeading.id = headingId;
      const headerActions = el('div', 'layer-menu-header-actions');
      settingsButton = el('button', 'layer-menu-icon-button layer-settings-button');
      settingsButton.type = 'button';
      settingsButton.title = t('layer.openSettings');
      settingsButton.setAttribute('aria-label', t('layer.openSettings'));
      settingsButton.innerHTML = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">'
        + '<circle cx="8" cy="8" r="2.25" fill="none" stroke="currentColor" stroke-width="1.4"/>'
        + '<path d="M8 1.4v1.8M8 12.8v1.8M1.4 8h1.8M12.8 8h1.8M3.35 3.35l1.27 1.27'
        + 'M11.38 11.38l1.27 1.27M12.65 3.35l-1.27 1.27M4.62 11.38l-1.27 1.27"'
        + ' fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>';
      settingsButton.addEventListener('click', () => showSettings());
      closeButton = el('button', 'layer-menu-icon-button layer-menu-close', '×');
      closeButton.type = 'button';
      closeButton.title = t('layer.closeMenu');
      closeButton.setAttribute('aria-label', t('layer.closeMenu'));
      closeButton.addEventListener('click', () => closeMenu({ restoreFocus: true }));
      headerActions.append(settingsButton, closeButton);
      header.append(backButton, menuHeading, headerActions);
      menu.append(header);

      mainView = el('div', 'layer-main-view');

      const typeSection = el('section', 'layer-menu-section');
      typeSection.append(el('span', 'layer-section-label', t('layer.typeHeading')));
      const categoryGrid = el('div', 'layer-category-grid');
      categoryGrid.setAttribute('role', 'radiogroup');
      categoryGrid.setAttribute('aria-label', t('layer.typeHeading'));
      for (const [category, definition] of Object.entries(LAYERS)) {
        const button = el('button', 'layer-category-button', t(definition.label));
        button.type = 'button';
        button.setAttribute('role', 'radio');
        button.setAttribute('aria-checked', 'false');
        button.setAttribute('aria-label', t(definition.title));
        button.dataset.layer = category;
        button.addEventListener('click', () => select(category, true, { keepMenu: true }));
        categoryButtons[category] = button;
        categoryGrid.append(button);
      }
      typeSection.append(categoryGrid);
      mainView.append(typeSection);

      const sourceSection = el('section', 'layer-menu-section');
      sourceSection.append(el('span', 'layer-section-label', t('layer.sourceHeading')));
      providerList = el('div', 'layer-provider-list');
      providerList.setAttribute('role', 'radiogroup');
      providerList.setAttribute('aria-label', t('layer.sourceHeading'));
      for (const [category, definition] of Object.entries(LAYERS)) {
        for (const provider of Object.values(definition.providers)) {
          const button = el('button', 'layer-provider-option', t(provider.label));
          button.type = 'button';
          button.setAttribute('role', 'radio');
          button.dataset.provider = provider.key;
          button.dataset.category = category;
          button.setAttribute('aria-checked', 'false');
          button.hidden = true;
          button.addEventListener('click', () => select(provider.key, true, { restoreFocus: true }));
          providerButtons[provider.key] = button;
          providerList.append(button);
        }
      }
      sourceEmpty = el('p', 'layer-source-empty', t('layer.noMapHint'));
      sourceEmpty.hidden = true;
      sourceSection.append(providerList, sourceEmpty);
      mainView.append(sourceSection);
      menu.append(mainView);

      settingsView = el('section', 'layer-settings-view');
      settingsView.hidden = true;
      settingsView.append(el('span', 'layer-section-label', t('layer.keyHeading')));
      keyStatus = el('p', 'layer-setting-status', t('layer.keyMissing'));
      keyScope = el('p', 'layer-setting-note', t('layer.keyScope'));
      const settingsActions = el('div', 'layer-settings-actions');
      configureButton = el('button', 'layer-key-action');
      configureButton.type = 'button';
      configureButton.addEventListener('click', () => onConfigureTianditu());
      settingsActions.append(configureButton);
      removeButton = el('button', 'layer-key-action danger');
      removeButton.type = 'button';
      removeButton.hidden = true;
      removeButton.addEventListener('click', () => onRemoveTianditu());
      settingsActions.append(removeButton);
      settingsView.append(keyStatus, keyScope, settingsActions);
      menu.append(settingsView);

      bar.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !menuOpen) return;
        event.preventDefault();
        if (settingsViewOpen) showLayers({ focusSettings: true });
        else closeMenu({ restoreFocus: true });
      });
      bar.append(menu);
      L.DomEvent.disableClickPropagation(bar);
      map.on('click', () => closeMenu());
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
        button.textContent = t(LAYERS[key].label);
      }
      if (menuHeading) menuHeading.textContent = t(settingsViewOpen
        ? 'layer.settingsTitle' : 'layer.menuTitle');
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
      for (const [key, button] of Object.entries(providerButtons)) {
        button.textContent = t(PROVIDERS[key].provider.label);
      }
      const labels = menu?.querySelectorAll('.layer-section-label');
      if (labels?.[0]) labels[0].textContent = t('layer.typeHeading');
      if (labels?.[1]) labels[1].textContent = t('layer.sourceHeading');
      if (labels?.[2]) labels[2].textContent = t('layer.keyHeading');
      if (sourceEmpty) sourceEmpty.textContent = t('layer.noMapHint');
      updateMenuButton();
      relabelKeyActions();
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
      button.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">'
        + '<circle cx="8" cy="8" r="4.2" fill="none" stroke="currentColor" stroke-width="1.6"/>'
        + '<path d="M8 0.9v3.2M8 11.9v3.2M0.9 8h3.2M11.9 8h3.2" fill="none" stroke="currentColor"'
        + ' stroke-width="1.6" stroke-linecap="round"/></svg>';
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

export function createExportControl({ L, map, el, t, onExport }) {
  let button = null;
  const Control = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const bar = el('div', 'export-switch leaflet-bar');
      button = el('button');
      button.type = 'button';
      button.title = t('export.title');
      button.setAttribute('aria-label', t('export.title'));
      button.dataset.export = 'overlay';
      button.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">'
        + '<rect x="1.6" y="3.1" width="12.8" height="9.8" rx="1.6" fill="none" stroke="currentColor"'
        + ' stroke-width="1.5"/><path d="M2.8 10.9l3.1-3.2 2.1 2.1 2.9-3 2.3 2.4" fill="none"'
        + ' stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>'
        + '<circle cx="11.1" cy="5.9" r="1.05" fill="currentColor"/></svg>';
      button.addEventListener('click', () => onExport());
      bar.append(button);
      L.DomEvent.disableClickPropagation(bar);
      return bar;
    },
  });
  map.addControl(new Control());

  return {
    relabel() {
      if (!button) return;
      button.title = t('export.title');
      button.setAttribute('aria-label', t('export.title'));
    },
  };
}
