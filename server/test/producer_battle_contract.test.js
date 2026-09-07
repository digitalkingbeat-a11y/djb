const { expect } = require('chai');
const BattleModes = require('../../battle_modes');
const Judge = require('../judge_engine');
const {
  disciplineForBattleContext,
  runOnce
} = require('../submission_judging_worker');
const {
  buildPublicRankings,
  resultRankingCategories,
  sanitizeBattleResult,
  stableVerifiedResultId
} = require('../battle_result_history');
const { applyResolvedBattleAwards } = require('../battle_award_ledger');
const { listPublicLeaderboards } = require('../battle_leaderboards');

function producerAudioAnalysis(overrides = {}){
  return {
    perEvent:[],
    session:{
      durationSec:96,
      bpm:92,
      onsets:Array.from({ length:260 }, (_, index) => index * 0.36),
      beatTimes:Array.from({ length:148 }, (_, index) => index * (60 / 92)),
      transitions:[],
      drift:{ tempoDriftBpm:0.2, startBpm:92, endBpm:92.2 },
      phrase:{ available:true, phraseLengthBeats:16, phraseLengthBars:4 },
      loudnessMetrics:{
        available:true,
        integratedLoudnessDb:-14.5,
        shortTermAverageDb:-15,
        shortTermRangeDb:7,
        peakLevelDb:-1.1,
        crestFactorDb:13.4,
        clipping:{ sampleCount:0, durationSec:0, ranges:[] },
        gainJumps:{ count:0, maxJumpDb:0, ranges:[] },
        silence:{ totalDurationSec:0, maxDurationSec:0, ranges:[] },
        overLimited:false,
        quiet:false
      },
      frequencyBalance:{
        available:true,
        windowCount:24,
        lowShare:0.32,
        midShare:0.45,
        highShare:0.23,
        lowMidRatioDb:-1.4,
        highMidRatioDb:-2.9,
        hollowMidPenalty:0,
        harshHighPenalty:0,
        bassHeavyPenalty:0,
        balancePenalty:0
      },
      harmonic:{
        available:true,
        key:{ name:'C minor', camelot:'5A' },
        confidence:0.72
      },
      ...overrides
    }
  };
}

function submission(overrides = {}){
  return {
    id:'sub-producer',
    battle_entry_id:'entry-producer',
    user_id:'producer-1',
    status:'uploaded',
    storage_object_path:'private/battle-entries/entry-producer/submissions/sub-producer/beat.webm',
    processing_info:{
      battleContext:{
        battleId:'battle-producer',
        modeId:'open_beat_battle',
        type:'Open Beat Battle',
        genre:'Hip-Hop'
      }
    },
    judge_result:{},
    ...overrides
  };
}

function fakeSubmissionClient(rows){
  const state = rows.map(row => ({ ...row, processing_info:{ ...(row.processing_info || {}) }, judge_result:{ ...(row.judge_result || {}) } }));
  const calls = [];
  function filtered(filters){
    return state.filter(row => filters.every(filter => String(row[filter.field]) === String(filter.value)));
  }
  return {
    calls,
    rows:state,
    from(table){
      expect(table).to.equal('mix_submissions');
      const query = {
        filters:[],
        values:null,
        limitValue:null,
        select(){ return this; },
        order(){ return this; },
        limit(value){ this.limitValue = Number(value); return this; },
        eq(field, value){ this.filters.push({ field, value }); return this; },
        update(values){ this.values = values; calls.push({ type:'update', values }); return this; },
        async single(){
          const row = filtered(this.filters)[0] || null;
          if(!row) return { data:null, error:null };
          if(this.values) Object.assign(row, this.values);
          return { data:row, error:null };
        },
        then(resolve, reject){
          const rows = filtered(this.filters);
          const data = this.limitValue == null ? rows : rows.slice(0, this.limitValue);
          return Promise.resolve({ data, error:null }).then(resolve, reject);
        }
      };
      return query;
    }
  };
}

function resultSubmission(overrides = {}){
  return {
    id:'sub-result-producer',
    battle_entry_id:'entry-result-producer',
    user_id:'producer-1',
    status:'completed',
    processing_info:{
      result_visibility:'public',
      verified_result_id:stableVerifiedResultId('sub-result-producer'),
      battleContext:{
        battleId:'battle-result-producer',
        modeId:'remix_challenge_battle',
        type:'Remix Challenge Beat Battle',
        genre:'Open Format'
      },
      battleResultSummary:{
        visibility:'public',
        verifiedResultId:stableVerifiedResultId('sub-result-producer'),
        title:'Producer Remix Finals',
        modeId:'remix_challenge_battle',
        type:'Remix Challenge Beat Battle',
        genre:'Open Format',
        outcome:'win',
        opponent:{ status:'opponent', name:'Rival Producer', country:'GB' },
        profile:{ displayName:'Beat Maker', country:'US' },
        progressAfter:{ belt:'Yellow' },
        completedAt:'2026-09-01T12:00:00.000Z'
      }
    },
    judge_result:{
      score:91,
      overallScore:91,
      battleDiscipline:'producer',
      evidenceType:'measurable_audio_rule_based_producer',
      scoringModel:{ measurableAnalysis:'ffmpeg_audio_analyzer', ruleBasedScoring:'producer_beat_judge_engine', trainedModelJudging:'not_used' },
      components:{ composition:90, drums_rhythm:92, mix_quality:91 },
      breakdown:{ composition:{ available:true, score:90 } },
      reward:{ type:'standard', metadata:{} }
    },
    updated_at:'2026-09-01T12:00:00.000Z',
    created_at:'2026-09-01T11:58:00.000Z',
    ...overrides
  };
}

