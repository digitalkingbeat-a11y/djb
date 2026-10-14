const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const runtimeSrc = fs.readFileSync(path.join(root, 'studio/deck_runtime.js'), 'utf8');
const recSrc = fs.readFileSync(path.join(root, 'studio/studio_recording.js'), 'utf8');

function makeRuntime(){
  const decks = ['a','b'].map(d => `<div class="deck" data-deck="${d}"><strong id="name-${d}">No Track</strong><small id="artist-${d}">--</small><div id="bpm-${d}">--</div><div id="key-${d}"></div><div id="time-${d}"></div><div id="meta-${d}"></div>
    <button data-sync="${d}">Sync</button><button data-keylock="${d}">Key</button><button data-loop="${d}">Loop</button><select id="loop-size-${d}"><option>1</option><option>2</option><option selected>4</option><option>8</option><option>16</option></select>
    <input id="pitch-${d}" type="range" min="0.94" max="1.06" step="0.001" value="1"><output id="pitch-out-${d}"></output>
    <div class="meter" id="meter-${d}"><i></i></div><div class="wave" id="wave-${d}"></div><div id="hotcue-pads-${d}"></div><div id="cues-${d}"></div><div id="mixes-next-${d}"></div><audio id="audio-${d}"></audio>
    <input id="gain-${d}" type="range" min="0" max="1.4" step="0.01" value="1"><output id="gain-${d}-out"></output>
    ${['high','mid','low'].map(b => `<input id="eq-${b}-${d}" type="range" min="-12" max="12" step="1" value="0"><output id="eq-${b}-${d}-out"></output>`).join('')}</div>`).join('');
  const dom = new JSDOM(`<input id="xfader" value="0"><output id="xfader-out"></output><input id="vol-a" value="1"><input id="vol-b" value="1">${decks}`, { runScripts:'outside-only' });
  const { window } = dom;
  window.HTMLMediaElement.prototype.play = function(){ return Promise.resolve(); };
  window.eval(runtimeSrc);
  let t = 1000;
  const state = { decks:{ a:{ cues:[], hotcues:[] }, b:{ cues:[], hotcues:[] } }, studioDecks:{} };
  const rt = window.DJBattleDeckRuntime.create({ window, document:window.document, state, localStorage:{ setItem(){} }, esc:s => String(s), now:() => t, setStudioRuleStatus(){} });
  return { window, rt, state, doc:window.document, setNow:v => { t = v; } };
}

test('sync matches the other deck BPM via playbackRate; disabled with tooltip when BPM missing', () => {
  const { rt, state, doc } = makeRuntime();
  rt.updateDeckButtons('a');
  const sync = doc.querySelector('[data-sync="a"]');
  assert.strictEqual(sync.disabled, true);
  assert.match(sync.title, /no BPM/);
  assert.strictEqual(rt.syncDeck('a').ok, false);
  state.studioDecks.a = { bpm:'120', title:'Tone A' };
  state.studioDecks.b = { bpm:'126', title:'Tone B' };
  rt.updateDeckButtons('a');
  assert.strictEqual(sync.disabled, false);
  const r = rt.syncDeck('a');
  assert.ok(r.ok);
  assert.ok(Math.abs(r.rate - 1.05) < 1e-9);
  assert.ok(Math.abs(doc.getElementById('audio-a').playbackRate - 1.05) < 1e-9);
  assert.ok(Math.abs(rt.effectiveBpm('a') - 126) < 1e-6);
});

test('key lock toggles preservesPitch', () => {
  const { rt, doc } = makeRuntime();
  const audio = doc.getElementById('audio-a');
  rt.applyPitch('a');
  assert.strictEqual(audio.preservesPitch, false);
  rt.toggleKeyLock('a');
  assert.strictEqual(audio.preservesPitch, true);
  assert.strictEqual(doc.querySelector('[data-keylock="a"]').getAttribute('aria-pressed'), 'true');
  rt.toggleKeyLock('a');
  assert.strictEqual(audio.preservesPitch, false);
});

test('beat loop length comes from BPM and size; loop wraps and exits', () => {
  const { rt, state, doc } = makeRuntime();
  state.studioDecks.a = { bpm:'120' };
  const audio = doc.getElementById('audio-a');
  audio.currentTime = 10;
  let r = rt.toggleLoop('a');
  assert.ok(r.ok);
  assert.strictEqual(r.loop.length, 2); // 4 beats @120 = 2s
  assert.strictEqual(rt.setLoopSize('a', 8).ok, true);
  assert.strictEqual(rt.getLoop('a').length, 4);
  assert.strictEqual(rt.setLoopSize('a', 3).ok, false);
  audio.currentTime = 14.5;
  assert.strictEqual(rt.enforceLoop('a'), true);
  assert.ok(Math.abs(audio.currentTime - 10.5) < 1e-6);
  assert.match(doc.querySelector('[data-loop="a"]').textContent, /Exit 8/);
  rt.toggleLoop('a');
  assert.strictEqual(rt.getLoop('a'), null);
});

