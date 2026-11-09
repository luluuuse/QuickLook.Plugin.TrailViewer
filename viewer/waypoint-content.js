import { t } from './i18n.js';
import { formatCoord, formatters } from './format.js';

function resolvePhotoUrl(url, src) {
  if (/^data:image\//i.test(url) || /^https?:\/\//i.test(url)) return url;
  try {
    return new URL(url, new URL(src, location.href)).href;
  } catch {
    return null;
  }
}

export function renderPointPopup(point, title, el) {
  const box = el('div', 'point-popup');
  if (title) box.append(el('strong', null, title));
  if (point.time) box.append(el('div', null, formatters().full.format(point.time)));
  box.append(el('div', 'coord', formatCoord(point)));
  if (point.ele !== undefined) {
    box.append(el('div', null, t('point.elevation', { elevation: Math.round(point.ele), unit: t('unit.m') })));
  }
  if (point.description) box.append(el('div', 'point-text', point.description));
  return box;
}

/** Photo URLs and the first-click card shown by a waypoint pin. */
export function createWaypointContent({ el, src, photoViewer, pointPopup }) {
  const photosOf = (point) => (point.images || []).map((url) => resolvePhotoUrl(url, src)).filter(Boolean);

  function photoPreview(photos, point, closePopup) {
    const box = el('div', 'photo-preview');
    box.append(pointPopup(point, point.name || t('label.waypoint')));
    const strip = el('div', photos.length === 1 ? 'photo-thumbs single' : 'photo-thumbs');
    photos.forEach((url, index) => {
      const button = el('button', 'photo-thumb');
      button.type = 'button';
      button.title = photos.length > 1
        ? t('photo.openIndexed', { index: index + 1, count: photos.length })
        : t('photo.openSingle');
      button.setAttribute('aria-label', button.title);
      const thumb = el('img');
      thumb.alt = '';
      thumb.decoding = 'async';
      thumb.onerror = () => button.classList.add('failed');
      thumb.src = url;
      button.append(thumb);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        closePopup?.();
        photoViewer.show(photos, point.name || t('label.photo'), point, index);
      });
      strip.append(button);
    });
    box.append(strip);
    box.append(el('p', 'photo-hint', photos.length > 1
      ? t('photo.hintMany', { count: photos.length })
      : t('photo.hintOne')));
    return box;
  }

  return { photosOf, photoPreview };
}
