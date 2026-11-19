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
  'overlay-export': '<path d="M3 6.5 8.5 4l7 2.5L21 4v13.5L15.5 20l-7-2.5L3 20Z"/>'
    + '<path d="M8.5 4v13.5M15.5 6.5V20"/>',
  'photo-export': '<rect x="4" y="6" width="13" height="12" rx="2"/>'
    + '<path d="M7 3h10a3 3 0 0 1 3 3v8"/>'
    + '<path d="m5 16 3.5-3.5 2.5 2.5 2-2 3.5 3.5"/>',
  'image-export-all': '<path d="M7.2 17h9.4a4.4 4.4 0 0 0 .3-8.8A6 6 0 0 0 5.4 9.4'
    + ' 3.9 3.9 0 0 0 7.2 17Z"/><path d="M12 9.5v6"/><path d="m9.5 13 2.5 2.5 2.5-2.5"/>',
  'image-export-local': '<path d="M3 6h7l2 2h9v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>'
    + '<path d="M12 9v7"/><path d="m9.5 13.5 2.5 2.5 2.5-2.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/>'
    + '<path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  coordinates: '<circle cx="12" cy="12" r="5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>'
    + '<circle cx="12" cy="12" r="1.5"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  locate: '<path d="M9 4H6a2 2 0 0 0-2 2v3M15 4h3a2 2 0 0 1 2 2v3'
    + 'M20 15v3a2 2 0 0 1-2 2h-3M4 15v3a2 2 0 0 0 2 2h3"/>'
    + '<path d="M8 8h2M14 8h2M8 16h2M14 16h2"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/>'
    + '<path d="m3 16 9 5 9-5"/>',
  'map-grid': '<rect x="3" y="3" width="18" height="18" rx="2"/>'
    + '<path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  settings: '<path d="M9.4 3h5.2l.7 2.2 1.9 1.1 2.2-.7 2.6 4.4-1.6 1.6v2.8'
    + 'l1.6 1.6-2.6 4.4-2.2-.7-1.9 1.1-.7 2.2H9.4l-.7-2.2-1.9-1.1-2.2.7'
    + 'L.7 17l1.6-1.6v-2.8L.7 11l2.6-4.4 2.2.7 1.9-1.1Z"/>'
    + '<circle cx="12" cy="12" r="3.2"/>',
  'layer-road': '<path d="M3 19c5 0 4-9 9-9s4-7 9-7"/>'
    + '<circle cx="3" cy="19" r="1.8"/><circle cx="21" cy="3" r="1.8"/>',
  'layer-terrain': '<path d="M3 16c3-5 6-6 9-2s5 2 9-1"/>'
    + '<path d="M3 20c4-7 10-8 18-2"/><path d="M8 12c1-3 3-4 5-3"/>',
  'layer-satellite': '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/>'
    + '<path d="M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/>',
  'layer-custom': '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/>'
    + '<circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
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
  // A two-way arrow: the language switch is a toggle, not a menu, so it says "this flips" rather than
  // "pick one of two".
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/>'
    + '<path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18"/>',
  warning: '<path d="M12 3 2.8 20h18.4Z"/><path d="M12 9v5"/><path d="M12 17.5v.01"/>',
  activity: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1'
    + 'a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/>',
  'circle-help': '<circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.5 2.5 0 1 1 3.7 2.2'
    + 'c-.9.5-1.4 1.1-1.4 2.1"/><path d="M12 17v.01"/>',
  weather: '<path d="M7.5 18a4.5 4.5 0 0 1-.3-8.99 6 6 0 0 1 11.3 1.6A3.9 3.9 0 0 1 17.6 18Z"/>'
    + '<path d="M9.5 21h5"/><path d="M11 15.5l-1.5 2.5"/><path d="M15 15.5 13.5 18"/>',
});

/** The selected map-pin weather marks keep semantic colour while sharing one pin silhouette. */
const WEATHER_MARKS = Object.freeze({
  start: '<path d="M12 22s7-6.2 7-13a7 7 0 0 0-14 0c0 6.8 7 13 7 13Z"'
    + ' fill="#18c964" stroke="#0d3d21" stroke-width="1.5"/>'
    + '<path d="m9.8 6.6 5.2 2.9-5.2 2.9Z" fill="#0d3d21" stroke="none"/>',
  end: '<path d="M12 22s7-6.2 7-13a7 7 0 0 0-14 0c0 6.8 7 13 7 13Z"'
    + ' fill="#e5243b" stroke="#3d0d13" stroke-width="1.5"/>'
    + '<rect x="8.6" y="6.6" width="6.8" height="6.8" rx="1" fill="#3d0d13" stroke="none"/>',
  highest: '<path d="M12 22s7-6.2 7-13a7 7 0 0 0-14 0c0 6.8 7 13 7 13Z"'
    + ' fill="#f5c400" stroke="#3d3108" stroke-width="1.5"/>'
    + '<path d="m7.5 12 2.5-3 1.8 1.7 1.4-1.8 3.3 3.1" fill="none"'
    + ' stroke="#3d3108" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
});

