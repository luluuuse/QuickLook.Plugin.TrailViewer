// Cuts a release: the one number this project keeps in several places at once.
//
// The version decides the WebView2 virtual host (see AppHost in src/GpxPanel.cs), so a change to viewer/
// only reaches the screen once that number moves. The number itself lives in the csproj, but it is also
// named in the log -- twice in the preamble (Chinese and English) and once as the newest entry's heading.
// Four edits, and the easy one to forget is the host name sitting inside prose, eight lines away from
// anything that looks like a version.
//
//   node scripts/bump.cjs 1.16.7 --dry     show what would change, write nothing
//   node scripts/bump.cjs 1.16.7           make the changes and check them
//
// What it deliberately does not do: build, pack, commit, tag. The version is baked into the assembly at
// compile time, so build and pack have to happen after this, and publishing is a decision, not a step.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const CSPROJ = 'src/QuickLook.Plugin.TrailViewer.csproj';
const LOG = 'CHANGELOG.md';
const DASH = '\u2014'; // em dash: version-test parses "## 1.2.3 — 2026-11-07" literally

const argv = process.argv.slice(2);
const dry = argv.includes('--dry') || argv.includes('--dry-run');
const version = argv.find((a) => !a.startsWith('-'));

function fail(message) {
  console.error(`bump: ${message}`);
  process.exit(1);
}

const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const lines = (text) => text.split('\n');

if (!version) fail('no version given; try  node scripts/bump.cjs 1.16.7 --dry');
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`"${version}" is not a version; want 1.16.7`);

// 1. The old number, and the one place it is allowed to be authoritative.
const csproj = read(CSPROJ);
const found = [...csproj.matchAll(/<Version>([\d.]+)<\/Version>/g)];
if (found.length !== 1) fail(`${CSPROJ} has ${found.length} <Version> elements; want exactly 1`);
const old = found[0][1];

const parts = (v) => v.split('.').map(Number);
const [a, b, c] = parts(version);
const [x, y, z] = parts(old);
if (a * 1e6 + b * 1e3 + c <= x * 1e6 + y * 1e3 + z) fail(`${version} is not newer than ${old}`);

const host = (v) => `app-${v.replace(/\./g, '-')}.gpxviewer.example`;
const oldHost = host(old);
const newHost = host(version);

// 2. The log: nothing may already claim this version, and the old host must be findable -- if it is not,
//    the preamble was rewritten and this script would silently leave a stale name behind.
const log = read(LOG);
if (new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b`, 'm').test(log)) fail(`${LOG} already has an entry for ${version}`);

const occurrences = log.split(oldHost).length - 1;
if (occurrences === 0) fail(`${LOG} does not mention ${oldHost}; is the preamble still there?`);

const firstEntry = log.match(/^## \d+\.\d+\.\d+/m);
if (!firstEntry) fail(`${LOG} has no entry heading to insert above`);

const today = (() => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();

const entry = `## ${version} ${DASH} ${today} · （待写 / TODO）\n\n- （这一版改了什么）\n\n`;

// 3. Apply, in memory, so a dry run and a real run share one code path.
const nextLog = (() => {
  const renamed = log.split(oldHost).join(newHost);
  const at = renamed.match(/^## \d+\.\d+\.\d+/m).index;
  return renamed.slice(0, at) + entry + renamed.slice(at);
})();
const nextCsproj = csproj.replace(`<Version>${old}</Version>`, `<Version>${version}</Version>`);

// 4. Say what changed. The preview is the point of --dry, so it shows the real lines, not just "ok".
const report = [];
report.push(`${CSPROJ}`);
report.push(`  - <Version>${old}</Version>`);
report.push(`  + <Version>${version}</Version>`);
report.push('');
report.push(`${LOG}  (${occurrences} host name${occurrences === 1 ? '' : 's'})`);
lines(log).forEach((line, i) => {
  if (line.includes(oldHost)) {
    report.push(`  ${i + 1} - ${line}`);
    report.push(`  ${i + 1} + ${line.split(oldHost).join(newHost)}`);
  }
});
report.push('');
report.push(`${LOG}  (new entry above the oldest one)`);
entry.trimEnd().split('\n').forEach((line) => report.push(`  + ${line}`));

console.log(report.join('\n'));

if (dry) {
  console.log(`\n--dry: nothing written. Re-run without --dry to cut ${version}.`);
  process.exit(0);
}

fs.writeFileSync(path.join(root, CSPROJ), nextCsproj);
fs.writeFileSync(path.join(root, LOG), nextLog);
console.log(`\ncut ${version}: ${oldHost} -> ${newHost}`);
console.log(`fill in the entry in ${LOG}, then build and pack.`);

// 5. Check it. The one expected failure is the metadata already sitting in bin/Release, which still says
//    the previous version until the next build overwrites it -- that is not a mistake, it is a stale build.
const STALE = 'the built metadata carries the same number';
let output = '';
let ok = true;
try {
  output = execFileSync(process.execPath, [path.join('tests', 'version-test.cjs')], {
    cwd: root,
    encoding: 'utf8',
  });
} catch (err) {
  ok = false;
  output = `${err.stdout || ''}${err.stderr || ''}`;
}

const bad = output.split('\n').filter((line) => line.startsWith('FAIL'));
console.log('');
console.log(output.trimEnd());

if (ok) {
  console.log('\nversion checks OK. Next: dotnet build -c Release, then node scripts/pack.cjs.');
} else if (bad.length === 1 && bad[0].includes(STALE)) {
  console.log('\nThe only failure is the stale build in bin/Release; the next build fixes it.');
  console.log('Next: dotnet build -c Release, then node scripts/pack.cjs, then node tests/version-test.cjs.');
} else {
  process.exit(1);
}
