// Free Beat Store: the glue between a library track, a published marketplace listing and a
// free-for-email offer. Paid checkout is deliberately not part of this slice.
const { MIX_BUCKET } = require('./battle_submission');
const { LIBRARY_TRACK_TABLE } = require('./music_library');
const {
  MARKETPLACE_LISTING_TABLE,
  MARKETPLACE_PRODUCT_TABLE,
  RIGHTS_CLASSIFICATIONS_ALLOWED_FOR_MARKETPLACE,
  rightsClassificationAllowsMarketplace,
  sanitizeMarketplaceListing
} = require('./marketplace_foundation');
const { MARKETPLACE_FREE_EMAIL_OFFER_TABLE, MARKETPLACE_FREE_EMAIL_LEAD_TABLE } = require('./marketplace_free_email');

const MP3_MIME_TYPES = ['audio/mpeg', 'audio/mp3'];
const RIGHTS_LABELS = { original:'Original', licensed:'Licensed', royalty_free:'Royalty-free', platform_cleared:'Platform-cleared' };

function cleanId(value){
  const text = String(value == null ? '' : value).trim();
  return /^[A-Za-z0-9._:-]{1,128}$/.test(text) ? text : '';
}

function rightsMessage(classification){
  const allowed = RIGHTS_CLASSIFICATIONS_ALLOWED_FOR_MARKETPLACE.map(key => RIGHTS_LABELS[key] || key).join(', ');
  const current = String(classification || 'unknown').replace(/_/g, ' ');
  return `Only music you made or are cleared to share can go in the Beat Store. This track's rights are "${current}"; it needs to be one of: ${allowed}.`;
}

function trackIsMp3(track){
  const mime = String(track && (track.verified_mime_type || track.declared_mime_type) || '').toLowerCase();
  if(MP3_MIME_TYPES.includes(mime)) return true;
  if(mime) return false;
  return /\.mp3$/i.test(String(track && (track.original_filename || track.audio_storage_object_path) || ''));
}

function freeBeatEligibility(track){
  if(!track) return { ok:false, code:'missing', reason:'Choose one of your own tracks.' };
  if(!rightsClassificationAllowsMarketplace(track.rights_classification || track.rightsClassification)){
    return { ok:false, code:'rights', reason:rightsMessage(track.rights_classification || track.rightsClassification) };
  }
  if(!String(track.audio_storage_object_path || '').startsWith('private/library-audio/') && !String(track.audio_storage_object_path || '').startsWith('private/battle-entries/')){
    return { ok:false, code:'audio', reason:'Upload this track\'s audio to your account first.' };
  }
  if(!trackIsMp3(track)) return { ok:false, code:'format', reason:'Free downloads must be MP3 files. WAV and other formats stay private.' };
  return { ok:true };
}

async function one(dataClient, table, field, value){
  let query = dataClient.from(table).select('*').eq(field, value);
  if(typeof query.limit === 'function') query = query.limit(1);
  const result = await query;
  if(result.error) return { error:result.error };
  return { row:Array.isArray(result.data) ? result.data[0] || null : result.data || null };
}

function downloadFileName(title){
  const base = String(title || 'free-beat').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'free-beat';
  return /\.mp3$/i.test(base) ? base : `${base}.mp3`;
}

// Copies the listing's verified MP3 into private/marketplace-downloads/ (the only place a
// free-email offer may serve from) and returns the file entry for /freeEmail/offers.
async function prepareFreeDownloadFile(dataClient, storage, userId, listingId){
  const owner = cleanId(userId);
  const id = cleanId(listingId);
  if(!owner || !id) return { validationError:'A listing is required' };
  const listing = await one(dataClient, MARKETPLACE_LISTING_TABLE, 'id', id);
  if(listing.error) return listing;
  if(!listing.row || listing.row.status === 'archived') return { unavailable:true };
  if(String(listing.row.seller_user_id) !== owner) return { forbidden:true };
  const product = await one(dataClient, MARKETPLACE_PRODUCT_TABLE, 'id', listing.row.product_id);
  if(product.error) return product;
  if(!product.row || product.row.status !== 'active') return { unavailable:true };
  const track = product.row.library_track_id ? await one(dataClient, LIBRARY_TRACK_TABLE, 'id', product.row.library_track_id) : { row:null };
  if(track.error) return track;
  const source = track.row || product.row;
  if(track.row && String(track.row.user_id) !== owner) return { forbidden:true };
  const eligibility = freeBeatEligibility({ ...source, rights_classification:product.row.rights_classification, audio_storage_object_path:product.row.audio_storage_object_path });
  if(!eligibility.ok) return { validationError:eligibility.reason, code:eligibility.code };
  const target = `private/marketplace-downloads/${owner}/${id}/free.mp3`;
  if(!storage || typeof storage.copy !== 'function') return { error:new Error('Storage copy unavailable') };
  const copied = await storage.copy(product.row.audio_storage_object_path, target);
  if(copied && copied.error && !/exist|duplicate/i.test(String(copied.error.message || copied.error))) return { error:copied.error };
  return {
    file:{
      id:'free-mp3',
      type:'mp3',
      filename:downloadFileName(listing.row.title || product.row.title),
      mimeType:'audio/mpeg',
      storageBucket:product.row.audio_storage_bucket || MIX_BUCKET,
      storageObjectPath:target,
      size:source.file_size == null ? null : Number(source.file_size)
    }
  };
}

