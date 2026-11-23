import { CUSTOM_LIMITS, validateTemplate } from './custom-layers.js';

export const REGIONAL_PRESETS = Object.freeze([
  {
    id: 'gsi',
    labelKey: 'layer.preset.gsi',
    url: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
    tileSize: 256,
    minZoom: 4,
    maxZoom: 18,
    subdomains: '',
    attribution: '国土地理院 (GSI Japan)',
    tms: false,
  },
  {
    id: 'rudy',
    labelKey: 'layer.preset.rudy',
    url: 'https://tile.happyman.idv.tw/map/moi_osm/{z}/{x}/{y}.png',
    tileSize: 256,
    minZoom: 6,
    maxZoom: 18,
    subdomains: '',
    attribution: 'Taiwan TOPO / OpenStreetMap',
    tms: false,
  },
  {
    id: 'usgs',
    labelKey: 'layer.preset.usgs',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
    tileSize: 256,
    minZoom: 1,
    maxZoom: 16,
    subdomains: '',
    attribution: 'USGS The National Map',
    tms: false,
  },
  {
    id: 'usgs-classic',
    labelKey: 'layer.preset.usgsClassic',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/USA_Topo_Maps/MapServer/tile/{z}/{y}/{x}',
    tileSize: 256,
    minZoom: 1,
    maxZoom: 15,
    subdomains: '',
    attribution: 'USGS / National Geographic / Esri',
    tms: false,
  },
  {
    id: 'swisstopo',
    labelKey: 'layer.preset.swisstopo',
    url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
    tileSize: 256,
    minZoom: 2,
    maxZoom: 18,
    subdomains: '',
    attribution: 'swisstopo',
    tms: false,
  },
  {
    id: 'swissimage',
    labelKey: 'layer.preset.swissimage',
    url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
    tileSize: 256,
    minZoom: 2,
    maxZoom: 19,
    subdomains: '',
    attribution: 'swisstopo',
    tms: false,
  },
  {
    id: 'google-sat',
    labelKey: 'layer.preset.googleSat',
    url: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    tileSize: 256,
    minZoom: 1,
    maxZoom: 20,
    subdomains: '0123',
    attribution: 'Google',
    tms: false,
  },
]);

export const KEYED_PRESETS = Object.freeze([
  {
    id: 'tracestrack',
    labelKey: 'layer.preset.tracestrack',
    url: 'https://tile.tracestrack.com/topo__/{z}/{x}/{y}.png?key=YOUR_KEY',
    tileSize: 256,
    minZoom: 1,
    maxZoom: 18,
    subdomains: '',
    attribution: 'Tracestrack / OpenStreetMap',
    tms: false,
  },
  {
    id: 'thunderforest',
    labelKey: 'layer.preset.thunderforest',
    url: 'https://api.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=YOUR_KEY',
    tileSize: 256,
    minZoom: 1,
    maxZoom: 19,
    subdomains: '',
    attribution: 'Thunderforest / OpenStreetMap',
    tms: false,
  },
  {
    id: 'stadia',
    labelKey: 'layer.preset.stadia',
    url: 'https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}@2x.png?api_key=YOUR_KEY',
    tileSize: 512,
    minZoom: 1,
    maxZoom: 20,
    subdomains: '',
    attribution: 'Stadia Maps / Stamen / OpenStreetMap',
    tms: false,
  },
  {
    id: 'maptiler',
    labelKey: 'layer.preset.maptiler',
    url: 'https://api.maptiler.com/maps/outdoor/{z}/{x}/{y}.png?key=YOUR_KEY',
    tileSize: 256,
    minZoom: 1,
    maxZoom: 19,
    subdomains: '',
    attribution: 'MapTiler / OpenStreetMap',
    tms: false,
  },
]);

