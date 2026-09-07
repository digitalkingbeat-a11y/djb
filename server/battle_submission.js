const { randomUUID } = require('crypto');
const { ALLOWED_AUDIO_MIME_TYPES, LIMITS, validateAudioMetadata } = require('./ingestion_safety');

const SUBMISSION_STATUSES = ['draft', 'uploading', 'uploaded', 'queued', 'processing', 'judging', 'completed', 'failed'];
const SUBMISSION_SOURCES = ['uploaded_mix', 'battle_studio'];
const SUBMISSION_TRANSITIONS = {
  draft: ['uploading', 'failed'],
  uploading: ['uploaded', 'failed'],
  uploaded: ['queued', 'judging', 'failed'],
  queued: ['processing', 'judging', 'failed'],
  processing: ['judging', 'completed', 'failed'],
  judging: ['completed', 'failed'],
  completed: [],
  failed: ['uploading']
};
const MIX_BUCKET = 'battle-mixes';
const BATTLE_PREP_SNAPSHOT_TABLE = 'battle_prep_entry_snapshots';
const MAX_MIX_FILE_SIZE = LIMITS.uploadedAudioBytes;
const ALLOWED_MIME_TYPES = Object.fromEntries(Object.entries(ALLOWED_AUDIO_MIME_TYPES).map(([mimeType, extensions]) => [mimeType, extensions[0]]));

function validBattleId(battleId){ return typeof battleId === 'string' || typeof battleId === 'number'; }

function buildBattleEntryPayload({ battleId, userId }){
  if(!validBattleId(battleId) || String(battleId).trim() === '') throw new Error('Invalid battleId');
  return { battle_id: String(battleId), user_id: userId, status: 'active' };
}

function buildDraftSubmissionPayload({ entryId, userId, originalFilename, declaredMimeType, fileSize, duration, battleContext, submissionSource }){
  if(!originalFilename || !declaredMimeType || !Number.isFinite(Number(fileSize)) || Number(fileSize) < 0) throw new Error('Invalid submission metadata');
  if(duration != null && (!Number.isFinite(Number(duration)) || Number(duration) < 0)) throw new Error('Invalid duration');
  if(!SUBMISSION_SOURCES.includes(submissionSource)) throw new Error('Invalid submission source');
  const id = randomUUID();
  return {
    id,
    battle_entry_id: entryId,
    user_id: userId,
    storage_object_path: `private/battle-entries/${entryId}/submissions/${id}`,
    original_filename: String(originalFilename),
    declared_mime_type: String(declaredMimeType),
    file_size: Number(fileSize),
    duration: duration == null ? null : Number(duration),
    submission_source: submissionSource,
    status: 'draft',
    processing_info: battleContext && Object.keys(battleContext).length ? { battleContext } : {},
    processing_error: null
  };
}

function canTransitionSubmissionStatus(from, to){ return Boolean(SUBMISSION_TRANSITIONS[from] && SUBMISSION_TRANSITIONS[from].includes(to)); }

function validateUploadMetadata(submission){
  const validation = validateAudioMetadata({
    filename: submission.original_filename,
    mimeType: submission.declared_mime_type,
    size: submission.file_size
  }, LIMITS);
  if(validation.error) return { error: validation.error };
  return { extension: ALLOWED_MIME_TYPES[validation.mimeType] };
}

function buildUploadObjectPath(submission, extension){
  const prefix = `private/battle-entries/${submission.battle_entry_id}/submissions/${submission.id}`;
  if(String(submission.storage_object_path) !== prefix) return null;
  return `${prefix}/mix.${extension}`;
}

async function getOwnedBattleEntry(dataClient, userId, entryId){
  const result = await dataClient.from('battle_entries').select('*').eq('id', entryId).limit(1).single();
  if(result.error) return { error: result.error };
  if(String(result.data.user_id) !== String(userId)) return { forbidden: true };
  return { entry: result.data };
}

