const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Tournaments = require('../tournaments');
const Store = require('../store_five');
const Gifts = require('../beat_gifts');
const Market = require('../marketplace_foundation');
const Social = require('../social_notifications');
const Push = require('../push_alerts');
const { createMarketplaceCheckout, createStripeConnectAdapter, handleMarketplacePaymentEvent, issueMarketplaceDownloadAccess, sanitizeCommerceOrder } = require('../marketplace_commerce');
const { resetRateLimits } = require('../social_helpers');

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
const ids = n => Array.from({ length:n }, (_, i) => `dj-${i + 1}`);
const profile = id => ({ user_id:id, public_profile_id:`dj_${id}`, display_name:id.toUpperCase() });

describe('Oct 25 Store: tournament sizes and group stage', () => {
  beforeEach(() => resetRateLimits());
  it('offers 4, 8, 16 and 32 DJ tournaments and builds full brackets for the new sizes', () => {
    expect(Tournaments.CAPACITIES).to.deep.equal([4, 8, 16, 32]);
    expect(Tournaments.bracketFromSeeds(ids(4), 4)).to.have.length(3);
    const big = Tournaments.bracketFromSeeds(ids(32), 32);
    expect(big).to.have.length(31);
    expect(Math.max(...big.map(m => m.round))).to.equal(5);
    expect(big.find(m => m.round === 1 && m.position === 1)).to.include({ firstUserId:'dj-1', secondUserId:'dj-32' });
    expect(() => Tournaments.bracketFromSeeds(ids(5), 4)).to.throw();
  });
  it('splits DJs into balanced groups (snake draft) and gives every pair one match', () => {
    expect(Tournaments.groupCountFor(4, 4)).to.equal(1);
    expect(Tournaments.groupCountFor(8, 8)).to.equal(2);
    expect(Tournaments.groupCountFor(32, 32)).to.equal(8);
    const groups = Tournaments.drawGroups(ids(8), 2);
    expect(groups).to.deep.equal([['dj-1', 'dj-4', 'dj-5', 'dj-8'], ['dj-2', 'dj-3', 'dj-6', 'dj-7']]);
    const matches = Tournaments.groupMatchesFor(groups);
    expect(matches).to.have.length(12);
    expect(matches.every(m => m.round === 0 && m.stage === 'group' && m.status === 'ready')).to.equal(true);
    expect(Tournaments.groupLabel(2)).to.equal('Group B');
  });
  it('ranks a group by points, then head-to-head, and sends the top two through', () => {
    const ms = Tournaments.groupMatchesFor([['a', 'b', 'c']]).map((m, i) => ({ ...m, id:`m${i}` }));
    let out = Tournaments.applyResult(ms, ms[0], 'b'); // a v b → b
    out = Tournaments.applyResult(out, out[1], 'a'); // a v c → a
    out = Tournaments.applyResult(out, out[2], 'c'); // b v c → c  (all on 3 pts)
    const table = Tournaments.groupStandings(out, id => ({ a:1, b:2, c:3 }[id]))[0];
    expect(table.rows.map(r => r.points)).to.deep.equal([3, 3, 3]);
    expect(table.rows.filter(r => r.advancing)).to.have.length(2);
    expect(Tournaments.groupStageDone(out)).to.equal(true);
    const ko = Tournaments.knockoutFromGroups(Tournaments.groupStandings(out));
    expect(ko.filter(m => m.round === 1)).to.have.length(1);
  });
  it('runs a whole group-stage tournament to a champion, with no user ids in the public view', async () => {
    const db = dataClient({ dj_progression_profiles:ids(8).map(profile), battle_records:[], dj_notifications:[], dj_notification_mutes:[] });
    const created = await Tournaments.createTournament(db, 'dj-1', { title:'Group Cup', capacity:8, seeding:'signup', format:'groups' });
    expect(created.tournament.format).to.equal('groups');
    const tid = created.tournament.id;
    for(const id of ids(8).slice(1)) await Tournaments.joinTournament(db, id, tid);
    await Tournaments.startTournament(db, 'dj-1', tid); // a full tournament starts by itself
    let view = (await Tournaments.getTournament(db, tid, 'dj-1')).tournament;
    expect(view.stage).to.equal('groups');
    expect(view.groups).to.have.length(2);
    expect(view.groups[0].label).to.equal('Group A');
    expect(JSON.stringify(view)).to.not.match(/UserId|user_id/);
    const deps = {
      createBattle:async (client, userId, input) => { client.db.battle_records.push({ id:input.battleId, status:'open', created_by:userId }); return { battle:{ id:input.battleId } }; },
      joinBattle:async () => ({ battle:null }), roomState:async () => ({ state:{ id:'room' } })
    };
    const seedNo = id => Number(String(id).split('-')[1]);
    const playReady = async () => {
      view = (await Tournaments.getTournament(db, tid)).tournament;
      for(const m of view.matches.filter(x => x.status === 'ready')){
        const row = db.db.dj_tournament_matches.find(r => r.id === m.id);
        const played = await Tournaments.playTournamentMatch(db, row.first_user_id, tid, m.id, {}, deps);
        expect(played.battleId).to.be.a('string');
        const [win, lose] = seedNo(row.first_user_id) < seedNo(row.second_user_id) ? [row.first_user_id, row.second_user_id] : [row.second_user_id, row.first_user_id];
        db.db.battle_records.find(b => b.id === played.battleId).resolution = { status:'resolved', outcome:'winner', participants:[{ userId:win, outcome:'winner' }, { userId:lose, outcome:'loser' }] };
      }
    };
    await playReady(); // whole group stage
    view = (await Tournaments.getTournament(db, tid)).tournament;
    expect(view.stage).to.equal('knockout');
    expect(view.groups.every(g => g.complete)).to.equal(true);
    expect(view.groups[0].rows[0]).to.include({ wins:3, points:9, advancing:true });
    expect(view.matches.filter(m => m.stage !== 'group')).to.have.length(3);
    await playReady(); await playReady();
    view = (await Tournaments.getTournament(db, tid, 'dj-1')).tournament;
    expect(view.status).to.equal('completed');
    expect(view.champion.displayName).to.equal('DJ-1');
  });
  it('removing a DJ mid-group forfeits their remaining group matches, and a group stage needs 3 DJs', async () => {
    const db = dataClient({ dj_progression_profiles:ids(4).map(profile), battle_records:[], dj_notifications:[], dj_notification_mutes:[] });
    const t = (await Tournaments.createTournament(db, 'dj-1', { title:'Small', capacity:4, format:'groups', seeding:'signup' })).tournament;
    await Tournaments.joinTournament(db, 'dj-2', t.id);
    expect((await Tournaments.startTournament(db, 'dj-1', t.id)).validationError).to.match(/at least 3/);
    await Tournaments.joinTournament(db, 'dj-3', t.id);
    await Tournaments.joinTournament(db, 'dj-4', t.id);
    await Tournaments.startTournament(db, 'dj-1', t.id);
    const r = await Tournaments.removeEntrant(db, 'dj-1', t.id, 'dj_dj-4', now);
    expect(r.error).to.equal(undefined);
    const fourth = db.db.dj_tournament_matches.filter(m => m.stage === 'group' && [m.first_user_id, m.second_user_id].includes('dj-4'));
    expect(fourth.every(m => m.winner_user_id && m.winner_user_id !== 'dj-4')).to.equal(true);
  });
  it('SQL 050 widens the checks, adds the format/stage columns, and never re-creates the old 028 tables', () => {
    const s = sql('050_add_tournament_sizes_group_stage.sql');
    expect(s).to.match(/capacity IN \(4, 8, 16, 32\)/);
    expect(s).to.match(/round_number BETWEEN 0 AND 5/);
    expect(s).to.match(/seat_number BETWEEN 1 AND 32/);
    expect(s).to.match(/ADD COLUMN IF NOT EXISTS format/);
    expect(s).to.not.match(/CREATE TABLE/);
  });
});

