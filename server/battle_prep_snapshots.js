const { randomUUID, createHash } = require('crypto');
const BattleModes = require('../battle_modes');
const {
  LIBRARY_CRATE_TABLE,
  LIBRARY_CRATE_MEMBERSHIP_TABLE,
  LIBRARY_TRACK_TABLE,
  camelotKeyFor
} = require('./music_library');
const { getOrCreateBattleEntry, getOwnedBattleEntry, getStoredJudgeResult } = require('./battle_submission');
const { applyResolvedBattleAwards, sanitizeFailure } = require('./battle_award_ledger');
const {
  buildLockedScoringFormula,
  lockVotingConfig,
  normalizeVotingConfig,
  prepareCommunityVotingForResolution,
  publicVotingSummaryForBattle,
  sanitizeLockedScoringFormula
} = require('./battle_community_voting');

const BATTLE_RECORD_TABLE = 'battle_records';
const BATTLE_PREP_SNAPSHOT_TABLE = 'battle_prep_entry_snapshots';
const BATTLE_PREP_REPLACEMENT_TABLE = 'battle_prep_snapshot_replacements';
const DJ_FOLLOWS_TABLE = 'dj_follows';
const DJ_BLOCKS_TABLE = 'dj_blocks';
const BATTLE_RESOLUTION_SOURCE = 'server_competitive_battle_resolution';
const PERSONAL_TRACK_METHODS = new Set(['own_selection', 'genre_pool', 'open_library', 'ai_practice']);
const DEFAULT_CAPACITY = 2;
const DEFAULT_LOBBY_LIMIT = 20;
const MAX_LOBBY_LIMIT = 50;
const JOINABLE_STATUSES = new Set(['open', 'waiting']);
const RECOVERABLE_BATTLE_STATUSES = new Set(['open', 'waiting', 'matched', 'full', 'ready', 'started', 'active', 'submission_pending', 'judging']);
const PARTICIPANT_STATUSES = new Set(['joined', 'preparing', 'ready', 'started', 'submitted', 'disconnected', 'withdrawn', 'completed']);
const STARTED_BATTLE_STATUSES = new Set(['started', 'active', 'submission_pending', 'judging', 'completed']);
const PRESENCE_STALE_MS = 45 * 1000;

function cleanString(value, max = 160){
  if(value == null) return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return text ? text.slice(0, max) : null;
}

