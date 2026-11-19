import { iconElement, iconMarkup, setIcon, weatherMarkMarkup } from './icons.js';
import { createCoordinateTool } from './toolbox-coordinates.js';
import { createAttachmentTool } from './toolbox-attachments.js';

/**
 * One map-corner entry for task tools. Every tool page shares this panel, header and back navigation.
 */
export function createToolbox({
  L,
  map,
  el,
  t,
  formatDistance,
  measurement,
  copyText,
  showToast,
  coordinatePoints = () => ({}),
  focusCoordinate = (point) => point,
  onCoordinateWeather,
  attachmentItems = [],
  onExportAttachments,
  exportAvailable,
  mountExportView,
  onWeather,
  weatherAvailable,
  weatherModes = [],
  weatherHasElevation = () => true,
  onOpen,
  onLayoutChange,
}) {
  const lifecycle = new AbortController();
  let open = false;
  let button = null;
  let panel = null;
  let mainView = null;
  let measureView = null;
  let measureTotal = null;
  let measureMeta = null;
  let sectionList = null;
  let measureButton = null;
  let coordinateButton = null;
  let attachmentButton = null;
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
  let headNote = null;
  let exportView = null;
  let exportBack = null;
  let exportSettingsPanel = null;
  let view = 'main';

  function showView(next) {
    if (next !== 'coordinate') coordinates.stop();
    view = next;
    render();
  }

  const coordinates = createCoordinateTool({
    L,
    map,
    el,
    t,
    copyText,
    showToast,
    coordinatePoints,
    focusCoordinate,
    snapMarker: measurement.snapMarker,
    panel: () => panel,
    onBack: () => showView('main'),
    onWeather: (point) => {
      closePanel();
      onCoordinateWeather?.(point);
    },
    renderToolbox: () => render(),
  });
  const attachments = createAttachmentTool({
    el,
    t,
    attachmentItems,
    onExport: onExportAttachments,
    onBack: () => showView('main'),
    renderToolbox: () => render(),
    showToast,
  });

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
    coordinates.render();
    const attachmentCounts = attachments.render();
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

    if (active) view = 'measure';
    else if (view === 'measure') view = 'main';
    mainView.hidden = view !== 'main';
    measureView.hidden = view !== 'measure';
    coordinates.view.hidden = view !== 'coordinate';
    attachments.view.hidden = view !== 'attachments';
    exportView.hidden = view !== 'export';
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
        const target = view === 'measure'
          ? stopButton
          : view === 'coordinate'
            ? coordinates.view.querySelector('[data-coordinate="start"]:not(:disabled)')
              || coordinates.view.querySelector('[data-coordinate="center"]')
            : view === 'attachments'
              ? attachments.view.querySelector('.toolbox-back')
            : view === 'export'
              ? exportBack
              : measureButton;
        target?.focus({ preventScroll: true });
      });
    }
  }

  function closePanel({ restoreFocus = false } = {}) {
    if (!open) return;
    coordinates.stop();
    if (view === 'coordinate' || view === 'attachments' || view === 'export') view = 'main';
    open = false;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    onLayoutChange?.();
    if (restoreFocus && button.isConnected) button.focus({ preventScroll: true });
  }

  function startMeasure() {
    view = 'measure';
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
      headNote = el('span', 'toolbox-head-note', t('toolbox.quickStart'));
      closeButton = el('button', 'toolbox-close');
      closeButton.type = 'button';
      setIcon(closeButton, 'close');
      closeButton.addEventListener('click', () => closePanel({ restoreFocus: true }));
      header.append(heading, headNote, closeButton);

      mainView = el('div', 'toolbox-main');
      const quickGrid = el('div', 'toolbox-quick-grid');
      quickGrid.setAttribute('role', 'group');
      quickGrid.setAttribute('aria-label', t('toolbox.quickTools'));

      measureButton = el('button', 'toolbox-action toolbox-quick-action');
      measureButton.type = 'button';
      measureButton.dataset.tool = 'measure';
      measureButton.innerHTML = `<span class="toolbox-action-icon">${iconMarkup('ruler')}</span>`
        + '<strong></strong><span class="toolbox-key-chip">M</span>';
      measureButton.addEventListener('click', startMeasure);

      coordinateButton = el('button', 'toolbox-action toolbox-quick-action');
      coordinateButton.type = 'button';
      coordinateButton.dataset.tool = 'coordinates';
      coordinateButton.innerHTML = `<span class="toolbox-action-icon">${iconMarkup('coordinates')}</span>`
        + '<strong></strong>';
      coordinateButton.querySelector('strong').textContent = t('toolbox.coordinates');
      coordinateButton.addEventListener('click', () => {
        if (measurement.active()) measurement.stop();
        showView('coordinate');
        coordinates.begin();
      });

      exportButton = el('button', 'toolbox-action toolbox-quick-action');
      exportButton.type = 'button';
      exportButton.dataset.tool = 'export';
      exportButton.innerHTML = `<span class="toolbox-action-icon">${iconMarkup('overlay-export')}</span>`
        + '<strong></strong>';
      exportButton.querySelector('strong').textContent = t('toolbox.export');
      exportButton.addEventListener('click', () => {
        if (measurement.active()) measurement.stop();
        showView('export');
        requestAnimationFrame(() => exportSettingsPanel?.focus());
      });

      attachmentButton = el('button', 'toolbox-action toolbox-quick-action');
      attachmentButton.type = 'button';
      attachmentButton.dataset.tool = 'attachments';
      attachmentButton.innerHTML = `<span class="toolbox-action-icon">${iconMarkup('photo-export')}</span>`
        + '<strong></strong>';
      attachmentButton.querySelector('strong').textContent = t('toolbox.attachments');
      attachmentButton.addEventListener('click', () => {
        if (measurement.active()) measurement.stop();
        showView('attachments');
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
      quickGrid.append(measureButton, coordinateButton, exportButton, attachmentButton);
      mainView.append(quickGrid, weatherRow);

      exportView = el('section', 'toolbox-subview toolbox-export');
      exportView.hidden = true;
      exportBack = el('button', 'toolbox-back');
      exportBack.type = 'button';
      exportBack.append(iconElement('arrow-left'), el('span', null, t('toolbox.back')));
      exportBack.addEventListener('click', () => showView('main'));
      exportView.append(
        exportBack,
        el('h2', 'toolbox-subtitle', t('export.panel')),
        el('p', 'toolbox-subhint', t('export.panelHint')),
      );
      const exportSettings = el('div', 'toolbox-export-settings');
      exportSettingsPanel = mountExportView?.(exportSettings) || null;
      exportView.append(exportSettings);

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
      panel.append(header, mainView, coordinates.view, attachments.view, exportView, measureView);
      closeButton.title = t('toolbox.close');
      closeButton.setAttribute('aria-label', t('toolbox.close'));

      bar.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !open) return;
        event.preventDefault();
        if (coordinates.isActive()) {
          coordinates.stop();
          render();
          return;
        }
        if (view !== 'main') {
          showView('main');
          return;
        }
        closePanel({ restoreFocus: true });
      }, { signal: lifecycle.signal });
      bar.append(panel);
      L.DomEvent.disableClickPropagation(bar);
      map.on('click', closePanel);
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
    isView: (name) => open && view === name,
    weatherMode: () => weatherMode,
    isWeatherModeEnabled: (mode) => !(mode === 'highest' && !weatherHasElevation()),
    setWeatherMode(mode) {
      if (!weatherModes.includes(mode)) return false;
      weatherMode = mode;
      render();
      return true;
    },
    destroy() {
      lifecycle.abort();
      coordinates.destroy();
      map.off('click', closePanel);
    },
    relabel() {
      document.getElementById('toolbox-heading').textContent = t('toolbox.title');
      headNote.textContent = t('toolbox.quickStart');
      closeButton.title = t('toolbox.close');
      closeButton.setAttribute('aria-label', t('toolbox.close'));
      mainView.querySelector('.toolbox-quick-grid').setAttribute('aria-label', t('toolbox.quickTools'));
      coordinateButton.querySelector('strong').textContent = t('toolbox.coordinates');
      exportButton.querySelector('strong').textContent = t('toolbox.export');
      attachmentButton.querySelector('strong').textContent = t('toolbox.attachments');
      weatherButton.querySelector('strong').textContent = t('toolbox.weather');
      weatherButton.querySelector('small').textContent = t('toolbox.weatherHint');
      weatherButton.title = weatherAvailable() ? t('toolbox.weatherHint') : t('weather.unavailable');
      weatherButton.setAttribute('aria-label', weatherButton.title);
      weatherPicker.setAttribute('aria-label', t('toolbox.weatherTarget'));
      for (const option of weatherPicker.querySelectorAll('[data-weather-mode]')) {
        const label = option.querySelector('.toolbox-weather-mode-label');
        if (label) label.textContent = t(`weather.mode.${option.dataset.weatherMode}`);
      }
      coordinates.relabel();
      attachments.relabel();
      exportBack.querySelector('span').textContent = t('toolbox.back');
      exportView.querySelector('.toolbox-subtitle').textContent = t('export.panel');
      exportView.querySelector('.toolbox-subhint').textContent = t('export.panelHint');
      exportSettingsPanel?.relabel();
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
