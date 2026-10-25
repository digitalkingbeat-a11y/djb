const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const BattleChat = require('../battle_chat');
const Tournaments = require('../tournaments');
const TimedComments = require('../timed_comments');
const Social = require('../social_notifications');
const Challenges = require('../dj_challenges');
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


const notifs = (db, user, type) => (db.db.dj_notifications || []).filter(n => n.user_id === user && (!type || n.type === type));
const H = 3600000;

async function startedEight(n = 4, opts = {}){
  const ids = ['h', 'b', 'c', 'd', 'e', 'f', 'g', 'i'].slice(0, n);
  const db = dataClient({ dj_progression_profiles:ids.map(id => profile(id, `DJ ${id.toUpperCase()}`)), dj_blocks:[], battle_entries:[], mix_submissions:[], dj_notifications:[], dj_notification_mutes:opts.mutes || [] });
  const t0 = new Date('2026-10-20T12:00:00Z');
  const created = await Tournaments.createTournament(db, 'h', { title:'Friday Knockout', capacity:8, seeding:'signup', roundHours:opts.roundHours }, t0);
  const id = created.tournament.id;
  for(const u of ids.slice(1)) await Tournaments.joinTournament(db, u, id, t0);
  await Tournaments.startTournament(db, 'h', id, t0);
  return { db, id, t0, ids };
}

describe('Oct 19b: tournament round deadlines and forfeits', () => {
  beforeEach(resetRateLimits);

  it('gives every ready match a deadline (48h by default) and shows it', async () => {
    const { db, id, t0 } = await startedEight(4);
    const got = await Tournaments.getTournament(db, id, 'h', t0);
    const ready = got.tournament.matches.filter(m => m.status === 'ready');
    expect(ready).to.have.length(2);
    ready.forEach(m => expect(new Date(m.deadlineAt).getTime() - t0.getTime()).to.equal(48 * H));
    expect(got.tournament.roundHours).to.equal(48);
  });

  it('rejects odd round lengths and accepts 24h', async () => {
    const db = dataClient({ dj_progression_profiles:[] });
    expect((await Tournaments.createTournament(db, 'h', { title:'X', capacity:8, roundHours:5 })).validationError).to.match(/round length/);
    const ok = await Tournaments.createTournament(db, 'h', { title:'X', capacity:8, roundHours:24 });
    expect(ok.tournament.roundHours).to.equal(24);
  });

  it('forfeits the DJ who did not play once time is up', async () => {
    const { db, id, t0 } = await startedEight(4);
    const m = db.db.dj_tournament_matches.find(r => r.status === 'ready' && [r.first_user_id, r.second_user_id].includes('h'));
    const opp = m.first_user_id === 'h' ? m.second_user_id : m.first_user_id;
    m.battle_id = 'bt1'; m.status = 'active';
    db.db.battle_records = [{ id:'bt1', status:'open' }];
    db.db.battle_entries.push({ id:'en1', battle_id:'bt1', user_id:opp, status:'active' }, { id:'en2', battle_id:'bt1', user_id:'h', status:'active' });
    db.db.mix_submissions.push({ id:'s1', battle_entry_id:'en1', user_id:opp, status:'uploaded' });
    const early = await Tournaments.getTournament(db, id, 'h', new Date(t0.getTime() + 47 * H));
    expect(early.tournament.matches.find(x => x.id === m.id).winner).to.equal(null);
    const late = new Date(t0.getTime() + 49 * H);
    const after = await Tournaments.getTournament(db, id, 'h', late);
    const done = after.tournament.matches.find(x => x.id === m.id);
    expect(done.status).to.equal('completed');
    expect(done.winner.displayName).to.equal(`DJ ${opp.toUpperCase()}`);
    expect(done.forfeit.displayName).to.equal('DJ H');
    expect(JSON.stringify(after)).to.not.include('"forfeit_user_id"');
  });

  it('when neither DJ plays the higher seed goes through; when both played it waits for judges', () => {
    const now = new Date('2026-10-22T00:00:00Z');
    const m = { firstUserId:'a', secondUserId:'b', status:'ready', deadlineAt:'2026-10-21T00:00:00Z', winnerUserId:null };
    expect(Tournaments.forfeitDecision(m, new Set(), now)).to.include({ winnerUserId:'a', forfeitUserId:'b', bothMissed:true });
    expect(Tournaments.forfeitDecision(m, new Set(['a', 'b']), now)).to.equal(null);
    expect(Tournaments.forfeitDecision(m, new Set(['b']), now)).to.include({ winnerUserId:'b', forfeitUserId:'a' });
    expect(Tournaments.forfeitDecision({ ...m, deadlineAt:'2026-10-23T00:00:00Z' }, new Set(), now)).to.equal(null);
  });

  it('migration 034 adds the columns and never touches the old 028 tournament draft', () => {
    const text = sql('034_add_tournament_deadlines_host_controls.sql');
    ['round_hours', 'starts_at', 'cancelled_at', 'deadline_at', 'forfeit_user_id', 'IF NOT EXISTS'].forEach(word => expect(text).to.include(word));
    expect(fs.existsSync(path.join(root, 'sql', '028_create_tournaments.sql'))).to.equal(false);
  });
});

