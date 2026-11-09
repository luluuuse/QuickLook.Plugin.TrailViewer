// Run the host-side self-tests through an absolute path, so npm's Windows command shell does not reinterpret
// the relative executable as a command name.
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const executable = path.join(root, 'bin', 'Harness', 'TrailViewer.Harness.exe');
const result = spawnSync(executable, ['selftest'], { cwd: root, stdio: 'inherit' });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
