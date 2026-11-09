import { formatDistance, formatElevation } from './format.js';
import { t, units } from './i18n.js';
import { classifyWaypoint, INSIGHT_KEYS } from './waypoint-insights.js';
import { readStored, removeStored, writeStored } from './storage.js';

const OVERRIDE_KEY = 'waypoint-insights';
const MANUAL_IMPORTANT = new Set(['danger', 'water', 'camp', 'supply', 'exit']);

function loadOverrides() {
  try {
    const parsed = JSON.parse(readStored(OVERRIDE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Scrollable waypoint overview. It is deliberately a list rather than a search box: hikers scan the route in
 * order, then click the camp, pass or photo stop they need.
 */
export function createWaypointOverview({ el, onSelect, onLayoutChange }) {
  let panel = null;
  let filterTrigger = null;
  let filterMenu = null;
  let list = null;
  let closeButton = null;
  let toggleButton = null;
  let currentItems = [];
  let selectedIndex = -1;
  let activeFilter = 'all';
  let openPopover = null;
  let currentRow = null;
  const insights = new WeakMap();
  const overrides = loadOverrides();

  function pointKey(point) {
    return `${Number(point.lat).toFixed(6)},${Number(point.lon).toFixed(6)}`;
  }

  function insightOf(item) {
    let insight = insights.get(item.stop.point);
    if (!insight) {
      const automatic = classifyWaypoint(item.stop.point);
      const override = overrides[pointKey(item.stop.point)];
      if (override === 'clear') {
        insight = { primary: null, categories: [], important: false, evidence: [], contexts: [] };
      } else if (INSIGHT_KEYS.includes(override)) {
        insight = {
          primary: override,
          categories: [{
            key: override,
            important: MANUAL_IMPORTANT.has(override),
            confidence: 'high',
            evidence: [t('overview.manualEvidence')],
            contexts: [t('overview.manualEvidence')],
          }],
          important: MANUAL_IMPORTANT.has(override),
          evidence: [t('overview.manualEvidence')],
          contexts: [t('overview.manualEvidence')],
          manual: true,
        };
      } else {
        insight = automatic;
      }
      insights.set(item.stop.point, insight);
    }
    return insight;
  }

  function setOverride(point, value) {
    const key = pointKey(point);
    if (!value || value === 'auto') delete overrides[key];
    else overrides[key] = value;
    insights.delete(point);
    if (Object.keys(overrides).length === 0) removeStored(OVERRIDE_KEY);
    else writeStored(OVERRIDE_KEY, JSON.stringify(overrides));
    render();
  }

  function closePopover(restoreFocus = false) {
    if (!openPopover) return;
    const { trigger, menu } = openPopover;
    trigger.setAttribute('aria-expanded', 'false');
    menu.remove();
    openPopover = null;
    if (restoreFocus) trigger.focus({ preventScroll: true });
  }

  function positionPopover(menu, trigger) {
    const anchor = trigger.getBoundingClientRect();
    const bounds = menu.getBoundingClientRect();
    const margin = 8;
    const gap = 4;
    let left = anchor.right - bounds.width;
    let top = anchor.bottom + gap;
    left = Math.max(margin, Math.min(left, innerWidth - margin - bounds.width));
    if (top + bounds.height > innerHeight - margin) top = anchor.top - bounds.height - gap;
    top = Math.max(margin, top);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  function openMenu(trigger, menu) {
    closePopover();
    document.body.append(menu);
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    openPopover = { trigger, menu };
    positionPopover(menu, trigger);
    (menu.querySelector('[aria-checked="true"]') || menu.querySelector('button'))?.focus({ preventScroll: true });
  }

  function correctionMenu(point, name) {
    const menu = el('div', 'waypoint-popover waypoint-correct-menu');
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    const label = `${t('overview.correct')}: ${name}`;
    menu.setAttribute('aria-label', label);
    menu.append(el('strong', 'waypoint-popover-title', label));
    const selectedValue = overrides[pointKey(point)] || 'auto';
    for (const [value, text] of [
      ['auto', t('overview.auto')],
      ...INSIGHT_KEYS.map((key) => [key, t(`insight.${key}`)]),
      ['clear', t('overview.clear')],
    ]) {
      const option = el('button', `waypoint-correct-option insight-${value}`, text);
      option.type = 'button';
      option.dataset.value = value;
      option.setAttribute('role', 'menuitemradio');
      option.setAttribute('aria-checked', String(value === selectedValue));
      option.classList.toggle('selected', value === selectedValue);
      option.addEventListener('click', () => setOverride(point, value));
      menu.append(option);
    }
    return menu;
  }

  function build() {
    panel = el('aside', 'waypoint-overview');
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.tabIndex = -1;

    const header = el('div', 'waypoint-overview-header');
    const title = el('strong', null, t('overview.title'));
    title.id = 'waypoint-overview-title';
    panel.setAttribute('aria-labelledby', title.id);
    const headerActions = el('div', 'waypoint-overview-header-actions');
    filterTrigger = el('button', 'waypoint-filter-trigger');
    filterTrigger.type = 'button';
    filterTrigger.dataset.filterTrigger = '';
    filterTrigger.setAttribute('aria-haspopup', 'menu');
    filterTrigger.setAttribute('aria-expanded', 'false');
    filterTrigger.addEventListener('click', () => {
      if (filterTrigger.getAttribute('aria-expanded') === 'true') closePopover();
      else openMenu(filterTrigger, filterMenu);
    });
    closeButton = el('button', 'close', '\u00d7');
    closeButton.type = 'button';
    closeButton.title = t('overview.close');
    closeButton.setAttribute('aria-label', t('overview.close'));
    closeButton.addEventListener('click', close);
    headerActions.append(filterTrigger, closeButton);
    header.append(title, headerActions);
    filterMenu = el('div', 'waypoint-popover waypoint-filter-menu');
    filterMenu.hidden = true;
    filterMenu.setAttribute('role', 'menu');
    list = el('div', 'waypoint-overview-list');
    panel.append(header, list);
    panel.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (openPopover) return;
      close();
    });
    list.addEventListener('scroll', () => {
      if (openPopover) positionPopover(openPopover.menu, openPopover.trigger);
    }, { passive: true });
    document.addEventListener('pointerdown', (event) => {
      if (!openPopover) return;
      if (openPopover.menu.contains(event.target) || openPopover.trigger.contains(event.target)) return;
      closePopover();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !openPopover) return;
      event.preventDefault();
      event.stopPropagation();
      closePopover(true);
    });
    window.addEventListener('resize', () => closePopover());
    document.body.append(panel);
  }

  function renderFilters() {
    const counts = Object.fromEntries(INSIGHT_KEYS.map((key) => [key, 0]));
    let important = 0;
    for (const item of currentItems) {
      const insight = insightOf(item);
      if (insight.important) important += 1;
      for (const category of insight.categories) counts[category.key] += 1;
    }
    const choices = [{ key: 'all', count: currentItems.length }];
    if (important > 0) choices.push({ key: 'important', count: important });
    for (const key of INSIGHT_KEYS) {
      if (counts[key] > 0) choices.push({ key, count: counts[key] });
    }
    if (!choices.some((choice) => choice.key === activeFilter)) activeFilter = 'all';
    filterMenu.replaceChildren();
    if (choices.length <= 1) {
      filterTrigger.hidden = true;
      return;
    }
    filterTrigger.hidden = false;
    const current = choices.find((choice) => choice.key === activeFilter);
    const currentLabel = `${t(current.key === 'all' ? 'overview.all' : current.key === 'important'
      ? 'overview.important' : `insight.${current.key}`)} ${current.count}`;
    filterTrigger.replaceChildren(
      el('span', 'waypoint-filter-label', `${t('overview.filter')} · ${currentLabel}`),
      el('span', 'waypoint-filter-chevron', '\u25be'),
    );
    filterTrigger.lastElementChild.setAttribute('aria-hidden', 'true');
    filterTrigger.title = t('overview.filterTitle');
    filterTrigger.setAttribute('aria-label', `${t('overview.filterTitle')}: ${currentLabel}`);
    for (const choice of choices) {
      const button = el('button', 'insight-filter');
      button.type = 'button';
      button.dataset.filter = choice.key;
      button.setAttribute('role', 'menuitemradio');
      button.textContent = `${t(choice.key === 'all' ? 'overview.all' : choice.key === 'important'
        ? 'overview.important' : `insight.${choice.key}`)} ${choice.count}`;
      button.classList.toggle('active', activeFilter === choice.key);
      button.setAttribute('aria-checked', String(activeFilter === choice.key));
      button.addEventListener('click', () => {
        activeFilter = choice.key;
        render();
        filterTrigger.focus({ preventScroll: true });
      });
      filterMenu.append(button);
    }
  }

  function scrollCurrentIntoView() {
    if (!panel || panel.hidden || !currentRow) return;
    const listBox = list.getBoundingClientRect();
    const rowBox = currentRow.getBoundingClientRect();
    if (rowBox.top < listBox.top) list.scrollTop -= listBox.top - rowBox.top;
    else if (rowBox.bottom > listBox.bottom) list.scrollTop += rowBox.bottom - listBox.bottom;
  }

  function render() {
    if (!panel) return;
    closePopover();
    panel.querySelector('.waypoint-overview-header strong').textContent = t('overview.title');
    closeButton.title = t('overview.close');
    closeButton.setAttribute('aria-label', t('overview.close'));
    renderFilters();
    list.replaceChildren();

    const visible = currentItems.filter((item) => {
      const insight = insightOf(item);
      if (activeFilter === 'all') return true;
      if (activeFilter === 'important') return insight.important;
      return insight.categories.some((category) => category.key === activeFilter);
    });
    const selectedItem = currentItems.find((item) =>
      (item.members || [item.index]).includes(selectedIndex));
    const selectedVisible = selectedItem && visible.includes(selectedItem);
    currentRow = null;

    function makeRow(item, { pinned = false } = {}) {
      const { stop, index } = item;
      const insight = insightOf(item);
      const row = el('div', 'waypoint-overview-item');
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.dataset.waypoint = String(index);
      if (insight.primary) {
        row.classList.add(`insight-${insight.primary}`);
        row.dataset.primary = insight.primary;
      }
      if (insight.important) row.classList.add('important');
      if (insight.evidence.length > 0) {
        row.title = `${t('overview.evidence')}: ${insight.evidence.join(', ')}`;
      }
      const heading = el('span', 'heading');
      const name = stop.point.name || t('label.waypoint');
      const actions = el('span', 'waypoint-heading-actions');
      const override = overrides[pointKey(stop.point)];
      const correct = el('button', 'waypoint-correct-button', '\u270e');
      correct.type = 'button';
      correct.title = t('overview.correct');
      correct.setAttribute('aria-label', `${t('overview.correct')}: ${name}`);
      correct.setAttribute('aria-haspopup', 'menu');
      correct.setAttribute('aria-expanded', 'false');
      correct.classList.toggle('manual', Boolean(override && override !== 'auto'));
      correct.addEventListener('click', (event) => {
        event.stopPropagation();
        if (openPopover?.trigger === correct) {
          closePopover();
          return;
        }
        openMenu(correct, correctionMenu(stop.point, name));
      });
      actions.append(el('span', 'number', String(index + 1)), correct);
      heading.append(el('strong', null, name), actions);
      const meta = [];
      if (Number.isFinite(stop.along)) meta.push(formatDistance(stop.along));
      if (stop.point.ele !== undefined) meta.push(formatElevation(stop.point.ele));
      if (stop.photos.length > 0) meta.push(units(stop.photos.length, 'photo'));
      if (stop.mergedCount > 1) meta.push(t('overview.merged', { count: stop.mergedCount }));
      row.append(heading);
      if (pinned) row.append(el('span', 'waypoint-current-label', t('overview.current')));
      if (meta.length > 0) row.append(el('span', 'meta', meta.join(' \u00b7 ')));
      if (insight.categories.length > 0) {
        const badges = el('span', 'waypoint-insight-badges');
        for (const category of insight.categories) {
          const badge = el('span', `waypoint-insight-badge insight-${category.key}`, t(`insight.${category.key}`));
          if (category.confidence === 'medium') {
            badge.classList.add('possible');
            badge.title = t('overview.mediumConfidence');
          }
          badges.append(badge);
        }
        row.append(badges);
        const context = insight.categories[0]?.contexts?.[0];
        row.append(el('span', 'waypoint-evidence',
          `${t('overview.evidence')}: ${context || insight.evidence.join(', ')}`));
      }
      if (stop.point.description) row.append(el('span', 'description', stop.point.description));
      const selected = (item.members || [index]).includes(selectedIndex);
      row.classList.toggle('selected', selected);
      row.classList.toggle('current-pinned', pinned);
      if (selected) {
        row.setAttribute('aria-current', 'true');
        currentRow = row;
      }
      const activate = () => {
        for (const node of list.querySelectorAll('.waypoint-overview-item')) {
          node.classList.toggle('selected', node === row);
          if (node === row) node.setAttribute('aria-current', 'true');
          else node.removeAttribute('aria-current');
        }
        onSelect(item.navIndex);
      };
      row.addEventListener('click', (event) => {
        if (!(event.target instanceof Element) || !event.target.closest('.waypoint-correct-button')) activate();
      });
      row.addEventListener('keydown', (event) => {
        if ((event.key === 'Enter' || event.key === ' ') && event.target === row) {
          event.preventDefault();
          activate();
        }
      });
      list.append(row);
    }

    if (selectedItem && !selectedVisible) {
      makeRow(selectedItem, { pinned: true });
    }
    for (const item of visible) makeRow(item);
    if (visible.length === 0 && !selectedItem) {
      list.append(el('p', 'waypoint-overview-empty', t('overview.empty')));
    }
    requestAnimationFrame(scrollCurrentIntoView);
  }

  function open(items, index) {
    if (!panel) build();
    currentItems = items;
    selectedIndex = index;
    render();
    panel.hidden = false;
    toggleButton?.setAttribute('aria-expanded', 'true');
    closeButton.focus({ preventScroll: true });
    onLayoutChange?.();
  }

  function close() {
    if (!panel || panel.hidden) return;
    closePopover();
    panel.hidden = true;
    toggleButton?.setAttribute('aria-expanded', 'false');
    toggleButton?.focus({ preventScroll: true });
    onLayoutChange?.();
  }

  return {
    attachButton(button) {
      toggleButton = button;
      button.setAttribute('aria-expanded', 'false');
    },
    toggle(items, index) {
      if (panel?.hidden === false) close();
      else open(items, index);
    },
    refresh(items, index) {
      currentItems = items;
      selectedIndex = index;
      if (panel && !panel.hidden) render();
    },
    relabel(items, index) {
      currentItems = items;
      selectedIndex = index;
      if (panel) render();
    },
    close,
    open,
    isOpen: () => Boolean(panel) && !panel.hidden,
  };
}
