/** WebView2 message and clipboard bridge. Keeps host calls serialized and independent of viewer state. */
export function createHostBridge() {
  let clipboardSequence = 0;
  let clipboardWriting = false;
  let queuedClipboardWrite = null;
  const pendingClipboard = new Map();
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
    installViewerMessages,
    installTextInputReporting,
  };
}
