// Oct 26: mic talkover, keep the screen awake, waveform zoom, tracklist chapters, battle time limits.
const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const windows = [];
test.after(() => windows.forEach(w => { try{ w.close(); }catch(e){} }));

const root = path.join(__dirname, '..');
const nextTick = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async (n = 6) => { for(let i = 0; i < n; i++) await nextTick(); };
const plain = value => JSON.parse(JSON.stringify(value));

function loadAppDom({ url = 'http://127.0.0.1/index.html', setup } = {}){
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(index, { url, runScripts:'outside-only', pretendToBeVisual:true });
  const { window } = dom;
  window.alert = () => {};
  window.confirm = () => true;
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = function(){};
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLDialogElement.prototype.showModal = function showModal(){ this.setAttribute('open', ''); this.open = true; };
  window.HTMLDialogElement.prototype.close = function close(){ this.removeAttribute('open'); this.open = false; this.dispatchEvent(new window.Event('close')); };
  window.fetch = async () => ({ ok:false, status:503, text: async () => '{}', json: async () => ({}) });
  if(setup) setup(window);
  const beltScript = Array.from(window.document.querySelectorAll('script:not([src])')).find(s => s.textContent.includes('setCurrentBelt'));
  if(beltScript) window.eval(beltScript.textContent);
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js', 'social.js', 'beat_store_five.js', 'sales_chart.js', 'automix.js', 'share_links.js', 'studio_five.js'].forEach(file => {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });
  windows.push(window);
  return window;
}
const quietLoad = (opts = {}) => loadAppDom({ ...opts, setup:w => { w.__DJBattleSkipReturnLinks = true; if(opts.setup) opts.setup(w); } });
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
function studio(opts){
  const w = quietLoad(opts);
  w.__DJBattleTestHooks.switchView('studio');
  return w;
}
function fakePlaying(w, deck, playing){
  const a = w.document.getElementById(`audio-${deck}`);
  Object.defineProperty(a, 'src', { configurable:true, get:() => 'blob:track' });
  Object.defineProperty(a, 'paused', { configurable:true, get:() => !playing });
  a.pause = () => { playing = false; a.__paused = (a.__paused || 0) + 1; };
  return a;
}
function fakeCtx(){
  const node = () => ({ gain:{ value:1 }, connect(){ this.connected = (this.connected || 0) + 1; }, disconnect(){ this.disconnected = true; } });
  const made = { gains:[] };
  const ctx = { currentTime:0, destination:{ name:'speakers' }, resume:async () => {},
    createMediaStreamSource:s => { made.source = node(); made.source.stream = s; return made.source; },
    createGain:() => { const g = node(); made.gains.push(g); return g; },
    createAnalyser:() => { made.analyser = { ...node(), fftSize:256, getByteTimeDomainData:buf => buf.fill(192) }; return made.analyser; } };
  return { ctx, made };
}

/* ---------- waveform zoom ---------- */
test('zoom helpers snap to 1×/2×/4×/8×, step, keep the playhead in view, and follow a pinch', () => {
  const S = loadAppDom().DJBStudio26;
  assert.deepEqual(plain(S.ZOOM_LEVELS), [1, 2, 4, 8]);
  assert.equal(S.snapZoom(3.1), 4); assert.equal(S.snapZoom(0.2), 1); assert.equal(S.snapZoom(20), 8);
  assert.equal(S.stepZoom(1, 1), 2); assert.equal(S.stepZoom(8, 1), 8); assert.equal(S.stepZoom(2, -1), 1); assert.equal(S.stepZoom(1, -1), 1);
  assert.equal(S.zoomOffset(0.5, 1), 0);
  assert.equal(S.zoomOffset(0.5, 2), 0.25);   // centred
  assert.equal(S.zoomOffset(0.05, 4), 0);     // clamps at the start
  assert.equal(S.zoomOffset(0.99, 4), 0.75);  // clamps at the end
  assert.equal(S.pinchZoom(1, 100, 210), 2);
  assert.equal(S.pinchZoom(2, 100, 400), 8);
  assert.equal(S.pinchZoom(4, 200, 100), 2);
  assert.equal(S.pinchZoom(2, 0, 50), 2);
});

