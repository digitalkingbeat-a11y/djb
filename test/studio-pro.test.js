const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const proSrc = fs.readFileSync(path.join(root, 'studio/studio_pro.js'), 'utf8');
const runtimeSrc = fs.readFileSync(path.join(root, 'studio/deck_runtime.js'), 'utf8');
const recSrc = fs.readFileSync(path.join(root, 'studio/studio_recording.js'), 'utf8');
require('../studio/studio_pro.js');
const Pro = globalThis.DJBattleStudioPro;

function clickTrack(bpm, seconds, sr = 44100, extraHats = false){
  const a = new Float32Array(Math.floor(sr * seconds));
  const per = 60 / bpm * sr;
  const hit = (start, amp, decay) => { const s = Math.floor(start); for(let i = 0; i < 600 && s + i < a.length; i += 1) a[s + i] += Math.sin(i * 0.25) * Math.exp(-i / decay) * amp; };
  for(let t = 0; t < a.length; t += per){ hit(t, 0.8, 90); if(extraHats) hit(t + per / 2, 0.25, 20); }
  let seed = 3; for(let i = 0; i < a.length; i += 1){ seed = (seed * 1664525 + 1013904223) >>> 0; a[i] += (seed / 4294967296 - 0.5) * 0.02; }
  return a;
}

test('auto BPM: click tracks at known tempos are detected within 0.5 BPM', () => {
  [72, 93, 120, 128, 140, 174].forEach(bpm => {
    const r = Pro.detectBpm([clickTrack(bpm, 30)], 44100);
    assert.ok(r, `no result for ${bpm}`);
    assert.ok(Math.abs(r.bpm - bpm) <= 0.5, `${bpm} detected as ${r.bpm}`);
  });
});

test('auto BPM: off-beat hats do not double the tempo; out-of-range tempos fold into 70-180', () => {
  const r = Pro.detectBpm([clickTrack(124, 30, 44100, true)], 44100);
  assert.ok(Math.abs(r.bpm - 124) <= 0.5, `got ${r.bpm}`);
  assert.ok(Math.abs(Pro.detectBpm([clickTrack(60, 30)], 44100).bpm - 120) <= 0.5);
  assert.strictEqual(Pro.foldBpm(200), 100);
  assert.strictEqual(Pro.foldBpm(45), 90);
  assert.strictEqual(Pro.detectBpm([new Float32Array(1000)], 44100), null);
});

test('filter knob: center is off, left low-pass, right high-pass', () => {
  assert.strictEqual(Pro.filterSettings(0).mode, 'off');
  assert.strictEqual(Pro.filterSettings(0.02).mode, 'off');
  const lp = Pro.filterSettings(-1);
  assert.strictEqual(lp.type, 'lowpass'); assert.strictEqual(lp.frequency, 200);
  const hp = Pro.filterSettings(1);
  assert.strictEqual(hp.type, 'highpass'); assert.strictEqual(hp.frequency, 5000);
  assert.ok(Pro.filterSettings(-0.5).frequency < 20000 && Pro.filterSettings(-0.5).frequency > 200);
});

test('echo is synced to deck BPM at 1/4, 1/2 and 1 beat', () => {
  assert.strictEqual(Pro.echoDelaySeconds(120, 1), 0.5);
  assert.strictEqual(Pro.echoDelaySeconds(120, 0.5), 0.25);
  assert.strictEqual(Pro.echoDelaySeconds(120, 0.25), 0.125);
  assert.ok(Math.abs(Pro.echoDelaySeconds(128, 1) - 0.46875) < 1e-9);
});

test('cue/master knob is an equal-power blend', () => {
  assert.deepStrictEqual(Pro.cueMixGains(0), { cue:1, master:0 });
  assert.deepStrictEqual(Pro.cueMixGains(1), { cue:0, master:1 });
  const mid = Pro.cueMixGains(0.5);
  assert.ok(Math.abs(mid.cue - Math.SQRT1_2) < 1e-9 && Math.abs(mid.master - Math.SQRT1_2) < 1e-9);
});

