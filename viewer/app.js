// Track viewer page: loads the file from ?src=, draws it with Leaflet and reports "ready\t<summary>" or
// "error:<text>" to the plugin (window.chrome.webview). Works in any browser through a local web server.
// GPX and KML are recognised by their root element, so a mis-named file still opens.
import { GpxError, distanceMeters, parseGpxDocument, parseXml, summarize } from './gpx.js';
import { KmlError, parseKmlDocument } from './kml.js';
import { getLang, isChinese, langLabel, onLangChange, t, toggleLang, units } from './i18n.js';
import { analyse, elevationAt, SLOPE_FULL, slopeColor, slopeScale } from './profile.js';

/* global L */

const params = new URLSearchParams(location.search);
const src = params.get('src');
const fileName = params.get('name') || (src ? decodeURIComponent(src.split('/').pop()) : t('file.untitled'));

const COLORS = ['#ff5a36', '#2f9bff', '#f5c400', '#c23cff', '#18c964', '#ff3d9a', '#00c2c7', '#ff9f1a'];
const ROUTE_COLOR = '#ffffff';
// Above this many track points only the lines are drawn: a clickable dot per point would use too much memory.
const MAX_DOTS = 20000;
const LAYER_KEY = 'gpxviewer.layer';
// Labels are dictionary keys, not words: the switch button re-reads them when the language changes.
const LAYERS = {
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
  // Contours, hill shading, spot heights and trails: the layer a hike is planned on. Two alternatives were
  // measured and dropped, so nobody repeats the work. The Mapy.com outdoor style (served by Windy at
  // tiles.windy.com/v1/maptiles/outdoor/...) is the prettiest of the three, but only serves tiles already in
  // its CDN cache: a first-time tile answers 403, the browser blocks the empty reply, and a screen comes up
  // half blank. Esri World Topo is fine in Europe but in China it stops at zoom 13 -- beyond that every tile
  // is a "Map data not yet available" placeholder, which is exactly the zoom a hike needs.
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

function post(message) {
  window.chrome?.webview?.postMessage(message);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showError(text) {
  document.body.classList.add('failed');
  const box = document.getElementById('message');
  box.replaceChildren(el('h1', null, t('error.title')), el('p', 'file', fileName), el('p', 'detail', text));
  box.hidden = false;
  post(`error:${text}`);
}

// ---------- formatting ----------

// Dates follow the interface language rather than the system one: a Chinese Windows with the interface
// switched to English was printing 2026年1月1日 next to English labels. One set of formatters per language,
// built once -- the scrubber asks for a time on every mouse move.
const LOCALES = { en: 'en-US', zh: 'zh-CN' };
const formatters = (() => {
  const cache = new Map();
  return () => {
    const locale = LOCALES[getLang()];
    let set = cache.get(locale);
    if (!set) {
      set = {
        date: new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }),
        // `numeric` rather than `2-digit`: en-US writes "5:00 PM" where 24-hour Chinese writes 17:00, and a
        // forced leading zero gives "05:00 PM", which no English speaker writes.
        time: new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }),
        full: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }),
      };
      cache.set(locale, set);
    }
    return set;
  };
})();

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatRange(start, end) {
  if (!start) return null;
  const { date: dateFormat, time: timeFormat } = formatters();
  if (sameDay(start, end)) {
    return `${dateFormat.format(start)}, ${timeFormat.format(start)} \u2013 ${timeFormat.format(end)}`;
  }
  return `${dateFormat.format(start)} ${timeFormat.format(start)} \u2013 ${dateFormat.format(end)} ${timeFormat.format(end)}`;
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} ${t('unit.m')}`;
  return `${(meters / 1000).toFixed(meters < 100000 ? 2 : 1)} ${t('unit.km')}`;
}

/** Metres per second as the speed a person reads: 8.0 km/h, never 2.2222 m/s. */
function formatSpeed(metersPerSecond) {
  return `${(metersPerSecond * 3.6).toFixed(1)} ${t('unit.kmh')}`;
}

/** Ascent and descent: whole metres, or a dash when the file carries no heights to add up. */
function formatElevation(meters) {
  if (meters === null || meters === undefined) return '\u2014';
  return `${Math.round(meters).toLocaleString()} ${t('unit.m')}`;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const unit = (n, key) => `${n} ${t(key)}`;
  if (h >= 24) return `${unit(Math.floor(h / 24), 'unit.day')} ${unit(h % 24, 'unit.hour')} ${unit(m, 'unit.minute')}`;
  if (h > 0) return `${unit(h, 'unit.hour')} ${unit(m, 'unit.minute')}`;
  return m > 0 ? `${unit(m, 'unit.minute')} ${unit(s, 'unit.second')}` : unit(s, 'unit.second');
}

function formatCoord(p) {
  return `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`;
}

function pointPopup(p, title) {
  const box = el('div', 'point-popup');
  if (title) box.append(el('strong', null, title));
  if (p.time) box.append(el('div', null, formatters().full.format(p.time)));
  box.append(el('div', 'coord', formatCoord(p)));
  if (p.ele !== undefined) {
    box.append(el('div', null, t('point.elevation', { elevation: Math.round(p.ele), unit: t('unit.m') })));
  }
  if (p.description) box.append(el('div', 'point-text', p.description));
  return box;
}

// ---------- photos attached to waypoints ----------

// A description names its photos as absolute URLs, data URIs, or paths next to the document. Paths are
// resolved against the file itself, which the plugin serves from its own virtual host, so a photo that
// travels with the KML keeps working offline.
function resolvePhotoUrl(url) {
  if (/^data:image\//i.test(url) || /^https?:\/\//i.test(url)) return url;
  try {
    // src is absolute inside the plugin, but the page can also be opened from a plain web server, where
    // it is relative: anchor it to the page before resolving the photo against it.
    return new URL(url, new URL(src, location.href)).href;
  } catch {
    return null;
  }
}

function photosOf(point) {
  return (point.images || []).map(resolvePhotoUrl).filter(Boolean);
}

// The first thing a photo pin opens: the placemark's own details plus a strip of thumbnails, sized to the
// pin rather than to the window. Leaflet builds popup content lazily, so nothing is fetched until a pin is
// actually clicked; the full-size image is only requested from here.
function photoPreview(photos, point, closePopup) {
  const box = el('div', 'photo-preview');
  box.append(pointPopup(point, point.name || t('label.waypoint')));

  const strip = el('div', photos.length === 1 ? 'photo-thumbs single' : 'photo-thumbs');
  photos.forEach((url, index) => {
    const button = el('button', 'photo-thumb');
    button.type = 'button';
    button.tabIndex = -1;
    button.title = photos.length > 1
      ? t('photo.openIndexed', { index: index + 1, count: photos.length })
      : t('photo.openSingle');
    const thumb = el('img');
    thumb.alt = '';
    thumb.decoding = 'async';
    // No loading="lazy": the card is built when it opens, so every thumbnail in it is wanted right away.
    thumb.onerror = () => button.classList.add('failed');
    thumb.src = url;
    button.append(thumb);
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      // The card has done its job once the big picture is up; leaving it behind the viewer would only
      // flash back into sight when the viewer closes.
      if (closePopup) closePopup();
      photoViewer.show(photos, point.name || t('label.waypoint'), point, index);
    });
    strip.append(button);
  });
  box.append(strip);
  box.append(el('p', 'photo-hint', photos.length > 1
    ? t('photo.hintMany', { count: photos.length })
    : t('photo.hintOne')));
  return box;
}

// Full-window photo viewer. Built on first use: a file whose waypoints carry no photos never pays for it.
// Esc and the arrow keys are left alone on purpose - QuickLook owns them for closing the preview and
// stepping through files, so this closes on a click and steps with its own buttons.
const photoViewer = (() => {
  let root = null;
  let img = null;
  let status = null;
  let statusKind = ''; // 'loading' | 'failed' | '' - so a language switch can repaint the same state
  let caption = null;
  let meta = null;
  let counter = null;
  let closeButton = null;
  let stepButtons = [];
  let list = [];
  let index = 0;
  let shownPoint = null; // the placemark the current photo belongs to; keyboard stepping uses it
  let token = 0; // discards the callbacks of a photo the user already moved away from

  function build() {
    root = el('div', 'photo-viewer');
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');

    const bar = el('div', 'photo-bar');
    const titles = el('div', 'photo-titles');
    caption = el('strong', null, '');
    meta = el('div', 'photo-meta');
    titles.append(caption, meta);
    counter = el('div', 'photo-counter');
    const close = el('button', 'photo-close', '\u00d7');
    close.type = 'button';
    close.title = t('photo.close');
    close.tabIndex = -1;
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      hide();
    });
    closeButton = close;
    bar.append(titles, counter, close);

    const stage = el('div', 'photo-stage');
    img = el('img', 'photo-image');
    img.alt = '';
    img.decoding = 'async';
    // The original is what the user asked to see, so a click on it must not step or close: the arrows
    // step, and the close button or the surrounding backdrop closes.
    img.addEventListener('click', (e) => e.stopPropagation());
    status = el('div', 'photo-status');
    status.hidden = true;
    stage.append(img, status);

    for (const [delta, glyph, label, className] of [[-1, '\u2039', 'photo.previous', 'prev'], [1, '\u203a', 'photo.next', 'next']]) {
      const button = el('button', `photo-arrow ${className}`, glyph);
      button.type = 'button';
      button.title = t(label);
      button.tabIndex = -1;
      button.dataset.delta = String(delta);
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        step(delta);
      });
      stage.append(button);
      stepButtons.push(button);
    }

    // Clicks on the backdrop close; clicks on the bar and the photo do not.
    stage.addEventListener('click', () => hide());
    root.append(bar, stage);
    document.body.append(root);
  }

  /** The line under the caption: time, coordinates, height and the placemark's own text. */
  function paintMeta(point) {
    const bits = [];
    if (point.time) bits.push(formatters().full.format(point.time));
    bits.push(formatCoord(point));
    if (point.ele !== undefined) bits.push(`${Math.round(point.ele)} ${t('unit.m')}`);
    if (point.description) bits.push(point.description);
    meta.textContent = bits.join(' \u00b7 ');
  }

  function load() {
    const url = list[index];
    const mine = ++token;
    const many = list.length > 1;
    counter.textContent = many ? `${index + 1} / ${list.length}` : '';
    counter.hidden = !many;
    for (const button of stepButtons) button.hidden = !many;
    img.hidden = true;
    status.hidden = false;
    status.className = 'photo-status loading';
    statusKind = 'loading';
    status.textContent = t('photo.loading');
    img.onload = () => {
      if (mine !== token) return;
      status.hidden = true;
      statusKind = '';
      img.hidden = false;
    };
    img.onerror = () => {
      if (mine !== token) return;
      img.hidden = true;
      status.hidden = false;
      statusKind = 'failed';
      status.className = 'photo-status failed';
      status.replaceChildren(
        el('div', null, t('photo.failed')),
        el('code', null, url),
      );
    };
    img.src = url;
  }

  function step(delta) {
    if (list.length < 2) return;
    index = (index + delta + list.length) % list.length;
    load();
  }

  /** One photo over, or false when the album ends there: the caller decides what comes next. */
  function stepWithin(delta) {
    const next = index + delta;
    if (next < 0 || next >= list.length) return false;
    index = next;
    load();
    return true;
  }

  function show(urls, title, point, startIndex) {
    if (!root) build();
    list = urls;
    shownPoint = point;
    // A thumbnail click asks for that photo, not for the first one in the album.
    index = startIndex > 0 && startIndex < urls.length ? startIndex : 0;
    caption.textContent = title || t('label.photo');
    paintMeta(point);
    root.hidden = false;
    document.body.classList.add('showing-photo');
    load();
  }

  function hide() {
    if (!root || root.hidden) return;
    root.hidden = true;
    document.body.classList.remove('showing-photo');
    token += 1; // a slow photo must not appear after the viewer is closed
    img.hidden = true;
    img.removeAttribute('src');
  }

  /** Repaints everything that is not the photo itself, after a language switch. */
  function relabel() {
    if (!root) return;
    closeButton.title = t('photo.close');
    for (const button of stepButtons) {
      button.title = t(Number(button.dataset.delta) < 0 ? 'photo.previous' : 'photo.next');
    }
    if (shownPoint) paintMeta(shownPoint);
    if (statusKind === 'loading') status.textContent = t('photo.loading');
    if (statusKind === 'failed') {
      status.replaceChildren(el('div', null, t('photo.failed')), el('code', null, list[index]));
    }
  }

  return {
    show,
    hide,
    relabel,
    stepWithin,
    current: () => shownPoint,
    isOpen: () => Boolean(root) && !root.hidden,
    count: () => list.length,
  };
})();

// ---------- info box and elevation profile ----------

// Text that lives on the map as long as the file is open (tooltips, the profile's range line). A language
// switch repaints these in place instead of rebuilding the map.
const localizedNodes = [];

function localized(node, fill, attribute = null) {
  if (attribute) node.setAttribute(attribute, fill());
  else node.textContent = fill();
  localizedNodes.push({ node, fill, attribute });
  return node;
}

function repaintLocalized() {
  for (const { node, fill, attribute } of localizedNodes) {
    if (attribute) node.setAttribute(attribute, fill());
    else node.textContent = fill();
  }
}

function renderInfo(gpx, summary, elevations) {
  const box = document.getElementById('info');
  // Called again on every language switch: the box is rebuilt, never appended to.
  box.replaceChildren();
  box.append(el('h1', null, gpx.name || fileName));
  if (gpx.name && gpx.name !== fileName) box.append(el('p', 'file', fileName));

  // The numbers a walker looks at first, on rows of their own instead of one per line: three across, then the
  // pair that says how big the route is. The label sits under the value -- it is read once, the number every
  // time. Cells are dt/dd inside a dl, so a screen reader still hears a label with its value.
  const stats = el('div', 'stats');
  const statRow = (pairs) => {
    if (pairs.length === 0) return;
    const line = el('dl', 'row');
    for (const [label, value] of pairs) {
      const pair = el('div', 'pair');
      pair.append(el('dt', null, label), el('dd', null, value));
      line.append(pair);
    }
    stats.append(line);
  };

  // Average over the whole recording, stops included -- the same thing a phone shows next to the time.
  const climb = [];
  if (summary.durationSeconds > 0 && summary.distanceMeters > 0) {
    climb.push([t('info.speed'), formatSpeed(summary.distanceMeters / summary.durationSeconds)]);
  }
  // A file whose heights are all the same (KML often writes 0) has nothing to add up: the cells stay, with a
  // dash, rather than claiming a flat route climbed nothing.
  if (summary.points > 0) {
    climb.push([t('info.ascent'), formatElevation(elevations?.ascent)]);
    climb.push([t('info.descent'), formatElevation(elevations?.descent)]);
  }
  statRow(climb);

  // How big the route is, on one line: distance, the time it took, the number of points behind both.
  const extent = [];
  if (summary.segments > 0 || summary.routes > 0) {
    extent.push([summary.segments > 0 ? t('info.distance') : t('info.routeLength'), formatDistance(summary.distanceMeters)]);
  }
  if (summary.durationSeconds !== null) extent.push([t('info.time'), formatDuration(summary.durationSeconds)]);
  if (summary.points > 0) extent.push([t('info.points'), summary.points.toLocaleString()]);
  statRow(extent);
  if (stats.childElementCount > 0) box.append(stats);

  // Everything else is a fact worth reading once, in the plain list below.
  const rows = [];
  const range = formatRange(summary.start, summary.end);
  if (range) rows.push([t('info.date'), range]);

  const parts = [];
  if (summary.tracks > 0) {
    const segments = summary.segments > summary.tracks
      ? t('list.segments', { count: units(summary.segments, 'segment') }) : '';
    parts.push(units(summary.tracks, 'track') + segments);
  }
  if (summary.routes > 0) parts.push(units(summary.routes, 'route'));
  if (summary.areas > 0) parts.push(units(summary.areas, 'area'));
  if (summary.waypoints > 0) parts.push(units(summary.waypoints, 'waypoint'));
  if (parts.length > 0) rows.push([t('info.contents'), parts.join(t('list.separator'))]);

  // Only worth a row when something can be clicked open.
  const photoPins = (gpx.waypoints || []).filter((w) => photosOf(w).length > 0);
  if (photoPins.length > 0) {
    const photos = photoPins.reduce((n, w) => n + photosOf(w).length, 0);
    rows.push([t('info.photos'), t('info.photosValue', {
      photos: units(photos, 'photo'), pins: units(photoPins.length, 'pin'),
    })]);
  }

  // Each pair is boxed: a wide window unpacks the box again (display: contents) and the two-column grid is
  // untouched, while a narrow one can run the pairs along a line without ever splitting a label from its value.
  const table = el('dl', 'facts');
  for (const [key, value] of rows) {
    const fact = el('div', 'fact');
    fact.append(el('dt', null, key), el('dd', null, value));
    table.append(fact);
  }
  if (rows.length > 0) box.append(table);
  if (parts.length === 0) box.append(el('p', 'empty', t('info.empty')));
  box.hidden = false;
  renderKeys(gpx);
}

/** The keys, on their own above the map: the summary is about the file, not about how to drive the viewer. */
const KEY_HINTS = [
  // The arrow keys do the same thing as A and D, so only one pair is spelled out.
  {
    keys: ['A', 'D'], text: 'keys.nav', className: 'nav',
    // Nothing to step through in a file without waypoints, so that group is left out rather than lying.
    when: (gpx) => (gpx.waypoints || []).length > 1,
  },
  { keys: ['W'], text: 'keys.pin' },
  { keys: ['Q', 'E'], text: 'keys.layer' },
  { keys: ['C'], text: 'keys.locate' },
  { keys: ['S'], text: 'keys.chrome' },
];

function renderKeys(gpx) {
  const bar = document.getElementById('keys');
  bar.replaceChildren();
  const groups = KEY_HINTS.filter((hint) => !hint.when || hint.when(gpx));
  for (const hint of groups) {
    if (bar.childElementCount > 0) bar.append(el('span', 'sep', '\u00b7'));
    const group = el('span', hint.className ? 'hint ' + hint.className : 'hint');
    for (const key of hint.keys) group.append(el('kbd', null, key));
    group.append(el('span', null, t(hint.text)));
    bar.append(group);
  }
  bar.hidden = groups.length === 0;
}

// ---------- elevation profile ----------

/** Every track point with the distance travelled to reach it; scrubbing needs a position, not just a height. */
function trackPoints(gpx) {
  const points = [];
  let along = 0;
  // Each segment starts where the recording did. Walking the gap between two segments would add distance
  // the route never covered, and later report it as a level stretch nobody walked.
  for (const seg of gpx.tracks.flatMap((t) => t.segments)) {
    let prev = null;
    for (const p of seg) {
      if (prev) along += distanceMeters(prev, p);
      points.push({ along, lat: p.lat, lon: p.lon, ele: p.ele, time: p.time });
      prev = p;
    }
  }
  return points;
}

/** The last point at or before `distance`. `along` never decreases, so a binary search is enough. */
function pointNear(points, distance) {
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (points[mid].along <= distance) low = mid;
    else high = mid - 1;
  }
  return points[low];
}

/** Everything the profile and the summary box need, worked out once. */
function readElevations(gpx) {
  const points = trackPoints(gpx);
  // Only points that carry a height can be plotted, but the cursor runs over every point.
  const samples = points.filter((p) => p.ele !== undefined);
  if (samples.length < 2) return null;
  return { points, samples, ...analyse(samples) };
}

/** The point of the track a waypoint sits closest to: a profile has no room to show a detour off it. */
function nearestSample(samples, point) {
  let best = samples[0];
  let bestDistance = Infinity;
  for (const sample of samples) {
    const dLon = sample.lon - point.lon;
    const dLat = sample.lat - point.lat;
    const d = dLon * dLon + dLat * dLat;
    if (d < bestDistance) {
      bestDistance = d;
      best = sample;
    }
  }
  return best;
}

/**
 * How hard the route is, and the scale its colours came from.
 *
 * The five arrows and their counts were removed with the five-colour fill they referred to: once the fill
 * became a continuous ramp, "two gentle climbs" pointed at something no longer on the drawing. What is left
 * are the two numbers a rider actually decides on -- how much of the route is steep, and how steep the worst
 * of it gets -- with the scale beside them so both can be found on it.
 */
function gradeLegend(steep) {
  // No title over it: "Gradient" above "Steep 5.1 km" repeated the same word twice, and the row explains
  // itself -- the panel heading already says this is the elevation, and the scale says what the colours mean.
  const row = el('div', 'legend');
  const item = el('span', 'item');
  // Under twenty metres of climbing there is nothing worth a number: "steep 0 m" reads as a measurement
  // error, and "no steep ground" is what the route actually is.
  if (steep.metres >= 20) {
    // One decimal is enough here: the row is a summary, and 5.10 km spends a character to say nothing. Under
    // a kilometre it counts in tens of metres, which is the precision the 25 m grid actually has.
    const distance = () => (steep.metres >= 1000
      ? `${(steep.metres / 1000).toFixed(1)} ${t('unit.km')}`
      : `${Math.round(steep.metres / 10) * 10} ${t('unit.m')}`);
    item.append(
      localized(el('span', 'key'), () => t('grade.steep')),
      localized(el('span', 'value'), distance),
    );
  } else {
    item.append(localized(el('span', 'key'), () => t('grade.noSteep')));
  }
  item.append(el('span', 'sep', '\u00b7'));
  item.append(
    localized(el('span', 'key'), () => t('grade.steepest')),
    el('span', 'value', `${Math.round(steep.maxSlope * 100)}%`),
  );
  localized(item, () => t('grade.steepHint'), 'title');
  row.append(item);

  // The colours under the numbers are a scale, not five separate ideas, so the scale itself is shown. Without
  // it the magenta at 25 % and the yellow at 4 % are both just "a colour" and the reader supplies their own
  // meaning -- usually the wrong one.
  const strip = el('span', 'scale');
  const bar = el('span', 'scale-bar');
  bar.style.background = `linear-gradient(to right, ${slopeScale()
    .map(([offset, colour]) => `${colour} ${(offset * 100).toFixed(1)}%`).join(', ')})`;
  strip.append(el('span', 'scale-end', '0'), bar, el('span', 'scale-end', '25%'));
  localized(strip, () => t('profile.scaleHint'), 'title');
  row.append(strip);
  return row;
}

function renderProfile(gpx, data) {
  const { points, samples, min, max, total, cells, steep } = data;
  const width = 600;
  const height = 100;
  const span = max - min || 1;
  const at = (d) => (d / Math.max(total, 1)) * width;
  const yOf = (ele) => height - ((ele - min) / span) * (height - 8) - 4;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');

  // Cells of ground, each painted from its own gradient -- the same gradient the legend's two numbers are
  // read from. Neighbouring cells on the same step of the scale become one shape, and each shape is filled
  // with a left-to-right ramp from the colour before it to its own: without that every step change was a
  // hard vertical edge, and a 15 km profile read as a barcode instead of as ground.
  const BUCKETS = 24;
  const bucketOf = (slope) => Math.round(Math.max(0, Math.min(SLOPE_FULL, Math.abs(slope))) / (SLOPE_FULL / BUCKETS));
  const defs = document.createElementNS(ns, 'defs');
  svg.append(defs);
  let cursor = 0;
  let shape = null;
  let previousFill = null;
  let gradientId = 0;
  for (const cell of cells) {
    const bucket = bucketOf(cell.slope);
    if (!shape || shape.bucket !== bucket) {
      if (shape) emit(shape);
      shape = { bucket, from: cell.from, to: cell.to, points: [] };
    } else {
      shape.to = cell.to;
    }
    while (cursor < samples.length && samples[cursor].along <= cell.to) {
      if (samples[cursor].along > cell.from) shape.points.push([samples[cursor].along, samples[cursor].ele]);
      cursor += 1;
    }
    shape.to = cell.to;
  }
  if (shape) emit(shape);

  function emit(part) {
    // Half a pixel of overlap on each side: two shapes that merely touch leave an anti-aliased seam down the
    // whole height of the plot, which reads as a line the route does not have.
    const left = Math.max(0, at(part.from) - 0.5);
    const right = Math.min(width, at(part.to) + 0.5);
    const colour = slopeColor((part.bucket * SLOPE_FULL) / BUCKETS);
    let fill = colour;
    // A ramp narrower than a pixel has nothing to show, and a long route can have hundreds of those; they
    // take the flat colour of their own step instead, which is invisible at that width.
    if (previousFill && previousFill !== colour && right - left > 0.8) {
      const ramp = document.createElementNS(ns, 'linearGradient');
      const id = `slope-${gradientId += 1}`;
      ramp.setAttribute('id', id);
      ramp.setAttribute('gradientUnits', 'userSpaceOnUse');
      ramp.setAttribute('x1', left.toFixed(2));
      ramp.setAttribute('x2', right.toFixed(2));
      ramp.setAttribute('y1', '0');
      ramp.setAttribute('y2', '0');
      for (const [offset, stop] of [[0, previousFill], [1, colour]]) {
        const node = document.createElementNS(ns, 'stop');
        node.setAttribute('offset', String(offset));
        node.setAttribute('stop-color', stop);
        ramp.append(node);
      }
      defs.append(ramp);
      fill = `url(#${id})`;
    }
    const area = document.createElementNS(ns, 'path');
    area.setAttribute('class', 'area');
    area.setAttribute('fill', fill);
    area.setAttribute('d', `M${left.toFixed(1)},${height} L`
      + `${at(part.from).toFixed(1)},${yOf(elevationAt(samples, part.from)).toFixed(1)} L`
      + part.points.map(([along, ele]) => `${at(along).toFixed(1)},${yOf(ele).toFixed(1)}`).join(' L')
      + ` L${right.toFixed(1)},${yOf(elevationAt(samples, part.to)).toFixed(1)} L${right.toFixed(1)},${height} Z`);
    svg.append(area);
    previousFill = colour;
  }

  const line = document.createElementNS(ns, 'path');
  line.setAttribute('class', 'line');
  line.setAttribute('d', `M${samples.map((p) => `${at(p.along).toFixed(1)},${yOf(p.ele).toFixed(1)}`).join(' L')}`);
  svg.append(line);

  // Hover marks are HTML, not SVG: the plot is stretched horizontally, which would squash a circle flat.
  const guide = el('div', 'guide');
  const dot = el('div', 'dot');
  guide.hidden = true;
  dot.hidden = true;

  // The chart is the plot without the gutter: every position below is a percentage of it, so the axis numbers
  // can never sit on top of the curve the way they did when they floated over the drawing.
  const chart = el('div', 'chart');
  chart.append(svg);

  // The two ends of the axis get a column of their own to the left of the drawing, where nothing overlaps them.
  const gutter = el('div', 'gutter');
  gutter.append(
    localized(el('span', 'axis top'), () => `${Math.round(max)} ${t('unit.m')}`),
    localized(el('span', 'axis bottom'), () => `${Math.round(min)} ${t('unit.m')}`),
  );

  const plot = el('div', 'plot');
  plot.append(gutter, chart);

  // A waypoint goes where the track passes closest to it; the dots are the only thing on the profile that
  // can be clicked, and the click opens the same pin the map would.
  const pins = [];
  for (const waypoint of gpx.waypoints || []) {
    const near = nearestSample(samples, waypoint);
    const pin = el('span', photosOf(waypoint).length > 0 ? 'pin photo' : 'pin');
    pin.style.left = `${(near.along / Math.max(total, 1)) * 100}%`;
    pin.style.top = `${(yOf(near.ele) / height) * 100}%`;
    // The same waypoints, drawn twice: W hides the map's and these together, so the profile does not keep
    // pointing at markers the map no longer shows. A file whose switch is off at load starts hidden here too.
    pin.hidden = !pinsShown;
    localized(pin, () => waypoint.name || t('label.waypoint'), 'title');
    pins.push({ node: pin, point: waypoint });
    chart.append(pin);
  }
  profilePins = pins;

  // The top and the bottom of the route, written where they happen. The axis knows the range, but not
  // where along the walk it was reached, and those two numbers are what a climb is usually remembered by.
  const highest = samples.reduce((best, sample) => (sample.ele > best.ele ? sample : best), samples[0]);
  const lowest = samples.reduce((best, sample) => (sample.ele < best.ele ? sample : best), samples[0]);
  for (const [sample, kind] of [[highest, 'high'], [lowest, 'low']]) {
    const tag = localized(el('span', `extremum ${kind}`),
      () => t(kind === 'high' ? 'profile.high' : 'profile.low'), 'title');
    tag.append(el('b', '', `${Math.round(sample.ele)} ${t('unit.m')}`));
    const across = sample.along / Math.max(total, 1);
    const down = yOf(sample.ele) / height;
    tag.style.left = `${(across * 100).toFixed(2)}%`;
    // At the ends a centred label would hang off the plot; it is anchored to the edge instead.
    if (across < 0.05) tag.classList.add('left');
    else if (across > 0.95) tag.classList.add('right');
    // Above the point normally -- the fill is under the curve, and text on it is text on a colour. At the
    // very top there is no room above, so it goes below rather than being cut off.
    if (kind === 'high') {
      if (down < 0.2) tag.classList.add('below');
    } else if (down > 0.82) {
      tag.classList.add('above');
    }
    tag.style.top = `${(down * 100).toFixed(2)}%`;
    chart.append(tag);
  }

  chart.append(guide, dot);

  // The numbers ride with the cursor, above the point being read: the eye is on the curve, and a readout in
  // the far corner had to be looked up. Height first, in its own size; where it happened underneath.
  const value = el('b', 'ele');
  const meta = el('span', 'meta');
  const readout = el('span', 'readout');
  readout.append(value, meta);
  readout.hidden = true;
  chart.append(readout);

  const label = el('div', 'label');
  label.append(localized(el('span', 'range'), () => t('profile.title')));

  // Filled in by fit() below, and blank unless the road leaves the band where a slope reads as a slope.
  let noteOff = false;
  let noteVe = 3;
  const scaleNote = localized(el('span', 'scale'), () => (noteOff
    ? t('profile.scale', { n: noteVe >= 10 ? String(Math.round(noteVe)) : noteVe.toFixed(1) })
    : ''));
  scaleNote.hidden = true;
  label.append(scaleNote);

  const box = document.getElementById('profile');
  box.append(label, gradeLegend(steep), plot);
  box.hidden = false;
  document.body.classList.add('with-profile');

  /**
   * The height of the drawing, taken from the shape of the route rather than from the window.
   *
   * A profile has two scales and only one of them is free. The width is spent fitting the whole route across
   * the panel, so pixels per metre along the ground are fixed by the file; whatever height the drawing gets
   * becomes the vertical scale, and with it the exaggeration. Pinning that height at 78 px made the
   * exaggeration the window's business: the same 15.8 km walk read 1.7x in a 1200 px window and 3.1x at 700,
   * and its steepest 12.5 % stretch looked 12 degrees wide one way and 21 the other. Working the height out
   * from the route instead holds the vertical scale near three times the horizontal one, which is where a
   * 10 % climb reads as a climb rather than as a straight line or as a wall.
   *
   * Both ends are clamped, because neither is free either. A ride across a city is 40 m of height over 42 km:
   * three times would need three pixels, so it takes the floor and an exaggeration in the fifties -- there is
   * no other lever, the width is spoken for. A short steep climb wants five hundred, more than the map can
   * spare, so it takes the ceiling. In both cases the number beside the title says what the drawing is
   * really doing, where without it a reader would take the shape at face value.
   */
  const MIN_PLOT = 56;
  const MAX_PLOT = 128;
  const TARGET_VE = 3;

  function fit() {
    if (!box.offsetParent) return; // S has taken the whole interface off the map
    const w = chart.getBoundingClientRect().width;
    if (w < 60) return;
    // How much of the picture the panel may take. Tied to the window's height rather than to its shape: a
    // narrow window is often a tall one too, and there 128 px is a tenth of the screen, not half of it.
    const ceiling = Math.max(MIN_PLOT, Math.min(MAX_PLOT, Math.round(innerHeight * 0.18)));
    const wanted = Math.round((TARGET_VE * span * w) / Math.max(total, 1));
    const plotHeight = Math.min(ceiling, Math.max(MIN_PLOT, wanted));
    plot.style.height = `${plotHeight}px`;
    // The axis keeps 8 % of the height free top and bottom, so the ground itself only gets the rest.
    const ve = (plotHeight * 0.92) / span / (w / Math.max(total, 1));
    noteVe = ve;
    noteOff = ve < 2 || ve > 4;
    scaleNote.hidden = !noteOff;
    scaleNote.textContent = noteOff
      ? t('profile.scale', { n: ve >= 10 ? String(Math.round(ve)) : ve.toFixed(1) })
      : '';
    // Read back rather than assumed: the label and the legend are fixed heights, but the panel is what the
    // credit line and the opening frame have to clear.
    document.documentElement.style.setProperty('--profile-height', `${box.offsetHeight}px`);
  }

  let refitFrame = 0;
  addEventListener('resize', () => {
    if (refitFrame) return;
    refitFrame = requestAnimationFrame(() => { refitFrame = 0; fit(); });
  });
  fit();

  return { points, samples, total, svg, plot, chart, guide, dot, readout, value, meta, yOf, pins, refit: fit };
}

