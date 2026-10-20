// Oct 19c: direct messages, Find DJs search, live battle watching, shared crate tracklists and
// weekly practice goals. All tables are read and written by the server with the service role;
// browsers only ever see display names and public profile ids, never auth user ids.
const { cleanText, cleanId, newId, isMissingTable, profilesFor, blockedUserIdsFor, rateLimited, stablePublicProfileId } = require('./social_helpers');
const { notifyQuietly } = require('./social_notifications');
const { isFinishedBattle, recordCrowdVote } = require('./battle_crowd_votes');

const PROFILE_TABLE = 'dj_progression_profiles';
const DM_TABLE = 'direct_messages';
const DM_SCHEMA = '036_create_direct_messages';
const SEARCH_SCHEMA = '037_add_dj_search_fields';
const TRACKLIST_TABLE = 'shared_crate_tracklists';
const TRACKLIST_SCHEMA = '038_create_shared_crate_tracklists';
const GOAL_TABLE = 'practice_goals';
const GOAL_SCHEMA = '039_create_practice_goals';
const DM_MAX_LENGTH = 1000;
const TRACKLIST_MAX_TRACKS = 200;
const BELTS = ['White', 'Yellow', 'Orange', 'Green', 'Blue', 'Purple', 'Brown', 'Red', 'Black'];

const pairKey = (a, b) => [String(a), String(b)].sort().join('|');
const missing = (error, schema) => isMissingTable(error) ? { schemaMissing:true, schema } : { error };

async function allProfiles(dataClient, limit = 2000){
  const result = await dataClient.from(PROFILE_TABLE).select('*').limit(limit);
  if(result.error) return { error:result.error };
  return { rows:result.data || [] };
}
function profilePublicId(row){
  const pub = row.public_profile && typeof row.public_profile === 'object' ? row.public_profile : {};
  return row.public_profile_id || pub.publicProfileId || stablePublicProfileId(String(row.user_id));
}
// Turns a public profile id back into an auth user id (server side only).
async function userIdForPublicProfile(dataClient, publicProfileIdInput){
  const publicProfileId = cleanId(publicProfileIdInput);
  if(!publicProfileId) return null;
  const all = await allProfiles(dataClient);
  if(all.error) return null;
  const row = all.rows.find(r => profilePublicId(r) === publicProfileId);
  return row ? String(row.user_id) : null;
}
async function mutedUserIdsFor(dataClient, userId){
  const set = new Set();
  const result = await dataClient.from('dj_notification_mutes').select('*').eq('user_id', String(userId)).limit(500);
  if(!result || result.error) return set;
  (result.data || []).forEach(row => { if(row.active === false || row.muted === false) return;
    if(row.muted_user_id) set.add(String(row.muted_user_id));
    if(row.muted_public_profile_id) set.add(String(row.muted_public_profile_id)); });
  return set;
}

