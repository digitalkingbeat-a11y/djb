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

function serverLocalTrack(overrides = {}){
  return {
    id:'srv-alpha',
    serverBacked:true,
    userId:'user-1',
    title:'Alpha Server Tool',
    name:'Alpha Server Tool',
    artist:'DJ One',
    genre:'Open Format',
    bpm:124,
    key:'A minor',
    camelotKey:'8A',
    duration:180,
    source:'MY_LIBRARY',
    sourceType:'track',
    rightsCategory:'Original / I Own the Rights',
    rightsClassification:'original',
    battleEligible:true,
    analysisConfidence:0.92,
    usageRelationships:{ playlists:[], battles:[], posts:[], practiceHistory:[], submissions:[] },
    permissions:{ download:false },
    ...overrides
  };
}

function serverCrate(overrides = {}){
  return {
    id:'crate-server',
    serverBacked:true,
    userId:'user-1',
    name:'Server Battle Prep',
    description:'Synced prep crate',
    type:'battle_prep',
    visibility:'private',
    trackIds:['server:srv-alpha', 'server:srv-bravo'],
    syncVersion:'crate-v1',
    ...overrides
  };
}

function serverSnapshot(overrides = {}){
  return {
    id:'snap-server',
    snapshotId:'snap-server',
    snapshotVersion:'snapshot-v1',
    battleId:'battle-server',
    battleEntryId:'entry-server',
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
  hooks.setPlatformLibrary([]);
  hooks.setPremium(true);
  hooks.setLibraryTracks([
    serverLocalTrack(),
    serverLocalTrack({ id:'srv-bravo', title:'Bravo Server Blend', name:'Bravo Server Blend', bpm:128, key:'C minor', camelotKey:'5A' }),
    serverLocalTrack({ id:'srv-charlie', title:'Charlie Replacement', name:'Charlie Replacement', bpm:126, key:'A minor', camelotKey:'8A' })
  ]);
  const state = hooks.getLibraryState();
  state.sync.accountId = 'user-1';
  state.sync.status = 'synced';
  state.crates.push(serverCrate());
  return hooks;
}

test('authenticated battle creation awaits and stores a server-backed Battle Prep snapshot through result history', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  const calls = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    calls.push({ url, body:options.body });
    if(url === '/api/battles/withPrepSnapshot'){
      return { data:{
        battle:{ id:options.body.battleId, status:'open' },
        entry:{ id:'entry-server', battle_id:options.body.battleId, user_id:'user-1', status:'active' },
        snapshot:serverSnapshot({ battleId:options.body.battleId })
      } };
    }
    if(url === '/api/battleEntries/entry-server/prepSnapshot'){
      return { data:{ entry:{ id:'entry-server' }, snapshot:serverSnapshot({ battleId:calls[0].body.battleId }) } };
    }
    return { error:`unexpected ${url}` };
  };

  hooks.openCreateBattleModal();
  await settle();
  window.document.getElementById('new-battle-mode').value = 'own_selection_battle';
  window.document.getElementById('new-battle-mode').dispatchEvent(new window.Event('change', { bubbles:true }));
  window.document.getElementById('new-battle-title').value = 'Server Snapshot Create';
  window.document.getElementById('new-battle-prep-crate').value = 'crate:crate-server';
  window.document.getElementById('new-battle-prep-crate').dispatchEvent(new window.Event('change', { bubbles:true }));
  window.document.getElementById('save-new-battle').click();
  await settle();

  assert.equal(calls[0].url, '/api/battles/withPrepSnapshot');
  assert.equal(calls[0].body.crateId, 'crate-server');
  const battle = hooks.getBattles().find(item => item.title === 'Server Snapshot Create');
  assert.ok(battle);
  const snapshot = hooks.battlePrepSnapshotForUser(battle);
  assert.equal(snapshot.serverBacked, true);
  assert.equal(snapshot.syncStatus, 'server');
  assert.equal(snapshot.battleEntryId, 'entry-server');
  assert.equal(snapshot.snapshotVersion, 'snapshot-v1');

  hooks.startBattleSession(battle, { view:'studio' });
  await settle();
  const session = hooks.getActiveBattleSession();
  const context = hooks.buildBattleSubmissionContext(session);
  assert.equal(context.battleEntryId, 'entry-server');
  assert.equal(context.battlePrepSnapshotId, 'snap-server');
  assert.equal(context.battlePrepSnapshotVersion, 'snapshot-v1');
  assert.equal(context.battlePrepSnapshot.serverBacked, true);
  assert.doesNotMatch(JSON.stringify(context), /private\/|storage_object_path|token=/i);

  const completed = hooks.completeBattleWithJudgeResult({ ...session, status:'submission_pending', submissionId:'sub-server' }, {
    overallScore:90,
    won:true,
    components:{ timing:93 },
    evidenceType:'measurable_audio_rule_based'
  }, 'sub-server');
  assert.ifError(completed.error);
  const history = hooks.getBattleResults()[0];
  assert.equal(history.battlePrep.serverBacked, true);
  assert.equal(history.battlePrep.snapshotVersion, 'snapshot-v1');
  assert.equal(history.battlePrep.battleEntryId, 'entry-server');
});

