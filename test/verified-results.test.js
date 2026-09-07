const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function loadAppDom(){
  const root = path.join(__dirname, '..');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(index, {
    url: 'http://127.0.0.1/index.html',
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
    overallScore: 92,
    won: true,
    opponentScore: 84,
    breakdown: {
      timing: { available:true, score:92 },
      transition_quality: { available:true, score:90 },
      harmonic_compatibility: { available:true, score:88 }
    },
    timing: [{ label:'Measured Transition 1', timeMs:17000 }],
    measurableAnalysis: {
      durationSec: 88,
      bpm: 128,
      key: { name:'A minor' },
      transitionCount: 2
    },
    confidence: {
      measurableComponentRatio: 0.8,
      trainedModelJudging: { used:false }
    },
    recommendations: ['Keep the blend clean.'],
    scoringModel: {
      measurableAnalysis:'ffmpeg_audio_analyzer',
      ruleBasedScoring:'judge_engine',
      trainedModelJudging:'not_used'
    },
    evidenceType:'measurable_audio_rule_based',
    ...overrides
  };
}

function completePublicResult(window, options = {}){
  const hooks = window.__DJBattleTestHooks;
  const id = options.id || `verified-${Math.random().toString(16).slice(2)}`;
  const modeId = options.modeId || 'transition_battle';
  const opponentRequired = options.opponentRequirement || (modeId === 'ai_only_practice' ? 'none' : 'required');
  const participants = opponentRequired === 'none'
    ? [{ userId:'local-profile-digital-king', name:'Digital King', status:'submitted', submissionId:`sub-${id}` }]
    : [
      { userId:'local-profile-digital-king', name:'Digital King', status:'submitted', submissionId:`sub-${id}` },
      { userId:`opponent-${id}`, name:options.opponentName || 'Rival DJ', country:options.opponentCountry || 'CA', status:'submitted' }
    ];
  const created = window.DJBattleModes.createBattleRecord({
    id,
    modeId,
    title:options.title || 'Verified Battle',
    genre:options.genre || 'Bass House',
    status:'submission_pending',
    opponentRequirement:opponentRequired,
    reward:options.reward || { type:'standard', metadata:{} },
    rewardType:options.reward && options.reward.type || 'standard',
    participants,
    assignedTracks:['Platform Beat 001','Platform Loop 02']
  }, { requireAssignedTracks:false });
  assert.ifError(created.error);
  hooks.getBattles().unshift(created.battle);
  const completed = hooks.completeBattleWithJudgeResult(
    { id, battleId:id, participants, status:'submission_pending', submissionId:`sub-${id}` },
    judgeResult(options.judge || {}),
    `sub-${id}`
  );
  assert.ifError(completed.error);
  const record = hooks.getBattleResults().find(item => item.resultKey === `${id}:sub-${id}`);
  Object.assign(record, {
    visibility:options.visibility || 'public',
    verifiedResultId:options.verifiedResultId || `vr_${String(id).replace(/[^a-z0-9]/gi,'').padEnd(20,'0').slice(0,20)}`,
    verifiedResultUrl:null,
    profile:{ displayName:options.djName || 'Digital King', country:options.country || 'US', publicProfileId:options.publicProfileId || `dj-${id}` },
    country:options.country || 'US',
    belt:options.belt || record.progressAfter.belt || 'White',
    ratingMovement:options.ratingMovement == null ? record.progression.ratingDelta : options.ratingMovement,
    viewCount:Number(options.viewCount || 0),
    deleted:options.deleted || false,
    unavailable:options.unavailable || false,
    securePlaybackUrl:options.securePlaybackUrl || null,
    storage_object_path:'private/battle-entries/entry/submissions/sub/mix.webm',
    processing_info:{ service_key:'secret' }
  });
  if(options.completedAt) record.completedAt = options.completedAt;
  return record;
}

function nextTick(){
  return new Promise(resolve => setTimeout(resolve, 0));
}

function rankingDetailPayload(overrides = {}){
  const category = overrides.category || 'competitive_battles';
  return {
    success:true,
    detail:{
      scope:overrides.scope || 'public',
      profile:overrides.profile || { publicProfileId:'dj_abcdef1234567890', djName:'Server DJ', displayName:'Server DJ', country:'US', countryCode:'US', belt:'Blue', profileVisibility:'public' },
      category,
      categoryLabel:category === 'transition_battles' ? 'Transition Battles' : 'Global Competitive',
      source:'award_ledger',
      calculationVersion:'public-ledger-leaderboards-v1',
      current:overrides.current || { rank:2, previousRank:5, movement:3, movementStatus:'up', rating:1810, previousRating:1775, belt:'Blue', qualifyingBattles:3, eligibleRecord:{ wins:2, losses:1, ties:0 }, publishedSnapshot:{ rank:2, previousRank:5, movement:3, publishedAt:'2026-08-27T12:00:00.000Z', calculationVersion:'public-ledger-leaderboards-v1' } },
      eligibility:overrides.eligibility || { status:'fully_ranked', qualifyingBattleCount:3, requiredBattles:3, remainingBattles:0, blockers:[], source:'battle_progression_awards' },
      beltProgression:overrides.beltProgression || { currentXp:920, currentBelt:'Blue', nextBelt:'Purple', nextThresholdXp:1300, remainingXp:380, ruleVersion:'xp-belts-v1', promotions:[{ from:'Green', to:'Blue', awardedAt:'2026-08-26T12:00:00.000Z', xpAfter:920 }] },
      movementHistory:overrides.movementHistory || [
        { historyId:'rh-current', rankingPeriod:'2026-08-27T12:00:00.000Z', rank:2, previousRank:5, movement:3, movementStatus:'up', ratingBefore:1775, ratingAfter:1810, calculationVersion:'public-ledger-leaderboards-v1' }
      ],
      qualifyingBattles:overrides.qualifyingBattles || [
        { battleRef:'qb-public', score:96, result:{ verifiedResultId:'vr_profileimpact000000', verifiedResultUrl:'/results/vr_profileimpact000000', battle:{ title:'Profile Finals', type:'Transition Battle' }, outcome:'win', progression:{ ratingDelta:18 }, reward:{ type:'standard' } } },
        { battleRef:'qb-private', private:true, title:'Private qualifying battle', score:88, outcome:'win', progression:{ ratingDelta:8 }, scoringSource:['measured','rule-based'] }
      ],
      pagination:overrides.pagination || { cursor:null, nextCursor:null, limit:10, total:2, hasMore:false }
    }
  };
}

test('Verified Results page lists only public verified rows and redacts private internals', async () => {
  const { window, errors } = loadAppDom();
  completePublicResult(window, {
    id:'public-bitcoin',
    title:'Public Bitcoin Battle',
    modeId:'bitcoin_battle',
    reward:{ type:'bitcoin', metadata:{ amountSats:2500, custody:'external_pending' } },
    country:'US',
    belt:'Yellow',
    ratingMovement:18
  });
  completePublicResult(window, { id:'private-result', title:'Private Result', visibility:'private', country:'GB' });
  completePublicResult(window, { id:'deleted-result', title:'Deleted Result', deleted:true, country:'US' });

  await window.__DJBattleTestHooks.loadVerifiedResultsDiscovery();
  window.__DJBattleTestHooks.switchView('verified-results');
  const text = window.document.getElementById('verified-results-list').textContent;

  assert.match(text, /Public Bitcoin Battle/);
  assert.match(text, /Digital King \(US\)/);
  assert.match(text, /Bitcoin reward metadata: 2500 sats, untransferred/);
  assert.match(text, /measured/);
  assert.match(text, /rule-based/);
  assert.match(text, /hybrid/);
  assert.doesNotMatch(text, /Private Result|Deleted Result|private\/battle-entries|service_key|secret/);
  assert.deepEqual(errors, []);
});

test('Verified Results filters, sorts and paginates bounded public history', async () => {
  const { window } = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.getVerifiedDiscoveryState().pageSize = 2;
  completePublicResult(window, { id:'us-transition', title:'US Transition', modeId:'transition_battle', genre:'Bass House', country:'US', belt:'Yellow', ratingMovement:8, judge:{ overallScore:88 } });
  completePublicResult(window, { id:'ca-scratch', title:'CA Scratch', modeId:'scratching_battle', genre:'Scratch', country:'CA', belt:'White', ratingMovement:26, judge:{ overallScore:96 } });
  completePublicResult(window, { id:'us-mix', title:'US Mix', modeId:'five_song_mix_battle', genre:'Hip-Hop', country:'US', belt:'Green', ratingMovement:14, judge:{ overallScore:91 } });

  hooks.setVerifiedDiscoveryFilters({ country:'US', mode:'all', genre:'all', source:'all', belt:'all', opponent:'opponent', date:'all' });
  hooks.setVerifiedDiscoverySort('rating_movement');
  await hooks.loadVerifiedResultsDiscovery();
  assert.equal(hooks.getVerifiedDiscoveryState().pagination.total, 2);
  assert.equal(hooks.getVerifiedDiscoveryState().results[0].title, 'US Mix');

  hooks.setVerifiedDiscoveryFilters({ country:'all', mode:'all', genre:'all', source:'all', belt:'all', opponent:'opponent', date:'all' });
  hooks.setVerifiedDiscoverySort('highest_score');
  await hooks.loadVerifiedResultsDiscovery();
  assert.equal(hooks.getVerifiedDiscoveryState().results.length, 2);
  assert.equal(hooks.getVerifiedDiscoveryState().pagination.hasMore, true);
  assert.equal(hooks.getVerifiedDiscoveryState().results[0].title, 'CA Scratch');

  await hooks.loadVerifiedResultsDiscovery({ append:true });
  assert.equal(hooks.getVerifiedDiscoveryState().results.length, 3);
});

test('Verified rankings group by country and category while preventing duplicates', async () => {
  const { window } = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  const bitcoin = completePublicResult(window, {
    id:'rank-bitcoin',
    title:'Rank Bitcoin',
    modeId:'bitcoin_battle',
    reward:{ type:'bitcoin', metadata:{ amountSats:1000, custody:'external_pending' } },
    country:'US',
    ratingMovement:18
  });
  completePublicResult(window, {
    id:'rank-practice',
    title:'Rank Practice',
    modeId:'ai_only_practice',
    opponentRequirement:'none',
    country:'CA',
    ratingMovement:0,
    judge:{ overallScore:98, won:null, opponentScore:null }
  });
  hooks.getBattleResults().push({ ...bitcoin });
  await hooks.loadVerifiedResultsDiscovery();

  const rankings = hooks.buildVerifiedPublicRankings(hooks.getVerifiedDiscoveryState().results);
  assert.equal(rankings.categories.competitive_battles.rows[0].resultCount, 1);
  assert.equal(rankings.categories.competitive_battles.rows[0].country, 'US');
  assert.equal(rankings.categories.bitcoin_battles.rows[0].djName, 'Digital King');
  assert.equal(rankings.categories.ai_only_high_scores.rows[0].country, 'CA');

  hooks.renderVerifiedResultsDiscovery();
  assert.match(window.document.getElementById('verified-ranking-categories').textContent, /Bitcoin Battles/);
  assert.match(window.document.getElementById('verified-results-list').textContent, /View Ranking/);
});

test('Verified result and public DJ profile links expose approved public information only', async () => {
  const { window } = loadAppDom();
  completePublicResult(window, { id:'link-result', title:'Link Result', country:'US', belt:'Yellow' });
  await window.__DJBattleTestHooks.loadVerifiedResultsDiscovery();

  window.__DJBattleTestHooks.openVerifiedResultFromDiscovery('vr_linkresult0000000000');
  let text = window.document.getElementById('modal-content').textContent;
  assert.match(text, /Link Result/);
  assert.match(text, /Private storage paths/);
  assert.doesNotMatch(text, /private\/battle-entries|service_key|secret/);

  window.__DJBattleTestHooks.openPublicDjProfileFromDiscovery('vr_linkresult0000000000');
  text = window.document.getElementById('modal-content').textContent;
  assert.match(text, /PUBLIC DJ PROFILE/);
  assert.match(text, /Digital King/);
  assert.match(text, /Approved public profile info only/);
  assert.doesNotMatch(text, /private\/battle-entries|service_key|secret/);
});

test('Verified Results can load the server public discovery contract with safe pagination metadata', async () => {
  const { window } = loadAppDom();
  const requested = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    requested.push({ url, options });
    return {
      status:200,
      data:{
        results:[{
          id:'vr_server00000000000000',
          verifiedResultId:'vr_server00000000000000',
          visibility:'public',
          battle:{ title:'Server Verified', modeId:'transition_battle', type:'Transition Battle', genre:'EDM' },
          profile:{ displayName:'Server DJ', country:'US', publicProfileId:'dj_server' },
          opponent:{ status:'opponent', name:'Rival DJ' },
          score:95,
          outcome:'win',
          scoringSource:['measured','rule-based','hybrid'],
          belt:'Blue',
          progression:{ ratingDelta:21, beltAfter:'Blue' },
          ratingMovement:21,
          completedAt:'2026-08-25T12:00:00.000Z',
          reward:{ type:'standard', metadata:{} },
          evidence:{ breakdown:{ timing:95 }, recommendations:['Clean phrasing.'] }
        }],
        pagination:{ page:1, limit:10, total:1, hasMore:false, nextPage:null },
        rankings:null,
        sortUnsupported:true
      }
    };
  };
  window.__DJBattleTestHooks.setVerifiedDiscoverySort('most_viewed');
  await window.__DJBattleTestHooks.loadVerifiedResultsDiscovery({ forceServer:true });

  assert.match(requested[0].url, /^\/api\/publicBattleResults\?/);
  assert.equal(requested[0].options.public, true);
  assert.equal(window.__DJBattleTestHooks.getVerifiedDiscoveryState().source, 'server');
  assert.equal(window.__DJBattleTestHooks.getVerifiedDiscoveryState().sortUnsupported, true);
  assert.match(window.document.getElementById('verified-results-list').textContent, /Server Verified/);
  assert.match(window.document.getElementById('verified-discovery-status').textContent, /Most-viewed sort needs real view data/);
});