/* ------------------------------ 1. Direct messages ------------------------------ */
function sanitizeDm(row, viewerId){
  return { id:String(row.id), body:String(row.body || ''), createdAt:row.created_at, mine:String(row.sender_user_id) === String(viewerId), read:Boolean(row.read_at) };
}
async function myDmRows(dataClient, userId){
  const sent = await dataClient.from(DM_TABLE).select('*').eq('sender_user_id', String(userId)).limit(2000);
  if(sent.error) return missing(sent.error, DM_SCHEMA);
  const got = await dataClient.from(DM_TABLE).select('*').eq('recipient_user_id', String(userId)).limit(2000);
  if(got.error) return missing(got.error, DM_SCHEMA);
  return { rows:[...(sent.data || []), ...(got.data || [])].filter(r => (r.status || 'active') === 'active') };
}
async function listConversations(dataClient, userId){
  const mine = await myDmRows(dataClient, userId);
  if(!mine.rows) return mine;
  const blocked = await blockedUserIdsFor(dataClient, userId);
  const muted = await mutedUserIdsFor(dataClient, userId);
  const byOther = new Map();
  mine.rows.forEach(row => {
    const other = String(row.sender_user_id) === String(userId) ? String(row.recipient_user_id) : String(row.sender_user_id);
    if(blocked.has(other)) return;
    const c = byOther.get(other) || { other, last:null, unread:0 };
    if(!c.last || new Date(row.created_at) > new Date(c.last.created_at)) c.last = row;
    if(String(row.recipient_user_id) === String(userId) && !row.read_at) c.unread += 1;
    byOther.set(other, c);
  });
  const profiles = await profilesFor(dataClient, [...byOther.keys()]);
  const conversations = [...byOther.values()]
    .sort((a, b) => new Date(b.last.created_at) - new Date(a.last.created_at))
    .map(c => {
      const p = profiles.get(c.other) || { displayName:'DJ', publicProfileId:stablePublicProfileId(c.other) };
      return { with:{ displayName:p.displayName, publicProfileId:p.publicProfileId, belt:p.belt || null }, lastMessage:sanitizeDm(c.last, userId), unread:c.unread, muted:muted.has(c.other) || muted.has(String(p.publicProfileId)) };
    });
  return { conversations, unread:conversations.reduce((n, c) => n + c.unread, 0) };
}
async function readConversation(dataClient, userId, publicProfileId, now = new Date()){
  const other = await userIdForPublicProfile(dataClient, publicProfileId);
  if(!other || other === String(userId)) return { notFound:true };
  const blocked = await blockedUserIdsFor(dataClient, userId);
  const mine = await myDmRows(dataClient, userId);
  if(!mine.rows) return mine;
  const key = pairKey(userId, other);
  const rows = mine.rows.filter(r => r.conversation_key === key).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).slice(-200);
  const unreadIds = rows.filter(r => String(r.recipient_user_id) === String(userId) && !r.read_at).map(r => r.id);
  for(const id of unreadIds){
    await dataClient.from(DM_TABLE).update({ read_at:now.toISOString() }).eq('id', id).eq('recipient_user_id', String(userId));
  }
  const profiles = await profilesFor(dataClient, [other]);
  const muted = await mutedUserIdsFor(dataClient, userId);
  const p = profiles.get(other);
  return {
    with:{ displayName:p.displayName, publicProfileId:p.publicProfileId, belt:p.belt || null },
    messages:blocked.has(other) ? [] : rows.map(r => sanitizeDm(r, userId)),
    canSend:!blocked.has(other), blocked:blocked.has(other), muted:muted.has(other) || muted.has(String(p.publicProfileId)), maxLength:DM_MAX_LENGTH
  };
}
async function sendDirectMessage(dataClient, userId, publicProfileId, input = {}, now = new Date()){
  const body = cleanText(input.body, DM_MAX_LENGTH + 1);
  if(!body) return { validationError:'Type a message first' };
  if(body.length > DM_MAX_LENGTH) return { validationError:`Messages can be up to ${DM_MAX_LENGTH} characters` };
  const other = await userIdForPublicProfile(dataClient, publicProfileId);
  if(!other) return { notFound:true };
  if(other === String(userId)) return { validationError:'You can\'t message yourself' };
  const blocked = await blockedUserIdsFor(dataClient, userId);
  if(blocked.has(other)) return { blocked:true };
  if(rateLimited(`dm:${userId}`, now.getTime(), 10, 30000)) return { rateLimited:true };
  const row = { id:newId('dm'), conversation_key:pairKey(userId, other), sender_user_id:String(userId), recipient_user_id:other, body, status:'active', read_at:null, created_at:now.toISOString() };
  const inserted = await dataClient.from(DM_TABLE).insert([row]).select('*').single();
  if(inserted.error) return missing(inserted.error, DM_SCHEMA);
  // Muting a DJ keeps their messages coming but silences the Activity bell for them.
  const theirMutes = await mutedUserIdsFor(dataClient, other);
  const profiles = await profilesFor(dataClient, [userId]);
  const me = profiles.get(String(userId)) || { displayName:'A DJ' };
  if(!theirMutes.has(String(userId)) && !theirMutes.has(String(me.publicProfileId))){
    const bucket = Math.floor(now.getTime() / (10 * 60 * 1000));
    await notifyQuietly(dataClient, {
      recipientUserId:other, actorUserId:userId, type:'direct_message', subjectId:row.conversation_key, eventKey:`dm:${row.conversation_key}:${bucket}`,
      destination:{ type:'messages', publicProfileId:me.publicProfileId, label:'Open messages' },
      summary:`${me.displayName} sent you a message: "${body.slice(0, 80)}${body.length > 80 ? '…' : ''}"`, now
    });
  }
  return { created:true, message:sanitizeDm(inserted.data || row, userId) };
}
async function unsendDirectMessage(dataClient, userId, messageIdInput){
  const id = cleanId(messageIdInput);
  if(!id) return { notFound:true };
  const found = await dataClient.from(DM_TABLE).select('*').eq('id', id).limit(1);
  if(found.error) return missing(found.error, DM_SCHEMA);
  const row = (found.data || [])[0];
  if(!row || (row.status || 'active') !== 'active') return { notFound:true };
  if(String(row.sender_user_id) !== String(userId)) return { forbidden:true };
  const up = await dataClient.from(DM_TABLE).update({ status:'deleted' }).eq('id', id).eq('sender_user_id', String(userId));
  if(up.error) return { error:up.error };
  return { unsent:true, id };
}
// Only the person who received a message can report it.
async function directMessageReportTarget(dataClient, userId, messageId){
  const id = cleanId(messageId);
  if(!id) return { notFound:true };
  const found = await dataClient.from(DM_TABLE).select('*').eq('id', id).limit(1);
  if(found.error) return { error:found.error };
  const row = (found.data || [])[0];
  if(!row || (row.status || 'active') !== 'active') return { notFound:true };
  if(String(row.recipient_user_id) !== String(userId)) return { forbidden:true };
  return { target:row, ownerUserId:row.sender_user_id };
}

