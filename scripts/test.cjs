// Runs every Node/Playwright suite in a stable order. Keeping this in one process makes the same command
// usable locally and in CI, where a missing browser or a single failed suite must fail the job.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const tests = fs.readdirSync(path.join(root, 'tests'))
  .filter((name) => name.endsWith('-test.cjs'))
  .sort();

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
console.log(`\nAll ${tests.length} suites passed.`);