async function offersForListings(dataClient, listingIds){
  const ids = Array.from(new Set((listingIds || []).map(cleanId).filter(Boolean)));
  const byListing = new Map();
  if(!ids.length) return { byListing };
  let query = dataClient.from(MARKETPLACE_FREE_EMAIL_OFFER_TABLE).select('*');
  if(typeof query.in === 'function') query = query.in('listing_id', ids);
  if(typeof query.limit === 'function') query = query.limit(1000);
  const result = await query;
  if(result.error) return { error:result.error, byListing };
  (result.data || []).forEach(row => { if(ids.includes(String(row.listing_id))) byListing.set(String(row.listing_id), row); });
  return { byListing };
}

function publicOfferSummary(row){
  if(!row || row.status !== 'active' || !row.free_email_enabled) return null;
  return {
    offerId:row.id,
    verificationRequired:Boolean(row.verification_required),
    downloadConsentRequired:Boolean(row.download_consent_required),
    marketingConsentRequired:Boolean(row.marketing_consent_required),
    consentText:String(row.consent_text || ''),
    consentVersion:String(row.consent_version || '')
  };
}

// Adds `freeDownload` to catalog listings in one query. A missing offers table (SQL 024 not
// run yet) simply means no listing is free yet.
async function attachFreeOffers(dataClient, listings){
  const rows = Array.isArray(listings) ? listings : [];
  if(!rows.length) return { listings:rows };
  const offers = await offersForListings(dataClient, rows.map(row => row && row.id));
  rows.forEach(row => { if(row) row.freeDownload = publicOfferSummary(offers.byListing.get(String(row.id))); });
  return { listings:rows, offersUnavailable:Boolean(offers.error) };
}

// The seller's own Beat Store listings with how many people claimed each one.
async function listSellerStoreListings(dataClient, userId){
  const owner = cleanId(userId);
  if(!owner) return { validationError:'Seller is required' };
  let query = dataClient.from(MARKETPLACE_LISTING_TABLE).select('*').eq('seller_user_id', owner);
  if(typeof query.limit === 'function') query = query.limit(200);
  const listingsResult = await query;
  if(listingsResult.error) return { error:listingsResult.error };
  const listings = (listingsResult.data || []).filter(row => String(row.seller_user_id) === owner && row.status !== 'archived');
  const productIds = Array.from(new Set(listings.map(row => row.product_id).filter(Boolean)));
  const products = new Map();
  if(productIds.length){
    let productQuery = dataClient.from(MARKETPLACE_PRODUCT_TABLE).select('*');
    productQuery = typeof productQuery.in === 'function' ? productQuery.in('id', productIds) : productQuery.eq('creator_user_id', owner);
    const productResult = await productQuery;
    if(productResult.error) return { error:productResult.error };
    (productResult.data || []).forEach(row => products.set(String(row.id), row));
  }
  const offers = await offersForListings(dataClient, listings.map(row => row.id));
  let leadQuery = dataClient.from(MARKETPLACE_FREE_EMAIL_LEAD_TABLE).select('*').eq('seller_user_id', owner);
  if(typeof leadQuery.limit === 'function') leadQuery = leadQuery.limit(2000);
  const leads = await leadQuery;
  const counts = new Map();
  const bump = (listingId, field) => {
    const entry = counts.get(listingId) || { claims:0, downloads:0, confirmed:0, unconfirmed:0, optedIn:0 };
    entry[field] += 1;
    counts.set(listingId, entry);
  };
  if(!leads.error) (leads.data || []).forEach(row => {
    if(String(row.seller_user_id) !== owner) return;
    const listingId = String(row.listing_id);
    bump(listingId, 'claims');
    if(row.download_status === 'downloaded' || row.downloaded_at) bump(listingId, 'downloads');
    if(row.verification_status === 'verified') bump(listingId, 'confirmed');
    else bump(listingId, 'unconfirmed');
    if(row.marketing_consent_status === 'accepted') bump(listingId, 'optedIn');
  });
  const empty = { claims:0, downloads:0, confirmed:0, unconfirmed:0, optedIn:0 };
  const rows = listings.map(row => {
    const c = counts.get(String(row.id)) || empty;
    return {
      ...sanitizeMarketplaceListing(row, { product:products.get(String(row.product_id)) || null, ownerView:true }),
      freeDownload:publicOfferSummary(offers.byListing.get(String(row.id))),
      claimCount:c.claims,
      downloadCount:c.downloads,
      confirmedCount:c.confirmed,
      unconfirmedCount:c.unconfirmed,
      optedInCount:c.optedIn
    };
  });
  const totals = rows.reduce((sum, row) => ({
    claims:sum.claims + row.claimCount,
    downloads:sum.downloads + row.downloadCount,
    confirmed:sum.confirmed + row.confirmedCount,
    unconfirmed:sum.unconfirmed + row.unconfirmedCount,
    optedIn:sum.optedIn + row.optedInCount
  }), { ...empty });
  return {
    listings:rows,
    totals,
    leadsUnavailable:Boolean(leads.error)
  };
}

module.exports = {
  MP3_MIME_TYPES,
  attachFreeOffers,
  freeBeatEligibility,
  listSellerStoreListings,
  prepareFreeDownloadFile,
  publicOfferSummary,
  rightsMessage,
  trackIsMp3
};
