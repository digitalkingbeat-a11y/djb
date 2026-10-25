/*
 Express API for authenticated DJ Battle score submissions and aggregated AI
 leaderboards using Supabase as the backing store.

 BEFORE USING: set SUPABASE_URL and SUPABASE_KEY environment variables.
 Create a table `ai_scores` with columns:
  - id (uuid, default gen_random_uuid())
  - user_id (text)
  - dj (text)
  - battle_type (text)
  - genre (text)
  - score (int)
  - created_at (timestamp with time zone, default now())
*/

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { buildCorsOptions, securityHeaders } = require('./security');
const { createClient } = require('@supabase/supabase-js');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildJudgeBreakdownPayload } = require('./analysis_storage');
const { createFrontendRouter, shouldServeFrontend } = require('./static_frontend');
const { getFFmpegCapability, publicFFmpegCapabilityStatus } = require('./ffmpeg_capability');
const { requireAuthenticatedUser, requireConfiguredDataClient, requireOwnedUserId, requireOwnedUserIds, requireOperatorUser, getOwnedBeltAttempt, getOwnedBeltTest } = require('./auth');
const BeltPromotion = require('./belt_promotion');
const ProfileAvatar = require('./profile_avatar');
const { createAvatarDirectory, avatarResponseMiddleware } = require('./avatar_directory');
const { attachFreeOffers, listSellerStoreListings, prepareFreeDownloadFile } = require('./marketplace_free_beats');
const { savePracticeSession, listPracticeSessions, renamePracticeSession, deletePracticeSession } = require('./practice_sessions');
const { createEmailSender, createFreeEmailVerificationGateway, freeEmailConfirmationsStatus } = require('./email_sender');
const {
  applyConnectAccountUpdate,
  checkoutReturnUrls,
  createStripeConnectClient,
  listSellerSales,
  refreshSellerAccount,
  salesConfigStatus,
  setListingPrice,
  startSellerOnboarding
} = require('./marketplace_sales');
const { getOrCreateBattleEntry, createDraftSubmission, getOwnedMixSubmission, issueUploadAuthorization, completeUpload, getSubmissionJudgingResult, MIX_BUCKET } = require('./battle_submission');
const { reconcileBattleAwards } = require('./battle_award_ledger');
const {
  checkRankingDetailRateLimit,
  getOwnedRankingDetail,
  getOwnedRankingSummary,
  getPublicRankingDetail,
  listPublicLeaderboards,
  safeRebuildPublicLeaderboards
} = require('./battle_leaderboards');
const {
  buildBattleRoomState,
  cancelOwnedBattle,
  createBattleWithPrepSnapshot,
  findCompatibleLobbyBattle,
  hydrateOwnedBattlePrepSnapshot,
  joinBattleWithPrepSnapshot,
  listPublicBattleLobby,
  recoverOwnedActiveBattles,
  replaceBattlePrepSnapshotTrack,
  resolveBattleIfReady,
  setBattleEntryReady,
  startBattleIfReady,
  touchBattleRoomPresence,
  verifyBattleEntrySubmissionIntegrity,
  withdrawOwnedBattleEntry
} = require('./battle_prep_snapshots');
const {
  acceptDjChallenge,
  cancelDjChallenge,
  countOwnedNotifications,
  createDjBlock,
  createNotificationMute,
  listOwnedBlocks,
  removeOwnedBlock,
  listOwnedMutes,
  removeOwnedMute,
  countOwnedDjChallenges,
  declineDjChallenge,
  getChallengeInteractionEligibility,
  listOwnedDjChallenges,
  listOwnedNotifications,
  markAllOwnedNotificationsRead,
  markOwnedNotificationRead,
  sendDjChallenge
} = require('./dj_challenges');
const {
  followPublicDj,
  getOwnedChallengePreferences,
  getOwnedRelationshipSyncState,
  getRelationshipSummary,
  listOwnedActivityFeed,
  listOwnedOpponentHistory,
  listOwnedRelationships,
  requestRematch,
  unfollowPublicDj,
  updateOwnedChallengePreferences
} = require('./dj_relationships');
const {
  checkCommunitySchemaReadiness,
  createCommunityComment,
  createCommunityPost,
  deleteCommunityComment,
  deleteCommunityPost,
  issueCommunityAttachmentPlaybackAccess,
  listCommunityCategories,
  listCommunityComments,
  listCommunityFeed,
  listCommunityModerationHistory,
  listCommunityReports,
  listPublicProfileCommunityPosts,
  moderateCommunityTarget,
  recordCommunityAttachmentUsage,
  reportCommunityTarget,
  toggleCommunityReaction,
  updateCommunityComment,
  updateCommunityPost
} = require('./community');
const { getOwnedBattleResult, getPublicBattleResult, getPublicProfile, listOwnedBattleResults, listPublicBattleResults, recordPublicProfileView, recordVerifiedResultView, saveOwnedBattleResultSummary, setOwnedBattleResultVisibility } = require('./battle_result_history');
const {
  getPublicBattleShare,
  recordCommunityBattleVote
} = require('./battle_community_voting');
const { getCrowdVoteSummary, recordCrowdVote } = require('./battle_crowd_votes');
const {
  LIBRARY_ARTWORK_BUCKET,
  LIBRARY_TRACK_TABLE,
  sanitizeLibraryTrack,
  checkMusicLibrarySchemaReadiness,
  checkMusicLibraryOrganizationSchemaReadiness,
  createLibraryTrack,
  createLibraryCrate,
  createPracticeRecordingFromSubmission,
  duplicateLibraryCrate,
  getOwnedLibraryTrack,
  listOwnedLibraryCrates,
  listOwnedLibraryTracks,
  updateLibraryTrack,
  updateLibraryCrate,
  archiveLibraryTrack,
  archiveLibraryCrate,
  issueLibraryAudioUploadAuthorization,
  completeLibraryAudioUpload,
  issueLibraryArtworkUploadAuthorization,
  completeLibraryArtworkUpload,
  removeLibraryArtwork,
  issueLibraryPlaybackAccess,
  recordLibraryTrackUsage,
  updateLibraryTrackPrefs,
  setLibraryCrateMemberships
} = require('./music_library');
const {
  checkMarketplaceSchemaReadiness,
  createMarketplaceListing,
  getMarketplaceListing,
  grantMarketplaceEntitlement,
  issueMarketplacePlayerAccess,
  listMarketplaceCatalog,
  listOwnedMarketplaceEntitlements
} = require('./marketplace_foundation');
const {
  checkMarketplaceCommerceSchemaReadiness,
  createMarketplaceCheckout,
  createMarketplacePaymentProviderAdapter,
  handleMarketplacePaymentEvent,
  issueMarketplaceDownloadAccess,
  listMarketplaceSellerAccounts,
  listOwnedMarketplaceOrders,
  upsertMarketplaceSellerAccount,
  verifyStripeSignature
} = require('./marketplace_commerce');
const {
  checkMarketplaceFreeEmailSchemaReadiness,
  claimFreeEmailDownload,
  createFreeEmailOffer,
  createFreeEmailVerificationAdapter,
  issueFreeEmailLeadDownloadAccess,
  listSellerFreeEmailLeads,
  verifyFreeEmailLead
} = require('./marketplace_free_email');
const {
  checkMixRightsCertificationSchemaReadiness,
  certifyMixRights,
  getOwnedMixRightsCertification,
  listOwnedMixRightsCertifications,
  revokeMixRightsCertification
} = require('./mix_rights_certification');
const submissionJudgingWorker = require('./submission_judging_worker');
const { createSubmissionJudgingRunner, validateSubmissionJudgeRunnerConfig } = require('./submission_judging_runner');
const {
  LIMITS,
  authenticateWebSocketRequest,
  persistIngestionBuffer,
  persistJsonPayload,
  validateBridgeUserId,
  validateRequestBodySize,
  validateWebSocketMessage
} = require('./ingestion_safety');
const {
  guardProtectedWrite,
  rejectProtectedWriteError,
  validateBattleEntryPayload,
  validateBattleResultPayload,
  validateBeltAttemptPayload,
  validateBeltCodePayload,
  validateDraftSubmissionPayload,
  validateJudgeBreakdownPayload,
  validateRouteIdentifier,
  validateSubmitScorePayload
} = require('./protected_write_safety');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
if(!SUPABASE_URL || !SUPABASE_KEY){
  console.warn('Supabase credentials not set. Set SUPABASE_URL and SUPABASE_KEY to enable the server.');
}
if(!SUPABASE_SERVICE_KEY){
  console.warn('Supabase service role key not set. The server will reject protected updates to rankings without SUPABASE_SERVICE_KEY.');
}

function createOptionalSupabaseClient(label, url, key){
  if(!url || !key) return null;
  try{
    return createClient(url, key);
  }catch(err){
    console.warn(`${label} Supabase client disabled: ${err.message}`);
    return null;
  }
}

const supabase = createOptionalSupabaseClient('Public', SUPABASE_URL, SUPABASE_KEY);
const supabaseService = createOptionalSupabaseClient('Service', SUPABASE_URL, SUPABASE_SERVICE_KEY);
const requireAuth = requireAuthenticatedUser(supabase);
// Other DJs' photos on public payloads (rankings, posts, comments, follow lists, battle rooms, challenges).
const avatarDirectory = supabaseService ? createAvatarDirectory({
  dataClient:supabaseService,
  authAdmin:supabaseService.auth && supabaseService.auth.admin,
  storage:supabaseService.storage && supabaseService.storage.from(ProfileAvatar.PROFILE_AVATAR_BUCKET)
}) : null;
const AVATAR_ENRICHED_ROUTES = [
  '/api/publicProfiles', '/api/publicLeaderboards', '/api/relationshipLeaderboards', '/api/publicRankings', '/api/myRankings',
  '/api/community/feed', '/api/community/myFeed', '/api/community/publicProfiles', '/api/community/posts',
  '/api/relationships', '/api/activityFeed', '/api/opponentHistory', '/api/challenges', '/api/battles',
  '/api/publicBattles', '/api/publicBattleResults', '/api/blocks', '/api/notificationMutes'
];

function marketplaceProviderAdapter(provider){
  const normalized = String(provider || '').trim().toLowerCase();
  return createMarketplacePaymentProviderAdapter(normalized, {
    secretKey: normalized === 'stripe' ? process.env.STRIPE_SECRET_KEY : '',
    webhookSecret: normalized === 'stripe' ? process.env.STRIPE_WEBHOOK_SECRET : process.env.PAYPAL_WEBHOOK_ID,
    clientId: normalized === 'paypal' ? process.env.PAYPAL_CLIENT_ID : '',
    clientSecret: normalized === 'paypal' ? process.env.PAYPAL_CLIENT_SECRET : '',
    successUrl: checkoutReturnUrls(process.env).successUrl,
    cancelUrl: checkoutReturnUrls(process.env).cancelUrl
  });
}

// Outgoing email (fan confirmation links). EMAIL_PROVIDER=resend|sendgrid with RESEND_API_KEY or
// SENDGRID_API_KEY, EMAIL_FROM and APP_PUBLIC_URL; anything missing = safe no-op that only logs.
const emailSender = createEmailSender({ env:process.env });

function freeEmailVerificationAdapter(){
  return createFreeEmailVerificationAdapter({ gateway:createFreeEmailVerificationGateway(emailSender, { env:process.env }) });
}

function stripeConnectClient(){
  return createStripeConnectClient({ secretKey:process.env.STRIPE_SECRET_KEY });
}

function createConfiguredSubmissionJudgeRunner(){
  const capability = getFFmpegCapability();
  const publicStatus = publicFFmpegCapabilityStatus(capability);
  const configuration = validateSubmissionJudgeRunnerConfig(process.env, {
    supabaseServiceConfigured: Boolean(supabaseService),
    ffmpegCapability: publicStatus
  });
  const config = configuration.settings;
  if(!configuration.ready){
    return createSubmissionJudgingRunner({
      ...config,
      configuredEnabled: configuration.enabledRequested,
      enabled:false,
      disabledReason: configuration.disabledReason,
      configuration
    });
  }
  const storage = supabaseService.storage.from(MIX_BUCKET);
  return createSubmissionJudgingRunner({
    ...config,
    configuredEnabled:true,
    enabled:true,
    configuration,
    runOnce: ({ now, staleMs }) => submissionJudgingWorker.runOnce({ dataClient:supabaseService, storage, now, staleMs }),
    recoverStale: ({ now, staleMs }) => submissionJudgingWorker.recoverStaleJudgingSubmissions(supabaseService, { now, staleMs })
  });
}

const submissionJudgeRunner = createConfiguredSubmissionJudgeRunner();

const app = express();
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(cors(buildCorsOptions()));
app.use((req, res, next) => {
  const contentLength = req.get('content-length');
  if(contentLength){
    const validation = validateRequestBodySize(Number(contentLength), LIMITS);
    if(validation.error) return res.status(413).json({ error: validation.error });
  }
  return next();
});
app.use(bodyParser.json({
  limit: LIMITS.requestBodyBytes,
  verify:(req, res, buffer) => {
    req.rawBody = buffer ? buffer.toString('utf8') : '';
  }
}));
app.use((err, req, res, next) => {
  if(err && (err.type === 'entity.too.large' || err.status === 413)){
    return res.status(413).json({ error: 'Request body exceeds configured limit' });
  }
  return next(err);
});
app.use(AVATAR_ENRICHED_ROUTES, avatarResponseMiddleware(avatarDirectory));

// Oct 20b: hoisted so the existing view routes can feed "Who's watching".
const Crews = require('./crews');
const Tips = require('./tips');
const DiscountCodes = require('./discount_codes');
const ViewInsights = require('./view_insights');
function viewOwnHost(){ try{ return new URL(process.env.APP_PUBLIC_URL || '').hostname; }catch(e){ return ''; } }
function logViewQuietly(req, kind, targetId, ownerUserId){
  if(!supabaseService) return;
  const body = req.body || {};
  ViewInsights.logViewEvent(supabaseService, { kind, targetId, ownerUserId, referrer:typeof body.referrer === 'string' ? body.referrer.slice(0, 500) : '', ownHost:viewOwnHost(), embed:body.embed === true })
    .then(r => { if(r && r.error) console.warn('view insight log failed', r.error && r.error.message); }).catch(() => {});
}
function publicViewVisitor(req){
  return {
    visitorId: req.body && req.body.visitorId || req.get('x-dj-battle-visitor') || null,
    userAgent: req.get('user-agent') || '',
    acceptLanguage: req.get('accept-language') || '',
    ip: req.ip || req.socket && req.socket.remoteAddress || ''
  };
}

const beltsDefPath = path.join(__dirname, '..', 'belts', 'definitions.json');
function loadBeltsDefinitions(){
  try{ const txt = fs.readFileSync(beltsDefPath,'utf8'); return JSON.parse(txt); }catch(e){ console.warn('Failed reading belts definitions', e); return null; }
}

// Generate a randomized belt test based on belt definitions.
function generateRandomBeltTest(beltCode){
  const defs = loadBeltsDefinitions();
  if(!defs) return null;
  const belt = (defs.belts||[]).find(b=>b.code.toLowerCase()===String(beltCode).toLowerCase());
  if(!belt) return null;
  // belt difficulty scales with order (1..N). Higher order => tighter tolerances.
  const maxOrder = Math.max(...defs.belts.map(b=>b.order));
  const difficulty = (belt.order || 1) / (maxOrder || 8);
  const baseTimingMs = Math.round(300 - (difficulty * 240)); // 300ms -> 60ms
  const eventsCount = Math.floor(2 + Math.random()*4); // 2-5 events
  const events = [];
  for(let i=0;i<eventsCount;i++){
    const ev = {
      id: `evt_${Math.random().toString(36).slice(2,9)}`,
      label: `Transition ${i+1}`,
      targetWindowMs: Math.max(40, Math.round(baseTimingMs + (Math.random()*40 - 20))),
      maxDurationMs: 300 + Math.floor(Math.random()*700),
      components: {}
    };
    // assign component tolerances/weights
    defs.components.forEach(c=>{
      // component tolerance influenced by difficulty
      const tol = Math.max(0.01, Math.round((1 - difficulty) * 100) + Math.floor(Math.random()*20));
      ev.components[c.id] = { weight: c.weight, tolerance: tol };
    });
    events.push(ev);
  }
  const criteria = { belt: belt.code, passing_score: belt.minScore, events, components: defs.components, generated_at: new Date().toISOString() };
  return { code: belt.code, name: `${belt.name} Randomized Test`, criteria };
}

// Submit a score
app.post('/api/submitScore', requireAuth, async (req, res) => {
  const { userId: suppliedUserId } = req.body || {};
  const userId = requireOwnedUserId(req, res, suppliedUserId);
  if(!userId) return;
  const validation = validateSubmitScorePayload(req.body);
  if(validation.error) return rejectProtectedWriteError(res, validation);
  const { djName, battleType, genre, score } = validation.value;
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'submitScore', { payload: { userId, djName, battleType, genre, score } })) return;
  try{
    // Use service client to insert safely
    const insert = await supabaseService.from('ai_scores').insert([{ user_id: userId, dj: djName, battle_type: battleType, genre, score: Number(score) }]);
    if(insert.error) throw insert.error;

    // Reuse the ai_leaderboard view to compute aggregates
    const aggQ = await supabaseService.from('ai_leaderboard').select('*').eq('user_id', userId);
    if(aggQ.error) throw aggQ.error;
    const me = aggQ.data && aggQ.data[0] ? aggQ.data[0] : { best: Number(score), average: Number(score), attempts:1, last: Number(score) };

    // compute global rank for this battleType/genre by querying view
    const top = await supabaseService.from('ai_leaderboard').select('*');
    if(top.error) throw top.error;
    const rows = top.data || [];
    rows.sort((a,b)=>b.best - a.best || b.average - a.average);
    const rank = rows.findIndex(x=>String(x.user_id)===String(userId)) + 1;

    // previous best compute
    const prevBestQ = await supabaseService.from('ai_scores').select('score').eq('user_id', userId);
    const prevRows = prevBestQ.data || [];
    const previousBest = Math.max(...prevRows.map(r=>r.score), 0);
    const newPB = me.best > previousBest;
    const newHigh = rank === 1;

    return res.json({ success:true, rank, best: me.best, average: me.average, attempts: me.attempts, last: me.last, newPB, newHigh });
  }catch(err){
    console.error('submitScore error', err);
    return res.status(500).json({ error: 'Score submission failed' });
  }
});

// Submit a completed battle (DJ-vs-DJ). This endpoint is intended to be called by a
// trusted server process that receives verified battle submissions (including AI + community scores).
// Body: { battleId, battleType, genre, results: [ { userId, dj, aiScore, communityScore } ], winnerUserId }
app.post('/api/submitBattleResult', requireAuth, async (req, res) => {
  const validation = validateBattleResultPayload(req.body);
  if(validation.error) return rejectProtectedWriteError(res, validation);
  const { results, winnerUserId } = validation.value;
  const suppliedUserIds = results.map(result => result && result.userId);
  if(!requireOwnedUserIds(req, res, [winnerUserId, ...suppliedUserIds])) return;
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'submitBattleResult', { payload: { winnerUserId, results } })) return;
  return res.status(403).json({ error: 'Battle result submission requires a server-side adjudicator' });
});

app.post('/api/battleEntries', requireAuth, async (req, res) => {
  const { userId: suppliedUserId } = req.body || {};
  const userId = requireOwnedUserId(req, res, suppliedUserId);
  if(!userId) return;
  const validation = validateBattleEntryPayload(req.body);
  if(validation.error) return rejectProtectedWriteError(res, validation);
  const { battleId } = validation.value;
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'battleEntries', { payload: { userId, battleId }, fingerprintReplay: false })) return;
  try{
    const result = await getOrCreateBattleEntry(supabaseService, userId, battleId);
    if(result.error) throw result.error;
    return res.status(result.created ? 201 : 200).json({ success:true, entry: result.entry });
  }catch(err){ console.error('battleEntries error', err); return res.status(500).json({ error: 'Battle entry request failed' }); }
});

app.get('/api/battles/lobby', async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listPublicBattleLobby(supabaseService, req.query || {});
    if(result.error) throw result.error;
    return res.json({ success:true, battles:result.items, pagination:result.pagination });
  }catch(err){
    console.error('battle lobby listing error', err);
    return res.status(500).json({ error:'Battle lobby listing failed' });
  }
});

app.get('/api/battles/relationshipLobby', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listPublicBattleLobby(supabaseService, { ...(req.query || {}), viewerUserId:req.authUser.id });
    if(result.validationError) return res.status(401).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, battles:result.items, pagination:result.pagination, filters:result.filters });
  }catch(err){
    console.error('relationship battle lobby listing error', err);
    return res.status(500).json({ error:'Relationship lobby listing failed' });
  }
});

app.get('/api/battles/matchmaking', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await findCompatibleLobbyBattle(supabaseService, req.authUser.id, req.query || {});
    if(result.error) throw result.error;
    if(!result.battle) return res.status(404).json({ success:false, error:'No compatible open battle is available' });
    return res.json({ success:true, battle:result.battle, candidates:result.candidates || [] });
  }catch(err){
    console.error('battle matchmaking error', err);
    return res.status(500).json({ error:'Battle matchmaking failed' });
  }
});

app.get('/api/battles/recovery', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await recoverOwnedActiveBattles(supabaseService, req.authUser.id, req.query || {});
    if(result.error) throw result.error;
    return res.json({ success:true, battles:result.items });
  }catch(err){
    console.error('battle recovery error', err);
    return res.status(500).json({ error:'Battle recovery request failed' });
  }
});

app.get('/api/battles/:battleId/room', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.battleId, 'battleId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await buildBattleRoomState(supabaseService, req.authUser.id, validation.value.battleId, req.query || {});
    if(result.forbidden) return res.status(403).json({ error:'Cannot access another DJ\'s Battle Room' });
    if(result.notFound) return res.status(404).json({ error:'Battle Room is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, room:result.state, stale:Boolean(result.stale) });
  }catch(err){
    console.error('battle room state error', err);
    return res.status(500).json({ error:'Battle Room state request failed' });
  }
});

