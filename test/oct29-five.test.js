// Oct 29: EQ kill buttons, profile QR code, social links, Save as WAV, music rights tick.
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
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js', 'social.js', 'beat_store_five.js', 'sales_chart.js', 'automix.js', 'share_links.js', 'studio_five.js', 'assets/vendor/qrcode.js', 'oct29_five.js'].forEach(file => {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });
  windows.push(window);
  return window;
}
const quietLoad = (opts = {}) => loadAppDom({ ...opts, setup:w => { w.__DJBattleSkipReturnLinks = true; if(opts.setup) opts.setup(w); } });

const read = f => fs.readFileSync(path.join(root, f), 'utf8');

/* ---------- 1. EQ kill ---------- */
test('EQ kill: every deck has bass/mids/highs kill buttons that toggle and restore the slider', () => {
  const w = quietLoad();
  w.__DJBattleTestHooks.switchView('studio');
  const doc = w.document;
  ['a', 'b'].forEach(d => ['high', 'mid', 'low'].forEach(band => {
    const btn = doc.querySelector(`[data-eq-kill="${band}"][data-deck="${d}"]`);
    assert.ok(btn, `${d} ${band}`);
    assert.equal(btn.getAttribute('aria-pressed'), 'false');
    assert.equal(btn.type, 'button');
  }));
  const rt = w.__DJBattleTestHooks.getDeckRuntime();
  const slider = doc.getElementById('eq-low-a') || doc.querySelector('[data-eq="low"][data-deck="a"], #low-a, input[id*="low"][id*="a"]');
  if(slider){ slider.value = '3'; slider.dispatchEvent(new w.Event('input')); }
  const before = slider ? slider.value : null;
  let r = rt.toggleEqKill('a', 'low');
  assert.equal(r.ok, true); assert.equal(r.killed, true);
  const btn = doc.querySelector('[data-eq-kill="low"][data-deck="a"]');
  assert.ok(btn.classList.contains('active'));
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  assert.ok(btn.closest('.eq-band').classList.contains('eq-killed'));
  assert.equal(plain(rt.eqKillState('a')).low, true);
  assert.equal(plain(rt.eqKillState('b')).low, false, 'other deck untouched');
  if(slider) assert.equal(slider.value, before, 'slider value is kept while killed');
  btn.onclick({ preventDefault(){}, stopPropagation(){} });
  assert.equal(plain(rt.eqKillState('a')).low, false);
  assert.ok(!btn.classList.contains('active'));
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  if(slider) assert.equal(slider.value, before, 'second tap restores the slider setting');
  assert.equal(rt.toggleEqKill('a', 'nope').ok, false);
});

/* ---------- 2. QR ---------- */
test('QR: made locally (vendored MIT library), scannable size, quiet zone, safe file name', () => {
  const w = quietLoad();
  const Q = w.DJBattleProfileQr;
  assert.equal(typeof w.qrcode, 'function', 'vendored library loaded');
  const m = Q.qrMatrix('https://example.com/#dj=dj_0123456789abcdef');
  assert.ok(m && m.length >= 21 && m.length % 4 === 1, 'valid QR version size');
  // Finder pattern corners are dark.
  assert.equal(m[0][0], true); assert.equal(m[0][m.length - 1], true); assert.equal(m[m.length - 1][0], true);
  const svg = Q.qrSvg(m);
  assert.match(svg, new RegExp(`viewBox="0 0 ${m.length + 8} ${m.length + 8}"`));
  assert.equal(Q.qrMatrix(''), null);
  assert.equal(Q.qrFileName('DJ <Dan> "Ü"'), 'dj-dan-u-profile-qr.png');
  assert.equal(Q.qrFileName(''), 'dj-profile-qr.png');
  const src = read('oct29_five.js');
  assert.doesNotMatch(src, /https?:\/\/(api\.qrserver|chart\.googleapis|quickchart)/, 'no outside QR service');
  assert.match(read('assets/vendor/qrcode.js'), /MIT license/);
});

