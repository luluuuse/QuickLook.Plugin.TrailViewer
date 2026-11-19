import { createCustomLayer } from './custom-layers.js';
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

function tiandituDirectUrl(layer, key) {
  return `https://t{s}.tianditu.gov.cn/${layer}_w/wmts`
    + '?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
    + `&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles`
    + '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'
    + `&tk=${encodeURIComponent(key)}`;
}

export function createProviderLayer(L, map, provider, directKey, onDirectError) {
  if (provider.custom) return createCustomLayer(L, provider.custom);
  if (provider.requiresKey === 'tianditu') {
    if (!directKey) return L.layerGroup();
    const tileLayers = provider.layers.map(({ layer, options }) =>
      L.tileLayer(tiandituDirectUrl(layer, directKey), {
        ...(options || {}),
        subdomains: '01234567',
      }));
    const retryDelays = [800, 2500];
    let consecutiveErrors = 0;
    let retryAttempt = 0;
    let retryTimer = null;
    const retry = () => {
      if (retryTimer || retryAttempt >= retryDelays.length) return;
      const delay = retryDelays[retryAttempt];
      retryAttempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        for (const layer of tileLayers) {
          if (layer._map) layer.redraw();
        }
      }, delay);
    };
    const failed = () => {
      consecutiveErrors += 1;
      if (consecutiveErrors < 3) return;
      onDirectError({ count: consecutiveErrors, retrying: retryAttempt < retryDelays.length });
      retry();
    };
    const loaded = () => {
      consecutiveErrors = 0;
      retryAttempt = 0;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
    };
    for (const layer of tileLayers) {
      layer.on('tileerror', failed);
      layer.on('tileload', loaded);
    }
    return L.layerGroup(tileLayers);
  }
  if (!provider.url) return graticule(L, map);
  return L.tileLayer(provider.url, { ...(provider.options || {}) });
}