/* ------------------------------ 2. Find DJs ------------------------------ */
function searchCard(row){
  const pub = row.public_profile && typeof row.public_profile === 'object' ? row.public_profile : {};
  return {
    publicProfileId:profilePublicId(row),
    displayName:cleanText(row.display_name || pub.displayName, 80) || 'DJ',
    city:cleanText(row.hometown || pub.hometown || row.country || pub.country, 80) || null,
    genre:cleanText(row.genre || pub.genre, 60) || null,
    belt:cleanText(row.belt || pub.belt, 40) || 'White',
    wins:Number(row.wins) || 0
  };
}
async function searchDjs(dataClient, viewerId, query = {}){
  const q = cleanText(query.q, 60).toLowerCase();
  const city = cleanText(query.city, 60).toLowerCase();
  const genre = cleanText(query.genre, 60).toLowerCase();
  const belt = BELTS.find(b => b.toLowerCase() === cleanText(query.belt, 20).toLowerCase()) || '';
  const all = await allProfiles(dataClient);
  if(all.error) return { error:all.error };
  const blocked = viewerId ? await blockedUserIdsFor(dataClient, viewerId) : new Set();
  const results = all.rows
    .filter(r => String(r.visibility || 'public') === 'public' && r.searchable !== false)
    .filter(r => !viewerId || String(r.user_id) !== String(viewerId))
    .filter(r => !blocked.has(String(r.user_id)))
    .map(searchCard)
    .filter(c => !q || c.displayName.toLowerCase().includes(q))
    .filter(c => !city || String(c.city || '').toLowerCase().includes(city))
    .filter(c => !genre || String(c.genre || '').toLowerCase().includes(genre))
    .filter(c => !belt || c.belt === belt)
    .sort((a, b) => b.wins - a.wins || a.displayName.localeCompare(b.displayName))
    .slice(0, 50);
  return { results };
}
async function updateSearchProfile(dataClient, userId, input = {}, now = new Date()){
  const patch = { updated_at:now.toISOString() };
  if('hometown' in input) patch.hometown = cleanText(input.hometown, 60) || null;
  if('genre' in input) patch.genre = cleanText(input.genre, 40) || null;
  if('searchable' in input) patch.searchable = input.searchable !== false;
  const found = await dataClient.from(PROFILE_TABLE).select('*').eq('user_id', String(userId)).limit(1);
  if(found.error) return { error:found.error };
  const result = (found.data || [])[0]
    ? await dataClient.from(PROFILE_TABLE).update(patch).eq('user_id', String(userId))
    : await dataClient.from(PROFILE_TABLE).insert([{ user_id:String(userId), ...patch }]);
  if(result.error) return /column|schema cache/i.test(String(result.error.message || result.error)) ? { schemaMissing:true, schema:SEARCH_SCHEMA } : { error:result.error };
  return { saved:true, profile:{ hometown:patch.hometown, genre:patch.genre, searchable:patch.searchable } };
}

