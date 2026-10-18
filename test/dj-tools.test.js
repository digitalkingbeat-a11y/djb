const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const runtimeSrc = fs.readFileSync(path.join(root, 'studio/deck_runtime.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function extract(name){
  const start = app.indexOf(`function ${name}(`);
  let depth = 0, i = app.indexOf('){', start) + 1;
  for(; i < app.length; i++){ if(app[i] === '{') depth++; else if(app[i] === '}' && --depth === 0) break; }
  return app.slice(start, i + 1);
}

test('tap tempo averages taps and resets after 2s idle', () => {
  const createTapTempo = new Function(`${extract('createTapTempo')}; return createTapTempo;`)();
  const t = createTapTempo();
  assert.strictEqual(t.tap(0), null);
  assert.strictEqual(t.tap(500), 120);
  assert.strictEqual(t.tap(1000), 120);
  assert.strictEqual(t.tap(1469), 122.5);
  assert.strictEqual(t.tap(5000), null, 'resets after idle');
  assert.strictEqual(t.count(), 1);
});

test('upload modal and track editor expose BPM, key and tap tempo', () => {
  assert.match(app, /Genre<input id="meta-genre" placeholder="Genre"[^>]*><\/label>\$\{bpmKeyFieldsHtml\('meta'\)\}/);
  assert.match(app, /wireTapTempo\('meta'\)/);
  assert.match(app, /applyTrackPatchLocal\(track, \{ \.\.\.\(bpmKey\.bpm/);
  assert.match(app, /bpmKeyFieldsHtml\('edit', track\)/);
  assert.match(app, /updateLibraryTrackMetadataOptimistic\(save\.dataset\.editTrack, patch\)/);
});

test('library filters persist and show removable chips', () => {
  assert.match(app, /safeParse\('djBattleLibraryFilters', null\)/);
  assert.match(app, /localStorage\.setItem\('djBattleLibraryFilters'/);
  assert.match(app, /label:`Crate: \$\{/);
  assert.match(html, /id="library-filter-chips"/);
  assert.match(extract('clearLibraryFilter'), /state\.libraryFilters\.crate = 'all'/);
});

function makeRuntime(extra = {}){
  const dom = new JSDOM(`<input id="xfader" type="range" min="-1" max="1" step="0.01" value="0"><output id="xfader-out"></output>
    <input id="vol-a" value="1"><input id="vol-b" value="1">
    ${['a','b'].map(d => `<div class="deck" data-deck="${d}"><input id="pitch-${d}" type="range" min="0.94" max="1.06" step="0.001" value="1"><output id="pitch-out-${d}"></output><div class="wave" id="wave-${d}"></div><div id="hotcue-pads-${d}"></div><div id="cues-${d}"></div><div id="mixes-next-${d}"></div><audio id="audio-${d}"></audio></div>`).join('')}`, { runScripts:'outside-only' });
  const { window } = dom;
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.eval(runtimeSrc);
  const state = { decks:{ a:{ cues:[], hotcues:[] }, b:{ cues:[], hotcues:[] } }, studioDecks:{} };
  const store = { data:{}, setItem(k, v){ this.data[k] = v; } };
  const rt = window.DJBattleDeckRuntime.create({ window, document:window.document, state, localStorage:store, esc:s => String(s), ...extra });
  return { window, rt, state, store, doc:window.document };
}

test('pitch changes playbackRate with pitch not preserved and shows %', () => {
  const { rt, doc } = makeRuntime();
  doc.getElementById('pitch-a').value = '1.04';
  rt.applyPitch('a');
  const audio = doc.getElementById('audio-a');
  assert.strictEqual(audio.playbackRate, 1.04);
  assert.strictEqual(audio.defaultPlaybackRate, 1.04);
  assert.strictEqual(audio.preservesPitch, false);
  assert.strictEqual(doc.getElementById('pitch-out-a').textContent, '+4.0%');
});

test('crossfader uses equal-power curve and blends element volume before audio graph exists', () => {
  const { rt, doc } = makeRuntime();
  const c = rt.crossfadeCurve(0);
  assert.ok(Math.abs(c.a - Math.SQRT1_2) < 1e-6 && Math.abs(c.b - Math.SQRT1_2) < 1e-6);
  { const e = rt.crossfadeCurve(-1); assert.strictEqual(e.a, 1); assert.strictEqual(e.b, 0); }
  doc.getElementById('xfader').value = '1';
  rt.applyMix();
  assert.strictEqual(doc.getElementById('audio-a').volume, 0);
  assert.strictEqual(doc.getElementById('audio-b').volume, 1);
  assert.strictEqual(doc.getElementById('xfader-out').textContent, 'A 0% / B 100%');
});

test('hot cue pads: tap sets empty, tap jumps when set, right-click clears, persisted', () => {
  const { rt, doc, state, store, window } = makeRuntime();
  const audio = doc.getElementById('audio-a');
  rt.renderHotcuePads('a');
  assert.strictEqual(doc.querySelectorAll('#hotcue-pads-a .hotcue-pad').length, 4);
  audio.currentTime = 0;
  Object.defineProperty(audio, 'currentTime', { value:42.5, writable:true });
  doc.querySelector('[data-hotcue-pad="1"]').click();
  assert.strictEqual(state.decks.a.hotcues[0].slot, 1);
  assert.strictEqual(state.decks.a.hotcues[0].time, 42.5);
  assert.match(store.data.djBattleDecks, /"slot":1/);
  audio.currentTime = 3;
  doc.querySelector('[data-hotcue-pad="1"]').click();
  assert.strictEqual(audio.currentTime, 42.5);
  doc.querySelector('[data-hotcue-pad="1"]').dispatchEvent(new window.MouseEvent('contextmenu', { bubbles:true, cancelable:true }));
  assert.strictEqual(state.decks.a.hotcues.length, 0);
});

test('legacy hotcues without a slot fill pads in order', () => {
  const { rt, state } = makeRuntime();
  state.decks.b.hotcues = [{ pct:0.2 }, { pct:0.5 }];
  const slots = rt.hotcueSlots('b');
  assert.strictEqual(slots[0].pct, 0.2);
  assert.strictEqual(slots[1].pct, 0.5);
  assert.strictEqual(slots[2], null);
});

test('mixes well next lists matches, loads onto other deck, and has an empty state', () => {
  const tracks = {
    'my:1':{ libraryId:'my:1', title:'Base', bpm:128, key:'8A' },
    'my:2':{ libraryId:'my:2', title:'Match', bpm:127, key:'9A' },
    'my:3':{ libraryId:'my:3', title:'NoData', bpm:'--', key:'--' }
  };
  const loads = [];
  const { rt, state, doc } = makeRuntime({
    getLibraryTrackById:id => tracks[id], parseBpm:t => Number(t.bpm) || 0, trackTitle:t => t.title,
    compatibleTracksFor:base => base.libraryId === 'my:1' ? [tracks['my:2']] : []
  });
  rt.loadLibraryTrackToDeck = (id, deck) => loads.push([id, deck]);
  state.studioDecks.a = { trackId:'my:1' };
  const result = rt.renderMixesWellNext('a');
  assert.strictEqual(result.matches.length, 1);
  assert.match(doc.getElementById('mixes-next-a').textContent, /Match/);
  state.studioDecks.b = { trackId:'my:3' };
  assert.strictEqual(rt.renderMixesWellNext('b').empty, 'no-data');
  assert.match(doc.getElementById('mixes-next-b').textContent, /Add BPM and key/);
  assert.match(runtimeSrc, /loadLibraryTrackToDeck\(button\.dataset\.mixNext, otherDeck\)/);
});
