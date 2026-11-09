const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const propsPath = path.join(root, 'Directory.Build.props');

function readProperties() {
  return fs.readFileSync(propsPath, 'utf8');
}

function property(text, name) {
  const match = text.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return match ? match[1].trim() : null;
}

function readVersion() {
  const text = readProperties();
  const prefix = property(text, 'TrailViewerVersionPrefix');
  const suffix = property(text, 'TrailViewerVersionSuffix') || '';
  const protocol = Number(property(text, 'TrailViewerViewerProtocolVersion') || 0);
  const preferences = Number(property(text, 'TrailViewerPreferencesSchemaVersion') || 0);
  if (!prefix) throw new Error('TrailViewerVersionPrefix is missing from Directory.Build.props');
  return {
    prefix,
    suffix,
    version: suffix ? `${prefix}-${suffix}` : prefix,
    protocol,
    preferences,
  };
}

function parse(version) {
  const match = String(version).match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/,
  );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || '',
  };
}

function compareIdentifiers(left, right) {
  const a = left.split('.');
  const b = right.split('.');
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    if (a[i] === b[i]) continue;
    const numericA = /^\d+$/.test(a[i]);
    const numericB = /^\d+$/.test(b[i]);
    if (numericA && numericB) return Number(a[i]) - Number(b[i]);
    if (numericA) return -1;
    if (numericB) return 1;
    return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function compare(left, right) {
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) throw new Error(`cannot compare invalid semantic versions: ${left}, ${right}`);
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (!a.prerelease && !b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return compareIdentifiers(a.prerelease, b.prerelease);
}

function next(current, part, prerelease = '') {
  const parsed = parse(current);
  if (!parsed) throw new Error(`current version is invalid: ${current}`);
  let prefix;
  if (part === 'major') prefix = `${parsed.major + 1}.0.0`;
  else if (part === 'minor') prefix = `${parsed.major}.${parsed.minor + 1}.0`;
  else if (part === 'patch') {
    prefix = parsed.prerelease && parsed.prerelease.startsWith('rc.')
      ? `${parsed.major}.${parsed.minor}.${parsed.patch}`
      : `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  } else throw new Error(`unknown version part: ${part}`);
  if (prerelease && !/^(?:alpha|beta|rc)\.(?:0|[1-9]\d*)$/.test(prerelease)) {
    throw new Error(`invalid prerelease "${prerelease}"; use beta.1 or rc.1`);
  }
  return {
    prefix,
    suffix: prerelease,
    version: prerelease ? `${prefix}-${prerelease}` : prefix,
  };
}

function writeVersion(version, suffix = '') {
  const parsed = parse(suffix ? `${version}-${suffix}` : version);
  if (!parsed) throw new Error(`invalid semantic version: ${suffix ? `${version}-${suffix}` : version}`);
  let text = readProperties();
  const replace = (name, value) => {
    const pattern = new RegExp(`<${name}>[^<]*</${name}>`);
    if (!pattern.test(text)) throw new Error(`${name} is missing from Directory.Build.props`);
    text = text.replace(pattern, `<${name}>${value}</${name}>`);
  };
  replace('TrailViewerVersionPrefix', version);
  replace('TrailViewerVersionSuffix', suffix);
  fs.writeFileSync(propsPath, text);
}

module.exports = {
  compare,
  next,
  parse,
  readVersion,
  root,
  writeVersion,
};
