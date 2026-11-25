import { readStored, writeStored } from './storage.js';

export const THEME_KEY = 'theme';
export const THEMES = Object.freeze(['swiss', 'slate', 'classic']);
export const DEFAULT_THEME = 'swiss';

/** @param {string | null | undefined} value */
export function normalizeTheme(value) {
  return typeof value === 'string' && THEMES.includes(value) ? value : null;
}

/** @param {URLSearchParams | null} [params] */
export function savedTheme(params = null) {
  const fromHost = normalizeTheme(params?.get(THEME_KEY));
  if (fromHost) return fromHost;
  return normalizeTheme(readStored(THEME_KEY)) || DEFAULT_THEME;
}

let activeTheme = DEFAULT_THEME;
const listeners = new Set();

export function getTheme() {
  return activeTheme;
}

/** @param {string} theme */
export function applyTheme(theme) {
  const resolved = normalizeTheme(theme) || DEFAULT_THEME;
  activeTheme = resolved;
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dataset.theme = resolved;
  }
  return resolved;
}

/** @param {URLSearchParams | null} [params] */
export function initTheme(params = null) {
  return applyTheme(savedTheme(params));
}

/** @param {string} next @param {{ remember?: boolean }} [options] */
export function setTheme(next, { remember = true } = {}) {
  const resolved = normalizeTheme(next);
  if (!resolved || resolved === activeTheme) return false;
  applyTheme(resolved);
  if (remember) writeStored(THEME_KEY, resolved);
  for (const listener of listeners) listener(resolved);
  return true;
}

/** @param {(theme: string) => void} listener */
export function onThemeChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
