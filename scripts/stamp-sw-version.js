#!/usr/bin/env node
// Stamps sw.js CACHE_VERSION with a hash of every app-shell file (and sw.js itself), so any
// change to the shell ships a new service worker and the app's "Update ready" bar appears.
// `node scripts/stamp-sw-version.js`          writes the version into sw.js
// `node scripts/stamp-sw-version.js --check`  fails if sw.js isn't stamped for the current files
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const VERSION_RE = /const CACHE_VERSION = '([^']*)';/;

function readSw(root = ROOT){ return fs.readFileSync(path.join(root, 'sw.js'), 'utf8'); }

function shellFilesFrom(swSource){
  const match = swSource.match(/const SHELL_FILES = \[([\s\S]*?)\];/);
  if(!match) throw new Error('SHELL_FILES list not found in sw.js');
  const names = Array.from(match[1].matchAll(/'([^']+)'/g)).map(m => m[1]).filter(name => name !== './');
  if(match[1].includes('OFFLINE_URL')) names.push('offline.html');
  return Array.from(new Set(names)).sort();
}

function computeShellVersion(root = ROOT){
  const sw = readSw(root);
  const hash = crypto.createHash('sha256');
  hash.update(sw.replace(VERSION_RE, "const CACHE_VERSION = '';"));
  shellFilesFrom(sw).forEach(name => {
    const file = path.join(root, name);
    hash.update(`\n--${name}--\n`);
    hash.update(fs.existsSync(file) ? fs.readFileSync(file) : 'missing');
  });
  return `djb-shell-${hash.digest('hex').slice(0, 12)}`;
}

function currentVersion(root = ROOT){
  const match = readSw(root).match(VERSION_RE);
  return match ? match[1] : null;
}

function stamp(root = ROOT){
  const version = computeShellVersion(root);
  const sw = readSw(root);
  if(!VERSION_RE.test(sw)) throw new Error('CACHE_VERSION line not found in sw.js');
  const next = sw.replace(VERSION_RE, `const CACHE_VERSION = '${version}';`);
  if(next !== sw) fs.writeFileSync(path.join(root, 'sw.js'), next);
  return version;
}

if(require.main === module){
  if(process.argv.includes('--check')){
    const expected = computeShellVersion();
    const actual = currentVersion();
    if(actual !== expected){
      console.error(`sw.js CACHE_VERSION is ${actual}, expected ${expected}. Run npm run build.`);
      process.exit(1);
    }
    console.log(`sw.js version ok: ${actual}`);
  }else{
    console.log(`sw.js stamped: ${stamp()}`);
  }
}

module.exports = { computeShellVersion, currentVersion, shellFilesFrom, stamp, VERSION_RE };
