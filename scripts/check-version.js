const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
);
const sdkSource = fs.readFileSync(path.join(repoRoot, 'anycac.js'), 'utf8');

const expectedVersion = packageJson.version;
const tagArg = process.argv[2] || '';
const normalizedTagVersion = tagArg ? tagArg.replace(/^v/, '') : '';

const sourceMatch = sdkSource.match(/var SDK_VERSION = '([^']+)'/);

if (!sourceMatch) {
  throw new Error('Could not find SDK_VERSION in anycac.js');
}

const sourceVersion = sourceMatch[1];

if (sourceVersion !== expectedVersion) {
  throw new Error(
    `SDK version mismatch: anycac.js has ${sourceVersion}, package.json has ${expectedVersion}`
  );
}

if (normalizedTagVersion && normalizedTagVersion !== expectedVersion) {
  throw new Error(
    `Tag version mismatch: tag ${normalizedTagVersion} does not match package.json ${expectedVersion}`
  );
}

console.log(`Version check passed for ${expectedVersion}`);
