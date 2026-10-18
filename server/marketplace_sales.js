// Paid Beat Store sales: listing prices, Stripe Connect seller onboarding, seller orders and
// earnings, plus the public "is paid selling switched on" status. Keys come from env vars only:
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, MARKETPLACE_STRIPE_SUCCESS_URL,
//   MARKETPLACE_STRIPE_CANCEL_URL, STRIPE_CONNECT_RETURN_URL (optional), APP_PUBLIC_URL,
//   MARKETPLACE_PLATFORM_FEE_BPS (optional, default 1000 = 10%).
const { LIBRARY_TRACK_TABLE } = require('./music_library');
const {
  MARKETPLACE_LISTING_TABLE,
  MARKETPLACE_PRODUCT_TABLE,
  MARKETPLACE_RIGHTS_TABLE,
  rightsClassificationAllowsMarketplace,
  sanitizeMarketplaceListing
} = require('./marketplace_foundation');
const { MARKETPLACE_FREE_EMAIL_OFFER_TABLE } = require('./marketplace_free_email');
const { freeBeatEligibility } = require('./marketplace_free_beats');
const { sanitizeCommerceOrder, sanitizeSellerAccount } = require('./marketplace_commerce');

const SELLER_ACCOUNT_TABLE = 'marketplace_seller_accounts';
const ORDER_TABLE = 'marketplace_orders';
const MIN_PRICE_CENTS = 99;
const MAX_PRICE_CENTS = 50000;
const EARNING_STATUSES = ['paid', 'partially_refunded'];