/**
 * Ties the plot to the map: moving over it reports the distance and drops a marker on the track,
 * clicking holds that point so it can be looked at without keeping the mouse still.
 */
function attachScrub(map, state) {
  const { points, total, svg, plot, chart, guide, dot, readout, value, meta, yOf } = state;

  const marker = L.circleMarker([0, 0], {
    radius: 7, color: '#ffffff', weight: 2.5, fillColor: '#e5243b', fillOpacity: 1,
    interactive: false, className: 'scrub-marker',
  });
  let pinned = false;
  let onMap = false;
  let current = null;
  let frame = 0;
  let queued = null;

  // The dots on the profile open the same pin the map would. Wired here rather than at draw time because
  // the profile is built before the map: the stops only exist once the track has been drawn.
  for (const pin of state.pins || []) {
    pin.node.addEventListener('click', (event) => {
      event.stopPropagation();
      const index = stops.findIndex((stop) => stop.point === pin.point);
      if (index < 0) return;
      focusStop(index);
      const stop = stops[index];
      if (!stop.marker.isPopupOpen()) stop.marker.openPopup();
    });
  }

  function distanceAt(clientX) {
    const rect = svg.getBoundingClientRect();
    const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    return Math.min(total, Math.max(0, ratio * total));
  }

  function place(distance) {
    const point = pointNear(points, Math.max(0, Math.min(total, distance)));
    current = point;

    const rect = chart.getBoundingClientRect();
    const x = (point.along / total) * rect.width;
    guide.style.left = `${x}px`;
    guide.hidden = false;
    // Without a height the tip has nothing to point at, so it rides the bottom of the plot instead.
    let y = rect.height - 6;
    if (point.ele !== undefined) {
      y = (yOf(point.ele) / 100) * rect.height;
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
      dot.hidden = false;
    } else {
      dot.hidden = true;
    }

    // Height first, where the eye already is; the distance and the time underneath say when it was.
    value.textContent = point.ele !== undefined ? `${Math.round(point.ele)} ${t('unit.m')}` : '';
    value.hidden = value.textContent === '';
    const parts = [formatDistance(point.along)];
    if (point.time) parts.push(formatters().time.format(point.time));
    meta.textContent = parts.join(' · ');
    readout.hidden = false;

    // Measured after the words are in, then clamped: at either end a centred tip would hang off the plot.
    // It always sits above the point -- under it the tip lands on the cursor and the hand covers it. Near the
    // top there is no room above, so it is pushed back inside the plot rather than flipped.
    const width = readout.offsetWidth;
    const height = readout.offsetHeight;
    const half = width / 2 + 2;
    const left = rect.width <= width ? rect.width / 2 : Math.min(Math.max(x, half), rect.width - half);
    readout.style.left = `${left}px`;
    readout.style.top = `${Math.max(0, y - height - 10)}px`;

    const latlng = [point.lat, point.lon];
    marker.setLatLng(latlng);
    if (!onMap) {
      marker.addTo(map);
      onMap = true;
    }
    // Only move when the point would leave the view: panning on every move makes the track jump around.
    const pad = 64;
    const size = map.getSize();
    const at = map.latLngToContainerPoint(latlng);
    if (at.x < pad || at.y < pad || at.x > size.x - pad || at.y > size.y - pad) {
      map.panTo(latlng, { animate: false });
    }
  }

  function clear() {
    guide.hidden = true;
    dot.hidden = true;
    readout.hidden = true;
    if (onMap) {
      marker.remove();
      onMap = false;
    }
    current = null;
  }

  function schedule(clientX) {
    queued = clientX;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (queued !== null) place(distanceAt(queued));
      queued = null;
    });
  }

  svg.addEventListener('pointermove', (event) => {
    if (!pinned) schedule(event.clientX);
  });
  svg.addEventListener('pointerleave', () => {
    if (!pinned) clear();
  });
  svg.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    place(distanceAt(event.clientX));
    pinned = !pinned;
    plot.classList.toggle('pinned', pinned);
  });

  return {
    at: (meters) => place(meters),
    hide: clear,
    point: () => current,
    pinned: () => pinned,
    // Repaints the readout in the new language without waiting for the mouse to move again.
    refresh: () => {
      if (current) place(current.along);
    },
  };
}

