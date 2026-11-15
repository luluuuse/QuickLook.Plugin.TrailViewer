// A separate, collapsed-by-default split panel below the route summary. Only the entry is in the DOM until
// the user asks for the per-kilometre data; the full SplitData model is prepared for the detailed phase.

const BASIC_COLUMNS = Object.freeze(['index', 'distance', 'time', 'movingSpeed']);

export const DETAIL_COLUMNS = Object.freeze([
  'index',
  'distance',
  'time',
  'cumulativeTime',
  'ascent',
  'descent',
  'heartRate',
  'movingSpeed',
  'verticalSpeed',
]);

function svgIcon(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add(kind === 'chevron' ? 'split-chevron' : 'split-icon');
  const paths = {
    route: ['M3 18l5-9 5 4 7-9'],
    index: ['M5 5h14', 'M5 12h14', 'M5 19h14'],
    distance: ['M3 18l5-9 5 4 7-9'],
    time: ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z', 'M12 8v5l3 2'],
    cumulativeTime: ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z', 'M12 8v5l3 2', 'M4 4l2 2'],
    ascent: ['M12 19V6', 'M6 12l6-6 6 6'],
    descent: ['M12 5v13', 'M6 12l6 6 6-6'],
    heartRate: ['M12 20S4 15.7 4 9.8A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 8 2.8C20 15.7 12 20 12 20Z'],
    movingSpeed: ['M4 17a9 9 0 1 1 16 0', 'M12 14l4-5'],
    verticalSpeed: ['M5 17a8 8 0 1 1 14 0', 'M12 14l3-6', 'M10 5h4', 'M12 3v4'],
    chevron: ['M7 10l5 5 5-5'],
  };
  for (const definition of paths[kind] || paths.index) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', definition);
    svg.append(path);
  }
  return svg;
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
 * @param {{ el: Function, t: Function, formatSpeed: Function, formatTimer: Function, onLayoutChange?: Function, onSelect?: Function }} deps
 */
export function createSplitsView({
  el,
  t,
  formatSpeed,
  formatTimer,
  onLayoutChange,
  onSelect,
}) {
  const panel = document.getElementById('splits');
  let data = null;
  let summary = null;
  let expanded = false;
  let selectedIndex = null;
  let mode = 'basic';
  let focusActivatedIndex = null;

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
      colgroup.append(col);
    }
    for (const column of columns) {
      headRow.append(headerCell(el, column, labels[column]));
    }
    head.append(headRow);

    const body = el('tbody');
    for (const split of data.splits) {
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
        if (column === 'index') cell.textContent = String(split.index);
        else if (column === 'distance') cell.textContent = splitDistanceText(split.distanceMeters, t);
        else if (column === 'time') cell.textContent = timeText(split.elapsedSeconds, formatTimer);
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

    const totals = el('div', 'splits-totals');
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
    content.append(totals);
    return content;
  }

  function draw() {
    const available = Boolean(data && data.splits.length > 0
      && data.splits.some((split) => split.elapsedSeconds !== null));
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
    label.append(svgIcon('route'), el('span', null, t('splits.title')));
    const count = el('span', 'split-toggle-count', t('splits.count', { count: data.splits.length }));
    toggle.append(label, count, svgIcon('chevron'));
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
    render(nextData, nextSummary, { reset = false } = {}) {
      if (reset) {
        clearSelection(false);
        expanded = false;
        mode = 'basic';
      }
      data = nextData;
      summary = nextSummary;
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
    selected: () => selectedIndex,
    mode: () => mode,
    setMode,
    toggleMode: () => setMode(mode === 'detailed' ? 'basic' : 'detailed'),
  };
}