test('QR: button on the Profile; guests are told to sign in, signed-in DJs get the code + PNG button', () => {
  const w = quietLoad();
  const doc = w.document;
  const btn = doc.getElementById('profile-qr-button');
  assert.ok(btn); assert.equal(btn.textContent, 'Show my QR code');
  btn.click();
  assert.ok(doc.getElementById('profile-qr-local-note'));
  w.currentProfileShareUrl = () => 'https://djb.example/#dj=dj_abc"<x>';
  const r = w.DJBattleProfileQr.openProfileQr();
  assert.equal(r.ok, true);
  assert.ok(doc.querySelector('#profile-qr-frame svg.profile-qr-svg'));
  assert.equal(doc.querySelector('#profile-qr-link').textContent, 'https://djb.example/#dj=dj_abc"<x>');
  assert.equal(doc.querySelector('#profile-qr-link x'), null, 'link text is escaped');
  assert.ok(doc.getElementById('profile-qr-download'));
  // jsdom has no canvas: the download reports it cleanly instead of throwing.
  assert.equal(doc.getElementById('profile-qr-download').onclick().ok, false);
  ['index.html', 'sw.js'].forEach(f => { assert.match(read(f), /assets\/vendor\/qrcode\.js/); assert.match(read(f), /oct29_five\.js/); });
  assert.match(read('scripts/build-pages.js'), /'oct29_five\.js'/);
});

/* ---------- 3. Social links ---------- */
test('social links: https on the right site, or @handle turned into the full link; everything else refused', () => {
  const w = quietLoad();
  const c = (k, v) => plain(w.cleanSocialLink(k, v));
  assert.equal(c('instagram', '@dj.dan').value, 'https://instagram.com/dj.dan');
  assert.equal(c('instagram', 'https://www.instagram.com/djdan/').value, 'https://www.instagram.com/djdan');
  assert.equal(c('soundcloud', 'djdan').value, 'https://soundcloud.com/djdan');
  assert.equal(c('soundcloud', 'soundcloud.com/djdan/sets/live').value, 'https://soundcloud.com/djdan/sets/live');
  assert.equal(c('mixcloud', '@DJDan').value, 'https://mixcloud.com/DJDan');
  assert.equal(c('tiktok', '@djdan').value, 'https://tiktok.com/@djdan');
  assert.equal(c('tiktok', 'https://www.tiktok.com/@djdan?is_from=x#y').value, 'https://www.tiktok.com/@djdan', 'tracking bits dropped');
  assert.equal(c('tiktok', '').value, '');
  [['instagram', 'http://instagram.com/x'], ['instagram', 'javascript:alert(1)'], ['instagram', 'https://evil.com/instagram.com'], ['soundcloud', 'https://soundcloud.com.evil.com/a'],
   ['mixcloud', 'https://mixcloud.com/'], ['tiktok', '@dj<script>'], ['instagram', 'https://user@instagram.com/x'], ['soundcloud', '@has space'], ['tiktok', 'https://tiktok.com:8443/@x'], ['instagram', 'https://instagram.com/' + 'a'.repeat(200)]]
    .forEach(([k, v]) => assert.ok(c(k, v).error, `${k} ${v}`));
});