app.post('/api/battles/withPrepSnapshot', requireAuth, async (req, res) => {
  const userId = req.authUser.id;
  const body = { ...(req.body || {}), idempotencyKey:(req.body && req.body.idempotencyKey) || req.get('Idempotency-Key') || null };
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'battleWithPrepSnapshot', {
    payload: { userId, crateId:body.crateId || body.crate_id, modeId:body.modeId || body.mode_id, idempotencyKey:body.idempotencyKey },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const result = await createBattleWithPrepSnapshot(supabaseService, userId, body);
    if(result.forbidden) return res.status(403).json({ error:'Cannot use another DJ\'s Battle Prep crate or tracks' });
    if(result.unavailable) return res.status(404).json({ error:'Battle Prep crate is unavailable' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.conflict) return res.status(409).json({ error:result.reason || 'Battle cannot accept this entry' });
    if(result.error) throw result.error;
    return res.status(result.created ? 201 : 200).json({ success:true, battle:result.battle, entry:result.entry, snapshot:result.snapshot, duplicate:Boolean(result.duplicate) });
  }catch(err){
    console.error('battleWithPrepSnapshot error', err);
    return res.status(500).json({ error:'Battle creation request failed' });
  }
});

app.post('/api/battles/:battleId/join', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.battleId, 'battleId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  const userId = req.authUser.id;
  const body = { ...(req.body || {}), idempotencyKey:(req.body && req.body.idempotencyKey) || req.get('Idempotency-Key') || null };
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'joinBattleWithPrepSnapshot', {
    payload: { userId, battleId:validation.value.battleId, crateId:body.crateId || body.crate_id, idempotencyKey:body.idempotencyKey },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const tournamentGate = await Tournaments.tournamentBattleJoinAllowed(supabaseService, validation.value.battleId, userId);
    if(tournamentGate.error) throw tournamentGate.error;
    if(!tournamentGate.allowed) return res.status(403).json({ error:'Only the two DJs in this tournament match can join it' });
    const result = await joinBattleWithPrepSnapshot(supabaseService, userId, validation.value.battleId, body);
    if(result.forbidden) return res.status(403).json({ error:'Cannot use another DJ\'s Battle Prep crate or tracks' });
    if(result.notFound || result.unavailable) return res.status(404).json({ error:'Battle or Battle Prep crate is unavailable' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.conflict) return res.status(409).json({ error:result.reason || 'Battle is already full' });
    if(result.error) throw result.error;
    return res.status(result.created ? 201 : 200).json({ success:true, battle:result.battle, entry:result.entry, snapshot:result.snapshot, duplicate:Boolean(result.duplicate) });
  }catch(err){
    console.error('joinBattleWithPrepSnapshot error', err);
    return res.status(500).json({ error:'Battle join request failed' });
  }
});

app.post('/api/battles/:battleId/start', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.battleId, 'battleId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  const idempotencyKey = req.body && req.body.idempotencyKey || req.get('Idempotency-Key') || null;
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'startBattleRoom', {
    payload: { userId:req.authUser.id, battleId:validation.value.battleId, idempotencyKey },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const result = await startBattleIfReady(supabaseService, validation.value.battleId, { userId:req.authUser.id });
    if(result.forbidden) return res.status(403).json({ error:'Cannot start another DJ\'s battle' });
    if(result.notFound) return res.status(404).json({ error:'Battle is unavailable' });
    if(result.conflict) return res.status(409).json({ error:result.reason || 'Battle cannot start yet' });
    if(result.error) throw result.error;
    return res.json({ success:true, room:result.state, duplicate:Boolean(result.duplicate), started:Boolean(result.started) });
  }catch(err){
    console.error('battle room start error', err);
    return res.status(500).json({ error:'Battle start request failed' });
  }
});

app.post('/api/battles/:battleId/resolve', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.battleId, 'battleId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  const idempotencyKey = req.body && req.body.idempotencyKey || req.get('Idempotency-Key') || null;
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'resolveBattleRoom', {
    payload: { userId:req.authUser.id, battleId:validation.value.battleId, idempotencyKey },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const room = await buildBattleRoomState(supabaseService, req.authUser.id, validation.value.battleId, { resolve:false });
    if(room.forbidden) return res.status(403).json({ error:'Cannot resolve another DJ\'s battle room' });
    if(room.notFound) return res.status(404).json({ error:'Battle is unavailable' });
    if(room.error) throw room.error;
    const result = await resolveBattleIfReady(supabaseService, validation.value.battleId, { userId:req.authUser.id });
    if(result.forbidden) return res.status(403).json({ error:'Cannot resolve another DJ\'s battle' });
    if(result.notFound) return res.status(404).json({ error:'Battle is unavailable' });
    if(result.conflict) return res.status(409).json({ error:result.reason || 'Battle cannot be resolved yet' });
    if(result.error) throw result.error;
    const refreshed = await buildBattleRoomState(supabaseService, req.authUser.id, validation.value.battleId, { resolve:false });
    if(refreshed.error) throw refreshed.error;
    return res.json({
      success:true,
      resolved:Boolean(result.resolved),
      duplicate:Boolean(result.duplicate),
      room:refreshed.state,
      resolution:refreshed.state && refreshed.state.resolution || result.resolution || null
    });
  }catch(err){
    console.error('battle resolution error', err);
    return res.status(500).json({ error:'Battle resolution request failed' });
  }
});

app.post('/api/battles/:battleId/cancel', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.battleId, 'battleId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  const idempotencyKey = req.body && req.body.idempotencyKey || req.get('Idempotency-Key') || null;
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'cancelBattle', {
    payload: { userId:req.authUser.id, battleId:validation.value.battleId, idempotencyKey },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const result = await cancelOwnedBattle(supabaseService, req.authUser.id, validation.value.battleId);
    if(result.forbidden) return res.status(403).json({ error:'Only the battle creator can cancel this battle' });
    if(result.notFound) return res.status(404).json({ error:'Battle is unavailable' });
    if(result.conflict) return res.status(409).json({ error:result.reason || 'Battle cannot be cancelled' });
    if(result.error) throw result.error;
    return res.json({ success:true, battle:result.battle, duplicate:Boolean(result.duplicate) });
  }catch(err){
    console.error('battle cancel error', err);
    return res.status(500).json({ error:'Battle cancellation failed' });
  }
});

app.post('/api/battleEntries/:entryId/ready', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.entryId, 'entryId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  const ready = req.body && req.body.ready !== false;
  const idempotencyKey = req.body && req.body.idempotencyKey || req.get('Idempotency-Key') || null;
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'battleEntryReady', {
    payload: { userId:req.authUser.id, entryId:validation.value.entryId, ready, idempotencyKey },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const result = await setBattleEntryReady(supabaseService, req.authUser.id, validation.value.entryId, ready);
    if(result.forbidden) return res.status(403).json({ error:'Cannot change another DJ\'s ready state' });
    if(result.notFound) return res.status(404).json({ error:'Battle entry is unavailable' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.conflict) return res.status(409).json({ error:result.reason || 'Ready state cannot be changed' });
    if(result.error) throw result.error;
    return res.json({ success:true, room:result.state, entry:result.entry, autoStarted:Boolean(result.autoStarted) });
  }catch(err){
    console.error('battle ready state error', err);
    return res.status(500).json({ error:'Ready state request failed' });
  }
});

app.post('/api/battleEntries/:entryId/presence', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.entryId, 'entryId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'battleEntryPresence', {
    payload: { userId:req.authUser.id, entryId:validation.value.entryId, presence:req.body && (req.body.presence || req.body.presenceStatus) },
    fingerprintReplay:false
  })) return;
  try{
    const result = await touchBattleRoomPresence(supabaseService, req.authUser.id, validation.value.entryId, req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Cannot update another DJ\'s Battle Room presence' });
    if(result.notFound) return res.status(404).json({ error:'Battle entry is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, room:result.state, entry:result.entry });
  }catch(err){
    console.error('battle room presence error', err);
    return res.status(500).json({ error:'Battle Room presence request failed' });
  }
});

app.get('/api/battleEntries/:entryId/prepSnapshot', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.entryId, 'entryId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await hydrateOwnedBattlePrepSnapshot(supabaseService, req.authUser.id, validation.value.entryId);
    if(result.forbidden) return res.status(403).json({ error:'Cannot access another DJ\'s Battle Prep snapshot' });
    if(result.unavailable) return res.status(404).json({ error:'Battle Prep snapshot is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, entry:result.entry, snapshot:result.snapshot });
  }catch(err){
    console.error('battlePrepSnapshot hydrate error', err);
    return res.status(500).json({ error:'Battle Prep snapshot request failed' });
  }
});

app.post('/api/battleEntries/:entryId/withdraw', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.entryId, 'entryId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  const idempotencyKey = req.body && req.body.idempotencyKey || req.get('Idempotency-Key') || null;
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'withdrawBattleEntry', {
    payload: { userId:req.authUser.id, entryId:validation.value.entryId, idempotencyKey },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const result = await withdrawOwnedBattleEntry(supabaseService, req.authUser.id, validation.value.entryId);
    if(result.forbidden) return res.status(403).json({ error:'Cannot withdraw another DJ\'s battle entry' });
    if(result.notFound) return res.status(404).json({ error:'Battle entry is unavailable' });
    if(result.conflict) return res.status(409).json({ error:result.reason || 'Battle entry cannot be withdrawn' });
    if(result.error) throw result.error;
    return res.json({ success:true, entry:result.entry, battle:result.battle, duplicate:Boolean(result.duplicate) });
  }catch(err){
    console.error('battle entry withdrawal error', err);
    return res.status(500).json({ error:'Battle withdrawal failed' });
  }
});

app.post('/api/battlePrepSnapshots/:snapshotId/replacements', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.snapshotId, 'snapshotId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'battlePrepSnapshotReplacement', {
    payload: { userId:req.authUser.id, snapshotId:validation.value.snapshotId, fromTrackId:req.body && req.body.fromTrackId, toTrackId:req.body && req.body.toTrackId },
    fingerprintReplay:false
  })) return;
  try{
    const result = await replaceBattlePrepSnapshotTrack(supabaseService, req.authUser.id, validation.value.snapshotId, req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Cannot replace a track in another DJ\'s Battle Prep snapshot' });
    if(result.forbiddenReplacement) return res.status(409).json({ error:'This battle mode does not permit replacement' });
    if(result.notFound || result.unavailable) return res.status(404).json({ error:'Battle Prep snapshot or replacement track is unavailable' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, snapshot:result.snapshot });
  }catch(err){
    console.error('battlePrepSnapshot replacement error', err);
    return res.status(500).json({ error:'Battle Prep replacement request failed' });
  }
});

app.post('/api/battleEntries/:entryId/submissions', requireAuth, async (req, res) => {
  const { userId: suppliedUserId } = req.body || {};
  const userId = requireOwnedUserId(req, res, suppliedUserId);
  if(!userId) return;
  const entryValidation = validateRouteIdentifier(req.params.entryId, 'entryId');
  if(entryValidation.error) return rejectProtectedWriteError(res, entryValidation);
  const metadata = validateDraftSubmissionPayload(req.body, LIMITS);
  if(metadata.error) return rejectProtectedWriteError(res, metadata);
  const { entryId } = entryValidation.value;
  const { originalFilename, declaredMimeType, fileSize, duration, battleContext, submissionSource } = metadata.value;
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'battleEntrySubmission', { payload: { userId, entryId, originalFilename, declaredMimeType, fileSize, duration, submissionSource }, fingerprintReplay: false })) return;
  try{
    const integrity = await verifyBattleEntrySubmissionIntegrity(supabaseService, userId, entryId, battleContext);
    if(integrity.forbidden) return res.status(403).json({ error: 'Cannot create a submission for this battle entry' });
    if(integrity.notFound) return res.status(404).json({ error: 'Battle entry is unavailable' });
    if(integrity.conflict) return res.status(409).json({ error: integrity.reason || 'Battle is no longer accepting submissions' });
    if(integrity.validationError) return res.status(422).json({ error: integrity.validationError });
    if(integrity.error) throw integrity.error;
    const result = await createDraftSubmission(supabaseService, userId, entryId, { originalFilename, declaredMimeType, fileSize, duration, battleContext, submissionSource });
    if(result.forbidden) return res.status(403).json({ error: 'Cannot create a submission for this battle entry' });
    if(result.conflict) return res.status(409).json({ error: 'A final submission already exists for this battle entry' });
    if(result.validationError) return res.status(400).json({ error: 'Invalid request payload' });
    if(result.error) throw result.error;
    return res.status(result.created ? 201 : 200).json({ success:true, submission: result.submission });
  }catch(err){ console.error('battle submission error', err); return res.status(500).json({ error: 'Submission request failed' }); }
});

app.get('/api/mixSubmissions/:submissionId', requireAuth, async (req, res) => {
  try{
    const result = await getOwnedMixSubmission(supabaseService, req.authUser.id, req.params.submissionId);
    if(result.forbidden) return res.status(403).json({ error: 'Cannot access another user\'s submission' });
    if(result.error) throw result.error;
    return res.json({ success:true, submission: result.submission });
  }catch(err){ return res.status(500).json({ error: String(err) }); }
});

app.get('/api/mixSubmissions/:submissionId/judgingResult', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.submissionId, 'submissionId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  const { submissionId } = validation.value;
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await getSubmissionJudgingResult(supabaseService, req.authUser.id, submissionId);
    if(result.forbidden) return res.status(403).json({ error: 'Cannot access another user\'s judging result' });
    if(result.invalidState) return res.status(409).json({ error: 'Submission is not ready for judging results' });
    if(result.error) throw result.error;
    return res.json({
      success: true,
      status: result.status,
      completed: Boolean(result.completed),
      duplicate: Boolean(result.duplicate),
      submission: result.submission,
      judgeResult: result.judgeResult || null
    });
  }catch(err){
    console.error('judgingResult error', err);
    return res.status(500).json({ error: 'Judging result request failed' });
  }
});

app.get('/api/musicLibrary/tracks', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listOwnedLibraryTracks(supabaseService, req.authUser.id, { limit:req.query.limit, page:req.query.page });
    if(result.error) throw result.error;
    return res.json({ success:true, tracks:result.tracks, pagination:result.pagination });
  }catch(err){
    console.error('musicLibrary list error', err);
    return res.status(500).json({ error:'Music library request failed' });
  }
});

app.get('/api/musicLibrary/schemaStatus', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await checkMusicLibrarySchemaReadiness(supabaseService);
    return res.status(result.ready ? 200 : 503).json({ success:result.ready, ...result });
  }catch(err){
    console.error('musicLibrary schema status error', err);
    return res.status(500).json({ success:false, ready:false, schema:'012_create_music_library_tracks', status:'failed', message:'Music Library schema readiness check failed.' });
  }
});

app.get('/api/musicLibrary/organizationStatus', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await checkMusicLibraryOrganizationSchemaReadiness(supabaseService);
    return res.status(result.ready ? 200 : 503).json({ success:result.ready, ...result });
  }catch(err){
    console.error('musicLibrary organization status error', err);
    return res.status(500).json({ success:false, ready:false, schema:'013_create_music_library_crates', status:'failed', message:'Music Library organization readiness check failed.' });
  }
});

app.get('/api/musicLibrary/crates', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listOwnedLibraryCrates(supabaseService, req.authUser.id);
    if(result.error) throw result.error;
    return res.json({ success:true, crates:result.crates });
  }catch(err){
    console.error('musicLibrary crates list error', err);
    return res.status(500).json({ error:'Music library crate request failed' });
  }
});

app.post('/api/musicLibrary/crates', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'musicLibraryCrate', { payload: { userId:req.authUser.id, name:req.body && req.body.name, type:req.body && req.body.type }, fingerprintReplay:false })) return;
  try{
    const result = await createLibraryCrate(supabaseService, req.authUser.id, req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Cannot add another user\'s track to this crate' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.status(201).json({ success:true, crate:result.crate });
  }catch(err){
    console.error('musicLibrary crate create error', err);
    return res.status(500).json({ error:'Music library crate creation failed' });
  }
});

app.patch('/api/musicLibrary/crates/:crateId', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.crateId, 'crateId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'musicLibraryCrateUpdate', { payload: { userId:req.authUser.id, crateId:validation.value.crateId, body:req.body || {} }, fingerprintReplay:false })) return;
  try{
    const result = await updateLibraryCrate(supabaseService, req.authUser.id, validation.value.crateId, req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Cannot update another user\'s crate' });
    if(result.unavailable) return res.status(404).json({ error:'Music library crate is unavailable' });
    if(result.conflict) return res.status(409).json({ error:'Crate order changed on another device' });
    if(result.error) throw result.error;
    return res.json({ success:true, crate:result.crate });
  }catch(err){
    console.error('musicLibrary crate update error', err);
    return res.status(500).json({ error:'Music library crate update failed' });
  }
});

app.post('/api/musicLibrary/crates/:crateId/duplicate', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.crateId, 'crateId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await duplicateLibraryCrate(supabaseService, req.authUser.id, validation.value.crateId, req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Cannot duplicate another user\'s crate' });
    if(result.unavailable) return res.status(404).json({ error:'Music library crate is unavailable' });
    if(result.error) throw result.error;
    return res.status(201).json({ success:true, crate:result.crate });
  }catch(err){
    console.error('musicLibrary crate duplicate error', err);
    return res.status(500).json({ error:'Music library crate duplication failed' });
  }
});

app.delete('/api/musicLibrary/crates/:crateId', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.crateId, 'crateId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await archiveLibraryCrate(supabaseService, req.authUser.id, validation.value.crateId);
    if(result.forbidden) return res.status(403).json({ error:'Cannot delete another user\'s crate' });
    if(result.unavailable) return res.status(404).json({ error:'Music library crate is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, crate:result.crate });
  }catch(err){
    console.error('musicLibrary crate delete error', err);
    return res.status(500).json({ error:'Music library crate deletion failed' });
  }
});

app.put('/api/musicLibrary/crates/:crateId/tracks', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.crateId, 'crateId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'musicLibraryCrateMemberships', { payload: { userId:req.authUser.id, crateId:validation.value.crateId, trackIds:req.body && req.body.trackIds }, fingerprintReplay:false })) return;
  try{
    const result = await setLibraryCrateMemberships(supabaseService, req.authUser.id, validation.value.crateId, req.body && req.body.trackIds || [], { allowDuplicates:req.body && req.body.allowDuplicates });
    if(result.forbidden) return res.status(403).json({ error:'Cannot add unauthorized tracks to this crate' });
    if(result.unavailable) return res.status(404).json({ error:'Music library crate is unavailable' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, crate:result.crate });
  }catch(err){
    console.error('musicLibrary crate membership error', err);
    return res.status(500).json({ error:'Music library crate ordering failed' });
  }
});

// Practice log on the account (SQL 030). Saving is idempotent on the browser's session id.
app.get('/api/practiceSessions', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listPracticeSessions(supabaseService, req.authUser.id, { limit:req.query && req.query.limit, before:req.query && req.query.before });
    if(result.forbidden) return res.status(403).json({ error:'Practice log is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, sessions:result.sessions, pagination:result.pagination });
  }catch(err){
    console.error('practice sessions list error', err);
    return res.status(500).json({ error:'Practice log request failed' });
  }
});

app.post('/api/practiceSessions', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'practiceSessionSave', { payload:{ userId:req.authUser.id, clientSessionId:req.body && (req.body.clientSessionId || req.body.id) }, fingerprintReplay:false, idempotencyReplay:false })) return;
  try{
    const result = await savePracticeSession(supabaseService, req.authUser.id, req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Cannot save another DJ\'s practice session' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.status(result.created ? 201 : 200).json({ success:true, duplicate:Boolean(result.duplicate), session:result.session });
  }catch(err){
    console.error('practice session save error', err);
    return res.status(500).json({ error:'Practice session save failed' });
  }
});

app.patch('/api/practiceSessions/:sessionId', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'practiceSessionRename', { payload:{ userId:req.authUser.id, sessionId:req.params.sessionId }, fingerprintReplay:false, idempotencyReplay:false })) return;
  try{
    const result = await renamePracticeSession(supabaseService, req.authUser.id, req.params.sessionId, req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Cannot rename another DJ\'s practice session' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.notFound) return res.status(404).json({ error:'Practice session not found' });
    if(result.error) throw result.error;
    return res.json({ success:true, session:result.session });
  }catch(err){
    console.error('practice session rename error', err);
    return res.status(500).json({ error:'Practice session rename failed' });
  }
});

app.delete('/api/practiceSessions/:sessionId', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'practiceSessionDelete', { payload:{ userId:req.authUser.id, sessionId:req.params.sessionId }, fingerprintReplay:false, idempotencyReplay:false })) return;
  try{
    const result = await deletePracticeSession(supabaseService, req.authUser.id, req.params.sessionId);
    if(result.forbidden) return res.status(403).json({ error:'Cannot delete another DJ\'s practice session' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.notFound) return res.status(404).json({ error:'Practice session not found' });
    if(result.error) throw result.error;
    return res.json({ success:true, deleted:true, id:result.id });
  }catch(err){
    console.error('practice session delete error', err);
    return res.status(500).json({ error:'Practice session delete failed' });
  }
});

// Practice recordings already saved to the library (for replays on the Practice page).
app.get('/api/musicLibrary/practiceRecordings', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const limit = Math.max(1, Math.min(100, Number(req.query && req.query.limit) || 100));
    const result = await supabaseService.from(LIBRARY_TRACK_TABLE).select('*').eq('user_id', req.authUser.id).eq('source_type', 'practice_recording').limit(limit);
    if(result.error) throw result.error;
    const tracks = (result.data || []).filter(row => String(row.user_id) === String(req.authUser.id) && !row.archived_at).map(row => sanitizeLibraryTrack(row));
    return res.json({ success:true, tracks });
  }catch(err){
    console.error('practice recordings list error', err);
    return res.status(500).json({ error:'Practice recordings request failed' });
  }
});

app.post('/api/musicLibrary/practiceRecordings', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'musicLibraryPracticeRecording', { payload: { userId:req.authUser.id, sourceSubmissionId:req.body && (req.body.sourceSubmissionId || req.body.linkedSubmissionId) }, fingerprintReplay:false })) return;
  try{
    const result = await createPracticeRecordingFromSubmission(supabaseService, req.authUser.id, req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Cannot reuse another user\'s practice recording' });
    if(result.invalidState) return res.status(409).json({ error:'Practice source audio is not ready for library use' });
    if(result.duplicate) return res.status(409).json({ error:'This practice recording is already in your library', track:result.track });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.status(201).json({ success:true, track:result.track });
  }catch(err){
    console.error('musicLibrary practice recording error', err);
    return res.status(500).json({ error:'Practice recording library sync failed' });
  }
});

app.post('/api/musicLibrary/tracks', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'musicLibraryTrack', { payload: { userId:req.authUser.id, title:req.body && req.body.title, sourceSubmissionId:req.body && req.body.sourceSubmissionId }, fingerprintReplay:false })) return;
  try{
    const result = await createLibraryTrack(supabaseService, req.authUser.id, req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Cannot use another user\'s library source' });
    if(result.invalidState) return res.status(409).json({ error:'Source audio is not ready for library use' });
    if(result.duplicate) return res.status(409).json({ error:'This audio is already in your library', track:result.track });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.status(201).json({ success:true, track:result.track });
  }catch(err){
    console.error('musicLibrary create error', err);
    return res.status(500).json({ error:'Music library track creation failed' });
  }
});

app.get('/api/musicLibrary/tracks/:trackId', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.trackId, 'trackId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await getOwnedLibraryTrack(supabaseService, req.authUser.id, validation.value.trackId);
    if(result.forbidden) return res.status(403).json({ error:'Cannot access another user\'s library track' });
    if(result.unavailable) return res.status(404).json({ error:'Library track is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, track:result.sanitized });
  }catch(err){
    console.error('musicLibrary get error', err);
    return res.status(500).json({ error:'Music library track request failed' });
  }
});

