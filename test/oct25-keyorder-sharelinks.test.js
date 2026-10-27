// Oct 25: auto-mix "Order by key" and beat share links that credit the DJ who shared.
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
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js', 'social.js', 'beat_store_five.js', 'sales_chart.js', 'automix.js', 'share_links.js'].forEach(file => {
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


const read = f => fs.readFileSync(path.join(root, f), 'utf8');

/* ---------- Order by key ---------- */
test('keyDistance follows the Camelot wheel', () => {
  const A = loadAppDom().DJBAutomix;
  assert.equal(A.keyDistance('8A', '8A'), 0);
  assert.equal(A.keyDistance('8A', '8B'), 1);
  assert.equal(A.keyDistance('8A', '9A'), 1);
  assert.equal(A.keyDistance('12A', '1A'), 1); // wraps round
  assert.equal(A.keyDistance('8A', '9B'), 2);
  assert.ok(A.keyDistance('8A', '2A') > 2);
  assert.equal(A.keyDistance('8A', ''), null);
});

test('harmonicOrder walks to the closest key each time, BPM breaks ties, and keyless tracks go last', () => {
  const A = loadAppDom().DJBAutomix;
  const out = A.harmonicOrder([
    { id:'a', camelot:'8A', bpm:124 }, { id:'nokey', camelot:'', bpm:120 }, { id:'far', camelot:'2B', bpm:124 },
    { id:'n1', camelot:'9A', bpm:140 }, { id:'n2', camelot:'9A', bpm:125 }, { id:'rel', camelot:'9B', bpm:126 }
  ]);
  assert.deepEqual(plain(out.map(t => t.id)), ['a', 'n2', 'n1', 'rel', 'far', 'nokey']);
  assert.deepEqual(plain(out.map(t => t.match)), [null, 'smooth', 'same', 'smooth', 'clash', 'unknown']);
  assert.equal(A.harmonicOrder([]).length, 0);
});

test('the Studio panel has "Order by key"; ticking it reorders the list and Start plays that order', async () => {
  const w = quietLoad();
  const keys = { t1:['Opener', '8A', 124], t2:['Far Away', '3B', 124], t3:['Next Door', '9A', 125], t4:['No Key', '', 0] };
  const loads = [];
  w.djbAutomixHooks = { ...w.djbAutomixHooks, crates:() => [{ crateId:'c1', name:'Set' }], crateTrackIds:() => Object.keys(keys),
    track:id => ({ title:keys[id][0], camelotKey:keys[id][1], bpm:keys[id][2] }), camelot:t => t.camelotKey, bpm:t => t.bpm || null, canLoad:() => true,
    runtime:() => ({ loadLibraryTrackToDeck:(id, deck) => { loads.push([id, deck]); return { ok:true }; }, playDeck:async () => ({ ok:true }), applyMix(){} }) };
  w.__DJBattleTestHooks.switchView('studio');
  await settle();
  const box = w.document.getElementById('automix-keyorder');
  assert.ok(box, 'checkbox shown');
  assert.equal(box.checked, false);
  const titles = () => [...w.document.querySelectorAll('#automix-queue li')].map(li => li.textContent.replace(/\s+/g, ' ').trim());
  assert.match(titles()[1], /^Far Away/);
  box.checked = true; box.dispatchEvent(new w.Event('change'));
  assert.equal(w.localStorage.getItem('djbAutomixKeyOrder'), '1');
  assert.deepEqual(titles().map(t => t.replace(/^(same key|smooth|ok|key clash|no key) /, '')), ['Opener 8A', 'Next Door 9A', 'Far Away 3B', 'No Key']);
  assert.ok(w.document.querySelector('#automix-queue .automix-match--smooth'));
  assert.ok(w.document.querySelector('#automix-queue .automix-match--clash'));
  w.document.getElementById('automix-start').click();
  await settle();
  assert.deepEqual(plain(w.DJBAutomix.engine().state.queue), ['t1', 't3', 't2', 't4']);
  assert.deepEqual(loads[0], ['t1', 'a']);
  assert.match(w.document.querySelector('#automix-queue .is-now').textContent, /Opener/);
  w.DJBAutomix.engine().stop();
});

/* ---------- Share links ---------- */
test('opening a share link remembers it, counts one visit, tidies the address and credits checkout', async () => {
  const w = quietLoad();
  const calls = mockApi(w, storeRoutes({ extra:[['/api/marketplace/shareEvents', { status:200, data:{ success:true, counted:true } }]] }));
  w.history.replaceState(null, '', '/index.html?beat=l2&ref=abcdefgh23#store');
  const ref = w.DJBShareLinks.captureShareLink();
  await settle();
  assert.equal(ref.code, 'abcdefgh23');
  assert.equal(w.location.search, '');
  const visit = calls.find(c => c.url === '/api/marketplace/shareEvents');
  assert.equal(visit.body.kind, 'visit');
  assert.equal(visit.body.code, 'abcdefgh23');
  assert.equal(visit.body.listingId, 'l2');
  assert.deepEqual(plain(w.DJBShareLinks.checkoutExtras('l2')), { shareCode:'abcdefgh23' });
  assert.deepEqual(plain(w.DJBShareLinks.checkoutExtras('l1')), {});
  // Bad codes and expired refs are ignored.
  w.history.replaceState(null, '', '/index.html?beat=l2&ref=../evil#store');
  assert.equal(w.DJBShareLinks.captureShareLink(), null);
  w.localStorage.setItem('djbShareRef', JSON.stringify({ listingId:'l2', code:'abcdefgh23', at:Date.now() - 8 * 86400000 }));
  assert.deepEqual(plain(w.DJBShareLinks.checkoutExtras('l2')), {});
});

