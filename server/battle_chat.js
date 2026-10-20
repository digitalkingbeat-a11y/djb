// Battle room chat: short text messages between the DJs entered in one battle.
// Only DJs with an active entry can read or send. Blocked pairs never see each other's
// messages and cannot send while a block exists. Text is stored plain and capped.
const { cleanText, cleanId, newId, isMissingTable, profilesFor, blockedUserIdsFor, rateLimited } = require('./social_helpers');

const { notifyQuietly } = require('./social_notifications');

const CHAT_TABLE = 'battle_chat_messages';
const CHAT_SCHEMA = '031_create_battle_chat_messages';
const CHAT_MAX_LENGTH = 280;
const CHAT_PAGE = 100;

async function battleParticipants(dataClient, battleId){
  const result = await dataClient.from('battle_entries').select('*').eq('battle_id', battleId);
  if(result.error) return { error:result.error };
  return { userIds:(result.data || []).filter(row => (row.status || 'active') === 'active').map(row => String(row.user_id)) };
}

function sanitizeMessage(row, viewerId, profiles){
  const profile = profiles.get(String(row.user_id)) || { displayName:'DJ' };
  return {
    id:String(row.id),
    body:String(row.body || ''),
    createdAt:row.created_at,
    mine:String(row.user_id) === String(viewerId),
    author:{ displayName:profile.displayName, publicProfileId:profile.publicProfileId }
  };
}

async function listBattleChat(dataClient, viewerId, battleIdInput, options = {}){
  const battleId = cleanId(battleIdInput);
  if(!battleId) return { validationError:'A battle id is required' };
  const parts = await battleParticipants(dataClient, battleId);
  if(parts.error) return parts;
  if(!parts.userIds.includes(String(viewerId))) return { forbidden:true };
  let query = dataClient.from(CHAT_TABLE).select('*').eq('battle_id', battleId);
  if(typeof query.order === 'function') query = query.order('created_at', { ascending:true });
  if(typeof query.limit === 'function') query = query.limit(500);
  const result = await query;
  if(result.error) return isMissingTable(result.error) ? { schemaMissing:true, schema:CHAT_SCHEMA } : { error:result.error };
  const blocked = await blockedUserIdsFor(dataClient, viewerId);
  const after = options.after ? new Date(options.after).getTime() : 0;
  let rows = (result.data || [])
    .filter(row => (row.status || 'active') === 'active')
    .filter(row => !blocked.has(String(row.user_id)))
    .filter(row => !after || new Date(row.created_at).getTime() > after)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  rows = rows.slice(-CHAT_PAGE);
  const profiles = await profilesFor(dataClient, rows.map(row => row.user_id));
  const blockedInRoom = parts.userIds.some(id => id !== String(viewerId) && blocked.has(id));
  return { messages:rows.map(row => sanitizeMessage(row, viewerId, profiles)), canSend:!blockedInRoom, maxLength:CHAT_MAX_LENGTH };
}

async function postBattleChat(dataClient, userId, battleIdInput, input = {}, now = new Date()){
  const battleId = cleanId(battleIdInput);
  if(!battleId) return { validationError:'A battle id is required' };
  const raw = String(input.body == null ? '' : input.body);
  const body = cleanText(raw, CHAT_MAX_LENGTH + 1);
  if(!body) return { validationError:'Type a message first' };
  if(body.length > CHAT_MAX_LENGTH) return { validationError:`Messages can be up to ${CHAT_MAX_LENGTH} characters` };
  const parts = await battleParticipants(dataClient, battleId);
  if(parts.error) return parts;
  if(!parts.userIds.includes(String(userId))) return { forbidden:true };
  const blocked = await blockedUserIdsFor(dataClient, userId);
  if(parts.userIds.some(id => id !== String(userId) && blocked.has(id))) return { blocked:true };
  if(rateLimited(`chat:${userId}`, now.getTime(), 8, 20000)) return { rateLimited:true };
  const row = { id:newId('bcm'), battle_id:battleId, user_id:String(userId), body, status:'active', created_at:now.toISOString() };
  const inserted = await dataClient.from(CHAT_TABLE).insert([row]).select('*').single();
  if(inserted.error) return isMissingTable(inserted.error) ? { schemaMissing:true, schema:CHAT_SCHEMA } : { error:inserted.error };
  const profiles = await profilesFor(dataClient, [userId]);
  // Activity bell: one notification per opponent per 10 minutes of chatting, so it doesn't spam.
  const bucket = Math.floor(now.getTime() / (10 * 60 * 1000));
  const sender = (profiles.get(String(userId)) || {}).displayName || 'Your opponent';
  for(const other of parts.userIds.filter(id => id !== String(userId))){
    await notifyQuietly(dataClient, {
      recipientUserId:other, actorUserId:userId, type:'battle_chat_message', subjectId:battleId, eventKey:`chat:${battleId}:${bucket}`,
      destination:{ type:'battle_room', battleId, label:'Open battle chat' },
      summary:`${sender} sent you a message in battle chat: "${body.slice(0, 80)}${body.length > 80 ? '…' : ''}"`, now
    });
  }
  return { created:true, message:sanitizeMessage(inserted.data || row, userId, profiles) };
}

// Unsend: a DJ can take back their own message. It disappears for everyone on the next refresh.
async function unsendBattleChat(dataClient, userId, battleIdInput, messageIdInput, now = new Date()){
  const battleId = cleanId(battleIdInput);
  const messageId = cleanId(messageIdInput);
  if(!battleId || !messageId) return { notFound:true };
  const found = await dataClient.from(CHAT_TABLE).select('*').eq('id', messageId).limit(1);
  if(found.error) return isMissingTable(found.error) ? { schemaMissing:true, schema:CHAT_SCHEMA } : { error:found.error };
  const row = (found.data || [])[0];
  if(!row || String(row.battle_id) !== battleId || (row.status || 'active') === 'deleted') return { notFound:true };
  if(String(row.user_id) !== String(userId)) return { forbidden:true };
  const up = await dataClient.from(CHAT_TABLE).update({ status:'deleted' }).eq('id', messageId).eq('user_id', String(userId));
  if(up.error) return { error:up.error };
  return { unsent:true, id:messageId, at:now.toISOString() };
}

// Used by community reports: a chat message can be reported only by another DJ in that battle.
async function chatMessageReportTarget(dataClient, userId, messageId){
  const id = cleanId(messageId);
  if(!id) return { notFound:true };
  const found = await dataClient.from(CHAT_TABLE).select('*').eq('id', id).limit(1);
  if(found.error) return { error:found.error };
  const row = (found.data || [])[0];
  if(!row || (row.status || 'active') !== 'active') return { notFound:true };
  if(String(row.user_id) === String(userId)) return { forbidden:true };
  const parts = await battleParticipants(dataClient, row.battle_id);
  if(parts.error) return parts;
  if(!parts.userIds.includes(String(userId))) return { forbidden:true };
  return { target:row, ownerUserId:row.user_id };
}

module.exports = { CHAT_TABLE, CHAT_SCHEMA, CHAT_MAX_LENGTH, listBattleChat, postBattleChat, unsendBattleChat, chatMessageReportTarget, battleParticipants };