test('each deck gets − / + zoom buttons; zooming widens the waveform layer and markers stay inside it', () => {
  const w = studio();
  const d = w.document;
  assert.ok(d.getElementById('sf-zoom-a') && d.getElementById('sf-zoom-b'));
  w.djbStudioHooks.runtime().renderWaveformForDeck('a', {});
  const wave = d.getElementById('wave-a');
  const layer = wave.querySelector('.wave-layer');
  assert.ok(layer, 'waveform draws into one layer');
  assert.ok(layer.querySelector('.position-marker') && layer.querySelector('.wave-overview'));
  assert.equal(d.getElementById('sf-zoom-out-a').disabled, true);
  d.getElementById('sf-zoom-in-a').click();
  assert.equal(d.getElementById('sf-zoom-label-a').textContent, '2×');
  assert.equal(layer.style.width, '200%');
  w.DJBStudio26.followPlayhead('a', 0.5);
  assert.equal(layer.style.transform, 'translateX(-25%)');
  d.getElementById('sf-zoom-in-a').click(); d.getElementById('sf-zoom-in-a').click(); d.getElementById('sf-zoom-in-a').click();
  assert.equal(w.DJBStudio26.getZoom('a'), 8);
  assert.equal(d.getElementById('sf-zoom-in-a').disabled, true);
  // A redraw (new track, new cue) keeps the zoom.
  w.djbStudioHooks.runtime().renderWaveformForDeck('a', {});
  assert.equal(d.querySelector('#wave-a .wave-layer').style.width, '800%');
  assert.equal(w.DJBStudio26.getZoom('b'), 1, 'deck B is zoomed on its own');
});

test('a two-finger pinch on the waveform zooms in and out on phones', () => {
  const w = studio();
  const wave = w.document.getElementById('wave-b');
  const touch = (type, dist) => {
    const e = new w.Event(type, { cancelable:true });
    Object.defineProperty(e, 'touches', { value: dist == null ? [] : [{ clientX:0, clientY:0 }, { clientX:dist, clientY:0 }] });
    wave.dispatchEvent(e);
    return e;
  };
  touch('touchstart', 100);
  const move = touch('touchmove', 400);
  assert.equal(w.DJBStudio26.getZoom('b'), 4);
  assert.equal(move.defaultPrevented, true, 'the page does not zoom at the same time');
  touch('touchend');
  touch('touchstart', 200); touch('touchmove', 100);
  assert.equal(w.DJBStudio26.getZoom('b'), 2);
});

/* ---------- mic talkover ---------- */
test('the deck runtime ducks the music by the talkover level and restores it', () => {
  const w = studio();
  const r = w.djbStudioHooks.runtime();
  const a = w.document.getElementById('audio-a');
  w.document.getElementById('xfader').value = '-1';
  r.applyMix();
  assert.equal(a.volume, 1);
  r.setDuck(0.5);
  assert.equal(a.volume, 0.5);
  assert.equal(r.getDuck(), 0.5);
  r.setDuck(1);
  assert.equal(a.volume, 1);
});

test('Turn on mic routes the mic into the recording (not the speakers), TALK dips the music, and Mic off frees the mic', async () => {
  let asked = null, stopped = 0;
  const stream = { getTracks:() => [{ stop:() => { stopped++; } }] };
  const w = studio({ setup:win => { Object.defineProperty(win.navigator, 'mediaDevices', { configurable:true, value:{ getUserMedia:async c => { asked = c; return stream; } } }); } });
  const { ctx, made } = fakeCtx();
  const dest = { stream:{}, name:'rec' };
  const ducks = [];
  w.djbStudioHooks = { ...w.djbStudioHooks, runtime:() => ({ ensureAudioGraph(){}, getAudioContext:() => ctx, getRecordingDestination:() => dest, setDuck:v => ducks.push(v) }) };
  const d = w.document;
  assert.equal(d.getElementById('sf-talk').disabled, true);
  d.getElementById('sf-mic-on').click();
  await settle();
  assert.equal(asked.audio.echoCancellation, true);
  assert.equal(made.source.stream, stream);
  const [micGain, monitor] = made.gains;
  assert.equal(micGain.gain.value, 0, 'mic stays silent until TALK');
  assert.equal(monitor.gain.value, 0, 'mic is not sent to the speakers unless asked (no feedback)');
  assert.equal(d.getElementById('sf-talk').disabled, false);
  d.getElementById('sf-talk').click();
  assert.equal(micGain.gain.value, 1);
  assert.deepEqual(ducks, [0.5]);
  assert.equal(d.getElementById('sf-talk').textContent, 'TALKING');
  d.getElementById('sf-duck').value = '0.3';
  d.getElementById('sf-duck').dispatchEvent(new w.Event('change'));
  assert.deepEqual(ducks, [0.5, 0.3]);
  w.DJBStudio26.tick(0);
  assert.ok(parseInt(d.getElementById('sf-mic-level').style.width, 10) > 50, 'level meter moves');
  d.getElementById('sf-talk').click();
  assert.equal(micGain.gain.value, 0);
  assert.equal(ducks.at(-1), 1);
  // Hold M to talk.
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key:'m' }));
  assert.equal(w.DJBStudio26.state.talking, true);
  d.dispatchEvent(new w.KeyboardEvent('keyup', { key:'m' }));
  assert.equal(w.DJBStudio26.state.talking, false);
  d.getElementById('sf-mic-on').click();
  assert.equal(stopped, 1);
  assert.equal(d.getElementById('sf-talk').disabled, true);
});

