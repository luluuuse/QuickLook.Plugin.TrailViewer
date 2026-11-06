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

// 1. One file. CHANGELOG.md is the release note for what ships now: exactly one heading, describing the
//    feature set. The per-version record is kept outside this repository, so there is nothing to cross-check
//    here -- what this guard has to catch is a changelog that drifted from the version being built.
const changelog = read('CHANGELOG.md');
const parse = (text) => [...text.matchAll(/^## (\d+\.\d+\.\d+)(?: — (\d{4}-\d{2}-\d{2}))?/gm)]
  .map((m) => ({ version: m[1], date: m[2] || null }));
const release = parse(changelog);

check('the release note describes exactly one version', release.length === 1,
  release.map((v) => v.version).join(' ') || 'none');
check('and it carries a date', Boolean(release[0]?.date), release[0]?.date);

// 2. The csproj carries the version this build will be: it must be the one in the release note.
const csproj = read('src/QuickLook.Plugin.TrailViewer.csproj');
const current = (csproj.match(/<Version>([\d.]+)<\/Version>/) || [])[1];
check('the build version is the release in the changelog', release[0]?.version === current,
  `${current} vs ${release[0]?.version}`);

// 3. The metadata is a template now: a hard-coded version there is the bug this test exists for.
const metadata = read('src/QuickLook.Plugin.Metadata.config');
check('the metadata takes its version from the build', metadata.includes('<Version>@VERSION@</Version>'),
  (metadata.match(/<Version>.*<\/Version>/) || ['missing'])[0]);
check('the csproj fills that placeholder in', /WritePluginMetadata/.test(csproj) && csproj.includes('@VERSION@'));
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
