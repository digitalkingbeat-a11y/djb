// Oct 25: beat sales chart for sellers and auto-mix practice mode in the Studio.
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
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js', 'social.js', 'beat_store_five.js', 'sales_chart.js', 'automix.js'].forEach(file => {
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
const NOW = Date.parse('2026-10-14T12:00:00Z'); // a Wednesday

/* ---------- Sales chart: pure series ---------- */
test('weeks start on Monday and months on the 1st (UTC)', () => {
  const { bucketStart } = loadAppDom().DJBSalesChart;
  assert.equal(new Date(bucketStart(NOW, 'week')).toISOString(), '2026-10-12T00:00:00.000Z');
  assert.equal(new Date(bucketStart(NOW, 'month')).toISOString(), '2026-10-01T00:00:00.000Z');
});

test('buildSalesSeries buckets paid sales and free downloads by week and ranks best sellers', () => {
  const { buildSalesSeries } = loadAppDom().DJBSalesChart;
  const sales = { paidSales:[
    { listingId:'l1', paidAt:'2026-10-13T10:00:00Z', sellerAmountCents:900, currency:'USD' },
    { listingId:'l1', paidAt:'2026-10-06T10:00:00Z', sellerAmountCents:900, currency:'USD' },
    { listingId:'l2', paidAt:'2026-10-14T09:00:00Z', sellerAmountCents:1800, currency:'USD' },
    { listingId:'gone', paidAt:'2025-01-01T00:00:00Z', sellerAmountCents:100, currency:'USD' }
  ] };
  const leads = [{ listingId:'l3', claimedAt:'2026-10-12T01:00:00Z' }, { listingId:'l3', createdAt:'2026-09-30T01:00:00Z', downloadedAt:'2026-10-01T00:00:00Z' }];
  const listings = [{ id:'l1', title:'Night Drive' }, { id:'l2', title:'Sun Up' }, { id:'l3', title:'Free Loop' }];
  const data = buildSalesSeries({ sales, leads, listings, period:'week', now:NOW });
  assert.equal(data.series.length, 8);
  const last = data.series[7];
  assert.deepEqual([last.label, last.sales, last.earningsCents, last.downloads], ['Oct 12', 2, 2700, 1]);
  assert.equal(data.series[6].sales, 1);
  assert.equal(data.series[5].downloads, 1);
  assert.deepEqual(plain(data.totals), { sales:3, earningsCents:3600, downloads:2 }); // the 2025 sale is outside the window
  assert.deepEqual(plain(data.best.map(b => b.title)), ['Night Drive', 'Sun Up', 'A beat you removed', 'Free Loop']);
  assert.equal(data.empty, false);
});

test('month view covers six months; old servers without paidSales fall back to paid orders only', () => {
  const { buildSalesSeries } = loadAppDom().DJBSalesChart;
  const sales = { orders:[
    { listingId:'l1', paymentStatus:'paid', paidAt:'2026-08-03T00:00:00Z', sellerAmountCents:500 },
    { listingId:'l1', paymentStatus:'pending', createdAt:'2026-08-03T00:00:00Z', sellerAmountCents:500 },
    { listingId:'l1', paymentStatus:'partially_refunded', paidAt:'2026-10-01T00:00:00Z', sellerAmountCents:300 }
  ] };
  const data = buildSalesSeries({ sales, leads:[], listings:[], period:'month', now:NOW });
  assert.deepEqual(plain(data.series.map(b => b.label)), ['May 26', 'Jun 26', 'Jul 26', 'Aug 26', 'Sep 26', 'Oct 26']);
  assert.deepEqual(plain(data.series.map(b => b.sales)), [0, 0, 0, 1, 0, 1]);
  assert.equal(data.totals.earningsCents, 800);
});

test('no sales and no downloads gives a clear empty state', () => {
  const w = loadAppDom();
  const data = w.DJBSalesChart.buildSalesSeries({ sales:{ paidSales:[] }, leads:[], now:NOW });
  assert.equal(data.empty, true);
  assert.match(w.DJBSalesChart.insightsHtml(data, 'week', false), /No sales or downloads yet/);
});

