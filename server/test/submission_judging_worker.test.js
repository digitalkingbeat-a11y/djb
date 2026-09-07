const { expect } = require('chai');
const {
  buildJudgeResult,
  claimNextStaleJudgingSubmission,
  claimUploadedSubmission,
  eventsFromMeasuredTransitions,
  markSubmissionAnalysisFailed,
  recoverStaleJudgingSubmissions,
  runOnce
} = require('../submission_judging_worker');

function submission(overrides = {}){
  return {
    id:'sub-1',
    battle_entry_id:'entry-1',
    user_id:'user-1',
    status:'uploaded',
    storage_object_path:'private/battle-entries/entry-1/submissions/sub-1/mix.webm',
    processing_info:{
      battleContext:{
        battleId:'battle-1',
        modeId:'bitcoin_battle',
        genre:'Open Format',
        reward:{ type:'bitcoin', metadata:{ amountSats:2500, custody:'external_pending', walletConnected:false } }
      }
    },
    judge_result:{},
    ...overrides
  };
}

function fakeDataClient(rows){
  const state = rows.map(row => ({ ...row, processing_info:{ ...(row.processing_info || {}) }, judge_result:{ ...(row.judge_result || {}) } }));
  const calls = [];
  function filtered(filters){
    return state.filter(row => filters.every(filter => String(row[filter.field]) === String(filter.value)));
  }
  return {
    calls,
    rows: state,
    from(table){
      expect(table).to.equal('mix_submissions');
      const query = {
        filters: [],
        values: null,
        _limit: null,
        select(){ return this; },
        order(){ return this; },
        limit(value){ this._limit = value; return this; },
        eq(field, value){ this.filters.push({ field, value }); return this; },
        update(values){ this.values = values; calls.push({ type:'update', values }); return this; },
        async single(){
          const row = filtered(this.filters)[0] || null;
          if(!row) return { data:null, error:null };
          if(this.values) Object.assign(row, this.values);
          return { data: row, error:null };
        },
        then(resolve, reject){
          const rows = filtered(this.filters);
          const data = this._limit == null ? rows : rows.slice(0, this._limit);
          return Promise.resolve({ data, error:null }).then(resolve, reject);
        }
      };
      return query;
    }
  };
}

const analyzer = {
  async analyzeSessionAudio({ events }){
    if(!events.length){
      return { perEvent:[], session:{ durationSec:64, bpm:128, transitions:[16, 32], harmonic:{ key:{ name:'A minor', camelot:'8A' } }, onsets:[0, 0.469], beatTimes:[0, 0.469], loudnessMetrics:{ available:true } } };
    }
    return {
      perEvent: events.map((event, index) => ({ index, timingOffsetMs:null, measuredActualSec:event.actualSec, transition:{ available:true, abruptness:0.12 } })),
      session:{ durationSec:64, bpm:128, transitions:[16, 32], harmonic:{ key:{ name:'A minor', camelot:'8A' } }, onsets:[0, 0.469, 0.938], beatTimes:[0, 0.469, 0.938], loudnessMetrics:{ available:true } }
    };
  }
};

const judge = {
  analyzePerformance(events, options){
    return {
      meta:{ analyzedAt: options.analyzedAt, audioEvidence:{ available:true, transitionCount:2, onsetCount:3, beatGridCount:3 } },
      rawMeasurements: events.map((event, index) => ({ index, actualSec:event.actualSec })),
      components:{ transition_quality:88, harmonic_compatibility:84 },
      componentDetails:{
        transition_quality:{ available:true, score:88, measurements:{ averageAbruptness:0.12 } },
        harmonic_compatibility:{ available:true, score:84, measurements:{ transitions:[] } },
        timing:{ available:false, score:null, reason:'no_timing_targets' }
      },
      overallScore:86,
      timeline:events.map(event => ({ label:event.label, timeMs:event.actualSec * 1000 })),
      recommendations:['Keep transitions controlled.']
    };
  }
};

