// Oct 20b: Beat Store discount codes. A producer makes codes like BATTLE20 for a percentage or a
// fixed amount off, with an optional end date and usage limit. The discount is applied on the
// server when checkout starts, so the Stripe price already includes it.
const { cleanText, cleanId, newId, isMissingTable } = require('./social_helpers');

const SCHEMA = '045_create_beat_discount_codes';
const MIN_CHARGE_CENTS = 50; // Stripe's smallest card charge
const missing = () => ({ schemaMissing:true, schema:SCHEMA });
const fail = r => (isMissingTable(r.error) ? missing() : { error:r.error });
const normCode = v => String(v == null ? '' : v).trim().toUpperCase();

function publicCode(row, now = new Date()){
  return { id:row.id, code:row.code, kind:row.kind, percentOff:row.kind === 'percent' ? Number(row.percent_off) : null, amountOffCents:row.kind === 'fixed' ? Number(row.amount_off_cents) : null,
    endsAt:row.ends_at || null, usageLimit:row.usage_limit == null ? null : Number(row.usage_limit), timesUsed:Number(row.times_used || 0), reservedUses:Number(row.reserved_uses || 0), active:row.active !== false, state:codeState(row, now), createdAt:row.created_at };
}
function codeState(row, now = new Date()){
  if(row.active === false) return 'off';
  if(row.ends_at && new Date(row.ends_at) <= now) return 'ended';
  if(row.usage_limit != null && Number(row.times_used || 0) + Number(row.reserved_uses || 0) >= Number(row.usage_limit)) return 'used_up';
  return 'live';
}
function validateInput(body = {}, now = new Date()){
  const code = normCode(body.code);
  if(!/^[A-Z0-9_-]{3,20}$/.test(code)) return { validationError:'Codes are 3 to 20 letters or numbers (dashes and underscores are fine)' };
  const kind = body.kind === 'fixed' ? 'fixed' : body.kind === 'percent' ? 'percent' : null;
  if(!kind) return { validationError:'Pick percent off or an amount off' };
  const out = { code, kind, percent_off:null, amount_off_cents:null, ends_at:null, usage_limit:null };
  if(kind === 'percent'){ const p = Math.round(Number(body.percentOff)); if(!(p >= 1 && p <= 90)) return { validationError:'Percent off must be between 1 and 90' }; out.percent_off = p; }
  else { const c = Math.round(Number(body.amountOffCents)); if(!(c >= 50 && c <= 100000)) return { validationError:'Amount off must be between $0.50 and $1,000' }; out.amount_off_cents = c; }
  if(body.endsAt){ const d = new Date(body.endsAt); if(isNaN(d)) return { validationError:'That end date is not valid' }; if(d <= now) return { validationError:'The end date has to be in the future' }; out.ends_at = d.toISOString(); }
  if(body.usageLimit != null && body.usageLimit !== ''){ const n = Math.round(Number(body.usageLimit)); if(!(n >= 1 && n <= 100000)) return { validationError:'Usage limit must be between 1 and 100,000' }; out.usage_limit = n; }
  return { value:out };
}

async function listCodes(db, sellerId, now = new Date()){
  const r = await db.from('beat_discount_codes').select('*').eq('seller_user_id', String(sellerId)).limit(500);
  if(r.error) return fail(r);
  return { codes:(r.data || []).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(c => publicCode(c, now)) };
}
async function createCode(db, sellerId, body = {}, now = new Date()){
  const v = validateInput(body, now);
  if(v.validationError) return v;
  const existing = await db.from('beat_discount_codes').select('*').eq('seller_user_id', String(sellerId)).eq('code', v.value.code).limit(1);
  if(existing.error) return fail(existing);
  if((existing.data || []).length) return { validationError:'You already have a code with that name' };
  const ts = now.toISOString();
  const row = { id:newId('bdc'), seller_user_id:String(sellerId), ...v.value, times_used:0, active:true, created_at:ts, updated_at:ts };
  const ins = await db.from('beat_discount_codes').insert([row]);
  if(ins.error) return fail(ins);
  return { code:publicCode(row, now) };
}
async function setCodeActive(db, sellerId, codeId, active, now = new Date()){
  const id = cleanId(codeId);
  const r = await db.from('beat_discount_codes').select('*').eq('id', id).limit(1);
  if(r.error) return fail(r);
  const row = (r.data || [])[0];
  if(!row) return { notFound:true };
  if(String(row.seller_user_id) !== String(sellerId)) return { forbidden:true };
  const u = await db.from('beat_discount_codes').update({ active:Boolean(active), updated_at:now.toISOString() }).eq('id', id);
  if(u.error) return fail(u);
  return { code:publicCode({ ...row, active:Boolean(active) }, now) };
}

