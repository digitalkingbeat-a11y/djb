// Nov 9 five: per-track cues, track edit, find missing BPMs, sortable headers, Watch Live refresh.
const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const windows = [];
test.after(() => windows.forEach(w => { try{ w.close(); }catch(e){} }));

function loadApp(setup){
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url:'http://127.0.0.1/index.html', runScripts:'outside-only', pretendToBeVisual:true });
  const { window } = dom;
  window.alert = () => {};
  window.confirm = () => true;
  window.scrollTo = () => {};
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLDialogElement.prototype.showModal = function(){ this.setAttribute('open',''); };
  window.HTMLDialogElement.prototype.close = function(){ this.removeAttribute('open'); };
  window.fetch = async () => ({ ok:false, status:503, text:async()=> '{}', json:async()=>({}) });
  if(setup) setup(window);
  const files = ['api_client.js','submission_upload.js','battle_modes.js','studio/studio_pro.js','studio/studio_recording.js','studio/controller_mapping.js','studio/audio_setup.js','studio/streaming.js','studio/playlist_transfer.js','studio/studio_browser.js','studio/deck_runtime.js','connect.js','app.js'];
  files.forEach(file => {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    window.eval(file === 'app.js' ? `${code}\n;window.__inApp = source => eval(source);` : code);
  });
  windows.push(window);
  return window;
}

test('markup: Find missing BPMs, sortable headers, Edit wiring targets', () => {
  const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(html, /id="library-find-missing-bpm"/);
  assert.match(html, /id="library-missing-bpm-progress"/);
  assert.match(html, /data-library-sort="title"/);
  assert.match(html, /data-library-sort="artist"/);
  assert.match(html, /data-library-sort="bpm"/);
  assert.match(html, /data-library-sort="key"/);
  assert.match(html, /data-studio-sort="title"/);
  const app = fs.readFileSync(path.join(root,'app.js'),'utf8');
  assert.match(app, /function openTrackEditModal/);
  assert.match(app, /function findMissingBpms/);
  assert.match(app, /function syncDeckCuesToTrack/);
  assert.match(app, /function applyTrackCuesToDeck/);
  const connect = fs.readFileSync(path.join(root,'connect.js'),'utf8');
  assert.match(connect, /WATCH_LIST_MS/);
  assert.match(connect, /visibilitychange/);
  assert.match(connect, /loadLiveBattlesQuiet/);
});

test('track edit validation requires a title and a sane BPM', () => {
  const w = loadApp();
  const h = w.__DJBattleTestHooks;
  assert.equal(h.validateTrackEditFields({ title:'', artist:'A' }).ok, false);
  assert.equal(h.validateTrackEditFields({ title:'Ok', bpm:10 }).ok, false);
  const ok = h.validateTrackEditFields({ title:' Night ', artist:'DJ', genre:'House', bpm:'128.4', key:'8A' });
  assert.equal(ok.ok, true);
  assert.equal(ok.patch.title, 'Night');
  assert.equal(ok.patch.bpm, 128.4);
  assert.equal(ok.patch.bpmSource, 'manual');
});

test('cues save onto the track and restore onto either deck', () => {
  const w = loadApp();
  w.__inApp(`state.library.push({ id:'cue-1', libraryId:'my:cue-1', title:'Cue Track', name:'Cue Track', artist:'A', bpm:120, key:'8A', source:'MY_LIBRARY', _libraryOrigin:'my' });
    state.studioDecks = state.studioDecks || { a:{}, b:{} };
    state.studioDecks.a = { trackId:'my:cue-1', title:'Cue Track' };
    state.decks.a = { cues:[{ time:12.5, created:1 }], hotcues:[{ slot:0, time:12.5, pct:0.1, created:1 }] };`);
  const h = w.__DJBattleTestHooks;
  const saved = h.syncDeckCuesToTrack('a');
  assert.equal(saved.ok, true);
  assert.ok(w.__inApp(`const t = state.library.find(x => x.id==='cue-1'); t.cues.length === 1 && t.hotcues.length === 1`));
  // Clear deck and restore from track onto deck B
  w.__inApp(`state.decks.b = { cues:[], hotcues:[] };`);
  const applied = h.applyTrackCuesToDeck('my:cue-1', 'b');
  assert.equal(applied.ok, true);
  assert.equal(w.__inApp('state.decks.b.cues.length'), 1);
  assert.equal(w.__inApp('state.decks.b.hotcues[0].slot'), 0);
});

