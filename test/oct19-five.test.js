// Oct 19: battle chat, tournaments, timed comments, light mode, embeddable player.
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
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js', 'social.js'].forEach(file => window.eval(read(file)));
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

/* ---------------- 1. Battle chat ---------------- */
test('battle chat shows a clear needs-server state for local battles', () => {
  const window = loadAppDom();
  window.DJBSocial.onBattleRoom({ id:'local-1', title:'Local', opponent:{ name:'Rival' } });
  const panel = window.document.getElementById('battle-chat');
  assert.ok(panel, 'chat panel added to the battle room');
  assert.ok(window.document.getElementById('battle-chat-needs-server'));
  assert.match(panel.textContent, /needs the DJ Battle server/);
  window.DJBSocial.onBattleRoom({ id:'solo-1', title:'Solo' });
  assert.match(window.document.getElementById('battle-chat').textContent, /opens when another DJ joins/);
});

test('battle chat loads, escapes text, sends with a 280 limit, mutes and reports', async () => {
  const window = loadAppDom();
  signIn(window);
  const messages = [{ id:'m1', body:XSS, mine:false, author:{ displayName:'Rival <b>DJ</b>' }, createdAt:new Date().toISOString() }];
  const calls = stubApi(window, (p, o) => {
    if(p === '/api/battles/b1/chat' && o.method === 'POST') return { data:{ message:{ id:'m2', body:o.body.body, mine:true, author:{ displayName:'Chat DJ' }, createdAt:new Date().toISOString() } } };
    if(p === '/api/battles/b1/chat') return { data:{ messages, canSend:true } };
    if(p === '/api/community/reports') return { data:{ success:true } };
  });
  window.DJBSocial.onBattleRoom({ id:'b1', battleEntryId:'e1', battlePrepSyncStatus:'server', opponent:{ name:'Rival' } });
  await settle();
  const doc = window.document;
  const list = doc.getElementById('battle-chat-list');
  assert.equal(list.querySelectorAll('img').length, 0, 'message HTML is never parsed');
  assert.ok(list.textContent.includes(XSS));
  assert.equal(window.__pwned, undefined);
  const input = doc.getElementById('battle-chat-input');
  assert.equal(input.getAttribute('maxlength'), '280');
  input.value = 'good luck';
  doc.getElementById('battle-chat-form').dispatchEvent(new window.Event('submit', { cancelable:true }));
  await settle();
  assert.ok(calls.some(c => c.method === 'POST' && c.path === '/api/battles/b1/chat' && c.body.body === 'good luck'));
  assert.ok(doc.getElementById('battle-chat-list').textContent.includes('good luck'));
  assert.equal(doc.getElementById('battle-chat-input').value, '', 'input clears after sending');
  doc.getElementById('battle-chat-input').value = 'half typed';
  doc.getElementById('battle-chat-input').dispatchEvent(new window.Event('input'));
  await window.DJBSocial.loadChat();
  assert.equal(doc.getElementById('battle-chat-input').value, 'half typed', 'a poll never wipes what you are typing');
  // Mute hides the opponent but keeps your own messages.
  doc.getElementById('battle-chat-mute').click();
  assert.ok(!doc.getElementById('battle-chat-list').textContent.includes(XSS));
  assert.ok(doc.getElementById('battle-chat-list').textContent.includes('good luck'));
  assert.match(doc.getElementById('battle-chat').textContent, /1 message hidden/);
  assert.equal(window.localStorage.getItem('djbChatMuted:b1'), '1');
  doc.getElementById('battle-chat-mute').click();
  // Report goes to the existing community reports route.
  doc.querySelector('.chat-report').click();
  doc.querySelector('.inline-report [data-send]').click();
  await settle();
  const report = calls.find(c => c.path === '/api/community/reports');
  assert.deepEqual(JSON.parse(JSON.stringify(report.body)), { targetType:'battle_chat_message', targetId:'m1', reason:'harassment' });
});

test('battle chat polling pauses while the tab is hidden', async () => {
  const window = loadAppDom();
  signIn(window);
  window.__djbForceSocialPolling = true;
  stubApi(window, p => p.endsWith('/chat') ? { data:{ messages:[], canSend:true } } : null);
  window.switchView('battle-room');
  window.DJBSocial.onBattleRoom({ id:'b2', battleEntryId:'e2', battlePrepSyncStatus:'server', opponent:{ name:'Rival' } });
  await settle();
  assert.ok(window.DJBSocial.chatState().timer, 'polling while visible');
  Object.defineProperty(window.document, 'hidden', { configurable:true, get:() => true });
  window.document.dispatchEvent(new window.Event('visibilitychange'));
  assert.equal(window.DJBSocial.chatState().timer, null, 'polling stops when hidden');
  window.DJBSocial.stopChatPolling();
});

