const config = structuredClone(require('../package.json').build);
const policy = require('../out/main/update-policy.json');
if (policy.feedUrl) {
  config.win.signExecutable = true;
  config.win.publisherName = policy.publisher;
  config.forceCodeSigning = true;
  config.publish = [{ provider: 'generic', url: policy.feedUrl }];
}
module.exports = config;
