const fs = require('fs');
const path = require('path');
const { expect } = require('chai');
const { buildTimingAnalysisPayload, buildJudgeBreakdownPayload, buildBeltAttemptBreakdownPayload } = require('../analysis_storage');

const root = path.join(__dirname, '..');
const sql = name => fs.readFileSync(path.join(root, 'sql', name), 'utf8');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');

describe('database write contract', () => {
  const analysis = {
    meta: { duration: 120 },
    rawMeasurements: [{ diffMs: -20 }, { diffMs: 40 }],
    components: { timing: 90 },
    overallScore: 88,
    recommendations: ['Keep practicing']
  };

  it('uses timing_analysis events and meta columns for telemetry output', () => {
    const payload = buildTimingAnalysisPayload({ userId: 'user-1', battleId: 'battle-1', source: 'test', groupKey: 'group-1', analysis });
    expect(Object.keys(payload).sort()).to.deep.equal(['battle_id', 'duration', 'events', 'meta', 'recorded_at', 'user_id']);
    expect(payload.events).to.equal(analysis.rawMeasurements);
    expect(payload.meta.summary.avgTimingMs).to.equal(30);
    expect(sql('005_create_timing_analysis.sql')).to.include('events jsonb');
  });

  it('uses judge_breakdowns per_event and meta columns for all judge output', () => {
    const payload = buildJudgeBreakdownPayload({ userId: 'user-1', battleId: 'battle-1', source: 'test', analysis });
    expect(Object.keys(payload).sort()).to.deep.equal(['battle_id', 'duration', 'meta', 'per_event', 'recorded_at', 'user_id']);
    expect(payload.per_event).to.equal(analysis.rawMeasurements);
    expect(payload.meta.analysis).to.deep.include({ components: analysis.components, overall_score: 88, recommendations: analysis.recommendations });
    expect(sql('006_create_judge_breakdowns.sql')).to.include('per_event jsonb');
    ['index.js', 'process_telemetry.js', 'grade_belt_tests.js'].forEach(file => {
      expect(source(file)).to.include('buildJudgeBreakdownPayload');
    });
  });

  it('defines belt columns already written by the API and grading worker', () => {
    const beltsSql = sql('004_create_belts.sql');
    expect(beltsSql).to.include('test_type text');
    expect(beltsSql).to.include('user_id text');
    expect(beltsSql).to.include('passing_score numeric');
    expect(source('index.js')).to.include("test_type: 'belt_exam'");
    expect(source('grade_belt_tests.js')).to.include('passing_score: test.passing_score');
  });

  it('stores belt attempt judge output inside the breakdown jsonb column', () => {
    const payload = buildBeltAttemptBreakdownPayload({ source: 'test', context: { sessionId: 'session-1' }, analysis });
    expect(Object.keys(payload).sort()).to.deep.equal(['analysis', 'per_event', 'sessionId', 'source']);
    expect(payload.per_event).to.equal(analysis.rawMeasurements);
    expect(payload.analysis).to.deep.include({ components: analysis.components, overall_score: 88, recommendations: analysis.recommendations });
    expect(sql('004_create_belts.sql')).to.include("breakdown jsonb DEFAULT '{}'::jsonb");
    expect(source('grade_belt_tests.js')).to.include('breakdown: buildBeltAttemptBreakdownPayload');
    expect(source('grade_belt_tests.js')).to.not.include('breakdown: { raw:');
  });
});
