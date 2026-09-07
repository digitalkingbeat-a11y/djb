const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function loadAppDom(){
  const root = path.join(__dirname, '..');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(index, {
    url:'http://127.0.0.1/index.html',
    runScripts:'outside-only',
    pretendToBeVisual:true
  });
  const { window } = dom;
  window.alert = () => {};
  window.confirm = () => true;
  window.scrollTo = () => {};
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLDialogElement.prototype.showModal = function showModal(){ this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function close(){ this.removeAttribute('open'); };
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'].forEach(file => {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });
  return window;
}

function tick(){
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function settle(){
  await tick();
  await tick();
  await tick();
}

function configureServerLibrary(window){
  const hooks = window.__DJBattleTestHooks;
  hooks.setPremium(true);
  hooks.setPlatformLibrary([]);
  hooks.setLibraryTracks([
    serverTrack({ id:'srv-alpha', title:'Alpha Prep', name:'Alpha Prep', bpm:124, key:'A minor', camelotKey:'8A' }),
    serverTrack({ id:'srv-bravo', title:'Bravo Prep', name:'Bravo Prep', bpm:128, key:'C minor', camelotKey:'5A' })
  ]);
  const state = hooks.getLibraryState();
  state.sync.accountId = 'user-1';
  state.sync.status = 'synced';
  state.crates.push({
    id:'crate-server',
    serverBacked:true,
    userId:'user-1',
    name:'Server Battle Prep',
    type:'battle_prep',
    visibility:'private',
    trackIds:['server:srv-alpha', 'server:srv-bravo'],
    syncVersion:'crate-v1'
  });
  return hooks;
}

function serverTrack(overrides = {}){
  return {
    id:'srv-alpha',
    serverBacked:true,
    userId:'user-1',
    title:'Alpha Prep',
    name:'Alpha Prep',
    artist:'DJ One',
    genre:'Open Format',
    bpm:124,
    key:'A minor',
    camelotKey:'8A',
    duration:180,
    source:'MY_LIBRARY',
    sourceType:'track',
    rightsClassification:'original',
    rightsCategory:'Original / I Own the Rights',
    battleEligible:true,
    analysisConfidence:0.92,
    permissions:{ download:false },
    ...overrides
  };
}

function publicProfile(overrides = {}){
  return {
    id:'dj_recipient',
    publicProfileId:'dj_recipient',
    displayName:'Recipient DJ',
    country:'GB',
    belt:'Green',
    rating:1740,
    rank:8,
    stats:{ totalResults:4, wins:3, losses:1, ties:0 },
    competitiveHistory:[],
    aiOnlyHighScores:[],
    specialties:['own_selection_battle'],
    visibility:'public',
    ...overrides
  };
}

function relationshipRow(overrides = {}){
  return {
    id:'follow-1',
    direction:'following',
    publicProfileId:'dj_ally',
    displayName:'Ally DJ',
    country:'US',
    belt:'Blue',
    rating:1810,
    profile:{ publicProfileId:'dj_ally', displayName:'Ally DJ', country:'US', belt:'Blue', rating:1810 },
    followedAt:'2026-08-28T10:00:00.000Z',
    ...overrides
  };
}

function feedEvent(overrides = {}){
  return {
    id:'feed-1',
    sourceType:'verified_result',
    sourceId:'vr_1234567890abcdef1234',
    sourceVersion:'2026-08-28T09:00:00.000Z',
    actor:{ publicProfileId:'dj_ally', displayName:'Ally DJ', country:'US', belt:'Blue' },
    createdAt:'2026-08-28T09:00:00.000Z',
    title:'Ally DJ completed Own Selection Battle',
    summary:'94/100 - win - standard reward',
    result:{ verifiedResultId:'vr_1234567890abcdef1234', score:94, outcome:'win', reward:{ type:'xp' } },
    ...overrides
  };
}

function opponentRow(overrides = {}){
  return {
    id:'sub-rematch',
    verifiedResultId:null,
    completedAt:'2026-08-27T08:00:00.000Z',
    battle:{ modeId:'own_selection_battle', type:'Own Selection Battle', genre:'Open Format', durationMinutes:20 },
    opponent:{ publicProfileId:'dj_recipient', displayName:'Recipient DJ', country:'GB', belt:'Green' },
    outcome:'win',
    score:91,
    progression:{ ratingDelta:12 },
    rematchEligible:true,
    suggestedRules:{ modeId:'own_selection_battle', genre:'Open Format', durationMinutes:20, scoringType:'hybrid', reward:{ type:'xp' } },
    ...overrides
  };
}

function historyResult(){
  return {
    id:'history-rematch',
    submissionId:'sub-rematch',
    verifiedResultId:'vr_historyrematch0001',
    visibility:'private',
    completedAt:'2026-08-27T08:00:00.000Z',
    battle:{ modeId:'own_selection_battle', type:'Own Selection Battle', title:'Own Selection Battle', genre:'Open Format', durationMinutes:20 },
    opponent:{ status:'opponent', publicProfileId:'dj_recipient', displayName:'Recipient DJ', name:'Recipient DJ', country:'GB', belt:'Green' },
    score:91,
    outcome:'win',
    progression:{ xp:120, ratingDelta:12, beltBefore:'Blue', beltAfter:'Green' },
    details:{ breakdown:{ timing:92 }, measurableAnalysis:{ bpm:128, durationSec:180, transitionCount:3 }, recommendations:['Nice phrase control.'], confidence:{ overall:0.88 } },
    reward:{ type:'bitcoin', metadata:{ amountSats:5000, custody:'external_pending' }, transferStatus:'untransferred' }
  };
}

test('public profiles hydrate follow state and toggle through protected relationship endpoints', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  const calls = [];
  let following = false;
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    calls.push({ url, method:options.method || 'GET', body:options.body });
    if(url === '/api/relationships/dj_recipient') return { status:200, data:{ relationship:{ following, canFollow:true, counts:{ followers:9, following:3 }, profile:publicProfile() } } };
    if(url === '/api/relationships/dj_recipient/follow' && options.method === 'POST'){ following = true; return { status:201, data:{ follow:relationshipRow({ publicProfileId:'dj_recipient', profile:publicProfile() }) } }; }
    if(url === '/api/relationships/dj_recipient/follow' && options.method === 'DELETE'){ following = false; return { status:200, data:{ removed:true } }; }
    if(url === '/api/challenges/eligibility/dj_recipient') return { status:200, data:{ eligibility:{ available:true } } };
    return { status:200, data:{} };
  };

  hooks.renderPublicDjProfile(publicProfile());
  await settle();
  assert.equal(window.document.getElementById('follow-public-dj').textContent, 'Follow DJ');
  window.document.getElementById('follow-public-dj').click();
  await settle();
  assert.equal(window.document.getElementById('follow-public-dj').textContent, 'Following');
  window.document.getElementById('follow-public-dj').click();
  await settle();

  assert.ok(calls.some(call => call.url === '/api/relationships/dj_recipient/follow' && call.method === 'POST'));
  assert.ok(calls.some(call => call.url === '/api/relationships/dj_recipient/follow' && call.method === 'DELETE'));
  assert.doesNotMatch(window.document.getElementById('modal-content').innerHTML, /user_id|auth_id|private\/|storage_object|signed_url|service_key|track-/i);
});

