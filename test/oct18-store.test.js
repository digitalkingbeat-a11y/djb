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
const AVATAR = id => `https://proj.supabase.co/storage/v1/object/public/profile-avatars/avatars/${id}/avatar-1.jpg`;

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
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'].forEach(file => {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });
  windows.push(window);
  return window;
}
function signIn(window, id = 'user-1'){
  window.__DJBattleTestHooks.updateAuthUI({ id, email:`${id}@example.com`, user_metadata:{ full_name:'Store DJ' } });
}
function mockApi(window, routes){
  const calls = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    calls.push({ url, method:options.method || 'GET', body:options.body, public:options.public === true });
    for(const [pattern, handler] of routes){
      const hit = typeof pattern === 'string' ? url === pattern : pattern.test(url);
      if(hit) return typeof handler === 'function' ? handler(url, options) : handler;
    }
    return { error:'Request failed (503).', status:503, data:{ error:'Service unavailable' } };
  };
  return calls;
}
function catalogListing(id, extra = {}){
  return { id, title:`Beat ${id}`, description:'Warm house loop', status:'published', product:{ type:'beat', genre:'House', bpm:124, key:'A minor' }, freeDownload:{ offerId:`offer-${id}`, downloadConsentRequired:true, marketingConsentRequired:false, verificationRequired:false, consentText:'Send me this free download.' }, ...extra };
}
async function confirmOverlay(window, accept = true){
  for(let i = 0; i < 20 && !window.document.querySelector('.app-confirm-overlay'); i++) await nextTick();
  const overlay = window.document.querySelector('.app-confirm-overlay');
  assert.ok(overlay, 'in-app confirm opened');
  const text = overlay.textContent;
  overlay.querySelector(accept ? '[data-app-confirm-ok]' : '[data-app-confirm-cancel]').click();
  return text;
}

/* ---------- 1. Beat Store ---------- */

test('Beat Store is a routed page in the nav and More sheet, and browsing works signed out', async () => {
  const window = loadAppDom();
  const calls = mockApi(window, [[/^\/api\/marketplace\/catalog/, { status:200, data:{ success:true, listings:[catalogListing('l1'), catalogListing('l2', { freeDownload:null })], pagination:{ page:1, hasMore:false } } }]]);
  const doc = window.document;
  assert.ok(doc.querySelector('#nav .nav-btn[data-view="store"]'), 'desktop nav has Beat Store');
  assert.ok(window.__DJBattleTestHooks.navMoreItems().some(item => item.view === 'store'), 'phone More sheet lists Beat Store');
  doc.querySelector('#nav .nav-btn[data-view="store"]').click();
  await settle();
  assert.equal(window.location.hash, '#store');
  assert.equal(doc.getElementById('page-title').textContent, 'Beat Store');
  const catalogCall = calls.find(c => c.url.startsWith('/api/marketplace/catalog'));
  assert.ok(catalogCall && catalogCall.public, 'signed-out browse uses the public route');
  const cards = doc.querySelectorAll('[data-store-listing]');
  assert.equal(cards.length, 2);
  assert.match(cards[0].textContent, /FREE for email/);
  assert.ok(cards[0].querySelector('[data-store-claim="l1"]'));
  assert.match(cards[1].textContent, /Preview only/);
  assert.match(doc.getElementById('store-status').textContent, /Sign in to list your own/);
  assert.equal(calls.some(c => c.url.includes('myListings')), false, 'no seller calls when signed out');
});

test('deep link #store opens the Beat Store; #practice opens the Practice Log', async () => {
  const w1 = loadAppDom({ url:'http://127.0.0.1/index.html#store' });
  await settle();
  assert.equal(w1.document.querySelector('.view.active').id, 'store');
  const w2 = loadAppDom({ url:'http://127.0.0.1/index.html#practice' });
  await settle();
  assert.equal(w2.document.querySelector('.view.active').id, 'practice');
});

test('only tracks with cleared rights can be listed, with a clear reason otherwise', () => {
  const window = loadAppDom();
  const check = window.__DJBattleTestHooks.beatStoreTrackEligibility;
  assert.equal(check({ id:'a', serverBacked:true, rightsClassification:'original' }).ok, true);
  ['licensed', 'royalty_free', 'platform_cleared'].forEach(r => assert.equal(check({ id:'a', serverBacked:true, rightsClassification:r }).ok, true));
  const blocked = check({ id:'b', serverBacked:true, rightsClassification:'unknown' });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /Original, Licensed, Royalty-free or Platform-cleared/);
  assert.match(check({ id:'c', serverBacked:false, rightsClassification:'original' }).reason, /upload it to your account/);
  assert.match(check({ id:'d', serverBacked:true, rightsClassification:'original', sourceType:'practice_recording' }).reason, /Practice recordings/);
});

