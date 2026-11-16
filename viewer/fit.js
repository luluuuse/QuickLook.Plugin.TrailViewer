// A deliberately small FIT reader for recorded activities and courses. It reads the binary framing,
// definitions and the handful of profile fields TrailViewer needs, then returns the same ParsedTrack model
// as the GPX and KML readers. Workout steps, laps, cadence, power and developer metrics are
// intentionally left out of this first version.

const FIT_EPOCH_MS = Date.UTC(1989, 11, 31);
const FILE_ID_MESSAGE = 0;
const SESSION_MESSAGE = 18;
const RECORD_MESSAGE = 20;
const COURSE_MESSAGE = 31;
const COURSE_POINT_MESSAGE = 32;
const WORKOUT_FILE_TYPE = 5;

const BASE = {
  enum: 0x00,
  sint8: 0x01,
  uint8: 0x02,
  sint16: 0x03,
  uint16: 0x04,
  sint32: 0x05,
  uint32: 0x06,
  string: 0x07,
  float32: 0x08,
  float64: 0x09,
  uint8z: 0x0a,
  uint16z: 0x0b,
  uint32z: 0x0c,
  byte: 0x0d,
  sint64: 0x0e,
  uint64: 0x0f,
  uint64z: 0x10,
};

const CRC_TABLE = (() => {
  const table = new Uint16Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (value >>> 1) ^ 0xa001 : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

const textDecoder = new TextDecoder('utf-8');

export class FitError extends Error {
  /**
   * @param {'notFit' | 'truncated' | 'crc' | 'corrupt' | 'noGps' | 'workoutNoGps' | 'unsupported'} code
   * @param {number | null} offset
   */
  constructor(code, offset = null) {
    super(code);
    this.name = 'FitError';
    this.code = code;
    this.offset = offset;
  }
}

function fail(code, offset = null) {
  throw new FitError(code, offset);
}

/** @param {ArrayBuffer | ArrayBufferView} source */
function asBytes(source) {
  if (source instanceof Uint8Array) return source;
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  }
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  fail('notFit');
}

function readU16(bytes, offset, littleEndian = true) {
  return littleEndian
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] * 0x1000000)) >>> 0;
}

/** FIT's CRC-16, used for both the optional header checksum and the whole-file trailer. */
export function fitCrc(source, start = 0, end = asBytes(source).length) {
  const bytes = asBytes(source);
  let crc = 0;
  for (let index = start; index < end; index += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[index]) & 0xff];
  }
  return crc & 0xffff;
}

/** A quick signature check used before choosing the binary rather than the XML reader. */
export function isFit(source) {
  try {
    const bytes = asBytes(source);
    return bytes.length >= 14
      && (bytes[0] === 12 || bytes[0] === 14)
      && bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54;
  } catch {
    return false;
  }
}

function parseHeader(bytes) {
  if (!isFit(bytes)) fail('notFit');
  const headerSize = bytes[0];
  const dataSize = readU32(bytes, 4);
  const dataStart = headerSize;
  const dataEnd = dataStart + dataSize;
  const expectedSize = dataEnd + 2;
  if (!Number.isSafeInteger(expectedSize) || bytes.length < expectedSize) fail('truncated');
  if (bytes.length !== expectedSize) fail('corrupt', expectedSize);

  if (headerSize === 14) {
    const stored = readU16(bytes, 12);
    if (stored !== 0 && stored !== fitCrc(bytes, 0, 12)) fail('crc', 12);
  }
  if (readU16(bytes, dataEnd) !== fitCrc(bytes, 0, dataEnd)) fail('crc', dataEnd);
  return { dataStart, dataEnd };
}

function readDefinition(bytes, start, end, hasDeveloperData) {
  if (start + 5 > end) fail('truncated', start);
  const architecture = bytes[start];
  if (!(architecture === 0 || architecture === 1)) fail('corrupt', start);
  const littleEndian = architecture === 0;
  const globalMessage = readU16(bytes, start + 1, littleEndian);
  const fieldCount = bytes[start + 3];
  let cursor = start + 4;
  if (cursor + fieldCount * 3 > end) fail('truncated', start);

  const fields = [];
  let payloadSize = 0;
  for (let index = 0; index < fieldCount; index += 1) {
    const field = {
      number: bytes[cursor],
      size: bytes[cursor + 1],
      baseType: bytes[cursor + 2],
    };
    if (field.size === 0) fail('corrupt', cursor);
    fields.push(field);
    payloadSize += field.size;
    cursor += 3;
  }

  let developerSize = 0;
  if (hasDeveloperData) {
    if (cursor >= end) fail('truncated', cursor);
    const developerCount = bytes[cursor];
    cursor += 1;
    if (cursor + developerCount * 3 > end) fail('truncated', cursor);
    for (let index = 0; index < developerCount; index += 1) {
      developerSize += bytes[cursor + 1];
      cursor += 3;
    }
  }

  return {
    globalMessage,
    littleEndian,
    fields,
    payloadSize,
    developerSize,
    next: cursor,
  };
}

