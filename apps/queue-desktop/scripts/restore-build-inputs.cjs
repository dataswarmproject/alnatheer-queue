const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const policy = require('./build-input-policy.json');
const directory = path.resolve(process.argv[2] || '');
function checked(name, digest) {
  const bytes = fs.readFileSync(path.join(directory, name));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== digest)
    throw new Error('Build input checksum mismatch: ' + name);
  return bytes;
}
const archive = checked('font-build-input.enc', policy.fontSha256);
const key = Buffer.from(process.env.QUEUE_FONT_BUILD_KEY || '', 'base64');
if (key.length !== 32 || archive.subarray(0, 4).toString() !== 'QBF1')
  throw new Error('Invalid font build credential or archive');
const cipher = crypto.createDecipheriv('aes-256-gcm', key, archive.subarray(4, 16));
cipher.setAuthTag(archive.subarray(16, 32));
const original = Buffer.concat([cipher.update(archive.subarray(32)), cipher.final()]);
fs.writeFileSync(path.join(directory, 'fonts.zip'), original, { flag: 'wx', mode: 0o600 });
checked('voice-library.zip', policy.voiceSha256);
console.log('Private font and free voice build inputs verified.');
