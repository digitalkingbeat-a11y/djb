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
}

function lobbyRow(overrides = {}){
  return {
    id:'server-battle-1',
    modeId:'own_selection_battle',
    modeLabel:'Own Selection Battle',
    title:'Server Lobby Open',
    genre:'Open Format',
    status:'open',
    joinable:true,
    participantCount:1,
    capacity:2,
    createdAt:'2026-08-26T12:00:00.000Z',
    scoringType:'hybrid',
    creator:{ name:'Rival Selector', country:'US', belt:'Blue', rating:1810 },
    entryRequirements:{
      trackSelectionMethod:'own_selection',
      minimumTrackCount:2,
      trackCount:null,
      durationMinutes:20,
      opponentRequirement:'required',
      ownSelectionEligible:true
    },
    reward:{ type:'xp', metadataStatus:'standard' },
    bitcoinRewardMetadata:null,
    ...overrides
  };
}

function serverSnapshot(overrides = {}){
  return {
    id:'snap-server-lobby',
    snapshotId:'snap-server-lobby',
    snapshotVersion:'snap-lobby-v1',
    battleId:'server-battle-1',
    battleEntryId:'entry-server-lobby',
    userId:'user-1',
    crateId:'crate-server',
    crateVersion:'crate-v1',
    purpose:'own_selection',
    trackSelectionMethod:'own_selection',
    replacementAllowed:true,
    tracks:[
      { libraryTrackId:'srv-alpha', order:0, bpm:124, key:'A minor', camelotKey:'8A', genre:'Open Format', duration:180, status:'ready', reasons:[] },
      { libraryTrackId:'srv-bravo', order:1, bpm:128, key:'C minor', camelotKey:'5A', genre:'Open Format', duration:190, status:'ready', reasons:[] }
    ],
    replacements:[],
    ruleDecisions:{ ready:true, blockers:[], warnings:[], method:'own_selection', purpose:'own_selection' },
    availability:{ status:'available', unavailableTrackCount:0 },
    createdAt:'2026-08-26T12:00:00.000Z',
    ...overrides
  };
}

function configureServerLibrary(window){
  const hooks = window.__DJBattleTestHooks;
  hooks.setPremium(true);
  hooks.setPlatformLibrary([]);
  hooks.setLibraryTracks([
    { id:'srv-alpha', serverBacked:true, userId:'user-1', title:'Alpha Prep', name:'Alpha Prep', artist:'DJ One', genre:'Open Format', bpm:124, key:'A minor', camelotKey:'8A', duration:180, source:'MY_LIBRARY', sourceType:'track', rightsClassification:'original', rightsCategory:'Original / I Own the Rights', battleEligible:true, analysisConfidence:0.92, permissions:{ download:false } },
    { id:'srv-bravo', serverBacked:true, userId:'user-1', title:'Bravo Prep', name:'Bravo Prep', artist:'DJ One', genre:'Open Format', bpm:128, key:'C minor', camelotKey:'5A', duration:190, source:'MY_LIBRARY', sourceType:'track', rightsClassification:'original', rightsCategory:'Original / I Own the Rights', battleEligible:true, analysisConfidence:0.9, permissions:{ download:false } }
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

test('public Battle Lobby hydrates server rows with pagination and sanitized display', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  const calls = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    calls.push({ url, options });
    return { data:{ battles:[lobbyRow({ creator:{ name:'Rival Selector', country:'US', belt:'Blue', email:'hidden@example.com' } })], pagination:{ page:1, limit:20, total:1, hasMore:false, nextPage:null } } };
  };

  const result = await hooks.loadServerBattleLobby();
  assert.equal(calls[0].options.public, true);
  assert.match(calls[0].url, /\/api\/battles\/lobby\?/);
  assert.equal(result.battles.length, 1);
  assert.equal(hooks.getBattleLobbyState().status, 'synced');
  assert.ok(hooks.getBattles().find(row => row.id === 'server-battle-1').serverBacked);
  const text = window.document.getElementById('battle-grid').textContent;
  assert.match(text, /SYNCED/);
  assert.match(text, /Rival Selector/);
  assert.doesNotMatch(text, /hidden@example.com|private\/|storage/i);
});

test('Battle Lobby persists list and grid layout while displaying authoritative seat details', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  window.DJBattleApi.apiRequest = async () => ({ data:{ battles:[lobbyRow({ participantCount:6, capacity:8, status:'waiting' })], pagination:{ page:1, limit:20, total:1, hasMore:false, nextPage:null } } });
  await hooks.loadServerBattleLobby();
  const lobby = window.document.getElementById('battle-grid');
  assert.equal(lobby.classList.contains('battle-grid-view'), false);
  assert.match(lobby.textContent, /6\/8/);
  assert.match(lobby.textContent, /Waiting for 2/);
  assert.match(lobby.textContent, /DJ Battle/);
  window.document.querySelector('[data-battle-layout="grid"]').click();
  assert.equal(lobby.classList.contains('battle-grid-view'), true);
  assert.equal(window.localStorage.getItem('djBattleBattleLayout'), 'grid');
});

