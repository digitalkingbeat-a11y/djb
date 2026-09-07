const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const {
  MARKETPLACE_COMMERCE_SCHEMA,
  MARKETPLACE_ORDER_TABLE,
  MARKETPLACE_ORDER_ITEM_TABLE,
  MARKETPLACE_PAYMENT_EVENT_TABLE,
  MARKETPLACE_SELLER_ACCOUNT_TABLE,
  PAYMENT_STATUSES,
  PURCHASE_ENTITLEMENT_SOURCE,
  checkMarketplaceCommerceSchemaReadiness,
  createMarketplaceCheckout,
  createPayPalCommerceAdapter,
  createStripeConnectAdapter,
  handleMarketplacePaymentEvent,
  issueMarketplaceDownloadAccess,
  listMarketplaceSellerAccounts,
  listOwnedMarketplaceOrders,
  normalizePayPalEvent,
  normalizeStripeEvent,
  sellerAccountCanReceiveSales,
  upsertMarketplaceSellerAccount
} = require('../marketplace_commerce');
const {
  issueMarketplacePlayerAccess,
  listMarketplaceCatalog
} = require('../marketplace_foundation');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'sql', '023_create_marketplace_commerce_settlement.sql'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

function product(overrides = {}){
  return {
    id:'prod-1',
    creator_user_id:'seller-1',
    library_track_id:'track-1',
    product_type:'beat',
    title:'Neon Knock',
    description:'Club-ready beat.',
    audio_storage_bucket:'battle-mixes',
    audio_storage_object_path:'private/library-audio/seller-1/tracks/track-1/audio.webm',
    preview_storage_object_path:'private/marketplace-previews/seller-1/prod-1/preview.webm',
    artwork_storage_bucket:'battle-artwork',
    artwork_storage_object_path:'private/library-artwork/seller-1/tracks/track-1/artwork.png',
    bpm:128,
    key:'A minor',
    camelot_key:'8A',
    genre:'Bass House',
    duration:184,
    tags:['beat'],
    rights_classification:'original',
    status:'active',
    created_at:'2026-09-05T12:00:00.000Z',
    updated_at:'2026-09-05T12:00:00.000Z',
    ...overrides
  };
}

function rights(overrides = {}){
  return {
    id:'rights-1',
    product_id:'prod-1',
    rights_classification:'original',
    license_type:'battle_use',
    marketplace_streaming_allowed:true,
    preview_allowed:true,
    download_allowed:true,
    battle_use_allowed:true,
    commercial_use_allowed:false,
    attribution_required:false,
    territory:'worldwide',
    terms:{ credit:'Digital King' },
    status:'active',
    created_at:'2026-09-05T12:00:00.000Z',
    updated_at:'2026-09-05T12:00:00.000Z',
    ...overrides
  };
}

function listing(overrides = {}){
  return {
    id:'listing-1',
    product_id:'prod-1',
    seller_user_id:'seller-1',
    title:'Neon Knock',
    description:'Club-ready beat.',
    slug:'neon-knock',
    status:'published',
    preview_enabled:true,
    preview_duration:30,
    display_price_cents:2000,
    currency:'USD',
    commerce_status:'enabled',
    metadata:{ mood:'peak-time' },
    published_at:'2026-09-05T12:05:00.000Z',
    created_at:'2026-09-05T12:00:00.000Z',
    updated_at:'2026-09-05T12:05:00.000Z',
    ...overrides
  };
}

function sellerAccount(overrides = {}){
  return {
    id:'seller-acct-1',
    seller_user_id:'seller-1',
    provider:'stripe',
    provider_account_id:'acct_123',
    account_status:'connected',
    charges_enabled:true,
    payouts_enabled:true,
    requirements_due:[],
    created_at:'2026-09-05T12:00:00.000Z',
    updated_at:'2026-09-05T12:00:00.000Z',
    ...overrides
  };
}

