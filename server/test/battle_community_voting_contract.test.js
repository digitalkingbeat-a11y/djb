const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const {
  buildLockedScoringFormula,
  checkVoteRateLimit,
  fetchVotes,
  lockVotingConfig,
  normalizeVotingConfig,
  prepareCommunityVotingForResolution,
  pruneVoteRateState,
  publicEntryIdFor,
  recordCommunityBattleVote
} = require('../battle_community_voting');
const {
  createBattleWithPrepSnapshot,
  resolveBattleIfReady,
  startBattleIfReady
} = require('../battle_prep_snapshots');

const root = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'sql', '026_create_battle_community_voting.sql'), 'utf8');
const startedAt = new Date('2026-09-06T12:00:00.000Z');

describe('public battle community voting contract', () => {
  it('normalizes voting only from explicit voting fields and stores a disabled default on new battles', async () => {
    expect(normalizeVotingConfig({ title:'Unrelated settings object' }).enabled).to.equal(false);
    expect(normalizeVotingConfig({ votingConfig:{ title:'Unrelated nested object' } }).status).to.equal('disabled');

    const client = dataClient(seedData({ battle_records:[], battle_entries:[], battle_prep_entry_snapshots:[] }));
    const created = await createBattleWithPrepSnapshot(client, 'dj-1', {
      battleId:'battle-created',
      modeId:'own_selection_battle',
      title:'No Vote Default',
      genre:'Open Format',
      minimumTrackCount:2,
      crateId:'crate-a',
      idempotencyKey:'create-no-vote',
      isPremium:true
    }, startedAt);

    expect(created.created).to.equal(true);
    expect(client.db.battle_records[0].voting_config.enabled).to.equal(false);
    expect(client.db.battle_records[0].voting_config.status).to.equal('disabled');
    expect(client.db.battle_records[0].locked_scoring_formula).to.equal(null);
  });

  it('locks configured voting windows and scoring formulas when a ready battle starts', async () => {
    const battle = battleRecord({
      status:'ready',
      voting_config:normalizeVotingConfig({
        scoringType:'hybrid',
        votingConfig:{
          enabled:true,
          blindMode:true,
          windowMinutes:45,
          weights:{ judge:0.6, community:0.4 },
          criteria:['Overall']
        }
      }, battleRecord(), startedAt)
    });
    const client = dataClient(seedData({
      battle_records:[battle],
      battle_entries:[
        entry({ id:'entry-a', user_id:'dj-1', status:'ready', submitted_at:null, completed_at:null }),
        entry({ id:'entry-b', user_id:'dj-2', status:'ready', submitted_at:null, completed_at:null })
      ]
    }));

    const result = await startBattleIfReady(client, battle.id, { userId:'dj-1', auto:true }, startedAt);

    expect(result.started).to.equal(true);
    expect(client.db.battle_records[0].voting_config.status).to.equal('locked');
    expect(client.db.battle_records[0].voting_config.window.opensAt).to.equal(startedAt.toISOString());
    expect(client.db.battle_records[0].locked_scoring_formula.weights).to.deep.equal({ judge:0.6, community:0.4 });
    expect(result.battle.voting.scoringFormula.version).to.equal('battle-scoring-formula-v1');
  });

  it('shares blind public battle entries and accepts authenticated nonparticipant votes without leaking profiles', async () => {
    const client = dataClient(seedData());
    const vote = await recordCommunityBattleVote(client, 'viewer-1', 'battle-voting', {
      publicEntryId:publicEntryIdFor('battle-voting', 'entry-a'),
      score:92,
      scores:{ overall:92 },
      idempotencyKey:'vote-1',
      source:'shared_link',
      campaign:'launch'
    }, visitor(), new Date('2026-09-06T12:10:00.000Z'));

    expect(vote.duplicate).to.equal(false);
    expect(vote.vote.score).to.equal(92);
    expect(client.db.battle_community_votes).to.have.length(1);
    expect(client.db.battle_community_vote_audit).to.have.length(1);
    expect(vote.battle.participants.map(row => row.label)).to.deep.equal(['Entry A', 'Entry B']);
    expect(JSON.stringify(vote.battle)).to.not.include('dj-1');
    expect(JSON.stringify(vote.battle)).to.not.include('hidden@example.com');
    expect(vote.battle.voting.acceptsVotes).to.equal(true);

    const participant = await recordCommunityBattleVote(client, 'dj-1', 'battle-voting', {
      publicEntryId:publicEntryIdFor('battle-voting', 'entry-b'),
      score:80
    }, visitor(), new Date('2026-09-06T12:11:00.000Z'));
    expect(participant.forbidden).to.equal(true);
  });

  it('dedupes idempotent vote replays before rate limiting and writes audit before vote mutation', async () => {
    const existingVote = voteRow({
      battle_entry_id:'entry-a',
      public_entry_id:publicEntryIdFor('battle-voting', 'entry-a'),
      voter_user_id:'viewer-1',
      idempotency_key:'same-request',
      normalized_score:88
    });
    const rateState = new Map([
      ['viewer-1:battle-voting', { startedAt:new Date('2026-09-06T12:10:00.000Z').getTime(), count:3 }]
    ]);
    const replayClient = dataClient(seedData({ battle_community_votes:[existingVote] }));
    const replay = await recordCommunityBattleVote(replayClient, 'viewer-1', 'battle-voting', {
      idempotencyKey:'same-request'
    }, visitor(), new Date('2026-09-06T12:10:30.000Z'), { rateState, limits:{ rateMax:1 } });

    expect(replay.duplicate).to.equal(true);
    expect(rateState.get('viewer-1:battle-voting').count).to.equal(3);
    expect(replayClient.db.battle_community_votes).to.have.length(1);
    expect(replayClient.db.battle_community_vote_audit).to.have.length(0);

    const auditFailureClient = dataClient(seedData(), { failAudit:true });
    const failed = await recordCommunityBattleVote(auditFailureClient, 'viewer-2', 'battle-voting', {
      publicEntryId:publicEntryIdFor('battle-voting', 'entry-a'),
      score:77
    }, visitor(), new Date('2026-09-06T12:12:00.000Z'));

    expect(failed.error.message).to.match(/audit failed/i);
    expect(auditFailureClient.db.battle_community_votes).to.have.length(0);
  });

  it('requires pagination-safe vote aggregation beyond the first 1,000 records', async () => {
    const votes = Array.from({ length:1005 }, (_, index) => voteRow({
      id:`vote-${index}`,
      battle_entry_id:index % 2 ? 'entry-b' : 'entry-a',
      public_entry_id:publicEntryIdFor('battle-voting', index % 2 ? 'entry-b' : 'entry-a'),
      voter_user_id:`viewer-${index}`,
      normalized_score:index % 2 ? 60 : 90
    }));
    const pagedClient = dataClient(seedData({ battle_community_votes:votes }));
    const paged = await fetchVotes(pagedClient, 'battle-voting');
    expect(paged.votes).to.have.length(1005);
    expect(pagedClient.state.ranges).to.be.greaterThan(1);

    const unpagedClient = dataClient(seedData({ battle_community_votes:votes.slice(0, 1000) }), { noRange:true });
    const untrusted = await fetchVotes(unpagedClient, 'battle-voting');
    expect(untrusted.error.message).to.match(/pagination-capable/i);
  });

  it('bounds the process-local rate limiter and reports it is not distributed', () => {
    const state = new Map(Array.from({ length:8 }, (_, index) => [
      `viewer-${index}:battle-voting`,
      { startedAt:index + 1, count:1 }
    ]));
    pruneVoteRateState(state, 100, { rateWindowMs:1000, maxRateKeys:3 });
    const result = checkVoteRateLimit('viewer-new', 'battle-voting', new Date('2026-09-06T12:00:00.000Z'), {
      rateWindowMs:1000,
      rateMax:2,
      maxRateKeys:3
    }, state);

    expect(state.size).to.be.at.most(3);
    expect(result.limiter).to.deep.include({ scope:'process_local_bounded', distributed:false, maxKeys:3 });
  });

  it('waits while the voting window is open, applies locked weights after close, and falls back to judge scores below minimum votes', async () => {
    const openClient = dataClient(seedData());
    const open = await resolveBattleIfReady(openClient, 'battle-voting', {}, new Date('2026-09-06T12:10:00.000Z'));
    expect(open.unresolved).to.equal(true);
    expect(open.resolution.status).to.equal('community_voting');

    const closedClient = dataClient(seedData({
      battle_community_votes:[
        voteRow({ battle_entry_id:'entry-a', public_entry_id:publicEntryIdFor('battle-voting', 'entry-a'), voter_user_id:'viewer-1', normalized_score:20 }),
        voteRow({ battle_entry_id:'entry-b', public_entry_id:publicEntryIdFor('battle-voting', 'entry-b'), voter_user_id:'viewer-2', normalized_score:100 })
      ]
    }));
    const resolved = await resolveBattleIfReady(closedClient, 'battle-voting', {}, new Date('2026-09-06T13:01:00.000Z'));
    expect(resolved.resolved).to.equal(true);
    expect(resolved.resolution.scoringRule.weights).to.deep.equal({ judge:0.5, community:0.5 });
    const winner = resolved.resolution.participants.find(row => row.outcome === 'winner');
    expect(winner.entryId).to.equal('entry-b');
    expect(winner.score).to.equal(85);
    expect(winner.judgeScore).to.equal(70);
    expect(winner.communityScore).to.equal(100);
    expect(winner.communityVoting.scoreApplied).to.equal(true);
    expect(closedClient.db.marketplace_orders).to.have.length(0);
    expect(closedClient.db.marketplace_payment_events).to.have.length(0);
    expect(closedClient.db.marketplace_entitlements).to.have.length(0);

    const fallbackClient = dataClient(seedData({
      battle_records:[battleWithVoting({ minimumVotes:2 })],
      battle_community_votes:[
        voteRow({ battle_entry_id:'entry-b', public_entry_id:publicEntryIdFor('battle-voting', 'entry-b'), voter_user_id:'viewer-1', normalized_score:100 })
      ]
    }));
    const fallback = await resolveBattleIfReady(fallbackClient, 'battle-voting', {}, new Date('2026-09-06T13:01:00.000Z'));
    const fallbackWinner = fallback.resolution.participants.find(row => row.outcome === 'winner');
    expect(fallbackWinner.entryId).to.equal('entry-a');
    expect(fallbackWinner.score).to.equal(80);
    expect(fallbackWinner.communityVoting.scoreApplied).to.equal(false);
  });

  it('defines additive schema and public routes without creating commerce or entitlement paths', () => {
    expect(serverSource).to.include("app.get('/api/publicBattles/:battleId', async");
    expect(serverSource).to.include("app.post('/api/publicBattles/:battleId/votes', requireAuth");
    expect(serverSource).to.include('recordCommunityBattleVote');
    expect(serverSource).to.include('supabaseService');
    expect(sql).to.include('ADD COLUMN IF NOT EXISTS voting_config');
    expect(sql).to.include('ADD COLUMN IF NOT EXISTS locked_scoring_formula');
    expect(sql).to.include('CREATE TABLE IF NOT EXISTS public.battle_community_votes');
    expect(sql).to.include('CREATE TABLE IF NOT EXISTS public.battle_community_vote_audit');
    expect(sql).to.include('UNIQUE (battle_id, voter_user_id)');
    expect(sql).to.include("CHECK (voter_fingerprint ~ '^[a-f0-9]{64}$')");
    expect(sql).to.include('provider transactions');
    expect(sql).to.not.match(/CREATE TABLE .*marketplace_order|CREATE TABLE .*payment|CREATE TABLE .*settlement|CREATE TABLE .*payout|marketplace_entitlements/i);
  });
});

