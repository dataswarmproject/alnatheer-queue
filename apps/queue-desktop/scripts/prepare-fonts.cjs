const fs = require('node:fs'),
  path = require('node:path'),
  { execFileSync } = require('node:child_process');
const target = path.resolve(__dirname, '../src/renderer/public/fonts');
const files = ['Regular', 'Medium', 'Bold', 'Black', 'Light'].map(
  weight => 'thmanyahsans-' + weight + '.woff2',
);
if (files.every(file => fs.existsSync(path.join(target, file)))) process.exit(0);
const archive = process.env.QUEUE_FONT_ARCHIVE;
if (!archive || process.platform !== 'win32')
  throw new Error(
    'Provide the owner-supplied Thmanyah archive in QUEUE_FONT_ARCHIVE on the Windows build machine. Raw font files are excluded from Git.',
  );
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-File',
    path.join(__dirname, 'prepare-fonts.ps1'),
    '-Archive',
    path.resolve(archive),
    '-Destination',
    target,
  ],
  { stdio: 'inherit', windowsHide: true },
);
if (!files.every(file => fs.existsSync(path.join(target, file))))
  throw new Error('Font archive did not contain the required original Sans weights');
