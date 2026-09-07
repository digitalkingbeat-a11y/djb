const crypto = require('crypto');
const BattleModes = require('../battle_modes');
const { getOwnedMixSubmission, getStoredJudgeResult } = require('./battle_submission');
const { getMixRightsPublicationGate } = require('./mix_rights_certification');

const RESULT_VISIBILITIES = ['private', 'public'];
const DISCOVERY_SORTS = ['newest', 'highest_score', 'rating_movement', 'most_viewed'];
const DJ_FOLLOWS_TABLE = 'dj_follows';
const DISCOVERY_LIMIT_DEFAULT = 20;
const DISCOVERY_LIMIT_MAX = 50;
const DISCOVERY_SCAN_LIMIT = 200;
const DEFAULT_VIEW_LIMITS = {
  duplicateWindowMs: 15 * 60 * 1000,
  rateWindowMs: 60 * 1000,
  rateMax: 12,
  fingerprintRetentionMs: 30 * 24 * 60 * 60 * 1000,
  maxFingerprints: 120
};
const VIEW_RATE_STATE = new Map();

const RANKING_CATEGORIES = {
  competitive_battles: 'Competitive Battles',
  ai_only_high_scores: 'AI-Only High Scores',
  transition_battles: 'Transition Battles',
  scratching_battles: 'Scratching Battles',
  mix_battles: 'Mix Battles',
  producer_beat_battles: 'Producer Beat Battles',
  bitcoin_battles: 'Bitcoin Battles'
};

function stableVerifiedResultId(submissionId){
  return `vr_${crypto.createHash('sha256').update(`dj-battle-result:${submissionId}`).digest('hex').slice(0, 20)}`;
}

function stablePublicProfileId(userId){
  return `dj_${crypto.createHash('sha256').update(`dj-battle-profile:${userId}`).digest('hex').slice(0, 16)}`;
}

function trackingSalt(){
  return process.env.VIEW_TRACKING_SALT || process.env.SERVER_VIEW_TRACKING_SALT || 'local-public-view-tracking';
}

