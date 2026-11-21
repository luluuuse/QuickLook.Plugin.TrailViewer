// A separate, collapsed-by-default split panel below the route summary. Only the entry is in the DOM until
// the user asks for the per-kilometre data; the full SplitData model is prepared for the detailed phase.
import { iconElement } from './icons.js';

const BASIC_COLUMNS = Object.freeze(['index', 'time', 'ascent', 'movingSpeed']);

const COLUMN_WIDTHS = Object.freeze({
  index: 30,
  time: 54,
  cumulativeTime: 60,
  ascent: 44,
  descent: 44,
  heartRate: 52,
  movingSpeed: 64,
  verticalSpeed: 72,
});

export const DETAIL_COLUMNS = Object.freeze([
  'index',
  'time',
  'cumulativeTime',
  'ascent',
  'descent',
  'heartRate',
  'movingSpeed',
  'verticalSpeed',
]);

const BAR_COLUMNS = new Set([
  'distance',
  'time',
  'ascent',
  'descent',
  'heartRate',
  'movingSpeed',
  'verticalSpeed',
]);

function splitMetric(split, column) {
  if (column === 'index') return split.index;
  if (column === 'distance') return split.distanceMeters;
  if (column === 'time') return split.elapsedSeconds;
  if (column === 'cumulativeTime') return split.cumulativeSeconds;
  if (column === 'ascent') return split.ascentMeters;
  if (column === 'descent') return split.descentMeters;
  if (column === 'heartRate') return split.averageHeartRate;
  if (column === 'movingSpeed') return split.averageSpeedMps;
  if (column === 'verticalSpeed') return split.verticalSpeedMps;
  return null;
}

function headerCell(el, kind, label) {
  const cell = el('th');
  cell.scope = 'col';
  cell.className = `split-column split-${kind}`;
  cell.append(el('span', 'split-column-label', label));
  return cell;
}

function timeText(seconds, formatTimer, forceHours = false) {
  return seconds === null || seconds === undefined ? '\u2014' : formatTimer(seconds, forceHours);
}

function speedText(speed, formatSpeed) {
  return speed === null || speed === undefined ? '\u2014' : formatSpeed(speed);
}

function splitDistanceText(meters, t) {
  return `${(meters / 1000).toFixed(2)} ${t('unit.km')}`;
}

function elevationText(meters, t) {
  return Number.isFinite(meters) ? `${Math.round(meters)} ${t('unit.m')}` : '\u2014';
}

function heartRateText(rate) {
  return Number.isFinite(rate) ? `${Math.round(rate)} bpm` : '\u2014';
}

function verticalSpeedText(speed, t) {
  return Number.isFinite(speed) ? `${Math.round(speed * 3600)} ${t('unit.mPerHour')}` : '\u2014';
}

/**
 * @param {{ el: Function, t: Function, formatSpeed: Function, formatTimer: Function, loadData: Function, onLayoutChange?: Function, onSelect?: Function }} deps
 */