describe('producer beat battle contract', () => {
  it('defines producer battle modes without changing DJ battle semantics', () => {
    const producerModes = BattleModes.listBattleModes().filter(mode => mode.discipline === 'producer');
    expect(producerModes.map(mode => mode.id)).to.include.members([
      'open_beat_battle',
      'sample_flip_battle',
      'genre_challenge_beat_battle',
      'bpm_challenge_beat_battle',
      'timed_beat_challenge_battle',
      'drum_challenge_battle',
      'remix_challenge_battle'
    ]);
    producerModes.forEach(mode => {
      expect(mode.trackSelectionMethod).to.equal('open_library');
      expect(mode.judgingCriteria).to.deep.equal(BattleModes.PRODUCER_JUDGING_CRITERIA);
    });

    const producer = BattleModes.createBattleRecord({ modeId:'sample_flip_battle', genre:'Hip-Hop', title:'Flip This' }, { requireAssignedTracks:false });
    const dj = BattleModes.createBattleRecord({ modeId:'transition_battle', genre:'Bass House', assignedTracks:['A','B'] }, { requireAssignedTracks:false });

    expect(producer.battle).to.deep.include({ discipline:'producer', trackSelectionMethod:'open_library' });
    expect(BattleModes.buildBattleRules(producer.battle).discipline).to.equal('producer');
    expect(dj.battle).to.deep.include({ discipline:'dj', trackSelectionMethod:'assigned' });
  });

  it('scores producer beats from whole-file audio evidence without DJ transition scoring', () => {
    const result = Judge.analyzeProducerBeat([], {
      audioAnalysis:producerAudioAnalysis(),
      battleContext:{ modeId:'bpm_challenge_beat_battle', targetBpm:92 },
      analyzedAt:'2026-09-01T12:00:00.000Z'
    });

    expect(result.meta.discipline).to.equal('producer');
    expect(result.meta.audioEvidence.transitionCount).to.equal(0);
    expect(result.overallScore).to.be.within(0, 100);
    expect(result.components).to.have.keys(BattleModes.PRODUCER_JUDGING_CRITERIA);
    expect(result.components).to.not.have.property('transition_quality');
    expect(result.components.challenge_compliance).to.equal(100);
    expect(result.components.creativity).to.equal(null);

    const missing = Judge.analyzeProducerBeat([], { analyzedAt:'2026-09-01T12:00:00.000Z' });
    expect(missing.overallScore).to.equal(null);
    expect(missing.componentDetails.mix_quality.reason).to.equal('insufficient_mix_quality_evidence');
  });

  it('dispatches producer submissions to the producer judge without requiring measured transitions', async () => {
    const db = fakeSubmissionClient([submission()]);
    const analyzerCalls = [];
    const analyzer = {
      async analyzeSessionAudio({ events }){
        analyzerCalls.push(events.length);
        return producerAudioAnalysis({ transitions:[] });
      }
    };
    const judge = {
      analyzePerformance(){
        throw new Error('DJ judging path should not score producer beats');
      },
      analyzeProducerBeat(events, options){
        expect(events).to.deep.equal([]);
        expect(options.battleContext.modeId).to.equal('open_beat_battle');
        return Judge.analyzeProducerBeat(events, options);
      }
    };
    const storage = {
      async download(storagePath){
        expect(storagePath).to.equal('private/battle-entries/entry-producer/submissions/sub-producer/beat.webm');
        return { data:Buffer.from('fake-producer-beat'), error:null };
      }
    };

    const result = await runOnce({
      dataClient:db,
      storage,
      analyzer,
      judge,
      workerId:'producer-worker',
      now:new Date('2026-09-01T12:00:00.000Z')
    });

    expect(disciplineForBattleContext({ modeId:'open_beat_battle' })).to.equal('producer');
    expect(analyzerCalls).to.deep.equal([0]);
    expect(result.completed).to.equal(true);
    expect(result.judgeResult.battleDiscipline).to.equal('producer');
    expect(result.judgeResult.evidenceType).to.equal('measurable_audio_rule_based_producer');
    expect(result.judgeResult.scoringModel.ruleBasedScoring).to.equal('producer_beat_judge_engine');
    expect(result.judgeResult.measurableAnalysis.transitionCount).to.equal(0);
  });

  it('stores producer results in producer categories without DJ mix-category leakage', () => {
    const result = sanitizeBattleResult(resultSubmission(), { publicView:true });
    const categories = resultRankingCategories(result);
    const rankings = buildPublicRankings([result]);

    expect(result.battle).to.deep.include({ modeId:'remix_challenge_battle', discipline:'producer' });
    expect(categories).to.include.members(['competitive_battles', 'producer_beat_battles']);
    expect(categories).to.not.include('mix_battles');
    expect(rankings.categories.producer_beat_battles.rows).to.have.length(1);
    expect(rankings.categories.producer_beat_battles.rows[0].djName).to.equal('Beat Maker');
  });

  it('records producer award-ledger categories for authoritative leaderboards', async () => {
    const client = ledgerClient(seedLedgerData());
    const applied = await applyResolvedBattleAwards(
      client,
      battleRow({ mode_id:'remix_challenge_battle', title:'Producer Remix Finals' }),
      resolution(),
      new Date('2026-09-01T12:00:00.000Z')
    );
    const categories = client.db.battle_progression_awards[0].categories;
    const leaderboard = await listPublicLeaderboards(client, { category:'producer_beat_battles', limit:10 });

    expect(applied.resolution.awardState.status).to.equal('applied');
    expect(categories).to.include.members(['competitive_battles', 'producer_beat_battles']);
    expect(categories).to.not.include('mix_battles');
    expect(client.db.battle_ranking_snapshots.map(row => row.category)).to.include('producer_beat_battles');
    expect(leaderboard.category).to.equal('producer_beat_battles');
    expect(leaderboard.rows).to.have.length(2);
  });
});