test('profile relationship feed opponent and preference panels load server-backed data only', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  const calls = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    calls.push({ url, method:options.method || 'GET', body:options.body });
    if(url.startsWith('/api/relationships?')) return { status:200, data:{ relationships:[relationshipRow()], counts:{ following:1, followers:2 }, pagination:{ page:1, limit:10, total:1, hasMore:false } } };
    if(url.startsWith('/api/activityFeed?')) return { status:200, data:{ events:[feedEvent()], pagination:{ page:1, limit:10, total:1, hasMore:false } } };
    if(url.startsWith('/api/opponentHistory?')) return { status:200, data:{ opponents:[opponentRow()], pagination:{ page:1, limit:10, total:1, hasMore:false } } };
    if(url === '/api/challenges/eligibility/dj_ally') return { status:200, data:{ eligibility:{ available:true } } };
    if(url === '/api/challengePreferences' && (options.method || 'GET') === 'GET') return { status:200, data:{ preferences:{ whoMayChallenge:'followed', allowedModes:['own_selection_battle'], allowedGenres:['Open Format'], ratingRange:{ min:1500, max:2100 }, allowedBelts:['Blue'], bitcoinBattles:'metadata_only', autoDeclineOutsideRules:true } } };
    if(url === '/api/challengePreferences' && options.method === 'PATCH') return { status:200, data:{ preferences:options.body.preferences } };
    return { status:200, data:{} };
  };

  hooks.setProfileTab('relationships');
  await settle();
  assert.match(window.document.getElementById('profile-media').textContent, /Ally DJ/);
  assert.match(window.document.getElementById('profile-media').textContent, /Following/);

  hooks.setProfileTab('feed');
  await settle();
  assert.match(window.document.getElementById('profile-media').textContent, /94\/100/);
  window.document.querySelector('[data-feed-ranking]').click();
  assert.match(window.location.hash, /#rankings/);
  hooks.setProfileTab('feed');
  await settle();
  window.document.querySelector('[data-feed-challenge="dj_ally"]').click();
  await settle();
  assert.match(window.document.getElementById('modal-content').textContent, /Challenge Ally DJ/);

  hooks.setProfileTab('opponents');
  await settle();
  assert.match(window.document.getElementById('profile-media').textContent, /Recipient DJ/);
  assert.ok(window.document.querySelector('[data-opponent-rematch="sub-rematch"]'));

  hooks.setProfileTab('preferences');
  await settle();
  assert.equal(window.document.getElementById('pref-who').value, 'followed');
  window.document.getElementById('pref-who').value = 'nobody';
  window.document.getElementById('preference-save').click();
  await settle();

  assert.ok(calls.some(call => call.url === '/api/relationships?direction=following&page=1&limit=10'));
  assert.ok(calls.some(call => call.url === '/api/activityFeed?page=1&limit=10'));
  assert.ok(calls.some(call => call.url === '/api/challenges/eligibility/dj_ally'));
  assert.ok(calls.some(call => call.url === '/api/opponentHistory?page=1&limit=10'));
  assert.ok(calls.some(call => call.url === '/api/challengePreferences' && call.method === 'PATCH' && call.body.preferences.whoMayChallenge === 'nobody'));
  assert.doesNotMatch(window.document.getElementById('profile-media').innerHTML, /user_id|auth_id|private\/|storage_object|signed_url|service_key|download_url|track-/i);
});

