// Nov 1: "Play on a speaker or TV" cast button (Remote Playback API / AirPlay).
const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const cast = require('../cast.js');
const windows = [];
test.after(() => windows.forEach(w => { try{ w.close(); }catch(e){} }));

function fakeRemote(opts = {}){
  const listeners = {};
  return { state:'disconnected', calls:0,
    addEventListener(ev, fn){ (listeners[ev] = listeners[ev] || []).push(fn); },
    emit(ev){ (listeners[ev] || []).forEach(fn => fn()); },
    async prompt(){ this.calls++; if(opts.error){ const e = new Error('x'); e.name = opts.error; throw e; } } };
}
function loadApp(setup){
  const dom = new JSDOM(read('index.html'), { url:'http://127.0.0.1/djb/index.html#library', runScripts:'outside-only', pretendToBeVisual:true });
  const w = dom.window;
  w.alert = () => {}; w.confirm = () => true; w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = function(){};
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.HTMLMediaElement.prototype.pause = () => {};
  w.HTMLDialogElement.prototype.showModal = function(){ this.setAttribute('open', ''); this.open = true; };
  w.HTMLDialogElement.prototype.close = function(){ this.removeAttribute('open'); this.open = false; };
  w.fetch = async () => ({ ok:false, status:503, text:async () => '{}', json:async () => ({}) });
  w.__DJBattleSkipReturnLinks = true;
  if(setup) setup(w);
  const belt = Array.from(w.document.querySelectorAll('script:not([src])')).find(s => s.textContent.includes('setCurrentBelt'));
  if(belt) w.eval(belt.textContent);
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js', 'social.js', 'cast.js'].forEach(f => w.eval(read(f)));
  windows.push(w);
  return w;
}
const withRemote = (remote) => w => { Object.defineProperty(w.HTMLMediaElement.prototype, 'remote', { configurable:true, get(){ return this.__r || (this.__r = remote || fakeRemote()); } }); };

test('cast.js is loaded by the page, the build, the Pages bundle and the offline shell', () => {
  assert.match(read('index.html'), /<script src="cast\.js"><\/script>/);
  assert.match(read('package.json'), /node --check cast\.js/);
  assert.match(read('scripts/build-pages.js'), /'cast\.js'/);
  assert.ok(require('../sw.js').SHELL_FILES.includes('cast.js'));
});

test('support detection: Remote Playback, AirPlay, or neither', () => {
  assert.deepEqual(cast.castSupport({ remote:{ prompt(){} } }, {}), { remote:true, airplay:false, supported:true });
  assert.equal(cast.castSupport({ webkitShowPlaybackTargetPicker(){} }, {}).airplay, true);
  assert.equal(cast.castSupport({}, { WebKitPlaybackTargetAvailabilityEvent:function(){} }).supported, true);
  assert.equal(cast.castSupport({}, {}).supported, false);
});

test('without casting support the button is hidden (no dead button)', () => {
  const w = loadApp();
  const btn = w.document.querySelector('#library-player .cast-btn');
  assert.ok(btn); assert.equal(btn.hidden, true);
  assert.equal(btn.getAttribute('aria-label'), 'Play on a speaker or TV');
});

test('with Remote Playback the player shows a cast button that opens the device picker', async () => {
  const remote = fakeRemote();
  const w = loadApp(withRemote(remote));
  const audio = w.document.getElementById('library-player-audio');
  const btn = w.document.querySelector('#library-player .cast-btn');
  assert.equal(btn.hidden, false); assert.equal(btn.type, 'button');
  audio.src = 'https://cdn.example.com/mix.mp3';
  const r = await w.DJBCast.startCast(audio, btn, w);
  assert.equal(r.ok, true); assert.equal(r.via, 'remote'); assert.equal(remote.calls, 1);
  remote.emit('connecting'); assert.equal(btn.dataset.castState, 'connecting');
  remote.emit('connect'); assert.equal(btn.getAttribute('aria-pressed'), 'true'); assert.match(btn.textContent, /Casting/);
  remote.emit('disconnect'); assert.equal(btn.dataset.castState, 'disconnected');
});

test('nothing loaded: explains instead of opening the picker', async () => {
  const remote = fakeRemote();
  const w = loadApp(withRemote(remote));
  const toasts = []; w.showAppToast = (t, b) => toasts.push(b);
  const audio = w.document.getElementById('library-player-audio');
  const r = await w.DJBCast.startCast(audio, null, w);
  assert.equal(r.reason, 'no-source'); assert.equal(remote.calls, 0);
  assert.match(toasts[0], /Play a track first/);
});

test('plain-language errors for each failure, silent when the DJ just closes the picker', () => {
  const m = cast.errorMessage;
  assert.match(m({ name:'NotSupportedError' }, { src:'blob:http://x/1' }), /only saved on this device/);
  assert.match(m({ name:'NotFoundError' }, { src:'https://a/b.mp3' }), /same Wi‑Fi/);
  assert.match(m({ name:'NotSupportedError' }, { src:'https://a/b.mp3' }), /Chrome on Android, or Safari/);
  assert.equal(m({ name:'NotAllowedError' }, { src:'https://a' }), '');
  assert.equal(m({ name:'AbortError' }, { src:'https://a' }), '');
});

test('battle replay players get their own cast button', async () => {
  const w = loadApp(withRemote());
  const a = w.document.createElement('audio'); a.className = 'timed-audio'; a.src = 'https://cdn.example.com/replay.mp3';
  w.document.body.appendChild(a);
  await new Promise(r => setTimeout(r, 0));
  const btn = a.nextElementSibling && a.nextElementSibling.querySelector('.cast-btn');
  assert.ok(btn); assert.equal(btn.hidden, false);
  w.DJBCast.wireAll(w);
  assert.equal(w.document.querySelectorAll('audio.timed-audio + .cast-row .cast-btn').length, 1, 'not wired twice');
});

test('Safari AirPlay path uses the AirPlay picker', async () => {
  let shown = 0;
  const w = loadApp(win => { win.HTMLMediaElement.prototype.webkitShowPlaybackTargetPicker = function(){ shown++; }; });
  const audio = w.document.getElementById('library-player-audio');
  audio.src = 'https://cdn.example.com/mix.mp3';
  const btn = w.document.querySelector('#library-player .cast-btn');
  assert.equal(btn.hidden, false);
  const r = await w.DJBCast.startCast(audio, btn, w);
  assert.equal(r.via, 'airplay'); assert.equal(shown, 1);
});
