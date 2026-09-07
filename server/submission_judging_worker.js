const fs = require('fs');
const os = require('os');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const BattleModes = require('../battle_modes');
const Judge = require('./judge_engine');
const { getFFmpegCapability, publicFFmpegCapabilityStatus } = require('./ffmpeg_capability');
const { MIX_BUCKET, getStoredJudgeResult, getSubmissionJudgingResult } = require('./battle_submission');

const DEFAULT_POLL_LIMIT = 5;
const DEFAULT_STALE_JUDGING_MS = 15 * 60 * 1000;

function workerId(){
  return `submission-judge-${process.pid}-${Date.now().toString(36)}`;
}

function mergeProcessingInfo(submission, patch){
  const current = submission && submission.processing_info && typeof submission.processing_info === 'object' && !Array.isArray(submission.processing_info)
    ? submission.processing_info
    : {};
  return { ...current, ...patch };
}

function getBattleContext(submission){
  const info = submission && submission.processing_info;
  return info && info.battleContext && typeof info.battleContext === 'object' && !Array.isArray(info.battleContext)
    ? info.battleContext
    : {};
}

async function selectNextUploadedSubmission(dataClient, limit = DEFAULT_POLL_LIMIT){
  const query = dataClient
    .from('mix_submissions')
    .select('*')
    .eq('status', 'uploaded')
    .order('submitted_at', { ascending: true, nullsFirst: false })
    .limit(limit);
  const result = await query;
  if(result.error) return { error: result.error };
  const rows = result.data || [];
  return { submission: rows[0] || null };
}

async function claimUploadedSubmission(dataClient, submission, options = {}){
  if(!submission || !submission.id) return { claimed:false, reason:'no_submission' };
  if(submission.status === 'completed') return { claimed:false, duplicate:true, submission };
  if(submission.status !== 'uploaded') return { claimed:false, invalidState:true, submission };
  const now = options.now || new Date();
  const id = options.workerId || workerId();
  const update = await dataClient
    .from('mix_submissions')
    .update({
      status: 'judging',
      processing_info: mergeProcessingInfo(submission, {
        judging_worker_id: id,
        judging_claimed_at: now.toISOString(),
        judging_attempts: Number(submission.processing_info && submission.processing_info.judging_attempts || 0) + 1
      }),
      processing_error: null
    })
    .eq('id', submission.id)
    .eq('status', 'uploaded')
    .select('*')
    .single();
  if(update.error) return { error: update.error };
  if(!update.data) return { claimed:false, conflict:true };
  return { claimed:true, submission:update.data, workerId:id };
}

async function claimNextUploadedSubmission(dataClient, options = {}){
  const selected = await selectNextUploadedSubmission(dataClient, options.limit || DEFAULT_POLL_LIMIT);
  if(selected.error || !selected.submission) return selected;
  return claimUploadedSubmission(dataClient, selected.submission, options);
}

function isStaleJudgingSubmission(submission, options = {}){
  if(!submission || submission.status !== 'judging') return false;
  const now = options.now || new Date();
  const staleMs = Number(options.staleMs || DEFAULT_STALE_JUDGING_MS);
  const processingInfo = submission.processing_info || {};
  const claimedAt = Date.parse(processingInfo.judging_claimed_at || processingInfo.judging_started_at || '');
  return Number.isFinite(claimedAt) && now.getTime() - claimedAt >= staleMs;
}

async function selectStaleJudgingSubmissions(dataClient, options = {}){
  const now = options.now || new Date();
  const staleMs = Number(options.staleMs || DEFAULT_STALE_JUDGING_MS);
  const query = dataClient
    .from('mix_submissions')
    .select('*')
    .eq('status', 'judging')
    .order('submitted_at', { ascending: true, nullsFirst: false })
    .limit(options.limit || DEFAULT_POLL_LIMIT);
  const result = await query;
  if(result.error) return { error: result.error };
  const submissions = (result.data || []).filter(submission => isStaleJudgingSubmission(submission, { now, staleMs }));
  return { submissions };
}

