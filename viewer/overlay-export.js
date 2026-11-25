import { createExportPanel } from './export-panel.js';
import { clock, formatDistance, splitUnit } from './format.js';
import { readStored, writeStored } from './storage.js';

const SIZE_KEY = 'exportSize';
const INK_KEY = 'exportInk';
const SCRIM_KEY = 'exportScrim';
const CONTENT_KEY = 'exportContent';
const PROFILE_KEY = 'exportProfile';
const SIZES = ['1:1', '9:16', '4:3'];
const INKS = ['black', 'white', 'swiss'];
const SCRIMS = ['none', 'soft'];
const CONTENTS = ['full', 'track'];
const PROFILES = ['off', 'ele'];

function remembered(params, key, allowed, fallback) {
  const fromHost = params.get(key);
  if (allowed.includes(fromHost)) return fromHost;
  const value = readStored(key);
  return allowed.includes(value) ? value : fallback;
}

function remember(key, value) {
  writeStored(key, value);
}

/**
 * The file name carries every setting that changes the picture, so two styles never overwrite each other.
 * The bare-track and silhouette marks are appended only when used: the classic names stay exactly as before.
 */
export function overlayFileName(base, size, ink, scrim, suffix, { content = 'full', profile = 'off' } = {}) {
  const stem = String(base || 'track').replace(/\.[^.]+$/, '');
  const extras = `${content === 'track' ? '-bare' : ''}${profile === 'ele' ? '-ele' : ''}`;
  return `${stem}-${suffix}-${size.replace(':', 'x')}-${ink}-${scrim}${extras}.png`;
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
    content: remembered(params, CONTENT_KEY, CONTENTS, 'full'),
    profile: remembered(params, PROFILE_KEY, PROFILES, 'off'),
  };
  let currentGpx = gpx;
  let currentSummary = summary;
  let currentElevations = elevations;
  let elevationSamples = currentElevations?.samples?.length >= 2 && currentElevations.max > currentElevations.min
    ? currentElevations.samples
    : null;
  let profileAvailable = Boolean(elevationSamples);
  let panel = null;
  let exporting = false;
  let lines = routeModel
    ? routeModel.lines.map((line) => line.points)
    : [
      ...currentGpx.tracks.flatMap((track) => track.segments),
      ...(currentGpx.routes || []).map((route) => route.points),
    ].filter((line) => line && line.length > 0);

  function segments() {
    return lines;
  }

  function exportRows() {
    if (currentSummary.network) {
      return [
        { label: t('info.routeLength'), ...splitUnit(formatDistance(currentSummary.distanceMeters)) },
        { label: t('export.segments'), value: String(currentSummary.segments), unit: '' },
      ];
    }
    const rows = [{ label: t('info.distance'), ...splitUnit(formatDistance(currentSummary.distanceMeters)) }];
    if (currentSummary.durationSeconds !== null && currentSummary.durationSeconds !== undefined) {
      rows.push({ label: t('info.totalTime'), value: clock(currentSummary.durationSeconds), unit: '' });
    }
    if (currentElevations) {
      rows.push({
        label: t('info.ascent'),
        value: Math.round(currentElevations.ascent).toLocaleString(),
        unit: t('unit.m'),
      });
    }
    if (currentElevations) {
      rows.push({
        label: t('export.maxEle'),
        value: Math.round(currentElevations.max).toLocaleString(),
        unit: t('unit.m'),
      });
    }
    const speedSeconds = currentSummary.movingDurationSeconds || currentSummary.durationSeconds;
    if (speedSeconds > 0 && currentSummary.distanceMeters > 0) {
      rows.push({
        label: t(currentSummary.movingDurationSeconds ? 'info.movingSpeed' : 'info.speed'),
        value: ((currentSummary.distanceMeters / speedSeconds) * 3.6).toFixed(1),
        unit: t('unit.kmh'),
      });
    }
    return rows;
  }

  function title() {
    const named = currentGpx.name
      || currentGpx.tracks.find((track) => track.name)?.name
      || currentGpx.routes?.find((route) => route.name)?.name;
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
      content: options?.content ?? settings.content,
      profile: profileAvailable ? (options?.profile ?? settings.profile) : 'off',
      elevation: elevationSamples,
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
      const name = overlayFileName(base, snapshot.size, snapshot.ink, snapshot.scrim, t('export.suffix'), {
        content: snapshot.content,
        profile: profileAvailable ? snapshot.profile : 'off',
      });
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
    const keys = {
      size: SIZE_KEY, ink: INK_KEY, scrim: SCRIM_KEY, content: CONTENT_KEY, profile: PROFILE_KEY,
    };
    panel = createExportPanel({
      el,
      t,
      node,
      settings,
      profileAvailable,
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
    /** @param {{ gpx?: any, summary?: any, elevations?: any, routeModel?: any }} [next] */
    updateData(next = {}) {
      const { gpx: nextGpx, summary: nextSummary, elevations: nextElevations, routeModel: nextRouteModel } = next;
      if (nextGpx) currentGpx = nextGpx;
      if (nextSummary) currentSummary = nextSummary;
      if (nextElevations !== undefined) currentElevations = nextElevations;
      elevationSamples = currentElevations?.samples?.length >= 2 && currentElevations.max > currentElevations.min
        ? currentElevations.samples
        : null;
      profileAvailable = Boolean(elevationSamples);
      lines = nextRouteModel
        ? nextRouteModel.lines.map((line) => line.points)
        : [
          ...currentGpx.tracks.flatMap((track) => track.segments),
          ...(currentGpx.routes || []).map((route) => route.points),
        ].filter((line) => line && line.length > 0);
    },
  };
}
