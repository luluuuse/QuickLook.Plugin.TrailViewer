import { iconElement, iconMarkup, setIcon } from './icons.js';
import { LANG_NAMES } from './i18n.js';
import { createCoordinateTool } from './toolbox-coordinates.js';
import { createAttachmentTool } from './toolbox-attachments.js';
import { createMeasureTool } from './toolbox-measure.js';
import { createToolboxMain } from './toolbox-main.js';

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
  onEdit,
  lang = () => 'zh',
  setLang = () => false,
  onOpen,
  onLayoutChange,
}) {
  const lifecycle = new AbortController();
  // Declared with their real signatures: the defaults below are zero-argument stubs, and TypeScript would
  // otherwise infer those stubs as the only shape the callers may use.
  /** @type {() => string} */
  const readLang = lang;
  /** @type {(next: string) => boolean} */
  const writeLang = setLang;
  let open = false;
  let button = null;
  let panel = null;
  let closeButton = null;
  let helpButton = null;
  let langButton = null;
  let langText = null;
  let shortcutsView = null;
  let shortcutsBack = null;
  const shortcutRows = [];
  let exportView = null;
  let exportBack = null;
  let exportSettingsPanel = null;
  let view = 'main';
  // Where the shortcut page goes back to. It is opened from any page, so the back action returns to that
  // page rather than always to the menu.
  let shortcutReturn = 'main';
  // The measure page is a mode, not just a page: entering measurement opens it, and only leaving measurement
  // closes it. Remembering the previous state keeps a back press from being undone by the next render.
  let measureWasActive = false;

  function showView(next) {
    if (next !== 'coordinate') coordinates.stop();
    view = next;
    render();
  }

  function toggleShortcuts() {
    if (view === 'shortcuts') {
      showView(shortcutReturn);
      return;
    }
    shortcutReturn = view;
    showView('shortcuts');
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
  const measureTool = createMeasureTool({
    el,
    t,
    formatDistance,
    measurement,
    map,
    // Back is navigation, not a mode change: the measured points and the measuring state stay as they are, so
    // the user can look at another tool and return to the same measurement.
    onBack: () => showView('main'),
  });
  const main = createToolboxMain({
    el,
    t,
    exportAvailable,
    weatherAvailable,
    weatherHasElevation,
    weatherModes,
    onMeasure: () => startMeasure(),
    onCoordinates: () => {
      if (measurement.active()) measurement.stop();
      showView('coordinate');
      coordinates.begin();
    },
    onExport: () => {
      if (measurement.active()) measurement.stop();
      showView('export');
      requestAnimationFrame(() => exportSettingsPanel?.focus());
    },
    onAttachments: () => {
      if (measurement.active()) measurement.stop();
      showView('attachments');
    },
    onEdit: () => onEdit?.(),
    onWeather: (mode) => onWeather?.(mode),
    onClose: () => closePanel(),
  });

  function render() {
    if (!panel) return;
    const summary = measurement.summary();
    const active = measurement.active();
    button?.classList.toggle('active', active);
    button?.setAttribute('aria-pressed', String(active));
    const description = active
      ? `${t('toolbox.toggle')} · ${t('measure.active')}`
      : t('toolbox.toggle');
    button?.setAttribute('title', description);
    button?.setAttribute('aria-label', description);

    coordinates.render();
    const attachmentCounts = attachments.render();
    main.render({ active, summary, attachmentCounts });
    measureTool.render();

    // Entering measurement switches to its page; leaving it closes that page. Both are the measuring mode's
    // own transitions, so a language switch or a layout refresh does not pull the page out from under the user.
    if (active && !measureWasActive) view = 'measure';
    else if (!active && measureWasActive && view === 'measure') view = 'main';
    measureWasActive = active;
    main.view.hidden = view !== 'main';
    measureTool.view.hidden = view !== 'measure';
    coordinates.view.hidden = view !== 'coordinate';
    attachments.view.hidden = view !== 'attachments';
    exportView.hidden = view !== 'export';
    shortcutsView.hidden = view !== 'shortcuts';
    helpButton.classList.toggle('active', view === 'shortcuts');
    helpButton.setAttribute('aria-pressed', String(view === 'shortcuts'));
    renderLanguage();
  }

  /**
   * One button, not a pair of options: a globe marks the control as a language switch and the glyph beside it
   * names the language in use, so a click flips to the other one. The tooltip names the target in that
   * language's own words -- "English" on a Chinese page, "中文" on an English one -- because naming it in the
   * current interface language only repeated what the button already said.
   */
  function renderLanguage() {
    if (!langButton) return;
    const current = readLang();
    const target = current === 'zh' ? 'en' : 'zh';
    langButton.title = LANG_NAMES[target];
    langButton.setAttribute('aria-label', t('toolbox.languageSwitch', {
      current: LANG_NAMES[current],
      target: LANG_NAMES[target],
    }));
    langText.textContent = current === 'zh' ? '中' : 'EN';
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
          ? measureTool.stopButton
          : view === 'coordinate'
            ? coordinates.view.querySelector('[data-coordinate="start"]:not(:disabled)')
              || coordinates.view.querySelector('[data-coordinate="center"]')
            : view === 'attachments'
              ? attachments.view.querySelector('.toolbox-back')
            : view === 'export'
              ? exportBack
              : view === 'shortcuts'
                ? shortcutsBack
                : main.measureButton;
        target?.focus({ preventScroll: true });
      });
    }
  }

  function closePanel({ restoreFocus = false } = {}) {
    if (!open) return;
    coordinates.stop();
    if (['coordinate', 'attachments', 'export', 'shortcuts'].includes(view)) view = 'main';
    open = false;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    onLayoutChange?.();
    if (restoreFocus && button.isConnected) button.focus({ preventScroll: true });
  }

  function startMeasure() {
    view = 'measure';
    measureTool.start();
    render();
    requestAnimationFrame(() => measureTool.focusFinish());
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
      // One control, one click: the button names the language in use and the arrow says it flips.
      langButton = el('button', 'toolbox-lang');
      langButton.type = 'button';
      langButton.dataset.lang = 'switch';
      langText = el('span', 'toolbox-lang-text', '');
      // Globe first, then the language in use: the icon says "this is about language", the glyph says which
      // one is on. One element each, so neither has to do two jobs.
      langButton.append(
        iconElement('globe', { size: 13, className: 'ui-icon toolbox-lang-icon' }),
        langText,
      );
      langButton.addEventListener('click', () => {
        writeLang(readLang() === 'zh' ? 'en' : 'zh');
      });
      helpButton = el('button', 'toolbox-help');
      helpButton.type = 'button';
      helpButton.dataset.toolbox = 'shortcuts';
      setIcon(helpButton, 'circle-help');
      helpButton.addEventListener('click', () => toggleShortcuts());
      closeButton = el('button', 'toolbox-close');
      closeButton.type = 'button';
      setIcon(closeButton, 'close');
      closeButton.addEventListener('click', () => closePanel({ restoreFocus: true }));
      header.append(heading, langButton, helpButton, closeButton);

      shortcutsView = el('section', 'toolbox-subview toolbox-shortcut-page');
      shortcutsView.hidden = true;
      shortcutsBack = el('button', 'toolbox-back');
      shortcutsBack.type = 'button';
      shortcutsBack.append(iconElement('arrow-left'), el('span', null, t('toolbox.back')));
      shortcutsBack.addEventListener('click', () => showView(shortcutReturn));
      const shortcutsTitle = el('h2', 'toolbox-subtitle', t('toolbox.help'));
      const shortcutsHint = el('p', 'toolbox-subhint', t('toolbox.helpHint'));
      // One two-column table: seven shortcuts in four rows, so the reference fits the panel without scrolling.
      const shortcutList = el('div', 'toolbox-shortcut-list');
      shortcutList.setAttribute('role', 'list');
      for (const [keys, labelKey] of [
        ['W', 'toolbox.shortcutMarkers'],
        ['S', 'toolbox.shortcutChrome'],
        ['A / D', 'toolbox.shortcutNav'],
        ['Q / E', 'toolbox.shortcutMap'],
        ['C', 'toolbox.shortcutLocate'],
        ['M', 'toolbox.shortcutMeasure'],
        ['T', 'toolbox.shortcutToolbox'],
        ['P', 'toolbox.shortcutProfile'],
        ['L', 'toolbox.shortcutColor'],
      ]) {
        const row = el('div', 'toolbox-shortcut-row');
        row.setAttribute('role', 'listitem');
        const key = el('kbd', 'control-key toolbox-shortcut-keys', keys);
        const label = el('span', 'toolbox-shortcut-label', t(labelKey));
        label.dataset.labelKey = labelKey;
        row.append(key, label);
        shortcutList.append(row);
        shortcutRows.push(label);
      }
      shortcutsView.append(shortcutsBack, shortcutsTitle, shortcutsHint, shortcutList);

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

      panel.append(
        header,
        main.view,
        coordinates.view,
        attachments.view,
        exportView,
        shortcutsView,
        measureTool.view,
      );
      helpButton.title = t('toolbox.help');
      helpButton.setAttribute('aria-label', t('toolbox.help'));
      helpButton.setAttribute('aria-pressed', 'false');
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
    // The shortcut page is opened from any page, so its back action has to return where it came from.
    toggleShortcuts,
    weatherMode: main.weatherMode,
    isWeatherModeEnabled: main.isWeatherModeEnabled,
    setWeatherMode: main.setWeatherMode,
    destroy() {
      lifecycle.abort();
      coordinates.destroy();
      map.off('click', closePanel);
    },
    relabel() {
      document.getElementById('toolbox-heading').textContent = t('toolbox.title');
      helpButton.title = t('toolbox.help');
      helpButton.setAttribute('aria-label', t('toolbox.help'));
      closeButton.title = t('toolbox.close');
      closeButton.setAttribute('aria-label', t('toolbox.close'));
      main.relabel();
      coordinates.relabel();
      attachments.relabel();
      exportBack.querySelector('span').textContent = t('toolbox.back');
      exportView.querySelector('.toolbox-subtitle').textContent = t('export.panel');
      exportView.querySelector('.toolbox-subhint').textContent = t('export.panelHint');
      shortcutsBack.querySelector('span').textContent = t('toolbox.back');
      shortcutsView.querySelector('.toolbox-subtitle').textContent = t('toolbox.help');
      shortcutsView.querySelector('.toolbox-subhint').textContent = t('toolbox.helpHint');
      for (const label of shortcutRows) label.textContent = t(label.dataset.labelKey);
      exportSettingsPanel?.relabel();
      measureTool.relabel();
      render();
      onLayoutChange?.();
    },
  };
}
