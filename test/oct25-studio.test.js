// Oct 25 Studio: recently played + play counts, favourites + notes, beat jump + loop roll,
// slip mode and key shift. All names below are SAMPLE DATA.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const TP = require('../studio/track_prefs.js');
const P = require('../studio/deck_perf.js');
const windows = [];
test.after(() => windows.forEach(w => { try{ w.close(); }catch(e){} }));

function memStore(){ const data = {}; return { data, getItem:k => (k in data ? data[k] : null), setItem(k, v){ data[k] = String(v); }, removeItem(k){ delete data[k]; } }; }

test('play counts, recently played order and the "played this set" marker', () => {
  let t = Date.parse('2026-10-25T12:00:00Z');
  const prefs = TP.create({ localStorage:memStore(), now:() => (t += 1000) });
  prefs.recordPlay('lib:a'); prefs.recordPlay('lib:b'); prefs.recordPlay('lib:a');
  assert.equal(prefs.get('lib:a').playCount, 2);
  assert.equal(prefs.get('lib:b').playCount, 1);
  assert.deepEqual(prefs.recentIds(), ['lib:a', 'lib:b']);
  assert.equal(prefs.playedThisSet('lib:a'), true);
  assert.equal(prefs.playedThisSet('lib:c'), false);
  prefs.newSet();
  assert.equal(prefs.playedThisSet('lib:a'), false, 'new set clears the marks');
  assert.equal(prefs.get('lib:a').playCount, 2, 'but keeps play counts');
  prefs.setContext('battle:b1', 'This battle'); prefs.recordPlay('lib:b');
  assert.equal(prefs.currentSet().key, 'battle:b1');
  assert.deepEqual(prefs.currentSet().trackIds, ['lib:b']);
});

test('favourites and private notes save on the device and survive a reload', () => {
  const store = memStore();
  const prefs = TP.create({ localStorage:store });
  prefs.toggleFavourite('lib:a');
  prefs.setNote('lib:a', 'drop at 1:12');
  prefs.setNote('lib:b', 'x'.repeat(900));
  const again = TP.create({ localStorage:store });
  assert.equal(again.get('lib:a').favourite, true);
  assert.equal(again.get('lib:a').note, 'drop at 1:12');
  assert.equal(again.get('lib:b').note.length, TP.NOTE_MAX);
  assert.deepEqual(again.favouriteIds(), ['lib:a']);
  again.toggleFavourite('lib:a');
  assert.deepEqual(again.favouriteIds(), []);
  assert.match(TP.badgesHtml({ playCount:3, note:'n' }, true, s => s), /▶ 3[\s\S]*✓ Played[\s\S]*📝/);
  assert.match(TP.starButtonHtml('lib:a', true, s => s), /aria-pressed="true"/);
});

test('device and server copies merge: newest edit wins, play count never goes down', () => {
  const m = TP.mergePrefs({ favourite:true, note:'old', playCount:5, editedAt:'2026-10-20T00:00:00Z' }, { note:'new', playCount:2, editedAt:'2026-10-24T00:00:00Z', lastPlayedAt:'2026-10-24T01:00:00Z' });
  assert.equal(m.favourite, undefined);
  assert.equal(m.note, 'new');
  assert.equal(m.playCount, 5);
  assert.equal(m.lastPlayedAt, '2026-10-24T01:00:00.000Z');
});

test('beat jump moves whole beats so the track stays on the beat', () => {
  // 120 BPM = 0.5 s per beat.
  assert.equal(P.beatJumpTarget(10.25, 4, 120, 200), 12.25);
  assert.equal(P.beatJumpTarget(10.25, -16, 120, 200), 2.25);
  assert.equal(P.beatJumpTarget(0.3, -4, 120, 200), 0.3, 'never before 0:00, steps back by whole beats');
  assert.equal(P.beatJumpTarget(199, 8, 120, 200), 199.5, 'never past the end');
  assert.equal(P.beatJumpTarget(5, 4, 0, 200), null, 'needs a BPM');
  assert.deepEqual(P.JUMP_SIZES, [1, 4, 8, 16]);
});