test('signed out, listing a beat asks you to sign in and sends nothing', async () => {
  const window = loadAppDom();
  const calls = mockApi(window, []);
  assert.equal(window.__DJBattleTestHooks.openBeatStoreCreate(), null);
  assert.match(window.document.getElementById('notification-toast-rack').textContent, /Sign in to list a beat/);
  assert.equal(calls.length, 0);
});

test('signed in: create listing → free file → offer, and the modal blocks uncleared tracks', async () => {
  const window = loadAppDom();
  const calls = mockApi(window, [
    ['/api/marketplace/listings', { status:201, data:{ listing:{ id:'listing-9', title:'Night Drive' } } }],
    ['/api/marketplace/listings/listing-9/freeDownloadFile', { status:200, data:{ file:{ id:'free-mp3', type:'mp3', filename:'Night Drive.mp3', mimeType:'audio/mpeg', storageObjectPath:'private/marketplace-downloads/u/listing-9/free.mp3' } } }],
    ['/api/marketplace/freeEmail/offers', { status:201, data:{ offer:{ id:'offer-9', freeEmailEnabled:true } } }],
    [/^\/api\/marketplace\/catalog/, { status:200, data:{ listings:[], pagination:{} } }],
    ['/api/marketplace/myListings', { status:200, data:{ listings:[] } }]
  ]);
  signIn(window);
  window.__DJBattleTestHooks.getLibraryTracksState().unshift({ id:'trk-ok', serverBacked:true, title:'Night Drive', rightsClassification:'original', sourceType:'track' }, { id:'trk-bad', serverBacked:true, title:'Bootleg Edit', rightsClassification:'unknown', sourceType:'track' });
  assert.equal(window.__DJBattleTestHooks.openBeatStoreCreate(), true);
  const doc = window.document;
  const bad = doc.querySelector('input[name="store-track"][value="trk-bad"]');
  assert.equal(bad.disabled, true);
  assert.match(bad.closest('label').textContent, /Only Original, Licensed/);
  const submit = doc.getElementById('store-create-submit');
  assert.equal(submit.disabled, true);
  doc.querySelector('input[name="store-track"][value="trk-ok"]').click();
  doc.querySelector('input[name="store-track"][value="trk-ok"]').dispatchEvent(new window.Event('change'));
  assert.equal(submit.disabled, true, 'needs the rights box too');
  const attest = doc.getElementById('store-create-attest');
  attest.checked = true; attest.dispatchEvent(new window.Event('change'));
  assert.equal(submit.disabled, false);
  submit.click();
  await settle(12);
  const writes = calls.filter(c => c.method === 'POST').map(c => c.url);
  assert.deepEqual(plain(writes.slice(0, 3)), ['/api/marketplace/listings', '/api/marketplace/listings/listing-9/freeDownloadFile', '/api/marketplace/freeEmail/offers']);
  const listingBody = calls.find(c => c.url === '/api/marketplace/listings').body;
  assert.equal(listingBody.libraryTrackId, 'trk-ok');
  assert.equal(listingBody.downloadAllowed, true);
  assert.equal(listingBody.status, 'published');
  assert.equal(listingBody.displayPriceCents, 0);
  const offerBody = calls.find(c => c.url === '/api/marketplace/freeEmail/offers').body;
  assert.equal(offerBody.listingId, 'listing-9');
  assert.equal(offerBody.allowedFiles[0].storageObjectPath, 'private/marketplace-downloads/u/listing-9/free.mp3');
  assert.equal(offerBody.verificationRequired, false);
  assert.match(doc.getElementById('notification-toast-rack').textContent, /Beat listed/);
  assert.equal(calls.some(c => /checkout/.test(c.url)), false, 'no paid checkout');
});

