const config = structuredClone(require('../package.json').build);
const policy = require('../out/main/update-policy.json');
const { windowsSigning } = require('./windows-signing.cjs');
const signing = windowsSigning();
config.win = { ...config.win, ...signing.win };
if (signing.enabled) config.forceCodeSigning = true;
if (policy.feedUrl) {
  if (!signing.enabled || signing.mode !== 'public')
    throw new Error('The generic public update feed requires public Windows signing');
  config.win.signtoolOptions.publisherName = policy.publisher;
  config.publish = [{ provider: 'generic', url: policy.feedUrl }];
}
module.exports = config;
