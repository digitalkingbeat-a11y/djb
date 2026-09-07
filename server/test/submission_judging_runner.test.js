const { expect } = require('chai');
const {
  createSubmissionJudgingRunner,
  isSubmissionJudgeRunnerEnabled,
  parseSubmissionJudgeRunnerConfig,
  validateSubmissionJudgeRunnerConfig,
  sanitizeError
} = require('../submission_judging_runner');

describe('submission judging runner', () => {
  it('stays disabled by default and does not schedule work', async () => {
    let scheduled = 0;
    const runner = createSubmissionJudgingRunner({
      setTimeout(){ scheduled += 1; return null; }
    });
    expect(runner.status().enabled).to.equal(false);
    runner.start();
    expect(scheduled).to.equal(0);
    const result = await runner.runNow();
    expect(result).to.deep.equal({ skipped:true, reason:'disabled' });
  });

  it('parses explicit enablement and bounded timing configuration', () => {
    expect(isSubmissionJudgeRunnerEnabled({ SUBMISSION_JUDGE_WORKER_ENABLED:'true' })).to.equal(true);
    expect(isSubmissionJudgeRunnerEnabled({ SUBMISSION_JUDGE_WORKER_ENABLED:'0' })).to.equal(false);
    const config = parseSubmissionJudgeRunnerConfig({
      SUBMISSION_JUDGE_INTERVAL_MS:'500',
      SUBMISSION_JUDGE_BACKOFF_BASE_MS:'250',
      SUBMISSION_JUDGE_MAX_BACKOFF_MS:'3000',
      SUBMISSION_JUDGE_STALE_MS:'120000'
    });
    expect(config).to.deep.equal({ intervalMs:500, backoffBaseMs:250, maxBackoffMs:3000, staleJudgingMs:120000 });
  });

  it('validates deployment readiness without exposing secret values', () => {
    const disabled = validateSubmissionJudgeRunnerConfig({}, {
      supabaseServiceConfigured:false,
      ffmpegCapability:{ available:false, reason:'not_found' }
    });
    expect(disabled.ready).to.equal(false);
    expect(disabled.disabledReason).to.equal('worker_enablement');
    expect(JSON.stringify(disabled)).to.not.include('SUPABASE_SERVICE_KEY');

    const ready = validateSubmissionJudgeRunnerConfig({
      SUBMISSION_JUDGE_WORKER_ENABLED:'true',
      SUPABASE_URL:'https://example.invalid',
      SUPABASE_SERVICE_KEY:'never-return-this',
      SUBMISSION_JUDGE_INTERVAL_MS:'1000',
      SUBMISSION_JUDGE_STALE_MS:'60000',
      SUBMISSION_JUDGE_BACKOFF_BASE_MS:'500',
      SUBMISSION_JUDGE_MAX_BACKOFF_MS:'5000'
    }, {
      supabaseServiceConfigured:true,
      ffmpegCapability:{ available:true, source:'bundled' }
    });
    expect(ready.ready).to.equal(true);
    expect(ready.checks.find(check => check.id === 'ffmpeg_availability').source).to.equal('bundled');
    expect(JSON.stringify(ready)).to.not.include('never-return-this');

    const invalidTiming = validateSubmissionJudgeRunnerConfig({
      SUBMISSION_JUDGE_WORKER_ENABLED:'true',
      SUBMISSION_JUDGE_INTERVAL_MS:'5'
    }, {
      supabaseServiceConfigured:true,
      ffmpegCapability:{ available:true, source:'path' }
    });
    expect(invalidTiming.ready).to.equal(false);
    expect(invalidTiming.disabledReason).to.equal('submission_judge_interval_ms');
    expect(invalidTiming.settings.intervalMs).to.equal(10000);
  });

  it('prevents overlapping runs and counts processed submissions', async () => {
    let resolveRun;
    const runner = createSubmissionJudgingRunner({
      enabled:true,
      recoverStale: async () => ({ completed:0 }),
      runOnce: () => new Promise(resolve => { resolveRun = resolve; })
    });

    const first = runner.runNow();
    const second = await runner.runNow();
    expect(second).to.deep.equal({ skipped:true, reason:'active' });
    resolveRun({ processed:true, completed:true });
    const result = await first;
    expect(result.processedCount).to.equal(1);
    expect(runner.status().submissionsProcessed).to.equal(1);
    expect(runner.status().overlapsPrevented).to.equal(1);
  });

  it('backs off after failures, sanitizes status errors, and resets after success', async () => {
    let attempts = 0;
    const runner = createSubmissionJudgingRunner({
      enabled:true,
      intervalMs:500,
      backoffBaseMs:1000,
      maxBackoffMs:2500,
      recoverStale: async () => ({ completed:0 }),
      logger:{ warn(){} },
      runOnce: async () => {
        attempts += 1;
        if(attempts < 3){
          throw Object.assign(new Error('failed at C:\\private\\secret.txt service_key=abc private/battle-entries/entry/sub/mix.webm'), { code:'WORKER_FAILED' });
        }
        return { processed:true };
      }
    });

    await runner.runNow();
    expect(runner.status().consecutiveFailures).to.equal(1);
    expect(runner.status().nextDelayMs).to.equal(1000);
    expect(runner.status().lastFailure.message).to.not.include('secret.txt');
    expect(runner.status().lastFailure.message).to.not.include('abc');

    await runner.runNow();
    expect(runner.status().consecutiveFailures).to.equal(2);
    expect(runner.status().nextDelayMs).to.equal(2000);

    await runner.runNow();
    expect(runner.status().consecutiveFailures).to.equal(0);
    expect(runner.status().nextDelayMs).to.equal(500);
    expect(runner.status().submissionsProcessed).to.equal(1);
  });

  it('starts on a timer and stops gracefully without leaking private state', async () => {
    let cleared = false;
    const timer = { unref(){} };
    const runner = createSubmissionJudgingRunner({
      enabled:true,
      configuredEnabled:true,
      intervalMs:750,
      setTimeout(fn, delay){
        expect(delay).to.equal(0);
        return timer;
      },
      clearTimeout(value){
        expect(value).to.equal(timer);
        cleared = true;
      },
      recoverStale: async () => ({ completed:0 }),
      runOnce: async () => ({ processed:false })
    });

    runner.start();
    expect(runner.status().enabled).to.equal(true);
    expect(runner.status().startedAt).to.be.a('string');
    expect(runner.status().nextScheduledRunAt).to.be.a('string');
    expect(runner.status()).to.not.have.property('storage');
    expect(runner.status()).to.not.have.property('credentials');
    await runner.stop();
    expect(cleared).to.equal(true);
    expect(runner.status().stoppedAt).to.be.a('string');
  });

  it('redacts paths, storage object names and key-like values from errors', () => {
    const error = sanitizeError(new Error('read F:\\tmp\\mix.webm token=abcdef private/battle-entries/entry-1/submissions/sub-1/mix.webm'));
    expect(error.message).to.include('[redacted-path]');
    expect(error.message).to.include('[redacted-storage-object]');
    expect(error.message).to.include('token=[redacted]');
  });
});