function battleRecord(overrides = {}){
  return {
    id:'battle-voting',
    created_by:'dj-1',
    mode_id:'own_selection_battle',
    title:'Public Voting Battle',
    genre:'Open Format',
    duration_minutes:20,
    track_selection_method:'own_selection',
    track_count:null,
    minimum_track_count:1,
    opponent_requirement:'required',
    capacity:2,
    visibility:'public',
    status:'judging',
    scoring_type:'hybrid',
    voting_config:{ enabled:false, status:'disabled' },
    locked_scoring_formula:null,
    start_conditions:{ startsWhenFull:true },
    public_creator_profile:{ name:'Creator', country:'US', belt:'Blue' },
    reward_type:'standard',
    reward:{ type:'standard', metadata:{} },
    battle_version:3,
    created_at:'2026-09-06T11:00:00.000Z',
    updated_at:'2026-09-06T12:00:00.000Z',
    ...overrides
  };
}

function battleWithVoting(configOverrides = {}, battleOverrides = {}){
  const battle = battleRecord(battleOverrides);
  const config = lockVotingConfig(normalizeVotingConfig({
    scoringType:'hybrid',
    votingConfig:{
      enabled:true,
      blindMode:true,
      windowMinutes:30,
      minimumVotes:1,
      weights:{ judge:0.5, community:0.5 },
      criteria:['Overall'],
      ...configOverrides
    }
  }, battle, startedAt), battle, startedAt);
  return {
    ...battle,
    voting_config:config,
    locked_scoring_formula:buildLockedScoringFormula(config, battle, startedAt)
  };
}

