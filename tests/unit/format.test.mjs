import test from 'node:test';
import assert from 'node:assert/strict';

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { languages: ['en-US'], language: 'en-US' },
});
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
};

const format = await import('../../viewer/format.js');
const i18n = await import('../../viewer/i18n.js');

test('distances switch to kilometres at one thousand metres', () => {
  i18n.setLang('en');
  assert.equal(format.formatDistance(999), '999 m');
  assert.equal(format.formatDistance(1000), '1.00 km');
});

test('durations preserve sub-minute seconds', () => {
  i18n.setLang('en');
  assert.equal(format.formatDuration(12), '12 s');
  assert.equal(format.formatDuration(65), '1 min 5 s');
});

test('missing elevation is a dash rather than zero', () => {
  assert.equal(format.formatElevation(null), '\u2014');
});
