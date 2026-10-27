// Oct 25: beat share links that credit the DJ who shared.
// A signed-in DJ gets one short code per beat (?beat=<listing>&ref=<code>). Visits and preview
// plays through the link are counted once per visitor per day, storing only a salted hash.
// Paid orders carry the code in provider_metadata.shareCode. Sellers see counts per sharer by
// display name only: no user ids, public ids, buyer details or visitor data ever leave here.
const crypto = require('crypto');
const { isMissingTable, profilesFor, newId } = require('./social_helpers');

const SCHEMA = '053_create_beat_share_links';
const LINKS = 'marketplace_share_links';
const EVENTS = 'marketplace_share_events';
const KINDS = ['visit', 'play'];
const EARNING = ['paid', 'partially_refunded'];
const CODE_RE = /^[a-z0-9]{10}$/;
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

function newCode(){ const bytes = crypto.randomBytes(10); return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join(''); }
function cleanCode(code){ const c = String(code || '').trim().toLowerCase(); return CODE_RE.test(c) ? c : null; }
function cleanListingId(id){ const s = String(id || '').trim(); return /^[A-Za-z0-9_-]{1,128}$/.test(s) ? s : null; }
const missing = r => r && r.error && isMissingTable(r.error);

function shareUrl(base, listingId, code){
  const root = String(base || '').replace(/\/+$/, '');
  return `${root}/index.html?beat=${encodeURIComponent(listingId)}&ref=${code}#store`;
}

async function createShareLink(db, userId, listingId, { baseUrl = '' } = {}){
  const id = cleanListingId(listingId);
  if(!userId) return { validationError:'Sign in to get a share link' };
  if(!id) return { validationError:'A beat is required' };
  const listing = await db.from('marketplace_listings').select('*').eq('id', id).limit(1);
  if(listing.error) return { error:listing.error };
  const row = (listing.data || [])[0];
  if(!row || row.status !== 'published') return { unavailable:true };
  const existing = await db.from(LINKS).select('*').eq('listing_id', id).eq('sharer_user_id', String(userId)).limit(1);
  if(missing(existing)) return { schemaMissing:true, schema:SCHEMA };
  if(existing.error) return { error:existing.error };
  let code = existing.data && existing.data[0] && existing.data[0].code;
  if(!code){
    code = newCode();
    const ins = await db.from(LINKS).insert([{ code, listing_id:id, sharer_user_id:String(userId), created_at:new Date().toISOString() }]);
    if(missing(ins)) return { schemaMissing:true, schema:SCHEMA };
    if(ins.error) return { error:ins.error };
  }
  return { code, listingId:id, url:shareUrl(baseUrl, id, code) };
}

async function linkFor(db, code){
  const c = cleanCode(code);
  if(!c) return { row:null };
  const r = await db.from(LINKS).select('*').eq('code', c).limit(1);
  if(missing(r)) return { schemaMissing:true };
  if(r.error) return { error:r.error };
  return { row:(r.data || [])[0] || null };
}

function visitorHash(visitor = {}, day, salt){
  const basis = visitor.visitorId ? `v:${String(visitor.visitorId).slice(0, 80)}` : `n:${visitor.ip || ''}|${visitor.userAgent || ''}|${visitor.acceptLanguage || ''}`;
  return crypto.createHash('sha256').update(`${salt || 'djb-share'}|${day}|${basis}`).digest('hex');
}

// Counts one visit or play for a share link. Silent no-ops for bad codes, the sharer themself, or repeats.
async function recordShareEvent(db, { code, listingId, kind, visitor, viewerUserId, salt, now = new Date() }){
  if(!KINDS.includes(kind)) return { validationError:'Unknown share event' };
  const link = await linkFor(db, code);
  if(link.schemaMissing) return { schemaMissing:true, schema:SCHEMA };
  if(link.error) return { error:link.error };
  if(!link.row) return { skipped:'unknown_code' };
  if(listingId && String(listingId) !== String(link.row.listing_id)) return { skipped:'wrong_beat' };
  if(viewerUserId && String(viewerUserId) === String(link.row.sharer_user_id)) return { skipped:'own_link' };
  const day = now.toISOString().slice(0, 10);
  const hash = visitorHash(visitor, day, salt);
  const seen = await db.from(EVENTS).select('id').eq('code', link.row.code).eq('kind', kind).eq('visitor_hash', hash).eq('day', day).limit(1);
  if(seen.error) return { error:seen.error };
  if((seen.data || []).length) return { skipped:'repeat' };
  const ins = await db.from(EVENTS).insert([{ id:newId('shev'), code:link.row.code, listing_id:link.row.listing_id, kind, visitor_hash:hash, day, created_at:now.toISOString() }]);
  if(ins.error){ if(/duplicate|unique/i.test(String(ins.error.message || ''))) return { skipped:'repeat' }; return { error:ins.error }; }
  return { counted:true };
}

