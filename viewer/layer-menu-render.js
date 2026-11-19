import { iconElement } from './icons.js';

/** Updates that depend only on the current layers and menu controls. */
export function updateMenuButton({
  menuToggle, menuLabel, menuIcon, current, currentCategory, providers, layers, categoryIcons, t,
}) {
  if (!menuToggle || !menuLabel || !current || !currentCategory) return menuIcon;
  const category = providers[current].category;
  const providerLabel = t(providers[current].provider.label);
  const iconName = current === 'none' ? 'map-grid' : categoryIcons[category];
  let nextIcon = menuIcon;
  if (nextIcon?.dataset.icon !== iconName) {
    const next = iconElement(iconName);
    nextIcon?.replaceWith(next);
    nextIcon = next;
  }
  menuLabel.textContent = t(layers[category].label);
  menuToggle.dataset.short = t(layers[category].short);
  menuToggle.dataset.category = category;
  const description = `${t('layer.menuTitle')} · ${providerLabel} · ${t(layers[category].title)}`;
  menuToggle.title = description;
  menuToggle.setAttribute('aria-label', description);
  return nextIcon;
}

export function updateNoMapButton({ noMapButton, current, t }) {
  if (!noMapButton) return;
  const active = current === 'none';
  noMapButton.setAttribute('aria-checked', String(active));
  noMapButton.classList.toggle('active', active);
  noMapButton.title = t(active ? 'layer.noMapEnabled' : 'layer.noMapModeHint');
  noMapButton.setAttribute('aria-label', t(active ? 'layer.noMapEnabled' : 'layer.noMapMode'));
}

export function updateChoiceButtons({ categoryButtons, providerButtons, providerLabels, currentCategory, current }) {
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

export function renderLayerMenu({
  currentCategory, keyReady, providers, providerButtons, providerList, sourceEmpty, sourceSection,
  customManageButton, customEntryCount, keyStatus, removeButton, relabelKeyActions,
  updateChoiceButtons, renderCustomList, t,
}) {
  if (!currentCategory) return;
  updateChoiceButtons();
  for (const [key, button] of Object.entries(providerButtons)) {
    const visible = providers[key].category === currentCategory;
    button.hidden = !visible;
    const locked = visible && providers[key].provider.requiresKey && !keyReady;
    button.classList.toggle('locked', locked);
    button.dataset.locked = String(locked);
    button.removeAttribute('aria-disabled');
  }
  const noSource = currentCategory === 'none';
  if (providerList) providerList.hidden = noSource;
  if (sourceEmpty) sourceEmpty.hidden = !noSource;
  if (sourceSection) sourceSection.hidden = noSource;
  if (customManageButton) {
    customManageButton.hidden = currentCategory !== 'custom' || customEntryCount === 0;
  }
  if (keyStatus) {
    keyStatus.textContent = t(keyReady ? 'layer.keyConfigured' : 'layer.keyMissing');
    keyStatus.dataset.configured = String(keyReady);
  }
  if (removeButton) removeButton.hidden = !keyReady;
  relabelKeyActions();
  renderCustomList();
}

export function relabelLayerSwitcher({
  categoryButtons, categoryLabels, layers, t, menuHeading, customViewOpen, customManager,
  settingsViewOpen, backButton, settingsButton, closeButton, providerButtons, providerLabels,
  providers, menu, sourceEmpty, categoryKey, updateNoMapButton, updateMenuButton,
  relabelKeyActions, renderMenu,
}) {
  for (const [key, button] of Object.entries(categoryButtons)) {
    categoryLabels[key].textContent = t(layers[key].label);
    button.title = t(layers[key].title);
    button.setAttribute('aria-label', t(layers[key].title));
  }
  if (menuHeading) {
    menuHeading.textContent = t(customViewOpen
      ? (customManager.isEditing() ? customManager.headingKey() : 'layer.customHeading')
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
    providerLabels[key].label.textContent = t(providers[key].provider.label);
  }
  for (const node of menu?.querySelectorAll('[data-label-key]') || []) {
    node.textContent = t(node.dataset.labelKey);
  }
  const addButton = customManager.addButton();
  if (addButton) {
    addButton.title = t('layer.customAdd');
    addButton.setAttribute('aria-label', addButton.title);
  }
  const manageButton = customManager.manageButton();
  if (manageButton) {
    manageButton.title = t('layer.customManage');
    manageButton.setAttribute('aria-label', manageButton.title);
  }
  if (sourceEmpty) sourceEmpty.textContent = t('layer.noMapHint');
  if (categoryKey) {
    categoryKey.title = t('layer.switchHint');
    categoryKey.setAttribute('aria-label', categoryKey.title);
  }
  updateNoMapButton();
  updateMenuButton();
  relabelKeyActions();
  customManager.renderList();
  if (menu && !menu.hidden) renderMenu();
}

export function openLayerMenu({
  menu, onOpen, setMenuOpen, menuToggle, currentCategory, customEntryCount,
  showCustomView, showLayers, focus,
}) {
  if (!menu) return;
  onOpen?.();
  setMenuOpen(true);
  menu.hidden = false;
  menuToggle?.setAttribute('aria-expanded', 'true');
  if (currentCategory === 'custom' && customEntryCount === 0) showCustomView({ focus });
  else showLayers({ focus });
}