async function getOwnedMixSubmission(dataClient, userId, submissionId){
  const result = await dataClient.from('mix_submissions').select('*').eq('id', submissionId).limit(1).single();
  if(result.error) return { error: result.error };
  if(String(result.data.user_id) !== String(userId)) return { forbidden: true };
  return { submission: result.data };
}

async function getOrCreateBattleEntry(dataClient, userId, battleId){
  const payload = buildBattleEntryPayload({ battleId, userId });
  const existing = await dataClient.from('battle_entries').select('*').eq('battle_id', payload.battle_id).eq('user_id', userId).limit(1);
  if(existing.error) return { error: existing.error };
  if(existing.data && existing.data[0]) return { entry: existing.data[0], created: false };
  const inserted = await dataClient.from('battle_entries').insert([payload]).select('*').single();
  if(inserted.error) return { error: inserted.error };
  return { entry: inserted.data, created: true };
}

async function verifyBattlePrepSnapshotContext(dataClient, userId, entryId, battleContext){
  const snapshotId = battleContext && battleContext.battlePrepSnapshotId;
  if(!snapshotId) return { ok:true };
  const result = await dataClient
    .from(BATTLE_PREP_SNAPSHOT_TABLE)
    .select('id,snapshot_version,battle_entry_id,user_id')
    .eq('id', snapshotId)
    .eq('battle_entry_id', entryId)
    .eq('user_id', userId)
    .limit(1)
    .single();
  if(result.error) return { error: result.error };
  if(!result.data) return { validationError:'Battle Prep snapshot does not belong to this submission entry' };
  if(battleContext.battlePrepSnapshotVersion && String(battleContext.battlePrepSnapshotVersion) !== String(result.data.snapshot_version)){
    return { validationError:'Battle Prep snapshot version does not match this entry' };
  }
  return { ok:true };
}

async function createDraftSubmission(dataClient, userId, entryId, metadata){
  const owned = await getOwnedBattleEntry(dataClient, userId, entryId);
  if(owned.error || owned.forbidden) return owned;
  const snapshot = await verifyBattlePrepSnapshotContext(dataClient, userId, entryId, metadata && metadata.battleContext);
  if(snapshot.error || snapshot.validationError) return snapshot;
  const existing = await dataClient.from('mix_submissions').select('*').eq('battle_entry_id', entryId).limit(1);
  if(existing.error) return { error: existing.error };
  if(existing.data && existing.data[0]){
    if(existing.data[0].status === 'completed') return { conflict: true };
    return { submission: existing.data[0], created: false };
  }
  let payload;
  try{ payload = buildDraftSubmissionPayload({ entryId, userId, ...metadata }); }catch(err){ return { validationError: err.message }; }
  const inserted = await dataClient.from('mix_submissions').insert([payload]).select('*').single();
  if(inserted.error) return { error: inserted.error };
  return { submission: inserted.data, created: true };
}

async function issueUploadAuthorization(dataClient, storage, userId, submissionId, now=new Date()){
  const owned = await getOwnedMixSubmission(dataClient, userId, submissionId);
  if(owned.error || owned.forbidden) return owned;
  const submission = owned.submission;
  if(!['draft', 'failed'].includes(submission.status)) return { invalidState: true };
  const validation = validateUploadMetadata(submission);
  if(validation.error) return { validationError: validation.error };
  const objectPath = buildUploadObjectPath(submission, validation.extension);
  if(!objectPath) return { validationError: 'Invalid private storage path' };
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  const signed = await storage.createSignedUploadUrl(objectPath, { upsert: false });
  if(signed.error) return { error: signed.error };
  if(!signed.data || signed.data.path !== objectPath || !signed.data.token) return { error: new Error('Storage returned an invalid signed upload authorization') };
  const updated = await dataClient.from('mix_submissions').update({ status:'uploading', storage_object_path:objectPath, upload_authorized_at:now.toISOString(), upload_expires_at:expiresAt, processing_error:null }).eq('id', submissionId).eq('user_id', userId).select('*').single();
  if(updated.error) return { error: updated.error };
  return { submission: updated.data, uploadPath: signed.data.path, uploadToken: signed.data.token, expiresAt };
}

