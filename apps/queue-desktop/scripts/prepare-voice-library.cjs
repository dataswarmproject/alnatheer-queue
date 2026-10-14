const fs = require('node:fs'),
  path = require('node:path');
const target = path.resolve(__dirname, '../release/arabic-voice-library-free');
if (fs.existsSync(path.join(target, 'manifest.json'))) process.exit(0);
const source = process.env.QUEUE_VOICE_LIBRARY_DIRECTORY;
if (!source || !path.isAbsolute(source))
  throw new Error(
    'Provide the verified free Arabic voice library in QUEUE_VOICE_LIBRARY_DIRECTORY on the build machine',
  );
const actual = fs.realpathSync(source);
if (!fs.existsSync(path.join(actual, 'manifest.json')))
  throw new Error('Voice library manifest missing');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(actual, target, { recursive: true, errorOnExist: true, force: false });
// package:win performs full manifest/checksum/decoding verification before embedding.