describe('Oct 19b: tournament host controls', () => {
  beforeEach(resetRateLimits);

  it('lets only the host rename, reschedule and change round length before the start', async () => {
    const db = dataClient({ dj_progression_profiles:[profile('h', 'Host'), profile('b', 'Bee')] });
    const now = new Date('2026-10-20T12:00:00Z');
    const t = (await Tournaments.createTournament(db, 'h', { title:'Old', capacity:8 }, now)).tournament;
    await Tournaments.joinTournament(db, 'b', t.id, now);
    expect((await Tournaments.updateTournament(db, 'b', t.id, { title:'Hacked' }, now)).forbidden).to.equal(true);
    const starts = '2026-10-23T20:00:00.000Z';
    expect((await Tournaments.updateTournament(db, 'h', t.id, { title:'New name', startsAt:starts, roundHours:72 }, now)).updated).to.equal(true);
    const got = (await Tournaments.getTournament(db, t.id, 'h', now)).tournament;
    expect(got).to.include({ title:'New name', startsAt:starts, roundHours:72, status:'open' });
    expect((await Tournaments.updateTournament(db, 'h', t.id, { startsAt:'2020-01-01T00:00:00Z' }, now)).validationError).to.match(/future/);
  });

  it('draws the bracket automatically when the start date passes', async () => {
    const db = dataClient({ dj_progression_profiles:[], dj_notifications:[], dj_notification_mutes:[] });
    const now = new Date('2026-10-20T12:00:00Z');
    const t = (await Tournaments.createTournament(db, 'h', { title:'Sched', capacity:8, startsAt:'2026-10-21T12:00:00Z' }, now)).tournament;
    await Tournaments.joinTournament(db, 'b', t.id, now);
    expect((await Tournaments.getTournament(db, t.id, 'h', now)).tournament.status).to.equal('open');
    expect((await Tournaments.getTournament(db, t.id, 'h', new Date('2026-10-21T12:01:00Z'))).tournament.status).to.not.equal('open');
  });

  it('removing a DJ frees the seat before the start and forfeits their match after', async () => {
    const db = dataClient({ dj_progression_profiles:[profile('h', 'Host'), profile('b', 'Bee'), profile('c', 'Cee')] });
    const t = (await Tournaments.createTournament(db, 'h', { title:'R', capacity:8 })).tournament;
    await Tournaments.joinTournament(db, 'b', t.id);
    expect((await Tournaments.removeEntrant(db, 'b', t.id, 'dj_h')).forbidden).to.equal(true);
    expect((await Tournaments.removeEntrant(db, 'h', t.id, 'dj_h')).validationError).to.match(/yourself/);
    expect((await Tournaments.removeEntrant(db, 'h', t.id, 'dj_b')).removed).to.equal(true);
    expect((await Tournaments.getTournament(db, t.id, 'h')).tournament.entrantCount).to.equal(1);

    const s = await startedEight(4);
    const m = s.db.db.dj_tournament_matches.find(r => r.status === 'ready' && [r.first_user_id, r.second_user_id].includes('b'));
    const opp = m.first_user_id === 'b' ? m.second_user_id : m.first_user_id;
    const out = await Tournaments.removeEntrant(s.db, 'h', s.id, 'dj_b', s.t0);
    expect(out.forfeited).to.equal(true);
    expect(m.winner_user_id).to.equal(opp);
    expect(m.forfeit_user_id).to.equal('b');
  });

  it('cancel is host-only and hides the tournament from the list', async () => {
    const db = dataClient({ dj_progression_profiles:[] });
    const t = (await Tournaments.createTournament(db, 'h', { title:'C', capacity:8 })).tournament;
    expect((await Tournaments.cancelTournament(db, 'x', t.id)).forbidden).to.equal(true);
    expect((await Tournaments.cancelTournament(db, 'h', t.id)).cancelled).to.equal(true);
    expect((await Tournaments.listTournaments(db, 'h')).tournaments).to.have.length(0);
    expect((await Tournaments.cancelTournament(db, 'h', t.id)).conflict).to.equal(true);
  });

  it('server exposes the host, history and notification routes', () => {
    ["app.patch('/api/tournaments/:tournamentId'", "'/api/tournaments/:tournamentId/remove'", "'/api/tournaments/:tournamentId/cancel'", "'/api/me/tournaments'", "'/api/tournamentChampions'", "'/api/notificationPreferences/social'", "app.delete('/api/battles/:battleId/chat/:messageId'"].forEach(r => expect(serverSource).to.include(r));
  });
});