async function completeUpload(dataClient, storage, userId, submissionId, now=new Date()){
  const owned = await getOwnedMixSubmission(dataClient, userId, submissionId);
  if(owned.error || owned.forbidden) return owned;
  const submission = owned.submission;
  if(submission.status !== 'uploading') return { invalidState: true };
  if(!submission.upload_expires_at || new Date(submission.upload_expires_at) < now) return failUpload(dataClient, submission, userId, 'Upload authorization expired');
  const slash = submission.storage_object_path.lastIndexOf('/');
  const objectName = submission.storage_object_path.slice(slash + 1);
  const listed = await storage.list(submission.storage_object_path.slice(0, slash), { search: objectName });
  if(listed.error) return { error: listed.error };
  const object = (listed.data || []).find(item => item.name === objectName);
  const size = object && object.metadata && Number(object.metadata.size);
  const mime = object && object.metadata && object.metadata.mimetype;
  if(!object) return failUpload(dataClient, submission, userId, 'Uploaded object was not found');
  if(size !== Number(submission.file_size)) return failUpload(dataClient, submission, userId, 'Uploaded object size did not match authorization');
  if(!ALLOWED_MIME_TYPES[mime]) return failUpload(dataClient, submission, userId, 'Uploaded object MIME type was not allowed');
  const updated = await dataClient.from('mix_submissions').update({ status:'uploaded', verified_object_size:size, verified_mime_type:mime, upload_verified_at:now.toISOString(), submitted_at:now.toISOString(), processing_error:null }).eq('id', submissionId).eq('user_id', userId).select('*').single();
  if(updated.error) return { error: updated.error };
  return { submission: updated.data };
}

function extractJudgeScore(judgeResult){
  const raw = judgeResult && (judgeResult.score ?? judgeResult.overallScore ?? judgeResult.total ?? judgeResult.aiScore);
  if(!Number.isFinite(Number(raw))) return null;
  return Math.max(0, Math.min(100, Number(raw)));
}

function normalizeJudgeResult(judgeResult){
  if(!judgeResult || typeof judgeResult !== 'object' || Array.isArray(judgeResult)) return null;
  const score = extractJudgeScore(judgeResult);
  if(score == null) return null;
  const analysis = judgeResult.analysis && typeof judgeResult.analysis === 'object' ? judgeResult.analysis : judgeResult;
  const components = analysis.components || judgeResult.components || {};
  const breakdown = judgeResult.breakdown || analysis.breakdown || analysis.componentDetails || components;
  const timing = judgeResult.timing || analysis.timeline || analysis.rawMeasurements || analysis.perEvent || [];
  return {
    score,
    overallScore: score,
    breakdown,
    components,
    timing,
    rawMeasurements: analysis.rawMeasurements || analysis.perEvent || [],
    recommendations: analysis.recommendations || judgeResult.recommendations || [],
    confidence: judgeResult.confidence || null,
    evidenceType: judgeResult.evidenceType || 'server_judge_result',
    explanation: judgeResult.explanation || null,
    reward: judgeResult.reward || null,
    measurableAnalysis: judgeResult.measurableAnalysis || null,
    scoringModel: judgeResult.scoringModel || null,
    battleContext: judgeResult.battleContext || null,
    battleMode: judgeResult.battleMode || null,
    battleDiscipline: judgeResult.battleDiscipline || analysis.meta && analysis.meta.discipline || judgeResult.battleContext && judgeResult.battleContext.discipline || null,
    won: typeof judgeResult.won === 'boolean' ? judgeResult.won : null,
    opponentScore: Number.isFinite(Number(judgeResult.opponentScore)) ? Number(judgeResult.opponentScore) : null,
    winnerUserId: judgeResult.winnerUserId ? String(judgeResult.winnerUserId) : null,
    raw: judgeResult
  };
}