export function createSplitsView({
  el,
  t,
  formatSpeed,
  formatTimer,
  loadData,
  onLayoutChange,
  onSelect,
}) {
  const panel = document.getElementById('splits');
  let data = null;
  let summary = null;
  let expectedCount = 0;
  let previewAvailable = false;
  let expanded = false;
  let selectedIndex = null;
  let mode = 'basic';
  let sortColumn = null;
  let sortDirection = 'desc';
  let focusActivatedIndex = null;

  function ensureData() {
    if (!data) data = loadData();
    return data;
  }

  function updateSelectionRows() {
    for (const row of panel.querySelectorAll('.splits-table tbody tr')) {
      const selected = Number(row.getAttribute('data-split-index')) === selectedIndex;
      row.classList.toggle('selected', selected);
      row.setAttribute('aria-selected', String(selected));
    }
  }

  function clearSelection(notify = true) {
    if (selectedIndex === null) return;
    selectedIndex = null;
    updateSelectionRows();
    if (notify) onSelect?.(null);
  }

  function select(index) {
    selectedIndex = index;
    updateSelectionRows();
    onSelect?.(data.splits[index - 1]);
  }

  function choose(index) {
    const next = selectedIndex === index ? null : index;
    selectedIndex = next;
    updateSelectionRows();
    onSelect?.(next === null ? null : data.splits[next - 1]);
  }

  function renderTable() {
    const content = el('div', 'split-content');
    content.id = 'splits-content';

    const scroller = el('div', 'splits-scroll');
    const table = el('table', 'splits-table');
    table.classList.add(mode, data.hasHeartRate ? 'with-heart' : 'without-heart');
    const caption = el('caption', 'visually-hidden', t('splits.caption'));
    const head = el('thead');
    const headRow = el('tr');
    const labels = {
      index: t('splits.index'),
      distance: t('splits.distance'),
      time: t('splits.time'),
      cumulativeTime: t('splits.cumulativeTime'),
      ascent: t('splits.ascent'),
      descent: t('splits.descent'),
      heartRate: t('splits.heartRate'),
      movingSpeed: t('splits.movingSpeed'),
      verticalSpeed: t('splits.verticalSpeed'),
    };
    const columns = mode === 'detailed'
      ? DETAIL_COLUMNS.filter((column) => column !== 'heartRate' || data.hasHeartRate)
      : BASIC_COLUMNS;
    const colgroup = el('colgroup');
    for (const column of columns) {
      const col = el('col', `split-column-${column}`);
      col.style.width = `${COLUMN_WIDTHS[column]}px`;
      colgroup.append(col);
    }
    const tableWidth = columns.reduce((sum, column) => sum + COLUMN_WIDTHS[column], 0);
    table.style.width = `${tableWidth}px`;
    panel.style.setProperty('--split-table-width', `${tableWidth}px`);
    for (const column of columns) {
      const cell = headerCell(el, column, labels[column]);
      cell.classList.add('sortable');
      cell.tabIndex = 0;
      const active = sortColumn === column;
      cell.setAttribute('aria-sort', active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none');
      const hint = t('splits.sortHint', { label: labels[column] });
      cell.title = column === 'heartRate' ? `${t('splits.heartRateTitle')} · ${hint}` : hint;
      cell.setAttribute('aria-label', cell.title);
      const toggleSort = () => {
        if (sortColumn !== column) {
          sortColumn = column;
          sortDirection = column === 'index' ? 'asc' : 'desc';
        } else if (sortDirection === (column === 'index' ? 'asc' : 'desc')) {
          sortDirection = column === 'index' ? 'desc' : 'asc';
        } else {
          sortColumn = null;
          sortDirection = 'desc';
        }
        draw();
      };
      cell.addEventListener('click', toggleSort);
      cell.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggleSort();
      });
      headRow.append(cell);
    }
    head.append(headRow);

    const barMax = {};
    for (const column of columns) {
      if (!BAR_COLUMNS.has(column)) continue;
      let maxVal = 0;
      for (const split of data.splits) {
        const raw = splitMetric(split, column);
        const val = column === 'verticalSpeed' && Number.isFinite(raw) ? Math.abs(raw) : raw;
        if (Number.isFinite(val) && val > maxVal) maxVal = val;
      }
      barMax[column] = maxVal;
    }

    const isPartialSplit = (split) =>
      split.index === data.splits.length && split.distanceMeters < 995;

    const orderedSplits = sortColumn
      ? [...data.splits].sort((a, b) => {
        if (sortColumn !== 'index') {
          const aPartial = isPartialSplit(a);
          const bPartial = isPartialSplit(b);
          if (aPartial !== bPartial) return aPartial ? 1 : -1;
        }
        const av = splitMetric(a, sortColumn);
        const bv = splitMetric(b, sortColumn);
        const aOk = Number.isFinite(av);
        const bOk = Number.isFinite(bv);
        if (!aOk && !bOk) return a.index - b.index;
        if (!aOk) return 1;
        if (!bOk) return -1;
        if (av === bv) return a.index - b.index;
        return sortDirection === 'asc' ? av - bv : bv - av;
      })
      : data.splits;

    const body = el('tbody');
    for (const split of orderedSplits) {
      const isPartialLast = isPartialSplit(split);
      const row = el('tr');
      row.classList.toggle('fastest', split.index === data.fastestIndex);
      row.classList.toggle('selected', split.index === selectedIndex);
      row.dataset.splitIndex = String(split.index);
      row.tabIndex = 0;
      row.setAttribute('aria-selected', String(split.index === selectedIndex));
      row.title = t('splits.rowHint', {
        index: split.index,
        distance: splitDistanceText(split.distanceMeters, t),
        time: timeText(split.elapsedSeconds, formatTimer),
        speed: speedText(split.averageSpeedMps, formatSpeed),
      });

      for (const column of columns) {
        const cell = el('td', column === 'index' ? 'split-number' : `split-${column}`);
        if (column === 'index') {
          cell.textContent = isPartialLast ? `${split.index}*` : String(split.index);
          if (isPartialLast) {
            cell.classList.add('is-partial');
            cell.title = row.title;
          }
        } else if (column === 'time') cell.textContent = timeText(split.elapsedSeconds, formatTimer);
        else if (column === 'cumulativeTime') cell.textContent = timeText(split.cumulativeSeconds, formatTimer);
        else if (column === 'ascent') cell.textContent = elevationText(split.ascentMeters, t);
        else if (column === 'descent') cell.textContent = elevationText(split.descentMeters, t);
        else if (column === 'heartRate') cell.textContent = heartRateText(split.averageHeartRate);
        else if (column === 'verticalSpeed') cell.textContent = verticalSpeedText(split.verticalSpeedMps, t);
        else {
          cell.classList.add('split-speed');
          const value = el('span', null, speedText(split.averageSpeedMps, formatSpeed));
          value.title = t('splits.speedHint');
          cell.append(value);
        }
        const maxVal = barMax[column];
        const metricVal = maxVal > 0 ? splitMetric(split, column) : null;
        if (Number.isFinite(metricVal) && metricVal !== 0) {
          const pct = Math.min(100, Math.max(0, (Math.abs(metricVal) / maxVal) * 100));
          cell.classList.add('has-bar');
          if (metricVal < 0) cell.classList.add('is-negative');
          cell.style.setProperty('--split-bar', `${pct.toFixed(1)}%`);
        }
        row.append(cell);
      }
      row.addEventListener('focus', () => {
        if (selectedIndex !== split.index) {
          select(split.index);
          focusActivatedIndex = split.index;
        }
      });
      row.addEventListener('blur', () => {
        if (focusActivatedIndex === split.index) focusActivatedIndex = null;
      });
      row.addEventListener('click', () => {
        // Moving focus into an unselected row already selected it. Consume that focus-generated click so the
        // pointer action does not immediately toggle the new selection back off.
        if (focusActivatedIndex === split.index) {
          focusActivatedIndex = null;
          return;
        }
        choose(split.index);
      });
      body.append(row);
    }

    table.append(caption, colgroup, head, body);
    scroller.append(table);
    content.append(scroller);

    const totals = el('div', `splits-totals ${mode}`);
    const totalCell = el('div', 'split-total');
    totalCell.append(
      el('strong', null, timeText(summary.durationSeconds, formatTimer, true)),
      el('span', null, t('splits.totalTime')),
    );
    const movingCell = el('div', 'split-total');
    movingCell.append(
      el('strong', null, timeText(summary.movingDurationSeconds, formatTimer, true)),
      el('span', null, t('splits.movingTime')),
    );
    totals.append(totalCell, movingCell);
    if (mode === 'detailed') {
      const recordedRest = summary.pausedSeconds;
      const derivedRest = summary.durationSeconds !== null && summary.movingDurationSeconds !== null
        ? Math.max(0, summary.durationSeconds - summary.movingDurationSeconds)
        : null;
      const restCell = el('div', 'split-total');
      restCell.append(
        el('strong', null, timeText(
          Number.isFinite(recordedRest) ? recordedRest : derivedRest,
          formatTimer,
          true,
        )),
        el('span', null, t('splits.restTime')),
      );
      totals.append(restCell);
    }
    content.append(totals);
    return content;
  }

  function draw() {
    const loaded = expanded ? ensureData() : data;
    const available = loaded
      ? loaded.splits.length > 0 && loaded.splits.some((split) => split.elapsedSeconds !== null)
      : previewAvailable && expectedCount > 0;
    panel.hidden = !available;
    panel.replaceChildren();
    panel.classList.toggle('expanded', available && expanded);
    panel.dataset.mode = mode;
    if (!available) return;

    const header = el('div', 'split-panel-header');
    const toggle = el('button', 'split-toggle');
    toggle.type = 'button';
    toggle.id = 'splits-toggle';
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-controls', 'splits-content');
    toggle.title = t(expanded ? 'splits.closeTitle' : 'splits.openTitle');
    toggle.setAttribute('aria-label', toggle.title);

    const label = el('span', 'split-toggle-label');
    label.id = 'splits-title';
    label.append(iconElement('route', { className: 'split-icon' }), el('span', null, t('splits.title')));
    const splitCountValue = loaded?.splits.length || expectedCount;
    const count = el('span', 'split-toggle-count', t('splits.count', {
      count: splitCountValue,
    }));
    const compactCount = el('span', 'split-toggle-count-compact', String(splitCountValue));
    toggle.append(label, count, compactCount, iconElement('chevron-down', { className: 'split-chevron' }));
    toggle.addEventListener('click', () => setExpanded(!expanded));
    header.append(toggle);
    if (expanded) {
      const modeToggle = el('button', 'split-mode-toggle', t(mode === 'detailed' ? 'splits.basic' : 'splits.detailed'));
      modeToggle.type = 'button';
      modeToggle.setAttribute('aria-pressed', String(mode === 'detailed'));
      modeToggle.title = t(mode === 'detailed' ? 'splits.basicTitle' : 'splits.detailedTitle');
      modeToggle.setAttribute('aria-label', modeToggle.title);
      modeToggle.addEventListener('click', () => setMode(mode === 'detailed' ? 'basic' : 'detailed'));
      header.append(modeToggle);
    }
    panel.setAttribute('aria-labelledby', 'splits-title');
    panel.append(header);
    if (expanded) panel.append(renderTable());
    updateSelectionRows();
  }

  function setExpanded(next) {
    if (!next) {
      clearSelection();
    }
    expanded = Boolean(next);
    draw();
    requestAnimationFrame(() => onLayoutChange?.());
  }

  function setMode(next) {
    if (!(next === 'basic' || next === 'detailed') || next === mode) return;
    mode = next;
    draw();
    requestAnimationFrame(() => onLayoutChange?.());
  }

  return {
    render(nextSummary, { reset = false, count = 0, available = false } = {}) {
      if (reset) {
        clearSelection(false);
        expanded = false;
        mode = 'basic';
        sortColumn = null;
        sortDirection = 'desc';
        data = null;
      }
      summary = nextSummary;
      expectedCount = count;
      previewAvailable = available;
      draw();
      if (reset) onSelect?.(null);
    },
    open: () => setExpanded(true),
    close: () => setExpanded(false),
    toggle: () => setExpanded(!expanded),
    isOpen: () => expanded,
    select: (index) => {
      if (Number.isInteger(index) && index >= 1 && index <= (data?.splits.length || 0)) choose(index);
    },
    clearSelection: () => clearSelection(false),
    selected: () => selectedIndex,
    loaded: () => Boolean(data),
    mode: () => mode,
    setMode,
    toggleMode: () => setMode(mode === 'detailed' ? 'basic' : 'detailed'),
  };
}