test('migrate copies deck-only cues onto a track that has none', () => {
  const w = loadApp();
  w.__inApp(`state.library.push({ id:'mig-1', libraryId:'my:mig-1', title:'Old Cue', name:'Old Cue', artist:'A', source:'MY_LIBRARY', _libraryOrigin:'my' });
    state.studioDecks = { a:{ trackId:'my:mig-1' }, b:{} };
    state.decks.a = { cues:[{ time:3, created:1 }], hotcues:[] };
    state.decks.b = { cues:[], hotcues:[] };`);
  const result = w.__DJBattleTestHooks.migrateDeckCuesToTracks();
  assert.equal(result.moved, 1);
  assert.equal(w.__inApp('state.library.find(t => t.id==="mig-1").cues.length'), 1);
});

test('sortable headers toggle direction and remember the choice', () => {
  const w = loadApp();
  w.__inApp(`state.library = [
    { id:'1', libraryId:'my:1', title:'Bravo', artist:'Zed', bpm:140, key:'1A', source:'MY_LIBRARY', _libraryOrigin:'my', genre:'X' },
    { id:'2', libraryId:'my:2', title:'Alpha', artist:'Ann', bpm:120, key:'8A', source:'MY_LIBRARY', _libraryOrigin:'my', genre:'X' }
  ]; state.librarySort = { field:'title', direction:'asc' };`);
  w.__DJBattleTestHooks.wireLibrarySortHeaders();
  const th = w.document.querySelector('[data-library-sort="title"]');
  assert.ok(th);
  th.click(); // same field -> reverse to desc
  assert.equal(w.__inApp('state.librarySort.direction'), 'desc');
  const remembered = w.localStorage.getItem('djBattleLibrarySort');
  assert.match(remembered, /"direction":"desc"/);
  const artist = w.document.querySelector('[data-library-sort="artist"]');
  artist.click();
  assert.equal(w.__inApp('state.librarySort.field'), 'artist');
  assert.equal(w.__inApp('state.librarySort.direction'), 'asc');
});

test('Watch Live pauses timers when the page is hidden and exposes list auto-refresh', () => {
  const connect = fs.readFileSync(path.join(root,'connect.js'),'utf8');
  assert.match(connect, /WATCH_LIST_MS = 8000/);
  assert.match(connect, /visibilitychange/);
  assert.match(connect, /if\(D\.hidden\) stopWatchTimers/);
  assert.match(connect, /function loadLiveBattlesQuiet/);
  assert.match(connect, /startWatchTimers\(\);\n    return r;/); // list load starts timers
  const w = loadApp();
  assert.equal(typeof w.DJBConnect.watchPageVisible, 'function');
  assert.equal(typeof w.DJBConnect.startWatchTimers, 'function');
  assert.equal(typeof w.DJBConnect.stopWatchTimers, 'function');
});

test('Find missing BPMs skips tracks that already have a tempo', async () => {
  const w = loadApp();
  w.__inApp(`state.library = [
    { id:'has', libraryId:'my:has', title:'Has', artist:'A', bpm:128, source:'MY_LIBRARY', _libraryOrigin:'my' },
    { id:'miss', libraryId:'my:miss', title:'Miss', artist:'A', bpm:'--', source:'MY_LIBRARY', _libraryOrigin:'my' }
  ];`);
  const h = w.__DJBattleTestHooks;
  assert.equal(h.trackNeedsBpm(w.__inApp('state.library[0]')), false);
  assert.equal(h.trackNeedsBpm(w.__inApp('state.library[1]')), true);
});

test('deck runtime wires per-track cue sync hooks', () => {
  const src = fs.readFileSync(path.join(root,'studio/deck_runtime.js'),'utf8');
  assert.match(src, /deps\.syncDeckCuesToTrack/);
  assert.match(src, /deps\.applyTrackCuesToDeck/);
  assert.match(src, /deps\.migrateDeckCuesToTracks/);
});
