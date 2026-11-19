// Leaflet controls. Layer definitions and tile construction live in dedicated modules.

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
import { createCustomSourceForm } from './layer-custom-form.js';

export { LAYERS, loadCustomProviders, normalizeLayer } from './layer-registry.js';

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
  let customFormView;
  let customEmpty;
  let customEmptyAction;
  let customCount;
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
    customFormView.reset();
    customForm.hidden = true;
    if (menuHeading) menuHeading.textContent = t('layer.customHeading');
    renderCustomList();
  }

  function submitCustomForm() {
    const draft = customFormView.read(editingId);
    if (!draft.name) { customFormView.showError('name'); return; }
    const checked = validateTemplate(draft.url);
    if (!checked.ok) { customFormView.showError(checked.code); return; }
    if (checked.url.includes('{s}') && !draft.subdomains) {
      customFormView.showError('subdomain');
      return;
    }
    const duplicate = customEntries.some((entry) => entry.id !== editingId
      && entry.name.toLocaleLowerCase() === draft.name.toLocaleLowerCase());
    if (duplicate) {
      customFormView.showError('duplicate');
      return;
    }

    const previousId = editingId;
    const next = customEntries.filter((entry) => entry.id !== editingId);
    const saved = normalizeEntry(draft, next.length);
    if (!saved) { customFormView.showError('token'); return; }
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
    customFormView.setEntry(entry);
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

      customFormView = createCustomSourceForm({
        el,
        t,
        onCancel: () => clearCustomForm(),
        onSubmit: () => submitCustomForm(),
      });
      customForm = customFormView.form;

      customSection.append(customEmpty, customList, customForm);
      customView.append(customCount, customSection);
      menu.append(settingsView, customView);

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
    destroy() {
      lifecycle.abort();
      closeMenu();
      menu?.remove();
    },
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
