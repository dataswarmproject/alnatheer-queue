const fs = require('node:fs'),
  fsp = require('node:fs/promises'),
  path = require('node:path'),
  crypto = require('node:crypto');
(async () => {
  const root = path.resolve(__dirname, '..'),
    version = require('../package.json').version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Stable version required');
  require('./verify-windows-signatures.cjs').verifyWindowsSignatures(
    [
      path.join(root, 'release/win-unpacked/Alnatheer Queue.exe'),
      path.join(root, `release/Alnatheer Queue Setup ${version}.exe`),
    ],
    process.env.QUEUE_REQUIRE_WINDOWS_SIGNATURE === '1',
  );
  const key = crypto.createPrivateKey(
    process.env.QUEUE_RELEASE_SIGNING_KEY ||
      fs.readFileSync(
        path.join(process.env.LOCALAPPDATA, 'AlnatheerQueue/ReleaseSigning/private.pem'),
        'utf8',
      ),
  );
  const source = fs.readFileSync(
    path.resolve(root, '../../packages/queue-core/src/release-trust.ts'),
    'utf8',
  );
  const publicKey = source.match(/queueReleasePublicKey = '([A-Za-z0-9+/=]+)'/)?.[1];
  if (
    key.asymmetricKeyType !== 'ed25519' ||
    crypto.createPublicKey(key).export({ format: 'der', type: 'spki' }).toString('base64') !==
      publicKey
  )
    throw new Error('Release signer does not match the client trust root');
  const fileName = `alnatheer-queue-${version}-windows-x64.exe`,
    directory = path.join(root, 'release'),
    file = path.join(directory, fileName);
  await fsp.copyFile(path.join(directory, `Alnatheer Queue Setup ${version}.exe`), file);
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  const payload = {
    format: 1,
    version,
    platform: 'windows-x64',
    fileName,
    size: (await fsp.stat(file)).size,
    sha256: hash.digest('hex'),
    publishedAt: new Date().toISOString(),
  };
  const release = {
    payload,
    signature: crypto.sign(null, Buffer.from(JSON.stringify(payload)), key).toString('base64'),
  };
  await fsp.writeFile(path.join(directory, 'queue-release.json'), JSON.stringify(release, null, 2));
  console.log('Signed private queue release prepared: ' + version);
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