test('a buyer who came through a share link sends the code with checkout', async () => {
  const w = quietLoad(); signIn(w, 'buyer-1');
  w.__DJBattleTestHooks.setStoreNavigate(() => {});
  const PAIDL = listing('l2', { displayPriceCents:1500, freeDownload:null, rights:{ licenseType:'battle_use' } });
  const calls = mockApi(w, storeRoutes({ myListings:[], listings:[PAIDL], extra:[['/api/marketplace/shareEvents', { status:200, data:{ success:true } }],
    ['/api/marketplace/checkout', { status:201, data:{ success:true, order:{ id:'o1' }, checkout:{ provider:'stripe', redirectUrl:'https://checkout.stripe.com/c/pay/cs_1' } } }],
    ['/api/marketplace/wishlist', { status:200, data:{ success:true, items:[], listingIds:[] } }]] }));
  w.localStorage.setItem('djbShareRef', JSON.stringify({ listingId:'l2', code:'abcdefgh23', at:Date.now() }));
  await openStore(w);
  w.document.querySelector('[data-store-buy="l2"]').click();
  await settle();
  const dlg = w.document.getElementById('s25-buy-dialog');
  dlg.querySelector('#s25-agree').checked = true;
  dlg.querySelector('form').dispatchEvent(new w.Event('submit', { cancelable:true }));
  await settle();
  const checkout = calls.find(c => c.url === '/api/marketplace/checkout');
  assert.ok(checkout, 'checkout called');
  assert.equal(checkout.body.shareCode, 'abcdefgh23');
});

test('every store card gets a Share button; signed-out DJs are asked to sign in, signed-in DJs get their link', async () => {
  const w = quietLoad();
  const calls = mockApi(w, storeRoutes({ extra:[[/\/shareLink$/, { status:200, data:{ success:true, code:'k2m3n4p5q6', listingId:'l1' } }]] }));
  await openStore(w);
  const btns = w.document.querySelectorAll('#store-grid [data-share-link]');
  assert.equal(btns.length, 2);
  assert.equal((await w.DJBShareLinks.share('l1')).signedOut, true);
  assert.ok(!calls.some(c => /shareLink/.test(c.url)));
  signIn(w);
  const res = await w.DJBShareLinks.share('l1');
  assert.equal(res.url, 'http://127.0.0.1/index.html?beat=l1&ref=k2m3n4p5q6#store');
  assert.equal(calls.find(c => /shareLink/.test(c.url)).url, '/api/marketplace/listings/l1/shareLink');
  const dlg = w.document.getElementById('share-link-dialog');
  assert.ok(dlg.open);
  assert.equal(dlg.querySelector('#share-link-url').value, res.url);
});

test('a preview play through a share link is counted once', async () => {
  const w = quietLoad(); signIn(w);
  const calls = mockApi(w, [['/api/marketplace/shareEvents', { status:200, data:{ success:true } }]]);
  w.localStorage.setItem('djbShareRef', JSON.stringify({ listingId:'l1', code:'abcdefgh23', at:Date.now() }));
  const b = w.document.createElement('button'); b.dataset.s25Preview = 'l1'; w.document.body.appendChild(b);
  b.click(); b.click(); await settle();
  const plays = calls.filter(c => c.url === '/api/marketplace/shareEvents' && c.body.kind === 'play');
  assert.equal(plays.length, 1);
});

test('sellers see share counts per DJ name, an empty state, and the SQL-053 notice', async () => {
  const w = quietLoad(); signIn(w, 'seller-1');
  mockApi(w, storeRoutes({ extra:[
    [/^\/api\/marketplace\/freeEmail\/leads/, { status:200, data:{ success:true, leads:[] } }],
    ['/api/marketplace/shareStats', { status:200, data:{ success:true, rows:[{ listingId:'l1', listingTitle:'Beat l1', sharerName:'Kid <b>Rhythm</b>', isYou:false, visits:12, plays:5, sales:2, earningsCents:1800, currency:'USD' }], totals:{ visits:12, plays:5, sales:2, earningsCents:1800, sharers:1 } } }]
  ] }));
  await openStore(w); await settle(10);
  const box = w.document.getElementById('store-shares');
  assert.match(box.textContent, /Shared by DJs/);
  assert.match(box.textContent, /Kid <b>Rhythm<\/b>/); // escaped, shown as text
  assert.equal(box.querySelector('tbody tr').children.length, 5);
  assert.doesNotMatch(box.innerHTML, /seller-1|sharer|user_id/i);
  const H = w.DJBShareLinks.statsHtml;
  assert.match(H({ rows:[], totals:null }, false), /No shared visits yet/);
  assert.match(H({ schemaMissing:true }, false), /SQL 053/);
  assert.match(H({ rows:[], totals:null }, true), /Sample data/);
});

test('share_links.js is wired into the page, Pages build, build check and offline shell', () => {
  assert.match(read('index.html'), /<script src="share_links\.js"><\/script>/);
  assert.match(read('scripts/build-pages.js'), /'share_links\.js'/);
  assert.match(read('package.json'), /node --check share_links\.js/);
  assert.match(read('sw.js'), /'share_links\.js'/);
  assert.match(read('app.js'), /DJBShareLinks\.checkoutExtras\(listingId\)/);
});
