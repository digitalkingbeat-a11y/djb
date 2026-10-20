// Oct 19c: direct messages, Find DJs, watch live, shared crate tracklists, weekly practice goals.
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
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js', 'social.js', 'connect.js'].forEach(file => window.eval(read(file)));
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
const C = w => w.DJBConnect;
const dj = (name, extra = {}) => ({ displayName:name, publicProfileId:`dj_${name.toLowerCase()}`, belt:'Blue', ...extra });

test('new pages are in the nav and routable', () => {
  const w = loadAppDom();
  ['messages', 'find-djs', 'watch'].forEach(v => {
    assert.ok(w.document.getElementById(v), `${v} view exists`);
    assert.ok(w.document.querySelector(`.nav-btn[data-view="${v}"]`), `${v} nav button`);
  });
  w.switchView('find-djs');
  assert.ok(w.document.getElementById('find-djs').classList.contains('active'));
  assert.equal(w.document.getElementById('page-title').textContent, 'Find DJs');
});

test('messages: lists conversations with unread counts and escapes text', async () => {
  const w = loadAppDom(); signIn(w);
  const calls = stubApi(w, p => p === '/api/messages' ? { data:{ unread:2, conversations:[{ with:dj('Bee'), lastMessage:{ id:'m1', body:XSS, mine:false, createdAt:new Date().toISOString() }, unread:2, muted:false }] } } : null);
  await C(w).loadConversations();
  const btn = w.document.querySelector('[data-dm-open="dj_bee"]');
  assert.ok(btn);
  assert.equal(btn.querySelector('.dm-unread').textContent, '2');
  assert.equal(w.document.querySelector('#dm-list img'), null, 'no injected html');
  assert.equal(w.__pwned, undefined);
  assert.equal(w.document.querySelector('.nav-btn[data-view="messages"] .dm-nav-count').textContent, '2');
  assert.ok(calls.some(c => c.path === '/api/messages'));
});

test('messages: open, send, unsend and report', async () => {
  const w = loadAppDom(); signIn(w);
  const thread = { with:dj('Bee'), messages:[{ id:'m1', body:'yo', mine:false, createdAt:'2026-10-20T12:00:00Z' }, { id:'m2', body:'hey', mine:true, createdAt:'2026-10-20T12:01:00Z' }], canSend:true, blocked:false, muted:false, maxLength:1000 };
  const calls = stubApi(w, (p, o = {}) => {
    if(p === '/api/messages') return { data:{ conversations:[], unread:0 } };
    if(p === '/api/messages/dj_bee' && (o.method || 'GET') === 'GET') return { data:thread };
    if(p === '/api/messages/dj_bee' && o.method === 'POST') return { status:201, data:{ message:{ id:'m3', body:o.body.body, mine:true, createdAt:new Date().toISOString() } } };
    if(p === '/api/messages/item/m2') return { data:{ unsent:true } };
    if(p === '/api/community/reports') return { data:{ success:true } };
    return null;
  });
  await C(w).openConversation('dj_bee');
  assert.ok(w.document.getElementById('messages').classList.contains('active'));
  assert.equal(w.document.querySelectorAll('.dm-msg').length, 2);
  await C(w).sendMessage('battle friday?');
  assert.equal(calls.find(c => c.method === 'POST' && c.path === '/api/messages/dj_bee').body.body, 'battle friday?');
  assert.match(w.document.getElementById('dm-messages').textContent, /battle friday\?/);
  await C(w).unsendMessage('m2');
  assert.equal(w.document.querySelector('[data-dm-msg="m2"]'), null);
  w.document.querySelector('[data-dm-report="m1"]').click();
  w.document.querySelector('.inline-report [data-send]').click();
  await settle();
  const rep = calls.find(c => c.path === '/api/community/reports');
  assert.equal(rep.body.targetType, 'direct_message');
  assert.equal(rep.body.targetId, 'm1');
});

