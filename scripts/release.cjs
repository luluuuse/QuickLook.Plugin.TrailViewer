// Prepare a product release. This does not build, tag or publish; it changes the single version source
// and inserts the release-note heading.
//
//   node scripts/release.cjs patch
//   node scripts/release.cjs minor --pre beta.1
//   node scripts/release.cjs 2.0.0-rc.1 --dry
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { compare, next, parse, readVersion, root, writeVersion } = require('./version.cjs');

const LOG = 'CHANGELOG.md';
const DASH = '\u2014';
const args = process.argv.slice(2);
const dry = args.includes('--dry') || args.includes('--dry-run');
const preIndex = args.findIndex((arg) => arg === '--pre');
const prerelease = preIndex >= 0 ? args[preIndex + 1] : '';
const positional = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--pre') {
    i += 1;
  } else if (!args[i].startsWith('-')) {
    positional.push(args[i]);
  }
}
const asked = positional[0];

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

if (!asked) fail('give patch, minor, major, or an explicit semantic version');
const current = readVersion();
let target;
if (['patch', 'minor', 'major'].includes(asked)) {
  target = next(current.version, asked, prerelease);
} else {
  const parsed = parse(asked);
  if (!parsed) fail(`"${asked}" is not a semantic version`);
  target = {
    prefix: `${parsed.major}.${parsed.minor}.${parsed.patch}`,
    suffix: parsed.prerelease,
    version: asked,
  };
  if (prerelease && prerelease !== parsed.prerelease) {
    fail('do not mix an explicit version with --pre');
  }
}
if (compare(target.version, current.version) <= 0) {
  fail(`${target.version} is not newer than ${current.version}`);
}

try {
  const safeRoot = root.replace(/\\/g, '/');
  const tags = execFileSync('git', ['-c', `safe.directory=${safeRoot}`, 'tag', '--list', `v${target.version}`], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  if (tags) fail(`${tags} already exists`);
} catch (error) {
  if (error.status !== 1) fail(`could not inspect local tags: ${error.message}`);
}

const logPath = path.join(root, LOG);
const log = fs.readFileSync(logPath, 'utf8');
const escaped = target.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
if (new RegExp(`^## ${escaped}(?:\\s|$)`, 'm').test(log)) {
  fail(`${LOG} already has an entry for ${target.version}`);
}
const first = log.match(/^## \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/m);
if (!first) fail(`${LOG} has no release heading`);

const today = (() => {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
})();
const entry = `## ${target.version} ${DASH} ${today} · （待写 / TODO）\n\n- （这一版改了什么）\n\n`;

console.log('Directory.Build.props');
console.log(`  - ${current.version}`);
console.log(`  + ${target.version}`);
console.log(`\n${LOG}`);
entry.trimEnd().split('\n').forEach((line) => console.log(`  + ${line}`));
if (target.suffix) console.log(`\nprerelease: ${target.suffix}`);

if (dry) {
  console.log(`\n--dry: nothing written. ${current.version} -> ${target.version}`);
  process.exit(0);
}

writeVersion(target.prefix, target.suffix);
fs.writeFileSync(logPath, log.slice(0, first.index) + entry + log.slice(first.index));
console.log(`\nprepared ${target.version}. Fill in ${LOG}, then test and build.`);

try {
  const output = execFileSync(process.execPath, [path.join('tests', 'version-test.cjs')], {
    cwd: root,
    encoding: 'utf8',
  });
  console.log(`\n${output.trimEnd()}`);
} catch (error) {
  const output = `${error.stdout || ''}${error.stderr || ''}`.trimEnd();
  const failed = output.split('\n').filter((line) => line.startsWith('FAIL'));
  if (failed.length === 1 && failed[0].includes('the built metadata carries the same number')) {
    console.log(`\n${output}`);
    console.log('\nThe built metadata is stale until the next Release build.');
  } else {
    fail(output || error.message);
  }
}
