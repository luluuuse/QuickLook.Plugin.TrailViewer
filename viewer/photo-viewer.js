import { createFocusTrap } from './focus.js';

/**
 * Full-window photo viewer. Dependencies are passed in so this module owns its DOM and focus lifecycle
 * without importing the whole map application.
 */
export function createPhotoViewer({ el, formatters, formatCoord, t }) {
  let root = null;
  let img = null;
  let status = null;
  let statusKind = '';
  let caption = null;
  let meta = null;
  let counter = null;
  let closeButton = null;
  const stepButtons = [];
  let list = [];
  let index = 0;
  let shownPoint = null;
  let token = 0;
  let trap = null;

  function build() {
    root = el('div', 'photo-viewer');
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    trap = createFocusTrap(root, () => document.getElementById('map')?.focus({ preventScroll: true }));

    const bar = el('div', 'photo-bar');
    const titles = el('div', 'photo-titles');
    caption = el('strong', null, '');
    caption.id = 'photo-caption';
    root.setAttribute('aria-labelledby', caption.id);
    meta = el('div', 'photo-meta');
    titles.append(caption, meta);
    counter = el('div', 'photo-counter');
    const close = el('button', 'photo-close', '\u00d7');
    close.type = 'button';
    close.title = t('photo.close');
    close.setAttribute('aria-label', t('photo.close'));
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      hide();
    });
    closeButton = close;
    bar.append(titles, counter, close);

    const stage = el('div', 'photo-stage');
    img = el('img', 'photo-image');
    img.alt = '';
    img.decoding = 'async';
    img.addEventListener('click', (event) => event.stopPropagation());
    status = el('div', 'photo-status');
    status.hidden = true;
    stage.append(img, status);

    for (const [delta, glyph, label, className] of [
      [-1, '\u2039', 'photo.previous', 'prev'],
      [1, '\u203a', 'photo.next', 'next'],
    ]) {
      const button = el('button', `photo-arrow ${className}`, glyph);
      button.type = 'button';
      button.title = t(label);
      button.setAttribute('aria-label', t(label));
      button.dataset.delta = String(delta);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        step(delta);
      });
      stage.append(button);
      stepButtons.push(button);
    }

    stage.addEventListener('click', () => hide());
    root.append(bar, stage);
    document.body.append(root);
  }

  function paintMeta(point) {
    const bits = [];
    if (point.time) bits.push(formatters().full.format(point.time));
    bits.push(formatCoord(point));
    if (point.ele !== undefined) bits.push(`${Math.round(point.ele)} ${t('unit.m')}`);
    if (point.description) bits.push(point.description);
    meta.textContent = bits.join(' \u00b7 ');
  }

  function load() {
    const url = list[index];
    const mine = ++token;
    const many = list.length > 1;
    counter.textContent = many ? `${index + 1} / ${list.length}` : '';
    counter.hidden = !many;
    for (const button of stepButtons) button.hidden = !many;
    img.hidden = true;
    status.hidden = false;
    status.className = 'photo-status loading';
    statusKind = 'loading';
    status.textContent = t('photo.loading');
    img.onload = () => {
      if (mine !== token) return;
      status.hidden = true;
      statusKind = '';
      img.hidden = false;
    };
    img.onerror = () => {
      if (mine !== token) return;
      img.hidden = true;
      status.hidden = false;
      statusKind = 'failed';
      status.className = 'photo-status failed';
      status.replaceChildren(el('div', null, t('photo.failed')), el('code', null, url));
    };
    img.src = url;
  }

  function step(delta) {
    if (list.length < 2) return;
    index = (index + delta + list.length) % list.length;
    load();
  }

  function stepWithin(delta) {
    const next = index + delta;
    if (next < 0 || next >= list.length) return false;
    index = next;
    load();
    return true;
  }

  function show(urls, title, point, startIndex) {
    if (!root) build();
    const opening = root.hidden;
    list = urls;
    shownPoint = point;
    index = startIndex > 0 && startIndex < urls.length ? startIndex : 0;
    caption.textContent = title || t('label.photo');
    paintMeta(point);
    root.hidden = false;
    document.body.classList.add('showing-photo');
    if (opening) trap.activate(closeButton);
    load();
  }

  function hide() {
    if (!root || root.hidden) return;
    root.hidden = true;
    document.body.classList.remove('showing-photo');
    token += 1;
    img.hidden = true;
    img.removeAttribute('src');
    // The thumbnail may still be fading out inside a closed Leaflet popup; the map is the stable return point.
    trap.deactivate(true);
  }

  function relabel() {
    if (!root) return;
    closeButton.title = t('photo.close');
    closeButton.setAttribute('aria-label', t('photo.close'));
    for (const button of stepButtons) {
      const label = t(Number(button.dataset.delta) < 0 ? 'photo.previous' : 'photo.next');
      button.title = label;
      button.setAttribute('aria-label', label);
    }
    if (shownPoint) paintMeta(shownPoint);
    if (statusKind === 'loading') status.textContent = t('photo.loading');
    if (statusKind === 'failed') {
      status.replaceChildren(el('div', null, t('photo.failed')), el('code', null, list[index]));
    }
  }

  return {
    show,
    hide,
    relabel,
    stepWithin,
    current: () => shownPoint,
    isOpen: () => Boolean(root) && !root.hidden,
    count: () => list.length,
  };
}
