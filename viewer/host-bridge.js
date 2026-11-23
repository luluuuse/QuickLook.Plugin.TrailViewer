/** WebView2 message and clipboard bridge. Keeps host calls serialized and independent of viewer state. */
export function createHostBridge() {
  let clipboardSequence = 0;
  let probeSequence = 0;
  let clipboardWriting = false;
  let queuedClipboardWrite = null;
  const pendingClipboard = new Map();
  const pendingTrackSaves = new Map();
  const pendingNodeProbes = new Map();
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

  function saveTrackGpx({ id, fileName, xml, overwrite = false }) {
    if (!hasHost) {
      return Promise.resolve({ ok: true, cancelled: false, path: fileName, detail: 'browser-preview' });
    }
    const bytes = new TextEncoder().encode(xml);
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
      }, overwrite ? 30000 : 300000);
      pendingTrackSaves.set(id, { resolve, timer });
      post(`trackbegin\t${id}\t${totalChunks}\t${overwrite ? '1' : '0'}\t${encodeURIComponent(fileName)}`);
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
      } else if (parts[0] === 'tileCacheStats') {
        api.tileCacheStats?.(Number(parts[1]), Number(parts[2]));
      } else if (parts[0] === 'tileCacheCleared') {
        api.tileCacheCleared?.(Number(parts[1]), Number(parts[2]));
      } else if (parts[0] === 'trackSaveResult') {
        trackSaveResult(parts[1], Number(parts[2]), parts[3], parts[4]);
      } else if (parts[0] === 'nodeProbeResult') {
        nodeProbeResult(parts[1], parts[2] === '1', Number(parts[3]), parts[4]);
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
    installViewerMessages,
    installTextInputReporting,
  };
}