// ---------- map ----------

function graticule(map) {
  // Lines every "nice" number of degrees, so the track keeps a sense of scale without map tiles.
  const group = L.layerGroup();
  const steps = [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30];
  const style = { color: '#ffffff', opacity: 0.12, weight: 1, interactive: false };

  function redraw() {
    group.clearLayers();
    const b = map.getBounds();
    const span = Math.max(b.getNorth() - b.getSouth(), 1e-6);
    const step = steps.find((s) => span / s <= 10) ?? 30;
    const south = Math.max(-90, b.getSouth());
    const north = Math.min(90, b.getNorth());
    for (let lat = Math.ceil(south / step) * step; lat <= north; lat += step) {
      group.addLayer(L.polyline([[lat, b.getWest()], [lat, b.getEast()]], style));
    }
    for (let lon = Math.ceil(b.getWest() / step) * step; lon <= b.getEast(); lon += step) {
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

function savedLayer() {
  try {
    const value = localStorage.getItem(LAYER_KEY);
    return value in LAYERS ? value : 'map';
  } catch {
    return 'map';
  }
}

function layerSwitcher(map) {
  const layers = {};
  for (const [key, def] of Object.entries(LAYERS)) {
    layers[key] = def.url ? L.tileLayer(def.url, def.options) : graticule(map);
  }
  let current = null;
  const buttons = {};

  function select(key, remember) {
    if (current) map.removeLayer(layers[current]);
    current = key;
    layers[key].addTo(map);
    document.body.classList.toggle('no-map', key === 'none');
    for (const [k, button] of Object.entries(buttons)) button.classList.toggle('active', k === key);
    if (remember) {
      try {
        localStorage.setItem(LAYER_KEY, key);
      } catch {
        // Private mode or storage disabled: the choice just is not remembered.
      }
    }
  }

  const Control = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const bar = el('div', 'layer-switch leaflet-bar');
      for (const [key, def] of Object.entries(LAYERS)) {
        const button = el('button', null, t(def.label));
        button.type = 'button';
        button.title = t(def.title);
        button.tabIndex = -1; // never keep focus: Space and Esc belong to QuickLook
        button.dataset.layer = key;
        button.addEventListener('click', () => {
          select(key, true);
          button.blur();
        });
        buttons[key] = button;
        bar.append(button);
      }
      L.DomEvent.disableClickPropagation(bar);
      return bar;
    },
  });
  map.addControl(new Control());
  select(savedLayer(), false);

  /** Re-reads the labels after a language switch; the buttons themselves stay where they are. */
  function relabel() {
    for (const [key, button] of Object.entries(buttons)) {
      button.textContent = t(LAYERS[key].label);
      button.title = t(LAYERS[key].title);
    }
  }

  return { select, current: () => current, relabel };
}