/** Custom tile-source form. Keeps field normalisation and validation separate from layer selection state. */
export function createCustomSourceForm({ el, t, onCancel, onSubmit }) {
  const form = el('form', 'layer-custom-form');
  form.hidden = true;

  const presetsWrap = el('div', 'layer-custom-presets');
  const buildPresetGroup = (labelKey, list, selectKeyPlaceholder = false) => {
    const heading = el('span', 'layer-custom-presets-label', t(labelKey));
    heading.dataset.labelKey = labelKey;
    const chipRow = el('div', 'layer-custom-preset-list');
    for (const preset of list) {
      const chip = el('button', 'layer-custom-preset-chip', t(preset.labelKey));
      chip.type = 'button';
      chip.dataset.customPreset = preset.id;
      chip.dataset.labelKey = preset.labelKey;
      chip.addEventListener('click', () => {
        fillEntry({ ...preset, name: t(preset.labelKey) });
        error.hidden = true;
        if (selectKeyPlaceholder) {
          const idx = urlField.input.value.indexOf('YOUR_KEY');
          if (idx >= 0) {
            urlField.input.focus();
            urlField.input.setSelectionRange(idx, idx + 'YOUR_KEY'.length);
          }
        }
      });
      chipRow.append(chip);
    }
    presetsWrap.append(heading, chipRow);
  };
  buildPresetGroup('layer.customPresets', REGIONAL_PRESETS, false);
  buildPresetGroup('layer.customKeyPresets', KEYED_PRESETS, true);
  form.append(presetsWrap);
  const buildField = (name, labelKey, type = 'text', extra = {}) => {
    const wrap = el('label', 'layer-custom-field');
    const label = el('span', null, t(labelKey));
    label.dataset.labelKey = labelKey;
    const input = el('input');
    input.type = type;
    input.name = name;
    for (const [key, value] of Object.entries(extra)) input.setAttribute(key, value);
    wrap.append(label, input);
    return { wrap, input, label };
  };

  const nameField = buildField('name', 'layer.customName', 'text', {
    maxlength: String(CUSTOM_LIMITS.maxNameLength), required: '',
  });
  const urlField = buildField('url', 'layer.customUrl', 'url', {
    maxlength: String(CUSTOM_LIMITS.maxUrlLength),
    placeholder: 'https://host/{z}/{x}/{y}.png',
    required: '',
  });
  form.append(nameField.wrap, urlField.wrap);
  const urlHint = el('p', 'layer-setting-note', t('layer.customUrlHint'));
  urlHint.dataset.labelKey = 'layer.customUrlHint';
  form.append(urlHint);

  const urlStatus = el('p', 'layer-custom-url-status');
  urlStatus.dataset.customUrlStatus = '';
  urlStatus.hidden = true;
  form.append(urlStatus);
  const error = el('p', 'layer-custom-error', '');
  error.hidden = true;
  error.dataset.customError = '';

  function checkUrl({ autoTileSize = true } = {}) {
    const raw = urlField.input.value.trim();
    if (!raw) {
      urlStatus.hidden = true;
      urlField.input.removeAttribute('data-invalid');
      return null;
    }
    const result = validateTemplate(raw);
    if (result.ok) {
      urlStatus.hidden = true;
      urlField.input.removeAttribute('data-invalid');
      if (result.url !== raw) urlField.input.value = result.url;
      if (autoTileSize && /(?:%40|@)2x/i.test(result.url)) {
        form.querySelector('[name="tileSize"][value="512"]').checked = true;
      }
      return result;
    }
    urlStatus.hidden = false;
    urlStatus.textContent = t({
      empty: 'layer.customInvalidEmpty',
      scheme: 'layer.customInvalidScheme',
      token: 'layer.customInvalidToken',
      space: 'layer.customInvalidSpace',
      syntax: 'layer.customInvalidSyntax',
    }[result.code] || 'layer.customInvalidToken');
    urlField.input.setAttribute('data-invalid', 'true');
    return result;
  }
  urlField.input.addEventListener('input', checkUrl);
  urlField.input.addEventListener('blur', checkUrl);

  const sizeWrap = el('div', 'layer-custom-field');
  const sizeLabel = el('span', null, t('layer.customTileSize'));
  sizeLabel.dataset.labelKey = 'layer.customTileSize';
  sizeWrap.append(sizeLabel);
  const sizeGroup = el('div', 'layer-custom-inline');
  for (const size of CUSTOM_LIMITS.tileSizes) {
    const option = el('label', 'layer-custom-radio');
    const radio = el('input');
    radio.type = 'radio';
    radio.name = 'tileSize';
    radio.value = String(size);
    radio.checked = size === 256;
    option.append(radio, el('span', null, String(size)));
    sizeGroup.append(option);
  }
  sizeWrap.append(sizeGroup);

  const zoomWrap = el('div', 'layer-custom-field');
  const zoomLabel = el('span', null, t('layer.customZoom'));
  zoomLabel.dataset.labelKey = 'layer.customZoom';
  zoomWrap.append(zoomLabel);
  const zoomInline = el('div', 'layer-custom-inline');
  const minZoom = el('input');
  minZoom.type = 'number';
  minZoom.name = 'minZoom';
  minZoom.min = '0';
  minZoom.max = '22';
  minZoom.value = '1';
  const maxZoom = el('input');
  maxZoom.type = 'number';
  maxZoom.name = 'maxZoom';
  maxZoom.min = '0';
  maxZoom.max = '22';
  maxZoom.value = '19';
  zoomInline.append(minZoom, el('span', 'layer-custom-dash', '–'), maxZoom);
  zoomWrap.append(zoomInline);

  const advanced = el('details', 'layer-custom-advanced');
  const advancedSummary = el('summary', 'layer-custom-advanced-summary', t('layer.customAdvanced'));
  advancedSummary.dataset.labelKey = 'layer.customAdvanced';
  const advancedBody = el('div', 'layer-custom-advanced-body');
  advancedBody.append(buildField('subdomains', 'layer.customSubdomains', 'text', {
    maxlength: '16', placeholder: t('layer.customSubdomainsHint'),
  }).wrap);
  advancedBody.append(buildField('attribution', 'layer.customAttribution', 'text', {
    maxlength: String(CUSTOM_LIMITS.maxAttributionLength),
    placeholder: t('layer.customAttributionHint'),
  }).wrap);
  const tmsWrap = el('label', 'layer-custom-field layer-custom-toggle');
  const tmsBox = el('input');
  tmsBox.type = 'checkbox';
  tmsBox.name = 'tms';
  const tmsLabel = el('span', null, t('layer.customTms'));
  tmsLabel.dataset.labelKey = 'layer.customTms';
  tmsWrap.append(tmsBox, tmsLabel);
  advancedBody.append(tmsWrap);
  advanced.append(advancedSummary, advancedBody);

  const basics = el('div', 'layer-custom-basics');
  basics.append(sizeWrap, zoomWrap);
  form.append(basics, advanced, error);

  const formActions = el('div', 'layer-custom-form-actions');
  const saveButton = el('button', 'layer-custom-save', t('layer.customSave'));
  saveButton.type = 'submit';
  saveButton.dataset.customSave = '';
  saveButton.dataset.labelKey = 'layer.customSave';
  const cancelButton = el('button', 'layer-custom-cancel', t('layer.customCancel'));
  cancelButton.type = 'button';
  cancelButton.dataset.labelKey = 'layer.customCancel';
  cancelButton.addEventListener('click', onCancel);
  formActions.append(cancelButton, saveButton);
  form.append(formActions);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    onSubmit();
  });

  function value(name) {
    return form.querySelector(`[name="${name}"]`)?.value ?? '';
  }

  function reset() {
    for (const field of form.querySelectorAll('input')) {
      if (field.type === 'checkbox') field.checked = false;
      else if (field.type === 'radio') field.checked = field.value === '256';
      else if (field.name === 'minZoom') field.value = '1';
      else if (field.name === 'maxZoom') field.value = '19';
      else field.value = '';
    }
    urlStatus.hidden = true;
    urlField.input.removeAttribute('data-invalid');
    error.hidden = true;
    presetsWrap.hidden = false;
  }

  function fillEntry(entry) {
    const set = (name, next) => {
      const field = form.querySelector(`[name="${name}"]`);
      if (field) field.value = next;
    };
    set('name', entry.name);
    set('url', entry.url);
    set('minZoom', String(entry.minZoom));
    set('maxZoom', String(entry.maxZoom));
    set('subdomains', entry.subdomains);
    set('attribution', entry.attribution);
    const size = form.querySelector(`[name="tileSize"][value="${entry.tileSize}"]`);
    if (size) size.checked = true;
    const tms = form.querySelector('[name="tms"]');
    if (tms) tms.checked = entry.tms;
    checkUrl({ autoTileSize: false });
  }

  function setEntry(entry) {
    presetsWrap.hidden = true;
    fillEntry(entry);
  }

  function read(editingId) {
    return {
      id: editingId || undefined,
      name: value('name').trim(),
      url: value('url').trim(),
      tileSize: Number(form.querySelector('[name="tileSize"]:checked')?.value || 256),
      minZoom: Number(value('minZoom') || 1),
      maxZoom: Number(value('maxZoom') || 19),
      subdomains: value('subdomains').trim(),
      attribution: value('attribution').trim(),
      tms: Boolean(form.querySelector('[name="tms"]')?.checked),
    };
  }

  function showError(code) {
    const key = {
      empty: 'layer.customInvalidEmpty',
      scheme: 'layer.customInvalidScheme',
      token: 'layer.customInvalidToken',
      space: 'layer.customInvalidSpace',
      syntax: 'layer.customInvalidSyntax',
      subdomain: 'layer.customSubdomainRequired',
      duplicate: 'layer.customDuplicate',
      name: 'layer.customInvalidName',
      limit: 'layer.customLimit',
    }[code] || 'layer.customInvalidToken';
    error.textContent = t(key);
    error.hidden = false;
  }

  return {
    form,
    urlStatus,
    error,
    reset,
    read,
    setEntry,
    showError,
    check: checkUrl,
    focusName: () => nameField.input.focus({ preventScroll: true }),
  };
}
