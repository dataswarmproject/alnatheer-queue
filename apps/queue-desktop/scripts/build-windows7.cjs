// Build on a current Windows development PC; the resulting runtime targets Windows 7 SP1 x64.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const appRoot = path.resolve(__dirname, '..');
const root = path.resolve(appRoot, '../..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
function run(args, cwd = root) {
  // pnpm.cmd is a fixed trusted executable; arguments below are fixed build commands.
  execFileSync(pnpm, args, {
    cwd,
    env: { ...process.env, QUEUE_BUILD_TARGET: 'windows7' },
    stdio: 'inherit',
    windowsHide: true,
    shell: process.platform === 'win32',
  });
}
run([
  '--filter',
  '@saraf/queue-branch',
  'exec',
  'esbuild',
  'src/main.ts',
  'src/setup.ts',
  'src/restore.ts',
  'src/prepare-speech.ts',
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--target=node16',
  '--external:@electric-sql/pglite',
  '--outdir=dist-win7',
]);
run([
  '--filter',
  '@saraf/queue-branch',
  'exec',
  'esbuild',
  'src/legacy-bootstrap.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--target=node16',
  '--outfile=dist-win7/legacy-bootstrap.cjs',
]);
// Node 16 needs an explicit module boundary in resources/branch. Node 22's
// automatic ESM detection must not mask a missing packaged runtime descriptor.
fs.writeFileSync(
  path.join(root, 'services/queue-branch/dist-win7/package.json'),
  '{"type":"module"}\n',
);
run(['build'], appRoot);
if (process.argv.includes('--package')) {
  run(
    [
      'exec',
      'electron-builder',
      '--config',
      'scripts/windows7-build.cjs',
      '--win',
      'nsis',
      '--x64',
    ],
    appRoot,
  );
}
