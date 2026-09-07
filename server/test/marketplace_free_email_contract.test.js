const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const {
  MARKETPLACE_FREE_EMAIL_SCHEMA,
  MARKETPLACE_FREE_EMAIL_OFFER_TABLE,
  MARKETPLACE_FREE_EMAIL_LEAD_TABLE,
  FREE_EMAIL_ENTITLEMENT_SOURCE,
  checkMarketplaceFreeEmailSchemaReadiness,
  claimFreeEmailDownload,
  createFreeEmailOffer,
  createFreeEmailVerificationAdapter,
  emailPrincipalFor,
  issueFreeEmailLeadDownloadAccess,
  listSellerFreeEmailLeads,
  verifyFreeEmailLead
} = require('../marketplace_free_email');
const {
  PURCHASE_ENTITLEMENT_SOURCE,
  createMarketplaceCheckout,
  createStripeConnectAdapter,
  handleMarketplacePaymentEvent,
  issueMarketplaceDownloadAccess
} = require('../marketplace_commerce');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'sql', '024_create_marketplace_free_email_leads.sql'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const now = new Date('2026-09-05T14:00:00Z');

function product(overrides = {}){
  return {
    id:'prod-1',
    creator_user_id:'seller-1',
    library_track_id:'track-1',
    product_type:'beat',
    title:'Neon Knock',
    description:'Club-ready beat.',
    audio_storage_bucket:'battle-mixes',
    audio_storage_object_path:'private/library-audio/seller-1/tracks/track-1/master.wav',
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

function freeMp3(overrides = {}){
  return {
    id:'free-mp3',
    type:'mp3',
    filename:'Neon Knock Free.mp3',
    mimeType:'audio/mpeg',
    storageBucket:'battle-mixes',
    storageObjectPath:'private/marketplace-downloads/seller-1/prod-1/free.mp3',
    size:12345,
    ...overrides
  };
}

function freeOffer(overrides = {}){
  return {
    id:'offer-1',
    seller_user_id:'seller-1',
    product_id:'prod-1',
    listing_id:'listing-1',
    status:'active',
    free_email_enabled:true,
    verification_required:false,
    download_consent_required:true,
    marketing_consent_required:false,
    consent_text:'I agree to share my email to receive this free download.',
    consent_version:'lead-v1',
    allowed_files:[freeMp3()],
    download_limit:1,
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
    marketplace_entitlements:[],
    marketplace_player_sessions:[],
    marketplace_seller_accounts:[sellerAccount()],
    marketplace_orders:[],
    marketplace_order_items:[],
    marketplace_payment_events:[],
    marketplace_free_email_offers:[freeOffer()],
    marketplace_free_email_leads:[],
    ...overrides
  });
}

describe('marketplace free-email lead capture contract', () => {
  it('creates only seller-owned free-email offers with explicit free MP3 files', async () => {
    const db = baseDb({ marketplace_free_email_offers:[] });
    const created = await createFreeEmailOffer(db, 'seller-1', {
      listingId:'listing-1',
      consentText:'Download consent v2',
      consentVersion:'lead-v2',
      verificationRequired:true,
      allowedFiles:[freeMp3()]
    }, now);

    expect(created.created).to.equal(true);
    expect(created.offer.consentVersion).to.equal('lead-v2');
    expect(created.offer.verificationRequired).to.equal(true);
    expect(created.offer.allowedFiles).to.deep.equal([{ id:'free-mp3', type:'mp3', filename:'Neon Knock Free.mp3', mimeType:'audio/mpeg', size:12345 }]);
    expect(db.tables.marketplace_free_email_offers[0].allowed_files[0].storageObjectPath).to.equal('private/marketplace-downloads/seller-1/prod-1/free.mp3');
    expect(JSON.stringify(created.offer)).to.not.include('private/marketplace-downloads');

    const foreign = await createFreeEmailOffer(db, 'seller-2', { listingId:'listing-1', allowedFiles:[freeMp3()] }, now);
    expect(foreign.forbidden).to.equal(true);

    const paidClass = await createFreeEmailOffer(baseDb({ marketplace_free_email_offers:[] }), 'seller-1', {
      listingId:'listing-1',
      allowedFiles:[freeMp3({ id:'paid-wav', type:'wav', filename:'Neon Knock.wav', mimeType:'audio/wav', storageObjectPath:'private/marketplace-downloads/seller-1/prod-1/master.wav' })]
    }, now);
    expect(paidClass.validationError).to.match(/Free-email offers/);
  });

  it('requires explicit eligibility, valid email, server-owned files and download consent', async () => {
    const absent = await claimFreeEmailDownload(baseDb({ marketplace_free_email_offers:[] }), createFreeEmailVerificationAdapter(), null, {
      listingId:'listing-1',
      email:'fan@example.com',
      downloadConsentAccepted:true
    }, now, { rateLimit:false });
    expect(absent.unavailable).to.equal(true);

    const invalidEmail = await claimFreeEmailDownload(baseDb(), createFreeEmailVerificationAdapter(), null, {
      listingId:'listing-1',
      email:'not an email',
      downloadConsentAccepted:true
    }, now, { rateLimit:false });
    expect(invalidEmail.validationError).to.match(/valid email/);

    const clientFiles = await claimFreeEmailDownload(baseDb(), createFreeEmailVerificationAdapter(), null, {
      listingId:'listing-1',
      email:'fan@example.com',
      downloadConsentAccepted:true,
      allowedFiles:[freeMp3()]
    }, now, { rateLimit:false });
    expect(clientFiles.validationError).to.match(/Client-provided/);

    const missingConsent = await claimFreeEmailDownload(baseDb(), createFreeEmailVerificationAdapter(), null, {
      listingId:'listing-1',
      email:'fan@example.com'
    }, now, { rateLimit:false });
    expect(missingConsent.validationError).to.match(/Download consent/);
  });

  it('records lead consent separately and grants a free_email entitlement without commerce records', async () => {
    const db = baseDb();
    const result = await claimFreeEmailDownload(db, createFreeEmailVerificationAdapter(), null, {
      listingId:'listing-1',
      email:'FAN@Example.COM',
      downloadConsentAccepted:true,
      marketingConsentAccepted:false,
      source:'embedded-player',
      campaign:'summer-leads',
      referrer:'https://artist.example/drop'
    }, now, { rateLimit:false, exposeDownloadAccessToken:true });

    expect(result.claimed).to.equal(true);
    expect(result.verificationRequired).to.equal(false);
    expect(result.lead.email).to.equal('fan@example.com');
    expect(result.lead.userId).to.equal(null);
    expect(result.lead.downloadConsentStatus).to.equal('accepted');
    expect(result.lead.marketingConsentStatus).to.equal('declined');
    expect(result.lead.source).to.equal('embedded-player');
    expect(result.downloadAccessToken).to.be.a('string');

    const rawLead = db.tables.marketplace_free_email_leads[0];
    expect(rawLead.user_id).to.equal(null);
    expect(rawLead.consent_text_snapshot).to.equal('I agree to share my email to receive this free download.');
    expect(rawLead.consent_version).to.equal('lead-v1');
    expect(rawLead.verification_status).to.equal('not_required');
    expect(rawLead.download_status).to.equal('available');

    const entitlement = db.tables.marketplace_entitlements[0];
    expect(entitlement.source).to.equal(FREE_EMAIL_ENTITLEMENT_SOURCE);
    expect(entitlement.entitlement_type).to.equal('download');
    expect(entitlement.license_type).to.equal('free_email');
    expect(entitlement.user_id).to.equal(emailPrincipalFor('fan@example.com'));
    expect(entitlement.buyer_email).to.equal('fan@example.com');
    expect(entitlement.originating_order_id).to.equal(null);
    expect(entitlement.originating_lead_id).to.equal(rawLead.id);
    expect(entitlement.allowed_files).to.deep.equal([freeMp3()]);
    expect(JSON.stringify(result)).to.not.include('private/marketplace-downloads');

    expect(db.tables.marketplace_orders).to.have.length(0);
    expect(db.tables.marketplace_order_items).to.have.length(0);
    expect(db.tables.marketplace_payment_events).to.have.length(0);
  });

  it('reuses entitlement allowed_files and the signed private download path while isolating paid files', async () => {
    const db = baseDb();
    const claim = await claimFreeEmailDownload(db, createFreeEmailVerificationAdapter(), null, {
      listingId:'listing-1',
      email:'fan@example.com',
      downloadConsentAccepted:true
    }, now, { rateLimit:false, exposeDownloadAccessToken:true });
    const storage = storageClient();

    const paidDenied = await issueFreeEmailLeadDownloadAccess(db, storage, {
      leadId:claim.lead.id,
      downloadAccessToken:claim.downloadAccessToken,
      fileId:'paid-wav'
    }, new Date('2026-09-05T14:01:00Z'));
    expect(paidDenied.unavailable).to.equal(true);
    expect(storage.signed).to.have.length(0);

    const access = await issueFreeEmailLeadDownloadAccess(db, storage, {
      leadId:claim.lead.id,
      downloadAccessToken:claim.downloadAccessToken,
      fileId:'free-mp3',
      downloadSessionId:'free-session-1'
    }, new Date('2026-09-05T14:02:00Z'));
    expect(access.downloadAccess.file.id).to.equal('free-mp3');
    expect(access.downloadAccess.expiresAt).to.equal('2026-09-05T14:07:00.000Z');
    expect(access.downloadAccess.session.accessScope).to.equal('entitled_download');
    expect(storage.signed[0].objectPath).to.equal('private/marketplace-downloads/seller-1/prod-1/free.mp3');
    expect(JSON.stringify(access)).to.not.include('storageObjectPath');
    expect(JSON.stringify(access)).to.not.include('private/marketplace-downloads');
    expect(db.tables.marketplace_player_sessions[0].access_scope).to.equal('entitled_download');
    expect(db.tables.marketplace_free_email_leads[0].download_status).to.equal('downloaded');
  });

  it('holds verification-required claims pending and does not fake email delivery when unconfigured', async () => {
    const db = baseDb({ marketplace_free_email_offers:[freeOffer({ verification_required:true })] });
    const result = await claimFreeEmailDownload(db, createFreeEmailVerificationAdapter(), null, {
      listingId:'listing-1',
      email:'fan@example.com',
      downloadConsentAccepted:true
    }, now, { rateLimit:false, exposeVerificationToken:true });

    expect(result.verificationRequired).to.equal(true);
    expect(result.deliveryConfigured).to.equal(false);
    expect(result.deliveryStatus).to.equal('unconfigured');
    expect(result.verificationToken).to.be.a('string');
    expect(db.tables.marketplace_free_email_leads[0].verification_status).to.equal('pending');
    expect(db.tables.marketplace_free_email_leads[0].verification_delivery_status).to.equal('unconfigured');
    expect(db.tables.marketplace_entitlements).to.have.length(0);
    expect(db.tables.marketplace_orders).to.have.length(0);
    expect(db.tables.marketplace_payment_events).to.have.length(0);
  });

  it('uses deterministic adapter delivery for pending to verified to entitlement lifecycle', async () => {
    const db = baseDb({ marketplace_free_email_offers:[freeOffer({ verification_required:true })] });
    const deliveries = [];
    const adapter = createFreeEmailVerificationAdapter({
      gateway:{
        async sendVerificationEmail(lead, verification){
          deliveries.push({ lead, verification });
          return { deliveryId:'msg-1' };
        }
      }
    });
    const claim = await claimFreeEmailDownload(db, adapter, 'user-1', {
      listingId:'listing-1',
      email:'fan@example.com',
      downloadConsentAccepted:true,
      marketingConsentAccepted:true
    }, now, { rateLimit:false, exposeVerificationToken:true });

    expect(claim.verificationRequired).to.equal(true);
    expect(claim.deliveryConfigured).to.equal(true);
    expect(claim.deliveryStatus).to.equal('sent');
    expect(deliveries[0].lead.email).to.equal('fan@example.com');
    expect(deliveries[0].verification.token).to.equal(claim.verificationToken);
    expect(db.tables.marketplace_entitlements).to.have.length(0);

    const invalid = await verifyFreeEmailLead(db, { leadId:claim.lead.id, verificationToken:'wrong-token' }, now);
    expect(invalid.forbidden).to.equal(true);

    const verified = await verifyFreeEmailLead(db, { leadId:claim.lead.id, verificationToken:claim.verificationToken }, new Date('2026-09-05T14:04:00Z'), { exposeDownloadAccessToken:true });
    expect(verified.verified).to.equal(true);
    expect(verified.lead.verificationStatus).to.equal('verified');
    expect(verified.lead.marketingConsentStatus).to.equal('accepted');
    expect(verified.entitlement.source).to.equal(FREE_EMAIL_ENTITLEMENT_SOURCE);
    expect(verified.downloadAccessToken).to.be.a('string');
    expect(db.tables.marketplace_entitlements).to.have.length(1);
    expect(db.tables.marketplace_entitlements[0].user_id).to.equal('user-1');
    expect(db.tables.marketplace_entitlements[0].buyer_email).to.equal('fan@example.com');

    const duplicateVerify = await verifyFreeEmailLead(db, { leadId:claim.lead.id, verificationToken:claim.verificationToken }, now);
    expect(duplicateVerify.duplicate).to.equal(true);
    expect(db.tables.marketplace_entitlements).to.have.length(1);
  });

  it('handles duplicate claims idempotently without duplicating leads or entitlements', async () => {
    const db = baseDb();
    const first = await claimFreeEmailDownload(db, createFreeEmailVerificationAdapter(), null, {
      listingId:'listing-1',
      email:'Fan@Example.com',
      downloadConsentAccepted:true
    }, now, { rateLimit:false });
    const second = await claimFreeEmailDownload(db, createFreeEmailVerificationAdapter(), null, {
      listingId:'listing-1',
      email:'fan@example.com',
      downloadConsentAccepted:true
    }, now, { rateLimit:false });

    expect(first.claimed).to.equal(true);
    expect(second.duplicate).to.equal(true);
    expect(second.lead.id).to.equal(first.lead.id);
    expect(db.tables.marketplace_free_email_leads).to.have.length(1);
    expect(db.tables.marketplace_entitlements).to.have.length(1);
  });

  it('rate limits repeated claim attempts before creating extra lead records', async () => {
    const db = baseDb();
    const state = new Map();
    const first = await claimFreeEmailDownload(db, createFreeEmailVerificationAdapter(), null, {
      listingId:'listing-1',
      email:'one@example.com',
      downloadConsentAccepted:true,
      requesterKey:'198.51.100.10'
    }, now, { rateLimit:{ max:1, windowMs:60000, state } });
    const second = await claimFreeEmailDownload(db, createFreeEmailVerificationAdapter(), null, {
      listingId:'listing-1',
      email:'two@example.com',
      downloadConsentAccepted:true,
      requesterKey:'198.51.100.10'
    }, now, { rateLimit:{ max:1, windowMs:60000, state } });

    expect(first.claimed).to.equal(true);
    expect(second.rateLimited).to.equal(true);
    expect(db.tables.marketplace_free_email_leads).to.have.length(1);
    expect(db.tables.marketplace_entitlements).to.have.length(1);
  });

  it('limits seller lead retrieval to leads generated by that seller products only', async () => {
    const db = baseDb({
      marketplace_products:[
        product(),
        product({ id:'prod-2', creator_user_id:'seller-2', library_track_id:'track-2', title:'Southside Sparks', audio_storage_object_path:'private/library-audio/seller-2/tracks/track-2/master.wav' })
      ],
      marketplace_rights_policies:[
        rights(),
        rights({ id:'rights-2', product_id:'prod-2' })
      ],
      marketplace_listings:[
        listing(),
        listing({ id:'listing-2', product_id:'prod-2', seller_user_id:'seller-2', slug:'southside-sparks', title:'Southside Sparks' })
      ],
      marketplace_seller_accounts:[
        sellerAccount(),
        sellerAccount({ id:'seller-acct-2', seller_user_id:'seller-2', provider_account_id:'acct_456' })
      ],
      marketplace_free_email_offers:[
        freeOffer(),
        freeOffer({
          id:'offer-2',
          seller_user_id:'seller-2',
          product_id:'prod-2',
          listing_id:'listing-2',
          allowed_files:[freeMp3({ id:'free-mp3-2', storageObjectPath:'private/marketplace-downloads/seller-2/prod-2/free.mp3' })]
        })
      ]
    });

    await claimFreeEmailDownload(db, createFreeEmailVerificationAdapter(), null, {
      listingId:'listing-1',
      email:'seller-one-lead@example.com',
      downloadConsentAccepted:true
    }, now, { rateLimit:false });
    await claimFreeEmailDownload(db, createFreeEmailVerificationAdapter(), null, {
      listingId:'listing-2',
      email:'seller-two-lead@example.com',
      downloadConsentAccepted:true
    }, now, { rateLimit:false });

    const sellerOne = await listSellerFreeEmailLeads(db, 'seller-1');
    const sellerTwo = await listSellerFreeEmailLeads(db, 'seller-2');
    const sellerOneListingTwo = await listSellerFreeEmailLeads(db, 'seller-1', { listingId:'listing-2' });

    expect(sellerOne.leads.map(lead => lead.email)).to.deep.equal(['seller-one-lead@example.com']);
    expect(sellerTwo.leads.map(lead => lead.email)).to.deep.equal(['seller-two-lead@example.com']);
    expect(sellerOneListingTwo.leads).to.deep.equal([]);
  });

  it('preserves existing paid checkout settlement and download behavior beside free-email entitlements', async () => {
    const db = baseDb();
    const stripe = createStripeConnectAdapter({
      trustEvents:true,
      gateway:{
        async createCheckoutSession(payload){
          return { id:`cs_for_${payload.orderId}`, url:`https://checkout.stripe.test/session/${payload.orderId}`, status:'open' };
        }
      }
    });

    const checkout = await createMarketplaceCheckout(db, stripe, 'buyer-1', {
      orderId:'order-paid-1',
      listingId:'listing-1',
      provider:'stripe',
      clientPriceCents:2000,
      buyerEmail:'buyer@example.com',
      idempotencyKey:'paid-1'
    }, now, { platformFeeBps:1000 });
    expect(checkout.checkoutCreated).to.equal(true);
    expect(db.tables.marketplace_orders).to.have.length(1);
    expect(db.tables.marketplace_order_items).to.have.length(1);

    await handleMarketplacePaymentEvent(db, stripe, stripeEvent('evt-paid-1', 'checkout.session.completed', 'order-paid-1'), new Date('2026-09-05T14:05:00Z'));
    const purchase = db.tables.marketplace_entitlements.find(row => row.source === PURCHASE_ENTITLEMENT_SOURCE);
    expect(purchase.originating_order_id).to.equal('order-paid-1');
    expect(purchase.allowed_files[0].storageObjectPath).to.equal('private/library-audio/seller-1/tracks/track-1/master.wav');

    const access = await issueMarketplaceDownloadAccess(db, storageClient(), 'buyer-1', { orderId:'order-paid-1', fileId:'master-audio' }, new Date('2026-09-05T14:06:00Z'));
    expect(access.downloadAccess.file.id).to.equal('master-audio');

    await claimFreeEmailDownload(db, createFreeEmailVerificationAdapter(), null, {
      listingId:'listing-1',
      email:'free-lead@example.com',
      downloadConsentAccepted:true
    }, now, { rateLimit:false });
    expect(db.tables.marketplace_orders).to.have.length(1);
    expect(db.tables.marketplace_order_items).to.have.length(1);
    expect(db.tables.marketplace_payment_events).to.have.length(1);
    expect(db.tables.marketplace_entitlements.filter(row => row.source === FREE_EMAIL_ENTITLEMENT_SOURCE)).to.have.length(1);
  });

  it('reports schema readiness and exposes bounded routes without adding commerce settlement paths', async () => {
    const ready = await checkMarketplaceFreeEmailSchemaReadiness(baseDb());
    expect(ready.ready).to.equal(true);
    expect(ready.schema).to.equal(MARKETPLACE_FREE_EMAIL_SCHEMA);
    expect(MARKETPLACE_FREE_EMAIL_OFFER_TABLE).to.equal('marketplace_free_email_offers');
    expect(MARKETPLACE_FREE_EMAIL_LEAD_TABLE).to.equal('marketplace_free_email_leads');

    expect(sql).to.include('CREATE TABLE IF NOT EXISTS public.marketplace_free_email_offers');
    expect(sql).to.include('CREATE TABLE IF NOT EXISTS public.marketplace_free_email_leads');
    expect(sql).to.include('marketplace_entitlements');
    expect(sql).to.include('free_email');
    expect(sql).to.include('originating_lead_id');
    expect(sql).to.include('download_consent_status');
    expect(sql).to.include('marketing_consent_status');
    expect(sql).to.include('seller_user_id = auth.uid()::text');
    expect(sql).to.not.include('CREATE TABLE IF NOT EXISTS public.marketplace_orders');
    expect(sql).to.not.include('CREATE TABLE IF NOT EXISTS public.marketplace_payment_events');

    expect(serverSource).to.include("app.post('/api/marketplace/freeEmail/offers', requireAuth");
    expect(serverSource).to.include("app.post('/api/marketplace/freeEmail/claims'");
    expect(serverSource).to.include("app.post('/api/marketplace/freeEmail/verify'");
    expect(serverSource).to.include("app.post('/api/marketplace/freeEmail/downloads/access'");
    expect(serverSource).to.include("app.get('/api/marketplace/freeEmail/leads', requireAuth");
    expect(serverSource).to.include("app.post('/api/marketplace/downloads/access', requireAuth");
    expect(serverSource).to.include('issueFreeEmailLeadDownloadAccess');
  });
});

function stripeEvent(id, type, orderId){
  return {
    id,
    trusted:true,
    type,
    data:{
      object:{
        id:`cs_for_${orderId}`,
        payment_intent:`pi_for_${orderId}`,
        amount_total:2000,
        amount:2000,
        amount_refunded:0,
        currency:'usd',
        metadata:{ orderId }
      }
    }
  };
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
    marketplace_payment_events:(initial.marketplace_payment_events || []).map(clone),
    marketplace_free_email_offers:(initial.marketplace_free_email_offers || []).map(clone),
    marketplace_free_email_leads:(initial.marketplace_free_email_leads || []).map(clone)
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
