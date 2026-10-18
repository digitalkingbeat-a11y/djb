const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createEmailSender, createFreeEmailVerificationGateway, emailConfigStatus, freeEmailConfirmLink, freeEmailConfirmationsStatus, maskEmail } = require('../email_sender');
const { createFreeEmailVerificationAdapter, createFreeEmailOffer, claimFreeEmailDownload, verifyFreeEmailLead } = require('../marketplace_free_email');
const { createMarketplaceCheckout, createStripeConnectAdapter, handleMarketplacePaymentEvent, issueMarketplaceDownloadAccess, withOrderReturnParam } = require('../marketplace_commerce');
const { applyConnectAccountUpdate, checkoutReturnUrls, createStripeConnectClient, listSellerSales, refreshSellerAccount, salesConfigStatus, setListingPrice, startSellerOnboarding } = require('../marketplace_sales');
const { listSellerStoreListings } = require('../marketplace_free_beats');
const { savePracticeSession, renamePracticeSession, deletePracticeSession, listPracticeSessions } = require('../practice_sessions');

const root = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

/* ---------- in-memory Supabase stand-in ---------- */
function dataClient(initial){
  const db = Object.fromEntries(Object.entries(initial).map(([table, rows]) => [table, rows.map(row => ({ ...row }))]));
  const calls = [];
  return { db, calls, from(table){ if(!db[table]) db[table] = []; calls.push(table); return new Query(db, table); } };
}
class Query{
  constructor(db, table){ this.db = db; this.table = table; this.filters = []; this.inFilters = []; this.ltFilters = []; this.limitValue = null; this.insertRows = null; this.updateValues = null; this.orderBy = null; this.deleting = false; }
  select(){ return this; }
  eq(field, value){ this.filters.push([field, value]); return this; }
  in(field, values){ this.inFilters.push([field, values.map(String)]); return this; }
  lt(field, value){ this.ltFilters.push([field, value]); return this; }
  order(field, opts){ this.orderBy = [field, opts && opts.ascending]; return this; }
  limit(value){ this.limitValue = Number(value); return this; }
  insert(rows){ this.insertRows = rows.map(row => ({ ...row })); return this; }
  update(values){ this.updateValues = { ...values }; return this; }
  delete(){ this.deleting = true; return this; }
  then(resolve, reject){ return this.exec().then(resolve, reject); }
  async single(){ const result = await this.exec(); return result.error ? result : { data:(result.data && result.data[0]) || null, error:null }; }
  async exec(){
    if(this.insertRows){
      for(const row of this.insertRows){ if(row.id && this.db[this.table].some(old => old.id === row.id)) return { data:null, error:{ message:'duplicate key value violates unique constraint' } }; }
      this.db[this.table].push(...this.insertRows);
      return { data:this.insertRows, error:null };
    }
    let rows = this.db[this.table].filter(row => this.filters.every(([f, v]) => String(row[f]) === String(v)));
    rows = rows.filter(row => this.inFilters.every(([f, vs]) => vs.includes(String(row[f]))));
    rows = rows.filter(row => this.ltFilters.every(([f, v]) => new Date(row[f]) < new Date(v)));
    if(this.deleting){ const keep = this.db[this.table].filter(row => !rows.includes(row)); this.db[this.table] = keep; return { data:rows, error:null }; }
    if(this.updateValues){ rows.forEach(row => Object.assign(row, this.updateValues)); return { data:rows, error:null }; }
    if(this.orderBy){ const [f, asc] = this.orderBy; rows = rows.slice().sort((a, b) => (new Date(a[f]) - new Date(b[f])) * (asc ? 1 : -1)); }
    if(this.limitValue != null) rows = rows.slice(0, this.limitValue);
    return { data:rows, error:null };
  }
}