test('a blocked mic explains how to allow it', async () => {
  const w = studio({ setup:win => { Object.defineProperty(win.navigator, 'mediaDevices', { configurable:true, value:{ getUserMedia:async () => { const e = new Error('no'); e.name = 'NotAllowedError'; throw e; } } }); } });
  const res = await w.DJBStudio26.micOn();
  assert.equal(res.ok, false);
  assert.match(w.document.getElementById('sf-mic-note').textContent, /Allow the mic/);
});

/* ---------- keep the screen awake ---------- */
test('the screen stays awake while a deck plays, lets go when it stops, and the setting is remembered', async () => {
  const requests = [], releases = [];
  const w = studio({ setup:win => { Object.defineProperty(win.navigator, 'wakeLock', { configurable:true, value:{ request:async type => { requests.push(type); return { release:async () => { releases.push(1); }, addEventListener(){} }; } } }); } });
  const d = w.document;
  const S = w.DJBStudio26;
  assert.equal(S.wakeWanted({ enabled:true, playing:false, recording:true }), true);
  assert.equal(S.wakeWanted({ enabled:true, playing:true, visible:false }), false);
  assert.equal(S.wakeWanted({ enabled:false, playing:true }), false);
  await S.tick(0);
  assert.equal(requests.length, 0, 'nothing playing, no lock');
  fakePlaying(w, 'a', true);
  assert.equal(await S.tick(0), true);
  assert.deepEqual(requests, ['screen']);
  assert.match(d.getElementById('sf-awake-note').textContent, /staying on/);
  await S.tick(0);
  assert.equal(requests.length, 1, 'one lock, not one per tick');
  fakePlaying(w, 'a', false);
  assert.equal(await S.tick(0), false);
  assert.equal(releases.length, 1);
  d.getElementById('sf-awake').click();
  await settle();
  assert.equal(w.localStorage.getItem('djbKeepAwake'), 'off');
  assert.equal(d.getElementById('sf-awake').textContent, 'Keep screen awake: Off');
  fakePlaying(w, 'b', true);
  await S.tick(0);
  assert.equal(requests.length, 1, 'switched off means no lock');
});

