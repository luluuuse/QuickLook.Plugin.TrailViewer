import test from 'node:test';
import assert from 'node:assert/strict';
import version from '../../scripts/version.cjs';

test('semantic versions reject leading zeroes', () => {
  assert.equal(version.parse('01.2.3'), null);
  assert.equal(version.parse('1.02.3'), null);
  assert.equal(version.parse('1.2.03'), null);
});

test('prerelease precedence follows semantic versioning', () => {
  assert.ok(version.compare('1.17.0-beta.1', '1.17.0-beta.2') < 0);
  assert.ok(version.compare('1.17.0-beta.9', '1.17.0-rc.1') < 0);
  assert.ok(version.compare('1.17.0-rc.1', '1.17.0') < 0);
});

test('release preparation increments the requested component', () => {
  assert.equal(version.next('1.16.7', 'patch').version, '1.16.8');
  assert.equal(version.next('1.16.7', 'minor').version, '1.17.0');
  assert.equal(version.next('1.16.7', 'major').version, '2.0.0');
});

test('an rc release candidate becomes the matching stable patch', () => {
  assert.equal(version.next('1.17.0-rc.1', 'patch').version, '1.17.0');
});

test('a prerelease can be added to the next requested release', () => {
  assert.equal(version.next('1.16.7', 'minor', 'beta.1').version, '1.17.0-beta.1');
});
