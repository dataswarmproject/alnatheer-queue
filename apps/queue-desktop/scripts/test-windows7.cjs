const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const env = {
  ...process.env,
  QUEUE_TEST_ELECTRON: path.join(root, 'release/windows7-runtime-x64/electron.exe'),
  QUEUE_TEST_MAIN: path.join(root, 'out-win7/main/index.js'),
};
delete env.ELECTRON_RUN_AS_NODE;
for (const suite of [
  'setup-flow',
  'manager-counters',
  'all-devices',
  'manager-operations',
  'hdmi-flow',
  'host-network',
]) {
  execFileSync(
    process.execPath,
    [
      '--require',
      path.join(root, 'tests/windows7-playwright.cjs'),
      path.join(root, `tests/${suite}.cjs`),
    ],
    {
      env,
      windowsHide: true,
      stdio: 'inherit',
      timeout: 600000,
    },
  );
}
