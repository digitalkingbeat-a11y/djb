// Oct 20b: "Tip a DJ". A fan picks $2, $5 or a custom amount, adds an optional note, and pays
// through Stripe Checkout. The money goes straight to the DJ's connected Stripe account (the
// same Stripe Connect setup the Beat Store uses). The app takes no cut of tips.
const { cleanText, cleanId, newId, isMissingTable, profilesFor, blockedUserIdsFor, rateLimited, stablePublicProfileId } = require('./social_helpers');
const { sellerAccountCanReceiveSales, verifyStripeSignature } = require('./marketplace_commerce');

const SCHEMA = '044_create_dj_tips';
const PRESETS = [200, 500];
const MIN_CENTS = 100;
const MAX_CENTS = 50000;
const NOTE_MAX = 280;
const missing = () => ({ schemaMissing:true, schema:SCHEMA });
const fail = r => (isMissingTable(r.error) ? missing() : { error:r.error });

function parseAmount(body = {}){
  let cents = body.amountCents != null ? Number(body.amountCents) : Math.round(Number(body.amount) * 100);
  if(!Number.isFinite(cents)) return { validationError:'Pick an amount' };
  cents = Math.round(cents);
  if(cents < MIN_CENTS) return { validationError:'The smallest tip is $1' };
  if(cents > MAX_CENTS) return { validationError:'The largest tip is $500' };
  return { cents };
}
function appBase(env){ const u = String(env.APP_PUBLIC_URL || '').trim(); return /^https?:\/\//i.test(u) ? u.replace(/[#?].*$/, '').replace(/\/+$/, '') : ''; }
function tipsStatus(env = process.env){
  const configured = Boolean(env.STRIPE_SECRET_KEY && appBase(env));
  return { configured, presetsCents:PRESETS, minCents:MIN_CENTS, maxCents:MAX_CENTS, noteMax:NOTE_MAX };
}
async function findRecipient(db, publicProfileId){
  const r = await db.from('marketplace_seller_accounts').select('*').eq('provider', 'stripe').limit(5000);
  if(r.error) return { error:r.error };
  const acct = (r.data || []).find(a => stablePublicProfileId(a.seller_user_id) === publicProfileId);
  return { account:acct || null };
}
async function tipEligibility(db, publicProfileId){
  const pid = cleanText(publicProfileId, 40);
  if(!/^dj_[a-f0-9]{16}$/.test(pid)) return { notFound:true };
  const rec = await findRecipient(db, pid);
  if(rec.error) return rec;
  return { canTip:Boolean(rec.account && sellerAccountCanReceiveSales(rec.account)) };
}

async function createTipCheckout(db, tipperUserId, body = {}, { env = process.env, httpClient = globalThis.fetch, now = new Date() } = {}){
  const status = tipsStatus(env);
  if(!status.configured) return { providerUnavailable:true };
  const pid = cleanText(body.toPublicProfileId, 40);
  if(!/^dj_[a-f0-9]{16}$/.test(pid)) return { validationError:'Pick a DJ to tip' };
  const amount = parseAmount(body);
  if(amount.validationError) return amount;
  const note = cleanText(body.message, NOTE_MAX);
  const resultId = body.verifiedResultId ? cleanText(body.verifiedResultId, 40) : null;
  if(resultId && !/^vr_[a-f0-9]{20}$/.test(resultId)) return { validationError:'That battle result is not valid' };
  const rec = await findRecipient(db, pid);
  if(rec.error) return rec;
  if(!rec.account || !sellerAccountCanReceiveSales(rec.account)) return { recipientUnavailable:true };
  if(String(rec.account.seller_user_id) === String(tipperUserId)) return { validationError:'You can\u2019t tip yourself' };
  const blocked = await blockedUserIdsFor(db, tipperUserId);
  if(blocked.has(String(rec.account.seller_user_id))) return { recipientUnavailable:true };
  if(rateLimited(`tip:${tipperUserId}`, now.getTime(), 5, 60000)) return { validationError:'Slow down a little and try again in a minute' };
  const id = newId('tip');
  const ts = now.toISOString();
  const row = { id, tipper_user_id:String(tipperUserId), recipient_user_id:String(rec.account.seller_user_id), recipient_public_profile_id:pid, verified_result_id:resultId, amount_cents:amount.cents, currency:'usd', message:note || null, status:'pending', provider:'stripe', provider_checkout_id:null, created_at:ts, updated_at:ts };
  const ins = await db.from('dj_tips').insert([row]);
  if(ins.error) return fail(ins);
  const base = appBase(env);
  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('client_reference_id', id);
  params.append('success_url', `${base}/?tip=thanks&tipId=${id}#profile`);
  params.append('cancel_url', `${base}/?tip=canceled&tipId=${id}`);
  params.append('line_items[0][price_data][currency]', 'usd');
  params.append('line_items[0][price_data][product_data][name]', 'Tip for a DJ on DJ Battle');
  params.append('line_items[0][price_data][unit_amount]', String(amount.cents));
  params.append('line_items[0][quantity]', '1');
  params.append('payment_intent_data[transfer_data][destination]', rec.account.provider_account_id);
  for(const [k, v] of Object.entries({ kind:'tip', tipId:id })){ params.append(`metadata[${k}]`, v); params.append(`payment_intent_data[metadata][${k}]`, v); }
  const response = await httpClient('https://api.stripe.com/v1/checkout/sessions', { method:'POST', headers:{ Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type':'application/x-www-form-urlencoded' }, body:params });
  let data = {};
  try{ data = await response.json(); }catch(e){}
  if(!response || response.ok === false || !data.url) return { error:new Error('Stripe tip checkout failed') };
  await db.from('dj_tips').update({ provider_checkout_id:cleanText(data.id, 200), updated_at:ts }).eq('id', id);
  return { tip:{ id, amountCents:amount.cents, status:'pending' }, redirectUrl:data.url };
}

function isTipEvent(event){
  const obj = event && event.data && event.data.object;
  return Boolean(obj && obj.metadata && obj.metadata.kind === 'tip' && obj.metadata.tipId);
}
// Called from the Stripe webhook after the signature check.
async function handleTipEvent(db, event, now = new Date()){
  const obj = event.data.object;
  const tipId = cleanId(obj.metadata.tipId);
  const type = String(event.type || '');
  const status = /checkout\.session\.completed|payment_intent\.succeeded/.test(type) && (obj.payment_status ? obj.payment_status === 'paid' : true) ? 'paid'
    : /expired|canceled|failed/.test(type) ? 'canceled' : /refund/.test(type) ? 'refunded' : null;
  if(!tipId || !status) return { ignored:true };
  const r = await db.from('dj_tips').select('*').eq('id', tipId).limit(1);
  if(r.error) return fail(r);
  const row = (r.data || [])[0];
  if(!row) return { unknownTip:true };
  if(row.status === status || (row.status === 'paid' && status === 'canceled')) return { duplicate:true };
  const u = await db.from('dj_tips').update({ status, paid_at:status === 'paid' ? now.toISOString() : row.paid_at || null, updated_at:now.toISOString() }).eq('id', tipId);
  if(u.error) return fail(u);
  return { updated:true, status, tip:row };
}
function verifyTipWebhook(rawBody, signature, env = process.env){
  const secrets = [env.STRIPE_WEBHOOK_SECRET, env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(Boolean);
  if(!secrets.length) return { unconfigured:true };
  return { trusted:secrets.some(s => verifyStripeSignature(rawBody || '', signature || '', s)) };
}

async function listTips(db, userId, { direction = 'received' } = {}){
  const field = direction === 'sent' ? 'tipper_user_id' : 'recipient_user_id';
  const r = await db.from('dj_tips').select('*').eq(field, String(userId)).limit(500);
  if(r.error) return fail(r);
  const rows = (r.data || []).filter(t => t.status === 'paid').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const profiles = await profilesFor(db, rows.map(t => direction === 'sent' ? t.recipient_user_id : t.tipper_user_id));
  return {
    totalCents:rows.reduce((s, t) => s + Number(t.amount_cents || 0), 0),
    tips:rows.slice(0, 100).map(t => { const other = profiles.get(String(direction === 'sent' ? t.recipient_user_id : t.tipper_user_id)) || {}; return { id:t.id, amountCents:Number(t.amount_cents), message:t.message || '', from:direction === 'sent' ? null : { publicProfileId:other.publicProfileId, displayName:other.displayName || 'A fan' }, to:direction === 'sent' ? { publicProfileId:other.publicProfileId, displayName:other.displayName || 'DJ' } : null, verifiedResultId:t.verified_result_id || null, createdAt:t.created_at }; })
  };
}

module.exports = { SCHEMA, PRESETS, MIN_CENTS, MAX_CENTS, parseAmount, tipsStatus, tipEligibility, createTipCheckout, isTipEvent, handleTipEvent, verifyTipWebhook, listTips };
