// Build the QLP plugin package without external packaging dependencies.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { readVersion } = require('./version.cjs');

const skip = new Set(['.pdb', '.xml']);

function walk(dir, prefix = '') {
  const entries = [];
  const items = fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const item of items) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) entries.push(...walk(path.join(dir, item.name), name));
    else if (!skip.has(path.extname(item.name)) && !item.name.endsWith('.deps.json')) {
      entries.push({ name, data: fs.readFileSync(path.join(dir, item.name)) });
    }
  }
  return entries;
}

function relativeFiles(dir, prefix = '') {
  const names = [];
  const items = fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const item of items) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) names.push(...relativeFiles(path.join(dir, item.name), name));
    else names.push(name);
  }
  return names;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

const DOS_TIME = ((12 << 11) | (0 << 5) | 0) & 0xffff;
const DOS_DATE = (((2024 - 1980) << 9) | (1 << 5) | 1) & 0xffff;

function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = entry.data;
    const packed = zlib.deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, directory, end]);
}

function packRelease(root, release, out, version) {
  if (!fs.existsSync(release)) throw new Error(`no build output at ${release}; build the Release first`);
  const entries = walk(release);
  if (entries.length === 0) throw new Error(`${release} is empty`);

  const builtViewer = entries.filter((entry) => entry.name.startsWith('viewer/')).map((entry) => entry.name)
    .sort();
  const sourceViewer = relativeFiles(path.join(root, 'viewer')).map((name) => `viewer/${name}`).sort();
  if (JSON.stringify(builtViewer) !== JSON.stringify(sourceViewer)) {
    const extra = builtViewer.filter((name) => !sourceViewer.includes(name));
    const missing = sourceViewer.filter((name) => !builtViewer.includes(name));
    throw new Error(`release viewer differs from source (extra: ${extra.join(', ') || 'none'};`
      + ` missing: ${missing.join(', ') || 'none'})`);
  }

  const builtConfig = path.join(release, 'QuickLook.Plugin.Metadata.config');
  if (!fs.existsSync(builtConfig)) throw new Error('release metadata is missing; rebuild before packing');
  const built = fs.readFileSync(builtConfig, 'utf8').match(/<Version>\s*([^<\s]+)\s*<\/Version>/);
  if (!built) throw new Error('release metadata has no Version');
  if (built[1] !== version) {
    throw new Error(`build output is ${built[1]} but Directory.Build.props says ${version}`);
  }

  entries.unshift({ name: 'LICENSE', data: fs.readFileSync(path.join(root, 'LICENSE')) });
  const zip = buildZip(entries);
  fs.writeFileSync(out, zip);
  return {
    entries: entries.length,
    inBytes: entries.reduce((sum, entry) => sum + entry.data.length, 0),
    outBytes: zip.length,
    sha256: crypto.createHash('sha256').update(zip).digest('hex').toUpperCase(),
  };
}

const root = path.resolve(__dirname, '..');
const version = readVersion().version;
const out = path.join(root, `QuickLook.Plugin.TrailViewer-${version}.qlplugin`);

try {
  const result = packRelease(root, path.join(root, 'bin', 'Release'), out, version);
  console.log(`${path.basename(out)}: ${result.entries} files, `
    + `${(result.inBytes / 1024).toFixed(0)} KB -> ${(result.outBytes / 1024).toFixed(0)} KB`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