/* ---------------- store fixtures ---------------- */
const listingRow = (o = {}) => ({ id:'lst_1', status:'published', product_id:'p1', seller_user_id:U[1], title:'Night Drive', display_price_cents:2500, currency:'USD', preview_enabled:false, preview_duration:30, metadata:{}, ...o });
function storeDb(extra = {}){
  return dataClient({
    marketplace_listings:[listingRow()],
    marketplace_products:[{ id:'p1', status:'active', title:'Night Drive', creator_user_id:U[1], rights_classification:'original', audio_storage_object_path:'private/library-audio/u2/full.wav', preview_storage_object_path:null, duration:120 }],
    marketplace_rights_policies:[{ id:'r1', product_id:'p1', status:'active', license_type:'creator_license', rights_classification:'original', marketplace_streaming_allowed:true, preview_allowed:true, download_allowed:true }],
    marketplace_seller_accounts:[{ seller_user_id:U[1], provider:'stripe', provider_account_id:'acct_1', account_status:'connected', charges_enabled:true, payouts_enabled:true }],
    marketplace_orders:[], marketplace_order_items:[], marketplace_payment_events:[], marketplace_entitlements:[], marketplace_player_sessions:[],
    beat_wishlist_items:[], marketplace_beat_gifts:[], beat_discount_codes:[], dj_notifications:[], dj_notification_mutes:[], dj_progression_profiles:[], push_subscriptions:[],
    ...extra
  });
}
const stripe = () => createStripeConnectAdapter({ trustEvents:true, gateway:{ async createCheckoutSession(p){ return { id:`cs_${p.metadata && p.metadata.orderId || 'x'}`, url:'https://checkout.stripe.test/x', status:'open' }; } } });
const paidEvent = (id, orderId, type = 'checkout.session.completed') => ({ id, trusted:true, type, data:{ object:{ id:`cs_${orderId}`, payment_intent:`pi_${orderId}`, amount_total:2500, amount:2500, amount_refunded:type === 'charge.refunded' ? 2500 : 0, currency:'usd', metadata:{ orderId } } } });

