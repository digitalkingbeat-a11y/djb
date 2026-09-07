const crypto = require('crypto');
const BattleModes = require('../battle_modes');

const AWARD_LEDGER_TABLE = 'battle_progression_awards';
const PROGRESSION_PROFILE_TABLE = 'dj_progression_profiles';
const RANKING_SNAPSHOT_TABLE = 'battle_ranking_snapshots';
const AWARD_RULE_VERSION = 'battle-progression-v1';
const RANKING_RULE_VERSION = 'battle-ranking-v1';
const BELT_RULE_VERSION = 'xp-belts-v1';

const BELT_THRESHOLDS = [
  { name:'White', xp:0 },
  { name:'Yellow', xp:100 },
  { name:'Orange', xp:250 },
  { name:'Green', xp:500 },
  { name:'Blue', xp:850 },
  { name:'Purple', xp:1300 },
  { name:'Brown', xp:1800 },
  { name:'Black', xp:2500 }
];

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

function nowIso(now = new Date()){
  return now instanceof Date ? now.toISOString() : new Date(now || Date.now()).toISOString();
}

function stableHash(value){
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function stablePublicProfileId(userId){
  return `dj_${crypto.createHash('sha256').update(`dj-battle-profile:${userId}`).digest('hex').slice(0, 16)}`;
}

function sanitizePublicProfile(profile = {}, userId){
  const source = plainObject(profile);
  return {
    publicProfileId:safeString(source.publicProfileId || source.slug || source.handle, 96) || stablePublicProfileId(userId),
    displayName:safeString(source.displayName || source.name || source.djName, 120) || 'Ranked DJ',
    country:safeString(source.country, 80),
    flag:safeString(source.flag, 16),
    belt:safeString(source.belt, 60),
    visibility:source.visibility === 'private' ? 'private' : 'public'
  };
}

function tableQuery(dataClient, table){
  return dataClient.from(table).select('*');
}

function sanitizeFailure(error){
  const raw = String(error && (error.message || error.error || error) || 'Progression award application failed');
  return raw
    .replace(/[A-Za-z]:\\[^\s'"<>]+/g, '[path]')
    .replace(/\/(?:private|storage|tmp|var)\/[^\s'"<>]+/gi, '[path]')
    .replace(/(service[_-]?role|supabase[_-]?service|secret|token|key|password)[^\s,;'"<>]*/gi, '$1=[redacted]')
    .slice(0, 260);
}

function beltForXp(xp){
  const currentXp = safeNumber(xp);
  return BELT_THRESHOLDS.reduce((best, belt) => currentXp >= belt.xp ? belt : best, BELT_THRESHOLDS[0]);
}

function beltRank(name){
  const index = BELT_THRESHOLDS.findIndex(item => item.name === name);
  return index < 0 ? 0 : index;
}

function nextBelt(current, candidate){
  if(!current) return candidate;
  return beltRank(candidate) >= beltRank(current) ? candidate : current;
}

function battleLikeForProgression(battleRow, resolution){
  return {
    id: battleRow.id,
    modeId: battleRow.mode_id,
    title: battleRow.title,
    genre: battleRow.genre,
    durationMinutes: safeNumber(battleRow.duration_minutes, 10),
    opponentRequirement: battleRow.opponent_requirement,
    rewardType: battleRow.reward_type || plainObject(battleRow.reward).type,
    reward: battleRow.reward || { type:battleRow.reward_type || 'standard', metadata:{} },
    participants:safeArray(resolution && resolution.participants).map(participant => ({
      userId:String(participant.userId),
      submissionId:participant.submissionId,
      status:'completed'
    }))
  };
}

function modeCategories(battleRow, resolution){
  const categories = new Set();
  const mode = String(battleRow.mode_id || '').toLowerCase();
  const modeConfig = BattleModes.getBattleMode(battleRow.mode_id || battleRow.modeId || battleRow.type);
  const isProducer = String(battleRow.discipline || '').toLowerCase() === 'producer' || (modeConfig && modeConfig.discipline === 'producer');
  const reward = plainObject(battleRow.reward);
  if((battleRow.opponent_requirement || '') === 'none' || mode.includes('ai_only')) categories.add('ai_only_high_scores');
  else categories.add('competitive_battles');
  if(isProducer){
    categories.add('producer_beat_battles');
  }else{
    if(mode.includes('transition')) categories.add('transition_battles');
    if(mode.includes('scratch')) categories.add('scratching_battles');
    if(mode.includes('mix') || mode.includes('song')) categories.add('mix_battles');
  }
  if(mode.includes('bitcoin') || battleRow.reward_type === 'bitcoin' || reward.type === 'bitcoin') categories.add('bitcoin_battles');
  return Array.from(categories);
}

function defaultProgressionProfile(userId, country){
  const publicProfile = sanitizePublicProfile({ country }, userId);
  return {
    user_id:String(userId),
    xp:0,
    rating:1500,
    belt:'White',
    wins:0,
    losses:0,
    ties:0,
    voids:0,
    completed_battles:0,
    country:safeString(country, 80),
    public_profile:publicProfile,
    public_profile_id:publicProfile.publicProfileId,
    updated_at:null
  };
}

function normalizeProgressionProfile(row, userId, country){
  const source = row || {};
  const xp = safeNumber(source.xp);
  const publicProfile = sanitizePublicProfile(source.public_profile || source.publicProfile || {
    publicProfileId:source.public_profile_id,
    displayName:source.display_name,
    country:source.country || country,
    belt:source.belt,
    visibility:source.visibility
  }, userId);
  return {
    user_id:String(source.user_id || userId),
    xp,
    rating:safeNumber(source.rating ?? source.ranking_rating, 1500),
    belt:safeString(source.belt, 60) || beltForXp(xp).name,
    wins:safeNumber(source.wins),
    losses:safeNumber(source.losses),
    ties:safeNumber(source.ties),
    voids:safeNumber(source.voids),
    completed_battles:safeNumber(source.completed_battles),
    country:safeString(source.country || publicProfile.country || country, 80),
    public_profile:publicProfile,
    public_profile_id:publicProfile.publicProfileId,
    updated_at:source.updated_at || null
  };
}

async function getProgressionProfile(dataClient, userId, country){
  const result = await tableQuery(dataClient, PROGRESSION_PROFILE_TABLE).eq('user_id', userId).limit(1);
  if(result.error) return { error:result.error };
  const profile = result.data && result.data[0]
    ? normalizeProgressionProfile(result.data[0], userId, country)
    : defaultProgressionProfile(userId, country);
  return { profile, exists:Boolean(result.data && result.data[0]) };
}

async function listProgressionProfiles(dataClient){
  const result = await tableQuery(dataClient, PROGRESSION_PROFILE_TABLE);
  if(result.error) return { error:result.error };
  return { profiles:(result.data || []).map(row => normalizeProgressionProfile(row, row.user_id, row.country)) };
}

function rankRows(profiles, candidate){
  return [...profiles.filter(row => row.user_id !== candidate.user_id), candidate]
    .sort((a, b) => safeNumber(b.rating, 1500) - safeNumber(a.rating, 1500)
      || safeNumber(b.wins) - safeNumber(a.wins)
      || safeNumber(b.xp) - safeNumber(a.xp)
      || String(a.updated_at || '').localeCompare(String(b.updated_at || ''))
      || String(a.user_id).localeCompare(String(b.user_id)));
}

function rankingPosition(profiles, candidate, countryScoped = false){
  const scope = countryScoped && candidate.country
    ? profiles.filter(row => String(row.country || '').toLowerCase() === String(candidate.country).toLowerCase())
    : profiles;
  const ranked = rankRows(scope, candidate);
  const index = ranked.findIndex(row => String(row.user_id) === String(candidate.user_id));
  return index < 0 ? null : index + 1;
}

function progressionDeltaForParticipant(battleRow, resolution, participant){
  if(!resolution || resolution.status !== 'resolved') return { xp:0, ratingDelta:0, beltProgress:0, highScoreEligible:false, rewardType:battleRow.reward_type || 'standard' };
  if((battleRow.opponent_requirement || '') === 'none' || String(battleRow.mode_id || '').includes('ai_only')){
    return { xp:0, ratingDelta:0, beltProgress:0, highScoreEligible:true, rewardType:'high_score', competitiveEligible:false };
  }
  if(['void', 'withdrawn', 'failed'].includes(participant.outcome)) return { xp:0, ratingDelta:0, beltProgress:0, highScoreEligible:false, rewardType:battleRow.reward_type || 'standard' };
  const battle = battleLikeForProgression(battleRow, resolution);
  const result = {
    score: safeNumber(participant.score),
    won: participant.outcome === 'winner' ? true : participant.outcome === 'loser' ? false : null
  };
  return {
    ...BattleModes.calculateProgression({ battle, result }),
    competitiveEligible:true
  };
}

function buildAwardId(battleRow, resolution, participant){
  return participant.award && participant.award.id || `award_${stableHash({
    battleId:battleRow.id,
    resolutionId:resolution.id,
    resolutionVersion:resolution.version,
    entryId:participant.entryId,
    userId:participant.userId
  }).slice(0, 24)}`;
}

function buildAwardRow({ battleRow, resolution, participant, before, after, ranks, categories, now }){
  const delta = progressionDeltaForParticipant(battleRow, resolution, participant);
  return {
    id:buildAwardId(battleRow, resolution, participant),
    battle_id:String(battleRow.id),
    resolution_id:String(resolution.id),
    resolution_version:safeNumber(resolution.version),
    battle_entry_id:String(participant.entryId),
    user_id:String(participant.userId),
    submission_id:String(participant.submissionId || ''),
    outcome:safeString(participant.outcome, 40) || 'recorded',
    score:safeNumber(participant.score),
    xp_delta:safeNumber(delta.xp),
    rating_before:safeNumber(before.rating, 1500),
    rating_delta:safeNumber(delta.ratingDelta),
    rating_after:safeNumber(after.rating, 1500),
    xp_before:safeNumber(before.xp),
    xp_after:safeNumber(after.xp),
    belt_before:before.belt,
    belt_after:after.belt,
    global_rank_before:ranks.globalBefore,
    global_rank_after:ranks.globalAfter,
    country_rank_before:ranks.countryBefore,
    country_rank_after:ranks.countryAfter,
    country:after.country || before.country || null,
    categories,
    award_reason:safeString(`Resolved ${battleRow.mode_id || 'battle'} ${participant.outcome || 'result'} at score ${participant.score}`, 240),
    rule_version:AWARD_RULE_VERSION,
    rating_rule_version:RANKING_RULE_VERSION,
    belt_rule_version:BELT_RULE_VERSION,
    status:'applying',
    sanitized_error:null,
    created_at:nowIso(now),
    applied_at:null,
    updated_at:nowIso(now)
  };
}

function profileAfterAward(before, participant, delta, now){
  const xp = Math.max(0, safeNumber(before.xp) + safeNumber(delta.xp));
  const rating = Math.max(0, safeNumber(before.rating, 1500) + safeNumber(delta.ratingDelta));
  const computedBelt = beltForXp(xp).name;
  const profile = sanitizePublicProfile({
    ...(before.public_profile || {}),
    ...(participant.profile || {}),
    belt:nextBelt(before.belt, computedBelt)
  }, before.user_id);
  return {
    user_id:String(before.user_id),
    xp,
    rating,
    ranking_rating:rating,
    belt:nextBelt(before.belt, computedBelt),
    wins:safeNumber(before.wins) + (participant.outcome === 'winner' ? 1 : 0),
    losses:safeNumber(before.losses) + (participant.outcome === 'loser' ? 1 : 0),
    ties:safeNumber(before.ties) + (participant.outcome === 'tie' ? 1 : 0),
    voids:safeNumber(before.voids) + (participant.outcome === 'void' ? 1 : 0),
    completed_battles:safeNumber(before.completed_battles) + 1,
    country:before.country || participant.profile && participant.profile.country || null,
    public_profile:profile,
    public_profile_id:profile.publicProfileId,
    updated_at:nowIso(now)
  };
}

async function getExistingAward(dataClient, awardId){
  const result = await tableQuery(dataClient, AWARD_LEDGER_TABLE).eq('id', awardId).limit(1);
  if(result.error) return { error:result.error };
  return { award:result.data && result.data[0] || null };
}

async function upsertProgressionProfile(dataClient, profile, exists){
  const values = { ...profile };
  if(exists){
    const updated = await dataClient.from(PROGRESSION_PROFILE_TABLE).update(values).eq('user_id', profile.user_id).select('*').single();
    return updated.error ? { error:updated.error } : { profile:updated.data };
  }
  const inserted = await dataClient.from(PROGRESSION_PROFILE_TABLE).insert([values]).select('*').single();
  return inserted.error ? { error:inserted.error } : { profile:inserted.data };
}

async function insertRankingSnapshots(dataClient, award, now){
  const rows = safeArray(award.categories).map(category => ({
    id:`rank_${stableHash({ awardId:award.id, category }).slice(0, 24)}`,
    award_id:award.id,
    battle_id:award.battle_id,
    resolution_id:award.resolution_id,
    user_id:award.user_id,
    category,
    country:award.country || null,
    rating:award.rating_after,
    score:award.score,
    outcome:award.outcome,
    global_rank:award.global_rank_after,
    country_rank:award.country_rank_after,
    rule_version:RANKING_RULE_VERSION,
    created_at:nowIso(now)
  }));
  for(const row of rows){
    const existing = await tableQuery(dataClient, RANKING_SNAPSHOT_TABLE).eq('id', row.id).limit(1);
    if(existing.error) return { error:existing.error };
    if(existing.data && existing.data[0]) continue;
    const inserted = await dataClient.from(RANKING_SNAPSHOT_TABLE).insert([row]).select('*').single();
    if(inserted.error) return { error:inserted.error };
  }
  return { rows };
}

function awardProgressionPayload(award){
  return {
    status:award.status,
    awardId:award.id,
    awardSource:'server_progression_award_ledger',
    ruleVersion:award.rule_version,
    xp:safeNumber(award.xp_delta),
    ratingDelta:safeNumber(award.rating_delta),
    xpBefore:safeNumber(award.xp_before),
    xpAfter:safeNumber(award.xp_after),
    ratingBefore:safeNumber(award.rating_before),
    ratingAfter:safeNumber(award.rating_after),
    beltBefore:award.belt_before,
    beltAfter:award.belt_after,
    rankingBefore:award.global_rank_before,
    rankingAfter:award.global_rank_after,
    countryRankingBefore:award.country_rank_before,
    countryRankingAfter:award.country_rank_after,
    categories:safeArray(award.categories),
    appliedAt:award.applied_at || null,
    retryable:award.status === 'retryable',
    failure:award.status === 'retryable' ? safeString(award.sanitized_error, 260) : null
  };
}

async function applyParticipantAward(dataClient, battleRow, resolution, participant, now = new Date()){
  const awardId = buildAwardId(battleRow, resolution, participant);
  const existing = await getExistingAward(dataClient, awardId);
  if(existing.error) return existing;
  if(existing.award && existing.award.status === 'applied') return { award:existing.award, duplicate:true };

  const profileResult = await getProgressionProfile(dataClient, participant.userId, participant.profile && participant.profile.country);
  if(profileResult.error) return profileResult;
  const profilesResult = await listProgressionProfiles(dataClient);
  if(profilesResult.error) return profilesResult;
  const before = profileResult.profile;
  const delta = progressionDeltaForParticipant(battleRow, resolution, participant);
  const after = profileAfterAward(before, participant, delta, now);
  const ranks = {
    globalBefore:rankingPosition(profilesResult.profiles, before, false),
    countryBefore:rankingPosition(profilesResult.profiles, before, true),
    globalAfter:rankingPosition(profilesResult.profiles, normalizeProgressionProfile(after, after.user_id, after.country), false),
    countryAfter:rankingPosition(profilesResult.profiles, normalizeProgressionProfile(after, after.user_id, after.country), true)
  };
  const categories = modeCategories(battleRow, resolution).filter(category => category !== 'ai_only_high_scores');
  const row = buildAwardRow({ battleRow, resolution, participant, before, after:normalizeProgressionProfile(after, after.user_id, after.country), ranks, categories, now });
  let ledger = existing.award;
  if(!ledger){
    const inserted = await dataClient.from(AWARD_LEDGER_TABLE).insert([row]).select('*').single();
    if(inserted.error) return { error:inserted.error };
    ledger = inserted.data;
  }
  try{
    const profileUpdate = await upsertProgressionProfile(dataClient, after, profileResult.exists);
    if(profileUpdate.error) throw profileUpdate.error;
    const ranking = await insertRankingSnapshots(dataClient, row, now);
    if(ranking.error) throw ranking.error;
    const updated = await dataClient.from(AWARD_LEDGER_TABLE).update({
      status:'applied',
      sanitized_error:null,
      applied_at:nowIso(now),
      updated_at:nowIso(now)
    }).eq('id', row.id).select('*').single();
    if(updated.error) throw updated.error;
    return { award:updated.data, applied:true, duplicate:Boolean(existing.award) };
  }catch(err){
    const failure = sanitizeFailure(err);
    const failed = await dataClient.from(AWARD_LEDGER_TABLE).update({
      status:'retryable',
      sanitized_error:failure,
      updated_at:nowIso(now)
    }).eq('id', row.id).select('*').single();
    if(failed.error) return { error:failed.error };
    return { award:failed.data, retryable:true, error:new Error(failure) };
  }
}

function applyAwardResultsToResolution(resolution, awardResults, now = new Date()){
  const byEntry = new Map(awardResults.map(result => [String(result.participant.entryId), result]));
  const participants = safeArray(resolution.participants).map(participant => {
    const applied = byEntry.get(String(participant.entryId));
    if(!applied || !applied.award) return participant;
    return {
      ...participant,
      awardLedger:applied.award,
      result:{
        ...(participant.result || {}),
        progression:awardProgressionPayload(applied.award)
      }
    };
  });
  const appliedCount = awardResults.filter(result => result.award && result.award.status === 'applied').length;
  const retryableCount = awardResults.filter(result => result.award && result.award.status === 'retryable').length;
  const total = awardResults.length;
  return {
    ...resolution,
    participants,
    awardState:{
      status: retryableCount ? appliedCount ? 'partial_retryable' : 'retryable' : appliedCount === total ? 'applied' : 'pending',
      appliedCount,
      retryableCount,
      totalCount:total,
      ruleVersion:AWARD_RULE_VERSION,
      updatedAt:nowIso(now),
      lastFailure:awardResults.find(result => result.award && result.award.status === 'retryable')?.award?.sanitized_error || null
    }
  };
}

async function applyResolvedBattleAwards(dataClient, battleRow, resolution, now = new Date()){
  if(!resolution || resolution.status !== 'resolved'){
    return { resolution:{ ...(resolution || {}), awardState:{ status:'unavailable', totalCount:0, appliedCount:0, retryableCount:0, updatedAt:nowIso(now) } } };
  }
  if((battleRow.opponent_requirement || '') === 'none' || String(battleRow.mode_id || '').includes('ai_only')){
    return { resolution:{ ...resolution, awardState:{ status:'practice_separate', totalCount:0, appliedCount:0, retryableCount:0, updatedAt:nowIso(now) } } };
  }
  const awardResults = [];
  for(const participant of safeArray(resolution.participants)){
    const result = await applyParticipantAward(dataClient, battleRow, resolution, participant, now);
    if(result.error && !result.award) return { error:result.error };
    awardResults.push({ ...result, participant });
  }
  return { resolution:applyAwardResultsToResolution(resolution, awardResults, now), awards:awardResults.map(result => result.award).filter(Boolean) };
}

function sanitizeAwardForOwner(award){
  if(!award) return null;
  return {
    id:award.id,
    status:award.status,
    battleId:award.battle_id,
    resolutionId:award.resolution_id,
    resolutionVersion:safeNumber(award.resolution_version),
    outcome:award.outcome,
    score:safeNumber(award.score),
    progression:awardProgressionPayload(award),
    reason:award.award_reason,
    appliedAt:award.applied_at || null,
    createdAt:award.created_at || null
  };
}

async function reconcileBattleAwards(dataClient, options = {}, now = new Date()){
  const limit = Math.min(25, Math.max(1, safeNumber(options.limit || 10, 10)));
  const result = await tableQuery(dataClient, 'battle_records').eq('resolution_status', 'resolved').limit(limit);
  if(result.error) return { error:result.error };
  const outcomes = [];
  for(const battleRow of result.data || []){
    const resolution = plainObject(battleRow.resolution);
    if(!resolution.id) continue;
    const applied = await applyResolvedBattleAwards(dataClient, battleRow, resolution, now);
    if(applied.error){
      outcomes.push({ battleId:battleRow.id, status:'retryable', error:sanitizeFailure(applied.error) });
      continue;
    }
    if(applied.resolution && applied.resolution.awardState){
      await dataClient.from('battle_records').update({
        resolution:applied.resolution,
        updated_at:nowIso(now)
      }).eq('id', battleRow.id).select('*').single();
    }
    outcomes.push({ battleId:battleRow.id, status:applied.resolution.awardState.status, appliedCount:applied.resolution.awardState.appliedCount, retryableCount:applied.resolution.awardState.retryableCount });
  }
  return {
    processed:outcomes.length,
    results:outcomes,
    bounded:true,
    limit
  };
}

module.exports = {
  AWARD_LEDGER_TABLE,
  PROGRESSION_PROFILE_TABLE,
  RANKING_SNAPSHOT_TABLE,
  AWARD_RULE_VERSION,
  BELT_THRESHOLDS,
  applyResolvedBattleAwards,
  awardProgressionPayload,
  beltForXp,
  reconcileBattleAwards,
  sanitizeAwardForOwner,
  sanitizePublicProfile,
  sanitizeFailure
};