function safeNumber(value){
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function plainObject(value){
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeArray(value){
  return Array.isArray(value) ? value : [];
}

function stableHash(value){
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function modeFor(input){
  return BattleModes.getBattleMode(input && (input.modeId || input.mode_id || input.mode || input.type)) || BattleModes.getBattleMode('transition_battle');
}

function normalizeBattleInput(userId, input = {}, now = new Date()){
  const mode = modeFor(input);
  const rewardType = cleanString(input.rewardType || input.reward_type || input.reward && input.reward.type, 40) || mode.rewardType || 'standard';
  const rewardMetadata = {
    ...plainObject(mode.rewardMetadata),
    ...plainObject(input.rewardMetadata || input.reward_metadata),
    ...plainObject(input.reward && input.reward.metadata)
  };
  const durationMinutes = BattleModes.parseDurationMinutes(input.durationMinutes || input.duration_minutes, mode.defaultDurationMinutes);
  const record = BattleModes.normalizeBattleRecord({
    id: cleanString(input.battleId || input.id, 128) || `battle-${randomUUID()}`,
    title: cleanString(input.title, 160) || mode.label,
    modeId: mode.id,
    genre: cleanString(input.genre, 80) || mode.defaultGenre,
    durationMinutes,
    trackSelectionMethod: cleanString(input.trackSelectionMethod || input.track_selection_method, 40) || mode.trackSelectionMethod,
    trackCount: input.trackCount == null ? mode.trackCount : safeNumber(input.trackCount),
    minimumTrackCount: input.minimumTrackCount == null ? mode.minimumTrackCount : safeNumber(input.minimumTrackCount),
    opponentRequirement: cleanString(input.opponentRequirement || input.opponent_requirement, 40) || mode.opponentRequirement,
    visibility: cleanString(input.visibility, 40) || 'public',
    reward: { type: rewardType, metadata: rewardMetadata },
    rewardType,
    rewardMetadata,
    status: input.status || 'open',
    createdBy: userId,
    createdAt: now.toISOString()
  });
  const validation = BattleModes.validateBattleConfig ? BattleModes.validateBattleConfig(record, {
    isPremium: Boolean(input.isPremium || input.premium),
    requireAssignedTracks: false
  }) : [];
  if(validation && validation.ok === false) return { validationError: validation.errors.map(item => item.message).join(' ') };
  return { battle: record, mode };
}

function battleCapacity(battle){
  if((battle.opponentRequirement || '') === 'none') return 1;
  const requested = Number(battle.capacity || battle.maxParticipants);
  return Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : DEFAULT_CAPACITY;
}

function safeDate(value){
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function safeIso(value){
  const date = safeDate(value);
  return date ? date.toISOString() : null;
}

function safeIsoFromNow(now){
  return now instanceof Date ? now.toISOString() : new Date(now || Date.now()).toISOString();
}

function clampLimit(value, fallback = DEFAULT_LOBBY_LIMIT){
  const limit = Number(value);
  if(!Number.isFinite(limit) || limit <= 0) return fallback;
  return Math.min(MAX_LOBBY_LIMIT, Math.max(1, Math.floor(limit)));
}

function positivePage(value){
  const page = Number(value);
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function sanitizePublicDjProfile(value = {}){
  const profile = plainObject(value);
  return {
    name: cleanString(profile.name || profile.djName || profile.displayName, 80) || 'DJ',
    country: cleanString(profile.country, 80),
    flag: cleanString(profile.flag, 16),
    belt: cleanString(profile.belt, 40),
    rating: safeNumber(profile.rating),
    rank: safeNumber(profile.rank),
    publicProfileId: cleanString(profile.publicProfileId || profile.slug || profile.handle, 96)
  };
}

function sanitizeStartConditions(value = {}){
  const conditions = plainObject(value);
  return {
    startsWhenFull: conditions.startsWhenFull !== false,
    manualStart: Boolean(conditions.manualStart),
    scheduledAt: safeIso(conditions.scheduledAt || conditions.scheduled_at),
    expiresAt: safeIso(conditions.expiresAt || conditions.expires_at),
    beltRange: cleanString(conditions.beltRange || conditions.belt_range, 80),
    ratingMin: safeNumber(conditions.ratingMin || conditions.rating_min),
    ratingMax: safeNumber(conditions.ratingMax || conditions.rating_max)
  };
}

function scoringTypeFor(input = {}, battle = {}){
  const explicit = cleanString(input.scoringType || input.scoring_type || battle.scoringType || battle.scoring_type, 40);
  if(explicit) return explicit;
  const ai = input.aiJudging !== false && input.ai_judging !== false;
  const community = input.communityJudging !== false && input.community_judging !== false;
  if(ai && community) return 'hybrid';
  if(ai) return 'ai_assisted';
  if(community) return 'human_voted';
  return 'measured_rule_based';
}

function expirationForBattle(input = {}, now = new Date()){
  const explicit = safeIso(input.expiresAt || input.expires_at);
  if(explicit) return explicit;
  const hours = safeNumber(input.expirationHours || input.expiration_hours);
  if(hours && hours > 0){
    return new Date(now.getTime() + Math.min(hours, 168) * 60 * 60 * 1000).toISOString();
  }
  return null;
}

function isExpiredBattle(row, now = new Date()){
  const expiresAt = safeDate(row && (row.expires_at || row.expiresAt));
  return Boolean(expiresAt && expiresAt.getTime() <= now.getTime());
}

function battleStatusForLobby(row, entryCount = 0, now = new Date()){
  const raw = cleanString(row && row.status, 40) || 'open';
  if(['cancelled', 'completed', 'deleted', 'unavailable'].includes(raw)) return raw;
  if(isExpiredBattle(row, now) && ['open', 'waiting', 'matched', 'full'].includes(raw)) return 'expired';
  if(['started', 'active', 'submission_pending', 'judging'].includes(raw)) return 'started';
  const capacity = battleCapacity({
    opponentRequirement: row && row.opponent_requirement,
    capacity: row && row.capacity
  });
  if(entryCount >= capacity) return raw === 'matched' ? 'full' : raw === 'open' || raw === 'waiting' ? 'full' : raw;
  if(entryCount > 0 && raw === 'open') return 'waiting';
  return raw;
}

function isJoinableLobbyStatus(status){
  return JOINABLE_STATUSES.has(status);
}

function sanitizeBitcoinRewardMetadata(row){
  const reward = plainObject(row && row.reward);
  const metadata = plainObject(row && (row.bitcoin_reward_metadata || reward.metadata));
  if((row && row.reward_type) !== 'bitcoin' && reward.type !== 'bitcoin' && !metadata.amountSats) return null;
  return {
    status: metadata.verifiedPaymentId || metadata.verified_payment_id ? 'verified_payment_recorded' : 'metadata_untransferred',
    network: cleanString(metadata.network, 40) || 'bitcoin',
    amountSats: safeNumber(metadata.amountSats || metadata.amount_sats),
    custody: cleanString(metadata.custody, 80) || 'external_pending',
    walletConnected: Boolean(metadata.walletConnected || metadata.wallet_connected),
    verifiedPayment: Boolean(metadata.verifiedPaymentId || metadata.verified_payment_id)
  };
}

function purposeForBattle(battle, requestedPurpose){
  const method = battle && battle.trackSelectionMethod || modeFor(battle).trackSelectionMethod;
  if(PERSONAL_TRACK_METHODS.has(method)) return 'own_selection';
  return requestedPurpose === 'reference' ? 'reference' : 'reference';
}

function requiredTrackCount(battle, purpose){
  if(purpose !== 'own_selection') return 0;
  const count = safeNumber(battle.trackCount);
  const minimum = safeNumber(battle.minimumTrackCount);
  return Math.max(1, Number(count || minimum || 1));
}

function tableQuery(dataClient, table){
  return dataClient.from(table).select('*');
}

function optionalTableMissing(error){
  const message = String(error && (error.message || error.details || error.hint || error.code || error) || '').toLowerCase();
  return message.includes('does not exist')
    || message.includes('schema cache')
    || message.includes('could not find')
    || message.includes('relation')
    || message.includes('42p01');
}

function activeFollowRow(row){
  return row && row.active !== false && row.status !== 'inactive';
}

async function fetchActiveFollowRows(dataClient){
  const result = await tableQuery(dataClient, DJ_FOLLOWS_TABLE).limit(2000);
  if(result.error){
    if(optionalTableMissing(result.error)) return { follows:[], missing:true };
    return { error:result.error };
  }
  return { follows:(result.data || []).filter(activeFollowRow) };
}

async function fetchBlockedUserIds(dataClient, viewerUserId){
  if(!viewerUserId) return { userIds:new Set() };
  const result = await tableQuery(dataClient, DJ_BLOCKS_TABLE).limit(500);
  if(result.error){
    if(optionalTableMissing(result.error)) return { userIds:new Set(), missing:true };
    return { error:result.error };
  }
  const ids = new Set();
  (result.data || []).forEach(row => {
    if(row.active === false || row.status === 'inactive') return;
    const blocker = String(row.blocker_user_id || '');
    const blocked = String(row.blocked_user_id || '');
    if(blocker === String(viewerUserId) && blocked) ids.add(blocked);
    if(blocked === String(viewerUserId) && blocker) ids.add(blocker);
  });
  return { userIds:ids };
}

async function fetchPriorOpponentUserIds(dataClient, viewerUserId){
  const result = await tableQuery(dataClient, 'mix_submissions')
    .eq('user_id', viewerUserId)
    .eq('status', 'completed')
    .limit(500);
  if(result.error){
    if(optionalTableMissing(result.error)) return { userIds:new Set(), missing:true };
    return { error:result.error };
  }
  const ids = new Set();
  (result.data || []).forEach(row => {
    const summary = plainObject(plainObject(row.processing_info).battleResultSummary);
    const opponent = plainObject(summary.opponent);
    const opponentUserId = cleanString(opponent.userId || opponent.user_id, 128);
    if(opponentUserId && opponentUserId !== String(viewerUserId)) ids.add(opponentUserId);
  });
  return { userIds:ids };
}

function relationshipScope(value){
  const scope = cleanString(value, 40) || 'all';
  return ['following', 'prior_opponents'].includes(scope) ? scope : 'all';
}

async function relationshipCreatorFilter(dataClient, options = {}){
  const scope = relationshipScope(options.relationship || options.creatorScope || options.relationshipScope);
  const viewerUserId = cleanString(options.viewerUserId || options.userId, 128);
  if(scope === 'all') return { scope:'all', userIds:null };
  if(!viewerUserId) return { validationError:'Authenticated viewer is required for relationship-scoped lobby discovery.' };
  const blocked = await fetchBlockedUserIds(dataClient, viewerUserId);
  if(blocked.error) return blocked;
  let ids = new Set();
  if(scope === 'following'){
    const follows = await fetchActiveFollowRows(dataClient);
    if(follows.error) return follows;
    ids = new Set(follows.follows
      .filter(row => String(row.follower_user_id) === String(viewerUserId))
      .map(row => String(row.followed_user_id))
      .filter(id => id && !blocked.userIds.has(id)));
  }else{
    const opponents = await fetchPriorOpponentUserIds(dataClient, viewerUserId);
    if(opponents.error) return opponents;
    ids = new Set(Array.from(opponents.userIds).filter(id => id && !blocked.userIds.has(id)));
  }
  ids.delete(String(viewerUserId));
  return { scope, userIds:ids };
}

function followerCountsByPublicProfile(follows, publicProfileIds){
  const ids = new Set(safeArray(publicProfileIds).map(id => cleanString(id, 96)).filter(Boolean));
  const counts = new Map();
  ids.forEach(id => counts.set(id, { followers:0, following:0, source:'server' }));
  safeArray(follows).forEach(row => {
    const followed = cleanString(row.followed_public_profile_id || plainObject(row.followed_profile).publicProfileId, 96);
    const follower = cleanString(row.follower_public_profile_id || plainObject(row.follower_profile).publicProfileId, 96);
    if(followed && counts.has(followed)) counts.get(followed).followers += 1;
    if(follower && counts.has(follower)) counts.get(follower).following += 1;
  });
  return counts;
}

async function fetchFollowerCounts(dataClient, publicProfileIds){
  const ids = safeArray(publicProfileIds).filter(Boolean);
  if(!ids.length) return { counts:new Map() };
  const follows = await fetchActiveFollowRows(dataClient);
  if(follows.error) return follows;
  return { counts:followerCountsByPublicProfile(follows.follows, ids), missing:Boolean(follows.missing) };
}

async function fetchOwnedCrate(dataClient, userId, crateId){
  if(!crateId) return { validationError: 'Battle Prep crate is required for this battle mode' };
  const result = await tableQuery(dataClient, LIBRARY_CRATE_TABLE).eq('id', crateId).limit(1).single();
  if(result.error) return { error: result.error };
  if(!result.data || result.data.archived_at) return { unavailable: true };
  if(String(result.data.user_id) !== String(userId)) return { forbidden: true };
  if(result.data.type !== 'battle_prep') return { validationError: 'Choose an owned Battle Prep crate' };
  return { crate: result.data };
}

async function fetchCrateMemberships(dataClient, userId, crateId){
  const result = await tableQuery(dataClient, LIBRARY_CRATE_MEMBERSHIP_TABLE).eq('crate_id', crateId).eq('user_id', userId);
  if(result.error) return { error: result.error };
  const rows = (result.data || [])
    .filter(row => !row.archived_at)
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
  return { memberships: rows };
}

async function fetchTracksByIds(dataClient, trackIds){
  const ids = Array.from(new Set(trackIds.map(id => String(id))));
  if(!ids.length) return { tracks: [] };
  let query = tableQuery(dataClient, LIBRARY_TRACK_TABLE);
  if(typeof query.in === 'function') query = query.in('id', ids);
  const result = await query;
  if(result.error) return { error: result.error };
  const idSet = new Set(ids);
  return { tracks: (result.data || []).filter(row => idSet.has(String(row.id))) };
}

function trackDecision(track, battle, mode, purpose){
  const blockers = [];
  const warnings = [];
  if(!track || track.archived_at) blockers.push('Track is unavailable.');
  const rights = cleanString(track && track.rights_classification, 80) || 'unknown';
  if(track && String(track.user_id) !== String(battle.createdBy || track.user_id)) blockers.push('Track belongs to another DJ.');
  if(track && !track.audio_storage_object_path && !track.linked_submission_id) blockers.push('Track does not have authorized audio available.');
  if(track && /commercial/i.test(rights)) blockers.push('Track rights do not permit battle use.');
  const method = battle.trackSelectionMethod || mode.trackSelectionMethod;
  if(track && method === 'genre_pool'){
    const battleGenre = cleanString(battle.genre, 80);
    const trackGenre = cleanString(track.genre, 80);
    if(battleGenre && !['global', 'all', 'open format'].includes(battleGenre.toLowerCase()) && String(trackGenre || '').toLowerCase() !== battleGenre.toLowerCase()){
      blockers.push('Track does not match the required battle genre.');
    }
  }
  const duration = safeNumber(track && track.duration);
  if(track && duration != null && safeNumber(battle.durationMinutes) != null && duration > Number(battle.durationMinutes) * 60){
    warnings.push('Track is longer than the battle duration.');
  }
  if(track && track.analysis_confidence == null) warnings.push('Track analysis is missing.');
  if(purpose === 'reference' && PERSONAL_TRACK_METHODS.has(method)) warnings.push('Reference-only prep will not replace own-selection requirements.');
  return {
    status: blockers.length ? 'blocked' : warnings.length ? 'warning' : 'ready',
    blockers,
    warnings
  };
}

function snapshotTrack(row, membership, order, decision){
  return {
    libraryTrackId: String(row.id),
    order,
    bpm: safeNumber(row.bpm),
    key: cleanString(row.key, 40),
    camelotKey: cleanString(row.camelot_key || camelotKeyFor(row.key), 8),
    genre: cleanString(row.genre, 80),
    duration: safeNumber(row.duration),
    rightsClassification: cleanString(row.rights_classification, 80) || 'unknown',
    analysisConfidence: safeNumber(row.analysis_confidence),
    sourceType: cleanString(row.source_type, 40) || 'track',
    membershipId: cleanString(membership && membership.id, 128),
    availability: decision.status === 'blocked' ? 'blocked' : 'available',
    status: decision.status,
    reasons: [...decision.blockers, ...decision.warnings]
  };
}

async function validateOwnedBattlePrepCrate(dataClient, userId, crateId, battle, options = {}){
  const mode = modeFor(battle);
  const purpose = purposeForBattle(battle, options.purpose);
  const method = battle.trackSelectionMethod || mode.trackSelectionMethod;
  if(!crateId && !PERSONAL_TRACK_METHODS.has(method)){
    return {
      ready: true,
      optional: true,
      purpose,
      tracks: [],
      ruleDecisions: { ready:true, blockers:[], warnings:[], requiredTrackCount:0, method, purpose }
    };
  }
  const crateResult = await fetchOwnedCrate(dataClient, userId, crateId);
  if(crateResult.error || crateResult.forbidden || crateResult.unavailable || crateResult.validationError) return crateResult;
  const memberships = await fetchCrateMemberships(dataClient, userId, crateId);
  if(memberships.error) return memberships;
  const trackIds = memberships.memberships.map(row => String(row.track_id));
  const tracksResult = await fetchTracksByIds(dataClient, trackIds);
  if(tracksResult.error) return tracksResult;
  const tracksById = new Map((tracksResult.tracks || []).map(row => [String(row.id), row]));
  const blockers = [];
  const warnings = [];
  const rows = [];

  memberships.memberships.forEach((membership, index) => {
    const track = tracksById.get(String(membership.track_id));
    if(track && String(track.user_id) !== String(userId)){
      blockers.push('Crate contains a track owned by another DJ.');
      return;
    }
    const decision = trackDecision(track, { ...battle, createdBy:userId }, mode, purpose);
    if(!track) decision.blockers.push('Track no longer exists.');
    decision.blockers.forEach(reason => blockers.push(`Track ${index + 1}: ${reason}`));
    decision.warnings.forEach(reason => warnings.push(`Track ${index + 1}: ${reason}`));
    if(track) rows.push(snapshotTrack(track, membership, index, decision));
  });

  const required = requiredTrackCount(battle, purpose);
  const readyCount = rows.filter(row => row.status !== 'blocked').length;
  if(required && readyCount < required) blockers.push(`Battle Prep crate needs at least ${required} eligible track(s).`);
  if(!memberships.memberships.length && required) blockers.push('Battle Prep crate has no tracks.');
  if(!PERSONAL_TRACK_METHODS.has(method) && purpose === 'own_selection') blockers.push('Assigned-track modes cannot use a prep crate as replacement material.');

  return {
    ready: blockers.length === 0,
    purpose,
    crate: crateResult.crate,
    tracks: rows,
    ruleDecisions: {
      ready: blockers.length === 0,
      modeId: mode.id,
      method,
      purpose,
      requiredTrackCount: required,
      readyTrackCount: readyCount,
      blockers,
      warnings,
      checkedAt: options.now ? options.now.toISOString() : new Date().toISOString()
    }
  };
}

function buildSnapshotPayload({ userId, battle, entry, validation, crateId, now = new Date() }){
  const snapshotBasis = {
    userId,
    battleId: battle.id || battle.battle_id || entry.battle_id,
    entryId: entry.id,
    crateId,
    crateVersion: validation.crate && validation.crate.updated_at || null,
    tracks: validation.tracks,
    ruleDecisions: validation.ruleDecisions
  };
  const snapshotVersion = stableHash(snapshotBasis).slice(0, 32);
  const blocked = validation.tracks.filter(row => row.status === 'blocked').length;
  const warnings = validation.tracks.filter(row => row.status === 'warning').length;
  return {
    id: randomUUID(),
    battle_id: String(battle.id || battle.battle_id || entry.battle_id),
    battle_entry_id: entry.id,
    user_id: userId,
    crate_id: crateId || null,
    crate_version: validation.crate && validation.crate.updated_at || null,
    snapshot_version: snapshotVersion,
    purpose: validation.purpose,
    track_selection_method: validation.ruleDecisions.method,
    replacement_allowed: PERSONAL_TRACK_METHODS.has(validation.ruleDecisions.method),
    tracks: validation.tracks,
    rule_decisions: validation.ruleDecisions,
    availability: {
      status: blocked ? 'blocked' : warnings ? 'warning' : 'available',
      unavailableTrackCount: blocked,
      warningTrackCount: warnings,
      checkedAt: now.toISOString()
    },
    replacements: [],
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };
}

function sanitizeBattleRecord(row){
  if(!row) return null;
  return {
    id: row.id,
    modeId: row.mode_id,
    title: row.title,
    genre: row.genre,
    durationMinutes: safeNumber(row.duration_minutes),
    trackSelectionMethod: row.track_selection_method,
    trackCount: safeNumber(row.track_count),
    minimumTrackCount: safeNumber(row.minimum_track_count),
    opponentRequirement: row.opponent_requirement,
    capacity: safeNumber(row.capacity),
    status: row.status,
    scoringType: row.scoring_type || 'measured_rule_based',
    voting: publicVotingSummaryForBattle(row, [], [], new Date(row.updated_at || row.created_at || Date.now())),
    lockedScoringFormula: sanitizeLockedScoringFormula(row.locked_scoring_formula),
    startConditions: sanitizeStartConditions(row.start_conditions),
    expiresAt: row.expires_at,
    startedAt: row.started_at,
    deadlineAt: row.deadline_at,
    cancelledAt: row.cancelled_at,
    battleVersion: battleVersion(row),
    creatorPublicProfile: sanitizePublicDjProfile(row.public_creator_profile),
    reward: row.reward || { type: row.reward_type || 'standard', metadata: {} },
    bitcoinRewardMetadata: row.bitcoin_reward_metadata || null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function sanitizeBattleForLobby(row, entryCount = 0, now = new Date(), options = {}){
  if(!row) return null;
  const status = battleStatusForLobby(row, entryCount, now);
  const mode = modeFor(row);
  const reward = plainObject(row.reward);
  const bitcoinReward = sanitizeBitcoinRewardMetadata(row);
  const profile = sanitizePublicDjProfile(row.public_creator_profile);
  const relationshipCounts = plainObject(options.relationshipCounts);
  const creator = relationshipCounts.source === 'server'
    ? {
      ...profile,
      followerCount:safeNumber(relationshipCounts.followers) || 0,
      followingCount:safeNumber(relationshipCounts.following) || 0,
      relationshipCounts:{
        followers:safeNumber(relationshipCounts.followers) || 0,
        following:safeNumber(relationshipCounts.following) || 0,
        source:'server'
      }
    }
    : profile;
  return {
    id: row.id,
    modeId: row.mode_id,
    modeLabel: mode && mode.label || row.mode_id,
    title: cleanString(row.title, 160) || mode && mode.label || 'Battle',
    genre: cleanString(row.genre, 80) || mode && mode.defaultGenre || 'Open Format',
    status,
    joinable: isJoinableLobbyStatus(status),
    participantCount: entryCount,
    capacity: battleCapacity({ opponentRequirement:row.opponent_requirement, capacity:row.capacity }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    scoringType: cleanString(row.scoring_type, 40) || 'measured_rule_based',
    voting: publicVotingSummaryForBattle(row, [], [], now),
    creator,
    country: profile.country,
    belt: profile.belt,
    rating: profile.rating,
    entryRequirements: {
      trackSelectionMethod: cleanString(row.track_selection_method, 40) || mode && mode.trackSelectionMethod,
      trackCount: safeNumber(row.track_count),
      minimumTrackCount: safeNumber(row.minimum_track_count),
      durationMinutes: safeNumber(row.duration_minutes),
      opponentRequirement: cleanString(row.opponent_requirement, 40) || mode && mode.opponentRequirement,
      premiumRequired: Boolean(mode && mode.premiumRequired),
      ownSelectionEligible: PERSONAL_TRACK_METHODS.has(cleanString(row.track_selection_method, 40) || mode && mode.trackSelectionMethod)
    },
    startConditions: sanitizeStartConditions(row.start_conditions),
    reward: {
      type: cleanString(reward.type || row.reward_type, 40) || 'standard',
      metadataStatus: bitcoinReward ? 'bitcoin_metadata_only' : 'standard'
    },
    bitcoinRewardMetadata: bitcoinReward
  };
}

function battleRecordPayload(userId, battle, input, now = new Date()){
  const reward = plainObject(battle.reward);
  const startConditions = sanitizeStartConditions(input.startConditions || input.start_conditions);
  const expiresAt = expirationForBattle({ ...input, expiresAt: input.expiresAt || input.expires_at || startConditions.expiresAt }, now);
  return {
    id: battle.id,
    created_by: userId,
    mode_id: battle.modeId,
    title: battle.title,
    genre: battle.genre,
    duration_minutes: battle.durationMinutes,
    track_selection_method: battle.trackSelectionMethod,
    track_count: battle.trackCount,
    minimum_track_count: battle.minimumTrackCount,
    opponent_requirement: battle.opponentRequirement,
    capacity: battleCapacity(battle),
    visibility: battle.visibility || 'public',
    status: battle.status || 'open',
    scoring_type: scoringTypeFor(input, battle),
    voting_config: normalizeVotingConfig(input, battle, now),
    locked_scoring_formula: null,
    start_conditions: startConditions,
    expires_at: expiresAt,
    public_creator_profile: sanitizePublicDjProfile(input.publicProfile || input.public_profile || input.creatorPublicProfile || input.creator_public_profile),
    reward_type: reward.type || battle.rewardType || 'standard',
    reward,
    bitcoin_reward_metadata: (reward.type || battle.rewardType) === 'bitcoin' ? plainObject(reward.metadata) : null,
    idempotency_key: cleanString(input.idempotencyKey || input.idempotency_key, 128),
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };
}

async function findBattleByIdempotency(dataClient, userId, idempotencyKey){
  if(!idempotencyKey) return { battle: null };
  const result = await tableQuery(dataClient, BATTLE_RECORD_TABLE).eq('created_by', userId).eq('idempotency_key', idempotencyKey).limit(1);
  if(result.error) return { error: result.error };
  return { battle: result.data && result.data[0] || null };
}

async function getBattleRecord(dataClient, battleId){
  const result = await tableQuery(dataClient, BATTLE_RECORD_TABLE).eq('id', battleId).limit(1).single();
  if(result.error) return { error: result.error };
  if(!result.data) return { notFound: true };
  return { battle: result.data };
}

async function listBattleEntries(dataClient, battleId){
  const result = await tableQuery(dataClient, 'battle_entries').eq('battle_id', battleId);
  if(result.error) return { error: result.error };
  return { entries: (result.data || []).filter(row => row.status !== 'withdrawn') };
}

async function listBattleEntriesForBattles(dataClient, battleIds){
  const ids = Array.from(new Set(safeArray(battleIds).map(id => String(id)).filter(Boolean)));
  if(!ids.length) return { entries: [] };
  let query = tableQuery(dataClient, 'battle_entries');
  if(typeof query.in === 'function') query = query.in('battle_id', ids);
  const result = await query;
  if(result.error) return { error: result.error };
  const idSet = new Set(ids);
  return {
    entries: (result.data || [])
      .filter(row => idSet.has(String(row.battle_id)))
      .filter(row => row.status !== 'withdrawn')
  };
}

function entriesByBattle(entries){
  return safeArray(entries).reduce((map, row) => {
    const key = String(row.battle_id);
    const list = map.get(key) || [];
    list.push(row);
    map.set(key, list);
    return map;
  }, new Map());
}

async function getExistingSnapshotForEntry(dataClient, userId, entryId){
  const result = await tableQuery(dataClient, BATTLE_PREP_SNAPSHOT_TABLE).eq('battle_entry_id', entryId).eq('user_id', userId).limit(1);
  if(result.error) return { error: result.error };
  return { snapshot: result.data && result.data[0] || null };
}

async function persistSnapshot(dataClient, userId, battle, entry, crateId, options = {}, now = new Date()){
  const existing = await getExistingSnapshotForEntry(dataClient, userId, entry.id);
  if(existing.error || existing.snapshot) return existing.snapshot ? { snapshot: existing.snapshot, created:false, duplicate:true } : existing;
  const validation = await validateOwnedBattlePrepCrate(dataClient, userId, crateId, battle, { ...options, now });
  if(validation.error || validation.forbidden || validation.unavailable || validation.validationError) return validation;
  if(!validation.ready) return { validationError: validation.ruleDecisions.blockers.join(' ') || 'Battle Prep crate is not eligible' };
  if(!validation.tracks.length && !validation.optional) return { validationError: 'Battle Prep snapshot has no eligible tracks' };
  const payload = buildSnapshotPayload({ userId, battle, entry, validation, crateId, now });
  const inserted = await dataClient.from(BATTLE_PREP_SNAPSHOT_TABLE).insert([payload]).select('*').single();
  if(inserted.error) return { error: inserted.error };
  await dataClient.from('battle_entries').update({ battle_prep_snapshot_id: inserted.data.id, updated_at: now.toISOString() }).eq('id', entry.id).eq('user_id', userId);
  return { snapshot: inserted.data, created:true };
}

async function createBattleWithPrepSnapshot(dataClient, userId, input = {}, now = new Date()){
  const normalized = normalizeBattleInput(userId, input, now);
  if(normalized.validationError) return normalized;
  const idempotencyKey = cleanString(input.idempotencyKey || input.idempotency_key, 128);
  const existingByKey = await findBattleByIdempotency(dataClient, userId, idempotencyKey);
  if(existingByKey.error) return existingByKey;
  let battleRow = existingByKey.battle;
  let battle = normalized.battle;
  if(battleRow){
    battle = BattleModes.normalizeBattleRecord({
      id: battleRow.id,
      modeId: battleRow.mode_id,
      title: battleRow.title,
      genre: battleRow.genre,
      durationMinutes: battleRow.duration_minutes,
      trackSelectionMethod: battleRow.track_selection_method,
      trackCount: battleRow.track_count,
      minimumTrackCount: battleRow.minimum_track_count,
      opponentRequirement: battleRow.opponent_requirement,
      reward: battleRow.reward,
      status: battleRow.status,
      createdBy: battleRow.created_by
    });
  }else{
    const validation = await validateOwnedBattlePrepCrate(dataClient, userId, input.crateId || input.crate_id, battle, { purpose:input.purpose, now });
    if(validation.error || validation.forbidden || validation.unavailable || validation.validationError) return validation;
    if(!validation.ready) return { validationError: validation.ruleDecisions.blockers.join(' ') || 'Battle Prep crate is not eligible' };
    const payload = battleRecordPayload(userId, battle, { ...input, idempotencyKey }, now);
    const inserted = await dataClient.from(BATTLE_RECORD_TABLE).insert([payload]).select('*').single();
    if(inserted.error) return { error: inserted.error };
    battleRow = inserted.data;
  }
  const entryResult = await getOrCreateBattleEntry(dataClient, userId, battleRow.id);
  if(entryResult.error) return entryResult;
  const snapshotResult = await persistSnapshot(dataClient, userId, { ...battle, id:battleRow.id }, entryResult.entry, input.crateId || input.crate_id, { purpose:input.purpose }, now);
  if(snapshotResult.error || snapshotResult.forbidden || snapshotResult.unavailable || snapshotResult.validationError) return snapshotResult;
  return {
    battle: sanitizeBattleRecord(battleRow),
    entry: entryResult.entry,
    snapshot: sanitizeBattlePrepSnapshotForOwner(snapshotResult.snapshot),
    created: !existingByKey.battle,
    duplicate: Boolean(existingByKey.battle || !entryResult.created || snapshotResult.duplicate)
  };
}

async function joinBattleWithPrepSnapshot(dataClient, userId, battleId, input = {}, now = new Date()){
  const battleResult = await getBattleRecord(dataClient, battleId);
  if(battleResult.error || battleResult.notFound) return battleResult;
  let battleRow = battleResult.battle;
  if(String(battleRow.created_by) === String(userId) && input.role !== 'creator') return { conflict:true, reason:'Creator already has an entry for this battle' };
  const battle = BattleModes.normalizeBattleRecord({
    id: battleRow.id,
    modeId: battleRow.mode_id,
    title: battleRow.title,
    genre: battleRow.genre,
    durationMinutes: battleRow.duration_minutes,
    trackSelectionMethod: battleRow.track_selection_method,
    trackCount: battleRow.track_count,
    minimumTrackCount: battleRow.minimum_track_count,
    opponentRequirement: battleRow.opponent_requirement,
    reward: battleRow.reward,
    status: battleRow.status,
    createdBy: battleRow.created_by
  });
  const existing = await tableQuery(dataClient, 'battle_entries').eq('battle_id', battleRow.id).eq('user_id', userId).limit(1);
  if(existing.error) return { error: existing.error };
  if(existing.data && existing.data[0]){
    const snapshot = await getExistingSnapshotForEntry(dataClient, userId, existing.data[0].id);
    if(snapshot.error) return snapshot;
    return { battle:sanitizeBattleRecord(battleRow), entry:existing.data[0], snapshot:sanitizeBattlePrepSnapshotForOwner(snapshot.snapshot), duplicate:true };
  }
  const entries = await listBattleEntries(dataClient, battleRow.id);
  if(entries.error) return entries;
  const lobbyStatus = battleStatusForLobby(battleRow, entries.entries.length, now);
  if(!isJoinableLobbyStatus(lobbyStatus)){
    const reason = lobbyStatus === 'expired' ? 'Battle has expired' : lobbyStatus === 'full' ? 'Battle is already full' : 'Battle is not joinable';
    return { conflict:true, reason };
  }
  if(entries.entries.length >= battleCapacity(battleRow)) return { conflict:true, reason:'Battle is already full' };
  const validation = await validateOwnedBattlePrepCrate(dataClient, userId, input.crateId || input.crate_id, battle, { purpose:input.purpose, now });
  if(validation.error || validation.forbidden || validation.unavailable || validation.validationError) return validation;
  if(!validation.ready) return { validationError: validation.ruleDecisions.blockers.join(' ') || 'Battle Prep crate is not eligible' };
  const entryResult = await getOrCreateBattleEntry(dataClient, userId, battleRow.id);
  if(entryResult.error){
    const message = String(entryResult.error.message || entryResult.error);
    if(/capacity|slot|duplicate|conflict/i.test(message)) return { conflict:true, reason:'Battle is already full' };
    return entryResult;
  }
  const nextEntries = entries.entries.length + (entryResult.created ? 1 : 0);
  if(nextEntries > battleCapacity(battleRow)) return { conflict:true, reason:'Battle is already full' };
  const snapshotResult = await persistSnapshot(dataClient, userId, battle, entryResult.entry, input.crateId || input.crate_id, { purpose:input.purpose }, now);
  if(snapshotResult.error || snapshotResult.forbidden || snapshotResult.unavailable || snapshotResult.validationError) return snapshotResult;
  if(nextEntries >= battleCapacity(battleRow)){
    await dataClient.from(BATTLE_RECORD_TABLE).update({ status:'full', updated_at:now.toISOString() }).eq('id', battleRow.id);
    battleRow.status = 'full';
    const started = await startBattleIfReady(dataClient, battleRow.id, { userId, auto:true }, now);
    if(started.error || started.forbidden || started.conflict) return started;
    if(started.battle) battleRow = { ...battleRow, status:started.battle.status, started_at:started.battle.startedAt, deadline_at:started.battle.deadlineAt };
  }
  return { battle:sanitizeBattleRecord(battleRow), entry:entryResult.entry, snapshot:sanitizeBattlePrepSnapshotForOwner(snapshotResult.snapshot), created:true };
}

function lobbyFilterMatches(item, filters = {}){
  const mode = cleanString(filters.mode || filters.modeId || filters.mode_id, 80);
  if(mode && mode !== 'all' && item.modeId !== mode) return false;
  const genre = cleanString(filters.genre, 80);
  if(genre && genre !== 'all' && String(item.genre || '').toLowerCase() !== genre.toLowerCase()) return false;
  const country = cleanString(filters.country, 80);
  if(country && country !== 'all' && String(item.country || '').toLowerCase() !== country.toLowerCase()) return false;
  const scoringType = cleanString(filters.scoringType || filters.scoring_type || filters.source, 40);
  if(scoringType && scoringType !== 'all' && item.scoringType !== scoringType) return false;
  const belt = cleanString(filters.belt, 40);
  if(belt && belt !== 'all' && String(item.belt || '').toLowerCase() !== belt.toLowerCase()) return false;
  const status = cleanString(filters.status, 40);
  if(status && status !== 'all' && item.status !== status) return false;
  const opponent = cleanString(filters.opponent || filters.opponentStatus, 40);
  if(opponent && opponent !== 'all'){
    const requirement = item.entryRequirements && item.entryRequirements.opponentRequirement;
    if(opponent === 'ai-only' && requirement !== 'none') return false;
    if(opponent === 'opponent' && requirement === 'none') return false;
  }
  const ownSelection = filters.ownSelection === true || filters.ownSelection === 'true' || filters.own_selection === 'true';
  if(ownSelection && !(item.entryRequirements && item.entryRequirements.ownSelectionEligible)) return false;
  const bitcoin = filters.bitcoin === true || filters.bitcoin === 'true' || filters.bitcoinBattle === 'true' || filters.bitcoin_battle === 'true';
  if(bitcoin && !item.bitcoinRewardMetadata) return false;
  const from = safeDate(filters.dateFrom || filters.date_from);
  if(from && safeDate(item.createdAt) && safeDate(item.createdAt).getTime() < from.getTime()) return false;
  const to = safeDate(filters.dateTo || filters.date_to);
  if(to && safeDate(item.createdAt) && safeDate(item.createdAt).getTime() > to.getTime()) return false;
  return true;
}

function sortLobbyItems(items, sort = 'newest'){
  const rows = [...items];
  if(sort === 'oldest') rows.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  else if(sort === 'rating_range') rows.sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  else rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return rows;
}

async function listPublicBattleLobby(dataClient, options = {}, now = new Date()){
  const page = positivePage(options.page);
  const limit = clampLimit(options.limit || options.pageSize || options.page_size);
  const fetchLimit = Math.min(200, Math.max(limit * page * 3, limit));
  const relationship = await relationshipCreatorFilter(dataClient, options);
  if(relationship.error || relationship.validationError) return relationship;
  let query = tableQuery(dataClient, BATTLE_RECORD_TABLE).eq('visibility', 'public');
  if(typeof query.limit === 'function') query = query.limit(fetchLimit);
  const result = await query;
  if(result.error) return { error: result.error };
  let records = (result.data || []).filter(row => !['deleted', 'unavailable'].includes(cleanString(row.status, 40)));
  if(relationship.userIds){
    records = records.filter(row => relationship.userIds.has(String(row.created_by)));
  }
  const entries = await listBattleEntriesForBattles(dataClient, records.map(row => row.id));
  if(entries.error) return entries;
  const grouped = entriesByBattle(entries.entries);
  const publicProfileIds = records.map(row => sanitizePublicDjProfile(row.public_creator_profile).publicProfileId).filter(Boolean);
  const followerCounts = await fetchFollowerCounts(dataClient, publicProfileIds);
  if(followerCounts.error) return followerCounts;
  const sanitized = records
    .map(row => {
      const profileId = sanitizePublicDjProfile(row.public_creator_profile).publicProfileId;
      const counts = profileId && followerCounts.counts.get(profileId);
      return sanitizeBattleForLobby(row, (grouped.get(String(row.id)) || []).length, now, { relationshipCounts:counts });
    })
    .filter(Boolean)
    .filter(item => lobbyFilterMatches(item, options));
  const sorted = sortLobbyItems(sanitized, options.sort || 'newest');
  const offset = (page - 1) * limit;
  const items = sorted.slice(offset, offset + limit);
  return {
    items,
    pagination:{
      page,
      limit,
      total: sorted.length,
      hasMore: offset + limit < sorted.length,
      nextPage: offset + limit < sorted.length ? page + 1 : null
    },
    filters:{ relationship:relationship.scope }
  };
}

async function findCompatibleLobbyBattle(dataClient, userId, options = {}, now = new Date()){
  const list = await listPublicBattleLobby(dataClient, { ...options, page:1, limit:MAX_LOBBY_LIMIT, status:'all' }, now);
  if(list.error) return list;
  let query = tableQuery(dataClient, BATTLE_RECORD_TABLE);
  if(typeof query.in === 'function') query = query.in('id', list.items.map(item => item.id));
  const raw = await query;
  if(raw.error) return { error: raw.error };
  const creatorByBattle = new Map((raw.data || []).map(row => [String(row.id), row.created_by]));
  const rows = list.items.filter(item => item.joinable && String(creatorByBattle.get(String(item.id))) !== String(userId));
  return { battle: rows[0] || null, candidates: rows.slice(0, 5) };
}

async function latestSubmissionStatusForEntry(dataClient, entryId){
  const result = await tableQuery(dataClient, 'mix_submissions').eq('battle_entry_id', entryId).limit(10);
  if(result.error) return { error: result.error };
  const rows = (result.data || []).sort((a, b) => String(b.created_at || b.updated_at || '').localeCompare(String(a.created_at || a.updated_at || '')));
  const row = rows[0];
  if(!row) return { submission:null };
  return {
    submission:{
      id: row.id,
      status: cleanString(row.status, 40) || 'draft',
      uploadedAt: row.uploaded_at || null,
      completedAt: row.completed_at || null
    }
  };
}

function participantStatus(row, now = new Date()){
  const raw = cleanString(row && row.status, 40) || 'joined';
  if(raw === 'active') return 'joined';
  if(raw === 'withdrawn') return 'withdrawn';
  if(PARTICIPANT_STATUSES.has(raw)) return raw;
  const seen = safeDate(row && (row.presence_last_seen_at || row.last_seen_at));
  if(seen && now.getTime() - seen.getTime() > PRESENCE_STALE_MS && !['ready', 'started', 'submitted', 'completed'].includes(raw)) return 'disconnected';
  return 'joined';
}

function battleVersion(row){
  const numeric = safeNumber(row && (row.battle_version ?? row.live_version ?? row.version));
  if(numeric != null) return Math.max(0, Math.floor(numeric));
  return Math.abs(String(`${row && row.id}:${row && row.updated_at}:${row && row.started_at}:${row && row.deadline_at}`).split('').reduce((hash, ch)=>((hash << 5) - hash + ch.charCodeAt(0))|0, 0));
}

function nextBattleVersion(row){
  return battleVersion(row) + 1;
}

function battleDeadline(row, startedAt){
  const explicit = safeIso(row && (row.deadline_at || row.deadlineAt));
  if(explicit) return explicit;
  const start = safeDate(startedAt || row && row.started_at);
  const minutes = safeNumber(row && row.duration_minutes) || 10;
  return start ? new Date(start.getTime() + minutes * 60 * 1000).toISOString() : null;
}

function sanitizeParticipantForRoom(row, options = {}, now = new Date()){
  const self = Boolean(options.self);
  const status = participantStatus(row, now);
  const lastSeenAt = safeIso(row && (row.presence_last_seen_at || row.last_seen_at));
  const presenceStatus = cleanString(row && row.presence_status, 40) || (lastSeenAt ? 'online' : 'unknown');
  return {
    ...(self ? { entryId: row.id } : {}),
    status,
    ready: status === 'ready' || STARTED_BATTLE_STATUSES.has(status),
    submitted: ['submitted', 'completed'].includes(status),
    prepared: Boolean(row.battle_prep_snapshot_id),
    presence:{
      status: status === 'withdrawn' ? 'withdrawn' : presenceStatus,
      lastSeenAt,
      stale:Boolean(lastSeenAt && now.getTime() - safeDate(lastSeenAt).getTime() > PRESENCE_STALE_MS)
    },
    joinedAt: row.created_at || null,
    readyAt: row.ready_at || null,
    startedAt: row.started_at || null,
    submittedAt: row.submitted_at || null,
    completedAt: row.completed_at || null,
    profile: sanitizePublicDjProfile(row.public_profile || row.publicProfile)
  };
}

function sanitizeOwnedBattleEntryForRoom(row){
  if(!row) return null;
  return {
    id: row.id,
    battleId: row.battle_id,
    status: participantStatus(row),
    battlePrepSnapshotId: row.battle_prep_snapshot_id || null,
    readyAt: row.ready_at || null,
    startedAt: row.started_at || null,
    submittedAt: row.submitted_at || null,
    completedAt: row.completed_at || null,
    withdrawnAt: row.withdrawn_at || null,
    presence: {
      status: cleanString(row.presence_status, 40) || 'unknown',
      lastSeenAt: row.presence_last_seen_at || null
    }
  };
}

function sanitizeOpponentEntry(row){
  return {
    status: cleanString(row.status, 40) || 'active',
    joinedAt: row.created_at || null,
    prepared: Boolean(row.battle_prep_snapshot_id),
    profile: sanitizePublicDjProfile(row.public_profile || row.publicProfile)
  };
}

async function submissionStatesForEntries(dataClient, entries){
  const out = new Map();
  for(const entry of safeArray(entries)){
    const status = await latestSubmissionStatusForEntry(dataClient, entry.id);
    if(status.error) return status;
    out.set(String(entry.id), status.submission);
  }
  return { submissions:out };
}

function stableVerifiedResultId(submissionId){
  return `vr_${createHash('sha256').update(`dj-battle-result:${submissionId}`).digest('hex').slice(0, 20)}`;
}

function existingBattleResolution(row){
  const resolution = plainObject(row && (row.resolution || row.battle_resolution || row.resolution_result));
  return resolution && resolution.id ? resolution : null;
}

function sourceLabelsForJudgeResult(judgeResult){
  const labels = new Set();
  const evidenceType = String(judgeResult && judgeResult.evidenceType || '').toLowerCase();
  const scoringModel = plainObject(judgeResult && judgeResult.scoringModel);
  const confidence = plainObject(judgeResult && judgeResult.confidence);
  const trained = plainObject(confidence.trainedModelJudging);
  if(evidenceType.includes('measurable') || judgeResult && judgeResult.measurableAnalysis) labels.add('measured');
  if(evidenceType.includes('rule') || scoringModel.ruleBasedScoring) labels.add('rule-based');
  if(judgeResult && judgeResult.aiFeedback || trained.used === true) labels.add('AI-assisted');
  if(judgeResult && judgeResult.humanVoting) labels.add('human-voted');
  if(!labels.size) labels.add('rule-based');
  const values = Array.from(labels);
  return values.length > 1 ? [...values, 'hybrid'] : values;
}

function safeBreakdown(value){
  const input = plainObject(value);
  return Object.fromEntries(Object.entries(input).slice(0, 16).map(([key, raw]) => {
    if(raw && typeof raw === 'object' && !Array.isArray(raw)){
      return [cleanString(key, 80) || key, {
        available: raw.available !== false,
        score: safeNumber(raw.score),
        value: raw.value == null ? undefined : cleanString(raw.value, 120),
        reason: cleanString(raw.reason, 180)
      }];
    }
    return [cleanString(key, 80) || key, safeNumber(raw) == null ? cleanString(raw, 120) : safeNumber(raw)];
  }));
}

async function latestSubmissionForEntry(dataClient, entryId){
  const result = await tableQuery(dataClient, 'mix_submissions').eq('battle_entry_id', entryId).limit(20);
  if(result.error) return { error: result.error };
  const rows = (result.data || []).sort((a, b) => {
    const left = b.completed_at || b.updated_at || b.created_at || '';
    const right = a.completed_at || a.updated_at || a.created_at || '';
    return String(left).localeCompare(String(right));
  });
  return { submission: rows[0] || null };
}

async function latestSubmissionsForResolution(dataClient, entries){
  const submissions = new Map();
  for(const entry of safeArray(entries)){
    const result = await latestSubmissionForEntry(dataClient, entry.id);
    if(result.error) return result;
    submissions.set(String(entry.id), result.submission);
  }
  return { submissions };
}

function battleRecordForResolution(row, entries){
  const mode = modeFor(row);
  return {
    id: row.id,
    modeId: row.mode_id,
    type: mode && mode.label || row.title || row.mode_id,
    title: row.title,
    genre: row.genre,
    durationMinutes: safeNumber(row.duration_minutes) || mode && mode.defaultDurationMinutes || 10,
    trackSelectionMethod: row.track_selection_method,
    trackCount: safeNumber(row.track_count),
    minimumTrackCount: safeNumber(row.minimum_track_count),
    opponentRequirement: row.opponent_requirement,
    reward: row.reward || { type: row.reward_type || 'standard', metadata:{} },
    rewardType: row.reward_type || row.reward && row.reward.type || mode && mode.rewardType || 'standard',
    participants: safeArray(entries).map(entry => ({
      userId: String(entry.user_id),
      name: sanitizePublicDjProfile(entry.public_profile).name,
      status: entry.status,
      submissionId: null
    }))
  };
}

function pendingResolutionState(battleRow, entries, submissions, now = new Date()){
  const capacity = battleCapacity(battleRow);
  const activeEntries = safeArray(entries).filter(row => row.status !== 'withdrawn');
  const statuses = activeEntries.map(entry => {
    const submission = submissions && submissions.get(String(entry.id));
    return submission && cleanString(submission.status, 40) || participantStatus(entry, now);
  });
  const failed = statuses.some(status => status === 'failed');
  const completed = statuses.filter(status => status === 'completed').length;
  const status = failed
    ? 'failed'
    : activeEntries.length < capacity
      ? 'waiting_for_opponent'
      : completed < capacity
        ? statuses.some(item => ['uploaded', 'queued', 'processing', 'judging'].includes(item)) ? 'judging' : 'waiting_for_submissions'
        : 'resolving';
  return {
    id: null,
    battleId: battleRow && battleRow.id,
    status,
    outcome: 'unresolved',
    resolved:false,
    revealReady:false,
    reason: failed ? 'At least one required submission failed judging and needs recovery.' : null,
    requiredParticipants: capacity,
    completedParticipants: completed,
    checkedAt: safeIsoFromNow(now),
    participants: activeEntries.map(entry => {
      const submission = submissions && submissions.get(String(entry.id));
      return {
        ...(submission && String(entry.user_id) ? {} : {}),
        self:false,
        profile:sanitizePublicDjProfile(entry.public_profile),
        status: submission && submission.status || participantStatus(entry, now),
        submitted:Boolean(submission),
        completed:Boolean(submission && submission.status === 'completed'),
        score:null
      };
    })
  };
}

function determineResolutionOutcome(participants){
  const ordered = [...participants].sort((a, b) => Number(b.score) - Number(a.score) || String(a.entryId).localeCompare(String(b.entryId)));
  const topScore = ordered[0] && Number(ordered[0].score);
  const winners = ordered.filter(item => Number(item.score) === topScore);
  const tie = winners.length > 1;
  const winnerEntryIds = tie ? winners.map(item => item.entryId) : [ordered[0].entryId];
  return ordered.map((participant, index) => {
    const won = !tie && participant.entryId === winnerEntryIds[0];
    const participantOutcome = tie ? 'tie' : won ? 'winner' : 'loser';
    const opponentScores = ordered.filter(item => item.entryId !== participant.entryId).map(item => Number(item.score));
    return {
      ...participant,
      placement: tie ? 1 : index + 1,
      outcome: participantOutcome,
      won: tie ? null : won,
      opponentScore: opponentScores.length ? Math.max(...opponentScores) : null
    };
  });
}

function buildResolutionParticipant({ entry, submission, judgeResult, battleLike, outcome, resolutionId, version, now, scoreDetails = {} }){
  const detail = plainObject(scoreDetails);
  const judgeScore = safeNumber(detail.judgeScore) == null ? safeNumber(judgeResult.score) : safeNumber(detail.judgeScore);
  const finalScore = safeNumber(detail.score);
  const score = finalScore == null ? judgeScore : finalScore;
  const communityScore = safeNumber(detail.communityScore);
  const communityVoting = plainObject(detail.communityVoting);
  const enrichedJudgeResult = {
    ...(judgeResult.raw || {}),
    score,
    overallScore: score,
    judgeScore,
    communityScore,
    breakdown: judgeResult.breakdown,
    components: judgeResult.components,
    timing: judgeResult.timing,
    rawMeasurements: judgeResult.rawMeasurements,
    recommendations: judgeResult.recommendations,
    confidence: judgeResult.confidence,
    measurableAnalysis: judgeResult.measurableAnalysis,
    scoringModel: judgeResult.scoringModel,
    battleContext: judgeResult.battleContext,
    battleMode: judgeResult.battleMode || battleLike.modeId,
    evidenceType: judgeResult.evidenceType,
    explanation: judgeResult.explanation,
    humanVoting: Object.keys(communityVoting).length ? communityVoting : judgeResult.humanVoting,
    won: outcome.won,
    opponentScore: outcome.opponentScore,
    winnerUserId: outcome.outcome === 'winner' ? String(entry.user_id) : null
  };
  const payload = BattleModes.buildBattleResultPayload({
    battle: battleLike,
    userId: String(entry.user_id),
    submissionId: submission.id,
    judgeResult: enrichedJudgeResult,
    now: safeIsoFromNow(now)
  });
  const result = payload.result || {
    battleId:battleLike.id,
    userId:String(entry.user_id),
    submissionId:submission.id,
    score,
    progression:{}
  };
  const awardId = `award_${stableHash({ resolutionId, entryId:entry.id, submissionId:submission.id, userId:entry.user_id }).slice(0, 24)}`;
  result.won = outcome.won;
  result.opponentScore = outcome.opponentScore;
  result.outcome = outcome.outcome;
  result.progression = {
    ...(result.progression || {}),
    awardId,
    resolutionId,
    resolutionVersion: version,
    awardSource: BATTLE_RESOLUTION_SOURCE
  };
  return {
    entryId: String(entry.id),
    userId: String(entry.user_id),
    submissionId: String(submission.id),
    battlePrepSnapshotId: entry.battle_prep_snapshot_id || null,
    battlePrepSnapshotVersion: cleanString(plainObject(submission.processing_info).battleContext && plainObject(submission.processing_info).battleContext.battlePrepSnapshotVersion, 80),
    profile: sanitizePublicDjProfile(entry.public_profile),
    score,
    judgeScore,
    communityScore,
    communityVoting: Object.keys(communityVoting).length ? communityVoting : null,
    placement: outcome.placement,
    outcome: outcome.outcome,
    won: outcome.won,
    opponentScore: outcome.opponentScore,
    breakdown: safeBreakdown(judgeResult.breakdown || judgeResult.components),
    components: safeBreakdown(judgeResult.components),
    confidence: plainObject(judgeResult.confidence),
    evidenceType: cleanString(judgeResult.evidenceType, 120) || 'server_judge_result',
    scoringSource: sourceLabelsForJudgeResult(enrichedJudgeResult),
    timingEvidenceCount: safeArray(judgeResult.timing).length || safeArray(judgeResult.rawMeasurements).length,
    recommendations: safeArray(judgeResult.recommendations).slice(0, 8).map(item => cleanString(item, 240)).filter(Boolean),
    measurableAnalysis: plainObject(judgeResult.measurableAnalysis),
    result,
    award:{
      id: awardId,
      userId: String(entry.user_id),
      entryId: String(entry.id),
      submissionId: String(submission.id),
      progression: result.progression
    }
  };
}

function buildBattleResultSummaryForParticipant({ battleRow, participant, opponent, resolution, now }){
  const mode = modeFor(battleRow);
  const current = participant.result || {};
  const progression = plainObject(current.progression);
  return {
    visibility:'private',
    title: cleanString(battleRow.title, 160) || mode && mode.label || 'Battle Result',
    modeId: cleanString(battleRow.mode_id, 80),
    type: mode && mode.label || cleanString(battleRow.title, 120) || 'Battle',
    genre: cleanString(battleRow.genre, 80) || 'Open Format',
    outcome: participant.outcome === 'winner' ? 'win' : participant.outcome === 'loser' ? 'loss' : participant.outcome,
    score: safeNumber(participant.score),
    judgeScore: safeNumber(participant.judgeScore),
    communityScore: safeNumber(participant.communityScore),
    communityVoting: participant.communityVoting || null,
    opponent:{
      status: opponent ? 'opponent' : 'unmatched',
      name: opponent && opponent.profile && opponent.profile.name || null,
      country: opponent && opponent.profile && opponent.profile.country || null,
      score: opponent && opponent.score
    },
    profile:{
      displayName: participant.profile && participant.profile.name,
      country: participant.profile && participant.profile.country
    },
    progression,
    progressBefore: {
      xp:safeNumber(progression.xpBefore),
      rating:safeNumber(progression.ratingBefore),
      rankingRating:safeNumber(progression.ratingBefore),
      belt:cleanString(progression.beltBefore, 60)
    },
    progressAfter: {
      xp:safeNumber(progression.xpAfter),
      rating:safeNumber(progression.ratingAfter),
      rankingRating:safeNumber(progression.ratingAfter),
      belt:cleanString(progression.beltAfter, 60)
    },
    rankBefore:safeNumber(progression.rankingBefore),
    rankAfter:safeNumber(progression.rankingAfter),
    awardStatus:cleanString(progression.status, 40) || cleanString(plainObject(resolution.awardState).status, 40) || 'pending',
    completedAt: resolution.resolvedAt || safeIsoFromNow(now),
    battle:{
      battleId: battleRow.id,
      modeId: battleRow.mode_id,
      genre: battleRow.genre,
      resolutionId: resolution.id,
      resolutionVersion: resolution.version,
      scoringRule: resolution.scoringRule,
      communityVoting: resolution.communityVoting || null
    },
    reward: current.reward || battleRow.reward || { type:battleRow.reward_type || 'standard', metadata:{} },
    battlePrep:{
      source:'server_battle_prep_snapshot',
      serverBacked:true,
      snapshotId: participant.battlePrepSnapshotId,
      snapshotVersion: participant.battlePrepSnapshotVersion,
      battleEntryId: participant.entryId
    },
    securePlaybackPermitted:false
  };
}

async function persistResolutionSubmissionSummaries(dataClient, battleRow, resolution, submissions, now = new Date()){
  for(const participant of safeArray(resolution.participants)){
    const submission = submissions.get(String(participant.entryId));
    if(!submission) continue;
    const currentInfo = plainObject(submission.processing_info);
    const existingSummary = plainObject(currentInfo.battleResultSummary);
    const opponent = safeArray(resolution.participants).find(item => item.entryId !== participant.entryId) || null;
    const summary = buildBattleResultSummaryForParticipant({ battleRow, participant, opponent, resolution, now });
    const visibility = cleanString(currentInfo.result_visibility || existingSummary.visibility, 20) || 'private';
    const updated = await dataClient.from('mix_submissions').update({
      processing_info:{
        ...currentInfo,
        battleResolutionSummary:{
          id: resolution.id,
          status: resolution.status,
          outcome: resolution.outcome,
          version: resolution.version,
          resolvedAt: resolution.resolvedAt,
          participantOutcome: participant.outcome,
          awardId: participant.award && participant.award.id,
          scoringSource: participant.scoringSource
        },
        battleResultSummary:{ ...summary, visibility, verifiedResultId: currentInfo.verified_result_id || existingSummary.verifiedResultId || stableVerifiedResultId(submission.id), updatedAt:safeIsoFromNow(now) },
        result_visibility: visibility,
        verified_result_id: currentInfo.verified_result_id || existingSummary.verifiedResultId || stableVerifiedResultId(submission.id)
      }
    }).eq('id', submission.id).eq('user_id', participant.userId).select('*').single();
    if(updated.error) return { error: updated.error };
    submissions.set(String(participant.entryId), updated.data);
  }
  return { ok:true };
}

async function applyAndPersistAwardState(dataClient, battleRow, resolution, now = new Date()){
  if(!resolution || resolution.status !== 'resolved') return { resolution };
  const applied = await applyResolvedBattleAwards(dataClient, battleRow, resolution, now);
  let nextResolution = applied && applied.resolution;
  if(applied.error){
    nextResolution = {
      ...resolution,
      awardState:{
        status:'retryable',
        appliedCount:0,
        retryableCount:safeArray(resolution.participants).length,
        totalCount:safeArray(resolution.participants).length,
        updatedAt:safeIsoFromNow(now),
        lastFailure:sanitizeFailure(applied.error)
      }
    };
  }
  if(nextResolution && nextResolution !== resolution){
    const updated = await dataClient.from(BATTLE_RECORD_TABLE).update({
      resolution:nextResolution,
      updated_at:safeIsoFromNow(now)
    }).eq('id', battleRow.id).select('*').single();
    if(updated.error) return { error:updated.error };
    return { resolution:nextResolution, battleRow:updated.data, awards:applied && applied.awards || [], retryable:Boolean(applied && applied.error) };
  }
  return { resolution:nextResolution || resolution, battleRow, awards:applied && applied.awards || [] };
}

function sanitizeBattleResolutionForUser(resolution, userId){
  const source = resolution && resolution.id ? resolution : null;
  if(!source) return null;
  const resolved = source.status === 'resolved';
  const rows = safeArray(source.participants).map((participant, index) => {
    const self = String(participant.userId) === String(userId);
    const progression = plainObject(participant.result && participant.result.progression);
    return {
      self,
      ...(self ? { entryId:participant.entryId, submissionId:participant.submissionId, awardId:participant.award && participant.award.id } : {}),
      profile: participant.profile,
      placement: participant.placement,
      outcome: participant.outcome,
      score: resolved ? participant.score : null,
      judgeScore: resolved ? participant.judgeScore : null,
      communityScore: resolved ? participant.communityScore : null,
      communityVoting: resolved ? participant.communityVoting : null,
      opponentScore: self && resolved ? participant.opponentScore : null,
      scoringSource: participant.scoringSource,
      evidenceType: participant.evidenceType,
      breakdown: resolved ? participant.breakdown : {},
      components: resolved ? participant.components : {},
      confidence: resolved ? participant.confidence : {},
      timingEvidenceCount: resolved ? participant.timingEvidenceCount : 0,
      recommendations: self && resolved ? participant.recommendations : [],
      progression: self && resolved ? progression : {},
      progressionStatus: self && resolved ? cleanString(progression.status, 40) || cleanString(plainObject(source.awardState).status, 40) || 'pending' : null,
      reward: self && resolved ? plainObject(participant.result && participant.result.reward) : {}
    };
  });
  return {
    id: source.id,
    battleId: source.battleId,
    status: source.status,
    outcome: source.outcome,
    resolved,
    revealReady: resolved,
    version: source.version,
    resolvedAt: source.resolvedAt,
    scoringRule: source.scoringRule,
    communityVoting: source.communityVoting || null,
    awardState: {
      status: cleanString(plainObject(source.awardState).status, 40) || (resolved ? 'pending' : 'unavailable'),
      appliedCount: safeNumber(plainObject(source.awardState).appliedCount),
      retryableCount: safeNumber(plainObject(source.awardState).retryableCount),
      totalCount: safeNumber(plainObject(source.awardState).totalCount),
      ruleVersion: cleanString(plainObject(source.awardState).ruleVersion, 80),
      updatedAt: cleanString(plainObject(source.awardState).updatedAt, 80),
      lastFailure: cleanString(plainObject(source.awardState).lastFailure, 260)
    },
    scoreDifference: safeNumber(source.scoreDifference),
    bitcoinRewardMetadata: source.bitcoinRewardMetadata || null,
    participants: rows,
    self: rows.find(row => row.self) || null
  };
}

async function resolveBattleIfReady(dataClient, battleId, options = {}, now = new Date()){
  const battleResult = await getBattleRecord(dataClient, battleId);
  if(battleResult.error || battleResult.notFound) return battleResult;
  let battleRow = battleResult.battle;
  const entriesResult = await listBattleEntries(dataClient, battleRow.id);
  if(entriesResult.error) return entriesResult;
  const entries = entriesResult.entries;
  const submissionsResult = await latestSubmissionsForResolution(dataClient, entries);
  if(submissionsResult.error) return submissionsResult;
  const submissions = submissionsResult.submissions;
  const existing = existingBattleResolution(battleRow);
  if(existing && ['resolved', 'void'].includes(existing.status)){
    const awarded = await applyAndPersistAwardState(dataClient, battleRow, existing, now);
    if(awarded.error) return awarded;
    const awardResolution = awarded.resolution || existing;
    if(awarded.battleRow) battleRow = awarded.battleRow;
    const persisted = await persistResolutionSubmissionSummaries(dataClient, battleRow, awardResolution, submissions, now);
    if(persisted.error) return persisted;
    return { resolution:awardResolution, duplicate:true, battleRow };
  }
  if((battleRow.opponent_requirement || modeFor(battleRow).opponentRequirement) === 'none'){
    return {
      unresolved:true,
      battleRow,
      resolution:{
        id:null,
        battleId:battleRow.id,
        status:'practice_separate',
        outcome:'unresolved',
        reason:'AI-only practice results continue through the practice high-score contract.',
        participants:[]
      }
    };
  }
  if(['cancelled', 'expired'].includes(cleanString(battleRow.status, 40)) || isExpiredBattle(battleRow, now)){
    const version = nextBattleVersion(battleRow);
    const resolution = {
      id:`res_${stableHash({ battleId:battleRow.id, status:'void' }).slice(0, 24)}`,
      battleId:battleRow.id,
      status:'void',
      outcome:'void',
      version,
      resolvedAt:safeIsoFromNow(now),
      reason: cleanString(battleRow.status, 40) === 'cancelled' ? 'Battle was cancelled before competitive resolution.' : 'Battle expired before competitive resolution.',
      participants:[],
      bitcoinRewardMetadata:sanitizeBitcoinRewardMetadata(battleRow)
    };
    const updated = await dataClient.from(BATTLE_RECORD_TABLE).update({
      status: cleanString(battleRow.status, 40) === 'cancelled' ? 'cancelled' : 'expired',
      resolution,
      resolution_status:'void',
      resolution_version:version,
      resolved_at:safeIsoFromNow(now),
      battle_version:version,
      updated_at:safeIsoFromNow(now)
    }).eq('id', battleRow.id).select('*').single();
    if(updated.error) return { error: updated.error };
    return { resolution, battleRow:updated.data };
  }
  const capacity = battleCapacity(battleRow);
  if(entries.length < capacity){
    return { unresolved:true, battleRow, resolution:pendingResolutionState(battleRow, entries, submissions, now) };
  }
  const candidates = [];
  for(const entry of entries.slice(0, capacity)){
    const submission = submissions.get(String(entry.id));
    if(!submission){
      return { unresolved:true, battleRow, resolution:pendingResolutionState(battleRow, entries, submissions, now) };
    }
    if(submission.status === 'failed'){
      return { failed:true, battleRow, resolution:pendingResolutionState(battleRow, entries, submissions, now) };
    }
    const judgeResult = getStoredJudgeResult(submission);
    if(submission.status !== 'completed' || !judgeResult){
      return { unresolved:true, battleRow, resolution:pendingResolutionState(battleRow, entries, submissions, now) };
    }
    const context = plainObject(submission.processing_info).battleContext || {};
    if(context.battleEntryId && String(context.battleEntryId) !== String(entry.id)) return { conflict:true, reason:'Submission battle entry does not match the authenticated entry snapshot' };
    if(context.battlePrepSnapshotId && entry.battle_prep_snapshot_id && String(context.battlePrepSnapshotId) !== String(entry.battle_prep_snapshot_id)) return { conflict:true, reason:'Submission snapshot does not match the immutable battle entry snapshot' };
    candidates.push({ entry, submission, judgeResult, score:safeNumber(judgeResult.score) });
  }
  const invalid = candidates.find(candidate => candidate.score == null);
  if(invalid) return { unresolved:true, battleRow, resolution:pendingResolutionState(battleRow, entries, submissions, now) };
  const communityResolution = await prepareCommunityVotingForResolution(dataClient, battleRow, candidates, now);
  if(communityResolution.error) return communityResolution;
  if(communityResolution.waiting){
    return {
      unresolved:true,
      battleRow,
      resolution:{
        ...pendingResolutionState(battleRow, entries, submissions, now),
        status:'community_voting',
        reason:communityResolution.reason,
        voting:communityResolution.voting,
        scoringRule:communityResolution.scoringFormula
      }
    };
  }
  const scoredCandidates = communityResolution.candidates || candidates;
  const version = nextBattleVersion(battleRow);
  const resolutionId = `res_${stableHash({
    battleId:battleRow.id,
    submissions:scoredCandidates.map(item => [item.entry.id, item.submission.id, item.judgeScore == null ? item.score : item.judgeScore, item.communityScore, item.score]),
    scoringFormula:communityResolution.scoringFormula,
    versionBasis:battleRow.id
  }).slice(0, 24)}`;
  const outcomes = determineResolutionOutcome(scoredCandidates.map(item => ({ entryId:String(item.entry.id), score:item.score })));
  const battleLike = battleRecordForResolution(battleRow, entries);
  battleLike.participants = battleLike.participants.map(participant => {
    const candidate = scoredCandidates.find(item => String(item.entry.user_id) === String(participant.userId));
    return candidate ? { ...participant, submissionId:candidate.submission.id } : participant;
  });
  const participants = scoredCandidates.map(candidate => {
    const outcome = outcomes.find(item => item.entryId === String(candidate.entry.id));
    return buildResolutionParticipant({ entry:candidate.entry, submission:candidate.submission, judgeResult:candidate.judgeResult, battleLike, outcome, resolutionId, version, now, scoreDetails:candidate });
  });
  const scores = participants.map(item => Number(item.score));
  const sortedScores = [...scores].sort((a, b) => b - a);
  const topScore = Math.max(...scores);
  const tied = participants.filter(item => Number(item.score) === topScore).length > 1;
  const resolution = {
    id:resolutionId,
    battleId:battleRow.id,
    status:'resolved',
    outcome:tied ? 'tie' : 'winner',
    version,
    resolvedAt:safeIsoFromNow(now),
    scoringRule:communityResolution.scoringFormula || {
      type:'highest_normalized_score',
      modeId:battleRow.mode_id,
      tieThreshold:0,
      source:'existing_mode_score'
    },
    communityVoting:communityResolution.voting || publicVotingSummaryForBattle(battleRow, entries, [], now),
    scoreDifference:tied ? 0 : Math.abs((sortedScores[0] || 0) - (sortedScores[1] || 0)),
    participants,
    awardIds:participants.map(item => item.award && item.award.id).filter(Boolean),
    bitcoinRewardMetadata:sanitizeBitcoinRewardMetadata(battleRow)
  };
  const updated = await dataClient.from(BATTLE_RECORD_TABLE).update({
    status:'completed',
    resolution,
    resolution_status:'resolved',
    resolution_version:version,
    resolved_at:resolution.resolvedAt,
    battle_version:version,
    updated_at:resolution.resolvedAt
  }).eq('id', battleRow.id).select('*').single();
  if(updated.error) return { error:updated.error };
  battleRow = updated.data;
  for(const entry of entries){
    if(entry.status !== 'completed'){
      await dataClient.from('battle_entries').update({ status:'completed', completed_at:resolution.resolvedAt, updated_at:resolution.resolvedAt }).eq('id', entry.id);
    }
  }
  const awarded = await applyAndPersistAwardState(dataClient, battleRow, resolution, now);
  if(awarded.error) return awarded;
  const finalResolution = awarded.resolution || resolution;
  if(awarded.battleRow) battleRow = awarded.battleRow;
  const persisted = await persistResolutionSubmissionSummaries(dataClient, battleRow, finalResolution, submissions, now);
  if(persisted.error) return persisted;
  return { resolution:finalResolution, battleRow, resolved:true, awards:awarded.awards || [], awardRetryable:Boolean(awarded.retryable) };
}

async function verifyBattleEntrySubmissionIntegrity(dataClient, userId, entryId, battleContext = {}, now = new Date()){
  const owned = await getOwnedBattleEntry(dataClient, userId, entryId);
  if(owned.error || owned.forbidden) return owned;
  const entry = owned.entry;
  if(entry.status === 'withdrawn') return { conflict:true, reason:'Withdrawn battle entries cannot submit mixes' };
  if(entry.status === 'completed') return { conflict:true, reason:'Battle entry is already completed' };
  const battleResult = await getBattleRecord(dataClient, entry.battle_id);
  if(battleResult.error || battleResult.notFound) return battleResult;
  const battleRow = battleResult.battle;
  if(['cancelled', 'completed', 'expired'].includes(cleanString(battleRow.status, 40)) || isExpiredBattle(battleRow, now)){
    return { conflict:true, reason:'Battle is no longer accepting submissions' };
  }
  const context = plainObject(battleContext);
  if(context.battleId && String(context.battleId) !== String(entry.battle_id)) return { validationError:'Submission battle context does not match this entry' };
  if(context.battleEntryId && String(context.battleEntryId) !== String(entry.id)) return { validationError:'Submission entry context does not match this entry' };
  if(context.battlePrepSnapshotId && entry.battle_prep_snapshot_id && String(context.battlePrepSnapshotId) !== String(entry.battle_prep_snapshot_id)){
    return { validationError:'Submission snapshot context does not match this entry' };
  }
  return { ok:true, entry, battle:battleRow };
}

function readinessSnapshotOk(snapshot, availability){
  if(!snapshot) return { ok:false, reason:'Immutable Battle Prep snapshot is required before readying up' };
  const rules = plainObject(snapshot.rule_decisions);
  if(rules.ready === false) return { ok:false, reason:'Battle Prep snapshot does not pass battle rules' };
  const current = plainObject(availability || snapshot.availability);
  if(['blocked', 'unavailable'].includes(current.status)) return { ok:false, reason:'Battle Prep snapshot has unavailable or blocked tracks' };
  const tracks = safeArray(snapshot.tracks);
  if(tracks.some(track => track.status === 'blocked' || track.availability === 'blocked')) return { ok:false, reason:'Battle Prep snapshot contains a blocked track' };
  return { ok:true };
}

async function buildBattleRoomState(dataClient, userId, battleId, options = {}, now = new Date()){
  const battleResult = await getBattleRecord(dataClient, battleId);
  if(battleResult.error || battleResult.notFound) return battleResult;
  let battleRow = battleResult.battle;
  let resolutionAttempt = null;
  let entries = await listBattleEntries(dataClient, battleRow.id);
  if(entries.error) return entries;
  let ownEntry = entries.entries.find(row => String(row.user_id) === String(userId));
  if(!ownEntry && String(battleRow.created_by) !== String(userId)) return { forbidden:true };
  if(options.resolve !== false){
    resolutionAttempt = await resolveBattleIfReady(dataClient, battleRow.id, { viewerUserId:userId, automatic:true }, now);
    if(resolutionAttempt.error || resolutionAttempt.conflict) return resolutionAttempt;
    if(resolutionAttempt.battleRow) battleRow = resolutionAttempt.battleRow;
    entries = await listBattleEntries(dataClient, battleRow.id);
    if(entries.error) return entries;
    ownEntry = entries.entries.find(row => String(row.user_id) === String(userId));
    if(!ownEntry && String(battleRow.created_by) !== String(userId)) return { forbidden:true };
  }
  const snapshot = ownEntry ? await getExistingSnapshotForEntry(dataClient, userId, ownEntry.id) : { snapshot:null };
  if(snapshot.error) return snapshot;
  let ownerSnapshot = null;
  if(snapshot.snapshot){
    const current = await currentAvailability(dataClient, userId, snapshot.snapshot);
    if(current.error) return current;
    ownerSnapshot = sanitizeBattlePrepSnapshotForOwner({ ...snapshot.snapshot, availability:current.availability });
  }
  const submissions = await submissionStatesForEntries(dataClient, entries.entries);
  if(submissions.error) return submissions;
  const version = battleVersion(battleRow);
  const startedAt = safeIso(battleRow.started_at);
  const deadlineAt = battleDeadline(battleRow, startedAt);
  const roomBattle = {
    ...sanitizeBattleRecord(battleRow),
    status:battleStatusForLobby(battleRow, entries.entries.length, now),
    battleVersion:version,
    deadlineAt,
    serverNow:now.toISOString()
  };
  const participants = entries.entries.map(entry => {
    const self = ownEntry && String(entry.id) === String(ownEntry.id);
    const publicRow = self ? entry : { ...entry, user_id:null };
    const participant = sanitizeParticipantForRoom(publicRow, { self }, now);
    const submission = submissions.submissions.get(String(entry.id));
    if(submission){
      participant.status = submission.status === 'completed' ? 'completed' : 'submitted';
      participant.submitted = true;
      participant.submittedAt = submission.uploadedAt || submission.completedAt || participant.submittedAt || null;
    }
    if(self){
      participant.submission = submission;
    }else{
      participant.submission = submission ? { submitted:true, status:submission.status, uploadedAt:submission.uploadedAt || null, completedAt:submission.completedAt || null } : null;
    }
    return participant;
  });
  const storedResolution = existingBattleResolution(battleRow);
  const pendingResolution = resolutionAttempt && resolutionAttempt.resolution || pendingResolutionState(battleRow, entries.entries, submissions.submissions, now);
  const roomResolution = storedResolution
    ? sanitizeBattleResolutionForUser(storedResolution, userId)
    : {
        id:null,
        battleId:battleRow.id,
        status:pendingResolution.status || 'unresolved',
        outcome:pendingResolution.outcome || 'unresolved',
        resolved:false,
        revealReady:false,
        requiredParticipants:pendingResolution.requiredParticipants || battleCapacity(battleRow),
        completedParticipants:pendingResolution.completedParticipants || participants.filter(row => row.status === 'completed').length,
        reason:pendingResolution.reason || null,
        checkedAt:pendingResolution.checkedAt || now.toISOString(),
        participants:participants.map(row => ({
          self:Boolean(row.entryId),
          profile:row.profile,
          status:row.status,
          submitted:Boolean(row.submitted),
          completed:row.status === 'completed',
          score:null
        }))
      };
  const state = {
    battle:roomBattle,
    entry:sanitizeOwnedBattleEntryForRoom(ownEntry),
    snapshot:ownerSnapshot,
    participants,
    timing:{
      serverNow:now.toISOString(),
      startedAt,
      deadlineAt,
      durationMinutes:safeNumber(battleRow.duration_minutes) || 10,
      remainingSeconds:deadlineAt ? Math.max(0, Math.floor((safeDate(deadlineAt).getTime() - now.getTime()) / 1000)) : null
    },
    version,
    eventId:`battle-room:${battleRow.id}:${version}`,
    resolution:roomResolution,
    bitcoinRewardMetadata:sanitizeBitcoinRewardMetadata(battleRow)
  };
  const clientVersion = safeNumber(options.ifVersion || options.if_version);
  if(clientVersion != null && clientVersion > version) return { stale:true, state };
  return { state };
}

async function setBattleEntryReady(dataClient, userId, entryId, ready = true, now = new Date()){
  const owned = await getOwnedBattleEntry(dataClient, userId, entryId);
  if(owned.error || owned.forbidden) return owned;
  const entry = owned.entry;
  const battleResult = await getBattleRecord(dataClient, entry.battle_id);
  if(battleResult.error || battleResult.notFound) return battleResult;
  const battleRow = battleResult.battle;
  if(['cancelled', 'completed', 'expired'].includes(battleRow.status)) return { conflict:true, reason:'Battle is not accepting readiness changes' };
  if(STARTED_BATTLE_STATUSES.has(battleRow.status)) return { conflict:true, reason:'Battle has already started' };
  const snapshot = await getExistingSnapshotForEntry(dataClient, userId, entry.id);
  if(snapshot.error) return snapshot;
  if(ready){
    const current = snapshot.snapshot ? await currentAvailability(dataClient, userId, snapshot.snapshot) : { availability:null };
    if(current.error) return current;
    const ok = readinessSnapshotOk(snapshot.snapshot, current.availability);
    if(!ok.ok) return { validationError:ok.reason };
  }
  const participantStatusValue = ready ? 'ready' : 'preparing';
  const entryUpdate = {
    status:participantStatusValue,
    presence_status:'online',
    presence_last_seen_at:now.toISOString(),
    updated_at:now.toISOString()
  };
  if(ready) entryUpdate.ready_at = now.toISOString();
  const updated = await dataClient.from('battle_entries').update(entryUpdate).eq('id', entry.id).eq('user_id', userId).select('*').single();
  if(updated.error) return { error:updated.error };
  const auto = ready ? await startBattleIfReady(dataClient, battleRow.id, { userId, auto:true }, now) : null;
  if(auto && auto.error) return auto;
  const room = await buildBattleRoomState(dataClient, userId, battleRow.id, {}, now);
  if(room.error || room.forbidden) return room;
  return { entry:updated.data, state:room.state, autoStarted:Boolean(auto && auto.started) };
}

function allRequiredParticipantsReady(battleRow, entries){
  const activeEntries = safeArray(entries).filter(row => row.status !== 'withdrawn');
  const capacity = battleCapacity(battleRow);
  if(activeEntries.length < capacity) return false;
  return activeEntries.every(row => ['ready', 'started', 'submitted', 'completed'].includes(participantStatus(row)));
}

async function startBattleIfReady(dataClient, battleId, options = {}, now = new Date()){
  const battleResult = await getBattleRecord(dataClient, battleId);
  if(battleResult.error || battleResult.notFound) return battleResult;
  const battleRow = battleResult.battle;
  if(['cancelled', 'completed'].includes(battleRow.status)) return { conflict:true, reason:'Battle cannot be started from its current state' };
  if(isExpiredBattle(battleRow, now)) return { conflict:true, reason:'Battle has expired' };
  if(STARTED_BATTLE_STATUSES.has(battleRow.status)){
    const room = await buildBattleRoomState(dataClient, options.userId || battleRow.created_by, battleRow.id, {}, now);
    return { started:false, duplicate:true, state:room.state };
  }
  const entries = await listBattleEntries(dataClient, battleRow.id);
  if(entries.error) return entries;
  const allReady = allRequiredParticipantsReady(battleRow, entries.entries);
  const startConditions = plainObject(battleRow.start_conditions);
  const rosterIsFull = safeArray(entries.entries).filter(entry => entry.status !== 'withdrawn').length >= battleCapacity(battleRow);
  const automaticCapacityStart = Boolean(options.auto && startConditions.startsWhenFull !== false && rosterIsFull);
  const creatorAuthorized = String(battleRow.created_by) === String(options.userId) && Boolean(startConditions.manualStart || startConditions.creatorStart || battleRow.opponent_requirement === 'none');
  if(!options.auto && !creatorAuthorized) return { forbidden:true, reason:'Only an authorized creator can manually start this battle' };
  if(!allReady && !creatorAuthorized && !automaticCapacityStart) return { conflict:true, reason:'All required participants must be ready before the battle can start' };
  if(creatorAuthorized && !allReady && battleRow.opponent_requirement !== 'none') return { conflict:true, reason:'Creator start is not permitted before required participants are ready' };
  const version = nextBattleVersion(battleRow);
  const startedAt = now.toISOString();
  const deadlineAt = battleDeadline({ ...battleRow, started_at:startedAt, deadline_at:null }, startedAt);
  const lockedVotingConfig = lockVotingConfig(battleRow.voting_config, battleRow, now);
  const lockedScoringFormula = buildLockedScoringFormula(lockedVotingConfig, battleRow, now);
  const updatedBattle = await dataClient.from(BATTLE_RECORD_TABLE).update({
    status:'started',
    started_at:startedAt,
    deadline_at:deadlineAt,
    voting_config:lockedVotingConfig,
    locked_scoring_formula:lockedScoringFormula,
    battle_version:version,
    updated_at:startedAt
  }).eq('id', battleRow.id).select('*').single();
  if(updatedBattle.error) return { error:updatedBattle.error };
  for(const entry of entries.entries){
    if(entry.status !== 'withdrawn'){
      await dataClient.from('battle_entries').update({ status:'started', started_at:startedAt, updated_at:startedAt }).eq('id', entry.id);
    }
  }
  const room = await buildBattleRoomState(dataClient, options.userId || battleRow.created_by, battleRow.id, {}, now);
  if(room.error || room.forbidden) return room;
  return { started:true, state:room.state, battle:sanitizeBattleRecord(updatedBattle.data) };
}

async function touchBattleRoomPresence(dataClient, userId, entryId, input = {}, now = new Date()){
  const owned = await getOwnedBattleEntry(dataClient, userId, entryId);
  if(owned.error || owned.forbidden) return owned;
  const presence = cleanString(input.presence || input.presenceStatus || input.presence_status, 40) || 'online';
  const allowed = ['online', 'reconnecting', 'offline'];
  const safePresence = allowed.includes(presence) ? presence : 'online';
  const update = {
    presence_status:safePresence,
    presence_last_seen_at:now.toISOString(),
    updated_at:now.toISOString()
  };
  if(safePresence === 'offline' && !['ready', 'started', 'submitted', 'completed', 'withdrawn'].includes(owned.entry.status)){
    update.status = 'disconnected';
  }
  const updated = await dataClient.from('battle_entries').update(update).eq('id', owned.entry.id).eq('user_id', userId).select('*').single();
  if(updated.error) return { error:updated.error };
  const room = await buildBattleRoomState(dataClient, userId, owned.entry.battle_id, {}, now);
  if(room.error || room.forbidden) return room;
  return { entry:updated.data, state:room.state };
}

async function recoverOwnedActiveBattles(dataClient, userId, options = {}, now = new Date()){
  const limit = clampLimit(options.limit || options.pageSize || 20);
  const own = await tableQuery(dataClient, 'battle_entries').eq('user_id', userId).limit(limit);
  if(own.error) return { error: own.error };
  const ownEntries = (own.data || []).filter(row => row.status !== 'withdrawn');
  const battleIds = ownEntries.map(row => row.battle_id);
  if(!battleIds.length) return { items: [] };
  let battleQuery = tableQuery(dataClient, BATTLE_RECORD_TABLE);
  if(typeof battleQuery.in === 'function') battleQuery = battleQuery.in('id', battleIds);
  const battlesResult = await battleQuery;
  if(battlesResult.error) return { error: battlesResult.error };
  const recordsById = new Map((battlesResult.data || []).map(row => [String(row.id), row]));
  const entriesResult = await listBattleEntriesForBattles(dataClient, battleIds);
  if(entriesResult.error) return entriesResult;
  const groupedEntries = entriesByBattle(entriesResult.entries);
  const items = [];
  for(const entry of ownEntries){
    const battleRow = recordsById.get(String(entry.battle_id));
    if(!battleRow) continue;
    const grouped = groupedEntries.get(String(battleRow.id)) || [];
    const lobbyStatus = battleStatusForLobby(battleRow, grouped.length, now);
    if(lobbyStatus === 'completed' || lobbyStatus === 'deleted' || lobbyStatus === 'unavailable') continue;
    if(!RECOVERABLE_BATTLE_STATUSES.has(lobbyStatus) && !['cancelled', 'expired'].includes(lobbyStatus)) continue;
    const snapshot = await getExistingSnapshotForEntry(dataClient, userId, entry.id);
    if(snapshot.error) return snapshot;
    let ownerSnapshot = null;
    if(snapshot.snapshot){
      const current = await currentAvailability(dataClient, userId, snapshot.snapshot);
      if(current.error) return current;
      ownerSnapshot = sanitizeBattlePrepSnapshotForOwner({ ...snapshot.snapshot, availability:current.availability });
    }
    const submission = await latestSubmissionStatusForEntry(dataClient, entry.id);
    if(submission.error) return submission;
    items.push({
      battle: { ...sanitizeBattleRecord(battleRow), status:lobbyStatus },
      entry,
      snapshot: ownerSnapshot,
      submission: submission.submission,
      participants:{
        self:{ entryId:entry.id, status:entry.status || 'active', prepared:Boolean(ownerSnapshot), joinedAt:entry.created_at || null },
        opponents: grouped.filter(row => String(row.user_id) !== String(userId)).map(sanitizeOpponentEntry)
      }
    });
  }
  return { items };
}

async function cancelOwnedBattle(dataClient, userId, battleId, now = new Date()){
  const battleResult = await getBattleRecord(dataClient, battleId);
  if(battleResult.error || battleResult.notFound) return battleResult;
  const row = battleResult.battle;
  if(String(row.created_by) !== String(userId)) return { forbidden:true };
  const entries = await listBattleEntries(dataClient, row.id);
  if(entries.error) return entries;
  const status = battleStatusForLobby(row, entries.entries.length, now);
  if(row.status === 'cancelled') return { battle:{ ...sanitizeBattleRecord(row), status:'cancelled' }, duplicate:true };
  if(['started', 'completed', 'judging'].includes(status) || ['active', 'submission_pending', 'completed'].includes(row.status)) return { conflict:true, reason:'Battle cannot be cancelled after it has started' };
  const updated = await dataClient.from(BATTLE_RECORD_TABLE).update({ status:'cancelled', cancelled_at:now.toISOString(), updated_at:now.toISOString() }).eq('id', row.id).select('*').single();
  if(updated.error) return { error: updated.error };
  return { battle:sanitizeBattleRecord(updated.data), cancelled:true };
}

async function withdrawOwnedBattleEntry(dataClient, userId, entryId, now = new Date()){
  const owned = await getOwnedBattleEntry(dataClient, userId, entryId);
  if(owned.error || owned.forbidden) return owned;
  const entry = owned.entry;
  const battleResult = await getBattleRecord(dataClient, entry.battle_id);
  if(battleResult.error || battleResult.notFound) return battleResult;
  const row = battleResult.battle;
  if(String(row.created_by) === String(userId)) return { conflict:true, reason:'Battle creators must cancel the battle instead of withdrawing' };
  const entries = await listBattleEntries(dataClient, row.id);
  if(entries.error) return entries;
  const status = battleStatusForLobby(row, entries.entries.length, now);
  if(['started', 'completed', 'judging'].includes(status) || ['active', 'submission_pending', 'completed'].includes(row.status)) return { conflict:true, reason:'Battle entry cannot be withdrawn after the battle has started' };
  if(entry.status === 'withdrawn') return { entry, duplicate:true };
  const updated = await dataClient.from('battle_entries').update({ status:'withdrawn', withdrawn_at:now.toISOString(), updated_at:now.toISOString() }).eq('id', entry.id).eq('user_id', userId).select('*').single();
  if(updated.error) return { error: updated.error };
  const remainingCount = Math.max(0, entries.entries.length - 1);
  const nextStatus = remainingCount > 0 ? 'waiting' : 'open';
  await dataClient.from(BATTLE_RECORD_TABLE).update({ status:nextStatus, updated_at:now.toISOString() }).eq('id', row.id);
  return { entry:updated.data, battle:{ ...sanitizeBattleRecord(row), status:nextStatus }, withdrawn:true };
}

function publicSnapshotCounts(snapshot){
  const tracks = safeArray(snapshot && snapshot.tracks);
  return {
    trackCount: tracks.length,
    readyTrackCount: tracks.filter(row => row.status === 'ready').length,
    warningTrackCount: tracks.filter(row => row.status === 'warning').length,
    blockedTrackCount: tracks.filter(row => row.status === 'blocked').length
  };
}

function sanitizeBattlePrepSnapshotForOwner(row){
  if(!row) return null;
  return {
    id: row.id,
    snapshotId: row.id,
    snapshotVersion: row.snapshot_version,
    serverBacked: true,
    syncStatus: 'server',
    battleId: row.battle_id,
    battleEntryId: row.battle_entry_id,
    userId: row.user_id,
    crateId: row.crate_id,
    crateVersion: row.crate_version,
    purpose: row.purpose,
    trackSelectionMethod: row.track_selection_method,
    replacementAllowed: Boolean(row.replacement_allowed),
    tracks: safeArray(row.tracks),
    replacements: safeArray(row.replacements),
    ruleDecisions: plainObject(row.rule_decisions),
    availability: plainObject(row.availability),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function sanitizeBattlePrepSnapshotForPublic(row){
  if(!row) return null;
  const counts = publicSnapshotCounts(row);
  return {
    snapshotVersion: cleanString(row.snapshot_version, 64),
    serverBacked: true,
    source: 'server_battle_prep_snapshot',
    purpose: cleanString(row.purpose, 40),
    trackSelectionMethod: cleanString(row.track_selection_method, 40),
    availabilityStatus: cleanString(row.availability && row.availability.status, 40) || 'available',
    replacementCount: safeArray(row.replacements).length,
    ...counts
  };
}

async function hydrateOwnedBattlePrepSnapshot(dataClient, userId, entryId){
  const owned = await getOwnedBattleEntry(dataClient, userId, entryId);
  if(owned.error || owned.forbidden) return owned;
  const result = await getExistingSnapshotForEntry(dataClient, userId, entryId);
  if(result.error) return result;
  if(!result.snapshot) return { unavailable:true };
  const current = await currentAvailability(dataClient, userId, result.snapshot);
  if(current.error) return current;
  return { entry:owned.entry, snapshot:sanitizeBattlePrepSnapshotForOwner({ ...result.snapshot, availability:current.availability }) };
}

async function currentAvailability(dataClient, userId, snapshot){
  const ids = safeArray(snapshot.tracks).map(track => track.libraryTrackId).filter(Boolean);
  const tracksResult = await fetchTracksByIds(dataClient, ids);
  if(tracksResult.error) return tracksResult;
  const tracksById = new Map(tracksResult.tracks.map(row => [String(row.id), row]));
  const unavailable = ids.filter(id => {
    const row = tracksById.get(String(id));
    return !row || String(row.user_id) !== String(userId) || row.archived_at || (!row.audio_storage_object_path && !row.linked_submission_id);
  });
  return {
    availability:{
      ...plainObject(snapshot.availability),
      status: unavailable.length ? 'unavailable' : plainObject(snapshot.availability).status || 'available',
      unavailableTrackCount: unavailable.length,
      unavailableTrackIds: unavailable,
      checkedAt: new Date().toISOString()
    }
  };
}

async function replaceBattlePrepSnapshotTrack(dataClient, userId, snapshotId, input = {}, now = new Date()){
  const result = await tableQuery(dataClient, BATTLE_PREP_SNAPSHOT_TABLE).eq('id', snapshotId).limit(1).single();
  if(result.error) return { error: result.error };
  const snapshot = result.data;
  if(!snapshot) return { unavailable:true };
  if(String(snapshot.user_id) !== String(userId)) return { forbidden:true };
  if(!snapshot.replacement_allowed) return { forbiddenReplacement:true };
  const fromTrackId = cleanString(input.fromTrackId || input.from_track_id, 128);
  const toTrackId = cleanString(input.toTrackId || input.to_track_id, 128);
  if(!fromTrackId || !toTrackId) return { validationError:'Replacement track IDs are required' };
  const original = safeArray(snapshot.tracks).find(track => String(track.libraryTrackId) === String(fromTrackId));
  if(!original) return { validationError:'Original snapshot track was not found' };
  const tracksResult = await fetchTracksByIds(dataClient, [toTrackId]);
  if(tracksResult.error) return tracksResult;
  const replacementTrack = tracksResult.tracks[0];
  if(!replacementTrack || replacementTrack.archived_at) return { unavailable:true };
  if(String(replacementTrack.user_id) !== String(userId)) return { forbidden:true };
  const battleResult = await getBattleRecord(dataClient, snapshot.battle_id);
  if(battleResult.error || battleResult.notFound) return battleResult;
  const battle = BattleModes.normalizeBattleRecord({
    id: battleResult.battle.id,
    modeId: battleResult.battle.mode_id,
    genre: battleResult.battle.genre,
    durationMinutes: battleResult.battle.duration_minutes,
    trackSelectionMethod: battleResult.battle.track_selection_method,
    trackCount: battleResult.battle.track_count,
    minimumTrackCount: battleResult.battle.minimum_track_count,
    opponentRequirement: battleResult.battle.opponent_requirement,
    reward: battleResult.battle.reward,
    createdBy: battleResult.battle.created_by
  });
  const decision = trackDecision(replacementTrack, { ...battle, createdBy:userId }, modeFor(battle), snapshot.purpose);
  if(decision.blockers.length) return { validationError:decision.blockers.join(' ') };
  const event = {
    id: randomUUID(),
    snapshot_id: snapshot.id,
    user_id: userId,
    from_track_id: fromTrackId,
    to_track_id: toTrackId,
    reason: cleanString(input.reason, 240),
    rule_decision: decision,
    created_at: now.toISOString()
  };
  const inserted = await dataClient.from(BATTLE_PREP_REPLACEMENT_TABLE).insert([event]).select('*').single();
  if(inserted.error) return { error: inserted.error };
  const replacements = [...safeArray(snapshot.replacements), {
    id: inserted.data.id,
    fromTrackId,
    toTrackId,
    order: original.order,
    snapshotVersion: snapshot.snapshot_version,
    reason: event.reason,
    createdAt: event.created_at
  }];
  const updated = await dataClient.from(BATTLE_PREP_SNAPSHOT_TABLE).update({ replacements, updated_at: now.toISOString() }).eq('id', snapshot.id).eq('user_id', userId).select('*').single();
  if(updated.error) return { error: updated.error };
  return { snapshot:sanitizeBattlePrepSnapshotForOwner(updated.data), replacement:inserted.data };
}

module.exports = {
  BATTLE_RECORD_TABLE,
  BATTLE_PREP_SNAPSHOT_TABLE,
  BATTLE_PREP_REPLACEMENT_TABLE,
  buildSnapshotPayload,
  buildBattleRoomState,
  cancelOwnedBattle,
  createBattleWithPrepSnapshot,
  findCompatibleLobbyBattle,
  hydrateOwnedBattlePrepSnapshot,
  joinBattleWithPrepSnapshot,
  listPublicBattleLobby,
  normalizeBattleInput,
  recoverOwnedActiveBattles,
  replaceBattlePrepSnapshotTrack,
  resolveBattleIfReady,
  sanitizeBattleForLobby,
  sanitizeBattlePrepSnapshotForOwner,
  sanitizeBattlePrepSnapshotForPublic,
  setBattleEntryReady,
  startBattleIfReady,
  touchBattleRoomPresence,
  verifyBattleEntrySubmissionIntegrity,
  validateOwnedBattlePrepCrate,
  withdrawOwnedBattleEntry
};
