// Packs bin\Release into QuickLook.Plugin.TrailViewer-<version>.qlplugin, the zip QuickLook installs on Space.
// The version in the name comes from Directory.Build.props, so downloads never collide in a folder.
//
//   node scripts/pack.cjs
//
// Written by hand rather than with Compress-Archive: Windows PowerShell 5.1 writes backslashes into entry
// names, and the .qlplugin is a plain zip whose entry names have to use forward slashes.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { readVersion } = require('./version.cjs');

const root = path.resolve(__dirname, '..');
const release = path.join(root, 'bin', 'Release');

const version = readVersion().version;
const out = path.join(root, `QuickLook.Plugin.TrailViewer-${version}.qlplugin`);
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

// CRC-32, the checksum a zip entry needs; Node has no built-in.
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

const DOS_TIME = ((12 << 11) | (0 << 5) | 0) & 0xffff; // fixed timestamp: the archive only needs to be valid
const DOS_DATE = (((2024 - 1980) << 9) | (1 << 5) | 1) & 0xffff;

function build(entries) {
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
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
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
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
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

if (!fs.existsSync(release)) {
  console.error(`no build output at ${release}; run dotnet build -c Release first`);
  process.exit(1);
}

const entries = walk(release);
if (entries.length === 0) {
  console.error(`${release} is empty`);
  process.exit(1);
}

// CopyToOutputDirectory=PreserveNewest updates files but never removes ones deleted from viewer/. Packing
// the whole output folder would therefore publish stale JavaScript after a refactor. Compare the viewer tree
// to the source before accepting the build.
const builtViewer = entries.filter((entry) => entry.name.startsWith('viewer/')).map((entry) => entry.name)
  .sort();
const sourceViewer = relativeFiles(path.join(root, 'viewer')).map((name) => `viewer/${name}`).sort();
if (JSON.stringify(builtViewer) !== JSON.stringify(sourceViewer)) {
  console.error('bin/Release/viewer does not match viewer/; clean and rebuild before packing');
  const extra = builtViewer.filter((name) => !sourceViewer.includes(name));
  const missing = sourceViewer.filter((name) => !builtViewer.includes(name));
  if (extra.length) console.error(`extra: ${extra.join(', ')}`);
  if (missing.length) console.error(`missing: ${missing.join(', ')}`);
  process.exit(1);
}

// A file name carrying one version over a binary carrying another is worse than no version at all: it
// survives review, gets published, and misleads everyone who downloads it. Catch a stale build here.
const builtConfig = path.join(release, 'QuickLook.Plugin.Metadata.config');
if (!fs.existsSync(builtConfig)) {
  console.error(`${builtConfig} is missing; rebuild before packing`);
  process.exit(1);
}
const built = fs.readFileSync(builtConfig, 'utf8').match(/<Version>\s*([^<\s]+)\s*<\/Version>/);
if (!built) {
  console.error(`${builtConfig} has no <Version>`);
  process.exit(1);
}
if (built[1] !== version) {
  console.error(`build output is ${built[1]} but Directory.Build.props says ${version}; rebuild before packing`);
  process.exit(1);
}
// The upstream MIT notice has to travel with the binary: this is a fork of McBenac's plugin.
entries.unshift({ name: 'LICENSE', data: fs.readFileSync(path.join(root, 'LICENSE')) });
const zip = build(entries);
fs.writeFileSync(out, zip);
const inBytes = entries.reduce((n, e) => n + e.data.length, 0);
console.log(`${path.basename(out)}: ${entries.length} files, ${(inBytes / 1024).toFixed(0)} KB -> ${(zip.length / 1024).toFixed(0)} KB`);
