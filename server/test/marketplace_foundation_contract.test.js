const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const {
  MARKETPLACE_SCHEMA,
  MARKETPLACE_PRODUCT_TABLE,
  MARKETPLACE_RIGHTS_TABLE,
  MARKETPLACE_LISTING_TABLE,
  MARKETPLACE_ENTITLEMENT_TABLE,
  MARKETPLACE_PLAYER_SESSION_TABLE,
  checkMarketplaceSchemaReadiness,
  createMarketplaceListing,
  getMarketplaceListing,
  grantMarketplaceEntitlement,
  issueMarketplacePlayerAccess,
  listMarketplaceCatalog,
  listOwnedMarketplaceEntitlements,
  rightsClassificationAllowsMarketplace
} = require('../marketplace_foundation');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'sql', '022_create_marketplace_player_foundation.sql'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

function libraryTrack(overrides = {}){
  return {
    id:'track-1',
    user_id:'seller-1',
    source_type:'track',
    title:'Neon Knock',
    artist:'Digital King',
    bpm:128,
    key:'A minor',
    camelot_key:'8A',
    genre:'Bass House',
    duration:184,
    tags:['beat', 'battle'],
    rights_classification:'original',
    visibility:'private',
    audio_storage_bucket:'battle-mixes',
    audio_storage_object_path:'private/library-audio/seller-1/tracks/track-1/audio.webm',
    artwork_storage_bucket:'battle-artwork',
    artwork_storage_object_path:'private/library-artwork/seller-1/tracks/track-1/artwork.png',
    created_at:'2026-09-04T12:00:00.000Z',
    updated_at:'2026-09-04T12:00:00.000Z',
    archived_at:null,
    ...overrides
  };
}

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
    created_at:'2026-09-04T12:00:00.000Z',
    updated_at:'2026-09-04T12:00:00.000Z',
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
    download_allowed:false,
    battle_use_allowed:true,
    commercial_use_allowed:false,
    attribution_required:false,
    territory:'worldwide',
    terms:{ credit:'Digital King' },
    status:'active',
    created_at:'2026-09-04T12:00:00.000Z',
    updated_at:'2026-09-04T12:00:00.000Z',
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
    display_price_cents:0,
    currency:'USD',
    commerce_status:'deferred',
    metadata:{ mood:'peak-time' },
    published_at:'2026-09-04T12:05:00.000Z',
    created_at:'2026-09-04T12:00:00.000Z',
    updated_at:'2026-09-04T12:05:00.000Z',
    ...overrides
  };
}

function entitlement(overrides = {}){
  return {
    id:'ent-1',
    product_id:'prod-1',
    user_id:'buyer-1',
    entitlement_type:'stream',
    source:'manual_grant',
    status:'active',
    starts_at:'2026-09-04T12:00:00.000Z',
    expires_at:null,
    granted_by:'operator-1',
    grant_reason:'validation seed',
    created_at:'2026-09-04T12:00:00.000Z',
    updated_at:'2026-09-04T12:00:00.000Z',
    ...overrides
  };
}

