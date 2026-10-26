// Oct 25 Store: per-beat licences, short previews, wishlist heart, gifting, tournament sizes/groups.
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
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js', 'social.js', 'beat_store_five.js'].forEach(file => {
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
const PAID = (id, extra = {}) => listing(id, { displayPriceCents:1500, freeDownload:null, previewEnabled:true, previewDuration:45, rights:{ licenseType:'battle_use', licence:{ type:'battle_use', label:'Battle use only', summary:'Play it in battles.', may:['Play it in DJ Battle battles'], mayNot:['Release it'] } }, ...extra });
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

/* ---------- 1. Licences ---------- */
test('buyers see the licence in plain words before paying, must tick it, and the pick goes to checkout', async () => {
  const window = quietLoad();
  signIn(window, 'buyer-1');
  window.__DJBattleTestHooks.setStoreNavigate(() => {});
  const calls = mockApi(window, storeRoutes({ myListings:[], listings:[PAID('l2')], extra:[
    ['/api/marketplace/checkout', { status:201, data:{ success:true, order:{ id:'o1' }, checkout:{ provider:'stripe', redirectUrl:'https://checkout.stripe.com/c/pay/cs_1' } } }],
    ['/api/marketplace/wishlist', { status:200, data:{ success:true, items:[], listingIds:[] } }]
  ] }));
  await openStore(window);
  const chip = window.document.querySelector('[data-s25-terms="l2"]');
  assert.match(chip.textContent, /Battle use only/);
  window.document.querySelector('[data-store-buy="l2"]').click();
  await settle();
  const dlg = window.document.getElementById('s25-buy-dialog');
  assert.ok(dlg.open);
  assert.match(dlg.textContent, /Battle use only/);
  assert.match(dlg.textContent, /You may not/);
  dlg.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable:true }));
  assert.match(dlg.querySelector('#s25-buy-err').textContent, /Tick the box/);
  assert.ok(!calls.find(c => c.url === '/api/marketplace/checkout'), 'no checkout until the terms are ticked');
  dlg.querySelector('#s25-agree').checked = true;
  dlg.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable:true }));
  await settle();
  const checkout = calls.find(c => c.url === '/api/marketplace/checkout');
  assert.ok(checkout);
  assert.equal(checkout.body.licenseType, 'battle_use');
  assert.ok(!checkout.body.gift);
});

test('cancelling the licence dialog does not start a checkout', async () => {
  const window = quietLoad();
  signIn(window, 'buyer-1');
  const calls = mockApi(window, storeRoutes({ myListings:[], listings:[PAID('l2')] }));
  await openStore(window);
  window.document.querySelector('[data-store-buy="l2"]').click();
  await settle();
  window.document.querySelector('#s25-buy-dialog [data-close]').click();
  await settle();
  assert.ok(!calls.find(c => c.url === '/api/marketplace/checkout'));
});

test('the licence picker defaults to "Use in your own releases" and the owner can change it', async () => {
  const window = quietLoad();
  signIn(window, 'owner-1');
  const S = window.DJBStore25;
  const host = window.document.createElement('div'); host.innerHTML = S.licencePickerHtml('t-pick'); window.document.body.appendChild(host);
  assert.equal(S.pickedLicence('t-pick'), 'creator_license');
  host.querySelector('input[value="royalty_free_use"]').checked = true;
  assert.equal(S.pickedLicence('t-pick'), 'royalty_free_use');
  const calls = mockApi(window, storeRoutes({ myListings:[mine('l2', { displayPriceCents:999, freeDownload:null })], extra:[
    [/\/licence$/, { status:200, data:{ success:true, licence:{ type:'royalty_free_use', label:'Royalty-free' } } }]
  ] }));
  await openStore(window);
  const btn = window.document.querySelector('[data-s25-licence-edit="l2"]');
  assert.ok(btn, 'owner row has a licence button');
  btn.click();
  const dlg = window.document.getElementById('s25-licence-dialog');
  dlg.querySelector('input[value="royalty_free_use"]').checked = true;
  dlg.querySelector('#s25-licence-ok').checked = true;
  dlg.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable:true }));
  await settle();
  const call = calls.find(c => /\/licence$/.test(c.url));
  assert.equal(call.method, 'PATCH');
  assert.deepEqual(plain(call.body), { licenseType:'royalty_free_use', confirmRights:true });
});

