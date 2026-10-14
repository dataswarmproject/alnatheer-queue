const fs = require('node:fs'),
  path = require('node:path');
const root = path.resolve(__dirname, '..');
const feed = process.env.QUEUE_UPDATE_FEED_URL || '';
const publisher = process.env.QUEUE_UPDATE_PUBLISHER_NAME || '';
if (feed) {
  const url = new URL(feed);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('Update feed must be a clean HTTPS address');
}
const signed = !!(process.env.CSC_LINK && process.env.CSC_KEY_PASSWORD && publisher && feed);
if ((feed || publisher) && !signed)
  throw new Error(
    'Signed update delivery requires feed, publisher, CSC_LINK and CSC_KEY_PASSWORD together',
  );
fs.writeFileSync(
  path.join(root, 'out/main/update-policy.json'),
  JSON.stringify({ feedUrl: signed ? feed : '', publisher: signed ? publisher : '' }),
);
