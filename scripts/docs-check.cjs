// Structural and link checks for the tracked Markdown documentation.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const failures = [];
const check = (message, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  docs: ${message}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(message);
};

const tracked = [
  'README.md',
  'README.zh-CN.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'docs/USAGE.md',
  'docs/ARCHITECTURE.md',
  'docs/DEVELOPMENT.md',
  'docs/TESTING.md',
  'docs/RELEASING.md',
  'docs/changelog/legacy-1.16.md',
];

for (const file of tracked) check(`${file} exists`, fs.existsSync(path.join(root, file)));

function visibleHeadings(markdown) {
  let fenced = false;
  const headings = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (/^```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) headings.push({ level: match[1].length, text: match[2] });
  }
  return headings;
}

function localLinks(file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  return [...text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) => match[1].trim().replace(/^<|>$/g, ''))
    .filter((target) => !/^(?:https?:|mailto:|#)/i.test(target))
    .map((target) => target.split('#')[0])
    .filter(Boolean);
}

for (const file of tracked) {
  if (!fs.existsSync(path.join(root, file))) continue;
  const headings = visibleHeadings(fs.readFileSync(path.join(root, file), 'utf8'));
  check(`${file} has one top-level heading`, headings.filter((heading) => heading.level === 1).length === 1);
  const jump = headings.find((heading, index) => index > 0 && heading.level > headings[index - 1].level + 1);
  check(`${file} does not skip heading levels`, !jump, jump ? `#${jump.level} ${jump.text}` : 'clean');
  const missing = localLinks(file).filter((target) => !fs.existsSync(path.resolve(path.dirname(path.join(root, file)), target)));
  check(`${file} local links resolve`, missing.length === 0, missing.join(', ') || 'clean');
}

const english = visibleHeadings(fs.readFileSync(path.join(root, 'README.md'), 'utf8'))
  .filter((heading) => heading.level === 2);
const chinese = visibleHeadings(fs.readFileSync(path.join(root, 'README.zh-CN.md'), 'utf8'))
  .filter((heading) => heading.level === 2);
check('English and Chinese README structures match', english.length === chinese.length,
  `${english.length}/${chinese.length}`);

const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
check('main changelog has one Unreleased section', (changelog.match(/^## Unreleased$/gm) || []).length === 1);
check('1.16 history moved out of the main changelog', !/^## 1\.16\./m.test(changelog));
const releaseHeadings = [...changelog.matchAll(/^## (Unreleased|(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?).*$/gm)];
for (let i = 0; i < releaseHeadings.length; i += 1) {
  const heading = releaseHeadings[i];
  const nextHeading = changelog.indexOf('\n## ', heading.index + heading[0].length);
  const section = changelog.slice(heading.index, nextHeading < 0 ? changelog.length : nextHeading);
  check(`${heading[1]} release notes are bilingual`,
    /^### 中文$/m.test(section) && /^### English$/m.test(section));
  if (heading[1] !== 'Unreleased') {
    check(`${heading[1]} release notes have no TODO`, !/TODO|这一版改了什么/.test(section));
  }
}

console.log(failures.length === 0 ? '\nall documentation checks passed' : `\n${failures.length} documentation check(s) failed`);
process.exitCode = failures.length === 0 ? 0 : 1;
