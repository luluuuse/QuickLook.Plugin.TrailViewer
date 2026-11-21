// Leaflet controls. Layer definitions and tile construction live in dedicated modules.

import { readStored, writeStored } from './storage.js';
import { setIcon } from './icons.js';
import { loadCustomLayers } from './custom-layers.js';
import {
  CATEGORY_ICONS,
  LAYERS,
  LAYER_KEY,
  PROVIDERS,
  defaultProvider,
  normalizeLayer,
  registerCustomProvider,
  unregisterCustomProvider,
} from './layer-registry.js';
import { createProviderLayer } from './layer-providers.js';
import { createLayerSettingsView } from './layer-settings-view.js';
import { createCustomSourceManager } from './layer-custom-manager.js';
import {
  relabelLayerSwitcher,
  openLayerMenu,
  renderLayerMenu,
  renderTileCacheSettings,
  updateChoiceButtons,
  updateMenuButton as renderMenuButton,
  updateNoMapButton as renderNoMapButton,
} from './layer-menu-render.js';
import { applyLayerSelection } from './layer-selection.js';
import {
  activatePendingProvider as activatePendingKeyProvider,
  rebuildKeyedProviders as rebuildKeyedLayerProviders,
  relabelKeyActions as relabelLayerKeyActions,
  toggleNoMap as toggleNoMapLayer,
  updateDirectKey,
} from './layer-key-controls.js';

export { LAYERS, loadCustomProviders, normalizeLayer } from './layer-registry.js';

export function savedLayer(params) {
  const fromHost = normalizeLayer(params.get('layer'));
  if (fromHost) return fromHost;
  return normalizeLayer(readStored(LAYER_KEY)) || 'road.osm';
}

const TILE_CACHE_LIMITS = [256, 512, 2048, 0];
const TILE_CACHE_DAYS = [0, 7, 30, 90];

function parseAllowedNumber(value, allowed) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && allowed.includes(numeric) ? numeric : null;
}

export function savedTileCache(params, hosted = null) {
  const hostedEnabled = typeof hosted?.enabled === 'boolean' ? hosted.enabled : null;
  const hostedMb = parseAllowedNumber(hosted?.maxMb, TILE_CACHE_LIMITS);
  const hostedDays = parseAllowedNumber(hosted?.maxAgeDays, TILE_CACHE_DAYS);
  const paramEnabled = params?.get('tileCache');
  const paramMb = parseAllowedNumber(params?.get('tileCacheMaxMb'), TILE_CACHE_LIMITS);
  const paramDays = parseAllowedNumber(params?.get('tileCacheDays'), TILE_CACHE_DAYS);
  const storedEnabled = readStored('tileCache');
  const storedMb = parseAllowedNumber(readStored('tileCacheMaxMb'), TILE_CACHE_LIMITS);
  const storedDays = parseAllowedNumber(readStored('tileCacheDays'), TILE_CACHE_DAYS);

  const enabled = hostedEnabled !== null
    ? hostedEnabled
    : paramEnabled === '0' || paramEnabled === '1'
      ? paramEnabled !== '0'
      : storedEnabled === '0' || storedEnabled === '1'
        ? storedEnabled !== '0'
        : true;
  const maxMb = hostedMb ?? paramMb ?? storedMb ?? 512;
  const maxAgeDays = hostedDays ?? paramDays ?? storedDays ?? 30;
  return { enabled, maxMb, maxAgeDays };
}