/* ------------------------------ 3. Watch battles live ------------------------------ */
const WATCH_TTL_MS = 45000;
const watchers = new Map(); // battleId -> Map(viewerKey -> lastSeen)
function watchingCount(battleId, now = Date.now()){
  const m = watchers.get(battleId);
  if(!m) return 0;
  for(const [k, t] of m) if(now - t > WATCH_TTL_MS) m.delete(k);
  return m.size;
}
function heartbeat(battleId, viewerKeyInput, now = Date.now()){
  const key = cleanId(viewerKeyInput, 64);
  if(!key) return { validationError:'A viewer key is required' };
  if(!watchers.has(battleId)) watchers.set(battleId, new Map());
  const m = watchers.get(battleId);
  if(!m.has(key) && m.size >= 5000) return { watching:watchingCount(battleId, now) };
  m.set(key, now);
  return { watching:watchingCount(battleId, now) };
}
function resetWatchers(){ watchers.clear(); }
function djLiveStatus(entry, submissions){
  const sub = submissions.find(s => String(s.user_id) === String(entry.user_id) && String(s.status || '') !== 'withdrawn');
  if(String(entry.status || 'active') === 'withdrawn') return 'Left the battle';
  if(sub) return 'Mix submitted';
  return 'Mixing now';
}
async function liveBattle(dataClient, battleIdInput, options = {}){
  const battleId = cleanId(battleIdInput);
  if(!battleId) return { notFound:true };
  const rec = await dataClient.from('battle_records').select('*').eq('id', battleId).limit(1);
  if(rec.error) return { error:rec.error };
  const battle = (rec.data || [])[0];
  if(!battle || String(battle.visibility || 'public') === 'private') return { notFound:true };
  const entries = await dataClient.from('battle_entries').select('*').eq('battle_id', battleId).limit(32);
  if(entries.error) return { error:entries.error };
  const subs = await dataClient.from('mix_submissions').select('*').eq('battle_id', battleId).limit(64);
  const submissions = subs.error ? [] : subs.data || [];
  const rows = (entries.data || []);
  const profiles = await profilesFor(dataClient, rows.map(r => r.user_id));
  const finished = isFinishedBattle(battle);
  const cancelled = ['cancelled', 'expired'].includes(String(battle.status || ''));
  const djs = rows.map(r => {
    const p = profiles.get(String(r.user_id)) || { displayName:'DJ' };
    return { displayName:p.displayName, publicProfileId:p.publicProfileId, belt:p.belt || null, status:finished ? 'Finished' : djLiveStatus(r, submissions), canVoteFor:finished };
  });
  // Read-only chat for fans: names and text only.
  let chat = [];
  const chatRows = await dataClient.from('battle_chat_messages').select('*').eq('battle_id', battleId).limit(500);
  if(!chatRows.error){
    const authors = await profilesFor(dataClient, (chatRows.data || []).map(r => r.user_id));
    chat = (chatRows.data || []).filter(r => (r.status || 'active') === 'active')
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).slice(-100)
      .map(r => ({ id:String(r.id), body:String(r.body || ''), createdAt:r.created_at, author:{ displayName:(authors.get(String(r.user_id)) || {}).displayName || 'DJ' } }));
  }
  const viewerIsDj = options.viewerId && rows.some(r => String(r.user_id) === String(options.viewerId));
  return {
    battle:{ id:battleId, title:cleanText(battle.title, 120) || 'Battle', genre:cleanText(battle.genre, 60), status:finished ? 'finished' : cancelled ? 'cancelled' : 'live', startedAt:battle.started_at || null, deadlineAt:battle.deadline_at || null },
    djs, chat, watching:watchingCount(battleId), votingOpen:finished, viewerIsDj:Boolean(viewerIsDj)
  };
}
// Fans vote by public profile id, so the live page never needs anyone's auth user id.
async function liveCrowdVote(dataClient, voterId, battleIdInput, publicProfileId, now = new Date()){
  const battleId = cleanId(battleIdInput);
  if(!battleId) return { notFound:true };
  const entries = await dataClient.from('battle_entries').select('*').eq('battle_id', battleId).limit(32);
  if(entries.error) return { error:entries.error };
  const ids = (entries.data || []).map(r => String(r.user_id));
  const profiles = await profilesFor(dataClient, ids);
  const picked = ids.find(id => (profiles.get(id) || {}).publicProfileId === cleanId(publicProfileId));
  if(!picked) return { validationError:'Pick one of the DJs in this battle' };
  const result = await recordCrowdVote(dataClient, voterId, battleId, { pickedUserId:picked }, now);
  if(result.summary) delete result.summary;
  if(result.vote) delete result.vote;
  return result;
}
async function liveBattles(dataClient){
  const rec = await dataClient.from('battle_records').select('*').limit(200);
  if(rec.error) return { error:rec.error };
  const live = (rec.data || []).filter(b => String(b.visibility || 'public') !== 'private' && ['started', 'active', 'submission_pending', 'judging'].includes(String(b.status || '')));
  return { battles:live.slice(0, 30).map(b => ({ id:String(b.id), title:cleanText(b.title, 120) || 'Battle', genre:cleanText(b.genre, 60), watching:watchingCount(String(b.id)) })) };
}

