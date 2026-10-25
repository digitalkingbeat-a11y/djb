const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Crews = require('../crews');
const Tips = require('../tips');
const Codes = require('../discount_codes');
const Views = require('../view_insights');
const { createMarketplaceCheckout } = require('../marketplace_commerce');
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

const U = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'];
const pid = u => stablePublicProfileId(u);
const judged = (id, user, score) => ({ id, user_id:user, status:'completed', judge_result:{ overallScore:score } });

describe('Oct 20b: crews', () => {
  beforeEach(() => resetRateLimits());
  it('creates a crew with a logo and join code, enforces unique names, one crew per DJ and 4 members max', async () => {
    const db = dataClient({ crews:[], crew_members:[], dj_blocks:[], dj_progression_profiles:[] });
    expect((await Crews.createCrew(db, U[0], { name:'x' })).validationError).to.match(/name/);
    expect((await Crews.createCrew(db, U[0], { name:'Night', logoUrl:'http://x' })).validationError).to.match(/https/);
    const made = await Crews.createCrew(db, U[0], { name:'Night Shift', logoEmoji:'🔥', logoColor:'#2ec4b6' });
    expect(made.crew.name).to.equal('Night Shift');
    expect(made.crew.logo).to.deep.equal({ emoji:'🔥', color:'#2ec4b6', url:null });
    expect(made.crew.inviteCode).to.match(/^[A-F0-9]{8}$/);
    expect((await Crews.createCrew(db, U[1], { name:'night shift' })).validationError).to.match(/taken/);
    expect((await Crews.createCrew(db, U[0], { name:'Another' })).validationError).to.match(/already in a crew/);
    const code = made.crew.inviteCode;
    for(const u of U.slice(1, 4)){ const j = await Crews.joinCrew(db, u, { inviteCode:code }); expect(j.crew.memberCount).to.be.at.least(2); }
    expect((await Crews.joinCrew(db, U[4], { inviteCode:code })).validationError).to.match(/full/);
    const asMember = await Crews.loadCrew(db, made.crew.id, U[1]);
    expect(asMember.crew.inviteCode).to.equal(undefined, 'only the owner sees the code');
    expect(JSON.stringify(asMember.crew)).to.not.include(U[0], 'no account ids leak');
  });
  it('hands ownership on when the owner leaves and deletes the crew when the last DJ leaves', async () => {
    const db = dataClient({ crews:[], crew_members:[], dj_blocks:[], dj_progression_profiles:[] });
    const c = (await Crews.createCrew(db, U[0], { name:'Solo Pair' })).crew;
    await Crews.joinCrew(db, U[1], { inviteCode:c.inviteCode });
    await Crews.leaveCrew(db, U[0], c.id);
    expect((await Crews.loadCrew(db, c.id, U[1])).crew.isOwner).to.equal(true);
    const last = await Crews.leaveCrew(db, U[1], c.id);
    expect(last.disbanded).to.equal(true);
    expect(db.db.crews).to.have.length(0);
  });
  it('ranks crews by points, then wins, then fewer losses', () => {
    const r = Crews.rankCrews([{ name:'A', points:3, wins:1, losses:2 }, { name:'B', points:6, wins:2, losses:0 }, { name:'C', points:3, wins:1, losses:0 }]);
    expect(r.map(x => x.name)).to.deep.equal(['B', 'C', 'A']);
  });
  it('runs a 2-vs-2: lineups of exactly two, judged mixes only, combined totals and standings', async () => {
    const db = dataClient({ crews:[], crew_members:[], dj_blocks:[], dj_progression_profiles:[], crew_battles:[], mix_submissions:[judged('m0', U[0], 88), judged('m1', U[1], 83.5), judged('m2', U[2], 80), judged('m3', U[3], 79), { id:'m4', user_id:U[3], status:'processing', judge_result:null }] });
    const a = (await Crews.createCrew(db, U[0], { name:'Alpha' })).crew; await Crews.joinCrew(db, U[1], { inviteCode:a.inviteCode });
    const b = (await Crews.createCrew(db, U[2], { name:'Bravo' })).crew;
    expect((await Crews.challengeCrew(db, U[0], { opponentCrewId:b.id, lineup:[pid(U[0]), pid(U[1])] })).validationError).to.match(/at least 2/);
    await Crews.joinCrew(db, U[3], { inviteCode:b.inviteCode });
    expect((await Crews.challengeCrew(db, U[0], { opponentCrewId:b.id, lineup:[pid(U[0])] })).validationError).to.match(/exactly two/);
    const ch = await Crews.challengeCrew(db, U[0], { opponentCrewId:b.id, lineup:[pid(U[0]), pid(U[1])] });
    expect(ch.battle.status).to.equal('pending');
    expect((await Crews.respondToCrewBattle(db, U[0], ch.battle.id, { accept:true })).forbidden).to.equal(true);
    const live = await Crews.respondToCrewBattle(db, U[2], ch.battle.id, { accept:true, lineup:[pid(U[2]), pid(U[3])] });
    expect(live.battle.status).to.equal('live');
    expect((await Crews.submitCrewBattleMix(db, U[4], ch.battle.id, { submissionId:'m0' })).forbidden).to.equal(true);
    expect((await Crews.submitCrewBattleMix(db, U[1], ch.battle.id, { submissionId:'m0' })).forbidden).to.equal(true, 'only your own mix');
    expect((await Crews.submitCrewBattleMix(db, U[3], ch.battle.id, { submissionId:'m4' })).validationError).to.match(/judged/);
    await Crews.submitCrewBattleMix(db, U[0], ch.battle.id, { submissionId:'m0' });
    expect((await Crews.submitCrewBattleMix(db, U[0], ch.battle.id, { submissionId:'m0' })).validationError).to.match(/already/);
    await Crews.submitCrewBattleMix(db, U[1], ch.battle.id, { submissionId:'m1' });
    await Crews.submitCrewBattleMix(db, U[2], ch.battle.id, { submissionId:'m2' });
    const done = await Crews.submitCrewBattleMix(db, U[3], ch.battle.id, { submissionId:'m3' });
    expect(done.battle.status).to.equal('complete');
    expect(done.battle.challenger.total).to.equal(171.5);
    expect(done.battle.opponent.total).to.equal(159);
    expect(done.battle.winnerCrewId).to.equal(a.id);
    const ranks = await Crews.crewRankings(db);
    expect(ranks.crews[0]).to.include({ name:'Alpha', wins:1, points:3 });
    expect(ranks.crews[1]).to.include({ name:'Bravo', losses:1, points:0 });
  });
  it('scores an equal total as a draw', () => {
    const row = { challenger_crew_id:'a', opponent_crew_id:'b', challenger_lineup:['1', '2'], opponent_lineup:['3', '4'] };
    expect(Crews.combineScores(row, { 1:80, 2:80, 3:90, 4:70 }).winner).to.equal('draw');
    expect(Crews.combineScores(row, { 1:80, 2:80, 3:90 }).done).to.equal(false);
  });
  it('reports the missing schema as setup step 043', async () => {
    const db = { from:() => ({ select(){ return this; }, eq(){ return this; }, limit(){ return Promise.resolve({ error:{ message:'relation "crew_members" does not exist' } }); } }) };
    expect(await Crews.getMyCrew(db, U[0])).to.deep.equal({ schemaMissing:true, schema:'043_create_crews' });
  });
});

