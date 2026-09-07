const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const {
  buildBattleRoomState,
  resolveBattleIfReady,
  verifyBattleEntrySubmissionIntegrity
} = require('../battle_prep_snapshots');

const root = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'sql', '014_create_battle_prep_entry_snapshots.sql'), 'utf8');

describe('server-backed competitive battle resolution', () => {
  it('resolves completed competitive judging once and persists private result summaries', async () => {
    const client = dataClient(seedData());
    const first = await resolveBattleIfReady(client, 'battle-resolution', {}, new Date('2026-08-26T13:00:00.000Z'));
    expect(first.resolved).to.equal(true);
    expect(client.db.battle_records[0].status).to.equal('completed');
    expect(client.db.battle_records[0].resolution_status).to.equal('resolved');
    expect(first.resolution.outcome).to.equal('winner');
    expect(first.resolution.participants.map(row => row.outcome)).to.deep.equal(['winner', 'loser']);
    expect(first.resolution.awardIds).to.have.length(2);
    expect(first.resolution.awardIds[0]).to.match(/^award_/);

    const ownSummary = client.db.mix_submissions.find(row => row.id === 'sub-creator').processing_info.battleResultSummary;
    expect(ownSummary.outcome).to.equal('win');
    expect(ownSummary.visibility).to.equal('private');
    expect(ownSummary.battle.resolutionId).to.equal(first.resolution.id);
    expect(ownSummary.progression.awardSource).to.equal('server_progression_award_ledger');
    expect(ownSummary.progression.status).to.equal('applied');

    const duplicate = await resolveBattleIfReady(client, 'battle-resolution', {}, new Date('2026-08-26T13:01:00.000Z'));
    expect(duplicate.duplicate).to.equal(true);
    expect(duplicate.resolution.awardIds).to.deep.equal(first.resolution.awardIds);
    expect(client.db.battle_records[0].resolution_version).to.equal(first.resolution.version);
  });

  it('hides scores until every required completed judging result is available, then reveals sanitized summaries', async () => {
    const client = dataClient(seedData({
      mix_submissions:[
        submission({ id:'sub-creator', battle_entry_id:'entry-creator', user_id:'dj-1', status:'completed', judge_result:judgeResult(92, ['Private self advice']) }),
        submission({ id:'sub-rival', battle_entry_id:'entry-rival', user_id:'dj-2', status:'uploaded', judge_result:null })
      ]
    }));

    const pending = await buildBattleRoomState(client, 'dj-1', 'battle-resolution', {}, new Date('2026-08-26T12:40:00.000Z'));
    expect(pending.state.resolution.resolved).to.equal(false);
    expect(JSON.stringify(pending.state.resolution)).to.not.include('92');
    expect(JSON.stringify(pending.state.resolution)).to.not.include('Private self advice');

    client.db.mix_submissions[1] = submission({ id:'sub-rival', battle_entry_id:'entry-rival', user_id:'dj-2', status:'completed', judge_result:judgeResult(89, ['Private rival advice']), processing_info:{ battleContext:{ battleId:'battle-resolution', battleEntryId:'entry-rival', battlePrepSnapshotId:'snap-rival', battlePrepSnapshotVersion:'snap-v2' } } });
    const resolved = await buildBattleRoomState(client, 'dj-1', 'battle-resolution', {}, new Date('2026-08-26T13:00:00.000Z'));
    expect(resolved.state.resolution.resolved).to.equal(true);
    expect(resolved.state.resolution.self.score).to.equal(92);
    expect(resolved.state.resolution.participants.find(row => !row.self).score).to.equal(89);
    expect(JSON.stringify(resolved.state)).to.not.include('dj-2');
    expect(JSON.stringify(resolved.state)).to.not.include('Private rival advice');
    expect(JSON.stringify(resolved.state)).to.not.include('private/library-audio');
  });

  it('handles deterministic ties without dropping component evidence', async () => {
    const client = dataClient(seedData({
      mix_submissions:[
        submission({ id:'sub-creator', battle_entry_id:'entry-creator', user_id:'dj-1', status:'completed', judge_result:judgeResult(90) }),
        submission({ id:'sub-rival', battle_entry_id:'entry-rival', user_id:'dj-2', status:'completed', judge_result:judgeResult(90), processing_info:{ battleContext:{ battleId:'battle-resolution', battleEntryId:'entry-rival', battlePrepSnapshotId:'snap-rival', battlePrepSnapshotVersion:'snap-v2' } } })
      ]
    }));
    const resolved = await resolveBattleIfReady(client, 'battle-resolution', {}, new Date('2026-08-26T13:00:00.000Z'));
    expect(resolved.resolution.outcome).to.equal('tie');
    expect(resolved.resolution.scoreDifference).to.equal(0);
    expect(resolved.resolution.participants.every(row => row.outcome === 'tie')).to.equal(true);
    expect(resolved.resolution.participants[0].breakdown.timing.score).to.equal(90);
  });

  it('rejects submissions for foreign, cancelled and mismatched snapshot entries', async () => {
    const client = dataClient(seedData());
    const foreign = await verifyBattleEntrySubmissionIntegrity(client, 'dj-2', 'entry-creator', {});
    expect(foreign.forbidden).to.equal(true);

    const mismatch = await verifyBattleEntrySubmissionIntegrity(client, 'dj-1', 'entry-creator', {
      battleId:'battle-resolution',
      battleEntryId:'entry-creator',
      battlePrepSnapshotId:'snap-other'
    });
    expect(mismatch.validationError).to.match(/snapshot/i);

    client.db.battle_records[0].status = 'cancelled';
    const cancelled = await verifyBattleEntrySubmissionIntegrity(client, 'dj-1', 'entry-creator', {
      battleId:'battle-resolution',
      battleEntryId:'entry-creator',
      battlePrepSnapshotId:'snap-creator'
    });
    expect(cancelled.conflict).to.equal(true);
  });

  it('exposes protected resolution contracts and local migration constraints without wallet actions', () => {
    expect(serverSource).to.include("app.post('/api/battles/:battleId/resolve', requireAuth");
    expect(serverSource).to.include('resolveBattleIfReady(supabaseService');
    expect(serverSource).to.include('verifyBattleEntrySubmissionIntegrity(supabaseService');
    expect(sql).to.include('resolution_status');
    expect(sql).to.include('battle_resolution_awards');
    expect(sql).to.include('UNIQUE (resolution_id, user_id)');
    expect(sql).to.include('does not store audio files, artwork');
    expect(sql).to.not.match(/CREATE TABLE .*wallet|payout_status|deposit_address/i);
  });
});