describe('Oct 25 Store: per-beat licences', () => {
  beforeEach(() => resetRateLimits());
  it('has plain-words terms for every licence a seller can pick', () => {
    expect(Store.LICENCE_CHOICES).to.deep.equal(['battle_use', 'creator_license', 'royalty_free_use']);
    for(const type of Store.LICENCE_CHOICES){
      const t = Store.licenceTerms(type);
      expect(t.label).to.be.a('string');
      expect(t.may.length).to.be.greaterThan(0);
      expect(t.mayNot.length).to.be.greaterThan(0);
      expect(Market.RIGHTS_LICENSE_TYPES).to.include(type);
    }
    expect(Store.licenceText(Store.licenceTerms('battle_use'))).to.match(/You may not:/);
    expect(Market.sanitizeMarketplaceRightsPolicy({ license_type:'royalty_free_use' }).licence.label).to.equal('Royalty-free');
  });
  it('only the seller can change it, they must confirm their rights, and licensed music can\'t go royalty-free', async () => {
    const db = storeDb();
    expect((await Store.setListingLicence(db, U[0], 'lst_1', { licenseType:'battle_use', confirmRights:true })).forbidden).to.equal(true);
    expect((await Store.setListingLicence(db, U[1], 'lst_1', { licenseType:'battle_use' })).validationError).to.match(/Confirm/);
    expect((await Store.setListingLicence(db, U[1], 'lst_1', { licenseType:'personal_stream', confirmRights:true })).validationError).to.be.a('string');
    const ok = await Store.setListingLicence(db, U[1], 'lst_1', { licenseType:'royalty_free_use', confirmRights:true });
    expect(ok.licence.label).to.equal('Royalty-free');
    expect(db.db.marketplace_rights_policies[0]).to.include({ license_type:'royalty_free_use', commercial_use_allowed:true });
    db.db.marketplace_products[0].rights_classification = 'licensed';
    expect((await Store.setListingLicence(db, U[1], 'lst_1', { licenseType:'royalty_free_use', confirmRights:true })).validationError).to.match(/royalty-free/);
  });
  it('freezes a copy of the terms onto the order, which the receipt shows even if the seller changes licence later', async () => {
    const db = storeDb();
    const r = await createMarketplaceCheckout(db, stripe(), U[0], { orderId:'o1', listingId:'lst_1', provider:'stripe', clientPriceCents:2500, currency:'USD', licenseType:'creator_license' }, now);
    expect(r.checkoutCreated).to.equal(true);
    expect(r.order.licence.label).to.equal('Use in your own releases');
    await Store.setListingLicence(db, U[1], 'lst_1', { licenseType:'battle_use', confirmRights:true });
    expect(sanitizeCommerceOrder(db.db.marketplace_orders[0]).licence.label).to.equal('Use in your own releases');
    expect((await createMarketplaceCheckout(db, stripe(), U[0], { orderId:'o2', listingId:'lst_1', provider:'stripe', clientPriceCents:2500, licenseType:'creator_license' }, now)).validationError).to.match(/license/);
  });
});