function clean(value, max = 500){ return String(value == null ? '' : value).trim().slice(0, max); }
function cleanId(value){ const text = clean(value, 160); return /^[A-Za-z0-9._:-]{1,160}$/.test(text) ? text : ''; }
function httpsUrl(value){ const text = clean(value, 1000); return /^https?:\/\//i.test(text) ? text : ''; }
function appBase(env){ return httpsUrl(env.APP_PUBLIC_URL).replace(/[#?].*$/, '').replace(/\/+$/, ''); }

function checkoutReturnUrls(env = process.env){
  const base = appBase(env);
  return {
    successUrl: httpsUrl(env.MARKETPLACE_CHECKOUT_SUCCESS_URL || env.MARKETPLACE_STRIPE_SUCCESS_URL) || (base ? `${base}/?checkout=success#store` : ''),
    cancelUrl: httpsUrl(env.MARKETPLACE_CHECKOUT_CANCEL_URL || env.MARKETPLACE_STRIPE_CANCEL_URL) || (base ? `${base}/?checkout=cancel#store` : '')
  };
}

function connectReturnUrls(env = process.env){
  const base = appBase(env);
  const returnUrl = httpsUrl(env.STRIPE_CONNECT_RETURN_URL) || (base ? `${base}/?stripeConnect=return#store` : '');
  const refreshUrl = httpsUrl(env.STRIPE_CONNECT_REFRESH_URL) || (base ? `${base}/?stripeConnect=refresh#store` : returnUrl);
  return { returnUrl, refreshUrl };
}

// Booleans and missing setting NAMES only: never a key or a URL with secrets.
function salesConfigStatus(env = process.env){
  const urls = checkoutReturnUrls(env);
  const connect = connectReturnUrls(env);
  const missing = [];
  if(!clean(env.STRIPE_SECRET_KEY)) missing.push('STRIPE_SECRET_KEY');
  if(!urls.successUrl) missing.push('MARKETPLACE_STRIPE_SUCCESS_URL (or APP_PUBLIC_URL)');
  if(!urls.cancelUrl) missing.push('MARKETPLACE_STRIPE_CANCEL_URL (or APP_PUBLIC_URL)');
  if(!clean(env.STRIPE_WEBHOOK_SECRET)) missing.push('STRIPE_WEBHOOK_SECRET');
  if(!connect.returnUrl) missing.push('STRIPE_CONNECT_RETURN_URL (or APP_PUBLIC_URL)');
  const feeBps = Number.isFinite(Number(env.MARKETPLACE_PLATFORM_FEE_BPS)) && env.MARKETPLACE_PLATFORM_FEE_BPS !== '' && env.MARKETPLACE_PLATFORM_FEE_BPS != null ? Math.max(0, Math.min(5000, Math.round(Number(env.MARKETPLACE_PLATFORM_FEE_BPS)))) : 1000;
  return {
    paidSalesConfigured: !missing.length,
    checkoutConfigured: Boolean(clean(env.STRIPE_SECRET_KEY) && urls.successUrl && urls.cancelUrl),
    webhookConfigured: Boolean(clean(env.STRIPE_WEBHOOK_SECRET)),
    connectConfigured: Boolean(clean(env.STRIPE_SECRET_KEY) && connect.returnUrl),
    platformFeePercent: feeBps / 100,
    webhookPath: '/api/marketplace/webhooks/stripe',
    missing
  };
}

// Minimal Stripe Connect client (Express accounts). Tests pass a fake httpClient; nothing here
// runs unless STRIPE_SECRET_KEY is set.
function createStripeConnectClient(options = {}){
  const secretKey = clean(options.secretKey != null ? options.secretKey : process.env.STRIPE_SECRET_KEY);
  const httpClient = options.httpClient || globalThis.fetch;
  const configured = Boolean(secretKey && typeof httpClient === 'function');
  async function call(method, path, params){
    const body = params ? new URLSearchParams(params) : undefined;
    const response = await httpClient(`https://api.stripe.com${path}`, {
      method,
      headers:{ Authorization:`Bearer ${secretKey}`, ...(body ? { 'Content-Type':'application/x-www-form-urlencoded' } : {}) },
      body
    });
    let data = {};
    try{ data = await response.json(); }catch(e){}
    if(!response || response.ok === false) return { error:new Error(`Stripe request failed (${response && response.status})`) };
    return { data };
  }
  return {
    configured,
    async createExpressAccount({ email, sellerUserId } = {}){
      if(!configured) return { unconfigured:true };
      const params = [['type', 'express'], ['capabilities[card_payments][requested]', 'true'], ['capabilities[transfers][requested]', 'true'], ['metadata[sellerUserId]', clean(sellerUserId, 160)]];
      if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(email, 254))) params.push(['email', clean(email, 254)]);
      return call('POST', '/v1/accounts', params);
    },
    async createAccountLink(accountId, { returnUrl, refreshUrl } = {}){
      if(!configured) return { unconfigured:true };
      return call('POST', '/v1/account_links', [['account', accountId], ['type', 'account_onboarding'], ['return_url', returnUrl], ['refresh_url', refreshUrl || returnUrl]]);
    },
    async retrieveAccount(accountId){
      if(!configured) return { unconfigured:true };
      return call('GET', `/v1/accounts/${encodeURIComponent(accountId)}`);
    }
  };
}

function sellerRowFromStripeAccount(account){
  const chargesEnabled = Boolean(account && account.charges_enabled);
  const payoutsEnabled = Boolean(account && account.payouts_enabled);
  const due = account && account.requirements && Array.isArray(account.requirements.currently_due) ? account.requirements.currently_due : [];
  const disabled = account && account.requirements && account.requirements.disabled_reason;
  let status = 'pending';
  if(chargesEnabled && payoutsEnabled) status = 'connected';
  else if(disabled && !/requirements\.(pending_verification|past_due)|under_review/.test(String(disabled)) && account.details_submitted) status = 'restricted';
  return {
    account_status:status,
    charges_enabled:chargesEnabled,
    payouts_enabled:payoutsEnabled,
    requirements_due:due.map(item => clean(item, 160)).filter(Boolean).slice(0, 50)
  };
}

async function findSellerRow(dataClient, sellerUserId){
  const result = await dataClient.from(SELLER_ACCOUNT_TABLE).select('*').eq('seller_user_id', sellerUserId).eq('provider', 'stripe').limit(1);
  if(result.error) return { error:result.error };
  return { row:(result.data || []).find(row => String(row.seller_user_id) === String(sellerUserId) && row.provider === 'stripe') || null };
}

async function saveSellerRow(dataClient, sellerUserId, accountId, fields, now){
  const existing = await findSellerRow(dataClient, sellerUserId);
  if(existing.error) return existing;
  const timestamp = now.toISOString();
  if(existing.row){
    const updated = await dataClient.from(SELLER_ACCOUNT_TABLE).update({ ...fields, provider_account_id:accountId, updated_at:timestamp }).eq('id', existing.row.id).select('*');
    if(updated.error) return { error:updated.error };
    return { row:(updated.data || [])[0] || { ...existing.row, ...fields, provider_account_id:accountId } };
  }
  const row = { id:`mp_seller_${String(sellerUserId).replace(/[^A-Za-z0-9]/g, '').slice(0, 40)}_stripe`, seller_user_id:sellerUserId, provider:'stripe', provider_account_id:accountId, account_status:'pending', charges_enabled:false, payouts_enabled:false, requirements_due:[], ...fields, created_at:timestamp, updated_at:timestamp };
  const inserted = await dataClient.from(SELLER_ACCOUNT_TABLE).insert([row]).select('*');
  if(inserted.error) return { error:inserted.error };
  return { row:(inserted.data || [])[0] || row };
}

// Creates (once) the seller's Stripe Express account and returns a fresh onboarding link.
async function startSellerOnboarding(dataClient, stripe, sellerUserId, input = {}, now = new Date(), env = process.env){
  const owner = cleanId(sellerUserId);
  if(!owner) return { validationError:'A seller is required' };
  if(!stripe || !stripe.configured) return { providerUnavailable:true };
  const urls = connectReturnUrls(env);
  if(!urls.returnUrl) return { providerUnavailable:true };
  const existing = await findSellerRow(dataClient, owner);
  if(existing.error) return existing;
  let accountId = existing.row && existing.row.provider_account_id;
  let saved = existing.row;
  if(!accountId){
    const created = await stripe.createExpressAccount({ email:input.email, sellerUserId:owner });
    if(created.unconfigured) return { providerUnavailable:true };
    if(created.error) return { error:created.error };
    accountId = clean(created.data && created.data.id, 160);
    if(!/^acct_[A-Za-z0-9]+$/.test(accountId)) return { error:new Error('Stripe did not return a connected account') };
    const result = await saveSellerRow(dataClient, owner, accountId, sellerRowFromStripeAccount(created.data), now);
    if(result.error) return result;
    saved = result.row;
  }
  const link = await stripe.createAccountLink(accountId, urls);
  if(link.unconfigured) return { providerUnavailable:true };
  if(link.error) return { error:link.error };
  const url = clean(link.data && link.data.url, 1000);
  if(!/^https:\/\//i.test(url)) return { error:new Error('Stripe did not return an onboarding link') };
  return { onboardingUrl:url, account:sanitizeSellerAccount(saved) };
}

// Pulls the latest charges/payouts status from Stripe (after the seller comes back from onboarding).
async function refreshSellerAccount(dataClient, stripe, sellerUserId, now = new Date()){
  const owner = cleanId(sellerUserId);
  if(!owner) return { validationError:'A seller is required' };
  const existing = await findSellerRow(dataClient, owner);
  if(existing.error) return existing;
  if(!existing.row) return { account:null };
  if(!stripe || !stripe.configured) return { account:sanitizeSellerAccount(existing.row) };
  const remote = await stripe.retrieveAccount(existing.row.provider_account_id);
  if(remote.error) return { error:remote.error };
  if(remote.unconfigured) return { account:sanitizeSellerAccount(existing.row) };
  const saved = await saveSellerRow(dataClient, owner, existing.row.provider_account_id, sellerRowFromStripeAccount(remote.data), now);
  if(saved.error) return saved;
  return { account:sanitizeSellerAccount(saved.row), refreshed:true };
}

// Stripe "account.updated" webhook (already signature-verified by the caller).
async function applyConnectAccountUpdate(dataClient, event, now = new Date()){
  const account = event && event.data && event.data.object;
  const accountId = clean(account && account.id, 160);
  if(!/^acct_[A-Za-z0-9]+$/.test(accountId)) return { validationError:'Invalid connected account event' };
  const found = await dataClient.from(SELLER_ACCOUNT_TABLE).select('*').eq('provider', 'stripe').eq('provider_account_id', accountId).limit(1);
  if(found.error) return { error:found.error };
  const row = (found.data || [])[0];
  if(!row) return { unknownAccount:true };
  const updated = await dataClient.from(SELLER_ACCOUNT_TABLE).update({ ...sellerRowFromStripeAccount(account), updated_at:now.toISOString() }).eq('id', row.id).select('*');
  if(updated.error) return { error:updated.error };
  return { updated:true, account:sanitizeSellerAccount((updated.data || [])[0] || row) };
}

async function one(dataClient, table, field, value){
  const result = await dataClient.from(table).select('*').eq(field, value).limit(1);
  if(result.error) return { error:result.error };
  return { row:(result.data || []).find(row => String(row[field]) === String(value)) || null };
}

// Owner sets (or clears with 0) the price of a Beat Store listing.
async function setListingPrice(dataClient, sellerUserId, listingId, input = {}, now = new Date()){
  const owner = cleanId(sellerUserId);
  const id = cleanId(listingId);
  if(!owner || !id) return { validationError:'A listing is required' };
  const raw = input.priceCents != null ? input.priceCents : input.displayPriceCents;
  const priceCents = Math.round(Number(raw));
  if(!Number.isFinite(priceCents) || priceCents < 0) return { validationError:'Enter a price in dollars, like 9.99' };
  if(priceCents > 0 && priceCents < MIN_PRICE_CENTS) return { validationError:'The lowest price is $0.99 (use 0 to make it free).' };
  if(priceCents > MAX_PRICE_CENTS) return { validationError:'The highest price is $500.' };
  const currency = clean(input.currency || 'USD', 3).toUpperCase();
  if(currency !== 'USD') return { validationError:'Only US dollar prices are supported for now.' };
  const listing = await one(dataClient, MARKETPLACE_LISTING_TABLE, 'id', id);
  if(listing.error) return listing;
  if(!listing.row || listing.row.status === 'archived') return { unavailable:true };
  if(String(listing.row.seller_user_id) !== owner) return { forbidden:true };
  const product = await one(dataClient, MARKETPLACE_PRODUCT_TABLE, 'id', listing.row.product_id);
  if(product.error) return product;
  if(!product.row || product.row.status !== 'active') return { unavailable:true };
  const rights = await one(dataClient, MARKETPLACE_RIGHTS_TABLE, 'product_id', product.row.id);
  if(rights.error) return rights;
  if(priceCents > 0){
    if(!rightsClassificationAllowsMarketplace(product.row.rights_classification) || !rights.row || rights.row.status !== 'active' || !rights.row.marketplace_streaming_allowed || !rights.row.download_allowed){
      return { validationError:'Only music marked Original, Licensed, Royalty-free or Platform-cleared, with downloads allowed, can be sold.', code:'rights' };
    }
    const track = product.row.library_track_id ? await one(dataClient, LIBRARY_TRACK_TABLE, 'id', product.row.library_track_id) : { row:null };
    if(track.error) return track;
    const eligibility = freeBeatEligibility({ ...(track.row || product.row), rights_classification:product.row.rights_classification, audio_storage_object_path:product.row.audio_storage_object_path });
    if(!eligibility.ok) return { validationError:eligibility.reason.replace('Free downloads must', 'Sold downloads must'), code:eligibility.code };
  }
  const timestamp = now.toISOString();
  const values = { display_price_cents:priceCents, currency, commerce_status:priceCents > 0 ? 'enabled' : 'deferred', updated_at:timestamp };
  const updated = await dataClient.from(MARKETPLACE_LISTING_TABLE).update(values).eq('id', id).eq('seller_user_id', owner).select('*');
  if(updated.error) return { error:updated.error };
  // A priced beat is no longer a free-for-email download (and going back to free turns it on again).
  const offer = await one(dataClient, MARKETPLACE_FREE_EMAIL_OFFER_TABLE, 'listing_id', id);
  let freeOfferStatus = null;
  if(!offer.error && offer.row){
    freeOfferStatus = priceCents > 0 ? 'paused' : 'active';
    await dataClient.from(MARKETPLACE_FREE_EMAIL_OFFER_TABLE).update({ status:freeOfferStatus, free_email_enabled:priceCents === 0, updated_at:timestamp }).eq('id', offer.row.id);
  }
  const row = (updated.data || [])[0] || { ...listing.row, ...values };
  return { listing:sanitizeMarketplaceListing(row, { product:product.row, rights:rights.row, ownerView:true }), freeOfferStatus };
}

// The seller's own sales with totals. Only paid (or partly refunded) orders count as earnings.
async function listSellerSales(dataClient, sellerUserId){
  const owner = cleanId(sellerUserId);
  if(!owner) return { validationError:'A seller is required' };
  const result = await dataClient.from(ORDER_TABLE).select('*').eq('seller_user_id', owner).limit(500);
  if(result.error) return { error:result.error };
  const rows = (result.data || []).filter(row => String(row.seller_user_id) === owner)
    .sort((a, b) => String(b.paid_at || b.created_at || '').localeCompare(String(a.paid_at || a.created_at || '')));
  const earning = rows.filter(row => EARNING_STATUSES.includes(row.payment_status));
  const totals = {
    paidOrders: earning.length,
    pendingOrders: rows.filter(row => row.payment_status === 'pending' || row.payment_status === 'processing').length,
    grossCents: earning.reduce((sum, row) => sum + Number(row.gross_amount_cents || 0), 0),
    platformFeeCents: earning.reduce((sum, row) => sum + Number(row.platform_fee_cents || 0), 0),
    earningsCents: earning.reduce((sum, row) => sum + Number(row.seller_amount_cents || 0), 0),
    currency: (earning[0] && earning[0].currency) || 'USD'
  };
  // Buyers' emails are not shown to sellers here; the order list only says what sold and when.
  const orders = rows.slice(0, 100).map(row => {
    const order = sanitizeCommerceOrder(row, { ownerView:true });
    return { id:order.id, listingId:order.listingId, productId:order.productId, grossAmountCents:order.grossAmountCents, platformFeeCents:order.platformFeeCents, sellerAmountCents:order.sellerAmountCents, currency:order.currency, paymentStatus:order.paymentStatus, createdAt:order.createdAt, paidAt:order.paidAt };
  });
  return { orders, totals };
}

module.exports = {
  MAX_PRICE_CENTS,
  MIN_PRICE_CENTS,
  applyConnectAccountUpdate,
  checkoutReturnUrls,
  connectReturnUrls,
  createStripeConnectClient,
  listSellerSales,
  refreshSellerAccount,
  salesConfigStatus,
  sellerRowFromStripeAccount,
  setListingPrice,
  startSellerOnboarding
};