test('battle recording limit comes from battle duration; practice has none', () => {
  assert.strictEqual(Pro.battleRecordingLimitMs(null), null);
  [2, 5, 10, 60].forEach(m => assert.strictEqual(Pro.battleRecordingLimitMs({ duration:m }), m * 60000));
  assert.strictEqual(Pro.battleRecordingLimitMs({ durationMinutes:5 }), 300000);
  assert.strictEqual(Pro.clockText(61000), '01:01');
  assert.strictEqual(Pro.clockText(3600000), '1:00:00');
});

test('review markers place tracklist changes as fractions of the take', () => {
  const m = Pro.trackMarkers([{ ms:0, title:'A' }, { ms:30000, title:'B' }, { ms:90000, title:'C' }], 120000);
  assert.deepStrictEqual(m.map(x => [x.frac, x.title]), [[0.25, 'B'], [0.75, 'C']]);
});

// ---- runtime with a fake AudioContext ----
function fakeParam(v){ return { value:v }; }
function fakeNode(kind, extra){ const n = { kind, conns:[], connect(t){ n.conns.push(t); return t; }, disconnect(){ n.conns = []; }, ...extra }; return n; }
class FakeCtx {
  constructor(){ this.sampleRate = 44100; this.destination = fakeNode('dest'); }
  createMediaStreamDestination(){ return fakeNode('msd', { stream:{ id:'s' } }); }
  createMediaElementSource(){ return fakeNode('src'); }
  createGain(){ return fakeNode('gain', { gain:fakeParam(1) }); }
  createBiquadFilter(){ return fakeNode('biquad', { type:'lowpass', frequency:fakeParam(350), gain:fakeParam(0), Q:fakeParam(1) }); }
  createAnalyser(){ return fakeNode('analyser', { fftSize:2048, getFloatTimeDomainData(a){ a.fill(0); } }); }
  createChannelSplitter(){ return fakeNode('split'); }
  createDelay(max){ return fakeNode('delay', { max, delayTime:fakeParam(0) }); }
  createConvolver(){ return fakeNode('convolver', { buffer:null }); }
  createBuffer(ch, len, sr){ const data = Array.from({ length:ch }, () => new Float32Array(len)); return { numberOfChannels:ch, length:len, sampleRate:sr, getChannelData:c => data[c], copyToChannel(d, c){ data[c].set(d); } }; }
  close(){ return Promise.resolve(); }
}

function makeRuntime(){
  const decks = ['a','b'].map(d => `<div class="deck" data-deck="${d}"><strong id="name-${d}"></strong><div id="bpm-${d}">--</div><div id="key-${d}"></div><div id="time-${d}"></div><div id="meta-${d}"></div>
    <button data-sync="${d}">Sync</button><button data-keylock="${d}">Key</button><button data-loop="${d}">Loop</button><select id="loop-size-${d}"><option>4</option></select>
    <input id="pitch-${d}" type="range" min="0.94" max="1.06" step="0.001" value="1"><output id="pitch-out-${d}"></output><div id="wave-${d}"></div><div id="hotcue-pads-${d}"></div><div id="cues-${d}"></div><div id="mixes-next-${d}"></div><audio id="audio-${d}"></audio>
    <input id="gain-${d}" type="range" min="0" max="1.4" step="0.01" value="1">
    <input id="filter-${d}" type="range" min="-1" max="1" step="0.01" value="0"><output id="filter-${d}-out"></output>
    <select id="echo-beats-${d}"><option value="0">Off</option><option value="0.25">1/4</option><option value="0.5">1/2</option><option value="1">1</option></select>
    <input id="echo-wet-${d}" type="range" min="0" max="0.9" step="0.01" value="0.35"><output id="echo-${d}-out"></output>
    <input id="reverb-wet-${d}" type="range" min="0" max="1" step="0.01" value="0"><output id="reverb-${d}-out"></output>
    <button data-pfl="${d}">CUE</button></div>`).join('');
  const dom = new JSDOM(`<input id="xfader" value="0"><output id="xfader-out"></output><input id="vol-a" value="1"><input id="vol-b" value="1">
    <input id="cue-mix" type="range" min="0" max="1" step="0.01" value="0.5"><output id="cue-mix-out"></output><select id="headphone-output"></select><small id="headphone-note"></small>${decks}`, { runScripts:'outside-only' });
  const { window } = dom;
  window.HTMLMediaElement.prototype.play = function(){ return Promise.resolve(); };
  window.AudioContext = FakeCtx;
  window.eval(proSrc);
  window.eval(runtimeSrc);
  const saved = [];
  const state = { decks:{ a:{ cues:[], hotcues:[] }, b:{ cues:[], hotcues:[] } }, studioDecks:{} };
  const rt = window.DJBattleDeckRuntime.create({ window, document:window.document, state, localStorage:{ setItem(){} }, esc:s => String(s), now:() => 1000, setStudioRuleStatus(){}, saveDetectedBpm:(id, bpm) => saved.push([id, bpm]) });
  return { window, rt, state, doc:window.document, saved };
}