app.patch('/api/musicLibrary/tracks/:trackId', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.trackId, 'trackId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'musicLibraryTrackUpdate', { payload: { userId:req.authUser.id, trackId:validation.value.trackId, body:req.body || {} }, fingerprintReplay:false })) return;
  try{
    const result = await updateLibraryTrack(supabaseService, req.authUser.id, validation.value.trackId, req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Cannot update another user\'s library track' });
    if(result.unavailable) return res.status(404).json({ error:'Library track is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, track:result.track });
  }catch(err){
    console.error('musicLibrary update error', err);
    return res.status(500).json({ error:'Music library track update failed' });
  }
});

app.delete('/api/musicLibrary/tracks/:trackId', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.trackId, 'trackId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await archiveLibraryTrack(supabaseService, req.authUser.id, validation.value.trackId);
    if(result.forbidden) return res.status(403).json({ error:'Cannot archive another user\'s library track' });
    if(result.unavailable) return res.status(404).json({ error:'Library track is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, track:result.track });
  }catch(err){
    console.error('musicLibrary archive error', err);
    return res.status(500).json({ error:'Music library track archive failed' });
  }
});

app.post('/api/musicLibrary/tracks/:trackId/audioUploadAuthorization', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.trackId, 'trackId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await issueLibraryAudioUploadAuthorization(supabaseService, supabaseService.storage.from(MIX_BUCKET), req.authUser.id, validation.value.trackId);
    if(result.forbidden) return res.status(403).json({ error:'Cannot upload to another user\'s library track' });
    if(result.invalidState) return res.status(409).json({ error:'This library track reuses an existing submission and cannot upload duplicate audio' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, bucket:result.bucket, uploadPath:result.uploadPath, uploadToken:result.uploadToken, expiresAt:result.expiresAt });
  }catch(err){
    console.error('musicLibrary audio upload auth error', err);
    return res.status(500).json({ error:'Music library audio upload authorization failed' });
  }
});

app.post('/api/musicLibrary/tracks/:trackId/completeAudioUpload', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.trackId, 'trackId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await completeLibraryAudioUpload(supabaseService, supabaseService.storage.from(MIX_BUCKET), req.authUser.id, validation.value.trackId);
    if(result.forbidden) return res.status(403).json({ error:'Cannot complete audio upload for another user\'s library track' });
    if(result.invalidState) return res.status(409).json({ error:'Library audio upload is not ready to complete' });
    if(result.verificationFailed) return res.status(422).json({ error:'Uploaded audio did not match authorization' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, track:result.track });
  }catch(err){
    console.error('musicLibrary audio complete error', err);
    return res.status(500).json({ error:'Music library audio verification failed' });
  }
});

app.post('/api/musicLibrary/tracks/:trackId/artworkUploadAuthorization', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.trackId, 'trackId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await issueLibraryArtworkUploadAuthorization(supabaseService, supabaseService.storage.from(LIBRARY_ARTWORK_BUCKET), req.authUser.id, validation.value.trackId, req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Cannot upload artwork for another user\'s library track' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, bucket:result.bucket, uploadPath:result.uploadPath, uploadToken:result.uploadToken, expiresAt:result.expiresAt, track:result.track });
  }catch(err){
    console.error('musicLibrary artwork upload auth error', err);
    return res.status(500).json({ error:'Music library artwork upload authorization failed' });
  }
});

// Profile photo: modeled on the library artwork upload. The photo goes to the public "profile-avatars"
// bucket (see sql/029) and its URL is saved on the user's Supabase metadata as avatar_url.
app.post('/api/profile/avatarUploadAuthorization', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await ProfileAvatar.issueAvatarUploadAuthorization(supabaseService.storage.from(ProfileAvatar.PROFILE_AVATAR_BUCKET), req.authUser.id, req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Cannot upload a photo for another user' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, bucket:result.bucket, uploadPath:result.uploadPath, uploadToken:result.uploadToken, expiresAt:result.expiresAt, maxBytes:result.maxBytes });
  }catch(err){
    console.error('profile avatar upload auth error', err);
    return res.status(500).json({ error:'Profile photo upload authorization failed' });
  }
});

app.post('/api/profile/completeAvatarUpload', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await ProfileAvatar.completeAvatarUpload(supabaseService.storage.from(ProfileAvatar.PROFILE_AVATAR_BUCKET), supabaseService.auth && supabaseService.auth.admin, req.authUser.id, req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Cannot complete a photo upload for another user' });
    if(result.verificationFailed) return res.status(422).json({ error:'Uploaded photo did not match the allowed type or size' });
    if(result.error) throw result.error;
    if(avatarDirectory) avatarDirectory.remember(req.authUser.id, result.avatarUrl);
    return res.json({ success:true, avatarUrl:result.avatarUrl });
  }catch(err){
    console.error('profile avatar complete error', err);
    return res.status(500).json({ error:'Profile photo save failed' });
  }
});

app.delete('/api/profile/avatar', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await ProfileAvatar.removeAvatar(supabaseService.storage.from(ProfileAvatar.PROFILE_AVATAR_BUCKET), supabaseService.auth && supabaseService.auth.admin, req.authUser.id);
    if(result.forbidden) return res.status(403).json({ error:'Cannot remove another user\'s photo' });
    if(result.error) throw result.error;
    if(avatarDirectory) avatarDirectory.remember(req.authUser.id, null);
    return res.json({ success:true });
  }catch(err){
    console.error('profile avatar remove error', err);
    return res.status(500).json({ error:'Profile photo removal failed' });
  }
});

app.post('/api/musicLibrary/tracks/:trackId/completeArtworkUpload', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.trackId, 'trackId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await completeLibraryArtworkUpload(supabaseService, supabaseService.storage.from(LIBRARY_ARTWORK_BUCKET), req.authUser.id, validation.value.trackId);
    if(result.forbidden) return res.status(403).json({ error:'Cannot complete artwork for another user\'s library track' });
    if(result.invalidState) return res.status(409).json({ error:'Artwork upload is not ready to complete' });
    if(result.verificationFailed) return res.status(422).json({ error:'Uploaded artwork did not match authorization' });
    if(result.error) throw result.error;
    return res.json({ success:true, track:result.track });
  }catch(err){
    console.error('musicLibrary artwork complete error', err);
    return res.status(500).json({ error:'Music library artwork verification failed' });
  }
});

app.delete('/api/musicLibrary/tracks/:trackId/artwork', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.trackId, 'trackId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await removeLibraryArtwork(supabaseService, supabaseService.storage.from(LIBRARY_ARTWORK_BUCKET), req.authUser.id, validation.value.trackId);
    if(result.forbidden) return res.status(403).json({ error:'Cannot remove artwork from another user\'s library track' });
    if(result.unavailable) return res.status(404).json({ error:'Library track is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, track:result.track });
  }catch(err){
    console.error('musicLibrary artwork remove error', err);
    return res.status(500).json({ error:'Music library artwork removal failed' });
  }
});

app.post('/api/musicLibrary/tracks/:trackId/playbackAccess', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.trackId, 'trackId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await issueLibraryPlaybackAccess(supabaseService, supabaseService.storage.from(MIX_BUCKET), req.authUser.id, validation.value.trackId);
    if(result.forbidden) return res.status(403).json({ error:'Cannot play another user\'s private library track' });
    if(result.unavailable) return res.status(404).json({ error:'Library audio is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, track:result.track });
  }catch(err){
    console.error('musicLibrary playback error', err);
    return res.status(500).json({ error:'Music library playback access failed' });
  }
});

// Oct 25 Studio: private favourite / note / play count for one of your own library tracks.
app.post('/api/musicLibrary/tracks/:trackId/prefs', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.trackId, 'trackId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await updateLibraryTrackPrefs(supabaseService, req.authUser.id, validation.value.trackId, req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Cannot change another user\'s library track' });
    if(result.unavailable) return res.status(404).json({ error:'Library track is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, prefs:result.prefs });
  }catch(err){
    console.error('musicLibrary prefs error', err);
    return res.status(500).json({ error:'Music library prefs update failed' });
  }
});

app.post('/api/musicLibrary/tracks/:trackId/usage', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.trackId, 'trackId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await recordLibraryTrackUsage(supabaseService, req.authUser.id, validation.value.trackId, req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Cannot record usage on another user\'s library track' });
    if(result.unavailable) return res.status(404).json({ error:'Library track is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, track:result.track });
  }catch(err){
    console.error('musicLibrary usage error', err);
    return res.status(500).json({ error:'Music library usage update failed' });
  }
});

app.get('/api/marketplace/catalog', async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listMarketplaceCatalog(supabaseService, {
      limit:req.query && req.query.limit,
      page:req.query && req.query.page,
      productType:req.query && req.query.productType,
      genre:req.query && req.query.genre
    });
    if(result.error) throw result.error;
    await attachFreeOffers(supabaseService, result.listings);
    return res.json({ success:true, listings:result.listings, pagination:result.pagination });
  }catch(err){
    console.error('marketplace catalog error', err);
    return res.status(500).json({ error:'Marketplace catalog request failed' });
  }
});

app.get('/api/marketplace/catalog/:listingId', async (req, res) => {
  const validation = validateRouteIdentifier(req.params.listingId, 'listingId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await getMarketplaceListing(supabaseService, validation.value.listingId);
    if(result.unavailable) return res.status(404).json({ error:'Marketplace listing is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, listing:result.listing });
  }catch(err){
    console.error('marketplace listing error', err);
    return res.status(500).json({ error:'Marketplace listing request failed' });
  }
});

app.get('/api/marketplace/schemaStatus', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await checkMarketplaceSchemaReadiness(supabaseService);
    return res.status(result.ready ? 200 : 503).json({ success:result.ready, ...result });
  }catch(err){
    console.error('marketplace schema status error', err);
    return res.status(500).json({ success:false, ready:false, schema:'022_create_marketplace_player_foundation', status:'failed', message:'Marketplace foundation schema readiness check failed.' });
  }
});

app.post('/api/marketplace/listings', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'marketplaceListing', { payload: { userId:req.authUser.id, libraryTrackId:req.body && (req.body.libraryTrackId || req.body.library_track_id), status:req.body && req.body.status }, fingerprintReplay:false })) return;
  try{
    const result = await createMarketplaceListing(supabaseService, req.authUser.id, req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Cannot list another user\'s library track' });
    if(result.unavailable) return res.status(404).json({ error:'Library source is unavailable' });
    if(result.duplicate) return res.status(409).json({ error:'This library track already has a marketplace listing', listing:result.listing, product:result.product });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.status(201).json({ success:true, listing:result.listing, product:result.product, rights:result.rights });
  }catch(err){
    console.error('marketplace listing create error', err);
    return res.status(500).json({ error:'Marketplace listing creation failed' });
  }
});

app.get('/api/marketplace/entitlements', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listOwnedMarketplaceEntitlements(supabaseService, req.authUser.id);
    if(result.error) throw result.error;
    return res.json({ success:true, entitlements:result.entitlements });
  }catch(err){
    console.error('marketplace entitlement list error', err);
    return res.status(500).json({ error:'Marketplace entitlement request failed' });
  }
});

app.post('/api/marketplace/entitlements/grants', requireAuth, requireOperatorUser, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'marketplaceEntitlementGrant', { payload: { operatorUserId:req.authUser.id, productId:req.body && req.body.productId, userId:req.body && req.body.userId }, fingerprintReplay:false })) return;
  try{
    const result = await grantMarketplaceEntitlement(supabaseService, req.authUser.id, req.body || {});
    if(result.unavailable) return res.status(404).json({ error:'Marketplace product is unavailable' });
    if(result.duplicate) return res.status(409).json({ error:'User already has an active entitlement for this product', entitlement:result.entitlement });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.status(201).json({ success:true, entitlement:result.entitlement });
  }catch(err){
    console.error('marketplace entitlement grant error', err);
    return res.status(500).json({ error:'Marketplace entitlement grant failed' });
  }
});

app.post('/api/marketplace/player/access', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'marketplacePlayerAccess', { payload: { userId:req.authUser.id, listingId:req.body && req.body.listingId, productId:req.body && req.body.productId, preview:req.body && req.body.preview }, fingerprintReplay:false })) return;
  try{
    const result = await issueMarketplacePlayerAccess(supabaseService, supabaseService.storage.from(MIX_BUCKET), req.authUser.id, req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Marketplace player access is not available for this user' });
    if(result.unavailable) return res.status(404).json({ error:'Marketplace audio is unavailable' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, playerAccess:result.playerAccess, product:result.product, listing:result.listing });
  }catch(err){
    console.error('marketplace player access error', err);
    return res.status(500).json({ error:'Marketplace player access failed' });
  }
});

app.get('/api/marketplace/freeEmail/schemaStatus', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await checkMarketplaceFreeEmailSchemaReadiness(supabaseService);
    return res.status(result.ready ? 200 : 503).json({ success:result.ready, ...result });
  }catch(err){
    console.error('marketplace free email schema status error', err);
    return res.status(500).json({ success:false, ready:false, schema:'024_create_marketplace_free_email_leads', status:'failed', message:'Marketplace free-email schema readiness check failed.' });
  }
});

app.post('/api/marketplace/freeEmail/offers', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'marketplaceFreeEmailOffer', { payload: { sellerUserId:req.authUser.id, listingId:req.body && req.body.listingId, enabled:req.body && req.body.enabled }, fingerprintReplay:false })) return;
  try{
    const result = await createFreeEmailOffer(supabaseService, req.authUser.id, req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Cannot configure a free-email offer for another seller\'s listing' });
    if(result.unavailable) return res.status(404).json({ error:'Marketplace listing is unavailable for free-email offers' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.status(result.created ? 201 : 200).json({ success:true, offer:result.offer });
  }catch(err){
    console.error('marketplace free email offer error', err);
    return res.status(500).json({ error:'Marketplace free-email offer update failed' });
  }
});

app.post('/api/marketplace/freeEmail/claims', async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'marketplaceFreeEmailClaim', { payload: { listingId:req.body && req.body.listingId, email:req.body && req.body.email, source:req.body && req.body.source }, fingerprintReplay:false })) return;
  try{
    const result = await claimFreeEmailDownload(supabaseService, freeEmailVerificationAdapter(), null, req.body || {}, new Date(), { exposeDownloadAccessToken:true });
    if(result.rateLimited) return res.status(429).json({ error:'Too many free download claim attempts' });
    if(result.unavailable) return res.status(404).json({ error:'Free-email offer is unavailable' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.status(result.duplicate ? 200 : 201).json({ success:true, duplicate:Boolean(result.duplicate), verificationRequired:Boolean(result.verificationRequired), deliveryConfigured:result.deliveryConfigured, deliveryStatus:result.deliveryStatus || null, lead:result.lead, entitlement:result.entitlement || null, offer:result.offer || null, downloadAccessToken:result.downloadAccessToken || null });
  }catch(err){
    console.error('marketplace free email claim error', err);
    return res.status(500).json({ error:'Marketplace free-email claim failed' });
  }
});

app.post('/api/marketplace/freeEmail/claims/authenticated', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'marketplaceFreeEmailClaimAuthenticated', { payload: { userId:req.authUser.id, listingId:req.body && req.body.listingId, email:req.body && req.body.email, source:req.body && req.body.source }, fingerprintReplay:false })) return;
  try{
    const result = await claimFreeEmailDownload(supabaseService, freeEmailVerificationAdapter(), req.authUser.id, req.body || {}, new Date(), { exposeDownloadAccessToken:true });
    if(result.rateLimited) return res.status(429).json({ error:'Too many free download claim attempts' });
    if(result.unavailable) return res.status(404).json({ error:'Free-email offer is unavailable' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.status(result.duplicate ? 200 : 201).json({ success:true, duplicate:Boolean(result.duplicate), verificationRequired:Boolean(result.verificationRequired), deliveryConfigured:result.deliveryConfigured, deliveryStatus:result.deliveryStatus || null, lead:result.lead, entitlement:result.entitlement || null, offer:result.offer || null, downloadAccessToken:result.downloadAccessToken || null });
  }catch(err){
    console.error('marketplace free email authenticated claim error', err);
    return res.status(500).json({ error:'Marketplace free-email claim failed' });
  }
});

app.post('/api/marketplace/freeEmail/verify', async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'marketplaceFreeEmailVerify', { payload: { leadId:req.body && req.body.leadId }, fingerprintReplay:false })) return;
  try{
    const result = await verifyFreeEmailLead(supabaseService, req.body || {}, new Date(), { exposeDownloadAccessToken:true });
    if(result.forbidden) return res.status(403).json({ error:'Free-email verification is invalid' });
    if(result.unavailable) return res.status(404).json({ error:'Free-email lead is unavailable' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, duplicate:Boolean(result.duplicate), verified:Boolean(result.verified), lead:result.lead, entitlement:result.entitlement || null, offer:result.offer || null, downloadAccessToken:result.downloadAccessToken || null });
  }catch(err){
    console.error('marketplace free email verify error', err);
    return res.status(500).json({ error:'Marketplace free-email verification failed' });
  }
});

app.post('/api/marketplace/freeEmail/downloads/access', async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'marketplaceFreeEmailDownloadAccess', { payload: { leadId:req.body && req.body.leadId, fileId:req.body && req.body.fileId }, fingerprintReplay:false })) return;
  try{
    const result = await issueFreeEmailLeadDownloadAccess(supabaseService, supabaseService.storage.from(MIX_BUCKET), req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Free-email download access is not available' });
    if(result.unavailable) return res.status(404).json({ error:'Free-email download is unavailable' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, downloadAccess:result.downloadAccess });
  }catch(err){
    console.error('marketplace free email download access error', err);
    return res.status(500).json({ error:'Marketplace free-email download access failed' });
  }
});

// Free Beat Store: copy the listing's MP3 into the free-download area, then the app posts it to /freeEmail/offers.
app.post('/api/marketplace/listings/:listingId/freeDownloadFile', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.listingId, 'listingId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'marketplaceFreeDownloadFile', { payload:{ userId:req.authUser.id, listingId:validation.value.listingId }, fingerprintReplay:false })) return;
  try{
    const result = await prepareFreeDownloadFile(supabaseService, supabaseService.storage.from(MIX_BUCKET), req.authUser.id, validation.value.listingId);
    if(result.forbidden) return res.status(403).json({ error:'Cannot share another seller\'s listing' });
    if(result.unavailable) return res.status(404).json({ error:'Marketplace listing is unavailable' });
    if(result.validationError) return res.status(422).json({ error:result.validationError, code:result.code || null });
    if(result.error) throw result.error;
    return res.json({ success:true, file:result.file });
  }catch(err){
    console.error('marketplace free download file error', err);
    return res.status(500).json({ error:'Free download file preparation failed' });
  }
});

app.get('/api/marketplace/myListings', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listSellerStoreListings(supabaseService, req.authUser.id);
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, listings:result.listings, totals:result.totals || null, leadsUnavailable:Boolean(result.leadsUnavailable) });
  }catch(err){
    console.error('marketplace my listings error', err);
    return res.status(500).json({ error:'Marketplace listings request failed' });
  }
});

app.get('/api/marketplace/freeEmail/leads', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listSellerFreeEmailLeads(supabaseService, req.authUser.id, req.query || {});
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, leads:result.leads });
  }catch(err){
    console.error('marketplace free email leads error', err);
    return res.status(500).json({ error:'Marketplace free-email lead request failed' });
  }
});

// Public: is paid selling / are confirmation emails switched on? Booleans and setting names only.
app.get('/api/marketplace/storeConfig', async (req, res) => {
  const sales = salesConfigStatus(process.env);
  const email = freeEmailConfirmationsStatus(process.env);
  return res.json({
    success:true,
    paidSales:{ configured:sales.paidSalesConfigured, checkoutConfigured:sales.checkoutConfigured, webhookConfigured:sales.webhookConfigured, connectConfigured:sales.connectConfigured, platformFeePercent:sales.platformFeePercent, missing:sales.missing },
    emailConfirmations:{ configured:email.configured, provider:email.configured ? email.provider : null, missing:email.missing }
  });
});

app.patch('/api/marketplace/listings/:listingId/price', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.listingId, 'listingId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'marketplaceListingPrice', { payload:{ userId:req.authUser.id, listingId:validation.value.listingId, priceCents:req.body && req.body.priceCents }, fingerprintReplay:false })) return;
  try{
    const result = await setListingPrice(supabaseService, req.authUser.id, validation.value.listingId, req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Cannot price another seller\'s listing' });
    if(result.unavailable) return res.status(404).json({ error:'Marketplace listing is unavailable' });
    if(result.validationError) return res.status(422).json({ error:result.validationError, code:result.code || null });
    if(result.error) throw result.error;
    return res.json({ success:true, listing:result.listing, freeOfferStatus:result.freeOfferStatus || null });
  }catch(err){
    console.error('marketplace listing price error', err);
    return res.status(500).json({ error:'Listing price update failed' });
  }
});

// Seller self-onboarding with Stripe Connect (Express). Returns Stripe's hosted onboarding link.
app.post('/api/marketplace/sellerAccounts/onboard', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'marketplaceSellerOnboard', { payload:{ userId:req.authUser.id }, fingerprintReplay:false, idempotencyReplay:false })) return;
  try{
    const result = await startSellerOnboarding(supabaseService, stripeConnectClient(), req.authUser.id, { email:req.authUser.email }, new Date(), process.env);
    if(result.providerUnavailable) return res.status(503).json({ error:'Paid sales aren\'t set up on the server yet', code:'stripe_unconfigured' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, onboardingUrl:result.onboardingUrl, account:result.account });
  }catch(err){
    console.error('marketplace seller onboarding error', err);
    return res.status(500).json({ error:'Stripe onboarding could not start' });
  }
});

app.post('/api/marketplace/sellerAccounts/refresh', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'marketplaceSellerRefresh', { payload:{ userId:req.authUser.id }, fingerprintReplay:false, idempotencyReplay:false })) return;
  try{
    const result = await refreshSellerAccount(supabaseService, stripeConnectClient(), req.authUser.id);
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, account:result.account || null });
  }catch(err){
    console.error('marketplace seller refresh error', err);
    return res.status(500).json({ error:'Seller account status could not be refreshed' });
  }
});

app.get('/api/marketplace/sales', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listSellerSales(supabaseService, req.authUser.id);
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, orders:result.orders, totals:result.totals });
  }catch(err){
    console.error('marketplace seller sales error', err);
    return res.status(500).json({ error:'Sales request failed' });
  }
});

app.get('/api/marketplace/commerce/schemaStatus', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await checkMarketplaceCommerceSchemaReadiness(supabaseService);
    return res.status(result.ready ? 200 : 503).json({ success:result.ready, ...result });
  }catch(err){
    console.error('marketplace commerce schema status error', err);
    return res.status(500).json({ success:false, ready:false, schema:'023_create_marketplace_commerce_settlement', status:'failed', message:'Marketplace commerce schema readiness check failed.' });
  }
});

