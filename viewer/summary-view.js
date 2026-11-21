import { t, units } from './i18n.js';
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatRange,
  formatSpeed,
} from './format.js';
import { setIcon } from './icons.js';
import { readStored, writeStored } from './storage.js';

const DETAILS_KEY = 'infoDetails';

function savedDetailsMode() {
  return readStored(DETAILS_KEY) === 'full' ? 'full' : 'compact';
}

/** Plain text for the share action. Missing values are omitted instead of turning into misleading placeholders. */
export function trackSummaryText(gpx, summary, elevations, fileName) {
  const lines = [gpx.name || fileName];
  if (summary.segments > 0 || summary.routes > 0) {
    lines.push(`${t(!summary.network && summary.segments > 0 ? 'info.distance' : 'info.routeLength')}: `
      + formatDistance(summary.distanceMeters));
  }
  if (summary.network) {
    const contents = [];
    if (summary.routes > 0) contents.push(units(summary.routes, 'route'));
    if (summary.segments > 0) contents.push(units(summary.segments, 'segment'));
    if (summary.waypoints > 0) contents.push(units(summary.waypoints, 'waypoint'));
    if (contents.length > 0) lines.push(`${t('info.contents')}: ${contents.join(t('list.separator'))}`);
    return lines.join('\n');
  }

  const range = formatRange(summary.start, summary.end);
  if (range) lines.push(`${t('info.date')}: ${range}`);
  if (summary.durationSeconds !== null) {
    lines.push(`${t('info.totalTime')}: ${formatDuration(summary.durationSeconds)}`);
  }
  if (summary.movingDurationSeconds !== null
    && summary.movingDurationSeconds !== summary.durationSeconds) {
    lines.push(`${t('info.movingTime')}: ${formatDuration(summary.movingDurationSeconds)}`);
  }
  const speedSeconds = summary.movingDurationSeconds || summary.durationSeconds;
  if (speedSeconds > 0 && summary.distanceMeters > 0) {
    lines.push(`${t(summary.movingDurationSeconds ? 'info.movingSpeed' : 'info.speed')}: `
      + formatSpeed(summary.distanceMeters / speedSeconds));
  }
  if (elevations && summary.elevation) {
    lines.push(`${t('info.ascent')}: ${formatElevation(elevations.ascent)}`);
    lines.push(`${t('info.descent')}: ${formatElevation(elevations.descent)}`);
    lines.push(`${t('summary.peak')}: ${formatElevation(elevations.max)}`);
  }
  if (summary.points > 0) lines.push(`${t('info.points')}: ${summary.points.toLocaleString()}`);
  return lines.join('\n');
}

