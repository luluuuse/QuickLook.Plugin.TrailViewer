// Reject obvious provider credentials accidentally committed in source, docs or configuration.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const safeRoot = root.replace(/\\/g, '/');
const tracked = execFileSync('git', ['-c', `safe.directory=${safeRoot}`, 'ls-files', '--cached', '--others',
  '--exclude-standard', '-z'], {
  cwd: root,
  encoding: 'utf8',
}).split('\0').filter(Boolean);

const patterns = [
  ['Tianditu token', /(?:^|[?&])tk=[0-9a-f]{32}(?:\b|$)/i],
  ['provider API key', /(?:^|[?&])apikey=[0-9a-z]{16,}(?:\b|$)/i],
];
const failures = [];

for (const file of tracked) {
  if (!/\.(?:cs|cjs|mjs|js|json|md|ya?ml|csproj|props|targets|html|css|txt)$/.test(file)) continue;
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) continue;
  const text = fs.readFileSync(absolute, 'utf8');
  for (const [label, pattern] of patterns) {
    if (pattern.test(text)) failures.push(`${label}: ${file}`);
  }
}

if (failures.length > 0) {
  console.error('Potential provider credentials found in the repository:');
  failures.forEach((failure) => console.error(`  ${failure}`));
  process.exit(1);
}

console.log('PASS  secrets: no provider tokens or API keys are committed');