function baseDb(overrides = {}){
  return dataClient({
    marketplace_products:[product()],
    marketplace_rights_policies:[rights()],
    marketplace_listings:[listing()],
    marketplace_seller_accounts:[sellerAccount()],
    ...overrides
  });
}

describe('marketplace checkout and settlement contract', () => {
  it('creates checkout from authoritative listing price and Stripe Connect seller account metadata', async () => {
    const db = baseDb();
    let providerPayload = null;
    const stripe = createStripeConnectAdapter({
      trustEvents:true,
      gateway:{
        async createCheckoutSession(payload){
          providerPayload = payload;
          return { id:'cs_test_1', url:'https://checkout.stripe.test/session/cs_test_1', status:'open' };
        }
      }
    });

    const result = await createMarketplaceCheckout(db, stripe, 'buyer-1', {
      orderId:'order-1',
      listingId:'listing-1',
      provider:'stripe',
      clientPriceCents:2000,
      buyerEmail:'buyer@example.com',
      idempotencyKey:'idem-1'
    }, new Date('2026-09-05T12:10:00Z'), { platformFeeBps:1000 });

    expect(result.checkoutCreated).to.equal(true);
    expect(result.order.grossAmountCents).to.equal(2000);
    expect(result.order.platformFeeCents).to.equal(200);
    expect(result.order.sellerAmountCents).to.equal(1800);
    expect(result.order.providerTransactionId).to.equal('cs_test_1');
    expect(result.order.paymentStatus).to.equal('pending');
    expect(result.item.allowedFiles).to.deep.equal([{ id:'master-audio', type:'audio', filename:'Neon Knock.webm', mimeType:'audio/webm', size:null }]);
    expect(providerPayload.stripeConnect.connectedAccountId).to.equal('acct_123');
    expect(providerPayload.stripeConnect.applicationFeeAmount).to.equal(200);
    expect(providerPayload.stripeConnect.destination).to.equal('acct_123');
    expect(providerPayload.metadata.orderId).to.equal('order-1');
    expect(JSON.stringify(result)).to.not.include('private/library-audio');
  });

  it('rejects client price tampering and unavailable providers before unlocking anything', async () => {
    const tampered = await createMarketplaceCheckout(baseDb(), createStripeConnectAdapter({ gateway:{ async createCheckoutSession(){ return { id:'cs' }; } } }), 'buyer-1', {
      listingId:'listing-1',
      provider:'stripe',
      clientPriceCents:99
    });
    expect(tampered.validationError).to.equal('Client price does not match authoritative listing price');

    const unconfiguredDb = baseDb();
    const unconfigured = await createMarketplaceCheckout(unconfiguredDb, createStripeConnectAdapter(), 'buyer-1', {
      listingId:'listing-1',
      provider:'stripe'
    });
    expect(unconfigured.providerUnavailable).to.equal(true);
    expect(unconfiguredDb.tables.marketplace_orders).to.have.length(0);
    expect(unconfiguredDb.tables.marketplace_entitlements).to.have.length(0);

    const licenseTampered = await createMarketplaceCheckout(baseDb(), createStripeConnectAdapter({ gateway:{ async createCheckoutSession(){ return { id:'cs' }; } } }), 'buyer-1', {
      listingId:'listing-1',
      provider:'stripe',
      licenseType:'exclusive_license'
    });
    expect(licenseTampered.validationError).to.equal('Client license does not match authoritative listing license');
  });

  it('requires eligible connected seller accounts and never fakes missing provider accounts', async () => {
    const missing = await createMarketplaceCheckout(baseDb({ marketplace_seller_accounts:[] }), createStripeConnectAdapter({ gateway:{ async createCheckoutSession(){ return { id:'cs' }; } } }), 'buyer-1', {
      listingId:'listing-1',
      provider:'stripe'
    });
    expect(missing.sellerUnavailable).to.equal(true);

    const restricted = sellerAccount({ account_status:'restricted', charges_enabled:true, payouts_enabled:true });
    expect(sellerAccountCanReceiveSales(restricted)).to.equal(false);
    const upserted = await upsertMarketplaceSellerAccount(dataClient({}), 'seller-1', {
      provider:'paypal',
      providerAccountId:'merchant-123',
      accountStatus:'connected',
      chargesEnabled:true,
      payoutsEnabled:false
    });
    expect(upserted.created).to.equal(true);
    expect(upserted.account.provider).to.equal('paypal');
    expect(upserted.account.eligibleForSales).to.equal(true);

    const listed = await listMarketplaceSellerAccounts(upsertedDbWithAccount(upserted.account), 'seller-1');
    expect(listed.accounts[0].providerAccountId).to.equal('merchant-123');
  });

  it('normalizes Stripe and PayPal provider events into the same internal states', () => {
    const paidStripe = normalizeStripeEvent({
      id:'evt-1',
      type:'checkout.session.completed',
      data:{ object:{ id:'cs_test_1', payment_intent:'pi_1', amount_total:2000, currency:'usd', metadata:{ orderId:'order-1' } } }
    });
    expect(paidStripe.paymentStatus).to.equal('paid');
    expect(paidStripe.orderId).to.equal('order-1');
    expect(paidStripe.amountCents).to.equal(2000);

    const failedStripe = normalizeStripeEvent({ id:'evt-2', type:'payment_intent.payment_failed', data:{ object:{ id:'pi_2', metadata:{ orderId:'order-1' } } } });
    const canceledStripe = normalizeStripeEvent({ id:'evt-3', type:'checkout.session.expired', data:{ object:{ id:'cs_2', metadata:{ orderId:'order-1' } } } });
    const refundedStripe = normalizeStripeEvent({ id:'evt-4', type:'charge.refunded', data:{ object:{ id:'ch_1', amount:2000, amount_refunded:1000, metadata:{ orderId:'order-1' } } } });
    const disputedStripe = normalizeStripeEvent({ id:'evt-5', type:'charge.dispute.created', data:{ object:{ id:'dp_1', metadata:{ orderId:'order-1' } } } });
    expect(failedStripe.paymentStatus).to.equal('failed');
    expect(canceledStripe.paymentStatus).to.equal('canceled');
    expect(refundedStripe.paymentStatus).to.equal('partially_refunded');
    expect(refundedStripe.refundState).to.equal('partial');
    expect(disputedStripe.paymentStatus).to.equal('disputed');

    const paidPayPal = normalizePayPalEvent({
      id:'WH-1',
      event_type:'PAYMENT.CAPTURE.COMPLETED',
      resource:{ id:'CAP-1', custom_id:'order-1', amount:{ value:'20.00', currency_code:'USD' } }
    });
    const canceledPayPal = normalizePayPalEvent({ id:'WH-2', event_type:'CHECKOUT.ORDER.CANCELLED', resource:{ id:'ORDER-2', custom_id:'order-1' } });
    expect(paidPayPal.paymentStatus).to.equal('paid');
    expect(paidPayPal.amountCents).to.equal(2000);
    expect(canceledPayPal.paymentStatus).to.equal('canceled');
  });

  it('creates purchase entitlements only after trusted server-side paid settlement and dedupes events', async () => {
    const db = baseDb();
    const stripe = stripeFixtureAdapter();
    const checkout = await createMarketplaceCheckout(db, stripe, 'buyer-1', {
      orderId:'order-1',
      listingId:'listing-1',
      provider:'stripe'
    }, new Date('2026-09-05T12:10:00Z'), { platformFeeBps:1000 });
    expect(checkout.order.paymentStatus).to.equal('pending');
    expect(db.tables.marketplace_entitlements).to.have.length(0);

    const settled = await handleMarketplacePaymentEvent(db, stripe, stripeEvent('evt-paid-1', 'checkout.session.completed', 'order-1'), new Date('2026-09-05T12:12:00Z'));
    expect(settled.settled).to.equal(true);
    expect(settled.order.paymentStatus).to.equal('paid');
    expect(settled.entitlementCreated).to.equal(true);
    expect(settled.entitlement.productId).to.equal('prod-1');
    expect(db.tables.marketplace_entitlements).to.have.length(1);
    expect(db.tables.marketplace_entitlements[0].source).to.equal(PURCHASE_ENTITLEMENT_SOURCE);
    expect(db.tables.marketplace_entitlements[0].originating_order_id).to.equal('order-1');
    expect(db.tables.marketplace_entitlements[0].license_type).to.equal('battle_use');
    expect(db.tables.marketplace_entitlements[0].allowed_files[0].storageObjectPath).to.equal('private/library-audio/seller-1/tracks/track-1/audio.webm');

    const duplicate = await handleMarketplacePaymentEvent(db, stripe, stripeEvent('evt-paid-1', 'checkout.session.completed', 'order-1'), new Date('2026-09-05T12:13:00Z'));
    expect(duplicate.duplicate).to.equal(true);
    expect(db.tables.marketplace_entitlements).to.have.length(1);
    expect(db.tables.marketplace_payment_events).to.have.length(1);
  });

  it('does not create entitlements for failed or canceled payment settlement', async () => {
    const failedDb = baseDb();
    const stripe = stripeFixtureAdapter();
    await createMarketplaceCheckout(failedDb, stripe, 'buyer-1', { orderId:'order-failed', listingId:'listing-1', provider:'stripe' });
    const failed = await handleMarketplacePaymentEvent(failedDb, stripe, stripeEvent('evt-failed-1', 'payment_intent.payment_failed', 'order-failed'));
    expect(failed.order.paymentStatus).to.equal('failed');
    expect(failedDb.tables.marketplace_entitlements).to.have.length(0);

    const canceledDb = baseDb();
    await createMarketplaceCheckout(canceledDb, stripe, 'buyer-1', { orderId:'order-canceled', listingId:'listing-1', provider:'stripe' });
    const canceled = await handleMarketplacePaymentEvent(canceledDb, stripe, stripeEvent('evt-canceled-1', 'checkout.session.expired', 'order-canceled'));
    expect(canceled.order.paymentStatus).to.equal('canceled');
    expect(canceledDb.tables.marketplace_entitlements).to.have.length(0);
  });

  it('restricts purchase entitlements after refunded or disputed settlement states', async () => {
    const db = baseDb();
    const stripe = stripeFixtureAdapter();
    await createMarketplaceCheckout(db, stripe, 'buyer-1', { orderId:'order-refund', listingId:'listing-1', provider:'stripe' });
    await handleMarketplacePaymentEvent(db, stripe, stripeEvent('evt-paid-refund', 'checkout.session.completed', 'order-refund'));
    expect(db.tables.marketplace_entitlements[0].status).to.equal('active');

    const refund = await handleMarketplacePaymentEvent(db, stripe, stripeEvent('evt-refund-1', 'charge.refunded', 'order-refund', { amount:2000, amount_refunded:2000 }));
    expect(refund.order.paymentStatus).to.equal('refunded');
    expect(refund.order.refundState).to.equal('full');
    expect(db.tables.marketplace_entitlements[0].status).to.equal('revoked');
  });

  it('keeps private paid media inaccessible without entitlement and signs only permitted files after settlement', async () => {
    const db = baseDb();
    const stripe = stripeFixtureAdapter();
    const denied = await issueMarketplaceDownloadAccess(db, storageClient(), 'buyer-1', { productId:'prod-1' });
    expect(denied.unavailable).to.equal(true);

    await createMarketplaceCheckout(db, stripe, 'buyer-1', { orderId:'order-download', listingId:'listing-1', provider:'stripe' });
    await handleMarketplacePaymentEvent(db, stripe, stripeEvent('evt-paid-download', 'checkout.session.completed', 'order-download'), new Date('2026-09-05T12:30:00Z'));

    const storage = storageClient();
    const access = await issueMarketplaceDownloadAccess(db, storage, 'buyer-1', { orderId:'order-download', fileId:'master-audio' }, new Date('2026-09-05T12:31:00Z'));
    expect(access.downloadAccess.file.id).to.equal('master-audio');
    expect(access.downloadAccess.expiresAt).to.equal('2026-09-05T12:36:00.000Z');
    expect(access.downloadAccess.session.accessScope).to.equal('entitled_download');
    expect(storage.signed[0].objectPath).to.equal('private/library-audio/seller-1/tracks/track-1/audio.webm');
    expect(JSON.stringify(access)).to.not.include('storageObjectPath');
    expect(JSON.stringify(access)).to.not.include('private/library-audio');

    const foreign = await issueMarketplaceDownloadAccess(db, storageClient(), 'buyer-2', { orderId:'order-download' });
    expect(foreign.unavailable).to.equal(true);
  });

  it('leaves existing catalog and player preview behavior intact', async () => {
    const db = baseDb();
    const catalog = await listMarketplaceCatalog(db, { limit:10 });
    expect(catalog.listings[0].id).to.equal('listing-1');
    expect(catalog.listings[0].previewEnabled).to.equal(true);

    const preview = await issueMarketplacePlayerAccess(db, storageClient(), 'listener-1', { listingId:'listing-1', preview:true }, new Date('2026-09-05T12:40:00Z'));
    expect(preview.playerAccess.accessScope).to.equal('preview');
    expect(JSON.stringify(preview)).to.not.include('private/marketplace-previews');
  });

  it('reports commerce schema readiness and exposes only bounded commerce routes', async () => {
    const ready = await checkMarketplaceCommerceSchemaReadiness(dataClient({}));
    expect(ready.ready).to.equal(true);
    expect(ready.schema).to.equal(MARKETPLACE_COMMERCE_SCHEMA);

    expect(PAYMENT_STATUSES).to.deep.equal(['pending', 'processing', 'paid', 'failed', 'canceled', 'refunded', 'partially_refunded', 'disputed']);
    expect(sql).to.include('CREATE TABLE IF NOT EXISTS public.marketplace_seller_accounts');
    expect(sql).to.include('CREATE TABLE IF NOT EXISTS public.marketplace_orders');
    expect(sql).to.include('CREATE TABLE IF NOT EXISTS public.marketplace_order_items');
    expect(sql).to.include('CREATE TABLE IF NOT EXISTS public.marketplace_payment_events');
    expect(sql).to.include("provider text NOT NULL CHECK (provider IN ('stripe', 'paypal'))");
    expect(sql).to.include("payment_status IN ('pending', 'processing', 'paid', 'failed', 'canceled', 'refunded', 'partially_refunded', 'disputed')");
    expect(sql).to.include('purchase_settlement');
    expect(sql).to.include('entitled_download');
    expect(sql).to.include('provider_account_id');
    expect(sql).to.not.match(/mark.*paid.*redirect|client.*success/i);

    expect(serverSource).to.include("app.post('/api/marketplace/checkout', requireAuth");
    expect(serverSource).to.include("app.post('/api/marketplace/webhooks/:provider'");
    expect(serverSource).to.include("app.post('/api/marketplace/downloads/access', requireAuth");
    expect(serverSource).to.include("app.get('/api/marketplace/orders', requireAuth");
    expect(serverSource).to.include("app.get('/api/marketplace/sellerAccounts/status', requireAuth");
    expect(serverSource).to.include("app.post('/api/marketplace/sellerAccounts', requireAuth, requireOperatorUser");
    expect(MARKETPLACE_SELLER_ACCOUNT_TABLE).to.equal('marketplace_seller_accounts');
    expect(MARKETPLACE_ORDER_TABLE).to.equal('marketplace_orders');
    expect(MARKETPLACE_ORDER_ITEM_TABLE).to.equal('marketplace_order_items');
    expect(MARKETPLACE_PAYMENT_EVENT_TABLE).to.equal('marketplace_payment_events');
  });
});

