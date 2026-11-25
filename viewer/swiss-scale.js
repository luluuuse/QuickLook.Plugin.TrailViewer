// Live cartographic scale denominator (e.g. "1 : 25 000") inspired by swisstopo map sheets.
// Computed from Web Mercator ground resolution at the current map centre latitude and 96 CSS DPI.

const EQUATOR_METERS_PER_PIXEL_Z0 = 156543.03392;
const CSS_METERS_PER_PIXEL = 0.0254 / 96;

/**
 * Rounds a raw map scale denominator to clean cartographic steps.
 * @param {number} raw
 * @returns {number}
 */
export function roundScaleDenominator(raw) {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (raw < 1000) return Math.max(100, Math.round(raw / 50) * 50);
  if (raw < 5000) return Math.round(raw / 250) * 250;
  if (raw < 20000) return Math.round(raw / 500) * 500;
  if (raw < 100000) return Math.round(raw / 1000) * 1000;
  if (raw < 500000) return Math.round(raw / 5000) * 5000;
  if (raw < 2000000) return Math.round(raw / 25000) * 25000;
  return Math.round(raw / 100000) * 100000;
}

/**
 * Formats a positive integer denominator using Swiss thin-space thousands grouping (e.g. "1 : 25 000").
 * @param {number} denominator
 * @returns {string}
 */
export function formatScaleDenominator(denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) return '';
  const digits = String(Math.round(denominator));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
  return `1 : ${grouped}`;
}

/**
 * Computes the formatted cartographic scale string for a Leaflet zoom level and latitude.
 * @param {number} zoom
 * @param {number} latitude
 * @returns {string}
 */
export function cartographicScale(zoom, latitude) {
  if (!Number.isFinite(zoom) || !Number.isFinite(latitude)) return '';
  const clampedLat = Math.max(-85, Math.min(85, latitude));
  const metersPerPixel = (EQUATOR_METERS_PER_PIXEL_Z0 * Math.cos((clampedLat * Math.PI) / 180)) / (2 ** zoom);
  const denominator = roundScaleDenominator(metersPerPixel / CSS_METERS_PER_PIXEL);
  return formatScaleDenominator(denominator);
}

/**
 * Attaches a live Swiss-style cartographic scale denominator badge beside Leaflet's scale bar.
 * @param {{ on: Function, off: Function, getZoom: Function, getCenter: Function, _loaded?: boolean }} map
 * @param {{ getContainer: () => HTMLElement | null }} scaleControl
 * @returns {{ update: () => void, destroy: () => void }}
 */
export function attachSwissScaleRatio(map, scaleControl) {
  const container = scaleControl?.getContainer?.();
  if (!container) return { update() {}, destroy() {} };
  const badge = document.createElement('span');
  badge.className = 'swiss-scale-ratio';
  badge.setAttribute('aria-hidden', 'true');
  container.append(badge);

  const update = () => {
    if (map._loaded === false) {
      badge.hidden = true;
      return;
    }
    let center;
    let zoom;
    try {
      center = map.getCenter?.();
      zoom = map.getZoom?.();
    } catch {
      badge.hidden = true;
      return;
    }
    const label = cartographicScale(zoom, center?.lat ?? 0);
    badge.textContent = label;
    badge.hidden = !label;
  };

  map.on('zoomend', update);
  map.on('moveend', update);
  update();

  return {
    update,
    destroy() {
      map.off('zoomend', update);
      map.off('moveend', update);
      badge.remove();
    },
  };
}