test('filter and send FX are wired into the channel chain and follow the knobs', () => {
  const { rt, state, doc } = makeRuntime();
  rt.ensureAudioGraph();
  const chain = rt.getChain('a');
  assert.ok(chain.filter && chain.delay && chain.convolver && chain.echoSend && chain.reverbSend);
  assert.ok(chain.high.conns.includes(chain.filter), 'EQ feeds the filter');
  assert.ok(chain.filter.conns.includes(chain.mix) && chain.mix.conns.includes(chain.analyser));
  assert.ok(chain.delay.conns.includes(chain.mix) && chain.convolver.conns.includes(chain.mix), 'FX returns into the channel mix');
  assert.ok(chain.convolver.buffer && chain.convolver.buffer.length > 44100, 'generated reverb impulse');
  assert.strictEqual(chain.filter.type, 'allpass');
  doc.getElementById('filter-a').value = '-1';
  rt.applySendFx('a');
  assert.strictEqual(chain.filter.type, 'lowpass');
  assert.strictEqual(chain.filter.frequency.value, 200);
  assert.match(doc.getElementById('filter-a-out').textContent, /LP/);
  doc.getElementById('filter-a').value = '1';
  rt.applySendFx('a');
  assert.strictEqual(chain.filter.type, 'highpass');
  state.studioDecks.a = { bpm:'120' };
  doc.getElementById('echo-beats-a').value = '0.5';
  doc.getElementById('reverb-wet-a').value = '0.4';
  const r = rt.applySendFx('a');
  assert.strictEqual(chain.delay.delayTime.value, 0.25);
  assert.strictEqual(chain.echoSend.gain.value, 0.35);
  assert.strictEqual(chain.reverbSend.gain.value, 0.4);
  assert.strictEqual(r.echo.delaySeconds, 0.25);
  doc.getElementById('echo-beats-a').value = '0';
  rt.applySendFx('a');
  assert.strictEqual(chain.echoSend.gain.value, 0);
});

test('PFL cue toggles route a channel to the cue bus; cue/master knob sets the blend', () => {
  const { rt, doc } = makeRuntime();
  rt.ensureAudioGraph();
  const chain = rt.getChain('a');
  const bus = rt.getCueBus();
  assert.ok(bus && chain.pfl && chain.pfl.conns.includes(bus.cue));
  assert.strictEqual(chain.pfl.gain.value, 0);
  rt.togglePfl('a');
  assert.strictEqual(chain.pfl.gain.value, 1);
  assert.strictEqual(doc.querySelector('[data-pfl="a"]').getAttribute('aria-pressed'), 'true');
  doc.getElementById('cue-mix').value = '0';
  rt.applyCue();
  assert.strictEqual(bus.cue.gain.value, 1); assert.strictEqual(bus.master.gain.value, 0);
  doc.getElementById('cue-mix').value = '1';
  rt.applyCue();
  assert.strictEqual(bus.cue.gain.value, 0); assert.strictEqual(bus.master.gain.value, 1);
});

