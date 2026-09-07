const { createHash, randomUUID } = require('crypto');
const { MIX_BUCKET } = require('./battle_submission');
const { LIBRARY_TRACK_TABLE, camelotKeyFor } = require('./music_library');

const MARKETPLACE_SCHEMA = '022_create_marketplace_player_foundation';
const MARKETPLACE_PRODUCT_TABLE = 'marketplace_products';
const MARKETPLACE_RIGHTS_TABLE = 'marketplace_rights_policies';
const MARKETPLACE_LISTING_TABLE = 'marketplace_listings';
const MARKETPLACE_ENTITLEMENT_TABLE = 'marketplace_entitlements';
const MARKETPLACE_PLAYER_SESSION_TABLE = 'marketplace_player_sessions';

const PRODUCT_TYPES = ['beat', 'sample_pack', 'loop_pack', 'preset_pack', 'battle_recording'];
const PRODUCT_STATUSES = ['draft', 'active', 'archived', 'blocked'];
const LISTING_STATUSES = ['draft', 'published', 'archived', 'blocked'];
const RIGHTS_CLASSIFICATIONS_ALLOWED_FOR_MARKETPLACE = ['original', 'licensed', 'royalty_free', 'platform_cleared'];
const RIGHTS_LICENSE_TYPES = ['personal_stream', 'battle_use', 'creator_license', 'royalty_free_use', 'preview_only'];
const ENTITLEMENT_TYPES = ['stream', 'download', 'creator_grant'];
const ENTITLEMENT_SOURCES = ['manual_grant', 'operator_grant', 'creator_grant', 'imported', 'test_seed'];
const ENTITLEMENT_STATUSES = ['active', 'revoked', 'expired'];
const PLAYER_ACCESS_SCOPES = ['preview', 'entitled_stream', 'owner_stream'];

function cleanString(value, fallback = '', max = 240){
  return String(value == null ? fallback : value).trim().slice(0, max);
}

function cleanIdentifier(value, fallback = ''){
  const text = cleanString(value, fallback, 128);
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text : '';
}

function cleanEnum(value, allowed, fallback){
  return allowed.includes(value) ? value : fallback;
}

function safeArray(value, max = 32){
  if(!Array.isArray(value)) return [];
  return value.map(item => cleanString(item, '', 64)).filter(Boolean).slice(0, max);
}

function safeObject(value){
  if(!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value };
}

function finiteNumber(value, options = {}){
  if(value == null || value === '') return null;
  const number = Number(value);
  if(!Number.isFinite(number)) return null;
  const min = options.min == null ? number : options.min;
  const max = options.max == null ? number : options.max;
  return Math.max(min, Math.min(max, number));
}

function integer(value, options = {}){
  const number = finiteNumber(value, options);
  return number == null ? null : Math.round(number);
}

function nowIso(now){
  return (now instanceof Date ? now : new Date(now || Date.now())).toISOString();
}

function hashId(prefix, value){
  const digest = createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
  return `${prefix}_${digest}`;
}