app.get('/api/marketplace/sellerAccounts/status', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listMarketplaceSellerAccounts(supabaseService, req.authUser.id);
    if(result.error) throw result.error;
    return res.json({ success:true, accounts:result.accounts });
  }catch(err){
    console.error('marketplace seller account status error', err);
    return res.status(500).json({ error:'Marketplace seller account status request failed' });
  }
});

app.post('/api/marketplace/sellerAccounts', requireAuth, requireOperatorUser, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  const sellerUserId = req.body && req.body.sellerUserId || req.body && req.body.seller_user_id;
  if(!guardProtectedWrite(req, res, 'marketplaceSellerAccount', { payload: { operatorUserId:req.authUser.id, sellerUserId, provider:req.body && req.body.provider }, fingerprintReplay:false })) return;
  try{
    const result = await upsertMarketplaceSellerAccount(supabaseService, sellerUserId, req.body || {});
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.status(result.created ? 201 : 200).json({ success:true, account:result.account });
  }catch(err){
    console.error('marketplace seller account update error', err);
    return res.status(500).json({ error:'Marketplace seller account update failed' });
  }
});

app.post('/api/marketplace/checkout', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'marketplaceCheckout', { payload: { userId:req.authUser.id, listingId:req.body && req.body.listingId, provider:req.body && req.body.provider, licenseType:req.body && req.body.licenseType, idempotencyKey:req.body && req.body.idempotencyKey }, fingerprintReplay:false })) return;
  try{
    const provider = marketplaceProviderAdapter(req.body && req.body.provider);
    const result = await createMarketplaceCheckout(supabaseService, provider, req.authUser.id, req.body || {});
    if(result.providerUnavailable) return res.status(503).json({ error:'Marketplace payment provider is not configured for checkout' });
    if(result.sellerUnavailable) return res.status(409).json({ error:'Seller is not eligible to receive marketplace sales through this provider' });
    if(result.unavailable) return res.status(404).json({ error:'Marketplace listing is unavailable for checkout' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.duplicate) return res.status(409).json({ error:'Checkout already exists for this idempotency key', order:result.order, checkout:result.checkout });
    if(result.error) throw result.error;
    return res.status(201).json({ success:true, order:result.order, item:result.item, checkout:result.checkout, sellerAccount:result.sellerAccount, discount:result.discount || null });
  }catch(err){
    console.error('marketplace checkout error', err);
    return res.status(500).json({ error:'Marketplace checkout failed' });
  }
});

app.get('/api/marketplace/orders', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listOwnedMarketplaceOrders(supabaseService, req.authUser.id);
    if(result.error) throw result.error;
    return res.json({ success:true, orders:result.orders });
  }catch(err){
    console.error('marketplace orders error', err);
    return res.status(500).json({ error:'Marketplace order request failed' });
  }
});

app.post('/api/marketplace/downloads/access', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'marketplaceDownloadAccess', { payload: { userId:req.authUser.id, entitlementId:req.body && req.body.entitlementId, orderId:req.body && req.body.orderId, productId:req.body && req.body.productId, fileId:req.body && req.body.fileId }, fingerprintReplay:false })) return;
  try{
    const result = await issueMarketplaceDownloadAccess(supabaseService, supabaseService.storage.from(MIX_BUCKET), req.authUser.id, req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Marketplace download access is not available for this user' });
    if(result.unavailable) return res.status(404).json({ error:'Marketplace download is unavailable' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, downloadAccess:result.downloadAccess });
  }catch(err){
    console.error('marketplace download access error', err);
    return res.status(500).json({ error:'Marketplace download access failed' });
  }
});

app.post('/api/marketplace/webhooks/:provider', async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const provider = marketplaceProviderAdapter(req.params.provider);
    // Oct 20b: tips ride the same Stripe webhook; they carry metadata.kind = "tip".
    if(req.params.provider === 'stripe' && Tips.isTipEvent(req.body)){
      const check = Tips.verifyTipWebhook(req.rawBody || '', req.get('stripe-signature') || '');
      if(check.unconfigured) return res.status(503).json({ error:'Marketplace payment provider webhook verification is not configured' });
      if(!check.trusted) return res.status(400).json({ error:'Marketplace payment event verification failed' });
      const tip = await Tips.handleTipEvent(supabaseService, req.body);
      if(tip.error) throw tip.error;
      return res.json({ success:true, tip:{ updated:Boolean(tip.updated), status:tip.status || null, duplicate:Boolean(tip.duplicate), unknown:Boolean(tip.unknownTip) } });
    }
    // Stripe Connect "account.updated": keep the seller's charges/payouts status current.
    if(req.params.provider === 'stripe' && req.body && req.body.type === 'account.updated'){
      const signature = req.get('stripe-signature') || '';
      const secrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(Boolean);
      if(!secrets.length) return res.status(503).json({ error:'Marketplace payment provider webhook verification is not configured' });
      if(!secrets.some(secret => verifyStripeSignature(req.rawBody || '', signature, secret))) return res.status(400).json({ error:'Marketplace payment event verification failed' });
      const update = await applyConnectAccountUpdate(supabaseService, req.body);
      if(update.validationError) return res.status(422).json({ error:update.validationError });
      if(update.error) throw update.error;
      return res.json({ success:true, sellerAccountUpdated:Boolean(update.updated), unknownAccount:Boolean(update.unknownAccount) });
    }
    const result = await handleMarketplacePaymentEvent(supabaseService, provider, req.body || {}, new Date(), {
      rawBody:req.rawBody || '',
      signature:req.get('stripe-signature') || req.get('paypal-transmission-sig') || '',
      headers:req.headers || {}
    });
    if(result.providerUnavailable) return res.status(503).json({ error:'Marketplace payment provider webhook verification is not configured' });
    if(result.verificationFailed) return res.status(400).json({ error:'Marketplace payment event verification failed' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, duplicate:Boolean(result.duplicate), unknownOrder:Boolean(result.unknownOrder), event:result.event, order:result.order || null, entitlement:result.entitlement || null });
  }catch(err){
    console.error('marketplace webhook error', err);
    return res.status(500).json({ error:'Marketplace payment event handling failed' });
  }
});

app.get('/api/submissionJudge/status', requireAuth, requireOperatorUser, async (req, res) => {
  return res.json({ success:true, runner: submissionJudgeRunner.status() });
});

app.post('/api/battleAwards/reconcile', requireAuth, requireOperatorUser, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  const idempotencyKey = req.body && req.body.idempotencyKey || req.get('Idempotency-Key') || null;
  if(!guardProtectedWrite(req, res, 'battleAwardsReconcile', {
    payload:{ userId:req.authUser.id, limit:req.body && req.body.limit, idempotencyKey },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const result = await reconcileBattleAwards(supabaseService, { limit:req.body && req.body.limit });
    if(result.error) throw result.error;
    return res.json({ success:true, reconciliation:result });
  }catch(err){
    console.error('battle award reconciliation error', err);
    return res.status(500).json({ error:'Battle award reconciliation failed' });
  }
});

app.post('/api/publicLeaderboards/rebuild', requireAuth, requireOperatorUser, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  const idempotencyKey = req.body && req.body.idempotencyKey || req.get('Idempotency-Key') || null;
  if(!guardProtectedWrite(req, res, 'publicLeaderboardsRebuild', {
    payload:{ userId:req.authUser.id, category:req.body && req.body.category, idempotencyKey },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const result = await safeRebuildPublicLeaderboards(supabaseService, req.body || {});
    if(result.error) throw result.error;
    return res.json({ success:true, rebuild:result });
  }catch(err){
    console.error('public leaderboard rebuild error', err);
    return res.status(500).json({ error:'Public leaderboard rebuild failed' });
  }
});

app.get('/api/battleResults', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listOwnedBattleResults(supabaseService, req.authUser.id, { limit:req.query.limit });
    if(result.error) throw result.error;
    return res.json({ success:true, results:result.results });
  }catch(err){
    console.error('battleResults list error', err);
    return res.status(500).json({ error:'Battle results request failed' });
  }
});

app.get('/api/battleResults/:submissionId', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.submissionId, 'submissionId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await getOwnedBattleResult(supabaseService, req.authUser.id, validation.value.submissionId);
    if(result.forbidden) return res.status(403).json({ error:'Cannot access another user\'s battle result' });
    if(result.unavailable) return res.status(404).json({ error:'Battle result is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, result:result.result });
  }catch(err){
    console.error('battleResult get error', err);
    return res.status(500).json({ error:'Battle result request failed' });
  }
});

app.post('/api/battleResults/:submissionId', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.submissionId, 'submissionId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await saveOwnedBattleResultSummary(supabaseService, req.authUser.id, validation.value.submissionId, req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Cannot update another user\'s battle result' });
    if(result.unavailable) return res.status(404).json({ error:'Battle result is unavailable' });
    if(result.rightsCertificationBlocked) return res.status(403).json({ error:'Battle result cannot be public because mix rights certification is blocked', certification:result.certification });
    if(result.rightsCertificationRequired) return res.status(409).json({ error:'Mix rights certification is required before this battle result can be public', reviewRequired:Boolean(result.reviewRequired), certification:result.certification || null });
    if(result.error) throw result.error;
    return res.json({ success:true, result:result.result });
  }catch(err){
    console.error('battleResult save error', err);
    return res.status(500).json({ error:'Battle result save failed' });
  }
});

app.patch('/api/battleResults/:submissionId/visibility', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.submissionId, 'submissionId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await setOwnedBattleResultVisibility(supabaseService, req.authUser.id, validation.value.submissionId, req.body && req.body.visibility);
    if(result.forbidden) return res.status(403).json({ error:'Cannot update another user\'s battle result' });
    if(result.unavailable) return res.status(404).json({ error:'Battle result is unavailable' });
    if(result.rightsCertificationBlocked) return res.status(403).json({ error:'Battle result cannot be public because mix rights certification is blocked', certification:result.certification });
    if(result.rightsCertificationRequired) return res.status(409).json({ error:'Mix rights certification is required before this battle result can be public', reviewRequired:Boolean(result.reviewRequired), certification:result.certification || null });
    if(result.error) throw result.error;
    return res.json({ success:true, result:result.result });
  }catch(err){
    console.error('battleResult visibility error', err);
    return res.status(500).json({ error:'Battle result visibility update failed' });
  }
});

app.get('/api/mixRights/schemaStatus', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await checkMixRightsCertificationSchemaReadiness(supabaseService);
    return res.status(result.ready ? 200 : 503).json({ success:result.ready, ...result });
  }catch(err){
    console.error('mixRights schema status error', err);
    return res.status(500).json({ success:false, ready:false, schema:'025_create_mix_rights_certifications', status:'failed', message:'Mix rights certification schema readiness check failed.' });
  }
});

app.get('/api/mixRights/certifications', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listOwnedMixRightsCertifications(supabaseService, req.authUser.id, req.query || {});
    if(result.error) throw result.error;
    return res.json({ success:true, certifications:result.certifications });
  }catch(err){
    console.error('mixRights certification list error', err);
    return res.status(500).json({ error:'Mix rights certification request failed' });
  }
});

app.get('/api/mixRights/certifications/:submissionId', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.submissionId, 'submissionId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await getOwnedMixRightsCertification(supabaseService, req.authUser.id, validation.value.submissionId);
    if(result.forbidden) return res.status(403).json({ error:'Cannot access another user\'s mix rights certification' });
    if(result.unavailable) return res.status(404).json({ error:'Mix rights certification is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, certification:result.certification });
  }catch(err){
    console.error('mixRights certification get error', err);
    return res.status(500).json({ error:'Mix rights certification request failed' });
  }
});

app.post('/api/mixRights/certifications/:submissionId', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.submissionId, 'submissionId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'mixRightsCertification', { payload: { userId:req.authUser.id, submissionId:validation.value.submissionId, attestationVersion:req.body && (req.body.attestationVersion || req.body.attestation_version) }, fingerprintReplay:false })) return;
  try{
    const result = await certifyMixRights(supabaseService, req.authUser.id, validation.value.submissionId, req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Cannot certify another user\'s mix rights' });
    if(result.unavailable) return res.status(404).json({ error:'Completed mix submission is unavailable for certification' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.status(result.created ? 201 : 200).json({ success:true, certification:result.certification });
  }catch(err){
    console.error('mixRights certification save error', err);
    return res.status(500).json({ error:'Mix rights certification failed' });
  }
});

app.post('/api/mixRights/certifications/:submissionId/revoke', requireAuth, requireOperatorUser, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.submissionId, 'submissionId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'mixRightsCertificationRevoke', { payload: { operatorUserId:req.authUser.id, submissionId:validation.value.submissionId, reason:req.body && req.body.reason }, fingerprintReplay:false })) return;
  try{
    const result = await revokeMixRightsCertification(supabaseService, req.authUser.id, validation.value.submissionId, req.body || {});
    if(result.unavailable) return res.status(404).json({ error:'Mix rights certification is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, certification:result.certification });
  }catch(err){
    console.error('mixRights certification revoke error', err);
    return res.status(500).json({ error:'Mix rights certification revoke failed' });
  }
});

app.get('/api/publicBattles/:battleId', async (req, res) => {
  const validation = validateRouteIdentifier(req.params.battleId, 'battleId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await getPublicBattleShare(supabaseService, validation.value.battleId, { viewer:req.query || {} });
    if(result.notFound || result.private) return res.status(404).json({ error:'Public battle not found' });
    if(result.error) throw result.error;
    return res.json({ success:true, battle:result.battle, votesMissing:Boolean(result.votesMissing) });
  }catch(err){
    console.error('publicBattle share error', err);
    return res.status(500).json({ error:'Public battle request failed' });
  }
});

app.post('/api/publicBattles/:battleId/votes', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.battleId, 'battleId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await recordCommunityBattleVote(
      supabaseService,
      req.authUser.id,
      validation.value.battleId,
      req.body || {},
      publicViewVisitor(req)
    );
    if(result.notFound || result.private) return res.status(404).json({ error:'Public battle not found' });
    if(result.forbidden) return res.status(403).json({ error:result.reason || 'Community vote is not permitted' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.votingUnavailable || result.votingClosed) return res.status(409).json({ error:result.reason || 'Community voting is unavailable', status:result.status });
    if(result.rateLimited) return res.status(429).json({ error:'Community vote rate limit exceeded', retryAfterMs:result.retryAfterMs, limiter:result.limiter });
    if(result.error) throw result.error;
    return res.json({ success:true, duplicate:Boolean(result.duplicate), updated:Boolean(result.updated), vote:result.vote, battle:result.battle });
  }catch(err){
    console.error('publicBattle vote error', err);
    return res.status(500).json({ error:'Public battle vote request failed' });
  }
});

app.get('/api/battles/:battleId/crowdVotes', async (req, res) => {
  const validation = validateRouteIdentifier(req.params.battleId, 'battleId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await getCrowdVoteSummary(supabaseService, validation.value.battleId, null);
    if(result.notFound) return res.status(404).json({ error:'Battle not found' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, finished:Boolean(result.finished), schemaMissing:Boolean(result.schemaMissing), summary:result.summary });
  }catch(err){
    console.error('crowd vote summary error', err);
    return res.status(500).json({ error:'Crowd vote summary request failed' });
  }
});

app.post('/api/battles/:battleId/crowdVotes', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.battleId, 'battleId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await recordCrowdVote(supabaseService, req.authUser.id, validation.value.battleId, req.body || {});
    if(result.notFound) return res.status(404).json({ error:'Battle not found' });
    if(result.forbidden) return res.status(403).json({ error:result.reason || 'Crowd vote is not permitted' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.votingClosed) return res.status(409).json({ error:result.reason });
    if(result.schemaMissing) return res.status(503).json({ error:'Crowd voting table is not installed (apply sql/028_create_battle_crowd_votes.sql)' });
    if(result.error) throw result.error;
    return res.json({ success:true, duplicate:Boolean(result.duplicate), summary:result.summary });
  }catch(err){
    console.error('crowd vote error', err);
    return res.status(500).json({ error:'Crowd vote request failed' });
  }
});

app.get('/api/publicBattleResults', async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listPublicBattleResults(supabaseService, req.query || {});
    if(result.error) throw result.error;
    const leaderboardResult = await listPublicLeaderboards(supabaseService, req.query || {});
    if(leaderboardResult.error) throw leaderboardResult.error;
    return res.json({
      success:true,
      results:result.results,
      pagination:result.pagination,
      rankings:leaderboardResult,
      sortUnsupported:Boolean(result.sortUnsupported)
    });
  }catch(err){
    console.error('publicBattleResults list error', err);
    return res.status(500).json({ error:'Public battle results request failed' });
  }
});

app.get('/api/publicLeaderboards', async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listPublicLeaderboards(supabaseService, req.query || {});
    if(result.error) throw result.error;
    return res.json({
      success:true,
      leaderboard:result,
      rows:result.rows,
      categories:result.categories,
      pagination:result.pagination,
      calculationVersion:result.calculationVersion,
      source:result.source
    });
  }catch(err){
    console.error('publicLeaderboards error', err);
    return res.status(500).json({ error:'Public leaderboards request failed' });
  }
});

app.get('/api/relationshipLeaderboards', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listPublicLeaderboards(supabaseService, { ...(req.query || {}), viewerUserId:req.authUser.id });
    if(result.validationError) return res.status(401).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({
      success:true,
      leaderboard:result,
      rows:result.rows,
      categories:result.categories,
      pagination:result.pagination,
      calculationVersion:result.calculationVersion,
      source:result.source
    });
  }catch(err){
    console.error('relationshipLeaderboards error', err);
    return res.status(500).json({ error:'Relationship leaderboard request failed' });
  }
});

app.get('/api/publicRankings', async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listPublicLeaderboards(supabaseService, { ...req.query, page:req.query.page || 1, limit:req.query.limit || 50 });
    if(result.error) throw result.error;
    return res.json({
      success:true,
      rankings:result,
      rows:result.rows,
      categories:result.categories,
      pagination:result.pagination,
      calculationVersion:result.calculationVersion,
      source:result.source
    });
  }catch(err){
    console.error('publicRankings error', err);
    return res.status(500).json({ error:'Public rankings request failed' });
  }
});

app.get('/api/publicRankings/:publicProfileId/history', async (req, res) => {
  const validation = validateRouteIdentifier(req.params.publicProfileId, 'publicProfileId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  const visitor = publicViewVisitor(req);
  const rate = checkRankingDetailRateLimit(
    'public_ranking_detail',
    `${validation.value.publicProfileId}:${req.query && req.query.category || 'competitive_battles'}`,
    JSON.stringify(visitor)
  );
  if(rate.rateLimited) return res.status(429).json({ error:'Too many ranking detail requests', retryAfterMs:rate.retryAfterMs });
  try{
    const result = await getPublicRankingDetail(supabaseService, validation.value.publicProfileId, req.query || {});
    if(result.invalidCategory) return res.status(400).json({ error:'Unknown ranking category' });
    if(result.private) return res.status(403).json({ error:'Public DJ ranking history is private' });
    if(result.notFound || result.unavailable) return res.status(404).json({ error:'Public DJ ranking history is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, detail:result.detail });
  }catch(err){
    console.error('publicRankingDetail error', err);
    return res.status(500).json({ error:'Public ranking history request failed' });
  }
});

app.get('/api/myRankings', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await getOwnedRankingSummary(supabaseService, req.authUser.id, req.query || {});
    if(result.error) throw result.error;
    return res.json({
      success:true,
      rankings:result.rankings,
      calculationVersion:result.calculationVersion,
      source:result.source
    });
  }catch(err){
    console.error('myRankings error', err);
    return res.status(500).json({ error:'Personal rankings request failed' });
  }
});

app.get('/api/myRankings/history', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  const rate = checkRankingDetailRateLimit(
    'owned_ranking_detail',
    `${req.authUser.id}:${req.query && req.query.category || 'competitive_battles'}`,
    req.authUser.id
  );
  if(rate.rateLimited) return res.status(429).json({ error:'Too many ranking detail requests', retryAfterMs:rate.retryAfterMs });
  try{
    const result = await getOwnedRankingDetail(supabaseService, req.authUser.id, req.query || {});
    if(result.invalidCategory) return res.status(400).json({ error:'Unknown ranking category' });
    if(result.error) throw result.error;
    return res.json({ success:true, detail:result.detail });
  }catch(err){
    console.error('myRankingDetail error', err);
    return res.status(500).json({ error:'Personal ranking history request failed' });
  }
});

app.get('/api/publicProfiles/:publicProfileId', async (req, res) => {
  const validation = validateRouteIdentifier(req.params.publicProfileId, 'publicProfileId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await getPublicProfile(supabaseService, validation.value.publicProfileId);
    if(result.private) return res.status(403).json({ error:'Public DJ profile is private' });
    if(result.notFound || result.unavailable) return res.status(404).json({ error:'Public DJ profile is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, profile:result.profile });
  }catch(err){
    console.error('publicProfile error', err);
    return res.status(500).json({ error:'Public DJ profile request failed' });
  }
});

app.post('/api/publicProfiles/:publicProfileId/views', async (req, res) => {
  const validation = validateRouteIdentifier(req.params.publicProfileId, 'publicProfileId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await recordPublicProfileView(supabaseService, validation.value.publicProfileId, publicViewVisitor(req));
    if(result.private) return res.status(403).json({ error:'Public DJ profile is private' });
    if(result.notFound || result.unavailable) return res.status(404).json({ error:'Public DJ profile is unavailable' });
    if(result.rateLimited) return res.status(429).json({ success:false, rateLimited:true, retryAfterMs:result.retryAfterMs, views:result.views });
    if(result.error) throw result.error;
    if(!result.duplicate && result.ownerUserId) logViewQuietly(req, 'profile', validation.value.publicProfileId, result.ownerUserId);
    return res.json({ success:true, duplicate:Boolean(result.duplicate), views:result.views });
  }catch(err){
    console.error('publicProfile view error', err);
    return res.status(500).json({ error:'Public DJ profile view tracking failed' });
  }
});

app.get('/api/community/schemaStatus', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await checkCommunitySchemaReadiness(supabaseService);
    return res.status(result.ready ? 200 : 503).json({ success:result.ready, ...result });
  }catch(err){
    console.error('community schema status error', err);
    return res.status(500).json({ success:false, ready:false, schema:'020_create_community_forum', status:'failed', message:'Community schema readiness check failed.' });
  }
});

app.get('/api/community/categories', async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listCommunityCategories(supabaseService);
    if(result.error) throw result.error;
    return res.json({ success:true, categories:result.categories, configurationRequired:Boolean(result.configurationRequired) });
  }catch(err){
    console.error('community categories error', err);
    return res.status(500).json({ error:'Community categories request failed' });
  }
});

app.get('/api/community/feed', async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listCommunityFeed(supabaseService, null, req.query || {});
    if(result.validationError) return res.status(401).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, posts:result.posts, categories:result.categories, feed:result.feed, pagination:result.pagination, generatedAt:result.generatedAt, source:result.source });
  }catch(err){
    console.error('community feed error', err);
    return res.status(500).json({ error:'Community feed request failed' });
  }
});