test('headphone output shows a graceful note when setSinkId is unsupported', async () => {
  const { rt, doc, window } = makeRuntime();
  delete window.HTMLMediaElement.prototype.setSinkId;
  rt.renderHeadphoneUi();
  assert.strictEqual(doc.getElementById('headphone-note').textContent, 'Headphone output not supported in this browser');
  assert.strictEqual(doc.getElementById('headphone-output').disabled, true);
  const r = await rt.setHeadphoneDevice('x');
  assert.strictEqual(r.ok, false);
  window.HTMLMediaElement.prototype.setSinkId = function(){ return Promise.resolve(); };
  rt.renderHeadphoneUi([{ kind:'audiooutput', deviceId:'hp1', label:'USB Headphones' }, { kind:'audioinput', deviceId:'m', label:'Mic' }]);
  const opts = Array.from(doc.querySelectorAll('#headphone-output option')).map(o => o.textContent);
  assert.deepStrictEqual(opts, ['Choose headphones…', 'USB Headphones']);
});

test('detected BPM fills an empty deck with a Detected tag and saves via the track patch path; skips when BPM is set', () => {
  const { rt, state, doc, saved } = makeRuntime();
  state.studioDecks.a = { trackId:'my:t1', bpm:'--' };
  const r = rt.applyDetectedBpm('a', { bpm:126.1, confidence:0.9 });
  assert.ok(r.ok);
  assert.match(doc.getElementById('bpm-a').innerHTML, /126\.1.*Detected/);
  assert.strictEqual(rt.trackBpm('a'), 126.1);
  assert.deepStrictEqual(saved, [['my:t1', 126.1]]);
  state.studioDecks.b = { trackId:'my:t2', bpm:'128' };
  assert.strictEqual(rt.applyDetectedBpm('b', { bpm:100 }).skipped, 'already-set');
  assert.strictEqual(saved.length, 1);
});

// ---- recording: battle-length + review waveform ----
function makeRecorder(session){
  const dom = new JSDOM(`<button id="arm-record"></button><button id="record-mix"></button><button id="stop-record"></button><span id="record-status"></span><span id="record-timer"></span>
    <div id="record-countin" class="hidden"></div><small id="record-time-left" class="hidden"></small><section id="recording-review" class="hidden"><div id="recording-waveform"></div><div id="recording-tracklist"></div><audio id="recording-review-audio"></audio></section>`, { runScripts:'outside-only' });
  const { window } = dom;
  window.eval(proSrc);
  window.eval(recSrc);
  window.HTMLMediaElement.prototype.play = function(){ return Promise.resolve(); };
  let t = 1000; const timers = [];
  class FakeRec { constructor(){ this.state = 'inactive'; } start(){ this.state = 'recording'; } stop(){ this.state = 'inactive'; this.onstop && this.onstop(); } }
  const state = { studioRecording:{ state:'armed' } };
  const rec = window.DJBattleStudioRecording.create({ window, document:window.document, state, localStorage:{ setItem(){} }, esc:s => String(s), now:() => t,
    ensureAudioGraph(){}, getAudioContext:() => ({ resume:() => Promise.resolve() }), getRecordingDestination:() => ({ stream:{} }), getMediaRecorder:() => FakeRec,
    getBattleLimitMs:() => window.DJBattleStudioPro.battleRecordingLimitMs(session), getTracklist:() => [{ ms:0, title:'Intro' }, { ms:60000, title:'Second Track' }],
    setTimeout:(fn) => { timers.push(fn); return timers.length; }, clearTimeout(){}, computePeaks:() => [] });
  return { rec, state, doc:window.document, window, timers, setNow:v => { t = v; } };
}

