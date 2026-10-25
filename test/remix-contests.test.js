// Remix contests page: nav, list, contest page, entering, voting, host controls, Beat Store consent, reports, badge.
const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const windows = [];
test.after(() => windows.forEach(w => { try{ w.close(); }catch(e){} }));
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const settle = async (n = 10) => { for(let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

function loadAppDom({ url = 'https://127.0.0.1/index.html' } = {}){
  const dom = new JSDOM(read('index.html'), { url, runScripts:'outside-only', pretendToBeVisual:true });
  const { window } = dom;
  window.alert = () => {}; window.confirm = () => true; window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = function(){};
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLDialogElement.prototype.showModal = function(){ this.setAttribute('open', ''); this.open = true; };
  window.HTMLDialogElement.prototype.close = function(){ this.removeAttribute('open'); this.open = false; this.dispatchEvent(new window.Event('close')); };
  window.fetch = async () => ({ ok:false, status:503, text:async () => '{}', json:async () => ({}) });
  window.matchMedia = q => ({ matches:false, media:q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} });
  const beltScript = Array.from(window.document.querySelectorAll('script:not([src])')).find(s => s.textContent.includes('setCurrentBelt'));
  if(beltScript) window.eval(beltScript.textContent);
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/beatmatch_lessons.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js', 'social.js', 'connect.js', 'oct20.js', 'oct20b.js', 'passkeys.js', 'invites.js', 'remix_contests.js'].forEach(f => window.eval(read(f)));
  windows.push(window);
  return window;
}
function stubApi(window, handler){
  const calls = [];
  window.DJBattleApi.apiRequest = async (p, opts = {}) => {
    calls.push({ path:p, method:opts.method || 'GET', body:opts.body, public:opts.public });
    const out = await handler(p, opts);
    return out || { error:'Not found', status:404 };
  };
  return calls;
}
const ok = data => ({ data, status:200 });
const signIn = w => w.__DJBattleTestHooks.updateAuthUI({ id:'user-1', email:'dj@example.com', user_metadata:{ full_name:'Sample DJ' } });
const myInvite = (o = {}) => ({ code:'NOVA2345', joinCount:3, badge:{ key:'recruiter', emoji:'📣', label:'Crew Recruiter' }, next:{ label:'Scene Builder', emoji:'🌟', needed:7 }, friends:[{ displayName:'DJ Kilo', publicProfileId:'dj_2', joinedAt:'2026-10-24T12:00:00Z' }, { displayName:'DJ Echo', publicProfileId:'dj_3', joinedAt:'2026-10-23T12:00:00Z' }], ...o });

const later = h => new Date(Date.now() + h * 3600e3).toISOString();
const contest = (o = {}) => ({ id:'rmx_abc123abc123', title:'Flip My Beat (SAMPLE)', description:'Any genre welcome.', phase:'open', host:{ displayName:'DJ Host', publicProfileId:'dj_h' }, isHost:false,
  rights:{ classification:'original', label:'I made it (original)' }, submissionDeadline:later(30), votingDeadline:later(80), countdown:{ endsAt:later(30), what:'Submissions close' },
  parts:[{ id:'part_1', label:'Drums', filename:'drums.wav', size:10, uploaded:true }, { id:'part_2', label:'Bass', filename:'bass.wav', size:10, uploaded:true }],
  entryCount:2, winner:null, store:{ status:'none', listingId:null }, canEdit:false,
  entries:[{ id:'rmxe_1', title:'Night Flip', notes:'Half-time', dj:{ displayName:'DJ Alpha', publicProfileId:'dj_a' }, isMine:false, isWinner:false, votes:null, hidden:false },
    { id:'rmxe_2', title:'My Flip', notes:'', dj:{ displayName:'Sample DJ', publicProfileId:'dj_me' }, isMine:true, isWinner:false, votes:null, hidden:false }],
  totalVotes:null, viewer:{ signedIn:true, hasEntry:true, entryId:'rmxe_2', votedEntryId:null, canSubmit:true, canVote:false, isWinner:false }, ...o });

test('remix_contests.js is wired into the page, nav, routes, offline cache, Pages build, build checks and tests', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('remix_contests.js') > html.indexOf('invites.js'));
  assert.match(read('sw.js'), /'remix_contests\.js'/);
  assert.match(read('scripts/build-pages.js'), /'remix_contests\.js'/);
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.build, /node --check remix_contests\.js/);
  assert.match(pkg.scripts.test, /test\/remix-contests\.test\.js/);
  assert.match(read('app.js'), /\['remix-contests','RX','Remix Contests'\]/);
  const w = loadAppDom();
  assert.ok(w.document.querySelector('.nav-btn[data-view="remix-contests"]'));
  assert.equal(w.viewFromHash('#remix-contests'), 'remix-contests');
  assert.ok(w.document.getElementById('remix-contests'));
});

