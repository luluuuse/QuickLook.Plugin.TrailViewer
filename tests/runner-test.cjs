const path = require('path');
const { spawnSync } = require('child_process');
const { createChecker } = require('./support/assertions.cjs');

const root = path.resolve(__dirname, '..');
const { check, failures } = createChecker('runner');
const run = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts', 'test.cjs'), ...args], {
  cwd: root,
  encoding: 'utf8',
});

const all = run('--list');
const allNames = all.stdout.trim().split(/\r?\n/);
check('listing succeeds without running a browser suite', all.status === 0, all.stderr);
check('the complete list contains the browser suites', allNames.length >= 25, `${allNames.length}`);
check('the complete list is sorted', allNames.join('|') === [...allNames].sort().join('|'));

const selected = run('--list', 'photo', 'focus');
check('name fragments select only matching suites',
  selected.status === 0 && selected.stdout.trim() === 'focus-test.cjs\nphoto-test.cjs',
  JSON.stringify({ status: selected.status, stdout: selected.stdout, stderr: selected.stderr }));

const bareName = run('--list', 'photo-test.cjs');
check('a suite filename works as a selector',
  bareName.status === 0 && bareName.stdout.trim() === 'photo-test.cjs', bareName.stdout);

const unknown = run('--list', 'not-a-real-suite');
check('an unknown selector fails instead of passing zero tests',
  unknown.status === 2 && unknown.stderr.includes('not-a-real-suite'), unknown.stderr);

const badFlag = run('--unknown');
check('an unknown runner option fails',
  badFlag.status === 2 && badFlag.stderr.includes('--unknown'), badFlag.stderr);

console.log(failures.length === 0 ? '\nrunner checks OK' : `\n${failures.length} failed: ${failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
