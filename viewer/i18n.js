// Interface language. Every word the viewer writes for the user comes from here, so a switch is one flag:
// the page re-renders its own text and the map keeps its view.
//
// The first choice follows the system language (WebView2 reports it through navigator.language); after that
// the user's own choice is remembered. Storage is per origin and the plugin puts its version into the host
// name, so an upgrade starts over from the system language once - which is the safe direction.

const STORAGE_KEY = 'gpxviewer.lang';
export const LANGS = ['en', 'zh'];

/** A value is either a string with {placeholders} or a function taking the same values. */
const DICT = {
  en: {
    'page.title': 'Track viewer',
    'file.untitled': 'track file',

    'error.title': 'Cannot show this file',
    'error.noFile': 'No file given (?src= is missing).',
    'error.read': 'Could not read the file ({detail}).',
    'error.unexpected': 'Unexpected error: {detail}',
    'error.notTrack': 'The file is neither a GPX nor a KML document.',
    'error.notGpx': 'The file is not a GPX document.',
    'error.notKml': 'The file is not a KML document.',
    'error.notXml': (v) => (v.detail ? `The file is not valid XML: ${v.detail}` : 'The file is not valid XML.'),

    'info.date': 'Date',
    'info.points': 'Points',
    'info.distance': 'Distance',
    'info.routeLength': 'Route length',
    'info.time': 'Time',
    'info.speed': 'Avg speed',
    'info.ascent': 'Ascent',
    'info.descent': 'Descent',
    'info.contents': 'Contents',
    'info.photos': 'Photos',
    'info.empty': 'No tracks, routes, areas or waypoints in this file.',
    'info.photosValue': (v) => `${v.photos} on ${v.pins}`,

    // The bar above the map: the key caps are drawn next to these labels, so they stay short.
    'keys.nav': 'switch markers',
    'keys.pin': 'markers',
    'keys.layer': 'background',
    'keys.locate': 'fit',
    'keys.chrome': 'interface',

    'locate.title': 'Fit the whole track in view (C)',

    'point.elevation': (v) => `${v.elevation} ${v.unit} elevation`,
    'point.segment': (v) => `${v.name} (segment ${v.segment})`,

    'photo.openIndexed': (v) => `Open photo ${v.index} of ${v.count}`,
    'photo.openSingle': 'Open at full size',
    'photo.hintMany': (v) => `Click a photo to open it full size \u00b7 ${v.count} photos`,
    'photo.hintOne': 'Click the photo to open it full size',
    'photo.close': 'Close (click anywhere)',
    'photo.previous': 'Previous photo',
    'photo.next': 'Next photo',
    'photo.loading': 'Loading photo\u2026',
    'photo.failed': 'This photo could not be loaded.',

    'chrome.hint': 'Press S to bring the interface back',

    'profile.title': 'Elevation',
    // How much the drawing is stretched vertically. Shown only when the route forces it out of the band where
    // a slope reads as a slope.
    'profile.scale': 'Vertical ×{n}',
    // The highest and lowest point of the route, labelled on the drawing where they were reached.
    'profile.high': 'Highest point',
    'profile.low': 'Lowest point',
    // The colour scale runs from level ground to a 25 % wall, and stops there whatever the file contains.
    'profile.scaleHint': 'Gradient, saturated at 25 %',
    // Two numbers rather than five categories: how much of the route is steep, and the worst gradient on it.
    'grade.steep': 'Steep',
    'grade.noSteep': 'No steep ground',
    'grade.steepest': 'max',
    'grade.steepHint': 'Ground at 10 % or steeper: how much of the route, and the worst gradient on it',

    'layer.map': 'Map',
    'layer.terrain': 'Terrain',
    'layer.satellite': 'Satellite',
    'layer.none': 'No map',
    'layer.mapTitle': 'OpenStreetMap (Humanitarian style)',
    'layer.terrainTitle': 'Terrain map with contours, trails and spot heights (CyclOSM)',
    'layer.satelliteTitle': 'Esri World Imagery',
    'layer.noneTitle': 'Grid only: no map tiles are downloaded',

    'pins.label': 'Markers',
    'pins.showTitle': 'Show the markers',
    'pins.hideTitle': 'Hide the markers',

    'switch.title': 'Switch to Chinese',

    'unit.m': 'm',
    'unit.km': 'km',
    'unit.kmh': 'km/h',
    'unit.day': 'd',
    'unit.hour': 'h',
    'unit.minute': 'min',
    'unit.second': 's',

    'label.waypoint': 'Waypoint',
    'label.photo': 'Photo',
    'label.start': 'Start',
    'label.end': 'End',
    'list.separator': ', ',
    'list.segments': (v) => ` (${v.count})`,
  },

  zh: {
    'page.title': '轨迹预览',
    'file.untitled': '轨迹文件',

    'error.title': '无法显示此文件',
    'error.noFile': '未指定文件（缺少 ?src= 参数）。',
    'error.read': '无法读取文件（{detail}）。',
    'error.unexpected': '意外错误：{detail}',
    'error.notTrack': '该文件既不是 GPX 也不是 KML。',
    'error.notGpx': '该文件不是 GPX 文档。',
    'error.notKml': '该文件不是 KML 文档。',
    'error.notXml': (v) => (v.detail ? `文件不是合法的 XML：${v.detail}` : '文件不是合法的 XML。'),

    'info.date': '日期',
    'info.points': '点数',
    'info.distance': '里程',
    'info.routeLength': '路线长度',
    'info.time': '用时',
    'info.speed': '均速',
    'info.ascent': '上升',
    'info.descent': '下降',
    'info.contents': '内容',
    'info.photos': '照片',
    'info.empty': '文件中没有轨迹、路线、区域或标记点。',
    'info.photosValue': (v) => `${v.photos}，分布在 ${v.pins}`,

    'keys.nav': '切换标记点',
    'keys.pin': '标记点',
    'keys.layer': '切换底图',
    'keys.locate': '全览',
    'keys.chrome': '界面',

    'locate.title': '回到整条轨迹（C）',

    'point.elevation': (v) => `海拔 ${v.elevation} ${v.unit}`,
    'point.segment': (v) => `${v.name}（第 ${v.segment} 段）`,

    'photo.openIndexed': (v) => `打开第 ${v.index}/${v.count} 张`,
    'photo.openSingle': '查看原图',
    'photo.hintMany': (v) => `点击图片查看原图 \u00b7 共 ${v.count} 张`,
    'photo.hintOne': '点击图片查看原图',
    'photo.close': '关闭（点击空白处亦可）',
    'photo.previous': '上一张',
    'photo.next': '下一张',
    'photo.loading': '正在加载图片\u2026',
    'photo.failed': '图片加载失败。',

    'chrome.hint': '按 S 显示界面',

    'profile.title': '海拔',
    'profile.scale': '垂直夸大 ×{n}',
    'profile.high': '最高点',
    'profile.low': '最低点',
    'profile.scaleHint': '坡度色阶，25 % 封顶',
    'grade.steep': '陡坡',
    'grade.noSteep': '无陡坡',
    'grade.steepest': '最陡',
    'grade.steepHint': '坡度 ≥ 10 % 的路段：占多长，以及全线最陡的坡度',

    'layer.map': '地图',
    'layer.terrain': '地形',
    'layer.satellite': '卫星',
    'layer.none': '无底图',
    'layer.mapTitle': 'OpenStreetMap（人道主义风格）',
    'layer.terrainTitle': '地形图，有等高线、步道和山峰高程（CyclOSM）',
    'layer.satelliteTitle': 'Esri World Imagery',
    'layer.noneTitle': '仅显示网格，不下载地图瓦片',

    'pins.label': '标记点',
    'pins.showTitle': '显示标记点',
    'pins.hideTitle': '隐藏标记点',

    'switch.title': 'Switch to English',

    // Units stay in their international form in both languages: "16.81 km" is read at a glance, "16.81 公里"
    // is a sentence. Everything else on the page is translated; a measurement is not a word.
    'unit.m': 'm',
    'unit.km': 'km',
    'unit.kmh': 'km/h',
    'unit.day': 'd',
    'unit.hour': 'h',
    'unit.minute': 'min',
    'unit.second': 's',

    'label.waypoint': '标记点',
    'label.photo': '照片',
    'label.start': '起点',
    'label.end': '终点',
    'list.separator': '、',
    'list.segments': (v) => `（${v.count}）`,
  },
};

