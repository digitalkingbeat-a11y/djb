const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function loadAppDom(url = 'http://127.0.0.1/index.html'){
  const root = path.join(__dirname, '..');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(index, {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });

  const { window } = dom;
  window.alert = () => {};
  window.scrollTo = () => {};
  const errors = [];
  window.addEventListener('error', event => errors.push(event.error || event.message));
  window.HTMLDialogElement.prototype.showModal = function showModal(){ this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function close(){ this.removeAttribute('open'); };

  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'].forEach(file => {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });

  return { window, errors };
}

function judgeResult(overrides = {}){
  return {
    overallScore: 93,
    won: true,
    opponentScore: 86,
    breakdown: {
      timing: { available:true, score:94 },
      transition_quality: { available:true, score:91 },
      harmonic_compatibility: { available:true, score:88 }
    },
    timing: [{ label:'Measured Transition 1', timeMs:18000 }],
    rawMeasurements: [{ index:0, actualSec:18 }],
    measurableAnalysis: {
      durationSec: 90,
      bpm: 128,
      key: { name:'A minor' },
      transitionCount: 3
    },
    confidence: {
      measurableComponentRatio: 0.8,
      trainedModelJudging: { used:false, status:'future_not_used' }
    },
    recommendations: ['Tighten the second transition.'],
    scoringModel: {
      measurableAnalysis:'ffmpeg_audio_analyzer',
      ruleBasedScoring:'judge_engine',
      trainedModelJudging:'not_used'
    },
    evidenceType:'measurable_audio_rule_based',
    explanation:'Measured audio analysis scored by deterministic rules.',
    ...overrides
  };
}

function addBattle(window, overrides = {}){
  const created = window.DJBattleModes.createBattleRecord({
    id:'history-battle',
    modeId:'bitcoin_battle',
    genre:'Bass House',
    title:'Bitcoin Throwdown',
    status:'submission_pending',
    reward:{ type:'bitcoin', metadata:{ network:'bitcoin', custody:'external_pending', walletConnected:false, amountSats:2500 } },
    rewardType:'bitcoin',
    assignedTracks:['Platform Beat 001','Platform Loop 02'],
    participants:[
      { userId:'local-profile-digital-king', name:'Digital King', status:'submitted', submissionId:'sub-history' },
      { userId:'opponent-1', name:'Rival DJ', country:'CA', status:'submitted' }
    ],
    ...overrides
  }, { requireAssignedTracks:false });
  assert.ifError(created.error);
  window.__DJBattleTestHooks.getBattles().unshift(created.battle);
  return created.battle;
}

function nextTick(){
  return new Promise(resolve => setTimeout(resolve, 0));
}

function rankingDetailPayload(overrides = {}){
  const category = overrides.category || 'competitive_battles';
  return {
    success:true,
    detail:{
      scope:'owned',
      profile:{ djName:'Digital King', displayName:'Digital King', country:'US', belt:'Blue' },
      category,
      categoryLabel:category === 'bitcoin_battles' ? 'Bitcoin Battles' : 'Global Competitive',
      source:'award_ledger',
      calculationVersion:'public-ledger-leaderboards-v1',
      current:overrides.current || { rank:4, previousRank:8, movement:4, movementStatus:'up', rating:1812, previousRating:1770, qualifyingBattles:3, eligibleRecord:{ wins:2, losses:1, ties:0 }, publishedSnapshot:{ rank:4, previousRank:8, movement:4, publishedAt:'2026-08-27T12:00:00.000Z', calculationVersion:'public-ledger-leaderboards-v1' } },
      eligibility:overrides.eligibility || { status:'provisional', qualifyingBattleCount:2, requiredBattles:3, remainingBattles:1, blockers:['insufficient_eligible_battles'], source:'battle_progression_awards' },
      beltProgression:overrides.beltProgression || { currentXp:930, currentBelt:'Blue', nextBelt:'Purple', nextThresholdXp:1300, remainingXp:370, ruleVersion:'xp-belts-v1', promotions:[{ from:'Green', to:'Blue', awardedAt:'2026-08-26T12:00:00.000Z', xpAfter:930 }] },
      movementHistory:overrides.movementHistory || [
        { historyId:'rh-owned-1', rankingPeriod:'2026-08-27T12:00:00.000Z', rank:4, previousRank:8, movement:4, ratingBefore:1770, ratingAfter:1812, calculationVersion:'public-ledger-leaderboards-v1' }
      ],
      qualifyingBattles:overrides.qualifyingBattles || [
        { battleRef:'qb-owned-1', score:93, result:{ submissionId:'sub-history', verifiedResultId:'vr_ownedimpact0000000', verifiedResultUrl:'/results/vr_ownedimpact0000000', battle:{ title:'Bitcoin Throwdown' }, outcome:'win', progression:{ ratingDelta:12 }, reward:{ type:'bitcoin', transferStatus:'untransferred' } } }
      ],
      pagination:overrides.pagination || { cursor:null, nextCursor:null, limit:10, total:1, hasMore:false }
    }
  };
}

test('Battle History tab renders completed result details and syncs through the server result contract', async () => {
  const { window, errors } = loadAppDom();
  const calls = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    calls.push({ url, options });
    if(options.method === 'POST'){
      return {
        status:200,
        data:{
          result:{
            submissionId:'sub-history',
            visibility:'private',
            verifiedResultId:'vr_1234567890abcdef1234',
            profile:{ country:'US' }
          }
        }
      };
    }
    return { status:200, data:{ success:true } };
  };

  const battle = addBattle(window);
  const completed = window.__DJBattleTestHooks.completeBattleWithJudgeResult(
    { id:battle.id, battleId:battle.id, participants:battle.participants, status:'submission_pending', submissionId:'sub-history' },
    judgeResult(),
    'sub-history'
  );
  await nextTick();
  window.__DJBattleTestHooks.setProfileTab('history');

  const text = window.document.getElementById('profile-media').textContent;
  assert.ifError(completed.error);
  assert.match(text, /Bitcoin Throwdown/);
  assert.match(text, /Bass House/);
  assert.match(text, /Rival DJ/);
  assert.match(text, /Win/);
  assert.match(text, /93\/100/);
  assert.match(text, /XP\+\d+/);
  assert.match(text, /Bitcoin reward metadata: 2500 sats, untransferred/);
  assert.match(text, /measured/);
  assert.match(text, /rule-based/);
  assert.match(text, /hybrid/);

  const post = calls.find(call => call.url === '/api/battleResults/sub-history' && call.options.method === 'POST');
  assert.ok(post);
  assert.equal(post.options.body.visibility, 'private');
  assert.equal(post.options.body.genre, 'Bass House');
  assert.doesNotMatch(JSON.stringify(post.options.body), /private\/battle-entries|service_key|storage_object_path/);
  assert.deepEqual(errors, []);
});

