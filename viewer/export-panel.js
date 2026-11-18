// The toolbox owns the window chrome; this module only builds its export settings page.
export function createExportPanel({ el, t, node, settings, onChange, onExport, onPreview }) {
  const pickers = [];
  let previewVersion = 0;
  const picker = (field, labelKey, values, current) => {
    const row = el('div', 'row');
    const label = el('span', 'label', t(labelKey));
    const pick = el('div', 'pick');
    pick.setAttribute('role', 'group');
    pick.setAttribute('aria-label', t(labelKey));
    const buttons = values.map((value) => {
      const button = el('button', value.key === current ? 'option on' : 'option', value.label());
      button.type = 'button';
      button.setAttribute('aria-pressed', String(value.key === current));
      button.dataset.value = value.key;
      button.title = value.hint ? t(value.hint) : button.textContent;
      button.setAttribute('aria-label', button.title);
      button.addEventListener('click', () => {
        for (const other of pick.children) {
          const active = other === button;
          other.classList.toggle('on', active);
          other.setAttribute('aria-pressed', String(active));
        }
        onChange(field, value.key);
        void refreshPreview();
      });
      pick.append(button);
      return button;
    });
    row.append(label, pick);
    pickers.push({ label, labelKey, pick, buttons, values });
    return row;
  };

  const sizeRow = picker('size', 'export.size', [
    { key: '1:1', label: () => t('export.sizeSquare'), hint: 'export.sizeSquareHint' },
    { key: '9:16', label: () => t('export.sizePortrait'), hint: 'export.sizePortraitHint' },
    { key: '4:3', label: () => t('export.sizeLandscape'), hint: 'export.sizeLandscapeHint' },
  ], settings.size);
  const inkRow = picker('ink', 'export.ink', [
    { key: 'black', label: () => t('export.inkBlack'), hint: 'export.inkBlackHint' },
    { key: 'white', label: () => t('export.inkWhite'), hint: 'export.inkWhiteHint' },
  ], settings.ink);
  const scrimRow = picker('scrim', 'export.scrim', [
    { key: 'none', label: () => t('export.scrimNone'), hint: 'export.scrimNoneHint' },
    { key: 'soft', label: () => t('export.scrimSoft'), hint: 'export.scrimSoftHint' },
  ], settings.scrim);

  const preview = el('div', 'toolbox-export-preview');
  preview.setAttribute('role', 'img');
  preview.setAttribute('aria-label', t('export.preview'));
  const previewCanvas = el('canvas');
  preview.append(previewCanvas);

  const go = el('button', 'go', t('export.go'));
  go.type = 'button';
  go.addEventListener('click', () => onExport());
  node.replaceChildren(sizeRow, inkRow, scrimRow, preview, go);

  async function refreshPreview() {
    if (!onPreview) return;
    const version = ++previewVersion;
    preview.dataset.state = 'loading';
    try {
      const source = await onPreview({ ...settings });
      if (!source || version !== previewVersion) return;
      const scale = Math.min(236 / source.width, 112 / source.height);
      const width = Math.max(1, Math.round(source.width * scale));
      const height = Math.max(1, Math.round(source.height * scale));
      previewCanvas.width = width;
      previewCanvas.height = height;
      const context = previewCanvas.getContext('2d');
      context.clearRect(0, 0, width, height);
      context.drawImage(source, 0, 0, width, height);
      preview.dataset.size = settings.size;
      preview.dataset.ink = settings.ink;
      preview.dataset.scrim = settings.scrim;
      preview.dataset.state = 'ready';
    } catch {
      preview.dataset.state = 'failed';
    }
  }
  requestAnimationFrame(() => void refreshPreview());

  return {
    focus: () => go.focus({ preventScroll: true }),
    relabel() {
      go.textContent = t('export.go');
      for (const { label, labelKey, pick, buttons, values } of pickers) {
        label.textContent = t(labelKey);
        pick.setAttribute('aria-label', t(labelKey));
        buttons.forEach((button, index) => {
          button.textContent = values[index].label();
          button.title = values[index].hint ? t(values[index].hint) : button.textContent;
          button.setAttribute('aria-label', button.title);
        });
      }
      preview.setAttribute('aria-label', t('export.preview'));
      void refreshPreview();
    },
  };
}
