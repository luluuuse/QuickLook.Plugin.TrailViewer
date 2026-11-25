import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cartographicScale,
  formatScaleDenominator,
  roundScaleDenominator,
} from '../../viewer/swiss-scale.js';

test('roundScaleDenominator snaps smoothly across topographic zoom ranges', () => {
  assert.equal(roundScaleDenominator(480), 500);
  assert.equal(roundScaleDenominator(2410), 2500);
  assert.equal(roundScaleDenominator(12380), 12500);
  assert.equal(roundScaleDenominator(24720), 25000);
  assert.equal(roundScaleDenominator(51200), 51000);
  assert.equal(roundScaleDenominator(248000), 250000);
});

test('formatScaleDenominator uses thin-space Swiss thousands grouping', () => {
  assert.equal(formatScaleDenominator(25000), '1 : 25\u2009000');
  assert.equal(formatScaleDenominator(50000), '1 : 50\u2009000');
  assert.equal(formatScaleDenominator(1000000), '1 : 1\u2009000\u2009000');
  assert.equal(formatScaleDenominator(0), '');
});

test('cartographicScale computes realistic topographic scale at Swiss alpine latitude', () => {
  // At 46.5 deg N and zoom 14, ~6.59 m/px => ~24,900 => 1 : 25 000 (classic Swiss LK25 sheet!)
  assert.equal(cartographicScale(14, 46.5), '1 : 25\u2009000');
  assert.equal(cartographicScale(13, 46.5), '1 : 50\u2009000');
  assert.equal(cartographicScale(NaN, 46.5), '');
});
