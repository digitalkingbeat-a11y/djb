const crypto = require('crypto');

const BATTLE_RECORD_TABLE = 'battle_records';
const BATTLE_ENTRY_TABLE = 'battle_entries';
const BATTLE_VOTE_TABLE = 'battle_community_votes';
const BATTLE_VOTE_AUDIT_TABLE = 'battle_community_vote_audit';
const VOTING_CONFIG_VERSION = 'community-voting-v1';
const SCORING_FORMULA_VERSION = 'battle-scoring-formula-v1';
const VOTE_FETCH_PAGE_SIZE = 1000;
const DEFAULT_VOTE_LIMITS = {
  rateWindowMs: 60 * 1000,
  rateMax: 6,
  maxCriteria: 8,
  defaultWindowMinutes: 60,
  maxRateKeys: 5000,
  maxFetchPages: 50
};
const VOTE_RATE_STATE = new Map();

function plainObject(value){
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeArray(value){
  return Array.isArray(value) ? value : [];
}

function safeString(value, max = 160){
  if(value == null) return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return text ? text.slice(0, max) : null;
}

function safeNumber(value, fallback = null){
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeBoolean(value, fallback = false){
  if(value == null) return fallback;
  if(typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if(['true', '1', 'yes', 'on'].includes(text)) return true;
  if(['false', '0', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function hasOwn(object, key){
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function firstDefined(...values){
  return values.find(value => value !== undefined && value !== null);
}

function stableHash(value){
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeIso(value){
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function nowIso(now = new Date()){
  return now instanceof Date ? now.toISOString() : new Date(now || Date.now()).toISOString();
}

function addMinutesIso(startIso, minutes){
  const start = new Date(startIso);
  if(!Number.isFinite(start.getTime())) return null;
  return new Date(start.getTime() + Math.max(1, Number(minutes || DEFAULT_VOTE_LIMITS.defaultWindowMinutes)) * 60 * 1000).toISOString();
}

function optionalTableMissing(error){
  const message = String(error && (error.message || error.details || error.hint || error.code || error) || '').toLowerCase();
  return message.includes('does not exist')
    || message.includes('schema cache')
    || message.includes('could not find')
    || message.includes('relation')
    || message.includes('42p01');
}

function tableQuery(dataClient, table){
  return dataClient.from(table).select('*');
}

function publicEntryIdFor(battleId, entryId){
  return `entry_${stableHash({ scope:'public-battle-entry', battleId:String(battleId || ''), entryId:String(entryId || '') }).slice(0, 18)}`;
}

function normalizedEntryId(value){
  return safeString(value, 128);
}

function letterLabel(index){
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const safe = Math.max(0, Number(index) || 0);
  if(safe < alphabet.length) return `Entry ${alphabet[safe]}`;
  return `Entry ${safe + 1}`;
}

function sanitizePublicProfile(value = {}){
  const source = plainObject(value);
  const profile = {
    name: safeString(source.name || source.displayName || source.djName, 120) || 'DJ',
    displayName: safeString(source.displayName || source.name || source.djName, 120) || 'DJ',
    country: safeString(source.country, 80),
    belt: safeString(source.belt, 80),
    rating: safeNumber(source.rating, null),
    publicProfileId: safeString(source.publicProfileId || source.public_profile_id, 96)
  };
  return Object.fromEntries(Object.entries(profile).filter(([, value]) => value !== null && value !== undefined));
}

function normalizeCriterion(raw, index){
  const item = typeof raw === 'string' || typeof raw === 'number' ? { label:String(raw) } : plainObject(raw);
  const label = safeString(item.label || item.name || item.id, 80) || `Criterion ${index + 1}`;
  const id = safeString(item.id || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''), 40) || `criterion_${index + 1}`;
  return {
    id,
    label,
    weight: Math.max(0, safeNumber(item.weight, 1))
  };
}

function normalizeCriteria(value, limits = DEFAULT_VOTE_LIMITS){
  const configured = safeArray(value).slice(0, limits.maxCriteria).map(normalizeCriterion);
  if(!configured.length) return [{ id:'overall', label:'Overall', weight:1 }];
  const seen = new Set();
  return configured.filter(item => {
    if(seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function normalizeMinimumVotes(value){
  const votes = safeNumber(value, 1);
  return Math.min(100, Math.max(1, Math.floor(votes)));
}

function normalizedScoringType(input, battle){
  return safeString(input.scoringType || input.scoring_type || battle.scoringType || battle.scoring_type, 40) || 'measured_rule_based';
}

function hasVotingConfigShape(value = {}){
  return [
    'enabled', 'blindMode', 'blind_mode', 'revealEntrants', 'reveal_entrants',
    'voterEligibility', 'voter_eligibility', 'windowMinutes', 'window_minutes',
    'opensAt', 'opens_at', 'closesAt', 'closes_at', 'scoreMin', 'score_min',
    'scoreMax', 'score_max', 'criteria', 'minimumVotes', 'minimum_votes',
    'weights', 'communityWeight', 'community_weight', 'judgeWeight', 'judge_weight'
  ].some(key => hasOwn(value, key));
}

function explicitVotingSignal(input = {}, source = {}){
  return hasVotingConfigShape(source)
    || [
      'enabled', 'communityVoting', 'community_voting', 'publicVoting', 'public_voting',
      'votingEnabled', 'voting_enabled', 'communityJudging', 'community_judging',
    ].some(key => hasOwn(input, key));
}

function normalizeWeightPair(input, battle, enabled){
  if(!enabled) return { judge:1, community:0 };
  const source = plainObject(input);
  const weights = plainObject(source.weights);
  const scoringType = normalizedScoringType(input, battle);
  const explicitCommunity = firstDefined(weights.community, source.communityWeight, source.community_weight);
  const explicitJudge = firstDefined(weights.judge, source.judgeWeight, source.judge_weight);
  let community = safeNumber(explicitCommunity, null);
  let judge = safeNumber(explicitJudge, null);
  if(community == null && judge == null){
    community = scoringType === 'human_voted' ? 1 : 0.25;
    judge = scoringType === 'human_voted' ? 0 : 0.75;
  }else if(community == null){
    judge = Math.max(0, Math.min(1, judge));
    community = 1 - judge;
  }else if(judge == null){
    community = Math.max(0, Math.min(1, community));
    judge = 1 - community;
  }
  community = Math.max(0, Math.min(1, community));
  judge = Math.max(0, Math.min(1, judge));
  const total = judge + community;
  if(total <= 0) return { judge:1, community:0 };
  return {
    judge:Number((judge / total).toFixed(4)),
    community:Number((community / total).toFixed(4))
  };
}

function normalizeVotingConfig(input = {}, battle = {}, now = new Date()){
  const nested = plainObject(input.votingConfig || input.voting_config);
  const source = Object.keys(nested).length ? nested : hasVotingConfigShape(input) ? plainObject(input) : {};
  const explicit = explicitVotingSignal(input, source);
  const enabledRaw = firstDefined(
    source.enabled,
    input.enabled,
    input.votingEnabled,
    input.voting_enabled,
    input.communityVoting,
    input.community_voting,
    input.publicVoting,
    input.public_voting,
    hasOwn(input, 'communityJudging') ? input.communityJudging : undefined,
    hasOwn(input, 'community_judging') ? input.community_judging : undefined
  );
  const enabled = enabledRaw == null ? false : safeBoolean(enabledRaw, false);
  const windowMinutes = Math.min(7 * 24 * 60, Math.max(5, Math.floor(safeNumber(
    firstDefined(source.windowMinutes, source.window_minutes, input.votingWindowMinutes, input.voting_window_minutes),
    DEFAULT_VOTE_LIMITS.defaultWindowMinutes
  ))));
  const opensAt = safeIso(firstDefined(source.opensAt, source.opens_at, input.votingOpensAt, input.voting_opens_at));
  const closesAt = safeIso(firstDefined(source.closesAt, source.closes_at, input.votingClosesAt, input.voting_closes_at));
  const scoreMin = Math.max(0, Math.min(100, safeNumber(firstDefined(source.scoreMin, source.score_min), 0)));
  const scoreMax = Math.max(scoreMin + 1, Math.min(100, safeNumber(firstDefined(source.scoreMax, source.score_max), 100)));
  return {
    version: VOTING_CONFIG_VERSION,
    enabled,
    status: enabled ? 'configured' : explicit ? 'configured_disabled' : 'disabled',
    blindMode: enabled ? safeBoolean(firstDefined(source.blindMode, source.blind_mode, input.blindMode, input.blind_mode), true) : false,
    revealEntrants: safeBoolean(firstDefined(source.revealEntrants, source.reveal_entrants), false),
    voterEligibility: safeString(firstDefined(source.voterEligibility, source.voter_eligibility), 80) || 'authenticated_non_participant',
    window: {
      opensAt,
      closesAt,
      windowMinutes
    },
    criteria: normalizeCriteria(firstDefined(source.criteria, input.votingCriteria, input.voting_criteria)),
    scoreRange: { min:scoreMin, max:scoreMax },
    minimumVotes: normalizeMinimumVotes(firstDefined(source.minimumVotes, source.minimum_votes)),
    weights: normalizeWeightPair({ ...source, scoringType:normalizedScoringType(input, battle) }, battle, enabled),
    configuredAt: safeIso(source.configuredAt || source.configured_at) || nowIso(now)
  };
}

function currentVotingConfigForBattle(battleRow = {}, now = new Date()){
  const source = plainObject(battleRow.voting_config || battleRow.votingConfig);
  const config = normalizeVotingConfig({ votingConfig:source, scoringType:battleRow.scoring_type }, battleRow, now);
  return {
    ...config,
    status: safeString(source.status, 40) || config.status,
    lockedAt: safeIso(source.lockedAt || source.locked_at) || null,
    window: {
      ...config.window,
      opensAt: safeIso(source.window && (source.window.opensAt || source.window.opens_at)) || config.window.opensAt,
      closesAt: safeIso(source.window && (source.window.closesAt || source.window.closes_at)) || config.window.closesAt
    }
  };
}

function votingWindowStatus(config, now = new Date()){
  if(!config || !config.enabled) return 'disabled';
  const current = now instanceof Date ? now : new Date(now || Date.now());
  const opensAt = safeIso(config.window && config.window.opensAt);
  const closesAt = safeIso(config.window && config.window.closesAt);
  if(!opensAt) return 'configured';
  if(new Date(opensAt).getTime() > current.getTime()) return 'scheduled';
  if(closesAt && new Date(closesAt).getTime() <= current.getTime()) return 'closed';
  return 'open';
}

function lockVotingConfig(inputConfig, battleRow = {}, now = new Date()){
  const config = currentVotingConfigForBattle({ ...battleRow, voting_config:inputConfig }, now);
  if(!config.enabled) return { ...config, status:'disabled', lockedAt:config.lockedAt || nowIso(now) };
  const lockedAt = config.lockedAt || nowIso(now);
  const opensAt = config.window.opensAt || lockedAt;
  const closesAt = config.window.closesAt || addMinutesIso(opensAt, config.window.windowMinutes);
  return {
    ...config,
    status:'locked',
    lockedAt,
    window:{
      ...config.window,
      opensAt,
      closesAt
    }
  };
}

function sanitizeLockedScoringFormula(value){
  const formula = plainObject(value);
  if(!formula.version) return null;
  return {
    version: safeString(formula.version, 80) || SCORING_FORMULA_VERSION,
    type: safeString(formula.type, 80) || 'highest_normalized_score',
    source: safeString(formula.source, 80) || 'battle_start',
    lockedAt: safeIso(formula.lockedAt || formula.locked_at),
    modeId: safeString(formula.modeId || formula.mode_id, 80),
    scoringType: safeString(formula.scoringType || formula.scoring_type, 40),
    weights: {
      judge: safeNumber(plainObject(formula.weights).judge, 1),
      community: safeNumber(plainObject(formula.weights).community, 0)
    },
    communityVoting: {
      enabled: plainObject(formula.communityVoting || formula.community_voting).enabled === true,
      minimumVotes: normalizeMinimumVotes(plainObject(formula.communityVoting || formula.community_voting).minimumVotes)
    },
    fallback: safeString(formula.fallback, 120) || 'judge_score_when_no_eligible_community_votes',
    tieThreshold: safeNumber(formula.tieThreshold || formula.tie_threshold, 0),
    scoreRange: plainObject(formula.scoreRange || formula.score_range)
  };
}

function buildLockedScoringFormula(votingConfig, battleRow = {}, now = new Date()){
  const config = votingConfig && votingConfig.version ? votingConfig : currentVotingConfigForBattle({ ...battleRow, voting_config:votingConfig }, now);
  const weights = config.enabled ? config.weights : { judge:1, community:0 };
  return {
    version: SCORING_FORMULA_VERSION,
    type:'highest_normalized_score',
    source:'battle_start',
    lockedAt: config.lockedAt || nowIso(now),
    modeId: safeString(battleRow.mode_id || battleRow.modeId, 80),
    scoringType: safeString(battleRow.scoring_type || battleRow.scoringType, 40) || 'measured_rule_based',
    weights,
    communityVoting:{
      enabled: Boolean(config.enabled && weights.community > 0),
      minimumVotes: config.minimumVotes || 1
    },
    fallback:'judge_score_when_no_eligible_community_votes',
    tieThreshold:0,
    scoreRange: config.scoreRange || { min:0, max:100 }
  };
}

function sanitizeVotingConfigForPublic(config, battleRow = {}, now = new Date()){
  const source = config && config.version ? config : currentVotingConfigForBattle({ ...battleRow, voting_config:config }, now);
  return {
    version: source.version || VOTING_CONFIG_VERSION,
    enabled:Boolean(source.enabled),
    status:votingWindowStatus(source, now),
    blindMode:Boolean(source.blindMode),
    voterEligibility:source.voterEligibility || 'authenticated_non_participant',
    window:{
      opensAt: source.window && source.window.opensAt || null,
      closesAt: source.window && source.window.closesAt || null,
      windowMinutes: source.window && source.window.windowMinutes || DEFAULT_VOTE_LIMITS.defaultWindowMinutes
    },
    criteria:safeArray(source.criteria).map(item => ({ id:item.id, label:item.label, weight:item.weight })),
    scoreRange: source.scoreRange || { min:0, max:100 },
    minimumVotes: source.minimumVotes || 1,
    weights: source.weights || { judge:1, community:0 },
    lockedAt: source.lockedAt || null
  };
}

function voteIsActive(row){
  return row && row.active !== false && !['void', 'retracted', 'flagged'].includes(String(row.status || 'active').toLowerCase());
}

function voteScore(row){
  return safeNumber(row && (row.normalized_score ?? row.score), null);
}

function computeVoteTallies(entries = [], votes = [], battleRow = {}, config = null){
  const currentConfig = config || currentVotingConfigForBattle(battleRow);
  const entryIds = new Set(safeArray(entries).map(row => String(row.id)));
  const map = new Map();
  safeArray(entries).forEach(entry => {
    map.set(String(entry.id), { battleEntryId:String(entry.id), publicEntryId:publicEntryIdFor(battleRow.id, entry.id), voteCount:0, averageScore:null, scoreTotal:0 });
  });
  safeArray(votes).filter(voteIsActive).forEach(row => {
    const entryId = String(row.battle_entry_id || '');
    if(!entryIds.has(entryId)) return;
    const score = voteScore(row);
    if(score == null) return;
    const tally = map.get(entryId);
    tally.voteCount += 1;
    tally.scoreTotal += score;
    tally.averageScore = Number((tally.scoreTotal / tally.voteCount).toFixed(2));
    tally.minimumMet = tally.voteCount >= (currentConfig.minimumVotes || 1);
  });
  return {
    byEntryId:map,
    publicTallies:Array.from(map.values()).map(row => ({
      publicEntryId:row.publicEntryId,
      voteCount:row.voteCount,
      averageScore:row.averageScore,
      minimumMet:Boolean(row.minimumMet)
    })),
    totalVotes:Array.from(map.values()).reduce((sum, row) => sum + row.voteCount, 0)
  };
}

function sanitizePublicBattleEntry(entry, battleRow, config, tally, index, now = new Date()){
  const publicEntryId = publicEntryIdFor(battleRow.id, entry.id);
  const status = votingWindowStatus(config, now);
  const blindActive = Boolean(config.enabled && config.blindMode && !config.revealEntrants && ['configured', 'scheduled', 'open'].includes(status));
  const profile = blindActive ? { name:letterLabel(index), displayName:letterLabel(index) } : sanitizePublicProfile(entry.public_profile);
  return {
    publicEntryId,
    label: blindActive ? letterLabel(index) : profile.displayName || profile.name || letterLabel(index),
    profile,
    status: safeString(entry.status, 40) || 'joined',
    submitted:['submitted', 'completed'].includes(String(entry.status || '').toLowerCase()),
    voteCount:tally && tally.voteCount || 0,
    averageVoteScore:tally && tally.averageScore != null ? tally.averageScore : null
  };
}

function publicVotingSummaryForBattle(battleRow = {}, entries = [], votes = [], now = new Date()){
  const config = currentVotingConfigForBattle(battleRow, now);
  const publicConfig = sanitizeVotingConfigForPublic(config, battleRow, now);
  const tallies = computeVoteTallies(entries, votes, battleRow, config);
  const formula = sanitizeLockedScoringFormula(battleRow.locked_scoring_formula) || buildLockedScoringFormula(config, battleRow, now);
  return {
    ...publicConfig,
    acceptsVotes: publicConfig.enabled && publicConfig.status === 'open',
    totalVotes:tallies.totalVotes,
    tallies:tallies.publicTallies,
    scoringFormula:formula,
    abuseControls:{
      rateLimit:'process_local_bounded',
      distributed:false,
      persistentVoterUniqueness:true,
      auditBeforeWrite:true
    }
  };
}

async function fetchBattle(dataClient, battleId){
  const requested = safeString(battleId, 128);
  if(!requested) return { notFound:true };
  const result = await tableQuery(dataClient, BATTLE_RECORD_TABLE).eq('id', requested).limit(1);
  if(result.error) return { error:result.error };
  const battle = result.data && result.data[0];
  return battle ? { battle } : { notFound:true };
}

async function fetchEntries(dataClient, battleId){
  const result = await tableQuery(dataClient, BATTLE_ENTRY_TABLE).eq('battle_id', battleId);
  if(result.error) return { error:result.error };
  return { entries:(result.data || []).filter(row => row.status !== 'withdrawn') };
}

async function fetchVotes(dataClient, battleId, options = {}){
  const pageSize = Math.min(VOTE_FETCH_PAGE_SIZE, Math.max(1, Math.floor(safeNumber(options.pageSize || options.limit, VOTE_FETCH_PAGE_SIZE))));
  const maxPages = Math.max(1, Math.floor(safeNumber(options.maxPages, DEFAULT_VOTE_LIMITS.maxFetchPages)));
  const votes = [];
  for(let page = 0; page < maxPages; page += 1){
    let query;
    try{
      query = tableQuery(dataClient, BATTLE_VOTE_TABLE).eq('battle_id', battleId);
      if(typeof query.range === 'function') query = query.range(page * pageSize, page * pageSize + pageSize - 1);
      else query = query.limit(pageSize);
      const result = await query;
      if(result.error){
        if(options.optional && optionalTableMissing(result.error)) return { votes:[], missing:true };
        return { error:result.error };
      }
      const pageRows = result.data || [];
      votes.push(...pageRows);
      if(typeof query.range !== 'function'){
        if(pageRows.length >= pageSize){
          return { error:new Error('Community vote aggregation requires pagination-capable data client before totals can be trusted') };
        }
        return { votes };
      }
      if(pageRows.length < pageSize) return { votes };
    }catch(err){
      if(options.optional && optionalTableMissing(err)) return { votes:[], missing:true };
      return { error:err };
    }
  }
  return { error:new Error('Community vote aggregation exceeded bounded pagination limit') };
}

function sanitizePublicBattle(battleRow, entries, votes, now = new Date()){
  const config = currentVotingConfigForBattle(battleRow, now);
  const tallies = computeVoteTallies(entries, votes, battleRow, config);
  const voting = publicVotingSummaryForBattle(battleRow, entries, votes, now);
  const sortedEntries = [...safeArray(entries)].sort((a, b) => String(a.created_at || a.id).localeCompare(String(b.created_at || b.id)));
  return {
    id:safeString(battleRow.id, 128),
    publicUrl:`/battles/${safeString(battleRow.id, 128)}`,
    title:safeString(battleRow.title, 160) || 'Battle',
    modeId:safeString(battleRow.mode_id, 80),
    genre:safeString(battleRow.genre, 80) || 'Open Format',
    status:safeString(battleRow.status, 40) || 'open',
    visibility:safeString(battleRow.visibility, 40) || 'public',
    durationMinutes:safeNumber(battleRow.duration_minutes, null),
    scoringType:safeString(battleRow.scoring_type, 40) || 'measured_rule_based',
    startedAt:safeIso(battleRow.started_at),
    deadlineAt:safeIso(battleRow.deadline_at),
    resolvedAt:safeIso(battleRow.resolved_at),
    creator:sanitizePublicProfile(battleRow.public_creator_profile),
    voting,
    participants:sortedEntries.map((entry, index) => sanitizePublicBattleEntry(entry, battleRow, config, tallies.byEntryId.get(String(entry.id)), index, now)),
    resolved:Boolean(plainObject(battleRow.resolution).status === 'resolved' || battleRow.resolution_status === 'resolved')
  };
}

async function fetchExistingVoteForVoter(dataClient, battleId, voterUserId){
  const result = await tableQuery(dataClient, BATTLE_VOTE_TABLE)
    .eq('battle_id', battleId)
    .eq('voter_user_id', voterUserId)
    .limit(5);
  if(result.error) return { error:result.error };
  const vote = (result.data || []).find(voteIsActive) || null;
  return { vote };
}

async function getPublicBattleShare(dataClient, battleId, options = {}, now = new Date()){
  const found = await fetchBattle(dataClient, battleId);
  if(found.error || found.notFound) return found;
  if(!['public', 'available'].includes(String(found.battle.visibility || 'public'))) return { private:true };
  const entries = await fetchEntries(dataClient, found.battle.id);
  if(entries.error) return entries;
  const votes = await fetchVotes(dataClient, found.battle.id, { optional:true });
  if(votes.error) return votes;
  return { battle:sanitizePublicBattle(found.battle, entries.entries, votes.votes, now), votesMissing:Boolean(votes.missing) };
}

function visitorFingerprint(visitor = {}, scope, targetId){
  const visitorId = safeString(visitor.visitorId || visitor.sessionId || visitor.viewerId, 160) || '';
  const userAgent = safeString(visitor.userAgent, 240) || '';
  const ip = safeString(visitor.ip || visitor.ipAddress, 120) || '';
  const acceptLanguage = safeString(visitor.acceptLanguage, 120) || '';
  return crypto
    .createHash('sha256')
    .update(`battle-vote:${scope}:${targetId}:${visitorId}:${userAgent}:${ip}:${acceptLanguage}`)
    .digest('hex');
}

function pruneVoteRateState(state = VOTE_RATE_STATE, nowMs = Date.now(), limits = DEFAULT_VOTE_LIMITS){
  const windowMs = Math.max(1000, safeNumber(limits.rateWindowMs, DEFAULT_VOTE_LIMITS.rateWindowMs));
  const maxKeys = Math.max(1, Math.floor(safeNumber(limits.maxRateKeys, DEFAULT_VOTE_LIMITS.maxRateKeys)));
  for(const [key, record] of state.entries()){
    if(!record || nowMs - safeNumber(record.startedAt, 0) >= windowMs){
      state.delete(key);
    }
  }
  if(state.size <= maxKeys) return;
  const overflow = state.size - maxKeys;
  Array.from(state.entries())
    .sort((a, b) => safeNumber(a[1] && a[1].startedAt, 0) - safeNumber(b[1] && b[1].startedAt, 0))
    .slice(0, overflow)
    .forEach(([key]) => state.delete(key));
}

function checkVoteRateLimit(userId, battleId, now = new Date(), limits = DEFAULT_VOTE_LIMITS, state = VOTE_RATE_STATE){
  const nowMs = now instanceof Date ? now.getTime() : new Date(now || Date.now()).getTime();
  const windowMs = Math.max(1000, safeNumber(limits.rateWindowMs, DEFAULT_VOTE_LIMITS.rateWindowMs));
  const max = Math.max(1, safeNumber(limits.rateMax, DEFAULT_VOTE_LIMITS.rateMax));
  const maxKeys = Math.max(1, Math.floor(safeNumber(limits.maxRateKeys, DEFAULT_VOTE_LIMITS.maxRateKeys)));
  pruneVoteRateState(state, nowMs, { ...limits, rateWindowMs:windowMs, maxRateKeys:maxKeys });
  const key = `${String(userId)}:${String(battleId)}`;
  const record = state.get(key) || { startedAt:nowMs, count:0 };
  if(nowMs - record.startedAt >= windowMs){
    record.startedAt = nowMs;
    record.count = 0;
  }
  record.count += 1;
  state.set(key, record);
  pruneVoteRateState(state, nowMs, { ...limits, rateWindowMs:windowMs, maxRateKeys:maxKeys });
  const limiter = { scope:'process_local_bounded', distributed:false, maxKeys };
  if(record.count > max){
    return { rateLimited:true, retryAfterMs:Math.max(0, windowMs - (nowMs - record.startedAt)), limiter };
  }
  return { rateLimited:false, limiter };
}

function normalizeVotePayload(body = {}, config){
  const range = config.scoreRange || { min:0, max:100 };
  const rawScore = firstDefined(body.score, body.overallScore, body.overall_score);
  const score = safeNumber(rawScore, null);
  if(score == null || score < range.min || score > range.max) return { validationError:`Vote score must be between ${range.min} and ${range.max}` };
  const configuredCriteria = new Set(safeArray(config.criteria).map(item => item.id));
  const inputScores = plainObject(body.scores || body.criteriaScores || body.criteria_scores);
  const criteriaScores = {};
  Object.entries(inputScores).slice(0, DEFAULT_VOTE_LIMITS.maxCriteria).forEach(([key, value]) => {
    const id = safeString(key, 40);
    const number = safeNumber(value, null);
    if(id && configuredCriteria.has(id) && number != null && number >= range.min && number <= range.max){
      criteriaScores[id] = number;
    }
  });
  return {
    score:Number(score.toFixed(2)),
    criteriaScores,
    note:safeString(body.note || body.comment, 400)
  };
}

function findVoteTarget(entries, body, battleId){
  const publicEntryId = safeString(body.publicEntryId || body.public_entry_id, 80);
  const entryId = normalizedEntryId(body.entryId || body.battleEntryId || body.battle_entry_id);
  if(publicEntryId){
    return entries.find(row => publicEntryIdFor(battleId, row.id) === publicEntryId) || null;
  }
  if(entryId){
    return entries.find(row => String(row.id) === String(entryId)) || null;
  }
  return null;
}

function sanitizeVoteRow(row){
  return row ? {
    id:safeString(row.id, 80),
    battleId:safeString(row.battle_id, 128),
    publicEntryId:safeString(row.public_entry_id, 80),
    score:voteScore(row),
    criteriaScores:plainObject(row.criteria_scores),
    status:safeString(row.status, 40) || 'active',
    voteVersion:safeNumber(row.vote_version, 1),
    createdAt:safeIso(row.created_at),
    updatedAt:safeIso(row.updated_at)
  } : null;
}

async function insertVoteAudit(dataClient, vote, action, now = new Date()){
  const row = {
    id:`vote_audit_${stableHash({ voteId:vote.id, action, version:vote.vote_version, at:nowIso(now) }).slice(0, 24)}`,
    vote_id:vote.id,
    battle_id:vote.battle_id,
    battle_entry_id:vote.battle_entry_id,
    voter_user_id:vote.voter_user_id,
    public_entry_id:vote.public_entry_id,
    action,
    vote_version:vote.vote_version || 1,
    audit_payload:{
      score:vote.normalized_score,
      criteriaScores:plainObject(vote.criteria_scores),
      source:safeString(vote.source, 80) || 'public_battle_vote',
      idempotencyKeyPresent:Boolean(vote.idempotency_key)
    },
    created_at:nowIso(now)
  };
  const result = await dataClient.from(BATTLE_VOTE_AUDIT_TABLE).insert([row]).select('*').single();
  if(result.error) return { error:result.error };
  return { audit:result.data };
}

async function recordCommunityBattleVote(dataClient, userId, battleId, body = {}, visitor = {}, now = new Date(), options = {}){
  const voterUserId = safeString(userId, 128);
  if(!voterUserId) return { validationError:'Authenticated voter is required' };
  const found = await fetchBattle(dataClient, battleId);
  if(found.error || found.notFound) return found;
  if(!['public', 'available'].includes(String(found.battle.visibility || 'public'))) return { private:true };
  const entries = await fetchEntries(dataClient, found.battle.id);
  if(entries.error) return entries;
  if(entries.entries.some(row => String(row.user_id) === String(voterUserId))){
    return { forbidden:true, reason:'Battle participants cannot cast community votes on their own battle' };
  }
  const config = currentVotingConfigForBattle(found.battle, now);
  const status = votingWindowStatus(config, now);
  if(!config.enabled) return { votingUnavailable:true, reason:'Community voting is not enabled for this battle' };
  if(status !== 'open') return { votingClosed:true, status, reason:'Community voting is not open for this battle' };
  const idempotencyKey = safeString(body.idempotencyKey || body.idempotency_key, 128);
  const existing = await fetchExistingVoteForVoter(dataClient, found.battle.id, voterUserId);
  if(existing.error) return existing;
  if(existing.vote && idempotencyKey && existing.vote.idempotency_key === idempotencyKey){
    const share = await getPublicBattleShare(dataClient, found.battle.id, {}, now);
    if(share.error) return share;
    return { duplicate:true, vote:sanitizeVoteRow(existing.vote), battle:share.battle };
  }
  const target = findVoteTarget(entries.entries, body, found.battle.id);
  if(!target) return { validationError:'A valid public battle entry is required' };
  const payload = normalizeVotePayload(body, config);
  if(payload.validationError) return payload;
  const limits = { ...DEFAULT_VOTE_LIMITS, ...plainObject(options.limits) };
  const rate = checkVoteRateLimit(voterUserId, found.battle.id, now, limits, options.rateState || VOTE_RATE_STATE);
  if(rate.rateLimited) return { rateLimited:true, retryAfterMs:rate.retryAfterMs, limiter:rate.limiter };
  const fingerprint = visitorFingerprint(visitor, 'battle-vote', `${found.battle.id}:${voterUserId}`);
  const base = {
    battle_id:found.battle.id,
    battle_entry_id:target.id,
    public_entry_id:publicEntryIdFor(found.battle.id, target.id),
    voter_user_id:voterUserId,
    voter_fingerprint:fingerprint,
    normalized_score:payload.score,
    criteria_scores:payload.criteriaScores,
    note:payload.note,
    source:safeString(body.source, 80) || 'public_battle_vote',
    campaign:safeString(body.campaign, 120),
    referrer:safeString(body.referrer, 240),
    status:'active',
    active:true,
    idempotency_key:idempotencyKey,
    updated_at:nowIso(now)
  };
  let action;
  let voteRow;
  if(existing.vote){
    const version = Math.max(1, safeNumber(existing.vote.vote_version, 1)) + 1;
    voteRow = { ...existing.vote, ...base, vote_version:version };
    action = 'updated';
  }else{
    voteRow = {
      id:`vote_${stableHash({ battleId:found.battle.id, voterUserId }).slice(0, 24)}`,
      ...base,
      vote_version:1,
      created_at:nowIso(now)
    };
    action = 'created';
  }
  const audit = await insertVoteAudit(dataClient, voteRow, action, now);
  if(audit.error) return audit;
  let vote;
  if(existing.vote){
    const updated = await dataClient.from(BATTLE_VOTE_TABLE).update(voteRow).eq('id', existing.vote.id).select('*').single();
    if(updated.error) return { error:updated.error };
    vote = updated.data;
  }else{
    const inserted = await dataClient.from(BATTLE_VOTE_TABLE).insert([voteRow]).select('*').single();
    if(inserted.error) return { error:inserted.error };
    vote = inserted.data;
  }
  const share = await getPublicBattleShare(dataClient, found.battle.id, {}, now);
  if(share.error) return share;
  return { duplicate:false, updated:action === 'updated', vote:sanitizeVoteRow(vote), audit:audit.audit, battle:share.battle };
}

async function prepareCommunityVotingForResolution(dataClient, battleRow, candidates = [], now = new Date()){
  const config = currentVotingConfigForBattle(battleRow, now);
  const formula = sanitizeLockedScoringFormula(battleRow.locked_scoring_formula) || buildLockedScoringFormula(config, battleRow, now);
  const status = votingWindowStatus(config, now);
  const waitsForVoting = Boolean(config.enabled && formula.weights.community > 0 && ['configured', 'scheduled', 'open'].includes(status));
  const entries = safeArray(candidates).map(item => item.entry);
  const votes = await fetchVotes(dataClient, battleRow.id, { optional:true });
  if(votes.error) return votes;
  const tallies = computeVoteTallies(entries, votes.votes, battleRow, config);
  const summary = {
    ...publicVotingSummaryForBattle(battleRow, entries, votes.votes, now),
    status,
    waitsForVoting,
    votesMissing:Boolean(votes.missing)
  };
  if(waitsForVoting){
    return { waiting:true, status, reason:'Community voting window must close before the locked scoring formula can resolve this battle', voting:summary, scoringFormula:formula };
  }
  const scoredCandidates = safeArray(candidates).map(candidate => {
    const judgeScore = safeNumber(candidate.score, 0);
    const tally = tallies.byEntryId.get(String(candidate.entry.id));
    const communityScore = tally && tally.voteCount >= (config.minimumVotes || 1) ? tally.averageScore : null;
    const scoreApplied = formula.weights.community > 0 && communityScore != null;
    const finalScore = scoreApplied
      ? Number((judgeScore * formula.weights.judge + communityScore * formula.weights.community).toFixed(2))
      : judgeScore;
    return {
      ...candidate,
      judgeScore,
      communityScore,
      score:finalScore,
      communityVoting:{
        enabled:Boolean(config.enabled),
        scoreApplied,
        voteCount:tally && tally.voteCount || 0,
        averageScore:communityScore,
        minimumVotes:config.minimumVotes || 1,
        publicEntryId:publicEntryIdFor(battleRow.id, candidate.entry.id),
        source:'battle_community_votes'
      }
    };
  });
  return { waiting:false, candidates:scoredCandidates, voting:summary, scoringFormula:formula };
}

module.exports = {
  BATTLE_VOTE_AUDIT_TABLE,
  BATTLE_VOTE_TABLE,
  SCORING_FORMULA_VERSION,
  VOTING_CONFIG_VERSION,
  buildLockedScoringFormula,
  checkVoteRateLimit,
  computeVoteTallies,
  currentVotingConfigForBattle,
  fetchVotes,
  getPublicBattleShare,
  lockVotingConfig,
  normalizeVotePayload,
  normalizeVotingConfig,
  prepareCommunityVotingForResolution,
  pruneVoteRateState,
  publicEntryIdFor,
  publicVotingSummaryForBattle,
  recordCommunityBattleVote,
  sanitizeLockedScoringFormula,
  sanitizePublicBattle,
  sanitizeVotingConfigForPublic,
  votingWindowStatus
};
