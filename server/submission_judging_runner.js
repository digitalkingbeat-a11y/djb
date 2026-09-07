const DEFAULT_INTERVAL_MS = 10000;
const DEFAULT_BACKOFF_BASE_MS = 1000;
const DEFAULT_MAX_BACKOFF_MS = 60000;
const DEFAULT_STALE_JUDGING_MS = 15 * 60 * 1000;

function parsePositiveInteger(value, fallback, minimum = 1){
  const parsed = Number(value);
  if(!Number.isFinite(parsed) || parsed < minimum) return fallback;
  return Math.floor(parsed);
}

function isSubmissionJudgeRunnerEnabled(env = process.env){
  const value = String(env.SUBMISSION_JUDGE_WORKER_ENABLED || '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function parseSubmissionJudgeRunnerConfig(env = process.env){
  return {
    intervalMs: parsePositiveInteger(env.SUBMISSION_JUDGE_INTERVAL_MS, DEFAULT_INTERVAL_MS, 250),
    backoffBaseMs: parsePositiveInteger(env.SUBMISSION_JUDGE_BACKOFF_BASE_MS, DEFAULT_BACKOFF_BASE_MS, 100),
    maxBackoffMs: parsePositiveInteger(env.SUBMISSION_JUDGE_MAX_BACKOFF_MS, DEFAULT_MAX_BACKOFF_MS, 1000),
    staleJudgingMs: parsePositiveInteger(env.SUBMISSION_JUDGE_STALE_MS, DEFAULT_STALE_JUDGING_MS, 1000)
  };
}

function numericCheck(env, key, label, minimum, fallback, parsedValue){
  const raw = env[key];
  const hasValue = raw != null && String(raw).trim() !== '';
  const numeric = Number(raw);
  const valid = !hasValue || (Number.isFinite(numeric) && numeric >= minimum);
  return {
    id: key.toLowerCase(),
    label,
    ok: valid,
    status: valid ? 'ok' : 'warning',
    valueMs: parsedValue,
    message: valid
      ? `${label} is ${parsedValue}ms`
      : `${label} must be at least ${minimum}ms; using safe default ${fallback}ms`
  };
}

function validateSubmissionJudgeRunnerConfig(env = process.env, dependencies = {}){
  const parsed = parseSubmissionJudgeRunnerConfig(env);
  const enabledRequested = isSubmissionJudgeRunnerEnabled(env);
  const supabaseServiceConfigured = dependencies.supabaseServiceConfigured == null
    ? Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY)
    : Boolean(dependencies.supabaseServiceConfigured);
  const ffmpegCapability = dependencies.ffmpegCapability || { available:false, source:null, reason:'not_checked' };
  const checks = [
    {
      id: 'worker_enablement',
      label: 'Worker enablement',
      ok: enabledRequested,
      status: enabledRequested ? 'ok' : 'disabled',
      message: enabledRequested ? 'Automatic judging is explicitly enabled' : 'Automatic judging is disabled by default'
    },
    {
      id: 'supabase_service_access',
      label: 'Supabase service access',
      ok: supabaseServiceConfigured,
      status: supabaseServiceConfigured ? 'ok' : 'blocked',
      message: supabaseServiceConfigured ? 'Service client is configured' : 'Service client is not configured'
    },
    {
      id: 'ffmpeg_availability',
      label: 'FFmpeg availability',
      ok: Boolean(ffmpegCapability.available),
      status: ffmpegCapability.available ? 'ok' : 'blocked',
      source: ffmpegCapability.available ? ffmpegCapability.source || null : null,
      reason: ffmpegCapability.available ? null : ffmpegCapability.reason || 'unavailable',
      message: ffmpegCapability.available ? 'FFmpeg is available' : 'FFmpeg is unavailable'
    },
    numericCheck(env, 'SUBMISSION_JUDGE_INTERVAL_MS', 'Polling interval', 250, DEFAULT_INTERVAL_MS, parsed.intervalMs),
    numericCheck(env, 'SUBMISSION_JUDGE_STALE_MS', 'Stale-job recovery window', 1000, DEFAULT_STALE_JUDGING_MS, parsed.staleJudgingMs),
    numericCheck(env, 'SUBMISSION_JUDGE_BACKOFF_BASE_MS', 'Retry backoff base', 100, DEFAULT_BACKOFF_BASE_MS, parsed.backoffBaseMs),
    numericCheck(env, 'SUBMISSION_JUDGE_MAX_BACKOFF_MS', 'Retry backoff maximum', 1000, DEFAULT_MAX_BACKOFF_MS, parsed.maxBackoffMs)
  ];
  const timingsValid = checks.filter(check => check.status === 'warning').length === 0;
  const ready = enabledRequested && supabaseServiceConfigured && Boolean(ffmpegCapability.available) && timingsValid;
  const blocker = checks.find(check => check.status === 'blocked' || check.status === 'warning' || check.status === 'disabled');
  return {
    enabledRequested,
    ready,
    disabledReason: ready ? null : blocker && blocker.id || null,
    settings: parsed,
    checks
  };
}

