const fs = require('node:fs'),
  path = require('node:path');
const root = path.resolve(__dirname, '..');
const feed = process.env.QUEUE_UPDATE_FEED_URL || '';
const publisher = process.env.QUEUE_UPDATE_PUBLISHER_NAME || '';
const { windowsSigning } = require('./windows-signing.cjs');
const signing = windowsSigning();
if (feed) {
  const url = new URL(feed);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('Update feed must be a clean HTTPS address');
}
const signed = !!(signing.enabled && signing.mode === 'public' && publisher && feed);
if (feed && !signed)
  throw new Error(
    'Generic update delivery requires public Windows signing, feed and publisher together',
  );
if (feed && publisher !== signing.publisher)
  throw new Error('Signing and update publisher identities differ');
fs.writeFileSync(
  path.join(root, 'out/main/update-policy.json'),
  JSON.stringify({ feedUrl: signed ? feed : '', publisher: signed ? publisher : '' }),
);
