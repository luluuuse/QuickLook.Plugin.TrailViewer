/** WebView2 message and clipboard bridge. Keeps host calls serialized and independent of viewer state. */
export function createHostBridge() {
  let clipboardSequence = 0;
  let probeSequence = 0;
  let importSequence = 0;
  let clipboardWriting = false;
  let queuedClipboardWrite = null;
  const pendingClipboard = new Map();
  const pendingTrackSaves = new Map();
  const pendingNodeProbes = new Map();
  const pendingTrackImportLists = new Map();
  const pendingTrackImports = new Map();
  const hasHost = Boolean(
    window.chrome?.webview?.postMessage && window.chrome.webview.addEventListener,
  );

  function post(message) {
    window.chrome?.webview?.postMessage(message);
  }

  function decodeMessage(value) {
    try {
      return decodeURIComponent(value || '');
    } catch {
      return value || '';
    }
  }

  function clipboardResult(id, ok, detail = '') {
    const pending = pendingClipboard.get(id);
    if (!pending) return;
    pendingClipboard.delete(id);
    clearTimeout(pending.timer);
    if (ok) pending.resolve();
    else pending.reject(new Error(decodeMessage(detail) || 'clipboard write failed'));
  }

  function writeHostClipboard(text) {
    const id = `${Date.now().toString(36)}-${(clipboardSequence += 1).toString(36)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingClipboard.delete(id);
        reject(new Error('the clipboard did not respond'));
      }, 4000);
      pendingClipboard.set(id, { resolve, reject, timer });
      post(`clipboard\t${id}\t${encodeURIComponent(text)}`);
    });
  }

  async function drainClipboard() {
    try {
      while (queuedClipboardWrite) {
        const current = queuedClipboardWrite;
        queuedClipboardWrite = null;
        try {
          await writeHostClipboard(current.text);
          current.resolve();
        } catch (error) {
          current.reject(error);
        }
      }
    } finally {
      clipboardWriting = false;
    }
  }

  async function copyText(text) {
    if (!hasHost) {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard access is unavailable');
      await navigator.clipboard.writeText(text);
      return;
    }
    if (text.length > 32000) throw new Error('the copied text is too large');

    if (queuedClipboardWrite) {
      queuedClipboardWrite.text = text;
      return queuedClipboardWrite.promise;
    }

    let resolve;
    let reject;
    const write = { text, resolve, reject };
    write.promise = new Promise((accept, decline) => {
      resolve = accept;
      reject = decline;
    });
    write.resolve = resolve;
    write.reject = reject;
    queuedClipboardWrite = write;
    if (!clipboardWriting) {
      clipboardWriting = true;
      drainClipboard();
    }
    return write.promise;
  }

  function persistCustomSources(entries) {
    if (hasHost) post(`custom-sources\t${JSON.stringify(entries)}`);
  }

  function setEditorState(active) {
    if (hasHost) post(`editor-state\t${active ? '1' : '0'}`);
  }

  function setEditorDirty(dirty) {
    if (hasHost) post(`editor-dirty\t${dirty ? '1' : '0'}`);
  }

  function trackSaveResult(id, statusCode, path = '', detail = '') {
    const pending = pendingTrackSaves.get(id);
    if (!pending) return;
    pendingTrackSaves.delete(id);
    clearTimeout(pending.timer);
    if (statusCode === 0) {
      const decodedDetail = decodeMessage(detail);
      pending.resolve({
        ok: true,
        cancelled: false,
        path: decodeMessage(path),
        detail: decodedDetail,
        overwrote: decodedDetail === 'overwrote',
      });
    } else if (statusCode === 2) {
      pending.resolve({ ok: false, cancelled: true, path: '', detail: '' });
    } else {
      pending.resolve({ ok: false, cancelled: false, path: '', detail: decodeMessage(detail) });
    }
  }

  function trackSaveProgress(id, completed = 0, total = 0, failed = 0) {
    const pending = pendingTrackSaves.get(id);
    if (!pending || typeof pending.onProgress !== 'function') return;
    pending.onProgress({
      completed: Math.max(0, Number(completed) || 0),
      total: Math.max(0, Number(total) || 0),
      failed: Math.max(0, Number(failed) || 0),
    });
  }

  /**
   * Sends a serialized track payload in chunks to the host for saving.
   * @param {{ id: string, fileName: string, xml?: string, content?: string, format?: string, overwrite?: boolean, packRemoteImages?: boolean, onProgress?: ((info: { completed: number, total: number, failed: number }) => void) | null }} opts
   */
  function saveTrackGpx({
    id,
    fileName,
    xml = '',
    content,
    format = 'gpx',
    overwrite = false,
    packRemoteImages = false,
    onProgress = null,
  }) {
    if (!hasHost) {
      return Promise.resolve({ ok: true, cancelled: false, path: fileName, detail: 'browser-preview' });
    }
    const safeFormat = String(format || 'gpx').toLowerCase();
    const text = content ?? xml ?? '';
    const effectiveOverwrite = (safeFormat === 'gpx' || safeFormat === 'kml' || safeFormat === 'kmz')
      && Boolean(overwrite);
    const effectivePackRemote = safeFormat === 'kmz' && Boolean(packRemoteImages);
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    const sliceSize = 0x8000;
    for (let i = 0; i < bytes.length; i += sliceSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + sliceSize));
    }
    const base64 = btoa(binary);
    const chunkSize = 196608;
    const totalChunks = Math.max(1, Math.ceil(base64.length / chunkSize));

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingTrackSaves.delete(id);
        resolve({ ok: false, cancelled: false, path: '', detail: 'save timed out' });
      }, effectivePackRemote ? 600000 : (effectiveOverwrite ? 30000 : 300000));
      pendingTrackSaves.set(id, { resolve, timer, onProgress });
      post(
        `trackbegin\t${id}\t${totalChunks}\t${effectiveOverwrite ? '1' : '0'}`
        + `\t${encodeURIComponent(fileName)}\t${safeFormat}\t${effectivePackRemote ? '1' : '0'}`,
      );
      for (let i = 0; i < totalChunks; i += 1) {
        const chunk = base64.slice(i * chunkSize, (i + 1) * chunkSize);
        post(`trackchunk\t${id}\t${i}\t${chunk}`);
      }
      post(`trackdone\t${id}`);
    });
  }

  function nodeProbeResult(id, ok, ms = 0, reason = '') {
    const pending = pendingNodeProbes.get(id);
    if (!pending) return;
    pendingNodeProbes.delete(id);
    clearTimeout(pending.timer);
    pending.resolve({
      ok: Boolean(ok),
      ms: Math.max(0, Math.round(Number(ms) || 0)),
      reason: decodeMessage(reason) || (ok ? 'ok' : 'error'),
    });
  }

  function probeNode(url, timeoutMs = 10000) {
    if (!hasHost) return Promise.resolve(null);
    const id = `${Date.now().toString(36)}-${(probeSequence += 1).toString(36)}`;
    const boundedTimeout = Math.max(1000, Math.min(30000, Math.round(Number(timeoutMs) || 10000)));
    return new Promise((resolve) => {
      const started = performance.now();
      const timer = setTimeout(() => {
        pendingNodeProbes.delete(id);
        resolve({
          ok: false,
          ms: Math.max(1, Math.round(performance.now() - started)),
          reason: 'timeout',
        });
      }, boundedTimeout + 2000);
      pendingNodeProbes.set(id, { resolve, timer });
      post(`probe-node\t${id}\t${boundedTimeout}\t${encodeURIComponent(url)}`);
    });
  }

  function trackImportListResult(id, encodedJson = '') {
    const pending = pendingTrackImportLists.get(id);
    if (!pending) return;
    pendingTrackImportLists.delete(id);
    clearTimeout(pending.timer);
    try {
      const parsed = JSON.parse(decodeMessage(encodedJson) || '[]');
      pending.resolve(Array.isArray(parsed) ? parsed : []);
    } catch {
      pending.resolve([]);
    }
  }

  function listSiblingTracks() {
    if (!hasHost) return Promise.resolve([]);
    const id = `${Date.now().toString(36)}-${(importSequence += 1).toString(36)}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingTrackImportLists.delete(id);
        resolve([]);
      }, 5000);
      pendingTrackImportLists.set(id, { resolve, timer });
      post(`track-import-list\t${id}`);
    });
  }

  function decodeBase64Utf8(base64) {
    if (!base64) return '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  }

  function trackImportChunk(id, index, total, chunk = '') {
    const pending = pendingTrackImports.get(id);
    if (!pending) return;
    if (!pending.chunks) pending.chunks = new Array(Math.max(1, total));
    if (index >= 0 && index < pending.chunks.length) {
      pending.chunks[index] = chunk;
    }
  }

  function trackImportResult(id, statusCode, encodedName = '', encodedDetail = '') {
    const pending = pendingTrackImports.get(id);
    if (!pending) return;
    pendingTrackImports.delete(id);
    clearTimeout(pending.timer);
    if (statusCode === 0) {
      try {
        const joined = (pending.chunks || []).join('');
        const text = decodeBase64Utf8(joined);
        pending.resolve({
          ok: true,
          cancelled: false,
          name: decodeMessage(encodedName),
          text,
          detail: '',
        });
      } catch {
        pending.resolve({
          ok: false,
          cancelled: false,
          name: decodeMessage(encodedName),
          text: '',
          detail: 'decode failed',
        });
      }
    } else if (statusCode === 2) {
      pending.resolve({ ok: false, cancelled: true, name: '', text: '', detail: '' });
    } else {
      pending.resolve({
        ok: false,
        cancelled: false,
        name: decodeMessage(encodedName),
        text: '',
        detail: decodeMessage(encodedDetail),
      });
    }
  }

  function importExternalTrack({ mode = 'dialog', name = '' } = {}) {
    if (!hasHost) return Promise.resolve(null);
    const id = `${Date.now().toString(36)}-${(importSequence += 1).toString(36)}`;
    const timeoutMs = mode === 'dialog' ? 300000 : 15000;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingTrackImports.delete(id);
        resolve({ ok: false, cancelled: false, name: '', text: '', detail: 'import timed out' });
      }, timeoutMs);
      pendingTrackImports.set(id, { resolve, timer });
      post(`track-import-read\t${id}\t${mode}\t${encodeURIComponent(name || '')}`);
    });
  }

  function checkUpdate(force = false) {
    if (!hasHost) return false;
    post(`update-check\t${force ? '1' : '0'}`);
    return true;
  }

  function downloadUpdate(assetUrl, assetName) {
    if (!hasHost || !assetUrl) return false;
    post(`update-download\t${encodeURIComponent(assetUrl)}\t${encodeURIComponent(assetName || '')}`);
    return true;
  }

  function ignoreUpdate(version) {
    if (!hasHost || !version) return false;
    post(`update-ignore\t${encodeURIComponent(version)}`);
    return true;
  }

  function openUpdateRelease(url) {
    if (!hasHost) return false;
    post(`update-open\t${encodeURIComponent(url || '')}`);
    return true;
  }

  function installViewerMessages(api, clipboardResultHandler) {
    window.chrome?.webview?.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      const parts = event.data.split('\t');
      if (parts[0] === 'clipboardResult') {
        clipboardResultHandler(parts[1], parts[2] === '1', parts[3]);
      } else if (parts[0] === 'attachmentResult') {
        api.attachments.result(
          parts[1],
          Number(parts[2]),
          parts[3] === '1',
          decodeMessage(parts[4]),
          decodeMessage(parts[5]),
        );
      } else if (parts[0] === 'attachmentResume') {
        api.attachmentResume(parts[1], parts[2], decodeMessage(parts[3]));
      } else if (parts[0] === 'overlayExported') {
        api.exported(decodeMessage(parts[1]));
      } else if (parts[0] === 'overlayFailed') {
        api.exportFailed(decodeMessage(parts[1]));
      } else if (parts[0] === 'tianditu-response') {
        api.tiandituResponse(Number(parts[1]));
      } else if (parts[0] === 'setTiandituKey') {
        api.setTiandituKey(decodeMessage(parts[1]));
      } else if (parts[0] === 'pressKey') {
        api.pressKey(decodeMessage(parts[1]));
      } else if (parts[0] === 'hostAction') {
        api.hostAction?.(decodeMessage(parts[1]));
      } else if (parts[0] === 'tileCacheStats') {
        api.tileCacheStats?.(Number(parts[1]), Number(parts[2]));
      } else if (parts[0] === 'tileCacheCleared') {
        api.tileCacheCleared?.(Number(parts[1]), Number(parts[2]));
      } else if (parts[0] === 'trackSaveResult') {
        trackSaveResult(parts[1], Number(parts[2]), parts[3], parts[4]);
      } else if (parts[0] === 'trackSaveProgress') {
        trackSaveProgress(parts[1], Number(parts[2]), Number(parts[3]), Number(parts[4]));
      } else if (parts[0] === 'hostReveal') {
        api.revealViewer?.();
      } else if (parts[0] === 'nodeProbeResult') {
        nodeProbeResult(parts[1], parts[2] === '1', Number(parts[3]), parts[4]);
      } else if (parts[0] === 'trackImportList') {
        trackImportListResult(parts[1], parts[2]);
      } else if (parts[0] === 'trackImportChunk') {
        trackImportChunk(parts[1], Number(parts[2]), Number(parts[3]), parts[4]);
      } else if (parts[0] === 'trackImportResult') {
        trackImportResult(parts[1], Number(parts[2]), parts[3], parts[4]);
      } else if (parts[0] === 'updateStatus') {
        let parsed = null;
        try { parsed = JSON.parse(decodeMessage(parts[1])); } catch { parsed = null; }
        if (parsed) api.updateStatus?.(parsed);
      } else if (parts[0] === 'updateProgress') {
        api.updateProgress?.(Number(parts[1]), Number(parts[2]));
      } else if (parts[0] === 'updateDownloadResult') {
        api.updateDownloadResult?.(parts[1] === '1', decodeMessage(parts[2]));
      }
    });
  }

  function installTextInputReporting(isTextField) {
    let reported = null;
    const report = (active) => {
      if (active === reported) return;
      reported = active;
      post(`text-input\t${active ? '1' : '0'}`);
    };
    document.addEventListener('focusin', (event) => report(isTextField(event.target)));
    document.addEventListener('focusout', (event) => {
      if (!isTextField(event.relatedTarget)) report(false);
    });
  }

  return {
    hasHost,
    post,
    decodeMessage,
    copyText,
    clipboardResult,
    persistCustomSources,
    setEditorState,
    setEditorDirty,
    saveTrackGpx,
    probeNode,
    listSiblingTracks,
    importExternalTrack,
    checkUpdate,
    downloadUpdate,
    ignoreUpdate,
    openUpdateRelease,
    installViewerMessages,
    installTextInputReporting,
  };
}