function isoNow(now){
  return (typeof now === 'function' ? now() : new Date()).toISOString();
}

function dateNow(now){
  const value = typeof now === 'function' ? now() : now;
  return value instanceof Date ? value : new Date();
}

function sanitizeError(error){
  const code = error && error.code ? String(error.code).slice(0, 80) : null;
  const raw = error && error.message ? String(error.message) : String(error || 'Unknown runner failure');
  const message = raw
    .replace(/[A-Za-z]:\\[^\s"'`]+/g, '[redacted-path]')
    .replace(/\/(?:var|tmp|home|users|private)\/[^\s"'`]+/gi, '[redacted-path]')
    .replace(/private\/battle-entries\/[^\s"'`]+/g, '[redacted-storage-object]')
    .replace(/(service[_-]?role|anon|bearer|token|key)=?[^\s"'`]+/gi, '$1=[redacted]')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 500);
  return { message, code };
}

function processedCount(result){
  if(!result || typeof result !== 'object') return 0;
  if(Number.isFinite(Number(result.processedCount))) return Math.max(0, Number(result.processedCount));
  if(result.processed || result.completed || result.failed) return 1;
  return 0;
}

function recoveredCount(result){
  if(!result || typeof result !== 'object') return 0;
  if(Number.isFinite(Number(result.completed))) return Math.max(0, Number(result.completed));
  if(Number.isFinite(Number(result.recovered))) return Math.max(0, Number(result.recovered));
  return 0;
}

function createSubmissionJudgingRunner(options = {}){
  const intervalMs = parsePositiveInteger(options.intervalMs, DEFAULT_INTERVAL_MS, 250);
  const backoffBaseMs = parsePositiveInteger(options.backoffBaseMs, DEFAULT_BACKOFF_BASE_MS, 100);
  const maxBackoffMs = parsePositiveInteger(options.maxBackoffMs, DEFAULT_MAX_BACKOFF_MS, 1000);
  const staleJudgingMs = parsePositiveInteger(options.staleJudgingMs, DEFAULT_STALE_JUDGING_MS, 1000);
  const now = options.now || (() => new Date());
  const setTimeoutFn = options.setTimeout || setTimeout;
  const clearTimeoutFn = options.clearTimeout || clearTimeout;
  const logger = options.logger || console;
  const runOnce = options.runOnce || (async () => ({ processed:false }));
  const recoverStale = options.recoverStale || (async () => ({ completed:0 }));
  const configuration = options.configuration || null;

  let timer = null;
  let stopped = false;
  let activePromise = null;
  const configuredEnabled = options.configuredEnabled == null ? Boolean(options.enabled) : Boolean(options.configuredEnabled);
  const state = {
    configuredEnabled,
    enabled: Boolean(options.enabled),
    disabledReason: options.disabledReason || null,
    active: false,
    currentActivity: null,
    startedAt: null,
    stoppedAt: null,
    lastRunAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailure: null,
    consecutiveFailures: 0,
    nextDelayMs: null,
    nextScheduledRunAt: null,
    runCount: 0,
    submissionsProcessed: 0,
    staleRecoveriesCompleted: 0,
    overlapsPrevented: 0
  };

  function status(){
    return {
      configuredEnabled: state.configuredEnabled,
      enabled: state.enabled,
      disabledReason: state.disabledReason,
      active: state.active,
      currentActivity: state.currentActivity,
      startedAt: state.startedAt,
      stoppedAt: state.stoppedAt,
      lastRunAt: state.lastRunAt,
      lastSuccessAt: state.lastSuccessAt,
      lastFailureAt: state.lastFailureAt,
      lastFailure: state.lastFailure,
      consecutiveFailures: state.consecutiveFailures,
      nextDelayMs: state.nextDelayMs,
      nextScheduledRunAt: state.nextScheduledRunAt,
      runCount: state.runCount,
      submissionsProcessed: state.submissionsProcessed,
      staleRecoveriesCompleted: state.staleRecoveriesCompleted,
      overlapsPrevented: state.overlapsPrevented,
      intervalMs,
      backoffBaseMs,
      maxBackoffMs,
      staleJudgingMs,
      configuration
    };
  }

  function nextDelay(){
    if(!state.consecutiveFailures) return intervalMs;
    const delay = backoffBaseMs * (2 ** Math.min(state.consecutiveFailures - 1, 10));
    return Math.min(maxBackoffMs, Math.max(backoffBaseMs, delay));
  }

  function schedule(delayMs){
    if(!state.enabled || stopped) return;
    state.nextDelayMs = delayMs;
    state.nextScheduledRunAt = new Date(dateNow(now).getTime() + delayMs).toISOString();
    timer = setTimeoutFn(async () => {
      timer = null;
      state.nextScheduledRunAt = null;
      await runNow({ scheduled:true });
      if(state.enabled && !stopped) schedule(nextDelay());
    }, delayMs);
    if(timer && typeof timer.unref === 'function') timer.unref();
  }

  async function runNow(){
    if(!state.enabled) return { skipped:true, reason:'disabled' };
    if(state.active){
      state.overlapsPrevented += 1;
      return { skipped:true, reason:'active' };
    }

    state.active = true;
    state.currentActivity = 'recovering_stale_judging';
    state.lastRunAt = isoNow(now);
    state.runCount += 1;

    activePromise = (async () => {
      try{
        const runTime = now();
        const recovery = await recoverStale({ now: runTime, staleMs: staleJudgingMs });
        const recoveries = recoveredCount(recovery);
        state.staleRecoveriesCompleted += recoveries;

        state.currentActivity = 'processing_submission';
        const result = await runOnce({ now: runTime, staleMs: staleJudgingMs });
        const count = processedCount(result);
        state.submissionsProcessed += count;

        state.consecutiveFailures = 0;
        state.lastFailure = null;
        state.lastSuccessAt = isoNow(now);
        state.nextDelayMs = intervalMs;
        return { ...(result || {}), recovered: recoveries, processedCount: count };
      }catch(error){
        state.consecutiveFailures += 1;
        state.lastFailureAt = isoNow(now);
        state.lastFailure = sanitizeError(error);
        state.nextDelayMs = nextDelay();
        if(logger && typeof logger.warn === 'function'){
          logger.warn('submission judging runner failed', state.lastFailure);
        }
        return { error: state.lastFailure };
      }finally{
        state.active = false;
        state.currentActivity = null;
        activePromise = null;
      }
    })();

    return activePromise;
  }

  function start(){
    if(!state.enabled) return status();
    if(state.startedAt && !state.stoppedAt) return status();
    stopped = false;
    state.startedAt = isoNow(now);
    state.stoppedAt = null;
    schedule(0);
    return status();
  }

  async function stop(){
    stopped = true;
    if(timer){
      clearTimeoutFn(timer);
      timer = null;
    }
    state.stoppedAt = isoNow(now);
    state.nextDelayMs = null;
    state.nextScheduledRunAt = null;
    if(activePromise) await activePromise;
    return status();
  }

  return { runNow, start, stop, status };
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_MAX_BACKOFF_MS,
  DEFAULT_STALE_JUDGING_MS,
  createSubmissionJudgingRunner,
  isSubmissionJudgeRunnerEnabled,
  parseSubmissionJudgeRunnerConfig,
  validateSubmissionJudgeRunnerConfig,
  sanitizeError
};