function entry(overrides = {}){
  return {
    id:'entry-a',
    battle_id:'battle-voting',
    user_id:'dj-1',
    status:'completed',
    battle_prep_snapshot_id:'snap-a',
    public_profile:{ name:'Creator', country:'US', belt:'Blue', email:'hidden@example.com', user_id:'dj-1' },
    created_at:'2026-09-06T11:01:00.000Z',
    updated_at:'2026-09-06T12:50:00.000Z',
    ...overrides
  };
}

function submission(overrides = {}){
  return {
    id:'sub-a',
    battle_entry_id:'entry-a',
    user_id:'dj-1',
    status:'completed',
    judge_result:judgeResult(80),
    processing_info:{
      battleContext:{
        battleId:'battle-voting',
        battleEntryId:'entry-a',
        battlePrepSnapshotId:'snap-a',
        battlePrepSnapshotVersion:'snap-v1'
      }
    },
    created_at:'2026-09-06T12:20:00.000Z',
    updated_at:'2026-09-06T12:50:00.000Z',
    completed_at:'2026-09-06T12:50:00.000Z',
    ...overrides
  };
}

function judgeResult(score){
  return {
    score,
    overallScore:score,
    components:{ timing:score },
    breakdown:{ timing:{ available:true, score } },
    timing:[{ label:'Transition 1', diffMs:12 }],
    rawMeasurements:[{ diffMs:12 }],
    measurableAnalysis:{ transitionCount:1 },
    scoringModel:{ ruleBasedScoring:'judge_engine' },
    evidenceType:'measurable_audio_rule_based',
    recommendations:[]
  };
}