test('Battle History filters by battle mode, genre, result, opponent status and date', () => {
  const { window } = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  const battle = addBattle(window);
  hooks.completeBattleWithJudgeResult(
    { id:battle.id, battleId:battle.id, participants:battle.participants, status:'submission_pending', submissionId:'sub-history-filter' },
    judgeResult(),
    'sub-history-filter'
  );
  hooks.getBattleResults().push({
    resultKey:'practice:sub-old',
    submissionId:'sub-old',
    title:'Old AI Practice',
    modeId:'ai_only_practice',
    type:'AI Practice',
    genre:'Open Format',
    outcome:'practice',
    score:77,
    opponent:{ status:'ai_only', name:'AI-only practice' },
    completedAt:'2024-01-01T00:00:00.000Z',
    progression:{ xp:25, ratingDelta:0 },
    progressBefore:{ belt:'White', rankingRating:1600 },
    progressAfter:{ belt:'White', rankingRating:1600 },
    sourceLabels:['measured','rule-based'],
    visibility:'private',
    userId:'local-profile-digital-king'
  });

  assert.equal(hooks.filterBattleHistoryResults(hooks.getBattleResults(), { mode:'bitcoin_battle', genre:'Bass House', result:'win', opponent:'opponent', date:'30d' }).length, 1);
  assert.equal(hooks.filterBattleHistoryResults(hooks.getBattleResults(), { mode:'ai_only_practice', genre:'Open Format', result:'practice', opponent:'ai_only', date:'year' }).length, 0);
});