function plainObject(value){
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeString(value, maxLength = 160){
  if(value == null) return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return text ? text.slice(0, maxLength) : null;
}

function optionalTableMissing(error){
  const message = String(error && (error.message || error.details || error.hint || error.code || error) || '').toLowerCase();
  return message.includes('does not exist')
    || message.includes('schema cache')
    || message.includes('could not find')
    || message.includes('relation')
    || message.includes('42p01');
}

function safeNumber(value){
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function safeArray(value){
  return Array.isArray(value) ? value : [];
}

function normalizeVisibility(value){
  return RESULT_VISIBILITIES.includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'private';
}

function processingInfo(submission){
  return plainObject(submission && submission.processing_info);
}

function resultSummary(submission){
  return plainObject(processingInfo(submission).battleResultSummary);
}

function resultVisibility(submission){
  const info = processingInfo(submission);
  return normalizeVisibility(info.result_visibility || resultSummary(submission).visibility);
}

function verifiedResultId(submission){
  const info = processingInfo(submission);
  return safeString(info.verified_result_id || resultSummary(submission).verifiedResultId, 80) || stableVerifiedResultId(submission.id);
}

function mergeProcessingInfo(submission, patch){
  return { ...processingInfo(submission), ...patch };
}

function safeReward(reward){
  const source = plainObject(reward);
  const metadata = plainObject(source.metadata);
  if(source.type === 'bitcoin'){
    const verifiedPayment = Boolean(metadata.verifiedPaymentId || metadata.paymentVerified === true);
    return {
      type: 'bitcoin',
      metadata: {
        network: safeString(metadata.network, 40) || 'bitcoin',
        amountSats: safeNumber(metadata.amountSats),
        custody: safeString(metadata.custody, 80) || 'external_pending',
        walletConnected: metadata.walletConnected === true
      },
      transferStatus: verifiedPayment ? 'verified_payment_record' : 'untransferred'
    };
  }
  return {
    type: safeString(source.type, 40) || 'standard',
    metadata: {}
  };
}

function sourceLabels(judgeResult){
  const labels = new Set();
  const evidenceType = (safeString(judgeResult && judgeResult.evidenceType, 120) || '').toLowerCase();
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

function safeProgression(summary){
  const before = plainObject(summary.progressBefore);
  const after = plainObject(summary.progressAfter);
  return {
    xp: safeNumber(summary.xp ?? plainObject(summary.progression).xp),
    ratingDelta: safeNumber(summary.ratingDelta ?? plainObject(summary.progression).ratingDelta),
    beltBefore: safeString(before.belt || summary.beltBefore, 60),
    beltAfter: safeString(after.belt || summary.beltAfter, 60),
    rankingBefore: safeNumber(summary.rankBefore),
    rankingAfter: safeNumber(summary.rankAfter)
  };
}

function safeBattleContext(submission, judgeResult, summary){
  const context = {
    ...plainObject(processingInfo(submission).battleContext),
    ...plainObject(judgeResult && judgeResult.battleContext),
    ...plainObject(summary.battle)
  };
  const modeId = safeString(summary.modeId || context.modeId || judgeResult && judgeResult.battleMode, 80);
  const mode = BattleModes.getBattleMode(modeId || context.type);
  const discipline = safeString(summary.discipline || context.discipline || judgeResult && judgeResult.battleDiscipline, 40)
    || (mode && mode.discipline)
    || 'dj';
  return {
    battleId: safeString(context.battleId || submission.battle_entry_id, 128),
    title: safeString(summary.title || context.title, 160) || 'Battle Result',
    modeId,
    type: safeString(summary.type || context.type, 120) || 'Battle',
    discipline: discipline === 'producer' ? 'producer' : 'dj',
    genre: safeString(summary.genre || context.genre, 80) || 'Open Format'
  };
}

function safeOpponent(summary){
  const opponent = plainObject(summary.opponent);
  return {
    status: safeString(opponent.status || summary.opponentStatus, 40) || 'unknown',
    name: safeString(opponent.name || summary.opponentName, 120),
    country: safeString(opponent.country || summary.opponentCountry, 80)
  };
}

function safePublicMedia(value){
  return safeArray(value).filter(item => {
    const media = plainObject(item);
    return media.public === true || media.visibility === 'public' || media.isPublic === true;
  }).slice(0, 8).map(item => {
    const media = plainObject(item);
    return {
      title: safeString(media.title || media.name, 120) || 'Public media',
      type: safeString(media.type || media.kind, 40) || 'audio',
      description: safeString(media.description, 220),
      securePlaybackPermitted: media.securePlaybackPermitted === true || media.onSitePlayback === true,
      publicUrl: safeString(media.publicUrl || media.artworkUrl, 240)
    };
  });
}

function safeProfile(summary, submission, publicView){
  const profile = plainObject(summary.profile);
  const safe = {
    displayName: safeString(profile.displayName || summary.djName, 120) || 'DJ',
    country: safeString(profile.country || summary.country, 80)
  };
  if(publicView){
    safe.publicProfileId = stablePublicProfileId(submission.user_id);
    safe.bio = safeString(profile.publicBio || profile.bio, 600);
    safe.specialties = safeArray(profile.specialties || profile.modes).slice(0, 12).map(item => safeString(item, 80)).filter(Boolean);
    safe.media = safePublicMedia(profile.media || profile.publicMedia);
  }
  else safe.userId = safeString(submission.user_id, 128);
  return safe;
}

function trackingSource(submission, scope){
  const tracking = plainObject(processingInfo(submission).viewTracking);
  return plainObject(tracking[scope]);
}

function trackingStats(submission, scope){
  const tracking = trackingSource(submission, scope);
  return {
    total: safeNumber(tracking.total) || 0,
    uniqueEstimate: safeNumber(tracking.uniqueEstimate) || 0,
    lastViewedAt: safeString(tracking.lastViewedAt, 80)
  };
}

function safeEvidence(judgeResult, publicView){
  return {
    breakdown: plainObject(judgeResult && judgeResult.breakdown || judgeResult && judgeResult.components),
    timing: Array.isArray(judgeResult && judgeResult.timing) ? judgeResult.timing.slice(0, publicView ? 8 : 32) : [],
    recommendations: Array.isArray(judgeResult && judgeResult.recommendations) ? judgeResult.recommendations.slice(0, publicView ? 5 : 12).map(item => safeString(item, 240)).filter(Boolean) : [],
    measurableAnalysis: plainObject(judgeResult && judgeResult.measurableAnalysis),
    confidence: plainObject(judgeResult && judgeResult.confidence)
  };
}

function safeBattlePrepTrack(track){
  const row = plainObject(track);
  return {
    libraryTrackId: safeString(row.libraryTrackId || row.trackId, 128),
    order: safeNumber(row.order),
    bpm: safeNumber(row.bpm),
    key: safeString(row.key, 40),
    camelotKey: safeString(row.camelotKey, 8),
    genre: safeString(row.genre, 80),
    duration: safeNumber(row.duration),
    status: safeString(row.status || row.availability, 40),
    reasons: safeArray(row.reasons).slice(0, 8).map(item => safeString(item, 180)).filter(Boolean)
  };
}

function safeBattlePrepSummary(value, publicView){
  const input = plainObject(value);
  const tracks = safeArray(input.tracks).map(safeBattlePrepTrack).filter(row => row.libraryTrackId);
  const trackCount = safeNumber(input.trackCount) || tracks.length;
  const warningTrackCount = safeNumber(input.warningTrackCount) || tracks.filter(row => row.status === 'warning').length;
  const blockedTrackCount = safeNumber(input.blockedTrackCount) || tracks.filter(row => row.status === 'blocked' || row.status === 'unavailable').length;
  const summary = {
    source: safeString(input.source, 80) || (input.serverBacked ? 'server_battle_prep_snapshot' : 'local_battle_prep_snapshot'),
    serverBacked: input.serverBacked === true,
    snapshotVersion: safeString(input.snapshotVersion || input.version, 80),
    purpose: safeString(input.purpose, 40),
    trackSelectionMethod: safeString(input.trackSelectionMethod, 40),
    trackCount,
    readyTrackCount: safeNumber(input.readyTrackCount) || Math.max(0, trackCount - warningTrackCount - blockedTrackCount),
    warningTrackCount,
    blockedTrackCount,
    replacementCount: safeNumber(input.replacementCount) || safeArray(input.replacements).length,
    availabilityStatus: safeString(input.availabilityStatus || input.availability && input.availability.status, 40)
  };
  if(!publicView){
    summary.snapshotId = safeString(input.snapshotId || input.id, 128);
    summary.battleEntryId = safeString(input.battleEntryId, 128);
    summary.crateId = safeString(input.crateId, 128);
    summary.crateVersion = safeString(input.crateVersion, 128);
    summary.tracks = tracks;
  }
  return summary.trackCount || summary.snapshotId || summary.snapshotVersion ? summary : null;
}

function sanitizeBattleResult(submission, options = {}){
  const publicView = Boolean(options.publicView);
  const judgeResult = getStoredJudgeResult(submission);
  if(!submission || submission.status !== 'completed' || !judgeResult) return null;
  const summary = resultSummary(submission);
  const visibility = resultVisibility(submission);
  const verifiedId = verifiedResultId(submission);
  const reward = safeReward(judgeResult.reward || summary.reward);
  const battle = safeBattleContext(submission, judgeResult, summary);
  const opponent = safeOpponent(summary);
  const profile = safeProfile(summary, submission, publicView);
  const progression = safeProgression(summary);
  const completedAt = safeString(summary.completedAt || judgeResult.completedAt || processingInfo(submission).judging_completed_at || submission.updated_at || submission.created_at, 80);
  const resultTracking = trackingStats(submission, 'result');
  const viewCount = safeNumber(summary.viewCount ?? summary.publicViews ?? processingInfo(submission).public_views ?? processingInfo(submission).public_view_count ?? resultTracking.total);
  const battlePrep = safeBattlePrepSummary(
    summary.battlePrep ||
    plainObject(processingInfo(submission).battleContext).battlePrepSummary ||
    plainObject(processingInfo(submission).battleContext).battlePrepSnapshot ||
    plainObject(judgeResult.battleContext).battlePrepSummary ||
    plainObject(judgeResult.battleContext).battlePrepSnapshot,
    publicView
  );

  const safe = {
    id: publicView ? verifiedId : safeString(submission.id, 128),
    submissionId: publicView ? undefined : safeString(submission.id, 128),
    verifiedResultId: verifiedId,
    verifiedResultUrl: visibility === 'public' ? `/results/${verifiedId}` : null,
    visibility,
    completedAt,
    battle,
    profile,
    opponent,
    score: judgeResult.score,
    outcome: summary.outcome || (judgeResult.won === true ? 'win' : judgeResult.won === false ? 'loss' : battle.modeId === 'ai_only_practice' ? 'practice' : 'recorded'),
    opponentScore: safeNumber(judgeResult.opponentScore),
    progression,
    belt: progression.beltAfter,
    ratingMovement: progression.ratingDelta,
    viewCount,
    uniqueViewEstimate: resultTracking.uniqueEstimate,
    reward,
    battlePrep,
    scoringSource: sourceLabels(judgeResult),
    evidence: safeEvidence(judgeResult, publicView),
    securePlaybackPermitted: publicView ? false : summary.securePlaybackPermitted === true
  };
  return safe;
}

function sanitizeSummaryInput(body = {}){
  const visibility = normalizeVisibility(body.visibility);
  const opponent = plainObject(body.opponent);
  const profile = plainObject(body.profile);
  return {
    visibility,
    title: safeString(body.title, 160),
    modeId: safeString(body.modeId, 80),
    type: safeString(body.type, 120),
    genre: safeString(body.genre, 80),
    outcome: safeString(body.outcome, 40),
    opponent: {
      status: safeString(opponent.status || body.opponentStatus, 40),
      name: safeString(opponent.name || body.opponentName, 120),
      country: safeString(opponent.country || body.opponentCountry, 80)
    },
    profile: {
      displayName: safeString(profile.displayName || body.djName, 120),
      country: safeString(profile.country || body.country, 80)
    },
    progression: plainObject(body.progression),
    progressBefore: plainObject(body.progressBefore),
    progressAfter: plainObject(body.progressAfter),
    rankBefore: safeNumber(body.rankBefore),
    rankAfter: safeNumber(body.rankAfter),
    securePlaybackPermitted: body.securePlaybackPermitted === true,
    completedAt: safeString(body.completedAt, 80),
    battlePrep: safeBattlePrepSummary(body.battlePrep, false)
  };
}

async function listOwnedBattleResults(dataClient, userId, options = {}){
  const limit = Math.min(100, Math.max(1, Number(options.limit || 50)));
  const query = dataClient.from('mix_submissions').select('*').eq('user_id', userId).eq('status', 'completed').limit(limit);
  const result = await query;
  if(result.error) return { error: result.error };
  const results = (result.data || []).map(row => sanitizeBattleResult(row)).filter(Boolean);
  results.sort((a,b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
  return { results };
}

async function getOwnedBattleResult(dataClient, userId, submissionId){
  const owned = await getOwnedMixSubmission(dataClient, userId, submissionId);
  if(owned.error || owned.forbidden) return owned;
  const result = sanitizeBattleResult(owned.submission);
  if(!result) return { unavailable: true };
  return { result };
}

async function saveOwnedBattleResultSummary(dataClient, userId, submissionId, body, now = new Date()){
  const owned = await getOwnedMixSubmission(dataClient, userId, submissionId);
  if(owned.error || owned.forbidden) return owned;
  if(owned.submission.status !== 'completed' || !getStoredJudgeResult(owned.submission)) return { unavailable: true };
  const summary = sanitizeSummaryInput(body);
  const visibility = summary.visibility;
  const rightsGate = visibility === 'public' ? await ensurePublicRightsCertification(dataClient, owned.submission, now) : { allowed:true };
  if(rightsGate.error) return { error:rightsGate.error };
  if(rightsGate.rightsCertificationBlocked) return { rightsCertificationBlocked:true, certification:rightsGate.certification };
  if(rightsGate.rightsCertificationRequired) return { rightsCertificationRequired:true, reviewRequired:Boolean(rightsGate.reviewRequired), certification:rightsGate.certification || null };
  const verifiedId = verifiedResultId(owned.submission);
  const updated = await dataClient
    .from('mix_submissions')
    .update({
      processing_info: mergeProcessingInfo(owned.submission, {
        battleResultSummary: { ...summary, visibility, verifiedResultId: verifiedId, rightsCertification:rightsGate.certification || null, updatedAt: now.toISOString() },
        result_visibility: visibility,
        verified_result_id: verifiedId
      })
    })
    .eq('id', submissionId)
    .eq('user_id', userId)
    .select('*')
    .single();
  if(updated.error) return { error: updated.error };
  return { result: sanitizeBattleResult(updated.data) };
}

async function setOwnedBattleResultVisibility(dataClient, userId, submissionId, visibility, now = new Date()){
  return saveOwnedBattleResultSummary(dataClient, userId, submissionId, { visibility }, now);
}

async function getPublicBattleResult(dataClient, verifiedId){
  const requested = safeString(verifiedId, 80);
  if(!requested || !/^vr_[a-f0-9]{20}$/.test(requested)) return { notFound: true };
  const query = dataClient.from('mix_submissions').select('*').eq('status', 'completed').limit(100);
  const result = await query;
  if(result.error) return { error: result.error };
  const row = (result.data || []).find(submission => verifiedResultId(submission) === requested);
  if(!row) return { notFound: true };
  if(resultVisibility(row) !== 'public') return { private: true };
  const rightsGate = await ensurePublicRightsCertification(dataClient, row);
  if(rightsGate.error) return { error:rightsGate.error };
  if(!rightsGate.allowed) return { private:true };
  const sanitized = sanitizeBattleResult(row, { publicView: true });
  return sanitized ? { result: sanitized } : { unavailable: true };
}

function normalizeDiscoveryOptions(options = {}){
  const page = Math.min(100, Math.max(1, Number(options.page || 1)));
  const limit = Math.min(DISCOVERY_LIMIT_MAX, Math.max(1, Number(options.limit || DISCOVERY_LIMIT_DEFAULT)));
  const sort = DISCOVERY_SORTS.includes(String(options.sort || '').toLowerCase()) ? String(options.sort).toLowerCase() : 'newest';
  return {
    page,
    limit,
    sort,
    country: safeString(options.country, 80),
    mode: safeString(options.mode || options.modeId, 80),
    genre: safeString(options.genre, 80),
    source: safeString(options.source || options.scoringSource, 80),
    belt: safeString(options.belt, 80),
    opponent: safeString(options.opponent || options.opponentStatus, 80),
    date: safeString(options.date, 40),
    category: safeString(options.category, 80)
  };
}

function dateBucketMatches(completedAt, bucket){
  if(!bucket || bucket === 'all') return true;
  const date = completedAt ? new Date(completedAt) : null;
  if(!date || Number.isNaN(date.getTime())) return false;
  const ageMs = Date.now() - date.getTime();
  if(bucket === '7d') return ageMs <= 7 * 24 * 60 * 60 * 1000;
  if(bucket === '30d') return ageMs <= 30 * 24 * 60 * 60 * 1000;
  if(bucket === 'year') return ageMs <= 365 * 24 * 60 * 60 * 1000;
  return true;
}

function opponentCategory(result){
  const opponent = result && result.opponent || {};
  if(opponent.status === 'ai_only' || result && result.outcome === 'practice') return 'ai_only';
  if(opponent.status === 'opponent' || opponent.name) return 'opponent';
  return opponent.status || 'unmatched';
}

function resultRankingCategories(result){
  const categories = new Set();
  if(!result || result.visibility !== 'public' || !result.verifiedResultId) return [];
  const mode = String(result.battle && result.battle.modeId || result.battle && result.battle.type || '').toLowerCase();
  const type = String(result.battle && result.battle.type || '').toLowerCase();
  const modeConfig = BattleModes.getBattleMode(result.battle && (result.battle.modeId || result.battle.type));
  const isProducer = String(result.battle && result.battle.discipline || '').toLowerCase() === 'producer'
    || (modeConfig && modeConfig.discipline === 'producer')
    || mode.includes('beat_battle')
    || type.includes('beat battle')
    || mode.includes('sample_flip')
    || mode.includes('drum_challenge')
    || mode.includes('remix_challenge');
  if(opponentCategory(result) === 'ai_only') categories.add('ai_only_high_scores');
  else categories.add('competitive_battles');
  if(isProducer) categories.add('producer_beat_battles');
  else {
    if(mode.includes('transition') || type.includes('transition')) categories.add('transition_battles');
    if(mode.includes('scratch') || type.includes('scratch')) categories.add('scratching_battles');
    if(mode.includes('mix') || type.includes('mix') || type.includes('song')) categories.add('mix_battles');
  }
  if(mode.includes('bitcoin') || (result.reward && result.reward.type === 'bitcoin')) categories.add('bitcoin_battles');
  return Array.from(categories);
}

function matchesDiscoveryFilters(result, filters){
  if(!result || result.visibility !== 'public' || !result.verifiedResultId) return false;
  if(filters.country && filters.country !== 'all' && String(result.profile && result.profile.country || '').toLowerCase() !== filters.country.toLowerCase()) return false;
  if(filters.mode && filters.mode !== 'all' && String(result.battle && result.battle.modeId || '').toLowerCase() !== filters.mode.toLowerCase()) return false;
  if(filters.genre && filters.genre !== 'all' && String(result.battle && result.battle.genre || '').toLowerCase() !== filters.genre.toLowerCase()) return false;
  if(filters.source && filters.source !== 'all' && !(result.scoringSource || []).some(source => String(source).toLowerCase() === filters.source.toLowerCase())) return false;
  if(filters.belt && filters.belt !== 'all' && String(result.belt || result.progression && result.progression.beltAfter || '').toLowerCase() !== filters.belt.toLowerCase()) return false;
  if(filters.opponent && filters.opponent !== 'all' && opponentCategory(result) !== filters.opponent) return false;
  if(filters.date && !dateBucketMatches(result.completedAt, filters.date)) return false;
  if(filters.category && filters.category !== 'all' && !resultRankingCategories(result).includes(filters.category)) return false;
  return true;
}

function sortDiscoveryResults(results, sort){
  const rows = [...results];
  if(sort === 'highest_score') rows.sort((a,b) => Number(b.score || 0) - Number(a.score || 0) || String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
  else if(sort === 'rating_movement') rows.sort((a,b) => Math.abs(Number(b.ratingMovement || b.progression && b.progression.ratingDelta || 0)) - Math.abs(Number(a.ratingMovement || a.progression && a.progression.ratingDelta || 0)) || Number(b.score || 0) - Number(a.score || 0));
  else if(sort === 'most_viewed') rows.sort((a,b) => Number(b.viewCount || 0) - Number(a.viewCount || 0) || String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
  else rows.sort((a,b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
  return rows;
}

function dedupePublicResults(results){
  const seen = new Set();
  const deduped = [];
  results.forEach(result => {
    const key = result && result.verifiedResultId;
    if(!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(result);
  });
  return deduped;
}

async function ensurePublicRightsCertification(dataClient, submission, now = new Date()){
  const gate = await getMixRightsPublicationGate(dataClient, submission, now);
  if(gate.error) return gate;
  if(gate.allowed) return { allowed:true, certification:gate.certification || null };
  if(gate.certificationBlocked) return { allowed:false, rightsCertificationBlocked:true, certification:gate.certification || null };
  return { allowed:false, rightsCertificationRequired:true, reviewRequired:Boolean(gate.reviewRequired), certification:gate.certification || null };
}

async function filterPublicRowsByRightsCertification(dataClient, rows, now = new Date()){
  const allowed = [];
  for(const row of rows){
    if(resultVisibility(row) !== 'public') continue;
    const gate = await ensurePublicRightsCertification(dataClient, row, now);
    if(gate.error) return { error:gate.error };
    if(gate.allowed) allowed.push(row);
  }
  return { rows:allowed };
}

function visitorFingerprint(visitor = {}, scope, targetId){
  const visitorId = safeString(visitor.visitorId || visitor.sessionId || visitor.viewerId, 160) || '';
  const userAgent = safeString(visitor.userAgent, 240) || '';
  const ip = safeString(visitor.ip || visitor.ipAddress, 120) || '';
  const acceptLanguage = safeString(visitor.acceptLanguage, 120) || '';
  return crypto
    .createHash('sha256')
    .update(`${trackingSalt()}:${scope}:${targetId}:${visitorId}:${userAgent}:${ip}:${acceptLanguage}`)
    .digest('hex');
}

function rateLimitKey(scope, targetId, fingerprint){
  return `${scope}:${targetId}:${fingerprint}`;
}

function checkViewRateLimit(scope, targetId, fingerprint, now, limits = DEFAULT_VIEW_LIMITS, state = VIEW_RATE_STATE){
  const key = rateLimitKey(scope, targetId, fingerprint);
  const cutoff = now.getTime() - limits.rateWindowMs;
  const timestamps = (state.get(key) || []).filter(value => value >= cutoff);
  if(timestamps.length >= limits.rateMax){
    state.set(key, timestamps);
    return { rateLimited:true, retryAfterMs: Math.max(0, limits.rateWindowMs - (now.getTime() - timestamps[0])) };
  }
  timestamps.push(now.getTime());
  state.set(key, timestamps);
  return { rateLimited:false };
}

function normalizeTrackingRecord(current, fingerprint, now, limits = DEFAULT_VIEW_LIMITS){
  const existing = plainObject(current);
  const fingerprints = plainObject(existing.fingerprints);
  const nowMs = now.getTime();
  const duplicateCutoff = nowMs - limits.duplicateWindowMs;
  const retentionCutoff = nowMs - limits.fingerprintRetentionMs;
  const lastSeen = Number(fingerprints[fingerprint] || 0);
  const retained = Object.entries(fingerprints)
    .filter(([, timestamp]) => Number(timestamp) >= retentionCutoff)
    .sort((a,b) => Number(b[1]) - Number(a[1]))
    .slice(0, limits.maxFingerprints - 1);
  const nextFingerprints = Object.fromEntries(retained);
  if(lastSeen >= duplicateCutoff){
    nextFingerprints[fingerprint] = lastSeen;
    return {
      duplicate:true,
      tracking:{
        total: safeNumber(existing.total) || 0,
        uniqueEstimate: safeNumber(existing.uniqueEstimate) || Object.keys(nextFingerprints).length,
        lastViewedAt: safeString(existing.lastViewedAt, 80),
        fingerprints: nextFingerprints
      }
    };
  }
  nextFingerprints[fingerprint] = nowMs;
  return {
    duplicate:false,
    tracking:{
      total: (safeNumber(existing.total) || 0) + 1,
      uniqueEstimate: Object.keys(nextFingerprints).length,
      lastViewedAt: now.toISOString(),
      fingerprints: nextFingerprints
    }
  };
}

function mergeViewTracking(submission, scope, tracking){
  const info = processingInfo(submission);
  const viewTracking = plainObject(info.viewTracking);
  return {
    ...info,
    viewTracking: {
      ...viewTracking,
      [scope]: tracking
    }
  };
}

function safeViewResponse(tracking, duplicate, rateLimited){
  return {
    duplicate:Boolean(duplicate),
    rateLimited:Boolean(rateLimited),
    views:{
      total:safeNumber(tracking && tracking.total) || 0,
      uniqueEstimate:safeNumber(tracking && tracking.uniqueEstimate) || 0,
      lastViewedAt:safeString(tracking && tracking.lastViewedAt, 80)
    }
  };
}

function buildPublicRankings(results, options = {}){
  const categoryFilter = safeString(options.category, 80);
  const countryFilter = safeString(options.country, 80);
  const aggregates = {};
  Object.keys(RANKING_CATEGORIES).forEach(category => { aggregates[category] = new Map(); });

  dedupePublicResults(results).forEach(result => {
    if(!result || result.visibility !== 'public' || !result.verifiedResultId) return;
    const country = safeString(result.profile && result.profile.country, 80) || 'Unknown';
    if(countryFilter && countryFilter !== 'all' && country.toLowerCase() !== countryFilter.toLowerCase()) return;
    const categories = resultRankingCategories(result);
    categories.forEach(category => {
      if(categoryFilter && categoryFilter !== 'all' && category !== categoryFilter) return;
      const profile = result.profile || {};
      const profileId = profile.publicProfileId || profile.displayName || 'dj';
      const key = `${category}:${country}:${profileId}`;
      const row = aggregates[category].get(key) || {
        category,
        categoryLabel: RANKING_CATEGORIES[category],
        djName: profile.displayName || 'DJ',
        publicProfileId: profile.publicProfileId || null,
        country,
        belt: result.belt || result.progression && result.progression.beltAfter || 'Unranked',
        resultCount: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        scoreTotal: 0,
        bestScore: 0,
        ratingMovement: 0,
        latestCompletedAt: null
      };
      row.resultCount += 1;
      row.scoreTotal += Number(result.score || 0);
      row.bestScore = Math.max(row.bestScore, Number(result.score || 0));
      row.ratingMovement += Number(result.ratingMovement || result.progression && result.progression.ratingDelta || 0);
      row.latestCompletedAt = !row.latestCompletedAt || String(result.completedAt || '').localeCompare(String(row.latestCompletedAt)) > 0 ? result.completedAt : row.latestCompletedAt;
      if(result.outcome === 'win') row.wins += 1;
      else if(result.outcome === 'loss') row.losses += 1;
      else if(result.outcome === 'tie') row.ties += 1;
      if(result.belt || result.progression && result.progression.beltAfter) row.belt = result.belt || result.progression.beltAfter;
      aggregates[category].set(key, row);
    });
  });

  const categories = {};
  Object.entries(aggregates).forEach(([category, rows]) => {
    const ranked = Array.from(rows.values())
      .map(row => ({
        ...row,
        averageScore: row.resultCount ? Number((row.scoreTotal / row.resultCount).toFixed(1)) : 0
      }))
      .sort((a,b) => b.ratingMovement - a.ratingMovement || b.averageScore - a.averageScore || b.bestScore - a.bestScore)
      .map((row,index) => ({ ...row, rank:index + 1 }));
    const countries = ranked.reduce((acc, row) => {
      acc[row.country] = acc[row.country] || [];
      acc[row.country].push(row);
      return acc;
    }, {});
    categories[category] = { label:RANKING_CATEGORIES[category], rows:ranked, countries };
  });
  return { categories };
}

function publicProfileStats(results){
  const rows = dedupePublicResults(results);
  const total = rows.length;
  const wins = rows.filter(row => row.outcome === 'win').length;
  const losses = rows.filter(row => row.outcome === 'loss').length;
  const ties = rows.filter(row => row.outcome === 'tie').length;
  const competitive = rows.filter(row => opponentCategory(row) !== 'ai_only');
  const aiOnly = rows.filter(row => opponentCategory(row) === 'ai_only');
  const scoreTotal = rows.reduce((sum, row) => sum + Number(row.score || 0), 0);
  return {
    totalResults: total,
    competitiveBattles: competitive.length,
    aiOnlyHighScores: aiOnly.length,
    wins,
    losses,
    ties,
    bestScore: rows.reduce((best, row) => Math.max(best, Number(row.score || 0)), 0),
    averageScore: total ? Number((scoreTotal / total).toFixed(1)) : 0,
    totalViews: rows.reduce((sum, row) => sum + Number(row.viewCount || 0), 0)
  };
}

function buildPublicProfileFromResults(publicProfileId, results, sourceRows = []){
  const rows = dedupePublicResults(results).filter(row => row && row.profile && row.profile.publicProfileId === publicProfileId);
  if(!rows.length) return null;
  rows.sort((a,b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
  const primary = rows[0];
  const stats = publicProfileStats(rows);
  const rankings = buildPublicRankings(rows);
  const rankedRows = Object.values(rankings.categories || {}).flatMap(category => category.rows || []);
  const ownRanks = rankedRows.filter(row => row.publicProfileId === publicProfileId);
  const rank = ownRanks.length ? Math.min(...ownRanks.map(row => Number(row.rank || 9999))) : null;
  const specialties = Array.from(new Set(rows.flatMap(row => [
    row.battle && row.battle.modeId,
    row.battle && row.battle.type,
    ...(safeArray(row.profile && row.profile.specialties))
  ]).filter(Boolean))).slice(0, 10);
  const media = rows.flatMap(row => safeArray(row.profile && row.profile.media)).filter(item => item && (item.public === true || item.visibility === 'public' || item.securePlaybackPermitted === true)).slice(0, 8);
  const profileViewStats = sourceRows
    .filter(row => stablePublicProfileId(row.user_id) === publicProfileId)
    .map(row => trackingStats(row, 'profile'))
    .reduce((acc, item) => ({
      total: acc.total + Number(item.total || 0),
      uniqueEstimate: acc.uniqueEstimate + Number(item.uniqueEstimate || 0),
      lastViewedAt: !acc.lastViewedAt || String(item.lastViewedAt || '').localeCompare(String(acc.lastViewedAt)) > 0 ? item.lastViewedAt : acc.lastViewedAt
    }), { total:0, uniqueEstimate:0, lastViewedAt:null });
  return {
    id: publicProfileId,
    displayName: primary.profile.displayName || 'DJ',
    country: primary.profile.country || null,
    belt: primary.belt || primary.progression && primary.progression.beltAfter || 'Unranked',
    rating: rows.reduce((sum, row) => sum + Number(row.ratingMovement || 0), 0),
    rank,
    bio: safeString(primary.profile.bio, 600),
    specialties,
    stats,
    media,
    rankings,
    competitiveHistory: rows.filter(row => opponentCategory(row) !== 'ai_only'),
    aiOnlyHighScores: rows.filter(row => opponentCategory(row) === 'ai_only'),
    verifiedResults: rows,
    views: profileViewStats
  };
}

async function getPublicProfileRelationshipCounts(dataClient, publicProfileId){
  let result;
  try{
    result = await dataClient.from(DJ_FOLLOWS_TABLE).select('*').limit(DISCOVERY_SCAN_LIMIT);
  }catch(err){
    return { counts:null, missing:true };
  }
  if(result.error){
    if(optionalTableMissing(result.error)) return { counts:null, missing:true };
    return { error:result.error };
  }
  const active = (result.data || []).filter(row => row.active !== false && row.status !== 'inactive');
  const followers = active.filter(row => safeString(row.followed_public_profile_id || plainObject(row.followed_profile).publicProfileId, 96) === publicProfileId).length;
  const following = active.filter(row => safeString(row.follower_public_profile_id || plainObject(row.follower_profile).publicProfileId, 96) === publicProfileId).length;
  return { counts:{ followers, following, source:'server' } };
}

async function getPublicProfile(dataClient, publicProfileId){
  const requested = safeString(publicProfileId, 80);
  if(!requested || !/^dj_[a-f0-9]{16}$/.test(requested)) return { notFound:true };
  const query = dataClient.from('mix_submissions').select('*').eq('status', 'completed').limit(DISCOVERY_SCAN_LIMIT);
  const result = await query;
  if(result.error) return { error:result.error };
  const rows = result.data || [];
  const matchingRows = rows.filter(row => stablePublicProfileId(row.user_id) === requested);
  if(!matchingRows.length) return { notFound:true };
  const certified = await filterPublicRowsByRightsCertification(dataClient, matchingRows);
  if(certified.error) return { error:certified.error };
  const publicResults = certified.rows.map(row => sanitizeBattleResult(row, { publicView:true })).filter(row => row && row.visibility === 'public');
  if(!publicResults.length) return { private:true };
  const profile = buildPublicProfileFromResults(requested, publicResults, certified.rows);
  if(!profile) return { unavailable:true };
  const relationships = await getPublicProfileRelationshipCounts(dataClient, requested);
  if(relationships.error) return relationships;
  if(relationships.counts){
    profile.relationshipCounts = relationships.counts;
    profile.followerCount = relationships.counts.followers;
    profile.followingCount = relationships.counts.following;
  }
  return { profile };
}

async function recordVerifiedResultView(dataClient, verifiedId, visitor = {}, now = new Date(), options = {}){
  const requested = safeString(verifiedId, 80);
  if(!requested || !/^vr_[a-f0-9]{20}$/.test(requested)) return { notFound:true };
  const limits = { ...DEFAULT_VIEW_LIMITS, ...plainObject(options.limits) };
  const rateState = options.rateState || VIEW_RATE_STATE;
  const query = dataClient.from('mix_submissions').select('*').eq('status', 'completed').limit(DISCOVERY_SCAN_LIMIT);
  const result = await query;
  if(result.error) return { error:result.error };
  const row = (result.data || []).find(submission => verifiedResultId(submission) === requested);
  if(!row) return { notFound:true };
  if(resultVisibility(row) !== 'public') return { private:true };
  const rightsGate = await ensurePublicRightsCertification(dataClient, row, now);
  if(rightsGate.error) return { error:rightsGate.error };
  if(!rightsGate.allowed) return { private:true };
  const sanitized = sanitizeBattleResult(row, { publicView:true });
  if(!sanitized) return { unavailable:true };
  const fingerprint = visitorFingerprint(visitor, 'result', requested);
  const rate = checkViewRateLimit('result', requested, fingerprint, now, limits, rateState);
  if(rate.rateLimited) return { ...safeViewResponse(trackingSource(row, 'result'), false, true), retryAfterMs:rate.retryAfterMs };
  const normalized = normalizeTrackingRecord(trackingSource(row, 'result'), fingerprint, now, limits);
  if(normalized.duplicate) return { ...safeViewResponse(normalized.tracking, true, false), result:sanitized };
  const updated = await dataClient
    .from('mix_submissions')
    .update({ processing_info: mergeViewTracking(row, 'result', normalized.tracking) })
    .eq('id', row.id)
    .select('*')
    .single();
  if(updated.error) return { error:updated.error };
  return { ...safeViewResponse(normalized.tracking, false, false), result:sanitizeBattleResult(updated.data, { publicView:true }) };
}

async function recordPublicProfileView(dataClient, publicProfileId, visitor = {}, now = new Date(), options = {}){
  const requested = safeString(publicProfileId, 80);
  if(!requested || !/^dj_[a-f0-9]{16}$/.test(requested)) return { notFound:true };
  const limits = { ...DEFAULT_VIEW_LIMITS, ...plainObject(options.limits) };
  const rateState = options.rateState || VIEW_RATE_STATE;
  const query = dataClient.from('mix_submissions').select('*').eq('status', 'completed').limit(DISCOVERY_SCAN_LIMIT);
  const result = await query;
  if(result.error) return { error:result.error };
  const matchingRows = (result.data || []).filter(row => stablePublicProfileId(row.user_id) === requested);
  if(!matchingRows.length) return { notFound:true };
  const certified = await filterPublicRowsByRightsCertification(dataClient, matchingRows, now);
  if(certified.error) return { error:certified.error };
  const publicRows = certified.rows.filter(row => sanitizeBattleResult(row, { publicView:true }));
  if(!publicRows.length) return { private:true };
  publicRows.sort((a,b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
  const row = publicRows[0];
  const fingerprint = visitorFingerprint(visitor, 'profile', requested);
  const rate = checkViewRateLimit('profile', requested, fingerprint, now, limits, rateState);
  if(rate.rateLimited) return { ...safeViewResponse(trackingSource(row, 'profile'), false, true), retryAfterMs:rate.retryAfterMs };
  const normalized = normalizeTrackingRecord(trackingSource(row, 'profile'), fingerprint, now, limits);
  if(normalized.duplicate) return { ...safeViewResponse(normalized.tracking, true, false) };
  const updated = await dataClient
    .from('mix_submissions')
    .update({ processing_info: mergeViewTracking(row, 'profile', normalized.tracking) })
    .eq('id', row.id)
    .select('*')
    .single();
  if(updated.error) return { error:updated.error };
  return { ...safeViewResponse(normalized.tracking, false, false), profileId:requested };
}

async function listPublicBattleResults(dataClient, options = {}){
  const filters = normalizeDiscoveryOptions(options);
  const query = dataClient.from('mix_submissions').select('*').eq('status', 'completed').limit(DISCOVERY_SCAN_LIMIT);
  const result = await query;
  if(result.error) return { error: result.error };
  const certified = await filterPublicRowsByRightsCertification(dataClient, result.data || []);
  if(certified.error) return { error:certified.error };
  const allPublic = dedupePublicResults((certified.rows || [])
    .map(row => sanitizeBattleResult(row, { publicView: true }))
    .filter(row => row && row.visibility === 'public'));
  const filtered = allPublic.filter(row => matchesDiscoveryFilters(row, filters));
  const sorted = sortDiscoveryResults(filtered, filters.sort);
  const start = (filters.page - 1) * filters.limit;
  const pageRows = sorted.slice(start, start + filters.limit);
  const realViewCounts = sorted.some(row => Number(row.viewCount || 0) > 0);
  return {
    results: pageRows,
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total: sorted.length,
      hasMore: start + filters.limit < sorted.length,
      nextPage: start + filters.limit < sorted.length ? filters.page + 1 : null
    },
    filters,
    rankings: buildPublicRankings(filtered, { category:filters.category, country:filters.country }),
    sortUnsupported: filters.sort === 'most_viewed' && !realViewCounts
  };
}

module.exports = {
  RESULT_VISIBILITIES,
  RANKING_CATEGORIES,
  buildPublicRankings,
  buildPublicProfileFromResults,
  getOwnedBattleResult,
  getPublicBattleResult,
  getPublicProfile,
  listPublicBattleResults,
  listOwnedBattleResults,
  recordPublicProfileView,
  recordVerifiedResultView,
  resultRankingCategories,
  sanitizeBattleResult,
  sanitizeSummaryInput,
  saveOwnedBattleResultSummary,
  setOwnedBattleResultVisibility,
  sourceLabels,
  stablePublicProfileId,
  stableVerifiedResultId
};
