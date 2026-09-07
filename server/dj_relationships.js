const { createHash, randomUUID } = require('crypto');
const BattleModes = require('../battle_modes');
const {
  PROGRESSION_PROFILE_TABLE,
  sanitizePublicProfile
} = require('./battle_award_ledger');
const {
  DJ_BLOCKS_TABLE,
  DJ_NOTIFICATION_MUTES_TABLE,
  DJ_NOTIFICATIONS_TABLE,
  normalizeChallengeRules,
  sendDjChallenge
} = require('./dj_challenges');
const {
  sanitizeBattleResult,
  stablePublicProfileId
} = require('./battle_result_history');

const DJ_FOLLOWS_TABLE = 'dj_follows';
const DJ_CHALLENGE_PREFERENCES_TABLE = 'dj_challenge_preferences';
const DJ_ACTIVITY_FEED_TABLE = 'dj_activity_feed_events';
const DEFAULT_RELATIONSHIP_LIMIT = 20;
const MAX_RELATIONSHIP_LIMIT = 50;
const DEFAULT_ACTIVITY_LIMIT = 20;
const MAX_ACTIVITY_LIMIT = 50;
const CHALLENGE_AUDIENCES = new Set(['everyone', 'followed', 'prior_opponents', 'nobody']);
const BITCOIN_PREFS = new Set(['allow', 'metadata_only', 'deny']);

function tableQuery(dataClient, table){
  return dataClient.from(table).select('*');
}

