import assert from 'node:assert/strict';
import test from 'node:test';
import { URL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

globalThis.location = { href: 'https://app.test/viewer/index.html' };

const { attachmentCounts, attachmentItems, createAttachmentExporter } =
  await import('../../viewer/attachments.js');

test('attachment inventory separates embedded, inline and external images', () => {
  const src = 'https://file.test/tracks/album.kml';
  const gpx = {
    waypoints: [
      { name: 'Album', images: ['photo.png', 'data:image/png;base64,AAAA'] },
      { name: 'Remote', images: ['https://images.test/one.jpg', 'photo.png'] },
    ],
  };
  const photosOf = (point) => point.images.map((url) =>
    (/^(?:data:|https:)/.test(url) ? url : new URL(url, src).href));

  const items = attachmentItems(gpx, photosOf, src);
  assert.deepEqual(items.map(({ kind, name }) => ({ kind, name })), [
    { kind: 'embedded', name: 'Album' },
    { kind: 'inline', name: 'Album' },
    { kind: 'external', name: 'Remote' },
  ]);
  assert.deepEqual(attachmentCounts(items), { total: 3, embedded: 2, external: 1 });
});

test('duplicate photo URLs are exported once', () => {
  const photos = ['https://file.test/a.jpg'];
  const items = attachmentItems({
    waypoints: [{ name: 'One', images: photos }, { name: 'Two', images: photos }],
  }, (point) => point.images, 'https://file.test/track.kml');
  assert.equal(items.length, 1);
  assert.equal(items[0].index, 1);
});

test('external downloads use at most three workers and never block local-only export', async () => {
  let active = 0;
  let maximum = 0;
  let links = 0;
  let exporter;
  const post = (message) => {
    if (message.startsWith('attachmentresume\t')) {
      const parts = message.split('\t');
      Promise.resolve().then(() => exporter.resumeResult(parts[1], '', ''));
      return;
    }
    if (!message.startsWith('attachmentlink\t')) return;
    links += 1;
    const [, batch, index] = message.split('\t');
    active += 1;
    maximum = Math.max(maximum, active);
    delay(30).then(() => {
      active -= 1;
      exporter.result(batch, Number(index), true, '/tmp/photos/photo.jpg', '');
    });
  };
  exporter = createAttachmentExporter({ post, hasHost: true });
  const items = Array.from({ length: 7 }, (_, index) => ({
    index: index + 1,
    kind: 'external',
    name: `Photo ${index + 1}`,
    url: `https://images.test/${index + 1}.jpg`,
  }));

  const all = await exporter.exportAll(items, true);
  assert.deepEqual(all, { succeeded: 7, failed: 0, skipped: 0, folder: '/tmp/photos/photo.jpg' });
  assert.equal(maximum, 3);
  assert.equal(links, 7);

  const localOnly = await exporter.exportAll(items, false);
  assert.deepEqual(localOnly, { succeeded: 0, failed: 0, skipped: 0, folder: '' });
  assert.equal(links, 7);
});

test('resume skips completed item indices before scheduling work', async () => {
  let links = 0;
  let exporter;
  const post = (message) => {
    if (message.startsWith('attachmentresume\t')) {
      const parts = message.split('\t');
      Promise.resolve().then(() => exporter.resumeResult(parts[1], '1,2', '/photos'));
      return;
    }
    if (!message.startsWith('attachmentlink\t')) return;
    links += 1;
    const parts = message.split('\t');
    Promise.resolve().then(() =>
      exporter.result(parts[1], Number(parts[2]), true, '/photos/3.jpg', ''));
  };
  exporter = createAttachmentExporter({ post, hasHost: true });
  const items = [
    { index: 1, kind: 'external', name: 'One', url: 'https://images.test/1.jpg' },
    { index: 2, kind: 'external', name: 'Two', url: 'https://images.test/2.jpg' },
    { index: 3, kind: 'external', name: 'Three', url: 'https://images.test/3.jpg' },
  ];
  const result = await exporter.exportAll(items, true);
  assert.deepEqual(result, { succeeded: 1, failed: 0, skipped: 2, folder: '/photos/3.jpg' });
  assert.equal(links, 1);
});