app.get('/api/community/myFeed', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listCommunityFeed(supabaseService, req.authUser.id, req.query || {});
    if(result.validationError) return res.status(401).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, posts:result.posts, categories:result.categories, feed:result.feed, pagination:result.pagination, generatedAt:result.generatedAt, source:result.source });
  }catch(err){
    console.error('community authenticated feed error', err);
    return res.status(500).json({ error:'Community feed request failed' });
  }
});

app.get('/api/community/publicProfiles/:publicProfileId/posts', async (req, res) => {
  const validation = validateRouteIdentifier(req.params.publicProfileId, 'publicProfileId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listPublicProfileCommunityPosts(supabaseService, validation.value.publicProfileId, req.query || {});
    if(result.notFound || result.private) return res.status(404).json({ error:'Public DJ community posts are unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, posts:result.posts, pagination:result.pagination });
  }catch(err){
    console.error('public profile community posts error', err);
    return res.status(500).json({ error:'Public DJ community posts request failed' });
  }
});

app.post('/api/community/posts', requireAuth, async (req, res) => {
  const body = { ...(req.body || {}), idempotencyKey:(req.body && req.body.idempotencyKey) || req.get('Idempotency-Key') || null };
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'communityPost', {
    payload:{ userId:req.authUser.id, categoryId:body.categoryId || body.category_id, title:body.title, idempotencyKey:body.idempotencyKey },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const result = await createCommunityPost(supabaseService, req.authUser.id, body);
    if(result.forbidden) return res.status(403).json({ error:'Cannot attach another DJ\'s media to a community post' });
    if(result.unavailable) return res.status(404).json({ error:'Community attachment is unavailable' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.status(result.created ? 201 : 200).json({ success:true, post:result.post, duplicate:Boolean(result.duplicate) });
  }catch(err){
    console.error('community post create error', err);
    return res.status(500).json({ error:'Community post creation failed' });
  }
});

app.patch('/api/community/posts/:postId', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.postId, 'postId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'communityPostUpdate', {
    payload:{ userId:req.authUser.id, postId:validation.value.postId, body:req.body || {} },
    fingerprintReplay:false
  })) return;
  try{
    const result = await updateCommunityPost(supabaseService, req.authUser.id, validation.value.postId, req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Cannot edit another DJ\'s community post' });
    if(result.notFound || result.unavailable) return res.status(404).json({ error:'Community post is unavailable' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, post:result.post });
  }catch(err){
    console.error('community post update error', err);
    return res.status(500).json({ error:'Community post update failed' });
  }
});

app.delete('/api/community/posts/:postId', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.postId, 'postId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await deleteCommunityPost(supabaseService, req.authUser.id, validation.value.postId);
    if(result.forbidden) return res.status(403).json({ error:'Cannot delete another DJ\'s community post' });
    if(result.notFound) return res.status(404).json({ error:'Community post is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, post:result.post, deleted:Boolean(result.deleted) });
  }catch(err){
    console.error('community post delete error', err);
    return res.status(500).json({ error:'Community post deletion failed' });
  }
});

app.get('/api/community/posts/:postId/comments', async (req, res) => {
  const validation = validateRouteIdentifier(req.params.postId, 'postId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listCommunityComments(supabaseService, null, validation.value.postId, req.query || {});
    if(result.forbidden) return res.status(403).json({ error:'Community comments are private' });
    if(result.notFound || result.unavailable) return res.status(404).json({ error:'Community post is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, comments:result.comments, pagination:result.pagination, generatedAt:result.generatedAt });
  }catch(err){
    console.error('community comments error', err);
    return res.status(500).json({ error:'Community comments request failed' });
  }
});

app.get('/api/community/posts/:postId/myComments', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.postId, 'postId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listCommunityComments(supabaseService, req.authUser.id, validation.value.postId, req.query || {});
    if(result.forbidden) return res.status(403).json({ error:'Community comments are private' });
    if(result.notFound || result.unavailable) return res.status(404).json({ error:'Community post is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, comments:result.comments, pagination:result.pagination, generatedAt:result.generatedAt });
  }catch(err){
    console.error('community authenticated comments error', err);
    return res.status(500).json({ error:'Community comments request failed' });
  }
});

app.post('/api/community/comments', requireAuth, async (req, res) => {
  const body = { ...(req.body || {}), idempotencyKey:(req.body && req.body.idempotencyKey) || req.get('Idempotency-Key') || null };
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'communityComment', {
    payload:{ userId:req.authUser.id, postId:body.postId || body.post_id, parentCommentId:body.parentCommentId || body.parent_comment_id, idempotencyKey:body.idempotencyKey },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const result = await createCommunityComment(supabaseService, req.authUser.id, body);
    if(result.forbidden) return res.status(403).json({ error:'Cannot comment on this community post' });
    if(result.notFound || result.unavailable) return res.status(404).json({ error:'Community post or parent comment is unavailable' });
    if(result.conflict) return res.status(409).json({ error:result.reason || 'Community comments are unavailable' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.status(result.created ? 201 : 200).json({ success:true, comment:result.comment, duplicate:Boolean(result.duplicate) });
  }catch(err){
    console.error('community comment create error', err);
    return res.status(500).json({ error:'Community comment creation failed' });
  }
});

app.patch('/api/community/comments/:commentId', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.commentId, 'commentId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'communityCommentUpdate', {
    payload:{ userId:req.authUser.id, commentId:validation.value.commentId, body:req.body || {} },
    fingerprintReplay:false
  })) return;
  try{
    const result = await updateCommunityComment(supabaseService, req.authUser.id, validation.value.commentId, req.body || {});
    if(result.forbidden) return res.status(403).json({ error:'Cannot edit another DJ\'s community comment' });
    if(result.notFound || result.unavailable) return res.status(404).json({ error:'Community comment is unavailable' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, comment:result.comment });
  }catch(err){
    console.error('community comment update error', err);
    return res.status(500).json({ error:'Community comment update failed' });
  }
});

app.delete('/api/community/comments/:commentId', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.commentId, 'commentId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await deleteCommunityComment(supabaseService, req.authUser.id, validation.value.commentId);
    if(result.forbidden) return res.status(403).json({ error:'Cannot delete another DJ\'s community comment' });
    if(result.notFound) return res.status(404).json({ error:'Community comment is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, comment:result.comment, deleted:Boolean(result.deleted) });
  }catch(err){
    console.error('community comment delete error', err);
    return res.status(500).json({ error:'Community comment deletion failed' });
  }
});

app.post('/api/community/reactions/toggle', requireAuth, async (req, res) => {
  const body = { ...(req.body || {}), idempotencyKey:(req.body && req.body.idempotencyKey) || req.get('Idempotency-Key') || null };
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'communityReactionToggle', {
    payload:{ userId:req.authUser.id, targetType:body.targetType || body.target_type, targetId:body.targetId || body.target_id, type:body.type || body.reactionType, idempotencyKey:body.idempotencyKey },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const result = await toggleCommunityReaction(supabaseService, req.authUser.id, body);
    if(result.rateLimited) return res.status(429).json({ success:false, rateLimited:true, retryAfterMs:result.retryAfterMs });
    if(result.forbidden) return res.status(403).json({ error:'Cannot react to this community item' });
    if(result.notFound || result.unavailable) return res.status(404).json({ error:'Community item is unavailable' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, reaction:result.reaction, counts:result.counts });
  }catch(err){
    console.error('community reaction error', err);
    return res.status(500).json({ error:'Community reaction failed' });
  }
});

app.post('/api/community/reports', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'communityReport', {
    payload:{ userId:req.authUser.id, targetType:req.body && (req.body.targetType || req.body.target_type), targetId:req.body && (req.body.targetId || req.body.target_id), reason:req.body && req.body.reason },
    fingerprintReplay:false
  })) return;
  try{
    const result = await reportCommunityTarget(supabaseService, req.authUser.id, req.body || {});
    if(result.rateLimited) return res.status(429).json({ success:false, rateLimited:true, retryAfterMs:result.retryAfterMs });
    if(result.forbidden) return res.status(403).json({ error:'Cannot report this community item' });
    if(result.notFound || result.unavailable) return res.status(404).json({ error:'Community item is unavailable' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.status(result.created ? 201 : 200).json({ success:true, report:result.report, duplicate:Boolean(result.duplicate) });
  }catch(err){
    console.error('community report error', err);
    return res.status(500).json({ error:'Community report failed' });
  }
});

app.get('/api/community/reports', requireAuth, requireOperatorUser, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listCommunityReports(supabaseService, req.authUser.id, req.query || {});
    if(result.forbidden) return res.status(403).json({ error:'Moderator access is required' });
    if(result.error) throw result.error;
    return res.json({ success:true, reports:result.reports, pagination:result.pagination });
  }catch(err){
    console.error('community report list error', err);
    return res.status(500).json({ error:'Community reports request failed' });
  }
});

app.post('/api/community/moderation/actions', requireAuth, requireOperatorUser, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'communityModerationAction', {
    payload:{ userId:req.authUser.id, targetType:req.body && (req.body.targetType || req.body.target_type), targetId:req.body && (req.body.targetId || req.body.target_id), action:req.body && req.body.action },
    fingerprintReplay:false
  })) return;
  try{
    const result = await moderateCommunityTarget(supabaseService, req.authUser.id, req.body || {});
    if(result.notFound) return res.status(404).json({ error:'Community moderation target is unavailable' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, action:result.action, report:result.report || null });
  }catch(err){
    console.error('community moderation error', err);
    return res.status(500).json({ error:'Community moderation action failed' });
  }
});

app.get('/api/community/moderation/history', requireAuth, requireOperatorUser, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listCommunityModerationHistory(supabaseService, req.authUser.id, req.query || {});
    if(result.forbidden) return res.status(403).json({ error:'Moderator access is required' });
    if(result.error) throw result.error;
    return res.json({ success:true, actions:result.actions, pagination:result.pagination });
  }catch(err){
    console.error('community moderation history error', err);
    return res.status(500).json({ error:'Community moderation history request failed' });
  }
});

app.post('/api/community/posts/:postId/attachments/:attachmentId/usage', requireAuth, async (req, res) => {
  const postValidation = validateRouteIdentifier(req.params.postId, 'postId');
  if(postValidation.error) return rejectProtectedWriteError(res, postValidation);
  const attachmentValidation = validateRouteIdentifier(req.params.attachmentId, 'attachmentId');
  if(attachmentValidation.error) return rejectProtectedWriteError(res, attachmentValidation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await issueCommunityAttachmentPlaybackAccess(supabaseService, supabaseService.storage.from(MIX_BUCKET), req.authUser.id, postValidation.value.postId, attachmentValidation.value.attachmentId);
    if(result.rateLimited) return res.status(429).json({ success:false, rateLimited:true, retryAfterMs:result.retryAfterMs });
    if(result.forbidden) return res.status(403).json({ error:'Community media is private or unavailable' });
    if(result.notFound || result.unavailable) return res.status(404).json({ error:'Community media is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, attachment:result.attachment, usage:result.usage, playbackAccess:result.playbackAccess });
  }catch(err){
    console.error('community attachment usage error', err);
    return res.status(500).json({ error:'Community media usage failed' });
  }
});

app.get('/api/relationships/sync', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await getOwnedRelationshipSyncState(supabaseService, req.authUser.id, req.query || {});
    if(result.error) throw result.error;
    return res.json({ success:true, sync:result.sync });
  }catch(err){
    console.error('relationship sync error', err);
    return res.status(500).json({ error:'DJ relationship sync failed' });
  }
});

app.get('/api/relationships/:publicProfileId', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.publicProfileId, 'publicProfileId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await getRelationshipSummary(supabaseService, req.authUser.id, validation.value.publicProfileId);
    if(result.notFound || result.private) return res.status(404).json({ error:'DJ profile is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, relationship:result.summary });
  }catch(err){
    console.error('relationship summary error', err);
    return res.status(500).json({ error:'DJ relationship summary failed' });
  }
});

app.post('/api/relationships/:publicProfileId/follow', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.publicProfileId, 'publicProfileId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  const body = { ...(req.body || {}), idempotencyKey:(req.body && req.body.idempotencyKey) || req.get('Idempotency-Key') || null };
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'followPublicDj', {
    payload:{ userId:req.authUser.id, publicProfileId:validation.value.publicProfileId, idempotencyKey:body.idempotencyKey },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const result = await followPublicDj(supabaseService, req.authUser.id, { ...body, publicProfileId:validation.value.publicProfileId });
    if(result.notFound || result.private) return res.status(404).json({ error:'DJ profile is unavailable' });
    if(result.forbidden) return res.status(403).json({ error:result.reason || 'DJ profile is unavailable' });
    if(result.conflict) return res.status(409).json({ error:result.reason || 'Follow cannot be created' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.status(result.created ? 201 : 200).json({ success:true, follow:result.follow, duplicate:Boolean(result.duplicate) });
  }catch(err){
    console.error('followPublicDj error', err);
    return res.status(500).json({ error:'DJ follow request failed' });
  }
});

app.delete('/api/relationships/:publicProfileId/follow', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.publicProfileId, 'publicProfileId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  const idempotencyKey = req.body && req.body.idempotencyKey || req.get('Idempotency-Key') || null;
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'unfollowPublicDj', {
    payload:{ userId:req.authUser.id, publicProfileId:validation.value.publicProfileId, idempotencyKey },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const result = await unfollowPublicDj(supabaseService, req.authUser.id, validation.value.publicProfileId);
    if(result.notFound || result.private) return res.status(404).json({ error:'DJ profile is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, follow:result.follow, removed:Boolean(result.removed), duplicate:Boolean(result.duplicate) });
  }catch(err){
    console.error('unfollowPublicDj error', err);
    return res.status(500).json({ error:'DJ unfollow request failed' });
  }
});

app.get('/api/relationships', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listOwnedRelationships(supabaseService, req.authUser.id, req.query || {});
    if(result.error) throw result.error;
    return res.json({ success:true, relationships:result.relationships, counts:result.counts, pagination:result.pagination });
  }catch(err){
    console.error('listRelationships error', err);
    return res.status(500).json({ error:'DJ relationships request failed' });
  }
});

app.get('/api/activityFeed', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listOwnedActivityFeed(supabaseService, req.authUser.id, req.query || {});
    if(result.error) throw result.error;
    return res.json({ success:true, events:result.events, pagination:result.pagination });
  }catch(err){
    console.error('activityFeed error', err);
    return res.status(500).json({ error:'DJ activity feed request failed' });
  }
});

app.get('/api/opponentHistory', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listOwnedOpponentHistory(supabaseService, req.authUser.id, req.query || {});
    if(result.error) throw result.error;
    return res.json({ success:true, opponents:result.opponents, pagination:result.pagination });
  }catch(err){
    console.error('opponentHistory error', err);
    return res.status(500).json({ error:'Opponent history request failed' });
  }
});

app.get('/api/challengePreferences', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await getOwnedChallengePreferences(supabaseService, req.authUser.id);
    if(result.error) throw result.error;
    return res.json({ success:true, preferences:result.preferences, configurationRequired:Boolean(result.configurationRequired) });
  }catch(err){
    console.error('challengePreferences read error', err);
    return res.status(500).json({ error:'Challenge preferences request failed' });
  }
});

app.patch('/api/challengePreferences', requireAuth, async (req, res) => {
  const body = req.body || {};
  const idempotencyKey = body.idempotencyKey || req.get('Idempotency-Key') || null;
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'updateChallengePreferences', {
    payload:{ userId:req.authUser.id, preferences:body.preferences || body, idempotencyKey },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const result = await updateOwnedChallengePreferences(supabaseService, req.authUser.id, body.preferences || body);
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, preferences:result.preferences });
  }catch(err){
    console.error('challengePreferences update error', err);
    return res.status(500).json({ error:'Challenge preferences update failed' });
  }
});

app.post('/api/rematches', requireAuth, async (req, res) => {
  const body = { ...(req.body || {}), idempotencyKey:(req.body && req.body.idempotencyKey) || req.get('Idempotency-Key') || null };
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'requestRematch', {
    payload:{
      userId:req.authUser.id,
      previousResultId:body.previousResultId || body.resultId || body.submissionId,
      opponentPublicProfileId:body.opponentPublicProfileId || body.recipientPublicProfileId,
      challengerCrateId:body.challengerCrateId || body.crateId,
      idempotencyKey:body.idempotencyKey
    },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const result = await requestRematch(supabaseService, req.authUser.id, body);
    if(result.private || result.forbidden) return res.status(403).json({ error:result.reason || 'This DJ cannot receive rematches' });
    if(result.notFound || result.unavailable) return res.status(404).json({ error:'Rematch source or public DJ profile is unavailable' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.conflict) return res.status(409).json({ error:result.reason || 'Rematch cannot be created', challenge:result.challenge });
    if(result.error) throw result.error;
    return res.status(result.created ? 201 : 200).json({ success:true, rematch:result.rematch, challenge:result.challenge, duplicate:Boolean(result.duplicate) });
  }catch(err){
    console.error('requestRematch error', err);
    return res.status(500).json({ error:'Rematch request failed' });
  }
});

app.post('/api/challenges', requireAuth, async (req, res) => {
  const body = { ...(req.body || {}), idempotencyKey:(req.body && req.body.idempotencyKey) || req.get('Idempotency-Key') || null };
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'sendDjChallenge', {
    payload:{
      userId:req.authUser.id,
      recipientPublicProfileId:body.recipientPublicProfileId || body.recipient_public_profile_id,
      challengerCrateId:body.challengerCrateId || body.challenger_crate_id || body.crateId || body.crate_id,
      rules:body.rules,
      idempotencyKey:body.idempotencyKey
    },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const result = await sendDjChallenge(supabaseService, req.authUser.id, body);
    if(result.private || result.forbidden) return res.status(403).json({ error:result.reason || 'This DJ cannot receive challenges' });
    if(result.notFound || result.unavailable) return res.status(404).json({ error:'Public DJ profile is unavailable for challenges' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.conflict) return res.status(409).json({ error:result.reason || 'Challenge cannot be created' });
    if(result.error) throw result.error;
    return res.status(result.created ? 201 : 200).json({ success:true, challenge:result.challenge, duplicate:Boolean(result.duplicate) });
  }catch(err){
    console.error('sendDjChallenge error', err);
    return res.status(500).json({ error:'DJ challenge request failed' });
  }
});

app.get('/api/challenges', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listOwnedDjChallenges(supabaseService, req.authUser.id, req.query || {});
    if(result.error) throw result.error;
    return res.json({ success:true, challenges:result.challenges, pagination:result.pagination });
  }catch(err){
    console.error('listDjChallenges error', err);
    return res.status(500).json({ error:'DJ challenge inbox request failed' });
  }
});

app.get('/api/challenges/count', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await countOwnedDjChallenges(supabaseService, req.authUser.id);
    if(result.error) throw result.error;
    return res.json({ success:true, counts:result });
  }catch(err){
    console.error('countDjChallenges error', err);
    return res.status(500).json({ error:'DJ challenge count request failed' });
  }
});

app.get('/api/challenges/eligibility/:publicProfileId', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.publicProfileId, 'publicProfileId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await getChallengeInteractionEligibility(supabaseService, req.authUser.id, validation.value.publicProfileId);
    if(result.error) throw result.error;
    return res.json({ success:true, eligibility:{ available:Boolean(result.available), reason:result.available ? null : 'Challenge unavailable', profile:result.profile || null } });
  }catch(err){
    console.error('challenge eligibility error', err);
    return res.status(500).json({ error:'Challenge eligibility request failed' });
  }
});

app.post('/api/challenges/:challengeId/accept', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.challengeId, 'challengeId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  const body = { ...(req.body || {}), idempotencyKey:(req.body && req.body.idempotencyKey) || req.get('Idempotency-Key') || null };
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'acceptDjChallenge', {
    payload:{ userId:req.authUser.id, challengeId:validation.value.challengeId, recipientCrateId:body.recipientCrateId || body.crateId || body.crate_id, idempotencyKey:body.idempotencyKey },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const result = await acceptDjChallenge(supabaseService, req.authUser.id, validation.value.challengeId, body);
    if(result.forbidden) return res.status(403).json({ error:'Cannot accept another DJ\'s challenge' });
    if(result.notFound || result.unavailable) return res.status(404).json({ error:'DJ challenge or Battle Prep crate is unavailable' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.conflict || result.expired) return res.status(409).json({ error:result.reason || 'Challenge is no longer available', challenge:result.challenge });
    if(result.error) throw result.error;
    return res.status(result.accepted ? 201 : 200).json({ success:true, challenge:result.challenge, battle:result.battle, entry:result.entry, snapshot:result.snapshot, room:result.room, duplicate:Boolean(result.duplicate) });
  }catch(err){
    console.error('acceptDjChallenge error', err);
    return res.status(500).json({ error:'DJ challenge acceptance failed' });
  }
});

app.post('/api/challenges/:challengeId/decline', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.challengeId, 'challengeId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  const idempotencyKey = req.body && req.body.idempotencyKey || req.get('Idempotency-Key') || null;
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'declineDjChallenge', {
    payload:{ userId:req.authUser.id, challengeId:validation.value.challengeId, idempotencyKey },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const result = await declineDjChallenge(supabaseService, req.authUser.id, validation.value.challengeId);
    if(result.forbidden) return res.status(403).json({ error:'Cannot decline another DJ\'s challenge' });
    if(result.notFound) return res.status(404).json({ error:'DJ challenge is unavailable' });
    if(result.conflict) return res.status(409).json({ error:result.reason || 'Challenge is no longer pending', challenge:result.challenge });
    if(result.error) throw result.error;
    return res.json({ success:true, challenge:result.challenge, duplicate:Boolean(result.duplicate) });
  }catch(err){
    console.error('declineDjChallenge error', err);
    return res.status(500).json({ error:'DJ challenge decline failed' });
  }
});

app.post('/api/challenges/:challengeId/cancel', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.challengeId, 'challengeId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  const idempotencyKey = req.body && req.body.idempotencyKey || req.get('Idempotency-Key') || null;
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'cancelDjChallenge', {
    payload:{ userId:req.authUser.id, challengeId:validation.value.challengeId, idempotencyKey },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const result = await cancelDjChallenge(supabaseService, req.authUser.id, validation.value.challengeId);
    if(result.forbidden) return res.status(403).json({ error:'Cannot cancel another DJ\'s challenge' });
    if(result.notFound) return res.status(404).json({ error:'DJ challenge is unavailable' });
    if(result.conflict) return res.status(409).json({ error:result.reason || 'Challenge is no longer pending', challenge:result.challenge });
    if(result.error) throw result.error;
    return res.json({ success:true, challenge:result.challenge, duplicate:Boolean(result.duplicate) });
  }catch(err){
    console.error('cancelDjChallenge error', err);
    return res.status(500).json({ error:'DJ challenge cancellation failed' });
  }
});

app.get('/api/notifications', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listOwnedNotifications(supabaseService, req.authUser.id, req.query || {});
    if(result.error) throw result.error;
    return res.json({ success:true, notifications:result.notifications, pagination:result.pagination });
  }catch(err){
    console.error('listNotifications error', err);
    return res.status(500).json({ error:'Notification center request failed' });
  }
});