/**
 * One button that shows or hides the dots on the map: the waypoint pins and the dot on every recorded point.
 * The lines, the areas, the start/end flags, the profile and the summary stay exactly as they are: this is
 * for looking at the shape of a route without a field of dots on top of it. A file that draws no dots and has
 * no waypoints gets no button, so the corner never carries a switch that does nothing.
 */
function pinsControl(map) {
  let button = null;
  let labelNode = null;

  function relabel() {
    if (!button) return;
    button.classList.toggle('active', pinsShown);
    button.title = t(pinsShown ? 'pins.hideTitle' : 'pins.showTitle');
    if (labelNode) labelNode.textContent = t('pins.label');
  }

  function set(show, remember) {
    pinsShown = show;
    if (show) {
      pinLayer?.addTo(map);
      // Coming back from hidden the markers are new DOM nodes, so the selection has to be painted again.
      const stop = stops[stopIndex];
      if (stop) {
        stop.marker.getElement()?.classList.add('selected');
        paintHalo(stop);
      }
    } else {
      pinLayer?.remove();
      if (halo) {
        halo.remove();
        halo = null;
      }
    }
    // The profile carries the same waypoints as dots of its own; one switch, one state for both.
    for (const pin of profilePins) pin.node.hidden = !show;
    if (remember) {
      try {
        localStorage.setItem(PINS_KEY, show ? '1' : '0');
      } catch {
        // Private mode or storage disabled: the choice just is not remembered.
      }
    }
    relabel();
  }

  const Control = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const bar = el('div', 'pins-switch leaflet-bar');
      button = el('button');
      button.type = 'button';
      button.tabIndex = -1; // never keep focus: Space and Esc belong to QuickLook
      button.dataset.pins = 'toggle';
      // The dot carries the state at a glance; the word stays put so the button never changes width.
      labelNode = el('span', null, t('pins.label'));
      button.append(el('span', 'dot'), labelNode);
      button.addEventListener('click', () => {
        set(!pinsShown, true);
        button.blur();
      });
      bar.append(button);
      relabel();
      L.DomEvent.disableClickPropagation(bar);
      return bar;
    },
  });
  map.addControl(new Control());

  return { set, show: () => set(true, true), hide: () => set(false, true), visible: () => pinsShown, relabel };
}

