import { symbolMarkup } from './icons.js';

export const SNAP_RETICLE_SIZE = 18;

/** Maps each snappable target kind to its standardized data-symbol glyph in icons.js. */
export const SNAP_SYMBOL_NAMES = Object.freeze({
  marker: 'snap-marker',
  measure: 'snap-measure',
  track: 'snap-track',
});

/** Maps each snappable target kind to its bilingual label key in i18n.js. */
export const SNAP_LABEL_KEYS = Object.freeze({
  marker: 'measure.snapMarker',
  measure: 'measure.snapPoint',
  track: 'measure.snapTrack',
});

export function snapSymbolName(kind) {
  return Object.hasOwn(SNAP_SYMBOL_NAMES, kind) ? SNAP_SYMBOL_NAMES[kind] : null;
}

export function snapLabelKey(kind) {
  return Object.hasOwn(SNAP_LABEL_KEYS, kind) ? SNAP_LABEL_KEYS[kind] : null;
}

function readLon(target) {
  return Number(target?.lon ?? target?.lng);
}

/**
 * Builds one non-interactive Leaflet marker for a standardized snap reticle.
 * Reused by live hover previews, waypoint click selection, and snapped coordinate highlights.
 */
export function createSnapReticleMarker(L, target, {
  kind = target?.kind,
  className = '',
  animate = true,
  zIndexOffset = 2200,
} = {}) {
  const symbolName = snapSymbolName(kind);
  if (!symbolName || !target) return null;
  const lat = Number(target.lat);
  const lon = readLon(target);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const half = SNAP_RETICLE_SIZE / 2;
  const extra = className ? ` ${className}` : '';
  const classes = `snap-indicator snap-indicator-${kind}${extra}${animate ? ' is-animated' : ''}`;
  return L.marker([lat, lon], {
    interactive: false,
    keyboard: false,
    pane: 'markerPane',
    zIndexOffset,
    icon: L.divIcon({
      className: classes,
      html: `<span class="snap-reticle" data-snap-kind="${kind}">${symbolMarkup(symbolName, {
        width: SNAP_RETICLE_SIZE,
        height: SNAP_RETICLE_SIZE,
        className: 'data-symbol snap-symbol',
      })}</span>`,
      iconSize: [SNAP_RETICLE_SIZE, SNAP_RETICLE_SIZE],
      iconAnchor: [half, half],
    }),
  });
}

function sameTarget(a, b) {
  return Boolean(a && b && a.kind === b.kind && a.lat === b.lat && a.lon === readLon(b));
}

/**
 * Standardized hover snap indicator shared across map tools (distance measurement, coordinate picker).
 * Keeps the reticle and lightweight label stable while the pointer stays locked to the same target.
 */
export function createSnapIndicator({
  L,
  map,
  t,
  labelClassName = 'snap-label',
}) {
  const layer = L.layerGroup().addTo(map);
  let current = null;

  function hide() {
    if (!current) return;
    current = null;
    layer.clearLayers();
  }

  function show(target, { force = false, animate = true } = {}) {
    if (!target || target.kind === 'free' || !snapSymbolName(target.kind)) {
      hide();
      return;
    }
    if (!force && sameTarget(current, target)) return;
    current = { lat: Number(target.lat), lon: readLon(target), kind: target.kind };
    layer.clearLayers();
    const reticle = createSnapReticleMarker(L, current, { kind: current.kind, animate });
    reticle?.addTo(layer);
    const key = snapLabelKey(current.kind);
    if (key) {
      L.marker([current.lat, current.lon], {
        interactive: false,
        keyboard: false,
        pane: 'markerPane',
        zIndexOffset: 2200,
        icon: L.divIcon({
          className: labelClassName,
          html: `<span data-snap-kind="${current.kind}">${t(key)}</span>`,
          iconAnchor: [-12, 22],
        }),
      }).addTo(layer);
    }
  }

  function relabel() {
    if (!current) return;
    show(current, { force: true, animate: false });
  }

  function destroy() {
    hide();
    map.removeLayer(layer);
  }

  return {
    show,
    hide,
    relabel,
    destroy,
    current: () => (current ? { ...current } : null),
  };
}
