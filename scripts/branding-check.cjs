// Prevent obsolete product branding from returning outside the explicit compatibility and attribution allowlist.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const safeRoot = root.replace(/\\/g, '/');
const tracked = execFileSync('git', ['-c', `safe.directory=${safeRoot}`, 'ls-files', '--cached', '--others',
  '--exclude-standard', '-z'], {
  cwd: root,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);
const allowedFiles = new Set([
  'src/PluginIdentity.cs',
  'viewer/storage.js',
  'viewer/app.js',
  'viewer/globals.d.ts',
  'tests/info-mode-test.cjs',
  'tools/Harness/Program.cs',
  'scripts/branding-check.cjs',
  'docs/changelog/legacy-1.16.md',
]);
const allowedLine = /github\.com\/McBenac\/QuickLook\.Plugin\.GpxViewer/;
const migrationLine = /→|旧|兼容|compatibility|legacy|obsolete/i;
const forbidden = /GpxViewer|gpxviewer\.|GPXVIEWER_|window\.gpxViewer/;
const failures = [];

for (const file of tracked) {
  if (!/\.(?:cs|cjs|mjs|js|json|md|ya?ml|csproj|props|targets|html|css|txt)$/.test(file)) continue;
  if (allowedFiles.has(file)) continue;
  if (!fs.existsSync(path.join(root, file))) continue;
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (forbidden.test(line) && !allowedLine.test(line) && !migrationLine.test(line)) {
      failures.push(`${file}:${index + 1}: ${line.trim()}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Obsolete GpxViewer branding found outside the compatibility allowlist:');
  failures.forEach((failure) => console.error(`  ${failure}`));
  process.exit(1);
}

console.log('PASS  branding: obsolete GpxViewer identifiers stay inside compatibility and attribution files');
