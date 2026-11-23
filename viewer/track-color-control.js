import { readStored, writeStored } from './storage.js';
import {
  TRACK_COLOR_MODES,
  normalizeTrackColorMode,
} from './track-color.js';

const STORAGE_KEY = 'trackColor';

const MODE_VISUALS = Object.freeze({
  single: { stroke: '#e6e6e6', start: '#e6e6e6', end: '#e6e6e6', stops: null },
  elevation: {
    stroke: 'url(#track-color-grad-elevation)',
    start: '#2ecc71',
    end: '#ff4757',
    stops: [
      ['0%', '#2ecc71'],
      ['35%', '#f1c40f'],
      ['70%', '#e67e22'],
      ['100%', '#ff4757'],
    ],
  },
  speed: {
    stroke: 'url(#track-color-grad-speed)',
    start: '#9b59b6',
    end: '#00e5ff',
    stops: [
      ['0%', '#9b59b6'],
      ['50%', '#3498db'],
      ['100%', '#00e5ff'],
    ],
  },
  heartRate: {
    stroke: 'url(#track-color-grad-heartRate)',
    start: '#f8a5c2',
    end: '#b31237',
    stops: [
      ['0%', '#f8a5c2'],
      ['40%', '#ff6b81'],
      ['75%', '#ff2e4c'],
      ['100%', '#b31237'],
    ],
  },
});

export function savedTrackColor(params) {
  const fromHost = params?.get('trackColor');
  if (fromHost) return normalizeTrackColorMode(fromHost);
  return normalizeTrackColorMode(readStored(STORAGE_KEY));
}

function createTrailIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('viewBox', '0 0 18 18');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('data-symbol', 'track-color-symbol');

  const defs = document.createElementNS(ns, 'defs');
  for (const mode of TRACK_COLOR_MODES) {
    const spec = MODE_VISUALS[mode];
    if (!spec.stops) continue;
    const grad = document.createElementNS(ns, 'linearGradient');
    grad.setAttribute('id', `track-color-grad-${mode}`);
    grad.setAttribute('x1', '2');
    grad.setAttribute('y1', '14');
    grad.setAttribute('x2', '16');
    grad.setAttribute('y2', '4');
    grad.setAttribute('gradientUnits', 'userSpaceOnUse');
    for (const [offset, color] of spec.stops) {
      const stop = document.createElementNS(ns, 'stop');
      stop.setAttribute('offset', offset);
      stop.setAttribute('stop-color', color);
      grad.append(stop);
    }
    defs.append(grad);
  }

  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M3 13.5C5.2 13.5 5.6 8.6 8.6 8.6C11.4 8.6 11.4 4.5 15 4.5');
  path.setAttribute('stroke-width', '2.4');
  path.setAttribute('stroke-linecap', 'round');

  const startDot = document.createElementNS(ns, 'circle');
  startDot.setAttribute('cx', '3');
  startDot.setAttribute('cy', '13.5');
  startDot.setAttribute('r', '1.6');

  const endDot = document.createElementNS(ns, 'circle');
  endDot.setAttribute('cx', '15');
  endDot.setAttribute('cy', '4.5');
  endDot.setAttribute('r', '1.6');

  svg.append(defs, path, startDot, endDot);
  return { svg, path, startDot, endDot };
}

/**
 * Single-click toolbar icon button for cycling between single, elevation, speed, and heart-rate track coloring.
 * @param {{ L: any, map: any, el: Function, t: Function, tracks: any, initialMode?: string, showToast?: (msg: string, ms?: number) => void, onChange?: (mode: string) => void }} opts
 */
export function createTrackColorControl({
  L, map, el, t, tracks, initialMode = 'single',
  showToast = () => {}, onChange = () => {},
}) {
  let activeTracks = tracks;
  let capabilities = activeTracks.colorCapabilities();
  let availableModes = TRACK_COLOR_MODES.filter((mode) => mode === 'single' || Boolean(capabilities[mode]));
  let preferredMode = normalizeTrackColorMode(initialMode);
  let activeMode = preferredMode !== 'single' && !capabilities[preferredMode] ? 'single' : preferredMode;
  let control = null;
  let button = null;
  let trailIcon = null;

  function updateButton() {
    if (!button || !trailIcon) return;
    const visual = MODE_VISUALS[activeMode] || MODE_VISUALS.single;
    trailIcon.path.setAttribute('stroke', visual.stroke);
    trailIcon.startDot.setAttribute('fill', visual.start);
    trailIcon.endDot.setAttribute('fill', visual.end);
    button.dataset.trackColor = activeMode;
    button.classList.toggle('has-active-mode', activeMode !== 'single');
    const title = t('trackColor.cycleTitle', { mode: t(`trackColor.mode.${activeMode}`) });
    button.title = title;
    button.setAttribute('aria-label', title);
  }

  function applyMode(nextMode, persist = true, notifyToast = false) {
    const normalized = normalizeTrackColorMode(nextMode);
    if (normalized !== 'single' && !capabilities[normalized]) return;
    preferredMode = normalized;
    activeMode = activeTracks.setColorMode(normalized);
    if (persist) {
      writeStored(STORAGE_KEY, preferredMode);
      onChange(preferredMode);
    }
    updateButton();
    if (notifyToast) {
      showToast(t('trackColor.toast', { mode: t(`trackColor.mode.${activeMode}`) }), 1800);
    }
  }

  function cycleMode() {
    if (availableModes.length <= 1) return;
    const currentIdx = availableModes.indexOf(activeMode);
    const nextMode = availableModes[(currentIdx + 1) % availableModes.length];
    applyMode(nextMode, true, true);
  }

  function mount() {
    if (activeMode !== 'single') {
      activeMode = activeTracks.setColorMode(activeMode);
    }
    const Switch = L.Control.extend({
      options: { position: 'topright' },
      onAdd() {
        const box = L.DomUtil.create('div', 'leaflet-bar track-color-switch');
        button = el('button', 'track-color-toggle');
        button.type = 'button';
        button.disabled = availableModes.length <= 1;
        trailIcon = createTrailIcon();
        button.append(trailIcon.svg);
        L.DomEvent.disableClickPropagation(box);
        L.DomEvent.on(button, 'click', (event) => {
          event.stopPropagation();
          cycleMode();
        });
        box.append(button);
        return box;
      },
    });
    control = new Switch();
    control.addTo(map);
    updateButton();
  }

  return {
    mount,
    mode: () => preferredMode,
    activeMode: () => activeMode,
    setMode: (nextMode) => applyMode(nextMode, true, false),
    cycle: cycleMode,
    relabel: updateButton,
    setTracks(nextTracks) {
      if (!nextTracks) return;
      activeTracks = nextTracks;
      capabilities = activeTracks.colorCapabilities();
      availableModes = TRACK_COLOR_MODES.filter((mode) => mode === 'single' || Boolean(capabilities[mode]));
      const target = preferredMode !== 'single' && capabilities[preferredMode] ? preferredMode : 'single';
      activeMode = activeTracks.setColorMode(target);
      if (button) button.disabled = availableModes.length <= 1;
      updateButton();
    },
    destroy() {
      control?.remove();
    },
  };
}