describe('Oct 25 Store: short previews for paid beats', () => {
  beforeEach(() => resetRateLimits());
  it('picks a 30-60 second window: seller start, or about a third of the way in', () => {
    expect(Store.previewWindow(200, {})).to.include({ start:60, length:45, auto:true });
    expect(Store.previewWindow(200, { startSeconds:10, lengthSeconds:90 })).to.include({ start:10, length:60, auto:false });
    expect(Store.previewWindow(200, { startSeconds:190, lengthSeconds:30 })).to.include({ start:170, length:30 });
    expect(Store.previewWindow(40, { lengthSeconds:45 })).to.include({ start:0, shortTrack:true });
  });
  it('builds an FFmpeg command that cuts, fades and mixes the voice tag', () => {
    const args = Store.previewFfmpegArgs({ input:'in.wav', output:'out.mp3', start:30, length:45, tagPath:'tag.wav' });
    const s = args.join(' ');
    expect(s).to.match(/-ss 30 -t 45 -i in\.wav/);
    expect(s).to.match(/adelay=2000:all=1/);
    expect(s).to.match(/adelay=22000:all=1/);
    expect(s).to.match(/amix=inputs=4/);
    expect(Store.previewFfmpegArgs({ input:'a', output:'b', start:0, length:30 }).join(' ')).to.not.match(/amix/);
    expect(fs.existsSync(Store.VOICE_TAG_PATH)).to.equal(true);
  });
  it('never lets a non-owner preview stream the full file', async () => {
    const db = storeDb();
    db.db.marketplace_listings[0].preview_enabled = true;
    db.db.marketplace_products[0].preview_storage_object_path = 'private/library-audio/u2/full.wav'; // old-style "preview" = the full beat
    const storage = { async createSignedUrl(p){ return { data:{ signedUrl:`https://signed/${p}` } }; } };
    const r = await Market.issueMarketplacePlayerAccess(db, storage, U[0], { listingId:'lst_1', preview:true }, now);
    expect(r.unavailable).to.equal(true);
    expect(JSON.stringify(r)).to.not.match(/full\.wav/);
    expect(Market.sanitizeMarketplaceProduct(db.db.marketplace_products[0]).hasPreview).to.equal(false);
    db.db.marketplace_products[0].preview_storage_object_path = 'private/marketplace-previews/p1/clip.mp3';
    const ok = await Market.issueMarketplacePlayerAccess(db, storage, U[0], { listingId:'lst_1', preview:true }, now);
    expect(JSON.stringify(ok)).to.match(/clip\.mp3/);
    expect(JSON.stringify(ok)).to.not.match(/full\.wav/);
  });
  it('the seller-only endpoint cuts a real preview with FFmpeg and stores only the clip', async function(){
    let ffmpegPath = null;
    try{ execFileSync('ffmpeg', ['-version'], { stdio:'ignore' }); ffmpegPath = 'ffmpeg'; }catch(e){ this.skip(); }
    this.timeout(30000);
    const src = path.join(os.tmpdir(), `djb-test-src-${process.pid}.wav`);
    execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=90', src]);
    const uploads = {};
    const storage = { async download(){ return { data:fs.readFileSync(src) }; }, async upload(p, buf){ uploads[p] = buf; return { data:{ path:p } }; }, async remove(){ return {}; } };
    const db = storeDb();
    expect((await Store.generateListingPreview(db, U[0], 'lst_1', {}, { storage, ffmpegPath }, now)).forbidden).to.equal(true);
    db.db.marketplace_products[0].duration = 90;
    const r = await Store.generateListingPreview(db, U[1], 'lst_1', { startSeconds:20, lengthSeconds:30, voiceTag:true }, { storage, ffmpegPath }, now);
    fs.unlinkSync(src);
    expect(r.preview).to.include({ startSeconds:20, lengthSeconds:30, voiceTag:true });
    const keys = Object.keys(uploads);
    expect(keys).to.have.length(1);
    expect(keys[0]).to.match(/^private\/marketplace-previews\/p1\/[0-9a-f]+\.mp3$/);
    expect(uploads[keys[0]].length).to.be.greaterThan(10000);
    expect(db.db.marketplace_products[0].preview_storage_object_path).to.equal(keys[0]);
    expect(db.db.marketplace_listings[0]).to.include({ preview_enabled:true, preview_duration:30 });
  });
});