test('relationship lobby filter uses protected discovery without resetting Battle Room state', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  hooks.setBattleLobbyFilters({ relationship:'following', country:'US' });
  hooks.setActiveBattleSession({ id:'active-battle', battleId:'active-battle', battleEntryId:'entry-active', status:'active', timerRemaining:322, deckA:{ id:'srv-alpha' } });
  const calls = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    calls.push({ url, options });
    return { data:{ battles:[lobbyRow({ creator:{ name:'Followed Selector', publicProfileId:'dj_followed', country:'US', relationshipCounts:{ followers:5, source:'server' }, followerCount:5 } })], pagination:{ page:1, limit:20, total:1, hasMore:false, nextPage:null } } };
  };

  await hooks.loadServerBattleLobby();

  assert.ok(calls[0].url.startsWith('/api/battles/relationshipLobby?'));
  assert.equal(calls[0].options.public, undefined);
  assert.match(calls[0].url, /relationship=following/);
  assert.match(window.document.getElementById('battle-grid').textContent, /5 follower/);
  assert.equal(hooks.getActiveBattleSession().battleEntryId, 'entry-active');
  assert.equal(hooks.getActiveBattleSession().timerRemaining, 322);
});

test('server-backed join waits for the protected server contract and recovers final-slot conflicts', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  const calls = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    calls.push({ url, body:options.body, public:options.public });
    if(url.startsWith('/api/battles/lobby')) return { data:{ battles:[lobbyRow()], pagination:{ page:1, limit:20, total:1, hasMore:false } } };
    if(url === '/api/battles/server-battle-1/join') return { error:'Battle is already full', status:409 };
    return { error:`unexpected ${url}`, status:500 };
  };
  await hooks.loadServerBattleLobby();
  hooks.openBattleLifecycle('server-battle-1');
  await settle();
  window.document.getElementById('enter-prep-crate').value = 'crate:crate-server';
  window.document.getElementById('enter-prep-crate').dispatchEvent(new window.Event('change', { bubbles:true }));
  window.document.getElementById('find-opponent').click();
  await settle();

  assert.ok(calls.some(call => call.url === '/api/battles/server-battle-1/join'));
  assert.match(window.document.getElementById('enter-battle-error').textContent, /full/i);
  const battle = hooks.getBattles().find(row => row.id === 'server-battle-1');
  assert.equal(Boolean(hooks.battlePrepSnapshotForUser(battle)), false);
});

