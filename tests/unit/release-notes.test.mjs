import test from 'node:test';
import assert from 'node:assert/strict';
import releaseNotes from '../../scripts/release-notes.cjs';

const changelog = `# Changelog

## 1.2.0 — 2026-01-02 · Feature

### Added

- A useful feature.

## 1.1.1 — 2026-01-01 · Fix

- Previous notes.
`;

test('release notes contain only the requested changelog section', () => {
  assert.equal(releaseNotes.extractReleaseNotes(changelog, '1.2.0'),
    '### Added\n\n- A useful feature.\n');
});

test('release note extraction rejects a missing version', () => {
  assert.throws(() => releaseNotes.extractReleaseNotes(changelog, '9.9.9'), /no section/);
});

test('release note extraction refuses unfinished placeholders', () => {
  const unfinished = '## 2.0.0 — 2026-01-03 · TODO\n\n- （这一版改了什么）\n';
  assert.throws(() => releaseNotes.extractReleaseNotes(unfinished, '2.0.0'), /TODO/);
});

test('cumulative notes use the curated current section and omit superseded history', () => {
  const cumulative = `# Changelog

## 1.2.0 — 2026-01-02

- Current fix.

## 1.1.1 — 2026-01-01

- Earlier fix.

## 1.1.0 — 2026-01-01

- New feature.

## 1.0.0 — 2025-12-31

- Previous public release.
`;
  const notes = releaseNotes.extractReleaseNotesSince(cumulative, '1.2.0', 'v1.0.0');
  assert.match(notes, /Since v1\.0\.0/);
  assert.match(notes, /Current fix/);
  assert.doesNotMatch(notes, /Earlier fix/);
  assert.doesNotMatch(notes, /New feature/);
  assert.doesNotMatch(notes, /Previous public release/);
});