/* ------------------------------ 4. Shared crate tracklists ------------------------------ */
// Only these four fields are ever stored. Audio, artwork, file names and URLs are dropped.
function cleanTracklist(tracks){
  return (Array.isArray(tracks) ? tracks : []).slice(0, TRACKLIST_MAX_TRACKS).map(t => {
    const bpm = Number(t && t.bpm);
    return { title:cleanText(t && t.title, 120), artist:cleanText(t && t.artist, 120) || null, bpm:Number.isFinite(bpm) && bpm > 20 && bpm < 400 ? Math.round(bpm * 10) / 10 : null, key:cleanText(t && t.key, 8) || null };
  }).filter(t => t.title);
}
function publicTracklist(row, viewerId){
  const owner = row.owner || {};
  return { id:String(row.id), name:String(row.name || 'Crate'), tracks:Array.isArray(row.tracks) ? row.tracks : [], createdAt:row.created_at, owner:{ displayName:owner.displayName || 'DJ', publicProfileId:owner.publicProfileId || null }, mine:Boolean(viewerId && String(row.user_id) === String(viewerId)) };
}
async function shareTracklist(dataClient, userId, input = {}, now = new Date()){
  const name = cleanText(input.name, 80);
  if(!name) return { validationError:'Give the crate a name' };
  const tracks = cleanTracklist(input.tracks);
  if(!tracks.length) return { validationError:'This crate has no tracks to share' };
  if(rateLimited(`tracklist:${userId}`, now.getTime(), 10, 60 * 60 * 1000)) return { rateLimited:true };
  const profiles = await profilesFor(dataClient, [userId]);
  const p = profiles.get(String(userId));
  const row = { id:newId('tl'), user_id:String(userId), crate_id:cleanId(input.crateId) || null, name, tracks, owner:{ displayName:p.displayName, publicProfileId:p.publicProfileId }, status:'active', created_at:now.toISOString() };
  const inserted = await dataClient.from(TRACKLIST_TABLE).insert([row]).select('*').single();
  if(inserted.error) return missing(inserted.error, TRACKLIST_SCHEMA);
  return { created:true, tracklist:publicTracklist(inserted.data || row, userId) };
}
async function getTracklist(dataClient, idInput, viewerId){
  const id = cleanId(idInput);
  if(!id) return { notFound:true };
  const found = await dataClient.from(TRACKLIST_TABLE).select('*').eq('id', id).limit(1);
  if(found.error) return missing(found.error, TRACKLIST_SCHEMA);
  const row = (found.data || [])[0];
  if(!row || (row.status || 'active') !== 'active') return { notFound:true };
  return { tracklist:publicTracklist(row, viewerId) };
}
async function myTracklists(dataClient, userId){
  const found = await dataClient.from(TRACKLIST_TABLE).select('*').eq('user_id', String(userId)).limit(200);
  if(found.error) return missing(found.error, TRACKLIST_SCHEMA);
  return { tracklists:(found.data || []).filter(r => (r.status || 'active') === 'active').map(r => publicTracklist(r, userId)) };
}
async function stopSharingTracklist(dataClient, userId, idInput){
  const id = cleanId(idInput);
  const found = await dataClient.from(TRACKLIST_TABLE).select('*').eq('id', id).limit(1);
  if(found.error) return missing(found.error, TRACKLIST_SCHEMA);
  const row = (found.data || [])[0];
  if(!row || (row.status || 'active') !== 'active') return { notFound:true };
  if(String(row.user_id) !== String(userId)) return { forbidden:true };
  const up = await dataClient.from(TRACKLIST_TABLE).update({ status:'removed' }).eq('id', id).eq('user_id', String(userId));
  if(up.error) return { error:up.error };
  return { removed:true, id };
}

