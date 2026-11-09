import { t, units } from './i18n.js';
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatRange,
  formatSpeed,
} from './format.js';

const DETAILS_KEY = 'gpxviewer.infoDetails';

function savedDetailsMode() {
  try {
    return localStorage.getItem(DETAILS_KEY) === 'full' ? 'full' : 'compact';
  } catch {
    return 'compact';
  }
}

export function createSummaryView({ el, fileName, photosOf, onLayoutChange }) {
  let detailsMode = savedDetailsMode();

  return function renderInfo(gpx, summary, elevations, estimateSeconds) {
    const box = document.getElementById('info');
    box.replaceChildren();
    box.dataset.details = detailsMode;

    const headingRow = el('div', 'info-heading');
    const heading = el('h1', null, gpx.name || fileName);
    heading.title = gpx.name && gpx.name !== fileName
      ? `${gpx.name}\n${t('info.fileHint', { name: fileName })}`
      : fileName;
    const detailsButton = el('button', 'info-details-toggle',
      t(detailsMode === 'full' ? 'info.less' : 'info.more'));
    detailsButton.type = 'button';
    detailsButton.setAttribute('aria-expanded', String(detailsMode === 'full'));
    detailsButton.title = t(detailsMode === 'full' ? 'info.lessTitle' : 'info.moreTitle');
    detailsButton.setAttribute('aria-label', detailsButton.title);
    detailsButton.addEventListener('click', () => {
      detailsMode = detailsMode === 'full' ? 'compact' : 'full';
      try { localStorage.setItem(DETAILS_KEY, detailsMode); }
      catch { /* The mode still applies to this preview. */ }
      renderInfo(gpx, summary, elevations, estimateSeconds);
      requestAnimationFrame(() => {
        const nextButton = document.querySelector('.info-details-toggle');
        if (nextButton instanceof HTMLElement) nextButton.focus({ preventScroll: true });
        onLayoutChange?.();
      });
    });
    headingRow.append(heading, detailsButton);
    box.append(headingRow);

    const stats = el('div', 'stats');
    const statRow = (pairs) => {
      if (pairs.length === 0) return;
      const line = el('dl', 'row');
      for (const [label, value, title] of pairs) {
        const pair = el('div', 'pair');
        pair.append(el('dt', null, label), el('dd', null, value));
        if (title) pair.title = title;
        line.append(pair);
      }
      stats.append(line);
    };

    const climb = [];
    const speedSeconds = summary.movingDurationSeconds || summary.durationSeconds;
    if (speedSeconds > 0 && summary.distanceMeters > 0) {
      climb.push([
        t(summary.movingDurationSeconds ? 'info.movingSpeed' : 'info.speed'),
        formatSpeed(summary.distanceMeters / speedSeconds),
        t(summary.movingTimeSource === 'metadata' ? 'info.movingTimeMetadata' : 'info.movingTimeEstimated'),
      ]);
    }
    if (summary.points > 0) {
      const ascentTitle = elevations && elevations.rawAscent !== elevations.ascent
        ? t('info.ascentHint', {
          filtered: formatElevation(elevations.ascent),
          raw: formatElevation(elevations.rawAscent),
        })
        : null;
      climb.push([t('info.ascent'), formatElevation(elevations?.ascent), ascentTitle]);
      climb.push([t('info.descent'), formatElevation(elevations?.descent)]);
    }
    statRow(climb);

    const extent = [];
    if (summary.segments > 0 || summary.routes > 0) {
      extent.push([
        summary.segments > 0 ? t('info.distance') : t('info.routeLength'),
        formatDistance(summary.distanceMeters),
      ]);
    }
    if (summary.durationSeconds !== null) {
      const moving = summary.movingDurationSeconds !== null
        ? formatDuration(summary.movingDurationSeconds)
        : formatDuration(summary.durationSeconds);
      const title = estimateSeconds !== null && estimateSeconds !== undefined
        ? t('info.totalTimeHint', { moving, estimate: formatDuration(estimateSeconds) })
        : t('info.totalTimeHint', { moving, estimate: '\u2014' });
      extent.push([t('info.totalTime'), formatDuration(summary.durationSeconds), title]);
    }
    if (summary.points > 0) extent.push([t('info.points'), summary.points.toLocaleString()]);
    statRow(extent);
    if (stats.childElementCount > 0) box.append(stats);

    if (detailsMode !== 'full') {
      box.hidden = false;
      return;
    }

    const rows = [];
    const range = formatRange(summary.start, summary.end);
    if (range) rows.push([t('info.date'), range]);
    const anomalyParts = el('span', 'anomaly-values');
    const anomalyTitles = [];
    if (summary.gaps > 0) {
      const rawEvents = summary.gapEvents || summary.gaps;
      anomalyParts.append(el('span', null, `${t('info.breaks')} ${t('info.breaksValue', {
        count: summary.gaps,
        distance: formatDistance(summary.gapDistanceMeters),
      })}`));
      if (rawEvents > summary.gaps) anomalyTitles.push(t('info.breaksRaw', { count: rawEvents }));
    }
    if (summary.anomalies > 0) {
      const rawEvents = summary.anomalyEvents || summary.anomalies;
      anomalyParts.append(el('span', null, `${t('info.anomalies')} ${t('info.anomaliesValue', {
        count: summary.anomalies,
        distance: formatDistance(summary.anomalyDistanceMeters),
      })}`));
      if (rawEvents > summary.anomalies) anomalyTitles.push(t('info.anomaliesRaw', { count: rawEvents }));
    }
    if (anomalyParts.childElementCount > 0) {
      rows.push([
        t('info.trackAnomalies'),
        anomalyParts,
        anomalyTitles.length > 0 ? anomalyTitles.join('\n') : null,
      ]);
    }

    const parts = [];
    if (summary.tracks > 0) {
      const segments = summary.segments > summary.tracks
        ? t('list.segments', { count: units(summary.segments, 'segment') })
        : '';
      parts.push(units(summary.tracks, 'track') + segments);
    }
    if (summary.routes > 0) parts.push(units(summary.routes, 'route'));
    if (summary.areas > 0) parts.push(units(summary.areas, 'area'));
    if (summary.waypoints > 0) parts.push(units(summary.waypoints, 'waypoint'));
    if (parts.length > 0) rows.push([t('info.contents'), parts.join(t('list.separator'))]);

    const photoPins = (gpx.waypoints || []).filter((waypoint) => photosOf(waypoint).length > 0);
    if (photoPins.length > 0) {
      const photos = photoPins.reduce((count, waypoint) => count + photosOf(waypoint).length, 0);
      rows.push([t('info.photos'), t('info.photosValue', {
        photos: units(photos, 'photo'),
        pins: units(photoPins.length, 'pin'),
      })]);
    }

    const table = el('dl', 'facts');
    for (const [key, value, title] of rows) {
      const fact = el('div', 'fact');
      const description = el('dd');
      if (typeof value === 'string') description.textContent = value;
      else description.append(value);
      fact.append(el('dt', null, key), description);
      if (title) fact.title = title;
      table.append(fact);
    }
    if (rows.length > 0) box.append(table);
    if (parts.length === 0) box.append(el('p', 'empty', t('info.empty')));
    box.hidden = false;
  };
}
