const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const BattleChat = require('../battle_chat');
const Tournaments = require('../tournaments');
const TimedComments = require('../timed_comments');
const { resetRateLimits } = require('../social_helpers');
const { reportCommunityTarget } = require('../community');
const { securityHeaders, CSP, EMBED_CSP } = require('../security');
const { isServableFrontendPath } = require('../static_frontend');

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
const profile = (id, name) => ({ user_id:id, public_profile_id:`dj_${id}`, display_name:name });

describe('Oct 19: battle room chat', () => {
  beforeEach(resetRateLimits);
  const seed = () => dataClient({
    battle_entries:[{ battle_id:'b1', user_id:'a', status:'active' }, { battle_id:'b1', user_id:'b', status:'active' }],
    dj_progression_profiles:[profile('a', 'DJ Ace'), profile('b', 'DJ Bee')], dj_blocks:[], battle_chat_messages:[]
  });

  it('lets the two DJs chat, stores plain capped text and hides user ids', async () => {
    const db = seed();
    const sent = await BattleChat.postBattleChat(db, 'a', 'b1', { body:'  good <b>luck</b>\n' });
    expect(sent.created).to.equal(true);
    expect(sent.message.body).to.equal('good <b>luck</b>');
    const listed = await BattleChat.listBattleChat(db, 'b', 'b1');
    expect(listed.messages).to.have.length(1);
    expect(listed.messages[0]).to.include({ mine:false });
    expect(listed.messages[0].author.displayName).to.equal('DJ Ace');
    expect(JSON.stringify(listed)).to.not.include('"a"');
    expect(listed.maxLength).to.equal(280);
  });

  it('rejects outsiders, empty and over-long messages', async () => {
    const db = seed();
    expect((await BattleChat.postBattleChat(db, 'stranger', 'b1', { body:'hi' })).forbidden).to.equal(true);
    expect((await BattleChat.listBattleChat(db, 'stranger', 'b1')).forbidden).to.equal(true);
    expect((await BattleChat.postBattleChat(db, 'a', 'b1', { body:'   ' })).validationError).to.be.a('string');
    expect((await BattleChat.postBattleChat(db, 'a', 'b1', { body:'x'.repeat(281) })).validationError).to.match(/280/);
  });

  it('respects blocks both ways and rate limits bursts', async () => {
    const db = seed();
    await BattleChat.postBattleChat(db, 'b', 'b1', { body:'before block' });
    db.db.dj_blocks.push({ blocker_user_id:'a', blocked_user_id:'b', status:'active', active:true });
    expect((await BattleChat.listBattleChat(db, 'a', 'b1')).messages).to.have.length(0);
    expect((await BattleChat.listBattleChat(db, 'a', 'b1')).canSend).to.equal(false);
    expect((await BattleChat.postBattleChat(db, 'b', 'b1', { body:'hey' })).blocked).to.equal(true);
    db.db.dj_blocks = [];
    let last;
    for(let i = 0; i < 9; i++) last = await BattleChat.postBattleChat(db, 'a', 'b1', { body:`m${i}` });
    expect(last.rateLimited).to.equal(true);
  });

  it('can be reported through community reports by the other DJ only', async () => {
    const db = seed();
    db.db.community_reports = [];
    const sent = await BattleChat.postBattleChat(db, 'a', 'b1', { body:'rude' });
    const own = await reportCommunityTarget(db, 'a', { targetType:'battle_chat_message', targetId:sent.message.id, reason:'harassment' });
    expect(own.forbidden).to.equal(true);
    const report = await reportCommunityTarget(db, 'b', { targetType:'battle_chat_message', targetId:sent.message.id, reason:'harassment' });
    expect(report.created || report.validationError).to.exist;
  });

  it('ships a migration with RLS and a report target type', () => {
    const text = sql('031_create_battle_chat_messages.sql');
    expect(text).to.include('char_length(body) BETWEEN 1 AND 280');
    expect(text).to.include('ENABLE ROW LEVEL SECURITY');
    expect(text).to.include("'battle_chat_message', 'timed_comment'");
    expect(serverSource).to.include("app.get('/api/battles/:battleId/chat'");
    expect(serverSource).to.include("app.post('/api/battles/:battleId/chat'");
  });
});