/* ---------- Sales chart: in the Beat Store ---------- */
test('the seller sees the chart from real server data, can switch to months, and sees an empty state', async () => {
  const w = quietLoad();
  signIn(w);
  const recent = new Date(Date.now() - 2 * 86400000).toISOString();
  const calls = mockApi(w, storeRoutes({
    sales:{ status:200, data:{ success:true, orders:[], totals:{ paidOrders:1, earningsCents:900, currency:'USD' }, paidSales:[{ listingId:'l2', paidAt:recent, sellerAmountCents:900, currency:'USD' }] } },
    extra:[[/^\/api\/marketplace\/freeEmail\/leads/, { status:200, data:{ success:true, leads:[{ listingId:'l1', claimedAt:recent }] } }]]
  }));
  await openStore(w);
  await settle(10);
  assert.ok(calls.some(c => c.url === '/api/marketplace/freeEmail/leads?limit=500'));
  const box = w.document.getElementById('store-insights');
  assert.match(box.textContent, /Sales over time/);
  assert.match(box.textContent, /Best-selling beats/);
  assert.equal(box.querySelector('.sales-best li strong').textContent, 'Beat l2');
  assert.doesNotMatch(box.textContent, /Sample data/);
  assert.equal(box.querySelectorAll('.sales-chart-col').length, 8);
  box.querySelector('[data-sales-period="month"]').click();
  assert.equal(box.querySelectorAll('.sales-chart-col').length, 6);
  assert.equal(box.querySelector('[data-sales-period="month"]').getAttribute('aria-pressed'), 'true');

  const w2 = quietLoad(); signIn(w2);
  mockApi(w2, storeRoutes({ extra:[[/^\/api\/marketplace\/freeEmail\/leads/, { status:200, data:{ success:true, leads:[] } }]] }));
  await openStore(w2); await settle(10);
  assert.ok(w2.document.querySelector('#store-insights [data-sales-empty]'));
});

test('the sales chart files are wired into the page, Pages build, build check and offline shell', () => {
  assert.match(read('index.html'), /<script src="sales_chart\.js"><\/script>/);
  assert.match(read('index.html'), /<script src="automix\.js"><\/script>/);
  assert.match(read('scripts/build-pages.js'), /'sales_chart\.js', 'automix\.js'/);
  assert.match(read('package.json'), /node --check sales_chart\.js && node --check automix\.js/);
  assert.match(read('sw.js'), /'sales_chart\.js', 'automix\.js'/);
  assert.match(read('server/marketplace_sales.js'), /paidSales/);
});

/* ---------- Auto-mix: engine ---------- */
test('fadePosition eases from one side to the other and fadeStartAt leaves room for the fade', () => {
  const A = loadAppDom().DJBAutomix;
  assert.equal(A.fadePosition(0, 8, 'b'), -1);
  assert.equal(A.fadePosition(4, 8, 'b'), 0);
  assert.equal(A.fadePosition(8, 8, 'b'), 1);
  assert.equal(A.fadePosition(20, 8, 'a'), -1);
  assert.equal(A.fadeStartAt(180, 8), 172);
  assert.equal(A.fadeStartAt(10, 16), 5);
  assert.equal(A.fadeStartAt(NaN, 8), null);
  assert.equal(A.cleanTransition('16'), 16);
  assert.equal(A.cleanTransition(7), 8);
});

function fakeDecks(){
  let t = 0;
  const audio = { a:{ paused:true, duration:NaN, currentTime:0, ended:false, pause(){ this.paused = true; } }, b:{ paused:true, duration:NaN, currentTime:0, ended:false, pause(){ this.paused = true; } } };
  const loads = []; let x = 0;
  const runtime = {
    loadLibraryTrackToDeck(id, deck){ if(id === 'bad') return { ok:false }; loads.push([id, deck]); Object.assign(audio[deck], { duration:60, currentTime:0, ended:false }); return { ok:true }; },
    async playDeck(deck){ audio[deck].paused = !audio[deck].paused; return { ok:true }; },
    applyMix(){}, syncDeck(){}
  };
  return { audio, loads, runtime, clock:{ now:() => t, advance(ms){ t += ms; } }, get x(){ return x; }, setX(v){ x = v; } };
}

