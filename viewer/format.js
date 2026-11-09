import { getLang, t } from './i18n.js';

const LOCALES = { en: 'en-US', zh: 'zh-CN' };

export const formatters = (() => {
  const cache = new Map();
  return () => {
    const locale = LOCALES[getLang()];
    let set = cache.get(locale);
    if (!set) {
      set = {
        date: new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }),
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

export function formatRange(start, end) {
  if (!start) return null;
  const { date: dateFormat, time: timeFormat } = formatters();
  if (sameDay(start, end)) {
    return `${dateFormat.format(start)}, ${timeFormat.format(start)} \u2013 ${timeFormat.format(end)}`;
  }
  return `${dateFormat.format(start)} ${timeFormat.format(start)} \u2013 ${dateFormat.format(end)} ${timeFormat.format(end)}`;
}

export function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} ${t('unit.m')}`;
  return `${(meters / 1000).toFixed(meters < 100000 ? 2 : 1)} ${t('unit.km')}`;
}

export function formatSpeed(metersPerSecond) {
  return `${(metersPerSecond * 3.6).toFixed(1)} ${t('unit.kmh')}`;
}

export function formatElevation(meters) {
  if (meters === null || meters === undefined) return '\u2014';
  return `${Math.round(meters).toLocaleString()} ${t('unit.m')}`;
}

export function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const trailingSeconds = seconds % 60;
  const unit = (value, key) => `${value} ${t(key)}`;
  if (hours >= 24) {
    return `${unit(Math.floor(hours / 24), 'unit.day')} ${unit(hours % 24, 'unit.hour')} ${unit(minutes, 'unit.minute')}`;
  }
  if (hours > 0) return `${unit(hours, 'unit.hour')} ${unit(minutes, 'unit.minute')}`;
  return minutes > 0
    ? `${unit(minutes, 'unit.minute')} ${unit(trailingSeconds, 'unit.second')}`
    : unit(trailingSeconds, 'unit.second');
}

export function formatCoord(point) {
  return `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`;
}

/** "8.16 公里" as a number and a unit, so export can set them at two sizes on one baseline. */
export function splitUnit(text) {
  const gap = text.lastIndexOf(' ');
  return gap < 0 ? { value: text, unit: '' } : { value: text.slice(0, gap), unit: text.slice(gap + 1) };
}

export function clock(seconds) {
  const pad = (number) => String(number).padStart(2, '0');
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${pad(hours)}:${pad(minutes)}:${pad(Math.floor(seconds % 60))}`;
}