describe('Oct 20b: tips', () => {
  beforeEach(() => resetRateLimits());
  const env = { STRIPE_SECRET_KEY:'sk_test_x', APP_PUBLIC_URL:'https://digitalkingbeat-a11y.github.io/djb/', STRIPE_WEBHOOK_SECRET:'whsec_test' };
  const seller = { seller_user_id:U[1], provider:'stripe', provider_account_id:'acct_123', account_status:'connected', charges_enabled:true, payouts_enabled:true };
  it('validates amounts ($1 to $500) and only reports configured with a Stripe key and app URL', () => {
    expect(Tips.parseAmount({ amountCents:50 }).validationError).to.match(/\$1/);
    expect(Tips.parseAmount({ amountCents:60000 }).validationError).to.match(/\$500/);
    expect(Tips.parseAmount({ amount:'12.5' }).cents).to.equal(1250);
    expect(Tips.tipsStatus({}).configured).to.equal(false);
    expect(Tips.tipsStatus(env)).to.include({ configured:true });
    expect(JSON.stringify(Tips.tipsStatus(env))).to.not.include('sk_test');
  });
  it('creates a Stripe checkout that pays the DJ\'s connected account, with tip metadata', async () => {
    const db = dataClient({ marketplace_seller_accounts:[seller], dj_tips:[], dj_blocks:[] });
    let sent = null;
    const httpClient = async (url, opts) => { sent = { url, body:String(opts.body), auth:opts.headers.Authorization }; return { ok:true, json:async () => ({ id:'cs_1', url:'https://checkout.stripe.com/c/pay/cs_1' }) }; };
    expect((await Tips.createTipCheckout(db, U[1], { toPublicProfileId:pid(U[1]), amountCents:500 }, { env, httpClient })).validationError).to.match(/yourself/);
    const r = await Tips.createTipCheckout(db, U[0], { toPublicProfileId:pid(U[1]), amountCents:500, message:'Great set' }, { env, httpClient });
    expect(r.redirectUrl).to.match(/^https:\/\/checkout\.stripe\.com/);
    expect(sent.url).to.equal('https://api.stripe.com/v1/checkout/sessions');
    expect(sent.body).to.include('payment_intent_data%5Btransfer_data%5D%5Bdestination%5D=acct_123');
    expect(sent.body).to.include('metadata%5Bkind%5D=tip');
    expect(sent.body).to.include('unit_amount%5D=500');
    expect(sent.body).to.not.include('application_fee');
    expect(db.db.dj_tips[0]).to.include({ amount_cents:500, message:'Great set', status:'pending', provider_checkout_id:'cs_1' });
  });
  it('refuses DJs without finished Stripe payouts, and when Stripe isn\'t configured', async () => {
    const db = dataClient({ marketplace_seller_accounts:[{ ...seller, payouts_enabled:false }], dj_tips:[], dj_blocks:[] });
    expect((await Tips.createTipCheckout(db, U[0], { toPublicProfileId:pid(U[1]), amountCents:500 }, { env, httpClient:async () => ({}) })).recipientUnavailable).to.equal(true);
    expect((await Tips.createTipCheckout(db, U[0], { toPublicProfileId:pid(U[1]), amountCents:500 }, { env:{}, httpClient:async () => ({}) })).providerUnavailable).to.equal(true);
    expect((await Tips.tipEligibility(db, pid(U[1]))).canTip).to.equal(false);
  });
  it('marks a tip paid from a signed Stripe webhook and lists paid tips for the DJ', async () => {
    const db = dataClient({ dj_tips:[{ id:'tip_abc', tipper_user_id:U[0], recipient_user_id:U[1], amount_cents:500, status:'pending', message:'🔥', created_at:'2026-10-20T10:00:00Z' }], dj_progression_profiles:[] });
    const event = { id:'evt_1', type:'checkout.session.completed', data:{ object:{ payment_status:'paid', metadata:{ kind:'tip', tipId:'tip_abc' } } } };
    expect(Tips.isTipEvent(event)).to.equal(true);
    expect(Tips.isTipEvent({ data:{ object:{ metadata:{ orderId:'o1' } } } })).to.equal(false);
    const raw = JSON.stringify(event); const t = 1700000000;
    const sig = `t=${t},v1=${crypto.createHmac('sha256', env.STRIPE_WEBHOOK_SECRET).update(`${t}.${raw}`).digest('hex')}`;
    expect(Tips.verifyTipWebhook(raw, 'bad', env).trusted).to.equal(false);
    expect(Tips.verifyTipWebhook(raw, sig, env).trusted).to.equal(true);
    expect((await Tips.handleTipEvent(db, event)).status).to.equal('paid');
    expect((await Tips.handleTipEvent(db, event)).duplicate).to.equal(true);
    const mine = await Tips.listTips(db, U[1]);
    expect(mine.totalCents).to.equal(500);
    expect(mine.tips[0].message).to.equal('🔥');
    expect(JSON.stringify(mine)).to.not.include(U[0]);
  });
  it('routes tip events through the Stripe webhook before the marketplace handler', () => {
    expect(serverSource.indexOf('Tips.isTipEvent(req.body)')).to.be.lessThan(serverSource.indexOf('handleMarketplacePaymentEvent(supabaseService'));
    ['/api/tips/checkout', '/api/tips/mine', '/api/tips/config', '/api/crews/mine', '/api/crewBattles', '/api/marketplace/discountCodes', '/api/insights/views', '/api/marketplace/listings/:listingId/views'].forEach(r => expect(serverSource).to.include(`'${r}'`));
  });
});

