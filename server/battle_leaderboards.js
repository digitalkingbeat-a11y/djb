const crypto = require('crypto');
const {
  AWARD_LEDGER_TABLE,
  BELT_THRESHOLDS,
  PROGRESSION_PROFILE_TABLE,
  sanitizePublicProfile,
  sanitizeFailure
} = require('./battle_award_ledger');
const { sanitizeBattleResult } = require('./battle_result_history');

const PUBLIC_LEADERBOARD_TABLE = 'public_leaderboard_snapshots';
const LEADERBOARD_CALCULATION_VERSION = 'public-ledger-leaderboards-v1';
const DJ_FOLLOWS_TABLE = 'dj_follows';
const DJ_BLOCKS_TABLE = 'dj_blocks';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const SCAN_LIMIT = 500;
const DETAIL_LIMIT_DEFAULT = 10;
const DETAIL_LIMIT_MAX = 25;
const DETAIL_RATE_STATE = new Map();

const LEADERBOARD_CATEGORIES = {
  competitive_battles: 'Global Competitive',
  country_rankings: 'Country Rankings',
  transition_battles: 'Transition Battles',
  scratching_battles: 'Scratching Battles',
  mix_battles: 'Mix Battles',
  producer_beat_battles: 'Producer Beat Battles',
  bitcoin_battles: 'Bitcoin Battles',
  belt_rankings: 'Belt-Level Rankings',
  ai_only_high_scores: 'AI-Only High Scores'
};