function battleRow(overrides = {}){
  return {
    id:'battle-producer-ledger',
    mode_id:'open_beat_battle',
    title:'Producer Ledger Battle',
    genre:'Hip-Hop',
    duration_minutes:60,
    opponent_requirement:'required',
    reward_type:'standard',
    reward:{ type:'standard', metadata:{} },
    ...overrides
  };
}

function participant(overrides = {}){
  return {
    entryId:'entry-ledger-1',
    userId:'producer-1',
    submissionId:'sub-ledger-1',
    profile:{ name:'Beat Maker', country:'US', belt:'Green' },
    outcome:'winner',
    won:true,
    score:94,
    award:{ id:overrides.awardId || `award-${overrides.entryId || 'entry-ledger-1'}` },
    ...overrides
  };
}

function resolution(overrides = {}){
  return {
    id:'resolution-producer',
    battleId:'battle-producer-ledger',
    status:'resolved',
    outcome:'winner',
    version:1,
    participants:[
      participant(),
      participant({ entryId:'entry-ledger-2', userId:'producer-2', submissionId:'sub-ledger-2', outcome:'loser', won:false, score:88, awardId:'award-entry-ledger-2', profile:{ name:'Rival Producer', country:'GB', belt:'Orange' } })
    ],
    ...overrides
  };
}

function profile(overrides = {}){
  const userId = overrides.user_id || 'producer-1';
  const displayName = userId === 'producer-2' ? 'Rival Producer' : 'Beat Maker';
  const country = overrides.country || (userId === 'producer-2' ? 'GB' : 'US');
  return {
    user_id:userId,
    xp:500,
    rating:1700,
    ranking_rating:1700,
    belt:'Green',
    wins:1,
    losses:0,
    ties:0,
    completed_battles:1,
    country,
    visibility:'public',
    public_profile_id:`dj_${userId.replace(/[^a-z0-9]/gi, '')}`,
    public_profile:{ publicProfileId:`dj_${userId.replace(/[^a-z0-9]/gi, '')}`, displayName, country, belt:'Green', visibility:'public' },
    updated_at:'2026-09-01T11:00:00.000Z',
    ...overrides
  };
}

function seedLedgerData(overrides = {}){
  return {
    battle_records:[],
    battle_progression_awards:[],
    battle_ranking_snapshots:[],
    public_leaderboard_snapshots:[],
    mix_submissions:[],
    dj_follows:[],
    dj_blocks:[],
    dj_progression_profiles:[
      profile({ user_id:'producer-1', country:'US' }),
      profile({ user_id:'producer-2', country:'GB' })
    ],
    ...overrides
  };
}

function ledgerClient(initial){
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
  }
  select(){ return this; }
  eq(field, value){ this.filters.push([field, value]); return this; }
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
      const rows = this.insertRows.map(row => ({ ...row }));
      this.db[this.table].push(...rows);
      return { data:rows, error:null };
    }
    let rows = this.db[this.table].filter(row => this.filters.every(([field, value]) => String(row[field]) === String(value)));
    if(this.updateValues){
      rows.forEach(row => Object.assign(row, this.updateValues));
      return { data:rows.slice(0, this.limitValue || rows.length), error:null };
    }
    if(this.limitValue != null) rows = rows.slice(0, this.limitValue);
    return { data:rows, error:null };
  }
}
