const config = structuredClone(require('../package.json').build);
const { windowsSigning } = require('./windows-signing.cjs');
const signing = windowsSigning();
if (!signing.enabled) throw new Error('The Windows 7 installer requires Windows signing');
config.forceCodeSigning = true;
config.electronVersion = '22.3.27';
config.directories.output = 'release/windows7';
config.files = ['out-win7/**/*', 'package.json'];
config.extraMetadata = { main: './out-win7/main/index.js', queueTarget: 'windows7-x64' };
config.artifactName = 'alnatheer-queue-${version}-windows7-x64.${ext}';
config.win = { ...config.win, ...signing.win, target: [{ target: 'nsis', arch: ['x64'] }] };
config.extraResources = config.extraResources.map(resource =>
  resource.from === '../../services/queue-branch/dist'
    ? { ...resource, from: '../../services/queue-branch/dist-win7' }
    : resource,
);
module.exports = config;