test('browsers without Wake Lock get a plain note instead of an error', async () => {
  const w = studio();
  await w.DJBStudio26.tick(0);
  assert.match(w.document.getElementById('sf-awake-note').textContent, /can't keep the screen on/);
});

/* ---------- tracklist ---------- */
test('chaptersText writes 00:00 Artist - Title lines and starts at 00:00', () => {
  const S = loadAppDom().DJBStudio26;
  assert.equal(S.chaptersText([{ ms:65000, title:'Two', artist:'DJ B' }, { ms:0, title:'One', artist:'DJ A' }, { ms:3725000, title:'Late' }]),
    '00:00 DJ A - One\n01:05 DJ B - Two\n1:02:05 Late');
  assert.equal(S.chaptersText([{ ms:12000, title:'First' }]), '00:00 Intro\n00:12 First');
  assert.equal(S.chaptersText([], 'x'), '');
});

test('after a take the tracklist gets "Copy as chapters" next to Copy, and it copies the chapter lines', async () => {
  let copied = null;
  const w = studio({ setup:win => { Object.defineProperty(win.navigator, 'clipboard', { configurable:true, value:{ writeText:async t => { copied = t; } } }); } });
  const d = w.document;
  w.djbStudioHooks = { ...w.djbStudioHooks, recording:() => ({ state:'review', tracklist:[{ ms:0, title:'Opener', artist:'Kay' }, { ms:95000, title:'Closer', artist:'Lee' }] }) };
  d.getElementById('recording-tracklist').innerHTML = '<div class="tracklist-head"><span class="eyebrow">TRACKLIST</span><button id="copy-tracklist">Copy</button></div>';
  await w.DJBStudio26.tick(0);
  const btn = d.getElementById('sf-copy-chapters');
  assert.ok(btn);
  btn.click();
  await settle();
  assert.equal(copied, '00:00 Kay - Opener\n01:35 Lee - Closer');
  assert.equal(btn.textContent, 'Copied');
});

/* ---------- battle time limits ---------- */
test('a timed battle take counts down, warns once at 1 minute left, and stops the take and the decks at 0', async () => {
  const w = studio();
  const d = w.document;
  const toasts = [];
  w.showAppToast = (t, b) => toasts.push(t);
  let rec = { state:'recording', limitMs:120000, startedAt:1000 };
  let stops = 0;
  w.djbStudioHooks = { ...w.djbStudioHooks, recording:() => rec, stopRecording:() => { stops++; rec = { state:'review', autoStopped:true }; } };
  const a = fakePlaying(w, 'a', true);
  const S = w.DJBStudio26;
  assert.equal(S.limitTick(1000 + 30000), 'ok');
  assert.equal(d.getElementById('battle-clock').textContent, '1:30');
  assert.equal(S.limitTick(1000 + 61000), 'warn');
  assert.equal(d.getElementById('sf-limit-banner').textContent, '1 minute left');
  assert.ok(d.querySelector('#studio .timer-card').classList.contains('sf-warn'));
  S.limitTick(1000 + 70000);
  assert.deepEqual(toasts, ['1 minute left'], 'warns once');
  assert.equal(S.limitTick(1000 + 120000), 'over');
  assert.equal(stops, 1);
  assert.equal(S.limitTick(1000 + 121000), 'over');
  assert.equal(a.__paused, 1, 'decks pause when time is up');
  assert.match(d.getElementById('sf-limit-banner').textContent, /Time's up/);
  assert.equal(d.getElementById('battle-clock').textContent, '0:00');
  S.limitTick(1000 + 122000);
  assert.equal(a.__paused, 1, 'only once');
  assert.equal(S.limitPhase(61000), 'ok'); assert.equal(S.limitPhase(60000), 'warn'); assert.equal(S.limitPhase(0), 'over');
});

test('the manual BATTLE CLOCK warns at 1:00 and pauses the decks at 0:00', () => {
  const w = studio();
  const toasts = [];
  w.showAppToast = t => toasts.push(t);
  const b = fakePlaying(w, 'b', true);
  assert.equal(w.DJBStudio26.clockTick(61), 'ok');
  assert.equal(w.DJBStudio26.clockTick(60), 'warn');
  w.DJBStudio26.clockTick(59);
  assert.deepEqual(toasts, ['1 minute left']);
  assert.equal(w.DJBStudio26.clockTick(0), 'over');
  assert.equal(b.__paused, 1);
});

test('studio_five.js is wired into the page, Pages build, build check, offline shell and the app hooks', () => {
  assert.match(read('index.html'), /<script src="studio_five\.js"><\/script>/);
  assert.match(read('scripts/build-pages.js'), /'studio_five\.js'/);
  assert.match(read('package.json'), /node --check studio_five\.js/);
  assert.match(read('sw.js'), /'studio_five\.js'/);
  const app = read('app.js');
  assert.match(app, /window\.DJBStudio26\.onView\(view\)/);
  assert.match(app, /window\.DJBStudio26\.clockTick\(timerSeconds\)/);
  assert.match(read('studio/deck_runtime.js'), /setDuck/);
});