test('authenticated join stores only the joining DJ server snapshot', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  const created = window.DJBattleModes.createBattleRecord({
    id:'join-server-battle',
    modeId:'own_selection_battle',
    title:'Server Join Battle',
    genre:'Open Format',
    status:'open',
    createdBy:'opponent-1',
    entries:{
      'opponent-1':{
        battlePrepSnapshot:{
          id:'opponent-secret',
          userId:'opponent-1',
          crateName:'Private Opponent Crate',
          tracks:[{ libraryId:'server:secret-opponent-track', title:'Do Not Show' }]
        }
      }
    },
    participants:[{ userId:'opponent-1', name:'Rival DJ', status:'joined' }]
  }, { isPremium:true, requireAssignedTracks:false });
  hooks.getBattles().unshift(created.battle);
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    if(url === '/api/battles/join-server-battle/join'){
      return { data:{ entry:{ id:'entry-joiner', battle_id:'join-server-battle', user_id:'user-1' }, snapshot:serverSnapshot({ id:'snap-joiner', snapshotId:'snap-joiner', battleId:'join-server-battle', battleEntryId:'entry-joiner' }) } };
    }
    return { error:`unexpected ${url}` };
  };

  hooks.openBattleLifecycle('join-server-battle');
  await settle();
  assert.doesNotMatch(window.document.getElementById('modal-content').textContent, /Private Opponent Crate|Do Not Show/);
  window.document.getElementById('enter-prep-crate').value = 'crate:crate-server';
  window.document.getElementById('enter-prep-crate').dispatchEvent(new window.Event('change', { bubbles:true }));
  window.document.getElementById('find-opponent').click();
  await settle();

  const joined = hooks.getBattles().find(item => item.id === 'join-server-battle');
  const own = joined.entries['local-profile-digital-king'];
  assert.equal(own.battlePrepSnapshot.serverBacked, true);
  assert.equal(own.battlePrepSnapshotId, 'snap-joiner');
  assert.equal(own.serverBattleEntryId, 'entry-joiner');
  assert.equal(joined.participants.filter(item => item.userId === 'local-profile-digital-king').length, 1);
});

test('local Battle Prep fallback is explicitly unsynced and never calls the server bridge', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  const state = hooks.getLibraryState();
  state.crates.push({
    id:'local-prep',
    name:'Local Prep',
    type:'battle_prep',
    visibility:'private',
    trackIds:['server:srv-alpha', 'server:srv-bravo']
  });
  const calls = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => { calls.push({ url, body:options.body }); return { error:'should not be called' }; };

  hooks.openCreateBattleModal();
  await settle();
  window.document.getElementById('new-battle-mode').value = 'own_selection_battle';
  window.document.getElementById('new-battle-mode').dispatchEvent(new window.Event('change', { bubbles:true }));
  window.document.getElementById('new-battle-title').value = 'Local Unsynced Battle';
  window.document.getElementById('new-battle-prep-crate').value = 'crate:local-prep';
  window.document.getElementById('new-battle-prep-crate').dispatchEvent(new window.Event('change', { bubbles:true }));
  window.document.getElementById('save-new-battle').click();
  await settle();

  assert.equal(calls.length, 0);
  const battle = hooks.getBattles().find(item => item.title === 'Local Unsynced Battle');
  const snapshot = hooks.battlePrepSnapshotForUser(battle);
  assert.equal(snapshot.serverBacked, false);
  assert.equal(snapshot.syncStatus, 'local_unsynced');
  assert.notEqual(snapshot.source, 'server_battle_prep_snapshot');
});

