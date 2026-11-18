import { createExportPanel } from './export-panel.js';
import { clock, formatDistance, splitUnit } from './format.js';
import { readStored, writeStored } from './storage.js';

const SIZE_KEY = 'exportSize';
const INK_KEY = 'exportInk';
const SCRIM_KEY = 'exportScrim';
const SIZES = ['1:1', '9:16', '4:3'];
const INKS = ['black', 'white'];
const SCRIMS = ['none', 'soft'];

function remembered(params, key, allowed, fallback) {
  const fromHost = params.get(key);
  if (allowed.includes(fromHost)) return fromHost;
  const value = readStored(key);
  return allowed.includes(value) ? value : fallback;
}

function remember(key, value) {
  writeStored(key, value);
}

export function overlayFileName(base, size, ink, scrim, suffix) {
  const stem = String(base || 'track').replace(/\.[^.]+$/, '');
  return `${stem}-${suffix}-${size.replace(':', 'x')}-${ink}-${scrim}.png`;
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
  el,
  t,
  post,
  showToast,
  params,
  gpx,
  summary,
  elevations,
  routeModel,
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
  const lines = routeModel
    ? routeModel.lines.map((line) => line.points)
    : [
      ...gpx.tracks.flatMap((track) => track.segments),
      ...(gpx.routes || []).map((route) => route.points),
    ].filter((line) => line && line.length > 0);

  function segments() {
    return lines;
  }

  function exportRows() {
    if (summary.network) {
      return [
        { label: t('info.routeLength'), ...splitUnit(formatDistance(summary.distanceMeters)) },
        { label: t('export.segments'), value: String(summary.segments), unit: '' },
      ];
    }
    const rows = [{ label: t('info.distance'), ...splitUnit(formatDistance(summary.distanceMeters)) }];
    if (summary.durationSeconds !== null && summary.durationSeconds !== undefined) {
      rows.push({ label: t('info.totalTime'), value: clock(summary.durationSeconds), unit: '' });
    }
    if (elevations) {
      rows.push({
        label: t('info.ascent'),
        value: Math.round(elevations.ascent).toLocaleString(),
        unit: t('unit.m'),
      });
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
    return rows;
  }

  function title() {
    const named = gpx.name
      || gpx.tracks.find((track) => track.name)?.name
      || gpx.routes?.find((route) => route.name)?.name;
    const value = String(named || fileName || '').replace(/\.[^.]+$/, '').trim();
    return value.replace(/\s*-\s*\d{10,}$/, '').trim() || t('export.untitled');
  }

  function dateLabel() {
    const date = summary.start;
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('.');
  }

  async function build(options) {
    const lines = segments();
    if (lines.length === 0) return null;
    const { drawOverlay } = await import('./export.js');
    return drawOverlay({
      segments: lines,
      rows: exportRows(),
      title: title(),
      meta: summary.network ? t('export.network') : dateLabel(),
      ends: summary.network ? null : { start: t('export.start'), end: t('export.end') },
      size: options?.size ?? settings.size,
      ink: options?.ink ?? settings.ink,
      scrim: options?.scrim ?? settings.scrim,
      preview: options?.preview === true,
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
      const name = overlayFileName(base, snapshot.size, snapshot.ink, snapshot.scrim, t('export.suffix'));
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

  function mount(node) {
    if (panel || segments().length === 0) return panel;
    const keys = { size: SIZE_KEY, ink: INK_KEY, scrim: SCRIM_KEY };
    panel = createExportPanel({
      el,
      t,
      node,
      settings,
      onChange: (field, value) => {
        settings[field] = value;
        remember(keys[field], value);
        onSettingsChange?.();
      },
      onPreview: (snapshot) => build({ ...snapshot, preview: true }),
      onExport: () => void save(),
    });
    return panel;
  }

  return {
    available: () => segments().length > 0,
    settings: () => ({ ...settings }),
    save,
    build,
    mount,
    focus: () => panel?.focus(),
    relabel: () => panel?.relabel(),
  };
}