/* ---------- 2. Previews ---------- */
test('Preview asks the server for a preview-scope clip and plays it; owner can make one (start, length, voice tag)', async () => {
  const window = quietLoad();
  signIn(window, 'buyer-1');
  const calls = mockApi(window, storeRoutes({ listings:[PAID('l2')], myListings:[mine('l3', { displayPriceCents:999, freeDownload:null, product:{ duration:200 } })], extra:[
    ['/api/marketplace/player/access', { status:200, data:{ success:true, playerAccess:{ url:'https://proj.supabase.co/sign/preview.mp3', accessScope:'preview' } } }],
    [/\/listings\/l3\/preview$/, { status:200, data:{ success:true, preview:{ startSeconds:65, lengthSeconds:30, voiceTag:true, auto:false } } }]
  ] }));
  await openStore(window);
  const btn = window.document.querySelector('[data-s25-preview="l2"]');
  assert.ok(btn);
  const out = await window.DJBStore25.playPreview('l2', btn);
  assert.equal(out.scope, 'preview');
  assert.deepEqual(plain(calls.find(c => c.url === '/api/marketplace/player/access').body), { listingId:'l2', preview:true });
  window.document.querySelector('[data-s25-preview-make="l3"]').click();
  const dlg = window.document.getElementById('s25-preview-dialog');
  dlg.querySelector('input[name="s25-start"][value="manual"]').checked = true;
  dlg.querySelector('#s25-start-at').value = '1:05';
  dlg.querySelector('#s25-len').value = '30';
  dlg.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable:true }));
  await settle();
  assert.deepEqual(plain(calls.find(c => /l3\/preview$/.test(c.url)).body), { lengthSeconds:30, voiceTag:true, startSeconds:65 });
});

test('a bad start time is explained and nothing is sent', async () => {
  const window = quietLoad();
  signIn(window, 'owner-1');
  const calls = mockApi(window, storeRoutes({ myListings:[mine('l3', { displayPriceCents:999, freeDownload:null })] }));
  await openStore(window);
  window.DJBStore25.openPreviewMaker('l3');
  const dlg = window.document.getElementById('s25-preview-dialog');
  dlg.querySelector('input[name="s25-start"][value="manual"]').checked = true;
  dlg.querySelector('#s25-start-at').value = 'soon';
  dlg.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable:true }));
  await settle();
  assert.match(dlg.querySelector('#s25-prev-err').textContent, /1:05/);
  assert.ok(!calls.find(c => /preview$/.test(c.url)));
});

/* ---------- 3. Wishlist ---------- */
test('the heart saves and unsaves a beat, and the Saved tab shows price drops', async () => {
  const window = quietLoad();
  signIn(window, 'buyer-1');
  let saved = [];
  const calls = mockApi(window, storeRoutes({ myListings:[], listings:[PAID('l2')], extra:[
    ['/api/marketplace/wishlist', () => ({ status:200, data:{ success:true, listingIds:saved, items:saved.map(id => ({ listingId:id, title:'Beat <b>l2</b>', priceCents:1000, savedPriceCents:1500, priceDropped:true, available:true, currency:'USD' })) } })],
    [/\/wishlist\/l2$/, (u, o) => { saved = o.method === 'DELETE' ? [] : ['l2']; return { status:200, data:{ success:true } }; }]
  ] }));
  await openStore(window);
  const heart = window.document.querySelector('[data-s25-heart="l2"]');
  assert.equal(heart.getAttribute('aria-pressed'), 'false');
  heart.click(); await settle();
  assert.equal(heart.getAttribute('aria-pressed'), 'true');
  assert.equal(calls.filter(c => c.url === '/api/marketplace/wishlist/l2')[0].method, 'POST');
  await settle();
  const panel = window.document.getElementById('s25-panel');
  assert.match(panel.textContent, /Saved beats \(1\)/);
  assert.match(panel.textContent, /was \$15\.00/);
  assert.ok(!panel.querySelector('b b'), 'titles are escaped');
  heart.click(); await settle();
  assert.equal(heart.getAttribute('aria-pressed'), 'false');
  assert.equal(calls.filter(c => c.url === '/api/marketplace/wishlist/l2')[1].method, 'DELETE');
});