/* ---------------- 2. Tournaments ---------------- */
const profile = (name, extra = {}) => ({ displayName:name, publicProfileId:`dj_${name}`, ...extra });
function sampleTournament(){
  const p = ['Ace', 'Bee', 'Cee', 'Dee', 'Eve', 'Fox'].map((n, i) => profile(n, { seed:i + 1, you:n === 'Ace' }));
  return {
    id:'trn_1', title:'Friday <script>Knockout</script>', genre:'House', capacity:8, seeding:'random', status:'active', rounds:3, entrantCount:6,
    host:p[0], entrants:p, champion:null, you:{ joined:true, host:true, matchId:'m5' },
    matches:[
      { id:'m1', round:1, position:1, status:'bye', first:p[0], second:null, winner:p[0] },
      { id:'m2', round:1, position:2, status:'completed', first:p[3], second:p[4], winner:p[4] },
      { id:'m3', round:1, position:3, status:'bye', first:p[1], second:null, winner:p[1] },
      { id:'m4', round:1, position:4, status:'active', first:p[2], second:p[5], winner:null, hasBattle:true },
      { id:'m5', round:2, position:1, status:'ready', first:p[0], second:p[4], winner:null },
      { id:'m6', round:2, position:2, status:'pending', first:p[1], second:null, winner:null },
      { id:'m7', round:3, position:1, status:'pending', first:null, second:null, winner:null }
    ]
  };
}

test('tournaments page has a nav entry, a needs-server state and a route', async () => {
  const window = loadAppDom();
  assert.ok(window.document.querySelector('.sidebar .nav-btn[data-view="tournaments"]'));
  window.DJBattleApi.apiRequest = async () => ({ error:'offline', status:0 });
  window.switchView('tournaments');
  await settle();
  assert.ok(window.document.getElementById('tournaments').classList.contains('active'));
  assert.match(window.document.getElementById('tournament-status').textContent, /need the DJ Battle server/);
  assert.equal(window.document.getElementById('page-title').textContent, 'Tournaments');
});

test('tournament bracket renders rounds, byes, your match and the champion, safely', async () => {
  const window = loadAppDom();
  signIn(window);
  const t = sampleTournament();
  const calls = stubApi(window, (p, o) => {
    if(p === '/api/tournaments') return { data:{ tournaments:[t] } };
    if(p === '/api/tournaments/trn_1') return { data:{ tournament:t } };
    if(p === '/api/tournaments/trn_1/matches/m5/battle') return { data:{ battleId:'battle-x', room:null } };
    if(p === '/api/tournaments' && o.method === 'POST') return { data:{ tournament:t } };
  });
  window.switchView('tournaments');
  await settle();
  const doc = window.document;
  assert.equal(doc.querySelectorAll('#tournament-list .tournament-card').length, 1);
  assert.equal(doc.querySelectorAll('#tournament-list script').length, 0);
  doc.querySelector('[data-open-tournament="trn_1"]').click();
  await settle();
  const scroll = doc.querySelector('#tournament-detail .bracket-scroll');
  assert.ok(scroll, 'bracket scrolls inside its own box');
  assert.deepEqual(Array.from(doc.querySelectorAll('.bracket-round h5')).map(h => h.textContent), ['Quarterfinals', 'Semifinals', 'Final']);
  assert.equal(doc.querySelectorAll('.bracket-match').length, 7);
  assert.ok(doc.querySelector('[data-match="m1"]').textContent.includes('Bye'));
  assert.ok(doc.querySelector('[data-match="m2"] .bracket-slot.winner').textContent.includes('Eve'));
  doc.querySelector('[data-play-match="m5"]').click();
  await settle();
  assert.ok(calls.some(c => c.method === 'POST' && c.path === '/api/tournaments/trn_1/matches/m5/battle'));
  // Champion banner once the final is won.
  const done = { ...t, status:'completed', champion:profile('Eve'), you:{ joined:true, host:true, matchId:null } };
  window.DJBattleApi.apiRequest = async () => ({ data:{ tournament:done } });
  await window.DJBSocial.openTournament('trn_1');
  assert.match(doc.getElementById('tournament-champion').textContent, /Eve/);
  assert.equal(window.__pwned, undefined);
});

test('creating a tournament sends size, name and pairing choice', async () => {
  const window = loadAppDom();
  signIn(window);
  const t = { ...sampleTournament(), status:'open', matches:[], you:{ joined:true, host:true } };
  const calls = stubApi(window, (p, o) => (p === '/api/tournaments' && o.method === 'POST') ? { data:{ tournament:t } } : { data:{ tournaments:[] } });
  window.DJBSocial.openCreateTournament();
  const doc = window.document;
  doc.getElementById('tournament-title').value = 'Sunday Cup';
  doc.getElementById('tournament-capacity').value = '16';
  doc.getElementById('tournament-seeding').value = 'signup';
  doc.getElementById('tournament-create-submit').click();
  await settle();
  const post = calls.find(c => c.method === 'POST');
  assert.deepEqual({ title:post.body.title, capacity:post.body.capacity, seeding:post.body.seeding }, { title:'Sunday Cup', capacity:16, seeding:'signup' });
  assert.ok(doc.getElementById('tournament-start'), 'host can start early');
});