test('successful server-backed join carries entry and snapshot into Battle Room submission context', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    if(url.startsWith('/api/battles/lobby')) return { data:{ battles:[lobbyRow()], pagination:{ page:1, limit:20, total:1, hasMore:false } } };
    if(url === '/api/battles/server-battle-1/join') return { data:{ battle:{ id:'server-battle-1', status:'matched' }, entry:{ id:'entry-server-lobby', battle_id:'server-battle-1', user_id:'user-1', status:'active' }, snapshot:serverSnapshot() } };
    if(url === '/api/battleEntries/entry-server-lobby/prepSnapshot') return { data:{ entry:{ id:'entry-server-lobby' }, snapshot:serverSnapshot() } };
    return { data:null };
  };
  await hooks.loadServerBattleLobby();
  hooks.openBattleLifecycle('server-battle-1');
  await settle();
  window.document.getElementById('enter-prep-crate').value = 'crate:crate-server';
  window.document.getElementById('enter-prep-crate').dispatchEvent(new window.Event('change', { bubbles:true }));
  window.document.getElementById('find-opponent').click();
  await settle();

  const battle = hooks.getBattles().find(row => row.id === 'server-battle-1');
  const snapshot = hooks.battlePrepSnapshotForUser(battle);
  assert.equal(snapshot.serverBacked, true);
  assert.equal(snapshot.battleEntryId, 'entry-server-lobby');
  window.document.getElementById('modal').close();
  hooks.startBattleSession(battle, { view:'studio' });
  await settle();
  const context = hooks.buildBattleSubmissionContext(hooks.getActiveBattleSession());
  assert.equal(context.battleEntryId, 'entry-server-lobby');
  assert.equal(context.battlePrepSnapshotVersion, 'snap-lobby-v1');
});

test('cross-device recovery restores the authenticated battle without opponent prep leakage', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  window.DJBattleApi.apiRequest = async (url) => {
    if(url === '/api/battles/recovery?limit=20') return { data:{ battles:[{
      battle:{ id:'server-battle-1', modeId:'own_selection_battle', title:'Recovered Server Battle', genre:'Open Format', durationMinutes:20, trackSelectionMethod:'own_selection', minimumTrackCount:2, opponentRequirement:'required', status:'matched', reward:{ type:'xp', metadata:{} }, creatorPublicProfile:{ name:'Rival Selector', country:'US', belt:'Blue' } },
      entry:{ id:'entry-server-lobby', battle_id:'server-battle-1', user_id:'user-1', status:'active' },
      snapshot:serverSnapshot(),
      submission:{ id:'sub-1', status:'uploaded' },
      participants:{ self:{ entryId:'entry-server-lobby', prepared:true }, opponents:[{ status:'active', prepared:true, profile:{ name:'Rival Selector', country:'US', belt:'Blue', email:'hidden@example.com' } }] }
    }] } };
    return { data:null };
  };

  const recovered = await hooks.recoverServerBattleRoom();
  assert.equal(recovered.recovered.length, 1);
  const session = hooks.getActiveBattleSession();
  assert.equal(session.battleEntryId, 'entry-server-lobby');
  assert.equal(session.battlePrepSnapshotVersion, 'snap-lobby-v1');
  assert.equal(session.submissionId, 'sub-1');
  assert.doesNotMatch(window.document.body.textContent, /hidden@example.com|secret-track|private\//i);
});

test('matchmaking uses the authenticated server endpoint and local fallback remains explicit', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  const calls = [];
  window.DJBattleApi.apiRequest = async (url) => {
    calls.push(url);
    if(url.startsWith('/api/battles/matchmaking')) return { data:{ battle:lobbyRow({ id:'server-match' }), candidates:[lobbyRow({ id:'server-match' })] } };
    return { data:null };
  };
  const match = await hooks.findCompatibleServerBattle({ genre:'Open Format', country:'US' });
  assert.equal(match.battle.id, 'server-match');
  assert.ok(calls[0].startsWith('/api/battles/matchmaking?'));
  assert.ok(hooks.getBattles().find(row => row.id === 'server-match'));

  window.DJBattleApi = null;
  const skipped = await hooks.loadServerBattleLobby();
  assert.equal(skipped.reason, 'api_unavailable');
  assert.equal(hooks.getBattleLobbyState().status, 'offline');
});