test('completed history results can be reopened with original evidence and recommendations', () => {
  const { window } = loadAppDom();
  const battle = addBattle(window);
  window.__DJBattleTestHooks.completeBattleWithJudgeResult(
    { id:battle.id, battleId:battle.id, participants:battle.participants, status:'submission_pending', submissionId:'sub-history-open' },
    judgeResult(),
    'sub-history-open'
  );

  assert.equal(window.__DJBattleTestHooks.openBattleHistoryResult('history-battle:sub-history-open'), true);
  const text = window.document.getElementById('modal-content').textContent;
  assert.match(text, /Timing, key and transition evidence/);
  assert.match(text, /A minor/);
  assert.match(text, /Original category breakdown/);
  assert.match(text, /Tighten the second transition/);
  assert.match(text, /Secure playback stays on-site/);
  assert.match(text, /Public download links are not created/);
});

test('visibility control creates a verified public URL and can return a result to private', async () => {
  const { window } = loadAppDom();
  const calls = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    calls.push({ url, options });
    return {
      status:200,
      data:{
        result:{
          submissionId:'sub-history-share',
          visibility:options.body.visibility,
          verifiedResultId:'vr_abcdef1234567890abcd',
          profile:{ country:'US' }
        }
      }
    };
  };
  const battle = addBattle(window);
  window.__DJBattleTestHooks.completeBattleWithJudgeResult(
    { id:battle.id, battleId:battle.id, participants:battle.participants, status:'submission_pending', submissionId:'sub-history-share' },
    judgeResult(),
    'sub-history-share'
  );
  await nextTick();
  await window.__DJBattleTestHooks.toggleBattleResultVisibility('history-battle:sub-history-share');
  window.__DJBattleTestHooks.setProfileTab('history');

  assert.equal(calls.some(call => call.url === '/api/battleResults/sub-history-share/visibility' && call.options.body.visibility === 'public'), true);
  assert.match(window.document.getElementById('profile-media').textContent, /Public verified/);
  assert.match(window.document.getElementById('profile-media').textContent, /#result=vr_abcdef1234567890abcd/);

  await window.__DJBattleTestHooks.toggleBattleResultVisibility('history-battle:sub-history-share');
  assert.equal(calls.some(call => call.url === '/api/battleResults/sub-history-share/visibility' && call.options.body.visibility === 'private'), true);
});

test('public verified result renderer displays approved fields and redacts private internals', () => {
  const { window } = loadAppDom();
  window.__DJBattleTestHooks.renderPublicVerifiedResultProfile({
    id:'vr_abcdef1234567890abcd',
    verifiedResultId:'vr_abcdef1234567890abcd',
    battle:{ title:'Public Result', type:'Transition Battle', genre:'EDM' },
    profile:{ displayName:'Digital King', country:'US' },
    opponent:{ status:'opponent', name:'Rival DJ', country:'CA' },
    score:89,
    outcome:'win',
    reward:{ type:'bitcoin', metadata:{ amountSats:1500, custody:'external_pending' }, transferStatus:'untransferred' },
    scoringSource:['measured','rule-based','hybrid'],
    evidence:{ breakdown:{ timing:89 }, recommendations:['Keep the blend clean.'] },
    storage_object_path:'private/battle-entries/entry/submissions/sub/mix.webm',
    processing_info:{ service_key:'secret' }
  });

  const text = window.document.getElementById('modal-content').textContent;
  assert.match(text, /Public Result/);
  assert.match(text, /Digital King/);
  assert.match(text, /US/);
  assert.match(text, /1500 sats, untransferred/);
  assert.doesNotMatch(text, /private\/battle-entries|service_key|secret|mix\.webm/);
});

test('public verified result loader handles private and unavailable results cleanly', async () => {
  const { window } = loadAppDom();
  const requested = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    requested.push({ url, options });
    return { status:403, error:'Battle result is private' };
  };

  await window.__DJBattleTestHooks.loadPublicVerifiedResult('vr_abcdef1234567890abcd');
  assert.equal(requested[0].url, '/api/publicBattleResults/vr_abcdef1234567890abcd');
  assert.equal(requested[0].options.public, true);
  assert.match(window.document.getElementById('modal-content').textContent, /This result is private/);
});