describe('Oct 19b: Activity-bell notifications', () => {
  beforeEach(resetRateLimits);

  it('tells both DJs when their tournament match is ready, once', async () => {
    const { db, id, t0 } = await startedEight(4);
    expect(notifs(db, 'h', 'tournament_match_ready')).to.have.length(1);
    const n = notifs(db, 'h', 'tournament_match_ready')[0];
    expect(n.category).to.equal('battle');
    expect(n.destination).to.deep.equal({ type:'tournament', tournamentId:id, label:'Open tournament' });
    expect(n.summary).to.match(/Semifinal in Friday Knockout is ready/);
    await Tournaments.getTournament(db, id, 'h', t0);
    expect(notifs(db, 'h', 'tournament_match_ready')).to.have.length(1);
  });

  it('battle chat notifies the opponent, at most once per 10 minutes', async () => {
    const db = dataClient({ battle_entries:[{ battle_id:'b1', user_id:'a', status:'active' }, { battle_id:'b1', user_id:'b', status:'active' }], dj_progression_profiles:[profile('a', 'DJ Ace'), profile('b', 'DJ Bee')], dj_blocks:[], battle_chat_messages:[], dj_notifications:[], dj_notification_mutes:[] });
    const t = new Date('2026-10-20T12:00:00Z');
    await BattleChat.postBattleChat(db, 'a', 'b1', { body:'good luck' }, t);
    await BattleChat.postBattleChat(db, 'a', 'b1', { body:'again' }, new Date(t.getTime() + 60000));
    expect(notifs(db, 'b', 'battle_chat_message')).to.have.length(1);
    expect(notifs(db, 'a')).to.have.length(0);
    expect(notifs(db, 'b')[0].summary).to.include('DJ Ace');
    expect(notifs(db, 'b')[0].destination).to.include({ type:'battle_room', battleId:'b1' });
  });

  it('a switched-off type is not delivered, and switching back on works', async () => {
    const db = dataClient({ dj_notifications:[], dj_notification_mutes:[], dj_progression_profiles:[] });
    expect((await Social.getSocialNotificationPrefs(db, 'u')).prefs).to.deep.equal({ tournament_match_ready:true, battle_chat_message:true, timed_comment_received:true, direct_message:true, result_review_decided:true, invite_joined:true, remix_contest_won:true, remix_store_offer:true });
    const off = await Social.setSocialNotificationPref(db, 'u', 'battle_chat_message', false);
    expect(off.prefs.battle_chat_message).to.equal(false);
    expect((await Social.emitSocialNotification(db, { recipientUserId:'u', actorUserId:'x', type:'battle_chat_message', eventKey:'k' })).muted).to.equal(true);
    expect((await Social.emitSocialNotification(db, { recipientUserId:'u', actorUserId:'x', type:'timed_comment_received', eventKey:'k' })).created).to.equal(true);
    const on = await Social.setSocialNotificationPref(db, 'u', 'battle_chat_message', true);
    expect(on.prefs.battle_chat_message).to.equal(true);
    expect((await Social.emitSocialNotification(db, { recipientUserId:'u', actorUserId:'x', type:'battle_chat_message', eventKey:'k2' })).created).to.equal(true);
    expect((await Social.setSocialNotificationPref(db, 'u', 'nope', false)).validationError).to.be.a('string');
  });

  it('new types show in the existing notification center with readable summaries', () => {
    const fake = { id:'n1', user_id:'u', type:'timed_comment_received', category:'battle', summary:'DJ Ace commented at 1:42 in your mix', destination:{ type:'verified_result', verifiedResultId:'vr_1' } };
    const list = Challenges.__test && Challenges.__test.sanitizeNotification;
    const src = fs.readFileSync(path.join(root, 'dj_challenges.js'), 'utf8');
    ['tournament_match_ready', 'battle_chat_message', 'timed_comment_received'].forEach(type => expect(src).to.include(`'${type}'`));
    expect(sql('035_add_social_notification_types.sql')).to.include('timed_comment_received');
    if(list) expect(list(fake, 'u').type).to.equal('timed_comment_received');
  });

  it('a timed comment notifies the mix owner but not the commenter', async () => {
    const db = dataClient({ result_timed_comments:[], dj_progression_profiles:[profile('c', 'Commenter')], dj_blocks:[], dj_notifications:[], dj_notification_mutes:[], mix_submissions:[] });
    const { stableVerifiedResultId } = require('../battle_result_history');
    const resultId = stableVerifiedResultId('sub1');
    db.db.mix_submissions.push({ id:'sub1', user_id:'owner', status:'completed' });
    const resolver = async () => ({ result:{ verifiedResultId:resultId } });
    const out = await TimedComments.addTimedComment(db, 'c', resultId, { body:'that transition', atSeconds:102 }, new Date(), { resolver });
    expect(out.created).to.equal(true);
    expect(notifs(db, 'owner', 'timed_comment_received')).to.have.length(1);
    expect(notifs(db, 'owner')[0].summary).to.include('1:42');
    await TimedComments.addTimedComment(db, 'owner', resultId, { body:'thanks', atSeconds:5 }, new Date(), { resolver });
    expect(notifs(db, 'owner')).to.have.length(1);
  });
});

