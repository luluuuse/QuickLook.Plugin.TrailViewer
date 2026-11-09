// Leaflet controls and layer definitions. Dependencies are injected so this module does not reach into the map
// application's globals.

export const LAYERS = {
  map: {
    label: 'layer.map',
    title: 'layer.mapTitle',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    options: {
      subdomains: 'abc',
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors, '
        + 'style <a href="https://www.hotosm.org/" target="_blank">HOT</a>, '
        + 'hosted by <a href="https://openstreetmap.fr/" target="_blank">OSM France</a>',
    },
  },
  terrain: {
    label: 'layer.terrain',
    title: 'layer.terrainTitle',
    url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    options: {
      subdomains: 'abc',
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors, '
        + 'style <a href="https://www.cyclosm.org/" target="_blank">CyclOSM</a>, '
        + 'hosted by <a href="https://openstreetmap.fr/" target="_blank">OSM France</a>',
    },
  },
  satellite: {
    label: 'layer.satellite',
    title: 'layer.satelliteTitle',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      maxZoom: 19,
      attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics and the GIS User Community',
    },
  },
  none: {
    label: 'layer.none',
    title: 'layer.noneTitle',
  },
};

const LAYER_KEY = 'gpxviewer.layer';

function graticule(L, map) {
  const group = L.layerGroup();
  const steps = [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30];
  const style = { color: '#ffffff', opacity: 0.12, weight: 1, interactive: false };

  function redraw() {
    group.clearLayers();
    const bounds = map.getBounds();
    const span = Math.max(bounds.getNorth() - bounds.getSouth(), 1e-6);
    const step = steps.find((candidate) => span / candidate <= 10) ?? 30;
    const south = Math.max(-90, bounds.getSouth());
    const north = Math.min(90, bounds.getNorth());
    for (let lat = Math.ceil(south / step) * step; lat <= north; lat += step) {
      group.addLayer(L.polyline([[lat, bounds.getWest()], [lat, bounds.getEast()]], style));
    }
    for (let lon = Math.ceil(bounds.getWest() / step) * step; lon <= bounds.getEast(); lon += step) {
      group.addLayer(L.polyline([[south, lon], [north, lon]], style));
    }
  }

  group.on('add', () => {
    map.on('moveend', redraw);
    redraw();
  });
  group.on('remove', () => map.off('moveend', redraw));
  return group;
}

export function savedLayer(params) {
  const fromHost = params.get('layer');
  if (fromHost in LAYERS) return fromHost;
  try {
    const value = localStorage.getItem(LAYER_KEY);
    return value in LAYERS ? value : 'map';
  } catch {
    return 'map';
  }
}

export function createLayerSwitcher({ L, map, el, t, initial, onRemember }) {
  const layers = {};
  for (const [key, definition] of Object.entries(LAYERS)) {
    layers[key] = definition.url ? L.tileLayer(definition.url, definition.options) : graticule(L, map);
  }
  let current = null;
  const buttons = {};

  function select(key, remember) {
    if (current) map.removeLayer(layers[current]);
    current = key;
    layers[key].addTo(map);
    document.body.classList.toggle('no-map', key === 'none');
    for (const [candidate, button] of Object.entries(buttons)) {
      const active = candidate === key;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    if (remember) {
      try { localStorage.setItem(LAYER_KEY, key); }
      catch { /* Private mode or storage disabled: the choice just is not remembered. */ }
      onRemember?.();
    }
  }

  const Control = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const bar = el('div', 'layer-switch leaflet-bar');
      for (const [key, definition] of Object.entries(LAYERS)) {
        const button = el('button', null, t(definition.label));
        button.type = 'button';
        button.title = t(definition.title);
        button.setAttribute('aria-label', t(definition.title));
        button.setAttribute('aria-pressed', 'false');
        button.dataset.layer = key;
        button.addEventListener('click', () => select(key, true));
        buttons[key] = button;
        bar.append(button);
      }
      L.DomEvent.disableClickPropagation(bar);
      return bar;
    },
  });
  map.addControl(new Control());
  select(initial, false);

  return {
    select,
    current: () => current,
    relabel() {
      for (const [key, button] of Object.entries(buttons)) {
        button.textContent = t(LAYERS[key].label);
        button.title = t(LAYERS[key].title);
        button.setAttribute('aria-label', t(LAYERS[key].title));
      }
    },
  };
}

export function createLanguageControl({ L, map, el, t, label, toggle }) {
  let button = null;
  const Control = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const bar = el('div', 'lang-switch leaflet-bar');
      button = el('button', null, label());
      button.type = 'button';
      button.title = t('switch.title');
      button.setAttribute('aria-label', t('switch.title'));
      button.dataset.lang = 'switch';
      button.addEventListener('click', () => toggle());
      bar.append(button);
      L.DomEvent.disableClickPropagation(bar);
      return bar;
    },
  });
  map.addControl(new Control());

  return {
    relabel() {
      if (!button) return;
      button.textContent = label();
      button.title = t('switch.title');
      button.setAttribute('aria-label', t('switch.title'));
    },
  };
}

export function createLocateControl({ L, map, el, t, onLocate }) {
  let button = null;
  const Control = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const bar = el('div', 'locate-switch leaflet-bar');
      button = el('button');
      button.type = 'button';
      button.title = t('locate.title');
      button.setAttribute('aria-label', t('locate.title'));
      button.dataset.locate = 'route';
      button.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">'
        + '<circle cx="8" cy="8" r="4.2" fill="none" stroke="currentColor" stroke-width="1.6"/>'
        + '<path d="M8 0.9v3.2M8 11.9v3.2M0.9 8h3.2M11.9 8h3.2" fill="none" stroke="currentColor"'
        + ' stroke-width="1.6" stroke-linecap="round"/></svg>';
      button.addEventListener('click', () => onLocate());
      bar.append(button);
      L.DomEvent.disableClickPropagation(bar);
      return bar;
    },
  });
  map.addControl(new Control());

  return {
    relabel() {
      if (!button) return;
      button.title = t('locate.title');
      button.setAttribute('aria-label', t('locate.title'));
    },
  };
}

export function createExportControl({ L, map, el, t, onExport }) {
  let button = null;
  const Control = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const bar = el('div', 'export-switch leaflet-bar');
      button = el('button');
      button.type = 'button';
      button.title = t('export.title');
      button.setAttribute('aria-label', t('export.title'));
      button.dataset.export = 'overlay';
      button.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">'
        + '<rect x="1.6" y="3.1" width="12.8" height="9.8" rx="1.6" fill="none" stroke="currentColor"'
        + ' stroke-width="1.5"/><path d="M2.8 10.9l3.1-3.2 2.1 2.1 2.9-3 2.3 2.4" fill="none"'
        + ' stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>'
        + '<circle cx="11.1" cy="5.9" r="1.05" fill="currentColor"/></svg>';
      button.addEventListener('click', () => onExport());
      bar.append(button);
      L.DomEvent.disableClickPropagation(bar);
      return bar;
    },
  });
  map.addControl(new Control());

  return {
    relabel() {
      if (!button) return;
      button.title = t('export.title');
      button.setAttribute('aria-label', t('export.title'));
    },
  };
}
