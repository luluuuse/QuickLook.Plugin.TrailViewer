// User-defined raster sources. The plugin ships no third-party endpoint: the URL template, its availability and
// its licence are the user's own responsibility. Everything here is local validation and local rendering.

const STORAGE_KEY = 'customLayers';
const MAX_ENTRIES = 20;
const MAX_URL_LENGTH = 2048;
const MAX_NAME_LENGTH = 60;
const MAX_ATTRIBUTION_LENGTH = 200;

const TILE_SIZES = Object.freeze([256, 512]);
const MIN_ZOOM = 0;
const MAX_ZOOM_LIMIT = 22;

/** Placeholders Leaflet needs to build a tile address. */
const REQUIRED_TOKENS = Object.freeze(['{z}', '{x}', '{y}']);

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function cleanText(value, max) {
  // Strip C0 controls one code point at a time; a character class would trip no-control-regex.
  let text = String(value ?? '');
  for (let code = 0; code < 0x20; code += 1) {
    text = text.split(String.fromCharCode(code)).join(' ');
  }
  return text.trim().slice(0, max);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

/**
 * Only HTTPS templates are accepted because the viewer CSP permits HTTPS images only. A javascript: or data:
 * template would either be blocked or, worse, be a way to smuggle something else in.
 */
export function validateTemplate(url) {
  const text = cleanText(url, MAX_URL_LENGTH)
    .replace(/\{\s*\$([xyz])\s*\}/gi, (_, token) => `{${token.toLowerCase()}}`);
  if (!text) return { ok: false, code: 'empty' };
  if (!/^https:\/\//i.test(text)) return { ok: false, code: 'scheme' };
  for (const token of REQUIRED_TOKENS) {
    if (!text.includes(token)) return { ok: false, code: 'token' };
  }
  if (/\s/.test(text)) return { ok: false, code: 'space' };
  try {
    const sample = text
      .replaceAll('{z}', '1')
      .replaceAll('{x}', '2')
      .replaceAll('{y}', '3')
      .replaceAll('{s}', 'a');
    new URL(sample);
  } catch {
    return { ok: false, code: 'syntax' };
  }
  return { ok: true, url: text };
}

/** Normalises one stored or submitted entry; returns null when the entry cannot be rendered. */
export function normalizeEntry(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const checked = validateTemplate(raw.url);
  if (!checked.ok) return null;
  const name = cleanText(raw.name, MAX_NAME_LENGTH) || `Source ${index + 1}`;
  const tileSize = TILE_SIZES.includes(Number(raw.tileSize)) ? Number(raw.tileSize) : 256;
  const minZoom = clampInt(raw.minZoom, MIN_ZOOM, MAX_ZOOM_LIMIT, 1);
  const maxZoom = clampInt(raw.maxZoom, MIN_ZOOM, MAX_ZOOM_LIMIT, 19);
  return {
    id: cleanText(raw.id, 40) || `custom.${Date.now().toString(36)}${index}`,
    name,
    url: checked.url,
    tileSize,
    minZoom: Math.min(minZoom, maxZoom),
    maxZoom: Math.max(minZoom, maxZoom),
    subdomains: cleanText(raw.subdomains, 16).replace(/[^A-Za-z0-9]/g, ''),
    attribution: cleanText(raw.attribution, MAX_ATTRIBUTION_LENGTH),
    tms: raw.tms === true,
  };
}

/** Reads the host's durable list when supplied, otherwise the legacy browser storage fallback. */
export function loadCustomLayers(readStored, hosted = null) {
  let parsed = null;
  if (Array.isArray(hosted)) {
    parsed = hosted;
  } else {
    try {
      parsed = JSON.parse(readStored(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .slice(0, MAX_ENTRIES)
    .map((entry, index) => normalizeEntry(entry, index))
    .filter(Boolean);
}

export function saveCustomLayers(writeStored, entries) {
  const list = (entries || [])
    .slice(0, MAX_ENTRIES)
    .map((entry, index) => normalizeEntry(entry, index))
    .filter(Boolean);
  writeStored(STORAGE_KEY, JSON.stringify(list));
  return list;
}

/** A Leaflet layer for one entry. Retina-sized tiles need a negative zoom offset to stay 1:1 on screen. */
export function createCustomLayer(L, entry) {
  const options = {
    minZoom: entry.minZoom,
    maxZoom: entry.maxZoom,
    attribution: escapeHtml(entry.attribution || ''),
    tms: entry.tms,
    tileSize: entry.tileSize,
  };
  if (entry.subdomains) options.subdomains = entry.subdomains;
  if (entry.tileSize === 512) options.zoomOffset = -1;
  return L.tileLayer(entry.url, options);
}

export const CUSTOM_LIMITS = Object.freeze({
  maxEntries: MAX_ENTRIES,
  maxUrlLength: MAX_URL_LENGTH,
  maxNameLength: MAX_NAME_LENGTH,
  maxAttributionLength: MAX_ATTRIBUTION_LENGTH,
  tileSizes: TILE_SIZES,
});