function fakeFetch(handler){
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body:init.body ? String(init.body) : '' });
    const reply = handler(url, init) || { ok:true, status:200, json:{} };
    return { ok:reply.ok !== false, status:reply.status || 200, json:async () => reply.json || {}, headers:{ get:name => (reply.headers || {})[name.toLowerCase()] || null } };
  };
  fn.calls = calls;
  return fn;
}
function storeSeed(extra = {}){
  return dataClient({
    music_library_tracks:[{ id:'trk-1', user_id:'seller-1', title:'Neon Knock', rights_classification:'original', audio_storage_object_path:'private/library-audio/seller-1/tracks/trk-1/audio.mp3', verified_mime_type:'audio/mpeg' },
      { id:'trk-2', user_id:'seller-1', title:'Wave', rights_classification:'original', audio_storage_object_path:'private/library-audio/seller-1/tracks/trk-2/audio.wav', verified_mime_type:'audio/wav' }],
    marketplace_products:[{ id:'prod-1', creator_user_id:'seller-1', library_track_id:'trk-1', title:'Neon Knock', status:'active', rights_classification:'original', audio_storage_bucket:'battle-mixes', audio_storage_object_path:'private/library-audio/seller-1/tracks/trk-1/audio.mp3' },
      { id:'prod-2', creator_user_id:'seller-1', library_track_id:'trk-2', title:'Wave', status:'active', rights_classification:'original', audio_storage_bucket:'battle-mixes', audio_storage_object_path:'private/library-audio/seller-1/tracks/trk-2/audio.wav' }],
    marketplace_rights_policies:[{ id:'r1', product_id:'prod-1', status:'active', rights_classification:'original', license_type:'creator_license', marketplace_streaming_allowed:true, download_allowed:true },
      { id:'r2', product_id:'prod-2', status:'active', rights_classification:'original', license_type:'creator_license', marketplace_streaming_allowed:true, download_allowed:true }],
    marketplace_listings:[{ id:'lst-1', product_id:'prod-1', seller_user_id:'seller-1', title:'Neon Knock', status:'published', display_price_cents:0, currency:'USD' },
      { id:'lst-2', product_id:'prod-2', seller_user_id:'seller-1', title:'Wave', status:'published', display_price_cents:0, currency:'USD' }],
    marketplace_free_email_offers:[{ id:'off-1', listing_id:'lst-1', seller_user_id:'seller-1', product_id:'prod-1', status:'active', free_email_enabled:true }],
    marketplace_seller_accounts:[], marketplace_orders:[], marketplace_order_items:[], marketplace_payment_events:[], marketplace_entitlements:[], marketplace_player_sessions:[],
    marketplace_free_email_leads:[],
    ...extra
  });
}

