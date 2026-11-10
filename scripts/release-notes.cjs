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

function extractReleaseNotesSince(markdown, version, sinceVersion) {
  const current = findVersionHeading(markdown, version);
  const previous = findVersionHeading(markdown, sinceVersion);
  const sinceLabel = sinceVersion.replace(/^v/, '');
  const start = current.index;
  const end = previous.index;
  if (start >= end) {
    throw new Error(`CHANGELOG.md order puts ${version} at or after ${sinceVersion}`);
  }
  const section = markdown.slice(start, end).trim();
  if (!section) throw new Error(`release notes for ${version} since ${sinceVersion} are empty`);
  if (/\(待写 \/ TODO\)|（待写 \/ TODO）|（这一版改了什么）/.test(section)) {
    throw new Error(`release notes for ${version} still contain TODO placeholders`);
  }
  return `# 自 v${sinceLabel} 以来 / Since v${sinceLabel}\n\n${section}\n`;
}

function findVersionHeading(markdown, version) {
  const normalized = version.replace(/^v/, '');
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^## ${escaped}(?:\\s|$)`, 'm');
  const match = heading.exec(markdown);
  if (!match) throw new Error(`CHANGELOG.md has no section for ${normalized}`);
  return match;
}

function main() {
  const args = process.argv.slice(2);
  let output = null;
  let since = null;
  let version = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--output') {
      output = args[++i];
    } else if (args[i] === '--since') {
      since = args[++i];
    } else if (!args[i].startsWith('-')) {
      version = args[i];
    }
  }
  version = version || readVersion().version;
  const markdown = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const notes = since
    ? extractReleaseNotesSince(markdown, version, since)
    : extractReleaseNotes(markdown, version);
  if (output) {
    const target = path.resolve(root, output);
    fs.writeFileSync(target, notes);
    console.log(`release notes: ${version} -> ${target} (${Buffer.byteLength(notes)} bytes)`);
  } else {
    process.stdout.write(notes);
  }
}

if (require.main === module) main();

module.exports = { extractReleaseNotes, extractReleaseNotesSince };
