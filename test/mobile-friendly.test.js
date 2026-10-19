// Phone-friendly pass: file-picker autofill, floating player minimize, folded Studio sections,
// friendlier "not connected" messages, and the phone-only CSS that keeps every page on screen.
const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const windows = [];
test.after(() => windows.forEach(w => { try{ w.close(); }catch(e){} }));

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'professional-redesign.css'), 'utf8');

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
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'].forEach(file => {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });
  windows.push(window);
  return window;
}

async function waitFor(fn, ms = 2000){
  const end = Date.now() + ms;
  while(Date.now() < end){ const v = fn(); if(v) return v; await new Promise(r => setTimeout(r, 10)); }
  return fn();
}

// The phone block: everything after the "Phone-friendly pass" marker.
const phoneCss = css.slice(css.indexOf('Phone-friendly pass'));

test('picking files with Upload Tracks fills Title and Artist from "Artist - Title" like drag-and-drop', async () => {
  const window = loadAppDom(); const doc = window.document; const h = window.__DJBattleTestHooks;
  const input = doc.getElementById('library-upload');
  const file = new window.File([new Uint8Array(64)], 'DJ Nova - Night Drive.mp3', { type:'audio/mpeg' });
  Object.defineProperty(input, 'files', { value:[file], configurable:true });
  input.dispatchEvent(new window.Event('change'));
  await waitFor(() => doc.getElementById('meta-title'));
  assert.equal(doc.getElementById('meta-title').value, 'Night Drive');
  assert.equal(doc.getElementById('meta-artist').value, 'DJ Nova');
  assert.equal(typeof h.handleLibraryPickedFiles, 'function');
});

test('picker skips non-audio files with the same message as drag-and-drop', async () => {
  const window = loadAppDom(); const doc = window.document; const h = window.__DJBattleTestHooks;
  const pdf = new window.File([new Uint8Array(8)], 'flyer.pdf', { type:'application/pdf' });
  const result = await h.handleLibraryPickedFiles([pdf]);
  assert.equal(result.ok, false);
  assert.match(doc.body.textContent, /Not an audio file/);
});

test('floating player has a minimize toggle that remembers its state', () => {
  const window = loadAppDom(); const doc = window.document; const h = window.__DJBattleTestHooks;
  const btn = doc.getElementById('library-player-minimize');
  const player = doc.getElementById('library-player');
  assert.ok(btn);
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  btn.click();
  assert.equal(player.classList.contains('is-minimized'), true);
  assert.equal(doc.body.classList.contains('player-minimized'), true);
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(window.localStorage.getItem('djBattlePlayerMinimized'), '1');
  btn.click();
  assert.equal(h.libraryPlayerMinimized(), false);
  assert.equal(window.localStorage.getItem('djBattlePlayerMinimized'), '0');
  // A fresh load restores the saved state.
  const again = loadAppDom(win => win.localStorage.setItem('djBattlePlayerMinimized', '1'));
  assert.equal(again.document.getElementById('library-player').classList.contains('is-minimized'), true);
});

test('Studio Mixer and Hardware fold on phones with a Show/Hide toggle', () => {
  const window = loadAppDom(); const doc = window.document;
  const mixer = doc.querySelector('#studio .professional-mixer');
  const hw = doc.getElementById('controller-panel');
  const mixBtn = doc.querySelector('[data-phone-section="mixer"]');
  const hwBtn = doc.querySelector('[data-phone-section="hardware"]');
  assert.ok(mixBtn && hwBtn);
  assert.equal(mixer.classList.contains('phone-collapsed'), true);
  assert.equal(hw.classList.contains('phone-collapsed'), true);
  assert.equal(mixBtn.textContent, 'Show full mixer');
  mixBtn.click();
  assert.equal(mixer.classList.contains('phone-collapsed'), false);
  assert.equal(mixBtn.getAttribute('aria-expanded'), 'true');
  assert.equal(mixBtn.textContent, 'Hide full mixer');
  window.__DJBattleTestHooks.setupPhoneStudioSections();
  assert.equal(doc.querySelectorAll('[data-phone-section="mixer"]').length, 1, 'setup is idempotent');
  // The crossfader stays out of the folded list, so it is always reachable.
  assert.doesNotMatch(phoneCss, /phone-collapsed>\.crossfader/);
});

test('Studio labels have real spaces: MIXER MASTER, Guest VS Solo Mode, mode + belt on separate words', () => {
  const window = loadAppDom(); const doc = window.document;
  assert.equal(doc.querySelector('.mixer-head').textContent.replace(/\s+/g, ' ').trim(), 'MIXER MASTER');
  assert.match(doc.querySelector('.mini-battle-line').textContent.replace(/\s+/g, ' '), /^Guest VS Solo Mode$/);
  const metaWrap = doc.getElementById('mini-meta2').parentElement.textContent;
  assert.doesNotMatch(metaWrap, /modeWhite/);
});

test('Notifications says "Not connected" in plain words instead of the Supabase error, and has its own title', async () => {
  const window = loadAppDom(); const doc = window.document; const h = window.__DJBattleTestHooks;
  h.switchView('notifications');
  assert.equal(doc.getElementById('page-title').textContent, 'Notifications');
  await waitFor(() => /Not connected/.test(doc.getElementById('notification-center').textContent));
  const text = doc.getElementById('notification-center').textContent;
  assert.doesNotMatch(text, /Supabase/);
  assert.match(text, /Not connected/);
  assert.match(text, /No notifications yet/);
});

test('Beat Store 404 shows a friendly message, not "Request failed (404)"', async () => {
  const window = loadAppDom(); const doc = window.document; const h = window.__DJBattleTestHooks;
  window.DJBattleApi.apiRequest = async () => ({ error:'Request failed (404)', status:404 });
  h.switchView('store');
  if(h.loadBeatStore) await h.loadBeatStore({ reset:true });
  await new Promise(r => setTimeout(r, 10));
  const status = doc.getElementById('store-status').textContent;
  assert.doesNotMatch(status, /404|Request failed/);
  assert.match(status, /isn't available on this server yet|isn't connected|isn't switched on|Can't reach/);
});

test('phone CSS: shrinkable grids, scrolling tabs, wrapping rows, player above the menu, 44px targets', () => {
  assert.ok(phoneCss.length > 1000, 'phone block present');
  assert.match(phoneCss, /@media\(max-width:760px\)\{/);
  ['.music-library-workstation', '.community-layout', '.rankings-shell', '.saved-searches'].forEach(sel => assert.ok(phoneCss.includes(sel), sel));
  assert.match(phoneCss, /grid-template-columns:minmax\(0,1fr\)!important/);
  assert.match(phoneCss, /\.profile-tabs\{flex-wrap:nowrap;overflow-x:auto/);
  assert.match(phoneCss, /\.post-foot\{flex-wrap:wrap/);
  assert.match(phoneCss, /\.library-player\{left:8px;right:8px;bottom:calc\(72px/);
  assert.match(phoneCss, /\.recording-review \.modal-actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(phoneCss, /min-height:44px/);
  assert.match(phoneCss, /\.library-table-wrap thead,\n\s*\.studio-table-wrap thead\{display:none\}/);
  assert.match(phoneCss, /@media \(hover:none\) and \(pointer:coarse\)\{\n\s*#studio-shortcuts-button\{display:none!important\}/);
  // Desktop helpers stay hidden outside the phone block.
  assert.match(css, /\.phone-section-toggle,\n\.library-player-minimize\{display:none\}/);
});