test('messages: blocked conversations cannot send; block hides the thread', async () => {
  const w = loadAppDom(); signIn(w);
  stubApi(w, (p, o = {}) => {
    if(p === '/api/messages') return { data:{ conversations:[], unread:0 } };
    if(p === '/api/messages/dj_cee') return { data:{ with:dj('Cee'), messages:[], canSend:false, blocked:true, muted:false } };
    if(p === '/api/messages/dj_dee') return { data:{ with:dj('Dee'), messages:[{ id:'x', body:'hi', mine:false }], canSend:true, blocked:false, muted:false } };
    if(p === '/api/blocks') return { data:{ success:true } };
    if(p === '/api/notificationMutes') return { data:{ success:true } };
    return null;
  });
  w.appConfirmDanger = async () => true;
  await C(w).openConversation('dj_cee');
  assert.equal(w.document.getElementById('dm-form'), null);
  assert.match(w.document.getElementById('dm-thread').textContent, /can't message this DJ/);
  await C(w).openConversation('dj_dee');
  await C(w).muteCurrent();
  assert.equal(C(w).dmState().thread.muted, true);
  await C(w).blockCurrent();
  assert.equal(C(w).dmState().thread.messages.length, 0);
  assert.equal(w.document.getElementById('dm-form'), null);
});

test('messages: signed out and missing server are explained', async () => {
  const w = loadAppDom();
  await C(w).loadConversations();
  assert.match(w.document.getElementById('dm-status').textContent, /Sign in/);
  signIn(w);
  stubApi(w, () => ({ error:'x', status:503, data:{ schemaMissing:true, schema:'036_create_direct_messages', error:'x' } }));
  await C(w).loadConversations();
  assert.match(w.document.getElementById('dm-status').textContent, /036_create_direct_messages/);
});

test('find DJs: search sends filters, renders cards with follow, challenge and message', async () => {
  const w = loadAppDom(); signIn(w);
  const calls = stubApi(w, p => p.startsWith('/api/djs/search') ? { data:{ results:[dj('Bee', { city:'Atlanta', genre:'House', wins:4 }), dj(XSS, { publicProfileId:'dj_x', wins:1 })] } } : null);
  let challenged = null;
  w.openProtectedChallengeSetupFromPublicId = async (id, origin) => { challenged = [id, origin]; };
  let followed = null;
  w.togglePublicProfileFollow = async profile => { followed = profile; return { data:{} }; };
  await C(w).searchDjs({ q:'bee', city:'Atlanta', genre:'', belt:'Blue' });
  const url = calls[0].path;
  assert.match(url, /q=bee/); assert.match(url, /city=Atlanta/); assert.match(url, /belt=Blue/); assert.doesNotMatch(url, /genre=/);
  assert.equal(w.document.querySelectorAll('.find-card').length, 2);
  assert.equal(w.document.querySelector('#find-results img'), null);
  assert.match(w.document.querySelector('[data-find-dj="dj_bee"]').textContent, /Atlanta · House/);
  await C(w).followDj('dj_bee');
  assert.equal(followed.publicProfileId, 'dj_bee');
  assert.equal(w.document.querySelector('[data-find-follow="dj_bee"]').textContent, 'Following');
  w.document.querySelector('[data-find-challenge="dj_bee"]').click();
  await settle();
  assert.deepEqual(challenged, ['dj_bee', 'find_djs']);
});

test('find DJs: listing save goes to the server', async () => {
  const w = loadAppDom(); signIn(w);
  const calls = stubApi(w, p => p === '/api/me/searchProfile' ? { data:{ success:true } } : { data:{ results:[] } });
  await C(w).saveListing({ hometown:'Atlanta', genre:'House', searchable:false });
  const c = calls.find(x => x.path === '/api/me/searchProfile');
  assert.equal(c.method, 'PUT');
  assert.equal(JSON.stringify(c.body), JSON.stringify({ hometown:'Atlanta', genre:'House', searchable:false }));
  assert.match(w.document.getElementById('find-me-status').textContent, /hidden/);
});

function liveFixture(over = {}){
  return { battle:{ id:'b1', title:'Friday Clash', genre:'House', status:'live' }, djs:[{ displayName:'Bee', status:'Mixing now' }, { displayName:'Cee', status:'Mix submitted' }], chat:[{ id:'c1', body:XSS, author:{ displayName:'Bee' }, createdAt:'2026-10-20T12:00:00Z' }], watching:12, votingOpen:false, viewerIsDj:false, ...over };
}
test('watch live: shows watching count, DJ status and read-only chat', async () => {
  const w = loadAppDom();
  const calls = stubApi(w, (p, o = {}) => {
    if(p === '/api/battles/b1/watch') return { data:{ watching:13 } };
    if(p === '/api/battles/b1/live') return { data:liveFixture() };
    return null;
  });
  await C(w).openLive('b1');
  const room = w.document.querySelector('[data-watch-battle="b1"]');
  assert.ok(room);
  assert.match(w.document.getElementById('watch-count').textContent, /Watching: 12/);
  assert.deepEqual(Array.from(room.querySelectorAll('[data-dj-status]')).map(e => e.textContent), ['Mixing now', 'Mix submitted']);
  assert.equal(room.querySelector('#watch-chat img'), null);
  assert.equal(room.querySelector('input, textarea, form'), null, 'chat is read-only');
  assert.match(room.textContent, /opens when the battle ends/);
  const beat = calls.find(c => c.path === '/api/battles/b1/watch');
  assert.match(beat.body.viewerKey, /^[a-z0-9]{8,40}$/);
});

test('watch live: crowd voting opens when the battle ends', async () => {
  const w = loadAppDom(); signIn(w);
  const calls = stubApi(w, p => {
    if(p === '/api/battles/b1/live') return { data:liveFixture({ battle:{ id:'b1', title:'Friday Clash', status:'finished' }, votingOpen:true, djs:[{ displayName:'Bee', publicProfileId:'dj_bee', status:'Finished', canVoteFor:true }, { displayName:'Cee', publicProfileId:'dj_cee', status:'Finished', canVoteFor:true }] }) };
    if(p === '/api/battles/b1/live/vote') return { data:{ success:true } };
    if(p === '/api/battles/b1/watch') return { data:{ watching:3 } };
    return null;
  });
  await C(w).openLive('b1');
  assert.equal(w.document.querySelectorAll('[data-watch-vote]').length, 2);
  await C(w).crowdVote('dj_cee');
  assert.equal(calls.find(c => c.path === '/api/battles/b1/live/vote').body.publicProfileId, 'dj_cee');
  assert.equal(w.document.querySelector('[data-watch-vote="dj_cee"]').textContent, 'Voted ✓');
});

test('battle chat tells DJs that fans can read it', () => {
  assert.match(read('social.js'), /Fans watching this battle live can read this chat/);
});

test('shared tracklist: only title, artist, BPM and key are sent', async () => {
  const w = loadAppDom(); signIn(w);
  const calls = stubApi(w, p => p === '/api/sharedCrates' ? { status:201, data:{ tracklist:{ id:'tl_abc123', name:'Warmup' } } } : null);
  w.allLibraryCrates = () => [{ crateId:'cr1', id:'cr1', name:'Warmup' }];
  w.getLibraryCrateById = () => ({ crateId:'cr1', id:'cr1', name:'Warmup' });
  w.resolveCrateTrackIds = () => ['t1', 't2'];
  w.__DJBattleTestHooks.getLibraryTracksState().push(...w.eval(`[{ id:'t1', title:'Track One', artist:'Sample', bpm:124, camelotKey:'8A', audioUrl:'blob:secret', fileName:'one.mp3' }, { id:'t2', title:'Track Two', bpm:'128', key:'Am', storagePath:'u/2.wav' }]`));
  await C(w).shareCrate('cr1');
  const body = calls.find(c => c.path === '/api/sharedCrates').body;
  assert.equal(JSON.stringify(body.tracks), JSON.stringify([{ title:'Track One', artist:'Sample', bpm:124, key:'8A' }, { title:'Track Two', artist:null, bpm:128, key:'Am' }]));
  assert.doesNotMatch(JSON.stringify(body), /blob:|mp3|wav|storage/);
  assert.match(w.document.getElementById('crate-share-url').value, /\?tracklist=tl_abc123$/);
});

test('shared tracklist: viewer can copy it into a to-find list', async () => {
  const w = loadAppDom();
  stubApi(w, p => p === '/api/sharedCrates/tl_abc123' ? { data:{ tracklist:{ id:'tl_abc123', name:'Warmup', owner:{ displayName:'Bee' }, mine:false, tracks:[{ title:XSS, artist:null, bpm:124, key:'8A' }] } } } : null);
  await C(w).openSharedTracklist('tl_abc123');
  assert.equal(w.document.querySelector('#tracklist-rows img'), null);
  w.document.getElementById('tracklist-copy').click();
  const lists = C(w).toFindLists();
  assert.equal(lists.length, 1);
  assert.equal(lists[0].from, 'Bee');
  assert.equal(lists[0].tracks[0].found, false);
  C(w).toggleToFind('tl_abc123', 0, true);
  assert.equal(C(w).toFindLists()[0].tracks[0].found, true);
  C(w).renderSharePanel();
  assert.ok(w.document.getElementById('tofind-lists'));
  C(w).removeToFind('tl_abc123');
  assert.equal(C(w).toFindLists().length, 0);
});

test('weekly goal: weeks start on Monday and streak counts hit weeks', () => {
  const w = loadAppDom();
  const ws = C(w).weekStart(new w.Date(2026, 9, 21, 15)); // Wed Oct 21 2026
  assert.equal(ws.getDay(), 1);
  assert.equal(ws.getDate(), 19);
  assert.equal(C(w).weekStart(new w.Date(2026, 9, 25, 23)).getDate(), 19, 'Sunday belongs to the same week');
  const at = (d, h = 12) => ({ recordedAt:new Date(2026, 9, d, h).toISOString() });
  const sessions = [at(19), at(20), at(12), at(13), at(14), at(5), at(6), at(1)];
  const now = new Date(2026, 9, 21, 9);
  const p = C(w).goalProgress(now, sessions, 2);
  assert.equal(p.done, 2); assert.equal(p.hit, true);
  assert.equal(p.streak, 3, 'this week + 2 previous weeks');
  assert.equal(C(w).goalProgress(now, sessions, 3).streak, 1, 'only the week of Oct 12 hit 3, so streak breaks');
  assert.equal(C(w).goalProgress(new Date(2026, 9, 26, 9), sessions, 2).done, 0, 'resets Monday');
});

test('weekly goal: ring on Battle Home and server sync', async () => {
  const w = loadAppDom(); signIn(w);
  const calls = stubApi(w, (p, o = {}) => p === '/api/practiceGoal' ? (o.method === 'PUT' ? { data:{ goal:{ sessionsPerWeek:o.body.sessionsPerWeek } } } : { data:{ goal:{ sessionsPerWeek:3 } } }) : null);
  await C(w).loadGoal();
  const panel = w.document.getElementById('practice-goal');
  assert.ok(panel && panel.closest('#dashboard'));
  assert.ok(panel.querySelector('svg.goal-ring'));
  assert.match(panel.textContent, /Resets Monday/);
  await C(w).setGoal(5);
  assert.equal(JSON.stringify(calls.find(c => c.method === 'PUT').body), '{"sessionsPerWeek":5}');
  assert.match(w.document.getElementById('goal-status').textContent, /Saved to your account/);
  assert.equal(JSON.parse(w.localStorage.getItem('djbPracticeGoal')), 5);
});

test('new script is shipped everywhere', () => {
  assert.match(read('index.html'), /<script src="connect.js"><\/script>/);
  assert.match(read('sw.js'), /'connect.js'/);
  assert.match(read('scripts/build-pages.js'), /'connect.js'/);
  assert.match(read('package.json'), /node --check connect.js/);
});
