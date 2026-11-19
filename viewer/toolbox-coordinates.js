import { formatCoord, formatElevation } from './format.js';
import { iconElement, weatherMarkElement } from './icons.js';
import { createSnapIndicator, createSnapReticleMarker } from './snap-indicator.js';

/** Coordinate subview: point targets, free-map picking, snapping and clipboard feedback. */
export function createCoordinateTool({
  L, map, el, t, copyText, showToast, coordinatePoints, focusCoordinate, snapMarker,
  panel, onBack, onWeather, renderToolbox,
}) {
  const lifecycle = new AbortController();
  const { signal } = lifecycle;
  const snapIndicator = createSnapIndicator({
    L,
    map,
    t,
    labelClassName: 'snap-label coordinate-snap-label',
  });
  let active = false;
  let copiedPoint = null;
  let highlight = null;
  let highlightTimer = 0;
  let copyTimer = 0;
  let pickHintTimer = 0;
  let moveFrame = 0;

  const view = el('section', 'toolbox-subview toolbox-coordinate');
  view.hidden = true;
  const back = el('button', 'toolbox-back');
  back.type = 'button';
  back.append(iconElement('arrow-left'), el('span', null, t('toolbox.back')));
  back.addEventListener('click', onBack, { signal });
  const title = el('h2', 'toolbox-subtitle', t('coordinates.title'));
  const instruction = el('p', 'toolbox-subhint', t('coordinates.instruction'));
  const type = el('div', 'toolbox-coordinate-type', t('coordinates.type'));
  view.append(back, title, instruction, type);

  const grid = el('div', 'toolbox-coordinate-grid');
  const choices = [
    { mode: 'start', labelKey: 'coordinates.start', createIcon: () => weatherMarkElement('start', { size: 16 }) },
    { mode: 'end', labelKey: 'coordinates.end', createIcon: () => weatherMarkElement('end', { size: 16 }) },
    { mode: 'highest', labelKey: 'coordinates.highest', createIcon: () => weatherMarkElement('highest', { size: 16 }) },
    { mode: 'center', labelKey: 'coordinates.center', createIcon: () => iconElement('locate') },
  ];
  for (const { mode, labelKey, createIcon } of choices) {
    const option = el('button', 'toolbox-coordinate-button');
    option.type = 'button';
    option.dataset.coordinate = mode;
    option.append(createIcon(), el('span', null, t(labelKey)));
    option.addEventListener('click', () => {
      if (mode === 'center') {
        const centre = map.getCenter();
        copy({ lat: centre.lat, lon: centre.lng }, mode);
      } else {
        copy(coordinatePoints()[mode], mode, { focus: true });
      }
    }, { signal });
    grid.append(option);
  }
  view.append(grid);

  const result = el('div', 'toolbox-coordinate-result');
  result.hidden = true;
  const output = el('code');
  const elevation = el('small', 'toolbox-coordinate-elevation');
  const weather = el('button', 'toolbox-coordinate-weather');
  weather.type = 'button';
  weather.hidden = true;
  weather.append(iconElement('weather'), el('span', null, t('coordinates.weather')));
  weather.title = t('coordinates.weatherHint');
  weather.setAttribute('aria-label', weather.title);
  weather.addEventListener('click', () => {
    if (!copiedPoint) return;
    onWeather(copiedPoint);
  }, { signal });
  result.append(el('span', null, t('coordinates.result')), output, elevation, weather);
  view.append(result);

  const hint = el('div', 'coordinate-pick-hint');
  hint.hidden = true;
  hint.append(iconElement('coordinates'), el('span', null, t('coordinates.pick')));
  map.getContainer().append(hint);

  function elevationText(point) {
    const value = Number(point?.ele);
    return Number.isFinite(value)
      ? t('coordinates.elevation', { elevation: formatElevation(value) })
      : t('coordinates.elevationUnavailable');
  }

  function paint(target, coordinate, elevationTextValue) {
    result.hidden = !coordinate;
    output.textContent = coordinate;
    elevation.textContent = elevationTextValue;
    weather.hidden = !coordinate;
    if (target) result.dataset.target = target;
  }

  function hideSnap() {
    if (moveFrame) {
      cancelAnimationFrame(moveFrame);
      moveFrame = 0;
    }
    snapIndicator.hide();
  }

  function stop() {
    if (!active) return;
    active = false;
    hideSnap();
    clearTimeout(pickHintTimer);
    clearTimeout(highlightTimer);
    panel()?.classList.remove('is-picking');
    map.getContainer().classList.remove('is-coordinate-picking');
    hint.hidden = true;
    if (highlight) map.removeLayer(highlight);
    highlight = null;
    instruction.textContent = t('coordinates.instruction');
  }

  function begin() {
    active = true;
    map.closePopup();
    panel()?.classList.add('is-picking');
    map.getContainer().classList.add('is-coordinate-picking');
    clearTimeout(pickHintTimer);
    hint.hidden = false;
    renderToolbox();
  }

  function showHint() {
    clearTimeout(pickHintTimer);
    hint.hidden = false;
    pickHintTimer = setTimeout(() => {
      hint.hidden = true;
    }, 1800);
  }

  function showPoint(point, targetKey, coordinate, snapped, ephemeral) {
    clearTimeout(highlightTimer);
    if (highlight) map.removeLayer(highlight);
    const halo = L.circleMarker([point.lat, point.lon], {
      radius: 20,
      color: '#2f9bff',
      weight: 2,
      opacity: 0.95,
      fill: false,
      interactive: false,
      className: 'coordinate-focus-halo',
      pane: 'markerPane',
    });
    const dot = L.circleMarker([point.lat, point.lon], {
      radius: 6,
      color: '#07141a',
      weight: 2,
      fillColor: '#8fd9ff',
      fillOpacity: 1,
      interactive: false,
      className: 'coordinate-focus-dot',
      pane: 'markerPane',
    });
    const label = el('div', snapped ? 'coordinate-focus-label is-snapped' : 'coordinate-focus-label');
    label.append(
      el('strong', null, t(`coordinates.${targetKey}`)),
      el('small', 'coordinate-focus-details',
        snapped ? `${t('coordinates.snapMarker')} \u00b7 ${coordinate}` : coordinate),
      el('small', 'coordinate-focus-elevation', elevationText(point)),
    );
    const tag = L.marker([point.lat, point.lon], {
      interactive: false,
      keyboard: false,
      zIndexOffset: 2400,
      icon: L.divIcon({
        className: 'coordinate-focus-tag',
        html: label.outerHTML,
        iconAnchor: [-14, 25],
      }),
    });
    const layers = [halo, dot, tag];
    if (snapped) {
      const reticle = createSnapReticleMarker(L, point, {
        kind: 'marker',
        animate: false,
        zIndexOffset: 2300,
      });
      if (reticle) layers.push(reticle);
    }
    highlight = L.layerGroup(layers).addTo(map);
    if (ephemeral) {
      highlightTimer = setTimeout(() => {
        if (highlight) map.removeLayer(highlight);
        highlight = null;
      }, 1800);
    }
  }

  function copy(point, targetKey, { focus = false, snapped = false, ephemeral = false } = {}) {
    if (!point) return;
    const coordinate = formatCoord(point);
    copiedPoint = { lat: Number(point.lat), lon: Number(point.lon), ele: point.ele };
    paint(targetKey, coordinate, elevationText(point));
    showPoint(point, targetKey, coordinate, snapped, ephemeral);
    if (focus) focusCoordinate(point);
    clearTimeout(copyTimer);
    copyTimer = setTimeout(async () => {
      copyTimer = 0;
      try {
        await copyText(coordinate);
      } catch (error) {
        showToast(t('coordinates.copyFailed', { detail: error.message }), 4000);
      }
    }, 150);
  }

  function render() {
    const targets = coordinatePoints();
    for (const option of view.querySelectorAll('[data-coordinate]')) {
      const mode = option.dataset.coordinate;
      if (mode === 'center') {
        option.title = t('coordinates.centerHint');
      } else {
        option.disabled = !targets[mode];
        option.title = targets[mode]
          ? `${t(`coordinates.${mode}`)}: ${formatCoord(targets[mode])}`
          : t('coordinates.unavailable');
      }
      option.setAttribute('aria-label', option.title);
    }
    instruction.textContent = t(active ? 'coordinates.pick' : 'coordinates.instruction');
  }

  function relabel() {
    back.querySelector('span').textContent = t('toolbox.back');
    title.textContent = t('coordinates.title');
    instruction.textContent = t(active ? 'coordinates.pick' : 'coordinates.instruction');
    type.textContent = t('coordinates.type');
    for (const option of view.querySelectorAll('[data-coordinate]')) {
      option.querySelector('span').textContent = t(`coordinates.${option.dataset.coordinate}`);
    }
    result.querySelector('span').textContent = t('coordinates.result');
    elevation.textContent = elevationText(copiedPoint);
    weather.querySelector('span').textContent = t('coordinates.weather');
    weather.title = t('coordinates.weatherHint');
    weather.setAttribute('aria-label', weather.title);
    hint.querySelector('span').textContent = t('coordinates.pick');
    snapIndicator.relabel();
    render();
  }

  function onMouseMove(event) {
    if (!active) return;
    if (event.originalEvent?.target?.closest?.('.leaflet-control')) {
      hideSnap();
      return;
    }
    if (moveFrame) return;
    const latlng = event.latlng;
    moveFrame = requestAnimationFrame(() => {
      moveFrame = 0;
      if (!active) return;
      snapIndicator.show(snapMarker(latlng));
    });
  }

  map.on('mousemove', onMouseMove);
  map.on('mouseout', hideSnap);
  map.on('movestart zoomstart', hideSnap);

  map.getContainer().addEventListener('click', (event) => {
    if (!active || event.target.closest('.leaflet-control')) return;
    event.preventDefault();
    event.stopPropagation();
    hideSnap();
    showHint();
    const target = snapMarker(map.mouseEventToLatLng(event));
    if (target) copy(target, 'picked', { snapped: target.kind === 'marker', ephemeral: true });
  }, { capture: true, signal });

  function destroy() {
    lifecycle.abort();
    hideSnap();
    map.off('mousemove', onMouseMove);
    map.off('mouseout', hideSnap);
    map.off('movestart zoomstart', hideSnap);
    snapIndicator.destroy();
    clearTimeout(highlightTimer);
    clearTimeout(copyTimer);
    clearTimeout(pickHintTimer);
    if (highlight) map.removeLayer(highlight);
    hint.remove();
  }

  return {
    view,
    begin,
    stop,
    render,
    relabel,
    destroy,
    isActive: () => active,
  };
}
