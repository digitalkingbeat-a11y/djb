// Comments pinned to a moment in a public battle result's mix ("1:42, that transition").
// Anyone can read comments on a public result; signed-in DJs can add, edit and delete their own.
const { cleanText, cleanId, newId, isMissingTable, profilesFor, blockedUserIdsFor, rateLimited } = require('./social_helpers');
const { getPublicBattleResult, verifiedResultId } = require('./battle_result_history');
const { notifyQuietly } = require('./social_notifications');

const TIMED_COMMENT_TABLE = 'result_timed_comments';
const TIMED_COMMENT_SCHEMA = '033_create_result_timed_comments';
const TIMED_COMMENT_MAX_LENGTH = 500;
const MAX_SECONDS = 4 * 60 * 60;

function validResultId(value){
  const id = cleanId(value, 80);
  return /^vr_[a-z0-9]+$/i.test(id) ? id : '';
}
function cleanSeconds(value){
  const n = Number(value);
  if(!Number.isFinite(n) || n < 0 || n > MAX_SECONDS) return null;
  return Math.round(n * 10) / 10;
}
function sanitizeTimedComment(row, viewerId, profiles){
  const profile = profiles.get(String(row.user_id)) || { displayName:'DJ' };
  return {
    id:String(row.id),
    atSeconds:Number(row.at_seconds) || 0,
    body:String(row.body || ''),
    createdAt:row.created_at,
    editedAt:row.edited_at || null,
    mine:viewerId != null && String(row.user_id) === String(viewerId),
    author:{ displayName:profile.displayName, publicProfileId:profile.publicProfileId }
  };
}

async function ensurePublicResult(dataClient, resultId, resolver = getPublicBattleResult){
  const found = await resolver(dataClient, resultId);
  if(found.error) return { error:found.error };
  if(found.notFound || found.unavailable) return { notFound:true };
  if(found.private) return { private:true };
  return { result:found.result };
}

async function listTimedComments(dataClient, resultIdInput, viewerId = null, options = {}){
  const resultId = validResultId(resultIdInput);
  if(!resultId) return { notFound:true };
  const gate = await ensurePublicResult(dataClient, resultId, options.resolver);
  if(gate.error || gate.notFound || gate.private) return gate;
  const query = dataClient.from(TIMED_COMMENT_TABLE).select('*').eq('verified_result_id', resultId);
  const result = typeof query.limit === 'function' ? await query.limit(500) : await query;
  if(result.error) return isMissingTable(result.error) ? { schemaMissing:true, schema:TIMED_COMMENT_SCHEMA } : { error:result.error };
  const blocked = viewerId ? await blockedUserIdsFor(dataClient, viewerId) : new Set();
  const rows = (result.data || [])
    .filter(row => (row.status || 'active') === 'active')
    .filter(row => !blocked.has(String(row.user_id)))
    .sort((a, b) => Number(a.at_seconds) - Number(b.at_seconds) || new Date(a.created_at) - new Date(b.created_at));
  const profiles = await profilesFor(dataClient, rows.map(row => row.user_id));
  return { comments:rows.map(row => sanitizeTimedComment(row, viewerId, profiles)), maxLength:TIMED_COMMENT_MAX_LENGTH };
}

function parseBody(input){
  const body = cleanText(input && input.body, TIMED_COMMENT_MAX_LENGTH + 1);
  if(!body) return { validationError:'Write a comment first' };
  if(body.length > TIMED_COMMENT_MAX_LENGTH) return { validationError:`Comments can be up to ${TIMED_COMMENT_MAX_LENGTH} characters` };
  return { body };
}

