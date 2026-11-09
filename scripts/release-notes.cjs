// Extract one release section from CHANGELOG.md. Release workflows use this file as the GitHub Release body,
// so user-facing notes cannot silently fall back to GitHub's commit-only generated summary.
const fs = require('fs');
const path = require('path');
const { readVersion, root } = require('./version.cjs');

function extractReleaseNotes(markdown, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^## ${escaped}(?:\\s|$)`, 'm');
  const match = heading.exec(markdown);
  if (!match) throw new Error(`CHANGELOG.md has no section for ${version}`);
  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const next = rest.search(/^## (?:\d+\.\d+\.\d+)(?:-[0-9A-Za-z.-]+)?(?:\s|$)/m);
  const section = (next < 0 ? rest : rest.slice(0, next))
    .replace(/^\s*—[^\n]*\n/, '')
    .trim();
  if (!section) throw new Error(`release notes for ${version} are empty`);
  if (/\(待写 \/ TODO\)|（待写 \/ TODO）|（这一版改了什么）/.test(section)) {
    throw new Error(`release notes for ${version} still contain TODO placeholders`);
  }
  return `${section}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--output');
  const output = outputIndex >= 0 ? args[outputIndex + 1] : null;
  const version = args.find((arg, index) =>
    !arg.startsWith('-') && (outputIndex < 0 || index !== outputIndex + 1)) || readVersion().version;
  const markdown = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const notes = extractReleaseNotes(markdown, version);
  if (output) {
    const target = path.resolve(root, output);
    fs.writeFileSync(target, notes);
    console.log(`release notes: ${version} -> ${target} (${Buffer.byteLength(notes)} bytes)`);
  } else {
    process.stdout.write(notes);
  }
}

if (require.main === module) main();

module.exports = { extractReleaseNotes };
