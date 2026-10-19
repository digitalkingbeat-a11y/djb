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
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    const refs = [...html.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css|png|svg|webmanifest))"/g)].map(m => m[1]);
    assert.ok(refs.length > 10);
    for(const ref of refs) assert.ok(fs.existsSync(path.join(out, ref)), `index.html needs ${ref}`);
    const sw = fs.readFileSync(path.join(out, 'sw.js'), 'utf8');
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

test('Pages build minifies, bundles and hashes assets, and keeps the service worker in sync', () => {
  const out = buildPages(fs.mkdtempSync(path.join(os.tmpdir(), 'djb-pages-opt-')));
  try{
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    const sourceHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    // One CSS bundle replaces every root stylesheet, in the same order.
    const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]);
    assert.equal(links.length, 1);
    assert.match(links[0], /^styles\.bundle\.[0-9a-f]{10}\.css$/);
    const bundle = fs.readFileSync(path.join(out, links[0]), 'utf8');
    const sourceCss = [...sourceHtml.matchAll(/<link rel="stylesheet" href="([^"]+\.css)"/g)].map(m => m[1]);
    assert.ok(sourceCss.length >= 10);
    for(const f of sourceCss) assert.ok(!fs.existsSync(path.join(out, f)), `${f} is bundled, not shipped separately`);
    assert.ok(bundle.length < sourceCss.reduce((n, f) => n + fs.statSync(path.join(root, f)).size, 0));
    // Every local script is hashed and minified, and nothing index.html references is missing.
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
    for(const src of scripts){
      assert.ok(fs.existsSync(path.join(out, src)), `missing ${src}`);
      if(src !== LOCAL_CONFIG) assert.match(src, /\.[0-9a-f]{10}\.js$/);
    }
    const appSrc = scripts.find(s => /^app\.[0-9a-f]{10}\.js$/.test(s));
    assert.ok(appSrc);
    assert.ok(fs.statSync(path.join(out, appSrc)).size < fs.statSync(path.join(root, 'app.js')).size * 0.9);
    for(const [, ref] of html.matchAll(/(?:src|href)="([^"#:]+\.[a-z]+)"/g)) assert.ok(fs.existsSync(path.join(out, ref)), `index.html needs ${ref}`);
    // Service worker precaches exactly files that exist, includes the bundle and hashed app, and is stamped.
    const sw = fs.readFileSync(path.join(out, 'sw.js'), 'utf8');
    const stamp = require('../scripts/stamp-sw-version.js');
    const shell = stamp.shellFilesFrom(sw);
    for(const f of shell) assert.ok(fs.existsSync(path.join(out, f)), `sw.js precaches missing ${f}`);
    assert.ok(shell.includes(links[0]));
    assert.ok(shell.includes(appSrc));
    assert.equal(stamp.currentVersion(out), stamp.computeShellVersion(out));
    assert.notEqual(stamp.currentVersion(out), stamp.currentVersion(root));
    // Source files on main stay readable.
    assert.ok(fs.readFileSync(path.join(root, 'app.js'), 'utf8').split('\n').length > 1000);
  }finally{ fs.rmSync(out, { recursive:true, force:true }); }
});