function plainObject(value){
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeArray(value){
  return Array.isArray(value) ? value : [];
}

function cleanString(value, max = 160){
  if(value == null) return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return text ? text.slice(0, max) : null;
}

function safeNumber(value){
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nowIso(now = new Date()){
  return now instanceof Date ? now.toISOString() : new Date(now || Date.now()).toISOString();
}

function safeDate(value){
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function stableHash(value){
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function stableId(prefix, payload){
  return `${prefix}-${stableHash(payload).slice(0, 24)}`;
}

function optionalTableMissing(error){
  const message = String(error && (error.message || error.details || error.hint || error.code || error) || '').toLowerCase();
  return message.includes('does not exist')
    || message.includes('schema cache')
    || message.includes('could not find')
    || message.includes('relation')
    || message.includes('42p01');
}

function normalizePage(value){
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 1;
}

function normalizeLimit(value, fallback = DEFAULT_RELATIONSHIP_LIMIT, max = MAX_RELATIONSHIP_LIMIT){
  const number = Number(value);
  if(!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.floor(number)));
}

function profileVisibility(row){
  const embedded = plainObject(row && row.public_profile);
  return cleanString(row && row.visibility, 40) || cleanString(embedded.visibility, 40) || 'public';
}

function publicProfileFromProgressionRow(row){
  if(!row) return null;
  const embedded = plainObject(row.public_profile);
  const profile = sanitizePublicProfile({
    ...embedded,
    publicProfileId: row.public_profile_id || embedded.publicProfileId,
    displayName: row.display_name || embedded.displayName || embedded.name || embedded.djName,
    country: row.country || embedded.country,
    flag: embedded.flag,
    belt: row.belt || embedded.belt,
    visibility: profileVisibility(row)
  }, row.user_id);
  if(profile.visibility === 'private' || profileVisibility(row) === 'private'){
    return {
      publicProfileId:null,
      displayName:'Private DJ',
      name:'Private DJ',
      profileVisibility:'private',
      country:null,
      flag:null,
      belt:'Unranked',
      rating:null,
      rank:null
    };
  }
  return {
    publicProfileId:profile.publicProfileId,
    displayName:profile.displayName,
    name:profile.displayName,
    profileVisibility:'public',
    country:profile.country || null,
    flag:profile.flag || null,
    belt:profile.belt || row.belt || 'Unranked',
    rating:safeNumber(row.rating ?? row.ranking_rating),
    rank:safeNumber(row.global_rank || row.rank),
    wins:safeNumber(row.wins),
    losses:safeNumber(row.losses),
    ties:safeNumber(row.ties),
    completedBattles:safeNumber(row.completed_battles),
    specialties:safeArray(embedded.specialties || embedded.modes).map(item => cleanString(item, 80)).filter(Boolean).slice(0, 8)
  };
}

function profileSnapshot(value = {}){
  const source = plainObject(value);
  if(source.profileVisibility === 'private' || source.visibility === 'private'){
    return {
      publicProfileId:null,
      displayName:'Private DJ',
      name:'Private DJ',
      profileVisibility:'private',
      country:null,
      flag:null,
      belt:'Unranked',
      rating:null,
      rank:null
    };
  }
  return {
    publicProfileId:cleanString(source.publicProfileId || source.id, 96),
    displayName:cleanString(source.displayName || source.name || source.djName, 120) || 'DJ',
    name:cleanString(source.name || source.displayName || source.djName, 120) || 'DJ',
    profileVisibility:'public',
    country:cleanString(source.country, 80),
    flag:cleanString(source.flag, 16),
    belt:cleanString(source.belt, 40) || 'Unranked',
    rating:safeNumber(source.rating),
    rank:safeNumber(source.rank),
    wins:safeNumber(source.wins),
    losses:safeNumber(source.losses),
    ties:safeNumber(source.ties),
    completedBattles:safeNumber(source.completedBattles || source.completed_battles)
  };
}

async function fetchProgressionProfiles(dataClient){
  const result = await tableQuery(dataClient, PROGRESSION_PROFILE_TABLE).limit(1000);
  if(result.error) return { error:result.error };
  const rows = result.data || [];
  const byUser = new Map();
  const byPublic = new Map();
  rows.forEach(row => {
    const profile = publicProfileFromProgressionRow(row);
    byUser.set(String(row.user_id), { row, profile, public:Boolean(profile && profile.profileVisibility === 'public' && profile.publicProfileId) });
    if(profile && profile.publicProfileId) byPublic.set(String(profile.publicProfileId), { row, profile, public:Boolean(profile.profileVisibility === 'public') });
    if(row.public_profile_id && !byPublic.has(String(row.public_profile_id))) byPublic.set(String(row.public_profile_id), { row, profile, public:Boolean(profile && profile.profileVisibility === 'public') });
  });
  return { rows, byUser, byPublic };
}

async function resolvePublicProfile(dataClient, publicProfileId){
  const requested = cleanString(publicProfileId, 96);
  if(!requested) return { validationError:'Public DJ profile is required.' };
  const profiles = await fetchProgressionProfiles(dataClient);
  if(profiles.error) return profiles;
  const found = profiles.byPublic.get(String(requested));
  if(!found) return { notFound:true };
  if(!found.public) return { private:true };
  return { userId:String(found.row.user_id), profile:found.profile, profiles };
}

async function resolveUserProfile(dataClient, userId, existingProfiles){
  const profiles = existingProfiles || await fetchProgressionProfiles(dataClient);
  if(profiles.error) return profiles;
  const found = profiles.byUser.get(String(userId));
  if(found && found.profile) return { profile:found.profile, profiles };
  return { profile:profileSnapshot(sanitizePublicProfile({}, userId)), profiles };
}

async function activeBlockBetween(dataClient, userA, userB){
  const result = await tableQuery(dataClient, DJ_BLOCKS_TABLE).limit(1000);
  if(result.error){
    if(optionalTableMissing(result.error)) return { blocked:false, missing:true };
    return { error:result.error };
  }
  const blocked = (result.data || []).some(row => {
    if(row.active === false || row.status === 'inactive') return false;
    const blocker = String(row.blocker_user_id || '');
    const blockedUser = String(row.blocked_user_id || '');
    return (blocker === String(userA) && blockedUser === String(userB))
      || (blocker === String(userB) && blockedUser === String(userA));
  });
  return { blocked };
}

async function listFollowRows(dataClient){
  const result = await tableQuery(dataClient, DJ_FOLLOWS_TABLE).limit(2000);
  if(result.error){
    if(optionalTableMissing(result.error)) return { follows:[], missing:true };
    return { error:result.error };
  }
  return { follows:(result.data || []).filter(row => row.active !== false && row.status !== 'inactive') };
}

function sanitizeFollow(row, viewerId, direction){
  if(!row) return null;
  const followDirection = direction || (String(row.follower_user_id) === String(viewerId) ? 'following' : 'follower');
  const profile = followDirection === 'following'
    ? profileSnapshot(row.followed_profile)
    : profileSnapshot(row.follower_profile);
  if(profile.profileVisibility === 'private' || !profile.publicProfileId) return null;
  return {
    id:String(row.id),
    direction:followDirection,
    status:cleanString(row.status, 40) || 'active',
    profile,
    publicProfileId:profile.publicProfileId,
    displayName:profile.displayName,
    country:profile.country,
    flag:profile.flag,
    belt:profile.belt,
    rating:profile.rating,
    rank:profile.rank,
    followedAt:row.created_at || null,
    updatedAt:row.updated_at || null
  };
}

function relationshipCounts(follows, userId){
  const rows = follows || [];
  return {
    following:rows.filter(row => String(row.follower_user_id) === String(userId)).length,
    followers:rows.filter(row => String(row.followed_user_id) === String(userId)).length
  };
}

function rowEventVersion(row){
  if(!row) return 0;
  const explicit = safeNumber(row.event_version);
  const updated = safeDate(row.updated_at || row.updatedAt);
  const created = safeDate(row.created_at || row.createdAt);
  const source = safeDate(row.sourceVersion || row.completedAt || row.followedAt);
  return Math.max(
    explicit || 0,
    updated ? updated.getTime() : 0,
    created ? created.getTime() : 0,
    source ? source.getTime() : 0
  );
}

function maxEventVersion(rows){
  return safeArray(rows).reduce((max, row) => Math.max(max, rowEventVersion(row)), 0);
}

function publicFollowerCountMapFromRows(follows, publicProfileIds = []){
  const ids = new Set(safeArray(publicProfileIds).map(id => cleanString(id, 96)).filter(Boolean));
  const map = new Map();
  ids.forEach(id => map.set(id, {
    publicProfileId:id,
    followers:0,
    following:0,
    followerCount:0,
    followingCount:0,
    source:'server',
    eventVersion:0
  }));
  safeArray(follows).forEach(row => {
    const version = rowEventVersion(row);
    const followedId = cleanString(row.followed_public_profile_id || plainObject(row.followed_profile).publicProfileId, 96);
    const followerId = cleanString(row.follower_public_profile_id || plainObject(row.follower_profile).publicProfileId, 96);
    if(followedId && map.has(followedId)){
      const item = map.get(followedId);
      item.followers += 1;
      item.followerCount = item.followers;
      item.eventVersion = Math.max(item.eventVersion, version);
    }
    if(followerId && map.has(followerId)){
      const item = map.get(followerId);
      item.following += 1;
      item.followingCount = item.following;
      item.eventVersion = Math.max(item.eventVersion, version);
    }
  });
  return map;
}

async function getPublicFollowerCountMap(dataClient, publicProfileIds = []){
  const follows = await listFollowRows(dataClient);
  if(follows.error) return follows;
  return { counts:publicFollowerCountMapFromRows(follows.follows, publicProfileIds), missing:Boolean(follows.missing) };
}

async function listOwnedRelationshipMuteRows(dataClient, userId){
  const result = await tableQuery(dataClient, DJ_NOTIFICATION_MUTES_TABLE)
    .eq('user_id', userId)
    .limit(500);
  if(result.error){
    if(optionalTableMissing(result.error)) return { mutes:[], missing:true };
    return { error:result.error };
  }
  return { mutes:(result.data || []).filter(row => row.active !== false && row.muted !== false) };
}

async function relationshipNotificationMuted(dataClient, userId, actorUserId, actorProfile, type = 'follow_started'){
  const rows = await listOwnedRelationshipMuteRows(dataClient, userId);
  if(rows.error) return rows;
  const actor = profileSnapshot(actorProfile);
  const muted = rows.mutes.some(row => {
    const category = cleanString(row.category, 40) || 'relationship';
    const notificationType = cleanString(row.notification_type, 80);
    if(category !== 'all' && category !== 'relationship') return false;
    if(notificationType && notificationType !== type) return false;
    const mutedUserId = cleanString(row.muted_user_id, 128);
    const mutedProfileId = cleanString(row.muted_public_profile_id, 96);
    if(mutedUserId && mutedUserId !== String(actorUserId || '')) return false;
    if(mutedProfileId && mutedProfileId !== actor.publicProfileId) return false;
    return true;
  });
  return { muted };
}

async function emitRelationshipNotification(dataClient, userId, actorUserId, actorProfile, options = {}, now = new Date()){
  const type = cleanString(options.type, 80) || 'follow_started';
  const subjectId = cleanString(options.subjectId, 128) || `${actorUserId}:${userId}`;
  const version = safeNumber(options.eventVersion) || now.getTime();
  const eventKey = stableHash({ userId:String(userId), actorUserId:String(actorUserId), type, subjectId, version });
  const actor = profileSnapshot(actorProfile);
  const existing = await tableQuery(dataClient, DJ_NOTIFICATIONS_TABLE)
    .eq('user_id', userId)
    .eq('event_key', eventKey)
    .limit(1);
  if(existing.error){
    if(optionalTableMissing(existing.error)) return { notifications:[], missing:true };
    return { error:existing.error };
  }
  if(existing.data && existing.data[0]) return { notifications:[existing.data[0]], duplicate:true };
  const mute = await relationshipNotificationMuted(dataClient, userId, actorUserId, actor, type);
  if(mute.error) return { error:mute.error };
  if(mute.muted) return { notifications:[], muted:true };
  const payload = {
    id:`notification-${eventKey.slice(0, 24)}`,
    user_id:String(userId),
    type,
    category:'relationship',
    subject_type:cleanString(options.subjectType, 80) || 'dj_relationship',
    subject_id:subjectId,
    event_key:eventKey,
    event_version:version,
    actor_user_id:String(actorUserId || ''),
    actor_public_profile_id:actor.publicProfileId || null,
    actor_profile:actor,
    challenge_snapshot:null,
    destination:options.destination || { type:'public_profile', publicProfileId:actor.publicProfileId, label:'Open Profile' },
    summary:cleanString(options.summary, 180) || `${actor.displayName || 'A DJ'} followed your public profile.`,
    status:'delivered',
    read_at:null,
    archived_at:null,
    created_at:nowIso(now),
    updated_at:nowIso(now)
  };
  const inserted = await dataClient.from(DJ_NOTIFICATIONS_TABLE).insert([payload]).select('*').single();
  if(inserted.error){
    if(optionalTableMissing(inserted.error)) return { notifications:[], missing:true };
    return { error:inserted.error };
  }
  return { notifications:[inserted.data] };
}

async function followPublicDj(dataClient, followerId, input = {}, now = new Date()){
  const target = await resolvePublicProfile(dataClient, input.publicProfileId || input.followedPublicProfileId || input.followed_public_profile_id);
  if(target.error || target.validationError || target.notFound || target.private) return target;
  if(String(target.userId) === String(followerId)) return { conflict:true, reason:'You cannot follow yourself.' };
  const block = await activeBlockBetween(dataClient, followerId, target.userId);
  if(block.error) return block;
  if(block.blocked) return { forbidden:true, reason:'This DJ profile is unavailable.' };
  const follower = await resolveUserProfile(dataClient, followerId, target.profiles);
  if(follower.error) return follower;
  const existing = await tableQuery(dataClient, DJ_FOLLOWS_TABLE)
    .eq('follower_user_id', followerId)
    .eq('followed_user_id', target.userId)
    .limit(1);
  if(existing.error) return { error:existing.error };
  const current = existing.data && existing.data[0];
  if(current && current.active !== false && current.status !== 'inactive'){
    return { follow:sanitizeFollow(current, followerId, 'following'), duplicate:true };
  }
  const idempotencyKey = cleanString(input.idempotencyKey || input.idempotency_key, 128);
  if(current){
    const updated = await dataClient.from(DJ_FOLLOWS_TABLE)
      .update({
        status:'active',
        active:true,
        followed_public_profile_id:target.profile.publicProfileId,
        follower_public_profile_id:follower.profile.publicProfileId || null,
        followed_profile:profileSnapshot(target.profile),
        follower_profile:profileSnapshot(follower.profile),
        idempotency_key:idempotencyKey || current.idempotency_key || null,
        updated_at:nowIso(now)
      })
      .eq('id', current.id)
      .select('*')
      .single();
    if(updated.error) return { error:updated.error };
    await emitRelationshipNotification(dataClient, target.userId, followerId, follower.profile, { subjectId:updated.data.id }, now);
    return { follow:sanitizeFollow(updated.data, followerId, 'following'), created:true, reactivated:true };
  }
  const payload = {
    id:stableId('follow', { followerId, followedId:target.userId, idempotencyKey: idempotencyKey || 'direct' }),
    follower_user_id:String(followerId),
    followed_user_id:String(target.userId),
    follower_public_profile_id:follower.profile.publicProfileId || null,
    followed_public_profile_id:target.profile.publicProfileId,
    follower_profile:profileSnapshot(follower.profile),
    followed_profile:profileSnapshot(target.profile),
    idempotency_key:idempotencyKey || null,
    status:'active',
    active:true,
    created_at:nowIso(now),
    updated_at:nowIso(now)
  };
  const inserted = await dataClient.from(DJ_FOLLOWS_TABLE).insert([payload]).select('*').single();
  if(inserted.error) return { error:inserted.error };
  await emitRelationshipNotification(dataClient, target.userId, followerId, follower.profile, { subjectId:inserted.data.id }, now);
  return { follow:sanitizeFollow(inserted.data, followerId, 'following'), created:true };
}

async function unfollowPublicDj(dataClient, followerId, publicProfileId, now = new Date()){
  const target = await resolvePublicProfile(dataClient, publicProfileId);
  if(target.error || target.validationError || target.notFound || target.private) return target;
  const existing = await tableQuery(dataClient, DJ_FOLLOWS_TABLE)
    .eq('follower_user_id', followerId)
    .eq('followed_user_id', target.userId)
    .limit(1);
  if(existing.error) return { error:existing.error };
  const current = (existing.data || []).find(row => row.active !== false && row.status !== 'inactive');
  if(!current) return { follow:null, duplicate:true };
  const updated = await dataClient.from(DJ_FOLLOWS_TABLE)
    .update({ status:'inactive', active:false, updated_at:nowIso(now) })
    .eq('id', current.id)
    .select('*')
    .single();
  if(updated.error) return { error:updated.error };
  return { follow:sanitizeFollow({ ...updated.data, active:true, status:'inactive' }, followerId, 'following'), removed:true };
}

async function disableFollowsBetweenUsers(dataClient, userA, userB, now = new Date()){
  const listed = await listFollowRows(dataClient);
  if(listed.error || listed.missing) return listed.error ? listed : { disabledCount:0, missing:true };
  let disabledCount = 0;
  for(const row of listed.follows){
    const pair = (String(row.follower_user_id) === String(userA) && String(row.followed_user_id) === String(userB))
      || (String(row.follower_user_id) === String(userB) && String(row.followed_user_id) === String(userA));
    if(!pair) continue;
    const updated = await dataClient.from(DJ_FOLLOWS_TABLE)
      .update({ status:'inactive', active:false, updated_at:nowIso(now) })
      .eq('id', row.id)
      .select('*')
      .single();
    if(updated.error) return { error:updated.error };
    disabledCount += 1;
  }
  return { disabledCount };
}

async function getRelationshipSummary(dataClient, userId, publicProfileId){
  const target = await resolvePublicProfile(dataClient, publicProfileId);
  if(target.error || target.validationError || target.notFound || target.private) return target;
  const follows = await listFollowRows(dataClient);
  if(follows.error) return follows;
  const block = await activeBlockBetween(dataClient, userId, target.userId);
  if(block.error) return block;
  const counts = relationshipCounts(follows.follows, target.userId);
  const following = follows.follows.some(row => String(row.follower_user_id) === String(userId) && String(row.followed_user_id) === String(target.userId));
  const followedBy = follows.follows.some(row => String(row.follower_user_id) === String(target.userId) && String(row.followed_user_id) === String(userId));
  return {
    summary:{
      profile:profileSnapshot(target.profile),
      following,
      followedBy,
      canFollow:String(userId) !== String(target.userId) && !block.blocked,
      unavailable:Boolean(block.blocked),
      counts
    }
  };
}

async function listOwnedRelationships(dataClient, userId, options = {}){
  const direction = cleanString(options.direction, 20) || 'following';
  const limit = normalizeLimit(options.limit);
  const page = normalizePage(options.page);
  const follows = await listFollowRows(dataClient);
  if(follows.error) return follows;
  const rows = follows.follows
    .filter(row => {
      if(direction === 'followers') return String(row.followed_user_id) === String(userId);
      if(direction === 'all') return String(row.followed_user_id) === String(userId) || String(row.follower_user_id) === String(userId);
      return String(row.follower_user_id) === String(userId);
    })
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
  const start = (page - 1) * limit;
  const pageRows = rows.slice(start, start + limit).map(row => sanitizeFollow(row, userId, direction === 'followers' ? 'follower' : 'following')).filter(Boolean);
  return {
    relationships:pageRows,
    counts:relationshipCounts(follows.follows, userId),
    pagination:{
      page,
      limit,
      total:rows.length,
      hasMore:start + limit < rows.length,
      nextPage:start + limit < rows.length ? page + 1 : null
    }
  };
}

function defaultChallengePreferences(){
  return {
    whoMayChallenge:'everyone',
    allowedModes:[],
    allowedGenres:[],
    ratingRange:{ min:null, max:null },
    allowedBelts:[],
    bitcoinBattles:'metadata_only',
    autoDeclineOutsideRules:false,
    notifications:{ challenges:true, rematches:true, follows:true },
    updatedAt:null,
    source:'default'
  };
}

function normalizeChallengePreferences(input = {}, existing = {}){
  const base = defaultChallengePreferences();
  const source = { ...plainObject(existing), ...plainObject(input) };
  const who = cleanString(source.whoMayChallenge || source.who_may_challenge, 40) || base.whoMayChallenge;
  const bitcoin = cleanString(source.bitcoinBattles || source.bitcoin_battles || source.bitcoinBattleEligibility, 40) || base.bitcoinBattles;
  const range = plainObject(source.ratingRange || source.rating_range);
  const modes = safeArray(source.allowedModes || source.allowed_modes)
    .map(item => cleanString(item, 80))
    .filter(item => item && BattleModes.getBattleMode(item))
    .slice(0, 20);
  const genres = safeArray(source.allowedGenres || source.allowed_genres)
    .map(item => cleanString(item, 80))
    .filter(Boolean)
    .slice(0, 40);
  const belts = safeArray(source.allowedBelts || source.allowed_belts)
    .map(item => cleanString(item, 60))
    .filter(Boolean)
    .slice(0, 20);
  return {
    whoMayChallenge:CHALLENGE_AUDIENCES.has(who) ? who : base.whoMayChallenge,
    allowedModes:modes,
    allowedGenres:genres,
    ratingRange:{
      min:safeNumber(source.minRating ?? source.min_rating ?? range.min),
      max:safeNumber(source.maxRating ?? source.max_rating ?? range.max)
    },
    allowedBelts:belts,
    bitcoinBattles:BITCOIN_PREFS.has(bitcoin) ? bitcoin : base.bitcoinBattles,
    autoDeclineOutsideRules:source.autoDeclineOutsideRules === true || source.auto_decline_outside_rules === true,
    notifications:{
      challenges:plainObject(source.notifications).challenges !== false,
      rematches:plainObject(source.notifications).rematches !== false,
      follows:plainObject(source.notifications).follows !== false
    },
    updatedAt:cleanString(source.updated_at || source.updatedAt, 80),
    source:source.source || 'server'
  };
}

function preferencesRowToPublic(row){
  if(!row) return defaultChallengePreferences();
  return normalizeChallengePreferences({
    whoMayChallenge:row.who_may_challenge,
    allowedModes:row.allowed_modes,
    allowedGenres:row.allowed_genres,
    minRating:row.min_rating,
    maxRating:row.max_rating,
    allowedBelts:row.allowed_belts,
    bitcoinBattles:row.bitcoin_battles,
    autoDeclineOutsideRules:row.auto_decline_outside_rules,
    notifications:row.notification_preferences,
    updatedAt:row.updated_at,
    source:'server'
  });
}

async function getOwnedChallengePreferences(dataClient, userId){
  const result = await tableQuery(dataClient, DJ_CHALLENGE_PREFERENCES_TABLE)
    .eq('user_id', userId)
    .limit(1);
  if(result.error){
    if(optionalTableMissing(result.error)) return { preferences:{ ...defaultChallengePreferences(), source:'configuration_required' }, configurationRequired:true };
    return { error:result.error };
  }
  return { preferences:preferencesRowToPublic(result.data && result.data[0]) };
}

async function updateOwnedChallengePreferences(dataClient, userId, input = {}, now = new Date()){
  const existing = await tableQuery(dataClient, DJ_CHALLENGE_PREFERENCES_TABLE)
    .eq('user_id', userId)
    .limit(1);
  if(existing.error) return { error:existing.error };
  const current = existing.data && existing.data[0];
  const normalized = normalizeChallengePreferences(input, current || {});
  const payload = {
    id:current && current.id || stableId('challenge-pref', { userId }),
    user_id:String(userId),
    who_may_challenge:normalized.whoMayChallenge,
    allowed_modes:normalized.allowedModes,
    allowed_genres:normalized.allowedGenres,
    min_rating:normalized.ratingRange.min,
    max_rating:normalized.ratingRange.max,
    allowed_belts:normalized.allowedBelts,
    bitcoin_battles:normalized.bitcoinBattles,
    auto_decline_outside_rules:normalized.autoDeclineOutsideRules,
    notification_preferences:normalized.notifications,
    created_at:current && current.created_at || nowIso(now),
    updated_at:nowIso(now)
  };
  const query = current
    ? dataClient.from(DJ_CHALLENGE_PREFERENCES_TABLE).update(payload).eq('id', current.id)
    : dataClient.from(DJ_CHALLENGE_PREFERENCES_TABLE).insert([payload]);
  const saved = await query.select('*').single();
  if(saved.error) return { error:saved.error };
  return { preferences:preferencesRowToPublic(saved.data), updated:true };
}

function feedEventFromResult(row, result){
  const profile = profileSnapshot(result.profile);
  const reward = plainObject(result.reward);
  const rewardText = reward.type === 'bitcoin' ? 'Bitcoin metadata untransferred' : `${reward.type || 'standard'} reward`;
  const battle = plainObject(result.battle);
  const mode = cleanString(result.modeId || result.type || battle.modeId || battle.type, 80) || '';
  const modeKey = mode.toLowerCase();
  const modeConfig = BattleModes.getBattleMode(mode || battle.type);
  const producer = String(battle.discipline || result.battleDiscipline || '').toLowerCase() === 'producer'
    || (modeConfig && modeConfig.discipline === 'producer')
    || modeKey.includes('beat_battle')
    || modeKey.includes('sample_flip')
    || modeKey.includes('drum_challenge')
    || modeKey.includes('remix_challenge');
  const rankingCategory = reward.type === 'bitcoin' || modeKey.includes('bitcoin')
    ? 'bitcoin_battles'
    : producer
      ? 'producer_beat_battles'
      : modeKey.includes('scratch')
        ? 'scratching_battles'
        : modeKey.includes('transition')
          ? 'transition_battles'
          : modeKey.includes('mix') || modeKey.includes('song')
            ? 'mix_battles'
            : 'competitive_battles';
  return {
    id:stableId('feed', { type:'verified_result', id:result.verifiedResultId, version:result.completedAt }),
    sourceType:'verified_result',
    sourceId:result.verifiedResultId,
    sourceVersion:result.completedAt || row.updated_at || row.created_at || '',
    actor:profile,
    createdAt:result.completedAt || row.updated_at || row.created_at || null,
    visibility:'public',
    title:`${profile.displayName || 'DJ'} completed ${result.battle && (result.battle.type || result.battle.modeId) || 'a battle'}`,
    summary:`${result.score == null ? 'N/A' : result.score}/100 - ${result.outcome || 'recorded'} - ${rewardText}`,
    result:{
      verifiedResultId:result.verifiedResultId,
      publicProfileId:profile.publicProfileId,
      battle:result.battle,
      rankingCategory,
      score:result.score,
      outcome:result.outcome,
      scoringSource:result.scoringSource,
      ratingMovement:result.ratingMovement,
      belt:result.belt,
      reward:reward.type === 'bitcoin' ? { type:'bitcoin', transferStatus:'untransferred', metadata:reward.metadata || {} } : { type:reward.type || 'standard' }
    }
  };
}

function feedEventFromFollow(row){
  const actor = profileSnapshot(row.follower_profile);
  const target = profileSnapshot(row.followed_profile);
  if(!actor.publicProfileId || !target.publicProfileId) return null;
  return {
    id:stableId('feed', { type:'follow', id:row.id, version:row.updated_at || row.created_at }),
    sourceType:'follow',
    sourceId:String(row.id),
    sourceVersion:row.updated_at || row.created_at || '',
    actor,
    createdAt:row.created_at || row.updated_at || null,
    visibility:'public',
    title:`${actor.displayName || 'A DJ'} followed ${target.displayName || 'a DJ'}`,
    summary:'Public relationship activity. Private follow lists, auth IDs and storage data are not exposed.',
    target
  };
}

async function listOwnedActivityFeed(dataClient, userId, options = {}){
  const limit = normalizeLimit(options.limit, DEFAULT_ACTIVITY_LIMIT, MAX_ACTIVITY_LIMIT);
  const page = normalizePage(options.page);
  const follows = await listFollowRows(dataClient);
  if(follows.error) return follows;
  const followingIds = new Set(follows.follows.filter(row => String(row.follower_user_id) === String(userId)).map(row => String(row.followed_user_id)));
  const events = [];
  if(followingIds.size){
    const submissions = await tableQuery(dataClient, 'mix_submissions').limit(500);
    if(submissions.error) return { error:submissions.error };
    (submissions.data || []).forEach(row => {
      if(!followingIds.has(String(row.user_id))) return;
      const result = sanitizeBattleResult(row, { publicView:true });
      if(!result || result.visibility !== 'public') return;
      events.push(feedEventFromResult(row, result));
    });
    follows.follows.forEach(row => {
      if(!followingIds.has(String(row.follower_user_id))) return;
      const event = feedEventFromFollow(row);
      if(event) events.push(event);
    });
  }
  const deduped = [];
  const seen = new Set();
  events
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .forEach(event => {
      const key = `${event.sourceType}:${event.sourceId}:${event.sourceVersion}`;
      if(seen.has(key)) return;
      seen.add(key);
      deduped.push(event);
    });
  const start = (page - 1) * limit;
  return {
    events:deduped.slice(start, start + limit),
    pagination:{
      page,
      limit,
      total:deduped.length,
      hasMore:start + limit < deduped.length,
      nextPage:start + limit < deduped.length ? page + 1 : null
    }
  };
}

async function getOwnedRelationshipSyncState(dataClient, userId, options = {}, now = new Date()){
  const relationshipPage = await listOwnedRelationships(dataClient, userId, {
    direction:options.direction || 'following',
    page:options.relationshipPage || options.page || 1,
    limit:options.relationshipLimit || options.limit || DEFAULT_RELATIONSHIP_LIMIT
  });
  if(relationshipPage.error) return relationshipPage;
  const feed = await listOwnedActivityFeed(dataClient, userId, {
    page:options.feedPage || 1,
    limit:options.feedLimit || DEFAULT_ACTIVITY_LIMIT
  });
  if(feed.error) return feed;
  const opponents = await listOwnedOpponentHistory(dataClient, userId, {
    page:options.opponentPage || 1,
    limit:options.opponentLimit || 10
  });
  if(opponents.error) return opponents;
  const preferences = await getOwnedChallengePreferences(dataClient, userId);
  if(preferences.error) return preferences;
  const notifications = await tableQuery(dataClient, DJ_NOTIFICATIONS_TABLE)
    .eq('user_id', userId)
    .limit(200);
  if(notifications.error && !optionalTableMissing(notifications.error)) return { error:notifications.error };
  const notificationRows = notifications.error ? [] : notifications.data || [];
  const preferenceVersion = preferences.preferences && preferences.preferences.updatedAt
    ? rowEventVersion({ updatedAt:preferences.preferences.updatedAt })
    : 0;
  const syncVersion = Math.max(
    maxEventVersion(relationshipPage.relationships),
    maxEventVersion(feed.events),
    maxEventVersion(opponents.opponents),
    maxEventVersion(notificationRows),
    preferenceVersion
  );
  const sinceVersion = safeNumber(options.sinceVersion || options.since_version) || 0;
  return {
    sync:{
      status:'synced',
      syncVersion,
      eventVersion:syncVersion,
      stale:false,
      changed:!sinceVersion || syncVersion >= sinceVersion,
      polling:{
        intervalMs:30000,
        hiddenIntervalMs:90000,
        realtime:'optional_authenticated_scope'
      },
      counts:relationshipPage.counts,
      relationships:relationshipPage.relationships,
      relationshipPagination:relationshipPage.pagination,
      events:feed.events,
      feedPagination:feed.pagination,
      opponents:opponents.opponents,
      opponentPagination:opponents.pagination,
      preferences:preferences.preferences,
      configurationRequired:Boolean(preferences.configurationRequired),
      notificationVersion:maxEventVersion(notificationRows),
      generatedAt:nowIso(now)
    }
  };
}

function resultSummary(row){
  return plainObject(plainObject(row && row.processing_info).battleResultSummary);
}

function opponentPublicProfileIdFromSummary(summary){
  const opponent = plainObject(summary.opponent);
  return cleanString(opponent.publicProfileId || opponent.profileId || summary.opponentPublicProfileId, 96);
}

function opponentHistoryRow(row, result){
  const summary = resultSummary(row);
  const opponent = plainObject(summary.opponent);
  const battle = plainObject(result.battle);
  const publicProfileId = opponentPublicProfileIdFromSummary(summary);
  const reward = plainObject(result.reward);
  return {
    id:String(result.submissionId || row.id),
    verifiedResultId:result.visibility === 'public' ? result.verifiedResultId : null,
    completedAt:result.completedAt,
    battle,
    opponent:{
      status:result.opponent && result.opponent.status || opponent.status || 'opponent',
      publicProfileId,
      displayName:cleanString(opponent.displayName || opponent.name || result.opponent && result.opponent.name, 120) || 'Opponent DJ',
      country:cleanString(opponent.country || result.opponent && result.opponent.country, 80),
      belt:cleanString(opponent.belt, 60),
      rating:safeNumber(opponent.rating)
    },
    outcome:result.outcome,
    score:result.score,
    opponentScore:result.opponentScore,
    scoringSource:result.scoringSource,
    progression:result.progression,
    rematchEligible:Boolean(publicProfileId && (result.opponent && result.opponent.status) !== 'ai_only'),
    suggestedRules:{
      modeId:battle.modeId,
      title:`Rematch - ${battle.title || battle.type || 'Battle'}`,
      genre:battle.genre,
      durationMinutes:safeNumber(summary.durationMinutes || plainObject(summary.battle).durationMinutes),
      scoringType:cleanString(summary.scoringType || plainObject(summary.battle).scoringType, 40) || 'hybrid',
      reward:reward.type === 'bitcoin'
        ? { type:'bitcoin', metadata:{ amountSats:reward.metadata && reward.metadata.amountSats, custody:'external_pending' }, transferStatus:'untransferred' }
        : { type:reward.type || 'xp', metadata:{} }
    }
  };
}

async function listOwnedOpponentHistory(dataClient, userId, options = {}){
  const limit = normalizeLimit(options.limit, DEFAULT_ACTIVITY_LIMIT, MAX_ACTIVITY_LIMIT);
  const page = normalizePage(options.page);
  const opponentFilter = cleanString(options.opponentPublicProfileId || options.opponent, 96);
  const result = await tableQuery(dataClient, 'mix_submissions')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .limit(500);
  if(result.error) return { error:result.error };
  const rows = (result.data || [])
    .map(row => ({ row, result:sanitizeBattleResult(row) }))
    .filter(item => item.result)
    .map(item => opponentHistoryRow(item.row, item.result))
    .filter(item => !opponentFilter || String(item.opponent.publicProfileId || '') === String(opponentFilter))
    .sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
  const start = (page - 1) * limit;
  return {
    opponents:rows.slice(start, start + limit),
    pagination:{
      page,
      limit,
      total:rows.length,
      hasMore:start + limit < rows.length,
      nextPage:start + limit < rows.length ? page + 1 : null
    }
  };
}

async function requestRematch(dataClient, userId, input = {}, now = new Date(), options = {}){
  const previousResultId = cleanString(input.previousResultId || input.resultId || input.submissionId, 128);
  let opponentPublicProfileId = cleanString(input.opponentPublicProfileId || input.recipientPublicProfileId, 96);
  let suggestedRules = plainObject(input.rules);
  if(previousResultId){
    const result = await tableQuery(dataClient, 'mix_submissions')
      .eq('id', previousResultId)
      .eq('user_id', userId)
      .eq('status', 'completed')
      .limit(1)
      .single();
    if(result.error) return { error:result.error };
    if(!result.data) return { notFound:true };
    const sanitized = sanitizeBattleResult(result.data);
    if(!sanitized) return { unavailable:true };
    const row = opponentHistoryRow(result.data, sanitized);
    if(!row.rematchEligible) return { conflict:true, reason:'This result is not eligible for a DJ rematch.' };
    opponentPublicProfileId = opponentPublicProfileId || row.opponent.publicProfileId;
    suggestedRules = { ...row.suggestedRules, ...suggestedRules };
  }
  if(!opponentPublicProfileId) return { validationError:'Choose an opponent for the rematch.' };
  const normalized = normalizeChallengeRules(suggestedRules);
  if(normalized.validationError) return normalized;
  const body = {
    recipientPublicProfileId:opponentPublicProfileId,
    challengerCrateId:input.challengerCrateId || input.crateId,
    idempotencyKey:input.idempotencyKey || stableId('rematch-key', { userId, opponentPublicProfileId, previousResultId, rules:normalized.rules }),
    origin:{
      source:'rematch',
      previousResultId:previousResultId || null,
      publicProfileId:opponentPublicProfileId,
      rankingCategory:input.rankingCategory || 'competitive_battles'
    },
    rules:normalized.rules
  };
  const result = await sendDjChallenge(dataClient, userId, body, now, options);
  if(result.challenge){
    result.rematch = {
      previousResultId:previousResultId || null,
      opponentPublicProfileId,
      requiresFreshCrate:true,
      challenge:result.challenge
    };
  }
  return result;
}

module.exports = {
  BITCOIN_PREFS,
  CHALLENGE_AUDIENCES,
  DJ_ACTIVITY_FEED_TABLE,
  DJ_CHALLENGE_PREFERENCES_TABLE,
  DJ_FOLLOWS_TABLE,
  defaultChallengePreferences,
  disableFollowsBetweenUsers,
  followPublicDj,
  getOwnedRelationshipSyncState,
  getPublicFollowerCountMap,
  getOwnedChallengePreferences,
  getRelationshipSummary,
  listOwnedActivityFeed,
  listOwnedOpponentHistory,
  listOwnedRelationships,
  normalizeChallengePreferences,
  requestRematch,
  unfollowPublicDj,
  updateOwnedChallengePreferences
};
