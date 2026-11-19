import { iconElement, iconMarkup, setIcon } from './icons.js';
import { createCustomSourceForm } from './layer-custom-form.js';

/** Owns the layer menu DOM and returns the controls that the switcher updates. */
export function createLayerSettingsView({
  el, t, layers, categoryIcons,
  onToggle, onBack, onSettings, onNoMap, onClose, onCategory,
  onCustomManage, onCustomAdd, onClearCustom, onSubmitCustom,
  onConfigureTianditu, onRemoveTianditu,
}) {
  const bar = el('div', 'layer-switch leaflet-bar');
  const menuToggle = el('button', 'layer-menu-toggle');
  menuToggle.type = 'button';
  menuToggle.dataset.layer = 'menu';
  menuToggle.setAttribute('aria-haspopup', 'dialog');
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-controls', 'layer-source-menu');
  menuToggle.innerHTML = iconMarkup('layers');
  const menuIcon = menuToggle.firstElementChild;
  const menuLabel = el('span', 'layer-menu-label');
  const menuChevron = iconElement('chevron-down', { size: 12 });
  menuChevron.classList.add('layer-menu-chevron');
  menuToggle.append(menuLabel, menuChevron);
  menuToggle.addEventListener('click', onToggle);
  bar.append(menuToggle);

  const menu = el('div', 'layer-source-menu');
  menu.id = 'layer-source-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'dialog');
  const headingId = 'layer-source-heading';
  menu.setAttribute('aria-labelledby', headingId);
  const header = el('div', 'layer-menu-header');
  const backButton = el('button', 'layer-menu-icon-button layer-menu-back');
  backButton.type = 'button';
  setIcon(backButton, 'chevron-left');
  backButton.hidden = true;
  backButton.title = t('layer.backToLayers');
  backButton.setAttribute('aria-label', t('layer.backToLayers'));
  backButton.addEventListener('click', onBack);
  const menuHeading = el('strong', 'layer-source-heading', t('layer.menuTitle'));
  menuHeading.id = headingId;
  const headerActions = el('div', 'layer-menu-header-actions');
  const settingsButton = el('button', 'layer-menu-icon-button layer-settings-button');
  settingsButton.type = 'button';
  settingsButton.title = t('layer.openSettings');
  settingsButton.setAttribute('aria-label', t('layer.openSettings'));
  setIcon(settingsButton, 'settings');
  settingsButton.addEventListener('click', onSettings);
  const noMapButton = el('button', 'layer-menu-icon-button layer-nomap-button');
  noMapButton.type = 'button';
  noMapButton.dataset.noMap = '';
  noMapButton.setAttribute('role', 'switch');
  noMapButton.setAttribute('aria-checked', 'false');
  noMapButton.title = t('layer.noMapModeHint');
  noMapButton.setAttribute('aria-label', t('layer.noMapMode'));
  setIcon(noMapButton, 'map-grid');
  noMapButton.addEventListener('click', onNoMap);
  const closeButton = el('button', 'layer-menu-icon-button layer-menu-close');
  closeButton.type = 'button';
  setIcon(closeButton, 'close');
  closeButton.title = t('layer.closeMenu');
  closeButton.setAttribute('aria-label', t('layer.closeMenu'));
  closeButton.addEventListener('click', onClose);
  headerActions.append(noMapButton, settingsButton, closeButton);
  header.append(backButton, menuHeading, headerActions);
  menu.append(header);

  const mainView = el('div', 'layer-main-view');
  const typeSection = el('section', 'layer-menu-section');
  const typeHeading = el('span', 'layer-section-label', t('layer.typeHeading'));
  typeHeading.dataset.labelKey = 'layer.typeHeading';
  const typeHeadingRow = el('div', 'layer-section-heading-row');
  const categoryKey = el('kbd', 'control-key', 'Q / E');
  categoryKey.title = t('layer.switchHint');
  categoryKey.setAttribute('aria-label', categoryKey.title);
  typeHeadingRow.append(typeHeading, categoryKey);
  typeSection.append(typeHeadingRow);
  const categoryGrid = el('div', 'layer-category-grid');
  categoryGrid.setAttribute('role', 'radiogroup');
  categoryGrid.setAttribute('aria-label', t('layer.typeHeading'));
  const categoryButtons = {};
  const categoryLabels = {};
  for (const [category, definition] of Object.entries(layers)) {
    if (definition.settingsOnly) continue;
    const button = el('button', 'layer-category-button');
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', 'false');
    button.setAttribute('aria-label', t(definition.title));
    button.title = t(definition.title);
    button.dataset.layer = category;
    button.innerHTML = iconMarkup(categoryIcons[category]);
    const label = el('span', 'layer-category-label', t(definition.label));
    button.append(label);
    button.addEventListener('click', () => onCategory(category));
    categoryButtons[category] = button;
    categoryLabels[category] = label;
    categoryGrid.append(button);
  }
  typeSection.append(categoryGrid);
  mainView.append(typeSection);

  const sourceSection = el('section', 'layer-menu-section');
  const sourceHeading = el('span', 'layer-section-label', t('layer.sourceHeading'));
  sourceHeading.dataset.labelKey = 'layer.sourceHeading';
  const sourceHeadingRow = el('div', 'layer-section-heading-row');
  const customManageButton = el('button', 'layer-custom-manage', t('layer.customManage'));
  customManageButton.type = 'button';
  customManageButton.dataset.customManage = '';
  customManageButton.dataset.labelKey = 'layer.customManage';
  customManageButton.hidden = true;
  customManageButton.addEventListener('click', (event) => {
    event.stopPropagation();
    onCustomManage();
  });
  sourceHeadingRow.append(sourceHeading, customManageButton);
  sourceSection.append(sourceHeadingRow);
  const providerList = el('div', 'layer-provider-list');
  providerList.setAttribute('role', 'radiogroup');
  providerList.setAttribute('aria-label', t('layer.sourceHeading'));
  const sourceEmpty = el('p', 'layer-source-empty', t('layer.noMapHint'));
  sourceEmpty.dataset.labelKey = 'layer.noMapHint';
  sourceEmpty.hidden = true;
  sourceSection.append(providerList, sourceEmpty);
  mainView.append(sourceSection);
  menu.append(mainView);

  const settingsView = el('section', 'layer-settings-view');
  settingsView.hidden = true;
  const keySection = el('section', 'layer-settings-section');
  const keyRow = el('div', 'layer-key-row');
  const keyIdentity = el('div', 'layer-key-identity');
  const keyHeading = el('span', 'layer-section-label', t('layer.keyHeading'));
  keyHeading.dataset.labelKey = 'layer.keyHeading';
  const keyStatus = el('span', 'layer-setting-status', t('layer.keyMissing'));
  keyStatus.dataset.configured = 'false';
  keyIdentity.append(keyHeading, keyStatus);
  const settingsActions = el('div', 'layer-key-actions');
  const configureButton = el('button', 'layer-key-action');
  configureButton.type = 'button';
  setIcon(configureButton, 'plus');
  configureButton.title = t('layer.configureTiandituKey');
  configureButton.setAttribute('aria-label', configureButton.title);
  configureButton.addEventListener('click', onConfigureTianditu);
  const removeButton = el('button', 'layer-key-action danger');
  removeButton.type = 'button';
  removeButton.hidden = true;
  setIcon(removeButton, 'clear');
  removeButton.title = t('layer.removeTiandituKey');
  removeButton.setAttribute('aria-label', removeButton.title);
  removeButton.addEventListener('click', onRemoveTianditu);
  settingsActions.append(configureButton, removeButton);
  keyRow.append(keyIdentity, settingsActions);
  keySection.append(keyRow);
  settingsView.append(keySection);

  const customView = el('section', 'layer-custom-view');
  customView.hidden = true;
  const customSection = el('section', 'layer-custom-section');
  const customCount = el('span', 'layer-custom-count');
  const customEmpty = el('div', 'layer-custom-empty');
  const emptyIcon = el('span', 'layer-custom-empty-icon');
  emptyIcon.append(iconElement('layers', { size: 18 }));
  const emptyText = el('p', null, t('layer.customEmpty'));
  emptyText.dataset.labelKey = 'layer.customEmpty';
  const customEmptyAction = el('button', 'layer-custom-empty-action', t('layer.customAdd'));
  customEmptyAction.type = 'button';
  customEmptyAction.dataset.labelKey = 'layer.customAdd';
  customEmptyAction.addEventListener('click', onCustomAdd);
  customEmpty.append(emptyIcon, emptyText, customEmptyAction);
  const customList = el('div', 'layer-custom-list');
  customList.setAttribute('role', 'radiogroup');
  const customAddButton = el('button', 'layer-menu-icon-button layer-custom-add');
  customAddButton.type = 'button';
  customAddButton.dataset.customAdd = '';
  customAddButton.title = t('layer.customAdd');
  customAddButton.setAttribute('aria-label', customAddButton.title);
  setIcon(customAddButton, 'plus');
  customAddButton.addEventListener('click', onCustomAdd);
  headerActions.insertBefore(customAddButton, closeButton);
  customAddButton.hidden = true;
  const customForm = createCustomSourceForm({
    el,
    t,
    onCancel: onClearCustom,
    onSubmit: onSubmitCustom,
  });
  customSection.append(customEmpty, customList, customForm.form);
  customView.append(customCount, customSection);
  menu.append(settingsView, customView);
  bar.append(menu);

  return {
    bar, menuToggle, menuIcon, menuLabel, menu, mainView, settingsView, customView,
    menuHeading, backButton, settingsButton, closeButton, noMapButton, categoryKey,
    categoryButtons, categoryLabels, sourceSection, sourceEmpty, providerList,
    customManageButton, customCount, customEmpty, customList, customAddButton,
    configureButton, removeButton, keyStatus, customForm,
    customFormView: customForm,
  };
}