describe('Oct 25 Store: wishlist alerts', () => {
  beforeEach(() => resetRateLimits());
  it('saves, lists and removes hearts; you can\'t heart your own beat', async () => {
    const db = storeDb();
    expect((await Store.addToWishlist(db, U[0], 'lst_1', now)).saved).to.equal(true);
    expect((await Store.addToWishlist(db, U[0], 'lst_1', now)).duplicate).to.equal(true);
    expect((await Store.addToWishlist(db, U[1], 'lst_1', now)).validationError).to.match(/own/);
    const list = await Store.listWishlist(db, U[0]);
    expect(list.listingIds).to.deep.equal(['lst_1']);
    expect(list.items[0]).to.include({ savedPriceCents:2500, priceCents:2500 });
    expect((await Store.removeFromWishlist(db, U[0], 'lst_1')).removed).to.equal(true);
    expect((await Store.listWishlist(db, U[0])).items).to.have.length(0);
  });
  it('alerts savers once when the price drops, never on a rise', async () => {
    const db = storeDb();
    await Store.addToWishlist(db, U[0], 'lst_1', now);
    await Store.addToWishlist(db, U[2], 'lst_1', now);
    expect((await Store.notifyPriceDrop(db, { listingId:'lst_1', sellerUserId:U[1], title:'Night Drive', oldCents:2500, newCents:3000 }, now)).notified).to.equal(0);
    const r = await Store.notifyPriceDrop(db, { listingId:'lst_1', sellerUserId:U[1], title:'Night Drive', oldCents:2500, newCents:1500 }, now);
    expect(r.notified).to.equal(2);
    await Store.notifyPriceDrop(db, { listingId:'lst_1', sellerUserId:U[1], title:'Night Drive', oldCents:2500, newCents:1500 }, now);
    const alerts = db.db.dj_notifications.filter(n => n.type === 'wishlist_alert');
    expect(alerts).to.have.length(2);
    expect(alerts[0].summary).to.match(/\$25\.00 to \$15\.00/);
  });
  it('alerts savers of the producer\'s paid beats about a new discount code, and respects the Settings switch', async () => {
    const db = storeDb();
    await Store.addToWishlist(db, U[0], 'lst_1', now);
    await Store.addToWishlist(db, U[2], 'lst_1', now);
    await Social.setSocialNotificationPref(db, U[2], 'wishlist_alert', false, now);
    const r = await Store.notifyDiscountCode(db, { sellerUserId:U[1], code:{ id:'c1', code:'BATTLE20', kind:'percent', percentOff:20, active:true } }, now);
    expect(r.notified).to.be.at.least(1);
    const got = db.db.dj_notifications.filter(n => n.type === 'wishlist_alert');
    expect(got.map(n => n.user_id)).to.deep.equal([U[0]]);
    expect(got[0].summary).to.match(/BATTLE20 takes 20% off Night Drive/);
  });
  it('wishlist alerts are a notification type, a push type and in SQL 051', () => {
    expect(Social.SOCIAL_NOTIFICATION_TYPES).to.include.members(['wishlist_alert', 'gift_received']);
    expect(Push.PUSH_TYPES).to.include('wishlist_alert');
    expect(Push.payloadFor({ type:'wishlist_alert', summary:'Night Drive dropped', destination:{ type:'store' } })).to.include({ url:'./#store', body:'Night Drive dropped' });
    const s = sql('051_create_beat_wishlist.sql');
    expect(s).to.match(/beat_wishlist_items/);
    expect(s).to.match(/'remix_store_offer','wishlist_alert','gift_received'/);
  });
});

