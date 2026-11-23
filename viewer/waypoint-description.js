// Cleans app-generated coordinate, elevation and timestamp boilerplate from waypoint descriptions while
// preserving user-written notes and backfilling missing waypoint timestamps when embedded in the template.

const CJK_LOOKAHEAD = '(?:经度|东经|西经|纬度|北纬|南纬|海拔|高程|高度|记录时间|创建时间|时间|日期|速度|精度|方向|方位|航向)\\s*[:：]';
const TRAILING_BOUNDARY = `(?=$|[\\s,;，；、|·/。]|${CJK_LOOKAHEAD})`;

const COORDS_NUM = '[+-]?\\d{1,3}(?:\\.\\d+)?(?:\\s*°)?(?:\\s*[NSEW])?';
const ELEVATION_NUM = '[+-]?\\d+(?:\\.\\d+)?(?:\\s*(?:meters?|m|米|ft|feet))?';

const TELEMETRY_TOKEN_RE = new RegExp(
  '(?:'
  + `(?:坐标|经纬度|(?<![A-Za-z0-9_])(?:coordinates?|coords?))\\s*[:：]\\s*(?<coords>${COORDS_NUM}\\s*[,，]\\s*${COORDS_NUM}(?:\\s*[,，]\\s*${ELEVATION_NUM})?)`
  + `|(?:经度|东经|西经|(?<![A-Za-z0-9_])(?:longtitude|longitude|lon|lng))\\s*[:：]\\s*(?<lon>[+-]?\\d{1,3}(?:\\.\\d+)?(?:\\s*°)?(?:\\s*[EW])?)`
  + `|(?:纬度|北纬|南纬|(?<![A-Za-z0-9_])(?:latitude|lat))\\s*[:：]\\s*(?<lat>[+-]?\\d{1,2}(?:\\.\\d+)?(?:\\s*°)?(?:\\s*[NS])?)`
  + `|(?:海拔|高程|高度|(?<![A-Za-z0-9_])(?:altitude|elevation|alt|ele))\\s*[:：]\\s*(?<ele>${ELEVATION_NUM})`
  + '|(?:记录时间|创建时间|时间|日期|(?<![A-Za-z0-9_])(?:timestamp|datetime|time|date))\\s*[:：]\\s*(?<time>\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}(?:[T ]\\d{1,2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:?\\d{2})?)?)'
  + '|(?:速度|精度|方向|方位|航向|(?<![A-Za-z0-9_])(?:speed|accuracy|bearing|heading|course))\\s*[:：]\\s*(?<extra>[+-]?\\d+(?:\\.\\d+)?(?:\\s*(?:km\\/h|m\\/s|mph|meters?|m|米|ft|°))?)'
  + `)${TRAILING_BOUNDARY}`,
  'gi',
);

const DATE_PARTS_RE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[Tt ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?([Zz]|[+-]\d{2}:?\d{2})?)?$/;

/** @returns {{ valid: boolean, date: Date | undefined }} */
function parseTelemetryDate(raw) {
  const m = DATE_PARTS_RE.exec(raw.trim());
  if (!m) return { valid: false, date: undefined };

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return { valid: false, date: undefined };
  }
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarCheck.getUTCFullYear() !== year
    || calendarCheck.getUTCMonth() !== month - 1
    || calendarCheck.getUTCDate() !== day
  ) {
    return { valid: false, date: undefined };
  }

  if (m[4] === undefined) {
    return { valid: true, date: undefined };
  }

  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] !== undefined ? Number(m[6]) : 0;
  const ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, '0')) : 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return { valid: false, date: undefined };
  }

  const tz = m[8];
  if (tz) {
    const normalizedTz = tz.toUpperCase() === 'Z'
      ? 'Z'
      : (tz.includes(':') ? tz : `${tz.slice(0, 3)}:${tz.slice(3)}`);
    const iso = `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      + `T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
      + `${ms ? `.${String(ms).padStart(3, '0')}` : ''}${normalizedTz}`;
    const parsed = Date.parse(iso);
    if (!Number.isFinite(parsed)) return { valid: false, date: undefined };
    return { valid: true, date: new Date(parsed) };
  }

  const local = new Date(year, month - 1, day, hour, minute, second, ms);
  if (
    local.getFullYear() !== year
    || local.getMonth() !== month - 1
    || local.getDate() !== day
    || local.getHours() !== hour
    || local.getMinutes() !== minute
    || local.getSeconds() !== second
  ) {
    return { valid: false, date: undefined };
  }
  return { valid: true, date: local };
}