describe('Oct 19b: battle chat unsend', () => {
  beforeEach(resetRateLimits);
  it('lets a DJ unsend only their own message, and it disappears for both', async () => {
    const db = dataClient({ battle_entries:[{ battle_id:'b1', user_id:'a', status:'active' }, { battle_id:'b1', user_id:'b', status:'active' }], dj_progression_profiles:[], dj_blocks:[], battle_chat_messages:[] });
    const sent = await BattleChat.postBattleChat(db, 'a', 'b1', { body:'oops' });
    expect((await BattleChat.unsendBattleChat(db, 'b', 'b1', sent.message.id)).forbidden).to.equal(true);
    expect((await BattleChat.unsendBattleChat(db, 'a', 'other', sent.message.id)).notFound).to.equal(true);
    expect((await BattleChat.unsendBattleChat(db, 'a', 'b1', sent.message.id)).unsent).to.equal(true);
    expect((await BattleChat.listBattleChat(db, 'b', 'b1')).messages).to.have.length(0);
    expect((await BattleChat.unsendBattleChat(db, 'a', 'b1', sent.message.id)).notFound).to.equal(true);
  });
});

describe('Oct 19b: tournament wins on profiles', () => {
  beforeEach(resetRateLimits);
  it('records the champion, runner-up and how far everyone got, and lists champions publicly', async () => {
    const { db, id, t0 } = await startedEight(4);
    const late = (h) => new Date(t0.getTime() + h * H);
    await Tournaments.getTournament(db, id, 'h', late(49)); // semis: nobody played, higher seeds go through
    await Tournaments.getTournament(db, id, 'h', late(99)); // final: same
    const t = (await Tournaments.getTournament(db, id, 'h', late(100))).tournament;
    expect(t.status).to.equal('completed');
    expect(t.champion.displayName).to.equal('DJ H');
    const mine = await Tournaments.tournamentHistory(db, 'h');
    expect(mine.wins).to.equal(1);
    expect(mine.tournaments[0]).to.include({ placement:'Champion', champion:true });
    const runner = (await Tournaments.tournamentHistory(db, 'b')).tournaments[0];
    expect(runner.placement).to.equal('Runner-up');
    const semi = (await Tournaments.tournamentHistory(db, 'c')).tournaments[0];
    expect(semi.placement).to.equal('Semifinalist');
    const champs = await Tournaments.tournamentChampions(db);
    expect(champs.champions).to.deep.equal([{ publicProfileId:'dj_h', displayName:'DJ H', wins:1 }]);
    const pub = await Tournaments.publicTournamentHistory(db, 'dj_h');
    expect(pub.wins).to.equal(1);
    expect(JSON.stringify(pub)).to.not.match(/"h"|user_id/);
  });
});