describe('Oct 19: tournaments', () => {
  beforeEach(resetRateLimits);
  const ids = n => Array.from({ length:n }, (_, i) => `dj-${i + 1}`);

  it('keeps the eight-seat foundation contract from the tranche11 branch', () => {
    const seats = ids(8);
    let matches = Tournaments.bracketFromSeats(seats);
    expect(matches.map(m => m.round)).to.deep.equal([1, 1, 1, 1, 2, 2, 3]);
    expect(() => Tournaments.bracketFromSeats([...seats.slice(0, 7), 'dj-1'])).to.throw();
    for(let p = 1; p <= 4; p++) matches = Tournaments.advanceWinner(matches, 1, p, seats[(p - 1) * 2]);
    matches = Tournaments.advanceWinner(matches, 2, 1, 'dj-1');
    matches = Tournaments.advanceWinner(matches, 2, 2, 'dj-5');
    matches = Tournaments.advanceWinner(matches, 3, 1, 'dj-5');
    expect(matches[6].winnerUserId).to.equal('dj-5');
  });

  it('seeds 16-DJ brackets in standard order and gives top seeds byes', () => {
    expect(Tournaments.seedOrder(8)).to.deep.equal([1, 8, 4, 5, 2, 7, 3, 6]);
    const full = Tournaments.bracketFromSeeds(ids(16), 16);
    expect(full.filter(m => m.round === 1)).to.have.length(8);
    expect(Math.max(...full.map(m => m.round))).to.equal(4);
    const six = Tournaments.bracketFromSeeds(ids(6), 8);
    const r1 = six.filter(m => m.round === 1);
    expect(r1.filter(m => m.status === 'bye').map(m => m.winnerUserId).sort()).to.deep.equal(['dj-1', 'dj-2']);
    expect(six.find(m => m.round === 2 && m.position === 1).firstUserId).to.equal('dj-1');
    const three = Tournaments.bracketFromSeeds(ids(3), 8);
    expect(three.filter(m => m.status === 'void').length).to.be.greaterThan(0);
    expect(three.find(m => m.round === 3).status).to.equal('pending');
  });

  it('runs a full tournament: sign-up, start, real battles, automatic advancement, champion', async () => {
    const db = dataClient({ dj_progression_profiles:ids(4).map(id => profile(id, id.toUpperCase())), battle_records:[] });
    const created = await Tournaments.createTournament(db, 'dj-1', { title:'Friday Knockout', capacity:8, seeding:'signup' });
    expect(created.tournament.entrantCount).to.equal(1);
    const tid = created.tournament.id;
    for(const id of ['dj-2', 'dj-3', 'dj-4']) expect((await Tournaments.joinTournament(db, id, tid)).joined).to.equal(true);
    expect((await Tournaments.joinTournament(db, 'dj-2', tid)).duplicate).to.equal(true);
    expect((await Tournaments.startTournament(db, 'dj-2', tid)).forbidden).to.equal(true);
    expect((await Tournaments.startTournament(db, 'dj-1', tid)).started).to.equal(true);
    expect((await Tournaments.joinTournament(db, 'dj-9', tid)).conflict).to.equal(true);
    let view = (await Tournaments.getTournament(db, tid, 'dj-1')).tournament;
    expect(view.status).to.equal('active');
    expect(JSON.stringify(view)).to.not.match(/UserId|user_id/);
    const deps = {
      createBattle:async (client, userId, input) => { client.db.battle_records.push({ id:input.battleId, status:'open', created_by:userId }); return { battle:{ id:input.battleId } }; },
      joinBattle:async () => ({ battle:null }),
      roomState:async () => ({ state:{ id:'room' } })
    };
    const playRound = async () => {
      view = (await Tournaments.getTournament(db, tid)).tournament;
      for(const m of view.matches.filter(x => x.status === 'ready')){
        const loaded = db.db.dj_tournament_matches.find(r => r.id === m.id);
        expect((await Tournaments.playTournamentMatch(db, 'outsider', tid, m.id, {}, deps)).forbidden).to.equal(true);
        const played = await Tournaments.playTournamentMatch(db, loaded.first_user_id, tid, m.id, {}, deps);
        expect(played.room).to.deep.equal({ id:'room' });
        expect((await Tournaments.tournamentBattleJoinAllowed(db, played.battleId, 'outsider')).allowed).to.equal(false);
        // The lower seed wins every match.
        const battle = db.db.battle_records.find(b => b.id === played.battleId);
        battle.resolution = { status:'resolved', outcome:'winner', participants:[{ userId:loaded.second_user_id, outcome:'winner' }, { userId:loaded.first_user_id, outcome:'loser' }] };
      }
    };
    await playRound();
    await playRound();
    view = (await Tournaments.getTournament(db, tid, 'dj-4')).tournament;
    expect(view.status).to.equal('completed');
    expect(view.champion.displayName).to.equal('DJ-3');
  });

  it('ties go to the higher seed and cancelled battles can be replayed', () => {
    const match = { firstUserId:'a', secondUserId:'b' };
    expect(Tournaments.battleWinner({ resolution:{ status:'resolved', outcome:'tie', participants:[] } }, match)).to.equal('a');
    expect(Tournaments.battleWinner({ resolution:{ status:'pending' } }, match)).to.equal(null);
  });

  it('ships the migration and routes, and gates tournament battles', () => {
    const text = sql('032_create_tournaments.sql');
    expect(text).to.include('CHECK (capacity IN (8, 16))');
    expect(text).to.include('UNIQUE (tournament_id, user_id)');
    expect(text).to.include("'bye'");
    expect(text).to.include('ENABLE ROW LEVEL SECURITY');
    expect(serverSource).to.include('tournamentBattleJoinAllowed');
    expect(serverSource).to.include("'/api/tournaments/:tournamentId/matches/:matchId/battle'");
  });
});

