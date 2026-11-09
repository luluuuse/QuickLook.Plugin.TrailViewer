// Product version and cache identity are deliberately different. This test keeps the release version in one
// source, checks the changelog and built metadata against it, and proves the WebView host is content-derived.
//
//   node tests/version-test.cjs
const fs = require('fs');
const path = require('path');
const { compare, parse, readVersion } = require('../scripts/version.cjs');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];
function check(what, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(what);
}

const current = readVersion();
const changelog = read('CHANGELOG.md');
const releases = [...changelog.matchAll(
  /^## ((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?) \u2014 (\d{4}-\d{2}-\d{2})/gm,
)].map((match) => ({ version: match[1], date: match[2] }));

check('the version source is valid semantic versioning', Boolean(parse(current.version)), current.version);
check('the log has a release note', releases.length >= 1,
  releases.map((release) => release.version).join(' ') || 'none');
check('every entry carries a date', releases.every((release) => release.date), 'all dated');
check('entries follow semantic-version precedence',
  releases.every((release, index) => index === 0 || compare(releases[index - 1].version, release.version) > 0),
  releases.map((release) => release.version).join(' '));
check('the release version is the newest log entry', releases[0]?.version === current.version,
  `${current.version} vs ${releases[0]?.version}`);

const csproj = read('src/QuickLook.Plugin.TrailViewer.csproj');
check('the project derives Version from Directory.Build.props',
  csproj.includes('$(TrailViewerVersionPrefix)') && csproj.includes('$(TrailViewerVersionSuffix)'));
check('the assembly keeps a numeric version independent of the prerelease suffix',
  csproj.includes('<AssemblyVersion>$(TrailViewerVersionPrefix).0</AssemblyVersion>'));
check('protocol and preference schemas have independent versions',
  current.protocol > 0 && current.preferences > 0, `${current.protocol}/${current.preferences}`);

const metadata = read('src/QuickLook.Plugin.Metadata.config');
check('the metadata takes its version from the build', metadata.includes('<Version>@VERSION@</Version>'));
check('the project fills that placeholder in', /WritePluginMetadata/.test(csproj) && csproj.includes('@VERSION@'));

const packageJson = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
check('npm tooling no longer claims to be the product version',
  packageJson.version === undefined && lock.version === undefined && lock.packages?.['']?.version === undefined,
  `${packageJson.version}/${lock.version}/${lock.packages?.['']?.version}`);

const built = path.join(root, 'bin', 'Release', 'QuickLook.Plugin.Metadata.config');
if (fs.existsSync(built)) {
  const shipped = (fs.readFileSync(built, 'utf8').match(/<Version>([^<]+)<\/Version>/) || [])[1];
  check('the built metadata carries the same number', shipped === current.version,
    `${shipped} vs ${current.version}`);
}

const panel = read('src/GpxPanel.cs');
check('the WebView host is derived from viewer content, not the release version',
  panel.includes('ViewerBuildId.Compute(ViewerFolder, BuildInfo.ViewerProtocolVersion)')
  && !panel.includes('Assembly.GetName().Version.ToString(3)'));
check('viewer build identity includes the page protocol',
  read('src/ViewerBuildId.cs').includes('protocolVersion'));
check('the changelog no longer pretends a release version is the cache host',
  !/app-\d+-\d+-\d+\.gpxviewer\.example/.test(changelog));

console.log(failures.length === 0 ? '\nversion checks OK' : `\n${failures.length} failed`);
process.exit(failures.length === 0 ? 0 : 1);
