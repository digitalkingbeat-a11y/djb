const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const Connect = require('../connect');
const Social = require('../social_notifications');
const { resetRateLimits } = require('../social_helpers');
const { reportCommunityTarget } = require('../community');

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
const profile = (id, name, extra = {}) => ({ user_id:id, public_profile_id:`dj_${id}`, display_name:name, visibility:'public', belt:'White', ...extra });
const base = (extra = {}) => dataClient({ dj_progression_profiles:[profile('a', 'Ace'), profile('b', 'Bee'), profile('c', 'Cee')], dj_blocks:[], dj_notifications:[], dj_notification_mutes:[], direct_messages:[], community_reports:[], ...extra });

describe('Oct 19c: direct messages', () => {
  beforeEach(() => resetRateLimits());
  it('sends, lists with unread counts, marks read and never leaks user ids', async () => {
    const db = base();
    const sent = await Connect.sendDirectMessage(db, 'a', 'dj_b', { body:'  battle friday? ' });
    expect(sent.created).to.equal(true);
    expect(sent.message.body).to.equal('battle friday?');
    const list = await Connect.listConversations(db, 'b');
    expect(list.unread).to.equal(1);
    expect(list.conversations[0].with.publicProfileId).to.equal('dj_a');
    expect(JSON.stringify(list)).to.not.match(/"a"|user_id/);
    const read = await Connect.readConversation(db, 'b', 'dj_a');
    expect(read.messages).to.have.length(1);
    expect(read.messages[0].mine).to.equal(false);
    expect((await Connect.listConversations(db, 'b')).unread).to.equal(0);
    expect(db.db.dj_notifications.filter(n => n.user_id === 'b' && n.type === 'direct_message')).to.have.length(1);
  });
  it('validates length, self-messages and unknown DJs', async () => {
    const db = base();
    expect((await Connect.sendDirectMessage(db, 'a', 'dj_b', { body:'' })).validationError).to.match(/Type/);
    expect((await Connect.sendDirectMessage(db, 'a', 'dj_b', { body:'x'.repeat(1001) })).validationError).to.match(/1000/);
    expect((await Connect.sendDirectMessage(db, 'a', 'dj_a', { body:'hi' })).validationError).to.match(/yourself/);
    expect((await Connect.sendDirectMessage(db, 'a', 'dj_zzz', { body:'hi' })).notFound).to.equal(true);
  });
  it('blocks stop sending both ways and hide the conversation', async () => {
    const db = base();
    await Connect.sendDirectMessage(db, 'a', 'dj_b', { body:'hi' });
    db.db.dj_blocks.push({ blocker_user_id:'b', blocked_user_id:'a', active:true });
    expect((await Connect.sendDirectMessage(db, 'a', 'dj_b', { body:'again' })).blocked).to.equal(true);
    expect((await Connect.sendDirectMessage(db, 'b', 'dj_a', { body:'x' })).blocked).to.equal(true);
    expect((await Connect.listConversations(db, 'b')).conversations).to.have.length(0);
    const read = await Connect.readConversation(db, 'a', 'dj_b');
    expect(read.messages).to.have.length(0);
    expect(read.canSend).to.equal(false);
  });
  it('a mute keeps messages but silences the bell', async () => {
    const db = base({ dj_notification_mutes:[{ id:'m1', user_id:'b', muted_public_profile_id:'dj_a', category:'challenge', active:true }] });
    await Connect.sendDirectMessage(db, 'a', 'dj_b', { body:'hi' });
    expect(db.db.direct_messages).to.have.length(1);
    expect(db.db.dj_notifications).to.have.length(0);
    expect((await Connect.listConversations(db, 'b')).conversations[0].muted).to.equal(true);
  });
  it('rate limits bursts', async () => {
    const db = base();
    const now = new Date();
    for(let i = 0; i < 10; i++) await Connect.sendDirectMessage(db, 'a', 'dj_b', { body:`m${i}` }, now);
    expect((await Connect.sendDirectMessage(db, 'a', 'dj_b', { body:'m11' }, now)).rateLimited).to.equal(true);
  });
  it('only the sender can unsend; only the recipient can report', async () => {
    const db = base();
    const { message } = await Connect.sendDirectMessage(db, 'a', 'dj_b', { body:'hi' });
    expect((await Connect.unsendDirectMessage(db, 'b', message.id)).forbidden).to.equal(true);
    expect((await reportCommunityTarget(db, 'c', { targetType:'direct_message', targetId:message.id, reason:'spam' })).forbidden).to.equal(true);
    const rep = await reportCommunityTarget(db, 'b', { targetType:'direct_message', targetId:message.id, reason:'spam' });
    expect(rep.error).to.equal(undefined);
    expect((await Connect.unsendDirectMessage(db, 'a', message.id)).unsent).to.equal(true);
    expect((await Connect.readConversation(db, 'b', 'dj_a')).messages).to.have.length(0);
  });
  it('reports a missing table as a setup step', async () => {
    const db = base();
    db.from = () => ({ select(){ return this; }, eq(){ return this; }, limit(){ return Promise.resolve({ error:{ message:'relation "direct_messages" does not exist' } }); }, in(){ return this; } });
    const r = await Connect.listConversations(db, 'a');
    expect(r.schemaMissing).to.equal(true);
    expect(r.schema).to.equal('036_create_direct_messages');
  });
  it('direct_message is a notification type with a Settings switch', () => {
    expect(Social.SOCIAL_NOTIFICATION_TYPES).to.include('direct_message');
    expect(Social.SOCIAL_NOTIFICATION_LABELS.direct_message).to.be.a('string');
  });
});

