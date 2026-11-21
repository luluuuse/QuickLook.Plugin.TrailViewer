import { iconMarkup, weatherMarkMarkup } from './icons.js';

/** Main toolbox menu: quick actions, keyboard hints and route weather card. */
export function createToolboxMain({
  el, t, exportAvailable, weatherAvailable, weatherHasElevation,
  weatherModes, onMeasure, onCoordinates, onExport, onAttachments, onWeather, onEdit, onClose,
}) {
  let weatherMode = weatherModes[0] || 'start';
  let measureButton;
  let coordinateButton;
  let exportButton;
  let attachmentButton;
  let editButton;
  let weatherButton;
  let weatherPicker;
  let quickGrid;
  let latestState = null;

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
    editButton.addEventListener('click', () => {
      onClose();
      onEdit?.();
    });

    weatherButton = el('button', 'toolbox-action');
    weatherButton.type = 'button';
    weatherButton.dataset.tool = 'weather';
    weatherButton.innerHTML = `<span class="toolbox-action-icon">${iconMarkup('weather')}</span>`
      + '<span><strong></strong><small></small></span>';
    weatherButton.querySelector('strong').textContent = t('toolbox.weather');
    weatherButton.querySelector('small').textContent = t('toolbox.weatherHint');
    weatherButton.addEventListener('click', () => {
      onClose();
      onWeather?.(weatherMode);
    });
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
    weatherButton.disabled = !weatherAvailable();
    weatherButton.title = weatherAvailable() ? t('toolbox.weatherHint') : t('weather.unavailable');
    weatherButton.setAttribute('aria-label', weatherButton.title);

    const weatherRow = el('div', 'toolbox-weather-card');
    weatherRow.append(weatherButton, weatherPicker);
    quickGrid.append(measureButton, coordinateButton, exportButton, attachmentButton);
    view.append(editButton, quickGrid, weatherRow);
    return view;
  }

  const view = build();

  function render({ active, summary, attachmentCounts }) {
    latestState = { active, summary, attachmentCounts };
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
    for (const option of weatherPicker.querySelectorAll('[data-weather-mode]')) {
      option.setAttribute('aria-pressed', String(option.dataset.weatherMode === weatherMode));
      option.disabled = Boolean(option.dataset.weatherMode === 'highest' && !weatherHasElevation());
    }
    weatherPicker.hidden = !weatherAvailable() || weatherModes.length === 0;
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
    weatherButton.querySelector('small').textContent = t('toolbox.weatherHint');
    weatherPicker.setAttribute('aria-label', t('toolbox.weatherTarget'));
    for (const option of weatherPicker.querySelectorAll('[data-weather-mode]')) {
      option.querySelector('.toolbox-weather-mode-label').textContent =
        t(`weather.mode.${option.dataset.weatherMode}`);
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
    isWeatherModeEnabled: (mode) => !(mode === 'highest' && !weatherHasElevation()),
  };
}