test('private profile progression history loads authenticated ranking detail with category filtering', async () => {
  const { window } = loadAppDom();
  const requested = [];
  window.DJBattleApi.apiRequest = async (url) => {
    requested.push(url);
    if(url.startsWith('/api/myRankings/history?')){
      const category = new URL(`http://local${url}`).searchParams.get('category') || 'competitive_battles';
      return { status:200, data:rankingDetailPayload({ category }) };
    }
    return { status:200, data:{} };
  };

  window.__DJBattleTestHooks.setProfileTab('progression');
  await nextTick();
  await nextTick();
  let text = window.document.getElementById('profile-media').textContent;

  assert.ok(requested.some(url => /^\/api\/myRankings\/history\?category=competitive_battles/.test(url)));
  assert.match(text, /PRIVATE PROGRESSION HISTORY/);
  assert.match(text, /#4/);
  assert.match(text, /provisional/i);
  assert.match(text, /Insufficient Eligible Battles/i);
  assert.match(text, /Green -> Blue/);
  assert.match(text, /Bitcoin metadata: untransferred/);
  assert.doesNotMatch(text, /storage|signedurl|service_role|private\/battle-entries/i);

  window.document.querySelector('[data-profile-ranking-scope="private"][data-profile-ranking-category="bitcoin_battles"]').click();
  await nextTick();
  await nextTick();
  assert.ok(requested.some(url => /category=bitcoin_battles/.test(url)));
  assert.equal(window.__DJBattleTestHooks.getProfileRankingState().private.category, 'bitcoin_battles');
});

test('private profile progression preserves stale safe detail and dedupes pagination', async () => {
  const { window } = loadAppDom();
  let fail = false;
  const requested = [];
  window.DJBattleApi.apiRequest = async (url) => {
    requested.push(url);
    if(fail) return { status:503, error:'Ranking history temporarily unavailable' };
    const params = new URL(`http://local${url}`).searchParams;
    if(params.get('cursor') === 'cursor_1'){
      return { status:200, data:rankingDetailPayload({
        movementHistory:[{ historyId:'rh-owned-1', rankingPeriod:'2026-08-27T12:00:00.000Z', rank:4, previousRank:8, movement:4, ratingBefore:1770, ratingAfter:1812 }],
        qualifyingBattles:[{ battleRef:'qb-owned-2', score:90, title:'Second qualifying battle', outcome:'win', progression:{ ratingDelta:7 } }],
        pagination:{ cursor:'cursor_1', nextCursor:null, limit:1, total:2, hasMore:false }
      }) };
    }
    return { status:200, data:rankingDetailPayload({ pagination:{ cursor:null, nextCursor:'cursor_1', limit:1, total:2, hasMore:true } }) };
  };

  await window.__DJBattleTestHooks.loadPrivateProfileRankingDetail('competitive_battles');
  await window.__DJBattleTestHooks.loadPrivateProfileRankingDetail('competitive_battles', { append:true });
  fail = true;
  await window.__DJBattleTestHooks.loadPrivateProfileRankingDetail('competitive_battles');

  const state = window.__DJBattleTestHooks.getProfileRankingState().private;
  const text = window.document.getElementById('profile-media').textContent;
  assert.equal(state.status, 'stale');
  assert.equal(state.data.movementHistory.length, 1);
  assert.equal(state.data.qualifyingBattles.length, 2);
  assert.match(text, /Ranking history temporarily unavailable/);
  assert.match(text, /Second qualifying battle/);
  assert.ok(requested.some(url => /cursor=cursor_1/.test(url)));
});

test('Battle History ranking impact opens the private profile progression state', async () => {
  const { window } = loadAppDom();
  const requested = [];
  window.DJBattleApi.apiRequest = async (url) => {
    requested.push(url);
    if(url.startsWith('/api/myRankings/history?')) return { status:200, data:rankingDetailPayload({ category:'bitcoin_battles' }) };
    return { status:200, data:{} };
  };
  const battle = addBattle(window);
  window.__DJBattleTestHooks.completeBattleWithJudgeResult(
    { id:battle.id, battleId:battle.id, participants:battle.participants, status:'submission_pending', submissionId:'sub-history-impact' },
    judgeResult(),
    'sub-history-impact'
  );
  window.__DJBattleTestHooks.setProfileTab('history');

  assert.equal(window.__DJBattleTestHooks.openPrivateRankingImpactFromResult('history-battle:sub-history-impact'), true);
  await nextTick();
  await nextTick();

  assert.ok(requested.some(url => /category=bitcoin_battles/.test(url)));
  assert.match(window.document.getElementById('profile-media').textContent, /PRIVATE PROGRESSION HISTORY/);
  assert.match(window.location.hash, /tab=progression/);
});
