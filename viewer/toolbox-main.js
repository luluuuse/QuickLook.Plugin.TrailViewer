import { iconMarkup, weatherMarkMarkup } from './icons.js';

/** Main toolbox menu: quick actions, theme switcher, keyboard hints and route weather card. */
export function createToolboxMain({
  el, t, exportAvailable, editAvailable = () => true, weatherAvailable, weatherHasElevation,
  weatherModes, weatherCategories = [], weatherProvidersByCategory = {},
  initialWeatherCategory = 'weather', initialWeatherProviders = {},
  onWeatherCategoryChange, onWeatherProviderChange,
  theme = () => 'swiss', themeModes = [],
  onMeasure, onCoordinates, onExport, onAttachments,
  onWeather, onEdit, onUpdate, onThemes, onClose,
}) {
  let weatherMode = weatherModes[0] || 'start';
  let weatherCategory = weatherCategories.includes(initialWeatherCategory)
    ? initialWeatherCategory
    : (weatherCategories[0] || 'weather');
  const selectedProviders = {};
  for (const cat of weatherCategories) {
    const list = weatherProvidersByCategory[cat] || [];
    const init = initialWeatherProviders[cat];
    selectedProviders[cat] = list.includes(init) ? init : (list[0] || 'windy');
  }
  let measureButton;
  let coordinateButton;
  let exportButton;
  let attachmentButton;
  let editButton;
  let weatherButton;
  let weatherCard;
  let weatherTabs;
  let weatherPicker;
  let weatherProviderPicker;
  let quickGrid;
  let themePick;
  let versionBar;
  let updateButton;
  let latestState = null;

  function activeWeatherProvider() {
    const list = weatherProvidersByCategory[weatherCategory] || [];
    const current = selectedProviders[weatherCategory];
    return list.includes(current) ? current : (list[0] || 'windy');
  }

  function weatherHintText() {
    const provider = activeWeatherProvider();
    const key = `weather.hint.${provider}`;
    const specific = t(key);
    return specific !== key
      ? specific
      : t('toolbox.weatherHint', { provider: t(`weather.provider.${provider}`) });
  }

  function syncWeatherButton() {
    const provider = activeWeatherProvider();
    const hint = weatherHintText();
    weatherButton.querySelector('.toolbox-action-icon').innerHTML = iconMarkup(`provider-${provider}`);
    weatherButton.querySelector('small').textContent = hint;
    weatherButton.title = weatherAvailable() ? hint : t('weather.unavailable');
    weatherButton.setAttribute('aria-label', weatherButton.title);
    if (weatherCard) weatherCard.dataset.activeProvider = provider;
  }

  function rebuildProviderPicker() {
    const providers = weatherProvidersByCategory[weatherCategory] || [];
    const active = activeWeatherProvider();
    weatherProviderPicker.replaceChildren();
    for (const provider of providers) {
      const option = el('button', 'toolbox-weather-mode toolbox-weather-provider');
      option.type = 'button';
      option.dataset.weatherProvider = provider;
      option.innerHTML = `${iconMarkup(`provider-${provider}`, { size: 13 })}`
        + `<span class="toolbox-weather-mode-label">${t(`weather.provider.${provider}`)}</span>`;
      const desc = t(`weather.desc.${provider}`);
      option.title = desc;
      option.setAttribute('aria-label', desc);
      option.setAttribute('aria-pressed', String(provider === active));
      option.addEventListener('click', () => {
        if (provider === activeWeatherProvider()) return;
        selectedProviders[weatherCategory] = provider;
        onWeatherProviderChange?.(weatherCategory, provider);
        syncWeatherButton();
        if (latestState) render(latestState);
      });
      weatherProviderPicker.append(option);
    }
    weatherProviderPicker.hidden = !weatherAvailable() || providers.length === 0;
  }

  function build() {
    const view = el('div', 'toolbox-main');
    quickGrid = el('div', 'toolbox-quick-grid');
    quickGrid.setAttribute('role', 'group');
    quickGrid.setAttribute('aria-label', t('toolbox.quickTools'));

    measureButton = el('button', 'toolbox-action toolbox-quick-action');
    measureButton.type = 'button';
    measureButton.dataset.tool = 'measure';
    measureButton.innerHTML = `<span class="toolbox-action-icon">${iconMarkup('ruler')}</span>`
      + '<strong></strong>';
    measureButton.addEventListener('click', onMeasure);
    coordinateButton = el('button', 'toolbox-action toolbox-quick-action');
    coordinateButton.type = 'button';
    coordinateButton.dataset.tool = 'coordinates';
    coordinateButton.innerHTML = `<span class="toolbox-action-icon">${iconMarkup('coordinates')}</span>`
      + '<strong></strong>';
    coordinateButton.querySelector('strong').textContent = t('toolbox.coordinates');
    coordinateButton.addEventListener('click', onCoordinates);
    exportButton = el('button', 'toolbox-action toolbox-quick-action');
    exportButton.type = 'button';
    exportButton.dataset.tool = 'export';
    exportButton.innerHTML = `<span class="toolbox-action-icon">${iconMarkup('overlay-export')}</span>`
      + '<strong></strong>';
    exportButton.querySelector('strong').textContent = t('toolbox.export');
    exportButton.addEventListener('click', onExport);
    attachmentButton = el('button', 'toolbox-action toolbox-quick-action');
    attachmentButton.type = 'button';
    attachmentButton.dataset.tool = 'attachments';
    attachmentButton.innerHTML = `<span class="toolbox-action-icon">${iconMarkup('photo-export')}</span>`
      + '<strong></strong>';
    attachmentButton.querySelector('strong').textContent = t('toolbox.attachments');
    attachmentButton.addEventListener('click', onAttachments);

    editButton = el('button', 'toolbox-action toolbox-hero-action');
    editButton.type = 'button';
    editButton.dataset.tool = 'edit';
    editButton.innerHTML = `<span class="toolbox-action-icon">${iconMarkup('edit')}</span>`
      + '<span><strong></strong><small></small></span>'
      + '<span class="toolbox-hero-chevron" aria-hidden="true">\u203a</span>';
    editButton.querySelector('strong').textContent = t('toolbox.edit');
    editButton.querySelector('small').textContent = t('toolbox.editHint');
    editButton.title = t('toolbox.editHint');
    editButton.setAttribute('aria-label', editButton.title);
    editButton.disabled = !editAvailable();
    editButton.addEventListener('click', () => {
      if (editButton.disabled) return;
      onClose();
      onEdit?.();
    });

    weatherButton = el('button', 'toolbox-action');
    weatherButton.type = 'button';
    weatherButton.dataset.tool = 'weather';
    weatherButton.innerHTML = `<span class="toolbox-action-icon">${iconMarkup('weather')}</span>`
      + '<span><strong></strong><small></small></span>'
      + '<span class="toolbox-weather-ext" aria-hidden="true">\u2197</span>';
    weatherButton.querySelector('strong').textContent = t('toolbox.weather');
    syncWeatherButton();
    weatherButton.addEventListener('click', () => {
      onClose();
      onWeather?.(weatherMode, activeWeatherProvider());
    });

    weatherTabs = el('div', 'toolbox-weather-tabs');
    weatherTabs.setAttribute('role', 'group');
    weatherTabs.setAttribute('aria-label', t('toolbox.weatherCategory'));
    for (const category of weatherCategories) {
      const tab = el('button', 'toolbox-weather-tab');
      tab.type = 'button';
      tab.dataset.weatherCategory = category;
      tab.textContent = t(`weather.category.${category}`);
      tab.setAttribute('aria-pressed', String(category === weatherCategory));
      tab.addEventListener('click', () => {
        if (category === weatherCategory) return;
        weatherCategory = category;
        onWeatherCategoryChange?.(category);
        rebuildProviderPicker();
        syncWeatherButton();
        if (latestState) render(latestState);
      });
      weatherTabs.append(tab);
    }
    weatherTabs.hidden = weatherCategories.length <= 1;

    const weatherHead = el('div', 'toolbox-weather-head');
    weatherHead.append(weatherButton, weatherTabs);

    weatherPicker = el('div', 'toolbox-weather-picker');
    weatherPicker.setAttribute('role', 'group');
    weatherPicker.setAttribute('aria-label', t('toolbox.weatherTarget'));
    for (const mode of weatherModes) {
      const option = el('button', 'toolbox-weather-mode');
      option.type = 'button';
      option.dataset.weatherMode = mode;
      option.innerHTML = `${weatherMarkMarkup(mode, { size: 16 })}`
        + `<span class="toolbox-weather-mode-label">${t(`weather.mode.${mode}`)}</span>`;
      option.setAttribute('aria-pressed', String(mode === weatherMode));
      option.addEventListener('click', () => {
        weatherMode = mode;
        if (latestState) render(latestState);
      });
      weatherPicker.append(option);
    }
    weatherPicker.hidden = weatherModes.length === 0;
    weatherProviderPicker = el('div', 'toolbox-weather-picker toolbox-weather-providers');
    weatherProviderPicker.setAttribute('role', 'group');
    weatherProviderPicker.setAttribute('aria-label', t('toolbox.weatherProvider'));
    rebuildProviderPicker();
    weatherButton.disabled = !weatherAvailable();
    syncWeatherButton();

    weatherCard = el('div', 'toolbox-weather-card');
    weatherCard.dataset.activeProvider = activeWeatherProvider();
    weatherCard.append(weatherHead, weatherPicker, weatherProviderPicker);
    quickGrid.append(measureButton, coordinateButton, exportButton, attachmentButton);

    themePick = el('div', 'toolbox-theme-pick');
    themePick.setAttribute('role', 'group');
    themePick.setAttribute('aria-label', t('theme.label'));
    const themeTrigger = el('button', 'toolbox-theme-trigger');
    themeTrigger.type = 'button';
    themeTrigger.dataset.tool = 'themes';
    const triggerSwatch = el('span', 'toolbox-theme-option toolbox-theme-trigger-swatch');
    const triggerLabel = el('span', 'toolbox-theme-trigger-label', '');
    const triggerCaret = el('span', 'toolbox-theme-trigger-caret', '\u203a');
    triggerCaret.setAttribute('aria-hidden', 'true');
    themeTrigger.append(triggerSwatch, triggerLabel, triggerCaret);
    themeTrigger.addEventListener('click', () => onThemes?.());
    themePick.append(themeTrigger);
    themePick.hidden = themeModes.length === 0;

    versionBar = el('div', 'toolbox-version-bar');
    updateButton = el('button', 'toolbox-version-btn');
    updateButton.type = 'button';
    updateButton.dataset.tool = 'update';
    updateButton.textContent = t('update.checkNow');
    updateButton.addEventListener('click', () => onUpdate?.());
    versionBar.append(themePick, updateButton);

    view.append(quickGrid, editButton, weatherCard, versionBar);
    return view;
  }

  function renderThemeState() {
    if (!themePick) return;
    const current = theme();
    const trigger = themePick.querySelector('.toolbox-theme-trigger');
    const triggerSwatch = themePick.querySelector('.toolbox-theme-trigger-swatch');
    const triggerLabel = themePick.querySelector('.toolbox-theme-trigger-label');
    if (triggerSwatch) triggerSwatch.dataset.themeOption = current;
    if (triggerLabel) triggerLabel.textContent = t(`theme.${current}`);
    if (trigger) {
      const label = `${t('theme.label')}: ${t(`theme.${current}`)}`;
      trigger.title = label;
      trigger.setAttribute('aria-label', label);
    }
    for (const option of themePick.querySelectorAll('button[data-theme-option]')) {
      option.setAttribute('aria-pressed', String(option.dataset.themeOption === current));
    }
  }

  const view = build();

  function render({ active, summary, attachmentCounts, updateState = null }) {
    latestState = { active, summary, attachmentCounts, updateState };
    measureButton.querySelector('strong').textContent = t(active
      ? 'measure.active' : summary.pointCount > 0 ? 'measure.resume' : 'measure.start');
    measureButton.title = t(active ? 'measure.stopTitle' : 'measure.startTitle');
    measureButton.setAttribute('aria-label', measureButton.title);
    attachmentButton.disabled = attachmentCounts.total === 0;
    attachmentButton.title = attachmentCounts.total > 0
      ? t('attachments.summary', attachmentCounts)
      : t('attachments.none');
    attachmentButton.setAttribute('aria-label', attachmentButton.title);
    coordinateButton.title = t('toolbox.coordinatesHint');
    coordinateButton.setAttribute('aria-label', coordinateButton.title);
    exportButton.disabled = !exportAvailable();
    exportButton.title = exportAvailable() ? t('toolbox.exportHint') : t('export.empty');
    exportButton.setAttribute('aria-label', exportButton.title);
    editButton.disabled = !editAvailable();
    const available = weatherAvailable();
    for (const tab of weatherTabs.querySelectorAll('[data-weather-category]')) {
      tab.setAttribute('aria-pressed', String(tab.dataset.weatherCategory === weatherCategory));
    }
    weatherTabs.hidden = !available || weatherCategories.length <= 1;
    for (const option of weatherPicker.querySelectorAll('[data-weather-mode]')) {
      option.setAttribute('aria-pressed', String(option.dataset.weatherMode === weatherMode));
      option.disabled = Boolean(option.dataset.weatherMode === 'highest' && !weatherHasElevation());
    }
    weatherPicker.hidden = !available || weatherModes.length === 0;
    const activeProvider = activeWeatherProvider();
    for (const option of weatherProviderPicker.querySelectorAll('[data-weather-provider]')) {
      option.setAttribute('aria-pressed', String(option.dataset.weatherProvider === activeProvider));
    }
    const activeProviders = weatherProvidersByCategory[weatherCategory] || [];
    weatherProviderPicker.hidden = !available || activeProviders.length === 0;
    weatherButton.disabled = !available;
    syncWeatherButton();
    renderThemeState();
    const hasNew = Boolean(updateState?.hasUpdate && updateState?.latestVersion);
    updateButton.classList.toggle('has-update', hasNew);
    updateButton.textContent = hasNew
      ? t('update.newBadge', { version: `v${updateState.latestVersion}` })
      : (updateState?.status === 'checking' ? t('update.checking') : t('update.checkNow'));
  }

  function relabel() {
    quickGrid.setAttribute('aria-label', t('toolbox.quickTools'));
    coordinateButton.querySelector('strong').textContent = t('toolbox.coordinates');
    exportButton.querySelector('strong').textContent = t('toolbox.export');
    attachmentButton.querySelector('strong').textContent = t('toolbox.attachments');
    editButton.querySelector('strong').textContent = t('toolbox.edit');
    editButton.querySelector('small').textContent = t('toolbox.editHint');
    editButton.title = t('toolbox.editHint');
    editButton.setAttribute('aria-label', editButton.title);
    weatherButton.querySelector('strong').textContent = t('toolbox.weather');
    syncWeatherButton();
    weatherTabs.setAttribute('aria-label', t('toolbox.weatherCategory'));
    for (const tab of weatherTabs.querySelectorAll('[data-weather-category]')) {
      tab.textContent = t(`weather.category.${tab.dataset.weatherCategory}`);
    }
    weatherPicker.setAttribute('aria-label', t('toolbox.weatherTarget'));
    for (const option of weatherPicker.querySelectorAll('[data-weather-mode]')) {
      option.querySelector('.toolbox-weather-mode-label').textContent =
        t(`weather.mode.${option.dataset.weatherMode}`);
    }
    weatherProviderPicker.setAttribute('aria-label', t('toolbox.weatherProvider'));
    for (const option of weatherProviderPicker.querySelectorAll('[data-weather-provider]')) {
      const provider = option.dataset.weatherProvider;
      option.querySelector('.toolbox-weather-mode-label').textContent =
        t(`weather.provider.${provider}`);
      const desc = t(`weather.desc.${provider}`);
      option.title = desc;
      option.setAttribute('aria-label', desc);
    }
    if (themePick) {
      themePick.setAttribute('aria-label', t('theme.label'));
      renderThemeState();
    }
  }

  return {
    view,
    measureButton,
    render,
    relabel,
    weatherMode: () => weatherMode,
    setWeatherMode(mode) {
      if (!weatherModes.includes(mode)) return false;
      weatherMode = mode;
      if (latestState) render(latestState);
      return true;
    },
    weatherCategory: () => weatherCategory,
    weatherProvider: () => activeWeatherProvider(),
    setWeatherCategory(category) {
      if (!weatherCategories.includes(category)) return false;
      weatherCategory = category;
      onWeatherCategoryChange?.(category);
      rebuildProviderPicker();
      syncWeatherButton();
      if (latestState) render(latestState);
      return true;
    },
    setWeatherProvider(provider) {
      const targetCategory = weatherCategories.find((cat) => (weatherProvidersByCategory[cat] || []).includes(provider));
      if (!targetCategory) return false;
      weatherCategory = targetCategory;
      selectedProviders[targetCategory] = provider;
      onWeatherCategoryChange?.(targetCategory);
      onWeatherProviderChange?.(targetCategory, provider);
      rebuildProviderPicker();
      syncWeatherButton();
      if (latestState) render(latestState);
      return true;
    },
    isWeatherModeEnabled: (mode) => !(mode === 'highest' && !weatherHasElevation()),
  };
}