describe('Oct 19c: Find DJs', () => {
  const db = () => base({ dj_progression_profiles:[
    profile('a', 'Ace'), profile('b', 'Bee Sharp', { hometown:'Atlanta, GA', genre:'House', belt:'Blue', wins:5 }),
    profile('c', 'Cee', { hometown:'Atlanta', genre:'Hip-Hop', belt:'Blue', wins:9 }), profile('d', 'Hidden', { visibility:'private', hometown:'Atlanta' }),
    profile('e', 'Shy', { searchable:false, hometown:'Atlanta' }), profile('f', 'Blocked', { hometown:'Atlanta' })
  ], dj_blocks:[{ blocker_user_id:'a', blocked_user_id:'f', active:true }] });
  it('filters by city, genre, name and belt and leaves out private, hidden, blocked and yourself', async () => {
    const d = db();
    const atl = await Connect.searchDjs(d, 'a', { city:'atlanta' });
    expect(atl.results.map(r => r.displayName)).to.deep.equal(['Cee', 'Bee Sharp']);
    expect((await Connect.searchDjs(d, 'a', { genre:'house' })).results.map(r => r.displayName)).to.deep.equal(['Bee Sharp']);
    expect((await Connect.searchDjs(d, 'a', { q:'sharp' })).results).to.have.length(1);
    expect((await Connect.searchDjs(d, 'a', { belt:'black' })).results).to.have.length(0);
    expect((await Connect.searchDjs(d, null, {})).results.map(r => r.displayName)).to.include('Ace');
    expect(JSON.stringify(atl)).to.not.match(/user_id/);
  });
  it('saves your listing', async () => {
    const d = db();
    const r = await Connect.updateSearchProfile(d, 'a', { hometown:' Miami ', genre:'Afro', searchable:false });
    expect(r.saved).to.equal(true);
    const row = d.db.dj_progression_profiles.find(p => p.user_id === 'a');
    expect([row.hometown, row.genre, row.searchable]).to.deep.equal(['Miami', 'Afro', false]);
  });
});