app.get('/api/notifications/count', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await countOwnedNotifications(supabaseService, req.authUser.id);
    if(result.error) throw result.error;
    return res.json({ success:true, counts:result });
  }catch(err){
    console.error('countNotifications error', err);
    return res.status(500).json({ error:'Notification count request failed' });
  }
});

app.post('/api/notifications/mark-all-read', requireAuth, async (req, res) => {
  const body = req.body || {};
  const idempotencyKey = body.idempotencyKey || req.get('Idempotency-Key') || null;
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'markAllNotificationsRead', {
    payload:{ userId:req.authUser.id, filter:body.filter || 'unread', idempotencyKey },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const result = await markAllOwnedNotificationsRead(supabaseService, req.authUser.id, body);
    if(result.error) throw result.error;
    return res.json({ success:true, updatedCount:result.updatedCount || 0 });
  }catch(err){
    console.error('markAllNotificationsRead error', err);
    return res.status(500).json({ error:'Notification read-state update failed' });
  }
});

app.post('/api/notifications/:notificationId/read', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.notificationId, 'notificationId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  const idempotencyKey = req.body && req.body.idempotencyKey || req.get('Idempotency-Key') || null;
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'markNotificationRead', {
    payload:{ userId:req.authUser.id, notificationId:validation.value.notificationId, idempotencyKey },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const result = await markOwnedNotificationRead(supabaseService, req.authUser.id, validation.value.notificationId, true);
    if(result.notFound) return res.status(404).json({ error:'Notification is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, notification:result.notification });
  }catch(err){
    console.error('markNotificationRead error', err);
    return res.status(500).json({ error:'Notification read-state update failed' });
  }
});

app.post('/api/notifications/:notificationId/unread', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.notificationId, 'notificationId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  const idempotencyKey = req.body && req.body.idempotencyKey || req.get('Idempotency-Key') || null;
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'markNotificationUnread', {
    payload:{ userId:req.authUser.id, notificationId:validation.value.notificationId, idempotencyKey },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const result = await markOwnedNotificationRead(supabaseService, req.authUser.id, validation.value.notificationId, false);
    if(result.notFound) return res.status(404).json({ error:'Notification is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, notification:result.notification });
  }catch(err){
    console.error('markNotificationUnread error', err);
    return res.status(500).json({ error:'Notification read-state update failed' });
  }
});

app.post('/api/blocks', requireAuth, async (req, res) => {
  const body = { ...(req.body || {}), idempotencyKey:(req.body && req.body.idempotencyKey) || req.get('Idempotency-Key') || null };
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'blockDjInteraction', {
    payload:{ userId:req.authUser.id, blockedPublicProfileId:body.blockedPublicProfileId || body.publicProfileId || body.blocked_public_profile_id, idempotencyKey:body.idempotencyKey },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const result = await createDjBlock(supabaseService, req.authUser.id, body);
    if(result.notFound || result.private || result.forbidden) return res.status(404).json({ error:'DJ profile is unavailable' });
    if(result.conflict) return res.status(409).json({ error:result.reason || 'Block cannot be created' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.status(result.created ? 201 : 200).json({ success:true, block:result.block, duplicate:Boolean(result.duplicate), cancelledChallengeCount:result.cancelledChallengeCount || 0 });
  }catch(err){
    console.error('blockDjInteraction error', err);
    return res.status(500).json({ error:'DJ safety block request failed' });
  }
});

app.post('/api/notificationMutes', requireAuth, async (req, res) => {
  const body = { ...(req.body || {}), idempotencyKey:(req.body && req.body.idempotencyKey) || req.get('Idempotency-Key') || null };
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'muteDjNotifications', {
    payload:{ userId:req.authUser.id, category:body.category, notificationType:body.notificationType || body.notification_type, mutedPublicProfileId:body.mutedPublicProfileId || body.publicProfileId || body.muted_public_profile_id, idempotencyKey:body.idempotencyKey },
    fingerprintReplay:false,
    idempotencyReplay:false
  })) return;
  try{
    const result = await createNotificationMute(supabaseService, req.authUser.id, body);
    if(result.notFound || result.private || result.forbidden) return res.status(404).json({ error:'DJ profile is unavailable' });
    if(result.conflict) return res.status(409).json({ error:result.reason || 'Mute cannot be created' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.status(result.created ? 201 : 200).json({ success:true, mute:result.mute, duplicate:Boolean(result.duplicate) });
  }catch(err){
    console.error('muteDjNotifications error', err);
    return res.status(500).json({ error:'Notification mute request failed' });
  }
});

// Blocked & muted list: the signed-in DJ's own blocks and mutes only.
app.get('/api/blocks', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listOwnedBlocks(supabaseService, req.authUser.id);
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, blocks:result.blocks });
  }catch(err){
    console.error('list blocks error', err);
    return res.status(500).json({ error:'Blocked DJ list request failed' });
  }
});

app.delete('/api/blocks/:blockId', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.blockId, 'blockId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'unblockDjInteraction', { payload:{ userId:req.authUser.id, blockId:validation.value.blockId }, fingerprintReplay:false, idempotencyReplay:false })) return;
  try{
    const result = await removeOwnedBlock(supabaseService, req.authUser.id, validation.value.blockId);
    if(result.notFound) return res.status(404).json({ error:'Block not found' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, block:result.block, duplicate:Boolean(result.duplicate) });
  }catch(err){
    console.error('unblock error', err);
    return res.status(500).json({ error:'Unblock request failed' });
  }
});

app.get('/api/notificationMutes', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await listOwnedMutes(supabaseService, req.authUser.id);
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, mutes:result.mutes });
  }catch(err){
    console.error('list mutes error', err);
    return res.status(500).json({ error:'Muted DJ list request failed' });
  }
});

app.delete('/api/notificationMutes/:muteId', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.muteId, 'muteId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'unmuteDjNotifications', { payload:{ userId:req.authUser.id, muteId:validation.value.muteId }, fingerprintReplay:false, idempotencyReplay:false })) return;
  try{
    const result = await removeOwnedMute(supabaseService, req.authUser.id, validation.value.muteId);
    if(result.notFound) return res.status(404).json({ error:'Mute not found' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, mute:result.mute, duplicate:Boolean(result.duplicate) });
  }catch(err){
    console.error('unmute error', err);
    return res.status(500).json({ error:'Unmute request failed' });
  }
});

app.get('/api/publicBattleResults/:verifiedResultId', async (req, res) => {
  const validation = validateRouteIdentifier(req.params.verifiedResultId, 'verifiedResultId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await getPublicBattleResult(supabaseService, validation.value.verifiedResultId);
    if(result.private) return res.status(403).json({ error:'Battle result is private' });
    if(result.notFound || result.unavailable) return res.status(404).json({ error:'Battle result is unavailable' });
    if(result.error) throw result.error;
    return res.json({ success:true, result:result.result });
  }catch(err){
    console.error('publicBattleResult error', err);
    return res.status(500).json({ error:'Public battle result request failed' });
  }
});

app.post('/api/publicBattleResults/:verifiedResultId/views', async (req, res) => {
  const validation = validateRouteIdentifier(req.params.verifiedResultId, 'verifiedResultId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await recordVerifiedResultView(supabaseService, validation.value.verifiedResultId, publicViewVisitor(req));
    if(result.private) return res.status(403).json({ error:'Battle result is private' });
    if(result.notFound || result.unavailable) return res.status(404).json({ error:'Battle result is unavailable' });
    if(result.rateLimited) return res.status(429).json({ success:false, rateLimited:true, retryAfterMs:result.retryAfterMs, views:result.views });
    if(result.error) throw result.error;
    if(!result.duplicate && result.ownerUserId) logViewQuietly(req, 'result', validation.value.verifiedResultId, result.ownerUserId);
    return res.json({ success:true, duplicate:Boolean(result.duplicate), views:result.views, result:result.result });
  }catch(err){
    console.error('publicBattleResult view error', err);
    return res.status(500).json({ error:'Public battle result view tracking failed' });
  }
});

app.post('/api/mixSubmissions/:submissionId/uploadAuthorization', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.submissionId, 'submissionId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  const { submissionId } = validation.value;
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'uploadAuthorization', { payload: { userId: req.authUser.id, submissionId }, fingerprintReplay: false })) return;
  try{
    const result = await issueUploadAuthorization(supabaseService, supabaseService.storage.from(MIX_BUCKET), req.authUser.id, submissionId);
    if(result.forbidden) return res.status(403).json({ error: 'Cannot upload for another user\'s submission' });
    if(result.invalidState) return res.status(409).json({ error: 'Submission cannot receive upload authorization in its current state' });
    if(result.validationError) return res.status(400).json({ error: 'Invalid request payload' });
    if(result.error) throw result.error;
    return res.json({ success:true, bucket:MIX_BUCKET, uploadPath: result.uploadPath, uploadToken: result.uploadToken, expiresAt: result.expiresAt, submissionId: result.submission.id });
  }catch(err){ console.error('uploadAuthorization error', err); return res.status(500).json({ error: 'Upload authorization failed' }); }
});

app.post('/api/mixSubmissions/:submissionId/completeUpload', requireAuth, async (req, res) => {
  const validation = validateRouteIdentifier(req.params.submissionId, 'submissionId');
  if(validation.error) return rejectProtectedWriteError(res, validation);
  const { submissionId } = validation.value;
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'completeUpload', { payload: { userId: req.authUser.id, submissionId }, fingerprintReplay: false })) return;
  try{
    const result = await completeUpload(supabaseService, supabaseService.storage.from(MIX_BUCKET), req.authUser.id, submissionId);
    if(result.forbidden) return res.status(403).json({ error: 'Cannot complete another user\'s submission' });
    if(result.invalidState) return res.status(409).json({ error: 'Submission is not awaiting upload verification' });
    if(result.verificationFailed) return res.status(400).json({ error: result.reason });
    if(result.error) throw result.error;
    return res.json({ success:true, submission: result.submission });
  }catch(err){ console.error('completeUpload error', err); return res.status(500).json({ error: 'Upload completion failed' }); }
});

// Belts API: get available belts
app.get('/api/getBelts', async (req, res) => {
  const defs = loadBeltsDefinitions();
  if(!defs) return res.status(500).json({ error: 'Belts definitions unavailable' });
  return res.json({ success:true, belts: defs.belts, components: defs.components });
});

// Request a belt test (creates a belt_tests row)
app.post('/api/requestBeltTest', requireAuth, async (req, res) => {
  const { userId: suppliedUserId } = req.body || {};
  const userId = requireOwnedUserId(req, res, suppliedUserId);
  if(!userId) return;
  const defs = loadBeltsDefinitions();
  if(!defs) return res.status(500).json({ error: 'Belts definitions unavailable' });
  const validation = validateBeltCodePayload(req.body, (defs.belts || []).map(b => b.code));
  if(validation.error) return rejectProtectedWriteError(res, validation);
  const { beltCode } = validation.value;
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'requestBeltTest', { payload: { userId, beltCode } })) return;
  try{
    const belt = (defs.belts || []).find(b=>b.code.toLowerCase()===String(beltCode).toLowerCase());
    if(!belt) return res.status(422).json({ error: 'Invalid field value' });
    const criteria = { components: defs.components, requiredScore: belt.minScore };
    const ins = await supabaseService.from('belt_tests').insert([{ user_id: userId, code: belt.code, name: `${belt.name} Promotion Test`, criteria, passing_score: belt.minScore, test_type: 'belt_exam' }]).select('*');
    if(ins.error) throw ins.error;
    const test = ins.data && ins.data[0] ? ins.data[0] : null;
    return res.json({ success:true, test });
  }catch(err){ console.error('requestBeltTest error', err); return res.status(500).json({ error: 'Belt test request failed' }); }
});

// Generate a randomized belt test server-side (creates belt_tests row)
app.post('/api/generateBeltTest', requireAuth, async (req, res) => {
  const { userId: suppliedUserId } = req.body || {};
  const userId = requireOwnedUserId(req, res, suppliedUserId);
  if(!userId) return;
  const defs = loadBeltsDefinitions();
  if(!defs) return res.status(500).json({ error: 'Belts definitions unavailable' });
  const validation = validateBeltCodePayload(req.body, (defs.belts || []).map(b => b.code));
  if(validation.error) return rejectProtectedWriteError(res, validation);
  const { beltCode } = validation.value;
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'generateBeltTest', { payload: { userId, beltCode } })) return;
  try{
    const generated = generateRandomBeltTest(beltCode);
    if(!generated) return res.status(500).json({ error: 'Unable to generate test' });
    const ins = await supabaseService.from('belt_tests').insert([{ user_id: userId, code: generated.code, name: generated.name, criteria: generated.criteria, passing_score: generated.criteria.passing_score, test_type: 'belt_exam' }]).select('*');
    if(ins.error) throw ins.error;
    const test = ins.data && ins.data[0] ? ins.data[0] : null;
    return res.json({ success:true, test });
  }catch(err){ console.error('generateBeltTest error', err); return res.status(500).json({ error: 'Belt test generation failed' }); }
});

// The signed-in DJ's current belt (White until a promotion test is passed) and the next one to test for.
app.get('/api/myBelt', requireAuth, async (req, res) => {
  const defs = loadBeltsDefinitions();
  if(!defs) return res.status(500).json({ error: 'Belts definitions unavailable' });
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await BeltPromotion.getUserBelt(supabaseService, req.authUser.id, defs);
    if(result.error) throw result.error;
    return res.json({ success:true, belt: result.belt, stored: result.stored });
  }catch(err){ console.error('myBelt error', err); return res.status(500).json({ error: 'Belt lookup failed' }); }
});

// Return belt attempts for the authenticated user
app.get('/api/getBeltAttempts', requireAuth, async (req,res)=>{
  const userId = requireOwnedUserId(req, res, req.query.userId || req.query.user_id);
  if(!userId) return;
  try{
    const q = await supabaseService.from('belt_attempts').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(100);
    if(q.error) throw q.error;
    return res.json({ success:true, attempts: q.data || [] });
  }catch(err){ console.error('getBeltAttempts error', err); return res.status(500).json({ error: String(err) }); }
});

// Get a single belt attempt by id when it belongs to the authenticated user
app.get('/api/getBeltAttempt', requireAuth, async (req,res)=>{
  const id = req.query.id || req.query.attemptId;
  if(!id) return res.status(400).json({ error: 'Missing attempt id' });
  try{
    const result = await getOwnedBeltAttempt(supabaseService, req.authUser.id, id);
    if(result.error) throw result.error;
    if(result.forbidden) return res.status(403).json({ error: 'Cannot access another user\'s belt attempt' });
    return res.json({ success:true, attempt: result.attempt });
  }catch(err){ console.error('getBeltAttempt error', err); return res.status(500).json({ error: String(err) }); }
});

// Submit a belt attempt and evaluate
app.post('/api/submitBeltAttempt', requireAuth, async (req, res) => {
  const { userId: suppliedUserId } = req.body || {};
  const userId = requireOwnedUserId(req, res, suppliedUserId);
  if(!userId) return;
  const validation = validateBeltAttemptPayload(req.body);
  if(validation.error) return rejectProtectedWriteError(res, validation);
  const { testId, score, breakdown } = validation.value;
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'submitBeltAttempt', { payload: { userId, testId, score, breakdown } })) return;
  try{
    const testResult = await getOwnedBeltTest(supabaseService, userId, testId);
    if(testResult.error) throw testResult.error;
    if(testResult.forbidden) return res.status(403).json({ error: 'Cannot submit an attempt for this belt test' });
    const test = testResult.test;
    // One attempt per generated test, so a failed test can't be re-submitted with better numbers.
    const prior = await supabaseService.from('belt_attempts').select('id').eq('test_id', testId).limit(1);
    if(prior.error) throw prior.error;
    if(Array.isArray(prior.data) && prior.data.length) return res.status(409).json({ error: 'This belt test was already submitted. Start a new test to try again.' });
    const defs = loadBeltsDefinitions();
    const passingScore = Number(test.passing_score || 0);
    // The in-app tap test sends raw tap timings; the server grades them itself instead of trusting a score.
    const serverScored = Boolean(breakdown && breakdown.method === BeltPromotion.TAP_METHOD);
    const graded = serverScored ? BeltPromotion.scoreTapAttempt(test, breakdown, defs) : null;
    const finalScore = graded ? graded.score : Number(score);
    const storedBreakdown = { ...(breakdown || {}), beltCode: test.code, serverScored, grading: graded };
    const att = await supabaseService.from('belt_attempts').insert([{ user_id: userId, test_id: testId, score: finalScore, passing_score: passingScore, breakdown: storedBreakdown }]).select('*');
    if(att.error) throw att.error;
    const passed = finalScore >= passingScore;
    let award = null;
    if(passed && serverScored && defs){
      // Only the very next belt is awarded; skipping ahead stays a practice pass.
      const current = await BeltPromotion.getUserBelt(supabaseService, userId, defs);
      if(current.error) throw current.error;
      const next = current.belt && current.belt.next;
      if(next && String(next.code).toLowerCase() === String(test.code).toLowerCase()){
        const awarded = await BeltPromotion.awardBelt(supabaseService, userId, next.code, { testId, score: finalScore, method: BeltPromotion.TAP_METHOD });
        if(awarded.error) throw awarded.error;
        award = { beltCode: next.code, beltName: next.name, awardedAt: awarded.awarded.awardedAt };
      }
    }
    return res.json({ success:true, passed, score: finalScore, passingScore, beltCode: test.code, serverScored, grading: graded, award });
  }catch(err){ console.error('submitBeltAttempt error', err); return res.status(500).json({ error: 'Belt attempt submission failed' }); }
});

// Get leaderboard (optional filters: battleType, genre)
app.get('/api/getLeaderboard', async (req, res) => {
  const battleType = req.query.battleType || 'Practice';
  const genre = req.query.genre || 'Global';
  try{
    const q = await supabase.from('ai_scores').select('*').eq('battle_type', battleType).eq('genre', genre);
    if(q.error) throw q.error;
    const rows = q.data || [];
    const map = new Map();
    rows.forEach(r=>{
      const key = r.user_id;
      const cur = map.get(key) || { userId: r.user_id, dj: r.dj, best: 0, sum:0, attempts:0, last:0 };
      cur.attempts += 1;
      cur.sum += Number(r.score||0);
      cur.last = Number(r.score||0);
      cur.best = Math.max(cur.best, Number(r.score||0));
      map.set(key, cur);
    });
    const agg = Array.from(map.values()).map((v)=>({
      userId: v.userId, dj: v.dj, best: v.best, average: Math.round((v.sum / v.attempts)*10)/10, attempts: v.attempts, last: v.last
    }));
    agg.sort((a,b)=>b.best - a.best || b.average - a.average);
    const rowsOut = agg.map((r,i)=>({ rank: i+1, ...r }));
    return res.json({ success:true, rows: rowsOut });
  }catch(err){
    console.error('getLeaderboard error', err);
    return res.status(500).json({ error: String(err) });
  }
});

// Accept judge breakdown submissions (trusted clients / service role recommended)
app.post('/api/submitJudgeBreakdown', requireAuth, async (req, res) => {
  const body = req.body || {};
  const { userId: suppliedUserId } = body;
  const userId = requireOwnedUserId(req, res, suppliedUserId);
  if(!userId) return;
  const validation = validateJudgeBreakdownPayload(body);
  if(validation.error) return rejectProtectedWriteError(res, validation);
  const { battleId, analysis } = validation.value;
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'submitJudgeBreakdown', { payload: { userId, battleId, analysis } })) return;
  try{
    const payload = buildJudgeBreakdownPayload({
      userId,
      battleId,
      source: 'api_submit_judge_breakdown',
      analysis
    });
    const ins = await supabaseService.from('judge_breakdowns').insert([payload]);
    if(ins.error) throw ins.error;
    return res.json({ success:true, id: ins.data && ins.data[0] ? ins.data[0].id : null });
  }catch(err){
    console.error('submitJudgeBreakdown error', err);
    return res.status(500).json({ error: 'Judge breakdown submission failed' });
  }
});

/* ---------- Oct 19: battle chat, tournaments, timed comments ---------- */
const BattleChat = require('./battle_chat');
const Tournaments = require('./tournaments');
const TimedComments = require('./timed_comments');
// Lets a public read include "you" details when the browser sends a token, without requiring one.
const optionalAuth = (req, res, next) => (req.get('Authorization') ? requireAuth(req, res, next) : next());
function sendSchemaMissing(res, result){
  return res.status(503).json({ error:`Run server/sql/${result.schema}.sql in Supabase to turn this on`, schemaMissing:true, schema:result.schema });
}

app.get('/api/battles/:battleId/chat', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await BattleChat.listBattleChat(supabaseService, req.authUser.id, req.params.battleId, { after:req.query && req.query.after });
    if(result.schemaMissing) return sendSchemaMissing(res, result);
    if(result.forbidden) return res.status(403).json({ error:'Only DJs in this battle can read its chat' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, messages:result.messages, canSend:result.canSend, maxLength:result.maxLength });
  }catch(err){
    console.error('battle chat list error', err);
    return res.status(500).json({ error:'Battle chat request failed' });
  }
});

app.post('/api/battles/:battleId/chat', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'battleChatPost', { payload:{ userId:req.authUser.id, battleId:req.params.battleId }, fingerprintReplay:false, idempotencyReplay:false })) return;
  try{
    const result = await BattleChat.postBattleChat(supabaseService, req.authUser.id, req.params.battleId, req.body || {});
    if(result.schemaMissing) return sendSchemaMissing(res, result);
    if(result.forbidden) return res.status(403).json({ error:'Only DJs in this battle can chat here' });
    if(result.blocked) return res.status(403).json({ error:'You can\'t message this DJ', blocked:true });
    if(result.rateLimited) return res.status(429).json({ error:'Slow down a little before sending more' });
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.status(201).json({ success:true, message:result.message });
  }catch(err){
    console.error('battle chat post error', err);
    return res.status(500).json({ error:'Battle chat send failed' });
  }
});

function sendTournamentResult(res, result, okStatus = 200){
  if(result.schemaMissing) return sendSchemaMissing(res, result);
  if(result.forbidden) return res.status(403).json({ error:'Only the host or the DJs in this match can do that' });
  if(result.notFound) return res.status(404).json({ error:'Tournament is unavailable' });
  if(result.rateLimited) return res.status(429).json({ error:'You\'ve created a few tournaments already. Try again later.' });
  if(result.validationError) return res.status(422).json({ error:result.validationError });
  if(result.conflict) return res.status(409).json({ error:result.reason || 'Tournament changed, refresh and try again' });
  if(result.error) throw result.error;
  return null;
}

app.get('/api/tournaments', optionalAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await Tournaments.listTournaments(supabaseService, req.authUser && req.authUser.id);
    if(sendTournamentResult(res, result)) return;
    return res.json({ success:true, tournaments:result.tournaments });
  }catch(err){
    console.error('tournament list error', err);
    return res.status(500).json({ error:'Tournament list request failed' });
  }
});

