const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const directory = path.join(process.env.LOCALAPPDATA, 'AlnatheerQueue', 'ReleaseSigning');
const file = path.join(directory, 'private.pem');
const trustFile = path.resolve(__dirname, '../../..', 'packages/queue-core/src/release-trust.ts');
const source = fs.existsSync(trustFile) ? fs.readFileSync(trustFile, 'utf8') : '';
const trustedKey = source.match(/queueReleasePublicKey = '([A-Za-z0-9+/=]+)'/)?.[1];
if (source.trim() && !trustedKey)
  throw new Error('Existing trust-root source is invalid; refusing to replace it');
let privateKey;
if (process.env.QUEUE_RELEASE_SIGNING_KEY)
  privateKey = crypto.createPrivateKey(process.env.QUEUE_RELEASE_SIGNING_KEY);
else if (fs.existsSync(file)) privateKey = crypto.createPrivateKey(fs.readFileSync(file));
else {
  if (trustedKey || !process.argv.includes('--bootstrap'))
    throw new Error(
      'Supply the existing release signing key. The committed trust root will not be changed.',
    );
  privateKey = crypto.generateKeyPairSync('ed25519').privateKey;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, privateKey.export({ format: 'pem', type: 'pkcs8' }), {
    flag: 'wx',
    mode: 0o600,
  });
}
if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Unexpected release key');
const publicKey = crypto
  .createPublicKey(privateKey)
  .export({ format: 'der', type: 'spki' })
  .toString('base64');
if (trustedKey) {
  if (publicKey !== trustedKey)
    throw new Error('Release signer does not match the committed trust root');
  console.log('Existing queue release signer verified; trust root unchanged.');
  process.exit(0);
}
if (!process.argv.includes('--bootstrap'))
  throw new Error('Initial trust-root creation requires --bootstrap');
fs.writeFileSync(
  trustFile,
  `// Public trust root. The private signing key is never shipped with clients.\nexport const queueReleasePublicKey = '${publicKey}';\nexport const queueReleaseRepository = 'dataswarmproject/alnatheer-queue';\n`,
);
console.log(
  'Queue release public trust root prepared; private key remains outside the repository.',
);