// For checkout: the code to credit on this order, or null. A buyer can't credit their own link.
async function shareCodeForCheckout(db, code, listingId, buyerUserId){
  try{
    const link = await linkFor(db, code);
    if(!link.row) return null;
    if(String(link.row.listing_id) !== String(listingId)) return null;
    if(buyerUserId && String(link.row.sharer_user_id) === String(buyerUserId)) return null;
    return link.row.code;
  }catch(_){ return null; }
}

// Seller view: per beat, per sharer (display name only) visits, plays, sales, earnings.
async function sellerShareStats(db, sellerUserId){
  const owner = String(sellerUserId || '');
  if(!owner) return { validationError:'A seller is required' };
  const listings = await db.from('marketplace_listings').select('*').eq('seller_user_id', owner).limit(500);
  if(listings.error) return { error:listings.error };
  const mine = (listings.data || []).filter(l => String(l.seller_user_id) === owner);
  if(!mine.length) return { rows:[], totals:{ visits:0, plays:0, sales:0, earningsCents:0, sharers:0 } };
  const ids = mine.map(l => String(l.id));
  const titles = new Map(mine.map(l => [String(l.id), l.title || 'Beat']));
  const links = await db.from(LINKS).select('*').in('listing_id', ids);
  if(missing(links)) return { schemaMissing:true, schema:SCHEMA };
  if(links.error) return { error:links.error };
  const linkRows = (links.data || []).filter(l => ids.includes(String(l.listing_id)));
  if(!linkRows.length) return { rows:[], totals:{ visits:0, plays:0, sales:0, earningsCents:0, sharers:0 } };
  const codes = linkRows.map(l => l.code);
  const events = await db.from(EVENTS).select('*').in('code', codes);
  if(events.error) return { error:events.error };
  const orders = await db.from('marketplace_orders').select('*').eq('seller_user_id', owner).limit(1000);
  if(orders.error) return { error:orders.error };
  const people = await profilesFor(db, linkRows.map(l => l.sharer_user_id));
  const byCode = new Map(linkRows.map(l => [l.code, { listingId:String(l.listing_id), listingTitle:titles.get(String(l.listing_id)), sharerName:(people.get(String(l.sharer_user_id)) || {}).displayName || 'DJ', isYou:String(l.sharer_user_id) === owner, visits:0, plays:0, sales:0, earningsCents:0, currency:'USD', _sharer:String(l.sharer_user_id) }]));
  (events.data || []).forEach(e => { const r = byCode.get(e.code); if(r && KINDS.includes(e.kind)) r[e.kind === 'visit' ? 'visits' : 'plays'] += 1; });
  (orders.data || []).forEach(o => {
    const meta = o.provider_metadata && typeof o.provider_metadata === 'object' ? o.provider_metadata : {};
    const r = byCode.get(meta.shareCode);
    if(!r || !EARNING.includes(o.payment_status) || String(o.buyer_user_id) === r._sharer) return;
    r.sales += 1; r.earningsCents += Number(o.seller_amount_cents || 0); if(o.currency) r.currency = o.currency;
  });
  const rows = [...byCode.values()].filter(r => r.visits || r.plays || r.sales)
    .map(({ _sharer, ...r }) => r)
    .sort((a, b) => b.sales - a.sales || b.plays - a.plays || b.visits - a.visits || a.sharerName.localeCompare(b.sharerName));
  const totals = rows.reduce((t, r) => ({ visits:t.visits + r.visits, plays:t.plays + r.plays, sales:t.sales + r.sales, earningsCents:t.earningsCents + r.earningsCents }), { visits:0, plays:0, sales:0, earningsCents:0 });
  totals.sharers = new Set(rows.filter(r => !r.isYou).map(r => r.sharerName)).size;
  return { rows, totals };
}

module.exports = { SCHEMA, KINDS, newCode, cleanCode, shareUrl, visitorHash, createShareLink, recordShareEvent, shareCodeForCheckout, sellerShareStats };
