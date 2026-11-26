export function createUiFeedback({ t, toolbox, afterShow }) {
  let hidden = false;
  let toastTimer = 0;
  let toastHideTimer = 0;

  function showToast(text, hold = 1500, tone = 'info') {
    const node = document.getElementById('toast');
    if (!node) return;
    clearTimeout(toastTimer);
    clearTimeout(toastHideTimer);
    node.textContent = text;
    node.dataset.tone = tone || 'info';
    node.hidden = false;
    node.classList.remove('on');
    requestAnimationFrame(() => node.classList.add('on'));
    toastTimer = setTimeout(() => {
      node.classList.remove('on');
      toastHideTimer = setTimeout(() => { node.hidden = true; }, 220);
    }, hold);
  }

  function toggle() {
    hidden = !hidden;
    document.body.classList.toggle('chrome-hidden', hidden);
    if (hidden) {
      toolbox?.()?.close();
      showToast(t('chrome.hint'));
    } else {
      requestAnimationFrame(() => afterShow?.());
    }
  }

  return {
    toggle,
    showToast,
    isHidden: () => hidden,
  };
}