/* ---------------- 3. Timed comments ---------------- */
const publicResult = { verifiedResultId:'vr_abc123def456', score:91, outcome:'winner', battle:{ title:'Bass House Clash', genre:'House', durationMinutes:5 }, profile:{ displayName:'Ace' }, evidence:{} };

test('public results get a waveform with markers, sorted comments and seeking', async () => {
  const window = loadAppDom();
  signIn(window);
  const comments = [
    { id:'c2', atSeconds:102, body:'that transition 🔥', mine:true, author:{ displayName:'Chat DJ' } },
    { id:'c1', atSeconds:12, body:XSS, mine:false, author:{ displayName:'Rival' } }
  ];
  const calls = stubApi(window, (p, o) => {
    if(p.endsWith('/timedComments') && o.method === 'POST') return { data:{ comment:{ id:'c3', atSeconds:o.body.atSeconds, body:o.body.body, mine:true, author:{ displayName:'Chat DJ' } } } };
    if(p.endsWith('/timedComments')) return { data:{ comments, maxLength:500 } };
    if(p.startsWith('/api/timedComments/') && o.method === 'DELETE') return { data:{ deleted:true } };
    if(p.startsWith('/api/timedComments/')) return { data:{ comment:{ ...comments[0], body:o.body.body, editedAt:'now' } } };
  });
  window.renderPublicVerifiedResultProfile(publicResult);
  await settle();
  const doc = window.document;
  assert.equal(doc.querySelectorAll('#timed-wave .timed-marker').length, 2);
  assert.deepEqual(Array.from(doc.querySelectorAll('#timed-list .timed-time')).map(b => b.textContent), ['0:12', '1:42']);
  assert.equal(doc.querySelectorAll('#timed-list img').length, 0);
  assert.equal(window.DJBSocial.timedState().duration, 300);
  doc.querySelector('[data-marker="c2"]').click();
  assert.equal(window.DJBSocial.timedState().position, 102);
  assert.ok(doc.querySelector('[data-timed-comment="c2"]').classList.contains('active'));
  // Own comment: edit and delete; someone else's: report.
  const own = doc.querySelector('[data-timed-comment="c2"]');
  assert.deepEqual(Array.from(own.querySelectorAll('.timed-item-actions button')).map(b => b.textContent), ['Edit', 'Delete']);
  assert.deepEqual(Array.from(doc.querySelectorAll('[data-timed-comment="c1"] .timed-item-actions button')).map(b => b.textContent), ['Report']);
  // Adding a comment at a moment.
  window.DJBSocial.openTimedForm(42.5);
  doc.getElementById('timed-input').value = 'nice cut';
  assert.equal(doc.getElementById('timed-input').getAttribute('maxlength'), '500');
  doc.getElementById('timed-post').click();
  await settle();
  const post = calls.find(c => c.method === 'POST');
  assert.deepEqual(JSON.parse(JSON.stringify(post.body)), { atSeconds:42.5, body:'nice cut' });
  assert.deepEqual(Array.from(doc.querySelectorAll('#timed-list .timed-time')).map(b => b.textContent), ['0:12', '0:42', '1:42']);
  await window.DJBSocial.deleteTimed('c2');
  assert.equal(doc.querySelectorAll('#timed-wave .timed-marker').length, 2);
  assert.equal(window.__pwned, undefined);
});

test('timed comments show a needs-server note when the server is missing', async () => {
  const window = loadAppDom();
  window.DJBattleApi.apiRequest = async () => ({ error:'offline', status:0 });
  window.renderPublicVerifiedResultProfile(publicResult);
  await settle();
  assert.match(window.document.getElementById('timed-comments').textContent, /need the DJ Battle server/);
});

/* ---------------- 4. Light mode ---------------- */
test('theme switch: dark, light and match my device, remembered and applied', async () => {
  const window = loadAppDom();
  const html = window.document.documentElement;
  const meta = () => window.document.querySelector('meta[name="theme-color"]').getAttribute('content');
  assert.equal(html.dataset.theme, 'dark');
  window.switchView('settings');
  const buttons = window.document.querySelectorAll('#settings-theme-panel [data-theme-pref]');
  assert.deepEqual(Array.from(buttons).map(b => b.textContent), ['Dark', 'Light', 'Match my device']);
  window.document.querySelector('[data-theme-pref="light"]').click();
  assert.equal(html.dataset.theme, 'light');
  assert.equal(window.localStorage.getItem('djbTheme'), 'light');
  assert.equal(meta(), '#f3f5f9');
  assert.equal(window.document.querySelector('[data-theme-pref="light"]').getAttribute('aria-checked'), 'true');
  window.DJBSocial.setThemePref('dark');
  assert.equal(meta(), '#0b0f14');
  const device = loadAppDom({ matchLight:true, theme:'system' });
  assert.equal(device.document.documentElement.dataset.theme, 'light');
});

