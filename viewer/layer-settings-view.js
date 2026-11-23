import { iconElement, iconMarkup, setIcon } from './icons.js';
import { createCustomSourceForm } from './layer-custom-form.js';
import { MAP_OVERLAYS, PROVIDER_NODES, SINGLE_NODE_SOURCES } from './layer-registry.js';

const MULTI_NODE_PROVIDERS = [
  { key: 'road.osm', labelKey: 'layer.osm' },
  { key: 'terrain.openTopo', labelKey: 'layer.openTopo' },
  { key: 'satellite.esri', labelKey: 'layer.esri' },
];

/** Owns the layer menu DOM and returns the controls that the switcher updates. */
export function createLayerSettingsView({
  el, t, layers, categoryIcons,
  onToggle, onBack, onSettings, onNoMap, onClose, onCategory,
  onCustomManage, onCustomAdd, onClearCustom, onSubmitCustom,
  onConfigureTianditu, onRemoveTianditu,
  onToggleTileCache, onSelectTileCacheMaxMb, onSelectTileCacheDays, onClearTileCache,
  onSelectProviderNode, onCheckProviderNodes, onToggleOverlay,
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

  const overlaysSection = el('section', 'layer-menu-section layer-overlays-section');
  const overlaysHeading = el('span', 'layer-section-label', t('layer.overlaysHeading'));
  overlaysHeading.dataset.labelKey = 'layer.overlaysHeading';
  const overlayList = el('div', 'layer-overlay-list');
  overlayList.setAttribute('role', 'group');
  overlayList.setAttribute('aria-label', t('layer.overlaysHeading'));
  const overlayButtons = {};
  for (const overlay of MAP_OVERLAYS) {
    const btn = el('button', 'layer-overlay-chip', t(overlay.labelKey));
    btn.type = 'button';
    btn.dataset.overlay = overlay.id;
    btn.dataset.labelKey = overlay.labelKey;
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => onToggleOverlay?.(overlay.id));
    overlayButtons[overlay.id] = btn;
    overlayList.append(btn);
  }
  overlaysSection.append(overlaysHeading, overlayList);
  mainView.append(overlaysSection);
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

  const cacheSection = el('section', 'layer-settings-section layer-cache-section');
  const cacheHeader = el('div', 'layer-cache-header');
  const cacheHeading = el('span', 'layer-cache-heading', t('layer.cacheHeading'));
  cacheHeading.dataset.labelKey = 'layer.cacheHeading';
  const tileCacheToggle = el('button', 'layer-cache-toggle');
  tileCacheToggle.type = 'button';
  tileCacheToggle.dataset.tileCache = 'toggle';
  tileCacheToggle.setAttribute('role', 'switch');
  tileCacheToggle.setAttribute('aria-checked', 'true');
  tileCacheToggle.title = t('layer.cacheToggleHint');
  tileCacheToggle.setAttribute('aria-label', t('layer.cacheToggleHint'));
  tileCacheToggle.addEventListener('click', () => onToggleTileCache?.());
  cacheHeader.append(cacheHeading, tileCacheToggle);

  const tileCacheOptions = el('div', 'layer-cache-options');

  const limitRow = el('div', 'layer-cache-row');
  const limitLabel = el('span', 'layer-cache-label', t('layer.cacheLimit'));
  limitLabel.dataset.labelKey = 'layer.cacheLimit';
  const limitChoices = el('div', 'layer-cache-choices');
  limitChoices.setAttribute('role', 'radiogroup');
  limitChoices.setAttribute('aria-label', t('layer.cacheLimit'));
  const tileCacheLimitButtons = {};
  for (const [mb, text] of [['256', '256 MB'], ['512', '512 MB'], ['2048', '2 GB'], ['0', '\u221e']]) {
    const button = el('button', 'layer-cache-choice', text);
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.dataset.tileCacheMb = mb;
    button.setAttribute('aria-checked', 'false');
    button.addEventListener('click', () => onSelectTileCacheMaxMb?.(Number(mb)));
    tileCacheLimitButtons[mb] = button;
    limitChoices.append(button);
  }
  limitRow.append(limitLabel, limitChoices);

  const daysRow = el('div', 'layer-cache-row');
  const daysLabel = el('span', 'layer-cache-label', t('layer.cacheRetention'));
  daysLabel.dataset.labelKey = 'layer.cacheRetention';
  const daysChoices = el('div', 'layer-cache-choices');
  daysChoices.setAttribute('role', 'radiogroup');
  daysChoices.setAttribute('aria-label', t('layer.cacheRetention'));
  const tileCacheDaysButtons = {};
  for (const days of ['7', '30', '90', '0']) {
    const button = el('button', 'layer-cache-choice');
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.dataset.tileCacheDays = days;
    button.setAttribute('aria-checked', 'false');
    button.addEventListener('click', () => onSelectTileCacheDays?.(Number(days)));
    tileCacheDaysButtons[days] = button;
    daysChoices.append(button);
  }
  daysRow.append(daysLabel, daysChoices);
  tileCacheOptions.append(limitRow, daysRow);

  const cacheFooter = el('div', 'layer-cache-footer');
  const tileCacheStatus = el('span', 'layer-cache-status', t('layer.cacheLoading'));
  const tileCacheClearButton = el('button', 'layer-cache-clear');
  tileCacheClearButton.type = 'button';
  tileCacheClearButton.dataset.tileCache = 'clear';
  tileCacheClearButton.title = t('layer.cacheClearTitle');
  tileCacheClearButton.setAttribute('aria-label', t('layer.cacheClearTitle'));
  const tileCacheClearLabel = el('span', 'layer-cache-clear-label', t('layer.cacheClear'));
  tileCacheClearButton.append(iconElement('clear', { size: 12 }), tileCacheClearLabel);
  tileCacheClearButton.addEventListener('click', () => onClearTileCache?.());
  cacheFooter.append(tileCacheStatus, tileCacheClearButton);

  cacheSection.append(cacheHeader, tileCacheOptions, cacheFooter);

  const nodesSection = el('section', 'layer-settings-section layer-nodes-section');
  const nodesHeader = el('div', 'layer-nodes-header');
  const nodesHeading = el('span', 'layer-cache-heading', t('layer.nodesHeading'));
  nodesHeading.dataset.labelKey = 'layer.nodesHeading';
  const nodesCheckButton = el('button', 'layer-nodes-check', t('layer.nodesCheck'));
  nodesCheckButton.type = 'button';
  nodesCheckButton.dataset.nodesCheck = '1';
  nodesCheckButton.title = t('layer.nodesCheckTitle');
  nodesCheckButton.setAttribute('aria-label', nodesCheckButton.title);
  nodesCheckButton.addEventListener('click', () => onCheckProviderNodes?.());
  nodesHeader.append(nodesHeading, nodesCheckButton);

  const nodesBody = el('div', 'layer-nodes-body');
  const nodeButtons = {};
  const nodeStatuses = {};
  for (const group of MULTI_NODE_PROVIDERS) {
    const row = el('div', 'layer-node-group');
    const title = el('span', 'layer-node-group-label', t(group.labelKey));
    title.dataset.labelKey = group.labelKey;
    const choices = el('div', 'layer-node-choices');
    choices.setAttribute('role', 'radiogroup');
    nodeButtons[group.key] = {};
    for (const node of PROVIDER_NODES[group.key] || []) {
      const btn = el('button', 'layer-node-choice');
      btn.type = 'button';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', 'false');
      btn.dataset.nodeProvider = group.key;
      btn.dataset.nodeId = node.id;
      const dot = el('span', 'layer-node-dot');
      dot.dataset.state = 'idle';
      const label = el('span', 'layer-node-label', t(node.labelKey));
      label.dataset.labelKey = node.labelKey;
      const metric = el('span', 'layer-node-metric');
      btn.append(dot, label, metric);
      btn.addEventListener('click', () => onSelectProviderNode?.(group.key, node.id));
      nodeButtons[group.key][node.id] = btn;
      nodeStatuses[`${group.key}:${node.id}`] = { dot, metric };
      choices.append(btn);
    }
    row.append(title, choices);
    nodesBody.append(row);
  }

  const singleRow = el('div', 'layer-node-single-row');
  const singleHeading = el('span', 'layer-node-group-label', t('layer.nodesSingleHeading'));
  singleHeading.dataset.labelKey = 'layer.nodesSingleHeading';
  const singleList = el('div', 'layer-node-single-list');
  for (const src of SINGLE_NODE_SOURCES) {
    const pill = el('span', 'layer-node-single-pill');
    const dot = el('span', 'layer-node-dot');
    dot.dataset.state = 'idle';
    const label = el('span', 'layer-node-label', t(src.labelKey));
    label.dataset.labelKey = src.labelKey;
    const metric = el('span', 'layer-node-metric');
    pill.append(dot, label, metric);
    nodeStatuses[`single:${src.id}`] = { dot, metric };
    singleList.append(pill);
  }
  singleRow.append(singleHeading, singleList);
  nodesBody.append(singleRow);
  nodesSection.append(nodesHeader, nodesBody);

  settingsView.append(keySection, cacheSection, nodesSection);

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
    tileCacheToggle, tileCacheOptions, tileCacheLimitButtons, tileCacheDaysButtons,
    tileCacheStatus, tileCacheClearButton, tileCacheClearLabel,
    nodesCheckButton, nodeButtons, nodeStatuses, overlayButtons,
  };
}