describe('Oct 19c: watch live', () => {
  beforeEach(() => Connect.resetWatchers());
  const db = (status = 'active', extra = {}) => base({
    battle_records:[{ id:'b1', title:'Friday Clash', genre:'House', status, visibility:'public' }, { id:'p1', title:'Secret', status:'active', visibility:'private' }],
    battle_entries:[{ battle_id:'b1', user_id:'a', status:'active' }, { battle_id:'b1', user_id:'b', status:'active' }],
    mix_submissions:[{ battle_id:'b1', user_id:'b', status:'submitted' }],
    battle_chat_messages:[{ id:'c1', battle_id:'b1', user_id:'a', body:'good luck', status:'active', created_at:'2026-10-20T12:00:00Z' }, { id:'c2', battle_id:'b1', user_id:'b', body:'gone', status:'deleted', created_at:'2026-10-20T12:01:00Z' }],
    ...extra
  });
  it('shows each DJ status, read-only chat and the watching count', async () => {
    const d = db();
    Connect.heartbeat('b1', 'viewer1'); Connect.heartbeat('b1', 'viewer2'); Connect.heartbeat('b1', 'viewer1');
    const r = await Connect.liveBattle(d, 'b1');
    expect(r.battle.status).to.equal('live');
    expect(r.watching).to.equal(2);
    expect(r.djs.map(x => x.status)).to.deep.equal(['Mixing now', 'Mix submitted']);
    expect(r.chat.map(m => m.body)).to.deep.equal(['good luck']);
    expect(r.votingOpen).to.equal(false);
    expect(JSON.stringify(r)).to.not.match(/user_id|"a"|"b"/);
  });
  it('watchers expire after 45 seconds', () => {
    const t = Date.now();
    Connect.heartbeat('b1', 'v1', t);
    expect(Connect.watchingCount('b1', t + Connect.WATCH_TTL_MS + 1)).to.equal(0);
  });
  it('opens crowd voting when the battle ends', async () => {
    const d = db('completed', { battle_crowd_votes:[] });
    const r = await Connect.liveBattle(d, 'b1');
    expect(r.votingOpen).to.equal(true);
    expect(r.djs.every(x => x.canVoteFor && x.publicProfileId)).to.equal(true);
    expect(JSON.stringify(r)).to.not.match(/user_id|"a"|"b"/);
    const v = await Connect.liveCrowdVote(d, 'c', 'b1', 'dj_b');
    expect(v.recorded).to.equal(true);
    expect(d.db.battle_crowd_votes[0].picked_user_id).to.equal('b');
    expect((await Connect.liveCrowdVote(d, 'a', 'b1', 'dj_b')).forbidden).to.equal(true);
    expect((await Connect.liveCrowdVote(d, 'c', 'b1', 'dj_zzz')).validationError).to.be.a('string');
  });
  it('private battles are not watchable and are not listed', async () => {
    expect((await Connect.liveBattle(db(), 'p1')).notFound).to.equal(true);
    expect((await Connect.liveBattles(db())).battles.map(b => b.id)).to.deep.equal(['b1']);
  });
});