test('the saved theme is applied before first paint', () => {
  const html = read('index.html');
  const pre = html.indexOf("localStorage.getItem('djbTheme')");
  assert.ok(pre > 0 && pre < html.indexOf('<link rel="stylesheet"'), 'pre-paint script runs before any stylesheet');
  assert.ok(html.indexOf('light-theme.css') > html.indexOf('professional-redesign.css'));
  const window = loadAppDom({ theme:'light' });
  assert.equal(window.document.documentElement.getAttribute('data-theme'), 'light');
});

test('light-theme.css is generated, current, and only applies in light mode', () => {
  const { buildLightTheme } = require('../scripts/build-light-theme.js');
  assert.equal(read('light-theme.css'), buildLightTheme(), 'run node scripts/build-light-theme.js');
  const rules = read('light-theme.css').split('\n').filter(l => l.includes('{') && !l.startsWith('@media') && !l.startsWith('/*'));
  assert.ok(rules.length > 200);
  assert.ok(rules.every(l => l.includes('html[data-theme="light"]')), 'every rule is scoped to light mode');
  const themes = read('themes.css');
  assert.match(themes, /html\[data-theme="light"\]\{[^}]*--bg:#f3f5f9/);
});

/* ---------------- 5. Embeds ---------------- */
test('Embed buttons on public results and Beat Store cards give an iframe snippet', async () => {
  const window = loadAppDom();
  stubApi(window, () => ({ data:{ comments:[] } }));
  window.renderPublicVerifiedResultProfile(publicResult);
  await settle();
  const doc = window.document;
  doc.querySelector('[data-embed-result]').click();
  const code = doc.getElementById('embed-code').value;
  assert.match(code, /^<iframe src="http:\/\/127\.0\.0\.1\/embed\.html\?type=result&id=vr_abc123def456"/);
  assert.match(code, /title="DJ Battle result player"/);
  const grid = doc.getElementById('store-grid');
  grid.innerHTML = '<article class="store-card" data-store-listing="lst_9"><div class="store-card-foot"></div></article>';
  window.DJBSocial.decorateBeatStore();
  grid.querySelector('[data-store-embed]').click();
  assert.match(doc.getElementById('embed-code').value, /embed\.html\?type=beat&id=lst_9/);
});

test('embed page renders a result or beat with a link back, escapes text, and ships to Pages', async () => {
  const Embed = require('../embed.js');
  assert.deepEqual(Embed.parseParams('?type=result&id=vr_abc123def456'), { type:'result', id:'vr_abc123def456', theme:'' });
  assert.equal(Embed.parseParams('?type=result&id=<x>').id, '');
  assert.equal(Embed.appLink('result', 'vr_1', 'https://x.github.io/djb/embed.html?type=result'), 'https://x.github.io/djb/index.html?result=vr_1');
  const dom = new JSDOM(read('embed.html'), { url:'https://x.github.io/djb/embed.html?type=result&id=vr_abc123def456', runScripts:'outside-only' });
  windows.push(dom.window);
  dom.window.matchMedia = () => ({ matches:false });
  dom.window.DJBattleApi = { apiRequest:async p => { assert.equal(p, '/api/publicBattleResults/vr_abc123def456'); return { data:{ result:{ ...publicResult, battle:{ title:XSS } } } }; } };
  dom.window.eval(read('embed.js'));
  await settle();
  const rootEl = dom.window.document.getElementById('embed-root');
  assert.equal(rootEl.querySelectorAll('img').length, 0);
  assert.ok(rootEl.textContent.includes(XSS));
  assert.match(rootEl.textContent, /91/);
  const cta = rootEl.querySelector('a.cta');
  assert.equal(cta.textContent, 'Battle me on DJ Battle');
  assert.equal(cta.href, 'https://x.github.io/djb/index.html?result=vr_abc123def456');
  assert.equal(cta.rel, 'noopener');
  const beat = Embed.viewModel('beat', { listing:{ title:'Night Drive', displayPriceCents:0, product:{ genre:'Trap', bpm:140 } } });
  assert.equal(beat.badge, 'FREE');
  const { PAGES_FILES } = require('../scripts/build-pages.js');
  ['embed.html', 'embed.js', 'social.js'].forEach(f => assert.ok(PAGES_FILES.includes(f), `${f} ships to Pages`));
  assert.match(read('sw.js'), /'social\.js'/);
});
