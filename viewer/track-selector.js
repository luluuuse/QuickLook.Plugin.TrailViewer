import { distanceMeters } from './geo.js';
import { iconElement } from './icons.js';
import { trackColorForIndex } from './track-layer.js';

export const WAYPOINT_MATCH_METERS = 350;

function pointToSegmentMeters(point, a, b) {
  const cosLat = Math.cos(((point.lat + a.lat) * 0.5 * Math.PI) / 180) || 1;
  const ax = (a.lon - point.lon) * cosLat;
  const ay = a.lat - point.lat;
  const bx = (b.lon - point.lon) * cosLat;
  const by = b.lat - point.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-18) return distanceMeters(point, a);
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq));
  const proj = { lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) };
  return distanceMeters(point, proj);
}

function trackBounds(track) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const segment of track.segments || []) {
    for (const point of segment) {
      if (point.lat < minLat) minLat = point.lat;
      if (point.lat > maxLat) maxLat = point.lat;
      if (point.lon < minLon) minLon = point.lon;
      if (point.lon > maxLon) maxLon = point.lon;
    }
  }
  return { minLat, maxLat, minLon, maxLon };
}

export function waypointMatchesTrack(waypoint, track, maxMeters = WAYPOINT_MATCH_METERS, bounds = null) {
  if (!waypoint || !track?.segments?.length) return false;
  const box = bounds || trackBounds(track);
  if (!Number.isFinite(box.minLat)) return false;
  const latPad = maxMeters / 110540;
  const cosLat = Math.max(0.1, Math.cos((waypoint.lat * Math.PI) / 180));
  const lonPad = maxMeters / (111320 * cosLat);
  if (waypoint.lat < box.minLat - latPad || waypoint.lat > box.maxLat + latPad
    || waypoint.lon < box.minLon - lonPad || waypoint.lon > box.maxLon + lonPad) {
    return false;
  }
  for (const segment of track.segments) {
    if (segment.length === 1) {
      if (distanceMeters(waypoint, segment[0]) <= maxMeters) return true;
      continue;
    }
    for (let index = 1; index < segment.length; index += 1) {
      const a = segment[index - 1];
      const b = segment[index];
      const segMinLat = a.lat < b.lat ? a.lat : b.lat;
      const segMaxLat = a.lat > b.lat ? a.lat : b.lat;
      if (waypoint.lat < segMinLat - latPad || waypoint.lat > segMaxLat + latPad) continue;
      const segMinLon = a.lon < b.lon ? a.lon : b.lon;
      const segMaxLon = a.lon > b.lon ? a.lon : b.lon;
      if (waypoint.lon < segMinLon - lonPad || waypoint.lon > segMaxLon + lonPad) continue;
      if (pointToSegmentMeters(waypoint, a, b) <= maxMeters) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Projects a multi-track document onto a single selected track while filtering waypoints to those
 * belonging to the selected track (same KML folder or within proximity threshold).
 */
export function buildTrackViewGpx(sourceGpx, selectedIndex) {
  if (!sourceGpx || selectedIndex === null || selectedIndex === undefined) return sourceGpx;
  const tracks = sourceGpx.tracks || [];
  if (tracks.length < 2 || selectedIndex < 0 || selectedIndex >= tracks.length) return sourceGpx;
  const track = tracks[selectedIndex];
  const bounds = trackBounds(track);
  const trackFolder = track.folder || '';
  const otherTrackFolders = new Set();
  tracks.forEach((other, index) => {
    if (index !== selectedIndex && other.folder && other.folder !== trackFolder) {
      otherTrackFolders.add(other.folder);
    }
  });
  const waypoints = (sourceGpx.waypoints || []).filter((waypoint) => {
    const wpFolder = waypoint.folder || '';
    if (trackFolder && wpFolder === trackFolder) return true;
    if (wpFolder && otherTrackFolders.has(wpFolder)) return false;
    return waypointMatchesTrack(waypoint, track, WAYPOINT_MATCH_METERS, bounds);
  });
  return {
    ...sourceGpx,
    name: track.name || sourceGpx.name,
    tracks: [track],
    routes: [],
    waypoints,
  };
}

/** Returns per-track metadata with matching map palette indices. */
export function extractTrackChoices(sourceGpx, sourceModel) {
  const groups = sourceModel?.trackGroups || [];
  const choices = [];
  let colorIndex = 0;
  groups.forEach((group, index) => {
    const distance = group.segments.reduce((sum, segment) => sum + (segment.length || 0), 0);
    choices.push({
      index,
      name: group.track?.name || '',
      distanceMeters: distance,
      colorIndex,
      segmentCount: group.segments.length,
    });
    colorIndex += group.segments.length;
  });
  return choices;
}

/** Collapsible multi-track switcher stacked under the summary/splits card on the left. */
export function createTrackSelector({
  node, el, t, formatDistance, onSelect, onLayoutChange,
}) {
  let expanded = false;
  let currentGpx = null;
  let currentChoices = [];
  let selected = null;
  let totalDistanceMeters = 0;

  function labelFor(choice) {
    return choice.name || t('tracks.unnamed', { n: choice.index + 1 });
  }

  function paint() {
    if (!node) return;
    if (!currentGpx || currentGpx.network || currentChoices.length < 2) {
      node.hidden = true;
      node.classList.remove('expanded', 'filtered');
      node.textContent = '';
      onLayoutChange?.();
      return;
    }

    node.hidden = false;
    node.classList.toggle('expanded', expanded);
    node.classList.toggle('filtered', selected !== null);

    const activeChoice = selected !== null ? currentChoices[selected] : null;
    const header = el('div', 'track-selector-header');
    const toggle = el('button', 'track-selector-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.title = t('tracks.toggleTitle');
    toggle.setAttribute('aria-label', t('tracks.toggleTitle'));

    const label = el('span', 'track-selector-label');
    if (activeChoice) {
      const dot = el('span', 'track-selector-dot');
      dot.style.backgroundColor = trackColorForIndex(activeChoice.colorIndex);
      label.append(dot, el('span', 'track-selector-name', labelFor(activeChoice)));
    } else {
      label.append(
        iconElement('multi-track', { className: 'track-selector-icon' }),
        el('span', 'track-selector-name', t('tracks.title')),
      );
    }

    const countText = activeChoice
      ? `${selected + 1}/${currentChoices.length}`
      : t('tracks.count', { n: currentChoices.length });
    const count = el('span', 'track-selector-count', countText);
    const compactCount = el('span', 'track-selector-count-compact', String(currentChoices.length));
    toggle.append(label, count, compactCount, iconElement('chevron-down', { className: 'track-selector-chevron' }));
    toggle.addEventListener('click', () => {
      expanded = !expanded;
      paint();
    });
    header.append(toggle);

    if (!expanded) {
      node.replaceChildren(header);
      onLayoutChange?.();
      return;
    }

    const prevList = node.querySelector('.track-selector-list');
    const prevScrollTop = prevList ? prevList.scrollTop : 0;
    const activeEl = document.activeElement;
    let prevFocusKey = null;
    if (activeEl instanceof HTMLElement && prevList?.contains(activeEl)) {
      prevFocusKey = activeEl.dataset.trackIndex ?? 'all';
    }

    const list = el('div', 'track-selector-list');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', t('tracks.title'));

    const allBtn = el('button', selected === null ? 'track-selector-item selected' : 'track-selector-item');
    allBtn.type = 'button';
    allBtn.setAttribute('role', 'option');
    allBtn.setAttribute('aria-selected', String(selected === null));
    allBtn.dataset.trackIndex = 'all';
    allBtn.append(
      el('span', 'track-selector-dot is-all'),
      el('span', 'track-selector-item-name', t('tracks.all')),
      el('span', 'track-selector-item-meta', formatDistance(totalDistanceMeters)),
    );
    allBtn.addEventListener('click', () => {
      if (selected === null) return;
      selected = null;
      onSelect?.(null);
      paint();
    });
    list.append(allBtn);

    for (const choice of currentChoices) {
      const isSelected = selected === choice.index;
      const item = el('button', isSelected ? 'track-selector-item selected' : 'track-selector-item');
      item.type = 'button';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(isSelected));
      item.dataset.trackIndex = String(choice.index);
      const dot = el('span', 'track-selector-dot');
      dot.style.backgroundColor = trackColorForIndex(choice.colorIndex);
      const nameSpan = el('span', 'track-selector-item-name', labelFor(choice));
      nameSpan.title = labelFor(choice);
      const meta = el('span', 'track-selector-item-meta', formatDistance(choice.distanceMeters));
      item.append(dot, nameSpan, meta);
      item.addEventListener('click', () => {
        const next = isSelected ? null : choice.index;
        selected = next;
        onSelect?.(next);
        paint();
      });
      list.append(item);
    }

    const content = el('div', 'track-selector-content');
    content.append(list);
    node.replaceChildren(header, content);
    if (prevScrollTop > 0) list.scrollTop = prevScrollTop;
    if (prevFocusKey !== null) {
      const target = list.querySelector(`.track-selector-item[data-track-index="${prevFocusKey}"]`);
      if (target instanceof HTMLElement) target.focus({ preventScroll: true });
    }
    onLayoutChange?.();
  }

  return {
    render(sourceGpx, sourceModel, selectedIndex = null) {
      currentGpx = sourceGpx;
      currentChoices = extractTrackChoices(sourceGpx, sourceModel);
      totalDistanceMeters = sourceModel?.trackDistanceMeters || 0;
      selected = selectedIndex !== null && selectedIndex >= 0 && selectedIndex < currentChoices.length
        ? selectedIndex
        : null;
      if (currentChoices.length < 2) expanded = false;
      paint();
    },
    setSelected(selectedIndex) {
      selected = selectedIndex !== null && selectedIndex >= 0 && selectedIndex < currentChoices.length
        ? selectedIndex
        : null;
      paint();
    },
    relabel() {
      paint();
    },
    refreshTheme() {
      paint();
    },
    isOpen: () => expanded,
    selectedIndex: () => selected,
    choices: () => currentChoices,
    open() {
      if (currentChoices.length < 2) return;
      expanded = true;
      paint();
    },
    close() {
      if (!expanded) return;
      expanded = false;
      paint();
    },
  };
}
