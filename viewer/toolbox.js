import { iconElement, iconMarkup, setIcon, weatherMarkMarkup } from './icons.js';

/**
 * One map-corner entry for task tools. The measurement controller owns state; this module only exposes it
 * and hands the existing overlay exporter its original settings panel.
 */
export function createToolbox({
  L,
  map,
  el,
  t,
  formatDistance,
  measurement,
  exportAvailable,
  onExport,
  onWeather,
  weatherAvailable,
  weatherModes = [],
  weatherHasElevation = () => true,
  onOpen,
  onLayoutChange,
}) {
  let open = false;
  let button = null;
  let panel = null;
  let mainView = null;
  let measureView = null;
  let measureTotal = null;
  let measureMeta = null;
  let sectionList = null;
  let measureButton = null;
  let exportButton = null;
  let weatherButton = null;
  let weatherPicker = null;
  let weatherMode = weatherModes[0] || 'start';
  let measureTitle = null;
  let listHeading = null;
  let instruction = null;
  let finishButton = null;
  let undoButton = null;
  let redoButton = null;
  let centerButton = null;
  let clearButton = null;
  let stopButton = null;
  let closeButton = null;

  function render() {
    if (!panel) return;
    const summary = measurement.summary();
    const active = measurement.active();
    button?.classList.toggle('active', active);
    button?.setAttribute('aria-pressed', String(active));
    const description = active ? `${t('toolbox.open')} · ${t('measure.active')}` : t('toolbox.open');
    button?.setAttribute('title', description);
    button?.setAttribute('aria-label', description);

    measureButton.querySelector('strong').textContent = t(active
      ? 'measure.active' : summary.pointCount > 0 ? 'measure.resume' : 'measure.start');
    exportButton.disabled = !exportAvailable();
    exportButton.title = exportAvailable() ? t('toolbox.exportHint') : t('export.empty');
    exportButton.setAttribute('aria-label', exportButton.title);
    weatherButton.disabled = !weatherAvailable();
    weatherButton.title = weatherAvailable() ? t('toolbox.weatherHint') : t('weather.unavailable');
    weatherButton.setAttribute('aria-label', weatherButton.title);
    for (const option of weatherPicker.querySelectorAll('[data-weather-mode]')) {
      option.setAttribute('aria-pressed', String(option.dataset.weatherMode === weatherMode));
    }
    weatherPicker.hidden = !weatherAvailable() || weatherModes.length === 0;
    // The summit segment disappears when a file carries no elevation instead of opening a point it cannot find.
    for (const option of weatherPicker.querySelectorAll('[data-weather-mode]')) {
      option.disabled = Boolean(option.dataset.weatherMode === 'highest' && !weatherHasElevation());
    }

    measureTotal.textContent = formatDistance(summary.totalMeters);
    measureMeta.textContent = t('measure.summary', {
      sections: summary.sectionCount,
      points: summary.pointCount,
    });
    instruction.textContent = t('measure.instruction');
    finishButton.disabled = !measurement.canEndSection();
    undoButton.disabled = !measurement.canUndo();
    redoButton.disabled = !measurement.canRedo();
    clearButton.disabled = summary.pointCount === 0;
    stopButton.querySelector('.toolbox-action-label').textContent = t(active ? 'measure.stop' : 'measure.resume');
    measureButton.title = t(active ? 'measure.stopTitle' : 'measure.startTitle');
    undoButton.title = t('measure.undoTitle');
    redoButton.title = t('measure.redoTitle');
    stopButton.title = t(active ? 'measure.stopTitle' : 'measure.resumeTitle');
    undoButton.setAttribute('aria-label', undoButton.title);
    redoButton.setAttribute('aria-label', redoButton.title);
    stopButton.setAttribute('aria-label', stopButton.title);
    measureButton.setAttribute('aria-label', measureButton.title);

    sectionList.replaceChildren();
    const rows = [];
    measurement.sections().forEach((points, index) => {
      if (points.length === 0) return;
      const meters = index < summary.segmentMeters.length ? summary.segmentMeters[index] : 0;
      rows.push(el('li', 'toolbox-section-row', t('measure.sectionRow', {
        index: index + 1,
        distance: formatDistance(meters),
        points: points.length,
      })));
    });
    if (rows.length === 0) rows.push(el('li', 'toolbox-empty', t('measure.empty')));
    sectionList.append(...rows);

    const showMeasure = active;
    mainView.hidden = showMeasure;
    measureView.hidden = !showMeasure;
  }

  function openPanel({ focus = true } = {}) {
    if (!panel || open) return;
    onOpen?.();
    open = true;
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    render();
    onLayoutChange?.();
    if (focus) {
      requestAnimationFrame(() => {
        const target = measurement.active() ? stopButton : measureButton;
        target?.focus({ preventScroll: true });
      });
    }
  }

  function closePanel({ restoreFocus = false } = {}) {
    if (!open) return;
    open = false;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    onLayoutChange?.();
    if (restoreFocus && button.isConnected) button.focus({ preventScroll: true });
  }

  function startMeasure() {
    measurement.start();
    render();
    requestAnimationFrame(() => finishButton.focus({ preventScroll: true }));
  }

  const Control = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const bar = el('div', 'toolbox-switch leaflet-bar');
      button = el('button');
      button.type = 'button';
      button.dataset.toolbox = 'open';
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-controls', 'toolbox-panel');
      button.setAttribute('aria-pressed', 'false');
      button.innerHTML = iconMarkup('toolbox');
      button.addEventListener('click', () => {
        if (open) closePanel({ restoreFocus: true });
        else openPanel();
      });
      bar.append(button);

      panel = el('div', 'toolbox-panel');
      panel.id = 'toolbox-panel';
      panel.hidden = true;
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-labelledby', 'toolbox-heading');

      const header = el('div', 'toolbox-header');
      const heading = el('strong', 'toolbox-heading', t('toolbox.title'));
      heading.id = 'toolbox-heading';
      closeButton = el('button', 'toolbox-close');
      closeButton.type = 'button';
      setIcon(closeButton, 'close');
      closeButton.addEventListener('click', () => closePanel({ restoreFocus: true }));
      header.append(heading, closeButton);

      mainView = el('div', 'toolbox-main');
      measureButton = el('button', 'toolbox-action');
      measureButton.type = 'button';
      measureButton.dataset.tool = 'measure';
      measureButton.innerHTML = `<span class="toolbox-action-icon">${iconMarkup('ruler')}</span>`
        + '<span><strong></strong><small></small></span>';
      measureButton.querySelector('small').textContent = t('toolbox.measureHint');
      measureButton.addEventListener('click', startMeasure);

      exportButton = el('button', 'toolbox-action');
      exportButton.type = 'button';
      exportButton.dataset.tool = 'export';
      exportButton.innerHTML = `<span class="toolbox-action-icon">${iconMarkup('image-down')}</span>`
        + '<span><strong></strong><small></small></span>';
      exportButton.querySelector('strong').textContent = t('toolbox.export');
      exportButton.querySelector('small').textContent = t('toolbox.exportHint');
      exportButton.addEventListener('click', () => {
        closePanel();
        onExport();
      });

      weatherButton = el('button', 'toolbox-action');
      weatherButton.type = 'button';
      weatherButton.dataset.tool = 'weather';
      weatherButton.innerHTML = `<span class="toolbox-action-icon">${iconMarkup('weather')}</span>`
        + '<span><strong></strong><small></small></span>';
      weatherButton.querySelector('strong').textContent = t('toolbox.weather');
      weatherButton.querySelector('small').textContent = t('toolbox.weatherHint');
      weatherButton.addEventListener('click', () => {
        closePanel();
        onWeather?.(weatherMode);
      });

      // The three points share the action card: the card is the control, and the segments choose which point
      // it opens. Keeping them inside one border is what stops the picker reading as a second, unrelated tool.
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
          render();
        });
        weatherPicker.append(option);
      }
      weatherPicker.hidden = weatherModes.length === 0;
      const weatherRow = el('div', 'toolbox-weather-card');
      weatherRow.append(weatherButton, weatherPicker);
      mainView.append(measureButton, exportButton, weatherRow);

      measureView = el('section', 'toolbox-measure');
      measureView.hidden = true;
      measureTitle = el('span', 'toolbox-measure-kicker', t('measure.active'));
      measureTotal = el('strong', 'toolbox-measure-total', formatDistance(0));
      measureTotal.tabIndex = -1;
      measureTotal.setAttribute('aria-live', 'polite');
      measureMeta = el('span', 'toolbox-measure-meta');
      instruction = el('p', 'toolbox-measure-help');

      listHeading = el('strong', 'toolbox-list-heading', t('measure.sections'));
      sectionList = el('ol', 'toolbox-section-list');

      const actions = el('div', 'toolbox-measure-actions');
      const actionButton = (icon, labelKey, name, className = '') => {
        const action = el('button', className);
        action.type = 'button';
        action.dataset.measure = name;
        action.append(iconElement(icon), el('span', 'toolbox-action-label', t(labelKey)));
        return action;
      };
      finishButton = actionButton('finish-section', 'measure.finishSection', 'finish');
      finishButton.addEventListener('click', () => measurement.endSection());
      centerButton = actionButton('center-point', 'measure.centerPoint', 'center');
      centerButton.addEventListener('click', () => measurement.addAt(map.getCenter()));
      undoButton = actionButton('undo', 'measure.undo', 'undo');
      undoButton.addEventListener('click', () => measurement.undo());
      redoButton = actionButton('redo', 'measure.redo', 'redo');
      redoButton.addEventListener('click', () => measurement.redo());
      clearButton = actionButton('clear', 'measure.clear', 'clear', 'danger');
      clearButton.addEventListener('click', () => measurement.clear());
      stopButton = actionButton('stop', 'measure.stop', 'stop', 'primary');
      stopButton.addEventListener('click', () => {
        if (measurement.active()) measurement.stop();
        else startMeasure();
      });
      actions.append(finishButton, centerButton, undoButton, redoButton, clearButton, stopButton);
      measureView.append(measureTitle, measureTotal, measureMeta, instruction, listHeading, sectionList, actions);
      panel.append(header, mainView, measureView);
      closeButton.title = t('toolbox.close');
      closeButton.setAttribute('aria-label', t('toolbox.close'));

      bar.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !open) return;
        event.preventDefault();
        closePanel({ restoreFocus: true });
      });
      bar.append(panel);
      L.DomEvent.disableClickPropagation(bar);
      map.on('click', () => closePanel());
      return bar;
    },
  });
  map.addControl(new Control());

  measurement.subscribe(render);
  render();

  return {
    open: () => openPanel(),
    close: () => closePanel(),
    toggle: () => (open ? closePanel() : openPanel()),
    isOpen: () => open,
    weatherMode: () => weatherMode,
    isWeatherModeEnabled: (mode) => !(mode === 'highest' && !weatherHasElevation()),
    setWeatherMode(mode) {
      if (!weatherModes.includes(mode)) return false;
      weatherMode = mode;
      render();
      return true;
    },
    relabel() {
      document.getElementById('toolbox-heading').textContent = t('toolbox.title');
      closeButton.title = t('toolbox.close');
      closeButton.setAttribute('aria-label', t('toolbox.close'));
      measureButton.querySelector('small').textContent = t('toolbox.measureHint');
      exportButton.querySelector('strong').textContent = t('toolbox.export');
      exportButton.querySelector('small').textContent = t('toolbox.exportHint');
      weatherButton.querySelector('strong').textContent = t('toolbox.weather');
      weatherButton.querySelector('small').textContent = t('toolbox.weatherHint');
      weatherButton.title = weatherAvailable() ? t('toolbox.weatherHint') : t('weather.unavailable');
      weatherButton.setAttribute('aria-label', weatherButton.title);
      weatherPicker.setAttribute('aria-label', t('toolbox.weatherTarget'));
      for (const option of weatherPicker.querySelectorAll('[data-weather-mode]')) {
        const label = option.querySelector('.toolbox-weather-mode-label');
        if (label) label.textContent = t(`weather.mode.${option.dataset.weatherMode}`);
      }
      measureTitle.textContent = t('measure.active');
      instruction.textContent = t('measure.instruction');
      listHeading.textContent = t('measure.sections');
      finishButton.querySelector('.toolbox-action-label').textContent = t('measure.finishSection');
      centerButton.querySelector('.toolbox-action-label').textContent = t('measure.centerPoint');
      undoButton.querySelector('.toolbox-action-label').textContent = t('measure.undo');
      redoButton.querySelector('.toolbox-action-label').textContent = t('measure.redo');
      clearButton.querySelector('.toolbox-action-label').textContent = t('measure.clear');
      stopButton.querySelector('.toolbox-action-label').textContent = t(measurement.active()
        ? 'measure.stop' : 'measure.resume');
      render();
      onLayoutChange?.();
    },
  };
}
