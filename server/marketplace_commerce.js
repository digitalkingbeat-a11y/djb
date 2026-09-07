const { createHash, createHmac, randomUUID, timingSafeEqual } = require('crypto');
const { MIX_BUCKET } = require('./battle_submission');
const {
  MARKETPLACE_PRODUCT_TABLE,
  MARKETPLACE_RIGHTS_TABLE,
  MARKETPLACE_LISTING_TABLE,
  MARKETPLACE_ENTITLEMENT_TABLE,
  MARKETPLACE_PLAYER_SESSION_TABLE,
  sanitizeMarketplaceEntitlement,
  sanitizeMarketplaceListing,
  sanitizeMarketplaceProduct,
  sanitizeMarketplaceRightsPolicy
} = require('./marketplace_foundation');

const MARKETPLACE_COMMERCE_SCHEMA = '023_create_marketplace_commerce_settlement';
const MARKETPLACE_SELLER_ACCOUNT_TABLE = 'marketplace_seller_accounts';
const MARKETPLACE_ORDER_TABLE = 'marketplace_orders';
const MARKETPLACE_ORDER_ITEM_TABLE = 'marketplace_order_items';
const MARKETPLACE_PAYMENT_EVENT_TABLE = 'marketplace_payment_events';

const PAYMENT_PROVIDERS = ['stripe', 'paypal'];
const PAYMENT_STATUSES = ['pending', 'processing', 'paid', 'failed', 'canceled', 'refunded', 'partially_refunded', 'disputed'];
const REFUND_STATES = ['none', 'partial', 'full'];
const DISPUTE_STATES = ['none', 'open', 'won', 'lost'];
const SELLER_ACCOUNT_STATUSES = ['not_connected', 'pending', 'connected', 'restricted', 'disabled'];
const PURCHASE_ENTITLEMENT_SOURCE = 'purchase_settlement';
const DEFAULT_PLATFORM_FEE_BPS = 1000;

function cleanString(value, fallback = '', max = 240){
  return String(value == null ? fallback : value).trim().slice(0, max);
}