test('Verified Results renders authoritative ledger rankings from the server contract', async () => {
  const { window } = loadAppDom();
  const requested = [];
  const ledgerRankings = {
    source:'award_ledger',
    calculationVersion:'public-ledger-leaderboards-v1',
    categories:{
      competitive_battles:{
        label:'Global Competitive',
        rows:[{
          rank:1,
          previousRank:3,
          movement:2,
          djName:'Ledger DJ',
          publicProfileId:'dj_ledger',
          country:'US',
          belt:'Blue',
          rating:1810,
          eligibleWins:2,
          eligibleLosses:1,
          eligibleTies:0,
          qualifyingBattles:3,
          averageScore:91.3,
          bestScore:96,
          minimumEligibility:{ requiredBattles:1, met:true }
        }]
      },
      bitcoin_battles:{ label:'Bitcoin Battles', rows:[] }
    }
  };
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    requested.push({ url, options });
    if(url.startsWith('/api/publicLeaderboards?')){
      return { status:200, data:{ leaderboard:ledgerRankings, ...ledgerRankings } };
    }
    return {
      status:200,
      data:{
        results:[{
          id:'vr_ledger000000000000',
          verifiedResultId:'vr_ledger000000000000',
          visibility:'public',
          battle:{ title:'Ledger Result', modeId:'transition_battle', type:'Transition Battle', genre:'EDM' },
          profile:{ displayName:'Result DJ', country:'US', publicProfileId:'dj_result' },
          opponent:{ status:'opponent', name:'Rival DJ' },
          score:88,
          outcome:'win',
          scoringSource:['measured','rule-based'],
          belt:'Green',
          ratingMovement:8,
          completedAt:'2026-08-25T12:00:00.000Z',
          reward:{ type:'standard', metadata:{} }
        }],
        pagination:{ page:1, limit:10, total:1, hasMore:false, nextPage:null },
        rankings:ledgerRankings,
        sortUnsupported:false
      }
    };
  };

  await window.__DJBattleTestHooks.loadVerifiedResultsDiscovery({ forceServer:true });
  await window.__DJBattleTestHooks.loadAuthoritativeLeaderboards();

  const state = window.__DJBattleTestHooks.getVerifiedDiscoveryState();
  const statusText = window.document.getElementById('verified-discovery-status').textContent;
  const rankingText = window.document.getElementById('verified-ranking-categories').textContent;

  assert.equal(state.rankingSource, 'award_ledger');
  assert.match(requested[0].url, /^\/api\/publicBattleResults\?/);
  assert.match(requested[1].url, /^\/api\/publicLeaderboards\?/);
  assert.match(statusText, /Award ledger rankings/);
  assert.match(rankingText, /Ledger DJ/);
  assert.match(rankingText, /Rating 1810/);
  assert.match(rankingText, /2-1-0/);
  assert.doesNotMatch(rankingText, /Result DJ/);
});