// English counts as the fallback for anything a translation forgets, so a missing key never shows up raw.
const COUNTS = {
  en: {
    track: ['track', 'tracks'], segment: ['segment', 'segments'], route: ['route', 'routes'],
    area: ['area', 'areas'], waypoint: ['waypoint', 'waypoints'], photo: ['photo', 'photos'],
    pin: ['pin', 'pins'],
  },
  zh: {
    track: ['条轨迹', '条轨迹'], segment: ['段', '段'], route: ['条路线', '条路线'],
    area: ['个区域', '个区域'], waypoint: ['个标记点', '个标记点'], photo: ['张照片', '张照片'],
    pin: ['个标记点', '个标记点'],
  },
};

function detect() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (LANGS.includes(saved)) return saved;
  } catch {
    // Private mode or storage disabled: the system language decides.
  }
  for (const tag of navigator.languages || [navigator.language || '']) {
    if (typeof tag === 'string' && tag.toLowerCase().startsWith('zh')) return 'zh';
  }
  return 'en';
}

let lang = detect();
const listeners = new Set();

export const getLang = () => lang;
export const isChinese = () => lang === 'zh';

/** The label for the switch button: it shows where you are, the tooltip says where the click goes. */
export const langLabel = () => (lang === 'zh' ? '中' : 'EN');

/** True when the click would change the language, i.e. the pair this build actually ships. */
export const otherLang = () => (lang === 'zh' ? 'en' : 'zh');

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return false;
  lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not remembered, still applied for this preview.
  }
  for (const fn of listeners) fn(lang);
  return true;
}

export const toggleLang = () => setLang(otherLang());

/** Looks the text up; a function value gets the values, a string has {placeholders} filled in. */
export function t(key, values) {
  const table = DICT[lang] || DICT.en;
  const entry = table[key] ?? DICT.en[key];
  if (entry === undefined) return key;
  if (typeof entry === 'function') return entry(values || {});
  if (!values) return entry;
  return entry.replace(/\{(\w+)\}/g, (whole, name) => (name in values ? String(values[name]) : whole));
}

/** "3 photos" / "3 张照片" - the plural lives in the dictionary, not in a suffix rule. */
export function units(n, kind) {
  const pair = (COUNTS[lang] || COUNTS.en)[kind] || COUNTS.en[kind] || [kind, kind];
  return `${n.toLocaleString()} ${pair[n === 1 ? 0 : 1]}`;
}