test('social links: Edit Profile saves them, hero shows icon links, public profile shows them safely', async () => {
  const w = quietLoad();
  const doc = w.document;
  w.openEditProfileModal();
  ['instagram', 'soundcloud', 'mixcloud', 'tiktok'].forEach(k => assert.ok(doc.getElementById(`edit-profile-${k}`), k));
  doc.getElementById('edit-profile-name').value = 'DJ Dan';
  doc.getElementById('edit-profile-instagram').value = 'https://evil.com/x';
  let result = doc.getElementById('save-profile').onclick();
  assert.match(result.error, /Instagram/);
  doc.getElementById('edit-profile-instagram').value = '@djdan';
  doc.getElementById('edit-profile-tiktok').value = '@djdan';
  doc.getElementById('edit-profile-soundcloud').value = 'soundcloud.com/djdan';
  result = doc.getElementById('save-profile').onclick();
  assert.ok(!result.error, result.error);
  const u = w.currentUser();
  assert.equal(u.instagram, 'https://instagram.com/djdan');
  assert.equal(u.tiktok, 'https://tiktok.com/@djdan');
  assert.equal(u.mixcloud, '');
  const hero = doc.getElementById('profile-hero-links');
  const links = [...hero.querySelectorAll('a.profile-social-link')];
  assert.deepEqual(links.map(a => a.getAttribute('href')), ['https://instagram.com/djdan', 'https://soundcloud.com/djdan', 'https://tiktok.com/@djdan']);
  links.forEach(a => { assert.equal(a.getAttribute('rel'), 'noopener noreferrer'); assert.equal(a.getAttribute('target'), '_blank'); assert.ok(a.getAttribute('aria-label')); });
  w.openEditProfileModal();
  assert.equal(doc.getElementById('edit-profile-instagram').value, 'https://instagram.com/djdan');
  w.renderPublicDjProfile({ publicProfileId:'dj_0123456789abcdef', displayName:'SAMPLE DJ', stats:{}, mixcloud:'https://mixcloud.com/sample', instagram:'javascript:alert(1)', tiktok:'https://tiktok.com/@x"onmouseover="alert(1)' }, 'server');
  const mod = doc.querySelector('#modal .public-profile-links');
  assert.ok(mod);
  assert.deepEqual([...mod.querySelectorAll('a.profile-social-link')].map(a => a.getAttribute('href')), ['https://mixcloud.com/sample']);
  assert.equal(mod.querySelector('[onmouseover]'), null);
});

test('social links: signed-in save sends them to the account and copes with the server before 056', async () => {
  const w = quietLoad();
  const calls = [];
  let reply = { data:{ success:true, links:{} } };
  w.DJBattleApi.apiRequest = async (url, opts = {}) => { calls.push({ url, opts }); return reply; };
  let out = await w.syncProfileLinksToServer({ signedIn:true, id:'u1', website:'', bookingInfo:'', instagram:'https://instagram.com/djdan', soundcloud:'', mixcloud:'', tiktok:'https://tiktok.com/@djdan' });
  assert.equal(out.saved, true);
  assert.deepEqual(plain(calls[0].opts.body), { website:'', bookingInfo:'', instagram:'https://instagram.com/djdan', soundcloud:'', mixcloud:'', tiktok:'https://tiktok.com/@djdan' });
  reply = { data:{ success:true, links:{}, socialSchemaMissing:true } };
  out = await w.syncProfileLinksToServer({ signedIn:true, id:'u1', instagram:'https://instagram.com/djdan' });
  assert.equal(out.socialLocalOnly, true);
});

/* ---------- 4. WAV ---------- */
test('WAV: encoder writes a correct 16-bit PCM RIFF header and clamps samples', () => {
  const w = quietLoad();
  const R = w.DJBattleStudioRecording;
  const L = new Float32Array([0, 1, -1, 2]); const Rt = new Float32Array([0.5, -0.5, 0, -3]);
  const buf = R.encodeWav([L, Rt], 48000);
  const v = new DataView(buf);
  const s = (o, n) => String.fromCharCode(...new Uint8Array(buf, o, n));
  assert.equal(s(0, 4), 'RIFF'); assert.equal(s(8, 4), 'WAVE'); assert.equal(s(12, 4), 'fmt '); assert.equal(s(36, 4), 'data');
  assert.equal(v.getUint16(20, true), 1, 'PCM');
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint32(28, true), 48000 * 4);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 16);
  assert.equal(buf.byteLength, 44 + 16);
  assert.equal(v.getUint32(4, true), 36 + 16);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(i => v.getInt16(44 + i * 2, true)), [0, 16384, 32767, -16384, -32768, 0, 32767, -32768]);
  const mono = new DataView(R.encodeWav([new Float32Array(3)], 44100));
  assert.equal(mono.getUint16(22, true), 1);
});