function stripeFixtureAdapter(){
  return createStripeConnectAdapter({
    trustEvents:true,
    gateway:{
      async createCheckoutSession(payload){
        return { id:'cs_for_' + payload.orderId, url:`https://checkout.stripe.test/session/${payload.orderId}`, status:'open' };
      }
    }
  });
}

function stripeEvent(id, type, orderId, overrides = {}){
  return {
    id,
    trusted:true,
    type,
    data:{
      object:{
        id:type.includes('checkout') ? 'cs_for_' + orderId : 'pi_for_' + orderId,
        payment_intent:'pi_for_' + orderId,
        amount_total:overrides.amount || 2000,
        amount:overrides.amount || 2000,
        amount_refunded:overrides.amount_refunded || 0,
        currency:'usd',
        metadata:{ orderId }
      }
    }
  };
}

function upsertedDbWithAccount(account){
  return dataClient({
    marketplace_seller_accounts:[{
      id:account.id,
      seller_user_id:account.sellerUserId,
      provider:account.provider,
      provider_account_id:account.providerAccountId,
      account_status:account.accountStatus,
      charges_enabled:account.chargesEnabled,
      payouts_enabled:account.payoutsEnabled,
      requirements_due:account.requirementsDue,
      created_at:account.createdAt,
      updated_at:account.updatedAt
    }]
  });
}

