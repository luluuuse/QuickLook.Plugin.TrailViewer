import { createExportPanel } from './export-panel.js';
import { clock, formatDistance, splitUnit } from './format.js';

const SIZE_KEY = 'gpxviewer.exportSize';
const INK_KEY = 'gpxviewer.exportInk';
const SCRIM_KEY = 'gpxviewer.exportScrim';
const SIZES = ['1:1', '9:16', '4:3'];
const INKS = ['black', 'white'];
const SCRIMS = ['none', 'soft'];

function remembered(params, key, allowed, fallback) {
  const fromHost = params.get(key.replace(/^gpxviewer\./, ''));
  if (allowed.includes(fromHost)) return fromHost;
  try {
    const value = localStorage.getItem(key);
    return allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function remember(key, value) {
  try { localStorage.setItem(key, value); }
  catch { /* Not remembered, still applied to this preview. */ }
}

function base64Of(bytes) {
  let text = '';
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    text += String.fromCharCode.apply(null, bytes.subarray(index, index + step));
  }
  return btoa(text);
}

export function createOverlayExport({
  L,
  el,
  t,
  post,
  showToast,
  params,
  gpx,
  summary,
  elevations,
  fileName,
  onSettingsChange,
}) {
  const settings = {
    size: remembered(params, SIZE_KEY, SIZES, '9:16'),
    ink: remembered(params, INK_KEY, INKS, 'black'),
    scrim: remembered(params, SCRIM_KEY, SCRIMS, 'none'),
  };
  let panel = null;
  let exporting = false;

  function segments() {
    return [
      ...gpx.tracks.flatMap((track) => track.segments),
      ...(gpx.routes || []).map((route) => route.points),
    ].filter((line) => line && line.length > 0);
  }

  function exportRows() {
    const rows = [{ label: t('info.distance'), ...splitUnit(formatDistance(summary.distanceMeters)) }];
    if (summary.durationSeconds !== null && summary.durationSeconds !== undefined) {
      rows.push({ label: t('info.totalTime'), value: clock(summary.durationSeconds), unit: '' });
    }
    if (elevations) {
      rows.push({
        label: t('export.maxEle'),
        value: Math.round(elevations.max).toLocaleString(),
        unit: t('unit.m'),
      });
    }
    const speedSeconds = summary.movingDurationSeconds || summary.durationSeconds;
    if (speedSeconds > 0 && summary.distanceMeters > 0) {
      rows.push({
        label: t(summary.movingDurationSeconds ? 'info.movingSpeed' : 'info.speed'),
        value: ((summary.distanceMeters / speedSeconds) * 3.6).toFixed(1),
        unit: t('unit.kmh'),
      });
    }
    if (elevations) {
      rows.push({
        label: t('info.ascent'),
        value: Math.round(elevations.ascent).toLocaleString(),
        unit: t('unit.m'),
      });
    }
    return rows;
  }

  async function build(options) {
    const lines = segments();
    if (lines.length === 0) return null;
    const { drawOverlay } = await import('./export.js');
    return drawOverlay({
      segments: lines,
      rows: exportRows(),
      ends: { start: t('export.start'), end: t('export.end') },
      size: options?.size ?? settings.size,
      ink: options?.ink ?? settings.ink,
      scrim: options?.scrim ?? settings.scrim,
    });
  }

  async function save() {
    if (exporting) return;
    exporting = true;
    try {
      const snapshot = { ...settings };
      const canvas = await build(snapshot);
      if (!canvas) {
        showToast(t('export.empty'), 3000);
        return;
      }
      const blob = await new Promise((done) => canvas.toBlob(done, 'image/png'));
      if (!blob) throw new Error('the canvas produced no image');
      const data = base64Of(new Uint8Array(await blob.arrayBuffer()));
      const chunk = 1 << 18;
      const base = (fileName || 'track').replace(/\.[^.]+$/, '');
      const shape = snapshot.size.replace(':', 'x');
      const name = `${base}-${t('export.suffix')}-${shape}.png`;
      const chunks = Math.ceil(data.length / chunk);
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      post(`export\t${id}\t${chunks}\t${encodeURIComponent(name)}`);
      for (let index = 0, offset = 0; offset < data.length; index += 1, offset += chunk) {
        post(`exportchunk\t${id}\t${index}\t${chunks}\t${data.slice(offset, offset + chunk)}`);
      }
      post(`exportdone\t${id}\t${chunks}`);
    } catch (error) {
      showToast(t('export.failed', { detail: error.message }), 4000);
    } finally {
      exporting = false;
    }
  }

  if (segments().length > 0) {
    const keys = { size: SIZE_KEY, ink: INK_KEY, scrim: SCRIM_KEY };
    panel = createExportPanel({
      L,
      el,
      t,
      node: document.getElementById('export'),
      settings,
      onChange: (field, value) => {
        settings[field] = value;
        remember(keys[field], value);
        onSettingsChange?.();
      },
      onExport: () => {
        panel.close();
        void save();
      },
    });
  }

  return {
    available: () => panel !== null,
    settings: () => ({ ...settings }),
    save,
    build,
    relabel: () => panel?.relabel(),
    close: () => panel?.close(),
    panelOpen: () => panel?.isOpen() ?? false,
    togglePanel: () => panel?.toggle(),
  };
}