test('server-backed public DJ profiles show approved fields and track profile views', async () => {
  const { window } = loadAppDom();
  const requested = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    requested.push({ url, options });
    if(url === '/api/publicProfiles/dj_abcdef1234567890'){
      return {
        status:200,
        data:{
          profile:{
            id:'dj_abcdef1234567890',
            displayName:'Server DJ',
            country:'US',
            belt:'Blue',
            rating:31,
            rank:2,
            bio:'Public battle bio.',
            specialties:['transition_battle','bitcoin_battle'],
            stats:{ totalResults:2, competitiveBattles:1, aiOnlyHighScores:1, wins:1, losses:0, ties:0, bestScore:96, averageScore:93, totalViews:9 },
            views:{ total:3, uniqueEstimate:2 },
            media:[
              { title:'Public set', visibility:'public', publicUrl:'https://example.test/listen.webm', securePlaybackPermitted:true },
              { title:'Private set', visibility:'private', publicUrl:'private/battle-entries/secret.webm' }
            ],
            competitiveHistory:[{ verifiedResultId:'vr_competitive00000000', title:'Competitive Result', battle:{ type:'Transition Battle', genre:'EDM' }, score:92, outcome:'win', visibility:'public', profile:{ displayName:'Server DJ', country:'US', publicProfileId:'dj_abcdef1234567890' }, scoringSource:['measured','rule-based'], reward:{ type:'standard' } }],
            aiOnlyHighScores:[{ verifiedResultId:'vr_practice0000000000', title:'Practice Result', battle:{ type:'AI Practice', genre:'Open Format' }, score:96, outcome:'practice', opponent:{ status:'ai_only' }, visibility:'public', profile:{ displayName:'Server DJ', country:'US', publicProfileId:'dj_abcdef1234567890' }, scoringSource:['measured','rule-based'], reward:{ type:'high_score' } }],
            verifiedResults:[]
          }
        }
      };
    }
    if(url === '/api/publicProfiles/dj_abcdef1234567890/views'){
      return { status:200, data:{ success:true, duplicate:false, views:{ total:4, uniqueEstimate:2 } } };
    }
    return { status:404, error:'not found' };
  };

  await window.__DJBattleTestHooks.loadPublicDjProfile('dj_abcdef1234567890');
  await nextTick();
  const text = window.document.getElementById('modal-content').textContent;

  assert.equal(requested[0].url, '/api/publicProfiles/dj_abcdef1234567890');
  assert.equal(requested[0].options.public, true);
  assert.equal(requested[1].url, '/api/publicProfiles/dj_abcdef1234567890/views');
  assert.equal(requested[1].options.method, 'POST');
  assert.match(requested[1].options.body.visitorId, /^pv_/);
  assert.match(text, /Server DJ/);
  assert.match(text, /Public battle bio/);
  assert.match(text, /Competitive history/);
  assert.match(text, /AI-only high scores/);
  assert.match(text, /Public set/);
  assert.doesNotMatch(text, /Private set|private\/battle-entries|private@example\.com|auth-secret|service_key|secret\.webm/);
});

