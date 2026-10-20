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
    endsAt:row.ends_at || null, usageLimit:row.usage_limit == null ? null : Number(row.usage_limit), timesUsed:Number(row.times_used || 0), active:row.active !== false, state:codeState(row, now), createdAt:row.created_at };
}
function codeState(row, now = new Date()){
  if(row.active === false) return 'off';
  if(row.ends_at && new Date(row.ends_at) <= now) return 'ended';
  if(row.usage_limit != null && Number(row.times_used || 0) >= Number(row.usage_limit)) return 'used_up';
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
// Counts the use. Called once checkout is created; conditional on times_used so two buyers
// racing for the last use can't both get it.
async function recordRedemption(db, row, { orderId, buyerUserId, discountCents, now = new Date() }){
  const used = Number(row.times_used || 0);
  const u = await db.from('beat_discount_codes').update({ times_used:used + 1, updated_at:now.toISOString() }).eq('id', row.id).eq('times_used', used);
  if(u.error) return fail(u);
  if(Array.isArray(u.data) && !u.data.length) return { raced:true };
  await db.from('beat_discount_redemptions').insert([{ id:newId('bdr'), code_id:row.id, order_id:orderId, buyer_user_id:String(buyerUserId), discount_cents:discountCents, created_at:now.toISOString() }]);
  return { recorded:true };
}
// Read-only price preview for the "Apply" button in the Beat Store.
async function previewDiscount(db, { listing, code, now = new Date() }){
  if(!listing) return { notFound:true };
  const gross = Math.round(Number(listing.display_price_cents || 0));
  const d = await resolveDiscount(db, { sellerUserId:listing.seller_user_id, code, grossCents:gross, now });
  if(d.none) return { validationError:'Type a code first' };
  if(d.validationError || d.error || d.schemaMissing) return d;
  return { preview:{ code:d.row.code, originalCents:gross, discountCents:d.discountCents, finalCents:d.finalCents } };
}

module.exports = { SCHEMA, MIN_CHARGE_CENTS, validateInput, listCodes, createCode, setCodeActive, discountFor, resolveDiscount, recordRedemption, previewDiscount, codeState, publicCode };
