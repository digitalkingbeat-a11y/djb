// Nov 2: iPhone launch screens + dark in-app boot splash.
const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('index.html');
const { SIZES, fileFor } = require('../scripts/build-splash.js');
const sw = require('../sw.js');

test('every iPhone size has a startup-image link and a real PNG of the right size', () => {
  assert.ok(SIZES.length >= 10);
  for(const s of SIZES){
    const f = fileFor(s);
    assert.ok(html.includes(`(device-width: ${s[0]}px) and (device-height: ${s[1]}px) and (-webkit-device-pixel-ratio: ${s[2]})`), f);
    assert.ok(html.includes(`rel="apple-touch-startup-image"`) && html.includes(`href="${f}"`), f);
    const buf = fs.readFileSync(path.join(root, f));
    assert.equal(buf.readUInt32BE(16), s[0] * s[2]); assert.equal(buf.readUInt32BE(20), s[1] * s[2]);
  }
});
test('manifest keeps dark background/theme colours for Android', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.background_color, '#0b0f14'); assert.equal(m.theme_color, '#0b0f14');
});
test('service worker caches splash images but nothing else under splash/', () => {
  assert.equal(sw.isShellPath('/djb/assets/splash/splash-1170x2532.png'), true);
  assert.equal(sw.isShellPath('/djb/assets/splash/../../x.mp3'), false);
  assert.equal(sw.isShellPath('/djb/assets/splash/notes.txt'), false);
});
test('Pages build ships the splash images', () => {
  const out = fs.mkdtempSync(path.join(require('os').tmpdir(), 'djb-splash-'));
  require('../scripts/build-pages.js').buildPages(out, { optimize:false });
  for(const s of SIZES) assert.ok(fs.existsSync(path.join(out, fileFor(s))), fileFor(s));
  fs.rmSync(out, { recursive:true, force:true });
});
test('boot splash never takes taps, is first in body, and comes after the self-heal guard', () => {
  assert.match(html, /<body>\s*<!-- Nov 2: dark boot splash/);
  assert.match(html, /#djb-boot-splash\{position:fixed;[^}]*pointer-events:none/);
  assert.ok(html.indexOf('Nov 1: boot safety net') < html.indexOf('id="djb-boot-splash"'));
});
function runSplash(env){
  const src = html.match(/<div id="djb-boot-splash"[\s\S]*?<script>([\s\S]*?)<\/script>/)[1];
  const timers = []; const el = { className:'', parentNode:{ removeChild(){ el.removed = true; } } };
  let now = 0; const listeners = {};
  const win = { addEventListener:(t, f) => { listeners[t] = f; } };
  const ctx = { window:win, Date:{ now:() => now }, setTimeout:(f, ms) => timers.push([now + ms, f]),
    document:{ getElementById:id => id === 'djb-boot-splash' ? el : (id === 'djb-boot-bar' ? env.bar : null) } };
  vm.runInNewContext(src, ctx);
  const tick = ms => { now += ms; let t; while((t = timers.findIndex(x => x[0] <= now)) >= 0){ const [, f] = timers.splice(t, 1)[0]; f(); } };
  return { el, win, tick, listeners };
}
test('splash fades once the app is ready', () => {
  const r = runSplash({}); r.tick(100); assert.equal(r.el.className, '');
  r.win.__djbAppLoaded = true; r.tick(60); assert.equal(r.el.className, 'gone'); r.tick(400); assert.equal(r.el.removed, true);
});
test('splash gets out of the way of the repair bar and never waits more than 4s', () => {
  const env = {}; const r = runSplash(env); env.bar = {}; r.tick(60); assert.equal(r.el.className, 'gone');
  const r2 = runSplash({}); r2.tick(3900); assert.equal(r2.el.className, ''); r2.tick(200); assert.equal(r2.el.className, 'gone');
});
