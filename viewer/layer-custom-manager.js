import { CUSTOM_LIMITS, createCustomLayer, normalizeEntry, saveCustomLayers } from './custom-layers.js';
import { iconElement, setIcon } from './icons.js';
import { writeStored } from './storage.js';

/** Owns custom-source entries, form state, persistence and status rendering. */
export function createCustomSourceManager({
  L, el, t, map, LAYERS, PROVIDERS, layers, initialEntries,
  registerProvider, unregisterProvider, getCurrent, getCurrentCategory,
  getNoMapReturn, setNoMapReturn, select, renderMenu, getMenuOpen,
  updateMenuButton, showCustomView, onCustomSave, onCustomError,
}) {
  let entries = initialEntries || [];
  const errors = new Set();
  const states = new Map();
  let editingId = null;
  let pendingDelete = null;
  let ui = null;

  function bind(next) {
    ui = next;
    refreshProviders();
    renderProviderList();
    renderList();
  }

  // The switcher injects this as a getter, but a plain boolean is also accepted so the manager never reads a
  // function object as truthy: that turned every "only inside the custom page" control permanently visible.
  function inCustomView() {
    const value = ui?.customViewOpen;
    return typeof value === 'function' ? Boolean(value()) : Boolean(value);
  }

  function refreshProviders() {
    for (const id of Object.keys(LAYERS.custom.providers)) unregisterProvider(id);
    for (const entry of entries) registerProvider(entry);
  }

  function providerLayer(entry) {
    const layer = createCustomLayer(L, entry);
    let warned = false;
    let loadedTiles = 0;
    let failedTiles = 0;
    const setState = (state) => {
      if (states.get(entry.id) === state) return;
      states.set(entry.id, state);
      renderList();
    };
    setState('loading');
    layer.on('tileerror', () => {
      failedTiles += 1;
      errors.add(entry.id);
      setState(loadedTiles > 0 ? 'limited' : 'error');
      renderList();
      renderMenu();
      if (!warned) {
        warned = true;
        onCustomError();
      }
    });
    layer.on('tileload', () => {
      loadedTiles += 1;
      errors.delete(entry.id);
      setState(failedTiles > 0 ? 'limited' : 'ready');
      renderList();
      renderMenu();
    });
    return layer;
  }

  function ensureLayer(id) {
    const entry = LAYERS.custom.providers[id]?.custom;
    if (!entry) return null;
    if (!layers[id]) layers[id] = providerLayer(entry);
    return layers[id];
  }

  function persist(previousId = null) {
    const current = getCurrent();
    const wasCurrent = Boolean(previousId && current === previousId);
    if (wasCurrent) map.removeLayer(layers[previousId]);
    errors.delete(previousId);
    states.delete(previousId);
    entries = saveCustomLayers(writeStored, entries);
    onCustomSave?.(entries);
    refreshProviders();
    renderProviderList();
    if (wasCurrent && PROVIDERS[current]) {
      delete layers[current];
      ensureLayer(current).addTo(map);
      updateMenuButton();
    }
    if (getCurrentCategory() === 'custom' && !PROVIDERS[current]) {
      select('road.osm', true);
    }
    renderMenu();
  }

  function clearForm() {
    editingId = null;
    if (!ui?.form) return;
    ui.formView.reset();
    ui.form.hidden = true;
    if (ui.menuHeading) ui.menuHeading.textContent = t('layer.customHeading');
    renderList();
  }

  function submit() {
    const draft = ui.formView.read(editingId);
    if (!draft.name) { ui.formView.showError('name'); return; }
    const checked = ui.formView.check();
    if (!checked.ok) { ui.formView.showError(checked.code); return; }
    if (checked.url.includes('{s}') && !draft.subdomains) {
      ui.formView.showError('subdomain');
      return;
    }
    const duplicate = entries.some((entry) => entry.id !== editingId
      && entry.name.toLocaleLowerCase() === draft.name.toLocaleLowerCase());
    if (duplicate) {
      ui.formView.showError('duplicate');
      return;
    }
    const previousId = editingId;
    const next = entries.filter((entry) => entry.id !== editingId);
    const saved = normalizeEntry(draft, next.length);
    if (!saved) { ui.formView.showError('token'); return; }
    next.push(saved);
    entries = next;
    persist(previousId);
    clearForm();
    select(saved.id, true, { keepMenu: true });
    showCustomView({ focus: false });
    ui.addButton?.focus({ preventScroll: true });
  }

  function edit(id) {
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry || !ui?.form) return;
    pendingDelete = null;
    editingId = id;
    ui.formView.setEntry(entry);
    openForm();
  }

  function remove(id) {
    const current = getCurrent();
    const wasCurrent = current === id;
    const remaining = entries.filter((entry) => entry.id !== id);
    if (wasCurrent) {
      if (getNoMapReturn() === id) setNoMapReturn(remaining[0]?.id || 'road.osm');
      select(remaining[0]?.id || 'road.osm', true);
    }
    delete layers[id];
    errors.delete(id);
    states.delete(id);
    if (pendingDelete === id) pendingDelete = null;
    entries = remaining;
    persist();
    renderList();
    if (getMenuOpen()) renderMenu();
  }

  function renderProviderList() {
    if (!ui?.providerList) return;
    for (const key of Object.keys(ui.providerButtons)) delete ui.providerButtons[key];
    for (const key of Object.keys(ui.providerLabels)) delete ui.providerLabels[key];
    ui.providerList.replaceChildren();
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
        ui.providerButtons[provider.key] = button;
        ui.providerLabels[provider.key] = { check, label };
        ui.providerList.append(button);
      }
    }
  }

  function add() {
    editingId = null;
    pendingDelete = null;
    clearForm();
    // The add button is also reachable from the layer list. Opening the form there used to leave it inside the
    // hidden custom page: the click looked dead because nothing visible changed.
    if (!inCustomView()) showCustomView({ focus: false });
    openForm();
  }

  function openForm() {
    if (!ui?.form) return;
    ui.form.hidden = false;
    ui.form.querySelector('.layer-custom-advanced')?.removeAttribute('open');
    ui.list.hidden = true;
    ui.empty.hidden = true;
    ui.addButton.hidden = true;
    ui.count.hidden = true;
    if (ui.menuHeading) {
      ui.menuHeading.textContent = t(editingId
        ? 'layer.customEditTitle' : 'layer.customAddTitle');
    }
    ui.formView.focusName();
    ui.form.scrollIntoView({ block: 'nearest' });
  }

  function renderList() {
    if (!ui?.list) return;
    const current = getCurrent();
    const editing = Boolean(ui.form && !ui.form.hidden);
    const customPage = inCustomView();
    ui.list.hidden = editing;
    ui.addButton.hidden = !customPage || editing;
    ui.empty.hidden = editing || entries.length > 0;
    ui.count.hidden = editing || !customPage;
    ui.count.textContent = `${entries.length}/${CUSTOM_LIMITS.maxEntries}`;
    // The manage link belongs to the source list heading, so it follows the same rule as the rest of that list:
    // only in the Custom category, and not while the management page is already open.
    ui.manageButton.hidden = getCurrentCategory() !== 'custom' || customPage || entries.length === 0;
    ui.list.replaceChildren();
    for (const entry of entries) {
      const state = states.get(entry.id) || '';
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
        renderList();
      });
      const actions = el('div', 'layer-custom-actions');
      const editButton = el('button', 'layer-custom-action');
      editButton.type = 'button';
      editButton.dataset.customEdit = entry.id;
      setIcon(editButton, 'edit', { size: 12 });
      editButton.title = t('layer.customEdit');
      editButton.setAttribute('aria-label', editButton.title);
      editButton.addEventListener('click', () => edit(entry.id));
      const removeButton = el('button', `layer-custom-action danger${pendingDelete === entry.id ? ' confirm' : ''}`);
      removeButton.type = 'button';
      removeButton.dataset.customRemove = entry.id;
      setIcon(removeButton, pendingDelete === entry.id ? 'check' : 'clear', { size: 12 });
      removeButton.title = t(pendingDelete === entry.id
        ? 'layer.customRemoveConfirm' : 'layer.customRemove');
      removeButton.setAttribute('aria-label', removeButton.title);
      removeButton.addEventListener('click', (event) => {
        event.stopPropagation();
        if (pendingDelete !== entry.id) {
          pendingDelete = entry.id;
          renderList();
          return;
        }
        remove(entry.id);
      });
      actions.append(editButton, removeButton);
      row.append(choose, actions);
      ui.list.append(row);
    }
  }

  function relabel() {
    renderList();
  }

  return {
    bind,
    refreshProviders,
    entries: () => entries,
    providerLayer,
    ensureLayer,
    persist,
    clearForm,
    submit,
    edit,
    remove,
    renderProviderList,
    add,
    renderList,
    relabel,
    isEditing: () => Boolean(ui?.form && !ui.form.hidden),
    headingKey: () => editingId ? 'layer.customEditTitle' : 'layer.customAddTitle',
    focusAdd: () => ui?.addButton?.focus({ preventScroll: true }),
    addButton: () => ui?.addButton,
    manageButton: () => ui?.manageButton,
  };
}
