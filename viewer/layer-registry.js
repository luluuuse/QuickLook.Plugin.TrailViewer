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
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        options: {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
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
      esriLight: {
        key: 'road.esriLight',
        label: 'layer.esriLight',
        nodeGroup: 'satellite.esri',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        options: {
          maxZoom: 19,
          maxNativeZoom: 16,
          attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
        },
      },
      esriDark: {
        key: 'road.esriDark',
        label: 'layer.esriDark',
        nodeGroup: 'satellite.esri',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        options: {
          maxZoom: 19,
          maxNativeZoom: 16,
          attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
        },
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
      esriTopo: {
        key: 'terrain.esriTopo',
        label: 'layer.esriTopo',
        nodeGroup: 'satellite.esri',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
        options: {
          maxZoom: 19,
          maxNativeZoom: 18,
          attribution: 'Tiles &copy; Esri &mdash; Esri, USGS, NOAA',
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
  if (Object.hasOwn(PROVIDERS, value)) return value;
  if (Object.hasOwn(LEGACY_LAYERS, value)) return LEGACY_LAYERS[value];
  if (Object.hasOwn(LAYERS, value)) return defaultProvider(value);
  return null;
}

export const PROVIDER_NODES = Object.freeze({
  'road.osm': [
    {
      id: 'official',
      labelKey: 'layer.node.osmOfficial',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      options: {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
      },
    },
    {
      id: 'hot',
      labelKey: 'layer.node.osmHot',
      url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
      options: {
        subdomains: 'abc',
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors, '
          + 'style <a href="https://www.hotosm.org/" target="_blank">HOT</a>, '
          + 'hosted by <a href="https://openstreetmap.fr/" target="_blank">OSM France</a>',
      },
    },
    {
      id: 'de',
      labelKey: 'layer.node.osmDe',
      url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
      options: {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors, '
          + 'hosted by <a href="https://www.openstreetmap.de/" target="_blank">FOSSGIS</a>',
      },
    },
  ],
  'terrain.openTopo': [
    {
      id: 'official',
      labelKey: 'layer.node.openTopoOfficial',
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
    {
      id: 'openmaps',
      labelKey: 'layer.node.openMapsMirror',
      url: 'https://tile.openmaps.fr/opentopomap/{z}/{x}/{y}.png',
      options: {
        maxZoom: 19,
        maxNativeZoom: 17,
        attribution: 'Map data &copy; '
          + '<a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors, '
          + 'mirror <a href="https://openmaps.fr/" target="_blank">OpenMaps.fr</a>',
      },
    },
  ],
  'satellite.esri': [
    {
      id: 'server',
      labelKey: 'layer.node.esriServer',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      options: {
        maxZoom: 19,
        attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics and the GIS User Community',
      },
    },
    {
      id: 'services',
      labelKey: 'layer.node.esriServices',
      url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      options: {
        maxZoom: 19,
        attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics and the GIS User Community',
      },
    },
  ],
});

export const MAP_OVERLAYS = Object.freeze([
  {
    id: 'hiking',
    labelKey: 'layer.overlay.hiking',
    url: 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png',
    options: {
      maxZoom: 19,
      maxNativeZoom: 18,
      zIndex: 25,
      opacity: 0.9,
      attribution: '&copy; <a href="https://hiking.waymarkedtrails.org/" target="_blank">Waymarked Trails</a>',
    },
  },
  {
    id: 'cycling',
    labelKey: 'layer.overlay.cycling',
    url: 'https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png',
    options: {
      maxZoom: 19,
      maxNativeZoom: 18,
      zIndex: 26,
      opacity: 0.9,
      attribution: '&copy; <a href="https://cycling.waymarkedtrails.org/" target="_blank">Waymarked Trails</a>',
    },
  },
  {
    id: 'pistes',
    labelKey: 'layer.overlay.pistes',
    url: 'https://tiles.opensnowmap.org/pistes/{z}/{x}/{y}.png',
    options: {
      maxZoom: 19,
      maxNativeZoom: 18,
      zIndex: 27,
      opacity: 0.9,
      attribution: '&copy; <a href="https://www.opensnowmap.org/" target="_blank">OpenSnowMap</a>',
    },
  },
]);

export const SINGLE_NODE_SOURCES = Object.freeze([
  { id: 'terrain.cyclosm', labelKey: 'layer.cyclosm', url: 'https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png' },
  { id: 'terrain.openHiking', labelKey: 'layer.openHiking', url: 'https://tile.openmaps.fr/openhikingmap/{z}/{x}/{y}.png' },
  { id: 'overlay.waymarked', labelKey: 'layer.overlay.hiking', url: 'https://tile.waymarkedtrails.org/hiking/10/534/359.png' },
  { id: 'overlay.pistes', labelKey: 'layer.overlay.pistes', url: 'https://tiles.opensnowmap.org/pistes/10/534/359.png' },
  { id: 'tianditu', labelKey: 'layer.tiandituRoad', requiresKey: 'tianditu' },
]);

/** Returns a provider spec merged with the user's selected node when multiple nodes exist. */
export function resolveProvider(provider, selectedNodes = {}) {
  const groupKey = provider?.nodeGroup || provider?.key;
  const nodes = groupKey && Object.hasOwn(PROVIDER_NODES, groupKey)
    ? PROVIDER_NODES[groupKey]
    : null;
  if (!nodes || nodes.length === 0) return provider;
  const chosenId = selectedNodes?.[groupKey];
  const node = nodes.find((candidate) => candidate.id === chosenId) || nodes[0];
  if (provider?.nodeGroup && provider.url) {
    const host = node.id === 'services' ? 'services.arcgisonline.com' : 'server.arcgisonline.com';
    return {
      ...provider,
      url: provider.url.replace(/^https:\/\/(?:server|services)\.arcgisonline\.com/i, `https://${host}`),
      activeNodeId: node.id,
    };
  }
  return {
    ...provider,
    url: node.url,
    options: { ...node.options },
    activeNodeId: node.id,
  };
}

/** Loads the user's own sources and makes them selectable before the switcher is built. */
export function loadCustomProviders(read = readStored, hosted = null) {
  const entries = loadCustomLayers(read, hosted);
  for (const entry of entries) registerCustomProvider(entry);
  return entries;
}