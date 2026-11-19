import { readStored } from './storage.js';
import { loadCustomLayers } from './custom-layers.js';
export const LAYERS = {
  road: {
    label: 'layer.road',
    short: 'layer.shortRoad',
    title: 'layer.roadTitle',
    providers: {
      osm: {
        key: 'road.osm',
        label: 'layer.osm',
        url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
        options: {
          subdomains: 'abc',
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors, '
            + 'style <a href="https://www.hotosm.org/" target="_blank">HOT</a>, '
            + 'hosted by <a href="https://openstreetmap.fr/" target="_blank">OSM France</a>',
        },
      },
      tianditu: {
        key: 'road.tianditu',
        label: 'layer.tiandituRoad',
        requiresKey: 'tianditu',
        layers: [
          {
            layer: 'vec',
            options: {
              maxZoom: 19,
              maxNativeZoom: 18,
              zIndex: 5,
              attribution: '&copy; <a href="https://www.tianditu.gov.cn/" target="_blank">天地图</a>',
            },
          },
          {
            layer: 'cva',
            options: { maxZoom: 19, maxNativeZoom: 18, zIndex: 10 },
          },
        ],
      },
    },
  },
  terrain: {
    label: 'layer.terrain',
    short: 'layer.shortTerrain',
    title: 'layer.terrainTitle',
    providers: {
      cyclosm: {
        key: 'terrain.cyclosm',
        label: 'layer.cyclosm',
        url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
        options: {
          subdomains: 'abc',
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors, '
            + 'style <a href="https://www.cyclosm.org/" target="_blank">CyclOSM</a>, '
            + 'hosted by <a href="https://openstreetmap.fr/" target="_blank">OSM France</a>',
        },
      },
      openHiking: {
        key: 'terrain.openHiking',
        label: 'layer.openHiking',
        url: 'https://tile.openmaps.fr/openhikingmap/{z}/{x}/{y}.png',
        options: {
          maxZoom: 19,
          maxNativeZoom: 18,
          attribution: '<a href="https://wiki.openstreetmap.org/wiki/OpenHikingMap" target="_blank">'
            + '&copy; OpenHikingMap</a> '
            + '<a href="https://openmaps.fr/donate" target="_blank">Donation</a> '
            + '<a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap</a>',
        },
      },
      openTopo: {
        key: 'terrain.openTopo',
        label: 'layer.openTopo',
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        options: {
          subdomains: 'abc',
          maxZoom: 19,
          maxNativeZoom: 17,
          attribution: 'Map data &copy; '
            + '<a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors, '
            + '<a href="https://viewfinderpanoramas.org/" target="_blank">SRTM</a> | Map style &copy; '
            + '<a href="https://opentopomap.org/" target="_blank">OpenTopoMap</a> '
            + '(<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank">CC-BY-SA</a>)',
        },
      },
    },
  },
  satellite: {
    label: 'layer.satellite',
    short: 'layer.shortSatellite',
    title: 'layer.satelliteTitle',
    providers: {
      esri: {
        key: 'satellite.esri',
        label: 'layer.esri',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        options: {
          maxZoom: 19,
          attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics and the GIS User Community',
        },
      },
      tianditu: {
        key: 'satellite.tianditu',
        label: 'layer.tiandituSatellite',
        requiresKey: 'tianditu',
        layers: [
          {
            layer: 'img',
            options: {
              maxZoom: 19,
              maxNativeZoom: 18,
              zIndex: 5,
              attribution: '&copy; <a href="https://www.tianditu.gov.cn/" target="_blank">天地图</a>',
            },
          },
          {
            layer: 'cia',
            options: { maxZoom: 19, maxNativeZoom: 18, zIndex: 10 },
          },
        ],
      },
    },
  },
  // Filled at runtime from the user's own list. The plugin ships no third-party endpoint, so this category is
  // empty until someone adds one.
  custom: {
    label: 'layer.custom',
    short: 'layer.shortCustom',
    title: 'layer.customTitle',
    providers: {},
  },
  none: {
    label: 'layer.none',
    short: 'layer.shortNone',
    title: 'layer.noneTitle',
    settingsOnly: true,
    providers: {
      none: { key: 'none', label: 'layer.none' },
    },
  },
};

export const CATEGORY_ICONS = Object.freeze({
  road: 'layer-road',
  terrain: 'layer-terrain',
  satellite: 'layer-satellite',
  custom: 'layer-custom',
});

export const LAYER_KEY = 'layer';
const LEGACY_LAYERS = {
  map: 'road.osm',
  terrain: 'terrain.cyclosm',
  satellite: 'satellite.esri',
  none: 'none',
};

export const PROVIDERS = Object.fromEntries(Object.entries(LAYERS).flatMap(([category, definition]) =>
  Object.values(definition.providers).map((provider) => [provider.key, { category, provider }])));

/** Registers one user entry so the rest of the switcher can treat it like any other provider. */
export function registerCustomProvider(entry) {
  LAYERS.custom.providers[entry.id] = {
    key: entry.id,
    label: entry.name,
    custom: entry,
  };
  PROVIDERS[entry.id] = { category: 'custom', provider: LAYERS.custom.providers[entry.id] };
}

export function unregisterCustomProvider(id) {
  delete LAYERS.custom.providers[id];
  delete PROVIDERS[id];
}

export function defaultProvider(category) {
  return Object.values(LAYERS[category]?.providers || {})[0]?.key;
}

export function normalizeLayer(value) {
  if (typeof value !== 'string') return null;
  if (value in PROVIDERS) return value;
  if (value in LEGACY_LAYERS) return LEGACY_LAYERS[value];
  if (value in LAYERS) return defaultProvider(value);
  return null;
}

/** Loads the user's own sources and makes them selectable before the switcher is built. */
export function loadCustomProviders(read = readStored, hosted = null) {
  const entries = loadCustomLayers(read, hosted);
  for (const entry of entries) registerCustomProvider(entry);
  return entries;
}