function cleanIdentifier(value, fallback = ''){
  const text = cleanString(value, fallback, 160);
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

function finiteInteger(value, fallback = null){
  if(value == null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function nowIso(now){
  return (now instanceof Date ? now : new Date(now || Date.now())).toISOString();
}

function stableId(prefix, value){
  const digest = createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
  return `${prefix}_${digest}`;
}

function redactObject(value){
  const source = safeObject(value);
  const redacted = {};
  for(const [key, raw] of Object.entries(source)){
    if(/secret|token|key|credential|authorization/i.test(key)){
      redacted[key] = '[redacted]';
    }else if(typeof raw === 'string' && /(sk_live|sk_test|access_token|refresh_token|private\/|service_role)/i.test(raw)){
      redacted[key] = '[redacted]';
    }else if(raw && typeof raw === 'object'){
      redacted[key] = JSON.parse(JSON.stringify(raw, (nestedKey, nestedValue) => {
        if(/secret|token|key|credential|authorization/i.test(nestedKey)) return '[redacted]';
        if(typeof nestedValue === 'string' && /(sk_live|sk_test|access_token|refresh_token|private\/|service_role)/i.test(nestedValue)) return '[redacted]';
        return nestedValue;
      }));
    }else{
      redacted[key] = raw;
    }
  }
  return redacted;
}

function centsFromMajorUnit(value){
  if(value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

function centsFromProviderAmount(value){
  if(value == null || value === '') return null;
  if(typeof value === 'number') return Math.round(value);
  if(typeof value === 'string' && /^\d+(?:\.\d{1,2})?$/.test(value)) return centsFromMajorUnit(value);
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function paymentProviderFromInput(value){
  return cleanEnum(cleanString(value).toLowerCase(), PAYMENT_PROVIDERS, null);
}

function normalizeCurrency(value){
  return cleanString(value, 'USD', 3).toUpperCase() || 'USD';
}

function safeStoragePath(value){
  const path = cleanString(value, '', 600);
  if(!path || /^(https?|data|file):/i.test(path) || path.includes('..')) return null;
  return path.startsWith('private/library-audio/') || path.startsWith('private/battle-entries/') || path.startsWith('private/marketplace-downloads/')
    ? path
    : null;
}

function sanitizeAllowedFile(file){
  if(!file || typeof file !== 'object') return null;
  return {
    id: cleanIdentifier(file.id, 'master'),
    type: cleanString(file.type || file.kind, 'audio', 32),
    filename: cleanString(file.filename || file.name, 'download.webm', 180),
    mimeType: cleanString(file.mimeType || file.mime_type, 'audio/webm', 80),
    size: finiteInteger(file.size || file.file_size, null)
  };
}

function sanitizeCommerceOrder(row, options = {}){
  if(!row) return null;
  return {
    id: row.id,
    buyerUserId: row.buyer_user_id,
    buyerEmail: row.buyer_email || null,
    sellerUserId: row.seller_user_id,
    listingId: row.listing_id,
    productId: row.product_id,
    licenseType: row.license_type,
    grossAmountCents: Number(row.gross_amount_cents || 0),
    platformFeeCents: Number(row.platform_fee_cents || 0),
    sellerAmountCents: Number(row.seller_amount_cents || 0),
    currency: row.currency,
    provider: row.provider,
    providerTransactionId: row.provider_transaction_id || null,
    paymentStatus: row.payment_status,
    refundState: row.refund_state || 'none',
    disputeState: row.dispute_state || 'none',
    idempotencyKey: options.ownerView ? row.idempotency_key || null : undefined,
    checkoutUrl: options.checkoutUrl || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    paidAt: row.paid_at || null,
    failedAt: row.failed_at || null,
    canceledAt: row.canceled_at || null,
    refundedAt: row.refunded_at || null,
    disputedAt: row.disputed_at || null
  };
}

function sanitizeCommerceOrderItem(row){
  if(!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    listingId: row.listing_id,
    productId: row.product_id,
    sellerUserId: row.seller_user_id,
    licenseType: row.license_type,
    title: row.title_snapshot,
    grossAmountCents: Number(row.gross_amount_cents || 0),
    platformFeeCents: Number(row.platform_fee_cents || 0),
    sellerAmountCents: Number(row.seller_amount_cents || 0),
    currency: row.currency,
    allowedFiles: safeArray(row.allowed_files).map(sanitizeAllowedFile).filter(Boolean)
  };
}

function sanitizeSellerAccount(row){
  if(!row) return null;
  return {
    id: row.id,
    sellerUserId: row.seller_user_id,
    provider: row.provider,
    providerAccountId: row.provider_account_id || null,
    accountStatus: row.account_status,
    chargesEnabled: Boolean(row.charges_enabled),
    payoutsEnabled: Boolean(row.payouts_enabled),
    eligibleForSales: sellerAccountCanReceiveSales(row),
    requirementsDue: Array.isArray(row.requirements_due) ? row.requirements_due : [],
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function sanitizePaymentEvent(row){
  if(!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    providerEventId: row.provider_event_id,
    orderId: row.order_id || null,
    eventType: row.event_type,
    paymentStatus: row.normalized_payment_status || null,
    receivedAt: row.received_at || null,
    processedAt: row.processed_at || null,
    duplicateOf: row.duplicate_of || null
  };
}

function sanitizeDownloadAccess(row){
  if(!row) return null;
  return {
    url: row.url,
    expiresAt: row.expiresAt,
    entitlementId: row.entitlementId,
    orderId: row.orderId,
    productId: row.productId,
    listingId: row.listingId,
    file: sanitizeAllowedFile(row.file),
    session: row.session
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

async function insertSingle(dataClient, table, payload){
  let query = dataClient.from(table).insert([payload]).select('*');
  const result = typeof query.single === 'function' ? await query.single() : await query;
  if(result.error) return { error: result.error };
  return { row: Array.isArray(result.data) ? result.data[0] || null : result.data || null };
}

async function updateRows(dataClient, table, filters, values){
  let query = dataClient.from(table).update(values);
  filters.forEach(([field, value]) => { query = query.eq(field, value); });
  if(typeof query.select === 'function') query = query.select('*');
  const result = await query;
  if(result.error) return { error: result.error };
  return { rows: Array.isArray(result.data) ? result.data : result.data ? [result.data] : [] };
}

function sellerAccountCanReceiveSales(row){
  if(!row || !paymentProviderFromInput(row.provider) || !cleanString(row.provider_account_id)) return false;
  if(row.account_status !== 'connected') return false;
  if(row.provider === 'stripe') return Boolean(row.charges_enabled && row.payouts_enabled);
  if(row.provider === 'paypal') return Boolean(row.charges_enabled);
  return false;
}

async function getSellerAccount(dataClient, sellerUserId, provider){
  const normalizedProvider = paymentProviderFromInput(provider);
  if(!normalizedProvider) return { validationError:'Unsupported payment provider' };
  const result = await querySingle(dataClient, MARKETPLACE_SELLER_ACCOUNT_TABLE, [['seller_user_id', sellerUserId], ['provider', normalizedProvider]]);
  if(result.error) return { error: result.error };
  if(!result.row) return { account:null };
  return { account:result.row };
}

async function upsertMarketplaceSellerAccount(dataClient, sellerUserId, input = {}, now = new Date()){
  const normalizedSellerUserId = cleanIdentifier(sellerUserId);
  if(!normalizedSellerUserId) return { validationError:'A seller user is required' };
  const provider = paymentProviderFromInput(input.provider);
  if(!provider) return { validationError:'Unsupported payment provider' };
  const providerAccountId = cleanString(input.providerAccountId || input.provider_account_id, '', 160);
  if(!providerAccountId) return { validationError:'A connected seller account ID is required' };
  const timestamp = nowIso(now);
  const accountStatus = cleanEnum(input.accountStatus || input.account_status, SELLER_ACCOUNT_STATUSES, 'pending');
  const payload = {
    provider,
    provider_account_id: providerAccountId,
    account_status: accountStatus,
    charges_enabled: Boolean(input.chargesEnabled != null ? input.chargesEnabled : input.charges_enabled),
    payouts_enabled: Boolean(input.payoutsEnabled != null ? input.payoutsEnabled : input.payouts_enabled),
    requirements_due: Array.isArray(input.requirementsDue || input.requirements_due) ? (input.requirementsDue || input.requirements_due).map(item => cleanString(item, '', 160)).filter(Boolean).slice(0, 50) : [],
    updated_at: timestamp
  };
  const existing = await getSellerAccount(dataClient, normalizedSellerUserId, provider);
  if(existing.error || existing.validationError) return existing;
  if(existing.account){
    const updated = await updateRows(dataClient, MARKETPLACE_SELLER_ACCOUNT_TABLE, [['id', existing.account.id]], payload);
    if(updated.error) return { error: updated.error };
    return { account:sanitizeSellerAccount(updated.rows[0] || { ...existing.account, ...payload }), updated:true };
  }
  const inserted = await insertSingle(dataClient, MARKETPLACE_SELLER_ACCOUNT_TABLE, {
    id: cleanIdentifier(input.id || input.sellerAccountId || input.seller_account_id) || stableId('mp_seller', { sellerUserId:normalizedSellerUserId, provider }),
    seller_user_id: normalizedSellerUserId,
    ...payload,
    created_at: timestamp
  });
  if(inserted.error) return { error: inserted.error };
  return { account:sanitizeSellerAccount(inserted.row), created:true };
}

async function listMarketplaceSellerAccounts(dataClient, sellerUserId){
  const result = await queryRows(dataClient, MARKETPLACE_SELLER_ACCOUNT_TABLE, [['seller_user_id', sellerUserId]], 20);
  if(result.error) return { error: result.error };
  return { accounts: result.rows.map(sanitizeSellerAccount) };
}

async function loadListingCommerceBundle(dataClient, listingId){
  const id = cleanIdentifier(listingId);
  if(!id) return { validationError:'A marketplace listing is required' };
  const listing = await querySingle(dataClient, MARKETPLACE_LISTING_TABLE, [['id', id]]);
  if(listing.error) return { error: listing.error };
  if(!listing.row || listing.row.status !== 'published') return { unavailable:true };
  const product = await querySingle(dataClient, MARKETPLACE_PRODUCT_TABLE, [['id', listing.row.product_id]]);
  if(product.error) return { error: product.error };
  if(!product.row || product.row.status !== 'active') return { unavailable:true };
  const rights = await querySingle(dataClient, MARKETPLACE_RIGHTS_TABLE, [['product_id', product.row.id]]);
  if(rights.error) return { error: rights.error };
  if(!rights.row || rights.row.status !== 'active') return { unavailable:true };
  return { listing:listing.row, product:product.row, rights:rights.row };
}

function buildAllowedFiles(product, rights){
  if(!rights.download_allowed) return [];
  const path = safeStoragePath(product.audio_storage_object_path);
  if(!path) return [];
  return [{
    id:'master-audio',
    type:'audio',
    filename:`${cleanString(product.title, 'marketplace-audio', 120).replace(/[\\/:*?"<>|]+/g, '-')}.webm`,
    mimeType:'audio/webm',
    storageBucket:product.audio_storage_bucket || MIX_BUCKET,
    storageObjectPath:path,
    size:null
  }];
}

function publicAllowedFiles(files){
  return safeArray(files).map(sanitizeAllowedFile).filter(Boolean);
}

function resolvePlatformFee(grossAmountCents, options = {}){
  const envBps = finiteInteger(process.env.MARKETPLACE_PLATFORM_FEE_BPS, DEFAULT_PLATFORM_FEE_BPS);
  const bps = Math.max(0, Math.min(5000, finiteInteger(options.platformFeeBps, envBps)));
  const platformFeeCents = Math.max(0, Math.min(grossAmountCents, Math.round(grossAmountCents * bps / 10000)));
  return {
    platformFeeCents,
    sellerAmountCents: grossAmountCents - platformFeeCents,
    platformFeeBps: bps
  };
}

function validateClientPrice(input, grossAmountCents, currency){
  const clientPrice = input.clientPriceCents != null ? input.clientPriceCents
    : input.grossAmountCents != null ? input.grossAmountCents
      : input.priceCents;
  if(clientPrice == null) return { ok:true };
  const normalized = finiteInteger(clientPrice, null);
  if(normalized !== grossAmountCents) return { validationError:'Client price does not match authoritative listing price' };
  const clientCurrency = input.currency ? normalizeCurrency(input.currency) : currency;
  if(clientCurrency !== currency) return { validationError:'Client currency does not match authoritative listing currency' };
  return { ok:true };
}

function validateClientLicense(input, rights){
  const requested = cleanString(input.licenseType || input.license_type, '', 80);
  if(!requested) return { ok:true };
  if(requested !== rights.license_type) return { validationError:'Client license does not match authoritative listing license' };
  return { ok:true };
}

function buildOrderPayload(input){
  const timestamp = input.timestamp;
  const grossAmountCents = Number(input.grossAmountCents);
  const fee = resolvePlatformFee(grossAmountCents, { platformFeeBps:input.platformFeeBps });
  return {
    id: cleanIdentifier(input.orderId) || stableId('mp_order', { buyerUserId:input.buyerUserId, listingId:input.listing.id, idempotencyKey:input.idempotencyKey || randomUUID() }),
    buyer_user_id: input.buyerUserId,
    buyer_email: cleanString(input.buyerEmail, '', 254) || null,
    seller_user_id: input.listing.seller_user_id,
    seller_account_id: input.sellerAccount.id,
    listing_id: input.listing.id,
    product_id: input.product.id,
    license_type: input.rights.license_type,
    gross_amount_cents: grossAmountCents,
    platform_fee_cents: fee.platformFeeCents,
    seller_amount_cents: fee.sellerAmountCents,
    currency: input.currency,
    provider: input.provider,
    provider_transaction_id: null,
    payment_status: 'pending',
    refund_state: 'none',
    dispute_state: 'none',
    idempotency_key: cleanString(input.idempotencyKey, '', 160) || null,
    provider_metadata: {
      provider: input.provider,
      sellerAccountId: input.sellerAccount.provider_account_id,
      platformFeeBps: fee.platformFeeBps
    },
    created_at: timestamp,
    updated_at: timestamp,
    paid_at: null,
    failed_at: null,
    canceled_at: null,
    refunded_at: null,
    disputed_at: null
  };
}

function buildOrderItemPayload(order, listing, product, rights, allowedFiles){
  return {
    id: stableId('mp_item', { orderId:order.id, productId:product.id }),
    order_id: order.id,
    listing_id: listing.id,
    product_id: product.id,
    seller_user_id: listing.seller_user_id,
    license_type: rights.license_type,
    title_snapshot: listing.title || product.title,
    gross_amount_cents: order.gross_amount_cents,
    platform_fee_cents: order.platform_fee_cents,
    seller_amount_cents: order.seller_amount_cents,
    currency: order.currency,
    allowed_files: allowedFiles,
    created_at: order.created_at
  };
}

function normalizeProviderCheckout(provider, response){
  if(!response || response.unconfigured) return { unconfigured:true };
  if(response.error) return { error:response.error };
  const links = safeArray(response.links, 10);
  const approve = links.find(link => /approve|checkout/i.test(cleanString(link.rel)));
  return {
    provider,
    providerCheckoutId: cleanString(response.providerCheckoutId || response.checkoutId || response.sessionId || response.orderId || response.id, '', 180),
    redirectUrl: cleanString(response.redirectUrl || response.url || (approve && approve.href), '', 1000),
    rawStatus: cleanString(response.status || response.state, '', 80),
    providerSummary: redactObject({
      id: response.id,
      status: response.status || response.state,
      mode: response.mode,
      object: response.object
    })
  };
}

async function responseJson(response){
  if(!response || typeof response.json !== 'function') return {};
  try{ return await response.json(); }catch(err){ return {}; }
}

function verifyStripeSignature(rawBody, signatureHeader, secret){
  const body = typeof rawBody === 'string' ? rawBody : Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : '';
  const header = cleanString(signatureHeader, '', 1000);
  const webhookSecret = cleanString(secret, '', 500);
  if(!body || !header || !webhookSecret) return false;
  const timestamp = (header.match(/(?:^|,)t=([^,]+)/) || [])[1];
  const signatures = header.split(',').map(part => part.trim()).filter(part => part.startsWith('v1=')).map(part => part.slice(3));
  if(!timestamp || !signatures.length) return false;
  const expected = createHmac('sha256', webhookSecret).update(`${timestamp}.${body}`).digest('hex');
  return signatures.some(signature => {
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signature);
    return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
  });
}

function createStripeConnectAdapter(config = {}){
  const gateway = config.gateway || null;
  const httpClient = config.httpClient || globalThis.fetch;
  const secretKey = config.secretKey || process.env.STRIPE_SECRET_KEY;
  const successUrl = config.successUrl || process.env.MARKETPLACE_STRIPE_SUCCESS_URL || process.env.MARKETPLACE_CHECKOUT_SUCCESS_URL;
  const cancelUrl = config.cancelUrl || process.env.MARKETPLACE_STRIPE_CANCEL_URL || process.env.MARKETPLACE_CHECKOUT_CANCEL_URL;
  const configured = Boolean(gateway && typeof gateway.createCheckoutSession === 'function') || Boolean(secretKey && successUrl && cancelUrl && typeof httpClient === 'function');
  const eventVerificationConfigured = Boolean(config.trustEvents) || Boolean(gateway && typeof gateway.verifyWebhookEvent === 'function') || Boolean(config.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET);
  return {
    provider:'stripe',
    configured,
    eventVerificationConfigured,
    async verifyEvent(rawEvent, options = {}){
      if(config.trustEvents === true || rawEvent && rawEvent.trusted === true) return { trusted:true };
      if(gateway && typeof gateway.verifyWebhookEvent === 'function') return gateway.verifyWebhookEvent(rawEvent, options);
      const secret = config.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET;
      const signature = options.signature || options.stripeSignature || options.headers && (options.headers['stripe-signature'] || options.headers['Stripe-Signature']);
      if(secret && verifyStripeSignature(options.rawBody, signature, secret)) return { trusted:true };
      return { trusted:false, error:'Stripe event signature could not be verified' };
    },
    async createCheckout(order, context = {}){
      if(!configured) return { unconfigured:true };
      const payload = {
        mode:'payment',
        orderId: order.id,
        amountCents: order.gross_amount_cents,
        currency: order.currency,
        successUrl,
        cancelUrl,
        stripeConnect: {
          connectedAccountId: context.sellerAccount.provider_account_id,
          applicationFeeAmount: order.platform_fee_cents,
          destination: context.sellerAccount.provider_account_id
        },
        metadata: {
          orderId: order.id,
          listingId: order.listing_id,
          productId: order.product_id,
          buyerUserId: order.buyer_user_id,
          sellerUserId: order.seller_user_id
        }
      };
      if(gateway && typeof gateway.createCheckoutSession === 'function'){
        return normalizeProviderCheckout('stripe', await gateway.createCheckoutSession(payload));
      }
      const params = new URLSearchParams();
      params.append('mode', 'payment');
      params.append('client_reference_id', order.id);
      params.append('success_url', successUrl);
      params.append('cancel_url', cancelUrl);
      params.append('line_items[0][price_data][currency]', String(order.currency).toLowerCase());
      params.append('line_items[0][price_data][product_data][name]', cleanString(context.product && context.product.title, 'Marketplace product', 160));
      params.append('line_items[0][price_data][unit_amount]', String(order.gross_amount_cents));
      params.append('line_items[0][quantity]', '1');
      params.append('payment_intent_data[application_fee_amount]', String(order.platform_fee_cents));
      params.append('payment_intent_data[transfer_data][destination]', context.sellerAccount.provider_account_id);
      Object.entries(payload.metadata).forEach(([key, value]) => params.append(`metadata[${key}]`, String(value)));
      Object.entries(payload.metadata).forEach(([key, value]) => params.append(`payment_intent_data[metadata][${key}]`, String(value)));
      const response = await httpClient('https://api.stripe.com/v1/checkout/sessions', {
        method:'POST',
        headers:{
          Authorization:`Bearer ${secretKey}`,
          'Content-Type':'application/x-www-form-urlencoded'
        },
        body:params
      });
      const data = await responseJson(response);
      if(!response || response.ok === false) return { error:new Error('Stripe checkout creation failed') };
      return normalizeProviderCheckout('stripe', data);
    },
    normalizeEvent(rawEvent){
      return normalizeStripeEvent(rawEvent);
    }
  };
}

function createPayPalCommerceAdapter(config = {}){
  const gateway = config.gateway || null;
  const httpClient = config.httpClient || globalThis.fetch;
  const clientId = config.clientId || process.env.PAYPAL_CLIENT_ID;
  const clientSecret = config.clientSecret || process.env.PAYPAL_CLIENT_SECRET;
  const returnUrl = config.successUrl || process.env.MARKETPLACE_CHECKOUT_SUCCESS_URL || process.env.PAYPAL_RETURN_URL;
  const cancelUrl = config.cancelUrl || process.env.MARKETPLACE_CHECKOUT_CANCEL_URL || process.env.PAYPAL_CANCEL_URL;
  const baseUrl = config.baseUrl || process.env.PAYPAL_API_BASE_URL || 'https://api-m.paypal.com';
  const configured = Boolean(gateway && typeof gateway.createCheckoutOrder === 'function') || Boolean(clientId && clientSecret && returnUrl && cancelUrl && typeof httpClient === 'function');
  const eventVerificationConfigured = Boolean(config.trustEvents) || Boolean(gateway && typeof gateway.verifyWebhookEvent === 'function');
  return {
    provider:'paypal',
    configured,
    eventVerificationConfigured,
    async verifyEvent(rawEvent, options = {}){
      if(config.trustEvents === true || rawEvent && rawEvent.trusted === true) return { trusted:true };
      if(gateway && typeof gateway.verifyWebhookEvent === 'function') return gateway.verifyWebhookEvent(rawEvent, options);
      return { trusted:false, error:'PayPal event signature could not be verified' };
    },
    async createCheckout(order, context = {}){
      if(!configured) return { unconfigured:true };
      const payload = {
        intent:'CAPTURE',
        orderId: order.id,
        amountCents: order.gross_amount_cents,
        currency: order.currency,
        sellerAccountId: context.sellerAccount.provider_account_id,
        platformFeeCents: order.platform_fee_cents,
        metadata: {
          orderId: order.id,
          listingId: order.listing_id,
          productId: order.product_id,
          buyerUserId: order.buyer_user_id,
          sellerUserId: order.seller_user_id
        }
      };
      if(gateway && typeof gateway.createCheckoutOrder === 'function'){
        return normalizeProviderCheckout('paypal', await gateway.createCheckoutOrder(payload));
      }
      const tokenResponse = await httpClient(`${baseUrl}/v1/oauth2/token`, {
        method:'POST',
        headers:{
          Authorization:`Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type':'application/x-www-form-urlencoded'
        },
        body:'grant_type=client_credentials'
      });
      const tokenData = await responseJson(tokenResponse);
      if(!tokenResponse || tokenResponse.ok === false || !tokenData.access_token) return { error:new Error('PayPal access token request failed') };
      const amount = (Number(order.gross_amount_cents) / 100).toFixed(2);
      const fee = (Number(order.platform_fee_cents) / 100).toFixed(2);
      const orderResponse = await httpClient(`${baseUrl}/v2/checkout/orders`, {
        method:'POST',
        headers:{
          Authorization:`Bearer ${tokenData.access_token}`,
          'Content-Type':'application/json'
        },
        body:JSON.stringify({
          intent:'CAPTURE',
          purchase_units:[{
            custom_id:order.id,
            invoice_id:order.id,
            amount:{ currency_code:order.currency, value:amount },
            payee:{ merchant_id:context.sellerAccount.provider_account_id },
            payment_instruction:{
              platform_fees:[{ amount:{ currency_code:order.currency, value:fee } }]
            }
          }],
          application_context:{
            return_url:returnUrl,
            cancel_url:cancelUrl
          }
        })
      });
      const data = await responseJson(orderResponse);
      if(!orderResponse || orderResponse.ok === false) return { error:new Error('PayPal checkout creation failed') };
      return normalizeProviderCheckout('paypal', data);
    },
    normalizeEvent(rawEvent){
      return normalizePayPalEvent(rawEvent);
    }
  };
}

function createMarketplacePaymentProviderAdapter(provider, config = {}){
  const normalized = paymentProviderFromInput(provider);
  if(normalized === 'stripe') return createStripeConnectAdapter(config);
  if(normalized === 'paypal') return createPayPalCommerceAdapter(config);
  return { provider:normalized || provider, configured:false, normalizeEvent(){ return { validationError:'Unsupported payment provider' }; }, async createCheckout(){ return { unconfigured:true }; } };
}

function normalizeStripeEvent(rawEvent = {}){
  const event = safeObject(rawEvent);
  const object = safeObject(event.data && event.data.object || event.object || event);
  const type = cleanString(event.type || object.type, '', 120);
  const metadata = safeObject(object.metadata || event.metadata);
  const providerEventId = cleanString(event.id || object.event_id || object.id, '', 180);
  if(!providerEventId || !type) return { validationError:'Invalid Stripe event' };
  const amount = finiteInteger(object.amount_total, null) != null ? finiteInteger(object.amount_total, null)
    : finiteInteger(object.amount_received, null) != null ? finiteInteger(object.amount_received, null)
      : finiteInteger(object.amount, null);
  const amountRefunded = finiteInteger(object.amount_refunded, null);
  let paymentStatus = 'processing';
  let refundState = 'none';
  let disputeState = 'none';
  if(/checkout\.session\.completed|payment_intent\.succeeded|charge\.succeeded/.test(type)) paymentStatus = 'paid';
  if(/payment_intent\.processing/.test(type)) paymentStatus = 'processing';
  if(/checkout\.session\.expired|payment_intent\.canceled/.test(type)) paymentStatus = 'canceled';
  if(/payment_intent\.payment_failed|charge\.failed/.test(type)) paymentStatus = 'failed';
  if(/charge\.refunded/.test(type)){
    const partial = amount != null && amountRefunded != null && amountRefunded > 0 && amountRefunded < amount;
    paymentStatus = partial ? 'partially_refunded' : 'refunded';
    refundState = partial ? 'partial' : 'full';
  }
  if(/charge\.dispute\./.test(type)){
    paymentStatus = 'disputed';
    disputeState = 'open';
  }
  return {
    provider:'stripe',
    providerEventId,
    providerTransactionId: cleanString(object.payment_intent || object.id, '', 180),
    providerCheckoutId: cleanString(object.id, '', 180),
    orderId: cleanIdentifier(metadata.orderId || metadata.order_id || object.client_reference_id || event.orderId),
    paymentStatus,
    refundState,
    disputeState,
    amountCents: amount,
    amountRefundedCents: amountRefunded,
    currency: normalizeCurrency(object.currency || event.currency || 'USD'),
    eventType: type,
    payloadSummary: redactObject({ id:event.id, type, objectId:object.id, status:object.status })
  };
}

function normalizePayPalEvent(rawEvent = {}){
  const event = safeObject(rawEvent);
  const resource = safeObject(event.resource || event);
  const type = cleanString(event.event_type || event.type || resource.event_type, '', 120);
  const providerEventId = cleanString(event.id || resource.id, '', 180);
  if(!providerEventId || !type) return { validationError:'Invalid PayPal event' };
  const amountValue = resource.amount && resource.amount.value || resource.seller_receivable_breakdown && resource.seller_receivable_breakdown.gross_amount && resource.seller_receivable_breakdown.gross_amount.value;
  const amount = centsFromProviderAmount(amountValue);
  const currency = normalizeCurrency(resource.amount && resource.amount.currency_code || resource.seller_receivable_breakdown && resource.seller_receivable_breakdown.gross_amount && resource.seller_receivable_breakdown.gross_amount.currency_code || event.currency || 'USD');
  let paymentStatus = 'processing';
  let refundState = 'none';
  let disputeState = 'none';
  if(/PAYMENT\.CAPTURE\.COMPLETED|CHECKOUT\.ORDER\.COMPLETED/.test(type)) paymentStatus = 'paid';
  if(/CHECKOUT\.ORDER\.APPROVED|PAYMENT\.CAPTURE\.PENDING/.test(type)) paymentStatus = 'processing';
  if(/PAYMENT\.CAPTURE\.DENIED|PAYMENT\.CAPTURE\.DECLINED/.test(type)) paymentStatus = 'failed';
  if(/CHECKOUT\.ORDER\.CANCELLED|CHECKOUT\.ORDER\.VOIDED/.test(type)) paymentStatus = 'canceled';
  if(/PAYMENT\.CAPTURE\.REFUNDED/.test(type)){
    paymentStatus = 'refunded';
    refundState = 'full';
  }
  if(/CUSTOMER\.DISPUTE\.CREATED|CUSTOMER\.DISPUTE\.UPDATED/.test(type)){
    paymentStatus = 'disputed';
    disputeState = 'open';
  }
  const customId = cleanIdentifier(resource.custom_id || resource.invoice_id || resource.supplementary_data && resource.supplementary_data.related_ids && resource.supplementary_data.related_ids.order_id || event.orderId);
  return {
    provider:'paypal',
    providerEventId,
    providerTransactionId: cleanString(resource.id || resource.capture_id, '', 180),
    providerCheckoutId: cleanString(resource.supplementary_data && resource.supplementary_data.related_ids && resource.supplementary_data.related_ids.order_id || resource.id, '', 180),
    orderId: customId,
    paymentStatus,
    refundState,
    disputeState,
    amountCents: amount,
    amountRefundedCents: amount,
    currency,
    eventType: type,
    payloadSummary: redactObject({ id:event.id, event_type:type, resourceId:resource.id, status:resource.status })
  };
}

async function createMarketplaceCheckout(dataClient, providerAdapter, buyerUserId, input = {}, now = new Date(), options = {}){
  const provider = paymentProviderFromInput(input.provider || providerAdapter && providerAdapter.provider);
  if(!provider || !providerAdapter || providerAdapter.provider !== provider) return { validationError:'Unsupported payment provider' };
  if(!providerAdapter.configured) return { providerUnavailable:true };
  const bundle = await loadListingCommerceBundle(dataClient, input.listingId || input.listing_id);
  if(bundle.error || bundle.unavailable || bundle.validationError) return bundle;
  const { listing, product, rights } = bundle;
  if(String(listing.seller_user_id) === String(buyerUserId)) return { validationError:'Sellers cannot purchase their own listing' };
  if(!rights.marketplace_streaming_allowed) return { unavailable:true };
  const grossAmountCents = finiteInteger(listing.display_price_cents, 0);
  if(grossAmountCents <= 0) return { validationError:'Listing is not configured for paid checkout' };
  const currency = normalizeCurrency(listing.currency);
  const clientPrice = validateClientPrice(input, grossAmountCents, currency);
  if(clientPrice.validationError) return clientPrice;
  const clientLicense = validateClientLicense(input, rights);
  if(clientLicense.validationError) return clientLicense;

  const seller = await getSellerAccount(dataClient, listing.seller_user_id, provider);
  if(seller.error || seller.validationError) return seller;
  if(!seller.account || !sellerAccountCanReceiveSales(seller.account)) return { sellerUnavailable:true };

  const idempotencyKey = cleanString(input.idempotencyKey || input.idempotency_key, '', 160);
  if(idempotencyKey){
    const existing = await querySingle(dataClient, MARKETPLACE_ORDER_TABLE, [['buyer_user_id', buyerUserId], ['idempotency_key', idempotencyKey]]);
    if(existing.error) return { error: existing.error };
    if(existing.row) return { duplicate:true, order:sanitizeCommerceOrder(existing.row, { ownerView:true }), checkout:{ provider, providerCheckoutId:existing.row.provider_transaction_id || null, redirectUrl:null } };
  }

  const allowedFiles = buildAllowedFiles(product, rights);
  const timestamp = nowIso(now);
  const orderPayload = buildOrderPayload({
    orderId: input.orderId || input.order_id,
    buyerUserId,
    buyerEmail: input.buyerEmail || input.buyer_email,
    listing,
    product,
    rights,
    sellerAccount: seller.account,
    provider,
    currency,
    grossAmountCents,
    idempotencyKey,
    timestamp,
    platformFeeBps: options.platformFeeBps
  });
  const orderInsert = await insertSingle(dataClient, MARKETPLACE_ORDER_TABLE, orderPayload);
  if(orderInsert.error) return { error: orderInsert.error };
  const itemPayload = buildOrderItemPayload(orderInsert.row, listing, product, rights, allowedFiles);
  const itemInsert = await insertSingle(dataClient, MARKETPLACE_ORDER_ITEM_TABLE, itemPayload);
  if(itemInsert.error) return { error: itemInsert.error };

  const providerCheckout = await providerAdapter.createCheckout(orderInsert.row, {
    listing,
    product,
    rights,
    sellerAccount: seller.account,
    allowedFiles: publicAllowedFiles(allowedFiles)
  });
  if(providerCheckout.unconfigured) return { providerUnavailable:true, order:sanitizeCommerceOrder(orderInsert.row, { ownerView:true }) };
  if(providerCheckout.error) return { error: providerCheckout.error };
  const providerTransactionId = providerCheckout.providerCheckoutId || null;
  const updated = await updateRows(dataClient, MARKETPLACE_ORDER_TABLE, [['id', orderInsert.row.id]], {
    provider_transaction_id: providerTransactionId,
    payment_status: 'pending',
    provider_metadata: {
      ...safeObject(orderInsert.row.provider_metadata),
      checkout: {
        id: providerTransactionId,
        status: providerCheckout.rawStatus || null
      }
    },
    updated_at: timestamp
  });
  if(updated.error) return { error: updated.error };
  const order = updated.rows[0] || { ...orderInsert.row, provider_transaction_id:providerTransactionId };
  return {
    checkoutCreated:true,
    order:sanitizeCommerceOrder(order, { ownerView:true, checkoutUrl:providerCheckout.redirectUrl || null }),
    item:sanitizeCommerceOrderItem(itemInsert.row),
    listing:sanitizeMarketplaceListing(listing, { product, rights }),
    sellerAccount:sanitizeSellerAccount(seller.account),
    checkout:{
      provider,
      providerCheckoutId: providerTransactionId,
      redirectUrl: providerCheckout.redirectUrl || null
    }
  };
}

async function loadOrderBundle(dataClient, orderId){
  const order = await querySingle(dataClient, MARKETPLACE_ORDER_TABLE, [['id', cleanIdentifier(orderId)]]);
  if(order.error) return { error: order.error };
  if(!order.row) return { unavailable:true };
  const items = await queryRows(dataClient, MARKETPLACE_ORDER_ITEM_TABLE, [['order_id', order.row.id]], 20);
  if(items.error) return { error: items.error };
  const product = await querySingle(dataClient, MARKETPLACE_PRODUCT_TABLE, [['id', order.row.product_id]]);
  if(product.error) return { error: product.error };
  const listing = await querySingle(dataClient, MARKETPLACE_LISTING_TABLE, [['id', order.row.listing_id]]);
  if(listing.error) return { error: listing.error };
  const rights = await querySingle(dataClient, MARKETPLACE_RIGHTS_TABLE, [['product_id', order.row.product_id]]);
  if(rights.error) return { error: rights.error };
  return { order:order.row, items:items.rows, product:product.row, listing:listing.row, rights:rights.row };
}

async function findOrderForProviderEvent(dataClient, normalized){
  if(normalized.orderId){
    const byId = await loadOrderBundle(dataClient, normalized.orderId);
    if(byId.error || !byId.unavailable) return byId;
  }
  if(normalized.providerCheckoutId){
    const order = await querySingle(dataClient, MARKETPLACE_ORDER_TABLE, [['provider', normalized.provider], ['provider_transaction_id', normalized.providerCheckoutId]]);
    if(order.error) return { error: order.error };
    if(order.row) return loadOrderBundle(dataClient, order.row.id);
  }
  if(normalized.providerTransactionId){
    const order = await querySingle(dataClient, MARKETPLACE_ORDER_TABLE, [['provider', normalized.provider], ['provider_transaction_id', normalized.providerTransactionId]]);
    if(order.error) return { error: order.error };
    if(order.row) return loadOrderBundle(dataClient, order.row.id);
  }
  return { unavailable:true };
}

function orderStatusUpdate(order, normalized, timestamp){
  const status = cleanEnum(normalized.paymentStatus, PAYMENT_STATUSES, order.payment_status || 'processing');
  const values = {
    payment_status: status,
    refund_state: cleanEnum(normalized.refundState, REFUND_STATES, order.refund_state || 'none'),
    dispute_state: cleanEnum(normalized.disputeState, DISPUTE_STATES, order.dispute_state || 'none'),
    updated_at: timestamp,
    provider_metadata: {
      ...safeObject(order.provider_metadata),
      latestEventType: normalized.eventType,
      latestProviderTransactionId: normalized.providerTransactionId || null
    }
  };
  if(normalized.providerTransactionId && !order.provider_transaction_id) values.provider_transaction_id = normalized.providerTransactionId;
  if(status === 'paid') values.paid_at = order.paid_at || timestamp;
  if(status === 'failed') values.failed_at = order.failed_at || timestamp;
  if(status === 'canceled') values.canceled_at = order.canceled_at || timestamp;
  if(status === 'refunded' || status === 'partially_refunded') values.refunded_at = timestamp;
  if(status === 'disputed') values.disputed_at = timestamp;
  return values;
}

function buildPurchaseEntitlementPayload(order, item, product, timestamp){
  return {
    id: stableId('mp_ent', { orderId:order.id, productId:product.id, userId:order.buyer_user_id }),
    product_id: product.id,
    listing_id: order.listing_id,
    user_id: order.buyer_user_id,
    buyer_email: order.buyer_email,
    entitlement_type: safeArray(item.allowed_files).length ? 'download' : 'stream',
    source: PURCHASE_ENTITLEMENT_SOURCE,
    status: 'active',
    license_type: item.license_type,
    originating_order_id: order.id,
    allowed_files: safeArray(item.allowed_files),
    download_limit: null,
    download_count: 0,
    starts_at: timestamp,
    expires_at: null,
    granted_by: 'provider_settlement',
    grant_reason: `Provider-confirmed ${order.provider} settlement`,
    created_at: timestamp,
    updated_at: timestamp
  };
}

async function createOrActivatePurchaseEntitlement(dataClient, bundle, timestamp){
  const item = bundle.items[0];
  if(!item || !bundle.product) return { unavailable:true };
  const existingByOrder = await querySingle(dataClient, MARKETPLACE_ENTITLEMENT_TABLE, [['originating_order_id', bundle.order.id]]);
  if(existingByOrder.error) return { error: existingByOrder.error };
  const payload = buildPurchaseEntitlementPayload(bundle.order, item, bundle.product, timestamp);
  if(existingByOrder.row){
    const updated = await updateRows(dataClient, MARKETPLACE_ENTITLEMENT_TABLE, [['id', existingByOrder.row.id]], {
      status:'active',
      source:PURCHASE_ENTITLEMENT_SOURCE,
      license_type:payload.license_type,
      allowed_files:payload.allowed_files,
      originating_order_id:payload.originating_order_id,
      updated_at:timestamp
    });
    if(updated.error) return { error: updated.error };
    return { entitlement:sanitizeMarketplaceEntitlement(updated.rows[0] || { ...existingByOrder.row, ...payload }), activated:true };
  }
  const existingByUserProduct = await querySingle(dataClient, MARKETPLACE_ENTITLEMENT_TABLE, [['product_id', bundle.product.id], ['user_id', bundle.order.buyer_user_id]]);
  if(existingByUserProduct.error) return { error: existingByUserProduct.error };
  if(existingByUserProduct.row){
    const updated = await updateRows(dataClient, MARKETPLACE_ENTITLEMENT_TABLE, [['id', existingByUserProduct.row.id]], {
      status:'active',
      source:PURCHASE_ENTITLEMENT_SOURCE,
      listing_id:payload.listing_id,
      buyer_email:payload.buyer_email,
      entitlement_type:payload.entitlement_type,
      license_type:payload.license_type,
      originating_order_id:payload.originating_order_id,
      allowed_files:payload.allowed_files,
      updated_at:timestamp
    });
    if(updated.error) return { error: updated.error };
    return { entitlement:sanitizeMarketplaceEntitlement(updated.rows[0] || { ...existingByUserProduct.row, ...payload }), activated:true };
  }
  const inserted = await insertSingle(dataClient, MARKETPLACE_ENTITLEMENT_TABLE, payload);
  if(inserted.error) return { error: inserted.error };
  return { entitlement:sanitizeMarketplaceEntitlement(inserted.row), created:true };
}

async function restrictPurchaseEntitlements(dataClient, orderId, status, timestamp){
  if(status !== 'refunded' && status !== 'disputed') return { restricted:false };
  const existing = await queryRows(dataClient, MARKETPLACE_ENTITLEMENT_TABLE, [['originating_order_id', orderId]], 20);
  if(existing.error) return { error: existing.error };
  const restricted = [];
  for(const row of existing.rows){
    const updated = await updateRows(dataClient, MARKETPLACE_ENTITLEMENT_TABLE, [['id', row.id]], {
      status:'revoked',
      updated_at:timestamp,
      grant_reason:`Access restricted after ${status}`
    });
    if(updated.error) return { error: updated.error };
    restricted.push(sanitizeMarketplaceEntitlement(updated.rows[0] || { ...row, status:'revoked' }));
  }
  return { restricted:true, entitlements:restricted };
}

async function handleMarketplacePaymentEvent(dataClient, providerAdapter, rawEvent = {}, now = new Date(), options = {}){
  if(!providerAdapter || !paymentProviderFromInput(providerAdapter.provider)) return { validationError:'Unsupported payment provider' };
  if(!providerAdapter.eventVerificationConfigured) return { providerUnavailable:true };
  if(typeof providerAdapter.verifyEvent === 'function'){
    const verification = await providerAdapter.verifyEvent(rawEvent, options);
    if(verification && verification.error && !verification.trusted) return { verificationFailed:true };
    if(!verification || !verification.trusted) return { verificationFailed:true };
  }
  const normalized = providerAdapter.normalizeEvent(rawEvent, options);
  if(normalized.validationError) return { validationError:normalized.validationError };
  const existing = await querySingle(dataClient, MARKETPLACE_PAYMENT_EVENT_TABLE, [['provider', normalized.provider], ['provider_event_id', normalized.providerEventId]]);
  if(existing.error) return { error: existing.error };
  if(existing.row) return { duplicate:true, event:sanitizePaymentEvent(existing.row) };

  const timestamp = nowIso(now);
  const eventPayload = {
    id: stableId('mp_event', { provider:normalized.provider, providerEventId:normalized.providerEventId }),
    provider: normalized.provider,
    provider_event_id: normalized.providerEventId,
    order_id: normalized.orderId || null,
    provider_transaction_id: normalized.providerTransactionId || normalized.providerCheckoutId || null,
    event_type: normalized.eventType,
    normalized_payment_status: normalized.paymentStatus,
    payload_summary: normalized.payloadSummary || {},
    received_at: timestamp,
    processed_at: null,
    duplicate_of: null,
    error_message: null
  };
  const insertedEvent = await insertSingle(dataClient, MARKETPLACE_PAYMENT_EVENT_TABLE, eventPayload);
  if(insertedEvent.error) return { error: insertedEvent.error };

  const bundle = await findOrderForProviderEvent(dataClient, normalized);
  if(bundle.error) return { error: bundle.error };
  if(bundle.unavailable){
    await updateRows(dataClient, MARKETPLACE_PAYMENT_EVENT_TABLE, [['id', insertedEvent.row.id]], {
      processed_at: timestamp,
      error_message: 'Order not found'
    });
    return { unknownOrder:true, event:sanitizePaymentEvent({ ...insertedEvent.row, processed_at:timestamp }) };
  }
  if(bundle.order.provider !== normalized.provider){
    return { validationError:'Provider event does not match order provider' };
  }
  const update = orderStatusUpdate(bundle.order, normalized, timestamp);
  const orderUpdate = await updateRows(dataClient, MARKETPLACE_ORDER_TABLE, [['id', bundle.order.id]], update);
  if(orderUpdate.error) return { error: orderUpdate.error };
  const updatedOrder = orderUpdate.rows[0] || { ...bundle.order, ...update };
  const updatedBundle = { ...bundle, order:updatedOrder };

  let entitlement = null;
  let entitlementRestricted = null;
  if(updatedOrder.payment_status === 'paid'){
    entitlement = await createOrActivatePurchaseEntitlement(dataClient, updatedBundle, timestamp);
    if(entitlement.error) return { error: entitlement.error };
  }else{
    entitlementRestricted = await restrictPurchaseEntitlements(dataClient, updatedOrder.id, updatedOrder.payment_status, timestamp);
    if(entitlementRestricted.error) return { error: entitlementRestricted.error };
  }

  const eventUpdate = await updateRows(dataClient, MARKETPLACE_PAYMENT_EVENT_TABLE, [['id', insertedEvent.row.id]], {
    order_id: updatedOrder.id,
    processed_at: timestamp
  });
  if(eventUpdate.error) return { error: eventUpdate.error };
  return {
    settled:true,
    event:sanitizePaymentEvent(eventUpdate.rows[0] || { ...insertedEvent.row, order_id:updatedOrder.id, processed_at:timestamp }),
    order:sanitizeCommerceOrder(updatedOrder, { ownerView:true }),
    entitlement: entitlement ? entitlement.entitlement : null,
    entitlementCreated:Boolean(entitlement && entitlement.created),
    entitlementActivated:Boolean(entitlement && entitlement.activated),
    entitlementRestricted
  };
}

async function issueMarketplaceDownloadAccess(dataClient, storage, userId, input = {}, now = new Date()){
  const entitlementId = cleanIdentifier(input.entitlementId || input.entitlement_id);
  const orderId = cleanIdentifier(input.orderId || input.order_id);
  let entitlement = null;
  if(entitlementId){
    const found = await querySingle(dataClient, MARKETPLACE_ENTITLEMENT_TABLE, [['id', entitlementId]]);
    if(found.error) return { error: found.error };
    entitlement = found.row;
  }else if(orderId){
    const found = await querySingle(dataClient, MARKETPLACE_ENTITLEMENT_TABLE, [['originating_order_id', orderId], ['user_id', userId]]);
    if(found.error) return { error: found.error };
    entitlement = found.row;
  }else{
    const productId = cleanIdentifier(input.productId || input.product_id);
    if(!productId) return { validationError:'An entitlement, order or product is required' };
    const found = await querySingle(dataClient, MARKETPLACE_ENTITLEMENT_TABLE, [['product_id', productId], ['user_id', userId]]);
    if(found.error) return { error: found.error };
    entitlement = found.row;
  }
  if(!entitlement) return { unavailable:true };
  if(String(entitlement.user_id) !== String(userId)) return { forbidden:true };
  if(entitlement.status !== 'active') return { forbidden:true };
  const files = safeArray(entitlement.allowed_files).filter(file => safeStoragePath(file.storageObjectPath || file.storage_object_path));
  if(!files.length) return { unavailable:true };
  const fileId = cleanIdentifier(input.fileId || input.file_id, files[0].id);
  const file = files.find(item => String(item.id) === String(fileId)) || files[0];
  const objectPath = safeStoragePath(file.storageObjectPath || file.storage_object_path);
  if(!objectPath) return { unavailable:true };
  if(entitlement.download_limit != null && Number(entitlement.download_count || 0) >= Number(entitlement.download_limit)) return { forbidden:true };
  const expiresIn = 5 * 60;
  const signed = await storage.createSignedUrl(objectPath, expiresIn);
  if(signed.error) return { error: signed.error };
  const timestamp = nowIso(now);
  const expiresAt = new Date((now instanceof Date ? now : new Date(now)).getTime() + expiresIn * 1000).toISOString();
  const session = {
    id: cleanIdentifier(input.downloadSessionId || input.download_session_id) || `mp_down_${randomUUID()}`,
    product_id: entitlement.product_id,
    listing_id: entitlement.listing_id || null,
    user_id: userId,
    entitlement_id: entitlement.id,
    access_scope: 'entitled_download',
    expires_at: expiresAt,
    audit_context: {
      orderId: entitlement.originating_order_id || null,
      fileId: file.id,
      licenseType: entitlement.license_type || null
    },
    created_at: timestamp
  };
  const inserted = await insertSingle(dataClient, MARKETPLACE_PLAYER_SESSION_TABLE, session);
  if(inserted.error) return { error: inserted.error };
  await updateRows(dataClient, MARKETPLACE_ENTITLEMENT_TABLE, [['id', entitlement.id]], {
    download_count: Number(entitlement.download_count || 0) + 1,
    updated_at: timestamp
  });
  return {
    downloadAccess: sanitizeDownloadAccess({
      url: signed.data.signedUrl,
      expiresAt,
      entitlementId: entitlement.id,
      orderId: entitlement.originating_order_id || null,
      productId: entitlement.product_id,
      listingId: entitlement.listing_id || null,
      file,
      session: {
        id: inserted.row && inserted.row.id || session.id,
        accessScope: 'entitled_download',
        expiresAt
      }
    })
  };
}

async function listOwnedMarketplaceOrders(dataClient, userId){
  const result = await queryRows(dataClient, MARKETPLACE_ORDER_TABLE, [['buyer_user_id', userId]], 100);
  if(result.error) return { error: result.error };
  return { orders: result.rows.map(row => sanitizeCommerceOrder(row, { ownerView:true })) };
}

async function checkMarketplaceCommerceSchemaReadiness(dataClient){
  if(!dataClient) return { ready:false, schema:MARKETPLACE_COMMERCE_SCHEMA, status:'unconfigured', message:'Supabase service client is not configured.' };
  const tables = [
    MARKETPLACE_SELLER_ACCOUNT_TABLE,
    MARKETPLACE_ORDER_TABLE,
    MARKETPLACE_ORDER_ITEM_TABLE,
    MARKETPLACE_PAYMENT_EVENT_TABLE,
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
          schema:MARKETPLACE_COMMERCE_SCHEMA,
          status: missing ? 'migration_required' : 'failed',
          message: missing ? 'Marketplace commerce schema 023 is not available.' : 'Marketplace commerce schema readiness check failed.'
        };
      }
    }
    return { ready:true, schema:MARKETPLACE_COMMERCE_SCHEMA, status:'ready', message:'Marketplace commerce schema 023 is available.' };
  }catch(err){
    return { ready:false, schema:MARKETPLACE_COMMERCE_SCHEMA, status:'failed', message:'Marketplace commerce schema readiness check failed.' };
  }
}

module.exports = {
  MARKETPLACE_COMMERCE_SCHEMA,
  MARKETPLACE_SELLER_ACCOUNT_TABLE,
  MARKETPLACE_ORDER_TABLE,
  MARKETPLACE_ORDER_ITEM_TABLE,
  MARKETPLACE_PAYMENT_EVENT_TABLE,
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  PURCHASE_ENTITLEMENT_SOURCE,
  checkMarketplaceCommerceSchemaReadiness,
  createMarketplaceCheckout,
  createMarketplacePaymentProviderAdapter,
  createPayPalCommerceAdapter,
  createStripeConnectAdapter,
  handleMarketplacePaymentEvent,
  issueMarketplaceDownloadAccess,
  listMarketplaceSellerAccounts,
  listOwnedMarketplaceOrders,
  normalizePayPalEvent,
  normalizeStripeEvent,
  sellerAccountCanReceiveSales,
  sanitizeCommerceOrder,
  sanitizeCommerceOrderItem,
  sanitizePaymentEvent,
  sanitizeSellerAccount,
  upsertMarketplaceSellerAccount
};