test('server hydration restores snapshots across refresh and rejects another account snapshot', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  const session = {
    id:'battle-hydrate',
    battleId:'battle-hydrate',
    modeId:'own_selection_battle',
    title:'Hydrate Battle',
    mode:'Own Selection Battle',
    genre:'Open Format',
    duration:20,
    entries:{},
    status:'active'
  };
  hooks.setActiveBattleSession(session);
  window.DJBattleApi.apiRequest = async url => {
    if(url === '/api/battleEntries/entry-hydrate/prepSnapshot'){
      return { data:{ entry:{ id:'entry-hydrate' }, snapshot:serverSnapshot({
        id:'snap-hydrate',
        snapshotId:'snap-hydrate',
        battleId:'battle-hydrate',
        battleEntryId:'entry-hydrate',
        tracks:[
          { libraryTrackId:'srv-alpha', order:0, bpm:124, key:'A minor', camelotKey:'8A', genre:'Open Format', duration:180, status:'ready', reasons:[] },
          { libraryTrackId:'srv-missing', order:1, bpm:128, key:'C minor', camelotKey:'5A', genre:'Open Format', duration:190, status:'ready', reasons:[] }
        ]
      }) } };
    }
    return { error:`unexpected ${url}` };
  };

  const hydrated = await hooks.hydrateServerBattlePrepSnapshot('entry-hydrate');
  assert.equal(hydrated.snapshot.snapshotId, 'snap-hydrate');
  assert.equal(hooks.getActiveBattleSession().battleEntryId, 'entry-hydrate');
  assert.deepEqual(Array.from(hooks.getLibraryState().studioLibraryDrawer.validatedOrder), ['server:srv-alpha', 'server:srv-missing']);
  const recovered = hooks.recoverBattlePrepSnapshotInStudio(hooks.getActiveBattleSession());
  assert.deepEqual(recovered.missing, ['server:srv-missing']);

  hooks.getLibraryState().sync.accountId = 'user-2';
  window.DJBattleApi.apiRequest = async () => ({ data:{ entry:{ id:'entry-other' }, snapshot:serverSnapshot({ id:'snap-other', snapshotId:'snap-other', battleEntryId:'entry-other', userId:'user-1' }) } });
  const denied = await hooks.hydrateServerBattlePrepSnapshot('entry-other');
  assert.equal(denied.forbidden, true);
  assert.equal(hooks.getActiveBattleSession().battlePrepSnapshotId, 'snap-hydrate');
});

test('server-backed unavailable track recovery records protected replacement without rewriting evidence', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  const session = {
    id:'battle-replace',
    battleId:'battle-replace',
    modeId:'own_selection_battle',
    title:'Replacement Battle',
    mode:'Own Selection Battle',
    genre:'Open Format',
    duration:20,
    entries:{},
    status:'active'
  };
  const snapshot = hooks.serverBattlePrepSnapshotToLocal(serverSnapshot({
    id:'snap-replace',
    snapshotId:'snap-replace',
    battleId:'battle-replace',
    battleEntryId:'entry-replace',
    tracks:[
      { libraryTrackId:'srv-missing', order:0, bpm:122, key:'A minor', camelotKey:'8A', genre:'Open Format', duration:180, status:'ready', reasons:[] },
      { libraryTrackId:'srv-alpha', order:1, bpm:124, key:'A minor', camelotKey:'8A', genre:'Open Format', duration:180, status:'ready', reasons:[] }
    ]
  }), session, { crateName:'Server Battle Prep' });
  session.entries['local-profile-digital-king'] = { battlePrepSnapshot:snapshot, battlePrepSnapshotId:snapshot.id, serverBattleEntryId:'entry-replace' };
  session.battlePrepSnapshot = snapshot;
  session.battlePrepSnapshotId = snapshot.id;
  session.battleEntryId = 'entry-replace';
  hooks.setActiveBattleSession(session);

  const recovered = hooks.recoverBattlePrepSnapshotInStudio(session);
  assert.deepEqual(recovered.missing, ['server:srv-missing']);
  const calls = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    calls.push({ url, body:options.body });
    if(url === '/api/battlePrepSnapshots/snap-replace/replacements'){
      return { data:{ snapshot:serverSnapshot({
        id:'snap-replace',
        snapshotId:'snap-replace',
        battleId:'battle-replace',
        battleEntryId:'entry-replace',
        tracks:[
          { libraryTrackId:'srv-missing', order:0, bpm:122, key:'A minor', camelotKey:'8A', genre:'Open Format', duration:180, status:'ready', reasons:[] },
          { libraryTrackId:'srv-alpha', order:1, bpm:124, key:'A minor', camelotKey:'8A', genre:'Open Format', duration:180, status:'ready', reasons:[] }
        ],
        replacements:[{ fromTrackId:'srv-missing', toTrackId:'srv-charlie', order:0, snapshotVersion:'snapshot-v1', createdAt:'2026-08-26T12:10:00.000Z' }]
      }) } };
    }
    return { error:`unexpected ${url}` };
  };

  const replaced = await hooks.replaceServerBattlePrepSnapshotTrack('server:srv-missing', 'server:srv-charlie');
  assert.equal(replaced.ok, true);
  assert.equal(calls[0].body.fromTrackId, 'srv-missing');
  assert.equal(calls[0].body.toTrackId, 'srv-charlie');
  assert.equal(replaced.snapshot.tracks[0].libraryId, 'server:srv-missing');
  assert.equal(replaced.snapshot.replacements[0].toTrackId, 'srv-charlie');
});
