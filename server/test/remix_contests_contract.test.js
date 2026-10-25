const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const R = require('../remix_contests');
const Social = require('../social_notifications');
const { resetRateLimits, stablePublicProfileId } = require('../social_helpers');
const { reportCommunityTarget } = require('../community');

const root = path.join(__dirname, '..');
const sqlText = fs.readFileSync(path.join(root, 'sql', '049_create_remix_contests.sql'), 'utf8');
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
function fakeStorage(){
  const files = new Map();
  return { files,
    async createSignedUploadUrl(p){ return { data:{ path:p, token:`tok-${p.length}` }, error:null }; },
    async createSignedUrl(p, secs){ return { data:{ signedUrl:`https://signed.test/${encodeURIComponent(p)}?e=${secs}` }, error:null }; },
    async list(dir, { search }){ const full = `${dir}/${search}`; return { data:files.has(full) ? [{ name:search, metadata:{ size:files.get(full) } }] : [], error:null }; },
    async remove(paths){ paths.forEach(p => files.delete(p)); return { error:null }; },
    put(p, size){ files.set(p, size); }
  };
}
const U = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
const [HOST, A, B, C] = U;
const t0 = new Date('2026-10-25T12:00:00Z');
const later = h => new Date(t0.getTime() + h * 3600e3);
const baseInput = (o = {}) => ({ title:'Flip my beat', description:'Any genre', rightsClassification:'original', rightsConfirmed:true,
  submissionDeadline:later(48).toISOString(), votingDeadline:later(96).toISOString(), parts:[{ label:'Drums', filename:'drums.wav', mimeType:'audio/wav', size:1000 }, { label:'Bass', filename:'bass.mp3', mimeType:'audio/mpeg', size:500 }], ...o });
function newDb(){
  return dataClient({ remix_contests:[], remix_contest_entries:[], remix_contest_votes:[], dj_notifications:[], dj_notification_mutes:[], community_reports:[],
    dj_progression_profiles:[{ user_id:HOST, display_name:'DJ Host' }, { user_id:A, display_name:'DJ Alpha' }, { user_id:B, display_name:'DJ Bravo' }, { user_id:C, display_name:'DJ Charlie' }],
    marketplace_products:[], marketplace_rights_policies:[], marketplace_listings:[] });
}
async function liveContest(db, st, input){
  const c = await R.createContest(db, st, HOST, baseInput(input), t0);
  expect(c.created, JSON.stringify(c)).to.equal(true);
  db.db.remix_contests[0].parts.forEach(p => st.put(p.path, p.size));
  const p = await R.publishContest(db, st, HOST, c.contest.id, t0);
  expect(p.published).to.equal(true);
  return c.contest.id;
}
async function enter(db, st, user, id, at = later(1), size = 900){
  const s = await R.startEntry(db, st, user, id, { title:`Remix by ${user.slice(0, 2)}`, notes:'n', filename:'mix.mp3', mimeType:'audio/mpeg', size }, at);
  expect(s.upload, JSON.stringify(s)).to.be.an('object');
  st.put(s.upload.uploadPath, size);
  return R.completeEntry(db, st, user, id, at);
}
const noPrivateIds = obj => { const text = JSON.stringify(obj); U.forEach(u => expect(text).not.to.include(u)); expect(text).not.to.include('private/'); };