describe('marketplace/player foundation contract', () => {
  it('creates a published product/listing from owned rights-cleared library audio', async () => {
    const db = dataClient({ music_library_tracks:[libraryTrack()] });
    const result = await createMarketplaceListing(db, 'seller-1', {
      productId:'prod-1',
      listingId:'listing-1',
      libraryTrackId:'track-1',
      productType:'beat',
      publish:true,
      previewStorageObjectPath:'private/marketplace-previews/seller-1/prod-1/preview.webm',
      metadata:{ mood:'peak-time', secret:'private/library-audio/seller-1/tracks/track-1/audio.webm' }
    }, new Date('2026-09-04T12:05:00Z'));

    expect(result.created).to.equal(true);
    expect(result.product.type).to.equal('beat');
    expect(result.product.hasAudio).to.equal(true);
    expect(result.listing.status).to.equal('published');
    expect(result.listing.previewEnabled).to.equal(true);
    expect(result.listing.commerceStatus).to.equal('deferred');
    expect(result.rawProduct.audio_storage_object_path).to.equal('private/library-audio/seller-1/tracks/track-1/audio.webm');
    expect(JSON.stringify(result.listing)).to.not.include('audio_storage_object_path');
    expect(JSON.stringify(result.listing)).to.not.include('private/library-audio');
    expect(result.listing.metadata).to.deep.equal({});
    expect(db.tables.marketplace_products).to.have.length(1);
    expect(db.tables.marketplace_rights_policies).to.have.length(1);
    expect(db.tables.marketplace_listings).to.have.length(1);
  });

  it('blocks foreign, unknown and commercially restricted library tracks before listing', async () => {
    expect(rightsClassificationAllowsMarketplace('original')).to.equal(true);
    expect(rightsClassificationAllowsMarketplace('licensed')).to.equal(true);
    expect(rightsClassificationAllowsMarketplace('royalty_free')).to.equal(true);
    expect(rightsClassificationAllowsMarketplace('platform_cleared')).to.equal(true);
    expect(rightsClassificationAllowsMarketplace('commercial_copyrighted')).to.equal(false);
    expect(rightsClassificationAllowsMarketplace('unknown')).to.equal(false);

    const blocked = await createMarketplaceListing(dataClient({ music_library_tracks:[libraryTrack({ rights_classification:'commercial_copyrighted' })] }), 'seller-1', { libraryTrackId:'track-1' });
    expect(blocked.validationError).to.equal('Track rights are not cleared for marketplace listing');

    const unknown = await createMarketplaceListing(dataClient({ music_library_tracks:[libraryTrack({ rights_classification:'unknown' })] }), 'seller-1', { libraryTrackId:'track-1' });
    expect(unknown.validationError).to.equal('Track rights are not cleared for marketplace listing');

    const foreign = await createMarketplaceListing(dataClient({ music_library_tracks:[libraryTrack({ user_id:'seller-2' })] }), 'seller-1', { libraryTrackId:'track-1' });
    expect(foreign.forbidden).to.equal(true);
  });

  it('lists only published streamable catalog entries with public redaction', async () => {
    const db = dataClient({
      marketplace_products:[
        product(),
        product({ id:'prod-draft', library_track_id:'track-draft', title:'Draft Beat' }),
        product({ id:'prod-muted', library_track_id:'track-muted', title:'Muted Beat' })
      ],
      marketplace_rights_policies:[
        rights(),
        rights({ id:'rights-draft', product_id:'prod-draft' }),
        rights({ id:'rights-muted', product_id:'prod-muted', marketplace_streaming_allowed:false })
      ],
      marketplace_listings:[
        listing({ metadata:{ path:'private/library-audio/seller-1/tracks/track-1/audio.webm' } }),
        listing({ id:'listing-draft', product_id:'prod-draft', title:'Draft Beat', status:'draft' }),
        listing({ id:'listing-muted', product_id:'prod-muted', title:'Muted Beat' })
      ]
    });

    const catalog = await listMarketplaceCatalog(db, { limit:10 });
    expect(catalog.listings.map(item => item.id)).to.deep.equal(['listing-1']);
    expect(catalog.listings[0].sellerUserId).to.equal(undefined);
    expect(catalog.listings[0].previewEnabled).to.equal(true);
    expect(catalog.listings[0].metadata).to.deep.equal({});
    const serialized = JSON.stringify(catalog.listings[0]);
    expect(serialized).to.not.include('audio_storage_object_path');
    expect(serialized).to.not.include('artwork_storage_object_path');
    expect(serialized).to.not.include('private/library-audio');

    const detail = await getMarketplaceListing(db, 'listing-1');
    expect(detail.listing.id).to.equal('listing-1');
    expect(detail.listing.product.hasArtwork).to.equal(true);
  });

  it('issues owner and entitled player access without exposing permanent storage fields', async () => {
    const db = dataClient({
      marketplace_products:[product()],
      marketplace_rights_policies:[rights()],
      marketplace_listings:[listing()],
      marketplace_entitlements:[]
    });
    const storage = storageClient();

    const owner = await issueMarketplacePlayerAccess(db, storage, 'seller-1', { listingId:'listing-1' }, new Date('2026-09-04T12:10:00Z'));
    expect(owner.playerAccess.accessScope).to.equal('owner_stream');
    expect(owner.playerAccess.expiresAt).to.equal('2026-09-04T12:15:00.000Z');
    expect(storage.signed[0].expiresIn).to.equal(300);
    expect(JSON.stringify(owner)).to.not.include('audio_storage_object_path');

    const denied = await issueMarketplacePlayerAccess(db, storageClient(), 'buyer-1', { listingId:'listing-1' });
    expect(denied.forbidden).to.equal(true);

    const grant = await grantMarketplaceEntitlement(db, 'operator-1', { productId:'prod-1', userId:'buyer-1', reason:'validation seed' }, new Date('2026-09-04T12:11:00Z'));
    expect(grant.created).to.equal(true);
    const entitled = await issueMarketplacePlayerAccess(db, storageClient(), 'buyer-1', { productId:'prod-1' }, new Date('2026-09-04T12:12:00Z'));
    expect(entitled.playerAccess.accessScope).to.equal('entitled_stream');
    expect(entitled.playerAccess.entitlementId).to.equal(grant.entitlement.id);
    expect(db.tables.marketplace_player_sessions.map(row => row.access_scope)).to.include('entitled_stream');
  });

  it('keeps preview playback separate from full access', async () => {
    const db = dataClient({
      marketplace_products:[product()],
      marketplace_rights_policies:[rights()],
      marketplace_listings:[listing()],
      marketplace_entitlements:[]
    });
    const noPreviewFlag = await issueMarketplacePlayerAccess(db, storageClient(), 'visitor-1', { listingId:'listing-1' });
    expect(noPreviewFlag.forbidden).to.equal(true);

    const preview = await issueMarketplacePlayerAccess(db, storageClient(), 'visitor-1', { listingId:'listing-1', preview:true }, new Date('2026-09-04T12:20:00Z'));
    expect(preview.playerAccess.accessScope).to.equal('preview');
    expect(preview.playerAccess.previewDuration).to.equal(30);
    expect(preview.playerAccess.expiresAt).to.equal('2026-09-04T12:22:00.000Z');
    expect(db.tables.marketplace_player_sessions[0].access_scope).to.equal('preview');
    expect(db.tables.marketplace_player_sessions[0].audit_context.preview).to.equal(true);
  });

  it('lists owned entitlements and reports schema readiness without applying migrations', async () => {
    const db = dataClient({
      marketplace_products:[product()],
      marketplace_entitlements:[entitlement()]
    });
    const listed = await listOwnedMarketplaceEntitlements(db, 'buyer-1');
    expect(listed.entitlements).to.have.length(1);
    expect(listed.entitlements[0].product.title).to.equal('Neon Knock');

    const ready = await checkMarketplaceSchemaReadiness(dataClient({}));
    expect(ready.ready).to.equal(true);
    expect(ready.schema).to.equal(MARKETPLACE_SCHEMA);

    const missing = await checkMarketplaceSchemaReadiness({
      from(){ return { select(){ return this; }, limit(){ return Promise.resolve({ data:null, error:new Error('relation "marketplace_products" does not exist') }); } }; }
    });
    expect(missing.ready).to.equal(false);
    expect(missing.status).to.equal('migration_required');
  });

  it('defines RLS-ready tables, routes and deferred-commerce boundaries', () => {
    expect(sql).to.include('CREATE TABLE IF NOT EXISTS public.marketplace_products');
    expect(sql).to.include('CREATE TABLE IF NOT EXISTS public.marketplace_rights_policies');
    expect(sql).to.include('CREATE TABLE IF NOT EXISTS public.marketplace_listings');
    expect(sql).to.include('CREATE TABLE IF NOT EXISTS public.marketplace_entitlements');
    expect(sql).to.include('CREATE TABLE IF NOT EXISTS public.marketplace_player_sessions');
    expect(sql).to.include('ALTER TABLE public.marketplace_products ENABLE ROW LEVEL SECURITY');
    expect(sql).to.include("rights_classification IN ('original', 'licensed', 'royalty_free', 'platform_cleared')");
    expect(sql).to.include("audio_storage_object_path !~* '^(https?|data|file):'");
    expect(sql).to.not.match(/stripe|paypal|checkout|connect_account|payout|wallet/i);

    expect(serverSource).to.include("app.get('/api/marketplace/catalog'");
    expect(serverSource).to.include("app.get('/api/marketplace/catalog/:listingId'");
    expect(serverSource).to.include("app.get('/api/marketplace/schemaStatus', requireAuth");
    expect(serverSource).to.include("app.post('/api/marketplace/listings', requireAuth");
    expect(serverSource).to.include("app.get('/api/marketplace/entitlements', requireAuth");
    expect(serverSource).to.include("app.post('/api/marketplace/entitlements/grants', requireAuth, requireOperatorUser");
    expect(serverSource).to.include("app.post('/api/marketplace/player/access', requireAuth");
    expect(MARKETPLACE_PRODUCT_TABLE).to.equal('marketplace_products');
    expect(MARKETPLACE_RIGHTS_TABLE).to.equal('marketplace_rights_policies');
    expect(MARKETPLACE_LISTING_TABLE).to.equal('marketplace_listings');
    expect(MARKETPLACE_ENTITLEMENT_TABLE).to.equal('marketplace_entitlements');
    expect(MARKETPLACE_PLAYER_SESSION_TABLE).to.equal('marketplace_player_sessions');
  });
});

function dataClient(initial = {}){
  const tables = {
    music_library_tracks:(initial.music_library_tracks || []).map(row => ({ ...row })),
    marketplace_products:(initial.marketplace_products || []).map(row => ({ ...row })),
    marketplace_rights_policies:(initial.marketplace_rights_policies || []).map(row => ({ ...row })),
    marketplace_listings:(initial.marketplace_listings || []).map(row => ({ ...row })),
    marketplace_entitlements:(initial.marketplace_entitlements || []).map(row => ({ ...row })),
    marketplace_player_sessions:(initial.marketplace_player_sessions || []).map(row => ({ ...row }))
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
  }
  select(){ return this; }
  eq(field, value){ this.filters.push([field, value]); return this; }
  limit(value){ this.limitValue = Number(value); return this; }
  insert(rows){ this.insertRows = rows; return this; }
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
      this.insertRows.forEach(row => rows.push({ ...row }));
      return { data:this.insertRows.map(row => ({ ...row })), error:null };
    }
    const matched = rows.filter(row => this.filters.every(([field, value]) => String(row[field]) === String(value)));
    const limited = this.limitValue ? matched.slice(0, this.limitValue) : matched;
    return { data:limited.map(row => ({ ...row })), error:null };
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
