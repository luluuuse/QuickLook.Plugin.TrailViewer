const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const EXPORT_TIMEOUT_MS = 20000;
const EXTERNAL_CONCURRENCY = 3;

function imageKind(url, src) {
  if (/^data:image\//i.test(url)) return 'inline';
  try {
    return new URL(url, new URL(src, location.href)).origin === new URL(src, location.href).origin
      ? 'embedded'
      : 'external';
  } catch {
    return 'external';
  }
}

/** Every usable photo once, in waypoint order, with enough information for the export UI. */
export function attachmentItems(gpx, photosOf, src) {
  const seen = new Set();
  const items = [];
  for (const waypoint of gpx?.waypoints || []) {
    for (const url of photosOf(waypoint)) {
      if (seen.has(url)) continue;
      seen.add(url);
      const kind = imageKind(url, src);
      let relativePath = null;
      if (kind === 'embedded') {
        try {
          relativePath = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '');
        } catch {
          relativePath = null;
        }
      }
      items.push({
        url,
        kind,
        relativePath,
        name: waypoint.name || 'photo',
        index: items.length + 1,
      });
    }
  }
  return items;
}

export function attachmentCounts(items) {
  return {
    total: items.length,
    embedded: items.filter((item) => item.kind !== 'external').length,
    external: items.filter((item) => item.kind === 'external').length,
  };
}

function extensionFor(contentType, url = '') {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  const known = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/avif': 'avif',
  }[type];
  if (known) return known;
  const match = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(url);
  return match ? match[1].toLowerCase() : 'jpg';
}

function fileName(item, contentType = '', url = item.url) {
  const base = [...String(item.name || 'photo')]
    .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .join('')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim() || 'photo';
  return `${String(item.index).padStart(3, '0')}-${base}.${extensionFor(contentType, url)}`;
}

function base64Of(bytes) {
  let binary = '';
  const step = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + step));
  }
  return btoa(binary);
}

/**
 * Local files are copied by the host; Data URIs use bounded chunks and HTTPS links use a small worker pool.
 */
export function createAttachmentExporter({ post, hasHost }) {
  const pending = new Map();
  let batch = '';
  let resumeWaiter = null;

  function waitFor(index) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(index);
        reject(new Error('the image export timed out'));
      }, EXPORT_TIMEOUT_MS);
      pending.set(index, { resolve, timer });
    });
  }

  function settle(index, result) {
    const waiter = pending.get(index);
    if (!waiter) return;
    pending.delete(index);
    clearTimeout(waiter.timer);
    waiter.resolve(result);
  }

  function requestResume(indices) {
    if (indices.length === 0) return Promise.resolve({ completed: [], folder: '' });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resumeWaiter = null;
        resolve({ completed: [], folder: '' });
      }, 5000);
      resumeWaiter = {
        batch,
        finish(result) {
          clearTimeout(timer);
          resumeWaiter = null;
          resolve(result);
        },
      };
      post(`attachmentresume\t${batch}\t${indices.join(',')}`);
    });
  }

  async function upload(item) {
    let type;
    let bytes;
    if (item.kind === 'inline') {
      const match = /^data:(image\/[^;,]+)((?:;[^;,]*)*),(.*)$/is.exec(item.url);
      if (!match) throw new Error('the inline image was invalid');
      type = match[1];
      const isBase64 = /(?:^|;)base64$/i.test(match[2] || '');
      if (isBase64) {
        const binary = atob(match[3]);
        bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      } else {
        bytes = new TextEncoder().encode(decodeURIComponent(match[3]));
      }
    } else {
      const response = await fetch(item.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      type = response.headers.get('content-type') || '';
      if (!/^image\//i.test(type)) throw new Error('the response is not an image');
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    if (bytes.length === 0) throw new Error('the image was empty');
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('the image is larger than 30 MB');
    const data = base64Of(bytes);
    const id = `${batch}-${item.index}`;
    const chunks = Math.max(1, Math.ceil(data.length / (1 << 18)));
    const name = fileName(item, type);
    const result = waitFor(item.index);
    post(`attachmentbegin\t${batch}\t${item.index}\t${id}\t${chunks}\t${encodeURIComponent(name)}`);
    for (let index = 0, offset = 0; offset < data.length; index += 1, offset += 1 << 18) {
      post(`attachmentchunk\t${id}\t${index}\t${chunks}\t${data.slice(offset, offset + (1 << 18))}`);
    }
    post(`attachmentdone\t${batch}\t${item.index}\t${id}\t${chunks}`);
    return result;
  }

  function copyEmbedded(item) {
    if (!item.relativePath) return Promise.resolve({ ok: false, detail: 'the local image path is invalid' });
    const result = waitFor(item.index);
    post(`attachmentlocal\t${batch}\t${item.index}\t${encodeURIComponent(fileName(item))}`
      + `\t${encodeURIComponent(item.relativePath)}`);
    return result;
  }

  function download(item) {
    const result = waitFor(item.index);
    post(`attachmentlink\t${batch}\t${item.index}\t${encodeURIComponent(fileName(item))}`
      + `\t${encodeURIComponent(item.url)}`);
    return result;
  }

  async function exportItem(item) {
    if (item.kind === 'external') return download(item);
    if (item.kind === 'embedded') {
      const direct = await copyEmbedded(item);
      return direct.ok ? direct : upload(item);
    }
    return upload(item);
  }

  async function exportAll(items, includeExternal = true, onProgress) {
    if (!hasHost) throw new Error('image export is available in the QuickLook preview');
    batch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    let succeeded = 0;
    let failed = 0;
    const selected = includeExternal ? items : items.filter((item) => item.kind !== 'external');
    const total = selected.length;
    const resume = await requestResume(selected.map((item) => item.index));
    const completedBefore = new Set(resume.completed);
    const pendingItems = selected.filter((item) => !completedBefore.has(item.index));
    const local = pendingItems.filter((item) => item.kind !== 'external');
    const external = pendingItems.filter((item) => item.kind === 'external');
    const skipped = completedBefore.size;
    let completed = skipped;
    let folder = resume.folder || '';

    async function attempt(item) {
      try {
        const result = await exportItem(item);
        if (!result.ok) throw new Error(result.detail || 'the image could not be exported');
        succeeded += 1;
        folder = result.path || folder;
      } catch {
        failed += 1;
      } finally {
        completed += 1;
        onProgress?.({ completed, total, item });
      }
    }

    onProgress?.({ completed, total, item: null });
    let next = 0;
    const localWork = (async () => {
      for (const item of local) await attempt(item);
    })();
    const externalWork = Array.from(
      { length: Math.min(EXTERNAL_CONCURRENCY, external.length) },
      async () => {
        while (next < external.length) {
          const item = external[next];
          next += 1;
          await attempt(item);
        }
      },
    );
    await Promise.all([localWork, ...externalWork]);
    onProgress?.({ completed: total, total, item: null });
    return { succeeded, failed, skipped, folder };
  }

  return {
    exportAll,
    result(nextBatch, index, ok, path, detail) {
      if (nextBatch !== batch) return;
      settle(index, { ok, path: path || '', detail: detail || '' });
    },
    resumeResult(nextBatch, indices, folder) {
      if (!resumeWaiter || nextBatch !== resumeWaiter.batch) return;
      const completed = String(indices || '').split(',').filter(Boolean).map(Number);
      resumeWaiter.finish({ completed, folder: folder || '' });
    },
  };
}