describe('Paid beats with Stripe (Oct 18 c)', () => {
  it('reports exactly which settings are missing, by name, and never echoes a key', () => {
    const off = salesConfigStatus({});
    expect(off.paidSalesConfigured).to.equal(false);
    expect(off.missing).to.include('STRIPE_SECRET_KEY');
    expect(off.missing).to.include('STRIPE_WEBHOOK_SECRET');
    expect(off.webhookPath).to.equal('/api/marketplace/webhooks/stripe');
    const env = { STRIPE_SECRET_KEY:'sk_test_fake', STRIPE_WEBHOOK_SECRET:'whsec_fake', APP_PUBLIC_URL:'https://djb.example' };
    const on = salesConfigStatus(env);
    expect(on.paidSalesConfigured).to.equal(true);
    expect(JSON.stringify(on)).to.not.include('sk_test_fake');
    expect(JSON.stringify(on)).to.not.include('whsec_fake');
    expect(checkoutReturnUrls(env)).to.deep.equal({ successUrl:'https://djb.example/?checkout=success#store', cancelUrl:'https://djb.example/?checkout=cancel#store' });
    expect(checkoutReturnUrls({ ...env, MARKETPLACE_STRIPE_SUCCESS_URL:'https://x.example/ok' }).successUrl).to.equal('https://x.example/ok');
    expect(salesConfigStatus({ ...env, MARKETPLACE_PLATFORM_FEE_BPS:'750' }).platformFeePercent).to.equal(7.5);
  });

  it('adds the order id to Stripe return URLs before the #fragment', () => {
    expect(withOrderReturnParam('https://djb.example/?checkout=success#store', 'mp_order_1')).to.equal('https://djb.example/?checkout=success&order=mp_order_1#store');
    expect(withOrderReturnParam('https://djb.example/ok', 'o2')).to.equal('https://djb.example/ok?order=o2');
    expect(withOrderReturnParam('https://djb.example/ok?session_id={CHECKOUT_SESSION_ID}', 'o3')).to.equal('https://djb.example/ok?session_id={CHECKOUT_SESSION_ID}&order=o3');
  });

  it('owner sets a price on an eligible MP3 listing; free offer pauses; WAV, other sellers and bad prices are refused', async () => {
    const db = storeSeed();
    const priced = await setListingPrice(db, 'seller-1', 'lst-1', { priceCents:999 });
    expect(priced.listing.displayPriceCents).to.equal(999);
    expect(db.db.marketplace_listings[0].commerce_status).to.equal('enabled');
    expect(priced.freeOfferStatus).to.equal('paused');
    expect(db.db.marketplace_free_email_offers[0].free_email_enabled).to.equal(false);
    expect((await setListingPrice(db, 'other', 'lst-1', { priceCents:999 })).forbidden).to.equal(true);
    expect((await setListingPrice(db, 'seller-1', 'lst-1', { priceCents:50 })).validationError).to.match(/lowest price/);
    expect((await setListingPrice(db, 'seller-1', 'lst-1', { priceCents:60000 })).validationError).to.match(/highest price/);
    expect((await setListingPrice(db, 'seller-1', 'lst-1', { priceCents:-1 })).validationError).to.exist;
    expect((await setListingPrice(db, 'seller-1', 'lst-1', { priceCents:999, currency:'EUR' })).validationError).to.match(/US dollar/);
    const wav = await setListingPrice(db, 'seller-1', 'lst-2', { priceCents:999 });
    expect(wav.code).to.equal('format');
    db.db.marketplace_products[0].rights_classification = 'unknown';
    expect((await setListingPrice(db, 'seller-1', 'lst-1', { priceCents:1999 })).code).to.equal('rights');
    db.db.marketplace_products[0].rights_classification = 'original';
    const free = await setListingPrice(db, 'seller-1', 'lst-1', { priceCents:0 });
    expect(free.freeOfferStatus).to.equal('active');
    expect(db.db.marketplace_free_email_offers[0].free_email_enabled).to.equal(true);
  });

  it('Connect onboarding creates one Express account, saves it, and returns Stripe\'s link (mocked Stripe)', async () => {
    const db = storeSeed();
    const fetch = fakeFetch(url => {
      if(url.endsWith('/v1/accounts')) return { json:{ id:'acct_123', charges_enabled:false, payouts_enabled:false, requirements:{ currently_due:['external_account'] } } };
      if(url.endsWith('/v1/account_links')) return { json:{ url:'https://connect.stripe.com/setup/e/acct_123/x' } };
      if(url.includes('/v1/accounts/acct_123')) return { json:{ id:'acct_123', charges_enabled:true, payouts_enabled:true, details_submitted:true, requirements:{ currently_due:[] } } };
      return { ok:false, status:404 };
    });
    const stripe = createStripeConnectClient({ secretKey:'sk_test_fake', httpClient:fetch });
    const env = { APP_PUBLIC_URL:'https://djb.example' };
    const started = await startSellerOnboarding(db, stripe, 'seller-1', { email:'seller@example.com' }, new Date('2026-10-18T12:00:00Z'), env);
    expect(started.onboardingUrl).to.equal('https://connect.stripe.com/setup/e/acct_123/x');
    expect(started.account.accountStatus).to.equal('pending');
    expect(db.db.marketplace_seller_accounts).to.have.length(1);
    const linkCall = fetch.calls.find(c => c.url.endsWith('/v1/account_links'));
    expect(linkCall.body).to.include(encodeURIComponent('https://djb.example/?stripeConnect=return#store'));
    expect(fetch.calls[0].init.headers.Authorization).to.equal('Bearer sk_test_fake');
    fetch.calls.forEach(c => expect(c.url.startsWith('https://api.stripe.com/')).to.equal(true));
    await startSellerOnboarding(db, stripe, 'seller-1', {}, new Date(), env);
    expect(fetch.calls.filter(c => c.url.endsWith('/v1/accounts'))).to.have.length(1, 'account created only once');
    const refreshed = await refreshSellerAccount(db, stripe, 'seller-1');
    expect(refreshed.account.accountStatus).to.equal('connected');
    expect(refreshed.account.chargesEnabled && refreshed.account.payoutsEnabled).to.equal(true);
    expect((await startSellerOnboarding(db, createStripeConnectClient({ secretKey:'' }), 'seller-1', {}, new Date(), env)).providerUnavailable).to.equal(true);
    const update = await applyConnectAccountUpdate(db, { type:'account.updated', data:{ object:{ id:'acct_123', charges_enabled:false, payouts_enabled:false, requirements:{ currently_due:['individual.id_number'] } } } });
    expect(update.account.accountStatus).to.equal('pending');
    expect(update.account.requirementsDue).to.deep.equal(['individual.id_number']);
    expect((await applyConnectAccountUpdate(db, { data:{ object:{ id:'acct_unknown' } } })).unknownAccount).to.equal(true);
  });

  it('full paid flow with mocked Stripe: checkout -> signed webhook -> paid download; seller sees earnings', async () => {
    const db = storeSeed({ marketplace_seller_accounts:[{ id:'mp_seller_1', seller_user_id:'seller-1', provider:'stripe', provider_account_id:'acct_123', account_status:'connected', charges_enabled:true, payouts_enabled:true, requirements_due:[] }] });
    await setListingPrice(db, 'seller-1', 'lst-1', { priceCents:1000 });
    const fetch = fakeFetch(url => url.endsWith('/v1/checkout/sessions') ? { json:{ id:'cs_test_1', url:'https://checkout.stripe.com/c/pay/cs_test_1', status:'open' } } : { ok:false });
    const adapter = createStripeConnectAdapter({ secretKey:'sk_test_fake', httpClient:fetch, successUrl:'https://djb.example/?checkout=success#store', cancelUrl:'https://djb.example/?checkout=cancel#store', webhookSecret:'whsec_test' });
    const checkout = await createMarketplaceCheckout(db, adapter, 'buyer-1', { listingId:'lst-1', provider:'stripe', clientPriceCents:1000, currency:'USD' });
    expect(checkout.checkoutCreated).to.equal(true);
    expect(checkout.checkout.redirectUrl).to.equal('https://checkout.stripe.com/c/pay/cs_test_1');
    const sent = new URLSearchParams(fetch.calls[0].body);
    const orderId = checkout.order.id;
    expect(sent.get('success_url')).to.equal(`https://djb.example/?checkout=success&order=${orderId}#store`);
    expect(sent.get('payment_intent_data[transfer_data][destination]')).to.equal('acct_123');
    expect(sent.get('payment_intent_data[application_fee_amount]')).to.equal('100');
    expect(checkout.item.allowedFiles[0]).to.include({ filename:'Neon Knock.mp3', mimeType:'audio/mpeg' });
    const tampered = await createMarketplaceCheckout(db, adapter, 'buyer-1', { listingId:'lst-1', provider:'stripe', clientPriceCents:1 });
    expect(tampered.validationError).to.match(/price/);

    const event = { id:'evt_1', type:'checkout.session.completed', data:{ object:{ id:'cs_test_1', amount_total:1000, currency:'usd', metadata:{ orderId }, payment_intent:'pi_1' } } };
    const raw = JSON.stringify(event);
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', 'whsec_test').update(`${t}.${raw}`).digest('hex');
    const forged = await handleMarketplacePaymentEvent(db, adapter, event, new Date(), { rawBody:raw, signature:`t=${t},v1=${'0'.repeat(64)}` });
    expect(forged.verificationFailed).to.equal(true);
    const settled = await handleMarketplacePaymentEvent(db, adapter, event, new Date(), { rawBody:raw, signature:`t=${t},v1=${sig}` });
    expect(settled.order.paymentStatus).to.equal('paid');
    const storage = { signed:[], async createSignedUrl(p){ this.signed.push(p); return { data:{ signedUrl:`https://proj.supabase.co/storage/v1/object/sign/${p}?token=x` } }; } };
    const access = await issueMarketplaceDownloadAccess(db, storage, 'buyer-1', { orderId });
    expect(access.downloadAccess.url).to.match(/^https:\/\/proj\.supabase\.co/);
    expect((await issueMarketplaceDownloadAccess(db, storage, 'someone-else', { orderId })).unavailable).to.equal(true);

    const sales = await listSellerSales(db, 'seller-1');
    expect(sales.totals).to.include({ paidOrders:1, grossCents:1000, platformFeeCents:100, earningsCents:900 });
    expect(sales.orders[0]).to.not.have.property('buyerEmail');
    expect((await listSellerSales(db, 'buyer-1')).orders).to.have.length(0);
  });

  it('index.js wires the sales routes, keeps keys in env vars only, and verifies account.updated webhooks', () => {
    expect(serverSource).to.match(/app\.get\('\/api\/marketplace\/storeConfig'/);
    expect(serverSource).to.match(/app\.patch\('\/api\/marketplace\/listings\/:listingId\/price', requireAuth/);
    expect(serverSource).to.match(/app\.post\('\/api\/marketplace\/sellerAccounts\/onboard', requireAuth/);
    expect(serverSource).to.match(/app\.post\('\/api\/marketplace\/sellerAccounts\/refresh', requireAuth/);
    expect(serverSource).to.match(/app\.get\('\/api\/marketplace\/sales', requireAuth/);
    expect(serverSource).to.match(/account\.updated[\s\S]{0,400}verifyStripeSignature/);
    expect(serverSource).to.match(/Paid sales aren\\'t set up on the server yet/);
    const sources = ['index.js', 'marketplace_sales.js', 'marketplace_commerce.js', 'email_sender.js'].map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
    expect(sources).to.not.match(/sk_(live|test)_[A-Za-z0-9]{8,}/);
    expect(sources).to.not.match(/(re|SG)\.[A-Za-z0-9_-]{16,}/);
    ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'MARKETPLACE_STRIPE_SUCCESS_URL', 'MARKETPLACE_STRIPE_CANCEL_URL', 'APP_PUBLIC_URL', 'EMAIL_PROVIDER', 'RESEND_API_KEY', 'SENDGRID_API_KEY', 'EMAIL_FROM', '/api/marketplace/webhooks/stripe'].forEach(name => expect(readme).to.include(name));
  });
});

describe('Confirmation emails for free claims (Oct 18 c)', () => {
  it('picks the provider from env and falls back to a safe no-op', async () => {
    expect(emailConfigStatus({}).configured).to.equal(false);
    expect(emailConfigStatus({ RESEND_API_KEY:'x', EMAIL_FROM:'Beats <beats@djb.example>' })).to.include({ provider:'resend', configured:true });
    expect(emailConfigStatus({ SENDGRID_API_KEY:'x', EMAIL_FROM:'beats@djb.example' })).to.include({ provider:'sendgrid', configured:true });
    expect(emailConfigStatus({ EMAIL_PROVIDER:'resend' }).missing).to.deep.equal(['RESEND_API_KEY', 'EMAIL_FROM']);
    expect(freeEmailConfirmationsStatus({ RESEND_API_KEY:'x', EMAIL_FROM:'beats@djb.example' }).missing).to.deep.equal(['APP_PUBLIC_URL']);
    const logs = [];
    const fetch = fakeFetch(() => ({}));
    const noop = createEmailSender({ env:{}, httpClient:fetch, logger:{ info:m => logs.push(m) } });
    const result = await noop.send({ to:'fan@example.com', subject:'Hi' });
    expect(result.unconfigured).to.equal(true);
    expect(fetch.calls).to.have.length(0);
    expect(logs[0]).to.include('f***@example.com');
    expect(logs[0]).to.not.include('fan@example.com');
    expect(maskEmail('bob@x.io')).to.equal('b***@x.io');
  });

  it('sends through Resend or SendGrid with the key from env (mocked HTTP)', async () => {
    const resendFetch = fakeFetch(() => ({ json:{ id:'em_1' } }));
    const resend = createEmailSender({ env:{ EMAIL_PROVIDER:'resend', RESEND_API_KEY:'re_fake', EMAIL_FROM:'DJ Battle <beats@djb.example>' }, httpClient:resendFetch });
    const sent = await resend.send({ to:'fan@example.com', subject:'Confirm', text:'t', html:'<p>h</p>' });
    expect(sent).to.deep.equal({ sent:true, id:'em_1' });
    expect(resendFetch.calls[0].url).to.equal('https://api.resend.com/emails');
    expect(resendFetch.calls[0].init.headers.Authorization).to.equal('Bearer re_fake');
    expect(JSON.parse(resendFetch.calls[0].body)).to.include({ from:'DJ Battle <beats@djb.example>', subject:'Confirm' });
    const sgFetch = fakeFetch(() => ({ status:202, headers:{ 'x-message-id':'sg_1' } }));
    const sg = createEmailSender({ env:{ EMAIL_PROVIDER:'sendgrid', SENDGRID_API_KEY:'sg_fake', EMAIL_FROM:'DJ Battle <beats@djb.example>' }, httpClient:sgFetch });
    expect(await sg.send({ to:'fan@example.com', subject:'Confirm' })).to.deep.equal({ sent:true, id:'sg_1' });
    const sgBody = JSON.parse(sgFetch.calls[0].body);
    expect(sgBody.personalizations[0].to[0].email).to.equal('fan@example.com');
    expect(sgBody.from).to.deep.equal({ email:'beats@djb.example', name:'DJ Battle' });
    const failing = createEmailSender({ env:{ RESEND_API_KEY:'re_fake', EMAIL_FROM:'beats@djb.example' }, httpClient:fakeFetch(() => ({ ok:false, status:401 })) });
    expect((await failing.send({ to:'fan@example.com' })).error).to.be.instanceOf(Error);
    expect((await resend.send({ to:'not-an-email' })).error).to.exist;
  });

  it('claim -> confirmation email with the verify link -> verify -> download token', async () => {
    const db = storeSeed({ marketplace_free_email_offers:[] });
    db.db.marketplace_listings[0].status = 'published';
    const file = { id:'free-mp3', type:'mp3', filename:'Neon Knock.mp3', mimeType:'audio/mpeg', storageBucket:'battle-mixes', storageObjectPath:'private/marketplace-downloads/seller-1/lst-1/free.mp3' };
    const offer = await createFreeEmailOffer(db, 'seller-1', { listingId:'lst-1', enabled:true, allowedFiles:[file], verificationRequired:true, downloadConsentRequired:true });
    expect(offer.offer.verificationRequired).to.equal(true);
    const fetch = fakeFetch(() => ({ json:{ id:'em_9' } }));
    const sender = createEmailSender({ env:{ RESEND_API_KEY:'re_fake', EMAIL_FROM:'beats@djb.example' }, httpClient:fetch });
    const gateway = createFreeEmailVerificationGateway(sender, { env:{ APP_PUBLIC_URL:'https://djb.example/' } });
    const adapter = createFreeEmailVerificationAdapter({ gateway });
    expect(adapter.configured).to.equal(true);
    const claim = await claimFreeEmailDownload(db, adapter, null, { listingId:'lst-1', email:'Fan@Example.com', downloadConsentAccepted:true }, new Date(), { rateLimit:false, exposeDownloadAccessToken:true });
    expect(claim.verificationRequired).to.equal(true);
    expect(claim.deliveryConfigured).to.equal(true);
    expect(claim.downloadAccessToken).to.equal(undefined, 'no download until confirmed');
    const mail = JSON.parse(fetch.calls[0].body);
    expect(mail.to).to.deep.equal(['fan@example.com']);
    const link = mail.text.match(/https:\/\/djb\.example\/\?beatConfirm=1&lead=([^&]+)&token=([^#\s]+)#store/);
    expect(link, 'email has the confirm link').to.exist;
    expect(mail.html).to.include('Confirm and download');
    const verified = await verifyFreeEmailLead(db, { leadId:decodeURIComponent(link[1]), verificationToken:decodeURIComponent(link[2]) }, new Date(), { exposeDownloadAccessToken:true });
    expect(verified.verified).to.equal(true);
    expect(verified.downloadAccessToken).to.be.a('string');
    expect(db.db.marketplace_free_email_leads[0].verification_status).to.equal('verified');
    const wrong = await verifyFreeEmailLead(db, { leadId:decodeURIComponent(link[1]), verificationToken:'nope' });
    expect(wrong.duplicate || wrong.forbidden).to.equal(true);
    expect(freeEmailConfirmLink('https://djb.example/app/?x=1#y', 'l1', 't 1')).to.equal('https://djb.example/app/?beatConfirm=1&lead=l1&token=t%201#store');
    expect(createFreeEmailVerificationGateway(sender, { env:{} })).to.equal(null, 'no app URL = no confirmation emails');
    expect(createFreeEmailVerificationGateway(createEmailSender({ env:{} }), { env:{ APP_PUBLIC_URL:'https://djb.example' } })).to.equal(null);
  });

  it('index.js uses the pluggable sender and returns the download token after verify', () => {
    expect(serverSource).to.match(/const emailSender = createEmailSender\(/);
    expect(serverSource).to.match(/createFreeEmailVerificationAdapter\(\{ gateway:createFreeEmailVerificationGateway\(emailSender/);
    expect(serverSource).to.match(/verifyFreeEmailLead\(supabaseService, req\.body \|\| \{\}, new Date\(\), \{ exposeDownloadAccessToken:true \}\)/);
    expect(serverSource).to.match(/verified:Boolean\(result\.verified\)[^\n]*downloadAccessToken:result\.downloadAccessToken/);
  });
});

describe('Rename / delete practice sessions (Oct 18 c)', () => {
  const seed = async () => {
    const db = dataClient({ practice_sessions:[] });
    await savePracticeSession(db, 'dj-1', { clientSessionId:'s1', title:'Test take', score:50, recordedAt:'2026-10-10T00:00:00Z' });
    await savePracticeSession(db, 'dj-2', { clientSessionId:'s1', title:'Other DJ', score:80, recordedAt:'2026-10-10T00:00:00Z' });
    return db;
  };
  it('renames only the owner\'s session', async () => {
    const db = await seed();
    const renamed = await renamePracticeSession(db, 'dj-1', 's1', { title:'  Friday set  ' });
    expect(renamed.session.title).to.equal('Friday set');
    expect(db.db.practice_sessions.find(r => r.user_id === 'dj-2').title).to.equal('Other DJ');
    expect((await renamePracticeSession(db, 'dj-1', 'missing', { title:'x' })).notFound).to.equal(true);
    expect((await renamePracticeSession(db, 'dj-1', 's1', { title:'   ' })).validationError).to.exist;
    expect((await renamePracticeSession(db, '', 's1', { title:'x' })).forbidden).to.equal(true);
    expect((await renamePracticeSession(db, 'dj-1', '../x', { title:'x' })).validationError).to.exist;
  });
  it('deletes only the owner\'s session', async () => {
    const db = await seed();
    expect((await deletePracticeSession(db, 'dj-3', 's1')).notFound).to.equal(true);
    const removed = await deletePracticeSession(db, 'dj-1', 's1');
    expect(removed).to.deep.equal({ deleted:true, id:'s1' });
    expect(db.db.practice_sessions.map(r => r.user_id)).to.deep.equal(['dj-2']);
    expect((await listPracticeSessions(db, 'dj-1')).sessions).to.have.length(0);
    expect((await deletePracticeSession(db, 'dj-1', 's1')).notFound).to.equal(true);
  });
  it('index.js has auth-only PATCH and DELETE routes', () => {
    expect(serverSource).to.match(/app\.patch\('\/api\/practiceSessions\/:sessionId', requireAuth/);
    expect(serverSource).to.match(/app\.delete\('\/api\/practiceSessions\/:sessionId', requireAuth/);
    expect(serverSource).to.match(/renamePracticeSession\(supabaseService, req\.authUser\.id, req\.params\.sessionId/);
    expect(serverSource).to.match(/deletePracticeSession\(supabaseService, req\.authUser\.id, req\.params\.sessionId\)/);
  });
});

describe('Fan list counts (Oct 18 c)', () => {
  it('myListings reports claims, downloads, confirmed/unconfirmed and opt-ins per beat plus totals', async () => {
    const db = storeSeed({ marketplace_free_email_leads:[
      { id:'a', seller_user_id:'seller-1', listing_id:'lst-1', email:'a@x.io', download_status:'downloaded', downloaded_at:'2026-10-11', verification_status:'verified', marketing_consent_status:'accepted' },
      { id:'b', seller_user_id:'seller-1', listing_id:'lst-1', email:'b@x.io', download_status:'available', verification_status:'not_required', marketing_consent_status:'declined' },
      { id:'c', seller_user_id:'seller-1', listing_id:'lst-2', email:'c@x.io', download_status:'locked', verification_status:'pending', marketing_consent_status:'accepted' },
      { id:'d', seller_user_id:'seller-9', listing_id:'lst-9', email:'d@x.io', download_status:'downloaded', verification_status:'verified', marketing_consent_status:'accepted' }
    ] });
    const result = await listSellerStoreListings(db, 'seller-1');
    const one = result.listings.find(l => l.id === 'lst-1');
    expect(one).to.include({ claimCount:2, downloadCount:1, confirmedCount:1, unconfirmedCount:1, optedInCount:1 });
    expect(result.listings.find(l => l.id === 'lst-2')).to.include({ claimCount:1, downloadCount:0, unconfirmedCount:1 });
    expect(result.totals).to.deep.equal({ claims:3, downloads:1, confirmed:1, unconfirmed:2, optedIn:2 });
    expect(serverSource).to.match(/totals:result\.totals \|\| null/);
  });
});