describe('Oct 25 Store: gift a beat', () => {
  beforeEach(() => resetRateLimits());
  const mailer = () => { const sent = []; return { sent, async send(m){ sent.push(m); return { sent:true, id:'em_1' }; } }; };
  const giftCheckout = (db, orderId = 'og1', gift = { recipientEmail:'Friend@Example.com', message:'Happy birthday!', fromName:'Nova' }) =>
    createMarketplaceCheckout(db, stripe(), U[0], { orderId, listingId:'lst_1', provider:'stripe', clientPriceCents:2500, currency:'USD', gift }, now);
  it('validates the recipient email and message', () => {
    expect(Gifts.validateGiftInput({ recipientEmail:'nope' }).validationError).to.match(/email/);
    expect(Gifts.validateGiftInput({ recipientEmail:'a@b.co', message:'x'.repeat(281) }).validationError).to.match(/280/);
    expect(Gifts.validateGiftInput({ recipientEmail:' A@B.co ' }).recipientEmail).to.equal('a@b.co');
  });
  it('payment sends a one-time claim link by email; the buyer gets no copy; only the hash is stored', async () => {
    const db = storeDb();
    const mail = mailer();
    const r = await giftCheckout(db);
    expect(r.checkoutCreated).to.equal(true);
    expect(r.order.gift).to.equal(true);
    expect(db.db.marketplace_beat_gifts[0]).to.include({ status:'pending_payment', recipient_email:'friend@example.com' });
    const paid = await handleMarketplacePaymentEvent(db, stripe(), paidEvent('e1', 'og1'), now, { gifts:{ emailSender:mail, appUrl:'https://djbattle.test' } });
    expect(paid.settled).to.equal(true);
    expect(paid.entitlement).to.equal(null);
    expect(db.db.marketplace_entitlements).to.have.length(0);
    expect(mail.sent).to.have.length(1);
    expect(mail.sent[0].to).to.equal('friend@example.com');
    expect(mail.sent[0].text).to.match(/Happy birthday!/);
    expect(mail.sent[0].text).to.match(/Licence: Use in your own releases/);
    const link = mail.sent[0].text.match(/https:\/\/djbattle\.test\/\?gift=([^&]+)&gt=([^#\s]+)#store/);
    expect(link).to.not.equal(null);
    const token = decodeURIComponent(link[2]);
    const row = db.db.marketplace_beat_gifts[0];
    expect(row.status).to.equal('sent');
    expect(row.claim_token_hash).to.equal(Gifts.hashToken(token));
    expect(JSON.stringify(db.db)).to.not.include(token);
    // A repeated webhook doesn't send a second email.
    await handleMarketplacePaymentEvent(db, stripe(), paidEvent('e2', 'og1', 'payment_intent.succeeded'), now, { gifts:{ emailSender:mail, appUrl:'https://djbattle.test' } });
    expect(mail.sent).to.have.length(1);
    return { db, token };
  });
  it('claims exactly once, only for the matching email, then the recipient can download', async () => {
    const db = storeDb();
    const mail = mailer();
    await giftCheckout(db);
    await handleMarketplacePaymentEvent(db, stripe(), paidEvent('e1', 'og1'), now, { gifts:{ emailSender:mail, appUrl:'https://x.test' } });
    const [, giftId, token] = mail.sent[0].text.match(/\?gift=([^&]+)&gt=([^#\s]+)#/).map(decodeURIComponent);
    expect((await Gifts.claimGift(db, { id:U[3], email:'friend@example.com' }, { giftId, token:'wrong' }, now)).notFound).to.equal(true);
    const wrongPerson = await Gifts.claimGift(db, { id:U[2], email:'someone@else.com' }, { giftId, token }, now);
    expect(wrongPerson.forbidden).to.equal(true);
    expect(wrongPerson.message).to.match(/f\*+@example\.com/);
    const ok = await Gifts.claimGift(db, { id:U[3], email:'FRIEND@example.com' }, { giftId, token }, now);
    expect(ok.claimed).to.equal(true);
    const ent = db.db.marketplace_entitlements[0];
    expect(ent).to.include({ user_id:U[3], status:'active', originating_order_id:'og1' });
    expect((await Gifts.claimGift(db, { id:U[3], email:'friend@example.com' }, { giftId, token }, now)).conflict).to.equal(true);
    const storage = { async createSignedUrl(p){ return { data:{ signedUrl:`https://signed/${p}` } }; } };
    const dl = await issueMarketplaceDownloadAccess(db, storage, U[3], { orderId:'og1' }, now);
    expect(dl.error).to.equal(undefined);
    expect((await issueMarketplaceDownloadAccess(db, storage, U[0], { orderId:'og1' }, now)).unavailable).to.equal(true);
    expect(db.db.dj_notifications.some(n => n.type === 'gift_received' && n.user_id === U[0])).to.equal(true);
  });
  it('signing in with the gifted email adds it automatically (verified emails only)', async () => {
    const db = storeDb();
    await giftCheckout(db);
    await handleMarketplacePaymentEvent(db, stripe(), paidEvent('e1', 'og1'), now, { gifts:{} });
    expect((await Gifts.claimWaitingGifts(db, { id:U[3], email:'friend@example.com', emailVerified:false }, now)).claimed).to.have.length(0);
    expect((await Gifts.claimWaitingGifts(db, { id:U[3], email:'friend@example.com', emailVerified:true }, now)).claimed).to.have.length(1);
    expect(db.db.marketplace_entitlements[0].user_id).to.equal(U[3]);
    expect((await Gifts.listSentGifts(db, U[0])).gifts[0]).to.include({ status:'claimed', recipientEmail:'friend@example.com' });
  });
  it('a refund cancels an unclaimed gift', async () => {
    const db = storeDb();
    await giftCheckout(db);
    await handleMarketplacePaymentEvent(db, stripe(), paidEvent('e1', 'og1'), now, { gifts:{} });
    await handleMarketplacePaymentEvent(db, stripe(), paidEvent('e2', 'og1', 'charge.refunded'), now, { gifts:{} });
    expect(db.db.marketplace_beat_gifts[0]).to.include({ status:'cancelled', claim_token_hash:null });
  });
  it('SQL 052 stores only a hash and the server wires the routes', () => {
    const s = sql('052_create_beat_gifts.sql');
    expect(s).to.match(/claim_token_hash text CHECK/);
    expect(s).to.not.match(/claim_token text/);
    for(const route of ['/api/marketplace/gifts/claim', '/api/marketplace/gifts/inbox', '/api/marketplace/wishlist', '/api/marketplace/listings/:listingId/licence', '/api/marketplace/listings/:listingId/preview']) expect(serverSource).to.include(route);
  });
});