function getStoredJudgeResult(submission){
  const processingInfo = submission && submission.processing_info;
  const candidates = [
    submission && submission.judge_result,
    processingInfo && processingInfo.judgeResult,
    processingInfo && processingInfo.judgingResult,
    processingInfo && processingInfo.result,
    processingInfo && processingInfo.analysis
  ];
  for(const candidate of candidates){
    const normalized = normalizeJudgeResult(candidate);
    if(normalized) return normalized;
  }
  return null;
}

function mergeProcessingInfo(submission, patch){
  const current = submission && submission.processing_info && typeof submission.processing_info === 'object' && !Array.isArray(submission.processing_info)
    ? submission.processing_info
    : {};
  return { ...current, ...patch };
}

async function updateOwnedSubmission(dataClient, userId, submissionId, values){
  const updated = await dataClient
    .from('mix_submissions')
    .update(values)
    .eq('id', submissionId)
    .eq('user_id', userId)
    .select('*')
    .single();
  return updated.error ? { error: updated.error } : { submission: updated.data };
}

async function getSubmissionJudgingResult(dataClient, userId, submissionId, now=new Date()){
  const owned = await getOwnedMixSubmission(dataClient, userId, submissionId);
  if(owned.error || owned.forbidden) return owned;
  let submission = owned.submission;
  const judgeResult = getStoredJudgeResult(submission);

  if(submission.status === 'completed'){
    return { submission, status: 'completed', judgeResult, completed: Boolean(judgeResult), duplicate: true };
  }

  if(!judgeResult){
    return { submission, status: submission.status, judgeResult: null, completed: false };
  }

  if(!['uploaded', 'queued', 'processing', 'judging'].includes(submission.status)){
    return { invalidState: true, submission };
  }

  if(submission.status !== 'judging'){
    const judging = await updateOwnedSubmission(dataClient, userId, submissionId, {
      status: 'judging',
      processing_info: mergeProcessingInfo(submission, {
        judging_started_at: now.toISOString(),
        judging_source: judgeResult.evidenceType
      }),
      processing_error: null
    });
    if(judging.error) return judging;
    submission = judging.submission;
  }

  const completed = await updateOwnedSubmission(dataClient, userId, submissionId, {
    status: 'completed',
    judge_result: judgeResult,
    processing_info: mergeProcessingInfo(submission, {
      judging_completed_at: now.toISOString(),
      final_score: judgeResult.score,
      judging_source: judgeResult.evidenceType
    }),
    processing_error: null
  });
  if(completed.error) return completed;
  return { submission: completed.submission, status: 'completed', judgeResult, completed: true };
}

async function failUpload(dataClient, submission, userId, reason){
  const updated = await dataClient.from('mix_submissions').update({ status:'failed', processing_error:reason }).eq('id', submission.id).eq('user_id', userId).select('*').single();
  return updated.error ? { error: updated.error } : { verificationFailed:true, reason };
}

module.exports = {
  SUBMISSION_STATUSES,
  SUBMISSION_SOURCES,
  buildBattleEntryPayload,
  buildDraftSubmissionPayload,
  canTransitionSubmissionStatus,
  getOwnedBattleEntry,
  getOwnedMixSubmission,
  getOrCreateBattleEntry,
  verifyBattlePrepSnapshotContext,
  createDraftSubmission,
  MIX_BUCKET,
  MAX_MIX_FILE_SIZE,
  ALLOWED_MIME_TYPES,
  validateUploadMetadata,
  buildUploadObjectPath,
  issueUploadAuthorization,
  completeUpload,
  extractJudgeScore,
  normalizeJudgeResult,
  getStoredJudgeResult,
  getSubmissionJudgingResult
};
