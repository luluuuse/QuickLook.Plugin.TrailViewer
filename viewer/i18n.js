// Interface language. Every word the viewer writes for the user comes from here, so a switch is one flag:
// the page re-renders its own text and the map keeps its view.
//
// The first choice follows the system language (WebView2 reports it through navigator.language); after that
// the user's own choice is remembered. Storage is per origin and the plugin puts its version into the host
// name, so an upgrade starts over from the system language once - which is the safe direction.

import { readStored, writeStored } from './storage.js';

const STORAGE_KEY = 'lang';
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
    'info.movingSpeed': 'Moving avg',
    'info.totalTime': 'Total time',
    'info.movingTime': 'Moving time',
    'info.movingTimeMetadata': 'Measured from the pause total recorded in the file',
    'info.movingTimeEstimated': 'Estimated from movement speed because the file has no pause total',
    'info.totalTimeHint': (v) => [
      `Moving time: ${v.moving}`,
      `Grade-aware estimate: ${v.estimate}`,
      'Method: Naismith base + Langmuir descents + steep-uphill correction',
    ].join('\n'),
    'info.breaks': 'Data gaps',
    'info.breaksValue': (v) => `${v.count} \u00b7 ${v.distance}`,
    'info.breaksRaw': (v) => `${v.count} raw GPS break events`,
    'info.anomalies': 'Speed anomalies',
    'info.anomaliesValue': (v) => `${v.count} \u00b7 ${v.distance}`,
    'info.anomaliesRaw': (v) => `${v.count} raw speed or position jumps`,
    'info.trackAnomalies': 'Track anomalies',
    'info.more': 'More',
    'info.less': 'Less',
    'info.moreTitle': 'Show full route details',
    'info.lessTitle': 'Show only basic route details',
    'info.fileHint': (v) => `File: ${v.name}`,
    'map.gapHint': (v) => `${v.count} data-gap event${v.count === 1 ? '' : 's'} \u00b7 ${v.distance} missing \u00b7 click to zoom`,
    'map.anomalyHint': (v) => `GPS anomaly band \u00b7 ${v.count} abnormal interval${v.count === 1 ? '' : 's'} \u00b7 ${v.distance} affected \u00b7 click to zoom`,
    'info.ascentHint': (v) => `GPS noise filtered: ${v.filtered} shown, ${v.raw} in the raw readings`,
    'info.ascent': 'Ascent',
    'info.descent': 'Descent',
    'info.contents': 'Contents',
    'info.photos': 'Photos',
    'info.empty': 'No tracks, routes, areas or waypoints in this file.',
    'info.photosValue': (v) => `${v.photos} on ${v.pins}`,

    // The exported picture: the two words inside the start and end badges are one character each.
    'export.title': 'Export the track as a transparent picture (X). Shape, ink and backing: Shift+X',
    'export.start': 'S',
    'export.end': 'E',
    'export.maxEle': 'Max elevation',
    'export.suffix': 'track',
    'export.panel': 'Export overlay',
    'export.size': 'Shape',
    'export.sizeSquare': 'Square',
    'export.sizePortrait': 'Portrait',
    'export.sizeLandscape': 'Wide',
    'export.ink': 'Ink',
    'export.inkBlack': 'Black',
    'export.inkWhite': 'White',
    'export.scrim': 'Backing',
    'export.scrimNone': 'None',
    'export.scrimSoft': 'Soft',
    'export.go': 'Export',
    'export.empty': 'This file has no track to draw',
    'export.done': 'Saved {name}',
    'export.failed': 'Could not save the overlay ({detail})',

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

    'layer.road': 'Road',
    'layer.shortRoad': 'R',
    'layer.terrain': 'Terrain',
    'layer.shortTerrain': 'T',
    'layer.satellite': 'Satellite',
    'layer.shortSatellite': 'S',
    'layer.none': 'No map',
    'layer.shortNone': 'N',
    'layer.osm': 'OpenStreetMap HOT',
    'layer.cyclosm': 'CyclOSM',
    'layer.openHiking': 'OpenHikingMap',
    'layer.openTopo': 'OpenTopoMap',
    'layer.esri': 'Esri World Imagery',
    'layer.tiandituRoad': 'Tianditu road',
    'layer.tiandituSatellite': 'Tianditu satellite',
    'layer.configureTiandituKey': 'Configure Tianditu key…',
    'layer.changeTiandituKey': 'Change Tianditu key…',
    'layer.removeTiandituKey': 'Remove saved key',
    'layer.tiandituUnavailable': 'Tianditu is temporarily unavailable. The saved key is kept; retrying…',
    'layer.tiandituRejected': 'Tianditu rejected the key or domain. Check the key and domain restrictions.',
    'layer.tiandituHostOnly': 'Tianditu is available in QuickLook preview. A browser needs the TrailViewer host.',
    'layer.menuTitle': 'Map layers',
    'layer.settingsTitle': 'Map settings',
    'layer.openSettings': 'Open map settings',
    'layer.backToLayers': 'Back to map layers',
    'layer.closeMenu': 'Close map layers',
    'layer.keyHeading': 'Tianditu key',
    'layer.keyConfigured': 'Configured and encrypted with Windows DPAPI',
    'layer.keyMissing': 'Not configured',
    'layer.keyScope': 'The Tianditu road and satellite maps share this key.',
    'layer.typeHeading': 'Map type',
    'layer.sourceHeading': 'Map source',
    'layer.noMapHint': 'Only the coordinate grid is shown; no map tiles are downloaded.',
    'layer.chooseSource': 'Choose map source',
    'layer.roadTitle': 'Road map -- Q / E switch category',
    'layer.terrainTitle': 'Terrain maps: CyclOSM contours and trails, OpenHikingMap or OpenTopoMap -- Q / E switch category',
    'layer.satelliteTitle': 'Satellite map: Esri World Imagery -- Q / E switch category',
    'layer.noneTitle': 'Grid only: no map tiles are downloaded -- Q / E switch',

    'pins.label': 'Markers',
    'pins.showTitle': 'Show markers and anomaly labels (W)',
    'pins.hideTitle': 'Hide markers and anomaly labels (W)',
    'overview.label': 'List',
    'overview.openTitle': 'Open the waypoint overview',
    'overview.title': 'Waypoint overview',
    'overview.current': 'Current selection',
    'overview.close': 'Close the waypoint overview',
    'overview.all': 'All',
    'overview.important': 'Important',
    'overview.evidence': 'Detected',
    'overview.mediumConfidence': 'Possible match from the description',
    'overview.empty': 'No waypoints match this filter.',
    'overview.filter': 'Filter',
    'overview.filterTitle': 'Filter waypoints',
    'overview.merged': (v) => `${v.count} nearby points merged`,
    'overview.correct': 'Correct label',
    'overview.auto': 'Automatic',
    'overview.clear': 'Clear labels',
    'overview.manualEvidence': 'Set manually',
    'insight.danger': 'Danger',
    'insight.water': 'Water',
    'insight.camp': 'Camp',
    'insight.rescue': 'Rescue',
    'insight.exit': 'Bailout',
    'insight.supply': 'Supply',
    'insight.crossing': 'Crossing',
    'insight.junction': 'Junction',
    'insight.summit': 'Summit / pass',
    'insight.access': 'Access',
    'insight.viewpoint': 'Viewpoint',

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
    'info.movingSpeed': '运动均速',
    'info.totalTime': '总用时',
    'info.movingTime': '运动时间',
    'info.movingTimeMetadata': '来自文件中记录的暂停总时长',
    'info.movingTimeEstimated': '文件没有暂停总时长，按移动速度估算',
    'info.totalTimeHint': (v) => [
      `运动时间：${v.moving}`,
      `坡度修正估算：${v.estimate}`,
      '方法：Naismith 基础 + Langmuir 下坡修正 + 陡上坡修正',
    ].join('\n'),
    'info.breaks': '数据缺口',
    'info.breaksValue': (v) => `${v.count} 处 · ${v.distance}`,
    'info.breaksRaw': (v) => `${v.count} 个原始 GPS 断点`,
    'info.anomalies': '速度异常',
    'info.anomaliesValue': (v) => `${v.count} 处 · ${v.distance}`,
    'info.anomaliesRaw': (v) => `${v.count} 个原始速度或位置跳点`,
    'info.trackAnomalies': '轨迹异常',
    'info.more': '更多',
    'info.less': '收起',
    'info.moreTitle': '显示完整路线信息',
    'info.lessTitle': '仅显示基础路线信息',
    'info.fileHint': (v) => `文件：${v.name}`,
    'map.gapHint': (v) => `${v.count} 个数据缺口 · 缺失 ${v.distance} · 点击放大`,
    'map.anomalyHint': (v) => `GPS 异常带 · ${v.count} 个异常采样区间 · 影响 ${v.distance} · 点击放大`,
    'info.ascentHint': (v) => `已过滤 GPS 噪声：显示 ${v.filtered}，原始读数 ${v.raw}`,
    'info.ascent': '上升',
    'info.descent': '下降',
    'info.contents': '内容',
    'info.photos': '照片',
    'info.empty': '文件中没有轨迹、路线、区域或标记点。',
    'info.photosValue': (v) => `${v.photos}，分布在 ${v.pins}`,

    'export.title': '把轨迹导出为透明图片（X）；版式、墨色与底衬在 ⇧X 面板里',
    'export.start': '起',
    'export.end': '终',
    'export.maxEle': '最高海拔',
    'export.suffix': '轨迹',
    'export.panel': '导出叠加图',
    'export.size': '版式',
    'export.sizeSquare': '方版',
    'export.sizePortrait': '竖版',
    'export.sizeLandscape': '横版',
    'export.ink': '墨色',
    'export.inkBlack': '黑',
    'export.inkWhite': '白',
    'export.scrim': '底衬',
    'export.scrimNone': '无',
    'export.scrimSoft': '淡',
    'export.go': '导出',
    'export.empty': '这个文件里没有可画的轨迹',
    'export.done': '已导出 {name}',
    'export.failed': '导出失败（{detail}）',

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

    'layer.road': '路网',
    'layer.shortRoad': '路',
    'layer.terrain': '地形',
    'layer.shortTerrain': '地',
    'layer.satellite': '卫星',
    'layer.shortSatellite': '卫',
    'layer.none': '无底图',
    'layer.shortNone': '无',
    'layer.osm': 'OpenStreetMap',
    'layer.cyclosm': 'CyclOSM',
    'layer.openHiking': 'OpenHikingMap',
    'layer.openTopo': 'OpenTopoMap',
    'layer.esri': 'Esri World Imagery',
    'layer.tiandituRoad': '天地图路网图',
    'layer.tiandituSatellite': '天地图卫星图',
    'layer.configureTiandituKey': '配置天地图密钥…',
    'layer.changeTiandituKey': '更换天地图密钥…',
    'layer.removeTiandituKey': '移除已保存密钥',
    'layer.tiandituUnavailable': '天地图暂时无法加载，已保留保存的密钥，正在重试…',
    'layer.tiandituRejected': '天地图拒绝了该密钥或域名，请检查密钥和域名白名单。',
    'layer.tiandituHostOnly': '天地图需在 QuickLook 预览中使用，普通浏览器没有 TrailViewer 宿主。',
    'layer.menuTitle': '地图图层',
    'layer.settingsTitle': '地图设置',
    'layer.openSettings': '打开地图设置',
    'layer.backToLayers': '返回地图图层',
    'layer.closeMenu': '关闭地图图层面板',
    'layer.keyHeading': '天地图密钥',
    'layer.keyConfigured': '已配置，使用 Windows 凭据加密',
    'layer.keyMissing': '尚未配置',
    'layer.keyScope': '天地图路网和卫星图共用此密钥。',
    'layer.typeHeading': '地图类型',
    'layer.sourceHeading': '地图图源',
    'layer.noMapHint': '仅显示坐标网格，不下载地图瓦片。',
    'layer.chooseSource': '选择地图图源',
    'layer.roadTitle': '路网图，Q / E 切换类别',
    'layer.terrainTitle': '地形图：CyclOSM 等高线与步道、OpenHikingMap 或 OpenTopoMap，Q / E 切换类别',
    'layer.satelliteTitle': '卫星图：Esri World Imagery，Q / E 切换类别',
    'layer.noneTitle': '仅显示网格，不下载地图瓦片，Q / E 切换',

    'pins.label': '标记点',
    'pins.showTitle': '显示标记点与异常标记（W）',
    'pins.hideTitle': '隐藏标记点与异常标记（W）',
    'overview.label': '列表',
    'overview.openTitle': '打开标记点速览',
    'overview.title': '标记点速览',
    'overview.current': '当前选中',
    'overview.close': '关闭标记点速览',
    'overview.all': '全部',
    'overview.important': '重要',
    'overview.evidence': '识别',
    'overview.mediumConfidence': '根据描述判断的可能类别',
    'overview.empty': '没有符合此筛选的标记点。',
    'overview.filter': '筛选',
    'overview.filterTitle': '筛选标记点',
    'overview.merged': (v) => `已合并附近 ${v.count} 个点`,
    'overview.correct': '纠正分类',
    'overview.auto': '自动识别',
    'overview.clear': '清除标签',
    'overview.manualEvidence': '人工设置',
    'insight.danger': '危险',
    'insight.water': '水源',
    'insight.camp': '营地',
    'insight.rescue': '救援',
    'insight.exit': '下撤',
    'insight.supply': '补给',
    'insight.crossing': '过河',
    'insight.junction': '岔路',
    'insight.summit': '山顶/垭口',
    'insight.access': '入口',
    'insight.viewpoint': '观景',

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
  // The host passes its durable preference in the URL because localStorage is per origin, and the viewer
  // origin changes with every release.
  try {
    const fromHost = new URLSearchParams(location.search).get('lang');
    if (LANGS.includes(fromHost)) return fromHost;
  } catch {
    // Keep the normal detection below.
  }
  const saved = readStored(STORAGE_KEY);
  if (LANGS.includes(saved)) return saved;
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
  writeStored(STORAGE_KEY, next);
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
