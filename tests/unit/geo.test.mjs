import assert from 'node:assert/strict';
import test from 'node:test';
import { bearingDegrees, distanceMeters } from '../../viewer/geo.js';

test('distanceMeters returns zero for identical coordinates and accurate great-circle spans', () => {
  assert.equal(distanceMeters({ lat: 30.5, lon: 114.3 }, { lat: 30.5, lon: 114.3 }), 0);

  const oneDegreeLonAtEquator = distanceMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
  assert.ok(Math.abs(oneDegreeLonAtEquator - 111195.08) < 1, `${oneDegreeLonAtEquator}`);

  const oneDegreeLat = distanceMeters({ lat: 30, lon: 120 }, { lat: 31, lon: 120 });
  assert.ok(Math.abs(oneDegreeLat - 111195.08) < 1, `${oneDegreeLat}`);
});

test('distanceMeters handles anti-meridian crossings and antipodal poles without NaN', () => {
  const crossing = distanceMeters({ lat: 0, lon: 179.9 }, { lat: 0, lon: -179.9 });
  assert.ok(Math.abs(crossing - 22239.02) < 5, `${crossing}`);

  const poleToPole = distanceMeters({ lat: 90, lon: 0 }, { lat: -90, lon: 180 });
  assert.ok(Number.isFinite(poleToPole));
  assert.ok(Math.abs(poleToPole - Math.PI * 6371008.8) < 1, `${poleToPole}`);

  const northPoleRing = distanceMeters({ lat: 90, lon: 15 }, { lat: 90, lon: -120 });
  assert.ok(northPoleRing < 1e-6, `${northPoleRing}`);
});

test('bearingDegrees normalizes cardinal directions to [0, 360)', () => {
  const north = bearingDegrees({ lat: 30, lon: 114 }, { lat: 31, lon: 114 });
  const east = bearingDegrees({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
  const south = bearingDegrees({ lat: 31, lon: 114 }, { lat: 30, lon: 114 });
  const west = bearingDegrees({ lat: 0, lon: 1 }, { lat: 0, lon: 0 });

  assert.ok(Math.abs(north - 0) < 1e-9, `${north}`);
  assert.ok(Math.abs(east - 90) < 1e-9, `${east}`);
  assert.ok(Math.abs(south - 180) < 1e-9, `${south}`);
  assert.ok(Math.abs(west - 270) < 1e-9, `${west}`);
});
