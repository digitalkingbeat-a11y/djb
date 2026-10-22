// Oct 19b: tournament deadlines, host controls, notification switches, chat unsend/unread, tournament wins.
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
const S = w => w.DJBSocial;
const H = 3600000;

function tournamentFixture(overrides = {}){
  const soon = new Date(Date.now() + 5 * H).toISOString();
  const later = new Date(Date.now() + 40 * H).toISOString();
  const p = (name, seed, you = false) => ({ displayName:name, publicProfileId:`dj_${name}`, seed, you });
  return {
    id:'trn_1', title:'Sample Knockout', capacity:8, genre:'House', seeding:'signup', status:'active', roundHours:48, startsAt:null,
    host:p('Host', 1, true), entrantCount:4, entrants:[p('Host', 1, true), p('Bee', 2), p('Cee', 3), p('Dee', 4)], champion:null, rounds:3,
    matches:[
      { id:'m1', round:2, position:1, status:'ready', first:p('Host', 1, true), second:p('Dee', 4), winner:null, deadlineAt:soon, forfeit:null },
      { id:'m2', round:2, position:2, status:'completed', first:p('Bee', 2), second:p('Cee', 3), winner:p('Bee', 2), deadlineAt:null, forfeit:p('Cee', 3) },
      { id:'m3', round:3, position:1, status:'pending', first:null, second:p('Bee', 2), winner:null, deadlineAt:later, forfeit:null }
    ],
    you:{ joined:true, host:true, matchId:'m1' }, ...overrides
  };
}