async function addTimedComment(dataClient, userId, resultIdInput, input = {}, now = new Date(), options = {}){
  const resultId = validResultId(resultIdInput);
  if(!resultId) return { notFound:true };
  const parsed = parseBody(input);
  if(parsed.validationError) return parsed;
  const atSeconds = cleanSeconds(input.atSeconds);
  if(atSeconds == null) return { validationError:'Pick a moment in the mix' };
  const gate = await ensurePublicResult(dataClient, resultId, options.resolver);
  if(gate.error || gate.notFound || gate.private) return gate;
  if(rateLimited(`timed:${userId}`, now.getTime(), 10, 60000)) return { rateLimited:true };
  const row = { id:newId('tc'), verified_result_id:resultId, user_id:String(userId), at_seconds:atSeconds, body:parsed.body, status:'active', created_at:now.toISOString(), updated_at:now.toISOString(), edited_at:null };
  const inserted = await dataClient.from(TIMED_COMMENT_TABLE).insert([row]).select('*').single();
  if(inserted.error) return isMissingTable(inserted.error) ? { schemaMissing:true, schema:TIMED_COMMENT_SCHEMA } : { error:inserted.error };
  const profiles = await profilesFor(dataClient, [userId]);
  const owner = await resultOwnerUserId(dataClient, resultId);
  if(owner && owner !== String(userId)){
    const who = (profiles.get(String(userId)) || {}).displayName || 'A DJ';
    const m = Math.floor(atSeconds / 60), sec = String(Math.floor(atSeconds % 60)).padStart(2, '0');
    await notifyQuietly(dataClient, {
      recipientUserId:owner, actorUserId:userId, type:'timed_comment_received', subjectId:row.id, eventKey:`timed:${row.id}`,
      destination:{ type:'verified_result', verifiedResultId:resultId, label:'Open your mix' },
      summary:`${who} commented at ${m}:${sec} in your mix: "${parsed.body.slice(0, 80)}${parsed.body.length > 80 ? '…' : ''}"`, now
    });
  }
  return { created:true, comment:sanitizeTimedComment(inserted.data || row, userId, profiles) };
}

// The DJ whose mix this public result belongs to (never sent to the browser).
async function resultOwnerUserId(dataClient, resultId){
  try{
    const subs = await dataClient.from('mix_submissions').select('*').eq('status', 'completed').limit(500);
    if(subs.error) return null;
    const row = (subs.data || []).find(s => verifiedResultId(s) === resultId);
    return row && row.user_id ? String(row.user_id) : null;
  }catch(e){ return null; }
}

async function ownedComment(dataClient, userId, commentId){
  const id = cleanId(commentId);
  if(!id) return { notFound:true };
  const found = await dataClient.from(TIMED_COMMENT_TABLE).select('*').eq('id', id).limit(1);
  if(found.error) return { error:found.error };
  const row = (found.data || [])[0];
  if(!row || (row.status || 'active') !== 'active') return { notFound:true };
  if(String(row.user_id) !== String(userId)) return { forbidden:true };
  return { row };
}

async function editTimedComment(dataClient, userId, commentId, input = {}, now = new Date()){
  const owned = await ownedComment(dataClient, userId, commentId);
  if(owned.error || owned.notFound || owned.forbidden) return owned;
  const parsed = parseBody(input);
  if(parsed.validationError) return parsed;
  const patch = { body:parsed.body, edited_at:now.toISOString(), updated_at:now.toISOString() };
  const updated = await dataClient.from(TIMED_COMMENT_TABLE).update(patch).eq('id', owned.row.id).eq('user_id', String(userId)).select('*');
  if(updated.error) return { error:updated.error };
  const profiles = await profilesFor(dataClient, [userId]);
  return { updated:true, comment:sanitizeTimedComment({ ...owned.row, ...patch }, userId, profiles) };
}

async function deleteTimedComment(dataClient, userId, commentId, now = new Date()){
  const owned = await ownedComment(dataClient, userId, commentId);
  if(owned.error || owned.notFound || owned.forbidden) return owned;
  const updated = await dataClient.from(TIMED_COMMENT_TABLE).update({ status:'deleted', updated_at:now.toISOString() }).eq('id', owned.row.id).eq('user_id', String(userId));
  if(updated.error) return { error:updated.error };
  return { deleted:true, id:owned.row.id };
}

async function timedCommentReportTarget(dataClient, userId, commentId){
  const id = cleanId(commentId);
  if(!id) return { notFound:true };
  const found = await dataClient.from(TIMED_COMMENT_TABLE).select('*').eq('id', id).limit(1);
  if(found.error) return { error:found.error };
  const row = (found.data || [])[0];
  if(!row || (row.status || 'active') !== 'active') return { notFound:true };
  if(String(row.user_id) === String(userId)) return { forbidden:true };
  return { target:row, ownerUserId:row.user_id };
}

module.exports = { TIMED_COMMENT_TABLE, TIMED_COMMENT_SCHEMA, TIMED_COMMENT_MAX_LENGTH, listTimedComments, addTimedComment, editTimedComment, deleteTimedComment, timedCommentReportTarget, cleanSeconds };
