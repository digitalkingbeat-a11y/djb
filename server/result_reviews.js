// Oct 20: "Request a review" of a judged battle result. The DJ gives a reason and an optional
// note; the result shows "Under review" until an operator confirms the score or rescores it.
const { cleanText, newId, isMissingTable } = require('./social_helpers');
const { getOwnedBattleResult } = require('./battle_result_history');
const { notifyQuietly } = require('./social_notifications');

const TABLE = 'result_review_requests';
const SCHEMA = '041_create_result_review_requests';
const REVIEW_REASONS = Object.freeze({
  timing_misread:'The timing / beatmatching score looks wrong',
  wrong_track:'The wrong audio or track was judged',
  audio_problem:'The upload had an audio problem (silence, clipping, cut off)',
  scoring_rule:'A scoring rule was applied wrongly',
  other:'Something else'
});
const OPEN = ['pending'];
const NOTE_MAX = 600;

const publicReview = (row, { operator = false } = {}) => {
  const out = {
    id:row.id, submissionId:row.submission_id, battleTitle:row.battle_title || 'Battle', reason:row.reason, reasonLabel:REVIEW_REASONS[row.reason] || 'Something else',
    note:row.note || '', status:row.status, originalScore:row.original_score == null ? null : Number(row.original_score),
    newScore:row.new_score == null ? null : Number(row.new_score), decisionNote:row.decision_note || '', createdAt:row.created_at, decidedAt:row.decided_at || null
  };
  if(operator) out.requesterPublicProfileId = row.requester_public_profile_id || null;
  return out;
};

async function requestReview(dataClient, userId, submissionId, body = {}, now = new Date()){
  const reason = String(body.reason || '');
  if(!REVIEW_REASONS[reason]) return { validationError:'Pick a reason for the review' };
  const note = cleanText(body.note, NOTE_MAX);
  if(reason === 'other' && note.length < 10) return { validationError:'Tell the judges what looks wrong (at least 10 characters)' };
  const owned = await getOwnedBattleResult(dataClient, userId, submissionId);
  if(owned.error) return { error:owned.error };
  if(owned.forbidden) return { forbidden:true };
  if(owned.unavailable || !owned.result) return { notFound:true };
  const existing = await dataClient.from(TABLE).select('*').eq('submission_id', String(submissionId)).limit(20);
  if(existing.error) return isMissingTable(existing.error) ? { schemaMissing:true, schema:SCHEMA } : { error:existing.error };
  const rows = existing.data || [];
  const open = rows.find(r => OPEN.includes(r.status));
  if(open) return { duplicate:true, review:publicReview(open) };
  if(rows.length >= 2) return { validationError:'This result has already been reviewed twice. The decision is final.' };
  const at = now.toISOString();
  const row = {
    id:newId('review'), user_id:String(userId), submission_id:String(submissionId),
    requester_public_profile_id:owned.result.profile && owned.result.profile.publicProfileId || null,
    battle_title:cleanText(owned.result.battle && (owned.result.battle.title || owned.result.battle.name) || owned.result.title, 120) || 'Battle',
    reason, note, status:'pending', original_score:owned.result.score == null ? null : Number(owned.result.score),
    new_score:null, decision_note:null, decided_by:null, decided_at:null, created_at:at, updated_at:at
  };
  const ins = await dataClient.from(TABLE).insert([row]);
  if(ins && ins.error) return { error:ins.error };
  return { created:true, review:publicReview(row) };
}

async function listMyReviews(dataClient, userId){
  const r = await dataClient.from(TABLE).select('*').eq('user_id', String(userId)).limit(200);
  if(r.error) return isMissingTable(r.error) ? { schemaMissing:true, schema:SCHEMA } : { error:r.error };
  return { reviews:(r.data || []).map(row => publicReview(row)) };
}

async function listReviewQueue(dataClient, status = 'pending'){
  const r = await dataClient.from(TABLE).select('*').eq('status', status === 'decided' ? 'decided' : 'pending').limit(200);
  if(r.error) return isMissingTable(r.error) ? { schemaMissing:true, schema:SCHEMA } : { error:r.error };
  const rows = (r.data || []).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return { reviews:rows.map(row => publicReview(row, { operator:true })), reasons:REVIEW_REASONS };
}

// decision: 'confirm' (score stands) or 'rescore' (newScore 0–100).
async function decideReview(dataClient, operatorUserId, reviewId, body = {}, now = new Date()){
  const decision = body.decision;
  if(!['confirm', 'rescore'].includes(decision)) return { validationError:'Choose Confirm score or Rescore' };
  const newScore = decision === 'rescore' ? Number(body.newScore) : null;
  if(decision === 'rescore' && !(Number.isFinite(newScore) && newScore >= 0 && newScore <= 100)) return { validationError:'The new score must be between 0 and 100' };
  const found = await dataClient.from(TABLE).select('*').eq('id', String(reviewId)).limit(1);
  if(found.error) return isMissingTable(found.error) ? { schemaMissing:true, schema:SCHEMA } : { error:found.error };
  const row = (found.data || [])[0];
  if(!row) return { notFound:true };
  if(row.status !== 'pending') return { validationError:'This review was already decided' };
  const at = now.toISOString();
  const values = { status:'decided', outcome:decision === 'rescore' ? 'rescored' : 'confirmed', new_score:decision === 'rescore' ? Math.round(newScore) : null, decision_note:cleanText(body.note, NOTE_MAX) || null, decided_by:String(operatorUserId), decided_at:at, updated_at:at };
  const up = await dataClient.from(TABLE).update(values).eq('id', row.id).eq('status', 'pending');
  if(up && up.error) return { error:up.error };
  // Record the decision on the result itself, so every view of it can show the reviewed score.
  const sub = await dataClient.from('mix_submissions').select('*').eq('id', row.submission_id).limit(1);
  const subRow = sub && !sub.error && (sub.data || [])[0];
  if(subRow){
    const info = subRow.processing_info && typeof subRow.processing_info === 'object' ? subRow.processing_info : {};
    await dataClient.from('mix_submissions').update({ processing_info:{ ...info, resultReview:{ outcome:values.outcome, originalScore:row.original_score, newScore:values.new_score, decidedAt:at } } }).eq('id', row.submission_id);
  }
  await notifyQuietly(dataClient, { recipientUserId:row.user_id, type:'result_review_decided', subjectId:row.id, eventKey:`review-${row.id}`, destination:{ type:'battle_history' },
    summary:decision === 'rescore' ? `Review done: your "${row.battle_title}" score changed to ${values.new_score}/100` : `Review done: your "${row.battle_title}" score was confirmed` });
  return { review:publicReview({ ...row, ...values }, { operator:true }) };
}

module.exports = { TABLE, SCHEMA, REVIEW_REASONS, requestReview, listMyReviews, listReviewQueue, decideReview, publicReview };
