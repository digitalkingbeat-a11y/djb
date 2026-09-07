const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const {
  createProtectedWriteSafety,
  getProtectedWriteLimits,
  validateBattleEntryPayload,
  validateBattleResultPayload,
  validateBeltAttemptPayload,
  validateBeltCodePayload,
  validateDraftSubmissionPayload,
  validateJudgeBreakdownPayload,
  validateRouteIdentifier,
  validateSubmitScorePayload
} = require('../protected_write_safety');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

function response(){
  return {
    statusCode: null,
    body: null,
    status(code){ this.statusCode = code; return this; },
    json(body){ this.body = body; return this; }
  };
}

function request({ userId = 'user-1', ip = '127.0.0.1', headers = {}, body = {} } = {}){
  return {
    authUser: { id: userId },
    authUserId: userId,
    ip,
    headers,
    body,
    get(name){ return headers[name] || headers[name.toLowerCase()]; }
  };
}

describe('protected write safety contract', () => {
  it('parses configurable abuse-prevention limits with safe defaults', () => {
    const defaults = getProtectedWriteLimits({});
    expect(defaults).to.deep.equal({
      rateLimitWindowMs: 60000,
      rateLimitMax: 30,
      idempotencyReplayTtlMs: 600000,
      idempotencyKeyMaxLength: 128
    });
    expect(getProtectedWriteLimits({
      SERVER_WRITE_RATE_LIMIT_WINDOW_MS: '5000',
      SERVER_WRITE_RATE_LIMIT_MAX: '2',
      SERVER_IDEMPOTENCY_REPLAY_TTL_MS: '9000',
      SERVER_IDEMPOTENCY_KEY_MAX_LENGTH: '64'
    })).to.deep.equal({
      rateLimitWindowMs: 5000,
      rateLimitMax: 2,
      idempotencyReplayTtlMs: 9000,
      idempotencyKeyMaxLength: 64
    });
  });

  it('rejects malformed payloads and unsafe identifiers before writes', () => {
    expect(validateSubmitScorePayload(null).status).to.equal(400);
    expect(validateSubmitScorePayload({ score: 90 }).status).to.equal(400);
    expect(validateBattleEntryPayload({ battleId: '../battle-1' }).status).to.equal(422);
    expect(validateRouteIdentifier('../submission-1', 'submissionId').status).to.equal(422);
    expect(validateDraftSubmissionPayload({ originalFilename: 'mix.webm', declaredMimeType: 'audio/webm' }, { uploadedAudioBytes: 100 }).status).to.equal(400);
  });

  it('rejects out-of-range scores and upload metadata sizes', () => {
    expect(validateSubmitScorePayload({ djName: 'DJ', score: 181 }).status).to.equal(422);
    expect(validateBeltAttemptPayload({ testId: 'test-1', score: 101 }).status).to.equal(422);
    expect(validateBattleResultPayload({ winnerUserId: 'user-1', results: [{ userId: 'user-1', aiScore: 181 }] }).status).to.equal(422);
    expect(validateDraftSubmissionPayload({ originalFilename: 'mix.webm', declaredMimeType: 'audio/webm', fileSize: 101 }, { uploadedAudioBytes: 100 }).status).to.equal(422);
  });

  it('requires an explicit and valid mix submission source', () => {
    expect(validateDraftSubmissionPayload({ originalFilename: 'mix.webm', declaredMimeType: 'audio/webm', fileSize: 10 }, { uploadedAudioBytes: 100 }).status).to.equal(400);
    expect(validateDraftSubmissionPayload({ originalFilename: 'mix.webm', declaredMimeType: 'audio/webm', fileSize: 10, submissionSource: 'client_reported' }, { uploadedAudioBytes: 100 }).status).to.equal(422);
    expect(validateDraftSubmissionPayload({ originalFilename: 'mix.webm', declaredMimeType: 'audio/webm', fileSize: 10, submissionSource: 'uploaded_mix' }, { uploadedAudioBytes: 100 }).value.submissionSource).to.equal('uploaded_mix');
    expect(validateDraftSubmissionPayload({ originalFilename: 'mix.webm', declaredMimeType: 'audio/webm', fileSize: 10, submissionSource: 'battle_studio' }, { uploadedAudioBytes: 100 }).value.submissionSource).to.equal('battle_studio');
  });

  it('rejects invalid enum values for battle types, genres, and belts', () => {
    expect(validateSubmitScorePayload({ djName: 'DJ', battleType: 'Dance-Off', genre: 'Hip-Hop', score: 90 }).status).to.equal(422);
    expect(validateSubmitScorePayload({ djName: 'DJ', battleType: 'Practice', genre: 'Polka', score: 90 }).status).to.equal(422);
    expect(validateBeltCodePayload({ beltCode: 'gold' }, ['white', 'yellow']).status).to.equal(422);
  });

  it('normalizes valid score, belt, judge, and draft-submission payloads', () => {
    const score = validateSubmitScorePayload({ djName: ' Digital King ', battleType: 'Ahh / Fresh Scratch Battle', genre: 'hip-hop', score: '90.5' });
    expect(score.value).to.deep.equal({ djName: 'Digital King', battleType: 'Ahh/Fresh Scratch Battle', genre: 'Hip-Hop', score: 90.5 });

    const belt = validateBeltCodePayload({ beltCode: 'YELLOW' }, ['white', 'yellow']);
    expect(belt.value.beltCode).to.equal('yellow');

    const draft = validateDraftSubmissionPayload({ originalFilename: 'Mix.WebM', declaredMimeType: 'audio/webm; codecs=opus', fileSize: '12', duration: '3.5', submissionSource: 'uploaded_mix' }, { uploadedAudioBytes: 100 });
    expect(draft.value).to.deep.equal({ originalFilename: 'Mix.WebM', declaredMimeType: 'audio/webm', fileSize: 12, duration: 3.5, submissionSource: 'uploaded_mix', battleContext: {} });

    const studioDraft = validateDraftSubmissionPayload({ originalFilename: 'Mix.WebM', declaredMimeType: 'audio/webm', fileSize: '12', submissionSource: 'battle_studio' }, { uploadedAudioBytes: 100 });
    expect(studioDraft.value.submissionSource).to.equal('battle_studio');

    const bitcoinDraft = validateDraftSubmissionPayload({
      originalFilename: 'Mix.WebM',
      declaredMimeType: 'audio/webm',
      fileSize: '12',
      submissionSource: 'uploaded_mix',
      battleContext: { modeId:'bitcoin_battle', reward:{ type:'bitcoin', metadata:{ amountSats:'2500', custody:'external_pending', walletConnected:false } } }
    }, { uploadedAudioBytes: 100 });
    expect(bitcoinDraft.value.battleContext.reward).to.deep.equal({ type:'bitcoin', metadata:{ custody:'external_pending', walletConnected:false, amountSats:2500 } });

    const judge = validateJudgeBreakdownPayload({ battleId: 'battle-1', analysis: { overallScore: '88', perEvent: [{ diffMs: -20 }], components: { timing: 90 }, recommendations: [' Keep cleaner phrasing '], meta: { duration: '60' } } });
    expect(judge.value.analysis.overallScore).to.equal(88);
    expect(judge.value.analysis.rawMeasurements).to.deep.equal([{ diffMs: -20 }]);
    expect(judge.value.analysis.recommendations).to.deep.equal(['Keep cleaner phrasing']);
    expect(judge.value.analysis.meta.duration).to.equal(60);
  });

  it('rejects duplicate idempotency keys with a 409 response', () => {
    const safety = createProtectedWriteSafety({
      limits: { rateLimitWindowMs: 60000, rateLimitMax: 10, idempotencyReplayTtlMs: 600000, idempotencyKeyMaxLength: 32 },
      now: () => 1000
    });
    const req = request({ headers: { 'idempotency-key': 'score-1' }, body: { score: 90 } });
    expect(safety.guard(req, response(), 'submitScore', { payload: req.body })).to.equal(true);

    const replay = response();
    expect(safety.guard(req, replay, 'submitScore', { payload: req.body })).to.equal(false);
    expect(replay.statusCode).to.equal(409);
    expect(replay.body.error).to.equal('Duplicate submission');
  });

  it('blocks same-user same-route body replays even without an explicit idempotency key', () => {
    const safety = createProtectedWriteSafety({
      limits: { rateLimitWindowMs: 60000, rateLimitMax: 10, idempotencyReplayTtlMs: 600000, idempotencyKeyMaxLength: 32 },
      now: () => 1000
    });
    const req = request({ body: { djName: 'DJ', score: 90 } });
    expect(safety.guard(req, response(), 'submitScore', { payload: req.body })).to.equal(true);

    const duplicate = response();
    expect(safety.guard(req, duplicate, 'submitScore', { payload: req.body })).to.equal(false);
    expect(duplicate.statusCode).to.equal(409);
  });

  it('enforces configurable per-user/IP rate limits with a 429 response', () => {
    const safety = createProtectedWriteSafety({
      limits: { rateLimitWindowMs: 60000, rateLimitMax: 2, idempotencyReplayTtlMs: 600000, idempotencyKeyMaxLength: 32 },
      now: () => 1000
    });
    const req = request({ body: { battleId: 'battle-1' } });
    expect(safety.guard(req, response(), 'battleEntries', { payload: { battleId: 'battle-1' }, fingerprintReplay: false })).to.equal(true);
    expect(safety.guard(req, response(), 'battleEntries', { payload: { battleId: 'battle-2' }, fingerprintReplay: false })).to.equal(true);

    const limited = response();
    expect(safety.guard(req, limited, 'battleEntries', { payload: { battleId: 'battle-3' }, fingerprintReplay: false })).to.equal(false);
    expect(limited.statusCode).to.equal(429);
    expect(limited.body.error).to.equal('Too many requests');
  });

  it('wires validation and abuse guards into protected write routes only', () => {
    [
      'validateSubmitScorePayload(req.body)',
      'validateBattleResultPayload(req.body)',
      'validateBattleEntryPayload(req.body)',
      'validateDraftSubmissionPayload(req.body, LIMITS)',
      'validateBeltCodePayload(req.body',
      'validateBeltAttemptPayload(req.body)',
      'validateJudgeBreakdownPayload(body)'
    ].forEach(snippet => expect(serverSource).to.include(snippet));

    [
      'submitScore',
      'submitBattleResult',
      'battleEntries',
      'battleEntrySubmission',
      'uploadAuthorization',
      'completeUpload',
      'requestBeltTest',
      'generateBeltTest',
      'submitBeltAttempt',
      'submitJudgeBreakdown'
    ].forEach(routeKey => expect(serverSource).to.include(`guardProtectedWrite(req, res, '${routeKey}'`));
  });
});
