const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const {
  canTransitionSubmissionStatus,
  normalizeJudgeResult,
  getSubmissionJudgingResult
} = require('../battle_submission');

const root = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'sql', '011_submission_judging_results.sql'), 'utf8');

function submission(overrides={}){
  return {
    id:'sub-1',
    battle_entry_id:'entry-1',
    user_id:'user-1',
    status:'uploaded',
    processing_info:{},
    judge_result:{ overallScore:88, components:{ timing:92 }, rawMeasurements:[{ diffMs:12 }], recommendations:['Keep phrasing tight.'] },
    ...overrides
  };
}

function database(initialRow){
  let row = { ...initialRow };
  const updates = [];
  return {
    updates,
    get row(){ return row; },
    from(table){
      expect(table).to.equal('mix_submissions');
      return {
        values:null,
        select(){ return this; },
        eq(){ return this; },
        limit(){ return this; },
        update(values){ this.values = values; updates.push(values); return this; },
        async single(){
          if(this.values) row = { ...row, ...this.values };
          return { data: row, error:null };
        }
      };
    }
  };
}

describe('submission judging-result contract', () => {
  it('allows uploaded to judging to completed without reopening completed submissions', () => {
    expect(canTransitionSubmissionStatus('uploaded', 'judging')).to.equal(true);
    expect(canTransitionSubmissionStatus('judging', 'completed')).to.equal(true);
    expect(canTransitionSubmissionStatus('completed', 'judging')).to.equal(false);
  });

  it('normalizes score, timing, breakdown, recommendations, and reward metadata', () => {
    const result = normalizeJudgeResult({
      overallScore: 91,
      components: { timing: 94 },
      rawMeasurements: [{ diffMs: -18 }],
      recommendations: ['Cleaner gain staging'],
      reward: { type:'bitcoin', metadata:{ amountSats:2500, custody:'external_pending' } },
      won: true
    });
    expect(result.score).to.equal(91);
    expect(result.breakdown).to.deep.equal({ timing: 94 });
    expect(result.timing).to.deep.equal([{ diffMs: -18 }]);
    expect(result.reward.metadata.custody).to.equal('external_pending');
    expect(result.won).to.equal(true);
  });

  it('advances an owned uploaded submission through judging to completed when judge evidence exists', async () => {
    const db = database(submission());
    const result = await getSubmissionJudgingResult(db, 'user-1', 'sub-1', new Date('2026-01-01T00:00:00Z'));
    expect(result.completed).to.equal(true);
    expect(result.status).to.equal('completed');
    expect(result.judgeResult.score).to.equal(88);
    expect(db.updates.map(update => update.status)).to.deep.equal(['judging', 'completed']);
    expect(db.row.status).to.equal('completed');
    expect(db.row.judge_result.score).to.equal(88);
  });

  it('returns pending without fabricating a result when judge evidence is unavailable', async () => {
    const db = database(submission({ judge_result:{} }));
    const result = await getSubmissionJudgingResult(db, 'user-1', 'sub-1');
    expect(result.completed).to.equal(false);
    expect(result.status).to.equal('uploaded');
    expect(result.judgeResult).to.equal(null);
    expect(db.updates).to.deep.equal([]);
  });

  it('is idempotent after completion and blocks foreign submissions', async () => {
    const completedDb = database(submission({ status:'completed' }));
    const completed = await getSubmissionJudgingResult(completedDb, 'user-1', 'sub-1');
    expect(completed.duplicate).to.equal(true);
    expect(completedDb.updates).to.deep.equal([]);

    const foreign = await getSubmissionJudgingResult(database(submission({ user_id:'user-2' })), 'user-1', 'sub-1');
    expect(foreign.forbidden).to.equal(true);
  });

  it('exposes an authenticated judging-result endpoint and keeps Bitcoin custody external', () => {
    expect(serverSource).to.include("app.get('/api/mixSubmissions/:submissionId/judgingResult', requireAuth");
    expect(serverSource).to.include('getSubmissionJudgingResult(supabaseService, req.authUser.id, submissionId)');
    expect(sql).to.include("'judging'");
    expect(sql).to.include("OLD.status = 'uploaded' AND NEW.status IN ('queued', 'judging', 'failed')");
    expect(sql).to.include("OLD.status = 'judging' AND NEW.status IN ('completed', 'failed')");
    expect(sql).to.include('no wallet or custody actions');
  });
});
