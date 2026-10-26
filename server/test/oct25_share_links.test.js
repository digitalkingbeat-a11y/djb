const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const Share = require('../share_links');
const { createMarketplaceCheckout } = require('../marketplace_commerce');
const root = path.join(__dirname, '..');
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

const SELLER = 'seller-1', SHARER = 'sharer-1', BUYER = 'buyer-1';
const base = () => dataClient({
  marketplace_listings:[{ id:'l1', seller_user_id:SELLER, status:'published', title:'Night Drive' }, { id:'l2', seller_user_id:SELLER, status:'draft', title:'Hidden' }],
  marketplace_share_links:[], marketplace_share_events:[], marketplace_orders:[],
  dj_progression_profiles:[{ user_id:SHARER, display_name:'Kid Rhythm', public_profile_id:'dj_secret' }, { user_id:SELLER, display_name:'Seller DJ' }]
});

describe('Oct 25: beat share links', () => {
  it('SQL 053 makes the two service-role tables with hashed visitors only', () => {
    const sql = fs.readFileSync(path.join(root, 'sql', '053_create_beat_share_links.sql'), 'utf8');
    expect(sql).to.match(/CREATE TABLE IF NOT EXISTS public\.marketplace_share_links/);
    expect(sql).to.match(/CREATE TABLE IF NOT EXISTS public\.marketplace_share_events/);
    expect(sql).to.match(/UNIQUE \(code, kind, visitor_hash, day\)/);
    expect(sql.match(/ENABLE ROW LEVEL SECURITY/g)).to.have.length(2);
    expect(sql.replace(/--.*$/gm, '')).to.not.match(/\bip\b|user_agent|email/i);
  });

  it('gives one stable code per DJ per beat and refuses unpublished beats', async () => {
    const db = base();
    const a = await Share.createShareLink(db, SHARER, 'l1', { baseUrl:'https://djb.example/' });
    expect(a.code).to.match(/^[a-z0-9]{10}$/);
    expect(a.url).to.equal(`https://djb.example/index.html?beat=l1&ref=${a.code}#store`);
    expect((await Share.createShareLink(db, SHARER, 'l1')).code).to.equal(a.code);
    expect(db.db.marketplace_share_links).to.have.length(1);
    expect((await Share.createShareLink(db, SHARER, 'l2')).unavailable).to.equal(true);
    expect((await Share.createShareLink(db, null, 'l1')).validationError).to.be.a('string');
  });

  it('counts a visit and a play once per visitor per day, never for the sharer, and stores no visitor details', async () => {
    const db = base();
    const { code } = await Share.createShareLink(db, SHARER, 'l1');
    const v = { visitorId:'visitor-abc', ip:'203.0.113.9', userAgent:'UA' };
    const now = new Date('2026-10-25T12:00:00Z');
    expect((await Share.recordShareEvent(db, { code, listingId:'l1', kind:'visit', visitor:v, now })).counted).to.equal(true);
    expect((await Share.recordShareEvent(db, { code, listingId:'l1', kind:'visit', visitor:v, now })).skipped).to.equal('repeat');
    expect((await Share.recordShareEvent(db, { code, listingId:'l1', kind:'play', visitor:v, now })).counted).to.equal(true);
    expect((await Share.recordShareEvent(db, { code, listingId:'l1', kind:'visit', visitor:v, now:new Date('2026-10-26T12:00:00Z') })).counted).to.equal(true);
    expect((await Share.recordShareEvent(db, { code, listingId:'l1', kind:'visit', visitor:{ visitorId:'x' }, viewerUserId:SHARER, now })).skipped).to.equal('own_link');
    expect((await Share.recordShareEvent(db, { code, listingId:'other', kind:'visit', visitor:{ visitorId:'y' }, now })).skipped).to.equal('wrong_beat');
    expect((await Share.recordShareEvent(db, { code:'nope', kind:'visit', visitor:v, now })).skipped).to.equal('unknown_code');
    expect((await Share.recordShareEvent(db, { code, kind:'buy', visitor:v, now })).validationError).to.be.a('string');
    const stored = JSON.stringify(db.db.marketplace_share_events);
    expect(stored).to.not.include('visitor-abc');
    expect(stored).to.not.include('203.0.113.9');
    expect(db.db.marketplace_share_events.every(e => /^[0-9a-f]{64}$/.test(e.visitor_hash))).to.equal(true);
  });

  it('credits a paid sale to the sharer, not when buyers use their own link, and shows sellers names only', async () => {
    const db = base();
    const { code } = await Share.createShareLink(db, SHARER, 'l1');
    expect(await Share.shareCodeForCheckout(db, code, 'l1', BUYER)).to.equal(code);
    expect(await Share.shareCodeForCheckout(db, code, 'l1', SHARER)).to.equal(null);
    expect(await Share.shareCodeForCheckout(db, code, 'l9', BUYER)).to.equal(null);
    expect(await Share.shareCodeForCheckout(db, 'bad', 'l1', BUYER)).to.equal(null);
    await Share.recordShareEvent(db, { code, listingId:'l1', kind:'visit', visitor:{ visitorId:'a' } });
    await Share.recordShareEvent(db, { code, listingId:'l1', kind:'play', visitor:{ visitorId:'a' } });
    db.db.marketplace_orders.push(
      { id:'o1', seller_user_id:SELLER, buyer_user_id:BUYER, buyer_email:'buyer@example.com', listing_id:'l1', payment_status:'paid', seller_amount_cents:900, currency:'USD', provider_metadata:{ shareCode:code } },
      { id:'o2', seller_user_id:SELLER, buyer_user_id:BUYER, listing_id:'l1', payment_status:'pending', seller_amount_cents:900, provider_metadata:{ shareCode:code } },
      { id:'o3', seller_user_id:SELLER, buyer_user_id:SHARER, listing_id:'l1', payment_status:'paid', seller_amount_cents:900, provider_metadata:{ shareCode:code } });
    const stats = await Share.sellerShareStats(db, SELLER);
    expect(stats.rows).to.have.length(1);
    expect(stats.rows[0]).to.deep.equal({ listingId:'l1', listingTitle:'Night Drive', sharerName:'Kid Rhythm', isYou:false, visits:1, plays:1, sales:1, earningsCents:900, currency:'USD' });
    expect(stats.totals).to.deep.equal({ visits:1, plays:1, sales:1, earningsCents:900, sharers:1 });
    const out = JSON.stringify(stats);
    [SHARER, BUYER, 'buyer@example.com', 'dj_secret', code].forEach(secret => expect(out).to.not.include(secret));
    expect((await Share.sellerShareStats(db, 'someone-else')).rows).to.have.length(0);
  });

  it('reports a missing SQL 053 clearly', async () => {
    const db = base();
    db.from = table => table === 'marketplace_share_links' ? { select(){ return this; }, eq(){ return this; }, in(){ return this; }, limit(){ return this; }, then(r){ return Promise.resolve({ error:{ message:'relation "marketplace_share_links" does not exist' } }).then(r); } } : new Query(db.db, table);
    expect((await Share.createShareLink(db, SHARER, 'l1')).schemaMissing).to.equal(true);
    expect((await Share.sellerShareStats(db, SELLER)).schemaMissing).to.equal(true);
  });

  it('index.js wires the share routes and checkout passes the code through', () => {
    expect(serverSource).to.match(/app\.post\('\/api\/marketplace\/listings\/:listingId\/shareLink', requireAuth/);
    expect(serverSource).to.match(/app\.post\('\/api\/marketplace\/shareEvents', optionalAuth/);
    expect(serverSource).to.match(/app\.get\('\/api\/marketplace\/shareStats', requireAuth/);
    const commerce = fs.readFileSync(path.join(root, 'marketplace_commerce.js'), 'utf8');
    expect(commerce).to.match(/shareCodeForCheckout\(dataClient, input\.shareCode, listing\.id, buyerUserId\)/);
    expect(typeof createMarketplaceCheckout).to.equal('function');
  });
});
