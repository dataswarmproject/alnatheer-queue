// Chromium 108 needs a matching test client; these tools are never packaged.
const Module = require('node:module');
const path = require('node:path');
const original = Module._resolveFilename;
const target = path.resolve(
  __dirname,
  '../release/legacy-test-tools/node_modules/@playwright/test',
);
if (require(path.join(target, 'package.json')).version !== '1.32.1')
  throw new Error('Install the pinned Windows 7 test tooling first');
Module._resolveFilename = function (name, parent, ...options) {
  return original.call(this, name === '@playwright/test' ? target : name, parent, ...options);
};