test('a server refusal (e.g. WAV) is shown in the listing dialog, step by step', async () => {
  const window = loadAppDom();
  mockApi(window, [
    ['/api/marketplace/listings', { status:201, data:{ listing:{ id:'listing-w' } } }],
    ['/api/marketplace/listings/listing-w/freeDownloadFile', { error:'Request failed (422).', status:422, data:{ error:'Free downloads must be MP3 files. WAV and other formats stay private.' } }]
  ]);
  signIn(window);
  window.__DJBattleTestHooks.getLibraryTracksState().unshift({ id:'trk-wav', serverBacked:true, title:'Wav', rightsClassification:'original', sourceType:'track' });
  const result = await window.__DJBattleTestHooks.createFreeBeatListing({ trackId:'trk-wav' });
  assert.equal(result.step, 'file');
  assert.match(result.error, /Listing saved, but the free download isn't ready: Free downloads must be MP3/);
});

test('claiming with an email downloads the beat; the token is kept for this browser only', async () => {
  const window = loadAppDom();
  let clicked = '';
  window.HTMLAnchorElement.prototype.click = function(){ clicked = this.href; };
  const calls = mockApi(window, [
    [/^\/api\/marketplace\/catalog/, { status:200, data:{ listings:[catalogListing('l1')], pagination:{} } }],
    ['/api/marketplace/freeEmail/claims', { status:201, data:{ lead:{ id:'lead-1' }, downloadAccessToken:'tok-123', verificationRequired:false } }],
    ['/api/marketplace/freeEmail/downloads/access', { status:200, data:{ downloadAccess:{ url:'https://proj.supabase.co/storage/v1/object/sign/battle-mixes/private/marketplace-downloads/x/free.mp3?token=abc', file:{ filename:'Beat l1.mp3' } } } }]
  ]);
  await window.__DJBattleTestHooks.loadBeatStore();
  window.__DJBattleTestHooks.openBeatStoreClaim('l1');
  const doc = window.document;
  doc.getElementById('store-claim-email').value = 'not-an-email';
  doc.getElementById('store-claim-submit').click();
  await settle();
  assert.match(doc.getElementById('store-claim-error').textContent, /real email/);
  doc.getElementById('store-claim-email').value = 'fan@example.com';
  doc.getElementById('store-claim-submit').click();
  await settle();
  assert.match(doc.getElementById('store-claim-error').textContent, /Tick the box/);
  doc.getElementById('store-claim-consent').checked = true;
  doc.getElementById('store-claim-submit').click();
  await settle(10);
  const claim = calls.find(c => c.url === '/api/marketplace/freeEmail/claims');
  assert.deepEqual({ listingId:claim.body.listingId, email:claim.body.email, consent:claim.body.downloadConsentAccepted, marketing:claim.body.marketingConsentAccepted }, { listingId:'l1', email:'fan@example.com', consent:true, marketing:false });
  const access = calls.find(c => c.url === '/api/marketplace/freeEmail/downloads/access');
  assert.deepEqual(plain(access.body), { leadId:'lead-1', downloadAccessToken:'tok-123' });
  assert.match(clicked, /^https:\/\/proj\.supabase\.co/);
  assert.equal(window.__DJBattleTestHooks.beatStoreClaims().l1.downloadAccessToken, 'tok-123');
  assert.match(doc.querySelector('[data-store-claim="l1"]').textContent, /Download again/);
});

test('a repeat claim from another browser explains where to download', async () => {
  const window = loadAppDom();
  mockApi(window, [['/api/marketplace/freeEmail/claims', { status:200, data:{ duplicate:true, lead:{ id:'lead-1' } } }]]);
  const result = await window.__DJBattleTestHooks.claimFreeBeat('l1', { email:'fan@example.com' });
  assert.match(result.error, /already claimed/);
});

test('offline and not-set-up states are honest and do not pretend to load', async () => {
  const window = loadAppDom({ setup:w => { Object.defineProperty(w.navigator, 'onLine', { configurable:true, get:() => false }); } });
  const calls = mockApi(window, []);
  window.__DJBattleTestHooks.switchView('store');
  await settle();
  assert.match(window.document.getElementById('store-status').textContent, /You're offline/);
  assert.equal(calls.length, 0);
  const w2 = loadAppDom();
  mockApi(w2, [[/^\/api\/marketplace\/catalog/, { error:'Request failed (503).', status:503, data:{ error:'Supabase service role client is not configured' } }]]);
  await w2.__DJBattleTestHooks.loadBeatStore();
  assert.match(w2.document.getElementById('store-status').textContent, /isn't switched on yet/);
});

test('sellers see their claim counts and the email list', async () => {
  const window = loadAppDom();
  mockApi(window, [
    [/^\/api\/marketplace\/catalog/, { status:200, data:{ listings:[], pagination:{} } }],
    ['/api/marketplace/myListings', { status:200, data:{ listings:[{ id:'mine-1', title:'My Beat', status:'published', claimCount:2, freeDownload:{ offerId:'o' } }] } }],
    [/^\/api\/marketplace\/freeEmail\/leads/, { status:200, data:{ leads:[{ listingId:'mine-1', email:'a@example.com', marketingConsentStatus:'accepted', claimedAt:new Date().toISOString() }, { listingId:'mine-1', email:'b@example.com', marketingConsentStatus:'declined', claimedAt:new Date().toISOString() }] } }]
  ]);
  signIn(window);
  await window.__DJBattleTestHooks.loadBeatStore();
  const doc = window.document;
  const row = doc.querySelector('[data-store-mine="mine-1"]');
  assert.match(row.textContent, /2\s*claims/);
  row.querySelector('[data-store-leads]').click();
  await settle();
  const after = doc.querySelector('[data-store-mine="mine-1"]').textContent;
  assert.match(after, /a@example\.com/);
  assert.match(after, /OK to email about new beats/);
  assert.match(after, /b@example\.com/);
});

/* ---------- 2. Other DJs' photos ---------- */

test('other DJs\' server photos show on comments, follow lists, challenges and the battle room, with initials fallback', () => {
  const window = loadAppDom();
  const comment = window.communityCommentHtml({ id:'c1', author:{ displayName:'Rival DJ', publicProfileId:'dj_rival', avatarUrl:AVATAR('r') }, bodyText:'nice', reactionCounts:{} });
  assert.match(comment, new RegExp(`<img src="${AVATAR('r').replace(/[.?]/g, '\\$&')}"`));
  const noPhoto = window.communityCommentHtml({ id:'c2', author:{ displayName:'Plain DJ', publicProfileId:'dj_plain' }, bodyText:'hi', reactionCounts:{} });
  assert.doesNotMatch(noPhoto, /<img/);
  assert.match(noPhoto, />PD</);
  const unsafe = window.communityCommentHtml({ id:'c3', author:{ displayName:'Bad DJ', publicProfileId:'dj_bad', avatarUrl:'http://insecure.example.com/a.jpg' }, bodyText:'x', reactionCounts:{} });
  assert.doesNotMatch(unsafe, /<img/);
  const follow = window.relationshipRowHtml({ id:'f1', direction:'following', profile:{ displayName:'Follow DJ', publicProfileId:'dj_follow', avatarUrl:AVATAR('f') } });
  assert.match(follow, /<img src="https:\/\/proj\.supabase\.co/);
  const challenge = window.challengeRowHtml({ id:'ch1', direction:'received', status:'pending', challenger:{ displayName:'Challenger', publicProfileId:'dj_ch', avatarUrl:AVATAR('c') }, rules:{}, eligibility:{} });
  assert.match(challenge, /<img src="https:\/\/proj\.supabase\.co/);
  window.renderBattleRoom({ title:'Room', mode:'Battle', genre:'House', duration:10, opponent:{ name:'Opp DJ', publicProfileId:'dj_opp', avatarUrl:AVATAR('o') }, assigned:[] });
  assert.match(window.document.querySelector('#br-dj2 .avatar').innerHTML, /<img/);
  window.renderBattleRoom({ title:'Room', mode:'Battle', genre:'House', duration:10, opponent:null, assigned:[] });
  assert.equal(window.document.querySelector('#br-dj2 .avatar').textContent, 'AI');
});

test('rankings and posts render the photo the server attached for other DJs', () => {
  const window = loadAppDom();
  const h = window.__DJBattleTestHooks;
  assert.equal(h.avatarUrlForDj({ name:'Someone Else', publicProfileId:'dj_else', avatarUrl:AVATAR('e') }), AVATAR('e'));
  assert.equal(h.avatarUrlForDj({ name:'Someone Else', publicProfileId:'dj_else', avatarUrl:'javascript:alert(1)' }), '');
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(source, /avatarUrlForDj\(\{ name:row\.djName, publicProfileId:row\.publicProfileId, avatarUrl:row\.avatarUrl \}\)/, 'rankings use row.avatarUrl');
  assert.match(source, /avatarUrl:post\.author && \(post\.author\.avatarUrl \|\| post\.author\.avatar_url\)/, 'posts use author.avatarUrl');
});

/* ---------- 3. Blocked & muted ---------- */

test('signed out, Settings explains that blocks and mutes need an account', async () => {
  const window = loadAppDom();
  const calls = mockApi(window, []);
  window.__DJBattleTestHooks.switchView('settings');
  await settle();
  assert.match(window.document.getElementById('settings-safety-list').textContent, /Sign in to see DJs you've blocked or muted/);
  assert.equal(calls.filter(c => /blocks|notificationMutes/.test(c.url)).length, 0);
});

test('Blocked & muted lists your blocks and mutes; Unblock asks first, then removes the row', async () => {
  const window = loadAppDom();
  const calls = mockApi(window, [
    ['/api/blocks', { status:200, data:{ blocks:[{ id:'block-1', blockedProfile:{ displayName:'Rude DJ', publicProfileId:'dj_rude', avatarUrl:AVATAR('rude') }, createdAt:new Date().toISOString() }] } }],
    ['/api/notificationMutes', { status:200, data:{ mutes:[{ id:'mute-1', category:'challenge', mutedProfile:{ displayName:'Loud DJ', publicProfileId:'dj_loud' }, createdAt:new Date().toISOString() }] } }],
    [/^\/api\/blocks\//, { status:200, data:{ success:true } }],
    [/^\/api\/notificationMutes\//, { status:200, data:{ success:true } }]
  ]);
  signIn(window);
  window.__DJBattleTestHooks.switchView('settings');
  await settle(8);
  const box = window.document.getElementById('settings-safety-list');
  assert.match(box.textContent, /Blocked \(1\)/);
  assert.match(box.textContent, /Rude DJ/);
  assert.match(box.textContent, /Muted \(1\)/);
  assert.match(box.textContent, /Challenge notifications muted/);
  assert.ok(box.querySelector('[data-safety-block="block-1"] img'), 'blocked DJ photo shown');
  // Cancel keeps the block.
  box.querySelector('[data-safety-undo="block"]').click();
  const cancelText = await confirmOverlay(window, false);
  assert.match(cancelText, /Unblock Rude DJ\?/);
  await settle();
  assert.equal(calls.some(c => c.method === 'DELETE'), false);
  // Confirm removes it.
  window.document.querySelector('[data-safety-undo="block"]').click();
  await confirmOverlay(window, true);
  await settle();
  assert.ok(calls.find(c => c.method === 'DELETE' && c.url === '/api/blocks/block-1'));
  assert.equal(window.document.querySelector('[data-safety-block="block-1"]'), null);
  window.document.querySelector('[data-safety-undo="mute"]').click();
  const muteText = await confirmOverlay(window, true);
  assert.match(muteText, /Unmute Loud DJ\?/);
  await settle();
  assert.ok(calls.find(c => c.method === 'DELETE' && c.url === '/api/notificationMutes/mute-1'));
  assert.match(window.document.getElementById('settings-safety-list').textContent, /You haven't blocked or muted anyone/);
});

/* ---------- 4. Home-screen install ---------- */

test('manifest has name, theme, start URL and real 192/512 + maskable PNG icons; index links it', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'DJ Battle');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#0b0f14');
  assert.ok(manifest.start_url);
  const png = file => { const buf = fs.readFileSync(path.join(root, file)); assert.equal(buf.toString('hex', 0, 8), '89504e470d0a1a0a', `${file} is a PNG`); return [buf.readUInt32BE(16), buf.readUInt32BE(20)]; };
  const icons = Object.fromEntries(manifest.icons.filter(i => i.type === 'image/png').map(i => [`${i.sizes}:${i.purpose}`, i.src]));
  assert.deepEqual(png(icons['192x192:any']), [192, 192]);
  assert.deepEqual(png(icons['512x512:any']), [512, 512]);
  assert.deepEqual(png(icons['512x512:maskable']), [512, 512]);
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(index, /<link rel="manifest" href="manifest.webmanifest"/);
  assert.match(index, /apple-touch-icon-180\.png/);
  const offline = fs.readFileSync(path.join(root, 'offline.html'), 'utf8');
  assert.match(offline, /You're offline/);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.build, /node --check sw\.js/);
  assert.match(pkg.scripts.build, /manifest\.webmanifest/);
});

function loadServiceWorker(){
  const listeners = {};
  const stores = new Map([['djb-shell-v0', new Map()], ['other-app-cache', new Map()]]);
  const caches = {
    async open(name){ if(!stores.has(name)) stores.set(name, new Map()); const map = stores.get(name); return { async add(req){ map.set(new URL(req.url || req, 'https://app.test/').pathname, { body:'cached' }); }, async match(req){ return map.get(new URL(req.url || req, 'https://app.test/').pathname); }, async put(req, res){ map.set(new URL(req.url).pathname, res); } }; },
    async keys(){ return Array.from(stores.keys()); },
    async delete(name){ return stores.delete(name); },
    async match(req, opts){ const map = stores.get(opts && opts.cacheName); return map && map.get(new URL(req, 'https://app.test/').pathname); }
  };
  let networkUp = true;
  const fetched = [];
  const context = {
    self:{ addEventListener:(type, fn) => { listeners[type] = fn; }, location:{ origin:'https://app.test' }, skipWaiting:() => Promise.resolve(), clients:{ claim:() => Promise.resolve() } },
    caches, URL, Request:function Request(url){ this.url = new URL(url, 'https://app.test/').href; }, Response:function Response(body){ this.body = body; },
    fetch:async request => { fetched.push(request.url); if(!networkUp) throw new Error('offline'); return { ok:true, status:200, type:'basic', headers:{ get:() => '' }, clone(){ return this; } }; },
    module:{ exports:{} }, Promise
  };
  context.Response.error = () => ({ error:true });
  vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), context);
  return { listeners, stores, context, fetched, setNetwork:v => { networkUp = v; }, helpers:context.module.exports };
}
function fetchEvent(url, extra = {}){
  const event = { request:{ url, method:'GET', mode:'no-cors', headers:{ get:() => null }, ...extra }, responded:null, respondWith(p){ this.responded = p; } };
  return event;
}

test('service worker caches the app shell, never API/auth/Supabase, and cleans old versions', async () => {
  const sw = loadServiceWorker();
  const { helpers } = sw;
  helpers.SHELL_FILES.filter(f => f !== './').forEach(file => assert.ok(fs.existsSync(path.join(root, file)), `shell file exists: ${file}`));
  assert.equal(helpers.isNeverCached(new URL('https://app.test/api/blocks'), { method:'GET', headers:{ get:() => null } }), true);
  assert.equal(helpers.isNeverCached(new URL('https://app.test/app.js'), { method:'POST', headers:{ get:() => null } }), true);
  assert.equal(helpers.isNeverCached(new URL('https://app.test/app.js'), { method:'GET', headers:{ get:h => h === 'authorization' ? 'Bearer x' : null } }), true);
  assert.equal(helpers.isNeverCached(new URL('https://proj.supabase.co/auth/v1/token'), { method:'GET', headers:{ get:() => null } }), true);
  assert.equal(helpers.isNeverCached(new URL('https://app.test/app.js'), { method:'GET', headers:{ get:() => null } }), false);
  // install + activate
  let waited;
  sw.listeners.install({ waitUntil:p => { waited = p; } });
  await waited;
  assert.ok(sw.stores.get(helpers.CACHE_VERSION).has('/offline.html'));
  sw.listeners.activate({ waitUntil:p => { waited = p; } });
  await waited;
  assert.equal(sw.stores.has('djb-shell-v0'), false, 'old shell cache deleted');
  assert.equal(sw.stores.has('other-app-cache'), true, 'other caches untouched');
  // API and cross-origin requests are not intercepted
  const api = fetchEvent('https://app.test/api/marketplace/catalog');
  sw.listeners.fetch(api);
  assert.equal(api.responded, null);
  const supa = fetchEvent('https://proj.supabase.co/rest/v1/x');
  sw.listeners.fetch(supa);
  assert.equal(supa.responded, null);
  const audio = fetchEvent('https://app.test/uploads/song.mp3');
  sw.listeners.fetch(audio);
  assert.equal(audio.responded, null, 'non-shell files are left to the browser');
  // Offline navigation shows the friendly offline page
  sw.setNetwork(false);
  const nav = fetchEvent('https://app.test/index.html#battles', { mode:'navigate' });
  sw.listeners.fetch(nav);
  const page = await nav.responded;
  assert.equal(page.body, 'cached');
});

test('service worker registers only on https or localhost', async () => {
  const window = loadAppDom();
  const h = window.__DJBattleTestHooks;
  assert.equal(h.serviceWorkerAllowed({ protocol:'https:', hostname:'djbattle.app' }), true);
  assert.equal(h.serviceWorkerAllowed({ protocol:'http:', hostname:'localhost' }), true);
  assert.equal(h.serviceWorkerAllowed({ protocol:'http:', hostname:'192.168.1.5' }), false);
  const registered = [];
  const nav = { serviceWorker:{ register:async (url, opts) => { registered.push([url, opts.scope]); return {}; } } };
  assert.deepEqual(plain(await h.registerAppServiceWorker(nav, { protocol:'http:', hostname:'192.168.1.5' })), { skipped:'insecure' });
  assert.equal(registered.length, 0);
  const ok = await h.registerAppServiceWorker(nav, { protocol:'https:', hostname:'djbattle.app' });
  assert.equal(ok.registered, true);
  assert.deepEqual(registered, [['sw.js', './']]);
  assert.deepEqual(plain(await h.registerAppServiceWorker({}, { protocol:'https:', hostname:'x' })), { skipped:'unsupported' });
});

test('Settings shows how to install, and an Install button when the browser offers one', async () => {
  const window = loadAppDom();
  window.__DJBattleTestHooks.switchView('settings');
  await settle();
  const body = window.document.getElementById('settings-install-body');
  assert.match(body.textContent, /Install app|Add to Home/);
  let prompted = false;
  const event = new window.Event('beforeinstallprompt');
  event.prompt = () => { prompted = true; };
  event.userChoice = Promise.resolve({ outcome:'accepted' });
  window.dispatchEvent(event);
  const button = window.document.getElementById('settings-install-app');
  assert.ok(button);
  button.click();
  await settle();
  assert.equal(prompted, true);
});

/* ---------- 5. Practice log ---------- */

test('practice history keeps every session (not just 20), up to a 500 cap', async () => {
  const window = loadAppDom();
  const h = window.__DJBattleTestHooks;
  for(let i = 0; i < 30; i++) await h.savePracticeResult({ title:`Run ${i}`, score:100 + i, breakdown:[{ label:'Timing', score:10 }] });
  const saved = JSON.parse(window.localStorage.getItem('djBattlePracticeHistory'));
  assert.equal(saved.length, 30);
  assert.equal(new Set(saved.map(e => e.id)).size, 30, 'every session has its own id');
  assert.ok(saved.every(e => e.recordedAt));
  for(let i = 0; i < 520; i++) h.getPracticeHistory().push({ id:'bulk-' + i, title:'Bulk', score:1, recordedAt:new Date(0).toISOString() });
  h.persistPracticeHistory();
  assert.equal(JSON.parse(window.localStorage.getItem('djBattlePracticeHistory')).length, h.PRACTICE_HISTORY_CAP);
});

test('old sessions get stable ids, and local + account sessions merge without duplicates', () => {
  const window = loadAppDom({ setup:w => { w.localStorage.setItem('djBattlePracticeHistory', JSON.stringify([{ title:'Old run', score:120, date:'10/1/2026', type:'Practice', genre:'House', breakdown:[{ label:'Timing', score:14 }] }])); } });
  const h = window.__DJBattleTestHooks;
  const local = h.getPracticeHistory();
  assert.match(local[0].id, /^legacy-/);
  const again = h.normalizePracticeEntry({ title:'Old run', score:120, date:'10/1/2026', type:'Practice', genre:'House' });
  assert.equal(again.id, local[0].id, 'same legacy session → same id');
  h.getPracticeLogState().server = [{ id:local[0].id, title:'Old run', score:120, maxScore:180, breakdown:[{ key:'timing', label:'Timing', score:14, max:20 }], recordedAt:'2026-10-01T00:00:00.000Z' }, { id:'from-phone', title:'Phone run', score:150, maxScore:180, breakdown:[], recordedAt:'2026-10-05T00:00:00.000Z' }];
  const merged = h.mergedPracticeSessions();
  assert.deepEqual(plain(merged.map(s => s.id)), ['from-phone', local[0].id]);
  assert.equal(merged[1].onAccount, true);
  assert.equal(merged[1].local, true);
});

test('signed in, saving a session posts it to the account with its breakdown', async () => {
  const window = loadAppDom();
  const calls = mockApi(window, [['/api/practiceSessions', { status:201, data:{ session:{} } }]]);
  signIn(window);
  await window.__DJBattleTestHooks.savePracticeResult({ title:'Account run', score:144, breakdown:[{ label:'Timing', score:16.5 }, { label:'EQ', score:12 }] });
  await settle();
  const post = calls.find(c => c.url === '/api/practiceSessions' && c.method === 'POST');
  assert.ok(post, 'posted to account');
  assert.equal(post.body.title, 'Account run');
  assert.equal(post.body.maxScore, 180);
  assert.deepEqual(plain(post.body.breakdown.map(i => [i.key, i.score, i.max])), [['timing', 16.5, 20], ['eq', 12, 20]]);
  assert.ok(post.body.clientSessionId && post.body.recordedAt);
  assert.ok(window.__DJBattleTestHooks.getPracticeHistory()[0].syncedAt);
});

test('Practice page shows the scores-over-time chart, every session, and Replay when a recording exists', async () => {
  const window = loadAppDom();
  mockApi(window, [
    [/^\/api\/practiceSessions/, { status:200, data:{ sessions:[
      { id:'s1', title:'Monday', score:110, maxScore:180, breakdown:[{ key:'timing', label:'Timing', score:12, max:20 }, { key:'eq', label:'EQ', score:10, max:20 }], recordedAt:'2026-10-12T10:00:00.000Z' },
      { id:'s2', title:'Wednesday', score:132, maxScore:180, breakdown:[{ key:'timing', label:'Timing', score:15, max:20 }, { key:'eq', label:'EQ', score:13, max:20 }], recordedAt:'2026-10-14T10:00:00.000Z' },
      { id:'s3', title:'Friday', score:150, maxScore:180, breakdown:[{ key:'timing', label:'Timing', score:17, max:20 }, { key:'eq', label:'EQ', score:15, max:20 }], recordedAt:'2026-10-16T10:00:00.000Z', recordingTrackId:'rec-1' }
    ], pagination:{ hasMore:false } } }],
    ['/api/musicLibrary/practiceRecordings', { status:200, data:{ tracks:[{ id:'rec-1', title:'Friday take', sourceType:'practice_recording', rightsClassification:'original' }] } }],
    ['/api/musicLibrary/tracks/rec-1/playbackAccess', { status:200, data:{ track:{ id:'rec-1', playbackAccess:{ url:'https://proj.supabase.co/storage/v1/object/sign/battle-mixes/rec.webm?token=x', expiresAt:new Date(Date.now() + 60000).toISOString() } } } }]
  ]);
  signIn(window);
  window.__DJBattleTestHooks.switchView('practice');
  await settle(12);
  const doc = window.document;
  assert.equal(window.location.hash, '#practice');
  const svg = doc.querySelector('#practice-chart svg');
  assert.ok(svg, 'chart drawn');
  assert.deepEqual(plain(Array.from(svg.querySelectorAll('.practice-line')).map(g => g.dataset.series)), ['total', 'timing', 'eq']);
  assert.match(doc.querySelector('.practice-legend').textContent, /Overall.*Timing.*EQ/);
  assert.equal(doc.querySelectorAll('[data-practice-session]').length, 3);
  assert.match(doc.getElementById('practice-count').textContent, /3 sessions/);
  assert.ok(doc.querySelector('[data-practice-replay="s3"]'));
  assert.equal(doc.querySelector('[data-practice-replay="s1"]'), null);
  const series = window.__DJBattleTestHooks.practiceChartSeries(window.__DJBattleTestHooks.mergedPracticeSessions());
  assert.deepEqual(plain(series.series.find(s => s.key === 'timing').points.map(p => p.y)), [60, 75, 85]);
  const played = await window.__DJBattleTestHooks.replayPracticeSession('s3');
  assert.equal(played.playing, true);
  assert.match(doc.getElementById('practice-replay-audio').getAttribute('src'), /^https:\/\/proj\.supabase\.co/);
});

test('signed out, the Practice page uses this browser\'s log and says so', async () => {
  const window = loadAppDom();
  const calls = mockApi(window, []);
  await window.__DJBattleTestHooks.savePracticeResult({ title:'Local only', score:99, breakdown:[{ label:'Timing', score:9 }] });
  window.__DJBattleTestHooks.switchView('practice');
  await settle();
  const doc = window.document;
  assert.match(doc.getElementById('practice-status').textContent, /this browser only/);
  assert.match(doc.getElementById('practice-list').textContent, /Local only/);
  assert.match(doc.getElementById('practice-chart').textContent, /at least two practice sessions/);
  assert.equal(calls.filter(c => /practiceSessions/.test(c.url)).length, 0);
});
