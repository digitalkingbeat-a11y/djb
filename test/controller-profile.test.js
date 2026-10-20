const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const windows = [];
test.after(() => windows.forEach(w => { try{ w.close(); }catch(e){} }));

const root = path.join(__dirname, '..');
const plain = o => JSON.parse(JSON.stringify(o));
const LOCAL_PROFILE_KEY = 'djBattleLocalProfile:local-profile-digital-king';

function loadAppDom(setup){
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(index, { url:'http://127.0.0.1/index.html', runScripts:'outside-only', pretendToBeVisual:true });
  const { window } = dom;
  window.alert = () => {};
  window.confirm = () => true;
  window.scrollTo = () => {};
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLDialogElement.prototype.showModal = function showModal(){ this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function close(){ this.removeAttribute('open'); };
  window.fetch = async () => ({ ok:false, status:503, text: async () => '{}', json: async () => ({}) });
  if(setup) setup(window);
  // Run the inline belt helper from index.html so window.setCurrentBelt exists like in the browser.
  const beltScript = Array.from(window.document.querySelectorAll('script:not([src])')).find(s => s.textContent.includes('setCurrentBelt'));
  if(beltScript) window.eval(beltScript.textContent);
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'].forEach(file => {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });
  windows.push(window);
  return window;
}

/* ---------- 1. MIDI Learn ---------- */

test('MIDI parser reads CC, note on and note off with 1-based channels', () => {
  const h = loadAppDom().__DJBattleTestHooks;
  assert.deepEqual({ ...h.midiParse([0xB0, 7, 100]) }, { type:'cc', channel:1, number:7, value:100 });
  assert.deepEqual({ ...h.midiParse([0x93, 36, 127]) }, { type:'note', channel:4, number:36, value:127, on:true });
  assert.equal(h.midiParse([0x90, 36, 0]).on, false);
  assert.equal(h.midiParse([0x80, 36, 64]).on, false);
  assert.equal(h.midiParse([0xF8]), null);
  assert.equal(h.midiParse([0xE0, 0, 64]), null);
});

test('Studio shows a Learn button for crossfader, pitch, volume, gain, EQ, play/cue and hot cues', () => {
  const window = loadAppDom(); const doc = window.document;
  const ids = window.__DJBattleTestHooks.midiLearnTargets().map(t => t.id);
  ['xfader', 'pitch-a', 'pitch-b', 'vol-a', 'vol-b', 'gain-a', 'eq-high-a', 'eq-mid-b', 'eq-low-b', 'play-a', 'cue-b', 'hotcue-a-1', 'hotcue-b-4'].forEach(id => {
    assert.ok(ids.includes(id), `${id} is learnable`);
    assert.ok(doc.querySelector(`[data-midi-learn="${id}"]`), `${id} has a Learn button`);
  });
  assert.match(doc.getElementById('midi-learn-panel').textContent, /0 of \d+ mapped/);
  assert.match(doc.getElementById('midi-learn-panel').textContent, /Press Scan MIDI/);
});

test('Learn maps a knob to the crossfader, moves it, and persists in localStorage', () => {
  const window = loadAppDom(); const doc = window.document; const h = window.__DJBattleTestHooks;
  doc.querySelector('[data-midi-learn="xfader"]').click();
  assert.equal(h.midiLearning(), 'xfader');
  assert.equal(doc.querySelector('[data-midi-learn="xfader"]').getAttribute('aria-pressed'), 'true');
  assert.match(doc.getElementById('midi-learn-panel').textContent, /Waiting for controller/);
  const learned = h.midiRoute([0xB0, 16, 30]);
  assert.equal(learned.learned, 'xfader');
  assert.equal(h.midiLearning(), null);
  assert.deepEqual(JSON.parse(window.localStorage.getItem('djBattleMidiLearn')).xfader, { type:'cc', channel:1, number:16 });
  assert.match(doc.querySelector('[data-learn-row="xfader"]').textContent, /CC 16 · Ch 1/);
  let inputEvents = 0;
  const xf = doc.getElementById('xfader');
  xf.addEventListener('input', () => { inputEvents++; });
  h.midiRoute([0xB0, 16, 127]);
  assert.equal(Number(xf.value), 1);
  h.midiRoute([0xB0, 16, 0]);
  assert.equal(Number(xf.value), -1);
  assert.equal(inputEvents, 2);
  // A different CC number does nothing.
  assert.equal(h.midiRoute([0xB0, 17, 64]), null);
});

test('mappings survive reload; a button note triggers Play and the same control re-learned moves', () => {
  const window = loadAppDom(win => {
    win.localStorage.setItem('djBattleMidiLearn', JSON.stringify({ 'play-a':{ type:'note', channel:1, number:11 } }));
  });
  const doc = window.document; const h = window.__DJBattleTestHooks;
  assert.deepEqual(plain(h.midiLearnMap())['play-a'], { type:'note', channel:1, number:11 });
  let clicks = 0;
  doc.querySelector('[data-play="a"]').addEventListener('click', () => { clicks++; });
  h.midiRoute([0x90, 11, 127]);
  h.midiRoute([0x80, 11, 0]); // release does not click again
  assert.equal(clicks, 1);
  // Re-using the same physical button for another control moves the binding.
  h.midiStartLearn('cue-a');
  h.midiRoute([0x90, 11, 127]);
  const map = plain(h.midiLearnMap());
  assert.equal(map['play-a'], undefined);
  assert.deepEqual(map['cue-a'], { type:'note', channel:1, number:11 });
});

test('Clear and Reset all remove mappings; Escape cancels learn', () => {
  const window = loadAppDom(); const doc = window.document; const h = window.__DJBattleTestHooks;
  h.midiStartLearn('pitch-a'); h.midiRoute([0xB0, 1, 64]);
  h.midiStartLearn('vol-b'); h.midiRoute([0xB1, 2, 64]);
  assert.equal(Object.keys(plain(h.midiLearnMap())).length, 2);
  doc.querySelector('[data-midi-clear="pitch-a"]').click();
  assert.deepEqual(Object.keys(plain(h.midiLearnMap())), ['vol-b']);
  doc.getElementById('midi-learn-reset').click();
  assert.deepEqual(plain(h.midiLearnMap()), {});
  assert.equal(window.localStorage.getItem('djBattleMidiLearn'), '{}');
  h.midiStartLearn('eq-low-a');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
  assert.equal(h.midiLearning(), null);
  assert.match(doc.getElementById('midi-learn-panel').textContent, /Learn cancelled/);
});

test('clear message when Web MIDI is unsupported or no controller is plugged in', async () => {
  const window = loadAppDom(); const doc = window.document; const h = window.__DJBattleTestHooks;
  Object.defineProperty(window.navigator, 'requestMIDIAccess', { configurable:true, value:undefined });
  await h.scanMidiControllers();
  assert.match(doc.getElementById('midi-learn-panel').textContent, /isn't supported in this browser/);
  const res = h.midiStartLearn('xfader');
  assert.equal(res.ok, false);
  assert.equal(h.midiLearning(), null);
  Object.defineProperty(window.navigator, 'requestMIDIAccess', { configurable:true, value:async () => ({ inputs:new Map() }) });
  await h.scanMidiControllers();
  assert.match(doc.getElementById('midi-learn-panel').textContent, /No MIDI controller found/);
});

test('a learned controller input reaches the module through onmidimessage', async () => {
  const window = loadAppDom(); const doc = window.document; const h = window.__DJBattleTestHooks;
  const input = { name:'Generic Surface' };
  Object.defineProperty(window.navigator, 'requestMIDIAccess', { configurable:true, value:async () => ({ inputs:new Map([['x', input]]) }) });
  await h.scanMidiControllers();
  h.midiStartLearn('gain-a');
  input.onmidimessage({ data:[0xB0, 21, 0] });
  assert.deepEqual(plain(h.midiLearnMap())['gain-a'], { type:'cc', channel:1, number:21 });
  input.onmidimessage({ data:[0xB0, 21, 127] });
  assert.equal(Number(doc.getElementById('gain-a').value), 1.4);
});

/* ---------- 2. Download recorded mix ---------- */

test('download filename uses battle title + date and is sanitized', () => {
  const h = loadAppDom().__DJBattleTestHooks;
  const d = new Date(2026, 9, 18, 12, 0, 0);
  assert.equal(h.recordingDownloadName('Friday Night: House / Battle!!', d), 'friday-night-house-battle-2026-10-18.webm');
  assert.equal(h.recordingDownloadName('Café Déjà Vu', d), 'cafe-deja-vu-2026-10-18.webm');
  assert.equal(h.recordingDownloadName('../../etc/passwd', d), 'etc-passwd-2026-10-18.webm');
  assert.equal(h.recordingDownloadName('', d), 'dj-battle-mix-2026-10-18.webm');
  assert.equal(h.recordingDownloadName('<<<>>>', d), 'dj-battle-mix-2026-10-18.webm');
  assert.ok(h.recordingDownloadName('x'.repeat(200), d).length <= 60 + '-2026-10-18.webm'.length);
});

test('Recording Review has a Download button that saves the take as .webm', () => {
  const window = loadAppDom(); const doc = window.document; const h = window.__DJBattleTestHooks;
  const btn = doc.getElementById('download-recording');
  assert.ok(btn, 'Download button exists in review');
  assert.ok(doc.getElementById('recording-review').contains(btn));
  assert.equal(btn.disabled, true, 'disabled before any take');
  assert.equal(h.downloadRecording().ok, false);
  window.lastRecordedMixFile = new window.File(['webm-bytes'], 'dj-battle-take-1.webm', { type:'audio/webm' });
  window.activeBattleSession = { id:'b1', title:'Tampa Bass Clash', genre:'House' };
  let created = null; let clicked = null;
  window.URL.createObjectURL = blob => { created = blob; return 'blob:test-take'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function(){ clicked = { href:this.href, download:this.download }; };
  window.updateRecordingUi();
  assert.equal(btn.disabled, false, 'enabled once a take exists');
  btn.click();
  assert.ok(created, 'object URL made from the take');
  assert.equal(clicked.href, 'blob:test-take');
  assert.match(clicked.download, /^tampa-bass-clash-\d{4}-\d{2}-\d{2}\.webm$/);
  window.activeBattleSession = null;
  window.localStorage.removeItem('djBattleActiveSession');
  const practice = h.downloadRecording();
  assert.match(practice.name, /^practice-mix-\d{4}-\d{2}-\d{2}\.webm$/);
});

/* ---------- 3. Real hometown on player cards ---------- */

test('no fake "Tampa" anywhere; player card shows only the real belt when hometown is empty', () => {
  const window = loadAppDom(); const doc = window.document;
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /Tampa/);
  assert.doesNotMatch(doc.getElementById('br-dj1-meta').textContent, /Tampa/);
  assert.equal(doc.getElementById('br-dj1-meta').textContent, 'White Belt');
  assert.equal(doc.getElementById('mini-meta1').textContent, 'White Belt');
  assert.doesNotMatch(doc.body.innerHTML, /Tampa/);
});

test('Edit Profile saves hometown and bio, and player cards show hometown + real belt', () => {
  const window = loadAppDom();
  const doc = window.document; const h = window.__DJBattleTestHooks;
  window.setCurrentBelt('Blue'); // the app sets this from real battle progress (XP)
  doc.getElementById('edit-profile-button').click();
  assert.ok(doc.getElementById('edit-profile-hometown'));
  assert.ok(doc.getElementById('edit-profile-bio'));
  doc.getElementById('edit-profile-name').value = 'DJ Nova';
  doc.getElementById('edit-profile-hometown').value = '  Atlanta,   GA ';
  doc.getElementById('edit-profile-bio').value = 'Jersey club and house blends.';
  doc.getElementById('save-profile').click();
  const saved = JSON.parse(window.localStorage.getItem(LOCAL_PROFILE_KEY));
  assert.equal(saved.hometown, 'Atlanta, GA');
  assert.equal(saved.bio, 'Jersey club and house blends.');
  assert.equal(h.currentUser().hometown, 'Atlanta, GA');
  assert.equal(doc.getElementById('br-dj1-meta').textContent, 'Atlanta, GA • Blue Belt');
  assert.equal(doc.getElementById('mini-meta1').textContent, 'Atlanta, GA • Blue Belt');
  assert.equal(doc.querySelector('#br-dj1 .belt').textContent, 'Blue');
  assert.match(doc.getElementById('profile-hero-about').textContent, /Atlanta, GA • Jersey club/);
  // Reopen: fields are prefilled.
  doc.getElementById('edit-profile-button').click();
  assert.equal(doc.getElementById('edit-profile-hometown').value, 'Atlanta, GA');
  // Clearing hometown omits it instead of faking one.
  doc.getElementById('edit-profile-hometown').value = '';
  doc.getElementById('save-profile').click();
  assert.equal(doc.getElementById('br-dj1-meta').textContent, 'Blue Belt');
  assert.equal(JSON.parse(window.localStorage.getItem(LOCAL_PROFILE_KEY)).hometown, undefined);
});

test('belt changes update the player card; overlong hometown is rejected', () => {
  const window = loadAppDom(win => { win.localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify({ displayName:'Kay', initials:'K', hometown:'Detroit' })); });
  const doc = window.document;
  assert.equal(doc.getElementById('br-dj1-meta').textContent, 'Detroit • White Belt');
  window.setCurrentBelt('Green');
  assert.equal(doc.getElementById('br-dj1-meta').textContent, 'Detroit • Green Belt');
  doc.getElementById('edit-profile-button').click();
  doc.getElementById('edit-profile-hometown').value = 'x'.repeat(61);
  doc.getElementById('save-profile').click();
  assert.match(doc.getElementById('edit-profile-error').textContent, /Hometown must be 60/);
});

/* ---------- 4. One-row phone menu ---------- */

test('phone bar has exactly five primary items plus a More button', () => {
  const window = loadAppDom(); const doc = window.document;
  const primary = Array.from(doc.querySelectorAll('#nav .nav-btn[data-phone-primary]')).map(b => b.dataset.view);
  assert.deepEqual(primary, ['battles', 'studio', 'library', 'community', 'profile']);
  const more = doc.getElementById('nav-more');
  assert.ok(more);
  assert.equal(more.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  assert.equal(more.getAttribute('aria-controls'), 'nav-more-sheet');
  assert.equal(more.classList.contains('nav-btn'), false, 'More is not a page link');
  // Every desktop nav item is still there (desktop unchanged).
  assert.equal(doc.querySelectorAll('#nav .nav-btn').length, 16);
});

test('More opens a sheet with the remaining pages; picking one navigates and closes', () => {
  const window = loadAppDom(); const doc = window.document; const h = window.__DJBattleTestHooks;
  doc.getElementById('nav-more').click();
  const sheet = doc.getElementById('nav-more-sheet');
  assert.equal(sheet.classList.contains('hidden'), false);
  assert.equal(sheet.getAttribute('role'), 'dialog');
  assert.equal(sheet.getAttribute('aria-modal'), 'true');
  assert.equal(doc.getElementById('nav-more').getAttribute('aria-expanded'), 'true');
  const views = Array.from(sheet.querySelectorAll('[data-more-view]')).map(b => b.dataset.moreView);
  assert.deepEqual(views, ['dashboard', 'rankings', 'tournaments', 'crews', 'watch', 'find-djs', 'messages', 'activity', 'store', 'practice', 'settings']);
  assert.equal(doc.activeElement, sheet.querySelector('[data-more-view]'));
  sheet.querySelector('[data-more-view="rankings"]').click();
  assert.equal(h.navMoreIsOpen(), false);
  assert.equal(doc.getElementById('rankings').classList.contains('active'), true);
  assert.equal(doc.getElementById('nav-more').classList.contains('active'), true, 'More is highlighted while on a More page');
  doc.querySelector('#nav .nav-btn[data-view="studio"]').click();
  assert.equal(doc.getElementById('nav-more').classList.contains('active'), false);
});

test('Escape and the backdrop close the More sheet and focus returns to More', () => {
  const window = loadAppDom(); const doc = window.document; const h = window.__DJBattleTestHooks;
  const more = doc.getElementById('nav-more');
  more.click();
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
  assert.equal(h.navMoreIsOpen(), false);
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  assert.equal(doc.activeElement, more);
  more.click();
  doc.querySelector('#nav-more-sheet .nav-more-backdrop').click();
  assert.equal(h.navMoreIsOpen(), false);
});

test('phone CSS keeps one row of six and hides the rest; desktop hides More', () => {
  const css = fs.readFileSync(path.join(root, 'professional-redesign.css'), 'utf8');
  assert.match(css, /\.nav-more-btn,\.nav-short\{display:none\}/);
  const phone = css.slice(css.lastIndexOf('/* ---- One-row phone menu ---- */'));
  assert.match(phone, /grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(phone, /\.nav-btn:not\(\[data-phone-primary\]\)\{display:none\}/);
});