export function createLayerSwitcher({
  L, map, el, t, initial, onRemember, tiandituDirectKey = '',
  onConfigureTianditu = () => {}, onRemoveTianditu = () => {},
  onTiandituDirectError = () => {}, onCustomError = () => {},
  onOpen = () => {}, onCustomSave, customSources = null,
  hasHost = false, tileCacheConfig = null,
  onTileCacheChange = () => {}, onRequestTileCacheStats = () => {}, onClearTileCache = () => {},
}) {
  const lifecycle = new AbortController();
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
  let categoryKey;
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
  let tileCacheUi = null;
  let settingsViewOpen = false;
  let customView;
  let customViewOpen = false;
  let noMapReturn = 'road.osm';
  const tileCacheState = {
    enabled: tileCacheConfig?.enabled ?? true,
    maxMb: parseAllowedNumber(tileCacheConfig?.maxMb, TILE_CACHE_LIMITS) ?? 512,
    maxAgeDays: parseAllowedNumber(tileCacheConfig?.maxAgeDays, TILE_CACHE_DAYS) ?? 30,
    stats: { totalBytes: 0, tileCount: 0 },
    statsLoaded: false,
    clearArmed: false,
  };
  function renderTileCache() {
    if (!tileCacheUi) return;
    renderTileCacheSettings({ ...tileCacheUi, state: tileCacheState, hasHost, t });
  }
  function persistTileCacheSettings() {
    writeStored('tileCache', tileCacheState.enabled ? '1' : '0');
    writeStored('tileCacheMaxMb', String(tileCacheState.maxMb));
    writeStored('tileCacheDays', String(tileCacheState.maxAgeDays));
    onTileCacheChange?.();
  }
  const customManager = createCustomSourceManager({
    L,
    el,
    t,
    map,
    LAYERS,
    PROVIDERS,
    layers,
    initialEntries: customSources || loadCustomLayers(readStored),
    registerProvider: registerCustomProvider,
    unregisterProvider: unregisterCustomProvider,
    getCurrent: () => current,
    getCurrentCategory: () => currentCategory,
    getNoMapReturn: () => noMapReturn,
    setNoMapReturn: (value) => { noMapReturn = value; },
    select,
    renderMenu,
    getMenuOpen: () => menuOpen,
    updateMenuButton,
    showCustomView,
    onCustomSave,
    onCustomError,
  });
  function updateMenuButton() {
    menuIcon = renderMenuButton({
      menuToggle, menuLabel, menuIcon, current, currentCategory,
      providers: PROVIDERS, layers: LAYERS, categoryIcons: CATEGORY_ICONS, t,
    });
  }
  function select(value, remember, { keepMenu = false, restoreFocus = false } = {}) {
    const result = applyLayerSelection({
      value, remember, keepMenu, restoreFocus, current, lastProvider,
      layers, allLayers: LAYERS, providers: PROVIDERS, keyReady,
      normalizeLayer, defaultProvider, activeKey: LAYER_KEY, map,
      ensureCustomLayer: customManager.ensureLayer, menuOpen,
      openMenu, showSettings, closeMenu,
      setPendingKeyProvider: (key) => { pendingKeyProvider = key; },
      setNoMapReturn: (key) => { noMapReturn = key; },
    });
    if (!result) return false;
    current = result.key;
    currentCategory = result.category;
    if (remember) onRemember?.(result.key);
    updateChoiceButtons({ categoryButtons, providerButtons, providerLabels, currentCategory, current });
    updateMenuButton();
    renderNoMapButton({ noMapButton, current, t });
    if (result.keepMenu) renderMenu();
    return true;
  }
  function closeMenu({ restoreFocus = false } = {}) {
    if (!menu || !menuOpen) return;
    menuOpen = false;
    settingsViewOpen = false;
    customViewOpen = false;
    tileCacheState.clearArmed = false;
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
    tileCacheState.clearArmed = false;
    mainView.hidden = true;
    settingsView.hidden = false;
    if (customView) customView.hidden = true;
    backButton.hidden = false;
    settingsButton.hidden = true;
    menuHeading.textContent = t('layer.settingsTitle');
    renderMenu();
    if (hasHost) onRequestTileCacheStats?.();
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
    customManager.renderList();
    if (focus) customManager.focusAdd();
  }

  function backFromCurrentView() {
    tileCacheState.clearArmed = false;
    if (customViewOpen) {
      if (customManager.isEditing()) {
        customManager.clearForm();
        customManager.focusAdd();
      } else {
        showLayers({ focus: true });
      }
      return;
    }
    showLayers({ focusSettings: true });
  }

  function renderMenu() {
    if (!menu) return;
    renderLayerMenu({
      currentCategory, keyReady, providers: PROVIDERS, providerButtons, providerList,
      sourceEmpty, sourceSection, customManageButton: customManager.manageButton(),
      customEntryCount: customManager.entries().length, keyStatus, removeButton,
      relabelKeyActions,
      updateChoiceButtons: () => updateChoiceButtons({
        categoryButtons, providerButtons, providerLabels, currentCategory, current,
      }),
      renderCustomList: customManager.renderList,
      t,
    });
    renderTileCache();
  }

  function openMenu({ focus = true } = {}) {
    openLayerMenu({
      menu, onOpen, setMenuOpen: (value) => { menuOpen = value; }, menuToggle,
      currentCategory, customEntryCount: customManager.entries().length,
      showCustomView, showLayers, focus,
    });
  }

  function relabelKeyActions() {
    relabelLayerKeyActions({ configureButton, removeButton, keyReady, t });
  }

  function rebuildKeyedProviders() {
    rebuildKeyedLayerProviders({
      keyedProviders, layers, current, map, L, directKey,
      onDirectError: onTiandituDirectError, createProviderLayer,
    });
  }

  function activatePendingProvider() {
    activatePendingKeyProvider({
      pendingKeyProvider, keyReady, select, clearPending: () => { pendingKeyProvider = null; },
    });
  }

  function setDirectKey(key) {
    updateDirectKey({
      key,
      setDirectKey: (value) => { directKey = value; },
      setKeyReady: (value) => { keyReady = value; },
      rebuild: rebuildKeyedProviders,
      current, providers: PROVIDERS, currentCategory, select, defaultProvider,
      activatePending: activatePendingProvider, menuOpen: () => menuOpen,
      renderMenu, relabelActions: relabelKeyActions,
    });
  }

  const Control = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const view = createLayerSettingsView({
        el,
        t,
        layers: LAYERS,
        categoryIcons: CATEGORY_ICONS,
        onToggle: () => {
          if (menuOpen) closeMenu({ restoreFocus: true });
          else openMenu();
        },
        onBack: backFromCurrentView,
        onSettings: () => showSettings(),
        onNoMap: () => toggleNoMapLayer({
          enabled: current !== 'none',
          current,
          noMapReturn,
          select,
          setNoMapReturn: (value) => { noMapReturn = value; },
        }),
        onClose: () => closeMenu({ restoreFocus: true }),
        onCategory: (category) => {
          if (category === 'custom' && customManager.entries().length === 0) {
            showCustomView();
            return;
          }
          select(category, true, { keepMenu: true });
        },
        onCustomManage: () => showCustomView(),
        onCustomAdd: () => customManager.add(),
        onClearCustom: () => customManager.clearForm(),
        onSubmitCustom: () => customManager.submit(),
        onConfigureTianditu: () => onConfigureTianditu(),
        onRemoveTianditu: () => onRemoveTianditu(),
        onToggleTileCache: () => {
          tileCacheState.enabled = !tileCacheState.enabled;
          tileCacheState.clearArmed = false;
          persistTileCacheSettings();
          renderTileCache();
        },
        onSelectTileCacheMaxMb: (mb) => {
          if (!TILE_CACHE_LIMITS.includes(mb) || tileCacheState.maxMb === mb) return;
          tileCacheState.maxMb = mb;
          tileCacheState.clearArmed = false;
          persistTileCacheSettings();
          renderTileCache();
        },
        onSelectTileCacheDays: (days) => {
          if (!TILE_CACHE_DAYS.includes(days) || tileCacheState.maxAgeDays === days) return;
          tileCacheState.maxAgeDays = days;
          tileCacheState.clearArmed = false;
          persistTileCacheSettings();
          renderTileCache();
        },
        onClearTileCache: () => {
          if (!hasHost) {
            onClearTileCache?.();
            return;
          }
          if (!tileCacheState.clearArmed) {
            tileCacheState.clearArmed = true;
            renderTileCache();
            return;
          }
          tileCacheState.clearArmed = false;
          renderTileCache();
          onClearTileCache?.();
        },
      });
      const bar = view.bar;
      menuToggle = view.menuToggle;
      menuIcon = view.menuIcon;
      menuLabel = view.menuLabel;
      menu = view.menu;
      mainView = view.mainView;
      settingsView = view.settingsView;
      customView = view.customView;
      menuHeading = view.menuHeading;
      backButton = view.backButton;
      settingsButton = view.settingsButton;
      closeButton = view.closeButton;
      noMapButton = view.noMapButton;
      categoryKey = view.categoryKey;
      Object.assign(categoryButtons, view.categoryButtons);
      Object.assign(categoryLabels, view.categoryLabels);
      sourceSection = view.sourceSection;
      sourceEmpty = view.sourceEmpty;
      providerList = view.providerList;
      configureButton = view.configureButton;
      removeButton = view.removeButton;
      keyStatus = view.keyStatus;
      tileCacheUi = {
        tileCacheToggle: view.tileCacheToggle,
        tileCacheOptions: view.tileCacheOptions,
        tileCacheLimitButtons: view.tileCacheLimitButtons,
        tileCacheDaysButtons: view.tileCacheDaysButtons,
        tileCacheStatus: view.tileCacheStatus,
        tileCacheClearButton: view.tileCacheClearButton,
        tileCacheClearLabel: view.tileCacheClearLabel,
      };
      renderTileCache();
      customManager.bind({
        formView: view.customFormView,
        form: view.customForm.form,
        list: view.customList,
        empty: view.customEmpty,
        count: view.customCount,
        addButton: view.customAddButton,
        manageButton: view.customManageButton,
        menuHeading,
        providerList,
        providerButtons,
        providerLabels,
        customViewOpen: () => customViewOpen,
      });
      bar.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !menuOpen) return;
        event.preventDefault();
        if (settingsViewOpen || customViewOpen) backFromCurrentView();
        else closeMenu({ restoreFocus: true });
      }, { signal: lifecycle.signal });
      bar.append(menu);
      L.DomEvent.disableClickPropagation(bar);
      // Close on the initial map press. A text selection can begin inside the form and end over the map, which
      // produces a click on the map; that completion click must not dismiss the editor mid-drag.
      map.getContainer().addEventListener('pointerdown', (event) => {
        if (!event.target.closest('.leaflet-control')) closeMenu();
      }, { signal: lifecycle.signal });
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
    toggle: () => (menuOpen ? closeMenu() : openMenu({ focus: false })),
    isOpen: () => menuOpen,
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
    setTileCacheStats(totalBytes, tileCount) {
      tileCacheState.stats = {
        totalBytes: Math.max(0, Number(totalBytes) || 0),
        tileCount: Math.max(0, Math.round(Number(tileCount) || 0)),
      };
      tileCacheState.statsLoaded = true;
      tileCacheState.clearArmed = false;
      renderTileCache();
    },
    tileCacheSettings: () => ({
      enabled: tileCacheState.enabled,
      maxMb: tileCacheState.maxMb,
      maxAgeDays: tileCacheState.maxAgeDays,
      stats: { ...tileCacheState.stats },
      statsLoaded: tileCacheState.statsLoaded,
      clearArmed: tileCacheState.clearArmed,
    }),
    destroy() {
      lifecycle.abort();
      closeMenu();
      menu?.remove();
    },
    relabel() {
      relabelLayerSwitcher({
        categoryButtons, categoryLabels, layers: LAYERS, t, menuHeading, customViewOpen,
        customManager, settingsViewOpen, backButton, settingsButton, closeButton,
        providerButtons, providerLabels, providers: PROVIDERS, menu, sourceEmpty, categoryKey,
        updateNoMapButton: () => renderNoMapButton({ noMapButton, current, t }),
        updateMenuButton, relabelKeyActions, renderTileCache, renderMenu,
      });
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
