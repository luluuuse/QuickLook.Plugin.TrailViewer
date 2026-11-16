export const ICON_STROKE = 1.75;
export const ICON_VIEWBOX = '0 0 24 24';
export const DEFAULT_ICON_SIZE = 16;
export const COMPACT_ICON_SIZE = 12;

// All interface glyphs use the same open 24-unit grid, currentColor stroke and no fill. Keep this registry as
// the only source of application-owned UI icon paths.
const UI_ICONS = Object.freeze({
  toolbox: '<path d="M3 7h18v13H3z"/><path d="M8 7V4h8v3"/><path d="M3 12h18"/>'
    + '<path d="M9.5 12v2h5v-2"/>',
  ruler: '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0'
    + 'L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/>'
    + '<path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/>'
    + '<path d="m17.5 15.5 2-2"/>',
  'image-down': '<path d="M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10'
    + 'l-3.1-3.1a2 2 0 0 0-2.814.014L6 21"/><path d="m14 19 3 3v-5.5"/>'
    + '<path d="m17 22 3-3"/><circle cx="9" cy="9" r="2"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  locate: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5"/>'
    + '<path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/>'
    + '<path d="m3 16 9 5 9-5"/>',
  settings: '<circle cx="12" cy="12" r="3"/>'
    + '<path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1'
    + 'M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  pin: '<path d="M12 21s7-6.2 7-13a7 7 0 0 0-14 0c0 6.8 7 13 7 13Z"/>'
    + '<circle cx="12" cy="8" r="2.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/>'
    + '<circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  'finish-section': '<path d="M3 12h7M14 12h7M9 7v10M15 7v10"/>',
  'center-point': '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5"/>'
    + '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  undo: '<path d="m9 7-5 5 5 5"/><path d="M4 12h9a6 6 0 0 1 6 6"/>',
  redo: '<path d="m15 7 5 5-5 5"/><path d="M20 12h-9a6 6 0 0 0-6 6"/>',
  clear: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m6 7 1 14h10l1-14"/>'
    + '<path d="M10 11v6M14 11v6"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  route: '<path d="M4 19c4-8 7 2 11-6 1.3-2.7 3-4 5-4"/>'
    + '<circle cx="4" cy="19" r="1.5"/><circle cx="20" cy="9" r="1.5"/>',
  filter: '<path d="M4 5h16l-6 7v6l-4 2v-8Z"/>',
  edit: '<path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10Z"/>'
    + '<path d="m13.5 8 3 3"/>',
  'arrow-left': '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  warning: '<path d="M12 3 2.8 20h18.4Z"/><path d="M12 9v5"/><path d="M12 17.5v.01"/>',
  activity: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1'
    + 'a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/>',
  'circle-help': '<circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.5 2.5 0 1 1 3.7 2.2'
    + 'c-.9.5-1.4 1.1-1.4 2.1"/><path d="M12 17v.01"/>',
});

const DATA_SYMBOLS = Object.freeze({
  waypoint: {
    viewBox: '0 0 30 34',
    body: '<path class="symbol-fill" d="M12 1C6 1 1.5 5.6 1.5 11.5 1.5 19.5 12 33 12 33'
      + 's10.5-13.5 10.5-21.5C22.5 5.6 18 1 12 1Z"/>'
      + '<circle class="symbol-hole" cx="12" cy="11.5" r="4"/>',
  },
  camera: {
    viewBox: '0 0 24 24',
    body: '<path class="symbol-fill" d="M4 7h4l1.5-2h5L16 7h4v12H4Z"/>'
      + '<circle class="symbol-detail" cx="12" cy="13" r="3"/>',
  },
  direction: {
    viewBox: '0 0 24 24',
    body: '<path class="symbol-fill" d="M12 3 20 20 12 16 4 20Z"/>',
  },
  warning: {
    viewBox: '0 0 24 24',
    body: '<path class="symbol-fill" d="M12 3 2.8 20h18.4Z"/>'
      + '<path class="symbol-detail" d="M12 9v5M12 17.5v.01"/>',
  },
  anomaly: {
    viewBox: '0 0 24 24',
    body: '<path class="symbol-detail" d="M3 12h4l2-6 4 12 2-6h6"/>',
  },
});

