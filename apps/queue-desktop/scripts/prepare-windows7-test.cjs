const path = require('node:path');
const fs = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
(async () => {
  if (process.platform !== 'win32')
    throw new Error('Run the native legacy qualification on Windows');
  const root = path.resolve(__dirname, '..');
  const getPath = require.resolve('@electron/get', {
    paths: [path.dirname(require.resolve('electron/package.json'))],
  });
  // @electron/get verifies the archive against the official SHA256 manifest.
  const zip = await require(getPath).downloadArtifact({
    version: '22.3.27',
    artifactName: 'electron',
    platform: 'win32',
    arch: 'x64',
  });
  const output = path.join(root, 'release/windows7-runtime-x64');
  await fs.mkdir(output, { recursive: true });
  execFileSync('tar.exe', ['-xf', zip, '-C', output], { windowsHide: true });
  const tools = path.join(root, 'release/legacy-test-tools');
  execFileSync(
    'npm.cmd',
    [
      'install',
      '--prefix',
      `"${tools}"`,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      '@playwright/test@1.32.1',
    ],
    {
      shell: true,
      windowsHide: true,
      stdio: 'inherit',
    },
  );
  console.log('Pinned Electron 22 and test-only Playwright installed under ignored release/.');
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
