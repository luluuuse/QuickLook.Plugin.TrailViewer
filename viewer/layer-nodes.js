import { MAP_OVERLAYS, PROVIDER_NODES } from './layer-registry.js';

const STORAGE_KEY = 'layerNodes';
const OVERLAYS_STORAGE_KEY = 'layerOverlays';

/** Reads enabled transparent overlay IDs from storage. */
export function loadOverlayPreferences(read) {
  try {
    const raw = read?.(OVERLAYS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const validIds = new Set(MAP_OVERLAYS.map((o) => o.id));
    return new Set(parsed.filter((id) => typeof id === 'string' && validIds.has(id)));
  } catch {
    return new Set();
  }
}

/** Persists enabled transparent overlay IDs. */
export function saveOverlayPreferences(write, activeSet) {
  try {
    write?.(OVERLAYS_STORAGE_KEY, JSON.stringify([...(activeSet || [])]));
  } catch {
    // Storage may be unavailable in restricted contexts.
  }
}

/** Reads saved per-provider node selections, keeping only known provider/node IDs. */
export function loadNodePreferences(read) {
  try {
    const raw = read?.(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out = {};
    for (const [providerKey, nodes] of Object.entries(PROVIDER_NODES)) {
      const value = parsed[providerKey];
      if (typeof value === 'string' && nodes.some((node) => node.id === value)) {
        out[providerKey] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Persists per-provider node selections. */
export function saveNodePreferences(write, prefs) {
  try {
    write?.(STORAGE_KEY, JSON.stringify(prefs || {}));
  } catch {
    // Storage may be unavailable in restricted contexts.
  }
}

/** Builds one concrete z=10 tile URL for connectivity probing. */
export function probeUrlFor(spec, directKey = '') {
  if (spec?.requiresKey === 'tianditu') {
    if (!directKey) return null;
    return 'https://t0.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
      + '&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX=10&TILEROW=404&TILECOL=832'
      + `&tk=${encodeURIComponent(directKey)}`;
  }
  const template = spec?.url;
  if (!template) return null;
  return template
    .replace('{s}', 'a')
    .replace('{z}', '10')
    .replace('{x}', '832')
    .replace('{y}', '404');
}

/**
 * Probes one tile endpoint by loading a single image tile with a bounded timeout.
 * Image loading avoids CORS rejections while verifying that the server actually returns a valid tile image.
 * @param {string} url
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: boolean, ms: number }>}
 */
export function probeTileNode(url, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    const started = performance.now();
    const img = new Image();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      img.src = '';
      resolve({ ok, ms: Math.max(1, Math.round(performance.now() - started)) });
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.referrerPolicy = 'no-referrer';
    img.src = url;
  });
}
