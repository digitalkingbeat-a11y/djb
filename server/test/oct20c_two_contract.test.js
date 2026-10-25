const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const Codes = require('../discount_codes');
const Invites = require('../invites');
const Social = require('../social_notifications');
const { createMarketplaceCheckout, createStripeConnectAdapter, handleMarketplacePaymentEvent } = require('../marketplace_commerce');
const { resetRateLimits, stablePublicProfileId } = require('../social_helpers');

const root = path.join(__dirname, '..');
const sql = name => fs.readFileSync(path.join(root, 'sql', name), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
function dataClient(initial = {}){
  const db = Object.fromEntries(Object.entries(initial).map(([t, rows]) => [t, rows.map(r => ({ ...r }))]));
  return { db, from(table){ if(!db[table]) db[table] = []; return new Query(db, table); } };
}
class Query{
  constructor(db, table){ Object.assign(this, { db, table, filters:[], inFilters:[], limitValue:null, insertRows:null, updateValues:null, orderBy:null, del:false }); }
  select(){ return this; }
  eq(f, v){ this.filters.push([f, v]); return this; }
  in(f, vs){ this.inFilters.push([f, vs.map(String)]); return this; }
  order(f, o){ this.orderBy = [f, o && o.ascending]; return this; }
  limit(v){ this.limitValue = v; return this; }
  insert(rows){ this.insertRows = rows.map(r => ({ ...r })); return this; }
  update(v){ this.updateValues = { ...v }; return this; }
  delete(){ this.del = true; return this; }
  then(res, rej){ return this.exec().then(res, rej); }
  async single(){ const r = await this.exec(); return r.error ? r : { data:(r.data || [])[0] || null, error:null }; }
  async exec(){
    const t = this.db[this.table];
    if(this.insertRows){ t.push(...this.insertRows); return { data:this.insertRows, error:null }; }
    let rows = t.filter(r => this.filters.every(([f, v]) => String(r[f]) === String(v))).filter(r => this.inFilters.every(([f, vs]) => vs.includes(String(r[f]))));
    if(this.del){ this.db[this.table] = t.filter(r => !rows.includes(r)); return { data:rows, error:null }; }
    if(this.updateValues){ rows.forEach(r => Object.assign(r, this.updateValues)); return { data:rows, error:null }; }
    if(this.orderBy){ const [f, asc] = this.orderBy; rows = rows.slice().sort((a, b) => (new Date(a[f]) - new Date(b[f])) * (asc ? 1 : -1)); }
    if(this.limitValue != null) rows = rows.slice(0, this.limitValue);
    return { data:rows, error:null };
  }
}
const U = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
const now = new Date('2026-10-25T12:00:00Z');
const code = (o = {}) => ({ id:'c1', seller_user_id:U[1], code:'BATTLE20', kind:'percent', percent_off:20, usage_limit:2, times_used:0, reserved_uses:0, active:true, ...o });
function storeDb(codeRow = code()){
  return dataClient({
    marketplace_listings:[{ id:'lst_1', status:'published', product_id:'p1', seller_user_id:U[1], display_price_cents:2500, currency:'USD' }],
    marketplace_products:[{ id:'p1', status:'active', title:'Beat' }],
    marketplace_rights_policies:[{ product_id:'p1', status:'active', marketplace_streaming_allowed:true }],
    marketplace_seller_accounts:[{ seller_user_id:U[1], provider:'stripe', provider_account_id:'acct_1', account_status:'connected', charges_enabled:true, payouts_enabled:true }],
    marketplace_orders:[], marketplace_order_items:[], marketplace_payment_events:[], marketplace_entitlements:[], beat_discount_redemptions:[],
    beat_discount_codes:[codeRow]
  });
}
const stripe = (opts = {}) => createStripeConnectAdapter({ trustEvents:true, gateway:{ async createCheckoutSession(p){ if(opts.fail) throw new Error('Stripe is down'); return { id:`cs_${p.metadata && p.metadata.orderId || 'x'}`, url:'https://checkout.stripe.test/x', status:'open' }; } } });
const event = (id, type, orderId) => ({ id, trusted:true, type, data:{ object:{ id:`cs_${orderId}`, payment_intent:`pi_${orderId}`, amount_total:2000, amount:2000, amount_refunded:0, currency:'usd', metadata:{ orderId } } } });
const buy = (db, buyer, orderId, adapter = stripe(), at = now) => createMarketplaceCheckout(db, adapter, buyer, { orderId, listingId:'lst_1', provider:'stripe', clientPriceCents:2500, currency:'USD', discountCode:'battle20' }, at);

describe('Oct 20c: discount code uses count only after payment', () => {
  beforeEach(() => resetRateLimits());
  it('starting checkout only holds a use; Stripe "paid" counts it exactly once, even if the webhook repeats', async () => {
    const db = storeDb();
    const r = await buy(db, U[0], 'order-a');
    if(r.validationError || r.error) throw new Error(JSON.stringify(r));
    expect(r.discount.finalCents).to.equal(2000);
    const c = () => db.db.beat_discount_codes[0];
    expect(c().times_used).to.equal(0, 'not counted at checkout start');
    expect(c().reserved_uses).to.equal(1);
    expect(db.db.beat_discount_redemptions[0]).to.include({ status:'reserved', order_id:'order-a' });
    const paid = await handleMarketplacePaymentEvent(db, stripe(), event('evt_1', 'checkout.session.completed', 'order-a'), now);
    expect(paid.settled).to.equal(true);
    expect(c()).to.include({ times_used:1, reserved_uses:0 });
    expect(db.db.beat_discount_redemptions[0].status).to.equal('confirmed');
    await handleMarketplacePaymentEvent(db, stripe(), event('evt_1', 'checkout.session.completed', 'order-a'), now); // same event again
    await handleMarketplacePaymentEvent(db, stripe(), event('evt_2', 'payment_intent.succeeded', 'order-a'), now); // second "paid" event for same order
    await Codes.settleForOrder(db, 'order-a', 'paid', now);
    expect(c()).to.include({ times_used:1, reserved_uses:0 }, 'never double counted');
  });
  it('an expired or failed checkout gives the held use back, and the code can be used again', async () => {
    const db = storeDb(code({ usage_limit:1 }));
    await buy(db, U[0], 'order-b');
    expect((await buy(db, U[2], 'order-c')).validationError).to.match(/used up/, 'last use is held for the first buyer');
    await handleMarketplacePaymentEvent(db, stripe(), event('evt_x', 'checkout.session.expired', 'order-b'), now);
    expect(db.db.beat_discount_codes[0]).to.include({ times_used:0, reserved_uses:0 });
    expect(db.db.beat_discount_redemptions.find(r => r.order_id === 'order-b').status).to.equal('released');
    const again = await buy(db, U[2], 'order-d');
    expect(again.checkoutCreated).to.equal(true);
    expect(db.db.beat_discount_codes[0].reserved_uses).to.equal(1);
  });
  it('a hold Stripe never answers for is released after 24 hours', async () => {
    const db = storeDb(code({ usage_limit:1 }));
    await buy(db, U[0], 'order-e');
    const later = new Date(now.getTime() + Codes.RESERVATION_MS + 60000);
    const d = await Codes.resolveDiscount(db, { sellerUserId:U[1], code:'BATTLE20', grossCents:2500, now:later });
    expect(d.row, 'code is live again').to.be.an('object');
    expect(db.db.beat_discount_codes[0].reserved_uses).to.equal(0);
    // ...and if that very late payment does land, it still counts (once).
    await Codes.settleForOrder(db, 'order-e', 'paid', later);
    await Codes.settleForOrder(db, 'order-e', 'paid', later);
    expect(db.db.beat_discount_codes[0]).to.include({ times_used:1, reserved_uses:0 });
  });
  it('if checkout never reaches Stripe, the hold is given straight back', async () => {
    const db = storeDb();
    let thrown = null;
    await buy(db, U[0], 'order-f', stripe({ fail:true })).catch(e => { thrown = e; });
    expect(String(thrown && thrown.message)).to.match(/Stripe is down/);
    expect(db.db.beat_discount_codes[0]).to.include({ times_used:0, reserved_uses:0 });
    expect(db.db.beat_discount_redemptions[0].status).to.equal('released');
  });
  it('a limited code shows "used up" while all its uses are held or counted', () => {
    expect(Codes.codeState(code({ usage_limit:2, times_used:1, reserved_uses:1 }), now)).to.equal('used_up');
    expect(Codes.codeState(code({ usage_limit:2, times_used:1, reserved_uses:0 }), now)).to.equal('live');
    expect(Codes.publicCode(code({ reserved_uses:2 }), now).reservedUses).to.equal(2);
  });
  it('before SQL 047 is run, checkout explains the setup step instead of giving an untracked discount', async () => {
    const db = storeDb();
    const real = db.from.bind(db);
    db.from = t => { const q = real(t); if(t === 'beat_discount_codes'){ const upd = q.update.bind(q); q.update = v => { if('reserved_uses' in v){ q.exec = async () => ({ data:null, error:{ message:'Could not find the \'reserved_uses\' column of \'beat_discount_codes\' in the schema cache' } }); } return upd(v); }; } return q; };
    const r = await buy(db, U[0], 'order-g');
    expect(r.validationError).to.match(/SQL 047/);
  });
});

describe('Oct 20c: personal invite links', () => {
  beforeEach(() => resetRateLimits());
  const profiles = [{ user_id:U[0], display_name:'DJ Nova' }, { user_id:U[1], display_name:'DJ Kilo' }, { user_id:U[2], display_name:'DJ Echo' }, { user_id:U[3], display_name:'DJ Old' }];
  const fresh = (id, daysOld = 0) => ({ id, created_at:new Date(now.getTime() - daysOld * 86400000).toISOString() });
  const inviteDb = () => dataClient({ dj_invite_codes:[], dj_invite_joins:[], dj_progression_profiles:profiles, dj_notifications:[], dj_notification_mutes:[], push_subscriptions:[] });

  it('gives each DJ one readable code that stays the same', async () => {
    const db = inviteDb();
    const a = await Invites.getMyInvite(db, U[0], now);
    expect(a.invite.code).to.match(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(a.invite).to.include({ joinCount:0 });
    expect(a.invite.badge).to.equal(null);
    expect(a.invite.next).to.deep.equal({ label:'Connector', emoji:'🤝', needed:1 });
    expect((await Invites.getMyInvite(db, U[0], now)).invite.code).to.equal(a.invite.code);
    expect(db.db.dj_invite_codes).to.have.length(1);
  });
  it('credits a brand-new account once, alerts the inviter, and updates count and badge', async () => {
    const db = inviteDb();
    const mine = (await Invites.getMyInvite(db, U[0], now)).invite.code;
    const r = await Invites.claimInvite(db, fresh(U[1]), { code:mine.toLowerCase() }, now);
    expect(r.claimed).to.equal(true);
    expect(r.inviter.displayName).to.equal('DJ Nova');
    expect(JSON.stringify(r)).to.not.include(U[0], 'no account ids go to the browser');
    expect((await Invites.claimInvite(db, fresh(U[1]), { code:mine }, now)).alreadyCounted).to.equal(true);
    expect(db.db.dj_invite_joins).to.have.length(1);
    const alert = db.db.dj_notifications.find(n => n.user_id === U[0]);
    expect(alert).to.include({ type:'invite_joined', summary:'DJ Kilo joined DJ Battle from your invite link' });
    expect(alert.destination).to.deep.equal({ type:'invites', view:'profile' });
    await Invites.claimInvite(db, fresh(U[2]), { code:mine }, now);
    const card = (await Invites.getMyInvite(db, U[0], now)).invite;
    expect(card.joinCount).to.equal(2);
    expect(card.badge).to.deep.equal({ key:'connector', emoji:'🤝', label:'Connector' });
    expect(card.next).to.deep.equal({ label:'Crew Recruiter', emoji:'📣', needed:1 });
    expect(card.friends.map(f => f.displayName).sort()).to.deep.equal(['DJ Echo', 'DJ Kilo']);
    expect(card.friends[0].publicProfileId).to.equal(stablePublicProfileId(card.friends[0].publicProfileId === stablePublicProfileId(U[1]) ? U[1] : U[2]));
    expect(JSON.stringify(card)).to.not.match(new RegExp(`${U[1]}|${U[2]}|@`));
  });
  it('does not count your own link, an existing (older) account, or a made-up code', async () => {
    const db = inviteDb();
    const mine = (await Invites.getMyInvite(db, U[0], now)).invite.code;
    expect((await Invites.claimInvite(db, fresh(U[0]), { code:mine }, now)).ownCode).to.equal(true);
    expect((await Invites.claimInvite(db, fresh(U[3], 40), { code:mine }, now)).notNewAccount).to.equal(true);
    expect((await Invites.claimInvite(db, fresh(U[1]), { code:'ZZZZZZZZ' }, now)).validationError).to.match(/isn.t valid/);
    expect((await Invites.claimInvite(db, fresh(U[1]), { code:'<x>' }, now)).validationError).to.match(/isn.t valid/);
    expect(db.db.dj_invite_joins).to.have.length(0);
    expect(db.db.dj_notifications).to.have.length(0);
  });
  it('the public lookup shows only the inviter\u2019s DJ name', async () => {
    const db = inviteDb();
    const mine = (await Invites.getMyInvite(db, U[0], now)).invite.code;
    const r = await Invites.lookupInvite(db, mine);
    expect(r.invite.inviter.displayName).to.equal('DJ Nova');
    expect(JSON.stringify(r)).to.not.include(U[0]);
    expect((await Invites.lookupInvite(db, 'NOPE1234')).notFound).to.equal(true);
  });
  it('badge levels: 1, 3, 10 and 25 friends', () => {
    expect(Invites.badgeFor(0).badge).to.equal(null);
    expect(Invites.badgeFor(3).badge.label).to.equal('Crew Recruiter');
    expect(Invites.badgeFor(10).badge.label).to.equal('Scene Builder');
    expect(Invites.badgeFor(30)).to.deep.equal({ badge:{ key:'ambassador', emoji:'👑', label:'DJ Battle Ambassador' }, next:null });
  });
  it('limits claim attempts and explains the missing SQL step', async () => {
    const db = inviteDb();
    for(let i = 0; i < 5; i++) await Invites.claimInvite(db, fresh(U[1]), { code:'ZZZZZZZZ' }, now);
    expect((await Invites.claimInvite(db, fresh(U[1]), { code:'ZZZZZZZZ' }, now)).rateLimited).to.equal(true);
    const broken = { from(){ return { select(){ return this; }, eq(){ return this; }, limit(){ return Promise.resolve({ data:null, error:{ message:'relation "public.dj_invite_codes" does not exist' } }); } }; } };
    expect(await Invites.getMyInvite(broken, U[0], now)).to.deep.equal({ schemaMissing:true, schema:'048_create_dj_invites' });
  });
  it('has server routes and an Activity-bell type', () => {
    ["'/api/invites/mine'", "'/api/invites/claim'", "'/api/invites/:code'"].forEach(r => expect(serverSource).to.include(r));
    expect(serverSource).to.match(/app\.post\('\/api\/invites\/claim', requireAuth/);
    expect(serverSource).to.match(/app\.get\('\/api\/invites\/mine', requireAuth/);
    expect(Social.SOCIAL_NOTIFICATION_TYPES).to.include('invite_joined');
  });
});

describe('Oct 20c: SQL files', () => {
  it('047 and 048 are safe to re-run, server-only and listed in the README', () => {
    const readme = fs.readFileSync(path.join(root, 'sql', 'README.md'), 'utf8');
    ['047_add_discount_code_reservations.sql', '048_create_dj_invites.sql'].forEach(f => {
      const text = sql(f);
      expect(readme).to.include(f);
      expect(text).to.match(/ENABLE ROW LEVEL SECURITY/);
      expect(text).to.not.match(/CREATE TABLE (?!IF NOT EXISTS)/);
      expect(text).to.not.match(/ADD COLUMN (?!IF NOT EXISTS)/);
      expect(text).to.not.match(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
      expect((text.match(/ADD CONSTRAINT/g) || []).length).to.equal((text.match(/DROP CONSTRAINT IF EXISTS/g) || []).length, 'every constraint is dropped first');
      expect(text).to.not.match(/CREATE POLICY/, 'no browser access');
    });
    expect(sql('047_add_discount_code_reservations.sql')).to.include("DEFAULT 'confirmed'");
    // 048 keeps every older notification type
    const types = sql('048_create_dj_invites.sql');
    ['challenge_received', 'direct_message', 'result_review_decided', 'timed_comment_received', 'invite_joined'].forEach(t => expect(types).to.include(`'${t}'`));
  });
});