describe('Oct 20b: Beat Store discount codes', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  it('validates codes: format, percent 1-90, fixed amount, future end date, usage limit', () => {
    expect(Codes.validateInput({ code:'a', kind:'percent', percentOff:10 }, now).validationError).to.match(/3 to 20/);
    expect(Codes.validateInput({ code:'BATTLE20', kind:'percent', percentOff:95 }, now).validationError).to.match(/1 and 90/);
    expect(Codes.validateInput({ code:'BATTLE20', kind:'percent', percentOff:20, endsAt:'2026-10-01' }, now).validationError).to.match(/future/);
    expect(Codes.validateInput({ code:'battle20', kind:'fixed', amountOffCents:500, usageLimit:10 }, now).value).to.include({ code:'BATTLE20', amount_off_cents:500, usage_limit:10 });
  });
  it('works out discounts on the server and never charges below $0.50', () => {
    expect(Codes.discountFor({ kind:'percent', percent_off:20 }, 2500)).to.deep.equal({ discountCents:500, finalCents:2000 });
    expect(Codes.discountFor({ kind:'fixed', amount_off_cents:5000 }, 1000)).to.deep.equal({ discountCents:950, finalCents:50 });
  });
  it('rejects ended, used-up, turned-off and other sellers\' codes', async () => {
    const rows = [
      { id:'c1', seller_user_id:U[1], code:'OLD', kind:'percent', percent_off:10, ends_at:'2026-10-19T00:00:00Z', times_used:0, active:true },
      { id:'c2', seller_user_id:U[1], code:'FULL', kind:'percent', percent_off:10, usage_limit:2, times_used:2, active:true },
      { id:'c3', seller_user_id:U[1], code:'OFF', kind:'percent', percent_off:10, times_used:0, active:false },
      { id:'c4', seller_user_id:U[2], code:'THEIRS', kind:'percent', percent_off:10, times_used:0, active:true }
    ];
    const db = dataClient({ beat_discount_codes:rows });
    const t = code => Codes.resolveDiscount(db, { sellerUserId:U[1], code, grossCents:2500, now });
    expect((await t('old')).validationError).to.match(/ended/);
    expect((await t('FULL')).validationError).to.match(/used up/);
    expect((await t('OFF')).validationError).to.match(/isn.t valid/);
    expect((await t('THEIRS')).validationError).to.match(/isn.t valid/);
    expect((await t('')).none).to.equal(true);
  });
  it('lets sellers create, list and turn codes off, but not touch other sellers\' codes', async () => {
    const db = dataClient({ beat_discount_codes:[] });
    const made = await Codes.createCode(db, U[1], { code:'BATTLE20', kind:'percent', percentOff:20, usageLimit:50 }, now);
    expect(made.code).to.include({ code:'BATTLE20', percentOff:20, usageLimit:50, timesUsed:0, state:'live' });
    expect((await Codes.createCode(db, U[1], { code:'battle20', kind:'percent', percentOff:5 }, now)).validationError).to.match(/already/);
    expect((await Codes.setCodeActive(db, U[2], made.code.id, false)).forbidden).to.equal(true);
    expect((await Codes.setCodeActive(db, U[1], made.code.id, false)).code.state).to.equal('off');
    expect((await Codes.listCodes(db, U[1], now)).codes).to.have.length(1);
  });
  it('applies the code inside marketplace checkout: Stripe gets the lower price and a use is held until payment (Oct 20c)', async () => {
    const db = dataClient({
      marketplace_listings:[{ id:'lst_1', status:'published', product_id:'p1', seller_user_id:U[1], display_price_cents:2500, currency:'USD' }],
      marketplace_products:[{ id:'p1', status:'active', title:'Beat' }],
      marketplace_rights_policies:[{ product_id:'p1', status:'active', marketplace_streaming_allowed:true }],
      marketplace_seller_accounts:[{ seller_user_id:U[1], provider:'stripe', provider_account_id:'acct_1', account_status:'connected', charges_enabled:true, payouts_enabled:true }],
      marketplace_orders:[], marketplace_order_items:[], beat_discount_redemptions:[],
      beat_discount_codes:[{ id:'c1', seller_user_id:U[1], code:'BATTLE20', kind:'percent', percent_off:20, usage_limit:5, times_used:0, reserved_uses:0, active:true }]
    });
    let charged = null;
    const adapter = { provider:'stripe', configured:true, async createCheckout(order){ charged = order.gross_amount_cents; return { providerCheckoutId:'cs_9', redirectUrl:'https://checkout.stripe.com/x' }; } };
    const r = await createMarketplaceCheckout(db, adapter, U[0], { listingId:'lst_1', provider:'stripe', clientPriceCents:2500, currency:'USD', discountCode:'battle20' }, now);
    if(r.validationError || r.error || r.unavailable) throw new Error(JSON.stringify(r));
    expect(charged).to.equal(2000);
    expect(r.discount).to.deep.equal({ code:'BATTLE20', originalCents:2500, discountCents:500, finalCents:2000 });
    expect(db.db.beat_discount_codes[0].times_used).to.equal(0);
    expect(db.db.beat_discount_codes[0].reserved_uses).to.equal(1);
    expect(db.db.beat_discount_redemptions).to.have.length(1);
    const bad = await createMarketplaceCheckout(db, adapter, U[0], { listingId:'lst_1', provider:'stripe', clientPriceCents:2500, currency:'USD', discountCode:'NOPE' }, now);
    expect(bad.validationError).to.match(/isn.t valid/);
  });
});