test('Settings lists the wishlist and gift alert switches', () => {
  const src = read('social.js');
  assert.match(src, /'wishlist_alert', 'Price drops on saved beats'/);
  assert.match(src, /'gift_received', 'Beat gifts'/);
  assert.match(read('app.js'), /destination\.type === 'store'/);
});

/* ---------- 4. Gifts ---------- */
test('gift at checkout: email is checked, then email + message go with the Stripe checkout', async () => {
  const window = quietLoad();
  signIn(window, 'buyer-1');
  const navigated = [];
  window.__DJBattleTestHooks.setStoreNavigate(u => navigated.push(u));
  const calls = mockApi(window, storeRoutes({ myListings:[], listings:[PAID('l2')], extra:[
    ['/api/marketplace/checkout', { status:201, data:{ success:true, order:{ id:'o9' }, gift:{ id:'g1' }, checkout:{ provider:'stripe', redirectUrl:'https://checkout.stripe.com/c/pay/cs_9' } } }]
  ] }));
  await openStore(window);
  window.document.querySelector('[data-store-buy="l2"]').click();
  await settle();
  const dlg = window.document.getElementById('s25-buy-dialog');
  dlg.querySelector('#s25-agree').checked = true;
  dlg.querySelector('#s25-gift-on').checked = true;
  dlg.querySelector('#s25-gift-on').dispatchEvent(new window.Event('change'));
  assert.ok(!dlg.querySelector('#s25-gift-fields').classList.contains('hidden'));
  dlg.querySelector('#s25-gift-email').value = 'not-an-email';
  dlg.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable:true }));
  assert.match(dlg.querySelector('#s25-buy-err').textContent, /email/);
  dlg.querySelector('#s25-gift-email').value = 'Friend@Example.com';
  dlg.querySelector('#s25-gift-msg').value = 'For your next battle';
  dlg.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable:true }));
  await settle();
  const checkout = calls.find(c => c.url === '/api/marketplace/checkout');
  assert.deepEqual(plain(checkout.body.gift), { recipientEmail:'Friend@Example.com', message:'For your next battle', fromName:'' });
  assert.deepEqual(navigated, ['https://checkout.stripe.com/c/pay/cs_9']);
  const p = window.__DJBattleTestHooks.beatStorePurchases();
  assert.ok(!(p.l2 && p.l2.orderId === 'o9'), 'a gift is not saved as the buyer\'s own purchase');
});

test('a gift link is stashed, stripped from the address bar, and claimed once signed in', async () => {
  const window = quietLoad({ url:'http://127.0.0.1/index.html?gift=g1&gt=abc123#store' });
  assert.equal(window.location.search, '', 'token removed from the URL');
  assert.ok(window.sessionStorage.getItem('djb.pendingGiftClaim'));
  signIn(window, 'friend-1');
  const calls = mockApi(window, storeRoutes({ myListings:[], extra:[
    ['/api/marketplace/gifts/claim', { status:200, data:{ success:true, gift:{ fromName:'Dan <script>', message:'Enjoy' } } }],
    ['/api/marketplace/gifts/inbox', { status:200, data:{ success:true, claimed:[] } }]
  ] }));
  const out = await window.DJBStore25.claimPendingGift();
  assert.ok(out.claimed);
  assert.deepEqual(plain(calls.find(c => c.url === '/api/marketplace/gifts/claim').body), { giftId:'g1', token:'abc123' });
  assert.equal(window.sessionStorage.getItem('djb.pendingGiftClaim'), null, 'single use on the client too');
  const dlg = window.document.getElementById('s25-gift-dialog');
  assert.match(dlg.textContent, /Dan <script> sent you a beat/);
  assert.ok(!dlg.querySelector('script'));
});

