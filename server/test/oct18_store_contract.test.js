const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { createDjBlock, createNotificationMute, listOwnedBlocks, removeOwnedBlock, listOwnedMutes, removeOwnedMute } = require('../dj_challenges');
const { createAvatarDirectory, avatarResponseMiddleware, collectProfileTargets, isPublicAvatarUrl, stablePublicProfileId } = require('../avatar_directory');
const { attachFreeOffers, freeBeatEligibility, listSellerStoreListings, prepareFreeDownloadFile } = require('../marketplace_free_beats');
const { createMarketplaceListing } = require('../marketplace_foundation');
const { createFreeEmailOffer, claimFreeEmailDownload, issueFreeEmailLeadDownloadAccess } = require('../marketplace_free_email');
const { savePracticeSession, listPracticeSessions, sanitizeBreakdown } = require('../practice_sessions');
const { createFrontendRouter, isServableFrontendPath } = require('../static_frontend');

const root = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const AVATAR = id => `https://proj.supabase.co/storage/v1/object/public/profile-avatars/avatars/${id}/avatar-1.jpg`;

/* ---------- in-memory Supabase stand-in ---------- */
function dataClient(initial){
  const db = Object.fromEntries(Object.entries(initial).map(([table, rows]) => [table, rows.map(row => ({ ...row }))]));
  const calls = [];
  return { db, calls, from(table){ if(!db[table]) db[table] = []; calls.push(table); return new Query(db, table); } };
}
class Query{
  constructor(db, table){ this.db = db; this.table = table; this.filters = []; this.inFilters = []; this.ltFilters = []; this.limitValue = null; this.insertRows = null; this.updateValues = null; this.orderBy = null; }
  select(){ return this; }
  eq(field, value){ this.filters.push([field, value]); return this; }
  in(field, values){ this.inFilters.push([field, values.map(String)]); return this; }
  lt(field, value){ this.ltFilters.push([field, value]); return this; }
  order(field, opts){ this.orderBy = [field, opts && opts.ascending]; return this; }
  limit(value){ this.limitValue = Number(value); return this; }
  insert(rows){ this.insertRows = rows.map(row => ({ ...row })); return this; }
  update(values){ this.updateValues = { ...values }; return this; }
  then(resolve, reject){ return this.exec().then(resolve, reject); }
  async single(){ const result = await this.exec(); return result.error ? result : { data:(result.data && result.data[0]) || null, error:null }; }
  async exec(){
    if(this.insertRows){
      for(const row of this.insertRows){ if(row.id && this.db[this.table].some(old => old.id === row.id)) return { data:null, error:{ message:'duplicate key value violates unique constraint' } }; }
      this.db[this.table].push(...this.insertRows);
      return { data:this.insertRows, error:null };
    }
    let rows = this.db[this.table].filter(row => this.filters.every(([f, v]) => String(row[f]) === String(v)));
    rows = rows.filter(row => this.inFilters.every(([f, vs]) => vs.includes(String(row[f]))));
    rows = rows.filter(row => this.ltFilters.every(([f, v]) => new Date(row[f]) < new Date(v)));
    if(this.updateValues){ rows.forEach(row => Object.assign(row, this.updateValues)); return { data:rows, error:null }; }
    if(this.orderBy){ const [f, asc] = this.orderBy; rows = rows.slice().sort((a, b) => (new Date(a[f]) - new Date(b[f])) * (asc ? 1 : -1)); }
    if(this.limitValue != null) rows = rows.slice(0, this.limitValue);
    return { data:rows, error:null };
  }
}
function profileRow(userId, publicId, name, extra = {}){
  return { user_id:userId, public_profile_id:publicId, display_name:name, visibility:'public', belt:'Blue', public_profile:{ publicProfileId:publicId, displayName:name, visibility:'public' }, ...extra };
}