export function createSummaryView({
  el, fileName, photosOf, onCopySummary, onLayoutChange,
}) {
  let detailsMode = savedDetailsMode();
  let narrowExpanded = false;
  let desktopCollapsed = false;
  let activeSyncPill = null;
  const isNarrow = () => window.innerWidth <= 720 || window.innerHeight <= 520;

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => {
      if (!activeSyncPill) return;
      const wasCompact = document.body.classList.contains('info-compact');
      activeSyncPill();
      if (document.body.classList.contains('info-compact') !== wasCompact) {
        onLayoutChange?.();
      }
    });
  }

  return function renderInfo(gpx, summary, elevations, estimateSeconds) {
    const box = document.getElementById('info');
    box.replaceChildren();
    box.dataset.details = detailsMode;
    box.classList.toggle('narrow-expanded', narrowExpanded);
    box.classList.toggle('desktop-collapsed', desktopCollapsed);

    const pillParts = [];
    if (summary.distanceMeters > 0) pillParts.push(formatDistance(summary.distanceMeters));
    if (elevations && summary.elevation) pillParts.push(`+${formatElevation(elevations.ascent)}`);
    if (summary.durationSeconds !== null) pillParts.push(formatDuration(summary.durationSeconds));
    const pillButton = el('button', 'info-narrow-pill');
    pillButton.type = 'button';
    const syncPill = () => {
      const expanded = isNarrow() ? narrowExpanded : !desktopCollapsed;
      pillButton.setAttribute('aria-expanded', String(expanded));
      pillButton.title = t(expanded ? 'info.narrowCollapse' : 'info.narrowExpand');
      pillButton.setAttribute('aria-label', pillButton.title);
      pillButton.querySelector('.info-narrow-caret').textContent = expanded ? '\u25b4' : '\u25be';
      document.body.classList.toggle('info-compact', !expanded);
    };
    activeSyncPill = syncPill;
    pillButton.append(
      el('span', 'info-narrow-text', pillParts.length > 0 ? pillParts.join(' · ') : (gpx.name || fileName)),
      el('span', 'info-narrow-caret', '\u25be'),
    );
    syncPill();
    pillButton.addEventListener('click', () => {
      if (isNarrow()) {
        narrowExpanded = !narrowExpanded;
        box.classList.toggle('narrow-expanded', narrowExpanded);
      } else {
        desktopCollapsed = false;
        box.classList.remove('desktop-collapsed');
      }
      syncPill();
      onLayoutChange?.();
    });
    box.append(pillButton);

    const headingRow = el('div', 'info-heading');
    const heading = el('h1', null, gpx.name || fileName);
    const baseHeadingTitle = gpx.name && gpx.name !== fileName
      ? `${gpx.name}\n${t('info.fileHint', { name: fileName })}`
      : fileName;
    heading.title = `${baseHeadingTitle}\n${t('info.narrowCollapse')}`;
    heading.addEventListener('click', () => {
      if (isNarrow()) {
        narrowExpanded = false;
        box.classList.remove('narrow-expanded');
      } else {
        desktopCollapsed = true;
        box.classList.add('desktop-collapsed');
      }
      syncPill();
      onLayoutChange?.();
    });
    const detailsButton = el('button', 'info-details-toggle',
      t(detailsMode === 'full' ? 'info.less' : 'info.more'));
    detailsButton.type = 'button';
    detailsButton.setAttribute('aria-expanded', String(detailsMode === 'full'));
    detailsButton.title = t(detailsMode === 'full' ? 'info.lessTitle' : 'info.moreTitle');
    detailsButton.setAttribute('aria-label', detailsButton.title);
    detailsButton.addEventListener('click', () => {
      detailsMode = detailsMode === 'full' ? 'compact' : 'full';
      writeStored(DETAILS_KEY, detailsMode);
      renderInfo(gpx, summary, elevations, estimateSeconds);
      onLayoutChange?.();
      requestAnimationFrame(() => {
        const nextButton = document.querySelector('.info-details-toggle');
        if (nextButton instanceof HTMLElement) nextButton.focus({ preventScroll: true });
      });
    });
    const copyButton = el('button', 'info-copy');
    copyButton.type = 'button';
    setIcon(copyButton, 'copy');
    copyButton.title = t('summary.copy');
    copyButton.setAttribute('aria-label', t('summary.copy'));
    copyButton.addEventListener('click', async () => {
      if (!onCopySummary || copyButton.disabled) return;
      copyButton.disabled = true;
      try {
        await onCopySummary(trackSummaryText(gpx, summary, elevations, fileName));
      } catch {
        // The application reports failures through the shared toast.
      } finally {
        if (copyButton.isConnected) copyButton.disabled = false;
      }
    });
    headingRow.append(heading, copyButton, detailsButton);
    box.append(headingRow);

    const stats = el('div', 'stats');
    // primary is the typographic tier; accent is the blue rule that marks the two numbers the card answers
    // first. They are separate because a row can be important without being the first thing read.
    const statRow = (pairs) => {
      if (pairs.length === 0) return;
      const line = el('dl', 'row');
      for (const [label, value, title, primary = false, accent = false] of pairs) {
        const pair = el('div', 'pair');
        pair.classList.toggle('primary', primary);
        pair.classList.toggle('accent', accent);
        pair.append(el('dt', null, label), el('dd', null, value));
        if (title) pair.title = title;
        line.append(pair);
      }
      stats.append(line);
    };

    let speedPair = null;
    let ascentPair = null;
    let descentPair = null;
    const speedSeconds = summary.movingDurationSeconds || summary.durationSeconds;
    if (speedSeconds > 0 && summary.distanceMeters > 0) {
      speedPair = [
        t(summary.movingDurationSeconds ? 'info.movingSpeed' : 'info.speed'),
        formatSpeed(summary.distanceMeters / speedSeconds),
        t(summary.movingTimeSource === 'metadata' ? 'info.movingTimeMetadata' : 'info.movingTimeEstimated'),
      ];
    }
    if (summary.points > 0) {
      const ascentTitle = elevations && elevations.rawAscent !== elevations.ascent
        ? t('info.ascentHint', {
          filtered: formatElevation(elevations.ascent),
          raw: formatElevation(elevations.rawAscent),
        })
        : null;
      ascentPair = [t('info.ascent'), formatElevation(elevations?.ascent), ascentTitle, true];
      descentPair = [t('info.descent'), formatElevation(elevations?.descent)];
    }

    let distancePair = null;
    if (summary.segments > 0 || summary.routes > 0) {
      distancePair = [
        summary.segments > 0 ? t('info.distance') : t('info.routeLength'),
        formatDistance(summary.distanceMeters),
        null,
        true,
        // The two numbers the card answers first: how far, and how long it took.
        true,
      ];
    }
    // Row one is the shape of the route: how far, how much up, how much down.
    statRow([distancePair, ascentPair, descentPair].filter(Boolean));

    let timePair = null;
    if (summary.durationSeconds !== null) {
      const moving = summary.movingDurationSeconds !== null
        ? formatDuration(summary.movingDurationSeconds)
        : formatDuration(summary.durationSeconds);
      const title = estimateSeconds !== null && estimateSeconds !== undefined
        ? t('info.totalTimeHint', { moving, estimate: formatDuration(estimateSeconds) })
        : t('info.totalTimeHint', { moving, estimate: '\u2014' });
      timePair = [t('info.totalTime'), formatDuration(summary.durationSeconds), title, false, true];
    }
    // Row two is how it went: how long, how fast, over how many points.
    const pointsPair = summary.points > 0
      ? [t('info.points'), summary.points.toLocaleString()]
      : null;
    statRow([timePair, speedPair, pointsPair].filter(Boolean));
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
