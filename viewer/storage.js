const PREFIX = 'trailviewer.';
const LEGACY_PREFIX = 'gpxviewer.';

function fullKey(name, prefix = PREFIX) {
  return `${prefix}${name}`;
}

export function readStored(name) {
  const key = fullKey(name);
  const legacyKey = fullKey(name, LEGACY_PREFIX);
  try {
    const current = localStorage.getItem(key);
    if (current !== null) return current;
    const legacy = localStorage.getItem(legacyKey);
    if (legacy === null) return null;
    localStorage.setItem(key, legacy);
    localStorage.removeItem(legacyKey);
    return legacy;
  } catch {
    return null;
  }
}

export function writeStored(name, value) {
  const key = fullKey(name);
  try {
    localStorage.setItem(key, value);
    localStorage.removeItem(fullKey(name, LEGACY_PREFIX));
    return true;
  } catch {
    return false;
  }
}

export function removeStored(name) {
  try {
    localStorage.removeItem(fullKey(name));
    localStorage.removeItem(fullKey(name, LEGACY_PREFIX));
  } catch {
    // Storage can be disabled; callers keep working with defaults.
  }
}

export function storageKey(name) {
  return fullKey(name);
}