test('relationship sync accepts newer server versions and rejects stale polling responses', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  const pending = [];
  window.DJBattleApi.apiRequest = async (url) => new Promise(resolve => pending.push({ url, resolve }));

  const first = hooks.loadDjRelationshipSync({ render:false });
  const second = hooks.loadDjRelationshipSync({ render:false });
  pending[1].resolve({ status:200, data:{ sync:{ syncVersion:200, counts:{ following:1, followers:0 }, relationships:[relationshipRow({ id:'fresh-follow', displayName:'Fresh Ally', profile:{ publicProfileId:'dj_fresh', displayName:'Fresh Ally' } })], events:[], opponents:[], preferences:{ whoMayChallenge:'everyone' }, generatedAt:'2026-08-28T10:05:00.000Z' } } });
  await second;
  pending[0].resolve({ status:200, data:{ sync:{ syncVersion:100, counts:{ following:9, followers:9 }, relationships:[relationshipRow({ id:'stale-follow', displayName:'Stale Ally', profile:{ publicProfileId:'dj_stale', displayName:'Stale Ally' } })], events:[], opponents:[], generatedAt:'2026-08-28T10:04:00.000Z' } } });
  const stale = await first;

  const state = hooks.getRelationshipState();
  assert.equal(stale.stale, true);
  assert.equal(state.syncVersion, 200);
  assert.equal(state.counts.following, 1);
  assert.equal(state.rows[0].profile.displayName, 'Fresh Ally');
  assert.doesNotMatch(JSON.stringify(state.rows), /Stale Ally|private\/|service_key|auth_id/i);
});

test('Battle History rematch requires a fresh synced crate and posts the server rematch contract', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  hooks.getBattleResults().push(historyResult());
  const calls = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    calls.push({ url, method:options.method || 'GET', body:options.body });
    if(url === '/api/rematches') return { status:201, data:{ rematch:{ requiresFreshCrate:true }, challenge:{ id:'challenge-rematch', status:'pending' } } };
    if(url === '/api/challenges/count') return { status:200, data:{ counts:{ pendingReceived:0, pendingSent:1, pendingTotal:1 } } };
    if(url === '/api/notifications/count') return { status:200, data:{ counts:{ unreadTotal:0, unreadChallenges:0, unreadBattles:0, unreadRelationships:0 } } };
    return { status:200, data:{} };
  };

  hooks.setProfileTab('history');
  await settle();
  window.document.querySelector('[data-history-rematch="sub-rematch"]').click();
  await settle();
  window.document.getElementById('rematch-prep-crate').value = 'crate:crate-server';
  window.document.getElementById('rematch-prep-crate').dispatchEvent(new window.Event('change', { bubbles:true }));
  window.document.getElementById('send-rematch-request').click();
  await settle();

  const rematch = calls.find(call => call.url === '/api/rematches');
  assert.ok(rematch);
  assert.equal(rematch.body.previousResultId, 'sub-rematch');
  assert.equal(rematch.body.opponentPublicProfileId, 'dj_recipient');
  assert.equal(rematch.body.challengerCrateId, 'crate-server');
  assert.equal(rematch.body.rules.reward.type, 'bitcoin');
  assert.doesNotMatch(JSON.stringify(rematch.body), /snapshot_id|track-|private\/|storage_object|download_url|service_key/i);
});

test('relationship state clears on sign-out or account switch', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  const relationships = hooks.getRelationshipState();
  relationships.rows = [relationshipRow()];
  relationships.feed.rows = [feedEvent()];
  relationships.opponents.rows = [opponentRow()];
  relationships.preferences.data = { whoMayChallenge:'followed' };

  hooks.clearDjRelationshipState();

  assert.equal(hooks.getRelationshipState().rows.length, 0);
  assert.equal(hooks.getRelationshipState().feed.rows.length, 0);
  assert.equal(hooks.getRelationshipState().opponents.rows.length, 0);
  assert.equal(hooks.getRelationshipState().preferences.data, null);
});