/** One button that flips between the two languages; it shows where you are, the tooltip says where it goes. */
function languageControl(map) {
  let button = null;

  const Control = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const bar = el('div', 'lang-switch leaflet-bar');
      button = el('button', null, langLabel());
      button.type = 'button';
      button.title = t('switch.title');
      button.tabIndex = -1; // never keep focus: Space and Esc belong to QuickLook
      button.dataset.lang = 'switch';
      button.addEventListener('click', () => {
        toggleLang();
        button.blur();
      });
      bar.append(button);
      L.DomEvent.disableClickPropagation(bar);
      return bar;
    },
  });
  map.addControl(new Control());

  return {
    relabel() {
      if (!button) return;
      button.textContent = langLabel();
      button.title = t('switch.title');
    },
  };
}

/**
 * One button that puts the whole route back in view. Panning away or following a pin leaves the map
 * somewhere along the track with no way home except dragging; this is the way home, and it is the same
 * frame the file opened with -- not whatever zoom the last gesture stopped on.
 *
 * It stands under the zoom buttons, in the same column and the same 30 px square: both are about where the
 * map looks, and the top-right row is already crowded enough to run into the key bar on a narrow window.
 */
function locateControl(map) {
  let button = null;

  const Control = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const bar = el('div', 'locate-switch leaflet-bar');
      button = el('button');
      button.type = 'button';
      button.title = t('locate.title');
      button.setAttribute('aria-label', t('locate.title'));
      button.tabIndex = -1; // never keep focus: Space and Esc belong to QuickLook
      button.dataset.locate = 'route';
      // A crosshair: the one mark that reads as "put this back where it belongs" at 14 px.
      button.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">'
        + '<circle cx="8" cy="8" r="4.2" fill="none" stroke="currentColor" stroke-width="1.6"/>'
        + '<path d="M8 0.9v3.2M8 11.9v3.2M0.9 8h3.2M11.9 8h3.2" fill="none" stroke="currentColor"'
        + ' stroke-width="1.6" stroke-linecap="round"/></svg>';
      button.addEventListener('click', () => {
        fitRoute?.();
        button.blur();
      });
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

// The badge on the right tells a photo pin from a plain one; without it every pin looks clickable.
// White on yellow: a yellow badge would disappear into the pin's own colour at this size.
const PHOTO_BADGE = '<circle cx="23" cy="7.5" r="5.6" fill="#ffffff" stroke="#1b1b1b" stroke-width="1.2"/>'
  + '<rect x="20.4" y="6.4" width="5.4" height="3.7" rx="0.8" fill="#1b1b1b"/>'
  + '<circle cx="23" cy="8.25" r="1.15" fill="#ffffff"/>';

function pinIcon(color, withPhoto) {
  return L.divIcon({
    className: withPhoto ? 'gpx-pin has-photo' : 'gpx-pin',
    // Wider than the pin itself: the badge sits past the right edge of the marker body.
    html: `<svg viewBox="0 0 30 34" width="30" height="34"><path d="M12 1C6 1 1.5 5.6 1.5 11.5 1.5 19.5 12 33 12 33s10.5-13.5 10.5-21.5C22.5 5.6 18 1 12 1z" fill="${color}" stroke="#1b1b1b" stroke-width="1.5"/><circle cx="12" cy="11.5" r="4" fill="#1b1b1b"/>${withPhoto ? PHOTO_BADGE : ''}</svg>`,
    iconSize: [30, 34],
    iconAnchor: [12, 33],
    popupAnchor: [0, -30],
  });
}

// Waypoint markers in document order, for the keyboard to walk. Filled by drawGpx, read by the key handler:
// `stops` is every marker, `photoStops` the subset whose placemark carries photos.
let stops = [];
let photoStops = [];
let stopIndex = -1;
let navMap = null; // the map the stops live on, for the selection halo
let halo = null;   // a ring around the selected pin: at a glance the only readable cue when zoomed out
// The dots and the waypoint pins live in one group, so hiding them is one remove() and showing them is one
// addTo(): the markers, their popups and the stops the keyboard walks are all still there, just not on the
// map. The start and end flags stay on the map either way.
let pinLayer = null;
let pinControl = null; // set by pinsControl; focusStop asks it to bring the pins back
let pinsShown = true;
let profilePins = []; // the waypoints as drawn on the profile, hidden and shown with the map's
let layerSwitch = null; // set by main; Q and E ask it to move

const PINS_KEY = 'gpxviewer.pins';

/** Read once at load: the button remembers its own state the same way the layer switch does. */
function savedPins() {
  try {
    return localStorage.getItem(PINS_KEY) !== '0';
  } catch {
    return true; // private mode or storage disabled: show them, that is the useful default
  }
}

function drawGpx(map, gpx) {
  const bounds = L.latLngBounds([]);
  const dots = L.canvas({ padding: 0.5 });
  let colorIndex = 0;
  stops = [];
  photoStops = [];
  stopIndex = -1;
  navMap = map;
  halo = null;
  pinLayer = L.layerGroup();
  const withDots = gpx.tracks.reduce((n, t) => n + t.segments.reduce((m, seg) => m + seg.length, 0), 0) <= MAX_DOTS;
  // Many placemarks would bury the map in start and end flags; the lines still show where each one runs.
  const showEnds = gpx.tracks.length <= 20;

  // Areas go underneath the lines: a KML fence or park boundary is context, not the subject.
  for (const area of gpx.areas || []) {
    const shape = L.polygon(area.rings.map((ring) => ring.map((p) => [p.lat, p.lon])), {
      color: '#378ADD', weight: 2, opacity: 0.8, fillColor: '#378ADD', fillOpacity: 0.06, className: 'kml-area',
    }).addTo(map);
    if (area.name) shape.bindTooltip(el('span', null, area.name), { sticky: true });
    bounds.extend(shape.getBounds());
  }

  gpx.tracks.forEach((track) => {
    const segments = track.segments;
    segments.forEach((seg, s) => {
      const color = COLORS[colorIndex++ % COLORS.length];
      const latlngs = seg.map((p) => [p.lat, p.lon]);
      const title = track.name
        ? (n) => (segments.length > 1 ? t('point.segment', { name: track.name, segment: n }) : track.name)
        : null;
      const line = L.polyline(latlngs, { color, weight: 4, opacity: 0.9, className: 'gpx-track' }).addTo(map);
      if (title) line.bindTooltip(localized(el('span'), () => title(s + 1)), { sticky: true });
      bounds.extend(line.getBounds());
      if (!withDots) return;
      for (const p of seg) {
        // Track dots go into the same group as the waypoints: on a pure track they are the only thing the
        // switch has to hide, and hiding them is what makes the shape of a long route readable.
        pinLayer.addLayer(L.circleMarker([p.lat, p.lon], {
          renderer: dots, radius: 3, color: '#1b1b1b', weight: 1, fillColor: color, fillOpacity: 1,
        }).bindPopup(() => pointPopup(p, track.name)));
      }
    });
    const first = segments[0]?.[0];
    const lastSeg = segments[segments.length - 1];
    const last = lastSeg?.[lastSeg.length - 1];
    // End first, start on top and smaller: on a closed loop both stay visible.
    // Straight onto the map, not into pinLayer: the switch is for clearing a field of dots, and the two ends
    // are the anchor that tells you where the walk begins even with everything else hidden.
    if (last && showEnds) {
      L.circleMarker([last.lat, last.lon], { radius: 8, color: '#ffffff', weight: 3, fillColor: '#e5243b', fillOpacity: 1, className: 'gpx-end' })
        .bindPopup(() => pointPopup(last, t('label.end'))).addTo(map);
    }
    if (first && showEnds) {
      L.circleMarker([first.lat, first.lon], { radius: 5, color: '#ffffff', weight: 2, fillColor: '#18c964', fillOpacity: 1, className: 'gpx-start' })
        .bindPopup(() => pointPopup(first, t('label.start'))).addTo(map);
    }
  });

  for (const route of gpx.routes) {
    const line = L.polyline(route.points.map((p) => [p.lat, p.lon]), {
      color: ROUTE_COLOR, weight: 3, opacity: 0.9, dashArray: '8 8', className: 'gpx-route',
    }).addTo(map);
    if (route.name) line.bindTooltip(el('span', null, route.name), { sticky: true });
    bounds.extend(line.getBounds());
  }

  for (const w of gpx.waypoints) {
    const photos = photosOf(w);
    const marker = L.marker([w.lat, w.lon], {
      icon: pinIcon('#f5c400', photos.length > 0), keyboard: false, title: w.name || '',
    });
    // Into the group, not onto the map: the switch decides whether the group is on the map at all.
    pinLayer.addLayer(marker);
    // Every marker is a stop for the keyboard; the ones with photos additionally take part in stepping
    // through pictures while the viewer is open.
    const stop = { point: w, marker, photos };
    stops.push(stop);
    if (photos.length > 0) photoStops.push(stop);
    // A click only moves the highlight: the popup is Leaflet's own business, and calling openPopup here
    // would lose the race against bindPopup's toggle handler, which then sees an open popup and closes it.
    marker.on('click', () => focusStop(stops.indexOf(stop)));
    if (photos.length > 0) {
      // Two steps on purpose: the pin opens a card with thumbnails and the placemark's text, and the card
      // opens the full-size image. The tooltip names the pin before that first click.
      const label = localized(el('span'), () => `${w.name || t('label.photo')} \u00b7 ${units(photos.length, 'photo')}`);
      marker.bindTooltip(label, { direction: 'top', offset: [0, -30] });
      marker.bindPopup(() => photoPreview(photos, w, () => marker.closePopup()), {
        className: 'photo-popup', maxWidth: 300, minWidth: 220, autoPan: true, autoPanPadding: [24, 24],
      });
    } else {
      marker.bindPopup(() => pointPopup(w, w.name || t('label.waypoint')), { autoPanPadding: [24, 64] });
    }
    bounds.extend([w.lat, w.lon]);
  }
  // Built off the map and added once at the end: one switch, one place that decides.
  if (pinsShown && pinLayer.getLayers().length > 0) pinLayer.addTo(map);
  return bounds;
}

/** Highlights the marker at `index` (wrapping) and moves the map to it. Leaves the popup alone. */
function focusStop(index) {
  if (stops.length === 0) return null;
  // A key press outranks the hidden state: walking markers the user cannot see would just move the map.
  if (!pinsShown) pinControl?.show();
  const next = ((index % stops.length) + stops.length) % stops.length;
  const previous = stops[stopIndex];
  const stop = stops[next];
  if (previous && previous !== stop) previous.marker.getElement()?.classList.remove('selected');
  stopIndex = next;
  stop.marker.getElement()?.classList.add('selected');
  paintHalo(stop);
  return stop;
}

/** The ring around the selected pin. Created on first use; brought back when the pins return from hidden. */
function paintHalo(stop) {
  if (!navMap) return;
  const at = stop.marker.getLatLng();
  if (!halo) {
    halo = L.circleMarker(at, {
      radius: 16, color: '#2f9bff', weight: 2, opacity: 0.95,
      fillColor: '#2f9bff', fillOpacity: 0.14, interactive: false,
    }).addTo(navMap);
  }
  halo.setLatLng(at).bringToFront();
}

/** Highlight plus card: what the keyboard does. The popup opens only if it is not open already. */
function selectStop(index) {
  const stop = focusStop(index);
  if (stop && !stop.marker.isPopupOpen()) stop.marker.openPopup();
  return stop;
}

/** True when the key belongs to the viewer and the map must not move. */
function stepPhoto(delta) {
  if (photoStops.length === 0) return;
  const stop = photoStops.find((s) => s.point === photoViewer.current());
  if (!stop) {
    // The viewer was opened before any selection: start at the edge the key points away from.
    const edge = photoStops[delta > 0 ? 0 : photoStops.length - 1];
    photoViewer.show(edge.photos, edge.point.name || t('label.photo'), edge.point, 0);
    return;
  }
  // Inside an album the key moves one photo; at either end it continues with the neighbouring pin, so a
  // file of single-photo pins is walked one picture per press.
  if (photoViewer.stepWithin(delta)) return;
  const index = photoStops.indexOf(stop);
  const neighbour = photoStops[(index + delta + photoStops.length) % photoStops.length];
  selectStop(stops.indexOf(neighbour)); // the map follows, so closing the viewer lands on the right pin
  photoViewer.show(neighbour.photos, neighbour.point.name || t('label.photo'), neighbour.point,
    delta > 0 ? 0 : neighbour.photos.length - 1);
}

/** Arrow keys and A/D walk the waypoints; with a photo open they walk the photos instead. */
function stepByKey(delta) {
  if (photoViewer.isOpen()) {
    stepPhoto(delta);
    return;
  }
  if (stops.length === 0) return;
  selectStop(stopIndex < 0 ? (delta > 0 ? 0 : stops.length - 1) : stopIndex + delta);
}

// Esc and Space stay untouched: QuickLook closes the preview with them. Leaflet's own keyboard panning is
// off (map created with keyboard: false), so an arrow here means "next waypoint" and nothing else.
const STEP_KEYS = { arrowright: 1, arrowleft: -1, d: 1, a: -1 };
// Q and E walk the layer bar in the order its buttons read; W flips the markers; C goes back to the frame the
// file opened with. All of them are only live while the map is on screen: a photo covers it, and a change
// underneath the photo would be invisible to the person who caused it. Holding a key down repeats the event
// about thirty times a second, which would make the markers blink and the background race, so a repeat is
// ignored -- for these four only, the A/D stepping keeps its old behaviour of running on while the key is held.
const LAYER_KEYS = { q: -1, e: 1 };

function togglePins() {
  if (!pinControl) return; // a file with no switch has nothing to flip, and the key stays quiet
  if (pinsShown) pinControl.hide();
  else pinControl.show();
}

function cycleLayer(step) {
  if (!layerSwitch) return;
  const keys = Object.keys(LAYERS);
  const at = keys.indexOf(layerSwitch.current());
  layerSwitch.select(keys[(at + step + keys.length) % keys.length], true);
}

// The interface floats over the map: the summary, the key bar, the buttons in both top corners and the profile.
// S takes all of it away so the route is alone on the map, and S again brings it back. Nothing is remembered --
// the next file opens with its interface on, because a preview that starts blank looks broken.
let chromeHidden = false;
let placeZoom = null;
// Set by main once the track is drawn: the frame the file opened with, which C and the locate button return to.
let fitRoute = null;

function toggleChrome() {
  chromeHidden = !chromeHidden;
  document.body.classList.toggle('chrome-hidden', chromeHidden);
  if (chromeHidden) {
    // With every button gone there is no way to guess the key from the screen, so it is said once and fades.
    showToast(t('chrome.hint'));
  } else {
    // The card was display:none while hidden, so its width has to be measured again before the buttons can
    // stand next to it. One frame is enough for the layout to be back.
    requestAnimationFrame(() => placeZoom?.());
  }
}

let toastTimer = 0;
function showToast(text) {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = text;
  node.hidden = false;
  node.classList.remove('on');
  requestAnimationFrame(() => node.classList.add('on'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.classList.remove('on');
    setTimeout(() => { node.hidden = true; }, 300); // after the fade, not instead of it
  }, 1500);
}

/**
 * One key, applied. The page calls this for its own keydowns, and the host calls it when QuickLook -- not the
 * page -- is holding the keyboard: the key has to mean the same thing on both roads. Nothing happens while a
 * photo is open, and a file with no marker switch takes W quietly.
 */
function pressKey(name) {
  if (photoViewer.isOpen()) return;
  if (name === 'c') {
    fitRoute?.();
    return;
  }
  if (name === 's') {
    toggleChrome();
    return;
  }
  if (name === 'w') {
    togglePins();
    return;
  }
  const turn = LAYER_KEYS[name];
  if (turn) cycleLayer(turn);
}

function onKeyDown(e) {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const target = e.target;
  if (target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]')) return;
  const key = e.key.toLowerCase();
  const photoOpen = photoViewer.isOpen();
  if (!photoOpen && (key === 'w' || key === 's' || key === 'c' || LAYER_KEYS[key])) {
    if (e.repeat) return;
    e.preventDefault();
    pressKey(key);
    return;
  }
  const delta = STEP_KEYS[key];
  if (!delta) return;
  e.preventDefault();
  stepByKey(delta);
}

/** Keeps the host-language hints (spell check, screen readers, window title) in step with the interface. */
function applyPageLanguage() {
  document.documentElement.lang = isChinese() ? 'zh-CN' : 'en';
  document.title = t('page.title');
}

/** The plugin logs the ready line as it arrives, so it keeps one machine-readable shape in both languages. */
function distanceLog(meters) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`;
}

/** A window taller than it is wide, or too narrow for the widescreen arrangement: the summary takes the whole
    width and the controls move to a line under it (see the portrait block in style.css, same rule). */
function isPortrait() {
  return innerWidth < innerHeight || innerWidth < 960;
}

async function main() {
  applyPageLanguage();

  if (!src) {
    showError(t('error.noFile'));
    return;
  }

  let text;
  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    text = await response.text();
  } catch (e) {
    showError(t('error.read', { detail: e.message }));
    return;
  }

  let gpx;
  let summary;
  try {
    // One XML parse for both formats; the root element decides which reader runs. Keyhole markup uses
    // <kml> at the root, GPX uses <gpx>, so neither can be mistaken for the other.
    const doc = parseXml(text);
    const rootName = doc.documentElement?.localName;
    if (rootName !== 'kml' && rootName !== 'gpx') {
      throw new KmlError(t('error.notTrack'));
    }
    gpx = rootName === 'kml' ? parseKmlDocument(doc) : parseGpxDocument(doc);
    summary = summarize(gpx);
  } catch (e) {
    const known = e instanceof GpxError || e instanceof KmlError;
    showError(known ? e.message : t('error.unexpected', { detail: e.message }));
    return;
  }

  // Worked out once: the summary box and the profile read the same numbers, and neither recomputes on a
  // language switch.
  const elevations = summary.elevation ? readElevations(gpx) : null;
  // Read before the profile is drawn, not inside drawGpx: the profile hides its waypoint dots on this state,
  // and it is built first -- drawGpx needs the panel's height to frame the route under it.
  pinsShown = savedPins();
  renderInfo(gpx, summary, elevations);
  // Drawn before the map: the fit below needs to know whether the panel is there, and the panel's own height
  // is fixed in CSS, so the map never has to be told its size changed.
  const profile = elevations ? renderProfile(gpx, elevations) : null;

  const map = L.map('map', { keyboard: false, worldCopyJump: false });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank">Leaflet</a>');
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

  // A held Alt turns the wheel into half a level per notch, for putting a switchback under the pointer rather
  // than somewhere in a view that just doubled. Leaflet settles the wheel pixels 40 ms after the last event
  // and reads both options then, so switching them from a capture listener -- which runs before its own
  // handler on the same element -- is enough; none of its wheel logic is replaced. Both are needed: zoomSnap
  // alone changes nothing, because the pixel count is divided by wheelPxPerZoomLevel before it is rounded up.
  // Pixels collected under the other step are dropped on the switch, or half a notch would be re-read at the
  // new scale. The step goes back afterwards, so a map left at 0.5 does not let the + / - buttons -- which
  // still move a whole level -- stop between levels.
  let fineWheel = false;
  let fineTimer = 0;
  const wheelStep = (fine) => {
    map.options.zoomSnap = fine ? 0.5 : 1;
    map.options.wheelPxPerZoomLevel = fine ? 120 : 60;
  };
  map.getContainer().addEventListener('wheel', (event) => {
    if (event.altKey !== fineWheel) {
      fineWheel = event.altKey;
      wheelStep(fineWheel);
      const wheel = map.scrollWheelZoom;
      if (wheel) {
        clearTimeout(wheel._timer); // a pending settle would be worked out at the wrong step
        wheel._timer = null;
        wheel._startTime = null;
        wheel._delta = 0;
      }
    }
    clearTimeout(fineTimer);
    fineTimer = setTimeout(() => { fineWheel = false; wheelStep(false); }, 300);
  }, { capture: true });

  map.setView([20, 0], 2); // a view first: layers added to a map without one are queued, which is very slow
  const bounds = drawGpx(map, gpx);
  // The view the file opens with is also the one the locate button and C come back to, so it is written once.
  // The profile floats over the bottom of the map, so the route is centred in what is left rather than under
  // the panel. Without one, all four sides get the same margin. In a portrait window the summary runs the full
  // width and the controls take a line beneath it, so the top has to clear both -- measured, because the card
  // grows with the file name. With the interface away (S) neither panel is laid out: its rect would be empty
  // and its height still reserved, so the plain margin is used instead.
  fitRoute = () => {
    if (!bounds.isValid()) return;
    const card = chromeHidden ? null : document.getElementById('info').getBoundingClientRect();
    const topInset = card && isPortrait() ? Math.round(card.bottom) + 46 : 40;
    // Measured, not the old 150: the profile is as tall as the route it draws, and a fixed margin would put
    // the last metres of a mountain walk behind the panel.
    const bottomInset = !chromeHidden && profile
      ? Math.round(document.getElementById('profile').getBoundingClientRect().height) + 20
      : 40;
    map.fitBounds(bounds, {
      paddingTopLeft: [40, topInset],
      paddingBottomRight: [40, bottomInset],
      maxZoom: 16,
    });
  };
  fitRoute();
  // The zoom buttons stand against the right edge of the summary instead of in the far corner. The card is as
  // wide as its longest line, so its edge is measured rather than guessed, and measured again whenever the text
  // changes -- a language switch and a new file name both move it. When even a measured card leaves no room for
  // the corner switches beside it, the controls step down to a line under it instead (body.stepped, see the
  // portrait block in style.css); with room, they stay in the top band, where the eye already is.
  const zoomWrap = map.zoomControl?.getContainer().closest('.leaflet-top.leaflet-left');
  if (zoomWrap) {
    const place = () => {
      const card = document.getElementById('info').getBoundingClientRect();
      const row = document.querySelector('#map .leaflet-top.leaflet-right');
      const rowWidth = row ? row.getBoundingClientRect().width : 0;
      // 10 px each side of the band, 8 between card and zoom, 12 between zoom and the switches.
      const roomy = card.right + 8 + map.zoomControl.getContainer().offsetWidth + 12 + rowWidth <= innerWidth - 10;
      document.body.classList.toggle('stepped', !roomy);
      document.documentElement.style.setProperty('--zoom-left', `${Math.round(card.right + 8)}px`);
      document.documentElement.style.setProperty('--tools-top', `${Math.round(card.bottom)}px`);
    };
    place();
    placeZoom = place;
    new ResizeObserver(place).observe(document.getElementById('info'));
    let pending = 0;
    addEventListener('resize', () => {
      if (pending) return;
      pending = requestAnimationFrame(() => { pending = 0; place(); });
    });
  }

  // First of the corner controls, so it stands leftmost: "where the map looks" before "what the map shows".
  const locateCtrl = locateControl(map);
  const switcher = layerSwitcher(map); // after the view is set: the grid needs the map bounds
  layerSwitch = switcher;
  // A file that draws no dots and has no waypoints gets no switch: there is nothing for it to show or hide.
  pinControl = pinLayer.getLayers().length > 0 ? pinsControl(map) : null;
  const langControl = languageControl(map);
  placeZoom?.(); // the switches exist only now, and their width decides whether everything fits up top
  const scrub = profile ? attachScrub(map, profile) : null;
  document.addEventListener('keydown', onKeyDown);

  // A language switch repaints the page where it stands: same map, same view, same selection. Everything
  // that is generated from that state is rebuilt from the same values, so nothing has to be reparsed.
  onLangChange(() => {
    applyPageLanguage();
    renderInfo(gpx, summary, elevations);
    switcher.relabel();
    locateCtrl.relabel();
    pinControl?.relabel();
    langControl.relabel();
    repaintLocalized();
    if (scrub?.point()) scrub.refresh();
    // Popup content is built on open, so the open one is closed and opened again to be typed in the new
    // language; the pin stays selected and the card lands where it already was.
    const open = stops.find((stop) => stop.marker.isPopupOpen());
    if (open) {
      open.marker.closePopup();
      open.marker.openPopup();
    }
    photoViewer.relabel();
    // The switch labels grew or shrank with the language, so whether the corner still holds them is a new
    // question -- and the card may not have changed width at all, leaving the observer silent.
    requestAnimationFrame(() => placeZoom?.());
  });

  window.gpxViewer = {
    gpx, summary, map, scrub, photos: photoViewer,
    // The worked-out route shape, without the point arrays a test does not need.
    profile: elevations && {
      min: elevations.min, max: elevations.max, total: elevations.total,
      ascent: elevations.ascent, descent: elevations.descent, runs: elevations.runs,
      steep: elevations.steep,
    },
    nav: { select: selectStop, index: () => stopIndex, stops: () => stops, photoStops: () => photoStops },
    pins: {
      show: () => pinControl?.show(), hide: () => pinControl?.hide(),
      visible: () => pinsShown, hasControl: () => pinControl !== null,
      count: () => pinLayer?.getLayers().length || 0,
    },
    selectLayer: (key) => switcher.select(key, true), layer: switcher.current,
    // The frame the file opened with, for a test that wants it without walking the layers.
    locate: () => fitRoute?.(),
    // For the host: it owns the keys until the page gets the keyboard (see GpxPanel).
    pressKey,
  };
  document.body.classList.add('loaded');
  post(`ready\t${summary.points} points, ${distanceLog(summary.distanceMeters)}`);
}

main().catch((e) => showError(`Unexpected error: ${e.message}`));