test('public verified result pages track views through the server endpoint', async () => {
  const { window } = loadAppDom();
  const requested = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    requested.push({ url, options });
    if(url === '/api/publicBattleResults/vr_viewtracking0000000'){
      return {
        status:200,
        data:{
          result:{
            id:'vr_viewtracking0000000',
            verifiedResultId:'vr_viewtracking0000000',
            visibility:'public',
            battle:{ title:'Viewed Result', modeId:'transition_battle', type:'Transition Battle', genre:'EDM' },
            profile:{ displayName:'View DJ', country:'US', publicProfileId:'dj_abcdef1234567890' },
            opponent:{ status:'opponent', name:'Rival DJ' },
            score:91,
            outcome:'win',
            scoringSource:['measured','rule-based'],
            reward:{ type:'standard' },
            evidence:{ breakdown:{ timing:91 }, recommendations:['Clean.'] }
          }
        }
      };
    }
    if(url === '/api/publicBattleResults/vr_viewtracking0000000/views'){
      return { status:200, data:{ success:true, duplicate:false, views:{ total:8, uniqueEstimate:5 } } };
    }
    return { status:404, error:'not found' };
  };

  await window.__DJBattleTestHooks.loadPublicVerifiedResult('vr_viewtracking0000000');
  await nextTick();

  assert.equal(requested[0].url, '/api/publicBattleResults/vr_viewtracking0000000');
  assert.equal(requested[1].url, '/api/publicBattleResults/vr_viewtracking0000000/views');
  assert.equal(requested[1].options.method, 'POST');
  assert.equal(requested[1].options.public, true);
  assert.match(window.document.getElementById('modal-content').textContent, /Viewed Result/);
});