function voteRow(overrides = {}){
  return {
    id:'vote-existing',
    battle_id:'battle-voting',
    battle_entry_id:'entry-a',
    public_entry_id:publicEntryIdFor('battle-voting', 'entry-a'),
    voter_user_id:'viewer-existing',
    voter_fingerprint:'a'.repeat(64),
    normalized_score:88,
    criteria_scores:{},
    source:'public_battle_vote',
    status:'active',
    active:true,
    idempotency_key:'idem-existing',
    vote_version:1,
    created_at:'2026-09-06T12:05:00.000Z',
    updated_at:'2026-09-06T12:05:00.000Z',
    ...overrides
  };
}

function visitor(){
  return {
    visitorId:'visitor-1',
    userAgent:'Mocha',
    acceptLanguage:'en-US',
    ip:'127.0.0.1'
  };
}

function seedData(overrides = {}){
  return {
    battle_records:[battleWithVoting()],
    battle_entries:[
      entry(),
      entry({
        id:'entry-b',
        user_id:'dj-2',
        battle_prep_snapshot_id:'snap-b',
        public_profile:{ name:'Rival', country:'GB', belt:'Green', email:'hidden@example.com', user_id:'dj-2' }
      })
    ],
    battle_prep_entry_snapshots:[
      snapshot({ id:'snap-a', battle_entry_id:'entry-a', user_id:'dj-1' }),
      snapshot({ id:'snap-b', battle_entry_id:'entry-b', user_id:'dj-2' })
    ],
    battle_prep_snapshot_replacements:[],
    mix_submissions:[
      submission(),
      submission({
        id:'sub-b',
        battle_entry_id:'entry-b',
        user_id:'dj-2',
        judge_result:judgeResult(70),
        processing_info:{ battleContext:{ battleId:'battle-voting', battleEntryId:'entry-b', battlePrepSnapshotId:'snap-b', battlePrepSnapshotVersion:'snap-v1' } }
      })
    ],
    music_library_tracks:[
      { id:'track-1', user_id:'dj-1', title:'Track A', bpm:124, key:'A minor', camelot_key:'8A', genre:'Open Format', duration:180, rights_classification:'original', audio_storage_object_path:'private/library-audio/dj-1/a.wav' },
      { id:'track-2', user_id:'dj-1', title:'Track B', bpm:126, key:'C minor', camelot_key:'5A', genre:'Open Format', duration:180, rights_classification:'original', audio_storage_object_path:'private/library-audio/dj-1/b.wav' }
    ],
    music_library_crates:[{ id:'crate-a', user_id:'dj-1', type:'battle_prep', updated_at:'crate-v1' }],
    music_library_crate_memberships:[
      { id:'member-1', user_id:'dj-1', crate_id:'crate-a', track_id:'track-1', position:0 },
      { id:'member-2', user_id:'dj-1', crate_id:'crate-a', track_id:'track-2', position:1 }
    ],
    battle_community_votes:[],
    battle_community_vote_audit:[],
    battle_progression_awards:[],
    dj_progression_profiles:[],
    battle_ranking_snapshots:[],
    marketplace_orders:[],
    marketplace_payment_events:[],
    marketplace_entitlements:[],
    marketplace_seller_settlements:[],
    marketplace_seller_payouts:[],
    ...overrides
  };
}