/* ---------- 3. Blocked & muted ---------- */
describe('Blocked & muted list (Oct 18 b)', () => {
  const seed = () => dataClient({
    dj_blocks:[], dj_notification_mutes:[], dj_challenges:[], dj_follows:[], dj_notifications:[],
    dj_progression_profiles:[profileRow('me', 'dj_me', 'Me'), profileRow('rival', 'dj_rival', 'Rival DJ'), profileRow('other', 'dj_other', 'Other DJ')]
  });

  it('lists only my own active blocks and unblocks them; other people\'s blocks look missing', async () => {
    const client = seed();
    const mine = await createDjBlock(client, 'me', { blockedPublicProfileId:'dj_rival' });
    await createDjBlock(client, 'other', { blockedPublicProfileId:'dj_rival' });
    const listed = await listOwnedBlocks(client, 'me');
    expect(listed.blocks).to.have.length(1);
    expect(listed.blocks[0].blockedProfile.displayName).to.equal('Rival DJ');
    expect(JSON.stringify(listed.blocks)).to.not.match(/blocker_user_id|blocked_user_id|"rival"|"me"/);
    const othersBlock = client.db.dj_blocks.find(row => row.blocker_user_id === 'other');
    expect((await removeOwnedBlock(client, 'me', othersBlock.id)).notFound).to.equal(true);
    expect(othersBlock.active).to.equal(true);
    const removed = await removeOwnedBlock(client, 'me', mine.block.id);
    expect(removed.removed).to.equal(true);
    expect((await listOwnedBlocks(client, 'me')).blocks).to.have.length(0);
    expect((await removeOwnedBlock(client, 'me', mine.block.id)).duplicate).to.equal(true);
  });

  it('blocking again after an unblock switches the same row back on instead of failing', async () => {
    const client = seed();
    const first = await createDjBlock(client, 'me', { blockedPublicProfileId:'dj_rival' });
    await removeOwnedBlock(client, 'me', first.block.id);
    const again = await createDjBlock(client, 'me', { blockedPublicProfileId:'dj_rival' });
    expect(again.error).to.equal(undefined);
    expect(again.reactivated).to.equal(true);
    expect(client.db.dj_blocks).to.have.length(1);
    expect((await listOwnedBlocks(client, 'me')).blocks).to.have.length(1);
  });

  it('lists my mutes with the muted DJ\'s public name, unmutes, and re-mutes cleanly', async () => {
    const client = seed();
    const created = await createNotificationMute(client, 'me', { mutedPublicProfileId:'dj_rival', category:'all' });
    await createNotificationMute(client, 'other', { mutedPublicProfileId:'dj_rival', category:'all' });
    const listed = await listOwnedMutes(client, 'me');
    expect(listed.mutes).to.have.length(1);
    expect(listed.mutes[0].mutedProfile.displayName).to.equal('Rival DJ');
    expect(listed.mutes[0].category).to.equal('all');
    const othersMute = client.db.dj_notification_mutes.find(row => row.user_id === 'other');
    expect((await removeOwnedMute(client, 'me', othersMute.id)).notFound).to.equal(true);
    expect((await removeOwnedMute(client, 'me', created.mute.id)).removed).to.equal(true);
    expect((await listOwnedMutes(client, 'me')).mutes).to.have.length(0);
    const again = await createNotificationMute(client, 'me', { mutedPublicProfileId:'dj_rival', category:'all' });
    expect(again.reactivated).to.equal(true);
    expect((await listOwnedMutes(client, 'me')).mutes).to.have.length(1);
  });

  it('index.js exposes auth-only GET and DELETE routes next to the POST routes', () => {
    expect(serverSource).to.match(/app\.get\('\/api\/blocks', requireAuth/);
    expect(serverSource).to.match(/app\.delete\('\/api\/blocks\/:blockId', requireAuth/);
    expect(serverSource).to.match(/app\.get\('\/api\/notificationMutes', requireAuth/);
    expect(serverSource).to.match(/app\.delete\('\/api\/notificationMutes\/:muteId', requireAuth/);
    expect(serverSource).to.match(/removeOwnedBlock\(supabaseService, req\.authUser\.id/);
    expect(serverSource).to.match(/removeOwnedMute\(supabaseService, req\.authUser\.id/);
  });
});

/* ---------- 2. Other DJs' photos ---------- */
describe('other DJs\' photos (avatar directory)', () => {
  function setup(){
    const client = dataClient({ dj_progression_profiles:[
      profileRow('u1', 'dj_one', 'One'),
      profileRow('u2', 'dj_two', 'Two'),
      profileRow('u3', 'dj_secret', 'Secret', { visibility:'private' })
    ] });
    const metadata = { u1:{ avatar_url:AVATAR('u1') }, u2:{ avatar_url:'https://evil.example.com/x.jpg' }, u3:{ avatar_url:AVATAR('u3') }, u4:{ avatar_url:AVATAR('u4') } };
    const lookups = [];
    const authAdmin = { async getUserById(id){ lookups.push(id); return { data:{ user:{ id, user_metadata:metadata[id] || {} } }, error:null }; } };
    let lists = 0;
    const storage = { async list(folder){ lists += 1; expect(folder).to.equal('avatars'); return { data:[{ name:'u1' }, { name:'u2' }, { name:'u3' }, { name:'u4' }], error:null }; } };
    let now = 1000;
    const directory = createAvatarDirectory({ dataClient:client, authAdmin, storage, now:() => now, ttlMs:60000 });
    return { directory, lookups, client, getLists:() => lists, tick:ms => { now += ms; } };
  }

  it('adds avatarUrl to nested public profiles in one pass, skipping private and unsafe URLs', async () => {
    const { directory, lookups, getLists } = setup();
    const payload = {
      rankings:[{ publicProfileId:'dj_one', djName:'One' }, { publicProfileId:'dj_two', djName:'Two' }, { publicProfileId:null, djName:'Private DJ', profileVisibility:'private' }],
      posts:[{ id:'p1', author:{ publicProfileId:'dj_one' }, comments:[{ author:{ publicProfileId:'dj_one' } }] }],
      room:{ participants:{ opponents:[{ profile:{ publicProfileId:stablePublicProfileId('u4'), name:'No ranking row yet' } }] } },
      hidden:{ publicProfileId:'dj_secret' }
    };
    await directory.attach(payload);
    expect(payload.rankings[0].avatarUrl).to.equal(AVATAR('u1'));
    expect(payload.rankings[1]).to.not.have.property('avatarUrl');
    expect(payload.rankings[2]).to.not.have.property('avatarUrl');
    expect(payload.posts[0].author.avatarUrl).to.equal(AVATAR('u1'));
    expect(payload.posts[0].comments[0].author.avatarUrl).to.equal(AVATAR('u1'));
    expect(payload.room.participants.opponents[0].profile.avatarUrl).to.equal(AVATAR('u4'));
    expect(payload.hidden).to.not.have.property('avatarUrl');
    expect(lookups.sort()).to.deep.equal(['u1', 'u2', 'u4']);
    expect(getLists()).to.equal(1);
    expect(JSON.stringify(payload)).to.not.match(/"u1"|"u2"|user_id/);
  });

  it('caches lookups, refreshes after the TTL, and learns a freshly uploaded photo immediately', async () => {
    const { directory, lookups, client, getLists, tick } = setup();
    await directory.attach({ a:{ publicProfileId:'dj_one' } });
    await directory.attach({ a:{ publicProfileId:'dj_one' }, b:[{ publicProfileId:'dj_one' }] });
    expect(lookups).to.deep.equal(['u1']);
    expect(client.calls.filter(t => t === 'dj_progression_profiles')).to.have.length(1);
    directory.remember('u2', AVATAR('u2'));
    const fresh = { x:{ publicProfileId:'dj_two' } };
    await directory.attach(fresh);
    expect(fresh.x.avatarUrl).to.equal(AVATAR('u2'));
    directory.remember('u2', null);
    const removed = { x:{ publicProfileId:'dj_two' } };
    await directory.attach(removed);
    expect(removed.x).to.not.have.property('avatarUrl');
    tick(61000);
    await directory.attach({ a:{ publicProfileId:'dj_one' } });
    expect(getLists()).to.equal(2);
  });

  it('only accepts https URLs inside the public profile-avatars bucket', () => {
    expect(isPublicAvatarUrl(AVATAR('u1'))).to.equal(true);
    expect(isPublicAvatarUrl('http://proj.supabase.co/storage/v1/object/public/profile-avatars/avatars/u1/a.jpg')).to.equal(false);
    expect(isPublicAvatarUrl('https://proj.supabase.co/storage/v1/object/sign/battle-mixes/private/x.mp3?token=1')).to.equal(false);
    expect(isPublicAvatarUrl('javascript:alert(1)')).to.equal(false);
    expect(collectProfileTargets({ a:[{ publicProfileId:'x', avatarUrl:'already' }] })).to.have.length(0);
  });

  it('middleware enriches successful GET JSON and leaves errors alone', async () => {
    const { directory } = setup();
    const app = express();
    app.use(['/api/publicLeaderboards'], avatarResponseMiddleware(directory));
    app.get('/api/publicLeaderboards', (req, res) => res.json({ rows:[{ publicProfileId:'dj_one' }] }));
    app.get('/api/publicLeaderboards/fail', (req, res) => res.status(500).json({ error:'x', profile:{ publicProfileId:'dj_one' } }));
    const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
    const get = p => new Promise((resolve, reject) => http.get({ host:'127.0.0.1', port:server.address().port, path:p }, res => { let body = ''; res.on('data', c => { body += c; }); res.on('end', () => resolve(JSON.parse(body))); }).on('error', reject));
    try{
      expect((await get('/api/publicLeaderboards')).rows[0].avatarUrl).to.equal(AVATAR('u1'));
      expect((await get('/api/publicLeaderboards/fail')).profile).to.not.have.property('avatarUrl');
    }finally{ server.close(); }
  });

  it('is wired into the public routes and refreshed on photo save/remove', () => {
    expect(serverSource).to.include("app.use(AVATAR_ENRICHED_ROUTES, avatarResponseMiddleware(avatarDirectory));");
    ['/api/publicProfiles', '/api/publicLeaderboards', '/api/community/feed', '/api/community/posts', '/api/relationships', '/api/challenges', '/api/battles'].forEach(route => expect(serverSource).to.include(`'${route}'`));
    expect(serverSource).to.include('avatarDirectory.remember(req.authUser.id, result.avatarUrl)');
    expect(serverSource).to.include('avatarDirectory.remember(req.authUser.id, null)');
  });
});

/* ---------- 1. Free Beat Store ---------- */
describe('Free Beat Store (first marketplace slice)', () => {
  function track(overrides = {}){
    return { id:'track-1', user_id:'seller', title:'Night Drive', artist:'Seller', genre:'House', bpm:124, key:'A minor', rights_classification:'original', source_type:'track',
      audio_storage_bucket:'battle-mixes', audio_storage_object_path:'private/library-audio/seller/tracks/track-1/audio.mp3', original_filename:'night-drive.mp3', declared_mime_type:'audio/mpeg', verified_mime_type:'audio/mpeg', file_size:4200000, archived_at:null, ...overrides };
  }
  function db(tracks){
    return dataClient({ music_library_tracks:tracks, marketplace_products:[], marketplace_rights_policies:[], marketplace_listings:[], marketplace_entitlements:[], marketplace_player_sessions:[], marketplace_free_email_offers:[], marketplace_free_email_leads:[] });
  }
  function storage(){
    const copies = [];
    return { copies,
      async copy(from, to){ copies.push([from, to]); return { data:{ path:to }, error:null }; },
      async createSignedUrl(objectPath){ return { data:{ signedUrl:`https://proj.supabase.co/storage/v1/object/sign/battle-mixes/${objectPath}?token=t` }, error:null }; } };
  }

  it('explains in plain words which tracks can be listed', () => {
    expect(freeBeatEligibility(track()).ok).to.equal(true);
    const rights = freeBeatEligibility(track({ rights_classification:'unknown' }));
    expect(rights.ok).to.equal(false);
    expect(rights.reason).to.match(/Original, Licensed, Royalty-free, Platform-cleared/);
    expect(freeBeatEligibility(track({ verified_mime_type:'audio/wav', declared_mime_type:'audio/wav' })).reason).to.match(/MP3/);
    expect(freeBeatEligibility(track({ audio_storage_object_path:null })).reason).to.match(/Upload/);
    ['original', 'licensed', 'royalty_free', 'platform_cleared'].forEach(value => expect(freeBeatEligibility(track({ rights_classification:value })).ok).to.equal(true));
  });

  it('runs listing → free file → offer → claim → download end to end, with the token only for the claimer', async () => {
    const client = db([track()]);
    const store = storage();
    const created = await createMarketplaceListing(client, 'seller', { libraryTrackId:'track-1', status:'published', publish:true, downloadAllowed:true, displayPriceCents:0 });
    expect(created.created).to.equal(true);
    const listingId = created.listing.id;
    const prepared = await prepareFreeDownloadFile(client, store, 'seller', listingId);
    expect(prepared.file.storageObjectPath).to.equal(`private/marketplace-downloads/seller/${listingId}/free.mp3`);
    expect(prepared.file.filename).to.equal('Night Drive.mp3');
    expect(store.copies).to.deep.equal([['private/library-audio/seller/tracks/track-1/audio.mp3', prepared.file.storageObjectPath]]);
    const offer = await createFreeEmailOffer(client, 'seller', { listingId, allowedFiles:[prepared.file], verificationRequired:false, downloadLimit:3 });
    expect(offer.offer.freeEmailEnabled).to.equal(true);

    const catalogRows = [{ id:listingId, title:'Night Drive' }, { id:'other-listing', title:'Not free' }];
    await attachFreeOffers(client, catalogRows);
    expect(catalogRows[0].freeDownload.downloadConsentRequired).to.equal(true);
    expect(catalogRows[1].freeDownload).to.equal(null);
    expect(JSON.stringify(catalogRows)).to.not.match(/storage|private\//);

    const claim = await claimFreeEmailDownload(client, null, null, { listingId, email:'Fan@Example.com', downloadConsentAccepted:true }, new Date(), { exposeDownloadAccessToken:true, rateLimit:false });
    expect(claim.claimed).to.equal(true);
    expect(claim.downloadAccessToken).to.be.a('string');
    const again = await claimFreeEmailDownload(client, null, null, { listingId, email:'fan@example.com', downloadConsentAccepted:true }, new Date(), { exposeDownloadAccessToken:true, rateLimit:false });
    expect(again.duplicate).to.equal(true);
    expect(again.downloadAccessToken).to.equal(undefined);
    const access = await issueFreeEmailLeadDownloadAccess(client, store, { leadId:claim.lead.id, downloadAccessToken:claim.downloadAccessToken });
    expect(access.downloadAccess.url).to.match(/^https:\/\//);
    const wrong = await issueFreeEmailLeadDownloadAccess(client, store, { leadId:claim.lead.id, downloadAccessToken:'guess' });
    expect(wrong.forbidden).to.equal(true);

    const mine = await listSellerStoreListings(client, 'seller');
    expect(mine.listings).to.have.length(1);
    expect(mine.listings[0].claimCount).to.equal(1);
    expect((await listSellerStoreListings(client, 'someone-else')).listings).to.have.length(0);
  });

  it('refuses another seller\'s listing and WAV-only tracks', async () => {
    const client = db([track(), track({ id:'track-wav', title:'Wav', verified_mime_type:'audio/wav', declared_mime_type:'audio/wav', audio_storage_object_path:'private/library-audio/seller/tracks/track-wav/audio.wav' })]);
    const store = storage();
    const mp3 = await createMarketplaceListing(client, 'seller', { libraryTrackId:'track-1', publish:true, downloadAllowed:true });
    expect((await prepareFreeDownloadFile(client, store, 'intruder', mp3.listing.id)).forbidden).to.equal(true);
    const wav = await createMarketplaceListing(client, 'seller', { libraryTrackId:'track-wav', publish:true, downloadAllowed:true });
    const refused = await prepareFreeDownloadFile(client, store, 'seller', wav.listing.id);
    expect(refused.validationError).to.match(/MP3/);
    expect(store.copies).to.have.length(0);
    const blocked = await createMarketplaceListing(db([track({ rights_classification:'commercial_unlicensed' })]), 'seller', { libraryTrackId:'track-1' });
    expect(blocked.validationError).to.match(/rights/i);
  });

  it('index.js wires the store routes and hands the claimer their download token (never the verification token)', () => {
    expect(serverSource).to.match(/app\.post\('\/api\/marketplace\/listings\/:listingId\/freeDownloadFile', requireAuth/);
    expect(serverSource).to.match(/app\.get\('\/api\/marketplace\/myListings', requireAuth/);
    expect(serverSource).to.include('await attachFreeOffers(supabaseService, result.listings);');
    expect(serverSource.match(/exposeDownloadAccessToken:true/g)).to.have.length(2);
    expect(serverSource).to.not.include('exposeVerificationToken');
    expect(serverSource).to.not.match(/app\.post\('\/api\/marketplace\/checkout'[^\n]*\n[^\n]*freeBeat/);
  });
});

/* ---------- 5. Practice log ---------- */
describe('practice log on the account', () => {
  const client = () => dataClient({ practice_sessions:[] });
  const session = (n, extra = {}) => ({ clientSessionId:`practice-${n}`, title:`Session ${n}`, score:100 + n, maxScore:180, recordedAt:new Date(Date.UTC(2026, 9, 1 + n)).toISOString(), breakdown:[{ label:'Timing', score:15 }, { label:'EQ', score:12 }], ...extra });

  it('saves once per browser session id, even across retries and devices', async () => {
    const c = client();
    const first = await savePracticeSession(c, 'me', session(1));
    const retry = await savePracticeSession(c, 'me', session(1));
    expect(first.created).to.equal(true);
    expect(retry.duplicate).to.equal(true);
    expect(c.db.practice_sessions).to.have.length(1);
    const linked = await savePracticeSession(c, 'me', session(1, { recordingTrackId:'track-rec' }));
    expect(linked.session.recordingTrackId).to.equal('track-rec');
    expect(first.session.breakdown.map(i => i.key)).to.deep.equal(['timing', 'eq']);
  });

  it('lists only my sessions newest first with paging', async () => {
    const c = client();
    for(let n = 1; n <= 5; n++) await savePracticeSession(c, 'me', session(n));
    await savePracticeSession(c, 'someone', session(9));
    const page1 = await listPracticeSessions(c, 'me', { limit:2 });
    expect(page1.sessions.map(s => s.id)).to.deep.equal(['practice-5', 'practice-4']);
    expect(page1.pagination.hasMore).to.equal(true);
    const page2 = await listPracticeSessions(c, 'me', { limit:10, before:page1.pagination.nextBefore });
    expect(page2.sessions.map(s => s.id)).to.deep.equal(['practice-3', 'practice-2', 'practice-1']);
    expect(page2.pagination.hasMore).to.equal(false);
    expect(JSON.stringify(page2)).to.not.include('"someone"');
  });

  it('rejects sessions without an id or time and cleans the breakdown', async () => {
    expect((await savePracticeSession(client(), 'me', { title:'x', recordedAt:'2026-10-01' })).validationError).to.match(/id/);
    expect((await savePracticeSession(client(), 'me', { clientSessionId:'a' })).validationError).to.match(/time/);
    const items = sanitizeBreakdown({ timing:{ score:90, available:true }, eq:{ available:false, score:1 }, phrase:72 });
    expect(items.map(i => i.key)).to.deep.equal(['timing', 'phrase']);
  });

  it('has auth-only routes, a practice recordings list, and SQL 030 with RLS', () => {
    expect(serverSource).to.match(/app\.get\('\/api\/practiceSessions', requireAuth/);
    expect(serverSource).to.match(/app\.post\('\/api\/practiceSessions', requireAuth/);
    expect(serverSource).to.match(/app\.get\('\/api\/musicLibrary\/practiceRecordings', requireAuth/);
    const sql = fs.readFileSync(path.join(root, 'sql', '030_create_practice_sessions.sql'), 'utf8');
    expect(sql).to.include('CREATE TABLE IF NOT EXISTS public.practice_sessions');
    expect(sql).to.include('UNIQUE (user_id, client_session_id)');
    expect(sql).to.include('ENABLE ROW LEVEL SECURITY');
  });
});

/* ---------- 4. Home-screen install files are served ---------- */
describe('home-screen install files are served by the bundled front end', () => {
  it('allows the manifest, service worker, offline page and icons but no other asset types', async () => {
    expect(isServableFrontendPath('/manifest.webmanifest')).to.equal(true);
    expect(isServableFrontendPath('/sw.js')).to.equal(true);
    expect(isServableFrontendPath('/offline.html')).to.equal(true);
    expect(isServableFrontendPath('/assets/icon-512.png')).to.equal(true);
    expect(isServableFrontendPath('/assets/favicon.svg')).to.equal(true);
    expect(isServableFrontendPath('/assets/secret.json')).to.equal(false);
    expect(isServableFrontendPath('/assets/x.js')).to.equal(false);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djb-pwa-'));
    fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), '{"name":"DJ Battle"}');
    fs.writeFileSync(path.join(dir, 'sw.js'), '// sw');
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'assets', 'icon-192.png'), 'png');
    const app = express();
    app.use(createFrontendRouter({ root:dir }));
    const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
    const head = p => new Promise((resolve, reject) => http.get({ host:'127.0.0.1', port:server.address().port, path:p }, res => { res.resume(); res.on('end', () => resolve(res)); }).on('error', reject));
    try{
      const manifest = await head('/manifest.webmanifest');
      expect(manifest.statusCode).to.equal(200);
      expect(manifest.headers['content-type']).to.match(/application\/manifest\+json/);
      const sw = await head('/sw.js');
      expect(sw.headers['cache-control']).to.match(/no-store/);
      expect((await head('/assets/icon-192.png')).statusCode).to.equal(200);
    }finally{ server.close(); }
  });
});