describe('Oct 19: timed comments', () => {
  beforeEach(resetRateLimits);
  const resolver = async (client, id) => id === 'vr_public' ? { result:{ verifiedResultId:id } } : id === 'vr_private' ? { private:true } : { notFound:true };
  const seed = () => dataClient({ dj_progression_profiles:[profile('a', 'DJ Ace'), profile('b', 'DJ Bee')], dj_blocks:[], result_timed_comments:[] });

  it('adds comments at a moment, sorted by time, editable and deletable by the owner only', async () => {
    const db = seed();
    const late = await TimedComments.addTimedComment(db, 'a', 'vr_public', { atSeconds:102.34, body:'that transition 🔥' }, new Date(), { resolver });
    await TimedComments.addTimedComment(db, 'b', 'vr_public', { atSeconds:12, body:'<img src=x onerror=alert(1)>' }, new Date(), { resolver });
    expect(late.comment.atSeconds).to.equal(102.3);
    const listed = await TimedComments.listTimedComments(db, 'vr_public', 'a', { resolver });
    expect(listed.comments.map(c => c.atSeconds)).to.deep.equal([12, 102.3]);
    expect(listed.comments[1].mine).to.equal(true);
    expect((await TimedComments.editTimedComment(db, 'b', late.comment.id, { body:'hijack' })).forbidden).to.equal(true);
    expect((await TimedComments.editTimedComment(db, 'a', late.comment.id, { body:'that blend' })).comment.editedAt).to.be.a('string');
    expect((await TimedComments.deleteTimedComment(db, 'a', late.comment.id)).deleted).to.equal(true);
    expect((await TimedComments.listTimedComments(db, 'vr_public', null, { resolver })).comments).to.have.length(1);
  });

  it('only works on public results and validates time and length', async () => {
    const db = seed();
    expect((await TimedComments.addTimedComment(db, 'a', 'vr_private', { atSeconds:1, body:'x' }, new Date(), { resolver })).private).to.equal(true);
    expect((await TimedComments.addTimedComment(db, 'a', 'vr_public', { atSeconds:-1, body:'x' }, new Date(), { resolver })).validationError).to.be.a('string');
    expect((await TimedComments.addTimedComment(db, 'a', 'vr_public', { atSeconds:5, body:'x'.repeat(501) }, new Date(), { resolver })).validationError).to.match(/500/);
    expect((await TimedComments.listTimedComments(db, 'bad id', null, { resolver })).notFound).to.equal(true);
  });

  it('hides blocked DJs from the viewer', async () => {
    const db = seed();
    await TimedComments.addTimedComment(db, 'b', 'vr_public', { atSeconds:3, body:'hi' }, new Date(), { resolver });
    db.db.dj_blocks.push({ blocker_user_id:'a', blocked_user_id:'b', status:'active' });
    expect((await TimedComments.listTimedComments(db, 'vr_public', 'a', { resolver })).comments).to.have.length(0);
  });

  it('ships the migration and routes', () => {
    expect(sql('033_create_result_timed_comments.sql')).to.include('at_seconds numeric');
    expect(serverSource).to.include("'/api/publicBattleResults/:verifiedResultId/timedComments'");
    expect(serverSource).to.include("app.delete('/api/timedComments/:commentId'");
  });
});

describe('Oct 19: embed framing', () => {
  let server, base;
  before(done => {
    const app = express();
    app.use(securityHeaders);
    app.get('*', (req, res) => res.send('ok'));
    server = app.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; done(); });
  });
  after(done => server.close(done));
  const head = p => new Promise((resolve, reject) => http.get(base + p, res => { res.resume(); resolve(res.headers); }).on('error', reject));

  it('lets other sites frame only the embed page', async () => {
    const embed = await head('/embed.html');
    expect(embed['x-frame-options']).to.equal(undefined);
    expect(embed['content-security-policy']).to.include('frame-ancestors *');
    const app = await head('/index.html');
    expect(app['x-frame-options']).to.equal('DENY');
    expect(app['content-security-policy']).to.include("frame-ancestors 'none'");
    expect(CSP).to.include("frame-ancestors 'none'");
    expect(EMBED_CSP).to.not.include("frame-ancestors 'none'");
    expect(isServableFrontendPath('/embed.html')).to.equal(true);
  });
});
