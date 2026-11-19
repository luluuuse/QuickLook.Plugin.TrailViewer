import { iconElement } from './icons.js';

/** Distance-measurement subview and its section summary. */
export function createMeasureTool({ el, t, formatDistance, measurement, map, onBack }) {
  const view = el('section', 'toolbox-measure');
  view.hidden = true;
  const back = el('button', 'toolbox-back');
  back.type = 'button';
  back.append(iconElement('arrow-left'), el('span', null, t('toolbox.back')));
  back.addEventListener('click', () => onBack?.());
  const title = el('span', 'toolbox-measure-kicker', t('measure.active'));
  const total = el('strong', 'toolbox-measure-total', formatDistance(0));
  total.tabIndex = -1;
  total.setAttribute('aria-live', 'polite');
  const meta = el('span', 'toolbox-measure-meta');
  const instruction = el('p', 'toolbox-measure-help');
  const listHeading = el('strong', 'toolbox-list-heading', t('measure.sections'));
  const sectionList = el('ol', 'toolbox-section-list');
  const actions = el('div', 'toolbox-measure-actions');
  const actionButton = (icon, labelKey, name, className = '') => {
    const action = el('button', className);
    action.type = 'button';
    action.dataset.measure = name;
    action.append(iconElement(icon), el('span', 'toolbox-action-label', t(labelKey)));
    return action;
  };
  const finish = actionButton('finish-section', 'measure.finishSection', 'finish');
  finish.addEventListener('click', () => measurement.endSection());
  const centre = actionButton('center-point', 'measure.centerPoint', 'center');
  centre.addEventListener('click', () => measurement.addAt(map.getCenter()));
  const undo = actionButton('undo', 'measure.undo', 'undo');
  undo.addEventListener('click', () => measurement.undo());
  const redo = actionButton('redo', 'measure.redo', 'redo');
  redo.addEventListener('click', () => measurement.redo());
  const clear = actionButton('clear', 'measure.clear', 'clear', 'danger');
  clear.addEventListener('click', () => measurement.clear());
  const stop = actionButton('stop', 'measure.stop', 'stop', 'primary');
  stop.addEventListener('click', () => {
    if (measurement.active()) measurement.stop();
    else start();
  });
  actions.append(finish, centre, undo, redo, clear, stop);
  view.append(back, title, total, meta, instruction, listHeading, sectionList, actions);

  function render() {
    const summary = measurement.summary();
    const active = measurement.active();
    total.textContent = formatDistance(summary.totalMeters);
    meta.textContent = t('measure.summary', {
      sections: summary.sectionCount,
      points: summary.pointCount,
    });
    instruction.textContent = t('measure.instruction');
    finish.disabled = !measurement.canEndSection();
    undo.disabled = !measurement.canUndo();
    redo.disabled = !measurement.canRedo();
    clear.disabled = summary.pointCount === 0;
    stop.querySelector('.toolbox-action-label').textContent =
      t(active ? 'measure.stop' : 'measure.resume');
    undo.title = t('measure.undoTitle');
    redo.title = t('measure.redoTitle');
    stop.title = t(active ? 'measure.stopTitle' : 'measure.resumeTitle');
    undo.setAttribute('aria-label', undo.title);
    redo.setAttribute('aria-label', redo.title);
    stop.setAttribute('aria-label', stop.title);
    sectionList.replaceChildren();
    const rows = [];
    measurement.sections().forEach((points, index) => {
      if (points.length === 0) return;
      const meters = index < summary.segmentMeters.length ? summary.segmentMeters[index] : 0;
      rows.push(el('li', 'toolbox-section-row', t('measure.sectionRow', {
        index: index + 1,
        distance: formatDistance(meters),
        points: points.length,
      })));
    });
    if (rows.length === 0) rows.push(el('li', 'toolbox-empty', t('measure.empty')));
    sectionList.append(...rows);
  }

  function start() {
    measurement.start();
    render();
  }

  function relabel() {
    back.querySelector('span').textContent = t('toolbox.back');
    title.textContent = t('measure.active');
    listHeading.textContent = t('measure.sections');
    finish.querySelector('.toolbox-action-label').textContent = t('measure.finishSection');
    centre.querySelector('.toolbox-action-label').textContent = t('measure.centerPoint');
    undo.querySelector('.toolbox-action-label').textContent = t('measure.undo');
    redo.querySelector('.toolbox-action-label').textContent = t('measure.redo');
    clear.querySelector('.toolbox-action-label').textContent = t('measure.clear');
    render();
  }

  render();
  return {
    view,
    render,
    start,
    relabel,
    stopButton: stop,
    focusFinish: () => finish.focus({ preventScroll: true }),
  };
}