function signedValue(view, offset, size, maximum, littleEndian, zeroInvalid = false) {
  const value = size === 1
    ? view.getInt8(offset)
    : size === 2
      ? view.getInt16(offset, littleEndian)
      : size === 4
        ? view.getInt32(offset, littleEndian)
        : null;
  if (value === null || value === maximum || (zeroInvalid && value === 0)) return null;
  return value;
}

function unsignedValue(view, offset, size, maximum, littleEndian, zeroInvalid = false) {
  const value = size === 1
    ? view.getUint8(offset)
    : size === 2
      ? view.getUint16(offset, littleEndian)
      : size === 4
        ? view.getUint32(offset, littleEndian)
        : null;
  if (value === null || value === maximum || (zeroInvalid && value === 0)) return null;
  return value;
}

/**
 * Decodes one native FIT field. Arrays and bytes that this reader does not use are skipped by the caller.
 * The field's declared size remains the source of truth for advancing through the next record.
 */
function readField(bytes, view, offset, field, littleEndian) {
  const size = field.size;
  if (offset + size > bytes.length) fail('truncated', offset);
  const type = field.baseType & 0x1f;

  switch (type) {
    case BASE.enum:
      return size >= 1 ? unsignedValue(view, offset, 1, 0xff, littleEndian) : null;
    case BASE.sint8:
      return size >= 1 ? signedValue(view, offset, 1, 0x7f, littleEndian) : null;
    case BASE.uint8:
      return size >= 1 ? unsignedValue(view, offset, 1, 0xff, littleEndian) : null;
    case BASE.sint16:
      return size >= 2 ? signedValue(view, offset, 2, 0x7fff, littleEndian) : null;
    case BASE.uint16:
      return size >= 2 ? unsignedValue(view, offset, 2, 0xffff, littleEndian) : null;
    case BASE.sint32:
      return size >= 4 ? signedValue(view, offset, 4, 0x7fffffff, littleEndian) : null;
    case BASE.uint32:
      return size >= 4 ? unsignedValue(view, offset, 4, 0xffffffff, littleEndian) : null;
    case BASE.string: {
      const raw = bytes.subarray(offset, offset + size);
      const zero = raw.indexOf(0);
      const value = textDecoder.decode(zero >= 0 ? raw.subarray(0, zero) : raw).trim();
      return value || null;
    }
    case BASE.float32: {
      if (size < 4) return null;
      const value = view.getFloat32(offset, littleEndian);
      return Number.isFinite(value) ? value : null;
    }
    case BASE.float64: {
      if (size < 8) return null;
      const value = view.getFloat64(offset, littleEndian);
      return Number.isFinite(value) ? value : null;
    }
    case BASE.uint8z:
      return size >= 1 ? unsignedValue(view, offset, 1, 0xff, littleEndian, true) : null;
    case BASE.uint16z:
      return size >= 2 ? unsignedValue(view, offset, 2, 0xffff, littleEndian, true) : null;
    case BASE.uint32z:
      return size >= 4 ? unsignedValue(view, offset, 4, 0xffffffff, littleEndian, true) : null;
    case BASE.sint64:
    case BASE.uint64:
    case BASE.uint64z: {
      if (size < 8) return null;
      const value = type === BASE.sint64
        ? view.getBigInt64(offset, littleEndian)
        : view.getBigUint64(offset, littleEndian);
      const invalid = type === BASE.sint64
        ? 0x7fffffffffffffffn
        : type === BASE.uint64z ? 0n : 0xffffffffffffffffn;
      if (value === invalid) return null;
      return Number(value);
    }
    default:
      // byte arrays and vendor-specific base types are deliberately ignored.
      return null;
  }
}