function isValidCoordsPair(value) {
  const parts = value.split(/[,，]/);
  if (parts.length < 2) return false;
  const a = Number.parseFloat(parts[0].trim());
  const b = Number.parseFloat(parts[1].trim());
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return (Math.abs(a) <= 90 && Math.abs(b) <= 180) || (Math.abs(a) <= 180 && Math.abs(b) <= 90);
}

/** @returns {{ kind: string, date: Date | undefined } | null} */
function validateToken(groups) {
  if (!groups) return null;
  if (groups.coords !== undefined) {
    return isValidCoordsPair(groups.coords) ? { kind: 'coords', date: undefined } : null;
  }
  if (groups.lon !== undefined) {
    const lon = Number.parseFloat(groups.lon);
    return Number.isFinite(lon) && Math.abs(lon) <= 180 ? { kind: 'lon', date: undefined } : null;
  }
  if (groups.lat !== undefined) {
    const lat = Number.parseFloat(groups.lat);
    return Number.isFinite(lat) && Math.abs(lat) <= 90 ? { kind: 'lat', date: undefined } : null;
  }
  if (groups.ele !== undefined) {
    return Number.isFinite(Number.parseFloat(groups.ele)) ? { kind: 'ele', date: undefined } : null;
  }
  if (groups.time !== undefined) {
    const parsed = parseTelemetryDate(groups.time);
    return parsed.valid ? { kind: 'time', date: parsed.date } : null;
  }
  if (groups.extra !== undefined) {
    return Number.isFinite(Number.parseFloat(groups.extra)) ? { kind: 'extra', date: undefined } : null;
  }
  return null;
}

function cleanGapPiece(piece, { trimLeft, trimRight, html }) {
  let out = html ? piece.replace(/\s+/g, ' ') : piece;
  if (trimLeft) out = out.replace(/^[\s,;，；、|·/。]+/, '');
  if (trimRight) out = out.replace(/[\s,;，；、|·/]+$/, '');
  return out.trim();
}

function stripLine(line, spans, html) {
  if (spans.length === 0) {
    return html ? line.replace(/\s+/g, ' ').trim() : line.trim();
  }
  const pieces = [];
  let cursor = 0;
  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i];
    if (span.start > cursor) {
      const piece = cleanGapPiece(line.slice(cursor, span.start), {
        trimLeft: i > 0,
        trimRight: true,
        html,
      });
      if (piece) pieces.push(piece);
    }
    cursor = span.end;
  }
  if (cursor < line.length) {
    const piece = cleanGapPiece(line.slice(cursor), {
      trimLeft: true,
      trimRight: false,
      html,
    });
    if (piece) pieces.push(piece);
  }
  return pieces.join(' ');
}

/**
 * Strips app-generated telemetry blocks from a waypoint description when coordinate fields are present,
 * preserving genuine user remarks and extracting an embedded timestamp if present.
 *
 * @param {string | null | undefined} raw
 * @param {{ html?: boolean }} [options]
 * @returns {{ text: string | undefined, time: Date | undefined }}
 */
export function cleanWaypointDescription(raw, { html = false } = {}) {
  if (!raw || typeof raw !== 'string') return { text: undefined, time: undefined };

  const fallbackText = html
    ? (raw.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').trim() || undefined)
    : (raw.trim() || undefined);

  const lines = html
    ? raw
      .replace(/<\/?(?:div|p|br|li|tr|h[1-6]|hr)\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .split(/\r?\n/)
    : raw.split(/\r?\n/);

  const kinds = new Set();
  /** @type {Array<Array<{ start: number, end: number }>>} */
  const lineSpans = [];
  /** @type {Date | undefined} */
  let embeddedTime;

  for (const line of lines) {
    /** @type {Array<{ start: number, end: number }>} */
    const spans = [];
    TELEMETRY_TOKEN_RE.lastIndex = 0;
    let match;
    while ((match = TELEMETRY_TOKEN_RE.exec(line)) !== null) {
      const validated = validateToken(match.groups);
      if (!validated) continue;
      kinds.add(validated.kind);
      spans.push({ start: match.index, end: match.index + match[0].length });
      if (validated.kind === 'time' && validated.date && !embeddedTime) {
        embeddedTime = validated.date;
      }
    }
    lineSpans.push(spans);
  }

  const hasCoords = (kinds.has('lon') && kinds.has('lat')) || kinds.has('coords');
  if (!hasCoords) {
    return { text: fallbackText, time: undefined };
  }

  const survivingLines = [];
  for (let i = 0; i < lines.length; i += 1) {
    const cleaned = stripLine(lines[i], lineSpans[i], html);
    if (cleaned) survivingLines.push(cleaned);
  }

  const result = survivingLines.join(html ? ' ' : '\n').trim();
  return {
    text: result || undefined,
    time: embeddedTime,
  };
}
