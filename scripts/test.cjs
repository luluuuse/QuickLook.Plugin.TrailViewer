// Runs all Node/Playwright suites, or only those matching the supplied names. Keeping the runner in one
// process makes full CI stable while allowing a fast, risk-based subset during development.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const allTests = fs.readdirSync(path.join(root, 'tests'))
  .filter((name) => name.endsWith('-test.cjs'))
  .sort();
const args = process.argv.slice(2);
const unknownFlags = args.filter((arg) => arg.startsWith('-') && arg !== '--list');
if (unknownFlags.length) {
  console.error(`Unknown option(s): ${unknownFlags.join(', ')}`);
  process.exit(2);
}

const listOnly = args.includes('--list');
const selectors = args.filter((arg) => arg !== '--list');
const normalized = (value) => value.replaceAll('\\', '/').split('/').pop()
  .replace(/-test\.cjs$/i, '').toLowerCase();
const matches = (name, selector) => normalized(name).includes(normalized(selector));
const unmatched = selectors.filter((selector) => !allTests.some((name) => matches(name, selector)));
if (unmatched.length) {
  console.error(`No test suite matches: ${unmatched.join(', ')}`);
  process.exit(2);
}

const tests = selectors.length
  ? allTests.filter((name) => selectors.some((selector) => matches(name, selector)))
  : allTests;
if (listOnly) {
  console.log(tests.join('\n'));
  process.exit(0);
}

const failures = [];
for (const name of tests) {
  console.log(`\n=== ${name}`);
  const result = spawnSync(process.execPath, [path.join(root, 'tests', name)], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(result.error.message);
    failures.push(name);
  } else if (result.status !== 0) {
    failures.push(name);
  }
}

if (failures.length) {
  console.error(`\n${failures.length} suite(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log(`\nAll ${tests.length} ${selectors.length ? 'selected ' : ''}suites passed.`);
