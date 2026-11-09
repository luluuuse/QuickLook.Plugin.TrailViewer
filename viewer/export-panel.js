// The compact export settings dialog. The caller owns persisted settings and the final export action.
export function createExportPanel({ L, el, t, node, settings, onChange, onExport }) {
  const title = el('h2', null, t('export.panel'));
  title.id = 'export-title';
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-labelledby', title.id);

  const pickers = [];
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
      button.addEventListener('click', () => {
        for (const other of pick.children) {
          const active = other === button;
          other.classList.toggle('on', active);
          other.setAttribute('aria-pressed', String(active));
        }
        onChange(field, value.key);
      });
      pick.append(button);
      return button;
    });
    row.append(label, pick);
    pickers.push({ label, labelKey, pick, buttons, values });
    return row;
  };

  const sizeRow = picker('size', 'export.size', [
    { key: '1:1', label: () => t('export.sizeSquare') },
    { key: '9:16', label: () => t('export.sizePortrait') },
    { key: '4:3', label: () => t('export.sizeLandscape') },
  ], settings.size);
  const inkRow = picker('ink', 'export.ink', [
    { key: 'black', label: () => t('export.inkBlack') },
    { key: 'white', label: () => t('export.inkWhite') },
  ], settings.ink);
  const scrimRow = picker('scrim', 'export.scrim', [
    { key: 'none', label: () => t('export.scrimNone') },
    { key: 'soft', label: () => t('export.scrimSoft') },
  ], settings.scrim);

  const go = el('button', 'go', t('export.go'));
  go.type = 'button';
  go.addEventListener('click', () => onExport());
  node.replaceChildren(title, sizeRow, inkRow, scrimRow, go);
  L.DomEvent.disableClickPropagation(node);

  let previousFocus = null;
  const open = () => {
    if (!node.hidden) return;
    previousFocus = document.activeElement;
    node.hidden = false;
    requestAnimationFrame(() => go.focus({ preventScroll: true }));
  };
  const close = () => {
    if (node.hidden) return;
    node.hidden = true;
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
      previousFocus.focus({ preventScroll: true });
    } else {
      document.getElementById('map')?.focus({ preventScroll: true });
    }
    previousFocus = null;
  };

  return {
    open,
    close,
    isOpen: () => !node.hidden,
    toggle() { if (node.hidden) open(); else close(); },
    relabel() {
      title.textContent = t('export.panel');
      go.textContent = t('export.go');
      for (const { label, labelKey, pick, buttons, values } of pickers) {
        label.textContent = t(labelKey);
        pick.setAttribute('aria-label', t(labelKey));
        buttons.forEach((button, index) => { button.textContent = values[index].label(); });
      }
    },
  };
}
