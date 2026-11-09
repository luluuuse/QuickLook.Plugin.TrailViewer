// Keyboard focus helpers that coexist with QuickLook's low-level Space/Esc hook.

const FOCUSABLE = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * QuickLook owns Space. Preventing the browser's default button activation keeps Space as "close preview"
 * even after Tab has moved focus onto a viewer control. Enter still activates the focused button normally.
 */
export function installSpaceGuard() {
  document.addEventListener('keydown', (event) => {
    if (event.key === ' ' && event.target instanceof Element
        && event.target.closest('button, a, [role="button"]')) {
      event.preventDefault();
    }
  }, { capture: true });
}

function focusableWithin(root) {
  return [...root.querySelectorAll(FOCUSABLE)]
    .filter((node) => !node.hidden && node.getClientRects().length > 0);
}

/** Keep Tab inside a modal dialog, remember where it opened, and restore that focus when it closes. */
export function createFocusTrap(root, fallback) {
  let previous = null;
  let active = false;

  const onKeyDown = (event) => {
    if (event.key !== 'Tab' || !active) return;
    const items = focusableWithin(root);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  };

  return {
    activate(preferred) {
      if (active) return;
      active = true;
      previous = document.activeElement;
      document.addEventListener('keydown', onKeyDown, { capture: true });
      requestAnimationFrame(() => (preferred || focusableWithin(root)[0])?.focus({ preventScroll: true }));
    },
    deactivate(forceFallback = false) {
      if (!active) return;
      active = false;
      document.removeEventListener('keydown', onKeyDown, { capture: true });
      if (!forceFallback && previous instanceof HTMLElement && previous.isConnected
          && previous.getClientRects().length > 0) {
        previous.focus({ preventScroll: true });
      }
      else fallback?.();
      previous = null;
    },
  };
}
