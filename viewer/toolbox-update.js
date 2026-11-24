import { iconElement } from './icons.js';

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatPublishedDate(iso) {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Renders markdown-ish release notes safely using DOM nodes only (no innerHTML).
 * @param {Function} el
 * @param {HTMLElement} container
 * @param {string} raw
 */
function renderNotes(el, container, raw) {
  container.textContent = '';
  const text = String(raw || '').trim();
  if (!text) return;
  const lines = text.split('\n');
  let list = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      list = null;
      continue;
    }
    const headingMatch = line.match(/^#{2,4}\s+(.+)$/);
    if (headingMatch) {
      list = null;
      container.append(el('div', 'toolbox-update-notes-heading', headingMatch[1].trim()));
      continue;
    }
    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      if (!list) {
        list = el('ul', 'toolbox-update-notes-list');
        container.append(list);
      }
      const clean = bulletMatch[1].replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
      list.append(el('li', null, clean));
      continue;
    }
    list = null;
    const clean = line.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
    container.append(el('p', 'toolbox-update-notes-para', clean));
  }
}

/**
 * Toolbox subview for checking GitHub Releases, viewing bilingual release notes,
 * and downloading verified .qlplugin updates for QuickLook's native installer.
 */
export function createUpdateTool({
  el,
  t,
  lang,
  currentVersion,
  hasHost,
  onCheck,
  onDownload,
  onIgnore,
  onOpenRelease,
  onBack,
  onStateChange,
  showToast,
}) {
  let state = {
    status: 'idle', // idle | checking | available | up-to-date | ignored | error
    currentVersion: currentVersion || '',
    latestVersion: '',
    publishedAt: '',
    releaseUrl: '',
    assetName: '',
    assetUrl: '',
    assetSize: 0,
    notesZh: '',
    notesEn: '',
    ignoredVersion: '',
    detail: '',
    hasUpdate: false,
  };
  let downloading = false;
  let downloadedBytes = 0;
  let totalBytes = 0;

  const view = el('section', 'toolbox-subview toolbox-update');
  view.hidden = true;

  const back = el('button', 'toolbox-back');
  back.type = 'button';
  back.append(iconElement('arrow-left'), el('span', null, t('toolbox.back')));
  back.addEventListener('click', onBack);

  const title = el('h2', 'toolbox-subtitle', t('update.title'));
  const versionCard = el('div', 'toolbox-update-card');
  const versionLine = el('div', 'toolbox-update-versions');
  const statusLine = el('p', 'toolbox-subhint toolbox-update-status');
  versionCard.append(versionLine, statusLine);

  const progressWrap = el('div', 'toolbox-update-progress');
  progressWrap.hidden = true;
  const progressBar = el('div', 'toolbox-update-progress-bar');
  const progressFill = el('div', 'toolbox-update-progress-fill');
  progressBar.append(progressFill);
  const progressText = el('div', 'toolbox-update-progress-text');
  progressWrap.append(progressBar, progressText);

  const notesWrap = el('div', 'toolbox-update-notes');
  notesWrap.hidden = true;

  const actions = el('div', 'toolbox-update-actions');
  const primaryBtn = el('button', 'toolbox-update-btn is-primary');
  primaryBtn.type = 'button';
  primaryBtn.addEventListener('click', () => {
    if (downloading) return;
    if ((state.status === 'available' || state.status === 'ignored') && state.assetUrl) {
      downloading = true;
      downloadedBytes = 0;
      totalBytes = state.assetSize || 0;
      render();
      onDownload?.(state.assetUrl, state.assetName);
    } else if (state.status !== 'checking') {
      triggerCheck(true);
    }
  });

  const secondaryRow = el('div', 'toolbox-update-secondary');
  const ignoreBtn = el('button', 'toolbox-update-link');
  ignoreBtn.type = 'button';
  ignoreBtn.addEventListener('click', () => {
    if (!state.latestVersion || downloading) return;
    onIgnore?.(state.latestVersion);
  });

  const openReleaseBtn = el('button', 'toolbox-update-link');
  openReleaseBtn.type = 'button';
  openReleaseBtn.addEventListener('click', () => {
    onOpenRelease?.(state.releaseUrl || '');
  });

  const recheckBtn = el('button', 'toolbox-update-link');
  recheckBtn.type = 'button';
  recheckBtn.addEventListener('click', () => {
    if (downloading || state.status === 'checking') return;
    triggerCheck(true);
  });

  secondaryRow.append(ignoreBtn, openReleaseBtn, recheckBtn);
  actions.append(primaryBtn, secondaryRow);

  view.append(back, title, versionCard, progressWrap, notesWrap, actions);

  function triggerCheck(force = true) {
    if (!hasHost) {
      state = { ...state, status: 'error', detail: 'desktop-only', hasUpdate: false };
      render();
      onStateChange?.(state);
      return;
    }
    state = { ...state, status: 'checking', detail: '' };
    render();
    onStateChange?.(state);
    onCheck?.(force);
  }

  function applyStatus(raw) {
    if (!raw || typeof raw !== 'object') return;
    const status = String(raw.Status || raw.status || 'idle');
    if (status === 'silent-error') {
      // Background check failed: keep previous state quietly without alarming the user.
      if (state.status === 'checking') {
        state = { ...state, status: 'idle' };
        render();
        onStateChange?.(state);
      }
      return;
    }
    state = {
      status,
      currentVersion: String(raw.CurrentVersion || raw.currentVersion || state.currentVersion || ''),
      latestVersion: String(raw.LatestVersion || raw.latestVersion || ''),
      publishedAt: String(raw.PublishedAt || raw.publishedAt || ''),
      releaseUrl: String(raw.ReleaseUrl || raw.releaseUrl || ''),
      assetName: String(raw.AssetName || raw.assetName || ''),
      assetUrl: String(raw.AssetUrl || raw.assetUrl || ''),
      assetSize: Number(raw.AssetSize ?? raw.assetSize ?? 0) || 0,
      notesZh: String(raw.NotesZh || raw.notesZh || ''),
      notesEn: String(raw.NotesEn || raw.notesEn || ''),
      ignoredVersion: String(raw.IgnoredVersion || raw.ignoredVersion || ''),
      detail: String(raw.Detail || raw.detail || ''),
      hasUpdate: Boolean(raw.HasUpdate ?? raw.hasUpdate),
    };
    render();
    onStateChange?.(state);
  }

  function applyProgress(downloaded, total) {
    downloading = true;
    downloadedBytes = Math.max(0, Number(downloaded) || 0);
    totalBytes = Math.max(downloadedBytes, Number(total) || state.assetSize || 0);
    render();
  }

  function applyDownloadResult(ok, detail) {
    downloading = false;
    downloadedBytes = 0;
    totalBytes = 0;
    render();
    if (ok) {
      showToast?.(t('update.launched'), 3600);
    } else {
      showToast?.(t('update.downloadFail', { detail: detail || 'error' }), 3600);
    }
  }

  function render() {
    back.querySelector('span').textContent = t('toolbox.back');
    title.textContent = t('update.title');

    const cur = state.currentVersion ? `v${state.currentVersion}` : '—';
    const hasNew = (state.status === 'available' || state.status === 'ignored') && state.latestVersion;
    const pubDate = formatPublishedDate(state.publishedAt);

    versionLine.textContent = '';
    versionLine.append(el('span', 'toolbox-update-ver-cur', cur));
    if (hasNew) {
      versionLine.append(
        el('span', 'toolbox-update-ver-arrow', '→'),
        el('span', 'toolbox-update-ver-new', `v${state.latestVersion}`),
      );
      if (pubDate) versionLine.append(el('span', 'toolbox-update-ver-date', pubDate));
    }

    if (downloading) {
      statusLine.textContent = t('update.downloading');
    } else if (state.status === 'checking') {
      statusLine.textContent = t('update.checking');
    } else if (state.status === 'available') {
      statusLine.textContent = t('update.availableHint');
    } else if (state.status === 'ignored') {
      statusLine.textContent = t('update.ignoredHint', { version: `v${state.latestVersion}` });
    } else if (state.status === 'up-to-date') {
      statusLine.textContent = t('update.upToDate');
    } else if (state.status === 'error') {
      statusLine.textContent = state.detail === 'desktop-only'
        ? t('update.desktopOnly')
        : t('update.checkFail');
    } else {
      statusLine.textContent = t('update.idleHint');
    }

    progressWrap.hidden = !downloading;
    if (downloading) {
      const pct = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
      progressFill.style.width = `${pct}%`;
      const sizeText = totalBytes > 0
        ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`
        : formatBytes(downloadedBytes);
      progressText.textContent = totalBytes > 0 ? `${pct}% · ${sizeText}` : t('update.downloading');
    }

    const notes = lang?.() === 'en' ? (state.notesEn || state.notesZh) : (state.notesZh || state.notesEn);
    if (hasNew && notes) {
      renderNotes(el, notesWrap, notes);
      notesWrap.hidden = false;
    } else {
      notesWrap.textContent = '';
      notesWrap.hidden = true;
    }

    if (hasNew && state.assetUrl) {
      const sizeSuffix = state.assetSize > 0 ? ` (${formatBytes(state.assetSize)})` : '';
      primaryBtn.textContent = downloading
        ? t('update.downloading')
        : `${t('update.downloadInstall')}${sizeSuffix}`;
      primaryBtn.disabled = downloading;
      primaryBtn.hidden = false;
    } else {
      primaryBtn.textContent = state.status === 'checking' ? t('update.checking') : t('update.checkNow');
      primaryBtn.disabled = state.status === 'checking' || downloading;
      primaryBtn.hidden = false;
    }

    ignoreBtn.textContent = t('update.ignore');
    ignoreBtn.hidden = !(state.status === 'available' && state.latestVersion);
    ignoreBtn.disabled = downloading;

    openReleaseBtn.textContent = t('update.openRelease');
    openReleaseBtn.hidden = !hasHost;

    recheckBtn.textContent = t('update.recheck');
    recheckBtn.hidden = !hasNew;
    recheckBtn.disabled = downloading || state.status === 'checking';
  }

  render();

  return {
    view,
    render,
    relabel: render,
    triggerCheck,
    applyStatus,
    applyProgress,
    applyDownloadResult,
    getState: () => state,
  };
}