app.get('/api/tournaments/:tournamentId', optionalAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await Tournaments.getTournament(supabaseService, req.params.tournamentId, req.authUser && req.authUser.id);
    if(sendTournamentResult(res, result)) return;
    return res.json({ success:true, tournament:result.tournament });
  }catch(err){
    console.error('tournament read error', err);
    return res.status(500).json({ error:'Tournament request failed' });
  }
});

app.post('/api/tournaments', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'tournamentCreate', { payload:{ userId:req.authUser.id }, fingerprintReplay:false, idempotencyReplay:false })) return;
  try{
    const result = await Tournaments.createTournament(supabaseService, req.authUser.id, req.body || {});
    if(sendTournamentResult(res, result)) return;
    return res.status(201).json({ success:true, tournament:result.tournament });
  }catch(err){
    console.error('tournament create error', err);
    return res.status(500).json({ error:'Tournament create failed' });
  }
});

for(const action of ['join', 'leave', 'start']){
  app.post(`/api/tournaments/:tournamentId/${action}`, requireAuth, async (req, res) => {
    if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
    if(!guardProtectedWrite(req, res, `tournament_${action}`, { payload:{ userId:req.authUser.id, tournamentId:req.params.tournamentId }, fingerprintReplay:false, idempotencyReplay:false })) return;
    try{
      const fn = { join:Tournaments.joinTournament, leave:Tournaments.leaveTournament, start:Tournaments.startTournament }[action];
      const result = await fn(supabaseService, req.authUser.id, req.params.tournamentId);
      if(sendTournamentResult(res, result)) return;
      const fresh = await Tournaments.getTournament(supabaseService, req.params.tournamentId, req.authUser.id);
      if(fresh.error) throw fresh.error;
      return res.json({ success:true, tournament:fresh.tournament, duplicate:Boolean(result.duplicate) });
    }catch(err){
      console.error(`tournament ${action} error`, err);
      return res.status(500).json({ error:'Tournament request failed' });
    }
  });
}

app.post('/api/tournaments/:tournamentId/matches/:matchId/battle', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'tournamentMatchBattle', { payload:{ userId:req.authUser.id, matchId:req.params.matchId }, fingerprintReplay:false, idempotencyReplay:false })) return;
  try{
    const result = await Tournaments.playTournamentMatch(supabaseService, req.authUser.id, req.params.tournamentId, req.params.matchId, req.body || {}, {
      createBattle:createBattleWithPrepSnapshot, joinBattle:joinBattleWithPrepSnapshot, roomState:buildBattleRoomState
    });
    if(result.unavailable) return res.status(404).json({ error:'Battle Prep crate is unavailable' });
    if(sendTournamentResult(res, result)) return;
    return res.json({ success:true, battleId:result.battleId, battle:result.battle, entry:result.entry, room:result.room });
  }catch(err){
    console.error('tournament match battle error', err);
    return res.status(500).json({ error:'Tournament match request failed' });
  }
});

app.delete('/api/battles/:battleId/chat/:messageId', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'battleChatUnsend', { payload:{ userId:req.authUser.id, messageId:req.params.messageId }, fingerprintReplay:false, idempotencyReplay:false })) return;
  try{
    const result = await BattleChat.unsendBattleChat(supabaseService, req.authUser.id, req.params.battleId, req.params.messageId);
    if(result.schemaMissing) return sendSchemaMissing(res, result);
    if(result.notFound) return res.status(404).json({ error:'That message is already gone' });
    if(result.forbidden) return res.status(403).json({ error:'You can only unsend your own messages' });
    if(result.error) throw result.error;
    return res.json({ success:true, unsent:true, id:result.id });
  }catch(err){
    console.error('battle chat unsend error', err);
    return res.status(500).json({ error:'Unsend failed' });
  }
});

/* ---------- Oct 19c: direct messages, Find DJs, live watching, shared tracklists, weekly goals ---------- */
const Connect = require('./connect');
function sendConnectResult(res, result, messages = {}){
  if(result.schemaMissing) return sendSchemaMissing(res, result), true;
  if(result.notFound) return res.status(404).json({ error:messages.notFound || 'Not found' }), true;
  if(result.forbidden) return res.status(403).json({ error:messages.forbidden || 'You can\'t do that' }), true;
  if(result.blocked) return res.status(403).json({ error:'You can\'t message this DJ', blocked:true }), true;
  if(result.rateLimited) return res.status(429).json({ error:'Slow down a little before sending more' }), true;
  if(result.validationError) return res.status(422).json({ error:result.validationError }), true;
  if(result.error) throw result.error;
  return false;
}
const connectRoute = (label, handler) => async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{ await handler(req, res); }catch(err){
    console.error(`${label} error`, err);
    if(!res.headersSent) res.status(500).json({ error:`${label} failed` });
  }
};
const connectWrite = (req, res, action, extra = {}) => guardProtectedWrite(req, res, action, { payload:{ userId:req.authUser.id, ...extra }, fingerprintReplay:false, idempotencyReplay:false });

app.get('/api/messages', requireAuth, connectRoute('Messages list', async (req, res) => {
  const result = await Connect.listConversations(supabaseService, req.authUser.id);
  if(sendConnectResult(res, result)) return;
  res.json({ success:true, conversations:result.conversations, unread:result.unread });
}));
app.delete('/api/messages/item/:messageId', requireAuth, connectRoute('Message unsend', async (req, res) => {
  if(!connectWrite(req, res, 'directMessageUnsend', { messageId:req.params.messageId })) return;
  const result = await Connect.unsendDirectMessage(supabaseService, req.authUser.id, req.params.messageId);
  if(sendConnectResult(res, result, { notFound:'That message is already gone', forbidden:'You can only unsend your own messages' })) return;
  res.json({ success:true, unsent:true, id:result.id });
}));
app.get('/api/messages/:publicProfileId', requireAuth, connectRoute('Conversation', async (req, res) => {
  const result = await Connect.readConversation(supabaseService, req.authUser.id, req.params.publicProfileId);
  if(sendConnectResult(res, result, { notFound:'That DJ is unavailable' })) return;
  res.json({ success:true, ...result });
}));
app.post('/api/messages/:publicProfileId', requireAuth, connectRoute('Message send', async (req, res) => {
  if(!connectWrite(req, res, 'directMessageSend', { to:req.params.publicProfileId })) return;
  const result = await Connect.sendDirectMessage(supabaseService, req.authUser.id, req.params.publicProfileId, req.body || {});
  if(sendConnectResult(res, result, { notFound:'That DJ is unavailable' })) return;
  res.status(201).json({ success:true, message:result.message });
}));

app.get('/api/djs/search', optionalAuth, connectRoute('DJ search', async (req, res) => {
  const result = await Connect.searchDjs(supabaseService, req.authUser && req.authUser.id, req.query || {});
  if(sendConnectResult(res, result)) return;
  res.json({ success:true, results:result.results });
}));
app.put('/api/me/searchProfile', requireAuth, connectRoute('Search profile', async (req, res) => {
  if(!connectWrite(req, res, 'searchProfileUpdate')) return;
  const result = await Connect.updateSearchProfile(supabaseService, req.authUser.id, req.body || {});
  if(sendConnectResult(res, result)) return;
  res.json({ success:true, profile:result.profile });
}));

app.get('/api/liveBattles', connectRoute('Live battles', async (req, res) => {
  const result = await Connect.liveBattles(supabaseService);
  if(sendConnectResult(res, result)) return;
  res.json({ success:true, battles:result.battles });
}));
app.get('/api/battles/:battleId/live', optionalAuth, connectRoute('Live battle', async (req, res) => {
  const result = await Connect.liveBattle(supabaseService, req.params.battleId, { viewerId:req.authUser && req.authUser.id });
  if(sendConnectResult(res, result, { notFound:'This battle is private or no longer exists' })) return;
  res.json({ success:true, ...result });
}));
app.post('/api/battles/:battleId/live/vote', requireAuth, connectRoute('Live crowd vote', async (req, res) => {
  if(!connectWrite(req, res, 'liveCrowdVote', { battleId:req.params.battleId })) return;
  const result = await Connect.liveCrowdVote(supabaseService, req.authUser.id, req.params.battleId, req.body && req.body.publicProfileId);
  if(result.votingClosed) return res.status(409).json({ error:result.reason });
  if(result.forbidden) return res.status(403).json({ error:result.reason || 'You can\'t vote on this battle' });
  if(result.schemaMissing) return res.status(503).json({ error:'Run server/sql/028_create_battle_crowd_votes.sql in Supabase to turn this on', schemaMissing:true, schema:'028_create_battle_crowd_votes' });
  if(sendConnectResult(res, result)) return;
  res.json({ success:true, duplicate:Boolean(result.duplicate) });
}));
app.post('/api/battles/:battleId/watch', connectRoute('Watch heartbeat', async (req, res) => {
  const battleId = String(req.params.battleId || '').slice(0, 128);
  if(!/^[A-Za-z0-9._:-]{1,128}$/.test(battleId)) return res.status(404).json({ error:'Battle not found' });
  const result = Connect.heartbeat(battleId, req.body && req.body.viewerKey);
  if(sendConnectResult(res, result)) return;
  res.json({ success:true, watching:result.watching });
}));

app.get('/api/sharedCrates', requireAuth, connectRoute('Shared tracklists', async (req, res) => {
  const result = await Connect.myTracklists(supabaseService, req.authUser.id);
  if(sendConnectResult(res, result)) return;
  res.json({ success:true, tracklists:result.tracklists });
}));
app.post('/api/sharedCrates', requireAuth, connectRoute('Share tracklist', async (req, res) => {
  if(!connectWrite(req, res, 'sharedCrateCreate', { crateId:req.body && req.body.crateId })) return;
  const result = await Connect.shareTracklist(supabaseService, req.authUser.id, req.body || {});
  if(sendConnectResult(res, result)) return;
  res.status(201).json({ success:true, tracklist:result.tracklist });
}));
app.get('/api/sharedCrates/:id', optionalAuth, connectRoute('Tracklist', async (req, res) => {
  const result = await Connect.getTracklist(supabaseService, req.params.id, req.authUser && req.authUser.id);
  if(sendConnectResult(res, result, { notFound:'This tracklist was removed or the link is wrong' })) return;
  res.json({ success:true, tracklist:result.tracklist });
}));
app.delete('/api/sharedCrates/:id', requireAuth, connectRoute('Stop sharing', async (req, res) => {
  if(!connectWrite(req, res, 'sharedCrateRemove', { id:req.params.id })) return;
  const result = await Connect.stopSharingTracklist(supabaseService, req.authUser.id, req.params.id);
  if(sendConnectResult(res, result, { forbidden:'Only the DJ who shared this list can remove it' })) return;
  res.json({ success:true, removed:true, id:result.id });
}));

app.get('/api/practiceGoal', requireAuth, connectRoute('Practice goal', async (req, res) => {
  const result = await Connect.getPracticeGoal(supabaseService, req.authUser.id);
  if(sendConnectResult(res, result)) return;
  res.json({ success:true, goal:result.goal });
}));
app.put('/api/practiceGoal', requireAuth, connectRoute('Practice goal save', async (req, res) => {
  if(!connectWrite(req, res, 'practiceGoalSave')) return;
  const result = await Connect.setPracticeGoal(supabaseService, req.authUser.id, req.body || {});
  if(sendConnectResult(res, result)) return;
  res.json({ success:true, goal:result.goal });
}));

/* ---------- Oct 19b: host controls, tournament history, notification switches ---------- */
async function tournamentHostRoute(req, res, label, run){
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, `tournament_${label}`, { payload:{ userId:req.authUser.id, tournamentId:req.params.tournamentId }, fingerprintReplay:false, idempotencyReplay:false })) return;
  try{
    const result = await run();
    if(sendTournamentResult(res, result)) return;
    const fresh = await Tournaments.getTournament(supabaseService, req.params.tournamentId, req.authUser.id);
    if(fresh.error) throw fresh.error;
    return res.json({ success:true, tournament:fresh.tournament || null, cancelled:Boolean(result.cancelled) });
  }catch(err){
    console.error(`tournament ${label} error`, err);
    return res.status(500).json({ error:'Tournament request failed' });
  }
}
app.patch('/api/tournaments/:tournamentId', requireAuth, (req, res) => tournamentHostRoute(req, res, 'update', () => Tournaments.updateTournament(supabaseService, req.authUser.id, req.params.tournamentId, req.body || {})));
app.post('/api/tournaments/:tournamentId/remove', requireAuth, (req, res) => tournamentHostRoute(req, res, 'remove', () => Tournaments.removeEntrant(supabaseService, req.authUser.id, req.params.tournamentId, (req.body || {}).publicProfileId)));
app.post('/api/tournaments/:tournamentId/cancel', requireAuth, (req, res) => tournamentHostRoute(req, res, 'cancel', () => Tournaments.cancelTournament(supabaseService, req.authUser.id, req.params.tournamentId)));

app.get('/api/me/tournaments', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await Tournaments.tournamentHistory(supabaseService, req.authUser.id);
    if(sendTournamentResult(res, result)) return;
    return res.json({ success:true, tournaments:result.tournaments, wins:result.wins });
  }catch(err){
    console.error('tournament history error', err);
    return res.status(500).json({ error:'Tournament history request failed' });
  }
});

app.get('/api/tournamentChampions', async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await Tournaments.tournamentChampions(supabaseService);
    if(result.error) throw result.error;
    return res.json({ success:true, champions:result.champions });
  }catch(err){
    console.error('tournament champions error', err);
    return res.status(500).json({ error:'Tournament champions request failed' });
  }
});

app.get('/api/publicProfiles/:publicProfileId/tournaments', async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await Tournaments.publicTournamentHistory(supabaseService, req.params.publicProfileId);
    if(result.error) throw result.error;
    return res.json({ success:true, tournaments:result.tournaments, wins:result.wins });
  }catch(err){
    console.error('public tournament history error', err);
    return res.status(500).json({ error:'Tournament history request failed' });
  }
});

const SocialNotifications = require('./social_notifications');
app.get('/api/notificationPreferences/social', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await SocialNotifications.getSocialNotificationPrefs(supabaseService, req.authUser.id);
    if(result.error) throw result.error;
    return res.json({ success:true, prefs:result.prefs, labels:result.labels });
  }catch(err){
    console.error('social notification prefs error', err);
    return res.status(500).json({ error:'Notification settings request failed' });
  }
});
app.put('/api/notificationPreferences/social', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'socialNotificationPref', { payload:{ userId:req.authUser.id, type:(req.body || {}).type }, fingerprintReplay:false, idempotencyReplay:false })) return;
  try{
    const body = req.body || {};
    const result = await SocialNotifications.setSocialNotificationPref(supabaseService, req.authUser.id, body.type, body.enabled !== false);
    if(result.schemaMissing) return sendSchemaMissing(res, result);
    if(result.validationError) return res.status(422).json({ error:result.validationError });
    if(result.error) throw result.error;
    return res.json({ success:true, prefs:result.prefs, labels:result.labels });
  }catch(err){
    console.error('social notification pref save error', err);
    return res.status(500).json({ error:'Notification setting could not be saved' });
  }
});

function sendTimedResult(res, result){
  if(result.schemaMissing) return sendSchemaMissing(res, result);
  if(result.private) return res.status(403).json({ error:'Battle result is private' });
  if(result.notFound) return res.status(404).json({ error:'Comment or result is unavailable' });
  if(result.forbidden) return res.status(403).json({ error:'You can only change your own comments' });
  if(result.rateLimited) return res.status(429).json({ error:'Slow down a little before commenting again' });
  if(result.validationError) return res.status(422).json({ error:result.validationError });
  if(result.error) throw result.error;
  return null;
}

app.get('/api/publicBattleResults/:verifiedResultId/timedComments', optionalAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await TimedComments.listTimedComments(supabaseService, req.params.verifiedResultId, req.authUser && req.authUser.id);
    if(sendTimedResult(res, result)) return;
    return res.json({ success:true, comments:result.comments, maxLength:result.maxLength });
  }catch(err){
    console.error('timed comments list error', err);
    return res.status(500).json({ error:'Timed comments request failed' });
  }
});

app.post('/api/publicBattleResults/:verifiedResultId/timedComments', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  if(!guardProtectedWrite(req, res, 'timedCommentAdd', { payload:{ userId:req.authUser.id, resultId:req.params.verifiedResultId }, fingerprintReplay:false, idempotencyReplay:false })) return;
  try{
    const result = await TimedComments.addTimedComment(supabaseService, req.authUser.id, req.params.verifiedResultId, req.body || {});
    if(sendTimedResult(res, result)) return;
    return res.status(201).json({ success:true, comment:result.comment });
  }catch(err){
    console.error('timed comment add error', err);
    return res.status(500).json({ error:'Timed comment failed' });
  }
});

app.patch('/api/timedComments/:commentId', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await TimedComments.editTimedComment(supabaseService, req.authUser.id, req.params.commentId, req.body || {});
    if(sendTimedResult(res, result)) return;
    return res.json({ success:true, comment:result.comment });
  }catch(err){
    console.error('timed comment edit error', err);
    return res.status(500).json({ error:'Timed comment edit failed' });
  }
});

app.delete('/api/timedComments/:commentId', requireAuth, async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{
    const result = await TimedComments.deleteTimedComment(supabaseService, req.authUser.id, req.params.commentId);
    if(sendTimedResult(res, result)) return;
    return res.json({ success:true, deleted:true, id:result.id });
  }catch(err){
    console.error('timed comment delete error', err);
    return res.status(500).json({ error:'Timed comment delete failed' });
  }
});

/* ================= Oct 20: lock-screen alerts, result reviews, my data ================= */
const PushAlerts = require('./push_alerts');
const ResultReviews = require('./result_reviews');
const AccountData = require('./account_data');
const { setPushHook } = require('./push_hook');
const pushSender = (() => { try{ return PushAlerts.createPushSender(process.env); }catch(err){ console.warn('Web push disabled:', err && err.message); return null; } })();
if(pushSender) setPushHook((client, row) => PushAlerts.deliverPush(client, row, pushSender));

function sendOct20Result(res, result){
  if(result.schemaMissing) return sendSchemaMissing(res, result);
  if(result.forbidden) return res.status(403).json({ error:'That result belongs to another DJ' });
  if(result.notFound) return res.status(404).json({ error:'Not found' });
  if(result.validationError) return res.status(422).json({ error:result.validationError });
  if(result.error) throw result.error;
  return null;
}
const oct20Route = (label, fn) => async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{ await fn(req, res); }catch(err){ console.error(`${label} error`, err); if(!res.headersSent) res.status(500).json({ error:`${label} failed` }); }
};

// Public: whether alerts are set up, and the PUBLIC VAPID key the browser needs to subscribe.
app.get('/api/push/config', (req, res) => res.json({ success:true, ...PushAlerts.publicStatus(process.env) }));
app.get('/api/push/subscriptions', requireAuth, oct20Route('Push devices', async (req, res) => {
  const r = await PushAlerts.listSubscriptions(supabaseService, req.authUser.id);
  if(sendOct20Result(res, r)) return;
  res.json({ success:true, subscriptions:r.subscriptions, ...PushAlerts.publicStatus(process.env) });
}));
app.post('/api/push/subscriptions', requireAuth, oct20Route('Push subscribe', async (req, res) => {
  if(!PushAlerts.vapidConfig(process.env).configured) return res.status(503).json({ error:'Lock-screen alerts are not set up on the server yet (VAPID keys missing)', pushNotConfigured:true });
  if(!guardProtectedWrite(req, res, 'pushSubscribe', { payload:{ userId:req.authUser.id }, fingerprintReplay:false, idempotencyReplay:false })) return;
  const r = await PushAlerts.saveSubscription(supabaseService, req.authUser.id, req.body || {});
  if(sendOct20Result(res, r)) return;
  res.status(r.created ? 201 : 200).json({ success:true, subscription:r.subscription });
}));
app.delete('/api/push/subscriptions', requireAuth, oct20Route('Push unsubscribe', async (req, res) => {
  const r = await PushAlerts.removeSubscription(supabaseService, req.authUser.id, (req.body || {}).endpoint);
  if(sendOct20Result(res, r)) return;
  res.json({ success:true, removed:true });
}));
app.post('/api/push/test', requireAuth, oct20Route('Push test', async (req, res) => {
  if(!pushSender) return res.status(503).json({ error:'Lock-screen alerts are not set up on the server yet (VAPID keys missing)', pushNotConfigured:true });
  const r = await PushAlerts.deliverPush(supabaseService, { user_id:req.authUser.id, type:'direct_message', actor_profile:{ displayName:'DJ Battle' }, destination:{ type:'messages' } }, pushSender);
  if(sendOct20Result(res, r)) return;
  res.json({ success:true, sent:r.sent || 0 });
}));

app.post('/api/battleResults/:submissionId/review', requireAuth, oct20Route('Review request', async (req, res) => {
  if(!guardProtectedWrite(req, res, 'resultReviewRequest', { payload:{ userId:req.authUser.id, submissionId:req.params.submissionId }, fingerprintReplay:false, idempotencyReplay:false })) return;
  const r = await ResultReviews.requestReview(supabaseService, req.authUser.id, req.params.submissionId, req.body || {});
  if(sendOct20Result(res, r)) return;
  res.status(r.created ? 201 : 200).json({ success:true, duplicate:Boolean(r.duplicate), review:r.review });
}));
app.get('/api/resultReviews/mine', requireAuth, oct20Route('My reviews', async (req, res) => {
  const r = await ResultReviews.listMyReviews(supabaseService, req.authUser.id);
  if(sendOct20Result(res, r)) return;
  res.json({ success:true, reviews:r.reviews, reasons:ResultReviews.REVIEW_REASONS });
}));
app.get('/api/operations/resultReviews', requireAuth, requireOperatorUser, oct20Route('Review queue', async (req, res) => {
  const r = await ResultReviews.listReviewQueue(supabaseService, req.query.status);
  if(sendOct20Result(res, r)) return;
  res.json({ success:true, reviews:r.reviews, reasons:r.reasons });
}));
app.post('/api/operations/resultReviews/:reviewId/decision', requireAuth, requireOperatorUser, oct20Route('Review decision', async (req, res) => {
  const r = await ResultReviews.decideReview(supabaseService, req.authUser.id, req.params.reviewId, req.body || {});
  if(sendOct20Result(res, r)) return;
  res.json({ success:true, review:r.review });
}));