function discountFor(row, grossCents){
  let off = row.kind === 'percent' ? Math.round(grossCents * Number(row.percent_off) / 100) : Number(row.amount_off_cents);
  off = Math.max(0, Math.min(off, grossCents - MIN_CHARGE_CENTS));
  return { discountCents:off, finalCents:grossCents - off };
}
// Looks up a code for this seller and works out the new price. Never trusts the browser's math.
async function resolveDiscount(db, { sellerUserId, code, grossCents, now = new Date() }){
  const c = normCode(code);
  if(!c) return { none:true };
  const r0 = await db.from('beat_discount_codes').select('id').eq('seller_user_id', String(sellerUserId)).eq('code', c).limit(1);
  if(!r0.error && (r0.data || [])[0]) await releaseStaleReservations(db, r0.data[0].id, now);
  const r = await db.from('beat_discount_codes').select('*').eq('seller_user_id', String(sellerUserId)).eq('code', c).limit(1);
  if(r.error) return fail(r);
  const row = (r.data || [])[0];
  if(!row) return { validationError:'That discount code isn\u2019t valid for this beat' };
  const state = codeState(row, now);
  if(state === 'ended') return { validationError:'That discount code has ended' };
  if(state === 'used_up') return { validationError:'That discount code has been used up' };
  if(state !== 'live') return { validationError:'That discount code isn\u2019t valid for this beat' };
  if(grossCents <= MIN_CHARGE_CENTS) return { validationError:'This beat is too cheap for a discount' };
  return { row, ...discountFor(row, grossCents) };
}
// Oct 20c: a code use only COUNTS once Stripe says the payment went through
// (checkout.session.completed). While a buyer is still on the Stripe page, the use is
// "reserved" so a limited code can't be oversold; the hold is released when Stripe says the
// checkout expired or failed, or automatically after RESERVATION_MS if Stripe never tells us.
const RESERVATION_MS = 24 * 60 * 60 * 1000; // Stripe Checkout sessions last 24 hours by default
const RESERVATION_SCHEMA = '047_add_discount_code_reservations';
async function bumpCounts(db, codeId, change, now, tries = 4){
  for(let i = 0; i < tries; i++){
    const r = await db.from('beat_discount_codes').select('*').eq('id', codeId).limit(1);
    if(r.error) return failCounts(r);
    const row = (r.data || [])[0];
    if(!row) return { notFound:true };
    const used = Number(row.times_used || 0), held = Number(row.reserved_uses || 0);
    const next = { times_used:Math.max(0, used + (change.used || 0)), reserved_uses:Math.max(0, held + (change.held || 0)) };
    if(change.needRoom && row.usage_limit != null && used + held >= Number(row.usage_limit)) return { raced:true };
    // Conditional on both counters, so two webhooks or two buyers can't overwrite each other.
    // .select() makes Supabase hand back the changed rows, so "nothing changed" (someone else
    // got there first) is visible and we read again and retry.
    const u = await db.from('beat_discount_codes').update({ ...next, updated_at:now.toISOString() }).eq('id', codeId).eq('times_used', used).eq('reserved_uses', held).select('id');
    if(u.error) return failCounts(u);
    if(!(Array.isArray(u.data) && !u.data.length)) return { ok:true, row:{ ...row, ...next } };
  }
  return { raced:true };
}
// Missing reserved_uses / status columns mean SQL 047 hasn't been run yet.
function failCounts(r){ return isMissingTable(r.error) ? { schemaMissing:true, schema:RESERVATION_SCHEMA } : { error:r.error }; }
// Releases holds whose checkout is long gone (Stripe never sent "expired").
async function releaseStaleReservations(db, codeId, now = new Date()){
  const r = await db.from('beat_discount_redemptions').select('*').eq('code_id', codeId).eq('status', 'reserved').limit(500);
  if(r.error) return failCounts(r);
  let released = 0;
  for(const red of r.data || []){
    if(red.expires_at && new Date(red.expires_at) <= now){ const x = await settleRedemption(db, red, 'released', now); if(x.settled) released++; }
  }
  return { released };
}
// Called when checkout starts: holds one use, doesn't count it yet.
async function reserveRedemption(db, row, { orderId, buyerUserId, discountCents, now = new Date() }){
  const held = await bumpCounts(db, row.id, { held:+1, needRoom:true }, now);
  if(held.notFound) return { raced:true };
  if(held.raced || held.error || held.schemaMissing) return held;
  const ins = await db.from('beat_discount_redemptions').insert([{ id:newId('bdr'), code_id:row.id, order_id:String(orderId), buyer_user_id:String(buyerUserId), discount_cents:discountCents, status:'reserved', expires_at:new Date(now.getTime() + RESERVATION_MS).toISOString(), created_at:now.toISOString(), settled_at:null }]);
  if(ins.error){ await bumpCounts(db, row.id, { held:-1 }, now); return failCounts(ins); }
  return { reserved:true };
}
// Moves one redemption to 'confirmed' (counts the use) or 'released' (frees the hold).
// Each move is conditional on the row's current status, so a repeated webhook can never count
// a use twice. A payment that lands after its hold was auto-released (very late Stripe event)
// still counts, but without touching the hold counter again.
async function settleRedemption(db, red, to, now = new Date()){
  if(!red) return { unchanged:true };
  const from = red.status || 'reserved';
  let change = null;
  if(from === 'reserved') change = to === 'confirmed' ? { used:+1, held:-1 } : { held:-1 };
  else if(from === 'released' && to === 'confirmed') change = { used:+1 };
  if(!change) return { unchanged:true };
  const u = await db.from('beat_discount_redemptions').update({ status:to, settled_at:now.toISOString() }).eq('id', red.id).eq('status', from).select('id');
  if(u.error) return failCounts(u);
  if(Array.isArray(u.data) && !u.data.length) return { unchanged:true };
  const c = await bumpCounts(db, red.code_id, change, now, 8);
  if(c.error || c.schemaMissing) return c;
  return { settled:true, status:to };
}
// Webhook hook: paid => confirm, canceled/failed => release. Anything else is ignored.
async function settleForOrder(db, orderId, paymentStatus, now = new Date()){
  const to = paymentStatus === 'paid' ? 'confirmed' : (paymentStatus === 'canceled' || paymentStatus === 'failed') ? 'released' : null;
  if(!to || !orderId) return { ignored:true };
  const r = await db.from('beat_discount_redemptions').select('*').eq('order_id', String(orderId)).limit(5);
  if(r.error) return failCounts(r);
  const out = [];
  for(const red of r.data || []) out.push(await settleRedemption(db, red, to, now));
  return { results:out };
}
// Kept for older callers: now only reserves.
const recordRedemption = reserveRedemption;
// Read-only price preview for the "Apply" button in the Beat Store.
async function previewDiscount(db, { listing, code, now = new Date() }){
  if(!listing) return { notFound:true };
  const gross = Math.round(Number(listing.display_price_cents || 0));
  const d = await resolveDiscount(db, { sellerUserId:listing.seller_user_id, code, grossCents:gross, now });
  if(d.none) return { validationError:'Type a code first' };
  if(d.validationError || d.error || d.schemaMissing) return d;
  return { preview:{ code:d.row.code, originalCents:gross, discountCents:d.discountCents, finalCents:d.finalCents } };
}

module.exports = { RESERVATION_MS, RESERVATION_SCHEMA, reserveRedemption, settleRedemption, settleForOrder, releaseStaleReservations, SCHEMA, MIN_CHARGE_CENTS, validateInput, listCodes, createCode, setCodeActive, discountFor, resolveDiscount, recordRedemption, previewDiscount, codeState, publicCode };