describe('submission judging worker', () => {
  it('safely claims only uploaded submissions for judging', async () => {
    const db = fakeDataClient([submission()]);
    const claim = await claimUploadedSubmission(db, db.rows[0], { workerId:'worker-1', now:new Date('2026-01-01T00:00:00Z') });
    expect(claim.claimed).to.equal(true);
    expect(claim.submission.status).to.equal('judging');
    expect(claim.submission.processing_info.judging_worker_id).to.equal('worker-1');

    const duplicate = await claimUploadedSubmission(db, claim.submission, { workerId:'worker-2' });
    expect(duplicate.invalidState).to.equal(true);
  });

  it('uses measured transitions as scoring events without fabricating timing targets', () => {
    const events = eventsFromMeasuredTransitions({ session:{ transitions:[12.5, 24] } });
    expect(events).to.deep.equal([
      { label:'Measured Transition 1', actualSec:12.5, event:'measured_transition' },
      { label:'Measured Transition 2', actualSec:24, event:'measured_transition' }
    ]);
    expect(events[0]).to.not.have.property('idealSec');
  });

  it('builds a normalized measurable rule-based judge result with Bitcoin metadata preserved', () => {
    const sub = submission({ status:'judging' });
    const context = sub.processing_info.battleContext;
    const result = buildJudgeResult({
      submission: sub,
      battleContext: context,
      events:[{ label:'Measured Transition 1', actualSec:16 }],
      audioAnalysis:{ session:{ durationSec:64, bpm:128, transitions:[16], harmonic:{ key:{ name:'A minor' } } } },
      analysis: judge.analyzePerformance([{ label:'Measured Transition 1', actualSec:16 }], { analyzedAt:'2026-01-01T00:00:00Z', audioAnalysis:{} }),
      now:new Date('2026-01-01T00:00:00Z')
    });
    expect(result.score).to.equal(86);
    expect(result.evidenceType).to.equal('measurable_audio_rule_based');
    expect(result.scoringModel.trainedModelJudging).to.equal('not_used');
    expect(result.reward.type).to.equal('bitcoin');
    expect(result.reward.metadata.custody).to.equal('external_pending');
    expect(result.confidence.trainedModelJudging.used).to.equal(false);
  });

  it('processes an uploaded submission through judging result and completion contract', async () => {
    const db = fakeDataClient([submission()]);
    const storage = { async download(path){ expect(path).to.equal('private/battle-entries/entry-1/submissions/sub-1/mix.webm'); return { data:Buffer.from('fake-webm-bytes'), error:null }; } };
    const result = await runOnce({
      dataClient: db,
      storage,
      analyzer,
      judge,
      workerId:'worker-1',
      now:new Date('2026-01-01T00:00:00Z')
    });
    expect(result.processed).to.equal(true);
    expect(result.completed).to.equal(true);
    expect(db.rows[0].status).to.equal('completed');
    expect(db.rows[0].judge_result.score).to.equal(86);
    expect(db.rows[0].judge_result.measurableAnalysis.transitionCount).to.equal(2);
    expect(db.rows[0].judge_result.reward.metadata.amountSats).to.equal(2500);
    expect(db.calls.map(call => call.values.status).filter(Boolean)).to.deep.equal(['judging', 'completed']);
  });

  it('records retryable failure state when analysis cannot complete', async () => {
    const db = fakeDataClient([submission({ status:'judging' })]);
    const failed = await markSubmissionAnalysisFailed(db, db.rows[0], Object.assign(new Error('FFmpeg audio extraction unavailable'), { code:'FFMPEG_EXTRACT_FAILED' }), { now:new Date('2026-01-01T00:00:00Z') });
    expect(failed.failed).to.equal(true);
    expect(db.rows[0].status).to.equal('failed');
    expect(db.rows[0].processing_info.judging_retryable).to.equal(true);
    expect(db.rows[0].processing_error).to.match(/FFmpeg audio extraction unavailable/);
  });

  it('completes stale judging submissions that already have stored judge evidence', async () => {
    const db = fakeDataClient([submission({
      status:'judging',
      processing_info:{
        battleContext:{ battleId:'battle-1', reward:{ type:'bitcoin', metadata:{ amountSats:2500, custody:'external_pending' } } },
        judging_claimed_at:'2026-01-01T00:00:00.000Z'
      },
      judge_result:{ score:91, components:{ timing:91 }, reward:{ type:'bitcoin', metadata:{ amountSats:2500, custody:'external_pending' } } }
    })]);

    const result = await recoverStaleJudgingSubmissions(db, {
      now:new Date('2026-01-01T00:20:00.000Z'),
      staleMs:5 * 60 * 1000
    });

    expect(result.completed).to.equal(1);
    expect(db.rows[0].status).to.equal('completed');
    expect(db.rows[0].judge_result.reward.metadata.custody).to.equal('external_pending');
    expect(db.calls.map(call => call.values.status).filter(Boolean)).to.deep.equal(['completed']);
  });

  it('reclaims stale judging submissions without rewinding their lifecycle state', async () => {
    const db = fakeDataClient([submission({
      status:'judging',
      processing_info:{
        battleContext:{ battleId:'battle-1' },
        judging_claimed_at:'2026-01-01T00:00:00.000Z',
        judging_attempts:1
      },
      judge_result:{}
    })]);

    const claim = await claimNextStaleJudgingSubmission(db, {
      workerId:'worker-2',
      now:new Date('2026-01-01T00:20:00.000Z'),
      staleMs:5 * 60 * 1000
    });

    expect(claim.claimed).to.equal(true);
    expect(claim.recovered).to.equal(true);
    expect(db.rows[0].status).to.equal('judging');
    expect(db.rows[0].processing_info.judging_worker_id).to.equal('worker-2');
    expect(db.rows[0].processing_info.judging_attempts).to.equal(2);
    expect(db.rows[0].processing_info.judging_recovered_at).to.equal('2026-01-01T00:20:00.000Z');
  });

  it('does not reclaim fresh judging submissions', async () => {
    const db = fakeDataClient([submission({
      status:'judging',
      processing_info:{ judging_claimed_at:'2026-01-01T00:19:00.000Z' },
      judge_result:{}
    })]);

    const claim = await claimNextStaleJudgingSubmission(db, {
      workerId:'worker-2',
      now:new Date('2026-01-01T00:20:00.000Z'),
      staleMs:5 * 60 * 1000
    });

    expect(claim.claimed).to.equal(false);
    expect(claim.reason).to.equal('no_stale_judging_submission');
    expect(db.rows[0].processing_info.judging_worker_id).to.equal(undefined);
  });
});
