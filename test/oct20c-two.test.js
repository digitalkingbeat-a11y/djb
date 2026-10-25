// Oct 20c: Profile tabs fit on desktop, discount code count shown, and personal invite-a-friend links.
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
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/beatmatch_lessons.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js', 'social.js', 'connect.js', 'oct20.js', 'oct20b.js', 'passkeys.js', 'invites.js'].forEach(f => window.eval(read(f)));
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

test('invites.js is wired into the page, offline cache, Pages build, build checks and test list', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('invites.js') > html.indexOf('passkeys.js'));
  assert.match(read('sw.js'), /'invites\.js'/);
  assert.match(read('scripts/build-pages.js'), /'invites\.js'/);
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.build, /node --check invites\.js/);
  assert.match(pkg.scripts.test, /test\/oct20c-two\.test\.js/);
  assert.match(read('app.js'), /window\.DJBInvites\.onView\(view\)/);
});

test('Profile tabs wrap on desktop instead of pushing the page sideways; phones keep the scroll strip', () => {
  const css = read('professional-redesign.css');
  const desktop = css.slice(css.indexOf('/* Oct 20c: Profile tabs fit on desktop'));
  assert.match(desktop, /@media \(min-width:761px\)\{\s*\.profile-tabs\{flex-wrap:wrap/);
  assert.match(css, /@media\(max-width:760px\)\{[\s\S]*\.profile-tabs\{flex-wrap:nowrap;overflow-x:auto/);
});

test('discount code list shows uses that are still waiting on payment', async () => {
  const src = read('oct20b.js');
  assert.match(src, /waiting on payment/);
  assert.match(src, /c\.reservedUses/);
});

test('signed-in DJ sees their invite link, Copy, join count, badge and friends on Profile', async () => {
  const w = loadAppDom();
  const calls = stubApi(w, p => p === '/api/invites/mine' ? ok({ invite:myInvite() }) : null);
  signIn(w);
  w.switchView('profile');
  await settle();
  const panel = w.document.getElementById('profile-invite');
  assert.ok(panel, 'invite card is on Profile');
  assert.ok(panel.compareDocumentPosition(w.document.querySelector('.profile-tabs')) & w.Node.DOCUMENT_POSITION_FOLLOWING, 'card sits above the tabs');
  assert.equal(w.document.getElementById('invite-link').value, 'https://127.0.0.1/?invite=NOVA2345');
  assert.equal(w.document.getElementById('invite-join-count').textContent, '3');
  assert.match(w.document.getElementById('invite-badge').textContent, /Crew Recruiter/);
  assert.match(panel.textContent, /7 more to unlock/);
  assert.equal(w.document.querySelectorAll('#invite-friends li').length, 2);
  assert.ok(calls.some(c => c.path === '/api/invites/mine'));
  let copied = null;
  Object.defineProperty(w.navigator, 'clipboard', { value:{ writeText:async t => { copied = t; } }, configurable:true });
  w.document.getElementById('invite-copy').click();
  await settle();
  assert.equal(copied, 'https://127.0.0.1/?invite=NOVA2345');
  assert.equal(w.document.getElementById('invite-copy').textContent, 'Copied!');
});

test('no badge yet shows a locked badge; signed out asks to sign in; missing SQL names the file', async () => {
  const w = loadAppDom();
  stubApi(w, p => p !== '/api/invites/mine' ? null : ok({ invite:myInvite({ joinCount:0, badge:null, next:{ label:'Connector', emoji:'🤝', needed:1 }, friends:[] }) }));
  w.switchView('profile'); await settle();
  assert.match(w.document.getElementById('profile-invite').textContent, /Sign in to get your personal invite link/);
  signIn(w); await w.DJBInvites.load();
  const text = w.document.getElementById('profile-invite').textContent;
  assert.match(text, /First badge at 1 friend/);
  assert.match(text, /No friends have joined yet/);
  stubApi(w, () => ({ error:'x', status:503, data:{ schemaMissing:true, schema:'048_create_dj_invites' } }));
  await w.DJBInvites.load();
  assert.match(w.document.getElementById('profile-invite').textContent, /048_create_dj_invites\.sql/);
});

test('opening an invite link remembers the code, tidies the address bar, shows who invited you, and claims it after sign-in', async () => {
  const w = loadAppDom({ url:'https://127.0.0.1/index.html?invite=nova2345#battle-home' });
  assert.equal(w.location.search, '', 'invite code removed from the address bar');
  assert.equal(JSON.parse(w.localStorage.getItem('djbPendingInvite')).code, 'NOVA2345');
  const calls = stubApi(w, (p, o) => {
    if(p === '/api/invites/NOVA2345') return ok({ invite:{ code:'NOVA2345', inviter:{ displayName:'DJ Nova', publicProfileId:'dj_1' } } });
    if(p === '/api/invites/claim' && o.method === 'POST') return { data:{ claimed:true, inviter:{ displayName:'DJ Nova' } }, status:201 };
    return null;
  });
  await w.DJBInvites.lookupInviter();
  const bar = w.document.getElementById('invite-welcome');
  assert.ok(bar);
  assert.match(bar.textContent, /DJ Nova invited you/);
  assert.equal(calls.find(c => c.path === '/api/invites/NOVA2345').public, true, 'lookup works signed out');
  let toast = null; w.showAppToast = (t, b) => { toast = `${t} ${b}`; };
  signIn(w); await settle();
  const claim = calls.find(c => c.path === '/api/invites/claim');
  assert.equal(claim.body.code, 'NOVA2345');
  assert.equal(w.localStorage.getItem('djbPendingInvite'), null, 'claimed once, then forgotten');
  assert.equal(w.document.getElementById('invite-welcome'), null);
  assert.match(toast, /DJ Nova/);
});

test('a claim the server can\u2019t reach is kept for later; an old account or old link is just dropped quietly', async () => {
  const w = loadAppDom({ url:'https://127.0.0.1/?invite=ABCD2345' });
  stubApi(w, () => ({ error:'down', status:0 }));
  signIn(w); await settle();
  await w.DJBInvites.claimPending();
  assert.ok(w.localStorage.getItem('djbPendingInvite'), 'kept when the server is offline');
  let toasts = 0; w.showAppToast = () => { toasts++; };
  stubApi(w, () => ok({ success:true, claimed:false, reason:'not_new_account' }));
  await w.DJBInvites.claimPending();
  assert.equal(w.localStorage.getItem('djbPendingInvite'), null);
  assert.equal(toasts, 0, 'no welcome toast for an existing account');
  w.localStorage.setItem('djbPendingInvite', JSON.stringify({ code:'ABCD2345', at:Date.now() - 31 * 86400000 }));
  assert.equal(w.DJBInvites.readPending(), null, 'links older than 30 days expire');
});

test('Activity bell: "friend joined" alerts open Profile at the invite card and skip challenge rules text', async () => {
  const app = read('app.js');
  assert.match(app, /destination\.type === 'invites' && window\.DJBInvites/);
  assert.match(app, /'timed_comment_received', 'invite_joined'\]\.includes\(notification\.type\)/);
  const w = loadAppDom();
  stubApi(w, p => p === '/api/invites/mine' ? ok({ invite:myInvite() }) : null);
  signIn(w);
  const panel = await w.DJBInvites.focus();
  assert.equal(w.document.body.dataset.view || w.document.querySelector('.view.active').id, 'profile');
  assert.ok(panel && panel.id === 'profile-invite');
});
