// Practice log: one row per saved practice session, owned by the signed-in DJ.
// Saving is idempotent on the browser's own session id so retries and multi-device
// merges never create duplicates.
const crypto = require('crypto');

const PRACTICE_SESSION_TABLE = 'practice_sessions';
const PRACTICE_SESSION_SCHEMA = '030_create_practice_sessions';
const MAX_PAGE = 100;

function cleanString(value, max = 160){
  return String(value == null ? '' : value).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max);
}
function cleanId(value){
  const text = cleanString(value, 128);
  return /^[A-Za-z0-9._:-]{1,128}$/.test(text) ? text : '';
}
function boundedNumber(value, min, max){
  const n = Number(value);
  if(!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n * 100) / 100));
}
function isoOrNull(value){
  if(value == null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Accepts the app's two shapes: [{label, score}] (preview ratings) and {timing:{score}} (judged results).
function sanitizeBreakdown(value){
  const items = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.entries(value).map(([key, item]) => ({ key, ...(item && typeof item === 'object' ? item : { score:item }) }))
      : [];
  return items.slice(0, 16).map(item => {
    const label = cleanString(item && (item.label || item.name || item.key), 60);
    const key = cleanString(item && (item.key || item.id || label), 60).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const score = boundedNumber(item && item.score, 0, 1000);
    if(!key || score == null || (item && item.available === false)) return null;
    const max = boundedNumber(item && (item.max || item.maxScore), 1, 1000);
    return { key, label:label || key, score, max:max || null };
  }).filter(Boolean);
}

function sanitizePracticeSessionInput(input = {}){
  const clientSessionId = cleanId(input.clientSessionId || input.id || input.resultKey);
  if(!clientSessionId) return { validationError:'A practice session id is required' };
  const recordedAt = isoOrNull(input.recordedAt || input.completedAt || input.savedAt);
  if(!recordedAt) return { validationError:'A practice session time is required' };
  return {
    session:{
      client_session_id:clientSessionId,
      title:cleanString(input.title, 160) || 'Practice session',
      session_type:cleanString(input.type || input.sessionType, 60) || 'Practice',
      genre:cleanString(input.genre, 60) || 'Global',
      source:input.source === 'battle' ? 'battle' : 'practice',
      score:boundedNumber(input.score, 0, 1000),
      max_score:boundedNumber(input.maxScore, 1, 1000),
      breakdown:sanitizeBreakdown(input.breakdown),
      recording_track_id:cleanId(input.recordingTrackId) || null,
      recorded_at:recordedAt
    }
  };
}

function sanitizePracticeSession(row){
  if(!row) return null;
  return {
    id:row.client_session_id,
    serverId:row.id,
    title:row.title,
    type:row.session_type,
    genre:row.genre,
    source:row.source,
    score:row.score == null ? null : Number(row.score),
    maxScore:row.max_score == null ? null : Number(row.max_score),
    breakdown:Array.isArray(row.breakdown) ? row.breakdown : [],
    recordingTrackId:row.recording_track_id || null,
    recordedAt:row.recorded_at,
    createdAt:row.created_at || null
  };
}

function serverIdFor(userId, clientSessionId){
  return `ps_${crypto.createHash('sha256').update(`${userId}:${clientSessionId}`).digest('hex').slice(0, 24)}`;
}

async function savePracticeSession(dataClient, userId, input = {}, now = new Date()){
  const owner = cleanId(userId);
  if(!owner) return { forbidden:true };
  const parsed = sanitizePracticeSessionInput(input);
  if(parsed.validationError) return parsed;
  const id = serverIdFor(owner, parsed.session.client_session_id);
  const existing = await dataClient.from(PRACTICE_SESSION_TABLE).select('*').eq('id', id).limit(1);
  if(existing.error) return { error:existing.error };
  const found = (existing.data || [])[0];
  if(found){
    if(String(found.user_id) !== owner) return { forbidden:true };
    // A later save may add the recording link; nothing else changes on a duplicate.
    if(parsed.session.recording_track_id && !found.recording_track_id){
      const updated = await dataClient.from(PRACTICE_SESSION_TABLE).update({ recording_track_id:parsed.session.recording_track_id, updated_at:now.toISOString() }).eq('id', id).eq('user_id', owner).select('*').single();
      if(updated.error) return { error:updated.error };
      return { duplicate:true, session:sanitizePracticeSession(updated.data || { ...found, recording_track_id:parsed.session.recording_track_id }) };
    }
    return { duplicate:true, session:sanitizePracticeSession(found) };
  }
  const row = { id, user_id:owner, ...parsed.session, created_at:now.toISOString(), updated_at:now.toISOString() };
  const inserted = await dataClient.from(PRACTICE_SESSION_TABLE).insert([row]).select('*').single();
  if(inserted.error) return { error:inserted.error };
  return { created:true, session:sanitizePracticeSession(inserted.data || row) };
}

async function listPracticeSessions(dataClient, userId, options = {}){
  const owner = cleanId(userId);
  if(!owner) return { forbidden:true };
  const limit = Math.max(1, Math.min(MAX_PAGE, Number(options.limit) || 50));
  const before = isoOrNull(options.before);
  let query = dataClient.from(PRACTICE_SESSION_TABLE).select('*').eq('user_id', owner);
  const serverFiltersBefore = Boolean(before && typeof query.lt === 'function');
  if(serverFiltersBefore) query = query.lt('recorded_at', before);
  if(typeof query.order === 'function') query = query.order('recorded_at', { ascending:false });
  if(typeof query.limit === 'function') query = query.limit(limit + 1);
  const result = await query;
  if(result.error) return { error:result.error };
  let rows = (result.data || []).filter(row => String(row.user_id) === owner);
  const time = value => new Date(value).getTime() || 0;
  if(before && !serverFiltersBefore) rows = rows.filter(row => time(row.recorded_at) < time(before));
  rows.sort((a, b) => time(b.recorded_at) - time(a.recorded_at));
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).map(sanitizePracticeSession);
  return { sessions:page, pagination:{ limit, hasMore, nextBefore:hasMore && page.length ? page[page.length - 1].recordedAt : null } };
}

// Rename: only the title changes, and only on the signed-in DJ's own row.
async function renamePracticeSession(dataClient, userId, clientSessionId, input = {}, now = new Date()){
  const owner = cleanId(userId);
  if(!owner) return { forbidden:true };
  const clientId = cleanId(clientSessionId);
  if(!clientId) return { validationError:'A practice session id is required' };
  const title = cleanString(input.title, 160);
  if(!title) return { validationError:'Give the session a name' };
  const id = serverIdFor(owner, clientId);
  const existing = await dataClient.from(PRACTICE_SESSION_TABLE).select('*').eq('id', id).eq('user_id', owner).limit(1);
  if(existing.error) return { error:existing.error };
  const found = (existing.data || []).find(row => String(row.user_id) === owner);
  if(!found) return { notFound:true };
  const updated = await dataClient.from(PRACTICE_SESSION_TABLE).update({ title, updated_at:now.toISOString() }).eq('id', id).eq('user_id', owner).select('*');
  if(updated.error) return { error:updated.error };
  return { renamed:true, session:sanitizePracticeSession((updated.data || [])[0] || { ...found, title }) };
}

// Delete: scoped to the owner, so another DJ's id simply isn't found.
async function deletePracticeSession(dataClient, userId, clientSessionId){
  const owner = cleanId(userId);
  if(!owner) return { forbidden:true };
  const clientId = cleanId(clientSessionId);
  if(!clientId) return { validationError:'A practice session id is required' };
  const id = serverIdFor(owner, clientId);
  const existing = await dataClient.from(PRACTICE_SESSION_TABLE).select('*').eq('id', id).eq('user_id', owner).limit(1);
  if(existing.error) return { error:existing.error };
  const found = (existing.data || []).find(row => String(row.user_id) === owner);
  if(!found) return { notFound:true };
  const removed = await dataClient.from(PRACTICE_SESSION_TABLE).delete().eq('id', id).eq('user_id', owner);
  if(removed && removed.error) return { error:removed.error };
  return { deleted:true, id:clientId };
}

async function checkPracticeSessionSchemaReadiness(dataClient){
  if(!dataClient) return { ready:false, schema:PRACTICE_SESSION_SCHEMA, status:'unconfigured' };
  const result = await dataClient.from(PRACTICE_SESSION_TABLE).select('id').limit(1);
  if(result.error) return { ready:false, schema:PRACTICE_SESSION_SCHEMA, status:'migration_required', message:'Run server/sql/030_create_practice_sessions.sql in Supabase.' };
  return { ready:true, schema:PRACTICE_SESSION_SCHEMA, status:'ready' };
}

module.exports = {
  PRACTICE_SESSION_TABLE,
  PRACTICE_SESSION_SCHEMA,
  sanitizeBreakdown,
  sanitizePracticeSession,
  sanitizePracticeSessionInput,
  savePracticeSession,
  listPracticeSessions,
  renamePracticeSession,
  deletePracticeSession,
  checkPracticeSessionSchemaReadiness
};
