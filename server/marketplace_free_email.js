const { createHash, randomUUID, timingSafeEqual } = require('crypto');
const {
  MARKETPLACE_PRODUCT_TABLE,
  MARKETPLACE_RIGHTS_TABLE,
  MARKETPLACE_LISTING_TABLE,
  MARKETPLACE_ENTITLEMENT_TABLE,
  sanitizeMarketplaceEntitlement,
  sanitizeMarketplaceListing
} = require('./marketplace_foundation');
const { issueMarketplaceDownloadAccess } = require('./marketplace_commerce');

const MARKETPLACE_FREE_EMAIL_SCHEMA = '024_create_marketplace_free_email_leads';
const MARKETPLACE_FREE_EMAIL_OFFER_TABLE = 'marketplace_free_email_offers';
const MARKETPLACE_FREE_EMAIL_LEAD_TABLE = 'marketplace_free_email_leads';
const FREE_EMAIL_ENTITLEMENT_SOURCE = 'free_email';

const OFFER_STATUSES = ['active', 'paused', 'archived'];
const VERIFICATION_STATUSES = ['not_required', 'pending', 'verified', 'expired', 'failed'];
const VERIFICATION_DELIVERY_STATUSES = ['not_required', 'pending', 'sent', 'unconfigured', 'failed'];
const DOWNLOAD_STATUSES = ['locked', 'available', 'downloaded', 'restricted'];
const DOWNLOAD_CONSENT_STATUSES = ['accepted', 'not_required'];
const MARKETING_CONSENT_STATUSES = ['accepted', 'declined', 'required'];
const FREE_FILE_TYPES = ['mp3', 'audio', 'free_mp3', 'preview_download'];
const DEFAULT_CLAIM_LIMIT = { windowMs:15 * 60 * 1000, max:5 };
const defaultClaimRateState = new Map();

function cleanString(value, fallback = '', max = 240){
  return String(value == null ? fallback : value).trim().slice(0, max);
}

function cleanIdentifier(value, fallback = ''){
  const text = cleanString(value, fallback, 180);
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text : '';
}

function cleanEnum(value, allowed, fallback){
  return allowed.includes(value) ? value : fallback;
}

function safeObject(value){
  if(!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value };
}

function safeArray(value, max = 100){
  if(!Array.isArray(value)) return [];
  return value.slice(0, max);
}