test('the engine plays a crate in order, crossfades to the other deck and finishes on its own', async () => {
  const A = loadAppDom().DJBAutomix;
  const f = fakeDecks();
  const statuses = [];
  const eng = A.createEngine({ runtime:f.runtime, getAudio:d => f.audio[d], canLoad:id => id !== 'blocked', now:f.clock.now, setInterval:() => 1, clearInterval:() => {}, setXfader:v => f.setX(v), onChange:s => statuses.push(s) });
  assert.equal((await eng.start(['t1', 'blocked', 'bad', 't2'], { transitionSec:8 })).ok, true);
  assert.deepEqual(f.loads, [['t1', 'a']]);
  assert.equal(f.x, -1);
  assert.equal(f.audio.a.paused, false);
  f.audio.a.currentTime = 51; eng.tick(); await settle();
  assert.equal(eng.status().fading, false); // not yet
  f.audio.a.currentTime = 52; eng.tick(); await settle();
  assert.deepEqual(f.loads[1], ['t2', 'b']); // blocked + unloadable tracks skipped
  assert.equal(f.audio.b.paused, false);
  f.clock.advance(4000); eng.tick();
  assert.ok(Math.abs(f.x) < 0.01);
  f.clock.advance(4000); eng.tick();
  assert.equal(f.x, 1);
  assert.equal(f.audio.a.paused, true);
  assert.deepEqual([eng.status().deck, eng.status().index], ['b', 3]);
  f.audio.b.currentTime = 52; eng.tick(); await settle(); // nothing left to mix into
  f.audio.b.ended = true; f.audio.b.paused = true; eng.tick();
  assert.equal(eng.status().running, false);
  assert.match(statuses.at(-1).message, /last track/);
});

test('Stop hands the decks back and an empty crate is explained', async () => {
  const A = loadAppDom().DJBAutomix;
  const f = fakeDecks(); let cleared = 0;
  const eng = A.createEngine({ runtime:f.runtime, getAudio:d => f.audio[d], now:f.clock.now, setInterval:() => 7, clearInterval:id => { cleared = id; }, setXfader:v => f.setX(v) });
  assert.equal((await eng.start([], {})).ok, false);
  assert.match(eng.status().message, /no tracks/);
  await eng.start(['t1', 't2'], { transitionSec:4 });
  eng.stop();
  assert.equal(cleared, 7);
  assert.equal(f.audio.a.paused, true);
  assert.equal(eng.status().running, false);
  assert.match(eng.status().message, /stopped/);
});

/* ---------- Auto-mix: Studio panel ---------- */
test('the Studio shows the auto-mix panel with crates, transition lengths and Start/Stop', async () => {
  const w = quietLoad();
  const fake = { crateId:'c1', name:'Warm-up' };
  const loads = [];
  w.djbAutomixHooks = { ...w.djbAutomixHooks, crates:() => [fake], crateTrackIds:() => ['t1', 't2'], track:id => ({ title:`Song ${id}` }), canLoad:() => true,
    runtime:() => ({ loadLibraryTrackToDeck:(id, deck) => { loads.push([id, deck]); return { ok:true }; }, playDeck:async () => ({ ok:true }), applyMix(){} }) };
  w.__DJBattleTestHooks.switchView('studio');
  await settle();
  const panel = w.document.getElementById('automix-panel');
  assert.ok(panel, 'panel mounted');
  assert.deepEqual([...panel.querySelectorAll('#automix-length option')].map(o => o.value), ['4', '8', '16', '32']);
  assert.match(panel.querySelector('#automix-crate').textContent, /Warm-up \(2\)/);
  w.document.getElementById('automix-length').value = '16';
  w.document.getElementById('automix-start').click();
  await settle();
  assert.deepEqual(loads, [['t1', 'a']]);
  assert.equal(w.document.getElementById('xfader').value, '-1');
  assert.equal(w.DJBAutomix.engine().status().transition, 16);
  assert.equal(w.document.getElementById('automix-stop').disabled, false);
  assert.match(w.document.querySelector('#automix-queue .is-now').textContent, /Song t1/);
  w.document.getElementById('automix-stop').click();
  assert.equal(w.document.getElementById('automix-start').disabled, false);
  w.DJBAutomix.engine().stop();
});

test('with no crates the panel says to make one first', async () => {
  const w = quietLoad();
  w.djbAutomixHooks = { ...w.djbAutomixHooks, crates:() => [] };
  w.__DJBattleTestHooks.switchView('studio');
  await settle();
  assert.match(w.document.getElementById('automix-status').textContent, /Make a crate/);
  assert.equal(w.document.getElementById('automix-start').disabled, true);
});