function fitDate(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const date = new Date(FIT_EPOCH_MS + seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function semicircles(value) {
  return Number.isFinite(value) ? value * 180 / 0x80000000 : null;
}

function validPosition(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon)
    && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function compressedTimestamp(previous, offset) {
  if (!Number.isFinite(previous)) fail('corrupt');
  const previousOffset = previous & 0x1f;
  const rollover = offset < previousOffset ? 0x20 : 0;
  return previous - previousOffset + offset + rollover;
}

/**
 * Parses an activity or course FIT file. It is strict about framing and CRC, but optional data fields may
 * be absent or invalid without rejecting the whole recording.
 * @param {ArrayBuffer | ArrayBufferView} source
 * @returns {import('./types.js').ParsedTrack}
 */
export function parseFit(source) {
  const bytes = asBytes(source);
  const { dataStart, dataEnd } = parseHeader(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const definitions = Array(16);
  const points = [];
  const waypoints = [];
  let courseName = null;
  let fileType = null;
  let lastTimestamp = null;
  let elapsedSeconds = null;
  let timerSeconds = null;

  let offset = dataStart;
  while (offset < dataEnd) {
    const recordStart = offset;
    const header = bytes[offset];
    offset += 1;
    const compressed = (header & 0x80) !== 0;

    if (!compressed && (header & 0x40) !== 0) {
      const localType = header & 0x0f;
      const hasDeveloperData = (header & 0x20) !== 0;
      if (offset >= dataEnd || bytes[offset] !== 0) fail('corrupt', recordStart);
      const definition = readDefinition(bytes, offset + 1, dataEnd, hasDeveloperData);
      definitions[localType] = definition;
      offset = definition.next;
      continue;
    }

    if (!compressed && (header & 0x20) !== 0) fail('corrupt', recordStart);
    const localType = compressed ? (header & 0x60) >> 5 : header & 0x0f;
    const definition = definitions[localType];
    if (!definition) fail('corrupt', recordStart);

    let wireSize = definition.payloadSize;
    if (compressed && definition.fields[0]?.number === 253) wireSize -= definition.fields[0].size;
    const payloadEnd = offset + wireSize + definition.developerSize;
    if (payloadEnd > dataEnd) fail('truncated', recordStart);

    const values = {};
    let sawTimestampField = false;
    for (let index = 0; index < definition.fields.length; index += 1) {
      const field = definition.fields[index];
      if (compressed && index === 0 && field.number === 253) {
        sawTimestampField = true;
        continue;
      }
      if (field.number === 253) sawTimestampField = true;
      values[field.number] = readField(bytes, view, offset, field, definition.littleEndian);
      offset += field.size;
    }
    // Developer fields live after the native ones; only their total size matters here.
    offset = payloadEnd;

    if (compressed) {
      const timestamp = compressedTimestamp(lastTimestamp, header & 0x1f);
      values[253] = timestamp;
      lastTimestamp = timestamp;
    } else if (sawTimestampField) {
      lastTimestamp = Number.isFinite(values[253]) ? values[253] : null;
    }

    if (definition.globalMessage === FILE_ID_MESSAGE) {
      if (Number.isFinite(values[0])) fileType = values[0];
    } else if (definition.globalMessage === COURSE_MESSAGE) {
      if (typeof values[5] === 'string') courseName = values[5];
    } else if (definition.globalMessage === RECORD_MESSAGE) {
      const lat = semicircles(values[0]);
      const lon = semicircles(values[1]);
      if (!validPosition(lat, lon)) continue;
      const point = { lat, lon };
      const elevation = Number.isFinite(values[78]) ? values[78] : values[2];
      if (Number.isFinite(elevation)) point.ele = elevation / 5 - 500;
      if (Number.isFinite(values[3]) && values[3] > 0 && values[3] <= 255) {
        point.heartRate = values[3];
      }
      const time = fitDate(values[253]);
      if (time) point.time = time;
      points.push(point);
    } else if (definition.globalMessage === COURSE_POINT_MESSAGE) {
      const lat = semicircles(values[2]);
      const lon = semicircles(values[3]);
      if (!validPosition(lat, lon)) continue;
      const point = { lat, lon };
      if (typeof values[6] === 'string') point.name = values[6];
      const time = fitDate(values[1]);
      if (time) point.time = time;
      waypoints.push(point);
    } else if (definition.globalMessage === SESSION_MESSAGE) {
      if (Number.isFinite(values[7])) elapsedSeconds = (elapsedSeconds || 0) + values[7] / 1000;
      if (Number.isFinite(values[8])) timerSeconds = (timerSeconds || 0) + values[8] / 1000;
    }
  }

  if (offset !== dataEnd) fail('corrupt', offset);
  if (points.length === 0 && waypoints.length === 0) {
    fail(fileType === WORKOUT_FILE_TYPE ? 'workoutNoGps' : 'noGps');
  }
  if (points.length === 0 && fileType !== null && fileType !== 6) fail('unsupported');

  const track = points.length > 0 ? [{ name: courseName, segments: [points] }] : [];
  const result = {
    version: 'FIT',
    name: courseName,
    tracks: track,
    routes: [],
    waypoints,
    areas: [],
  };
  if (elapsedSeconds !== null) result.timeUsedSeconds = elapsedSeconds;
  if (elapsedSeconds !== null && timerSeconds !== null) {
    result.pauseSeconds = Math.max(0, elapsedSeconds - timerSeconds);
  }
  return result;
}
