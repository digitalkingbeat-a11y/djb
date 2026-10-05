const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

test('server test tooling stays on a mocha release without the high advisories', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'server', 'package.json'), 'utf8'));
  const major = Number(String(pkg.devDependencies.mocha).replace(/^[^\d]*/, '').split('.')[0]);
  assert.ok(major >= 12, `mocha ${pkg.devDependencies.mocha}`);
});

test('server lockfile pins qs at a release without the body-parser advisory', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'server', 'package-lock.json'), 'utf8'));
  const [major, minor] = String(lock.packages['node_modules/qs'].version).split('.').map(Number);
  assert.ok(major > 6 || (major === 6 && minor >= 16), lock.packages['node_modules/qs'].version);
});