test('list page shows contests with phase and countdown, and explains when the server is missing', async () => {
  const w = loadAppDom();
  stubApi(w, () => ({ error:'offline', status:0 }));
  await w.DJBRemix.load();
  assert.match(w.document.getElementById('rmx-status').textContent, /needs the DJ Battle server/);
  stubApi(w, p => p === '/api/remix-contests' ? ok({ contests:[contest()] }) : null);
  await w.DJBRemix.load();
  const card = w.document.querySelector('.rmx-card');
  assert.match(card.textContent, /Taking remixes/);
  assert.match(card.textContent, /Submissions close in 1d/);
  assert.match(card.textContent, /DJ Host/);
});

test('contest page: parts download, replace-your-remix form, entries with play and report, no vote buttons before voting', async () => {
  const w = loadAppDom(); signIn(w);
  const calls = stubApi(w, p => {
    if(p === '/api/remix-contests/rmx_abc123abc123') return ok({ contest:contest() });
    if(p.endsWith('/download')) return ok({ url:'https://signed.test/x', filename:'drums.wav' });
    if(p.endsWith('/play')) return ok({ url:'https://signed.test/play' });
    return null;
  });
  await w.DJBRemix.open('rmx_abc123abc123');
  const page = w.document.getElementById('rmx-page');
  assert.equal(page.classList.contains('hidden'), false);
  assert.match(page.textContent, /Replace your remix/);
  assert.equal(page.querySelectorAll('[data-rmx-part]').length, 2);
  assert.equal(page.querySelectorAll('[data-rmx-vote]').length, 0);
  assert.equal(page.querySelectorAll('[data-rmx-report-entry]').length, 1, 'cannot report your own remix');
  page.querySelector('[data-rmx-part]').click(); await settle();
  assert.ok(calls.some(c => c.path === '/api/remix-contests/rmx_abc123abc123/parts/part_1/download' && c.method === 'POST'));
  page.querySelector('[data-rmx-play="rmxe_1"]').click(); await settle();
  assert.equal(page.querySelector('[data-rmx-audio="rmxe_1"]').getAttribute('src'), 'https://signed.test/play');
  page.querySelector('[data-rmx-report-entry]').click(); await settle();
  w.document.getElementById('rmx-report-reason').value = 'copyright';
  w.document.getElementById('rmx-report-form').dispatchEvent(new w.Event('submit', { cancelable:true })); await settle();
  assert.ok(calls.some(c => c.path === '/api/community/reports' && c.body.targetType === 'remix_entry' && c.body.targetId === 'rmxe_1' && c.body.reason === 'copyright'));
  assert.doesNotMatch(page.innerHTML, /[0-9a-f]{8}-[0-9a-f]{4}-/i, 'no private account ids');
});

test('voting phase: vote buttons on other people\u2019s remixes only, and voting posts the entry id', async () => {
  const w = loadAppDom(); signIn(w);
  let voted = false;
  const calls = stubApi(w, (p, o) => {
    if(p === '/api/remix-contests/rmx_abc123abc123') return ok({ contest:contest({ phase:'voting', countdown:{ endsAt:later(20), what:'Voting closes' }, viewer:{ signedIn:true, hasEntry:true, votedEntryId:voted ? 'rmxe_1' : null, canSubmit:false, canVote:!voted, isWinner:false } }) });
    if(p.endsWith('/vote')){ voted = true; return ok({ voted:true }); }
    return null;
  });
  await w.DJBRemix.open('rmx_abc123abc123');
  const page = w.document.getElementById('rmx-page');
  assert.match(page.textContent, /One vote per account/);
  assert.deepEqual([...page.querySelectorAll('[data-rmx-vote]')].map(b => b.dataset.rmxVote), ['rmxe_1']);
  assert.equal(w.document.getElementById('rmx-entry-form'), null);
  page.querySelector('[data-rmx-vote]').click(); await settle(20);
  assert.ok(calls.some(c => c.path.endsWith('/vote') && c.body.entryId === 'rmxe_1'));
  assert.match(w.document.getElementById('rmx-page').textContent, /Your vote/);
});