test('loop roll window snaps to the beat line and slip keeps a hidden clock running', () => {
  const w = P.rollWindow(10.3, 0.25, 120, 0);
  assert.equal(w.start, 10.25); assert.equal(w.end, 10.375);
  assert.deepEqual(P.ROLL_SIZES, [0.125, 0.25, 0.5, 1]);
  const s = P.createSlip(20, 1000);
  assert.equal(P.advanceSlip(s, 3000, 1, true, 300), 22);
  assert.equal(P.advanceSlip(s, 4000, 1.5, true, 300), 23.5, 'follows the deck speed');
  assert.equal(P.advanceSlip(s, 9000, 1, false, 300), 23.5, 'stands still while paused');
});

test('key shift: semitone steps on the Camelot wheel, clamped to ±6, ratio without tempo change', () => {
  assert.equal(P.shiftCamelot('8A', 1), '3A');
  assert.equal(P.shiftCamelot('8A', -1), '1A');
  assert.equal(P.shiftCamelot('12B', 2), '2B');
  assert.equal(P.shiftCamelot('8A', 12), P.shiftCamelot('8A', 6), 'clamped');
  assert.equal(P.clampShift(-9), -6);
  assert.ok(Math.abs(P.semitoneRatio(12) - Math.pow(2, 0.5)) < 1e-9);
  assert.equal(P.shiftLabel(0), '0'); assert.equal(P.shiftLabel(2), '+2'); assert.equal(P.shiftLabel(-3), '−3');
  assert.match(P.WORKLET_SOURCE, /registerProcessor\('djb-pitch-shift'/);
  assert.match(P.WORKLET_SOURCE, /Math\.abs\(ratio - 1\) < 1e-4/, 'clean bypass at 0');
});

function makeRuntime(){
  const dom = new JSDOM(`<input id="xfader" type="range" value="0"><input id="vol-a" value="1"><input id="vol-b" value="1">
    ${['a','b'].map(d => `<div class="deck" data-deck="${d}"><button data-cue="${d}">Cue</button><span id="key-${d}"></span><span id="bpm-${d}"></span><input id="pitch-${d}" type="range" value="1"><output id="pitch-out-${d}"></output><div class="wave" id="wave-${d}"></div><div id="hotcue-pads-${d}"></div><div><div id="cues-${d}"></div></div><div id="mixes-next-${d}"></div><audio id="audio-${d}"></audio></div>`).join('')}`, { runScripts:'outside-only' });
  const { window } = dom;
  windows.push(window);
  window.eval(read('studio/deck_perf.js'));
  window.eval(read('studio/deck_runtime.js'));
  ['a','b'].forEach(d => {
    const a = window.document.getElementById(`audio-${d}`);
    let ct = 0, paused = true;
    Object.defineProperty(a, 'currentTime', { get:() => ct, set:v => { ct = v; }, configurable:true });
    Object.defineProperty(a, 'duration', { get:() => 240, configurable:true });
    Object.defineProperty(a, 'paused', { get:() => paused, configurable:true });
    a.play = () => { paused = false; return Promise.resolve(); }; a.pause = () => { paused = true; };
  });
  const played = [];
  const tracks = { 'lib:1':{ libraryId:'lib:1', title:'Sample One', key:'8A', bpm:'120' }, 'lib:2':{ libraryId:'lib:2', title:'Sample Two', key:'3A', bpm:'120' }, 'lib:3':{ libraryId:'lib:3', title:'Sample Three', key:'8A', bpm:'120' } };
  const state = { decks:{ a:{ cues:[], hotcues:[] }, b:{ cues:[], hotcues:[] } }, studioDecks:{ a:{ trackId:'lib:1', bpm:'120', key:'8A' } } };
  const camelot = k => /^(1[0-2]|[1-9])[AB]$/.test(k) ? k : '';
  const compat = base => Object.values(tracks).filter(t => t.key === base.key);
  const rt = window.DJBattleDeckRuntime.create({ window, document:window.document, state, localStorage:memStore(), esc:s => String(s), setStudioRuleStatus(){},
    getLibraryTrackById:id => tracks[id], parseBpm:t => Number(t.bpm), compatibleTracksFor:compat, trackTitle:t => t.title, parseCamelotKey:camelot, keyBadgeHtml:k => `<b>${k}</b>`, onTrackPlayed:id => played.push(id) });
  rt.wireControls();
  return { window, rt, state, doc:window.document, played, audio:d => window.document.getElementById(`audio-${d}`) };
}

test('each deck gets jump, roll pads, slip and key controls', () => {
  const { doc } = makeRuntime();
  ['a','b'].forEach(d => {
    const w = doc.getElementById(`deck-perf-${d}`);
    assert.ok(w, `deck ${d} perf row`);
    assert.equal(w.querySelectorAll('[data-beatjump]').length, 2);
    assert.equal(w.querySelectorAll('.roll-pad').length, 4);
    assert.ok(w.querySelector('[data-slip]'));
    assert.equal(w.querySelectorAll('[data-keyshift]').length, 2);
  });
});

test('beat jump buttons move by the chosen size; loop moves with the jump', () => {
  const { rt, audio, doc } = makeRuntime();
  audio('a').currentTime = 10;
  assert.equal(rt.setJumpSize('a', 8).ok, true);
  doc.querySelector('#deck-perf-a [data-beatjump="1"]').click();
  assert.equal(audio('a').currentTime, 14);
  assert.equal(rt.beatJump('a', -1).to, 13.5);
  assert.equal(rt.setJumpSize('a', 3).ok, false);
});

test('loop roll repeats a slice while held, then drops back in where the track would be', () => {
  const { rt, audio } = makeRuntime();
  const a = audio('a'); a.currentTime = 30.1; a.play();
  const r = rt.rollStart('a', 0.5);
  assert.equal(r.ok, true); assert.equal(r.roll.start, 30); assert.equal(r.roll.end, 30.25);
  assert.equal(rt.isSlipping('a'), true);
  a.currentTime = 30.3; rt.enforceLoop('a');
  assert.ok(a.currentTime < 30.25, 'loops inside the roll');
  const end = rt.rollEnd('a');
  assert.equal(end.ok, true);
  assert.ok(end.resumedAt >= 30.1, 'resumes from the hidden position');
  assert.equal(rt.getLoop('a'), null);
});

test('slip mode: a loop snaps back to the hidden play position on exit', () => {
  const { rt, audio } = makeRuntime();
  const a = audio('a'); a.currentTime = 50; a.play();
  rt.toggleSlip('a', true);
  rt.toggleLoop('a');
  assert.equal(rt.isSlipping('a'), true);
  a.currentTime = 50.2;
  rt.exitLoop('a');
  assert.equal(rt.isSlipping('a'), false);
  assert.ok(a.currentTime >= 50, 'jumped to where the track would be');
  rt.toggleSlip('a', false); rt.toggleLoop('a'); assert.equal(rt.isSlipping('a'), false, 'no slip when off');
});

test('key shift updates the key display and "mixes well next" to the shifted key', async () => {
  const { rt, doc } = makeRuntime();
  rt.loadTrackToDeck({ title:'Sample One', key:'8A', bpm:'120', libraryId:'lib:1' }, 'a');
  const r = await rt.setKeyShift('a', 1);
  assert.equal(r.semitones, 1); assert.equal(r.key, '3A');
  assert.match(doc.getElementById('key-a').innerHTML, /3A[\s\S]*\+1/);
  const mixes = doc.getElementById('mixes-next-a').innerHTML;
  assert.match(mixes, /KEY 3A/); assert.match(mixes, /Sample Two/); assert.doesNotMatch(mixes, /Sample Three/);
  assert.equal((await rt.setKeyShift('a', 9)).semitones, 6);
  rt.loadTrackToDeck({ title:'Sample Three', key:'8A', bpm:'120', libraryId:'lib:3' }, 'a');
  assert.equal(rt.getKeyShift('a'), 0, 'a new track starts at 0');
});

test('playing a track counts once per load', () => {
  const { rt, played, state } = makeRuntime();
  state.studioDecks.a = { trackId:'lib:1' };
  rt.logDeckEvent('play', 'a'); rt.logDeckEvent('pause', 'a'); rt.logDeckEvent('play', 'a');
  assert.deepEqual(played, ['lib:1']);
});

test('app: Library crates, stars, notes, Studio filter, shortcuts, MIDI targets and offline cache', () => {
  const html = read('index.html');
  assert.match(html, /data-library-crate="favourites"/);
  assert.match(html, /data-library-crate="recent"/);
  assert.ok(html.indexOf('studio/track_prefs.js') < html.indexOf('<script src="app.js"'));
  assert.ok(html.indexOf('studio/deck_perf.js') < html.indexOf('studio/deck_runtime.js'));
  const sw = read('sw.js');
  assert.match(sw, /'studio\/track_prefs\.js'/); assert.match(sw, /'studio\/deck_perf\.js'/);
  const app = read('app.js');
  assert.match(app, /keys:\[k\.roll\]/); assert.match(app, /document\.addEventListener\('keyup'/);
  assert.match(app, /\/api\/musicLibrary\/tracks\/\$\{encodeURIComponent\(editable\.track\.id\)\}\/prefs/);
  const midi = read('studio/controller_mapping.js');
  ['jump-back-', 'jump-fwd-', 'slip-', 'key-down-', 'key-up-', 'roll-'].forEach(id => assert.ok(midi.includes(id), id));
  assert.match(midi, /target\.kind === 'hold'/);
  const css = read('hardware.css');
  assert.match(css, /\.roll-pad\{[^}]*touch-action:none/);
  assert.match(css, /@media \(max-width:760px\)[\s\S]*\.roll-pad\{min-width:48px;min-height:48px/);
});

function loadAppDom(){
  const dom = new JSDOM(read('index.html'), { url:'https://127.0.0.1/index.html', runScripts:'outside-only', pretendToBeVisual:true });
  const { window } = dom;
  window.alert = () => {}; window.confirm = () => true; window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = function(){};
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLDialogElement.prototype.showModal = function(){ this.setAttribute('open', ''); this.open = true; };
  window.HTMLDialogElement.prototype.close = function(){ this.removeAttribute('open'); this.open = false; };
  window.fetch = async () => ({ ok:false, status:503, text:async () => '{}', json:async () => ({}) });
  window.matchMedia = q => ({ matches:false, media:q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} });
  const beltScript = Array.from(window.document.querySelectorAll('script:not([src])')).find(s => s.textContent.includes('setCurrentBelt'));
  if(beltScript) window.eval(beltScript.textContent);
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/beatmatch_lessons.js', 'studio/track_prefs.js', 'studio/deck_perf.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'].forEach(f => window.eval(read(f)));
  windows.push(window);
  return window;
}

test('full app: starring a track fills the Favourites crate and the Studio filter; notes save', () => {
  const w = loadAppDom();
  const doc = w.document;
  assert.ok(doc.getElementById('deck-perf-a'), 'deck A perf row in the real Studio');
  assert.ok(doc.getElementById('deck-perf-b'));
  const hooks = w.__DJBattleTestHooks;
  const shortcuts = hooks.STUDIO_SHORTCUTS.map(s => s.keys[0]);
  ['a','s','d','f','z','c','j','k','l',';','n','m'].forEach(k => assert.ok(shortcuts.includes(k), `shortcut ${k}`));
  assert.equal(shortcuts[shortcuts.length - 1], '?', 'help stays last');
  w.eval('renderLibrary()');
  const star = doc.querySelector('#library-table [data-tp-star]');
  assert.ok(star, 'stars in the Library');
  const id = star.dataset.tpStar;
  star.click();
  assert.equal(w.djbTrackPrefs.get(id).favourite, true);
  assert.equal(doc.getElementById('crate-count-favourites').textContent, '1');
  hooks.getAppState().libraryFilters.crate = 'favourites'; w.eval('renderLibrary()');
  assert.equal(doc.querySelectorAll('#library-table tr[data-library-row]').length, 1);
  w.eval(`selectLibraryTrack(${JSON.stringify(id)}, { loadPlayer:false })`);
  const note = doc.getElementById('track-note-input');
  assert.ok(note, 'private note box');
  note.value = 'drop at 1:12 (SAMPLE)'; note.dispatchEvent(new w.Event('blur'));
  assert.equal(w.djbTrackPrefs.get(id).note, 'drop at 1:12 (SAMPLE)');
  hooks.getAppState().studioLibrarySource = 'MY_LIBRARY'; w.eval("renderStudioLibrary('')");
  const fav = doc.querySelector('#studio-prefs-filter [data-prefs-filter="favourites"]');
  assert.ok(fav); fav.click();
  const rows = doc.querySelectorAll('#studio-library-table tr[data-studio-idx]');
  assert.equal(rows.length, 1);
  assert.match(rows[0].innerHTML, /tp-star on/);
  assert.match(rows[0].innerHTML, /📝/);
  w.eval(`onStudioTrackPlayed(${JSON.stringify(id)})`);
  doc.querySelector('#studio-prefs-filter [data-prefs-filter="recent"]').click();
  const recent = doc.querySelectorAll('#studio-library-table tr[data-studio-idx]');
  assert.equal(recent.length, 1);
  assert.match(recent[0].innerHTML, /✓ Played/); assert.match(recent[0].innerHTML, /▶ 1/);
});
