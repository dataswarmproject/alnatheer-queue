const path = require('node:path'),
  { execFileSync } = require('node:child_process');
const { windowsSigning } = require('./windows-signing.cjs');
function verifyWindowsSignatures(files, required = false) {
  const signing = windowsSigning();
  if (!signing.enabled) {
    if (required) throw new Error('Windows signing is required before publishing this release');
    return;
  }
  if (process.platform !== 'win32') throw new Error('Verify Windows release signatures on Windows');
  if (!signing.certificateSha1)
    throw new Error('Pin QUEUE_SIGNING_CERT_SHA1 to verify the release publisher');
  // Use a fixed wrapper file because powershell.exe -File does not bind multiple
  // positional values reliably to string[] parameters from a native process.
  for (const file of files)
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        path.join(__dirname, 'verify-windows-signatures.ps1'),
        '-Files',
        path.resolve(file),
        '-Publisher',
        signing.publisher,
        '-Thumbprint',
        signing.certificateSha1,
        '-Mode',
        signing.mode,
      ],
      { stdio: 'inherit', windowsHide: true },
    );
}
if (require.main === module) {
  const root = path.resolve(__dirname, '..'),
    version = require('../package.json').version;
  verifyWindowsSignatures(
    [
      path.join(root, 'release/win-unpacked/Alnatheer Queue.exe'),
      path.join(root, `release/Alnatheer Queue Setup ${version}.exe`),
    ],
    true,
  );
}
module.exports = { verifyWindowsSignatures };