function slugify(value, fallback = 'marketplace-product'){
  const slug = cleanString(value, fallback, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function safeStoragePath(value, allowedPrefixes){
  const path = cleanString(value, '', 500);
  if(!path || /^(https?|data|file):/i.test(path) || path.includes('..')) return null;
  return allowedPrefixes.some(prefix => path.startsWith(prefix)) ? path : null;
}

function rightsClassificationAllowsMarketplace(value){
  return RIGHTS_CLASSIFICATIONS_ALLOWED_FOR_MARKETPLACE.includes(cleanString(value));
}

function sanitizeTerms(value){
  const terms = safeObject(value);
  const serialized = JSON.stringify(terms);
  if(/(storage_object_path|audio_storage|artwork_storage|signedurl|https?:\/\/|service_role|secret|private\/)/i.test(serialized)){
    return {};
  }
  return terms;
}

function sanitizeMarketplaceProduct(row, options = {}){
  if(!row) return null;
  const ownerView = Boolean(options.ownerView);
  const product = {
    id: row.id,
    type: row.product_type,
    title: row.title,
    description: row.description || '',
    bpm: row.bpm == null ? null : Number(row.bpm),
    key: row.key || null,
    camelotKey: row.camelot_key || camelotKeyFor(row.key),
    genre: row.genre || 'Unsorted',
    duration: row.duration == null ? null : Number(row.duration),
    tags: Array.isArray(row.tags) ? row.tags : [],
    rightsClassification: row.rights_classification,
    status: row.status,
    hasAudio: Boolean(row.audio_storage_object_path),
    hasPreview: Boolean(row.preview_storage_object_path),
    hasArtwork: Boolean(row.artwork_storage_object_path),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
  if(ownerView){
    product.creatorUserId = row.creator_user_id;
    product.libraryTrackId = row.library_track_id || null;
  }
  return product;
}

function sanitizeMarketplaceRightsPolicy(row){
  if(!row) return null;
  return {
    id: row.id,
    productId: row.product_id,
    licenseType: row.license_type,
    rightsClassification: row.rights_classification,
    marketplaceStreamingAllowed: Boolean(row.marketplace_streaming_allowed),
    previewAllowed: Boolean(row.preview_allowed),
    downloadAllowed: Boolean(row.download_allowed),
    battleUseAllowed: Boolean(row.battle_use_allowed),
    commercialUseAllowed: Boolean(row.commercial_use_allowed),
    attributionRequired: Boolean(row.attribution_required),
    territory: row.territory || 'worldwide',
    status: row.status,
    terms: sanitizeTerms(row.terms),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function sanitizeMarketplaceListing(row, options = {}){
  if(!row) return null;
  const ownerView = Boolean(options.ownerView);
  const product = sanitizeMarketplaceProduct(options.product || row.product, { ownerView });
  const rights = sanitizeMarketplaceRightsPolicy(options.rights || row.rights);
  const listing = {
    id: row.id,
    productId: row.product_id,
    title: row.title,
    description: row.description || '',
    slug: row.slug || null,
    status: row.status,
    productType: product ? product.type : null,
    genre: product ? product.genre : null,
    previewEnabled: Boolean(row.preview_enabled && product && product.hasPreview && rights && rights.previewAllowed),
    previewDuration: row.preview_duration == null ? null : Number(row.preview_duration),
    displayPriceCents: row.display_price_cents == null ? null : Number(row.display_price_cents),
    currency: row.currency || 'USD',
    commerceStatus: row.commerce_status || 'deferred',
    metadata: sanitizeTerms(row.metadata),
    product,
    rights,
    publishedAt: row.published_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
  if(ownerView) listing.sellerUserId = row.seller_user_id;
  return listing;
}

function sanitizeMarketplaceEntitlement(row, options = {}){
  if(!row) return null;
  return {
    id: row.id,
    productId: row.product_id,
    userId: row.user_id,
    type: row.entitlement_type,
    source: row.source,
    status: row.status,
    startsAt: row.starts_at || null,
    expiresAt: row.expires_at || null,
    grantedBy: row.granted_by || null,
    grantReason: row.grant_reason || '',
    product: options.product ? sanitizeMarketplaceProduct(options.product, { ownerView:false }) : null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function sanitizeMarketplacePlayerSession(row){
  if(!row) return null;
  return {
    id: row.id,
    productId: row.product_id,
    listingId: row.listing_id || null,
    entitlementId: row.entitlement_id || null,
    accessScope: row.access_scope,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at || null
  };
}

function marketplaceProductPayloadFromTrack(userId, track, input = {}, timestamp){
  const productType = cleanEnum(input.productType || input.product_type, PRODUCT_TYPES, track.source_type === 'practice_recording' ? 'battle_recording' : 'beat');
  const audioPath = safeStoragePath(track.audio_storage_object_path, ['private/library-audio/', 'private/battle-entries/']);
  const previewPath = safeStoragePath(input.previewStorageObjectPath || input.preview_storage_object_path, ['private/marketplace-previews/', 'private/library-audio/']);
  const artworkPath = safeStoragePath(track.artwork_storage_object_path || input.artworkStorageObjectPath || input.artwork_storage_object_path, ['private/library-artwork/', 'private/marketplace-artwork/']);
  const title = cleanString(input.title || track.title, 'Untitled Product', 160);
  const description = cleanString(input.description || '', '', 2000);
  const id = cleanIdentifier(input.productId || input.product_id || input.id) || hashId('mp_prod', { userId, trackId:track.id, title });
  return {
    id,
    creator_user_id: userId,
    library_track_id: track.id,
    product_type: productType,
    title,
    description,
    audio_storage_bucket: track.audio_storage_bucket || MIX_BUCKET,
    audio_storage_object_path: audioPath,
    preview_storage_object_path: previewPath,
    artwork_storage_bucket: artworkPath ? (track.artwork_storage_bucket || 'battle-artwork') : null,
    artwork_storage_object_path: artworkPath,
    bpm: finiteNumber(input.bpm != null ? input.bpm : track.bpm, { min: 20, max: 300 }),
    key: cleanString(input.key != null ? input.key : track.key, '', 40) || null,
    camelot_key: cleanString(input.camelotKey || input.camelot_key || track.camelot_key || camelotKeyFor(track.key), '', 8) || null,
    genre: cleanString(input.genre || track.genre, 'Unsorted', 80),
    duration: finiteNumber(input.duration != null ? input.duration : track.duration, { min: 0, max: 24 * 60 * 60 }),
    tags: safeArray(input.tags || track.tags, 32),
    rights_classification: cleanString(track.rights_classification || input.rightsClassification || input.rights_classification, 'unknown', 80),
    status: cleanEnum(input.productStatus || input.product_status, PRODUCT_STATUSES, 'active'),
    created_at: timestamp,
    updated_at: timestamp
  };
}

function marketplaceRightsPayload(product, input = {}, timestamp){
  const rights = product.rights_classification;
  return {
    id: cleanIdentifier(input.rightsPolicyId || input.rights_policy_id) || hashId('mp_rights', { productId:product.id }),
    product_id: product.id,
    rights_classification: rights,
    license_type: cleanEnum(input.licenseType || input.license_type, RIGHTS_LICENSE_TYPES, rights === 'royalty_free' ? 'royalty_free_use' : 'battle_use'),
    marketplace_streaming_allowed: input.marketplaceStreamingAllowed == null ? true : Boolean(input.marketplaceStreamingAllowed),
    preview_allowed: input.previewAllowed == null ? true : Boolean(input.previewAllowed),
    download_allowed: Boolean(input.downloadAllowed),
    battle_use_allowed: input.battleUseAllowed == null ? true : Boolean(input.battleUseAllowed),
    commercial_use_allowed: Boolean(input.commercialUseAllowed),
    attribution_required: Boolean(input.attributionRequired),
    territory: cleanString(input.territory, 'worldwide', 80) || 'worldwide',
    terms: sanitizeTerms(input.terms),
    status: 'active',
    created_at: timestamp,
    updated_at: timestamp
  };
}

function marketplaceListingPayload(userId, product, input = {}, timestamp){
  const status = cleanEnum(input.status, LISTING_STATUSES, input.publish === true ? 'published' : 'draft');
  const publishedAt = status === 'published' ? (input.publishedAt || input.published_at || timestamp) : null;
  const previewDuration = integer(input.previewDuration || input.preview_duration, { min: 5, max: 180 }) || 30;
  return {
    id: cleanIdentifier(input.listingId || input.listing_id) || hashId('mp_listing', { productId:product.id, userId }),
    product_id: product.id,
    seller_user_id: userId,
    title: cleanString(input.listingTitle || input.title || product.title, product.title, 160),
    description: cleanString(input.listingDescription || input.description || product.description, '', 2000),
    slug: cleanString(input.slug, slugify(`${product.title}-${product.id}`), 120),
    status,
    preview_enabled: Boolean(input.previewEnabled !== false && product.preview_storage_object_path),
    preview_duration: previewDuration,
    display_price_cents: integer(input.displayPriceCents != null ? input.displayPriceCents : input.display_price_cents, { min: 0, max: 10000000 }),
    currency: cleanString(input.currency, 'USD', 3).toUpperCase() || 'USD',
    commerce_status: 'deferred',
    metadata: sanitizeTerms(input.metadata),
    published_at: publishedAt,
    created_at: timestamp,
    updated_at: timestamp
  };
}

async function queryRows(dataClient, table, filters = [], limit = null){
  let query = dataClient.from(table).select('*');
  filters.forEach(([field, value]) => { query = query.eq(field, value); });
  if(limit != null && typeof query.limit === 'function') query = query.limit(limit);
  const result = await query;
  if(result.error) return { error: result.error };
  return { rows: Array.isArray(result.data) ? result.data : [] };
}

async function querySingle(dataClient, table, filters = []){
  let query = dataClient.from(table).select('*');
  filters.forEach(([field, value]) => { query = query.eq(field, value); });
  if(typeof query.limit === 'function') query = query.limit(1);
  const result = await query;
  if(result.error) return { error: result.error };
  return { row: Array.isArray(result.data) ? result.data[0] || null : result.data || null };
}

async function getOwnedSourceTrack(dataClient, userId, trackId){
  const id = cleanIdentifier(trackId);
  if(!id) return { validationError: 'A library track is required' };
  const result = await querySingle(dataClient, LIBRARY_TRACK_TABLE, [['id', id]]);
  if(result.error) return { error: result.error };
  if(!result.row || result.row.archived_at) return { unavailable: true };
  if(String(result.row.user_id) !== String(userId)) return { forbidden: true };
  return { track: result.row };
}

async function createMarketplaceListing(dataClient, userId, input = {}, now = new Date()){
  const timestamp = nowIso(now);
  const trackId = input.libraryTrackId || input.library_track_id || input.trackId || input.track_id;
  const owned = await getOwnedSourceTrack(dataClient, userId, trackId);
  if(owned.error || owned.forbidden || owned.unavailable || owned.validationError) return owned;
  if(!rightsClassificationAllowsMarketplace(owned.track.rights_classification)){
    return { validationError: 'Track rights are not cleared for marketplace listing' };
  }
  if(!safeStoragePath(owned.track.audio_storage_object_path, ['private/library-audio/', 'private/battle-entries/'])){
    return { validationError: 'Marketplace products require verified private audio' };
  }

  const existingProduct = await querySingle(dataClient, MARKETPLACE_PRODUCT_TABLE, [['creator_user_id', userId], ['library_track_id', owned.track.id]]);
  if(existingProduct.error) return { error: existingProduct.error };
  if(existingProduct.row && existingProduct.row.status !== 'archived'){
    const existingListing = await querySingle(dataClient, MARKETPLACE_LISTING_TABLE, [['product_id', existingProduct.row.id]]);
    if(existingListing.error) return { error: existingListing.error };
    return {
      duplicate: true,
      product: sanitizeMarketplaceProduct(existingProduct.row, { ownerView:true }),
      listing: sanitizeMarketplaceListing(existingListing.row, { product:existingProduct.row, ownerView:true })
    };
  }

  const product = marketplaceProductPayloadFromTrack(userId, owned.track, input, timestamp);
  const rights = marketplaceRightsPayload(product, input, timestamp);
  const listing = marketplaceListingPayload(userId, product, input, timestamp);
  if(!rights.marketplace_streaming_allowed) return { validationError: 'Marketplace streaming must be allowed before listing' };

  const productInsert = await dataClient.from(MARKETPLACE_PRODUCT_TABLE).insert([product]).select('*').single();
  if(productInsert.error) return { error: productInsert.error };
  const rightsInsert = await dataClient.from(MARKETPLACE_RIGHTS_TABLE).insert([rights]).select('*').single();
  if(rightsInsert.error) return { error: rightsInsert.error };
  const listingInsert = await dataClient.from(MARKETPLACE_LISTING_TABLE).insert([listing]).select('*').single();
  if(listingInsert.error) return { error: listingInsert.error };

  return {
    created: true,
    product: sanitizeMarketplaceProduct(productInsert.data, { ownerView:true }),
    rights: sanitizeMarketplaceRightsPolicy(rightsInsert.data),
    listing: sanitizeMarketplaceListing(listingInsert.data, { product:productInsert.data, rights:rightsInsert.data, ownerView:true }),
    rawProduct: productInsert.data,
    rawRights: rightsInsert.data,
    rawListing: listingInsert.data
  };
}

async function loadListingBundle(dataClient, listingId, options = {}){
  const listing = await querySingle(dataClient, MARKETPLACE_LISTING_TABLE, [['id', cleanIdentifier(listingId)]]);
  if(listing.error) return { error: listing.error };
  if(!listing.row || listing.row.status === 'archived') return { unavailable: true };
  const product = await querySingle(dataClient, MARKETPLACE_PRODUCT_TABLE, [['id', listing.row.product_id]]);
  if(product.error) return { error: product.error };
  if(!product.row || product.row.status !== 'active') return { unavailable: true };
  if(!options.ownerView && listing.row.status !== 'published') return { unavailable: true };
  const rights = await querySingle(dataClient, MARKETPLACE_RIGHTS_TABLE, [['product_id', product.row.id]]);
  if(rights.error) return { error: rights.error };
  if(!rights.row || rights.row.status !== 'active') return { unavailable: true };
  return { listing: listing.row, product: product.row, rights: rights.row };
}

async function listMarketplaceCatalog(dataClient, options = {}){
  const limit = Math.max(1, Math.min(100, Number(options.limit || 50)));
  const page = Math.max(1, Number(options.page || 1));
  const listingsResult = await queryRows(dataClient, MARKETPLACE_LISTING_TABLE, [['status', 'published']], 500);
  if(listingsResult.error) return { error: listingsResult.error };

  const items = [];
  for(const listing of listingsResult.rows){
    const bundle = await loadListingBundle(dataClient, listing.id);
    if(bundle.error) return { error: bundle.error };
    if(bundle.unavailable) continue;
    if(options.productType && String(bundle.product.product_type) !== String(options.productType)) continue;
    if(options.genre && String(bundle.product.genre || '').toLowerCase() !== String(options.genre).toLowerCase()) continue;
    if(!bundle.rights.marketplace_streaming_allowed) continue;
    items.push(sanitizeMarketplaceListing(bundle.listing, { product:bundle.product, rights:bundle.rights }));
  }
  items.sort((a, b) => String(b.publishedAt || b.updatedAt || '').localeCompare(String(a.publishedAt || a.updatedAt || '')));
  const start = (page - 1) * limit;
  const pageItems = items.slice(start, start + limit);
  return {
    listings: pageItems,
    pagination: {
      page,
      limit,
      total: items.length,
      hasMore: start + limit < items.length,
      nextPage: start + limit < items.length ? page + 1 : null
    }
  };
}

async function getMarketplaceListing(dataClient, listingId, options = {}){
  const bundle = await loadListingBundle(dataClient, listingId, options);
  if(bundle.error || bundle.unavailable) return bundle;
  return { listing: sanitizeMarketplaceListing(bundle.listing, { product:bundle.product, rights:bundle.rights, ownerView:options.ownerView }) };
}

async function getProduct(dataClient, productId){
  const result = await querySingle(dataClient, MARKETPLACE_PRODUCT_TABLE, [['id', cleanIdentifier(productId)]]);
  if(result.error) return { error: result.error };
  if(!result.row || result.row.status !== 'active') return { unavailable: true };
  return { product: result.row };
}

async function getProductRights(dataClient, productId){
  const result = await querySingle(dataClient, MARKETPLACE_RIGHTS_TABLE, [['product_id', productId]]);
  if(result.error) return { error: result.error };
  if(!result.row || result.row.status !== 'active') return { unavailable: true };
  return { rights: result.row };
}

function entitlementIsActive(row, now = new Date()){
  if(!row || row.status !== 'active') return false;
  const current = now instanceof Date ? now : new Date(now);
  if(row.starts_at && new Date(row.starts_at) > current) return false;
  if(row.expires_at && new Date(row.expires_at) <= current) return false;
  return true;
}

async function findActiveEntitlement(dataClient, userId, productId, now = new Date()){
  const result = await queryRows(dataClient, MARKETPLACE_ENTITLEMENT_TABLE, [['user_id', userId], ['product_id', productId]], 100);
  if(result.error) return { error: result.error };
  const entitlement = result.rows.find(row => entitlementIsActive(row, now));
  return { entitlement: entitlement || null };
}

async function listOwnedMarketplaceEntitlements(dataClient, userId, now = new Date()){
  const result = await queryRows(dataClient, MARKETPLACE_ENTITLEMENT_TABLE, [['user_id', userId]], 200);
  if(result.error) return { error: result.error };
  const entitlements = [];
  for(const row of result.rows){
    const product = await getProduct(dataClient, row.product_id);
    if(product.error) return { error: product.error };
    entitlements.push(sanitizeMarketplaceEntitlement(row, { product:product.product || null, active:entitlementIsActive(row, now) }));
  }
  return { entitlements };
}

async function grantMarketplaceEntitlement(dataClient, operatorUserId, input = {}, now = new Date()){
  const productId = cleanIdentifier(input.productId || input.product_id);
  const userId = cleanIdentifier(input.userId || input.user_id);
  if(!productId || !userId) return { validationError: 'Product and user are required' };
  const product = await getProduct(dataClient, productId);
  if(product.error || product.unavailable) return product;
  const existing = await findActiveEntitlement(dataClient, userId, productId, now);
  if(existing.error) return { error: existing.error };
  if(existing.entitlement){
    return { duplicate: true, entitlement:sanitizeMarketplaceEntitlement(existing.entitlement, { product:product.product }) };
  }
  const timestamp = nowIso(now);
  const expiresAt = cleanString(input.expiresAt || input.expires_at, '', 80) || null;
  const payload = {
    id: cleanIdentifier(input.entitlementId || input.entitlement_id) || `mp_ent_${randomUUID()}`,
    product_id: productId,
    user_id: userId,
    entitlement_type: cleanEnum(input.entitlementType || input.entitlement_type, ENTITLEMENT_TYPES, 'stream'),
    source: cleanEnum(input.source, ENTITLEMENT_SOURCES, 'manual_grant'),
    status: 'active',
    starts_at: cleanString(input.startsAt || input.starts_at, timestamp, 80),
    expires_at: expiresAt,
    granted_by: operatorUserId,
    grant_reason: cleanString(input.reason || input.grantReason || input.grant_reason, '', 500),
    created_at: timestamp,
    updated_at: timestamp
  };
  const inserted = await dataClient.from(MARKETPLACE_ENTITLEMENT_TABLE).insert([payload]).select('*').single();
  if(inserted.error) return { error: inserted.error };
  return { created:true, entitlement:sanitizeMarketplaceEntitlement(inserted.data, { product:product.product }), rawEntitlement:inserted.data };
}

async function resolvePlayerBundle(dataClient, input = {}){
  const listingId = input.listingId || input.listing_id;
  const productId = input.productId || input.product_id;
  if(listingId){
    const bundle = await loadListingBundle(dataClient, listingId, { ownerView:true });
    if(bundle.error || bundle.unavailable) return bundle;
    return bundle;
  }
  if(!productId) return { validationError: 'A listing or product is required' };
  const product = await getProduct(dataClient, productId);
  if(product.error || product.unavailable) return product;
  const rights = await getProductRights(dataClient, product.product.id);
  if(rights.error || rights.unavailable) return rights;
  const listing = await querySingle(dataClient, MARKETPLACE_LISTING_TABLE, [['product_id', product.product.id]]);
  if(listing.error) return { error: listing.error };
  return { product:product.product, rights:rights.rights, listing:listing.row || null };
}

async function issueMarketplacePlayerAccess(dataClient, storage, userId, input = {}, now = new Date()){
  const bundle = await resolvePlayerBundle(dataClient, input);
  if(bundle.error || bundle.unavailable || bundle.validationError) return bundle;
  const { listing, product, rights } = bundle;
  if(!rights.marketplace_streaming_allowed) return { forbidden:true };

  const active = await findActiveEntitlement(dataClient, userId, product.id, now);
  if(active.error) return { error: active.error };

  let accessScope = null;
  let objectPath = null;
  let entitlementId = null;
  if(String(product.creator_user_id) === String(userId)){
    accessScope = 'owner_stream';
    objectPath = product.audio_storage_object_path;
  }else if(active.entitlement){
    accessScope = 'entitled_stream';
    objectPath = product.audio_storage_object_path;
    entitlementId = active.entitlement.id;
  }else if(input.preview === true && listing && listing.status === 'published' && listing.preview_enabled && rights.preview_allowed){
    accessScope = 'preview';
    objectPath = product.preview_storage_object_path;
  }else{
    return { forbidden:true };
  }

  if(!PLAYER_ACCESS_SCOPES.includes(accessScope) || !safeStoragePath(objectPath, ['private/library-audio/', 'private/battle-entries/', 'private/marketplace-previews/'])){
    return { unavailable:true };
  }
  const expiresIn = accessScope === 'preview' ? 2 * 60 : 5 * 60;
  const signed = await storage.createSignedUrl(objectPath, expiresIn);
  if(signed.error) return { error: signed.error };
  const timestamp = nowIso(now);
  const expiresAt = new Date((now instanceof Date ? now : new Date(now)).getTime() + expiresIn * 1000).toISOString();
  const session = {
    id: cleanIdentifier(input.playerSessionId || input.player_session_id) || `mp_play_${randomUUID()}`,
    product_id: product.id,
    listing_id: listing ? listing.id : null,
    user_id: userId,
    entitlement_id: entitlementId,
    access_scope: accessScope,
    expires_at: expiresAt,
    audit_context: {
      productType: product.product_type,
      preview: accessScope === 'preview',
      entitlementSource: active.entitlement ? active.entitlement.source : null
    },
    created_at: timestamp
  };
  const inserted = await dataClient.from(MARKETPLACE_PLAYER_SESSION_TABLE).insert([session]).select('*').single();
  if(inserted.error) return { error: inserted.error };
  return {
    playerAccess: {
      url: signed.data.signedUrl,
      expiresAt,
      accessScope,
      productId: product.id,
      listingId: listing ? listing.id : null,
      entitlementId,
      previewDuration: accessScope === 'preview' && listing ? Number(listing.preview_duration || 30) : null,
      session: sanitizeMarketplacePlayerSession(inserted.data)
    },
    product: sanitizeMarketplaceProduct(product),
    listing: listing ? sanitizeMarketplaceListing(listing, { product, rights }) : null
  };
}

async function checkMarketplaceSchemaReadiness(dataClient){
  if(!dataClient) return { ready:false, schema:MARKETPLACE_SCHEMA, status:'unconfigured', message:'Supabase service client is not configured.' };
  const tables = [
    MARKETPLACE_PRODUCT_TABLE,
    MARKETPLACE_RIGHTS_TABLE,
    MARKETPLACE_LISTING_TABLE,
    MARKETPLACE_ENTITLEMENT_TABLE,
    MARKETPLACE_PLAYER_SESSION_TABLE
  ];
  try{
    for(const table of tables){
      const result = await dataClient.from(table).select('id').limit(1);
      if(result.error){
        const message = String(result.error.message || result.error);
        const missing = /marketplace_|relation|schema|does not exist|not found|cache/i.test(message);
        return {
          ready:false,
          schema:MARKETPLACE_SCHEMA,
          status: missing ? 'migration_required' : 'failed',
          message: missing ? 'Marketplace foundation schema 022 is not available.' : 'Marketplace foundation schema readiness check failed.'
        };
      }
    }
    return { ready:true, schema:MARKETPLACE_SCHEMA, status:'ready', message:'Marketplace foundation schema 022 is available.' };
  }catch(err){
    return { ready:false, schema:MARKETPLACE_SCHEMA, status:'failed', message:'Marketplace foundation schema readiness check failed.' };
  }
}

module.exports = {
  MARKETPLACE_SCHEMA,
  MARKETPLACE_PRODUCT_TABLE,
  MARKETPLACE_RIGHTS_TABLE,
  MARKETPLACE_LISTING_TABLE,
  MARKETPLACE_ENTITLEMENT_TABLE,
  MARKETPLACE_PLAYER_SESSION_TABLE,
  PRODUCT_TYPES,
  LISTING_STATUSES,
  RIGHTS_CLASSIFICATIONS_ALLOWED_FOR_MARKETPLACE,
  ENTITLEMENT_SOURCES,
  checkMarketplaceSchemaReadiness,
  createMarketplaceListing,
  getMarketplaceListing,
  grantMarketplaceEntitlement,
  issueMarketplacePlayerAccess,
  listMarketplaceCatalog,
  listOwnedMarketplaceEntitlements,
  rightsClassificationAllowsMarketplace,
  sanitizeMarketplaceEntitlement,
  sanitizeMarketplaceListing,
  sanitizeMarketplacePlayerSession,
  sanitizeMarketplaceProduct,
  sanitizeMarketplaceRightsPolicy
};
