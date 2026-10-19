const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildPages, LOCAL_CONFIG } = require('../scripts/build-pages.js');

const root = path.join(__dirname, '..');

test('Pages build ships every file index.html and the service worker need, and nothing server-side', () => {
  const out = buildPages(fs.mkdtempSync(path.join(os.tmpdir(), 'djb-pages-')));
  try{
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const refs = [...html.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css|png|svg|webmanifest))"/g)].map(m => m[1]);
    assert.ok(refs.length > 20);
    for(const ref of refs) assert.ok(fs.existsSync(path.join(out, ref)), `index.html needs ${ref}`);
    const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
    const shell = sw.match(/const SHELL_FILES = \[([\s\S]*?)\];/)[1];
    for(const [, file] of shell.matchAll(/'([^']+\.[a-z]+)'/g)) assert.ok(fs.existsSync(path.join(out, file)), `sw.js caches ${file}`);
    assert.ok(fs.existsSync(path.join(out, 'offline.html')));
    assert.ok(fs.existsSync(path.join(out, '.nojekyll')));
    assert.ok(fs.existsSync(path.join(out, LOCAL_CONFIG)));
    for(const excluded of ['server', 'test', 'node_modules', 'scripts', 'package.json', '.github']) assert.ok(!fs.existsSync(path.join(out, excluded)), `${excluded} must not ship`);
    if(!fs.existsSync(path.join(root, LOCAL_CONFIG))){
      const placeholder = fs.readFileSync(path.join(out, LOCAL_CONFIG), 'utf8');
      assert.doesNotMatch(placeholder, /anonKey|url\s*:/);
    }
  }finally{ fs.rmSync(out, { recursive:true, force:true }); }
});

test('Pages workflow deploys main to gh-pages with the shared build script', () => {
  const wf = fs.readFileSync(path.join(root, '.github', 'workflows', 'pages.yml'), 'utf8');
  assert.match(wf, /push:\n    branches: \[main\]/);
  assert.match(wf, /workflow_dispatch:/);
  assert.match(wf, /contents: write/);
  assert.match(wf, /run: npm run build/);
  assert.match(wf, /node scripts\/build-pages\.js _site/);
  assert.match(wf, /git push --quiet origin gh-pages/);
});
