import { createFocusTrap } from './focus.js';
import { iconElement, setIcon } from './icons.js';
import { openExternal } from './weather.js';

const ZOOM_LEVELS = [
  0.05, 0.067, 0.1, 0.125, 0.167, 0.2, 0.25, 0.333, 0.4, 0.5, 0.667, 0.75,
  1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8,
];
const SCALE_EPSILON = 0.0005;

/**
 * Full-window photo viewer. Dependencies are passed in so this module owns its DOM and focus lifecycle
 * without importing the whole map application.
 */
export function createPhotoViewer({ el, formatters, formatCoord, t }) {
  let root = null;
  let stage = null;
  let img = null;
  let status = null;
  let statusKind = '';
  let caption = null;
  let meta = null;
  let counter = null;
  let zoomOutput = null;
  let closeButton = null;
  const stepButtons = [];
  let list = [];
  let index = 0;
  let shownPoint = null;
  let token = 0;
  let trap = null;
  let baseScale = 0;
  let viewScale = 0;
  let fitMode = true;
  let panX = 0;
  let panY = 0;
  let drag = null;
  let wheelDelta = 0;
  let wheelReset = 0;
  let layoutFrame = 0;
  let resizeObserver = null;
  let preloader = null;

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
    zoomOutput = el('button', 'photo-zoom', '100%');
    zoomOutput.type = 'button';
    zoomOutput.hidden = true;
    zoomOutput.setAttribute('aria-live', 'polite');
    zoomOutput.addEventListener('click', resetToFit);
    const close = el('button', 'photo-close');
    close.type = 'button';
    setIcon(close, 'close');
    close.title = t('photo.close');
    close.setAttribute('aria-label', t('photo.close'));
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      hide();
    });
    closeButton = close;
    bar.append(titles, counter, zoomOutput, close);

    stage = el('div', 'photo-stage');
    img = el('img', 'photo-image');
    img.alt = '';
    img.decoding = 'async';
    img.fetchPriority = 'high';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('click', (event) => event.stopPropagation());
    img.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || viewScale <= baseScale + SCALE_EPSILON) return;
      drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX, panY };
      img.setPointerCapture(event.pointerId);
      img.classList.add('dragging');
      event.preventDefault();
    });
    img.addEventListener('pointermove', (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      panX = drag.panX + event.clientX - drag.x;
      panY = drag.panY + event.clientY - drag.y;
      clampPan();
      applyTransform();
    });
    for (const type of ['pointerup', 'pointercancel']) {
      img.addEventListener(type, (event) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        drag = null;
        img.classList.remove('dragging');
        if (img.hasPointerCapture(event.pointerId)) img.releasePointerCapture(event.pointerId);
      });
    }
    status = el('div', 'photo-status');
    status.hidden = true;
    stage.append(img, status);

    for (const [delta, icon, label, className] of [
      [-1, 'arrow-left', 'photo.previous', 'prev'],
      [1, 'arrow-right', 'photo.next', 'next'],
    ]) {
      const button = el('button', `photo-arrow ${className}`);
      button.type = 'button';
      button.append(iconElement(icon));
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

    stage.addEventListener('wheel', (event) => {
      if (img.hidden || !event.deltaY || event.target.closest?.('button')) return;
      event.preventDefault();
      event.stopPropagation();
      if (wheelDelta && Math.sign(wheelDelta) !== Math.sign(event.deltaY)) wheelDelta = 0;
      wheelDelta += event.deltaY;
      clearTimeout(wheelReset);
      wheelReset = setTimeout(() => { wheelDelta = 0; }, 180);
      if (Math.abs(wheelDelta) < 30) return;
      const step = wheelDelta < 0 ? 1 : -1;
      wheelDelta = 0;
      setZoom(step, event);
    }, { passive: false });
    stage.addEventListener('click', () => hide());
    root.append(bar, stage);
    document.body.append(root);
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(scheduleLayout);
      resizeObserver.observe(stage);
    } else {
      window.addEventListener('resize', scheduleLayout);
    }
  }

  function paintMeta(point) {
    const bits = [];
    if (point.time) bits.push(formatters().full.format(point.time));
    bits.push(formatCoord(point));
    if (point.ele !== undefined) bits.push(`${Math.round(point.ele)} ${t('unit.m')}`);
    if (point.description) bits.push(point.description);
    meta.textContent = bits.join(' \u00b7 ');
  }

  function paintZoom() {
    if (!viewScale) return;
    const percent = Math.round(viewScale * 100);
    zoomOutput.textContent = `${percent}%`;
    const label = t('photo.zoom', { percent });
    zoomOutput.title = label;
    zoomOutput.setAttribute('aria-label', label);
  }

  function clearTransform() {
    img.style.width = '';
    img.style.height = '';
    img.style.transform = '';
    img.style.transformOrigin = 'center center';
    img.classList.remove('zoomed');
    img.classList.remove('dragging');
    drag = null;
    wheelDelta = 0;
  }

  function fitScale() {
    if (!stage || !img.naturalWidth || !img.naturalHeight) return 0;
    const style = getComputedStyle(stage);
    const width = Math.max(1, stage.clientWidth
      - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0));
    const height = Math.max(1, stage.clientHeight
      - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0));
    return Math.min(1, width / img.naturalWidth, height / img.naturalHeight);
  }

  function applyTransform() {
    if (!baseScale || !viewScale) return;
    const width = img.naturalWidth * viewScale;
    const height = img.naturalHeight * viewScale;
    const moved = Math.abs(panX) > 0.1 || Math.abs(panY) > 0.1;
    img.style.width = `${width}px`;
    img.style.height = `${height}px`;
    img.style.transform = moved
      ? `translate(${panX}px, ${panY}px)`
      : '';
    img.classList.toggle('zoomed', viewScale > baseScale + SCALE_EPSILON);
  }

  function clampPan() {
    if (!stage || !img.naturalWidth) {
      panX = 0;
      panY = 0;
      return;
    }
    const style = getComputedStyle(stage);
    const width = Math.max(1, stage.clientWidth
      - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0));
    const height = Math.max(1, stage.clientHeight
      - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0));
    const maxX = Math.max(0, (img.naturalWidth * viewScale - width) / 2);
    const maxY = Math.max(0, (img.naturalHeight * viewScale - height) / 2);
    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
  }

  function refreshZoomLayout() {
    layoutFrame = 0;
    if (!root || root.hidden || !img || img.hidden || !img.naturalWidth || !stage.clientWidth) return;
    baseScale = fitScale();
    if (!baseScale) return;
    if (fitMode || !viewScale) {
      viewScale = baseScale;
      panX = 0;
      panY = 0;
    } else {
      viewScale = Math.max(viewScale, baseScale);
    }
    clampPan();
    applyTransform();
    paintZoom();
  }

  function scheduleLayout() {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(refreshZoomLayout);
  }

  function resetToFit() {
    fitMode = true;
    viewScale = 0;
    panX = 0;
    panY = 0;
    clearTransform();
    if (zoomOutput) zoomOutput.hidden = !img || img.hidden;
    refreshZoomLayout();
  }

  function resetZoom() {
    fitMode = true;
    baseScale = 0;
    viewScale = 0;
    panX = 0;
    panY = 0;
    clearTransform();
    if (zoomOutput) zoomOutput.hidden = true;
    if (zoomOutput) paintZoom();
  }

  function setZoom(direction, originEvent = null) {
    if (!viewScale) return;
    const next = direction > 0
      ? ZOOM_LEVELS.find((scale) => scale > viewScale + SCALE_EPSILON)
      : [...ZOOM_LEVELS].reverse().find((scale) => scale < viewScale - SCALE_EPSILON
        && scale >= baseScale - SCALE_EPSILON);
    if (next === undefined) {
      if (direction < 0) resetToFit();
      return;
    }

    if (originEvent && viewScale > 0) {
      const rect = stage.getBoundingClientRect();
      const dx = originEvent.clientX - (rect.left + rect.width / 2);
      const dy = originEvent.clientY - (rect.top + rect.height / 2);
      const ratio = next / viewScale;
      panX = panX * ratio + dx * (1 - ratio);
      panY = panY * ratio + dy * (1 - ratio);
    }
    viewScale = next;
    fitMode = false;
    img.style.transformOrigin = 'center center';
    clampPan();
    applyTransform();
    zoomOutput.hidden = false;
    paintZoom();
  }

  function preloadNext() {
    if (list.length < 2) return;
    const nextUrl = list[(index + 1) % list.length];
    if (!nextUrl || nextUrl === list[index]) return;
    if (!preloader) {
      preloader = new Image();
      preloader.decoding = 'async';
      preloader.fetchPriority = 'low';
      preloader.referrerPolicy = 'no-referrer';
    }
    if (preloader.src !== nextUrl) preloader.src = nextUrl;
  }

  function renderFailed(url) {
    const nodes = [el('div', null, t('photo.failed')), el('code', null, url)];
    if (typeof url === 'string' && /^https:\/\//i.test(url)) {
      const openButton = /** @type {HTMLButtonElement} */ (el('button', 'photo-open-external', t('photo.openExternal')));
      openButton.type = 'button';
      openButton.addEventListener('click', (event) => {
        event.stopPropagation();
        openExternal(url);
      });
      nodes.push(openButton);
    }
    status.replaceChildren(...nodes);
  }

  function load() {
    const url = list[index];
    const mine = ++token;
    const many = list.length > 1;
    counter.textContent = many ? `${index + 1} / ${list.length}` : '';
    counter.hidden = !many;
    for (const button of stepButtons) button.hidden = !many;
    img.hidden = true;
    resetZoom();
    status.hidden = false;
    status.className = 'photo-status loading';
    statusKind = 'loading';
    status.textContent = t('photo.loading');
    img.onload = () => {
      if (mine !== token) return;
      status.hidden = true;
      statusKind = '';
      img.hidden = false;
      zoomOutput.hidden = false;
      scheduleLayout();
      preloadNext();
    };
    img.onerror = () => {
      if (mine !== token) return;
      img.hidden = true;
      zoomOutput.hidden = true;
      status.hidden = false;
      statusKind = 'failed';
      status.className = 'photo-status failed';
      renderFailed(url);
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
    clearTimeout(wheelReset);
    wheelDelta = 0;
    token += 1;
    img.hidden = true;
    img.removeAttribute('src');
    if (preloader) preloader.removeAttribute('src');
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
    if (zoomOutput && !zoomOutput.hidden) paintZoom();
    if (statusKind === 'loading') status.textContent = t('photo.loading');
    if (statusKind === 'failed') {
      renderFailed(list[index]);
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