describe("Oct 20b: who's watching", () => {
  it('buckets referrers into broad sources without keeping the URL', () => {
    expect(Views.sourceFromReferrer('')).to.equal('direct');
    expect(Views.sourceFromReferrer('https://l.instagram.com/?u=x')).to.equal('instagram');
    expect(Views.sourceFromReferrer('https://t.co/abc')).to.equal('x');
    expect(Views.sourceFromReferrer('https://www.google.com/search?q=dj')).to.equal('search');
    expect(Views.sourceFromReferrer('https://digitalkingbeat-a11y.github.io/djb/#rankings', 'digitalkingbeat-a11y.github.io')).to.equal('djbattle');
    expect(Views.sourceFromReferrer('https://someblog.example/post')).to.equal('other');
    expect(Views.sourceFromReferrer('https://x.example', '', true)).to.equal('embed');
  });
  it('weeks start on Monday (UTC)', () => {
    expect(Views.weekStart(new Date('2026-10-20T12:00:00Z'))).to.equal('2026-10-19');
    expect(Views.weekStart(new Date('2026-10-25T23:00:00Z'))).to.equal('2026-10-19');
  });
  it('logs only what was viewed, whose it is, the week and the source bucket', async () => {
    const db = dataClient({ view_events:[] });
    await Views.logViewEvent(db, { kind:'profile', targetId:'dj_1', ownerUserId:U[0], referrer:'https://www.instagram.com/p/xyz?igsh=secret', now:new Date('2026-10-20T12:00:00Z') });
    const row = db.db.view_events[0];
    expect(Object.keys(row).sort()).to.deep.equal(['id', 'kind', 'owner_user_id', 'source', 'target_id', 'viewed_at', 'week_start']);
    expect(JSON.stringify(row)).to.not.include('igsh');
  });
  it('summarizes 8 weeks: per-kind counts, trend vs last week and top sources', async () => {
    const now = new Date('2026-10-20T12:00:00Z');
    const ev = (kind, source, when) => ({ id:Math.random().toString(36), kind, target_id:'t', owner_user_id:U[0], source, week_start:Views.weekStart(new Date(when)), viewed_at:new Date(when).toISOString() });
    const rows = [ev('profile', 'instagram', '2026-10-19T10:00Z'), ev('profile', 'instagram', '2026-10-20T10:00Z'), ev('result', 'direct', '2026-10-20T11:00Z'), ev('listing', 'search', '2026-10-20T11:30Z'), ev('profile', 'direct', '2026-10-13T10:00Z'), ev('profile', 'direct', '2026-10-14T10:00Z'), ev('profile', 'direct', '2026-01-01T10:00Z')];
    const db = dataClient({ view_events:[...rows, { ...ev('profile', 'direct', '2026-10-20T10:00Z'), owner_user_id:U[1] }] });
    const { insights } = await Views.getInsights(db, U[0], now);
    expect(insights.weeks).to.have.length(8);
    expect(insights.weeks[7]).to.equal('2026-10-19');
    expect(insights.thisWeek).to.deep.equal({ total:4, profile:2, result:1, listing:1 });
    expect(insights.lastWeek.total).to.equal(2);
    expect(insights.trend).to.deep.equal({ changePercent:100, direction:'up' });
    expect(insights.sources[0]).to.include({ source:'instagram', views:2, percent:50 });
    expect(insights.totals.reduce((a, b) => a + b, 0)).to.equal(6, 'old views and other DJs\' views are left out');
  });
  it('the existing view routes feed the log only for new (non-duplicate) views', () => {
    expect(serverSource).to.include("if(!result.duplicate && result.ownerUserId) logViewQuietly(req, 'profile'");
    expect(serverSource).to.include("if(!result.duplicate && result.ownerUserId) logViewQuietly(req, 'result'");
    expect(serverSource).to.not.match(/ownerUserId:result\.ownerUserId/, 'owner ids are never sent to the browser');
  });
});

describe('Oct 20b: SQL files', () => {
  it('adds 043-046 with row level security, and keeps README notes', () => {
    ['043_create_crews.sql', '044_create_dj_tips.sql', '045_create_beat_discount_codes.sql', '046_create_view_events.sql'].forEach(f => {
      const text = sql(f);
      expect(text).to.match(/ENABLE ROW LEVEL SECURITY/);
      expect(fs.readFileSync(path.join(root, 'sql', 'README.md'), 'utf8')).to.include(f);
    });
    expect(sql('043_create_crews.sql')).to.include('crew_members_one_crew');
    expect(sql('046_create_view_events.sql').replace(/--.*$/gm, '')).to.not.match(/\bip\b|user_agent|visitor_id/i);
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    expect(readme).to.include('Oct 20b');
    expect(readme).to.include('No new keys');
  });
});