test('most viewed sorting uses real server view counts without fallback warning', async () => {
  const { window } = loadAppDom();
  window.DJBattleApi.apiRequest = async () => ({
    status:200,
    data:{
      results:[
        { id:'vr_lowviews0000000000', verifiedResultId:'vr_lowviews0000000000', visibility:'public', battle:{ title:'Low Views', modeId:'transition_battle', type:'Transition Battle', genre:'EDM' }, profile:{ displayName:'Low DJ', country:'US', publicProfileId:'dj_low' }, opponent:{ status:'opponent' }, score:88, outcome:'win', scoringSource:['measured'], belt:'White', ratingMovement:4, viewCount:2, completedAt:'2026-08-24T12:00:00Z', reward:{ type:'standard' } },
        { id:'vr_highviews000000000', verifiedResultId:'vr_highviews000000000', visibility:'public', battle:{ title:'High Views', modeId:'transition_battle', type:'Transition Battle', genre:'EDM' }, profile:{ displayName:'High DJ', country:'US', publicProfileId:'dj_high' }, opponent:{ status:'opponent' }, score:90, outcome:'win', scoringSource:['measured'], belt:'Yellow', ratingMovement:6, viewCount:20, completedAt:'2026-08-25T12:00:00Z', reward:{ type:'standard' } }
      ],
      pagination:{ page:1, limit:10, total:2, hasMore:false, nextPage:null },
      rankings:null,
      sortUnsupported:false
    }
  });

  window.__DJBattleTestHooks.setVerifiedDiscoverySort('most_viewed');
  await window.__DJBattleTestHooks.loadVerifiedResultsDiscovery({ forceServer:true });
  const state = window.__DJBattleTestHooks.getVerifiedDiscoveryState();

  assert.equal(state.results[0].title, 'High Views');
  assert.equal(state.sortUnsupported, false);
  assert.doesNotMatch(window.document.getElementById('verified-discovery-status').textContent, /needs real view data/);
});

