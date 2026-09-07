const { randomUUID, createHash } = require('crypto');
const BattleModes = require('../battle_modes');
const {
  PROGRESSION_PROFILE_TABLE,
  sanitizePublicProfile
} = require('./battle_award_ledger');
const {
  buildBattleRoomState,
  createBattleWithPrepSnapshot,
  joinBattleWithPrepSnapshot,
  validateOwnedBattlePrepCrate
} = require('./battle_prep_snapshots');

const DJ_CHALLENGE_TABLE = 'dj_challenges';
const DJ_NOTIFICATIONS_TABLE = 'dj_notifications';
const DJ_BLOCKS_TABLE = 'dj_blocks';
const DJ_NOTIFICATION_MUTES_TABLE = 'dj_notification_mutes';
const DJ_FOLLOWS_TABLE = 'dj_follows';
const DJ_CHALLENGE_PREFERENCES_TABLE = 'dj_challenge_preferences';
const CHALLENGE_STATUSES = Object.freeze(['pending', 'accepted', 'declined', 'cancelled', 'expired', 'converted-to-battle']);
const TERMINAL_CHALLENGE_STATUSES = new Set(['declined', 'cancelled', 'expired', 'converted-to-battle']);
const DEFAULT_CHALLENGE_LIMIT = 20;
const MAX_CHALLENGE_LIMIT = 50;
const DEFAULT_NOTIFICATION_LIMIT = 20;
const MAX_NOTIFICATION_LIMIT = 50;
const DEFAULT_EXPIRATION_HOURS = 72;
const SCORING_TYPES = new Set(['measured_rule_based', 'rule_based', 'ai_assisted', 'human_voted', 'hybrid']);
const PERSONAL_TRACK_METHODS = new Set(['own_selection', 'genre_pool', 'open_library', 'ai_practice']);
const NOTIFICATION_FILTERS = new Set(['all', 'unread', 'challenges', 'battles', 'relationships', 'archived']);
const NOTIFICATION_TYPES = new Set([
  'challenge_received',
  'challenge_accepted',
  'challenge_declined',
  'challenge_cancelled',
  'challenge_expired',
  'challenge_converted_to_battle',
  'rematch_requested',
  'follow_started',
  'comment_received',
  'reply_received',
  'reaction_received',
  'moderation_update'
]);
const NOTIFICATION_CATEGORIES = new Set(['challenge', 'battle', 'relationship', 'community']);
const CHALLENGE_AUDIENCES = new Set(['everyone', 'followed', 'prior_opponents', 'nobody']);

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

