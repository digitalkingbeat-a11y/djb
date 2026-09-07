const { createHash, randomUUID } = require('crypto');
const BattleModes = require('../battle_modes');
const { getOwnedMixSubmission, getStoredJudgeResult } = require('./battle_submission');

const MIX_RIGHTS_CERTIFICATION_SCHEMA = '025_create_mix_rights_certifications';
const MIX_RIGHTS_CERTIFICATION_TABLE = 'mix_rights_certifications';
const BATTLE_PREP_SNAPSHOT_TABLE = 'battle_prep_entry_snapshots';

const CERTIFICATION_STATUSES = ['certified', 'review_required', 'blocked', 'revoked', 'expired'];
const CERTIFICATION_SOURCES = ['battle_prep_snapshot', 'manual_attestation', 'operator_review'];
const ALLOWED_RIGHTS = new Set(['original', 'licensed', 'royalty_free', 'platform_cleared']);
const BLOCKED_RIGHTS = new Set(['commercial_copyrighted', 'commercial', 'copyrighted', 'unlicensed', 'rights_blocked', 'copyright_blocked', 'blocked']);

function cleanString(value, fallback = '', max = 240){
  return String(value == null ? fallback : value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function cleanIdentifier(value, fallback = ''){
  const text = cleanString(value, fallback, 180);
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text : '';
}

function cleanEnum(value, allowed, fallback){
  return allowed.includes(value) ? value : fallback;
}

function safeArray(value, max = 100){
  if(!Array.isArray(value)) return [];
  return value.slice(0, max);
}

function plainObject(value){
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nowIso(now){
  return (now instanceof Date ? now : new Date(now || Date.now())).toISOString();
}

function stableId(prefix, value){
  const digest = createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
  return `${prefix}_${digest}`;
}

function normalizeRights(value){
  return cleanString(value, 'unknown', 80).toLowerCase().replace(/[\s-]+/g, '_') || 'unknown';
}

function submissionBattleContext(submission){
  const info = plainObject(submission && submission.processing_info);
  return plainObject(info.battleContext);
}

function isProducerSubmission(submission){
  const judgeResult = getStoredJudgeResult(submission);
  const context = submissionBattleContext(submission);
  const modeId = cleanString(context.modeId || context.type || judgeResult && judgeResult.battleMode, '', 80);
  const mode = BattleModes.getBattleMode(modeId);
  const discipline = cleanString(
    context.discipline ||
    judgeResult && judgeResult.battleDiscipline ||
    judgeResult && judgeResult.battleContext && judgeResult.battleContext.discipline ||
    mode && mode.discipline,
    '',
    40
  ).toLowerCase();
  return discipline === 'producer' || mode && mode.discipline === 'producer';
}

function requiresDjMixRightsCertification(submission){
  return Boolean(submission && submission.status === 'completed' && getStoredJudgeResult(submission) && !isProducerSubmission(submission));
}

async function queryRows(dataClient, table, filters = [], limit = null){
  let query = dataClient.from(table).select('*');
  filters.forEach(([field, value]) => { query = query.eq(field, value); });
  if(limit != null && typeof query.limit === 'function') query = query.limit(limit);
  const result = await query;
  if(result.error) return { error: result.error };
  return { rows: Array.isArray(result.data) ? result.data : [] };
}

async function querySingle(dataClient, table, filters = []){
  const result = await queryRows(dataClient, table, filters, 1);
  if(result.error) return result;
  return { row: result.rows[0] || null };
}

async function insertSingle(dataClient, table, row){
  const result = await dataClient.from(table).insert([row]).select('*').single();
  if(result.error) return { error: result.error };
  return { row: result.data };
}

async function updateRows(dataClient, table, filters, values){
  let query = dataClient.from(table).update(values).select('*');
  filters.forEach(([field, value]) => { query = query.eq(field, value); });
  const result = await query;
  if(result.error) return { error: result.error };
  return { rows:Array.isArray(result.data) ? result.data : [] };
}

function sanitizeTrackEvidence(track){
  const row = plainObject(track);
  return {
    libraryTrackId: cleanString(row.libraryTrackId || row.trackId || row.id, '', 128) || null,
    order: Number.isFinite(Number(row.order)) ? Number(row.order) : null,
    title: cleanString(row.title, '', 160) || null,
    artist: cleanString(row.artist, '', 120) || null,
    rightsClassification: normalizeRights(row.rightsClassification || row.rights_classification),
    sourceType: cleanString(row.sourceType || row.source_type, 'track', 60) || 'track',
    status: cleanString(row.status, 'ready', 60) || 'ready',
    availability: cleanString(row.availability, 'available', 60) || 'available',
    reasons: safeArray(row.reasons, 12).map(item => cleanString(item, '', 220)).filter(Boolean)
  };
}

function evaluateTrackEvidence(tracks){
  const blockers = [];
  const warnings = [];
  safeArray(tracks, 100).forEach((track, index) => {
    const label = track.libraryTrackId || `track-${index + 1}`;
    const rights = normalizeRights(track.rightsClassification);
    if(track.status === 'blocked' || track.availability === 'blocked') blockers.push(`${label}: track was blocked in Battle Prep evidence`);
    if(BLOCKED_RIGHTS.has(rights)) blockers.push(`${label}: rights classification does not permit public mix use`);
    else if(!ALLOWED_RIGHTS.has(rights)) warnings.push(`${label}: rights classification requires review`);
  });
  if(!tracks.length) warnings.push('No immutable Battle Prep track evidence was available');
  return { blockers, warnings };
}

async function loadBattlePrepSnapshotEvidence(dataClient, submission, input = {}){
  const context = submissionBattleContext(submission);
  const requestedSnapshotId = cleanIdentifier(input.battlePrepSnapshotId || input.battle_prep_snapshot_id || context.battlePrepSnapshotId);
  if(!requestedSnapshotId){
    return {
      certificationSource:'manual_attestation',
      battlePrepSnapshotId:null,
      battlePrepSnapshotVersion:null,
      tracks:[],
      warnings:['No immutable Battle Prep snapshot was linked to this mix submission']
    };
  }
  const result = await querySingle(dataClient, BATTLE_PREP_SNAPSHOT_TABLE, [['id', requestedSnapshotId], ['battle_entry_id', submission.battle_entry_id], ['user_id', submission.user_id]]);
  if(result.error) return { error:result.error };
  if(!result.row) return { validationError:'Battle Prep snapshot evidence was not found for this submission' };
  const expectedVersion = cleanString(input.battlePrepSnapshotVersion || input.battle_prep_snapshot_version || context.battlePrepSnapshotVersion, '', 80);
  if(expectedVersion && String(result.row.snapshot_version) !== String(expectedVersion)){
    return { validationError:'Battle Prep snapshot version does not match this mix submission' };
  }
  return {
    certificationSource:'battle_prep_snapshot',
    battlePrepSnapshotId:result.row.id,
    battlePrepSnapshotVersion:result.row.snapshot_version || null,
    tracks:safeArray(result.row.tracks, 100).map(sanitizeTrackEvidence),
    warnings:[]
  };
}

function certificationDecision(evidence, input = {}){
  const rightsAttested = input.rightsAttested === true || input.rights_attested === true;
  const publicResultConsent = input.publicResultConsent === true || input.public_result_consent === true;
  const replayConsent = input.replayConsent === true || input.replay_consent === true;
  if(!rightsAttested) return { validationError:'Rights attestation is required before certifying a DJ mix' };
  if(!publicResultConsent) return { validationError:'Public result consent is required before certifying a DJ mix for public visibility' };
  const evaluated = evaluateTrackEvidence(evidence.tracks);
  const blockers = [...evaluated.blockers];
  const warnings = [...evidence.warnings, ...evaluated.warnings];
  const status = blockers.length ? 'blocked' : warnings.length ? 'review_required' : 'certified';
  return {
    status,
    publicResultAllowed: status === 'certified' && publicResultConsent,
    replayAllowed: status === 'certified' && replayConsent,
    rightsAttested,
    publicResultConsent,
    replayConsent,
    blockers,
    warnings
  };
}

function sanitizeMixRightsCertification(row){
  if(!row) return null;
  return {
    id: row.id,
    submissionId: row.submission_id,
    battleEntryId: row.battle_entry_id,
    userId: row.user_id,
    status: row.certification_status,
    certificationSource: row.certification_source,
    battlePrepSnapshotId: row.battle_prep_snapshot_id || null,
    battlePrepSnapshotVersion: row.battle_prep_snapshot_version || null,
    publicResultAllowed: Boolean(row.public_result_allowed),
    replayAllowed: Boolean(row.replay_allowed),
    rightsAttested: Boolean(row.rights_attested),
    publicResultConsent: Boolean(row.public_result_consent),
    replayConsent: Boolean(row.replay_consent),
    attestationVersion: row.attestation_version || null,
    trackEvidence: safeArray(row.track_evidence, 100).map(sanitizeTrackEvidence),
    blockedReasons: safeArray(row.blocked_reasons, 20).map(item => cleanString(item, '', 220)).filter(Boolean),
    warnings: safeArray(row.warnings, 20).map(item => cleanString(item, '', 220)).filter(Boolean),
    operatorReviewStatus: row.operator_review_status || 'not_requested',
    certifiedAt: row.certified_at || null,
    revokedAt: row.revoked_at || null,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

async function certifyMixRights(dataClient, userId, submissionId, input = {}, now = new Date()){
  const owned = await getOwnedMixSubmission(dataClient, userId, submissionId);
  if(owned.error || owned.forbidden) return owned;
  const submission = owned.submission;
  if(submission.status !== 'completed' || !getStoredJudgeResult(submission)) return { unavailable:true };
  if(!requiresDjMixRightsCertification(submission)) return { validationError:'DJ mix rights certification does not apply to this submission' };
  const evidence = await loadBattlePrepSnapshotEvidence(dataClient, submission, input);
  if(evidence.error || evidence.validationError) return evidence;
  const decision = certificationDecision(evidence, input);
  if(decision.validationError) return decision;
  const timestamp = nowIso(now);
  const payload = {
    id: cleanIdentifier(input.certificationId || input.certification_id) || stableId('mix_rights_cert', { submissionId:submission.id }),
    submission_id: submission.id,
    battle_entry_id: submission.battle_entry_id,
    user_id: submission.user_id,
    certification_status: decision.status,
    certification_source: cleanEnum(input.certificationSource || input.certification_source || evidence.certificationSource, CERTIFICATION_SOURCES, evidence.certificationSource),
    battle_prep_snapshot_id: evidence.battlePrepSnapshotId,
    battle_prep_snapshot_version: evidence.battlePrepSnapshotVersion,
    public_result_allowed: decision.publicResultAllowed,
    replay_allowed: decision.replayAllowed,
    rights_attested: decision.rightsAttested,
    public_result_consent: decision.publicResultConsent,
    replay_consent: decision.replayConsent,
    attestation_text: cleanString(input.attestationText || input.attestation_text, 'I certify that I have the rights or permissions required for this DJ mix use.', 1200),
    attestation_version: cleanString(input.attestationVersion || input.attestation_version, 'mix-rights-v1', 80) || 'mix-rights-v1',
    track_evidence: evidence.tracks,
    blocked_reasons: decision.blockers,
    warnings: decision.warnings,
    operator_review_status: decision.status === 'review_required' ? 'needed' : 'not_requested',
    review_notes: cleanString(input.reviewNotes || input.review_notes, '', 1000) || null,
    certified_at: decision.status === 'certified' ? timestamp : null,
    revoked_at: null,
    expires_at: cleanString(input.expiresAt || input.expires_at, '', 80) || null,
    created_at: timestamp,
    updated_at: timestamp
  };
  const existing = await querySingle(dataClient, MIX_RIGHTS_CERTIFICATION_TABLE, [['submission_id', submission.id], ['user_id', userId]]);
  if(existing.error) return { error:existing.error };
  if(existing.row){
    const updated = await updateRows(dataClient, MIX_RIGHTS_CERTIFICATION_TABLE, [['id', existing.row.id]], {
      ...payload,
      id:existing.row.id,
      created_at:existing.row.created_at || payload.created_at,
      updated_at:timestamp
    });
    if(updated.error) return { error:updated.error };
    return { updated:true, certification:sanitizeMixRightsCertification(updated.rows[0] || { ...existing.row, ...payload }) };
  }
  const inserted = await insertSingle(dataClient, MIX_RIGHTS_CERTIFICATION_TABLE, payload);
  if(inserted.error) return { error:inserted.error };
  return { created:true, certification:sanitizeMixRightsCertification(inserted.row) };
}

async function getOwnedMixRightsCertification(dataClient, userId, submissionId){
  const owned = await getOwnedMixSubmission(dataClient, userId, submissionId);
  if(owned.error || owned.forbidden) return owned;
  const result = await querySingle(dataClient, MIX_RIGHTS_CERTIFICATION_TABLE, [['submission_id', submissionId], ['user_id', userId]]);
  if(result.error) return { error:result.error };
  if(!result.row) return { unavailable:true };
  return { certification:sanitizeMixRightsCertification(result.row) };
}

async function listOwnedMixRightsCertifications(dataClient, userId, options = {}){
  const limit = Math.max(1, Math.min(100, Number(options.limit || 50)));
  const result = await queryRows(dataClient, MIX_RIGHTS_CERTIFICATION_TABLE, [['user_id', userId]], limit);
  if(result.error) return { error:result.error };
  const certifications = result.rows.map(sanitizeMixRightsCertification);
  certifications.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return { certifications };
}

async function revokeMixRightsCertification(dataClient, operatorUserId, submissionId, input = {}, now = new Date()){
  const certificationId = cleanIdentifier(input.certificationId || input.certification_id);
  const filters = certificationId ? [['id', certificationId]] : [['submission_id', cleanIdentifier(submissionId)]];
  const existing = await querySingle(dataClient, MIX_RIGHTS_CERTIFICATION_TABLE, filters);
  if(existing.error) return { error:existing.error };
  if(!existing.row) return { unavailable:true };
  const timestamp = nowIso(now);
  const updated = await updateRows(dataClient, MIX_RIGHTS_CERTIFICATION_TABLE, [['id', existing.row.id]], {
    certification_status:'revoked',
    public_result_allowed:false,
    replay_allowed:false,
    operator_review_status:'revoked',
    review_notes:cleanString(input.reason || input.reviewNotes || input.review_notes, 'Revoked by operator review.', 1000),
    revoked_by:String(operatorUserId || ''),
    revoked_at:timestamp,
    updated_at:timestamp
  });
  if(updated.error) return { error:updated.error };
  return { certification:sanitizeMixRightsCertification(updated.rows[0] || { ...existing.row, certification_status:'revoked', public_result_allowed:false, replay_allowed:false, revoked_at:timestamp }) };
}

function certificationExpired(certification, now = new Date()){
  if(!certification || !certification.expires_at) return false;
  const current = now instanceof Date ? now : new Date(now);
  return new Date(certification.expires_at) <= current;
}

async function getMixRightsPublicationGate(dataClient, submission, now = new Date()){
  if(!requiresDjMixRightsCertification(submission)) return { allowed:true, notRequired:true };
  const result = await querySingle(dataClient, MIX_RIGHTS_CERTIFICATION_TABLE, [['submission_id', submission.id], ['user_id', submission.user_id]]);
  if(result.error) return { error:result.error };
  if(!result.row) return { allowed:false, certificationRequired:true };
  const certification = sanitizeMixRightsCertification(result.row);
  if(result.row.certification_status === 'certified' && result.row.public_result_allowed === true && !certificationExpired(result.row, now)){
    return { allowed:true, certification };
  }
  if(result.row.certification_status === 'review_required') return { allowed:false, certificationRequired:true, reviewRequired:true, certification };
  return { allowed:false, certificationBlocked:true, certification };
}

async function checkMixRightsCertificationSchemaReadiness(dataClient){
  if(!dataClient) return { ready:false, schema:MIX_RIGHTS_CERTIFICATION_SCHEMA, status:'unconfigured', message:'Supabase service client is not configured.' };
  try{
    const result = await dataClient.from(MIX_RIGHTS_CERTIFICATION_TABLE).select('id').limit(1);
    if(result.error){
      const message = String(result.error.message || result.error);
      const missing = /mix_rights_certifications|relation|schema|does not exist|not found|cache/i.test(message);
      return {
        ready:false,
        schema:MIX_RIGHTS_CERTIFICATION_SCHEMA,
        status:missing ? 'migration_required' : 'failed',
        message:missing ? 'Mix rights certification schema 025 is not available.' : 'Mix rights certification schema readiness check failed.'
      };
    }
    return { ready:true, schema:MIX_RIGHTS_CERTIFICATION_SCHEMA, status:'ready', message:'Mix rights certification schema 025 is available.' };
  }catch(err){
    return { ready:false, schema:MIX_RIGHTS_CERTIFICATION_SCHEMA, status:'failed', message:'Mix rights certification schema readiness check failed.' };
  }
}

module.exports = {
  MIX_RIGHTS_CERTIFICATION_SCHEMA,
  MIX_RIGHTS_CERTIFICATION_TABLE,
  CERTIFICATION_STATUSES,
  checkMixRightsCertificationSchemaReadiness,
  certifyMixRights,
  getMixRightsPublicationGate,
  getOwnedMixRightsCertification,
  listOwnedMixRightsCertifications,
  requiresDjMixRightsCertification,
  revokeMixRightsCertification,
  sanitizeMixRightsCertification
};
