export function createUiFeedback({ t, overlay, afterShow }) {
  let hidden = false;
  let toastTimer = 0;

  function showToast(text, hold = 1500) {
    const node = document.getElementById('toast');
    if (!node) return;
    node.textContent = text;
    node.hidden = false;
    node.classList.remove('on');
    requestAnimationFrame(() => node.classList.add('on'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      node.classList.remove('on');
      setTimeout(() => { node.hidden = true; }, 300);
    }, hold);
  }

  function toggle() {
    hidden = !hidden;
    document.body.classList.toggle('chrome-hidden', hidden);
    if (hidden) {
      overlay()?.close();
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