function stableHash(value){
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function optionalTableMissing(error){
  const message = String(error && (error.message || error.details || error.hint || error.code || error) || '').toLowerCase();
  return message.includes('does not exist')
    || message.includes('schema cache')
    || message.includes('could not find')
    || message.includes('relation')
    || message.includes('42p01');
}

function nowIso(now = new Date()){
  return now instanceof Date ? now.toISOString() : new Date(now || Date.now()).toISOString();
}

function safeDate(value){
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function pageNumber(value){
  const page = Number(value);
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function pageLimit(value){
  const limit = Number(value);
  if(!Number.isFinite(limit) || limit <= 0) return DEFAULT_CHALLENGE_LIMIT;
  return Math.min(MAX_CHALLENGE_LIMIT, Math.max(1, Math.floor(limit)));
}

function statusValue(value){
  const status = cleanString(value, 40) || 'pending';
  return CHALLENGE_STATUSES.includes(status) ? status : 'pending';
}

function isPending(row){
  return statusValue(row && row.status) === 'pending';
}

function isActiveChallenge(row, now = new Date()){
  return ['pending', 'accepted'].includes(statusValue(row && row.status)) && !isExpiredChallenge(row, now);
}

function isExpiredChallenge(row, now = new Date()){
  const expires = safeDate(row && row.expires_at);
  return Boolean(expires && expires.getTime() <= now.getTime());
}

function challengeBattleId(challengeId){
  return `battle-challenge-${stableHash({ challengeId }).slice(0, 24)}`;
}

function sanitizeBitcoinRewardMetadata(reward){
  const source = plainObject(reward);
  const metadata = plainObject(source.metadata);
  return {
    network: cleanString(metadata.network, 40) || 'bitcoin',
    amountSats: safeNumber(metadata.amountSats),
    custody: cleanString(metadata.custody, 80) || 'external_pending',
    walletConnected: metadata.walletConnected === true,
    transferStatus: metadata.verifiedPaymentId || metadata.paymentVerified === true ? 'verified_payment_record' : 'untransferred'
  };
}

function normalizeChallengeRules(input = {}){
  const source = plainObject(input.rules || input);
  const mode = BattleModes.getBattleMode(source.modeId || source.mode_id || source.mode || source.type);
  if(!mode) return { validationError:'Choose a valid battle mode.' };
  const explicitDuration = source.durationMinutes || source.duration_minutes || source.duration;
  const durationMinutes = BattleModes.parseDurationMinutes(explicitDuration, mode.defaultDurationMinutes);
  if(explicitDuration != null && mode.allowedDurations && !mode.allowedDurations.includes(durationMinutes)){
    return { validationError:`Duration must be one of: ${mode.allowedDurations.join(', ')} minutes.` };
  }
  let trackSelectionMethod = cleanString(source.trackSelectionMethod || source.track_selection_method, 40) || mode.trackSelectionMethod;
  if(source.ownSelection === true || source.own_selection === true){
    trackSelectionMethod = PERSONAL_TRACK_METHODS.has(mode.trackSelectionMethod) ? 'own_selection' : mode.trackSelectionMethod;
  }
  if(!BattleModes.TRACK_SELECTION_METHODS.includes(trackSelectionMethod)){
    return { validationError:'Choose a valid track-selection rule.' };
  }
  const scoringType = cleanString(source.scoringType || source.scoring_type, 40) || 'hybrid';
  if(!SCORING_TYPES.has(scoringType)) return { validationError:'Choose a valid scoring type.' };
  const rewardSource = plainObject(source.reward);
  const rewardType = cleanString(source.rewardType || source.reward_type || rewardSource.type, 40) || mode.rewardType || 'standard';
  const reward = {
    type: BattleModes.REWARD_TYPES.includes(rewardType) ? rewardType : mode.rewardType || 'standard',
    metadata: {
      ...plainObject(mode.rewardMetadata),
      ...plainObject(source.rewardMetadata || source.reward_metadata),
      ...plainObject(rewardSource.metadata)
    }
  };
  if(reward.type === 'bitcoin') reward.metadata = sanitizeBitcoinRewardMetadata(reward);
  const normalized = {
    modeId: mode.id,
    modeLabel: mode.label,
    title: cleanString(source.title, 160) || mode.label,
    genre: cleanString(source.genre, 80) || mode.defaultGenre,
    durationMinutes,
    trackSelectionMethod,
    trackCount: source.trackCount == null && source.track_count == null ? mode.trackCount : safeNumber(source.trackCount || source.track_count),
    minimumTrackCount: source.minimumTrackCount == null && source.minimum_track_count == null ? mode.minimumTrackCount : safeNumber(source.minimumTrackCount || source.minimum_track_count),
    opponentRequirement: 'required',
    visibility: 'available',
    scoringType,
    ownSelectionEligible: PERSONAL_TRACK_METHODS.has(trackSelectionMethod),
    premiumRequired: Boolean(mode.premiumRequired),
    reward
  };
  const validation = BattleModes.validateBattleConfig(normalized, {
    isPremium: source.isPremium !== false && source.premium !== false,
    requireAssignedTracks: false
  });
  if(validation && validation.ok === false){
    return { validationError: validation.errors.map(item => item.message).join(' ') };
  }
  return { rules: normalized, mode };
}

function battleInputFromChallenge(row, profile, options = {}){
  const rules = plainObject(row.challenge_rules || row.rules);
  const reward = plainObject(rules.reward);
  return {
    battleId: row.proposed_battle_id || challengeBattleId(row.id),
    modeId: rules.modeId,
    title: cleanString(rules.title, 160) || `${cleanString(profile && (profile.displayName || profile.name), 80) || 'DJ'} Challenge`,
    genre: rules.genre,
    durationMinutes: rules.durationMinutes,
    trackSelectionMethod: rules.trackSelectionMethod,
    trackCount: rules.trackCount,
    minimumTrackCount: rules.minimumTrackCount,
    opponentRequirement: 'required',
    visibility: 'available',
    scoringType: rules.scoringType,
    reward: {
      type: cleanString(reward.type, 40) || 'standard',
      metadata: plainObject(reward.metadata)
    },
    crateId: options.crateId,
    purpose: options.purpose,
    idempotencyKey: options.idempotencyKey,
    isPremium: options.isPremium !== false,
    publicProfile: profile
  };
}

function profileVisibility(row){
  const embedded = plainObject(row && row.public_profile);
  return cleanString(row && row.visibility, 40) || cleanString(embedded.visibility, 40) || 'public';
}

function publicProfileFromProgressionRow(row){
  if(!row) return null;
  const embedded = plainObject(row.public_profile);
  const sanitized = sanitizePublicProfile({
    ...embedded,
    publicProfileId: row.public_profile_id || embedded.publicProfileId,
    displayName: row.display_name || embedded.displayName || embedded.name || embedded.djName,
    country: row.country || embedded.country,
    flag: embedded.flag,
    belt: row.belt || embedded.belt,
    visibility: profileVisibility(row)
  }, row.user_id);
  if(profileVisibility(row) === 'private' || sanitized.visibility === 'private'){
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
    publicProfileId:sanitized.publicProfileId,
    displayName:sanitized.displayName,
    name:sanitized.displayName,
    profileVisibility:'public',
    country:sanitized.country || null,
    flag:sanitized.flag || null,
    belt:sanitized.belt || row.belt || 'Unranked',
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
  const profile = plainObject(value);
  if(profile.profileVisibility === 'private') return publicProfileFromProgressionRow({ visibility:'private', public_profile:{}, user_id:'private' });
  return {
    publicProfileId:cleanString(profile.publicProfileId || profile.id, 96),
    displayName:cleanString(profile.displayName || profile.name || profile.djName, 120) || 'DJ',
    name:cleanString(profile.name || profile.displayName || profile.djName, 120) || 'DJ',
    profileVisibility:'public',
    country:cleanString(profile.country, 80),
    flag:cleanString(profile.flag, 16),
    belt:cleanString(profile.belt, 40) || 'Unranked',
    rating:safeNumber(profile.rating),
    rank:safeNumber(profile.rank),
    wins:safeNumber(profile.wins),
    losses:safeNumber(profile.losses),
    ties:safeNumber(profile.ties),
    completedBattles:safeNumber(profile.completedBattles || profile.completed_battles)
  };
}

async function fetchProgressionProfiles(dataClient){
  const result = await tableQuery(dataClient, PROGRESSION_PROFILE_TABLE);
  if(result.error) return { error:result.error };
  const rows = result.data || [];
  const byUser = new Map();
  const byPublic = new Map();
  rows.forEach(row => {
    const safe = publicProfileFromProgressionRow(row);
    byUser.set(String(row.user_id), { row, profile:safe, public:Boolean(safe && safe.profileVisibility === 'public' && safe.publicProfileId) });
    if(safe && safe.publicProfileId) byPublic.set(String(safe.publicProfileId), { row, profile:safe, public:Boolean(safe.profileVisibility === 'public') });
    else if(row.public_profile_id) byPublic.set(String(row.public_profile_id), { row, profile:safe, public:false });
  });
  return { rows, byUser, byPublic };
}

async function resolveRecipientByPublicProfile(dataClient, publicProfileId){
  const requested = cleanString(publicProfileId, 96);
  if(!requested) return { validationError:'Recipient public profile is required.' };
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
  if(found && found.public) return { profile:found.profile, profiles };
  if(found) return { profile:found.profile, profiles };
  return {
    profile:profileSnapshot(sanitizePublicProfile({}, userId)),
    profiles
  };
}

function activeChallengeHash(challengerId, recipientId, rules){
  return stableHash({
    challengerId:String(challengerId),
    recipientId:String(recipientId),
    modeId:rules.modeId,
    genre:rules.genre,
    durationMinutes:rules.durationMinutes,
    trackSelectionMethod:rules.trackSelectionMethod,
    scoringType:rules.scoringType,
    rewardType:rules.reward && rules.reward.type
  });
}

function notificationLimit(value){
  const limit = Number(value);
  if(!Number.isFinite(limit) || limit <= 0) return DEFAULT_NOTIFICATION_LIMIT;
  return Math.min(MAX_NOTIFICATION_LIMIT, Math.max(1, Math.floor(limit)));
}

function normalizeNotificationFilter(value){
  const filter = cleanString(value, 40) || 'all';
  return NOTIFICATION_FILTERS.has(filter) ? filter : 'all';
}

function notificationTimestamp(row, eventType){
  const status = statusValue(row && row.status);
  const source = eventType === 'challenge_received'
    ? row.created_at
    : eventType === 'challenge_accepted'
      ? row.accepted_at || row.updated_at
      : eventType === 'challenge_declined'
        ? row.declined_at || row.updated_at
        : eventType === 'challenge_cancelled'
          ? row.cancelled_at || row.updated_at
          : eventType === 'challenge_expired'
            ? row.expired_at || row.updated_at
            : eventType === 'challenge_converted_to_battle'
              ? row.converted_at || row.updated_at
              : status === 'pending'
                ? row.created_at
                : row.updated_at;
  return safeDate(source) || safeDate(row.updated_at) || safeDate(row.created_at) || new Date();
}

function challengeEventVersion(row, eventType){
  return notificationTimestamp(row, eventType).getTime();
}

function eventTypeForChallengeStatus(row){
  const status = statusValue(row && row.status);
  if(status === 'pending' && cleanString(plainObject(row && row.origin_context).source, 80) === 'rematch') return 'rematch_requested';
  if(status === 'pending') return 'challenge_received';
  if(status === 'accepted') return 'challenge_accepted';
  if(status === 'declined') return 'challenge_declined';
  if(status === 'cancelled') return 'challenge_cancelled';
  if(status === 'expired') return 'challenge_expired';
  if(status === 'converted-to-battle') return 'challenge_converted_to_battle';
  return null;
}

function notificationRecipients(row, eventType){
  const challenger = String(row.challenger_user_id || '');
  const recipient = String(row.recipient_user_id || '');
  if(!challenger || !recipient) return [];
  if(eventType === 'challenge_received' || eventType === 'rematch_requested') return [{ userId:recipient, actorUserId:challenger, actorProfile:row.challenger_profile }];
  if(eventType === 'challenge_declined') return [{ userId:challenger, actorUserId:recipient, actorProfile:row.recipient_profile }];
  if(eventType === 'challenge_cancelled') return [{ userId:recipient, actorUserId:challenger, actorProfile:row.challenger_profile }];
  if(eventType === 'challenge_accepted') return [{ userId:challenger, actorUserId:recipient, actorProfile:row.recipient_profile }];
  if(eventType === 'challenge_expired'){
    return [
      { userId:challenger, actorUserId:recipient, actorProfile:row.recipient_profile },
      { userId:recipient, actorUserId:challenger, actorProfile:row.challenger_profile }
    ];
  }
  if(eventType === 'challenge_converted_to_battle'){
    return [
      { userId:challenger, actorUserId:recipient, actorProfile:row.recipient_profile },
      { userId:recipient, actorUserId:challenger, actorProfile:row.challenger_profile }
    ];
  }
  return [];
}

function notificationCategory(eventType){
  if(eventType === 'follow_started') return 'relationship';
  return eventType === 'challenge_converted_to_battle' ? 'battle' : 'challenge';
}

function notificationDestination(row, userId, eventType){
  if(eventType === 'challenge_converted_to_battle' && row.battle_id){
    return { type:'battle_room', battleId:String(row.battle_id), label:'Enter Battle Room' };
  }
  const challenge = sanitizeChallenge(row, userId);
  if(challenge && challenge.eligibility && challenge.eligibility.canAccept){
    return { type:'challenge_inbox', challengeId:String(row.id), label:'Respond to Challenge' };
  }
  return { type:'challenge_inbox', challengeId:String(row.id), label:'Open Challenges' };
}

function notificationEventKey(userId, row, eventType){
  return stableHash({
    userId:String(userId),
    challengeId:String(row.id),
    eventType,
    eventVersion:challengeEventVersion(row, eventType)
  });
}

async function findExistingNotification(dataClient, userId, eventKey){
  const result = await tableQuery(dataClient, DJ_NOTIFICATIONS_TABLE)
    .eq('user_id', userId)
    .eq('event_key', eventKey)
    .limit(1);
  if(result.error) return { error:result.error };
  return { notification:result.data && result.data[0] || null };
}

async function listOwnedMuteRows(dataClient, userId){
  const result = await tableQuery(dataClient, DJ_NOTIFICATION_MUTES_TABLE)
    .eq('user_id', userId)
    .limit(500);
  if(result.error) return { error:result.error };
  return { mutes:(result.data || []).filter(row => row.active !== false && row.muted !== false) };
}

function notificationMutedByRows(notification, mutes){
  const row = plainObject(notification);
  const category = cleanString(row.category, 40);
  const type = cleanString(row.type, 80);
  const actorUserId = cleanString(row.actor_user_id, 128);
  const actorProfile = plainObject(row.actor_profile);
  const actorPublicProfileId = cleanString(actorProfile.publicProfileId || row.actor_public_profile_id, 96);
  return safeArray(mutes).some(mute => {
    const muteCategory = cleanString(mute.category, 40) || 'challenge';
    const muteType = cleanString(mute.notification_type, 80);
    if(muteCategory !== 'all' && muteCategory !== category) return false;
    if(muteType && muteType !== type) return false;
    const mutedUserId = cleanString(mute.muted_user_id, 128);
    const mutedPublicProfileId = cleanString(mute.muted_public_profile_id, 96);
    if(mutedUserId && mutedUserId !== actorUserId) return false;
    if(mutedPublicProfileId && mutedPublicProfileId !== actorPublicProfileId) return false;
    return true;
  });
}

function sanitizeNotification(row, userId, mutes = []){
  if(!row || String(row.user_id) !== String(userId)) return null;
  const type = NOTIFICATION_TYPES.has(row.type) ? row.type : 'challenge_received';
  const challengeSnapshot = plainObject(row.challenge_snapshot);
  const challenge = challengeSnapshot.id ? challengeSnapshot : null;
  const muted = notificationMutedByRows(row, mutes);
  return {
    id:String(row.id),
    eventId:String(row.event_key || row.id),
    type,
    category:NOTIFICATION_CATEGORIES.has(row.category) ? row.category : notificationCategory(type),
    eventVersion:safeNumber(row.event_version) || 0,
    status:cleanString(row.status, 40) || 'delivered',
    readAt:row.read_at || null,
    archivedAt:row.archived_at || null,
    createdAt:row.created_at || null,
    updatedAt:row.updated_at || null,
    unread:!row.read_at,
    muted,
    actor:profileSnapshot(row.actor_profile),
    challenge,
    destination:plainObject(row.destination),
    summary:cleanString(row.summary, 180) || notificationSummary(type, challenge, row.actor_profile)
  };
}

function notificationSummary(type, challenge, actorProfile){
  const actor = profileSnapshot(actorProfile).displayName || 'A DJ';
  const rules = challenge && challenge.rules || {};
  if(type === 'rematch_requested') return `${actor} requested a rematch in ${rules.modeLabel || 'a battle'}.`;
  if(type === 'follow_started') return `${actor} followed your public profile.`;
  if(type === 'comment_received') return `${actor} commented on your community post.`;
  if(type === 'reply_received') return `${actor} replied in a community discussion.`;
  if(type === 'reaction_received') return `${actor} reacted to your community post.`;
  if(type === 'moderation_update') return 'A community moderation update is available.';
  if(type === 'challenge_received') return `${actor} challenged you to ${rules.modeLabel || 'a battle'}.`;
  if(type === 'challenge_accepted') return `${actor} accepted your challenge.`;
  if(type === 'challenge_declined') return `${actor} declined your challenge.`;
  if(type === 'challenge_cancelled') return `${actor} cancelled a pending challenge.`;
  if(type === 'challenge_expired') return `A pending challenge expired.`;
  if(type === 'challenge_converted_to_battle') return `${actor} is ready in the Battle Room.`;
  return 'Challenge update.';
}

async function emitChallengeNotifications(dataClient, row, eventType = eventTypeForChallengeStatus(row), now = new Date()){
  if(!row || !eventType || !NOTIFICATION_TYPES.has(eventType)) return { notifications:[] };
  const recipients = notificationRecipients(row, eventType);
  const notifications = [];
  const errors = [];
  for(const recipient of recipients){
    const userId = String(recipient.userId || '');
    if(!userId) continue;
    const eventKey = notificationEventKey(userId, row, eventType);
    const existing = await findExistingNotification(dataClient, userId, eventKey);
    if(existing.error){ errors.push(existing.error); continue; }
    if(existing.notification){
      notifications.push(existing.notification);
      continue;
    }
    const challenge = sanitizeChallenge(row, userId);
    const actorProfile = profileSnapshot(recipient.actorProfile);
    const payload = {
      id:`notification-${eventKey.slice(0, 24)}`,
      user_id:userId,
      type:eventType,
      category:notificationCategory(eventType),
      subject_type:'dj_challenge',
      subject_id:String(row.id),
      challenge_id:String(row.id),
      event_key:eventKey,
      event_version:challengeEventVersion(row, eventType),
      actor_user_id:String(recipient.actorUserId || ''),
      actor_public_profile_id:actorProfile.publicProfileId || null,
      actor_profile:actorProfile,
      challenge_snapshot:challenge,
      destination:notificationDestination(row, userId, eventType),
      summary:notificationSummary(eventType, challenge, actorProfile),
      status:'delivered',
      read_at:null,
      archived_at:null,
      created_at:notificationTimestamp(row, eventType).toISOString(),
      updated_at:nowIso(now)
    };
    const inserted = await dataClient.from(DJ_NOTIFICATIONS_TABLE).insert([payload]).select('*').single();
    if(inserted.error) errors.push(inserted.error);
    else notifications.push(inserted.data);
  }
  return errors.length ? { notifications, error:errors[0] } : { notifications };
}

async function ensureChallengeNotificationsForRows(dataClient, rows, now = new Date()){
  for(const row of rows || []){
    const eventType = eventTypeForChallengeStatus(row);
    if(eventType) await emitChallengeNotifications(dataClient, row, eventType, now);
  }
}

async function listOwnedNotifications(dataClient, userId, options = {}, now = new Date()){
  const challengeRowsResult = await tableQuery(dataClient, DJ_CHALLENGE_TABLE).limit(500);
  if(challengeRowsResult.error) return { error:challengeRowsResult.error };
  const visibleChallenges = (challengeRowsResult.data || []).filter(row => challengeVisibleToUser(row, userId));
  await expirePendingChallengeRows(dataClient, visibleChallenges, now);
  await ensureChallengeNotificationsForRows(dataClient, visibleChallenges, now);

  const result = await tableQuery(dataClient, DJ_NOTIFICATIONS_TABLE).limit(1000);
  if(result.error) return { error:result.error };
  const muteRows = await listOwnedMuteRows(dataClient, userId);
  if(muteRows.error) return muteRows;
  const filter = normalizeNotificationFilter(options.filter || options.status);
  const limit = notificationLimit(options.limit);
  const page = pageNumber(options.page);
  const rows = (result.data || [])
    .filter(row => String(row.user_id) === String(userId))
    .filter(row => {
      if(filter !== 'archived' && row.archived_at) return false;
      if(filter === 'archived') return Boolean(row.archived_at);
      if(filter === 'unread') return !row.read_at && !notificationMutedByRows(row, muteRows.mutes);
      if(filter === 'challenges') return row.category === 'challenge';
      if(filter === 'battles') return row.category === 'battle';
      if(filter === 'relationships') return row.category === 'relationship';
      return true;
    })
    .sort((a, b) => {
      const versionDiff = (safeNumber(b.event_version) || 0) - (safeNumber(a.event_version) || 0);
      if(versionDiff) return versionDiff;
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
  const start = (page - 1) * limit;
  const pageRows = rows.slice(start, start + limit);
  return {
    notifications:pageRows.map(row => sanitizeNotification(row, userId, muteRows.mutes)).filter(Boolean),
    pagination:{
      page,
      limit,
      total:rows.length,
      hasMore:start + limit < rows.length,
      nextPage:start + limit < rows.length ? page + 1 : null
    }
  };
}

async function countOwnedNotifications(dataClient, userId, now = new Date()){
  await listOwnedNotifications(dataClient, userId, { limit:1 }, now);
  const result = await tableQuery(dataClient, DJ_NOTIFICATIONS_TABLE).limit(1000);
  if(result.error) return { error:result.error };
  const muteRows = await listOwnedMuteRows(dataClient, userId);
  if(muteRows.error) return muteRows;
  const owned = (result.data || []).filter(row => String(row.user_id) === String(userId));
  const unread = owned.filter(row => !row.read_at && !row.archived_at && !notificationMutedByRows(row, muteRows.mutes));
  return {
    unreadTotal:unread.length,
    unreadChallenges:unread.filter(row => row.category === 'challenge').length,
    unreadBattles:unread.filter(row => row.category === 'battle').length,
    unreadRelationships:unread.filter(row => row.category === 'relationship').length,
    archived:owned.filter(row => row.archived_at).length
  };
}

async function markOwnedNotificationRead(dataClient, userId, notificationId, read = true, now = new Date()){
  const id = cleanString(notificationId, 128);
  if(!id) return { validationError:'Notification id is required.' };
  const existing = await tableQuery(dataClient, DJ_NOTIFICATIONS_TABLE)
    .eq('id', id)
    .eq('user_id', userId)
    .limit(1)
    .single();
  if(existing.error) return { error:existing.error };
  if(!existing.data) return { notFound:true };
  const updated = await dataClient.from(DJ_NOTIFICATIONS_TABLE)
    .update({ read_at:read ? nowIso(now) : null, updated_at:nowIso(now) })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  if(updated.error) return { error:updated.error };
  return { notification:sanitizeNotification(updated.data, userId), updated:true };
}

async function markAllOwnedNotificationsRead(dataClient, userId, options = {}, now = new Date()){
  const filter = normalizeNotificationFilter(options.filter);
  const listed = await listOwnedNotifications(dataClient, userId, { filter:filter === 'all' ? 'unread' : filter, limit:MAX_NOTIFICATION_LIMIT, page:1 }, now);
  if(listed.error) return listed;
  let count = 0;
  for(const item of listed.notifications || []){
    if(!item.unread) continue;
    const result = await markOwnedNotificationRead(dataClient, userId, item.id, true, now);
    if(result.error) return result;
    count += result.updated ? 1 : 0;
  }
  return { updatedCount:count };
}

async function listBlockRows(dataClient){
  const result = await tableQuery(dataClient, DJ_BLOCKS_TABLE).limit(1000);
  if(result.error) return { error:result.error };
  return { blocks:(result.data || []).filter(row => row.active !== false && row.status !== 'inactive') };
}

async function findActiveBlockBetween(dataClient, userA, userB){
  const listed = await listBlockRows(dataClient);
  if(listed.error) return listed;
  const blocks = listed.blocks.filter(row => {
    const blocker = String(row.blocker_user_id || '');
    const blocked = String(row.blocked_user_id || '');
    return (blocker === String(userA) && blocked === String(userB))
      || (blocker === String(userB) && blocked === String(userA));
  });
  return { blocked:Boolean(blocks.length), blocks };
}

async function listActiveFollowRows(dataClient){
  const result = await tableQuery(dataClient, DJ_FOLLOWS_TABLE).limit(1000);
  if(result.error){
    if(optionalTableMissing(result.error)) return { follows:[], missing:true };
    return { error:result.error };
  }
  return { follows:(result.data || []).filter(row => row.active !== false && row.status !== 'inactive') };
}

async function disableFollowRelationshipsBetween(dataClient, userA, userB, now = new Date()){
  const listed = await listActiveFollowRows(dataClient);
  if(listed.error) return listed;
  if(listed.missing) return { disabledCount:0, missing:true };
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

async function getChallengePreferenceRow(dataClient, userId){
  const result = await tableQuery(dataClient, DJ_CHALLENGE_PREFERENCES_TABLE)
    .eq('user_id', userId)
    .limit(1);
  if(result.error){
    if(optionalTableMissing(result.error)) return { row:null, missing:true };
    return { error:result.error };
  }
  return { row:result.data && result.data[0] || null };
}

function normalizeChallengePreferenceRow(row){
  const source = plainObject(row);
  const who = cleanString(source.who_may_challenge, 40) || 'everyone';
  const bitcoin = cleanString(source.bitcoin_battles, 40) || 'metadata_only';
  return {
    whoMayChallenge:CHALLENGE_AUDIENCES.has(who) ? who : 'everyone',
    allowedModes:safeArray(source.allowed_modes).map(item => cleanString(item, 80)).filter(Boolean),
    allowedGenres:safeArray(source.allowed_genres).map(item => cleanString(item, 80)).filter(Boolean),
    minRating:safeNumber(source.min_rating),
    maxRating:safeNumber(source.max_rating),
    allowedBelts:safeArray(source.allowed_belts).map(item => cleanString(item, 60)).filter(Boolean),
    bitcoinBattles:['allow', 'metadata_only', 'deny'].includes(bitcoin) ? bitcoin : 'metadata_only'
  };
}

async function hasActiveFollow(dataClient, followerId, followedId){
  const listed = await listActiveFollowRows(dataClient);
  if(listed.error) return listed;
  return {
    follows:(listed.follows || []).some(row =>
      String(row.follower_user_id) === String(followerId)
      && String(row.followed_user_id) === String(followedId)
    )
  };
}

async function hasPriorOpponentHistory(dataClient, userA, userB){
  const result = await tableQuery(dataClient, 'mix_submissions').eq('status', 'completed').limit(500);
  if(result.error){
    if(optionalTableMissing(result.error)) return { prior:false, missing:true };
    return { error:result.error };
  }
  const prior = (result.data || []).some(row => {
    const info = plainObject(row.processing_info);
    const summary = plainObject(info.battleResultSummary);
    const opponent = plainObject(summary.opponent);
    const owner = String(row.user_id || '');
    const opponentId = String(opponent.userId || opponent.user_id || '');
    return (owner === String(userA) && opponentId === String(userB))
      || (owner === String(userB) && opponentId === String(userA));
  });
  return { prior };
}

async function challengePreferenceDenial(dataClient, challengerId, recipientId, rules, challengerProfile){
  const result = await getChallengePreferenceRow(dataClient, recipientId);
  if(result.error) return result;
  if(!result.row) return { allowed:true, missing:result.missing };
  const preferences = normalizeChallengePreferenceRow(result.row);
  if(preferences.whoMayChallenge === 'nobody') return { forbidden:true };
  if(preferences.whoMayChallenge === 'followed'){
    const follow = await hasActiveFollow(dataClient, recipientId, challengerId);
    if(follow.error) return follow;
    if(!follow.follows) return { forbidden:true };
  }
  if(preferences.whoMayChallenge === 'prior_opponents'){
    const prior = await hasPriorOpponentHistory(dataClient, challengerId, recipientId);
    if(prior.error) return prior;
    if(!prior.prior) return { forbidden:true };
  }
  if(preferences.allowedModes.length && !preferences.allowedModes.includes(rules.modeId)) return { forbidden:true };
  if(preferences.allowedGenres.length && !preferences.allowedGenres.map(item => item.toLowerCase()).includes(String(rules.genre || '').toLowerCase())) return { forbidden:true };
  const rating = safeNumber(challengerProfile && challengerProfile.rating);
  if(preferences.minRating != null && (rating == null || rating < preferences.minRating)) return { forbidden:true };
  if(preferences.maxRating != null && (rating == null || rating > preferences.maxRating)) return { forbidden:true };
  if(preferences.allowedBelts.length){
    const belt = cleanString(challengerProfile && challengerProfile.belt, 60);
    if(!belt || !preferences.allowedBelts.map(item => item.toLowerCase()).includes(belt.toLowerCase())) return { forbidden:true };
  }
  const reward = plainObject(rules.reward);
  if(reward.type === 'bitcoin' && preferences.bitcoinBattles === 'deny') return { forbidden:true };
  return { allowed:true };
}

function sanitizeBlock(row){
  if(!row) return null;
  return {
    id:String(row.id),
    status:cleanString(row.status, 40) || 'active',
    blockedProfile:profileSnapshot(row.blocked_profile),
    createdAt:row.created_at || null,
    updatedAt:row.updated_at || null
  };
}

async function createDjBlock(dataClient, blockerId, input = {}, now = new Date()){
  const targetProfileId = input.blockedPublicProfileId || input.publicProfileId || input.blocked_public_profile_id;
  const target = await resolveRecipientByPublicProfile(dataClient, targetProfileId);
  if(target.error || target.validationError || target.notFound || target.private) return target;
  if(String(target.userId) === String(blockerId)) return { conflict:true, reason:'You cannot block yourself.' };
  const existing = await tableQuery(dataClient, DJ_BLOCKS_TABLE)
    .eq('blocker_user_id', blockerId)
    .eq('blocked_user_id', target.userId)
    .limit(1);
  if(existing.error) return { error:existing.error };
  const active = (existing.data || []).find(row => row.active !== false && row.status !== 'inactive');
  if(active) return { block:sanitizeBlock(active), duplicate:true, cancelledChallengeCount:0 };
  const idempotencyKey = cleanString(input.idempotencyKey || input.idempotency_key, 128);
  const payload = {
    id:`block-${stableHash({ blockerId, blockedId:target.userId, idempotencyKey }).slice(0, 24)}`,
    blocker_user_id:String(blockerId),
    blocked_user_id:String(target.userId),
    blocked_public_profile_id:target.profile.publicProfileId || null,
    blocked_profile:profileSnapshot(target.profile),
    idempotency_key:idempotencyKey,
    status:'active',
    active:true,
    created_at:nowIso(now),
    updated_at:nowIso(now)
  };
  const inserted = await dataClient.from(DJ_BLOCKS_TABLE).insert([payload]).select('*').single();
  if(inserted.error) return { error:inserted.error };
  const cancelled = await cancelPendingChallengesBetween(dataClient, blockerId, target.userId, now);
  if(cancelled.error) return cancelled;
  const followCleanup = await disableFollowRelationshipsBetween(dataClient, blockerId, target.userId, now);
  if(followCleanup.error) return followCleanup;
  return { block:sanitizeBlock(inserted.data), created:true, cancelledChallengeCount:cancelled.cancelledCount || 0, disabledFollowCount:followCleanup.disabledCount || 0 };
}

async function cancelPendingChallengesBetween(dataClient, userA, userB, now = new Date()){
  const result = await tableQuery(dataClient, DJ_CHALLENGE_TABLE).limit(500);
  if(result.error) return { error:result.error };
  let cancelledCount = 0;
  for(const row of result.data || []){
    const pair = (String(row.challenger_user_id) === String(userA) && String(row.recipient_user_id) === String(userB))
      || (String(row.challenger_user_id) === String(userB) && String(row.recipient_user_id) === String(userA));
    if(!pair || !isPending(row)) continue;
    const updated = await updatePendingChallenge(dataClient, row.id, { status:'cancelled', cancelled_at:nowIso(now), safety_cancelled:true }, now);
    if(updated.error) return updated;
    if(updated.challenge){
      cancelledCount += 1;
      await emitChallengeNotifications(dataClient, updated.challenge, 'challenge_cancelled', now);
    }
  }
  return { cancelledCount };
}

function sanitizeMute(row){
  if(!row) return null;
  return {
    id:String(row.id),
    category:cleanString(row.category, 40) || 'challenge',
    notificationType:cleanString(row.notification_type, 80),
    mutedProfileId:cleanString(row.muted_public_profile_id, 96),
    active:row.active !== false && row.muted !== false,
    createdAt:row.created_at || null,
    updatedAt:row.updated_at || null
  };
}

async function createNotificationMute(dataClient, userId, input = {}, now = new Date()){
  const category = cleanString(input.category, 40) || 'challenge';
  if(category !== 'all' && !NOTIFICATION_CATEGORIES.has(category)) return { validationError:'Choose a valid mute category.' };
  const notificationType = cleanString(input.notificationType || input.notification_type, 80);
  if(notificationType && !NOTIFICATION_TYPES.has(notificationType)) return { validationError:'Choose a valid notification type.' };
  let mutedUserId = cleanString(input.mutedUserId || input.muted_user_id, 128);
  let mutedPublicProfileId = cleanString(input.mutedPublicProfileId || input.publicProfileId || input.muted_public_profile_id, 96);
  if(mutedPublicProfileId && !mutedUserId){
    const target = await resolveRecipientByPublicProfile(dataClient, mutedPublicProfileId);
    if(target.error || target.validationError || target.notFound || target.private) return target;
    mutedUserId = String(target.userId);
    mutedPublicProfileId = target.profile.publicProfileId || mutedPublicProfileId;
  }
  if(mutedUserId && String(mutedUserId) === String(userId)) return { conflict:true, reason:'You cannot mute yourself.' };
  const result = await tableQuery(dataClient, DJ_NOTIFICATION_MUTES_TABLE).eq('user_id', userId).limit(500);
  if(result.error) return { error:result.error };
  const existing = (result.data || []).find(row =>
    row.active !== false
    && String(row.muted_user_id || '') === String(mutedUserId || '')
    && String(row.muted_public_profile_id || '') === String(mutedPublicProfileId || '')
    && String(row.category || '') === String(category)
    && String(row.notification_type || '') === String(notificationType || '')
  );
  if(existing) return { mute:sanitizeMute(existing), duplicate:true };
  const payload = {
    id:`mute-${stableHash({ userId, mutedUserId, mutedPublicProfileId, category, notificationType }).slice(0, 24)}`,
    user_id:String(userId),
    muted_user_id:mutedUserId || null,
    muted_public_profile_id:mutedPublicProfileId || null,
    category,
    notification_type:notificationType || null,
    muted:true,
    active:true,
    created_at:nowIso(now),
    updated_at:nowIso(now)
  };
  const inserted = await dataClient.from(DJ_NOTIFICATION_MUTES_TABLE).insert([payload]).select('*').single();
  if(inserted.error) return { error:inserted.error };
  return { mute:sanitizeMute(inserted.data), created:true };
}

async function getChallengeInteractionEligibility(dataClient, userId, publicProfileId, options = {}){
  const target = await resolveRecipientByPublicProfile(dataClient, publicProfileId);
  if(target.error) return target;
  const unavailable = { available:false, reason:'Challenge unavailable' };
  if(target.validationError || target.notFound || target.private) return unavailable;
  if(String(target.userId) === String(userId)) return { available:false, reason:'You cannot challenge yourself.' };
  if(blockingDenial(userId, target.userId, options)) return unavailable;
  const block = await findActiveBlockBetween(dataClient, userId, target.userId);
  if(block.error) return block;
  if(block.blocked) return unavailable;
  return { available:true, profile:profileSnapshot(target.profile) };
}

async function findChallengeByIdempotency(dataClient, challengerId, idempotencyKey){
  const key = cleanString(idempotencyKey, 128);
  if(!key) return { challenge:null };
  const result = await tableQuery(dataClient, DJ_CHALLENGE_TABLE)
    .eq('challenger_user_id', challengerId)
    .eq('idempotency_key', key)
    .limit(1);
  if(result.error) return { error:result.error };
  return { challenge:result.data && result.data[0] || null };
}

async function findActiveDuplicateChallenge(dataClient, challengerId, recipientId, rulesHash, now = new Date()){
  const result = await tableQuery(dataClient, DJ_CHALLENGE_TABLE)
    .eq('challenger_user_id', challengerId)
    .eq('recipient_user_id', recipientId)
    .eq('rules_hash', rulesHash)
    .limit(20);
  if(result.error) return { error:result.error };
  const challenge = (result.data || []).find(row => isActiveChallenge(row, now));
  return { challenge:challenge || null };
}

function sanitizeOrigin(origin = {}){
  const source = plainObject(origin);
  return {
    publicProfileId:cleanString(source.publicProfileId || source.profileId, 96),
    rankingCategory:cleanString(source.rankingCategory || source.category, 80),
    source:cleanString(source.source || 'public_profile', 80)
  };
}

function sanitizeChallengeRules(rules){
  const source = plainObject(rules);
  const reward = plainObject(source.reward);
  const rewardType = cleanString(reward.type, 40) || 'standard';
  return {
    modeId:cleanString(source.modeId, 80),
    modeLabel:cleanString(source.modeLabel, 120),
    title:cleanString(source.title, 160),
    genre:cleanString(source.genre, 80),
    durationMinutes:safeNumber(source.durationMinutes),
    trackSelectionMethod:cleanString(source.trackSelectionMethod, 40),
    ownSelectionEligible:Boolean(source.ownSelectionEligible),
    scoringType:cleanString(source.scoringType, 40) || 'hybrid',
    premiumRequired:Boolean(source.premiumRequired),
    opponentRequirement:'required',
    trackCount:safeNumber(source.trackCount),
    minimumTrackCount:safeNumber(source.minimumTrackCount),
    reward: rewardType === 'bitcoin'
      ? { type:'bitcoin', metadata:sanitizeBitcoinRewardMetadata(reward), transferStatus:'untransferred' }
      : { type:rewardType, metadataStatus:'standard' }
  };
}

function sanitizeChallenge(row, viewerId){
  if(!row) return null;
  const challenger = profileSnapshot(row.challenger_profile);
  const recipient = profileSnapshot(row.recipient_profile);
  const status = statusValue(row.status);
  const direction = String(row.challenger_user_id) === String(viewerId)
    ? 'sent'
    : String(row.recipient_user_id) === String(viewerId)
      ? 'received'
      : 'public';
  const pending = status === 'pending';
  return {
    id:String(row.id),
    publicChallengeId:String(row.public_challenge_id || `challenge-${stableHash(row.id).slice(0, 12)}`),
    status,
    direction,
    createdAt:row.created_at || null,
    updatedAt:row.updated_at || null,
    expiresAt:row.expires_at || null,
    acceptedAt:row.accepted_at || null,
    declinedAt:row.declined_at || null,
    cancelledAt:row.cancelled_at || null,
    battleId:row.battle_id || null,
    origin:sanitizeOrigin(row.origin_context),
    rules:sanitizeChallengeRules(row.challenge_rules),
    challenger,
    recipient,
    eligibility:{
      canAccept:pending && String(row.recipient_user_id) === String(viewerId),
      canDecline:pending && String(row.recipient_user_id) === String(viewerId),
      canCancel:pending && String(row.challenger_user_id) === String(viewerId),
      requiresRecipientCrate:Boolean(plainObject(row.challenge_rules).ownSelectionEligible),
      expirationStatus:status === 'expired' ? 'expired' : pending ? 'active' : 'terminal'
    }
  };
}

async function sendDjChallenge(dataClient, challengerId, input = {}, now = new Date(), options = {}){
  const idempotencyKey = cleanString(input.idempotencyKey || input.idempotency_key || options.idempotencyKey, 128);
  const existingByKey = await findChallengeByIdempotency(dataClient, challengerId, idempotencyKey);
  if(existingByKey.error) return existingByKey;
  if(existingByKey.challenge) return { challenge:sanitizeChallenge(existingByKey.challenge, challengerId), duplicate:true };

  const recipientResult = await resolveRecipientByPublicProfile(dataClient, input.recipientPublicProfileId || input.recipient_public_profile_id);
  if(recipientResult.error || recipientResult.notFound || recipientResult.private || recipientResult.validationError) return recipientResult;
  if(String(recipientResult.userId) === String(challengerId)) return { conflict:true, reason:'You cannot challenge yourself.' };
  if(blockingDenial(challengerId, recipientResult.userId, options)) return { forbidden:true, reason:'This challenge is blocked by participant safety settings.' };
  const block = await findActiveBlockBetween(dataClient, challengerId, recipientResult.userId);
  if(block.error) return block;
  if(block.blocked) return { forbidden:true, reason:'This DJ cannot receive challenges' };

  const challengerProfile = await resolveUserProfile(dataClient, challengerId, recipientResult.profiles);
  if(challengerProfile.error) return challengerProfile;
  const normalized = normalizeChallengeRules(input);
  if(normalized.validationError) return normalized;
  const rules = normalized.rules;
  const preference = await challengePreferenceDenial(dataClient, challengerId, recipientResult.userId, rules, challengerProfile.profile);
  if(preference.error) return preference;
  if(preference.forbidden) return { forbidden:true, reason:'This DJ cannot receive challenges' };
  const challengerCrateId = cleanString(input.challengerCrateId || input.challenger_crate_id || input.crateId || input.crate_id, 128);
  const validationBattle = {
    id:'challenge-validation',
    modeId:rules.modeId,
    genre:rules.genre,
    durationMinutes:rules.durationMinutes,
    trackSelectionMethod:rules.trackSelectionMethod,
    trackCount:rules.trackCount,
    minimumTrackCount:rules.minimumTrackCount,
    opponentRequirement:'required',
    reward:rules.reward,
    createdBy:challengerId
  };
  const validation = await validateOwnedBattlePrepCrate(dataClient, challengerId, challengerCrateId, validationBattle, { purpose:PERSONAL_TRACK_METHODS.has(rules.trackSelectionMethod) ? 'own_selection' : 'reference', now });
  if(validation.error || validation.forbidden || validation.unavailable || validation.validationError) return validation;
  if(!validation.ready) return { validationError: validation.ruleDecisions && validation.ruleDecisions.blockers.join(' ') || 'Battle Prep crate is not eligible.' };

  const rulesHash = activeChallengeHash(challengerId, recipientResult.userId, rules);
  const duplicate = await findActiveDuplicateChallenge(dataClient, challengerId, recipientResult.userId, rulesHash, now);
  if(duplicate.error) return duplicate;
  if(duplicate.challenge) return { conflict:true, reason:'An active challenge with these rules is already pending.' };

  const expirationHours = Math.min(168, Math.max(1, safeNumber(input.expirationHours || input.expiration_hours) || DEFAULT_EXPIRATION_HOURS));
  const payload = {
    id:cleanString(input.challengeId || input.id, 128) || `challenge-${randomUUID()}`,
    public_challenge_id:`ch_${stableHash({ challengerId, recipientId:recipientResult.userId, rulesHash, idempotencyKey }).slice(0, 20)}`,
    challenger_user_id:String(challengerId),
    recipient_user_id:String(recipientResult.userId),
    challenger_public_profile_id:challengerProfile.profile.publicProfileId || null,
    recipient_public_profile_id:recipientResult.profile.publicProfileId,
    challenger_profile:profileSnapshot(challengerProfile.profile),
    recipient_profile:profileSnapshot(recipientResult.profile),
    challenger_crate_id:challengerCrateId || null,
    challenge_rules:rules,
    rules_hash:rulesHash,
    proposed_battle_id:challengeBattleId(input.challengeId || idempotencyKey || rulesHash),
    origin_context:sanitizeOrigin(input.origin || input.originContext || input.origin_context),
    idempotency_key:idempotencyKey,
    status:'pending',
    expires_at:new Date(now.getTime() + expirationHours * 60 * 60 * 1000).toISOString(),
    created_at:now.toISOString(),
    updated_at:now.toISOString()
  };
  const inserted = await dataClient.from(DJ_CHALLENGE_TABLE).insert([payload]).select('*').single();
  if(inserted.error) return { error:inserted.error };
  const notifications = await emitChallengeNotifications(dataClient, inserted.data, eventTypeForChallengeStatus(inserted.data), now);
  return { challenge:sanitizeChallenge(inserted.data, challengerId), created:true, notifications:notifications.notifications || [], notificationError:notifications.error || null };
}

function challengeVisibleToUser(row, userId){
  return String(row.challenger_user_id) === String(userId) || String(row.recipient_user_id) === String(userId);
}

async function expirePendingChallengeRows(dataClient, rows, now = new Date()){
  const expired = rows.filter(row => isPending(row) && isExpiredChallenge(row, now));
  for(const row of expired){
    const updated = await dataClient.from(DJ_CHALLENGE_TABLE)
      .update({ status:'expired', expired_at:now.toISOString(), updated_at:now.toISOString() })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('*')
      .single();
    row.status = 'expired';
    row.expired_at = now.toISOString();
    row.updated_at = now.toISOString();
    await emitChallengeNotifications(dataClient, updated.data || row, 'challenge_expired', now);
  }
}

async function listOwnedDjChallenges(dataClient, userId, options = {}, now = new Date()){
  const limit = pageLimit(options.limit);
  const page = pageNumber(options.page);
  const result = await tableQuery(dataClient, DJ_CHALLENGE_TABLE).limit(Math.max(200, limit));
  if(result.error) return { error:result.error };
  const rows = (result.data || []).filter(row => challengeVisibleToUser(row, userId));
  await expirePendingChallengeRows(dataClient, rows, now);
  const direction = cleanString(options.direction, 20) || 'received';
  const statusFilter = cleanString(options.status, 40) || 'all';
  const filtered = rows
    .filter(row => {
      if(direction === 'sent' && String(row.challenger_user_id) !== String(userId)) return false;
      if(direction === 'received' && String(row.recipient_user_id) !== String(userId)) return false;
      if(direction === 'all' || direction === 'sent' || direction === 'received') return true;
      return false;
    })
    .filter(row => statusFilter === 'all' || statusValue(row.status) === statusFilter)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const start = (page - 1) * limit;
  const pageRows = filtered.slice(start, start + limit);
  return {
    challenges:pageRows.map(row => sanitizeChallenge(row, userId)),
    pagination:{
      page,
      limit,
      total:filtered.length,
      hasMore:start + limit < filtered.length,
      nextPage:start + limit < filtered.length ? page + 1 : null
    }
  };
}

async function countOwnedDjChallenges(dataClient, userId, now = new Date()){
  const result = await tableQuery(dataClient, DJ_CHALLENGE_TABLE).limit(500);
  if(result.error) return { error:result.error };
  const rows = (result.data || []).filter(row => challengeVisibleToUser(row, userId));
  await expirePendingChallengeRows(dataClient, rows, now);
  const pending = rows.filter(row => isPending(row));
  return {
    pendingReceived:pending.filter(row => String(row.recipient_user_id) === String(userId)).length,
    pendingSent:pending.filter(row => String(row.challenger_user_id) === String(userId)).length,
    pendingTotal:pending.length
  };
}

async function fetchOwnedChallenge(dataClient, userId, challengeId){
  const result = await tableQuery(dataClient, DJ_CHALLENGE_TABLE).eq('id', challengeId).limit(1).single();
  if(result.error) return { error:result.error };
  if(!result.data) return { notFound:true };
  if(!challengeVisibleToUser(result.data, userId)) return { forbidden:true };
  return { challenge:result.data };
}

async function updatePendingChallenge(dataClient, challengeId, patch, now = new Date()){
  return updateChallengeFromStatus(dataClient, challengeId, 'pending', patch, now);
}

async function updateChallengeFromStatus(dataClient, challengeId, currentStatus, patch, now = new Date()){
  const updated = await dataClient.from(DJ_CHALLENGE_TABLE)
    .update({ ...patch, updated_at:now.toISOString() })
    .eq('id', challengeId)
    .eq('status', currentStatus)
    .select('*')
    .single();
  if(updated.error) return { error:updated.error };
  if(!updated.data) return { conflict:true, reason:'Challenge has already changed status.' };
  return { challenge:updated.data };
}

async function declineDjChallenge(dataClient, userId, challengeId, now = new Date()){
  const owned = await fetchOwnedChallenge(dataClient, userId, challengeId);
  if(owned.error || owned.notFound || owned.forbidden) return owned;
  const row = owned.challenge;
  if(String(row.recipient_user_id) !== String(userId)) return { forbidden:true };
  if(isExpiredChallenge(row, now)){
    const expired = await updatePendingChallenge(dataClient, row.id, { status:'expired', expired_at:now.toISOString() }, now);
    if(expired.error) return expired;
    return { expired:true, conflict:true, reason:'Challenge has expired.', challenge:sanitizeChallenge(expired.challenge || row, userId) };
  }
  if(!isPending(row)) return { challenge:sanitizeChallenge(row, userId), duplicate:true, conflict:TERMINAL_CHALLENGE_STATUSES.has(statusValue(row.status)) };
  const updated = await updatePendingChallenge(dataClient, row.id, { status:'declined', declined_at:now.toISOString() }, now);
  if(updated.error || updated.conflict) return updated;
  const notifications = await emitChallengeNotifications(dataClient, updated.challenge, 'challenge_declined', now);
  return { challenge:sanitizeChallenge(updated.challenge, userId), declined:true, notifications:notifications.notifications || [] };
}

async function cancelDjChallenge(dataClient, userId, challengeId, now = new Date()){
  const owned = await fetchOwnedChallenge(dataClient, userId, challengeId);
  if(owned.error || owned.notFound || owned.forbidden) return owned;
  const row = owned.challenge;
  if(String(row.challenger_user_id) !== String(userId)) return { forbidden:true };
  if(isExpiredChallenge(row, now)){
    const expired = await updatePendingChallenge(dataClient, row.id, { status:'expired', expired_at:now.toISOString() }, now);
    if(expired.error) return expired;
    return { expired:true, conflict:true, reason:'Challenge has expired.', challenge:sanitizeChallenge(expired.challenge || row, userId) };
  }
  if(!isPending(row)) return { challenge:sanitizeChallenge(row, userId), duplicate:true, conflict:TERMINAL_CHALLENGE_STATUSES.has(statusValue(row.status)) };
  const updated = await updatePendingChallenge(dataClient, row.id, { status:'cancelled', cancelled_at:now.toISOString() }, now);
  if(updated.error || updated.conflict) return updated;
  const notifications = await emitChallengeNotifications(dataClient, updated.challenge, 'challenge_cancelled', now);
  return { challenge:sanitizeChallenge(updated.challenge, userId), cancelled:true, notifications:notifications.notifications || [] };
}

async function acceptDjChallenge(dataClient, userId, challengeId, input = {}, now = new Date(), options = {}){
  const owned = await fetchOwnedChallenge(dataClient, userId, challengeId);
  if(owned.error || owned.notFound || owned.forbidden) return owned;
  const row = owned.challenge;
  if(String(row.recipient_user_id) !== String(userId)) return { forbidden:true };
  const currentStatus = statusValue(row.status);
  if(currentStatus === 'converted-to-battle' && row.battle_id){
    const room = await buildBattleRoomState(dataClient, userId, row.battle_id, {}, now);
    return { challenge:sanitizeChallenge(row, userId), battleId:row.battle_id, room:room.state || null, duplicate:true };
  }
  if(currentStatus !== 'pending' && currentStatus !== 'accepted') return { conflict:true, reason:'Challenge is no longer pending.', challenge:sanitizeChallenge(row, userId) };
  if(isExpiredChallenge(row, now)){
    const expired = await updatePendingChallenge(dataClient, row.id, { status:'expired', expired_at:now.toISOString() }, now);
    if(expired.error) return expired;
    return { expired:true, conflict:true, reason:'Challenge has expired.', challenge:sanitizeChallenge(expired.challenge || row, userId) };
  }

  const recipientCrateId = cleanString(input.recipientCrateId || input.recipient_crate_id || input.crateId || input.crate_id, 128);
  const challengerProfile = profileSnapshot(row.challenger_profile);
  const recipientProfile = profileSnapshot(row.recipient_profile);
  const purpose = PERSONAL_TRACK_METHODS.has(plainObject(row.challenge_rules).trackSelectionMethod) ? 'own_selection' : 'reference';
  const validationBattle = {
    id:row.proposed_battle_id || challengeBattleId(row.id),
    modeId:plainObject(row.challenge_rules).modeId,
    genre:plainObject(row.challenge_rules).genre,
    durationMinutes:plainObject(row.challenge_rules).durationMinutes,
    trackSelectionMethod:plainObject(row.challenge_rules).trackSelectionMethod,
    trackCount:plainObject(row.challenge_rules).trackCount,
    minimumTrackCount:plainObject(row.challenge_rules).minimumTrackCount,
    opponentRequirement:'required',
    reward:plainObject(row.challenge_rules).reward,
    createdBy:row.challenger_user_id
  };
  const challengerValidation = await validateOwnedBattlePrepCrate(dataClient, row.challenger_user_id, row.challenger_crate_id, validationBattle, { purpose, now });
  if(challengerValidation.error || challengerValidation.forbidden || challengerValidation.unavailable || challengerValidation.validationError) return challengerValidation;
  if(!challengerValidation.ready) return { validationError:challengerValidation.ruleDecisions && challengerValidation.ruleDecisions.blockers.join(' ') || 'Challenger Battle Prep crate is no longer eligible.' };
  const recipientValidation = await validateOwnedBattlePrepCrate(dataClient, userId, recipientCrateId, validationBattle, { purpose, now });
  if(recipientValidation.error || recipientValidation.forbidden || recipientValidation.unavailable || recipientValidation.validationError) return recipientValidation;
  if(!recipientValidation.ready) return { validationError:recipientValidation.ruleDecisions && recipientValidation.ruleDecisions.blockers.join(' ') || 'Recipient Battle Prep crate is not eligible.' };
  if(currentStatus === 'pending'){
    const reserved = await updatePendingChallenge(dataClient, row.id, { status:'accepted', accepted_at:now.toISOString() }, now);
    if(reserved.error || reserved.conflict) return reserved;
    await emitChallengeNotifications(dataClient, reserved.challenge, 'challenge_accepted', now);
  }
  const createResult = await createBattleWithPrepSnapshot(dataClient, row.challenger_user_id, battleInputFromChallenge(row, challengerProfile, {
    crateId:row.challenger_crate_id,
    purpose,
    idempotencyKey:`challenge-create:${row.id}`,
    isPremium:options.challengerPremium !== false
  }), now);
  if(createResult.error || createResult.forbidden || createResult.unavailable || createResult.validationError || createResult.conflict) return createResult;
  if(createResult.entry && createResult.entry.id){
    await dataClient.from('battle_entries').update({ public_profile:challengerProfile, updated_at:now.toISOString() }).eq('id', createResult.entry.id);
  }
  const joinResult = await joinBattleWithPrepSnapshot(dataClient, userId, createResult.battle.id, {
    crateId:recipientCrateId,
    purpose,
    idempotencyKey:`challenge-join:${row.id}:${userId}`
  }, now);
  if(joinResult.error || joinResult.forbidden || joinResult.unavailable || joinResult.validationError || joinResult.conflict) return joinResult;
  if(joinResult.entry && joinResult.entry.id){
    await dataClient.from('battle_entries').update({ public_profile:recipientProfile, updated_at:now.toISOString() }).eq('id', joinResult.entry.id);
  }
  const updated = await updateChallengeFromStatus(dataClient, row.id, 'accepted', {
    status:'converted-to-battle',
    accepted_at:now.toISOString(),
    converted_at:now.toISOString(),
    battle_id:createResult.battle.id
  }, now);
  if(updated.error) return updated;
  if(updated.conflict){
    return { conflict:true, reason:'Challenge was changed before acceptance completed.', battle:createResult.battle, entry:joinResult.entry, snapshot:joinResult.snapshot };
  }
  const notifications = await emitChallengeNotifications(dataClient, updated.challenge, 'challenge_converted_to_battle', now);
  const room = await buildBattleRoomState(dataClient, userId, createResult.battle.id, {}, now);
  return {
    challenge:sanitizeChallenge(updated.challenge, userId),
    battle:createResult.battle,
    entry:joinResult.entry,
    snapshot:joinResult.snapshot,
    room:room.state || null,
    notifications:notifications.notifications || [],
    accepted:true
  };
}

function blockingDenial(challengerId, recipientId, options = {}){
  return safeArray(options.blockedPairs).some(pair => {
    const source = Array.isArray(pair) ? { from:pair[0], to:pair[1] } : plainObject(pair);
    const from = String(source.from || source.blocker || '');
    const to = String(source.to || source.blocked || '');
    return (from === String(recipientId) && to === String(challengerId))
      || (from === String(challengerId) && to === String(recipientId));
  });
}

module.exports = {
  DJ_BLOCKS_TABLE,
  DJ_CHALLENGE_TABLE,
  DJ_CHALLENGE_PREFERENCES_TABLE,
  DJ_FOLLOWS_TABLE,
  DJ_NOTIFICATION_MUTES_TABLE,
  DJ_NOTIFICATIONS_TABLE,
  CHALLENGE_STATUSES,
  acceptDjChallenge,
  blockingDenial,
  cancelDjChallenge,
  countOwnedNotifications,
  createDjBlock,
  createNotificationMute,
  countOwnedDjChallenges,
  listOwnedDjChallenges,
  listOwnedNotifications,
  markAllOwnedNotificationsRead,
  markOwnedNotificationRead,
  getChallengeInteractionEligibility,
  normalizeChallengeRules,
  sanitizeChallenge,
  sanitizeNotification,
  sendDjChallenge,
  declineDjChallenge
};
