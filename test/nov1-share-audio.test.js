// Nov 1: Share audio into the installed app (manifest share_target -> service worker -> My Music).
const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const sw = require('../sw.js');
const share = require('../share_target.js');
const windows = [];
test.after(() => windows.forEach(w => { try{ w.close(); }catch(e){} }));

// Small in-memory CacheStorage good enough for the worker and page code.
function fakeCaches(){
  const stores = new Map();
  const mk = () => { const m = new Map(); return {
    put: async (k, r) => { m.set(String(k.url || k), r); },
    match: async k => { const r = m.get(String(k.url || k)); return r ? r.clone() : undefined; },
    keys: async () => Array.from(m.keys()).map(url => ({ url })),
  }; };
  return { stores,
    open: async n => { if(!stores.has(n)) stores.set(n, mk()); return stores.get(n); },
    has: async n => stores.has(n), delete: async n => stores.delete(n) };
}

test('manifest declares a POST multipart share_target for audio under the app scope', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  const st = m.share_target;
  assert.equal(st.action, './share-target');
  assert.equal(st.method, 'POST');
  assert.equal(st.enctype, 'multipart/form-data');
  assert.equal(st.params.files[0].name, 'audio');
  assert.ok(st.params.files[0].accept.includes('audio/*'));
  assert.equal(m.scope, './');
});

test('share-target path matches the scope on GitHub Pages (/djb/) and at the root', () => {
  assert.equal(sw.isShareTargetPath('/djb/share-target', '/djb/'), true);
  assert.equal(sw.isShareTargetPath('/share-target', '/'), true);
  assert.equal(sw.isShareTargetPath('/share-target', '/djb/'), false);
  assert.equal(sw.isShareTargetPath('/djb/api/share-target', '/djb/'), false);
  assert.equal(sw.shareRedirectUrl('https://x.github.io/djb/', 2, 1), 'https://x.github.io/djb/index.html?shared=2&skipped=1#library');
});

test('only audio files under the size limit are kept, at most 10', () => {
  const f = (name, type, size = 10) => ({ name, type, size });
  const r = sw.pickSharedAudio([f('a.mp3', 'audio/mpeg'), f('b.pdf', 'application/pdf'), f('c.flac', ''), f('e.wav', 'audio/wav', 0), f('big.wav', 'audio/wav', sw.SHARE_MAX_BYTES + 1), 'text']);
  assert.deepEqual(r.audio.map(x => x.name), ['a.mp3', 'c.flac']);
  assert.equal(r.skipped, 4);
  assert.equal(sw.pickSharedAudio(Array.from({ length:15 }, (_, i) => f(`${i}.mp3`, 'audio/mpeg'))).audio.length, 10);
});

test('worker stores shared audio in the private cache and redirects (303) to My Music', async () => {
  const caches = fakeCaches();
  const fd = new FormData();
  fd.append('audio', new File([new Uint8Array([1, 2, 3])], 'My Set – Live.mp3', { type:'audio/mpeg' }));
  fd.append('audio', new File(['x'], 'notes.txt', { type:'text/plain' }));
  const req = new Request('https://x.github.io/djb/share-target', { method:'POST', body:fd });
  const res = await sw.handleShareTarget(req, caches, 'https://x.github.io/djb/');
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), 'https://x.github.io/djb/index.html?shared=1&skipped=1#library');
  const files = await share.readSharedFiles(caches, File);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'My Set – Live.mp3');
  assert.equal(files[0].type, 'audio/mpeg');
  assert.equal(files[0].size, 3);
  assert.equal(caches.stores.has(sw.SHARE_CACHE), false, 'cache is cleared after pickup');
});

test('a broken share request still redirects safely with nothing stored', async () => {
  const caches = fakeCaches();
  const req = new Request('https://x.github.io/djb/share-target', { method:'POST', body:'junk', headers:{ 'Content-Type':'text/plain' } });
  const res = await sw.handleShareTarget(req, caches, 'https://x.github.io/djb/');
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /shared=0/);
  assert.equal(caches.stores.has(sw.SHARE_CACHE), false);
});

test('worker wires the POST handler before the never-cache rule and lists share_target.js in the shell', () => {
  const src = read('sw.js');
  assert.ok(src.indexOf('handleShareTarget(request') < src.indexOf('isNeverCached(url, request)) return'));
  assert.ok(sw.SHELL_FILES.includes('share_target.js'));
  assert.match(read('index.html'), /<script src="share_target\.js"><\/script>/);
  assert.match(read('scripts/build-pages.js'), /'share_target\.js'/);
});

