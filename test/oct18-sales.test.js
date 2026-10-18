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

const CONFIG_ON = { status:200, data:{ success:true, paidSales:{ configured:true, checkoutConfigured:true, webhookConfigured:true, connectConfigured:true, platformFeePercent:10, missing:[] }, emailConfirmations:{ configured:true, provider:'resend', missing:[] } } };
const CONFIG_OFF = { status:200, data:{ success:true, paidSales:{ configured:false, checkoutConfigured:false, webhookConfigured:false, connectConfigured:false, platformFeePercent:10, missing:['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] }, emailConfirmations:{ configured:false, provider:null, missing:['EMAIL_PROVIDER (resend or sendgrid)', 'APP_PUBLIC_URL'] } } };
function listing(id, extra = {}){
  return { id, title:`Beat ${id}`, description:'Warm loop', status:'published', currency:'USD', displayPriceCents:0, product:{ type:'beat', genre:'House', bpm:124 }, freeDownload:{ offerId:`offer-${id}`, downloadConsentRequired:true, verificationRequired:false, consentText:'Send me this.' }, ...extra };
}
function mine(id, extra = {}){
  return { id, title:`Beat ${id}`, status:'published', currency:'USD', displayPriceCents:0, freeDownload:{ offerId:`offer-${id}` }, claimCount:3, downloadCount:2, confirmedCount:1, unconfirmedCount:2, optedInCount:1, ...extra };
}
function storeRoutes({ config = CONFIG_ON, listings = [listing('l1'), listing('l2', { displayPriceCents:999, freeDownload:null })], myListings = [mine('l1'), mine('l2', { displayPriceCents:999, freeDownload:null, claimCount:0, downloadCount:0, unconfirmedCount:0, confirmedCount:0, optedInCount:0 })], accounts = [], sales = null, extra = [] } = {}){
  return [
    ...extra,
    ['/api/marketplace/storeConfig', config],
    [/^\/api\/marketplace\/catalog/, { status:200, data:{ success:true, listings, pagination:{ page:1, hasMore:false } } }],
    ['/api/marketplace/myListings', { status:200, data:{ success:true, listings:myListings, totals:{ claims:3, downloads:2, confirmed:1, unconfirmed:2, optedIn:1 } } }],
    ['/api/marketplace/sellerAccounts/status', { status:200, data:{ success:true, accounts } }],
    ['/api/marketplace/sales', sales || { status:200, data:{ success:true, orders:[], totals:{ paidOrders:0, pendingOrders:0, grossCents:0, platformFeeCents:0, earningsCents:0, currency:'USD' } } }]
  ];
}
async function openStore(window){
  await window.__DJBattleTestHooks.loadBeatStore({ reset:true });
  window.__DJBattleTestHooks.switchView('store');
  await settle();
}
const quietLoad = (opts = {}) => loadAppDom({ ...opts, setup:w => { w.__DJBattleSkipReturnLinks = true; if(opts.setup) opts.setup(w); } });

/* ---------- 1. Paid beats ---------- */

test('without Stripe settings the store says paid sales aren\'t set up, and Buy is disabled', async () => {
  const window = quietLoad();
  signIn(window);
  mockApi(window, storeRoutes({ config:CONFIG_OFF }));
  await openStore(window);
  const doc = window.document;
  const off = doc.querySelector('[data-store-sales-off]');
  assert.ok(off, 'not-set-up card shown to the owner');
  assert.match(off.textContent, /Paid sales aren't set up on the server yet/);
  assert.match(off.textContent, /STRIPE_SECRET_KEY/, 'missing setting names only');
  const buy = doc.querySelector('[data-store-buy="l2"]');
  assert.ok(buy.disabled, 'Buy disabled');
  assert.match(doc.querySelector('[data-store-listing="l2"] .store-price').textContent, /\$9\.99 • sales not set up yet/);
  const result = await window.__DJBattleTestHooks.buyBeat('l2');
  assert.equal(result.error, 'unconfigured');
  window.__DJBattleTestHooks.openListingPrice('l1');
  assert.ok(doc.querySelector('[data-store-price-off]'), 'price modal explains sales are off');
  doc.getElementById('store-price-input').value = '5';
  doc.getElementById('store-price-input').dispatchEvent(new window.Event('input'));
  assert.equal(doc.getElementById('store-price-save').disabled, true, 'cannot set a paid price while off');
});

test('owner sets a price (with the fee split) and the server gets cents', async () => {
  const window = quietLoad();
  signIn(window);
  const calls = mockApi(window, storeRoutes({ extra:[[/\/api\/marketplace\/listings\/l1\/price$/, (url, o) => ({ status:200, data:{ success:true, listing:{ id:'l1', displayPriceCents:o.body.priceCents, currency:'USD' } } })]] }));
  await openStore(window);
  const doc = window.document;
  doc.querySelector('[data-store-price="l1"]').click();
  const input = doc.getElementById('store-price-input');
  input.value = '9.99';
  input.dispatchEvent(new window.Event('input'));
  assert.match(doc.getElementById('store-price-split').textContent, /Buyers pay \$9\.99\. DJ Battle keeps 10%, so you get \$8\.99/);
  input.value = '9.999';
  input.dispatchEvent(new window.Event('input'));
  assert.equal(doc.getElementById('store-price-save').disabled, true);
  input.value = '9.99';
  input.dispatchEvent(new window.Event('input'));
  doc.getElementById('store-price-save').click();
  await settle(10);
  const patch = calls.find(c => c.method === 'PATCH');
  assert.equal(patch.url, '/api/marketplace/listings/l1/price');
  assert.deepEqual(plain(patch.body), { priceCents:999, currency:'USD' });
  const low = await window.__DJBattleTestHooks.setBeatPrice('l1', 50);
  assert.match(low.error, /lowest price is \$0\.99/);
  assert.equal(window.__DJBattleTestHooks.priceCentsFromInput('$12.5'), 1250);
  assert.ok(Number.isNaN(window.__DJBattleTestHooks.priceCentsFromInput('abc')));
});

test('Connect Stripe sends the owner to Stripe onboarding (only to stripe.com); earnings show once connected', async () => {
  const window = quietLoad();
  signIn(window);
  const navigated = [];
  window.__DJBattleTestHooks.setStoreNavigate(url => navigated.push(url));
  let onboardUrl = 'https://connect.stripe.com/setup/e/acct_123/abc';
  const calls = mockApi(window, storeRoutes({ extra:[['/api/marketplace/sellerAccounts/onboard', () => ({ status:200, data:{ success:true, onboardingUrl:onboardUrl } })]] }));
  await openStore(window);
  const doc = window.document;
  doc.getElementById('store-connect-stripe').click();
  await settle();
  assert.deepEqual(navigated, ['https://connect.stripe.com/setup/e/acct_123/abc']);
  assert.ok(calls.some(c => c.url === '/api/marketplace/sellerAccounts/onboard' && c.method === 'POST'));
  onboardUrl = 'https://evil.example/phish';
  const bad = await window.__DJBattleTestHooks.startStripeOnboarding();
  assert.equal(bad.error, 'unsafe url');
  assert.equal(navigated.length, 1);

  const w2 = quietLoad();
  signIn(w2);
  mockApi(w2, storeRoutes({
    accounts:[{ provider:'stripe', accountStatus:'connected', chargesEnabled:true, payoutsEnabled:true, requirementsDue:[] }],
    sales:{ status:200, data:{ success:true, orders:[{ id:'o1', listingId:'l2', sellerAmountCents:899, grossAmountCents:999, currency:'USD', paymentStatus:'paid', paidAt:new Date().toISOString() }], totals:{ paidOrders:1, pendingOrders:0, grossCents:999, platformFeeCents:100, earningsCents:899, currency:'USD' } } }
  }));
  await openStore(w2);
  const earnings = w2.document.querySelector('[data-store-earnings]');
  assert.match(earnings.textContent, /1sale/);
  assert.match(earnings.textContent, /\$8\.99your earnings/);
  assert.match(w2.document.querySelector('.store-orders').textContent, /Beat l2.*\$8\.99 to you • Paid/);
});

test('buyer: Buy creates a checkout and goes to Stripe; success page grants the paid download; cancel page says no charge', async () => {
  const window = quietLoad();
  signIn(window, 'buyer-1');
  const navigated = [];
  window.__DJBattleTestHooks.setStoreNavigate(url => navigated.push(url));
  const calls = mockApi(window, storeRoutes({ myListings:[], extra:[
    ['/api/marketplace/checkout', { status:201, data:{ success:true, order:{ id:'mp_order_1' }, checkout:{ provider:'stripe', redirectUrl:'https://checkout.stripe.com/c/pay/cs_test_123' } } }],
    ['/api/marketplace/orders', { status:200, data:{ success:true, orders:[{ id:'mp_order_1', listingId:'l2', paymentStatus:'paid' }] } }],
    ['/api/marketplace/downloads/access', { status:200, data:{ success:true, downloadAccess:{ url:'https://proj.supabase.co/storage/v1/object/sign/battle-mixes/x.mp3?token=t', file:{ filename:'Beat l2.mp3' } } } }]
  ] }));
  await openStore(window);
  window.document.querySelector('[data-store-buy="l2"]').click();
  await settle();
  const checkout = calls.find(c => c.url === '/api/marketplace/checkout');
  assert.equal(checkout.body.listingId, 'l2');
  assert.equal(checkout.body.provider, 'stripe');
  assert.equal(checkout.body.clientPriceCents, 999);
  assert.ok(checkout.body.idempotencyKey);
  assert.deepEqual(navigated, ['https://checkout.stripe.com/c/pay/cs_test_123']);
  assert.equal(window.__DJBattleTestHooks.beatStorePurchases().l2.orderId, 'mp_order_1');

  window.history.replaceState(null, '', '/index.html?checkout=success&order=mp_order_1#store');
  const back = await window.__DJBattleTestHooks.handleStoreReturnLinks(window.location);
  assert.equal(back.checkout.paid, true);
  assert.equal(window.location.search, '', 'checkout params removed from the address bar');
  const box = window.document.getElementById('checkout-result');
  assert.equal(box.dataset.checkoutState, 'paid');
  assert.match(box.textContent, /Payment received/);
  window.document.getElementById('checkout-download').click();
  await settle();
  const access = calls.find(c => c.url === '/api/marketplace/downloads/access');
  assert.deepEqual(plain(access.body), { orderId:'mp_order_1' });
  assert.ok(window.__DJBattleTestHooks.beatStorePurchases().l2.paid);
  await window.__DJBattleTestHooks.renderBeatStorePage();
  assert.ok(window.document.querySelector('[data-store-paid-download="l2"]'), 'card now offers Download');

  window.history.replaceState(null, '', '/index.html?checkout=cancel&order=mp_order_1#store');
  const canceled = await window.__DJBattleTestHooks.handleStoreReturnLinks(window.location);
  assert.ok(canceled.checkout.canceled);
  assert.match(window.document.querySelector('[data-checkout-state="canceled"]').textContent, /weren't charged for Beat l2/);
});

test('checkout refuses non-Stripe redirects and explains seller/price problems', async () => {
  const window = quietLoad();
  signIn(window, 'buyer-1');
  const navigated = [];
  window.__DJBattleTestHooks.setStoreNavigate(url => navigated.push(url));
  let reply = { status:201, data:{ order:{ id:'o' }, checkout:{ redirectUrl:'https://stripe.com.evil.example/pay' } } };
  mockApi(window, storeRoutes({ myListings:[], extra:[['/api/marketplace/checkout', () => reply]] }));
  await openStore(window);
  assert.equal((await window.__DJBattleTestHooks.buyBeat('l2')).error, 'unsafe url');
  reply = { error:'x', status:409, data:{ error:'Seller is not eligible' } };
  assert.match((await window.__DJBattleTestHooks.buyBeat('l2')).error, /hasn't finished setting up payouts/);
  reply = { error:'x', status:503, data:{} };
  assert.match((await window.__DJBattleTestHooks.buyBeat('l2')).error, /aren't set up/);
  assert.equal(navigated.length, 0);
  const pending = await window.__DJBattleTestHooks.checkOrderPaid('nope', { tries:2, waitMs:1 });
  assert.equal(pending.pending, true);
});

/* ---------- 2. Confirmed fan emails ---------- */

test('with email set up, new free beats require confirmation and fans see "check your email"', async () => {
  const window = quietLoad();
  signIn(window);
  const calls = mockApi(window, storeRoutes({ extra:[
    ['/api/marketplace/listings', { status:201, data:{ listing:{ id:'new1', title:'New' } } }],
    [/freeDownloadFile$/, { status:200, data:{ file:{ id:'free-mp3' } } }],
    ['/api/marketplace/freeEmail/offers', { status:201, data:{ offer:{ id:'of' } } }],
    ['/api/marketplace/freeEmail/claims/authenticated', { status:201, data:{ verificationRequired:true, deliveryConfigured:true, lead:{ id:'lead-1' } } }]
  ] }));
  await openStore(window);
  window.__DJBattleTestHooks.getLibraryTracksState().push({ id:'t1', title:'Mine', serverBacked:true, rightsClassification:'original' });
  await window.__DJBattleTestHooks.createFreeBeatListing({ trackId:'t1' });
  assert.equal(calls.find(c => c.url === '/api/marketplace/freeEmail/offers').body.verificationRequired, true);
  const doc = window.document;
  window.__DJBattleTestHooks.openBeatStoreClaim('l1');
  doc.getElementById('store-claim-email').value = 'fan@example.com';
  doc.getElementById('store-claim-consent').checked = true;
  doc.getElementById('store-claim-submit').click();
  await settle(10);
  const shown = doc.querySelector('[data-check-email]');
  assert.equal(shown.dataset.checkEmail, 'sent');
  assert.match(shown.textContent, /We sent a link to fan@example\.com/);
  assert.ok(doc.querySelector('[data-store-listing="l1"] .store-tag--pending'), 'card shows Check your email');

  const w2 = quietLoad();
  signIn(w2);
  const calls2 = mockApi(w2, storeRoutes({ config:CONFIG_OFF, extra:[
    ['/api/marketplace/listings', { status:201, data:{ listing:{ id:'new1', title:'New' } } }],
    [/freeDownloadFile$/, { status:200, data:{ file:{ id:'free-mp3' } } }],
    ['/api/marketplace/freeEmail/offers', { status:201, data:{ offer:{ id:'of' } } }]
  ] }));
  await openStore(w2);
  w2.__DJBattleTestHooks.getLibraryTracksState().push({ id:'t1', title:'Mine', serverBacked:true, rightsClassification:'original' });
  await w2.__DJBattleTestHooks.createFreeBeatListing({ trackId:'t1' });
  assert.equal(calls2.find(c => c.url === '/api/marketplace/freeEmail/offers').body.verificationRequired, false, 'no email service = instant download as before');
});

test('the emailed confirm link verifies, strips the token from the address bar and starts the download', async () => {
  const window = quietLoad();
  const calls = mockApi(window, storeRoutes({ extra:[
    ['/api/marketplace/freeEmail/verify', { status:200, data:{ success:true, verified:true, lead:{ id:'lead-9', listingId:'l1', email:'fan@example.com' }, downloadAccessToken:'dl-token' } }],
    ['/api/marketplace/freeEmail/downloads/access', { status:200, data:{ downloadAccess:{ url:'https://proj.supabase.co/storage/v1/object/sign/x.mp3?token=a', file:{ filename:'Beat l1.mp3' } } } }]
  ] }));
  window.history.replaceState(null, '', '/index.html?beatConfirm=1&lead=lead-9&token=secret-token#store');
  const result = await window.__DJBattleTestHooks.handleStoreReturnLinks(window.location);
  assert.equal(result.confirm.downloaded, true);
  assert.equal(window.location.search, '');
  assert.doesNotMatch(window.location.href, /secret-token/);
  const verify = calls.find(c => c.url === '/api/marketplace/freeEmail/verify');
  assert.deepEqual(plain(verify.body), { leadId:'lead-9', verificationToken:'secret-token' });
  assert.ok(verify.public, 'works signed out');
  const access = calls.find(c => c.url === '/api/marketplace/freeEmail/downloads/access');
  assert.deepEqual(plain(access.body), { leadId:'lead-9', downloadAccessToken:'dl-token' });
  assert.equal(window.__DJBattleTestHooks.beatStoreClaims().l1.downloadAccessToken, 'dl-token');

  const w2 = quietLoad();
  mockApi(w2, [['/api/marketplace/freeEmail/verify', { error:'x', status:403, data:{} }], ['/api/marketplace/storeConfig', CONFIG_ON]]);
  w2.history.replaceState(null, '', '/index.html?beatConfirm=1&lead=l&token=t#store');
  const bad = await w2.__DJBattleTestHooks.handleStoreReturnLinks(w2.location);
  assert.match(bad.confirm.error, /isn't valid any more/);
});

test('owner sees confirmed vs unconfirmed fan emails', async () => {
  const window = quietLoad();
  signIn(window);
  mockApi(window, storeRoutes({ extra:[[/^\/api\/marketplace\/freeEmail\/leads\?listingId=l1/, { status:200, data:{ leads:[
    { id:'a', listingId:'l1', email:'yes@example.com', verificationStatus:'verified', marketingConsentStatus:'accepted', claimedAt:new Date().toISOString() },
    { id:'b', listingId:'l1', email:'maybe@example.com', verificationStatus:'not_required', marketingConsentStatus:'declined', claimedAt:new Date().toISOString() },
    { id:'c', listingId:'l1', email:'wait@example.com', verificationStatus:'pending', marketingConsentStatus:'declined', claimedAt:new Date().toISOString() }
  ] } }]] }));
  await openStore(window);
  window.document.querySelector('[data-store-leads="l1"]').click();
  await settle();
  const text = window.document.querySelector('.store-leads').textContent;
  assert.match(text, /yes@example\.com.*Confirmed email/);
  assert.match(text, /maybe@example\.com.*Unconfirmed email/);
  assert.match(text, /wait@example\.com.*Waiting for confirmation/);
  assert.match(window.document.querySelector('[data-store-mine="l1"]').textContent, /2 unconfirmed emails/);
});

/* ---------- 3. Update ready bar ---------- */

function fakeSw(){
  const listeners = {};
  return { controller:{}, addEventListener:(type, fn) => { (listeners[type] = listeners[type] || []).push(fn); }, fire:type => (listeners[type] || []).forEach(fn => fn()), listeners };
}
test('a waiting service worker shows "Update ready"; tapping it skips waiting and reloads exactly once', async () => {
  const window = quietLoad();
  const h = window.__DJBattleTestHooks;
  let reloads = 0;
  h.setAppReload(() => { reloads += 1; });
  const sw = fakeSw();
  const messages = [];
  const registration = { waiting:{ postMessage:m => messages.push(m) }, addEventListener(){} };
  h.watchForAppUpdate(registration, { serviceWorker:sw });
  const bar = window.document.getElementById('app-update-bar');
  assert.ok(bar);
  assert.match(bar.textContent, /Update ready — tap to refresh/);
  sw.fire('controllerchange');
  assert.equal(reloads, 0, 'no reload unless the DJ tapped the bar');
  window.document.getElementById('app-update-apply').click();
  assert.deepEqual(plain(messages), [{ type:'SKIP_WAITING' }]);
  sw.fire('controllerchange');
  sw.fire('controllerchange');
  assert.equal(reloads, 1, 'reloads once, never loops');
  window.document.getElementById('app-update-apply').click();
  assert.equal(messages.length, 1);
});

test('first install shows no bar; a later update found while running does', async () => {
  const window = quietLoad();
  const h = window.__DJBattleTestHooks;
  const firstSw = { controller:null, addEventListener(){} };
  h.watchForAppUpdate({ waiting:{ postMessage(){} }, addEventListener(){} }, { serviceWorker:firstSw });
  assert.equal(window.document.getElementById('app-update-bar'), null);
  const sw = fakeSw();
  const regListeners = {};
  const worker = { state:'installing', addEventListener:(t, fn) => { regListeners['state'] = fn; } };
  const registration = { waiting:null, installing:worker, addEventListener:(t, fn) => { regListeners[t] = fn; } };
  h.watchForAppUpdate(registration, { serviceWorker:sw });
  regListeners.updatefound();
  worker.state = 'installed';
  regListeners.state();
  assert.ok(window.document.getElementById('app-update-bar'));
  const nav = { serviceWorker:{ register:async () => ({ waiting:{ postMessage(){} }, addEventListener(){} }), controller:{}, addEventListener(){} } };
  const reg = await h.registerAppServiceWorker(nav, { protocol:'https:', hostname:'app.test' });
  assert.ok(reg.registered);
});

test('sw.js waits for the tap (no skipWaiting on install) and its version is stamped from the shell files', async () => {
  const listeners = {};
  let skipped = 0;
  const context = { self:{ addEventListener:(t, fn) => { listeners[t] = fn; }, location:{ origin:'https://app.test' }, skipWaiting:() => { skipped += 1; return Promise.resolve(); }, clients:{ claim:() => Promise.resolve() } }, caches:{ open:async () => ({ add:async () => {} }) }, URL, Request:function(u){ this.url = u; }, Response:function(){}, module:{ exports:{} }, Promise };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), context);
  let waited;
  listeners.install({ waitUntil:p => { waited = p; } });
  await waited;
  assert.equal(skipped, 0, 'install does not skip waiting');
  listeners.message({ data:{ type:'nope' } });
  assert.equal(skipped, 0);
  listeners.message({ data:{ type:'SKIP_WAITING' } });
  assert.equal(skipped, 1);
  assert.match(context.module.exports.CACHE_VERSION, /^djb-shell-[0-9a-f]{12}$/);

  const stamp = require(path.join(root, 'scripts', 'stamp-sw-version.js'));
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'djb-sw-'));
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  fs.writeFileSync(path.join(tmp, 'sw.js'), sw);
  stamp.shellFilesFrom(sw).forEach(name => { fs.mkdirSync(path.dirname(path.join(tmp, name)), { recursive:true }); fs.writeFileSync(path.join(tmp, name), `x-${name}`); });
  const v1 = stamp.stamp(tmp);
  assert.equal(stamp.currentVersion(tmp), v1);
  assert.equal(stamp.computeShellVersion(tmp), v1, 'stable when nothing changed');
  fs.writeFileSync(path.join(tmp, 'app.js'), 'changed');
  const v2 = stamp.computeShellVersion(tmp);
  assert.notEqual(v2, v1, 'any shell change = new version');
  assert.equal(stamp.stamp(tmp), v2);
  assert.ok(stamp.shellFilesFrom(sw).includes('offline.html'));
  fs.rmSync(tmp, { recursive:true, force:true });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.build, /stamp-sw-version\.js && node scripts\/stamp-sw-version\.js --check/);
});

/* ---------- 4. Practice rename / delete ---------- */

function practiceWindow(){
  const sessions = [
    { id:'s1', title:'Warmup', score:120, maxScore:180, breakdown:[{ label:'Timing', score:12 }], recordedAt:'2026-10-10T10:00:00.000Z', type:'Practice', genre:'House' },
    { id:'s2', title:'Test take', score:60, maxScore:180, breakdown:[{ label:'Timing', score:6 }], recordedAt:'2026-10-11T10:00:00.000Z', type:'Practice', genre:'House' },
    { id:'s3', title:'Big run', score:150, maxScore:180, breakdown:[{ label:'Timing', score:16 }], recordedAt:'2026-10-12T10:00:00.000Z', type:'Practice', genre:'House' }
  ];
  const window = quietLoad({ setup:w => { w.localStorage.setItem('djBattlePracticeHistory', JSON.stringify(sessions.map(s => ({ ...s, syncedAt:'2026-10-12T00:00:00.000Z' })))); } });
  signIn(window);
  return window;
}
test('Rename edits the title inline, saves it to the account and the local log', async () => {
  const window = practiceWindow();
  const h = window.__DJBattleTestHooks;
  let fail = false;
  const calls = mockApi(window, [
    [/^\/api\/practiceSessions\?/, { status:200, data:{ sessions:[{ id:'s2', title:'Test take', score:60, maxScore:180, breakdown:[], recordedAt:'2026-10-11T10:00:00.000Z' }], pagination:{} } }],
    ['/api/musicLibrary/practiceRecordings', { status:200, data:{ tracks:[] } }],
    [/^\/api\/practiceSessions\/s2$/, (url, o) => fail ? { error:'x', status:500, data:{ error:'boom' } } : { status:200, data:{ session:{ id:'s2', title:o.body.title } } }]
  ]);
  h.switchView('practice');
  await settle(10);
  const doc = window.document;
  doc.querySelector('[data-practice-rename="s2"]').click();
  const input = doc.querySelector('[data-practice-rename-input]');
  assert.equal(input.value, 'Test take');
  input.value = '  Friday   set  ';
  doc.querySelector('[data-practice-rename-form="s2"]').dispatchEvent(new window.Event('submit', { cancelable:true }));
  await settle(10);
  const patch = calls.find(c => c.method === 'PATCH');
  assert.equal(patch.url, '/api/practiceSessions/s2');
  assert.deepEqual(plain(patch.body), { title:'Friday set' });
  assert.match(doc.querySelector('[data-practice-session="s2"]').textContent, /Friday set/);
  assert.equal(JSON.parse(window.localStorage.getItem('djBattlePracticeHistory')).find(e => e.id === 's2').title, 'Friday set');
  fail = true;
  await h.renamePracticeSession('s2', 'Broken');
  assert.match(doc.querySelector('[data-practice-session="s2"]').textContent, /Friday set/, 'failed rename is put back');
  assert.ok(doc.querySelector('.notification-toast--error [data-toast-retry]'));
});

test('Delete hides the session (chart recalculates) with Undo; after the window it deletes on the server and locally', async () => {
  const window = practiceWindow();
  const h = window.__DJBattleTestHooks;
  const calls = mockApi(window, [
    [/^\/api\/practiceSessions\?/, { status:200, data:{ sessions:[{ id:'s2', title:'Test take', score:60, maxScore:180, breakdown:[], recordedAt:'2026-10-11T10:00:00.000Z' }], pagination:{} } }],
    ['/api/musicLibrary/practiceRecordings', { status:200, data:{ tracks:[] } }],
    [/^\/api\/practiceSessions\/s2$/, { status:200, data:{ deleted:true } }]
  ]);
  h.switchView('practice');
  await settle(10);
  const doc = window.document;
  const before = h.practiceChartSeries(h.mergedPracticeSessions()).count;
  assert.equal(before, 3);
  doc.querySelector('[data-practice-delete="s2"]').click();
  assert.equal(doc.querySelector('[data-practice-session="s2"]'), null, 'hidden right away');
  assert.equal(h.practiceChartSeries(h.mergedPracticeSessions()).count, 2, 'chart leaves it out');
  assert.match(doc.getElementById('practice-count').textContent, /2 sessions/);
  const undo = doc.querySelector('[data-practice-undo="s2"]');
  assert.ok(undo);
  undo.click();
  assert.ok(doc.querySelector('[data-practice-session="s2"]'), 'Undo brings it back');
  assert.equal(calls.filter(c => c.method === 'DELETE').length, 0, 'nothing deleted on Undo');
  h.deletePracticeSessionWithUndo('s2', { undoMs:5 });
  await new Promise(r => setTimeout(r, 30));
  await settle(10);
  const del = calls.find(c => c.method === 'DELETE');
  assert.equal(del.url, '/api/practiceSessions/s2');
  assert.equal(JSON.parse(window.localStorage.getItem('djBattlePracticeHistory')).some(e => e.id === 's2'), false);
  assert.equal(h.getPracticeLogState().server.some(r => r.id === 's2'), false);
  assert.equal(h.undoPracticeDelete('s2').error, 'too late');
});

test('a failed server delete puts the session back with Retry', async () => {
  const window = practiceWindow();
  const h = window.__DJBattleTestHooks;
  mockApi(window, [
    [/^\/api\/practiceSessions\?/, { status:200, data:{ sessions:[{ id:'s1', title:'Warmup', score:120, maxScore:180, breakdown:[], recordedAt:'2026-10-10T10:00:00.000Z' }], pagination:{} } }],
    ['/api/musicLibrary/practiceRecordings', { status:200, data:{ tracks:[] } }],
    [/^\/api\/practiceSessions\/s1$/, { error:'x', status:500, data:{ error:'db down' } }]
  ]);
  h.switchView('practice');
  await settle(10);
  h.deletePracticeSessionWithUndo('s1', { undoMs:1000 });
  const result = await h.commitPracticeDelete('s1');
  assert.equal(result.error, true);
  assert.ok(window.document.querySelector('[data-practice-session="s1"]'), 'restored');
  assert.ok(JSON.parse(window.localStorage.getItem('djBattlePracticeHistory')).some(e => e.id === 's1'));
});

/* ---------- 5. Fan list export + counts ---------- */

test('owner view shows claims, downloads and totals per beat', async () => {
  const window = quietLoad();
  signIn(window);
  mockApi(window, storeRoutes());
  await openStore(window);
  const doc = window.document;
  const totals = doc.querySelector('[data-store-totals]').textContent;
  assert.match(totals, /2beats/);
  assert.match(totals, /3claims/);
  assert.match(totals, /2downloads/);
  assert.match(totals, /1OK to email/);
  assert.match(doc.querySelector('[data-store-downloads="l1"]').textContent, /2downloads/);
  assert.equal(doc.getElementById('store-export-fans').disabled, false);
});

test('Download fan list builds a safe CSV across every beat', async () => {
  const window = quietLoad();
  signIn(window);
  const calls = mockApi(window, storeRoutes({ myListings:[mine('l1', { title:'=SUM(A1)' }), mine('l2', { title:'Night, "Drive"' })], extra:[['/api/marketplace/freeEmail/leads?limit=500', { status:200, data:{ leads:[
    { listingId:'l1', email:'a@example.com', marketingConsentStatus:'accepted', verificationStatus:'verified', claimedAt:'2026-10-15T12:00:00.000Z' },
    { listingId:'l2', email:'+cmd@example.com', marketingConsentStatus:'declined', verificationStatus:'not_required', claimedAt:'2026-10-16T12:00:00.000Z' }
  ] } }]] }));
  await openStore(window);
  let clicked = null;
  window.URL.createObjectURL = () => 'blob:fan-list';
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function(){ clicked = { href:this.href, download:this.download }; };
  const result = await window.__DJBattleTestHooks.exportFanList();
  assert.ok(calls.some(c => c.url === '/api/marketplace/freeEmail/leads?limit=500'));
  assert.equal(result.count, 2);
  assert.match(clicked.download, /^djbattle-fan-list-\d{4}-\d{2}-\d{2}\.csv$/);
  const lines = result.csv.trim().split('\r\n');
  assert.equal(lines[0], '"Beat","Email","Opted in to new-beat emails","Confirmed","Claimed date"');
  assert.equal(lines[1], `"'=SUM(A1)","a@example.com","Yes","Confirmed","2026-10-15"`);
  assert.equal(lines[2], `"Night, ""Drive""","'+cmd@example.com","No","Unconfirmed","2026-10-16"`);
  const cell = window.__DJBattleTestHooks.csvCell;
  ['=1+1', '+1', '-1', '@x', '\tx'].forEach(v => assert.ok(cell(v).startsWith(`"'`), v));
  assert.equal(cell('plain'), '"plain"');
});