test('bracket shows a live countdown on ready matches and explains forfeits', async () => {
  const w = loadAppDom(); signIn(w);
  stubApi(w, p => p.startsWith('/api/tournaments/trn_1') ? { data:{ tournament:tournamentFixture() } } : { data:{ tournaments:[] } });
  w.switchView('tournaments');
  await S(w).openTournament('trn_1');
  const deadline = w.document.querySelector('[data-match="m1"] [data-deadline]');
  assert.ok(deadline, 'countdown shown');
  assert.match(deadline.textContent, /⏱ 4h \d+m left|⏱ 5h 0m left/);
  assert.ok(deadline.classList.contains('urgent'), 'under 6 hours is urgent');
  assert.equal(w.document.querySelector('[data-match="m3"] [data-deadline]'), null, 'pending matches have no timer');
  assert.match(w.document.querySelector('[data-match="m2"] .bracket-forfeit').textContent, /forfeit · Cee didn't play/);
  assert.match(w.document.getElementById('tournament-detail').textContent, /48 hours per round/);
  assert.equal(S(w).countdownText(new Date(Date.now() - 1000).toISOString()), "Time's up · settling by forfeit");
  assert.equal(S(w).countdownText(new Date(Date.now() + 49 * H + 30000).toISOString()), '2d 1h left');
});

test('create form sends the round length and optional start date', async () => {
  const w = loadAppDom(); signIn(w);
  const calls = stubApi(w, (p, o) => o.method === 'POST' ? { data:{ tournament:tournamentFixture({ status:'open' }) } } : { data:{ tournaments:[] } });
  S(w).openCreateTournament();
  w.document.getElementById('tournament-title').value = 'Sample Cup';
  w.document.getElementById('tournament-hours').value = '24';
  w.document.getElementById('tournament-starts').value = '2030-01-05T20:00';
  await w.document.getElementById('tournament-create-submit').onclick();
  const post = calls.find(c => c.path === '/api/tournaments' && c.method === 'POST');
  assert.equal(post.body.roundHours, 24);
  assert.ok(post.body.startsAt && !Number.isNaN(Date.parse(post.body.startsAt)));
});

test('host sees host controls; edit, remove (with confirm) and cancel call the server', async () => {
  const w = loadAppDom(); signIn(w);
  let confirms = 0;
  w.appConfirm = async () => { confirms++; return true; };
  const open = tournamentFixture({ status:'open', matches:[] });
  const calls = stubApi(w, (p, o) => {
    if(o.method === 'PATCH') return { data:{ tournament:{ ...open, title:o.body.title, startsAt:o.body.startsAt, roundHours:o.body.roundHours } } };
    if(p.endsWith('/remove')) return { data:{ tournament:{ ...open, entrants:open.entrants.filter(e => e.publicProfileId !== o.body.publicProfileId), entrantCount:3 } } };
    if(p.endsWith('/cancel')) return { data:{ cancelled:true, tournament:null } };
    if(p.startsWith('/api/tournaments/trn_1')) return { data:{ tournament:open } };
    return { data:{ tournaments:[open] } };
  });
  w.switchView('tournaments');
  await S(w).openTournament('trn_1');
  assert.ok(w.document.getElementById('tournament-host-tools'));
  S(w).openEditTournament();
  w.document.getElementById('tournament-edit-title').value = 'Renamed <b>Cup</b>';
  w.document.getElementById('tournament-edit-starts').value = '2030-02-01T19:30';
  w.document.getElementById('tournament-edit-hours').value = '72';
  await w.document.getElementById('tournament-edit-save').onclick();
  const patch = calls.find(c => c.method === 'PATCH');
  assert.equal(patch.path, '/api/tournaments/trn_1');
  assert.equal(patch.body.roundHours, 72);
  assert.match(w.document.querySelector('#tournament-detail h3').textContent, /Renamed <b>Cup<\/b>/, 'title shown as text');
  assert.match(w.document.getElementById('tournament-starts').textContent, /Starts/);

  S(w).openRemoveDj();
  const names = [...w.document.querySelectorAll('[data-remove-dj]')].map(b => b.dataset.removeName);
  assert.deepEqual(names, ['Bee', 'Cee', 'Dee'], 'host cannot remove themself');
  await S(w).removeDj('dj_Bee', 'Bee');
  assert.equal(confirms, 1);
  assert.equal(JSON.stringify(calls.find(c => c.path.endsWith('/remove')).body), JSON.stringify({ publicProfileId:'dj_Bee' }));

  await S(w).cancelTournamentFlow();
  assert.equal(confirms, 2);
  assert.ok(calls.some(c => c.path === '/api/tournaments/trn_1/cancel'));
  assert.equal(S(w).tournamentState().current, null);
  assert.match(w.document.getElementById('tournament-status').textContent, /was cancelled/);
});

test('a non-host sees no host controls, and declining the confirm sends nothing', async () => {
  const w = loadAppDom(); signIn(w);
  const t = tournamentFixture({ you:{ joined:true, host:false, matchId:null } });
  const calls = stubApi(w, () => ({ data:{ tournament:t } }));
  w.switchView('tournaments');
  await S(w).openTournament('trn_1');
  assert.equal(w.document.getElementById('tournament-host-tools'), null);
  w.appConfirm = async () => false;
  await S(w).cancelTournamentFlow();
  assert.ok(!calls.some(c => c.path.endsWith('/cancel')));
});

test('Settings has three Activity-bell switches that save to the server', async () => {
  const w = loadAppDom(); signIn(w);
  const calls = stubApi(w, (p, o) => {
    if(p === '/api/notificationPreferences/social' && o.method === 'PUT') return { data:{ prefs:{ tournament_match_ready:true, battle_chat_message:o.body.enabled, timed_comment_received:true } } };
    if(p === '/api/notificationPreferences/social') return { data:{ prefs:{ tournament_match_ready:true, battle_chat_message:true, timed_comment_received:false } } };
    return null;
  });
  w.switchView('settings');
  await settle();
  const boxes = [...w.document.querySelectorAll('#settings-social-notify [data-notify-type]')];
  assert.deepEqual(boxes.map(b => b.dataset.notifyType), ['tournament_match_ready', 'battle_chat_message', 'timed_comment_received']);
  assert.deepEqual(boxes.map(b => b.checked), [true, true, false]);
  await S(w).saveNotifyPref('battle_chat_message', false);
  assert.equal(JSON.stringify(calls.find(c => c.method === 'PUT').body), JSON.stringify({ type:'battle_chat_message', enabled:false }));
  assert.equal(w.document.querySelector('[data-notify-type="battle_chat_message"]').checked, false);
});

test('Settings switches explain they need the server when it is not running', async () => {
  const w = loadAppDom(); signIn(w);
  stubApi(w, () => ({ error:'offline', status:0 }));
  w.switchView('settings');
  await settle();
  assert.match(w.document.getElementById('settings-notify-note').textContent, /need the DJ Battle server/);
  assert.ok(w.document.querySelector('[data-notify-type]').disabled);
});

function chatRoom(w, messages){
  const room = w.document.getElementById('battle-room');
  room.classList.add('active');
  const c = S(w).chatState();
  Object.assign(c, { battleId:'bt_1', status:'ready', messages, canSend:true, muted:false });
  S(w).renderChat();
}

test('chat button shows an unread count that clears when opened', async () => {
  const w = loadAppDom(); signIn(w);
  const now = Date.now();
  chatRoom(w, [
    { id:'c1', body:'sample: good luck', mine:false, createdAt:new Date(now - 3000).toISOString(), author:{ displayName:'Bee' } },
    { id:'c2', body:'sample: ready?', mine:false, createdAt:new Date(now - 2000).toISOString(), author:{ displayName:'Bee' } },
    { id:'c3', body:'yes', mine:true, createdAt:new Date(now - 1000).toISOString(), author:{ displayName:'You' } }
  ]);
  assert.equal(w.document.getElementById('battle-chat-unread').textContent, '2');
  assert.match(w.document.getElementById('battle-chat-jump').getAttribute('aria-label'), /2 unread messages/);
  w.document.getElementById('battle-chat-jump').click();
  assert.equal(w.document.getElementById('battle-chat-unread'), null);
  assert.equal(S(w).unreadChatCount(), 0);
});

test('Unsend appears only on your own messages and removes it after confirm', async () => {
  const w = loadAppDom(); signIn(w);
  w.appConfirm = async () => true;
  const calls = stubApi(w, (p, o) => o.method === 'DELETE' ? { data:{ unsent:true } } : null);
  chatRoom(w, [
    { id:'c1', body:XSS, mine:false, createdAt:new Date().toISOString(), author:{ displayName:'Bee' } },
    { id:'c2', body:'typo', mine:true, createdAt:new Date().toISOString(), author:{ displayName:'You' } }
  ]);
  const items = [...w.document.querySelectorAll('.battle-chat-msg')];
  assert.equal(items[0].querySelector('.chat-unsend'), null);
  assert.ok(items[1].querySelector('.chat-unsend'));
  assert.equal(w.__pwned, undefined);
  await S(w).unsendChat('c2');
  assert.equal(calls[0].path, '/api/battles/bt_1/chat/c2');
  assert.equal(calls[0].method, 'DELETE');
  assert.equal(w.document.querySelectorAll('.battle-chat-msg').length, 1);
});

test('profile shows tournament results with a champion badge', async () => {
  const w = loadAppDom(); signIn(w);
  stubApi(w, p => p === '/api/me/tournaments' ? { data:{ wins:1, tournaments:[
    { id:'t1', title:XSS, capacity:8, status:'completed', placement:'Champion', champion:true },
    { id:'t2', title:'Sample Monday Cup', capacity:16, status:'completed', placement:'Semifinalist', champion:false, wonByForfeit:true }
  ] } } : null);
  w.switchView('profile');
  await settle();
  const panel = w.document.getElementById('profile-tournaments');
  assert.ok(panel);
  assert.match(w.document.getElementById('profile-champion-badge').textContent, /Champion/);
  assert.match(panel.textContent, /Semifinalist/);
  assert.match(panel.textContent, /forfeit win/);
  assert.equal(w.__pwned, undefined);
});

test('Rankings adds a trophy next to tournament champions', async () => {
  const w = loadAppDom();
  stubApi(w, p => p === '/api/tournamentChampions' ? { data:{ champions:[{ publicProfileId:'dj_champ', displayName:'Champ', wins:2 }] } } : null);
  const host = w.document.createElement('div');
  host.innerHTML = '<article class="ranking-row" data-ranking-dj="dj_champ"><div class="ranking-title"><strong>Champ</strong></div></article><article class="ranking-row" data-ranking-dj="dj_other"><div class="ranking-title"><strong>Other</strong></div></article>';
  w.document.body.appendChild(host);
  S(w).decorateRankings();
  await settle();
  const trophies = w.document.querySelectorAll('.ranking-trophy');
  assert.equal(trophies.length, 1);
  assert.equal(trophies[0].textContent, '🏆×2');
  S(w).decorateRankings();
  assert.equal(w.document.querySelectorAll('.ranking-trophy').length, 1, 'no duplicates');
});

test('tournament notifications open the tournament', async () => {
  const src = read('app.js');
  assert.match(src, /destination\.type === 'tournament'/);
  assert.match(src, /destination\.type === 'verified_result'/);
});