function snapshot(overrides = {}){
  return {
    id:'snap-a',
    battle_id:'battle-voting',
    battle_entry_id:'entry-a',
    user_id:'dj-1',
    crate_id:'crate-a',
    crate_version:'crate-v1',
    snapshot_version:'snap-v1',
    purpose:'own_selection',
    track_selection_method:'own_selection',
    replacement_allowed:true,
    tracks:[{ libraryTrackId:'track-1', order:0, bpm:124, key:'A minor', camelotKey:'8A', genre:'Open Format', duration:180, status:'ready' }],
    rule_decisions:{ ready:true, blockers:[], warnings:[] },
    availability:{ status:'available' },
    replacements:[],
    created_at:'2026-09-06T11:02:00.000Z',
    updated_at:'2026-09-06T11:02:00.000Z',
    ...overrides
  };
}

function dataClient(initial, options = {}){
  const db = Object.fromEntries(Object.entries(initial).map(([table, rows]) => [table, rows.map(clone)]));
  const state = { ranges:0 };
  return {
    db,
    state,
    from(table){
      if(!db[table]) db[table] = [];
      const query = new Query(db, table, options, state);
      if(options.noRange) query.range = undefined;
      return query;
    }
  };
}

class Query{
  constructor(db, table, options, state){
    this.db = db;
    this.table = table;
    this.options = options || {};
    this.state = state;
    this.filters = [];
    this.inFilters = [];
    this.limitValue = null;
    this.rangeValue = null;
    this.insertRows = null;
    this.updateValues = null;
  }
  select(){ return this; }
  eq(field, value){ this.filters.push([field, value]); return this; }
  in(field, values){ this.inFilters.push([field, values.map(value => String(value))]); return this; }
  limit(value){ this.limitValue = Number(value); return this; }
  range(from, to){ this.rangeValue = [Number(from), Number(to)]; this.state.ranges += 1; return this; }
  insert(rows){ this.insertRows = rows.map(clone); return this; }
  update(values){ this.updateValues = clone(values); return this; }
  then(resolve, reject){ return this.exec().then(resolve, reject); }
  async single(){
    const result = await this.exec();
    if(result.error) return result;
    return { data:Array.isArray(result.data) ? result.data[0] || null : result.data, error:null };
  }
  async exec(){
    if(this.options.failAudit && this.table === 'battle_community_vote_audit' && this.insertRows){
      return { data:null, error:new Error('audit failed before vote write') };
    }
    if(this.insertRows){
      const rows = this.insertRows.map(row => ({ id:row.id || `${this.table}-${this.db[this.table].length + 1}`, ...row }));
      this.db[this.table].push(...rows.map(clone));
      return { data:rows.map(clone), error:null };
    }
    let rows = this.db[this.table].filter(row => this.filters.every(([field, value]) => String(row[field]) === String(value)));
    rows = rows.filter(row => this.inFilters.every(([field, values]) => values.includes(String(row[field]))));
    if(this.updateValues){
      rows.forEach(row => Object.assign(row, clone(this.updateValues)));
      return { data:rows.slice(0, this.limitValue || rows.length).map(clone), error:null };
    }
    if(this.rangeValue){
      rows = rows.slice(this.rangeValue[0], this.rangeValue[1] + 1);
    }else if(this.limitValue != null){
      rows = rows.slice(0, this.limitValue);
    }
    return { data:rows.map(clone), error:null };
  }
}

function clone(value){
  return JSON.parse(JSON.stringify(value));
}
