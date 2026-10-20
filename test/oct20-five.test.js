// Oct 20: lock-screen alerts, Add to calendar, Rekordbox/Serato import, result reviews, my data.
const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const windows = [];
test.after(() => windows.forEach(w => { try{ w.close(); }catch(e){} }));

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const settle = async (n = 8) => { for(let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

function loadAppDom({ matchLight = false, theme = null } = {}){
  const dom = new JSDOM(read('index.html'), { url:'http://127.0.0.1/index.html', runScripts:'outside-only', pretendToBeVisual:true });
  const { window } = dom;
  window.alert = () => {};
  window.confirm = () => true;
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = function(){};
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLDialogElement.prototype.showModal = function(){ this.setAttribute('open', ''); this.open = true; };
  window.HTMLDialogElement.prototype.close = function(){ this.removeAttribute('open'); this.open = false; this.dispatchEvent(new window.Event('close')); };
  window.fetch = async () => ({ ok:false, status:503, text:async () => '{}', json:async () => ({}) });
  window.matchMedia = q => ({ matches:/light/.test(q) ? matchLight : false, media:q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} });
  if(theme) window.localStorage.setItem('djbTheme', theme);
  const inline = Array.from(window.document.querySelectorAll('script:not([src])'));
  const prePaint = inline.find(s => s.textContent.includes('djbTheme'));
  if(prePaint) window.eval(prePaint.textContent);
  const beltScript = inline.find(s => s.textContent.includes('setCurrentBelt'));
  if(beltScript) window.eval(beltScript.textContent);
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js', 'social.js', 'connect.js', 'oct20.js'].forEach(file => window.eval(read(file)));
  windows.push(window);
  return window;
}
function signIn(window, id = 'user-1'){
  window.__DJBattleTestHooks.updateAuthUI({ id, email:`${id}@example.com`, user_metadata:{ full_name:'Chat DJ' } });
}
// Replaces the API client with a scripted stand-in and records every call.
function stubApi(window, handler){
  const calls = [];
  window.DJBattleApi.apiRequest = async (p, opts = {}) => {
    calls.push({ path:p, method:opts.method || 'GET', body:opts.body });
    const out = await handler(p, opts);
    return out || { error:'Not found', status:404 };
  };
  return calls;
}


const XSS = '<img src=x onerror="window.__pwned=1">';
const O = w => w.DJBOct20;

/* ---------- 1. lock-screen alerts ---------- */
test('alerts: Settings shows the switch, per-type choices and the iPhone note; waits for server keys', async () => {
  const w = loadAppDom(); signIn(w);
  stubApi(w, p => p === '/api/push/config' ? { data:{ configured:false, publicKey:null, types:['tournament_match_ready', 'direct_message'], labels:{ tournament_match_ready:'Tournament match is ready', direct_message:'New direct message' } } } : null);
  w.switchView('settings');
  await settle(12);
  const panel = w.document.getElementById('settings-push-panel');
  assert.ok(panel, 'push panel');
  assert.ok(panel.querySelector('#push-enable'));
  assert.equal(panel.querySelectorAll('[data-push-type]').length, 2);
  assert.match(panel.textContent, /iPhone/);
  assert.match(panel.textContent, /Home Screen/);
  assert.match(panel.textContent, /VAPID/);
  const out = await O(w).push.enable();
  assert.match(out.error, /VAPID keys/);
});
test('alerts: per-type choice is remembered and the VAPID key decodes', async () => {
  const w = loadAppDom(); signIn(w);
  stubApi(w, p => p === '/api/push/config' ? { data:{ configured:true, publicKey:'BAAA', types:['a_type', 'b_type'], labels:{} } } : null);
  await O(w).push.load();
  await O(w).push.setType('a_type', false);
  assert.deepEqual(JSON.parse(w.localStorage.getItem('djBattlePushTypes')), ['b_type']);
  assert.equal(w.document.querySelector('[data-push-type="a_type"]').checked, false);
  assert.deepEqual(Array.from(O(w).push.urlB64ToUint8Array('AQID')), [1, 2, 3]);
});
test('alerts: the service worker shows a short alert and only opens in-app links', () => {
  const sw = require('../sw.js');
  assert.equal(sw.safePushUrl('./#messages'), './#messages');
  assert.equal(sw.safePushUrl('https://evil.example'), './');
  assert.equal(sw.safePushUrl('javascript:alert(1)'), './');
  const d = sw.parsePushData({ json:() => ({ title:'x'.repeat(200), url:'//evil' }) });
  assert.equal(d.title.length, 80);
  assert.equal(d.url, './');
  assert.equal(sw.parsePushData(null).title, 'DJ Battle');
  assert.ok(sw.SHELL_FILES.includes('oct20.js'));
  assert.match(read('sw.js'), /addEventListener\('push'/);
  assert.match(read('sw.js'), /addEventListener\('notificationclick'/);
});

/* ---------- 2. add to calendar ---------- */
test('calendar: .ics file, Google and Outlook links carry the event', () => {
  const w = loadAppDom();
  const ev = { title:'Tournament round 2 deadline, finals; go', start:'2026-10-22T20:00:00.000Z', kind:'Tournament round deadline', details:'Play before this' };
  const ics = O(w).calendar.buildIcs(ev, new Date('2026-10-20T10:00:00Z'));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20261022T200000Z/);
  assert.match(ics, /DTEND:20261022T203000Z/);
  assert.match(ics, /SUMMARY:Tournament round 2 deadline\\, finals\\; go/);
  assert.match(ics, /TRIGGER:-PT30M/);
  assert.ok(ics.split('\r\n').every(l => l.length <= 75));
  const g = new URL(O(w).calendar.googleUrl(ev));
  assert.equal(g.hostname, 'calendar.google.com');
  assert.equal(g.searchParams.get('dates'), '20261022T200000Z/20261022T203000Z');
  const o = new URL(O(w).calendar.outlookUrl(ev));
  assert.equal(o.hostname, 'outlook.live.com');
  assert.equal(o.searchParams.get('startdt'), '2026-10-22T20:00:00.000Z');
  assert.equal(O(w).calendar.icsFileName(ev), 'tournament-round-2-deadline-finals-go.ics');
});
test('calendar: the button opens a menu with all three choices and escapes titles', () => {
  const w = loadAppDom();
  const html = w.calendarButtonHtml({ title:XSS, start:'2026-10-22T20:00:00Z', kind:'Battle start' });
  assert.match(html, /data-cal-event=/);
  assert.equal(w.calendarButtonHtml({ title:'x', start:'not a date' }), '');
  const host = w.document.createElement('div'); host.innerHTML = html; w.document.body.appendChild(host);
  host.querySelector('[data-cal-event]').click();
  const menu = w.document.getElementById('cal-menu');
  assert.ok(menu);
  assert.ok(menu.querySelector('[data-cal-google]').href.startsWith('https://calendar.google.com/'));
  assert.ok(menu.querySelector('[data-cal-outlook]').href.startsWith('https://outlook.live.com/'));
  assert.ok(menu.querySelector('[data-cal-ics]'));
  assert.equal(menu.querySelector('strong').textContent, XSS);
  assert.equal(menu.querySelector('img'), null);
  assert.equal(w.__pwned, undefined);
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key:'Escape' }));
  assert.equal(w.document.getElementById('cal-menu'), null);
});
test('calendar: wired into battles, challenges and tournament deadlines', () => {
  assert.match(read('app.js'), /battleReminderButtonHtml[\s\S]{0,700}calendarButtonHtml\(/);
  assert.match(read('app.js'), /Expires \$\{esc\(challengeDate\(challenge\.expiresAt\)\)\}\$\{calendarButtonHtml\(/);
  assert.match(read('social.js'), /Tournament round deadline/);
});

/* ---------- 3. Rekordbox / Serato import ---------- */
const REKORDBOX = `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0"><PRODUCT Name="rekordbox" Version="6.8.0"/>
<COLLECTION Entries="2">
<TRACK TrackID="1" Name="Night &amp; Day" Artist="DJ Sample" Album="Demo" Genre="House" AverageBpm="124.00" Tonality="8A" TotalTime="245" Location="file://localhost/Users/dj/Music/DJ%20Sample%20-%20Night%20&amp;%20Day.mp3">
  <TEMPO Inizio="0.025" Bpm="124.00"/>
  <POSITION_MARK Name="Drop" Type="0" Start="61.5" Num="0"/>
  <POSITION_MARK Name="" Type="0" Start="12.0" Num="-1"/>
  <POSITION_MARK Name="Loop" Type="4" Start="90.0" End="98.0" Num="1"/>
</TRACK>
<TRACK TrackID="2" Name="Second Tune" Artist="Other" AverageBpm="128" Tonality="Am" TotalTime="200" Location="file://localhost/x/second.mp3"/>
</COLLECTION>
<PLAYLISTS><NODE Type="0" Name="ROOT" Count="1"><NODE Name="Friday Set" Type="1" KeyType="0" Entries="2"><TRACK Key="2"/><TRACK Key="1"/></NODE></NODE></PLAYLISTS>
</DJ_PLAYLISTS>`;
function seratoCrate(paths){
  const u16 = s => { const b = []; for(const c of s){ const n = c.charCodeAt(0); b.push(n >> 8, n & 255); } return b; };
  const chunk = (tag, data) => { const l = data.length; return [...tag].map(c => c.charCodeAt(0)).concat([(l >>> 24) & 255, (l >> 16) & 255, (l >> 8) & 255, l & 255], data); };
  let bytes = chunk('vrsn', u16('1.0/Serato ScratchLive Crate'));
  paths.forEach(p => { bytes = bytes.concat(chunk('otrk', chunk('ptrk', u16(p)))); });
  return new Uint8Array(bytes);
}
test('import: Rekordbox XML gives playlists, BPM, key, duration and cue points', () => {
  const w = loadAppDom();
  const t = w.DJBattlePlaylistTransfer.create({ window:w, document:w.document, state:{ playlists:[] } });
  const out = t.parseRekordboxXml(REKORDBOX);
  assert.equal(out.tracks.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(out.playlists.map(p => p.name))), ['Friday Set']);
  assert.deepEqual(JSON.parse(JSON.stringify(out.playlists[0].items.map(i => i.title))), ['Second Tune', 'Night & Day']);
  const nd = out.tracks[0];
  assert.equal(nd.bpm, '124'); assert.equal(nd.key, '8A'); assert.equal(nd.duration, '4:05');
  assert.equal(nd.fileName, 'DJ Sample - Night & Day.mp3');
  assert.equal(nd.cuePoints.length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(nd.cuePoints[0])), { name:'Drop', seconds:61.5, type:'cue', hotCue:0 });
  assert.equal(nd.cuePoints[2].type, 'loop');
  assert.match(t.parseRekordboxXml('<xml/>').error, /Rekordbox/);
});
test('import: Serato .crate gives the crate and its tracks', () => {
  const w = loadAppDom();
  const t = w.DJBattlePlaylistTransfer.create({ window:w, document:w.document, state:{ playlists:[] } });
  const out = t.parseSeratoCrate(seratoCrate(['Users/dj/Music/DJ Sample - Night & Day.mp3', 'Users/dj/Music/loose.wav']).buffer, 'Battle%%Friday.crate');
  assert.equal(out.playlists[0].name, 'Battle / Friday');
  assert.deepEqual(JSON.parse(JSON.stringify(out.tracks.map(x => [x.artist, x.title, x.fileName]))), [['DJ Sample', 'Night & Day', 'DJ Sample - Night & Day.mp3'], ['', 'loose', 'loose.wav']]);
  assert.match(t.parseSeratoCrate(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer).error, /Serato/);
});
test('import: matches audio already in the library and lists the rest as needing audio', () => {
  const w = loadAppDom();
  const hooks = w.__DJBattleTestHooks;
  const state = hooks.getAppState();
  state.library.push({ id:'own-1', title:'Night & Day', name:'Night & Day', artist:'DJ Sample', bpm:'--', key:'--', fileName:'DJ Sample - Night & Day.mp3' });
  const t = hooks.getPlaylistTransfer();
  const parsed = t.parseRekordboxXml(REKORDBOX);
  const out = t.applyDjSoftwareImport(parsed, 'rekordbox.xml');
  assert.equal(out.matched, 1);
  assert.equal(out.cues, 3);
  const own = state.library.find(x => x.id === 'own-1');
  assert.equal(own.bpm, '124'); assert.equal(own.key, '8A'); assert.equal(own.cuePoints.length, 3);
  const added = state.library.filter(x => x.importedFrom === 'rekordbox.xml');
  assert.deepEqual(JSON.parse(JSON.stringify(added.map(x => x.title))), ['Second Tune']);
  assert.equal(added[0].audioMissing, true);
  assert.ok(state.playlists.some(p => p.name === 'Friday Set' && /Audio files are not transferred/.test(p.transferNotice)));
  assert.match(out.summary, /1 still need their audio file uploaded/);
  assert.ok(hooks);
});
test('import: buttons on the Music Library and in Battle Studio open the file picker', () => {
  const w = loadAppDom();
  const input = w.document.getElementById('dj-software-import-file');
  assert.ok(input);
  assert.match(input.getAttribute('accept'), /\.xml/); assert.match(input.getAttribute('accept'), /\.crate/);
  let clicked = 0; input.click = () => { clicked += 1; };
  w.document.getElementById('library-import-dj-software').click();
  w.document.getElementById('import-dj-software').click();
  assert.equal(clicked, 2);
});

/* ---------- 4. result reviews ---------- */
function historyDom(w, id = 'sub-1'){
  const target = w.document.body.appendChild(Object.assign(w.document.createElement('div'), { id:'test-history' }));
  target.innerHTML = `<article class="battle-history-row" data-history-row="${id}"><div class="battle-history-main"><div class="battle-history-title"><strong>Friday battle</strong></div></div><div class="battle-history-actions"></div></article>`;
  return target;
}
test('reviews: request a review from battle history and show "Under review"', async () => {
  const w = loadAppDom(); signIn(w);
  const calls = stubApi(w, (p, o) => {
    if(p === '/api/resultReviews/mine') return { data:{ reviews:[] } };
    if(p === '/api/battleResults/sub-1/review' && o.method === 'POST') return { data:{ review:{ id:'review_1', submissionId:'sub-1', status:'pending', originalScore:64 } } };
    return null;
  });
  const target = historyDom(w);
  O(w).reviews.decorateHistory(target);
  await settle();
  const btn = target.querySelector('[data-review-request="sub-1"]');
  assert.ok(btn);
  btn.click();
  const dlg = w.document.getElementById('review-dialog');
  assert.ok(dlg.open);
  assert.equal(dlg.querySelectorAll('input[name="review-reason"]').length, 5);
  dlg.querySelector('#review-note').value = 'Transition at 1:42 is on beat';
  await dlg.querySelector('[data-review-send]').onclick();
  const sent = calls.find(c => c.path === '/api/battleResults/sub-1/review');
  assert.deepEqual({ ...sent.body }, { reason:'timing_misread', note:'Transition at 1:42 is on beat' });
  assert.match(target.querySelector('.review-badge').textContent, /Under review/);
  assert.equal(target.querySelector('[data-review-request]'), null);
});
test('reviews: rescored and confirmed results show the outcome', () => {
  const w = loadAppDom();
  assert.match(O(w).reviews.badge({ status:'decided', originalScore:64, newScore:71 }), /Rescored 64 → 71\/100/);
  assert.match(O(w).reviews.badge({ status:'decided', newScore:null }), /confirmed/);
});
test('reviews: operators get a queue in Judging Operations and can confirm or rescore', async () => {
  const w = loadAppDom(); signIn(w);
  const calls = stubApi(w, (p, o) => {
    if(p.startsWith('/api/operations/resultReviews?')) return { data:{ reviews:[{ id:'review_1', battleTitle:XSS, reasonLabel:'Timing looks wrong', note:XSS, originalScore:64, createdAt:'2026-10-20T10:00:00Z' }, { id:'review_2', battleTitle:'Other', reasonLabel:'Other', note:'', originalScore:50, createdAt:'2026-10-20T11:00:00Z' }] } };
    if(/decision$/.test(p)) return { data:{ review:{ id:p.split('/')[4], status:'decided' } } };
    return null;
  });
  await O(w).reviews.loadQueue();
  const host = w.document.getElementById('ops-review-queue');
  assert.ok(w.document.getElementById('operations').contains(host));
  assert.equal(host.querySelectorAll('[data-review-id]').length, 2);
  assert.equal(host.querySelector('img'), null);
  const li = host.querySelector('[data-review-id="review_1"]');
  li.querySelector('[data-review-score]').value = '71';
  li.querySelector('[data-review-note]').value = 'Analyzer missed it';
  await li.querySelector('[data-review-rescore]').onclick();
  assert.deepEqual({ ...calls.find(c => /review_1\/decision/.test(c.path)).body }, { decision:'rescore', newScore:71, note:'Analyzer missed it' });
  await w.document.querySelector('[data-review-id="review_2"] [data-review-confirm]').onclick();
  assert.equal(calls.find(c => /review_2\/decision/.test(c.path)).body.decision, 'confirm');
  assert.equal(w.document.querySelectorAll('#ops-review-queue [data-review-id]').length, 0);
  assert.equal(w.__pwned, undefined);
});

/* ---------- 5. my data & deletion ---------- */
test('my data: one-file download includes this device\u2019s settings but no sign-in tokens', async () => {
  const w = loadAppDom(); signIn(w);
  w.localStorage.setItem('djBattleTheme', 'light');
  w.localStorage.setItem('djBattleAuthToken', 'secret');
  let blobText = null;
  w.URL.createObjectURL = b => { blobText = b; return 'blob:x'; }; w.URL.revokeObjectURL = () => {};
  stubApi(w, p => p === '/api/account/export' ? { data:{ format:'djb-account-export', tables:{ mix_submissions:[{ id:'s1' }] } } } : null);
  const out = await O(w).account.download();
  assert.ok(out.ok);
  assert.match(out.name, /^djb-my-data-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(out.file.thisDevice.djBattleTheme, 'light');
  assert.equal(out.file.thisDevice.djBattleAuthToken, undefined);
  assert.ok(blobText);
});
test('delete: typed confirmation, 7-day grace banner and cancel', async () => {
  const w = loadAppDom(); signIn(w);
  const sched = { status:'scheduled', requestedAt:'2026-10-20T12:00:00Z', scheduledFor:'2026-10-27T12:00:00Z', graceDays:7 };
  const calls = stubApi(w, (p, o) => {
    if(p === '/api/account/deletion' && (o.method || 'GET') === 'GET') return { data:{ deletion:null, confirmPhrase:'DELETE MY ACCOUNT', graceDays:7 } };
    if(p === '/api/account/deletion' && o.method === 'POST') return { data:{ deletion:sched } };
    if(p === '/api/account/deletion' && o.method === 'DELETE') return { data:{ cancelled:true } };
    return null;
  });
  await O(w).account.load();
  w.switchView('settings'); await settle();
  w.document.getElementById('account-delete').click();
  const dlg = w.document.getElementById('delete-account-dialog');
  const go = dlg.querySelector('[data-delete-go]');
  assert.equal(go.disabled, true);
  const input = dlg.querySelector('#delete-confirm-input');
  input.value = 'delete'; input.oninput(); assert.equal(go.disabled, true);
  input.value = 'DELETE MY ACCOUNT'; input.oninput(); assert.equal(go.disabled, false);
  assert.match(dlg.textContent, /7 days/);
  await go.onclick();
  assert.equal(calls.find(c => c.method === 'POST').body.confirm, 'DELETE MY ACCOUNT');
  const banner = w.document.getElementById('deletion-banner');
  assert.ok(banner);
  assert.match(banner.textContent, /set to be deleted/);
  assert.ok(w.document.getElementById('account-cancel-delete'));
  await O(w).account.cancel();
  assert.equal(w.document.getElementById('deletion-banner'), null);
  assert.ok(calls.some(c => c.method === 'DELETE'));
});
test('oct20.js is loaded, built and deployed', () => {
  assert.match(read('index.html'), /<script src="oct20\.js"><\/script>/);
  assert.match(read('package.json'), /node --check oct20\.js/);
  assert.match(read('scripts/build-pages.js'), /'oct20\.js'/);
});