async function recoverStaleJudgingSubmissions(dataClient, options = {}){
  if(!dataClient) throw new Error('dataClient is required');
  const now = options.now || new Date();
  const selected = await selectStaleJudgingSubmissions(dataClient, options);
  if(selected.error) return selected;
  let completed = 0;
  let duplicates = 0;
  for(const submission of selected.submissions){
    const storedResult = getStoredJudgeResult(submission);
    if(!storedResult) continue;
    const result = await getSubmissionJudgingResult(dataClient, submission.user_id, submission.id, now);
    if(result.error) return { error: result.error };
    if(result.completed) completed += 1;
    if(result.duplicate) duplicates += 1;
  }
  return { inspected: selected.submissions.length, completed, duplicates };
}

async function claimStaleJudgingSubmission(dataClient, submission, options = {}){
  if(!submission || !submission.id) return { claimed:false, reason:'no_submission' };
  if(!isStaleJudgingSubmission(submission, options)) return { claimed:false, reason:'not_stale' };
  if(getStoredJudgeResult(submission)){
    const completed = await getSubmissionJudgingResult(dataClient, submission.user_id, submission.id, options.now || new Date());
    if(completed.error) return completed;
    return { claimed:false, completed:Boolean(completed.completed), duplicate:Boolean(completed.duplicate), submission:completed.submission, judgeResult:completed.judgeResult };
  }
  const now = options.now || new Date();
  const id = options.workerId || workerId();
  const update = await dataClient
    .from('mix_submissions')
    .update({
      processing_info: mergeProcessingInfo(submission, {
        judging_worker_id: id,
        judging_recovered_at: now.toISOString(),
        judging_claimed_at: now.toISOString(),
        judging_attempts: Number(submission.processing_info && submission.processing_info.judging_attempts || 0) + 1,
        judging_retryable: true
      }),
      processing_error: null
    })
    .eq('id', submission.id)
    .eq('status', 'judging')
    .select('*')
    .single();
  if(update.error) return { error: update.error };
  if(!update.data) return { claimed:false, conflict:true };
  return { claimed:true, recovered:true, submission:update.data, workerId:id };
}

async function claimNextStaleJudgingSubmission(dataClient, options = {}){
  const selected = await selectStaleJudgingSubmissions(dataClient, options);
  if(selected.error) return selected;
  for(const submission of selected.submissions){
    const claimed = await claimStaleJudgingSubmission(dataClient, submission, options);
    if(claimed.error || claimed.claimed || claimed.completed) return claimed;
  }
  return { claimed:false, reason:'no_stale_judging_submission' };
}

async function markSubmissionAnalysisFailed(dataClient, submission, error, options = {}){
  const now = options.now || new Date();
  const reason = safeErrorMessage(error);
  const update = await dataClient
    .from('mix_submissions')
    .update({
      status: 'failed',
      processing_error: reason,
      processing_info: mergeProcessingInfo(submission, {
        judging_failed_at: now.toISOString(),
        judging_retryable: true,
        judging_error_code: error && error.code || 'ANALYSIS_FAILED',
        ffmpeg: error && error.capability ? error.capability : undefined
      })
    })
    .eq('id', submission.id)
    .select('*')
    .single();
  if(update.error) return { error:update.error };
  return { failed:true, submission:update.data, error:reason };
}

function safeErrorMessage(error){
  const message = error && error.message ? String(error.message) : String(error || 'Analysis failed');
  return message.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 500);
}