export const UI_ICON_NAMES = Object.freeze(Object.keys(UI_ICONS));
export const DATA_SYMBOL_NAMES = Object.freeze(Object.keys(DATA_SYMBOLS));

function dimensions(size) {
  const value = Number(size);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_ICON_SIZE;
}

function attr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Static SVG markup for trusted application icon names. Unknown names fail visibly but safely. */
export function iconMarkup(name, {
  size = DEFAULT_ICON_SIZE,
  className = 'ui-icon',
  strokeWidth = ICON_STROKE,
} = {}) {
  const resolved = Object.hasOwn(UI_ICONS, name) ? name : 'circle-help';
  const pixels = dimensions(size);
  const base = className.split(/\s+/).includes('ui-icon') ? className : `ui-icon ${className}`;
  const classes = `${base}${pixels <= COMPACT_ICON_SIZE ? ' icon-compact' : ''}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ICON_VIEWBOX}" width="${pixels}"`
    + ` height="${pixels}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}"`
    + ` stroke-linecap="round" stroke-linejoin="round" class="${attr(classes)}"`
    + ` data-icon="${resolved}" aria-hidden="true">${UI_ICONS[resolved]}</svg>`;
}

/**
 * SVG element for DOM-based controls and table headings.
 * @returns {SVGElement}
 */
export function iconElement(name, {
  size = DEFAULT_ICON_SIZE,
  className = 'ui-icon',
  strokeWidth = ICON_STROKE,
} = {}) {
  const host = document.createElement('span');
  host.innerHTML = iconMarkup(name, { size, className, strokeWidth });
  const icon = host.firstElementChild;
  if (!(icon instanceof SVGElement)) throw new Error(`icon ${name} could not be created`);
  return icon;
}

export function setIcon(target, name, options = {}) {
  if (!(target instanceof Element)) return null;
  target.replaceChildren(iconElement(name, options));
  return target.firstElementChild;
}

/** Semantic map symbols keep their fills; the detail strokes stay consistent with the UI line language. */
export function symbolMarkup(name, {
  width = 16,
  height = width,
  className = 'data-symbol',
  extra = '',
} = {}) {
  const resolved = Object.hasOwn(DATA_SYMBOLS, name) ? name : 'warning';
  const symbol = DATA_SYMBOLS[resolved];
  const w = dimensions(width);
  const h = dimensions(height);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${symbol.viewBox}" width="${w}"`
    + ` height="${h}" class="${attr(className)}" data-symbol="${resolved}" aria-hidden="true">`
    + `${symbol.body}${extra}</svg>`;
}

/** @returns {SVGElement} */
export function symbolElement(name, options = {}) {
  const host = document.createElement('span');
  host.innerHTML = symbolMarkup(name, options);
  const symbol = host.firstElementChild;
  if (!(symbol instanceof SVGElement)) throw new Error(`symbol ${name} could not be created`);
  return symbol;
}

/** Replaces Leaflet's native text glyphs without touching the vendored stylesheet or script. */
/**
 * @param {any} map
 * @param {{closeLabel?: string | (() => string)}} [options]
 */
export function installLeafletIcons(map, { closeLabel = 'Close' } = {}) {
  const container = map.getContainer();
  const zoomIn = container.querySelector('.leaflet-control-zoom-in');
  const zoomOut = container.querySelector('.leaflet-control-zoom-out');
  if (zoomIn) setIcon(zoomIn, 'plus');
  if (zoomOut) setIcon(zoomOut, 'minus');

  map.on('popupopen', ({ popup }) => {
    requestAnimationFrame(() => {
      const close = popup.getElement()?.querySelector('.leaflet-popup-close-button');
      if (close && !close.querySelector('svg')) setIcon(close, 'close');
      const label = typeof closeLabel === 'function' ? closeLabel() : closeLabel;
      close?.setAttribute('aria-label', label);
    });
  });
}