function finiteInteger(value, fallback = null, options = {}){
  if(value == null || value === '') return fallback;
  const number = Number(value);
  if(!Number.isFinite(number)) return fallback;
  const min = options.min == null ? number : options.min;
  const max = options.max == null ? number : options.max;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function nowIso(now){
  return (now instanceof Date ? now : new Date(now || Date.now())).toISOString();
}

function stableId(prefix, value){
  const digest = createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
  return `${prefix}_${digest}`;
}

function secretHash(value){
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function safeEqualHash(actualHash, rawValue){
  const expected = Buffer.from(secretHash(rawValue));
  const actual = Buffer.from(String(actualHash || ''));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function normalizeEmail(value){
  const email = cleanString(value, '', 254).toLowerCase();
  if(!email || /\s/.test(email) || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) return '';
  return email;
}

function emailPrincipalFor(email){
  return `email_${secretHash(normalizeEmail(email)).slice(0, 32)}`;
}

function safeStoragePath(value){
  const path = cleanString(value, '', 600);
  if(!path || /^(https?|data|file):/i.test(path) || path.includes('..')) return null;
  return path.startsWith('private/marketplace-downloads/') ? path : null;
}

function sanitizeAllowedFile(file){
  if(!file || typeof file !== 'object') return null;
  return {
    id: cleanIdentifier(file.id, 'free-mp3'),
    type: cleanString(file.type || file.kind, 'mp3', 32),
    filename: cleanString(file.filename || file.name, 'download.mp3', 180),
    mimeType: cleanString(file.mimeType || file.mime_type, 'audio/mpeg', 80),
    size: finiteInteger(file.size || file.file_size, null, { min:0 })
  };
}

function normalizeAllowedFile(file, index){
  if(!file || typeof file !== 'object') return { validationError:'Free download files must be objects' };
  const id = cleanIdentifier(file.id, index === 0 ? 'free-mp3' : `free-mp3-${index + 1}`);
  const type = cleanString(file.type || file.kind, 'mp3', 32).toLowerCase();
  const mimeType = cleanString(file.mimeType || file.mime_type, 'audio/mpeg', 80).toLowerCase();
  const storageObjectPath = safeStoragePath(file.storageObjectPath || file.storage_object_path);
  if(!id) return { validationError:'Free download file IDs must be safe identifiers' };
  if(!FREE_FILE_TYPES.includes(type)) return { validationError:'Free-email offers may only include explicitly configured free MP3/audio files' };
  if(/wav|stem|trackout|master|exclusive/i.test(`${type} ${file.filename || file.name || ''}`)){
    return { validationError:'Free-email offers cannot include WAV, stems, trackouts, masters or exclusive files' };
  }
  if(mimeType && !['audio/mpeg', 'audio/mp3', 'application/octet-stream'].includes(mimeType)){
    return { validationError:'Free-email offers may only include MP3-compatible files' };
  }
  if(!storageObjectPath) return { validationError:'Free-email files must use private marketplace-downloads storage' };
  return {
    file: {
      id,
      type,
      filename: cleanString(file.filename || file.name, 'download.mp3', 180).replace(/[\\/:*?"<>|]+/g, '-'),
      mimeType: mimeType || 'audio/mpeg',
      storageBucket: cleanString(file.storageBucket || file.storage_bucket, 'battle-mixes', 80) || 'battle-mixes',
      storageObjectPath,
      size: finiteInteger(file.size || file.file_size, null, { min:0 })
    }
  };
}

function normalizeAllowedFiles(value){
  const files = safeArray(value, 12);
  if(!files.length) return { validationError:'A free-email offer requires at least one explicit free download file' };
  const normalized = [];
  for(let index = 0; index < files.length; index += 1){
    const result = normalizeAllowedFile(files[index], index);
    if(result.validationError) return result;
    normalized.push(result.file);
  }
  return { files:normalized };
}

function sanitizeFreeEmailOffer(row, options = {}){
  if(!row) return null;
  const offer = {
    id: row.id,
    sellerUserId: row.seller_user_id,
    productId: row.product_id,
    listingId: row.listing_id,
    status: row.status,
    freeEmailEnabled: Boolean(row.free_email_enabled),
    verificationRequired: Boolean(row.verification_required),
    downloadConsentRequired: Boolean(row.download_consent_required),
    marketingConsentRequired: Boolean(row.marketing_consent_required),
    consentText: row.consent_text || '',
    consentVersion: row.consent_version || '',
    allowedFiles: safeArray(row.allowed_files).map(sanitizeAllowedFile).filter(Boolean),
    downloadLimit: row.download_limit == null ? null : Number(row.download_limit),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
  if(options.listing) offer.listing = sanitizeMarketplaceListing(options.listing, { product:options.product || null, rights:options.rights || null, ownerView:Boolean(options.ownerView) });
  return offer;
}

function sanitizeFreeEmailLead(row){
  if(!row) return null;
  return {
    id: row.id,
    email: row.email,
    userId: row.user_id || null,
    sellerUserId: row.seller_user_id,
    productId: row.product_id,
    listingId: row.listing_id,
    offerId: row.offer_id,
    downloadConsentStatus: row.download_consent_status,
    marketingConsentStatus: row.marketing_consent_status,
    consentText: row.consent_text_snapshot || '',
    consentVersion: row.consent_version || '',
    source: row.source || null,
    campaign: row.campaign || null,
    referrer: row.referrer || null,
    verificationStatus: row.verification_status,
    verificationDeliveryStatus: row.verification_delivery_status,
    entitlementId: row.entitlement_id || null,
    downloadStatus: row.download_status,
    claimedAt: row.claimed_at || null,
    verificationSentAt: row.verification_sent_at || null,
    verifiedAt: row.verified_at || null,
    downloadedAt: row.downloaded_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
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
  const result = await queryRows(dataClient, table, filters, 1);
  if(result.error) return result;
  return { row: result.rows[0] || null };
}

async function insertSingle(dataClient, table, row){
  const result = await dataClient.from(table).insert([row]).select('*').single();
  if(result.error) return { error: result.error };
  return { row: result.data };
}

async function updateRows(dataClient, table, filters, values){
  let query = dataClient.from(table).update(values).select('*');
  filters.forEach(([field, value]) => { query = query.eq(field, value); });
  const result = await query;
  if(result.error) return { error: result.error };
  return { rows:Array.isArray(result.data) ? result.data : [] };
}

async function loadFreeEmailOfferBundle(dataClient, listingId){
  const id = cleanIdentifier(listingId);
  if(!id) return { validationError:'A marketplace listing is required' };
  const offer = await querySingle(dataClient, MARKETPLACE_FREE_EMAIL_OFFER_TABLE, [['listing_id', id]]);
  if(offer.error) return { error:offer.error };
  if(!offer.row || offer.row.status !== 'active' || !offer.row.free_email_enabled) return { unavailable:true };
  const listing = await querySingle(dataClient, MARKETPLACE_LISTING_TABLE, [['id', id]]);
  if(listing.error) return { error:listing.error };
  if(!listing.row || listing.row.status !== 'published') return { unavailable:true };
  const product = await querySingle(dataClient, MARKETPLACE_PRODUCT_TABLE, [['id', listing.row.product_id]]);
  if(product.error) return { error:product.error };
  if(!product.row || product.row.status !== 'active') return { unavailable:true };
  const rights = await querySingle(dataClient, MARKETPLACE_RIGHTS_TABLE, [['product_id', product.row.id]]);
  if(rights.error) return { error:rights.error };
  if(!rights.row || rights.row.status !== 'active' || !rights.row.marketplace_streaming_allowed || !rights.row.download_allowed) return { unavailable:true };
  if(String(offer.row.seller_user_id) !== String(listing.row.seller_user_id) || String(offer.row.product_id) !== String(product.row.id)) return { unavailable:true };
  const files = normalizeAllowedFiles(offer.row.allowed_files);
  if(files.validationError) return files;
  return { offer:offer.row, listing:listing.row, product:product.row, rights:rights.row, files:files.files };
}

async function createFreeEmailOffer(dataClient, sellerUserId, input = {}, now = new Date()){
  const listingId = cleanIdentifier(input.listingId || input.listing_id);
  if(!listingId || !sellerUserId) return { validationError:'Seller and listing are required' };
  const listing = await querySingle(dataClient, MARKETPLACE_LISTING_TABLE, [['id', listingId]]);
  if(listing.error) return { error:listing.error };
  if(!listing.row || listing.row.status === 'archived') return { unavailable:true };
  if(String(listing.row.seller_user_id) !== String(sellerUserId)) return { forbidden:true };
  const product = await querySingle(dataClient, MARKETPLACE_PRODUCT_TABLE, [['id', listing.row.product_id]]);
  if(product.error) return { error:product.error };
  if(!product.row || product.row.status !== 'active') return { unavailable:true };
  const rights = await querySingle(dataClient, MARKETPLACE_RIGHTS_TABLE, [['product_id', product.row.id]]);
  if(rights.error) return { error:rights.error };
  if(!rights.row || rights.row.status !== 'active' || !rights.row.marketplace_streaming_allowed || !rights.row.download_allowed) return { unavailable:true };
  const allowed = normalizeAllowedFiles(input.allowedFiles || input.allowed_files);
  if(allowed.validationError) return allowed;

  const timestamp = nowIso(now);
  const payload = {
    id: cleanIdentifier(input.offerId || input.offer_id) || stableId('mp_free_offer', { listingId }),
    seller_user_id: String(sellerUserId),
    product_id: product.row.id,
    listing_id: listing.row.id,
    status: cleanEnum(input.status || (input.enabled === false ? 'paused' : 'active'), OFFER_STATUSES, 'active'),
    free_email_enabled: input.freeEmailEnabled == null && input.free_email_enabled == null ? input.enabled !== false : Boolean(input.freeEmailEnabled != null ? input.freeEmailEnabled : input.free_email_enabled),
    verification_required: Boolean(input.verificationRequired != null ? input.verificationRequired : input.verification_required),
    download_consent_required: input.downloadConsentRequired == null && input.download_consent_required == null ? true : Boolean(input.downloadConsentRequired != null ? input.downloadConsentRequired : input.download_consent_required),
    marketing_consent_required: Boolean(input.marketingConsentRequired != null ? input.marketingConsentRequired : input.marketing_consent_required),
    consent_text: cleanString(input.consentText || input.consent_text, 'Send me this free download and record my claim for access.', 1200),
    consent_version: cleanString(input.consentVersion || input.consent_version, 'v1', 80) || 'v1',
    allowed_files: allowed.files,
    download_limit: finiteInteger(input.downloadLimit || input.download_limit, 1, { min:1, max:100 }),
    created_at: timestamp,
    updated_at: timestamp
  };

  const existing = await querySingle(dataClient, MARKETPLACE_FREE_EMAIL_OFFER_TABLE, [['listing_id', listingId]]);
  if(existing.error) return { error:existing.error };
  if(existing.row){
    const updated = await updateRows(dataClient, MARKETPLACE_FREE_EMAIL_OFFER_TABLE, [['id', existing.row.id]], {
      ...payload,
      id:existing.row.id,
      created_at:existing.row.created_at || payload.created_at,
      updated_at:timestamp
    });
    if(updated.error) return { error:updated.error };
    return { updated:true, offer:sanitizeFreeEmailOffer(updated.rows[0] || { ...existing.row, ...payload }, { listing:listing.row, product:product.row, rights:rights.row, ownerView:true }) };
  }

  const inserted = await insertSingle(dataClient, MARKETPLACE_FREE_EMAIL_OFFER_TABLE, payload);
  if(inserted.error) return { error:inserted.error };
  return { created:true, offer:sanitizeFreeEmailOffer(inserted.row, { listing:listing.row, product:product.row, rights:rights.row, ownerView:true }) };
}

function checkClaimRateLimit(input, email, now, options = {}){
  const rateLimit = options.rateLimit === false ? null : { ...DEFAULT_CLAIM_LIMIT, ...safeObject(options.rateLimit) };
  if(!rateLimit) return { ok:true };
  const max = finiteInteger(rateLimit.max, DEFAULT_CLAIM_LIMIT.max, { min:1, max:1000 });
  const windowMs = finiteInteger(rateLimit.windowMs, DEFAULT_CLAIM_LIMIT.windowMs, { min:1000, max:24 * 60 * 60 * 1000 });
  const state = rateLimit.state || defaultClaimRateState;
  const timestamp = now instanceof Date ? now.getTime() : new Date(now || Date.now()).getTime();
  const listingId = cleanIdentifier(input.listingId || input.listing_id);
  const key = cleanString(input.requesterKey || input.requester_key || email, email, 220).toLowerCase();
  const bucketKey = `${listingId}:${key}`;
  const attempts = (state.get(bucketKey) || []).filter(value => timestamp - value < windowMs);
  if(attempts.length >= max) return { rateLimited:true };
  attempts.push(timestamp);
  state.set(bucketKey, attempts);
  return { ok:true };
}

function createFreeEmailVerificationAdapter(config = {}){
  const gateway = config.gateway && typeof config.gateway.sendVerificationEmail === 'function' ? config.gateway : null;
  return {
    configured:Boolean(gateway),
    async sendVerificationEmail(lead, verification){
      if(!gateway) return { unconfigured:true };
      const result = await gateway.sendVerificationEmail(lead, verification);
      if(!result || result.unconfigured) return { unconfigured:true };
      if(result.error) return { error:result.error };
      return { sent:true, deliveryId:cleanString(result.deliveryId || result.id, '', 160) || null };
    }
  };
}

async function findExistingLead(dataClient, offerId, email){
  return querySingle(dataClient, MARKETPLACE_FREE_EMAIL_LEAD_TABLE, [['offer_id', offerId], ['email', email]]);
}

function publicClaimResult(lead, options = {}, secrets = {}){
  const response = { lead:sanitizeFreeEmailLead(lead) };
  if(secrets.verificationToken && options.exposeVerificationToken) response.verificationToken = secrets.verificationToken;
  if(secrets.downloadAccessToken && options.exposeDownloadAccessToken) response.downloadAccessToken = secrets.downloadAccessToken;
  return response;
}

async function createOrReuseFreeEmailEntitlement(dataClient, lead, offer, files, timestamp, downloadAccessToken){
  const existingByLead = await querySingle(dataClient, MARKETPLACE_ENTITLEMENT_TABLE, [['originating_lead_id', lead.id]]);
  if(existingByLead.error) return { error:existingByLead.error };
  if(existingByLead.row){
    return { entitlement:sanitizeMarketplaceEntitlement(existingByLead.row), rawEntitlement:existingByLead.row, duplicate:true };
  }
  const buyerPrincipal = lead.user_id || emailPrincipalFor(lead.email);
  const existingByEmail = await querySingle(dataClient, MARKETPLACE_ENTITLEMENT_TABLE, [['source', FREE_EMAIL_ENTITLEMENT_SOURCE], ['listing_id', lead.listing_id], ['buyer_email', lead.email]]);
  if(existingByEmail.error) return { error:existingByEmail.error };
  if(existingByEmail.row){
    return { entitlement:sanitizeMarketplaceEntitlement(existingByEmail.row), rawEntitlement:existingByEmail.row, duplicate:true };
  }
  const payload = {
    id: stableId('mp_ent_free', { leadId:lead.id, listingId:lead.listing_id, email:lead.email }),
    product_id: lead.product_id,
    listing_id: lead.listing_id,
    user_id: buyerPrincipal,
    buyer_email: lead.email,
    entitlement_type: 'download',
    source: FREE_EMAIL_ENTITLEMENT_SOURCE,
    status: 'active',
    license_type: 'free_email',
    originating_order_id: null,
    originating_lead_id: lead.id,
    allowed_files: files,
    download_limit: offer.download_limit == null ? 1 : offer.download_limit,
    download_count: 0,
    access_policy: {
      origin: FREE_EMAIL_ENTITLEMENT_SOURCE,
      leadId: lead.id,
      downloadAccessTokenHash: secretHash(downloadAccessToken)
    },
    starts_at: timestamp,
    expires_at: null,
    granted_by: 'free_email_claim',
    grant_reason: 'Verified free download for email lead claim',
    created_at: timestamp,
    updated_at: timestamp
  };
  const inserted = await insertSingle(dataClient, MARKETPLACE_ENTITLEMENT_TABLE, payload);
  if(inserted.error) return { error:inserted.error };
  return { entitlement:sanitizeMarketplaceEntitlement(inserted.row), rawEntitlement:inserted.row, created:true };
}

async function attachEntitlementToLead(dataClient, lead, entitlement, downloadAccessToken, timestamp, verificationStatus){
  const updates = {
    verification_status: cleanEnum(verificationStatus, VERIFICATION_STATUSES, lead.verification_status),
    entitlement_id: entitlement.id,
    download_status: 'available',
    download_access_token_hash: secretHash(downloadAccessToken),
    updated_at: timestamp
  };
  if(verificationStatus === 'verified') updates.verified_at = timestamp;
  const updated = await updateRows(dataClient, MARKETPLACE_FREE_EMAIL_LEAD_TABLE, [['id', lead.id]], updates);
  if(updated.error) return { error:updated.error };
  return { lead:updated.rows[0] || { ...lead, ...updates } };
}

async function claimFreeEmailDownload(dataClient, emailAdapter, userId, input = {}, now = new Date(), options = {}){
  const email = normalizeEmail(input.email || input.buyerEmail || input.buyer_email);
  if(!email) return { validationError:'A valid email address is required' };
  if(input.allowedFiles || input.allowed_files || input.storageObjectPath || input.storage_object_path || input.fileId || input.file_id){
    return { validationError:'Client-provided free-download files are not accepted' };
  }
  const rate = checkClaimRateLimit(input, email, now, options);
  if(rate.rateLimited) return { rateLimited:true };
  const bundle = await loadFreeEmailOfferBundle(dataClient, input.listingId || input.listing_id);
  if(bundle.error || bundle.unavailable || bundle.validationError) return bundle;
  const { offer, listing, product, rights, files } = bundle;
  if(offer.download_consent_required && input.downloadConsentAccepted !== true && input.download_consent_accepted !== true){
    return { validationError:'Download consent is required for this free download' };
  }
  const marketingAccepted = input.marketingConsentAccepted === true || input.marketing_consent_accepted === true;
  if(offer.marketing_consent_required && !marketingAccepted){
    return { validationError:'Marketing consent is required for this offer' };
  }
  const existing = await findExistingLead(dataClient, offer.id, email);
  if(existing.error) return { error:existing.error };
  if(existing.row){
    return { duplicate:true, ...publicClaimResult(existing.row, options) };
  }

  const timestamp = nowIso(now);
  const verificationRequired = Boolean(offer.verification_required);
  const verificationToken = verificationRequired ? `${randomUUID()}-${randomUUID()}` : null;
  const leadPayload = {
    id: cleanIdentifier(input.leadId || input.lead_id) || stableId('mp_free_lead', { offerId:offer.id, email }),
    offer_id: offer.id,
    email,
    user_id: userId ? String(userId) : null,
    seller_user_id: offer.seller_user_id,
    product_id: product.id,
    listing_id: listing.id,
    download_consent_status: offer.download_consent_required ? 'accepted' : 'not_required',
    marketing_consent_status: marketingAccepted ? 'accepted' : (offer.marketing_consent_required ? 'required' : 'declined'),
    consent_text_snapshot: offer.consent_text || '',
    consent_version: offer.consent_version || '',
    source: cleanString(input.source, '', 120) || null,
    campaign: cleanString(input.campaign, '', 120) || null,
    referrer: cleanString(input.referrer, '', 500) || null,
    verification_status: verificationRequired ? 'pending' : 'not_required',
    verification_delivery_status: verificationRequired ? 'pending' : 'not_required',
    verification_token_hash: verificationRequired ? secretHash(verificationToken) : null,
    verification_sent_at: null,
    verified_at: null,
    entitlement_id: null,
    download_status: verificationRequired ? 'locked' : 'available',
    download_access_token_hash: null,
    downloaded_at: null,
    claimed_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp
  };
  const inserted = await insertSingle(dataClient, MARKETPLACE_FREE_EMAIL_LEAD_TABLE, leadPayload);
  if(inserted.error) return { error:inserted.error };
  let lead = inserted.row;

  if(verificationRequired){
    const adapter = emailAdapter || createFreeEmailVerificationAdapter();
    const delivery = await adapter.sendVerificationEmail(sanitizeFreeEmailLead(lead), { token:verificationToken, listing:sanitizeMarketplaceListing(listing, { product, rights }) });
    if(delivery.error) return { error:delivery.error };
    const deliveryStatus = delivery.unconfigured ? 'unconfigured' : 'sent';
    const deliveryUpdate = {
      verification_delivery_status: deliveryStatus,
      verification_sent_at: deliveryStatus === 'sent' ? timestamp : null,
      updated_at: timestamp
    };
    const updated = await updateRows(dataClient, MARKETPLACE_FREE_EMAIL_LEAD_TABLE, [['id', lead.id]], deliveryUpdate);
    if(updated.error) return { error:updated.error };
    lead = updated.rows[0] || { ...lead, ...deliveryUpdate };
    return {
      verificationRequired:true,
      deliveryConfigured:deliveryStatus === 'sent',
      deliveryStatus,
      offer:sanitizeFreeEmailOffer(offer, { listing, product, rights }),
      ...publicClaimResult(lead, options, { verificationToken })
    };
  }

  const downloadAccessToken = `${randomUUID()}-${randomUUID()}`;
  const entitlement = await createOrReuseFreeEmailEntitlement(dataClient, lead, offer, files, timestamp, downloadAccessToken);
  if(entitlement.error) return { error:entitlement.error };
  const attached = await attachEntitlementToLead(dataClient, lead, entitlement.rawEntitlement, downloadAccessToken, timestamp, 'not_required');
  if(attached.error) return { error:attached.error };
  return {
    claimed:true,
    verificationRequired:false,
    entitlement:entitlement.entitlement,
    offer:sanitizeFreeEmailOffer(offer, { listing, product, rights }),
    ...publicClaimResult(attached.lead, options, { downloadAccessToken })
  };
}

async function verifyFreeEmailLead(dataClient, input = {}, now = new Date(), options = {}){
  const leadId = cleanIdentifier(input.leadId || input.lead_id);
  const token = cleanString(input.verificationToken || input.verification_token, '', 200);
  if(!leadId || !token) return { validationError:'Lead and verification token are required' };
  const leadResult = await querySingle(dataClient, MARKETPLACE_FREE_EMAIL_LEAD_TABLE, [['id', leadId]]);
  if(leadResult.error) return { error:leadResult.error };
  if(!leadResult.row) return { unavailable:true };
  const lead = leadResult.row;
  if(lead.entitlement_id){
    return { duplicate:true, ...publicClaimResult(lead, options) };
  }
  if(lead.verification_status !== 'pending' || !safeEqualHash(lead.verification_token_hash, token)){
    return { forbidden:true };
  }
  const bundle = await loadFreeEmailOfferBundle(dataClient, lead.listing_id);
  if(bundle.error || bundle.unavailable || bundle.validationError) return bundle;
  const timestamp = nowIso(now);
  const downloadAccessToken = `${randomUUID()}-${randomUUID()}`;
  const entitlement = await createOrReuseFreeEmailEntitlement(dataClient, lead, bundle.offer, bundle.files, timestamp, downloadAccessToken);
  if(entitlement.error) return { error:entitlement.error };
  const attached = await attachEntitlementToLead(dataClient, lead, entitlement.rawEntitlement, downloadAccessToken, timestamp, 'verified');
  if(attached.error) return { error:attached.error };
  return {
    verified:true,
    entitlement:entitlement.entitlement,
    offer:sanitizeFreeEmailOffer(bundle.offer, { listing:bundle.listing, product:bundle.product, rights:bundle.rights }),
    ...publicClaimResult(attached.lead, options, { downloadAccessToken })
  };
}

async function issueFreeEmailLeadDownloadAccess(dataClient, storage, input = {}, now = new Date()){
  const leadId = cleanIdentifier(input.leadId || input.lead_id);
  const token = cleanString(input.downloadAccessToken || input.download_access_token, '', 200);
  if(!leadId || !token) return { validationError:'Lead and download access token are required' };
  const leadResult = await querySingle(dataClient, MARKETPLACE_FREE_EMAIL_LEAD_TABLE, [['id', leadId]]);
  if(leadResult.error) return { error:leadResult.error };
  if(!leadResult.row || !leadResult.row.entitlement_id) return { unavailable:true };
  const lead = leadResult.row;
  if(lead.download_status !== 'available' && lead.download_status !== 'downloaded') return { forbidden:true };
  if(!safeEqualHash(lead.download_access_token_hash, token)) return { forbidden:true };
  const entitlementResult = await querySingle(dataClient, MARKETPLACE_ENTITLEMENT_TABLE, [['id', lead.entitlement_id]]);
  if(entitlementResult.error) return { error:entitlementResult.error };
  if(!entitlementResult.row) return { unavailable:true };
  const requestedFileId = cleanIdentifier(input.fileId || input.file_id);
  if(requestedFileId){
    const allowedFiles = safeArray(entitlementResult.row.allowed_files).filter(file => safeStoragePath(file.storageObjectPath || file.storage_object_path));
    if(!allowedFiles.some(file => String(file.id) === String(requestedFileId))) return { unavailable:true };
  }
  const principal = lead.user_id || emailPrincipalFor(lead.email);
  const access = await issueMarketplaceDownloadAccess(dataClient, storage, principal, {
    entitlementId: lead.entitlement_id,
    fileId: input.fileId || input.file_id,
    downloadSessionId: input.downloadSessionId || input.download_session_id
  }, now);
  if(access.downloadAccess){
    const timestamp = nowIso(now);
    await updateRows(dataClient, MARKETPLACE_FREE_EMAIL_LEAD_TABLE, [['id', lead.id]], {
      download_status:'downloaded',
      downloaded_at:timestamp,
      updated_at:timestamp
    });
  }
  return access;
}

async function listSellerFreeEmailLeads(dataClient, sellerUserId, options = {}){
  const seller = cleanIdentifier(sellerUserId);
  if(!seller) return { validationError:'Seller is required' };
  const result = await queryRows(dataClient, MARKETPLACE_FREE_EMAIL_LEAD_TABLE, [['seller_user_id', seller]], 500);
  if(result.error) return { error:result.error };
  let rows = result.rows;
  const listingId = cleanIdentifier(options.listingId || options.listing_id);
  if(listingId) rows = rows.filter(row => String(row.listing_id) === String(listingId));
  rows.sort((a, b) => String(b.claimed_at || b.created_at || '').localeCompare(String(a.claimed_at || a.created_at || '')));
  const limit = finiteInteger(options.limit, 100, { min:1, max:500 });
  return { leads:rows.slice(0, limit).map(sanitizeFreeEmailLead) };
}

async function checkMarketplaceFreeEmailSchemaReadiness(dataClient){
  if(!dataClient) return { ready:false, schema:MARKETPLACE_FREE_EMAIL_SCHEMA, status:'unconfigured', message:'Supabase service client is not configured.' };
  const tables = [
    MARKETPLACE_FREE_EMAIL_OFFER_TABLE,
    MARKETPLACE_FREE_EMAIL_LEAD_TABLE,
    MARKETPLACE_ENTITLEMENT_TABLE
  ];
  try{
    for(const table of tables){
      const result = await dataClient.from(table).select('id').limit(1);
      if(result.error){
        const message = String(result.error.message || result.error);
        const missing = /marketplace_|relation|schema|does not exist|not found|cache/i.test(message);
        return {
          ready:false,
          schema:MARKETPLACE_FREE_EMAIL_SCHEMA,
          status:missing ? 'migration_required' : 'failed',
          message:missing ? 'Marketplace free-email schema 024 is not available.' : 'Marketplace free-email schema readiness check failed.'
        };
      }
    }
    return { ready:true, schema:MARKETPLACE_FREE_EMAIL_SCHEMA, status:'ready', message:'Marketplace free-email schema 024 is available.' };
  }catch(err){
    return { ready:false, schema:MARKETPLACE_FREE_EMAIL_SCHEMA, status:'failed', message:'Marketplace free-email schema readiness check failed.' };
  }
}

module.exports = {
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
  loadFreeEmailOfferBundle,
  normalizeEmail,
  sanitizeFreeEmailLead,
  sanitizeFreeEmailOffer,
  verifyFreeEmailLead
};