/* ------------------------------ 5. Weekly practice goals ------------------------------ */
async function getPracticeGoal(dataClient, userId){
  const found = await dataClient.from(GOAL_TABLE).select('*').eq('user_id', String(userId)).limit(1);
  if(found.error) return missing(found.error, GOAL_SCHEMA);
  const row = (found.data || [])[0];
  return { goal:row ? { sessionsPerWeek:Number(row.sessions_per_week) || 0, updatedAt:row.updated_at } : null };
}
async function setPracticeGoal(dataClient, userId, input = {}, now = new Date()){
  const n = Math.round(Number(input.sessionsPerWeek));
  if(!Number.isFinite(n) || n < 0 || n > 21) return { validationError:'Pick between 1 and 21 sessions a week (or 0 to turn the goal off)' };
  const found = await dataClient.from(GOAL_TABLE).select('*').eq('user_id', String(userId)).limit(1);
  if(found.error) return missing(found.error, GOAL_SCHEMA);
  const at = now.toISOString();
  const result = (found.data || [])[0]
    ? await dataClient.from(GOAL_TABLE).update({ sessions_per_week:n, updated_at:at }).eq('user_id', String(userId))
    : await dataClient.from(GOAL_TABLE).insert([{ user_id:String(userId), sessions_per_week:n, updated_at:at }]);
  if(result.error) return missing(result.error, GOAL_SCHEMA);
  return { saved:true, goal:{ sessionsPerWeek:n, updatedAt:at } };
}

module.exports = {
  DM_TABLE, DM_SCHEMA, SEARCH_SCHEMA, TRACKLIST_TABLE, TRACKLIST_SCHEMA, GOAL_TABLE, GOAL_SCHEMA, DM_MAX_LENGTH, BELTS,
  userIdForPublicProfile, listConversations, readConversation, sendDirectMessage, unsendDirectMessage, directMessageReportTarget,
  searchDjs, updateSearchProfile, liveBattle, liveBattles, liveCrowdVote, heartbeat, watchingCount, resetWatchers, WATCH_TTL_MS,
  cleanTracklist, shareTracklist, getTracklist, myTracklists, stopSharingTracklist, getPracticeGoal, setPracticeGoal
};