function plainObject(value){
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeArray(value){
  return Array.isArray(value) ? value : [];
}

function safeNumber(value, fallback = 0){
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeString(value, max = 160){
  if(value == null) return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return text ? text.slice(0, max) : null;
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

function stableHash(value){
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function tableQuery(dataClient, table){
  return dataClient.from(table).select('*');
}

function pageNumber(value){
  const page = Number(value);
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function pageLimit(value){
  const limit = Number(value);
  if(!Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function normalizeCategory(value){
  const category = safeString(value, 80) || 'competitive_battles';
  return LEADERBOARD_CATEGORIES[category] ? category : 'competitive_battles';
}

function isLeaderboardCategory(value){
  return Boolean(LEADERBOARD_CATEGORIES[safeString(value, 80)]);
}

function countryCode(value){
  const text = String(value || '').trim();
  if(!text) return null;
  const upper = text.toUpperCase();
  const aliases = {
    'UNITED STATES':'US',
    'USA':'US',
    'UNITED KINGDOM':'GB',
    'UK':'GB',
    'CANADA':'CA'
  };
  return (aliases[upper] || upper).replace(/[^A-Z]/g, '').slice(0, 2) || null;
}

function categoryListForAward(award){
  const categories = new Set(safeArray(award.categories));
  if(!categories.size) categories.add('competitive_battles');
  if(award.country) categories.add('country_rankings');
  if(award.belt_after) categories.add('belt_rankings');
  return Array.from(categories).filter(category => LEADERBOARD_CATEGORIES[category] && category !== 'ai_only_high_scores');
}

function awardEligible(award){
  if(!award || award.status !== 'applied') return false;
  if(['void', 'withdrawn', 'failed'].includes(String(award.outcome || '').toLowerCase())) return false;
  if(!award.resolution_id || !award.user_id) return false;
  return true;
}

function detailLimit(value){
  const limit = Number(value);
  if(!Number.isFinite(limit) || limit <= 0) return DETAIL_LIMIT_DEFAULT;
  return Math.min(DETAIL_LIMIT_MAX, Math.max(1, Math.floor(limit)));
}

function parseCursor(value){
  if(value == null || value === '') return 0;
  const text = String(value);
  const match = text.match(/^cursor_(\d+)$/) || text.match(/^(\d+)$/);
  if(!match) return 0;
  const offset = Number(match[1]);
  return Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
}

function makeCursor(offset, total){
  return offset < total ? `cursor_${offset}` : null;
}

function checkRankingDetailRateLimit(scope, target, fingerprint, now = new Date(), limits = {}, state = DETAIL_RATE_STATE){
  const windowMs = safeNumber(limits.windowMs, 60 * 1000);
  const max = safeNumber(limits.max, 30);
  const nowMs = now instanceof Date ? now.getTime() : new Date(now || Date.now()).getTime();
  const key = stableHash({ scope:safeString(scope, 40), target:safeString(target, 128), fingerprint:safeString(fingerprint, 220) });
  const record = state.get(key) || { startedAt:nowMs, count:0 };
  if(nowMs - record.startedAt > windowMs){
    record.startedAt = nowMs;
    record.count = 0;
  }
  record.count += 1;
  state.set(key, record);
  if(record.count > max){
    return { rateLimited:true, retryAfterMs:Math.max(0, windowMs - (nowMs - record.startedAt)) };
  }
  return { rateLimited:false, retryAfterMs:0 };
}

async function fetchAppliedAwards(dataClient, limit = SCAN_LIMIT){
  const result = await tableQuery(dataClient, AWARD_LEDGER_TABLE).eq('status', 'applied').limit(Math.min(SCAN_LIMIT, Math.max(limit, DEFAULT_LIMIT)));
  if(result.error) return { error:result.error };
  return { awards:(result.data || []).filter(awardEligible) };
}

async function fetchProgressionProfiles(dataClient){
  const result = await tableQuery(dataClient, PROGRESSION_PROFILE_TABLE);
  if(result.error) return { error:result.error };
  return { profiles:new Map((result.data || []).map(row => [String(row.user_id), row])) };
}

function activeFollowRow(row){
  return row && row.active !== false && row.status !== 'inactive';
}

async function fetchActiveFollows(dataClient){
  const result = await tableQuery(dataClient, DJ_FOLLOWS_TABLE).limit(SCAN_LIMIT * 4);
  if(result.error){
    if(optionalTableMissing(result.error)) return { follows:[], missing:true };
    return { error:result.error };
  }
  return { follows:(result.data || []).filter(activeFollowRow) };
}

async function fetchBlockedUserIds(dataClient, viewerUserId){
  if(!viewerUserId) return { userIds:new Set() };
  const result = await tableQuery(dataClient, DJ_BLOCKS_TABLE).limit(SCAN_LIMIT);
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
    .limit(SCAN_LIMIT);
  if(result.error){
    if(optionalTableMissing(result.error)) return { userIds:new Set(), missing:true };
    return { error:result.error };
  }
  const ids = new Set();
  (result.data || []).forEach(row => {
    const summary = plainObject(plainObject(row.processing_info).battleResultSummary);
    const opponent = plainObject(summary.opponent);
    const opponentUserId = safeString(opponent.userId || opponent.user_id, 128);
    if(opponentUserId && opponentUserId !== String(viewerUserId)) ids.add(opponentUserId);
  });
  return { userIds:ids };
}

function relationshipScope(value){
  const scope = safeString(value, 40) || 'all';
  return ['following', 'prior_opponents'].includes(scope) ? scope : 'all';
}

async function relationshipUserIdFilter(dataClient, options = {}){
  const scope = relationshipScope(options.relationship || options.relationshipScope || options.scope);
  const viewerUserId = safeString(options.viewerUserId || options.userId, 128);
  if(scope === 'all') return { scope:'all', userIds:null };
  if(!viewerUserId) return { validationError:'Authenticated viewer is required for relationship-scoped rankings.' };
  const blocked = await fetchBlockedUserIds(dataClient, viewerUserId);
  if(blocked.error) return blocked;
  let ids = new Set();
  if(scope === 'following'){
    const follows = await fetchActiveFollows(dataClient);
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

function followerCountMapFromRows(follows, publicProfileIds = []){
  const ids = new Set(safeArray(publicProfileIds).map(id => safeString(id, 96)).filter(Boolean));
  const map = new Map();
  ids.forEach(id => map.set(id, { followers:0, following:0, source:'server' }));
  safeArray(follows).forEach(row => {
    const followedId = safeString(row.followed_public_profile_id || plainObject(row.followed_profile).publicProfileId, 96);
    const followerId = safeString(row.follower_public_profile_id || plainObject(row.follower_profile).publicProfileId, 96);
    if(followedId && map.has(followedId)) map.get(followedId).followers += 1;
    if(followerId && map.has(followerId)) map.get(followerId).following += 1;
  });
  return map;
}

async function attachFollowerCounts(dataClient, rows){
  const ids = rows.map(row => row.publicProfileId).filter(Boolean);
  if(!ids.length) return { rows };
  const follows = await fetchActiveFollows(dataClient);
  if(follows.error) return follows;
  const counts = followerCountMapFromRows(follows.follows, ids);
  return {
    rows:rows.map(row => {
      const count = counts.get(row.publicProfileId);
      return count ? {
        ...row,
        followerCount:count.followers,
        followingCount:count.following,
        relationshipCounts:{ followers:count.followers, following:count.following, source:'server' },
        relationshipSource:'server'
      } : row;
    }),
    missing:follows.missing
  };
}

function profileForAward(award, profiles){
  const profile = profiles.get(String(award.user_id)) || {};
  const embeddedProfile = plainObject(profile.public_profile);
  const publicProfile = sanitizePublicProfile({
    publicProfileId:profile.public_profile_id || embeddedProfile.publicProfileId,
    displayName:profile.display_name || embeddedProfile.displayName || embeddedProfile.name || embeddedProfile.djName,
    country:profile.country || embeddedProfile.country || award.country,
    flag:embeddedProfile.flag,
    belt:profile.belt || embeddedProfile.belt || award.belt_after,
    visibility:profile.visibility || embeddedProfile.visibility
  }, award.user_id);
  return {
    ...publicProfile,
    country:publicProfile.country || award.country || profile.country || null,
    belt:profile.belt || award.belt_after || publicProfile.belt || 'Unranked',
    rating:safeNumber(profile.rating ?? profile.ranking_rating ?? award.rating_after, safeNumber(award.rating_after, 1500)),
    wins:safeNumber(profile.wins),
    losses:safeNumber(profile.losses),
    ties:safeNumber(profile.ties),
    completedBattles:safeNumber(profile.completed_battles)
  };
}

function aggregateAwards(awards, profiles){
  const deduped = new Set();
  const maps = Object.fromEntries(Object.keys(LEADERBOARD_CATEGORIES).map(category => [category, new Map()]));
  for(const award of awards){
    for(const category of categoryListForAward(award)){
      const dedupeKey = `${award.resolution_id}:${award.user_id}:${category}`;
      if(deduped.has(dedupeKey)) continue;
      deduped.add(dedupeKey);
      const profile = profileForAward(award, profiles);
      const country = profile.country || award.country || 'Unknown';
      const key = `${category}:${award.user_id}`;
      const row = maps[category].get(key) || {
        category,
        categoryLabel:LEADERBOARD_CATEGORIES[category],
        userId:String(award.user_id),
        publicProfileId:profile.visibility === 'private' ? null : profile.publicProfileId,
        djName:profile.visibility === 'private' ? 'Private DJ' : profile.displayName,
        profileVisibility:profile.visibility === 'private' ? 'private' : 'public',
        country,
        countryCode:countryCode(country),
        belt:profile.belt || 'Unranked',
        rating:safeNumber(award.rating_after, profile.rating),
        previousRating:safeNumber(award.rating_before, profile.rating),
        eligibleWins:0,
        eligibleLosses:0,
        eligibleTies:0,
        qualifyingBattles:0,
        scoreTotal:0,
        bestScore:0,
        lastAwardedAt:null,
        previousRank:null,
        latestResolutionId:null
      };
      row.rating = safeNumber(award.rating_after, row.rating);
      row.previousRating = safeNumber(award.rating_before, row.previousRating);
      row.belt = award.belt_after || row.belt;
      row.qualifyingBattles += 1;
      row.scoreTotal += safeNumber(award.score);
      row.bestScore = Math.max(row.bestScore, safeNumber(award.score));
      row.previousRank = row.previousRank || safeNumber(award.global_rank_before, null);
      row.lastAwardedAt = !row.lastAwardedAt || String(award.applied_at || award.updated_at || '').localeCompare(String(row.lastAwardedAt)) > 0
        ? award.applied_at || award.updated_at || award.created_at || row.lastAwardedAt
        : row.lastAwardedAt;
      row.latestResolutionId = award.resolution_id || row.latestResolutionId;
      if(award.outcome === 'winner') row.eligibleWins += 1;
      else if(award.outcome === 'loser') row.eligibleLosses += 1;
      else if(award.outcome === 'tie') row.eligibleTies += 1;
      maps[category].set(key, row);
    }
  }
  return maps;
}

function winRate(row){
  const decisions = safeNumber(row.eligibleWins) + safeNumber(row.eligibleLosses) + safeNumber(row.eligibleTies);
  if(decisions < 3) return null;
  return decisions ? Number(((safeNumber(row.eligibleWins) + safeNumber(row.eligibleTies) * 0.5) / decisions).toFixed(3)) : null;
}

function sortRankRows(rows){
  return [...rows].sort((a, b) =>
    safeNumber(b.rating, 1500) - safeNumber(a.rating, 1500)
    || safeNumber(b.eligibleWins) - safeNumber(a.eligibleWins)
    || safeNumber(b.winRate) - safeNumber(a.winRate)
    || safeNumber(b.averageScore) - safeNumber(a.averageScore)
    || safeNumber(b.qualifyingBattles) - safeNumber(a.qualifyingBattles)
    || String(a.lastAwardedAt || '').localeCompare(String(b.lastAwardedAt || ''))
    || String(a.publicProfileId || a.djName).localeCompare(String(b.publicProfileId || b.djName))
  );
}

function finalizeCategoryRows(category, rows){
  return sortRankRows(rows.map(row => ({
    ...row,
    averageScore:row.qualifyingBattles ? Number((row.scoreTotal / row.qualifyingBattles).toFixed(1)) : 0,
    winRate:winRate(row),
    minimumEligibility:{
      requiredBattles:category === 'competitive_battles' ? 1 : 1,
      met:row.qualifyingBattles >= 1
    }
  }))).map((row, index) => {
    const rank = index + 1;
    const previousRank = row.previousRank || rank;
    return {
      ...row,
      rank,
      previousRank,
      movement:previousRank - rank
    };
  });
}

async function buildLeaderboards(dataClient, options = {}){
  const awardsResult = await fetchAppliedAwards(dataClient, safeNumber(options.scanLimit, SCAN_LIMIT));
  if(awardsResult.error) return awardsResult;
  const profilesResult = await fetchProgressionProfiles(dataClient);
  if(profilesResult.error) return profilesResult;
  const maps = aggregateAwards(awardsResult.awards, profilesResult.profiles);
  const categories = {};
  for(const [category, map] of Object.entries(maps)){
    const rows = finalizeCategoryRows(category, Array.from(map.values()));
    categories[category] = {
      label:LEADERBOARD_CATEGORIES[category],
      rows,
      countries:rows.reduce((acc, row) => {
        const key = row.country || 'Unknown';
        acc[key] = acc[key] || [];
        acc[key].push(row);
        return acc;
      }, {}),
      belts:rows.reduce((acc, row) => {
        const key = row.belt || 'Unranked';
        acc[key] = acc[key] || [];
        acc[key].push(row);
        return acc;
      }, {})
    };
  }
  return { categories, awardsScanned:awardsResult.awards.length, calculationVersion:LEADERBOARD_CALCULATION_VERSION };
}

function filterRows(rows, options = {}){
  const countryFilter = safeString(options.country, 80);
  const country = countryFilter && countryFilter !== 'all' ? countryCode(countryFilter) : null;
  const belt = safeString(options.belt, 80);
  return rows.filter(row => {
    if(country && countryCode(row.country) !== country) return false;
    if(belt && belt !== 'all' && String(row.belt || '').toLowerCase() !== belt.toLowerCase()) return false;
    return true;
  });
}

function sanitizeLeaderboardRow(row){
  return {
    rank:row.rank,
    previousRank:row.previousRank,
    movement:row.movement,
    publicProfileId:row.publicProfileId,
    djName:row.djName,
    profileVisibility:row.profileVisibility,
    country:row.country,
    countryCode:row.countryCode,
    belt:row.belt,
    rating:row.rating,
    eligibleWins:row.eligibleWins,
    eligibleLosses:row.eligibleLosses,
    eligibleTies:row.eligibleTies,
    winRate:row.winRate,
    qualifyingBattles:row.qualifyingBattles,
    averageScore:row.averageScore,
    bestScore:row.bestScore,
    lastQualifyingActivity:row.lastAwardedAt,
    minimumEligibility:row.minimumEligibility,
    followerCount:row.followerCount,
    followingCount:row.followingCount,
    relationshipCounts:row.relationshipCounts,
    relationshipSource:row.relationshipSource
  };
}

function sanitizeCategory(category){
  return {
    label:category.label,
    rows:(category.rows || []).map(sanitizeLeaderboardRow),
    countries:Object.fromEntries(Object.entries(category.countries || {}).map(([country, rows]) => [country, rows.map(sanitizeLeaderboardRow)])),
    belts:Object.fromEntries(Object.entries(category.belts || {}).map(([belt, rows]) => [belt, rows.map(sanitizeLeaderboardRow)]))
  };
}

async function listPublicLeaderboards(dataClient, options = {}){
  const category = normalizeCategory(options.category);
  const page = pageNumber(options.page);
  const limit = pageLimit(options.limit);
  const built = await buildLeaderboards(dataClient, options);
  if(built.error) return built;
  const relationship = await relationshipUserIdFilter(dataClient, options);
  if(relationship.error || relationship.validationError) return relationship;
  let categoryRows = filterRows((built.categories[category] && built.categories[category].rows) || [], options);
  if(relationship.userIds){
    categoryRows = categoryRows.filter(row => relationship.userIds.has(String(row.userId)));
  }
  const counted = await attachFollowerCounts(dataClient, categoryRows);
  if(counted.error) return counted;
  categoryRows = counted.rows;
  const offset = (page - 1) * limit;
  const rows = categoryRows.slice(offset, offset + limit).map(sanitizeLeaderboardRow);
  return {
    category,
    categoryLabel:LEADERBOARD_CATEGORIES[category],
    rows,
    categories:Object.fromEntries(Object.entries(built.categories).map(([key, value]) => [key, sanitizeCategory(value)])),
    filters:{
      country:safeString(options.country, 80) || 'all',
      belt:safeString(options.belt, 80) || 'all',
      relationship:relationship.scope
    },
    pagination:{
      page,
      limit,
      total:categoryRows.length,
      hasMore:offset + limit < categoryRows.length,
      nextPage:offset + limit < categoryRows.length ? page + 1 : null
    },
    calculationVersion:built.calculationVersion,
    source:'award_ledger'
  };
}

async function getOwnedRankingSummary(dataClient, userId, options = {}){
  const built = await buildLeaderboards(dataClient, options);
  if(built.error) return built;
  const summaries = {};
  for(const [category, data] of Object.entries(built.categories)){
    const row = (data.rows || []).find(item => String(item.userId) === String(userId));
    summaries[category] = row ? sanitizeLeaderboardRow(row) : {
      category,
      status:'not_yet_ranked',
      requirement:'Complete one eligible resolved competitive battle with an applied progression award.'
    };
  }
  return { rankings:summaries, calculationVersion:built.calculationVersion, source:'award_ledger' };
}

async function fetchPublishedSnapshots(dataClient){
  const result = await tableQuery(dataClient, PUBLIC_LEADERBOARD_TABLE).eq('status', 'published').limit(SCAN_LIMIT);
  if(result.error) return { error:result.error };
  return { snapshots:result.data || [] };
}

async function fetchCompletedSubmissionsForUser(dataClient, userId){
  const result = await tableQuery(dataClient, 'mix_submissions').eq('user_id', userId).eq('status', 'completed').limit(SCAN_LIMIT);
  if(result.error) return { error:result.error };
  return { submissions:result.data || [] };
}

function publicProfileFromProgressionRow(row, userId){
  const embedded = plainObject(row && row.public_profile);
  const profile = sanitizePublicProfile({
    publicProfileId:row && row.public_profile_id || embedded.publicProfileId,
    displayName:row && row.display_name || embedded.displayName || embedded.name || embedded.djName,
    country:row && row.country || embedded.country,
    flag:embedded.flag,
    belt:row && row.belt || embedded.belt,
    visibility:row && row.visibility || embedded.visibility
  }, userId);
  return {
    publicProfileId:profile.publicProfileId,
    djName:profile.visibility === 'private' ? 'Private DJ' : profile.displayName,
    displayName:profile.visibility === 'private' ? 'Private DJ' : profile.displayName,
    profileVisibility:profile.visibility,
    country:profile.country || row && row.country || null,
    countryCode:countryCode(profile.country || row && row.country),
    belt:row && row.belt || profile.belt || 'Unranked',
    rating:safeNumber(row && (row.ranking_rating ?? row.rating), 1500),
    wins:safeNumber(row && row.wins),
    losses:safeNumber(row && row.losses),
    ties:safeNumber(row && row.ties),
    completedBattles:safeNumber(row && row.completed_battles),
    xp:safeNumber(row && row.xp)
  };
}

function findPublicProfileById(profiles, publicProfileId){
  const requested = safeString(publicProfileId, 128);
  if(!requested) return { notFound:true };
  for(const [userId, row] of profiles.entries()){
    const profile = publicProfileFromProgressionRow(row, userId);
    if(profile.publicProfileId === requested){
      if(profile.profileVisibility === 'private') return { private:true };
      return { userId, profile };
    }
  }
  return { notFound:true };
}

function dedupeAwardsForUserCategory(awards, userId, category){
  const seen = new Set();
  return (awards || [])
    .filter(award => String(award.user_id) === String(userId) && categoryListForAward(award).includes(category))
    .filter(award => {
      const key = `${award.resolution_id}:${award.user_id}:${category}`;
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function rankFieldsForCategory(award, category){
  const country = category === 'country_rankings';
  const before = safeNumber(country ? award.country_rank_before : award.global_rank_before, null);
  const after = safeNumber(country ? award.country_rank_after : award.global_rank_after, null);
  return {
    previousRank:before,
    rank:after,
    movement:before != null && after != null ? before - after : 0
  };
}

function movementStatus(before, after, count){
  if(after == null) return count ? 'provisional' : 'unranked';
  if(before == null) return 'newly_ranked';
  if(before - after > 0) return 'up';
  if(before - after < 0) return 'down';
  return 'unchanged';
}

function eligibilityForCategory({ category, awards, profile }){
  const count = (awards || []).length;
  const requiredBattles = category === 'ai_only_high_scores' ? 0 : 3;
  const provisionalBattleCount = category === 'ai_only_high_scores' ? 0 : 1;
  const blockers = [];
  if(category === 'country_rankings' && !(profile && profile.country)) blockers.push('missing_country');
  if(category === 'belt_rankings' && !(profile && profile.belt)) blockers.push('missing_belt');
  if(category === 'ai_only_high_scores') blockers.push('ai_only_high_scores_are_separate_from_competitive_awards');
  if(category !== 'ai_only_high_scores' && count === 0) blockers.push('no_applied_progression_awards');
  const status = category === 'ai_only_high_scores'
    ? 'separate_arcade_board'
    : count >= requiredBattles
      ? 'fully_ranked'
      : count >= provisionalBattleCount
        ? 'provisional'
        : 'unranked';
  return {
    status,
    qualifyingBattleCount:count,
    requiredBattles,
    provisionalBattleCount,
    remainingBattles:Math.max(0, requiredBattles - count),
    blockers,
    ruleVersion:'ranking-eligibility-v1',
    source:'battle_progression_awards'
  };
}

function beltProgressionFromAwards(profile, awards){
  const ordered = [...(awards || [])].sort((a,b) => String(a.applied_at || a.created_at || '').localeCompare(String(b.applied_at || b.created_at || '')));
  const latest = ordered[ordered.length - 1] || {};
  const currentXp = safeNumber(latest.xp_after, safeNumber(profile && profile.xp));
  const currentBelt = safeString(latest.belt_after || profile && profile.belt, 60) || 'Unranked';
  const next = BELT_THRESHOLDS.find(item => item.xp > currentXp) || BELT_THRESHOLDS[BELT_THRESHOLDS.length - 1];
  const promotions = ordered
    .filter(award => award.belt_before && award.belt_after && award.belt_before !== award.belt_after)
    .map(award => ({
      promotionId:`bp_${stableHash({ resolutionId:award.resolution_id, userId:award.user_id, belt:award.belt_after }).slice(0, 16)}`,
      from:safeString(award.belt_before, 60),
      to:safeString(award.belt_after, 60),
      xpBefore:safeNumber(award.xp_before),
      xpAfter:safeNumber(award.xp_after),
      awardedAt:safeString(award.applied_at || award.updated_at || award.created_at, 80)
    }));
  return {
    currentXp,
    currentBelt,
    nextBelt:next && next.name || currentBelt,
    nextThresholdXp:next && next.xp != null ? next.xp : currentXp,
    remainingXp:Math.max(0, safeNumber(next && next.xp, currentXp) - currentXp),
    promotions,
    ruleVersion:'xp-belts-v1',
    source:'battle_progression_awards'
  };
}

function publishedSnapshotSummary(snapshots, publicProfileId, category){
  const rows = (snapshots || [])
    .filter(row => row.public_profile_id === publicProfileId && row.category === category && row.status === 'published')
    .sort((a,b) => String(b.published_at || '').localeCompare(String(a.published_at || '')));
  const latest = rows[0];
  if(!latest) return null;
  return {
    category:safeString(latest.category, 80),
    rank:safeNumber(latest.rank, null),
    previousRank:safeNumber(latest.previous_rank, null),
    movement:safeNumber(latest.movement),
    rating:safeNumber(latest.rating),
    qualifyingBattles:safeNumber(latest.qualifying_battles),
    averageScore:safeNumber(latest.average_score),
    bestScore:safeNumber(latest.best_score),
    publishedAt:safeString(latest.published_at, 80),
    calculationVersion:safeString(latest.calculation_version, 80),
    source:'published_leaderboard_snapshot'
  };
}

function publishedSnapshotHistory(snapshots, publicProfileId, category){
  return (snapshots || [])
    .filter(row => row.public_profile_id === publicProfileId && row.category === category && row.status === 'published')
    .sort((a,b) => String(b.published_at || '').localeCompare(String(a.published_at || '')))
    .slice(0, DETAIL_LIMIT_MAX)
    .map(row => ({
      category:safeString(row.category, 80),
      rank:safeNumber(row.rank, null),
      previousRank:safeNumber(row.previous_rank, null),
      movement:safeNumber(row.movement),
      rating:safeNumber(row.rating),
      qualifyingBattles:safeNumber(row.qualifying_battles),
      averageScore:safeNumber(row.average_score),
      bestScore:safeNumber(row.best_score),
      publishedAt:safeString(row.published_at, 80),
      calculationVersion:safeString(row.calculation_version, 80),
      source:'published_leaderboard_snapshot'
    }));
}

function scoringSourceFromAward(award){
  const explicit = safeArray(award.scoring_source || award.scoringSource).map(item => safeString(item, 80)).filter(Boolean);
  if(explicit.length) return explicit;
  return ['measured', 'rule-based'];
}

function strippedResultForRanking(result, publicView){
  if(!result) return null;
  const base = {
    verifiedResultId:result.verifiedResultId,
    verifiedResultUrl:result.verifiedResultUrl,
    visibility:result.visibility,
    completedAt:result.completedAt,
    battle:result.battle,
    opponent:publicView ? result.opponent : result.opponent,
    score:result.score,
    outcome:result.outcome,
    progression:result.progression,
    belt:result.belt,
    ratingMovement:result.ratingMovement,
    reward:result.reward,
    scoringSource:result.scoringSource,
    securePlaybackPermitted:publicView ? false : result.securePlaybackPermitted === true
  };
  if(!publicView) base.submissionId = result.submissionId;
  return base;
}

function qualifyingBattlesFromAwards(awards, submissions, publicView){
  const submissionsById = new Map((submissions || []).map(row => [String(row.id), row]));
  return (awards || []).map(award => {
    const submission = submissionsById.get(String(award.submission_id || ''));
    const sanitized = submission ? sanitizeBattleResult(submission, { publicView }) : null;
    if(sanitized && (!publicView || sanitized.visibility === 'public')){
      return {
        battleRef:`qb_${stableHash({ resolutionId:award.resolution_id, submissionId:award.submission_id }).slice(0, 16)}`,
        category:(categoryListForAward(award)[0] || 'competitive_battles'),
        source:'verified_result',
        private:false,
        score:safeNumber(award.score, sanitized.score),
        awardedAt:safeString(award.applied_at || award.updated_at || award.created_at, 80),
        result:strippedResultForRanking(sanitized, publicView)
      };
    }
    return {
      battleRef:`qb_${stableHash({ resolutionId:award.resolution_id, userId:award.user_id }).slice(0, 16)}`,
      category:(categoryListForAward(award)[0] || 'competitive_battles'),
      source:'award_ledger',
      private:publicView,
      title:publicView ? 'Private qualifying battle' : 'Qualifying battle',
      score:safeNumber(award.score),
      outcome:safeString(award.outcome, 40),
      awardedAt:safeString(award.applied_at || award.updated_at || award.created_at, 80),
      progression:{
        xp:safeNumber(award.xp_delta),
        ratingDelta:safeNumber(award.rating_delta),
        beltBefore:safeString(award.belt_before, 60),
        beltAfter:safeString(award.belt_after, 60)
      },
      reward:categoryListForAward(award).includes('bitcoin_battles') ? { type:'bitcoin', transferStatus:'untransferred', metadata:{} } : undefined,
      scoringSource:scoringSourceFromAward(award)
    };
  }).sort((a,b) => String(b.awardedAt || '').localeCompare(String(a.awardedAt || '')));
}

function movementHistoryFromAwards(awards, category){
  const ordered = [...(awards || [])].sort((a,b) => String(a.applied_at || a.created_at || '').localeCompare(String(b.applied_at || b.created_at || '')));
  return ordered.map((award, index) => {
    const ranks = rankFieldsForCategory(award, category);
    return {
      historyId:`rh_${stableHash({ resolutionId:award.resolution_id, userId:award.user_id, category }).slice(0, 16)}`,
      category,
      rankingPeriod:safeString(award.applied_at || award.updated_at || award.created_at, 80),
      rank:ranks.rank,
      previousRank:ranks.previousRank,
      movement:ranks.movement,
      movementStatus:movementStatus(ranks.previousRank, ranks.rank, index + 1),
      ratingBefore:safeNumber(award.rating_before, null),
      ratingAfter:safeNumber(award.rating_after, null),
      ratingDelta:safeNumber(award.rating_delta),
      eligibleRecord:{
        wins:ordered.slice(0, index + 1).filter(row => row.outcome === 'winner').length,
        losses:ordered.slice(0, index + 1).filter(row => row.outcome === 'loser').length,
        ties:ordered.slice(0, index + 1).filter(row => row.outcome === 'tie').length
      },
      score:safeNumber(award.score),
      qualifyingBattleCount:index + 1,
      authoritativeTimestamp:safeString(award.applied_at || award.updated_at || award.created_at, 80),
      calculationVersion:LEADERBOARD_CALCULATION_VERSION,
      ruleVersion:safeString(award.rule_version, 80),
      ratingRuleVersion:safeString(award.rating_rule_version, 80),
      beltRuleVersion:safeString(award.belt_rule_version, 80),
      source:'battle_progression_awards'
    };
  }).reverse();
}

function currentRankingFromHistory(history, profile, snapshot, eligibility){
  const latest = history && history[0];
  if(!latest){
    return {
      status:eligibility.status,
      rank:snapshot && snapshot.rank || null,
      previousRank:snapshot && snapshot.previousRank || null,
      movement:snapshot && snapshot.movement || 0,
      movementStatus:eligibility.status,
      rating:profile && profile.rating || null,
      belt:profile && profile.belt || 'Unranked',
      qualifyingBattles:eligibility.qualifyingBattleCount,
      publishedSnapshot:snapshot
    };
  }
  return {
    status:eligibility.status,
    rank:latest.rank,
    previousRank:latest.previousRank,
    movement:latest.movement,
    movementStatus:latest.movementStatus,
    rating:latest.ratingAfter,
    previousRating:latest.ratingBefore,
    belt:profile && profile.belt || 'Unranked',
    qualifyingBattles:eligibility.qualifyingBattleCount,
    eligibleRecord:latest.eligibleRecord,
    publishedSnapshot:snapshot
  };
}

function paginateRankingDetail(history, battles, options){
  const limit = detailLimit(options.limit);
  const offset = parseCursor(options.cursor);
  const total = Math.max(history.length, battles.length);
  return {
    movementHistory:history.slice(offset, offset + limit),
    qualifyingBattles:battles.slice(offset, offset + limit),
    pagination:{
      cursor:offset ? `cursor_${offset}` : null,
      nextCursor:makeCursor(offset + limit, total),
      limit,
      total,
      hasMore:offset + limit < total
    }
  };
}

async function buildRankingDetailForUser(dataClient, userId, options = {}, publicView = false, suppliedProfile = null){
  const category = safeString(options.category, 80) || 'competitive_battles';
  if(!isLeaderboardCategory(category)) return { invalidCategory:true };
  const awardsResult = await fetchAppliedAwards(dataClient, safeNumber(options.scanLimit, SCAN_LIMIT));
  if(awardsResult.error) return awardsResult;
  const profilesResult = await fetchProgressionProfiles(dataClient);
  if(profilesResult.error) return profilesResult;
  const snapshotsResult = await fetchPublishedSnapshots(dataClient);
  if(snapshotsResult.error) return snapshotsResult;
  const submissionsResult = await fetchCompletedSubmissionsForUser(dataClient, userId);
  if(submissionsResult.error) return submissionsResult;
  const profile = suppliedProfile || publicProfileFromProgressionRow(profilesResult.profiles.get(String(userId)) || {}, userId);
  const awards = dedupeAwardsForUserCategory(awardsResult.awards, userId, category);
  const eligibility = eligibilityForCategory({ category, awards, profile });
  const snapshot = publishedSnapshotSummary(snapshotsResult.snapshots, profile.publicProfileId, category);
  const snapshots = publishedSnapshotHistory(snapshotsResult.snapshots, profile.publicProfileId, category);
  const history = movementHistoryFromAwards(awards, category);
  const battles = qualifyingBattlesFromAwards(awards, submissionsResult.submissions, publicView);
  const paged = paginateRankingDetail(history, battles, options);
  return {
    detail:{
      scope:publicView ? 'public' : 'owned',
      profile:{
        publicProfileId:publicView && profile.profileVisibility === 'private' ? null : profile.publicProfileId,
        djName:publicView && profile.profileVisibility === 'private' ? 'Private DJ' : profile.djName,
        displayName:publicView && profile.profileVisibility === 'private' ? 'Private DJ' : profile.displayName,
        profileVisibility:profile.profileVisibility,
        country:profile.country,
        countryCode:profile.countryCode,
        belt:profile.belt
      },
      category,
      categoryLabel:LEADERBOARD_CATEGORIES[category],
      source:'award_ledger',
      calculationVersion:LEADERBOARD_CALCULATION_VERSION,
      rankingPeriod:'award_applied_at',
      current:currentRankingFromHistory(history, profile, snapshot, eligibility),
      publishedSnapshots:snapshots,
      movementHistory:paged.movementHistory,
      qualifyingBattles:paged.qualifyingBattles,
      eligibility,
      beltProgression:beltProgressionFromAwards(profile, awards),
      pagination:paged.pagination
    }
  };
}

async function getPublicRankingDetail(dataClient, publicProfileId, options = {}){
  const profilesResult = await fetchProgressionProfiles(dataClient);
  if(profilesResult.error) return profilesResult;
  const located = findPublicProfileById(profilesResult.profiles, publicProfileId);
  if(located.private || located.notFound) return located;
  return buildRankingDetailForUser(dataClient, located.userId, options, true, located.profile);
}

async function getOwnedRankingDetail(dataClient, userId, options = {}){
  return buildRankingDetailForUser(dataClient, userId, options, false);
}

async function rebuildPublicLeaderboards(dataClient, options = {}, now = new Date()){
  const built = await buildLeaderboards(dataClient, options);
  if(built.error) return built;
  const publishedAt = nowIso(now);
  let written = 0;
  for(const [category, data] of Object.entries(built.categories)){
    for(const row of data.rows || []){
      const snapshot = {
        id:`lb_${stableHash({ category, userId:row.userId, version:LEADERBOARD_CALCULATION_VERSION }).slice(0, 24)}`,
        category,
        country:row.country || null,
        belt:row.belt || null,
        rank:row.rank,
        previous_rank:row.previousRank,
        movement:row.movement,
        public_profile_id:row.publicProfileId,
        display_name:row.djName,
        rating:row.rating,
        eligible_wins:row.eligibleWins,
        eligible_losses:row.eligibleLosses,
        eligible_ties:row.eligibleTies,
        qualifying_battles:row.qualifyingBattles,
        average_score:row.averageScore,
        best_score:row.bestScore,
        last_qualifying_activity:row.lastAwardedAt,
        calculation_version:LEADERBOARD_CALCULATION_VERSION,
        status:'published',
        published_at:publishedAt
      };
      const existing = await tableQuery(dataClient, PUBLIC_LEADERBOARD_TABLE).eq('id', snapshot.id).limit(1);
      if(existing.error) return { error:existing.error };
      if(existing.data && existing.data[0]){
        const updated = await dataClient.from(PUBLIC_LEADERBOARD_TABLE).update(snapshot).eq('id', snapshot.id).select('*').single();
        if(updated.error) return { error:updated.error };
      }else{
        const inserted = await dataClient.from(PUBLIC_LEADERBOARD_TABLE).insert([snapshot]).select('*').single();
        if(inserted.error) return { error:inserted.error };
      }
      written += 1;
    }
  }
  return {
    status:'published',
    written,
    calculationVersion:LEADERBOARD_CALCULATION_VERSION,
    lastSuccessfulRebuild:publishedAt,
    sanitizedFailure:null
  };
}

async function safeRebuildPublicLeaderboards(dataClient, options = {}, now = new Date()){
  try{
    return await rebuildPublicLeaderboards(dataClient, options, now);
  }catch(err){
    return {
      status:'retryable',
      written:0,
      calculationVersion:LEADERBOARD_CALCULATION_VERSION,
      sanitizedFailure:sanitizeFailure(err)
    };
  }
}

module.exports = {
  LEADERBOARD_CATEGORIES,
  LEADERBOARD_CALCULATION_VERSION,
  PUBLIC_LEADERBOARD_TABLE,
  buildLeaderboards,
  checkRankingDetailRateLimit,
  getOwnedRankingDetail,
  getOwnedRankingSummary,
  getPublicRankingDetail,
  listPublicLeaderboards,
  rebuildPublicLeaderboards,
  safeRebuildPublicLeaderboards,
  sanitizeLeaderboardRow
};