describe('Remix contests', () => {
  beforeEach(() => resetRateLimits());

  it('SQL 049 creates the three tables, one remix and one vote per account, and adds report + alert types', () => {
    ['remix_contests', 'remix_contest_entries', 'remix_contest_votes'].forEach(t => expect(sqlText).to.match(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}`)));
    expect(sqlText).to.match(/UNIQUE \(contest_id, user_id\)/);
    expect(sqlText).to.match(/PRIMARY KEY \(contest_id, voter_user_id\)/);
    expect(sqlText).to.match(/'remix_contest', 'remix_entry'/);
    expect(sqlText).to.match(/'remix_contest_won','remix_store_offer'/);
    expect(sqlText).to.match(/'original','licensed','royalty_free','platform_cleared'/);
    expect(sqlText).not.to.match(/028_create_tournaments/);
    expect(Social.SOCIAL_NOTIFICATION_TYPES || []).to.satisfy(list => !list.length || (list.includes('remix_contest_won') && list.includes('remix_store_offer')));
    expect(serverSource).to.include("require('./remix_contests')");
    expect(serverSource).to.match(/app\.get\('\/api\/remix-contests\/champions'[\s\S]*app\.get\('\/api\/remix-contests\/:id'/);
  });

  it('creating needs a title, Beat Store rights, the rights checkbox, sane deadlines and valid audio parts', async () => {
    const db = newDb(), st = fakeStorage();
    expect((await R.createContest(db, st, HOST, baseInput({ rightsClassification:'unknown' }), t0)).validationError).to.match(/rights/);
    expect((await R.createContest(db, st, HOST, baseInput({ rightsConfirmed:false }), t0)).validationError).to.match(/Confirm/);
    expect((await R.createContest(db, st, HOST, baseInput({ submissionDeadline:later(2).toISOString() }), t0)).validationError).to.match(/24 hours/);
    expect((await R.createContest(db, st, HOST, baseInput({ votingDeadline:later(50).toISOString() }), t0)).validationError).to.match(/Voting needs/);
    expect((await R.createContest(db, st, HOST, baseInput({ parts:[] }), t0)).validationError).to.match(/part/);
    expect((await R.createContest(db, st, HOST, baseInput({ parts:[{ filename:'x.exe', mimeType:'application/x-msdownload', size:9 }] }), t0)).validationError).to.match(/Unsupported/);
    expect((await R.createContest(db, st, HOST, baseInput({ title:'x' }), t0)).validationError).to.match(/title/);
    const ok = await R.createContest(db, st, HOST, baseInput(), t0);
    expect(ok.created).to.equal(true);
    expect(ok.uploads).to.have.length(2);
    expect(ok.contest.phase).to.equal('draft');
    expect(db.db.remix_contests[0].parts.every(p => p.path.startsWith(R.PATH_PREFIX))).to.equal(true);
  });

  it('a draft only goes live once every part has uploaded, and is hidden from everyone but the host', async () => {
    const db = newDb(), st = fakeStorage();
    const c = await R.createContest(db, st, HOST, baseInput(), t0);
    expect((await R.listContests(db, A, t0)).contests).to.have.length(0);
    expect((await R.getContest(db, c.contest.id, A, t0)).notFound).to.equal(true);
    const first = db.db.remix_contests[0].parts[0]; st.put(first.path, first.size);
    expect((await R.publishContest(db, st, HOST, c.contest.id, t0)).validationError).to.match(/Bass/);
    expect((await R.publishContest(db, st, A, c.contest.id, t0)).forbidden).to.equal(true);
    const second = db.db.remix_contests[0].parts[1]; st.put(second.path, second.size);
    expect((await R.publishContest(db, st, HOST, c.contest.id, t0)).published).to.equal(true);
    const list = await R.listContests(db, null, t0);
    expect(list.contests[0].phase).to.equal('open');
    expect(list.contests[0].countdown.what).to.equal('Submissions close');
    noPrivateIds(list);
  });

  it('remixers download parts, send one remix each, can replace it before the deadline, and the host cannot enter', async () => {
    const db = newDb(), st = fakeStorage();
    const id = await liveContest(db, st);
    const part = db.db.remix_contests[0].parts[0];
    expect((await R.partDownload(db, st, null, id, part.id, later(1))).forbidden).to.equal(true);
    const dl = await R.partDownload(db, st, A, id, part.id, later(1));
    expect(dl.url).to.match(/^https:\/\/signed\.test\//);
    expect((await R.startEntry(db, st, HOST, id, { filename:'a.mp3', mimeType:'audio/mpeg', size:1 }, later(1))).validationError).to.match(/Hosts/);
    expect((await R.completeEntry(db, st, A, id, later(1))).validationError).to.match(/Upload/);
    const first = await enter(db, st, A, id);
    expect(first.submitted).to.equal(true); expect(first.replaced).to.equal(false);
    const oldPath = db.db.remix_contest_entries[0].storage_path;
    const again = await enter(db, st, A, id, later(2), 1200);
    expect(again.replaced).to.equal(true);
    expect(db.db.remix_contest_entries).to.have.length(1);
    expect(db.db.remix_contest_entries[0].storage_path).not.to.equal(oldPath);
    expect(st.files.has(oldPath)).to.equal(false);
    expect((await R.startEntry(db, st, B, id, { filename:'a.mp3', mimeType:'audio/mpeg', size:1 }, later(49))).validationError).to.match(/closed/);
  });

  it('host can edit or cancel only before the first remix arrives', async () => {
    const db = newDb(), st = fakeStorage();
    const id = await liveContest(db, st);
    expect((await R.editContest(db, A, id, { title:'Hijack' }, later(1))).forbidden).to.equal(true);
    const ed = await R.editContest(db, HOST, id, { title:'Flip it good', submissionDeadline:later(72).toISOString() }, later(1));
    expect(ed.updated).to.equal(true);
    expect(ed.contest.title).to.equal('Flip it good');
    expect(new Date(ed.contest.votingDeadline) - new Date(ed.contest.submissionDeadline)).to.equal(72 * 3600e3);
    await enter(db, st, A, id);
    expect((await R.editContest(db, HOST, id, { title:'Changed' }, later(2))).validationError).to.match(/already come in/);
    expect((await R.cancelContest(db, HOST, id, later(2))).validationError).to.match(/already come in/);
    const db2 = newDb(), st2 = fakeStorage();
    const id2 = await liveContest(db2, st2);
    expect((await R.cancelContest(db2, HOST, id2, later(1))).cancelled).to.equal(true);
    expect((await R.listContests(db2, A, later(1))).contests).to.have.length(0);
  });

  it('crowd voting: only after submissions close, one vote per account, never for your own remix; counts hidden until the end', async () => {
    const db = newDb(), st = fakeStorage();
    const id = await liveContest(db, st);
    await enter(db, st, A, id); await enter(db, st, B, id);
    const [ea, eb] = db.db.remix_contest_entries.map(e => e.id);
    expect((await R.castVote(db, C, id, { entryId:ea }, later(10))).validationError).to.match(/opens when/);
    const voting = later(60);
    expect((await R.castVote(db, A, id, { entryId:ea }, voting)).validationError).to.match(/own remix/);
    expect((await R.castVote(db, C, id, { entryId:ea }, voting)).voted).to.equal(true);
    expect((await R.castVote(db, C, id, { entryId:eb }, voting)).duplicate).to.equal(true);
    expect((await R.castVote(db, A, id, { entryId:eb }, voting)).voted).to.equal(true);
    expect((await R.castVote(db, HOST, id, { entryId:eb }, voting)).voted).to.equal(true);
    expect(db.db.remix_contest_votes).to.have.length(3);
    const view = await R.getContest(db, id, C, voting);
    expect(view.contest.phase).to.equal('voting');
    expect(view.contest.entries.every(e => e.votes === null)).to.equal(true);
    expect(view.contest.viewer.votedEntryId).to.equal(ea);
    expect(view.contest.viewer.canVote).to.equal(false);
    noPrivateIds(view);
    expect(view.contest.entries[0].dj.publicProfileId).to.equal(stablePublicProfileId(A));
  });

  it('when voting closes the top remix wins, gets the Remix Champion badge and an alert; ties go to the earliest remix', async () => {
    const db = newDb(), st = fakeStorage();
    const id = await liveContest(db, st);
    await enter(db, st, A, id, later(1)); await enter(db, st, B, id, later(2));
    const [ea, eb] = db.db.remix_contest_entries.map(e => e.id);
    await R.castVote(db, C, id, { entryId:eb }, later(60));
    await R.castVote(db, HOST, id, { entryId:eb }, later(60));
    await R.castVote(db, A, id, { entryId:eb }, later(60));
    const done = await R.getContest(db, id, null, later(100));
    expect(done.contest.phase).to.equal('completed');
    expect(done.contest.winner.displayName).to.equal('DJ Bravo');
    expect(done.contest.entries[0].isWinner).to.equal(true);
    expect(done.contest.entries[0].votes).to.equal(3);
    expect(db.db.dj_notifications.filter(n => n.type === 'remix_contest_won')).to.have.length(1);
    expect(String(db.db.dj_notifications[0].user_id)).to.equal(B);
    await R.getContest(db, id, null, later(101));
    expect(db.db.dj_notifications.filter(n => n.type === 'remix_contest_won')).to.have.length(1);
    const champs = await R.listChampions(db);
    expect(champs.badge.label).to.equal('Remix Champion');
    expect(champs.champions).to.deep.equal([{ publicProfileId:stablePublicProfileId(B), displayName:'DJ Bravo', wins:1 }]);
    noPrivateIds(champs);
    expect((await R.myRemixSummary(db, B)).wins).to.equal(1);
    expect(R.pickWinner([{ id:'x', status:'submitted', submitted_at:'2026-01-02' }, { id:'y', status:'submitted', submitted_at:'2026-01-01' }], []).id).to.equal('y');
    expect(ea).to.be.a('string');
  });

  it('Beat Store listing needs the host to ask, the winner to say yes, then lists with the winner as seller', async () => {
    const db = newDb(), st = fakeStorage();
    const id = await liveContest(db, st);
    await enter(db, st, A, id);
    await R.castVote(db, C, id, { entryId:db.db.remix_contest_entries[0].id }, later(60));
    await R.sweepDueContests(db, later(100));
    expect(db.db.remix_contests[0].status).to.equal('completed');
    expect((await R.listWinnerInStore(db, HOST, id, later(101))).validationError).to.match(/agreed/);
    expect((await R.offerStoreListing(db, A, id, { priceCents:500 }, later(101))).forbidden).to.equal(true);
    expect((await R.offerStoreListing(db, HOST, id, { priceCents:500 }, later(101))).offered).to.equal(true);
    expect(db.db.dj_notifications.some(n => n.type === 'remix_store_offer' && String(n.user_id) === A)).to.equal(true);
    expect((await R.answerStoreOffer(db, B, id, { accept:true }, later(102))).forbidden).to.equal(true);
    expect((await R.answerStoreOffer(db, A, id, { accept:true }, later(102))).status).to.equal('accepted');
    const listed = await R.listWinnerInStore(db, HOST, id, later(103));
    expect(listed.listed, JSON.stringify(listed)).to.equal(true);
    const listing = db.db.marketplace_listings[0];
    expect(listing.seller_user_id).to.equal(A);
    expect(listing.status).to.equal('published');
    expect(listing.display_price_cents).to.equal(500);
    expect(db.db.marketplace_products[0].audio_storage_object_path).to.match(/^private\/battle-entries\/remix-contests\//);
    expect((await R.listWinnerInStore(db, HOST, id, later(104))).validationError).to.match(/already/);
  });

  it('a winner can say no, and then nothing is listed', async () => {
    const db = newDb(), st = fakeStorage();
    const id = await liveContest(db, st);
    await enter(db, st, A, id);
    await R.getContest(db, id, null, later(100));
    await R.offerStoreListing(db, HOST, id, { priceCents:300 }, later(101));
    expect((await R.answerStoreOffer(db, A, id, { accept:false }, later(102))).status).to.equal('declined');
    expect((await R.listWinnerInStore(db, HOST, id, later(103))).validationError).to.match(/agreed/);
    expect(db.db.marketplace_listings).to.have.length(0);
  });

  it('contests and remixes go to the shared report queue; moderators can hide a remix so it cannot win', async () => {
    const db = newDb(), st = fakeStorage();
    const id = await liveContest(db, st);
    await enter(db, st, A, id); await enter(db, st, B, id);
    const [ea, eb] = db.db.remix_contest_entries.map(e => e.id);
    const rep = await reportCommunityTarget(db, C, { targetType:'remix_entry', targetId:ea, reason:'copyright' }, later(3));
    expect(rep.created, JSON.stringify(rep)).to.equal(true);
    expect((await reportCommunityTarget(db, A, { targetType:'remix_entry', targetId:ea, reason:'spam' }, later(3))).forbidden).to.equal(true);
    expect((await reportCommunityTarget(db, C, { targetType:'remix_contest', targetId:id, reason:'spam' }, later(3))).created).to.equal(true);
    expect((await R.moderateEntry(db, ea, { action:'hide' }, later(4))).status).to.equal('hidden');
    expect((await R.castVote(db, C, id, { entryId:ea }, later(60))).validationError).to.match(/Pick one/);
    const pub = await R.getContest(db, id, C, later(60));
    expect(pub.contest.entries.map(e => e.id)).to.deep.equal([eb]);
    expect((await R.entryPlayback(db, st, id, ea, C, later(60))).notFound).to.equal(true);
    expect((await R.entryPlayback(db, st, id, eb, null, later(60))).url).to.match(/signed\.test/);
    await R.getContest(db, id, null, later(100));
    expect(db.db.remix_contests[0].winner_entry_id).to.equal(eb);
  });

  it('reports "run SQL 049" when the tables are missing', async () => {
    const db = { from(){ const q = { select:() => q, eq:() => q, limit:() => q, then:(res) => Promise.resolve({ data:null, error:{ message:'relation "remix_contests" does not exist' } }).then(res) }; return q; } };
    const r = await R.listContests(db, null, t0);
    expect(r).to.deep.equal({ schemaMissing:true, schema:'049_create_remix_contests' });
  });
});
