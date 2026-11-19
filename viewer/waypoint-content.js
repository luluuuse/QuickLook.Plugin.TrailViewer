import { t } from './i18n.js';
import { formatters } from './format.js';
import { iconElement } from './icons.js';

function resolvePhotoUrl(url, src) {
  if (/^data:image\//i.test(url) || /^https?:\/\//i.test(url)) return url;
  try {
    return new URL(url, new URL(src, location.href)).href;
  } catch {
    return null;
  }
}

/**
 * The card a pin without a picture opens. It is the same card family as the photo one -- one fixed width, a
 * title over a single facts line, one custom close button in the same corner -- so a pin does not change shape
 * depending on whether the file happens to carry an attachment, and the two cards can sit side by side in the
 * "next" walk without one looking like a form.
 *
 * Coordinates are gone on purpose: the pin already pins the spot, and "38.421831, 114.293075" was the widest
 * and least-read line a 224 px card could hold.
 */
export function renderPointPopup(point, title, el, closePopup = null) {
  const card = el('div', 'place-card');
  const head = el('div', 'place-head');
  if (title) head.append(el('strong', 'place-card-title', title));
  const meta = [point.time ? formatters().short.format(point.time) : ''];
  if (point.ele !== undefined) {
    meta.push(t('point.elevation', { elevation: Math.round(point.ele), unit: t('unit.m') }));
  }
  const line = meta.filter(Boolean).join(' \u00b7 ');
  if (line) head.append(el('span', 'place-card-meta', line));
  if (head.childElementCount) card.append(head);
  if (point.description) card.append(el('p', 'place-text', point.description));

  if (closePopup) {
    const close = el('button', 'place-card-close', '\u2715');
    close.type = 'button';
    close.title = t('photo.closeCard');
    close.setAttribute('aria-label', close.title);
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      closePopup();
    });
    card.append(close);
  }
  return card;
}

/** Photo URLs and the first-click card shown by a waypoint pin. */
export function createWaypointContent({ el, src, photoViewer }) {
  const photosOf = (point) => (point.images || []).map((url) => resolvePhotoUrl(url, src)).filter(Boolean);

  /**
   * The card a photo pin opens first. The photo IS the card: it fills the whole 4:3 frame, and the facts sit on
   * a bottom scrim instead of taking a band of their own. That is roughly twice the visible photo area for the
   * same footprint, and the card no longer looks like a form with a picture attached.
   *
   * There is no "open photo" button: the photo is the button. "Next" is a round arrow in the corner with a
   * small position counter above it, so it costs no horizontal room and cannot collide with a long placemark
   * name. "Next" walks to the next pin that has photos -- what a reader wants after "this one is interesting" --
   * not the next frame of the same place, which the full-size viewer already does with the arrow keys.
   */
  function photoPreview(photos, point, closePopup, options = {}) {
    const { onNext = null, position = 0, total = 0 } = options;
    const box = el('div', 'photo-preview');
    const open = () => {
      closePopup?.();
      photoViewer.show(photos, point.name || t('label.photo'), point, 0);
    };

    const frame = el('div', 'photo-frame');
    frame.title = t('photo.openSingle');
    const heroImage = el('img', 'photo-image-thumb');
    heroImage.alt = '';
    heroImage.decoding = 'async';
    const heroError = iconElement('warning', { className: 'photo-error-icon' });
    heroImage.onerror = () => frame.classList.add('failed');
    heroImage.src = photos[0];
    frame.append(heroImage, heroError);

    const scrim = el('div', 'photo-scrim');
    const facts = el('div', 'photo-facts');
    facts.append(el('strong', 'photo-card-title', point.name || t('label.waypoint')));
    const meta = [point.time ? formatters().short.format(point.time) : ''];
    if (point.ele !== undefined) {
      meta.push(t('point.elevation', { elevation: Math.round(point.ele), unit: t('unit.m') }));
    }
    const line = meta.filter(Boolean).join(' \u00b7 ');
    if (line) facts.append(el('span', 'photo-card-meta', line));
    frame.append(scrim, facts);

    const close = el('button', 'photo-card-close', '\u2715');
    close.type = 'button';
    close.title = t('photo.closeCard');
    close.setAttribute('aria-label', close.title);
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      closePopup?.();
    });
    frame.append(close);

    if (onNext) {
      const nextButton = el('button', 'photo-next');
      nextButton.type = 'button';
      nextButton.title = t('photo.nextPinTitle', { count: total });
      nextButton.setAttribute('aria-label', nextButton.title);
      nextButton.append(iconElement('chevron-right', { size: 15 }));
      nextButton.addEventListener('click', (event) => {
        event.stopPropagation();
        closePopup?.();
        onNext();
      });
      const counter = el('span', 'photo-position', `${position}/${total}`);
      frame.append(counter, nextButton);
    }

    // The photo opens the viewer, but a click on the buttons or the close control must not double as that.
    frame.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      open();
    });
    box.append(frame);
    return box;
  }

  return { photosOf, photoPreview };
}