function judgeResult(score, recommendations = ['Keep phrasing tight.']){
  return {
    overallScore:score,
    components:{ timing:score, transition_quality:score - 2 },
    breakdown:{
      timing:{ available:true, score },
      transition_quality:{ available:true, score:score - 2 }
    },
    timing:[{ label:'Transition 1', diffMs:12 }],
    rawMeasurements:[{ diffMs:12 }],
    measurableAnalysis:{ bpm:124, key:{ name:'A minor' }, transitionCount:1 },
    confidence:{ measurableComponentRatio:0.8, trainedModelJudging:{ used:false } },
    recommendations,
    scoringModel:{ ruleBasedScoring:'judge_engine' },
    evidenceType:'measurable_audio_rule_based'
  };
}

function battleRecord(overrides = {}){
  return {
    id:'battle-resolution',
    created_by:'dj-1',
    mode_id:'own_selection_battle',
    title:'Resolution Battle',
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
    start_conditions:{ startsWhenFull:true },
    public_creator_profile:{ name:'Creator', country:'US', belt:'Blue' },
    reward_type:'bitcoin',
    reward:{ type:'bitcoin', metadata:{ network:'bitcoin', amountSats:2500, custody:'external_pending' } },
    bitcoin_reward_metadata:{ network:'bitcoin', amountSats:2500, custody:'external_pending' },
    battle_version:3,
    created_at:'2026-08-26T11:00:00.000Z',
    updated_at:'2026-08-26T12:30:00.000Z',
    ...overrides
  };
}

function entry(overrides = {}){
  return {
    id:'entry-creator',
    battle_id:'battle-resolution',
    user_id:'dj-1',
    status:'submitted',
    battle_prep_snapshot_id:'snap-creator',
    public_profile:{ name:'Creator', country:'US', belt:'Blue', storage:'private/library-audio/hidden.wav' },
    created_at:'2026-08-26T11:01:00.000Z',
    updated_at:'2026-08-26T12:00:00.000Z',
    ...overrides
  };
}