test('battle recording: 3-2-1 count-in, time left, auto-stop at battle duration', async () => {
  const { rec, state, doc, timers, setNow, window } = makeRecorder({ duration:2 });
  const started = rec.start();
  assert.strictEqual(state.studioRecording.state, 'countin');
  assert.strictEqual(doc.getElementById('record-countin').textContent, '3');
  timers.shift()();
  assert.strictEqual(doc.getElementById('record-countin').textContent, '2');
  timers.shift()();
  assert.strictEqual(doc.getElementById('record-countin').textContent, '1');
  timers.shift()();
  await started;
  assert.strictEqual(state.studioRecording.state, 'recording');
  assert.strictEqual(state.studioRecording.limitMs, 120000);
  setNow(31000); rec.updateUi();
  assert.strictEqual(doc.getElementById('record-time-left').textContent, 'Time left 01:30 of 02:00');
  setNow(120000); assert.strictEqual(rec.checkLimit(), false);
  setNow(121000); assert.strictEqual(rec.checkLimit(), true);
  assert.strictEqual(state.studioRecording.state, 'review');
  assert.strictEqual(state.studioRecording.autoStopped, true);
  assert.strictEqual(state.studioRecording.elapsedMs, 120000);
  window.close();
});

test('practice recording (no battle) starts at once with no limit', async () => {
  const { rec, state, doc, setNow, window } = makeRecorder(null);
  await rec.start();
  assert.strictEqual(state.studioRecording.state, 'recording');
  assert.strictEqual(state.studioRecording.limitMs, null);
  setNow(3600000);
  assert.strictEqual(rec.checkLimit(), false);
  assert.ok(doc.getElementById('record-time-left').classList.contains('hidden'));
  rec.stop(); window.close();
});

test('review waveform draws real peaks with tracklist markers and seeks on click', async () => {
  const { rec, state, doc, window, setNow } = makeRecorder(null);
  await rec.start(); setNow(121000); rec.stop();
  assert.match(doc.getElementById('recording-waveform').textContent, /Reading waveform/);
  rec.setReviewPeaks([0.1, 0.5, 1, 0.2], 120000);
  const wave = doc.getElementById('recording-waveform');
  assert.strictEqual(wave.querySelectorAll('i').length, 4);
  assert.strictEqual(wave.querySelector('i:nth-of-type(3)').style.height, '100%');
  const markers = wave.querySelectorAll('.review-marker');
  assert.strictEqual(markers.length, 1);
  assert.strictEqual(markers[0].style.left, '50.00%');
  assert.match(markers[0].textContent, /Second Track/);
  const audio = doc.getElementById('recording-review-audio');
  Object.defineProperty(audio, 'duration', { value:120, configurable:true });
  const r = rec.seekReview(0.25);
  assert.ok(r.ok); assert.strictEqual(audio.currentTime, 30);
  assert.ok(state.studioRecording.tracklist.length === 2);
  window.close();
});

test('app wires studio pro: script order, mixer markup, upload detection, no disabled FX row', () => {
  assert.ok(html.indexOf('studio/studio_pro.js') > 0 && html.indexOf('studio/studio_pro.js') < html.indexOf('studio/studio_recording.js'));
  ['data-pfl="a"', 'id="cue-mix"', 'id="headphone-output"', 'id="echo-beats-a"', 'id="reverb-wet-b"', 'id="filter-a-out"', 'id="record-countin"', 'id="record-time-left"'].forEach(s => assert.ok(app.includes(s), s));
  assert.ok(!app.includes('FX disabled until mapped'));
  assert.match(app, /detectBpmFromFile\(f\)/);
  assert.match(app, /bpmSource = 'detected'/);
  assert.match(app, /getBattleLimitMs/);
  assert.match(app, /async function saveDetectedBpm[\s\S]*?parseBpm\(editable\.track\)[\s\S]*?updateLibraryTrackMetadataOptimistic/);
});