test('URL parsing is strict and capped', () => {
  assert.equal(share.sharedCountFromUrl('https://a/djb/index.html#library'), null);
  assert.deepEqual(share.sharedCountFromUrl('https://a/djb/index.html?shared=3&skipped=1#library'), { count:3, skipped:1 });
  assert.deepEqual(share.sharedCountFromUrl('https://a/?shared=999'), { count:10, skipped:0 });
  assert.deepEqual(share.sharedCountFromUrl('https://a/?shared=abc&skipped=-2'), { count:0, skipped:0 });
});

test('support check: Android Chrome yes, iPhone Safari / desktop no, with a friendly note', () => {
  const win = (ua, extra = {}) => ({ navigator:{ userAgent:ua, serviceWorker:{}, maxTouchPoints:5, ...extra }, caches:{}, matchMedia:() => ({ matches:false }) });
  const android = share.shareSupport(win('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36'));
  assert.equal(android.supported, true);
  assert.match(share.noteText(android), /install DJ Battle/);
  const ios = share.shareSupport(win('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'));
  assert.equal(ios.supported, false);
  assert.match(share.noteText(ios), /Android \(Chrome\).*iPhone, use Upload Tracks/);
  const desk = share.shareSupport(win('Mozilla/5.0 (Windows NT 10.0) Chrome/130.0', { maxTouchPoints:0 }));
  assert.equal(desk.supported, false);
  assert.match(share.noteText(desk), /installed on Android \(Chrome\)/);
});

function loadApp(url, setup){
  const dom = new JSDOM(read('index.html'), { url, runScripts:'outside-only', pretendToBeVisual:true });
  const w = dom.window;
  w.alert = () => {}; w.confirm = () => true; w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = function(){};
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.HTMLMediaElement.prototype.pause = () => {};
  w.HTMLDialogElement.prototype.showModal = function(){ this.setAttribute('open', ''); this.open = true; };
  w.HTMLDialogElement.prototype.close = function(){ this.removeAttribute('open'); this.open = false; this.dispatchEvent(new w.Event('close')); };
  w.fetch = async () => ({ ok:false, status:503, text:async () => '{}', json:async () => ({}) });
  w.__DJBattleSkipReturnLinks = true;
  if(setup) setup(w);
  const belt = Array.from(w.document.querySelectorAll('script:not([src])')).find(s => s.textContent.includes('setCurrentBelt'));
  if(belt) w.eval(belt.textContent);
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js', 'social.js', 'share_target.js'].forEach(f => w.eval(read(f)));
  windows.push(w);
  return w;
}

test('Library shows the short "works when installed (Android/Chrome)" note', () => {
  const w = loadApp('http://127.0.0.1/djb/index.html#library');
  const note = w.document.getElementById('share-target-note');
  assert.ok(note);
  assert.match(note.textContent, /Android \(Chrome\)/);
});

test('opening with ?shared=1 opens the normal upload form prefilled, with the rights checkbox unticked', async () => {
  const caches = fakeCaches();
  await sw.storeSharedFiles(caches, 'http://127.0.0.1/djb/', [new File([new Uint8Array(8)], 'DJ Kay - Sunrise.mp3', { type:'audio/mpeg' })]);
  const w = loadApp('http://127.0.0.1/djb/index.html?shared=1&skipped=0#library', win => { win.caches = caches; win.__DJBattleSkipShareTarget = true; });
  const r = await w.DJBShareTarget.pickUpSharedFiles(w);
  for(let i = 0; i < 10; i++) await new Promise(res => setTimeout(res, 0));
  assert.equal(r.ok, true); assert.equal(r.count, 1);
  const doc = w.document;
  assert.match(doc.getElementById('modal').textContent, /Upload DJ Kay - Sunrise\.mp3/);
  assert.equal(doc.getElementById('meta-title').value, 'Sunrise');
  assert.equal(doc.getElementById('meta-artist').value, 'DJ Kay');
  const tick = doc.getElementById('meta-declare');
  assert.ok(tick); assert.equal(tick.checked, false);
  assert.ok(doc.getElementById('meta-rights'));
  assert.equal(w.location.search, '', 'shared= is removed from the address');
  assert.equal(caches.stores.has(sw.SHARE_CACHE), false);
});

test('opening with ?shared but an empty cache fails gracefully', async () => {
  const w = loadApp('http://127.0.0.1/djb/index.html?shared=0&skipped=1#library', win => { win.caches = fakeCaches(); win.__DJBattleSkipShareTarget = true; });
  const r = await w.DJBShareTarget.pickUpSharedFiles(w);
  assert.equal(r.ok, false); assert.equal(r.reason, 'empty');
  const w2 = loadApp('http://127.0.0.1/djb/index.html?shared=1#library', win => { win.__DJBattleSkipShareTarget = true; });
  const r2 = await w2.DJBShareTarget.pickUpSharedFiles(w2);
  assert.equal(r2.ok, false);
});