test('gain and EQ values show, double-click reset restores defaults', () => {
  const { rt, doc } = makeRuntime();
  doc.getElementById('eq-low-a').value = '6';
  doc.getElementById('gain-a').value = '0.5';
  const v = rt.applyChannelFx('a');
  assert.strictEqual(v.low, 6);
  assert.strictEqual(doc.getElementById('eq-low-a-out').textContent, '+6 dB');
  assert.strictEqual(doc.getElementById('gain-a-out').textContent, '-6.0 dB');
  rt.resetMixerControl('a', 'low');
  assert.strictEqual(doc.getElementById('eq-low-a').value, '0');
  assert.strictEqual(doc.getElementById('eq-low-a-out').textContent, '0 dB');
  assert.match(runtimeSrc, /type = 'lowshelf'/);
  assert.match(runtimeSrc, /type = 'peaking'/);
  assert.match(runtimeSrc, /type = 'highshelf'/);
  assert.match(runtimeSrc, /source\.connect\(chain\.input\);\s*chain\.output\.connect\(gain\)/);
});

test('meters use real RMS/peak, no Math.random, clip at full scale', () => {
  const { rt } = makeRuntime();
  const silence = rt.levelsFromSamples(new Float32Array(256));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(silence)), { rms:0, peak:0, clip:false });
  const sq = rt.levelsFromSamples(Float32Array.from({ length:256 }, (_, i) => i % 2 ? 0.5 : -0.5));
  assert.strictEqual(sq.rms, 0.5); assert.strictEqual(sq.peak, 0.5); assert.strictEqual(sq.clip, false);
  assert.strictEqual(rt.levelsFromSamples(Float32Array.of(1, -1)).clip, true);
  assert.strictEqual(rt.meterFraction(0), 0);
  assert.strictEqual(rt.meterFraction(1), 1);
  assert.doesNotMatch(runtimeSrc, /Math\.random/);
  assert.doesNotMatch(recSrc, /Math\.random/);
});

test('waveform peaks are computed from samples, cached, drawn with playhead and loop region; click seeks', () => {
  const { rt, state, doc } = makeRuntime();
  const peaks = rt.computePeaks([Float32Array.of(0, 0.25, 0, -0.5, 0, 1, 0, 0.1)], 4);
  assert.deepStrictEqual(Array.from(peaks), [0.25, 0.5, 1, 0.1]);
  rt.setDeckPeaks('a', 'lib:t1', peaks, 20);
  const segs = doc.querySelectorAll('#wave-a .wave-overview.real .wave-seg');
  assert.strictEqual(segs.length, 4);
  assert.strictEqual(segs[2].style.height, '100%');
  assert.ok(doc.querySelector('#wave-a .position-marker'));
  assert.ok(rt.getPeakCacheKeys().includes('lib:t1'));
  const audio = doc.getElementById('audio-a');
  Object.defineProperty(audio, 'duration', { value:20, configurable:true });
  state.studioDecks.a = { bpm:'120' };
  audio.currentTime = 5;
  rt.toggleLoop('a');
  const region = doc.querySelector('#wave-a .loop-region');
  assert.strictEqual(region.style.left, '25%');
  assert.strictEqual(region.style.width, '10%');
  const r = rt.seekDeckToFraction('a', 0.75);
  assert.strictEqual(r.time, 15);
  assert.strictEqual(rt.getLoop('a'), null, 'seeking out of loop exits it');
  assert.doesNotMatch(runtimeSrc, /repeating-linear-gradient/);
});

test('tracklist built from play log with timestamps; copy text format', () => {
  const { window } = makeRuntime();
  const { buildTracklist, tracklistText } = window.DJBattleDeckRuntime;
  const log = [
    { type:'play', deck:'a', at:500, title:'Tone A', artist:'Test' },
    { type:'play', deck:'b', at:1000 + 192000, title:'Tone B', artist:'' },
    { type:'pause', deck:'a', at:1000 + 200000, title:'Tone A' },
    { type:'play', deck:'a', at:1000 + 400000, title:'Late', artist:'' }
  ];
  const list = buildTracklist(log, 1000, 1000 + 300000);
  assert.strictEqual(tracklistText(list), '0:00 Tone A - Test\n3:12 Tone B');
});

test('recording shows tracklist with Copy after stop', async () => {
  const dom = new JSDOM(`<div id="recording-tracklist"></div><div id="recording-waveform"></div>`, { runScripts:'outside-only' });
  const { window } = dom;
  window.eval(runtimeSrc); window.eval(recSrc);
  const state = { studioRecording:{ state:'recording', startedAt:1000 } };
  const rec = window.DJBattleStudioRecording.create({ window, document:window.document, state, localStorage:{ setItem(){} }, esc:s => String(s), now:() => 61000,
    getTracklist:() => [{ ms:0, title:'Tone A', artist:'' }, { ms:30000, title:'Tone B', artist:'' }],
    formatTracklistTime:window.DJBattleDeckRuntime.formatTracklistTime });
  rec.finishRecording();
  const items = window.document.querySelectorAll('#recording-tracklist li');
  assert.strictEqual(items.length, 2);
  assert.match(items[1].textContent, /0:30.*Tone B/);
  assert.ok(window.document.getElementById('copy-tracklist'));
  let copied = '';
  Object.defineProperty(window.navigator, 'clipboard', { value:{ writeText:async t => { copied = t; } }, configurable:true });
  const r = await rec.copyTracklist();
  assert.ok(r.ok);
  assert.strictEqual(copied, '0:00 Tone A\n0:30 Tone B');
});

test('studio markup has loop size picker, EQ value outputs, tracklist panel and wiring', () => {
  assert.match(app, /id="loop-size-\$\{deck\}"/);
  assert.match(app, /<output id="eq-mid-a-out">/);
  assert.match(app, /<output id="gain-b-out">/);
  assert.match(app, /id="recording-tracklist"/);
  assert.match(app, /getMasterLevels:/);
  assert.match(app, /getTracklist:/);
});