export const WEATHER_MARK_NAMES = Object.freeze(Object.keys(WEATHER_MARKS));
const templateCache = new Map();

/** Static SVG markup for a weather point marker. Unknown names fall back to the start marker. */
export function weatherMarkMarkup(name, { size = DEFAULT_ICON_SIZE, className = 'weather-mark' } = {}) {
  const resolved = Object.hasOwn(WEATHER_MARKS, name) ? name : 'start';
  const pixels = dimensions(size);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ICON_VIEWBOX}" width="${pixels}"`
    + ` height="${pixels}" class="${attr(className)}" data-weather-mark="${resolved}" aria-hidden="true">`
    + `${WEATHER_MARKS[resolved]}</svg>`;
}

/** @returns {SVGElement} */
export function weatherMarkElement(name, options = {}) {
  const resolved = Object.hasOwn(WEATHER_MARKS, name) ? name : 'start';
  const size = dimensions(options.size);
  const className = options.className || 'weather-mark';
  return elementOfType(
    `weather:${resolved}:${size}:${className}`,
    weatherMarkMarkup(resolved, { size, className }),
    `weather mark ${name}`,
  );
}

const DATA_SYMBOLS = Object.freeze({
  waypoint: {
    viewBox: '0 0 24 32',
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
  // Standardized map-snapping reticles differentiated by target kind (marker: diamond, measure: square, track: cross).
  'snap-marker': {
    viewBox: '0 0 18 18',
    body: '<path class="snap-casing" d="M9 2.2 15.8 9 9 15.8 2.2 9Z"/>'
      + '<path class="snap-stroke" d="M9 2.2 15.8 9 9 15.8 2.2 9Z"/>'
      + '<circle class="snap-dot" cx="9" cy="9" r="1.5"/>',
  },
  'snap-measure': {
    viewBox: '0 0 18 18',
    body: '<rect class="snap-casing" x="3.5" y="3.5" width="11" height="11" rx="1"/>'
      + '<rect class="snap-stroke" x="3.5" y="3.5" width="11" height="11" rx="1"/>'
      + '<circle class="snap-dot" cx="9" cy="9" r="1.5"/>',
  },
  'snap-track': {
    viewBox: '0 0 18 18',
    body: '<path class="snap-casing" d="M9 2.2V6.5M9 11.5V15.8M2.2 9H6.5M11.5 9H15.8"/>'
      + '<path class="snap-stroke" d="M9 2.2V6.5M9 11.5V15.8M2.2 9H6.5M11.5 9H15.8"/>'
      + '<circle class="snap-dot" cx="9" cy="9" r="1.5"/>',
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

function elementOfType(cacheKey, markup, label) {
  let template = templateCache.get(cacheKey);
  if (!template) {
    template = document.createElement('template');
    template.innerHTML = markup;
    templateCache.set(cacheKey, template);
  }
  const element = template.content.firstElementChild.cloneNode(true);
  if (!(element instanceof SVGElement)) throw new Error(`${label} could not be created`);
  return element;
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
  const resolved = Object.hasOwn(UI_ICONS, name) ? name : 'circle-help';
  const pixels = dimensions(size);
  return elementOfType(
    `icon:${resolved}:${pixels}:${className}:${strokeWidth}`,
    iconMarkup(resolved, { size: pixels, className, strokeWidth }),
    `icon ${name}`,
  );
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
  const resolved = Object.hasOwn(DATA_SYMBOLS, name) ? name : 'warning';
  const width = dimensions(options.width);
  const height = options.height === undefined ? width : dimensions(options.height);
  const className = options.className || 'data-symbol';
  const extra = options.extra || '';
  return elementOfType(
    `symbol:${resolved}:${width}:${height}:${className}:${extra}`,
    symbolMarkup(resolved, { width, height, className, extra }),
    `symbol ${name}`,
  );
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