app.get('/api/account/export', requireAuth, oct20Route('Data export', async (req, res) => {
  const r = await AccountData.exportAccountData(supabaseService, req.authUser);
  if(sendOct20Result(res, r)) return;
  res.set('Cache-Control', 'no-store');
  res.set('Content-Disposition', `attachment; filename="djb-my-data-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(r.file);
}));
app.get('/api/account/deletion', requireAuth, oct20Route('Deletion status', async (req, res) => {
  const r = await AccountData.getDeletion(supabaseService, req.authUser.id);
  if(sendOct20Result(res, r)) return;
  res.json({ success:true, deletion:r.deletion, confirmPhrase:AccountData.CONFIRM_PHRASE, graceDays:AccountData.GRACE_DAYS });
}));
app.post('/api/account/deletion', requireAuth, oct20Route('Delete account', async (req, res) => {
  if(!guardProtectedWrite(req, res, 'accountDeletion', { payload:{ userId:req.authUser.id }, fingerprintReplay:false, idempotencyReplay:false })) return;
  const r = await AccountData.requestDeletion(supabaseService, req.authUser.id, req.body || {});
  if(sendOct20Result(res, r)) return;
  res.status(r.created ? 201 : 200).json({ success:true, deletion:r.deletion });
}));
app.delete('/api/account/deletion', requireAuth, oct20Route('Cancel deletion', async (req, res) => {
  const r = await AccountData.cancelDeletion(supabaseService, req.authUser.id);
  if(sendOct20Result(res, r)) return;
  res.json({ success:true, cancelled:true });
}));
// Deletes accounts whose 7-day grace period is over. Checked hourly while the server runs.
if(process.env.NODE_ENV !== 'test' && supabaseService && typeof supabaseService.from === 'function'){
  const sweepDeletions = () => AccountData.runDueDeletions(supabaseService, supabaseService.auth && supabaseService.auth.admin, supabaseService.storage).catch(err => console.warn('account deletion sweep failed', err && err.message));
  const sweepTimer = setInterval(sweepDeletions, 60 * 60 * 1000);
  if(sweepTimer.unref) sweepTimer.unref();
  setTimeout(sweepDeletions, 30000).unref?.();
}

/* ================= Oct 20b: crews, tips, discount codes, who's watching ================= */
function sendOct20bResult(res, result){
  if(result.schemaMissing) return sendSchemaMissing(res, result);
  if(result.forbidden) return res.status(403).json({ error:'You can\u2019t do that' });
  if(result.notFound) return res.status(404).json({ error:'Not found' });
  if(result.validationError) return res.status(422).json({ error:result.validationError });
  if(result.providerUnavailable) return res.status(503).json({ error:'Stripe isn\u2019t set up on the server yet', paymentsNotConfigured:true });
  if(result.recipientUnavailable) return res.status(409).json({ error:'This DJ hasn\u2019t set up Stripe payouts yet, so they can\u2019t get tips' });
  if(result.error) throw result.error;
  return null;
}
const oct20bRoute = (label, fn) => async (req, res) => {
  if(!requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')) return;
  try{ await fn(req, res); }catch(err){ console.error(`${label} error`, err); if(!res.headersSent) res.status(500).json({ error:`${label} failed` }); }
};
const optionalAuthB = (req, res, next) => (req.get('Authorization') ? requireAuth(req, res, next) : next());
// Crews
app.get('/api/crews', optionalAuthB, oct20bRoute('Crew rankings', async (req, res) => {
  const r = await Crews.crewRankings(supabaseService, req.authUser && req.authUser.id, Number(req.query.limit) || 50);
  if(sendOct20bResult(res, r)) return; res.json({ success:true, crews:r.crews });
}));
app.get('/api/crews/mine', requireAuth, oct20bRoute('My crew', async (req, res) => {
  const r = await Crews.getMyCrew(supabaseService, req.authUser.id);
  if(sendOct20bResult(res, r)) return; res.json({ success:true, crew:r.crew, battles:r.battles || [] });
}));
app.get('/api/crews/:crewId', optionalAuthB, oct20bRoute('Crew page', async (req, res) => {
  const r = await Crews.loadCrew(supabaseService, req.params.crewId, req.authUser && req.authUser.id);
  if(sendOct20bResult(res, r)) return;
  const b = await Crews.listCrewBattles(supabaseService, r.row.id, req.authUser && req.authUser.id);
  res.json({ success:true, crew:r.crew, battles:b.battles || [] });
}));
app.post('/api/crews', requireAuth, oct20bRoute('Create crew', async (req, res) => {
  const r = await Crews.createCrew(supabaseService, req.authUser.id, req.body || {});
  if(sendOct20bResult(res, r)) return; res.status(201).json({ success:true, crew:r.crew });
}));
app.post('/api/crews/join', requireAuth, oct20bRoute('Join crew', async (req, res) => {
  const r = await Crews.joinCrew(supabaseService, req.authUser.id, req.body || {});
  if(sendOct20bResult(res, r)) return; res.json({ success:true, crew:r.crew });
}));
app.patch('/api/crews/:crewId', requireAuth, oct20bRoute('Edit crew', async (req, res) => {
  const r = await Crews.updateCrew(supabaseService, req.authUser.id, req.params.crewId, req.body || {});
  if(sendOct20bResult(res, r)) return; res.json({ success:true, crew:r.crew });
}));
app.post('/api/crews/:crewId/leave', requireAuth, oct20bRoute('Leave crew', async (req, res) => {
  const r = await Crews.leaveCrew(supabaseService, req.authUser.id, req.params.crewId);
  if(sendOct20bResult(res, r)) return; res.json({ success:true, left:true, disbanded:Boolean(r.disbanded) });
}));
app.delete('/api/crews/:crewId/members/:publicProfileId', requireAuth, oct20bRoute('Remove crew member', async (req, res) => {
  const r = await Crews.removeMember(supabaseService, req.authUser.id, req.params.crewId, String(req.params.publicProfileId));
  if(sendOct20bResult(res, r)) return; res.json({ success:true, crew:r.crew });
}));
app.post('/api/crewBattles', requireAuth, oct20bRoute('Crew challenge', async (req, res) => {
  const r = await Crews.challengeCrew(supabaseService, req.authUser.id, req.body || {});
  if(sendOct20bResult(res, r)) return; res.status(201).json({ success:true, battle:r.battle });
}));
app.post('/api/crewBattles/:battleId/respond', requireAuth, oct20bRoute('Crew battle answer', async (req, res) => {
  const r = await Crews.respondToCrewBattle(supabaseService, req.authUser.id, req.params.battleId, req.body || {});
  if(sendOct20bResult(res, r)) return; res.json({ success:true, battle:r.battle });
}));
app.post('/api/crewBattles/:battleId/submit', requireAuth, oct20bRoute('Crew battle mix', async (req, res) => {
  const r = await Crews.submitCrewBattleMix(supabaseService, req.authUser.id, req.params.battleId, req.body || {});
  if(sendOct20bResult(res, r)) return; res.json({ success:true, battle:r.battle });
}));
// Tips
app.get('/api/tips/config', (req, res) => res.json({ success:true, ...Tips.tipsStatus(process.env) }));
app.get('/api/tips/eligibility/:publicProfileId', oct20bRoute('Tip check', async (req, res) => {
  const r = await Tips.tipEligibility(supabaseService, req.params.publicProfileId);
  if(sendOct20bResult(res, r)) return; res.json({ success:true, canTip:r.canTip, ...Tips.tipsStatus(process.env) });
}));
app.post('/api/tips/checkout', requireAuth, oct20bRoute('Tip checkout', async (req, res) => {
  const r = await Tips.createTipCheckout(supabaseService, req.authUser.id, req.body || {});
  if(sendOct20bResult(res, r)) return; res.status(201).json({ success:true, tip:r.tip, checkout:{ provider:'stripe', redirectUrl:r.redirectUrl } });
}));
app.get('/api/tips/mine', requireAuth, oct20bRoute('My tips', async (req, res) => {
  const r = await Tips.listTips(supabaseService, req.authUser.id, { direction:req.query.direction === 'sent' ? 'sent' : 'received' });
  if(sendOct20bResult(res, r)) return; res.json({ success:true, totalCents:r.totalCents, tips:r.tips });
}));
// Discount codes
app.get('/api/marketplace/discountCodes', requireAuth, oct20bRoute('Discount codes', async (req, res) => {
  const r = await DiscountCodes.listCodes(supabaseService, req.authUser.id);
  if(sendOct20bResult(res, r)) return; res.json({ success:true, codes:r.codes });
}));
app.post('/api/marketplace/discountCodes', requireAuth, oct20bRoute('Create discount code', async (req, res) => {
  const r = await DiscountCodes.createCode(supabaseService, req.authUser.id, req.body || {});
  if(sendOct20bResult(res, r)) return; res.status(201).json({ success:true, code:r.code });
}));
app.patch('/api/marketplace/discountCodes/:codeId', requireAuth, oct20bRoute('Edit discount code', async (req, res) => {
  const r = await DiscountCodes.setCodeActive(supabaseService, req.authUser.id, req.params.codeId, req.body && req.body.active !== false);
  if(sendOct20bResult(res, r)) return; res.json({ success:true, code:r.code });
}));
app.post('/api/marketplace/listings/:listingId/discountPreview', oct20bRoute('Discount preview', async (req, res) => {
  const id = String(req.params.listingId || '').slice(0, 128);
  const l = await supabaseService.from('marketplace_listings').select('*').eq('id', id).limit(1);
  if(l.error) throw l.error;
  const listing = (l.data || [])[0];
  const r = await DiscountCodes.previewDiscount(supabaseService, { listing:listing && listing.status === 'published' ? listing : null, code:req.body && req.body.code });
  if(sendOct20bResult(res, r)) return; res.json({ success:true, preview:r.preview });
}));
// Who's watching
app.post('/api/marketplace/listings/:listingId/views', oct20bRoute('Listing view', async (req, res) => {
  const id = String(req.params.listingId || '').slice(0, 128);
  if(!/^[A-Za-z0-9._:-]{1,128}$/.test(id)) return res.status(404).json({ error:'Not found' });
  const l = await supabaseService.from('marketplace_listings').select('*').eq('id', id).limit(1);
  if(l.error) throw l.error;
  const listing = (l.data || [])[0];
  if(!listing || listing.status !== 'published') return res.status(404).json({ error:'Not found' });
  const visitor = String((req.body && req.body.visitorId) || req.ip || '').slice(0, 120);
  if(rateLimitedView(`${id}:${visitor}`)) return res.json({ success:true, duplicate:true });
  logViewQuietly(req, 'listing', id, listing.seller_user_id);
  res.json({ success:true, duplicate:false });
}));
const listingViewSeen = new Map();
function rateLimitedView(key, now = Date.now()){
  const last = listingViewSeen.get(key);
  if(last && now - last < 30 * 60 * 1000) return true;
  listingViewSeen.set(key, now);
  if(listingViewSeen.size > 20000) listingViewSeen.clear();
  return false;
}
app.get('/api/insights/views', requireAuth, oct20bRoute('Who\u2019s watching', async (req, res) => {
  const r = await ViewInsights.getInsights(supabaseService, req.authUser.id);
  if(sendOct20bResult(res, r)) return; res.json({ success:true, insights:r.insights });
}));

/* ================= Oct 20c: personal invite-a-friend links ================= */
const Invites = require('./invites');
function sendInviteResult(res, r){
  if(r.rateLimited) { res.status(429).json({ error:'Too many tries. Wait a minute and try again.' }); return true; }
  return Boolean(sendOct20bResult(res, r));
}
app.get('/api/invites/mine', requireAuth, oct20bRoute('My invite link', async (req, res) => {
  const r = await Invites.getMyInvite(supabaseService, req.authUser.id);
  if(sendInviteResult(res, r)) return; res.json({ success:true, invite:r.invite });
}));
app.post('/api/invites/claim', requireAuth, oct20bRoute('Invite claim', async (req, res) => {
  const r = await Invites.claimInvite(supabaseService, req.authUser, req.body || {});
  if(r.notNewAccount || r.alreadyCounted) return res.json({ success:true, claimed:false, reason:r.notNewAccount ? 'not_new_account' : 'already_counted' });
  if(sendInviteResult(res, r)) return; res.status(201).json({ success:true, claimed:true, inviter:r.inviter });
}));
app.get('/api/invites/:code', oct20bRoute('Invite link', async (req, res) => {
  const ip = String(req.ip || req.socket && req.socket.remoteAddress || 'anon');
  if(require('./social_helpers').rateLimited(`invite-lookup:${ip}`, Date.now(), 30, 60 * 1000)) return res.status(429).json({ error:'Too many tries' });
  const r = await Invites.lookupInvite(supabaseService, req.params.code);
  if(sendInviteResult(res, r)) return; res.json({ success:true, invite:r.invite });
}));

/* ================= Remix contests ================= */
const RemixContests = require('./remix_contests');
const remixStorage = () => supabaseService.storage.from(MIX_BUCKET);
function sendRemixResult(res, r){
  if(r.rateLimited) { res.status(429).json({ error:'Too many tries. Wait a bit and try again.' }); return true; }
  return Boolean(sendOct20bResult(res, r));
}
const remixRoute = (label, fn) => oct20bRoute(label, async (req, res) => { const r = await fn(req); if(sendRemixResult(res, r)) return; res.status(r.__status || 200).json({ success:true, ...r }); });
const viewer = req => req.authUser ? req.authUser.id : null;
app.get('/api/remix-contests', optionalAuthB, remixRoute('Remix contests', req => RemixContests.listContests(supabaseService, viewer(req))));
app.get('/api/remix-contests/champions', remixRoute('Remix champions', () => RemixContests.listChampions(supabaseService)));
app.get('/api/me/remix-contests', requireAuth, remixRoute('My remix wins', req => RemixContests.myRemixSummary(supabaseService, req.authUser.id)));
app.post('/api/remix-contests', requireAuth, remixRoute('Create remix contest', async req => ({ ...(await RemixContests.createContest(supabaseService, remixStorage(), req.authUser.id, req.body || {})), __status:201 })));
app.get('/api/remix-contests/:id', optionalAuthB, remixRoute('Remix contest', req => RemixContests.getContest(supabaseService, req.params.id, viewer(req))));
app.post('/api/remix-contests/:id/publish', requireAuth, remixRoute('Publish remix contest', req => RemixContests.publishContest(supabaseService, remixStorage(), req.authUser.id, req.params.id)));
app.patch('/api/remix-contests/:id', requireAuth, remixRoute('Edit remix contest', req => RemixContests.editContest(supabaseService, req.authUser.id, req.params.id, req.body || {})));
app.post('/api/remix-contests/:id/cancel', requireAuth, remixRoute('Cancel remix contest', req => RemixContests.cancelContest(supabaseService, req.authUser.id, req.params.id)));
app.post('/api/remix-contests/:id/parts/:partId/download', requireAuth, remixRoute('Download part', req => RemixContests.partDownload(supabaseService, remixStorage(), req.authUser.id, req.params.id, req.params.partId)));
app.post('/api/remix-contests/:id/entry', requireAuth, remixRoute('Send remix', req => RemixContests.startEntry(supabaseService, remixStorage(), req.authUser.id, req.params.id, req.body || {})));
app.post('/api/remix-contests/:id/entry/complete', requireAuth, remixRoute('Finish remix upload', req => RemixContests.completeEntry(supabaseService, remixStorage(), req.authUser.id, req.params.id)));
app.delete('/api/remix-contests/:id/entry', requireAuth, remixRoute('Withdraw remix', req => RemixContests.withdrawEntry(supabaseService, remixStorage(), req.authUser.id, req.params.id)));
app.post('/api/remix-contests/:id/entries/:entryId/play', optionalAuthB, remixRoute('Play remix', req => RemixContests.entryPlayback(supabaseService, remixStorage(), req.params.id, req.params.entryId, viewer(req))));
app.post('/api/remix-contests/:id/vote', requireAuth, remixRoute('Remix vote', req => RemixContests.castVote(supabaseService, req.authUser.id, req.params.id, req.body || {})));
app.post('/api/remix-contests/:id/store-offer', requireAuth, remixRoute('Beat Store request', req => RemixContests.offerStoreListing(supabaseService, req.authUser.id, req.params.id, req.body || {})));
app.post('/api/remix-contests/:id/store-consent', requireAuth, remixRoute('Beat Store answer', req => RemixContests.answerStoreOffer(supabaseService, req.authUser.id, req.params.id, req.body || {})));
app.post('/api/remix-contests/:id/store-listing', requireAuth, remixRoute('List winning remix', async req => ({ ...(await RemixContests.listWinnerInStore(supabaseService, req.authUser.id, req.params.id)), __status:201 })));
app.post('/api/remix-contests/entries/:entryId/moderate', requireAuth, requireOperatorUser, remixRoute('Moderate remix', req => RemixContests.moderateEntry(supabaseService, req.params.entryId, req.body || {})));
// Close contests whose voting ended (also done whenever someone opens them). Checked every 15 minutes.
if(process.env.NODE_ENV !== 'test' && supabaseService && typeof supabaseService.from === 'function'){
  const remixTimer = setInterval(() => RemixContests.sweepDueContests(supabaseService).catch(err => console.warn('remix contest sweep failed', err && err.message)), 15 * 60 * 1000);
  if(remixTimer.unref) remixTimer.unref();
}

// Serve the static front end (index.html, app.js, CSS) from the same origin unless SERVE_FRONTEND=false.
if(shouldServeFrontend()) app.use(createFrontendRouter());

const PORT = process.env.PORT || 4000;

// Create HTTP server and attach WebSocket server for DJ Bridge
const server = http.createServer(app);
server.listen(PORT, ()=>console.log(`Server listening on http://localhost:${PORT}`));
if(submissionJudgeRunner.status().enabled){
  submissionJudgeRunner.start();
  console.log('Submission judging runner enabled');
}

let shutdownStarted = false;
async function shutdown(signal){
  if(shutdownStarted) return;
  shutdownStarted = true;
  console.log(`${signal} received, shutting down server`);
  await submissionJudgeRunner.stop();
  server.close(() => process.exit(0));
  const forceExit = setTimeout(() => process.exit(1), 5000);
  if(forceExit && typeof forceExit.unref === 'function') forceExit.unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// WebSocket server for DJ Battle Bridge clients
try{
  const WebSocket = require('ws');
  const wss = new WebSocket.Server({
    server,
    path: '/bridge',
    maxPayload: LIMITS.webSocketMessageBytes,
    verifyClient: (info, done) => {
      authenticateWebSocketRequest(info.req, supabase)
        .then(result => {
          if(!result.ok) return done(false, result.statusCode, result.reason);
          info.req.authUser = result.user;
          info.req.authUserId = result.userId;
          return done(true);
        })
        .catch(() => done(false, 401, 'Invalid access token'));
    }
  });

  // Live telemetry WebSocket server for dashboards / judge UIs
  const wssLive = new WebSocket.Server({ server, path: '/live', maxPayload: LIMITS.webSocketMessageBytes });
  wssLive.on('connection', (ws) => {
    console.log('Live telemetry client connected');
    ws.send(JSON.stringify({ type: 'welcome', ts: Date.now() }));
    ws.on('close', ()=>console.log('Live telemetry client disconnected'));
  });

  const storageDir = path.join(__dirname, 'bridge_data');
  if(!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });

  wss.on('connection', (ws, req) => {
    console.log('Bridge connected from', req.socket.remoteAddress);

    // Per-connection storage accounting for telemetry/audio persisted while online.
    const connBuf = { telemetryCount: 0, storageBytes: 0 };

    function rejectIngestion(error, closeCode){
      try{ if(ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', error })); }catch(e){}
      if(closeCode && ws.readyState === WebSocket.OPEN) ws.close(closeCode, error);
    }

    function persistJson(prefix, data){
      const saved = persistJsonPayload({ storageDir, prefix, data, currentUsageBytes: connBuf.storageBytes, limits: LIMITS });
      if(saved.error){
        rejectIngestion(saved.error, saved.error.includes('quota') ? 1009 : null);
        return null;
      }
      connBuf.storageBytes = saved.nextUsageBytes;
      return saved;
    }

    ws.on('message', (msg, isBinary) => {
      const messageValidation = validateWebSocketMessage(msg, LIMITS);
      if(messageValidation.error){
        rejectIngestion(messageValidation.error, 1009);
        return;
      }

      // Expect JSON messages or binary audio blobs. We attempt to parse JSON first.
      if(!isBinary){
        const text = Buffer.isBuffer(msg) ? msg.toString('utf8') : String(msg);
        let data = null;
        try{ data = JSON.parse(text); }catch(e){ console.warn('Non-JSON string message from bridge'); }
        if(data){
          const ownerCheck = validateBridgeUserId(data, req.authUserId);
          if(ownerCheck.error){
            rejectIngestion(ownerCheck.error, 1008);
            return;
          }

          const t = data.type || 'unknown';
          // Store telemetry messages to disk with timestamp
            if(t === 'telemetry'){
              const saved = persistJson('telemetry', data);
              if(!saved) return;
              connBuf.telemetryCount += 1;

              // If Supabase service key available, persist telemetry events for Mode 1 scoring
              try{
                if(supabaseService && data.events && Array.isArray(data.events) && data.events.length>0){
                  const rows = data.events.map(ev=>({
                    user_id: req.authUserId,
                    session_id: data.sessionId || data.session_id || data.raceId || null,
                    battle_id: data.battleId || null,
                    timestamp: ev.timestamp ? new Date(ev.timestamp).toISOString() : new Date().toISOString(),
                    event_type: ev.event || data.event || 'unknown',
                    payload: ev
                  }));
                  supabaseService.from('telemetry_events').insert(rows).then(r=>{ if(r.error) console.error('telemetry insert err', r.error); }).catch(e=>console.error('telemetry insert catch', e));
                }
              }catch(e){ console.warn('telemetry persist failed', e); }
              // Broadcast telemetry to live clients
              try{
                const msg = JSON.stringify({ type: 'telemetry', ts: Date.now(), data });
                wssLive.clients.forEach(c=>{ if(c.readyState === WebSocket.OPEN) c.send(msg); });
              }catch(e){ console.warn('live broadcast failed', e); }
            } else if(t === 'status'){
            console.log('Bridge status:', data);
          } else if(t === 'ping'){
            // simple ping/pong for latency calibration
            ws.send(JSON.stringify({ type: 'pong', ts: data.ts }));
          } else if(t === 'finalize'){
            // finalize and persist connBuf
            const out = { finalizedAt: Date.now(), meta: data.meta||{}, telemetry: connBuf.telemetryCount };
            const saved = persistJson('finalized', out);
            if(saved) console.log('Bridge finalized:', saved.path);
          } else {
            // generic store
            persistJson('msg', data);
          }
        }
      } else {
        // binary audio chunk: write to file
        const payload = Buffer.isBuffer(msg) ? msg : Array.isArray(msg) ? Buffer.concat(msg.map(part => Buffer.from(part))) : Buffer.from(msg);
        const saved = persistIngestionBuffer({
          storageDir,
          prefix: 'audio',
          extension: 'webm',
          buffer: payload,
          currentUsageBytes: connBuf.storageBytes,
          limits: LIMITS,
          mimeType: 'audio/webm'
        });
        if(saved.error){
          rejectIngestion(saved.error, saved.error.includes('quota') || saved.error.includes('size') ? 1009 : null);
          return;
        }
        connBuf.storageBytes = saved.nextUsageBytes;
        console.log('Saved audio chunk', saved.path);
      }
    });

    ws.on('close', ()=>{
      console.log('Bridge disconnected');
    });
  });
}catch(err){
  console.warn('WebSocket server optional dependency not available:', err.message);
}
