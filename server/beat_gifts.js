// Oct 25 Store: gift a beat at checkout.
//
// The buyer types the recipient's email and a short message, then pays through the usual Stripe
// checkout. When Stripe confirms payment we make a one-time claim link (only a SHA-256 hash of the
// secret is stored), email it with the existing email sender, and wait. The beat lands in the
// recipient's purchases when they sign in with that same email (with the link, or automatically
// the next time they open the Beat Store). A claim works exactly once.
const crypto = require('crypto');
const { cleanText, cleanId, isMissingTable, rateLimited } = require('./social_helpers');
const { notifyQuietly } = require('./social_notifications');

const GIFT_TABLE = 'marketplace_beat_gifts';
const GIFT_SCHEMA = '052_create_beat_gifts';
const GIFT_STATUSES = ['pending_payment', 'sent', 'claimed', 'cancelled'];
const MAX_MESSAGE = 280;
const CLAIM_DAYS = 365;
const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[A-Za-z]{2,24}$/;

const fail = r => (isMissingTable(r.error) ? { schemaMissing:true, schema:GIFT_SCHEMA } : { error:r.error });
const normEmail = v => String(v || '').trim().toLowerCase();
const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');
function maskEmail(email){
  const [name, domain] = normEmail(email).split('@');
  if(!domain) return '';
  return `${name.slice(0, 1)}${'*'.repeat(Math.max(1, Math.min(4, name.length - 1)))}@${domain}`;
}
function sameHash(a, b){
  const x = Buffer.from(String(a || ''), 'utf8'), y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function validateGiftInput(raw = {}){
  const email = normEmail(raw.recipientEmail || raw.email);
  if(!EMAIL_RE.test(email) || email.length > 254) return { validationError:'Enter the email address of the person you\'re gifting this beat to' };
  const message = cleanText(raw.message, MAX_MESSAGE);
  if(String(raw.message || '').length > MAX_MESSAGE) return { validationError:`Keep the gift message under ${MAX_MESSAGE} characters` };
  const fromName = cleanText(raw.fromName, 60);
  return { recipientEmail:email, message, fromName };
}

async function createPendingGift(db, { order, listing, gift, now = new Date() }){
  const ts = now.toISOString();
  const row = { id:`gift_${crypto.randomBytes(12).toString('hex')}`, order_id:order.id, listing_id:listing.id, product_id:order.product_id, buyer_user_id:String(order.buyer_user_id),
    recipient_email:gift.recipientEmail, message:gift.message || '', from_name:gift.fromName || '', status:'pending_payment', claim_token_hash:null,
    expires_at:null, claimed_by:null, claimed_at:null, email_sent_at:null, created_at:ts, updated_at:ts };
  const ins = await db.from(GIFT_TABLE).insert([row]);
  if(ins.error) return fail(ins);
  return { gift:row };
}

async function giftForOrder(db, orderId){
  const r = await db.from(GIFT_TABLE).select('*').eq('order_id', String(orderId)).limit(1);
  if(r.error) return fail(r);
  return { row:(r.data || [])[0] || null };
}

function claimUrl(appUrl, giftId, token){
  const base = String(appUrl || '').replace(/\/+$/, '') || '';
  return `${base}/?gift=${encodeURIComponent(giftId)}&gt=${encodeURIComponent(token)}#store`;
}

function giftEmail({ giftRow, title, link, licence }){
  const from = giftRow.from_name ? cleanText(giftRow.from_name, 60) : 'Someone';
  const subject = `${from} sent you a beat on DJ Battle`;
  const note = giftRow.message ? `\n\nTheir message:\n"${giftRow.message}"` : '';
  const licenceLines = licence ? `\n\n${require('./store_five').licenceText(licence)}` : '';
  const text = `${from} bought you "${title}" on DJ Battle.${note}\n\nClaim it here (sign in or sign up with this email address, ${giftRow.recipient_email}):\n${link}\n\nThe link works once and lasts a year.${licenceLines}`;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const html = `<p>${esc(from)} bought you <strong>${esc(title)}</strong> on DJ Battle.</p>${giftRow.message ? `<blockquote>${esc(giftRow.message)}</blockquote>` : ''}<p><a href="${esc(link)}">Claim your beat</a></p><p>Sign in or sign up with <strong>${esc(giftRow.recipient_email)}</strong>. The link works once and lasts a year.</p>${licence ? `<p><strong>Licence: ${esc(licence.label)}.</strong> ${esc(licence.summary)}</p>` : ''}`;
  return { subject, text, html };
}

// Called once Stripe confirms payment. deps: { emailSender, appUrl }
async function onGiftOrderPaid(db, bundle, now = new Date(), deps = {}){
  const found = await giftForOrder(db, bundle.order.id);
  if(found.error || found.schemaMissing) return found.schemaMissing ? { gift:null } : found;
  const row = found.row;
  if(!row) return { gift:null };
  if(row.status !== 'pending_payment') return { gift:{ id:row.id, status:row.status }, duplicate:true };
  const token = crypto.randomBytes(32).toString('base64url');
  const ts = now.toISOString();
  const expires = new Date(now.getTime() + CLAIM_DAYS * 86400000).toISOString();
  const up = await db.from(GIFT_TABLE).update({ status:'sent', claim_token_hash:hashToken(token), expires_at:expires, updated_at:ts }).eq('id', row.id).eq('status', 'pending_payment').select('*');
  if(up.error) return fail(up);
  if(Array.isArray(up.data) && !up.data.length) return { gift:{ id:row.id }, duplicate:true };
  const title = (bundle.items && bundle.items[0] && bundle.items[0].title_snapshot) || 'a beat';
  const licence = bundle.order.provider_metadata && bundle.order.provider_metadata.licence;
  const link = claimUrl(deps.appUrl, row.id, token);
  let emailed = false;
  if(deps.emailSender && typeof deps.emailSender.send === 'function'){
    try{
      const mail = giftEmail({ giftRow:row, title, link, licence });
      const sent = await deps.emailSender.send({ to:row.recipient_email, ...mail });
      emailed = Boolean(sent && (sent.sent || sent.ok || sent.id));
      if(emailed) await db.from(GIFT_TABLE).update({ email_sent_at:ts }).eq('id', row.id);
    }catch(_e){ /* the recipient can still claim by signing in with this email */ }
  }
  return { gift:{ id:row.id, status:'sent', emailed }, link };
}

// Refund / dispute / failed payment: unclaimed gifts are cancelled (claimed ones lose access via the order).
async function onGiftOrderStopped(db, order, status, now = new Date()){
  if(!['refunded', 'disputed', 'failed', 'canceled'].includes(status)) return { changed:false };
  const r = await db.from(GIFT_TABLE).update({ status:'cancelled', claim_token_hash:null, updated_at:now.toISOString() }).eq('order_id', order.id).in('status', ['pending_payment', 'sent']);
  if(r && r.error) return fail(r);
  return { changed:true };
}

async function grantTo(db, giftRow, user, now){
  const Commerce = require('./marketplace_commerce');
  const bundle = await Commerce.loadOrderBundle(db, giftRow.order_id);
  if(bundle.error || bundle.unavailable) return bundle.error ? bundle : { unavailable:true };
  if(bundle.order.payment_status !== 'paid') return { unavailable:true };
  const asRecipient = { ...bundle, order:{ ...bundle.order, buyer_user_id:String(user.id), buyer_email:normEmail(user.email) } };
  return Commerce.createOrActivatePurchaseEntitlement(db, asRecipient, now.toISOString());
}

// Single claim: flip sent -> claimed with a conditional update, then grant. Undo the flip if granting fails.
async function claimRow(db, row, user, now, deps = {}){
  if(row.expires_at && new Date(row.expires_at) <= now) return { gone:true, message:'This gift link has expired' };
  const ts = now.toISOString();
  const up = await db.from(GIFT_TABLE).update({ status:'claimed', claimed_by:String(user.id), claimed_at:ts, claim_token_hash:null, updated_at:ts })
    .eq('id', row.id).eq('status', 'sent').eq('claim_token_hash', row.claim_token_hash).select('*');
  if(up.error) return fail(up);
  if(!(up.data || []).length) return { conflict:true, message:'This gift has already been claimed' };
  const granted = await grantTo(db, row, user, now);
  if(granted.error || granted.unavailable){
    await db.from(GIFT_TABLE).update({ status:'sent', claimed_by:null, claimed_at:null, claim_token_hash:row.claim_token_hash, updated_at:ts }).eq('id', row.id);
    return granted.error ? granted : { unavailable:true };
  }
  await notifyQuietly(db, { recipientUserId:row.buyer_user_id, actorUserId:user.id, type:'gift_received', subjectId:row.id, eventKey:`gift-claimed:${row.id}`,
    destination:{ type:'store', label:'Open the Beat Store' }, summary:`Your gift to ${maskEmail(row.recipient_email)} was claimed.`, now });
  return { claimed:true, gift:{ id:row.id, listingId:row.listing_id, productId:row.product_id, message:row.message, fromName:row.from_name }, entitlement:granted.entitlement || null };
}

// With the link from the email. The signed-in email must match the recipient email.
async function claimGift(db, user, input = {}, now = new Date()){
  if(!user || !user.id) return { forbidden:true };
  if(rateLimited(`gift-claim:${user.id}`, now.getTime(), 10, 10 * 60 * 1000)) return { rateLimited:true };
  const id = cleanId(input.giftId, 80), token = String(input.token || '').slice(0, 200);
  if(!id || !token) return { validationError:'This gift link is incomplete' };
  const r = await db.from(GIFT_TABLE).select('*').eq('id', id).limit(1);
  if(r.error) return fail(r);
  const row = (r.data || [])[0];
  if(!row || !sameHash(hashToken(token), row.claim_token_hash || '')){
    if(row && row.status === 'claimed') return { conflict:true, message:'This gift has already been claimed' };
    return { notFound:true };
  }
  if(row.status !== 'sent') return { conflict:true, message:'This gift can\'t be claimed any more' };
  if(normEmail(user.email) !== normEmail(row.recipient_email)) return { forbidden:true, message:`This gift was sent to ${maskEmail(row.recipient_email)}. Sign in with that email to claim it.` };
  return claimRow(db, row, user, now);
}

// Automatic: any sent gifts for the signed-in (verified) email are added to their purchases.
async function claimWaitingGifts(db, user, now = new Date()){
  if(!user || !user.id || !user.email || !user.emailVerified) return { claimed:[] };
  const r = await db.from(GIFT_TABLE).select('*').eq('recipient_email', normEmail(user.email)).eq('status', 'sent').limit(20);
  if(r.error) return isMissingTable(r.error) ? { claimed:[] } : fail(r);
  const claimed = [];
  for(const row of r.data || []){
    const out = await claimRow(db, row, user, now);
    if(out.claimed) claimed.push(out.gift);
  }
  return { claimed };
}

// Gifts the signed-in user has sent.
async function listSentGifts(db, userId){
  const r = await db.from(GIFT_TABLE).select('*').eq('buyer_user_id', String(userId)).limit(100);
  if(r.error) return fail(r);
  return { gifts:(r.data || []).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(g => ({ id:g.id, listingId:g.listing_id, orderId:g.order_id,
    recipientEmail:g.recipient_email, message:g.message || '', status:g.status, claimedAt:g.claimed_at || null, createdAt:g.created_at })) };
}

module.exports = { GIFT_TABLE, GIFT_SCHEMA, GIFT_STATUSES, EMAIL_RE, hashToken, maskEmail, claimUrl, giftEmail, validateGiftInput, createPendingGift,
  onGiftOrderPaid, onGiftOrderStopped, claimGift, claimWaitingGifts, listSentGifts };