function snapshot(overrides = {}){
  return {
    id:'snap-creator',
    battle_id:'battle-resolution',
    battle_entry_id:'entry-creator',
    user_id:'dj-1',
    crate_id:'crate-a',
    crate_version:'v1',
    snapshot_version:'snap-v1',
    purpose:'own_selection',
    track_selection_method:'own_selection',
    replacement_allowed:true,
    tracks:[{ libraryTrackId:'track-1', order:0, bpm:124, key:'A minor', camelotKey:'8A', genre:'Open Format', duration:180, status:'ready' }],
    rule_decisions:{ ready:true, blockers:[], warnings:[] },
    availability:{ status:'available' },
    replacements:[],
    created_at:'2026-08-26T11:02:00.000Z',
    updated_at:'2026-08-26T11:02:00.000Z',
    ...overrides
  };
}

function submission(overrides = {}){
  return {
    id:'sub-creator',
    battle_entry_id:'entry-creator',
    user_id:'dj-1',
    status:'completed',
    judge_result:judgeResult(92),
    processing_info:{
      battleContext:{
        battleId:'battle-resolution',
        battleEntryId:'entry-creator',
        battlePrepSnapshotId:'snap-creator',
        battlePrepSnapshotVersion:'snap-v1'
      }
    },
    created_at:'2026-08-26T12:20:00.000Z',
    updated_at:'2026-08-26T12:50:00.000Z',
    completed_at:'2026-08-26T12:50:00.000Z',
    ...overrides
  };
}

function seedData(overrides = {}){
  return {
    battle_records:[battleRecord()],
    battle_entries:[
      entry(),
      entry({ id:'entry-rival', user_id:'dj-2', battle_prep_snapshot_id:'snap-rival', public_profile:{ name:'Rival', country:'GB', belt:'Green', email:'hidden@example.com' } })
    ],
    battle_prep_entry_snapshots:[
      snapshot(),
      snapshot({ id:'snap-rival', battle_entry_id:'entry-rival', user_id:'dj-2', crate_id:'crate-b', snapshot_version:'snap-v2', tracks:[{ libraryTrackId:'secret-track', order:0, bpm:126, key:'C minor', camelotKey:'5A', genre:'Open Format', duration:180, status:'ready' }] })
    ],
    battle_prep_snapshot_replacements:[],
    mix_submissions:[
      submission(),
      submission({ id:'sub-rival', battle_entry_id:'entry-rival', user_id:'dj-2', judge_result:judgeResult(84), processing_info:{ battleContext:{ battleId:'battle-resolution', battleEntryId:'entry-rival', battlePrepSnapshotId:'snap-rival', battlePrepSnapshotVersion:'snap-v2' } } })
    ],
    music_library_tracks:[],
    music_library_crates:[],
    music_library_crate_memberships:[],
    ...overrides
  };
}

function dataClient(initial){
  const db = Object.fromEntries(Object.entries(initial).map(([table, rows]) => [table, rows.map(row => ({ ...row }))]));
  return {
    db,
    from(table){
      if(!db[table]) db[table] = [];
      return new Query(db, table);
    }
  };
}

class Query{
  constructor(db, table){
    this.db = db;
    this.table = table;
    this.filters = [];
    this.limitValue = null;
    this.insertRows = null;
    this.updateValues = null;
    this.inFilters = [];
  }
  select(){ return this; }
  eq(field, value){ this.filters.push([field, value]); return this; }
  in(field, values){ this.inFilters.push([field, values.map(value => String(value))]); return this; }
  limit(value){ this.limitValue = Number(value); return this; }
  insert(rows){ this.insertRows = rows.map(row => ({ ...row })); return this; }
  update(values){ this.updateValues = { ...values }; return this; }
  then(resolve, reject){ return this.exec().then(resolve, reject); }
  async single(){
    const result = await this.exec();
    return result.error ? result : { data:(result.data && result.data[0]) || null, error:null };
  }
  async exec(){
    if(this.insertRows){
      const rows = this.insertRows.map(row => ({ id: row.id || `${this.table}-${this.db[this.table].length + 1}`, ...row }));
      this.db[this.table].push(...rows);
      return { data: rows, error:null };
    }
    let rows = this.db[this.table].filter(row => this.filters.every(([field, value]) => String(row[field]) === String(value)));
    rows = rows.filter(row => this.inFilters.every(([field, values]) => values.includes(String(row[field]))));
    if(this.updateValues){
      rows.forEach(row => Object.assign(row, this.updateValues));
      return { data: rows.slice(0, this.limitValue || rows.length), error:null };
    }
    if(this.limitValue != null) rows = rows.slice(0, this.limitValue);
    return { data: rows, error:null };
  }
}