test('public DJ profile loader returns clean private and unavailable states', async () => {
  const { window } = loadAppDom();
  window.DJBattleApi.apiRequest = async () => ({ status:403, error:'Public DJ profile is private' });
  await window.__DJBattleTestHooks.loadPublicDjProfile('dj_abcdef1234567890');
  assert.match(window.document.getElementById('modal-content').textContent, /private/);

  window.DJBattleApi.apiRequest = async () => ({ status:404, error:'Public DJ profile is unavailable' });
  await window.__DJBattleTestHooks.loadPublicDjProfile('dj_abcdef1234567890');
  assert.match(window.document.getElementById('modal-content').textContent, /unavailable/);
});

test('public DJ profile embeds authoritative ranking history and category controls', async () => {
  const { window } = loadAppDom();
  const requested = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    requested.push({ url, options });
    if(url === '/api/publicProfiles/dj_abcdef1234567890'){
      return {
        status:200,
        data:{ profile:{ id:'dj_abcdef1234567890', displayName:'Server DJ', country:'US', belt:'Blue', stats:{ wins:2, losses:1, ties:0, competitiveBattles:3, aiOnlyHighScores:1 }, competitiveHistory:[], aiOnlyHighScores:[], media:[], views:{ total:4, uniqueEstimate:2 } } }
      };
    }
    if(url === '/api/publicProfiles/dj_abcdef1234567890/views') return { status:200, data:{ views:{ total:5, uniqueEstimate:2 } } };
    if(url.startsWith('/api/publicRankings/dj_abcdef1234567890/history?')){
      const params = new URL(`http://local${url}`).searchParams;
      return { status:200, data:rankingDetailPayload({ category:params.get('category') || 'competitive_battles' }) };
    }
    if(url === '/api/publicBattleResults/vr_profileimpact000000') return { status:200, data:{ result:{ verifiedResultId:'vr_profileimpact000000', visibility:'public', battle:{ title:'Profile Finals', type:'Transition Battle', genre:'EDM' }, profile:{ displayName:'Server DJ', country:'US', publicProfileId:'dj_abcdef1234567890' }, opponent:{ status:'opponent' }, score:96, outcome:'win', scoringSource:['measured','rule-based'], reward:{ type:'standard' }, evidence:{ breakdown:{ timing:96 } } } } };
    return { status:404, error:'not found' };
  };

  await window.__DJBattleTestHooks.loadPublicDjProfile('dj_abcdef1234567890');
  await nextTick();
  await nextTick();
  let text = window.document.getElementById('modal-content').textContent;

  assert.ok(requested.some(req => /^\/api\/publicRankings\/dj_abcdef1234567890\/history\?/.test(req.url) && req.options.public === true));
  assert.match(text, /AUTHORITATIVE RANKING HISTORY/);
  assert.match(text, /#2/);
  assert.match(text, /2-1-0/);
  assert.match(text, /fully ranked/i);
  assert.match(text, /Private qualifying battle|Anonymous qualifying activity/);
  assert.match(text, /Green -> Blue/);
  assert.doesNotMatch(text, /signedurl|service_role|auth-secret|private\/battle-entries/i);

  window.document.querySelector('[data-profile-ranking-scope="public"][data-profile-ranking-category="transition_battles"]').click();
  await nextTick();
  await nextTick();
  assert.ok(requested.some(req => /category=transition_battles/.test(req.url)));

  window.document.querySelector('[data-profile-result-link="vr_profileimpact000000"]').click();
  await nextTick();
  text = window.document.getElementById('modal-content').textContent;
  assert.match(text, /Profile Finals/);
});