test('purchases tab shows the licence copy from the receipt', async () => {
  const window = quietLoad();
  signIn(window, 'buyer-1');
  mockApi(window, storeRoutes({ myListings:[], listings:[PAID('l2')], extra:[
    ['/api/marketplace/orders', { status:200, data:{ success:true, orders:[{ id:'o1', listingId:'l2', paymentStatus:'paid', grossAmountCents:1500, currency:'USD', createdAt:'2026-10-25T12:00:00Z', licence:{ label:'Battle use only', summary:'Play it in battles.', may:['Battles'], mayNot:['Releases'] } }] } }],
    ['/api/marketplace/gifts/sent', { status:200, data:{ success:true, gifts:[{ id:'g1', listingId:'l2', recipientEmail:'f***@example.com', status:'sent' }] } }]
  ] }));
  await openStore(window);
  window.document.querySelector('[data-s25-tab="bought"]').click();
  await settle();
  const panel = window.document.getElementById('s25-panel');
  assert.match(panel.textContent, /Battle use only/);
  panel.querySelector('[data-s25-receipt="o1"]').click();
  assert.match(window.document.getElementById('s25-receipt-dialog').textContent, /You may not/);
  window.document.querySelector('[data-s25-tab="gifts"]').click();
  assert.match(window.document.getElementById('s25-panel').textContent, /Sent · not claimed yet/);
});

/* ---------- 5. Tournaments ---------- */
test('tournament create offers 4/8/16/32 and a groups format', async () => {
  const window = quietLoad();
  const src = read('social.js');
  for(const n of ['4', '8', '16', '32']) assert.match(src, new RegExp(`<option value="${n}"`));
  assert.match(src, /id="tournament-format"/);
  assert.match(src, /format:\(D\.getElementById\('tournament-format'\)/);
});

test('group tables render with standings, advancing marks and escaped names', () => {
  const window = quietLoad();
  const t = { id:'t1', title:'Cup', status:'running', capacity:8, rounds:3, format:'groups', stage:'groups', genre:'House', host:{ displayName:'Host' }, entrants:[], entrantCount:8, you:{}, matches:[{ id:'m1', round:0, stage:'group', group:1, status:'ready', first:{ displayName:'A' }, second:{ displayName:'B' } }],
    groups:[{ number:1, label:'Group A', complete:false, rows:[{ dj:{ displayName:'<i>A</i>' }, played:1, wins:1, losses:0, points:3, advancing:true }, { dj:{ displayName:'B' }, played:1, wins:0, losses:1, points:0, advancing:true }, { dj:{ displayName:'C' }, played:0, wins:0, losses:0, points:0, advancing:false }] }] };
  const html = window.DJBSocial && window.DJBSocial._groupsHtml ? window.DJBSocial._groupsHtml(t) : null;
  assert.ok(html, 'groupsHtml exposed for tests');
  const box = window.document.createElement('div'); box.innerHTML = html;
  assert.equal(box.querySelectorAll('.tg-group tbody tr').length, 3);
  assert.equal(box.querySelectorAll('tr.tg-adv').length, 2);
  assert.ok(!box.querySelector('i'));
  assert.match(box.textContent, /Group A/);
});

test('wiring: script tag, build list, build check, phone + light CSS, README and SQL 050-052', () => {
  assert.match(read('index.html'), /<script src="beat_store_five\.js"><\/script>/);
  assert.match(read('scripts/build-pages.js'), /'beat_store_five\.js'/);
  assert.match(read('package.json'), /node --check beat_store_five\.js/);
  const css = read('social.css');
  assert.match(css, /html\[data-theme="light"\] \.s25-heart/);
  assert.match(css, /@media \(max-width:640px\)\{\s*\.s25-terms-cols/);
  assert.match(read('server/README.md'), /## Oct 25 Store/);
  for(const f of ['050_add_tournament_sizes_group_stage', '051_create_beat_wishlist', '052_create_beat_gifts']) assert.ok(fs.existsSync(path.join(root, 'server/sql', `${f}.sql`)));
});
