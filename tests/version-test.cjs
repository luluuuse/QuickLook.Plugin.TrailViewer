// One version, in every place that names it. Three files can carry a version number -- the changelog, the csproj
// and the plugin metadata QuickLook actually reads -- and they drifted once: the metadata sat at 1.7.0 while the
// code was at 1.15.x, so the plugin list was eight releases behind. This is the cheapest guard against that.
//
//   node tests/version-test.cjs
//
// No browser involved: it only reads the files.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const failures = [];
function check(what, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(what);
}

// 1. The log. 1.16.6 is the baseline entry, describing the plugin as it first shipped; every release since is
//    a new entry on top of it saying only what that version changed. Entries are appended, never rewritten, so
//    what this guard has to catch is an entry that does not match the version being built, an entry inserted
//    out of order, and one left without a date.
const changelog = read('CHANGELOG.md');
const parse = (text) => [...text.matchAll(/^## (\d+\.\d+\.\d+)(?: — (\d{4}-\d{2}-\d{2}))?/gm)]
  .map((m) => ({ version: m[1], date: m[2] || null }));
const release = parse(changelog);
const older = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

check('the log has a release note', release.length >= 1,
  release.map((v) => v.version).join(' ') || 'none');
check('every entry carries a date', release.every((v) => v.date),
  release.filter((v) => !v.date).map((v) => v.version).join(' ') || 'all dated');
check('and they run newest first, nothing inserted out of order',
  release.every((v, i) => i === 0 || older(release[i - 1].version, v.version) > 0),
  release.map((v) => v.version).join(' '));

// 2. The csproj carries the version this build will be: it must be the newest entry in the log.
const csproj = read('src/QuickLook.Plugin.TrailViewer.csproj');
const current = (csproj.match(/<Version>([\d.]+)<\/Version>/) || [])[1];
check('the build version is the newest entry in the log', release[0]?.version === current,
  `${current} vs ${release[0]?.version}`);

// 3. The metadata is a template now: a hard-coded version there is the bug this test exists for.
const metadata = read('src/QuickLook.Plugin.Metadata.config');
check('the metadata takes its version from the build', metadata.includes('<Version>@VERSION@</Version>'),
  (metadata.match(/<Version>.*<\/Version>/) || ['missing'])[0]);
check('the csproj fills that placeholder in', /WritePluginMetadata/.test(csproj) && csproj.includes('@VERSION@'));
const packageJson = JSON.parse(read('package.json'));
check('the npm test package carries the same version', packageJson.version === current,
  `${packageJson.version} vs ${current}`);
const lock = JSON.parse(read('package-lock.json'));
check('the lockfile carries the same version',
  lock.version === current && lock.packages?.['']?.version === current,
  `${lock.version}/${lock.packages?.['']?.version} vs ${current}`);
const built = path.join(root, 'bin', 'Release', 'QuickLook.Plugin.Metadata.config');
if (fs.existsSync(built)) {
  const shipped = (fs.readFileSync(built, 'utf8').match(/<Version>([\d.]+)<\/Version>/) || [])[1];
  check('the built metadata carries the same number', shipped === current, `${shipped} vs ${current}`);
}

// 4. The virtual host QuickLook is pointed at is the one this version derives to: 1.16.6 -> app-1-16-6.
const host = current.replace(/\./g, '-');
check('the changelog names the current virtual host', changelog.includes(`app-${host}.gpxviewer.example`), `app-${host}`);

console.log(failures.length === 0 ? '\nversion checks OK' : `\n${failures.length} failed`);
process.exit(failures.length === 0 ? 0 : 1);