test('WAV: "Save as WAV" sits next to Download and converts the take in the browser', async () => {
  const w = quietLoad();
  const doc = w.document;
  const wavBtn = doc.getElementById('download-recording-wav');
  assert.ok(wavBtn); assert.equal(wavBtn.textContent, 'Save as WAV');
  assert.equal(wavBtn.previousElementSibling.id, 'download-recording');
  const state = { studioRecording:{} };
  const mod = w.DJBattleStudioRecording.create({ window:w, document:doc, state, localStorage:{ setItem(){}, getItem(){ return null; } }, now:() => Date.UTC(2026, 9, 29, 12), activeStudioBattleSession:() => ({ title:'Friday Night House' }) });
  assert.equal((await mod.downloadWav()).error, 'no_take');
  w.lastRecordedMixFile = { name:'take.webm', type:'audio/webm', arrayBuffer: async () => new ArrayBuffer(8) };
  let closed = false;
  w.AudioContext = function(){ this.state = 'running'; this.close = () => { closed = true; }; this.decodeAudioData = (bytes, ok) => ok({ numberOfChannels:2, sampleRate:44100, getChannelData:() => new Float32Array([0, 0.25, -0.25]) }); };
  const clicks = [];
  w.URL.createObjectURL = blob => { clicks.push(blob); return 'blob:wav'; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function(){ clicks.push(this.download); };
  const r = await mod.downloadWav();
  assert.equal(r.ok, true, r.error);
  assert.match(r.name, /^friday-night-house-\d{4}-\d{2}-\d{2}\.wav$/);
  assert.equal(r.bytes, 44 + 3 * 2 * 2);
  assert.equal(clicks[0].type, 'audio/wav');
  assert.equal(clicks[1], r.name);
  assert.equal(closed, true, 'audio context closed afterwards');
  w.AudioContext = function(){ this.decodeAudioData = (b, ok, bad) => bad(new Error('x')); };
  assert.equal((await mod.downloadWav()).error, 'wav_failed');
});

/* ---------- 5. Rights ---------- */
test('rights: upload has "I own or have the rights to this music"; the coming-soon check is gone', () => {
  const app = read('app.js');
  assert.match(app, /id="meta-declare"> <span>I own or have the rights to this music<\/span>/);
  assert.doesNotMatch(app, /COPYRIGHT CHECK/);
  assert.doesNotMatch(app, /Automatic copyright checking is/);
});

test('rights: ticked tracks show "Rights confirmed"; the Rights button ticks/unticks and saves', async () => {
  const w = quietLoad();
  const html = w.rightsConfirmedBadgeHtml({ rightsConfirmed:true });
  assert.match(html, /Rights confirmed/);
  assert.equal(w.rightsConfirmedBadgeHtml({ rightsConfirmed:false }), '');
  assert.equal(w.rightsConfirmedBadgeHtml({ rightsDeclared:true }), html, 'older uploads that ticked the old box count');
  assert.equal(w.rightsConfirmedBadgeHtml({ rightsConfirmed:false, rightsDeclared:true }), '', 'an explicit untick wins');
  const st = w.__DJBattleTestHooks.getAppState();
  st.library.push({ id:'t1', title:'SAMPLE <b>Track</b>', name:'SAMPLE', artist:'Me', source:'MY_LIBRARY', rightsConfirmed:false });
  const track = st.library.find(t => t.id === 't1');
  const pending = w.runCopyrightCheck(track);
  const doc = w.document;
  assert.equal(doc.querySelector('#modal-content h3 b'), null, 'title escaped');
  const box = doc.getElementById('rights-confirm-input');
  assert.equal(box.checked, false);
  box.checked = true;
  await doc.getElementById('rights-confirm-save').onclick();
  const r = await pending;
  assert.equal(r.ok, true); assert.equal(r.rightsConfirmed, true);
  assert.equal(st.library.find(t => t.id === 't1').rightsConfirmed, true);
  w.renderLibrary();
  assert.match(doc.body.innerHTML, /rights-confirmed-badge/);
});

test('SQL 056 adds the social columns with domain checks and the rights columns', () => {
  const sql = read('server/sql/056_add_social_links_and_rights.sql');
  ['instagram_url', 'soundcloud_url', 'mixcloud_url', 'tiktok_url'].forEach(c => assert.match(sql, new RegExp(`${c} text`)));
  assert.match(sql, /rights_confirmed boolean NOT NULL DEFAULT false/);
  assert.match(sql, /rights_confirmed_at timestamptz/);
  assert.match(read('server/sql/README.md'), /056_add_social_links_and_rights\.sql/);
});
