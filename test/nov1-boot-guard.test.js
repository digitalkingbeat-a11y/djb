// Nov 1: boot safety net (self-repair when the app fails to start) + no CSS :has() for the player.
const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('index.html');
const guardSrc = (html.match(/<script>\s*\/\/ Nov 1: boot safety net[\s\S]*?<\/script>/) || [''])[0].replace(/^<script>|<\/script>$/g, '');
const windows = [];
test.after(() => windows.forEach(w => { try{ w.close(); }catch(e){} }));

function guardWindow(url = 'http://127.0.0.1/djb/index.html#battles'){
  const dom = new JSDOM('<!doctype html><body><nav><button data-view="studio">S</button></nav><section id="battles" class="view active"></section><section id="studio" class="view"></section></body>', { url, runScripts:'outside-only' });
  const w = dom.window; windows.push(w);
  const log = { unregistered:0, deleted:[], replaced:[] };
  Object.defineProperty(w.navigator, 'serviceWorker', { configurable:true, value:{ getRegistrations:async () => [{ unregister:async () => { log.unregistered++; return true; } }] } });
  w.caches = { keys:async () => ['djb-shell-old', 'djb-share-inbox', 'other-site'], delete:async k => { log.deleted.push(k); return true; } };
  w.__replace = u => log.replaced.push(u);
  w.eval(guardSrc.replace(/location\.replace\(/g, 'window.__replace('));
  return { w, log };
}
const wait = ms => new Promise(r => setTimeout(r, ms));

test('guard is the first script in <head> after the theme and is plain ES5 (no arrows, let/const, classes)', () => {
  assert.ok(guardSrc.length > 200);
  assert.ok(html.indexOf('Nov 1: boot safety net') < html.indexOf('<script src='));
  assert.doesNotMatch(guardSrc, /=>|\blet\s|\bconst\s|\bclass\s|`|\?\.|\?\?/);
  new vm.Script(guardSrc);
});

test('repair unregisters the worker, clears only DJ Battle caches, and reloads a fresh copy', async () => {
  const { w, log } = guardWindow();
  w.__djbBoot.repair();
  await wait(20);
  assert.equal(log.unregistered, 1);
  assert.deepEqual(log.deleted.sort(), ['djb-share-inbox', 'djb-shell-old']);
  assert.match(log.replaced[0], /^\/djb\/index\.html\?fresh=\d+#battles$/);
  assert.equal(w.sessionStorage.getItem('djbRepairTried'), '1');
});

test('?repair=1 runs the clean-up straight away', async () => {
  const { log } = guardWindow('http://127.0.0.1/djb/?repair=1');
  await wait(20);
  assert.equal(log.unregistered, 1);
});

test('failed start: first time repairs automatically, second time shows the bar with the error text', async () => {
  const { w, log } = guardWindow();
  w.dispatchEvent(new w.ErrorEvent('error', { message:'TypeError: x is not a function', filename:'http://127.0.0.1/djb/cast.ea96.js', lineno:12 }));
  w.__djbBoot.failed('The app didn’t finish loading');
  await wait(20);
  assert.equal(log.replaced.length, 1, 'auto-repair once');
  w.__djbBoot.failed('The app didn’t finish loading');
  const bar = w.document.getElementById('djb-boot-bar');
  assert.ok(bar);
  assert.match(bar.textContent, /Repair app/);
  assert.match(bar.textContent, /x is not a function \(cast\.ea96\.js:12\)/);
  assert.ok(w.document.getElementById('djb-boot-repair'));
});

test('healthy start: nothing shown, and the retry flag is cleared', () => {
  const { w } = guardWindow();
  w.switchView = () => {};
  assert.equal(w.__djbBoot.booted(), false, 'hoisted switchView alone is not enough');
  w.__djbAppLoaded = true;
  assert.equal(w.__djbBoot.booted(), true);
  assert.equal(w.document.getElementById('djb-boot-bar'), null);
});

test('two nav taps that don\'t change the screen show the repair bar', async () => {
  const { w } = guardWindow();
  const btn = w.document.querySelector('[data-view="studio"]');
  btn.click(); btn.click();
  await wait(1300);
  assert.ok(w.document.getElementById('djb-boot-bar'));
});

test('player layout no longer relies on CSS :has()', () => {
  assert.doesNotMatch(read('professional-redesign.css'), /library-player:has\(/);
  assert.match(read('professional-redesign.css'), /\.library-player\.has-cast/);
  assert.match(read('cast.js'), /classList\.toggle\('has-cast'/);
});

test('app.js ends with the boot marker', () => {
  assert.match(read('app.js').trimEnd(), /window\.__djbAppLoaded = true;$/);
});