test('host controls: edit and cancel before entries; Beat Store ask after a win; winner sees yes/no', async () => {
  const w = loadAppDom(); signIn(w);
  let c = contest({ isHost:true, canEdit:true, entries:[], entryCount:0, viewer:{ signedIn:true, canSubmit:false } });
  const calls = stubApi(w, p => (p === '/api/remix-contests/rmx_abc123abc123' ? ok({ contest:c }) : p.endsWith('/cancel') || p.endsWith('/store-offer') || p.endsWith('/store-consent') ? ok({}) : null));
  w.appConfirmDanger = async () => true;
  await w.DJBRemix.open(c.id);
  assert.ok(w.document.getElementById('rmx-edit'));
  assert.match(w.document.getElementById('rmx-page').textContent, /can\u2019t enter/);
  w.document.getElementById('rmx-cancel').click(); await settle(20);
  assert.ok(calls.some(x => x.path.endsWith('/cancel')));
  c = contest({ isHost:true, phase:'completed', countdown:null, winner:{ displayName:'DJ Alpha', publicProfileId:'dj_a', entryId:'rmxe_1' }, viewer:{ signedIn:true } });
  await w.DJBRemix.open(c.id);
  assert.equal(w.document.getElementById('rmx-edit'), null);
  w.document.getElementById('rmx-store-offer').click(); await settle();
  w.document.getElementById('rmx-store-price').value = '7';
  w.document.getElementById('rmx-store-form').dispatchEvent(new w.Event('submit', { cancelable:true })); await settle(20);
  assert.ok(calls.some(x => x.path.endsWith('/store-offer') && x.body.priceCents === 700));
  c = contest({ phase:'completed', countdown:null, winner:{ displayName:'Sample DJ', publicProfileId:'dj_me', entryId:'rmxe_2' }, store:{ status:'offered' }, viewer:{ signedIn:true, isWinner:true } });
  await w.DJBRemix.open(c.id);
  assert.match(w.document.getElementById('rmx-page').textContent, /You won!/);
  w.document.getElementById('rmx-consent-yes').click(); await settle(20);
  assert.ok(calls.some(x => x.path.endsWith('/store-consent') && x.body.accept === true));
});

test('host form requires the rights confirmation before anything is sent', async () => {
  const w = loadAppDom(); signIn(w);
  const calls = stubApi(w, () => null);
  w.DJBRemix.openCreate();
  w.document.getElementById('rmx-title').value = 'Test';
  w.document.getElementById('rmx-create-form').dispatchEvent(new w.Event('submit', { cancelable:true })); await settle();
  assert.match(w.document.getElementById('rmx-create-status').textContent, /confirm you have the rights/i);
  assert.equal(calls.filter(c => c.path === '/api/remix-contests').length, 0);
  assert.match(w.document.getElementById('rmx-create-dialog').textContent, /same rules as the Beat Store/);
});

test('Activity alerts open the contest; Remix Champion badge shows on Profile', async () => {
  const w = loadAppDom(); signIn(w);
  stubApi(w, p => p === '/api/me/remix-contests' ? ok({ wins:2, badge:{ label:'Remix Champion' } }) : p.startsWith('/api/remix-contests/rmx_') ? ok({ contest:contest() }) : null);
  assert.match(read('app.js'), /destination\.type === 'remix_contest'/);
  await w.DJBRemix.openFromAnywhere('rmx_abc123abc123');
  assert.equal(w.document.body.dataset.view, 'remix-contests');
  await w.DJBRemix.renderProfileBadge();
  assert.match(w.document.getElementById('profile-remix-badge').textContent, /2× Remix Champion/);
});