function dataClient(initial = {}){
  const tables = {
    marketplace_products:(initial.marketplace_products || []).map(clone),
    marketplace_rights_policies:(initial.marketplace_rights_policies || []).map(clone),
    marketplace_listings:(initial.marketplace_listings || []).map(clone),
    marketplace_entitlements:(initial.marketplace_entitlements || []).map(clone),
    marketplace_player_sessions:(initial.marketplace_player_sessions || []).map(clone),
    marketplace_seller_accounts:(initial.marketplace_seller_accounts || []).map(clone),
    marketplace_orders:(initial.marketplace_orders || []).map(clone),
    marketplace_order_items:(initial.marketplace_order_items || []).map(clone),
    marketplace_payment_events:(initial.marketplace_payment_events || []).map(clone)
  };
  return {
    tables,
    from(table){ return new Query(tables, table); }
  };
}

class Query{
  constructor(tables, table){
    this.tables = tables;
    this.table = table;
    this.filters = [];
    this.limitValue = null;
    this.insertRows = null;
    this.updateValues = null;
  }
  select(){ return this; }
  eq(field, value){ this.filters.push([field, value]); return this; }
  limit(value){ this.limitValue = Number(value); return this; }
  insert(rows){ this.insertRows = rows.map(clone); return this; }
  update(values){ this.updateValues = clone(values); return this; }
  then(resolve, reject){ return this.execute().then(resolve, reject); }
  async single(){
    const result = await this.execute();
    if(result.error) return result;
    return { data:Array.isArray(result.data) ? result.data[0] : result.data, error:null };
  }
  async execute(){
    const rows = this.tables[this.table];
    if(!rows) return { data:null, error:new Error(`Unknown table ${this.table}`) };
    if(this.insertRows){
      this.insertRows.forEach(row => rows.push(clone(row)));
      return { data:this.insertRows.map(clone), error:null };
    }
    const matched = rows.filter(row => this.filters.every(([field, value]) => String(row[field]) === String(value)));
    if(this.updateValues){
      matched.forEach(row => Object.assign(row, clone(this.updateValues)));
      return { data:matched.map(clone), error:null };
    }
    const limited = this.limitValue ? matched.slice(0, this.limitValue) : matched;
    return { data:limited.map(clone), error:null };
  }
}

function storageClient(){
  return {
    signed:[],
    async createSignedUrl(objectPath, expiresIn){
      this.signed.push({ objectPath, expiresIn });
      return { data:{ signedUrl:`https://signed.local/${encodeURIComponent(objectPath)}` }, error:null };
    }
  };
}

function clone(value){
  return JSON.parse(JSON.stringify(value));
}