async function storageDataToBuffer(data){
  if(Buffer.isBuffer(data)) return data;
  if(data instanceof ArrayBuffer) return Buffer.from(data);
  if(ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if(data && typeof data.arrayBuffer === 'function') return Buffer.from(await data.arrayBuffer());
  if(typeof data === 'string') return Buffer.from(data);
  throw new Error('Downloaded mix object was not readable');
}

function safeExtension(storagePath){
  const ext = path.extname(String(storagePath || '')).toLowerCase();
  return /^[.][a-z0-9]{1,8}$/.test(ext) ? ext : '.webm';
}

async function downloadSubmissionToTempFile(storage, submission, options = {}){
  if(!submission || !submission.storage_object_path) throw new Error('Submission storage path is missing');
  const downloaded = await storage.download(submission.storage_object_path);
  if(downloaded.error) throw downloaded.error;
  const buffer = await storageDataToBuffer(downloaded.data);
  if(!buffer.length) throw new Error('Downloaded mix object was empty');
  const tmpRoot = options.tmpDir || path.join(os.tmpdir(), 'dj-battle-judging');
  await fs.promises.mkdir(tmpRoot, { recursive:true });
  const filePath = path.join(tmpRoot, `submission-${submission.id}-${Date.now()}${safeExtension(submission.storage_object_path)}`);
  await fs.promises.writeFile(filePath, buffer);
  return filePath;
}

function eventsFromBattleContext(context){
  const events = context && (context.events || context.judgeEvents || context.timingEvents);
  return Array.isArray(events) ? events.filter(event => event && typeof event === 'object').slice(0, 64) : [];
}

function eventsFromMeasuredTransitions(audioAnalysis){
  const transitions = audioAnalysis && audioAnalysis.session && Array.isArray(audioAnalysis.session.transitions)
    ? audioAnalysis.session.transitions
    : [];
  return transitions.slice(0, 32).map((timeSec, index) => ({
    label: `Measured Transition ${index + 1}`,
    actualSec: Number(timeSec),
    event: 'measured_transition'
  })).filter(event => Number.isFinite(event.actualSec));
}

function disciplineForBattleContext(context = {}){
  const explicit = String(context.discipline || context.battleDiscipline || '').toLowerCase();
  if(explicit === 'producer') return 'producer';
  const mode = BattleModes.getBattleMode(context.modeId || context.mode || context.type || context.battleType);
  return mode && mode.discipline === 'producer' ? 'producer' : 'dj';
}

function analyzeByDiscipline(judge, discipline, events, options){
  if(discipline === 'producer'){
    if(!judge || typeof judge.analyzeProducerBeat !== 'function'){
      const err = new Error('Producer beat judge is unavailable');
      err.code = 'PRODUCER_JUDGE_UNAVAILABLE';
      throw err;
    }
    return judge.analyzeProducerBeat(events, options);
  }
  return judge.analyzePerformance(events, options);
}

async function analyzeSubmissionAudio({ analyzer, audioPath, battleContext, discipline }){
  const contextEvents = eventsFromBattleContext(battleContext);
  if(contextEvents.length){
    const audioAnalysis = await analyzer.analyzeSessionAudio({ audioPath, events: contextEvents });
    return { events: contextEvents, audioAnalysis };
  }

  if(discipline === 'producer'){
    const audioAnalysis = await analyzer.analyzeSessionAudio({ audioPath, events: [] });
    return { events: [], audioAnalysis };
  }

  const discovery = await analyzer.analyzeSessionAudio({ audioPath, events: [] });
  const measuredEvents = eventsFromMeasuredTransitions(discovery);
  if(!measuredEvents.length){
    const err = new Error('No measurable transition events were found in the uploaded mix');
    err.code = 'NO_MEASURABLE_TRANSITIONS';
    throw err;
  }
  const audioAnalysis = await analyzer.analyzeSessionAudio({ audioPath, events: measuredEvents });
  return { events: measuredEvents, audioAnalysis };
}

function confidenceForAnalysis(analysis){
  const details = analysis && analysis.componentDetails ? Object.values(analysis.componentDetails) : [];
  const available = details.filter(detail => detail && detail.available && Number.isFinite(Number(detail.score))).length;
  const total = details.length || 1;
  const audioEvidence = analysis && analysis.meta && analysis.meta.audioEvidence || {};
  return {
    measurableComponentRatio: Math.round((available / total) * 1000) / 1000,
    availableComponents: available,
    totalComponents: details.length,
    audioEvidenceAvailable: Boolean(audioEvidence.available),
    transitionCount: Number(audioEvidence.transitionCount || 0),
    onsetCount: Number(audioEvidence.onsetCount || 0),
    beatGridCount: Number(audioEvidence.beatGridCount || 0),
    trainedModelJudging: { used:false, status:'future_not_used' }
  };
}

function buildJudgeResult({ submission, battleContext, events, audioAnalysis, analysis, discipline, now = new Date() }){
  if(!Number.isFinite(Number(analysis && analysis.overallScore))){
    const err = new Error('Rule-based judge did not produce a score from measurable evidence');
    err.code = 'INSUFFICIENT_SCORING_EVIDENCE';
    throw err;
  }
  const resolvedDiscipline = discipline || disciplineForBattleContext(battleContext);
  const producer = resolvedDiscipline === 'producer';
  const confidence = confidenceForAnalysis(analysis);
  const resultContext = producer ? { ...(battleContext || {}), discipline: 'producer' } : battleContext;
  return {
    score: Number(analysis.overallScore),
    overallScore: Number(analysis.overallScore),
    breakdown: analysis.componentDetails || analysis.components || {},
    components: analysis.components || {},
    timing: analysis.timeline || [],
    rawMeasurements: analysis.rawMeasurements || [],
    recommendations: analysis.recommendations || [],
    confidence,
    evidenceType: producer ? 'measurable_audio_rule_based_producer' : 'measurable_audio_rule_based',
    explanation: producer
      ? 'Measured audio analysis was scored by deterministic Producer Beat Battle rules. No trained-model judging was used.'
      : 'Measured audio analysis was scored by deterministic DJ Battle rules. No trained-model judging was used.',
    measurableAnalysis: {
      durationSec: audioAnalysis && audioAnalysis.session ? audioAnalysis.session.durationSec ?? null : null,
      bpm: audioAnalysis && audioAnalysis.session ? audioAnalysis.session.bpm ?? null : null,
      key: audioAnalysis && audioAnalysis.session && audioAnalysis.session.harmonic ? audioAnalysis.session.harmonic.key || null : null,
      transitionCount: audioAnalysis && audioAnalysis.session && Array.isArray(audioAnalysis.session.transitions) ? audioAnalysis.session.transitions.length : 0,
      events
    },
    scoringModel: {
      measurableAnalysis: 'ffmpeg_audio_analyzer',
      ruleBasedScoring: producer ? 'producer_beat_judge_engine' : 'judge_engine',
      trainedModelJudging: 'not_used'
    },
    battleContext: resultContext,
    battleMode: battleContext.modeId || battleContext.type || null,
    battleDiscipline: resolvedDiscipline,
    reward: battleContext.reward || null,
    submissionId: submission.id,
    battleEntryId: submission.battle_entry_id,
    userId: submission.user_id,
    completedAt: now.toISOString(),
    analysis
  };
}

async function writeJudgeResultAndComplete(dataClient, submission, judgeResult, options = {}){
  const now = options.now || new Date();
  const written = await dataClient
    .from('mix_submissions')
    .update({
      judge_result: judgeResult,
      processing_info: mergeProcessingInfo(submission, {
        judging_result_written_at: now.toISOString(),
        final_score: judgeResult.score,
        confidence: judgeResult.confidence
      }),
      processing_error: null
    })
    .eq('id', submission.id)
    .eq('status', 'judging')
    .select('*')
    .single();
  if(written.error) return { error: written.error };
  if(!written.data) return { conflict:true };
  return getSubmissionJudgingResult(dataClient, written.data.user_id, written.data.id, now);
}

async function processClaimedSubmission({ dataClient, storage, submission, analyzer, judge = Judge, now = new Date(), tmpDir }){
  const battleContext = getBattleContext(submission);
  const discipline = disciplineForBattleContext(battleContext);
  const audioAnalyzer = analyzer || require('./audio_analyzer_ffmpeg');
  let audioPath = null;
  try{
    audioPath = await downloadSubmissionToTempFile(storage, submission, { tmpDir });
    const { events, audioAnalysis } = await analyzeSubmissionAudio({ analyzer: audioAnalyzer, audioPath, battleContext, discipline });
    const analysis = analyzeByDiscipline(judge, discipline, events, {
      audioAnalysis,
      battleContext,
      analyzedAt: now.toISOString()
    });
    if(analysis.meta) analysis.meta.duration = audioAnalysis && audioAnalysis.session ? audioAnalysis.session.durationSec ?? null : null;
    const judgeResult = buildJudgeResult({ submission, battleContext, events, audioAnalysis, analysis, discipline, now });
    const completed = await writeJudgeResultAndComplete(dataClient, submission, judgeResult, { now });
    if(completed.error) return completed;
    return { processed:true, completed:true, submission:completed.submission, judgeResult:completed.judgeResult };
  }catch(error){
    return markSubmissionAnalysisFailed(dataClient, submission, error, { now });
  }finally{
    if(audioPath){
      try{ await fs.promises.unlink(audioPath); }catch(err){}
    }
  }
}

async function runOnce({ dataClient, storage, analyzer, judge = Judge, workerId: id = workerId(), now = new Date(), tmpDir, staleMs, limit } = {}){
  if(!dataClient) throw new Error('dataClient is required');
  if(!storage) throw new Error('storage is required');
  let claimed = await claimNextUploadedSubmission(dataClient, { workerId:id, now });
  if(claimed.error) return claimed;
  if(!claimed.claimed){
    const stale = await claimNextStaleJudgingSubmission(dataClient, {
      workerId:id,
      now,
      staleMs,
      limit
    });
    if(stale.error || stale.completed) return stale;
    if(stale.claimed) claimed = stale;
  }
  if(!claimed.claimed) return claimed;
  return processClaimedSubmission({ dataClient, storage, submission:claimed.submission, analyzer, judge, now, tmpDir });
}

async function runLoop(options = {}){
  const intervalMs = Number(options.intervalMs || process.env.SUBMISSION_JUDGE_INTERVAL_MS || 10000);
  while(true){
    await runOnce(options).catch(error => console.error('submission judging worker failed', error));
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

function createWorkerClients(){
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_KEY || '';
  if(!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  const dataClient = createClient(url, key);
  return { dataClient, storage:dataClient.storage.from(MIX_BUCKET) };
}

if(require.main === module){
  const capability = getFFmpegCapability();
  if(!capability.available){
    console.error('Cannot start submission judging worker:', publicFFmpegCapabilityStatus(capability));
    process.exit(1);
  }
  const clients = createWorkerClients();
  const once = process.argv.includes('--once');
  const options = { ...clients };
  (once ? runOnce(options) : runLoop(options))
    .then(result => {
      if(once){
        console.log(JSON.stringify(result || { processed:false }, null, 2));
      }
    })
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  analyzeByDiscipline,
  analyzeSubmissionAudio,
  buildJudgeResult,
  claimNextStaleJudgingSubmission,
  claimNextUploadedSubmission,
  claimStaleJudgingSubmission,
  claimUploadedSubmission,
  confidenceForAnalysis,
  createWorkerClients,
  downloadSubmissionToTempFile,
  disciplineForBattleContext,
  eventsFromMeasuredTransitions,
  isStaleJudgingSubmission,
  markSubmissionAnalysisFailed,
  processClaimedSubmission,
  recoverStaleJudgingSubmissions,
  runLoop,
  runOnce,
  selectStaleJudgingSubmissions,
  selectNextUploadedSubmission,
  writeJudgeResultAndComplete
};