describe('Oct 19c: shared tracklists', () => {
  beforeEach(() => resetRateLimits());
  it('stores only title, artist, BPM and key', async () => {
    const d = base({ shared_crate_tracklists:[] });
    const r = await Connect.shareTracklist(d, 'a', { name:'Warmup', crateId:'cr1', tracks:[{ title:'One', artist:'X', bpm:'124.04', key:'8A', audioUrl:'https://x/one.mp3', fileName:'one.mp3', storagePath:'a/1' }, { title:'' }, { title:'Two', bpm:9999 }] });
    expect(r.created).to.equal(true);
    const stored = d.db.shared_crate_tracklists[0];
    expect(stored.tracks).to.deep.equal([{ title:'One', artist:'X', bpm:124, key:'8A' }, { title:'Two', artist:null, bpm:null, key:null }]);
    expect(JSON.stringify(stored)).to.not.match(/mp3|storage|https/);
    const pub = await Connect.getTracklist(d, r.tracklist.id, 'c');
    expect(pub.tracklist.owner.displayName).to.equal('Ace');
    expect(pub.tracklist.mine).to.equal(false);
    expect(JSON.stringify(pub)).to.not.match(/user_id/);
  });
  it('rejects empty crates and lets only the owner stop sharing', async () => {
    const d = base({ shared_crate_tracklists:[] });
    expect((await Connect.shareTracklist(d, 'a', { name:'Empty', tracks:[] })).validationError).to.match(/no tracks/);
    const r = await Connect.shareTracklist(d, 'a', { name:'Warmup', tracks:[{ title:'One' }] });
    expect((await Connect.stopSharingTracklist(d, 'b', r.tracklist.id)).forbidden).to.equal(true);
    expect((await Connect.stopSharingTracklist(d, 'a', r.tracklist.id)).removed).to.equal(true);
    expect((await Connect.getTracklist(d, r.tracklist.id)).notFound).to.equal(true);
    expect((await Connect.myTracklists(d, 'a')).tracklists).to.have.length(0);
  });
});

describe('Oct 19c: weekly practice goals', () => {
  it('saves, updates and validates the goal', async () => {
    const d = base({ practice_goals:[] });
    expect((await Connect.getPracticeGoal(d, 'a')).goal).to.equal(null);
    expect((await Connect.setPracticeGoal(d, 'a', { sessionsPerWeek:3 })).saved).to.equal(true);
    await Connect.setPracticeGoal(d, 'a', { sessionsPerWeek:5 });
    expect(d.db.practice_goals).to.have.length(1);
    expect((await Connect.getPracticeGoal(d, 'a')).goal.sessionsPerWeek).to.equal(5);
    expect((await Connect.setPracticeGoal(d, 'a', { sessionsPerWeek:22 })).validationError).to.be.a('string');
    expect((await Connect.setPracticeGoal(d, 'a', { sessionsPerWeek:'abc' })).validationError).to.be.a('string');
  });
});

describe('Oct 19c: SQL and routes', () => {
  it('ships SQL 036-039 with RLS on and safe re-runs', () => {
    ['036_create_direct_messages.sql', '037_add_dj_search_fields.sql', '038_create_shared_crate_tracklists.sql', '039_create_practice_goals.sql'].forEach(f => {
      const text = sql(f);
      expect(text).to.match(/IF NOT EXISTS/);
    });
    expect(sql('036_create_direct_messages.sql')).to.match(/ENABLE ROW LEVEL SECURITY/).and.match(/'direct_message'/);
    expect(sql('038_create_shared_crate_tracklists.sql')).to.match(/ENABLE ROW LEVEL SECURITY/);
    expect(sql('039_create_practice_goals.sql')).to.match(/ENABLE ROW LEVEL SECURITY/);
  });
  it('registers the new routes with auth on private ones', () => {
    [
      "app.get('/api/messages', requireAuth", "app.post('/api/messages/:publicProfileId', requireAuth", "app.delete('/api/messages/item/:messageId', requireAuth",
      "app.get('/api/djs/search', optionalAuth", "app.put('/api/me/searchProfile', requireAuth", "app.get('/api/battles/:battleId/live', optionalAuth",
      "app.post('/api/battles/:battleId/watch'", "app.post('/api/battles/:battleId/live/vote', requireAuth", "app.post('/api/sharedCrates', requireAuth", "app.get('/api/sharedCrates/:id', optionalAuth",
      "app.delete('/api/sharedCrates/:id', requireAuth", "app.put('/api/practiceGoal', requireAuth"
    ].forEach(s => expect(serverSource).to.include(s));
  });
  it('documents the SQL and redeploy in the README', () => {
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    ['036_create_direct_messages', '037_add_dj_search_fields', '038_create_shared_crate_tracklists', '039_create_practice_goals'].forEach(n => expect(readme).to.include(n));
  });
});
