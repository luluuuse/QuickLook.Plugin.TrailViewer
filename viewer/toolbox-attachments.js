import { iconElement } from './icons.js';

/** Attachment-export subview and its progress state. */
export function createAttachmentTool({
  el, t, attachmentItems, onExport, onBack, renderToolbox, showToast,
}) {
  let exporting = false;
  const view = el('section', 'toolbox-subview toolbox-attachments');
  view.hidden = true;
  const back = el('button', 'toolbox-back');
  back.type = 'button';
  back.append(iconElement('arrow-left'), el('span', null, t('toolbox.back')));
  back.addEventListener('click', onBack);
  const meta = el('p', 'toolbox-attachment-meta');
  const instruction = el('p', 'toolbox-subhint', t('attachments.instruction'));
  const actions = el('div', 'toolbox-attachment-actions');
  const all = el('button', 'toolbox-attachment-export all');
  all.type = 'button';
  all.append(iconElement('image-export-all'), el('span', null, t('attachments.exportAll')));
  const local = el('button', 'toolbox-attachment-export local');
  local.type = 'button';
  local.append(iconElement('image-export-local'), el('span', null, t('attachments.exportLocal')));
  actions.append(all, local);
  const progress = el('p', 'toolbox-attachment-progress');
  progress.hidden = true;
  progress.setAttribute('role', 'status');
  const result = el('p', 'toolbox-attachment-result');
  result.hidden = true;
  const title = el('h2', 'toolbox-subtitle', t('attachments.title'));
  view.append(back, title, meta, instruction, actions, progress, result);

  function counts() {
    const embedded = attachmentItems.filter((item) => item.kind !== 'external').length;
    return { total: attachmentItems.length, embedded, external: attachmentItems.length - embedded };
  }

  async function exportAll(includeExternal) {
    if (exporting || !onExport) return;
    const total = includeExternal ? attachmentItems.length : counts().embedded;
    if (total === 0) return;
    exporting = true;
    result.hidden = true;
    progress.hidden = false;
    progress.textContent = t('attachments.progress', { completed: 0, total });
    renderToolbox();
    try {
      const summary = await onExport(includeExternal, ({ completed, total: nextTotal }) => {
        progress.textContent = t('attachments.progress', { completed, total: nextTotal });
      });
      showToast(t('attachments.done', {
        success: summary.succeeded,
        failed: summary.failed,
        skipped: summary.skipped || 0,
      }), 5000);
      if (summary.folder) {
        result.textContent = t('attachments.folder', {
          name: String(summary.folder).split(/[\\/]/).pop(),
        });
        result.hidden = false;
      }
    } catch (error) {
      showToast(t('attachments.failed', { detail: error.message }), 5000);
      result.textContent = error.message;
      result.hidden = false;
    } finally {
      exporting = false;
      progress.hidden = true;
      renderToolbox();
    }
  }

  all.addEventListener('click', () => exportAll(true));
  local.addEventListener('click', () => exportAll(false));

  function render() {
    const current = counts();
    const summaryKey = current.total > 0 ? 'attachments.summary' : 'attachments.none';
    const summary = t(summaryKey, current);
    meta.textContent = summary;
    all.disabled = exporting || current.total === 0;
    local.disabled = exporting || current.embedded === 0;
    all.title = t('attachments.exportAllTitle', { count: current.total });
    local.title = t('attachments.exportLocalTitle', { count: current.embedded });
    all.setAttribute('aria-label', all.title);
    local.setAttribute('aria-label', local.title);
    return current;
  }

  function relabel() {
    back.querySelector('span').textContent = t('toolbox.back');
    title.textContent = t('attachments.title');
    instruction.textContent = t('attachments.instruction');
    all.querySelector('span').textContent = t('attachments.exportAll');
    local.querySelector('span').textContent = t('attachments.exportLocal');
    render();
  }

  return { view, render, relabel };
}