test('verified result ranking impact opens the public profile category history', async () => {
  const { window } = loadAppDom();
  const requested = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    requested.push({ url, options });
    if(url === '/api/publicProfiles/dj_abcdef1234567890') return { status:200, data:{ profile:{ id:'dj_abcdef1234567890', displayName:'Impact DJ', country:'US', belt:'Blue', stats:{}, competitiveHistory:[], aiOnlyHighScores:[], media:[] } } };
    if(url === '/api/publicProfiles/dj_abcdef1234567890/views') return { status:200, data:{ views:{ total:1, uniqueEstimate:1 } } };
    if(url.startsWith('/api/publicRankings/dj_abcdef1234567890/history?')) return { status:200, data:rankingDetailPayload({ category:'bitcoin_battles', qualifyingBattles:[{ battleRef:'qb-impact', score:91, result:{ verifiedResultId:'vr_impact000000000000', verifiedResultUrl:'/results/vr_impact000000000000', battle:{ title:'Bitcoin Impact' }, outcome:'win', progression:{ ratingDelta:21 }, reward:{ type:'bitcoin', transferStatus:'untransferred' } } }] }) };
    return { status:404, error:'not found' };
  };
  window.__DJBattleTestHooks.getVerifiedDiscoveryState().results = [{
    verifiedResultId:'vr_impact000000000000',
    visibility:'public',
    battle:{ title:'Bitcoin Impact', modeId:'bitcoin_battle', type:'Bitcoin Battle', genre:'Bass House' },
    profile:{ displayName:'Impact DJ', country:'US', publicProfileId:'dj_abcdef1234567890' },
    opponent:{ status:'opponent' },
    score:91,
    outcome:'win',
    scoringSource:['measured','rule-based'],
    reward:{ type:'bitcoin', transferStatus:'untransferred' },
    belt:'Blue',
    ratingMovement:21
  }];

  await window.__DJBattleTestHooks.openPublicProfileRankingImpactFromResult('vr_impact000000000000');
  await nextTick();
  await nextTick();

  assert.ok(requested.some(req => /category=bitcoin_battles/.test(req.url)));
  assert.match(window.document.getElementById('modal-content').textContent, /Bitcoin Impact/);
  assert.match(window.document.getElementById('modal-content').textContent, /Bitcoin metadata: untransferred/);
  assert.match(window.location.hash, /rankingCategory=bitcoin_battles/);
});
