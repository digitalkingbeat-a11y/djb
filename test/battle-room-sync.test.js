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
  window.alertMessages = [];
  window.alert = message => window.alertMessages.push(String(message));
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

function roomState(overrides = {}){
  return {
    battle:{
      id:'battle-live',
      modeId:'own_selection_battle',
      title:'Live Server Room',
      genre:'Open Format',
      durationMinutes:20,
      trackSelectionMethod:'own_selection',
      minimumTrackCount:2,
      opponentRequirement:'required',
      status:'started',
      reward:{ type:'xp', metadata:{} },
      creatorPublicProfile:{ name:'Rival Selector', country:'US', belt:'Blue' },
      battleVersion:2,
      startedAt:'2026-08-26T12:00:00.000Z',
      deadlineAt:'2026-08-26T12:20:00.000Z'
    },
    entry:{ id:'entry-live', battle_id:'battle-live', user_id:'user-1', status:'started' },
    snapshot:{
      id:'snap-live',
      snapshotId:'snap-live',
      snapshotVersion:'snap-v2',
      battleId:'battle-live',
      battleEntryId:'entry-live',
      userId:'user-1',
      crateId:'crate-server',
      crateVersion:'crate-v1',
      purpose:'own_selection',
      trackSelectionMethod:'own_selection',
      replacementAllowed:true,
      tracks:[{ libraryTrackId:'srv-alpha', order:0, bpm:124, key:'A minor', camelotKey:'8A', genre:'Open Format', duration:180, status:'ready', reasons:[] }],
      ruleDecisions:{ ready:true },
      availability:{ status:'available' }
    },
    participants:[
      { entryId:'entry-live', status:'started', ready:true, profile:{ name:'Digital King', country:'US', belt:'White' }, presence:{ status:'online', lastSeenAt:'2026-08-26T12:10:00.000Z' }, submission:null },
      { status:'submitted', ready:true, submitted:true, profile:{ name:'Rival Selector', country:'US', belt:'Blue', email:'hidden@example.com' }, presence:{ status:'online', lastSeenAt:'2026-08-26T12:10:00.000Z' }, submission:{ submitted:true, status:'uploaded' } }
    ],
    timing:{ serverNow:'2026-08-26T12:10:00.000Z', startedAt:'2026-08-26T12:00:00.000Z', deadlineAt:'2026-08-26T12:20:00.000Z', durationMinutes:20, remainingSeconds:600 },
    version:2,
    eventId:'battle-room:battle-live:2',
    ...overrides
  };
}

function configureServerRoom(window){
  const hooks = window.__DJBattleTestHooks;
  hooks.getLibraryState().sync.accountId = 'user-1';
  hooks.getLibraryState().sync.status = 'synced';
  const session = {
    id:'battle-live',
    battleId:'battle-live',
    modeId:'own_selection_battle',
    title:'Live Server Room',
    mode:'Own Selection Battle',
    genre:'Open Format',
    duration:20,
    status:'matched',
    battleEntryId:'entry-live',
    battlePrepSyncStatus:'server',
    battlePrepSnapshotVersion:'snap-v1',
    entries:{
      'local-profile-digital-king':{
        battleEntryId:'entry-live',
        serverBattleEntryId:'entry-live',
        battlePrepSyncStatus:'server'
      }
    }
  };
  hooks.setActiveBattleSession(session);
  return { hooks, session };
}

test('protected Battle Room polling applies newer server versions and rejects stale responses', async () => {
  const window = loadAppDom();
  const { hooks, session } = configureServerRoom(window);
  hooks.applyServerBattleRoomState(roomState({ version:3, eventId:'battle-room:battle-live:3', battle:{ ...roomState().battle, battleVersion:3 } }), { session });
  const stale = hooks.applyServerBattleRoomState(roomState({ version:2, eventId:'battle-room:battle-live:2' }), { session });
  assert.equal(stale.stale, true);
  assert.equal(hooks.getActiveBattleSession().battleVersion, 3);
  assert.equal(hooks.getBattleRoomSyncState().status, 'conflict');

  window.DJBattleApi.apiRequest = async url => {
    assert.match(url, /\/api\/battles\/battle-live\/room\?ifVersion=3/);
    return { data:{ room:roomState({ version:4, eventId:'battle-room:battle-live:4', battle:{ ...roomState().battle, battleVersion:4 } }) } };
  };
  await hooks.fetchServerBattleRoomState(hooks.getActiveBattleSession());
  assert.equal(hooks.getActiveBattleSession().battleVersion, 4);
  assert.match(window.document.getElementById('br-live-status').textContent, /Live/);
  assert.doesNotMatch(window.document.body.textContent, /hidden@example.com|private\//i);
});

test('Ready, Not Ready and Start use protected server room endpoints and recover authoritative timer', async () => {
  const window = loadAppDom();
  const { hooks, session } = configureServerRoom(window);
  const calls = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    calls.push({ url, body:options.body });
    if(url === '/api/battleEntries/entry-live/ready') return { data:{ room:roomState({ version:calls.length }) } };
    if(url === '/api/battles/battle-live/start') return { data:{ room:roomState({ version:5, timing:{ ...roomState().timing, remainingSeconds:480 } }) } };
    return { error:`unexpected ${url}` };
  };

  await hooks.setServerBattleReady(session, true);
  await hooks.setServerBattleReady(session, false);
  await hooks.startServerBattleFromRoom(session);
  assert.equal(calls[0].url, '/api/battleEntries/entry-live/ready');
  assert.equal(calls[0].body.ready, true);
  assert.equal(calls[1].body.ready, false);
  assert.equal(calls[2].url, '/api/battles/battle-live/start');
  assert.equal(window.document.getElementById('br-timer-note').textContent, 'Server clock');
  assert.equal(hooks.buildBattleSubmissionContext(hooks.getActiveBattleSession()).battleVersion, 5);
});

test('presence, cancellation and withdrawal use safe server contracts', async () => {
  const window = loadAppDom();
  const { hooks, session } = configureServerRoom(window);
  const calls = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    calls.push({ url, body:options.body });
    if(url === '/api/battleEntries/entry-live/presence') return { data:{ room:roomState({ version:3 }) } };
    if(url === '/api/battles/battle-live/cancel') return { data:{ battle:{ id:'battle-live', status:'cancelled' } } };
    if(url === '/api/battleEntries/entry-live/withdraw') return { data:{ entry:{ id:'entry-live', status:'withdrawn' } } };
    return { error:`unexpected ${url}` };
  };

  await hooks.sendBattleRoomPresence(session, 'reconnecting');
  await hooks.cancelServerBattleFromRoom(session);
  session.status = 'matched';
  await hooks.withdrawServerBattleEntryFromRoom(session);
  assert.deepEqual(calls.map(call => call.url), [
    '/api/battleEntries/entry-live/presence',
    '/api/battles/battle-live/cancel',
    '/api/battleEntries/entry-live/withdraw'
  ]);
  assert.equal(calls[0].body.presence, 'reconnecting');
});

test('duplicate server-backed submissions are blocked before creating another draft', async () => {
  const window = loadAppDom();
  const { hooks, session } = configureServerRoom(window);
  session.submissionId = 'sub-existing';
  session.submissionStatus = 'uploaded';
  let submitCalls = 0;
  window.DJBattleSubmission.submitMix = async () => { submitCalls += 1; return { error:'should not submit' }; };
  hooks.applyServerBattleRoomState(roomState(), { session });
  await settle();
  window.document.getElementById('br-upload-btn').click();
  await settle();
  assert.equal(submitCalls, 0);
  assert.match(window.alertMessages.join(' '), /already has a submission/i);
});

test('uploaded mix and Battle Studio takes are recorded with the correct standardized submission source', async () => {
  const window = loadAppDom();
  const { hooks, session } = configureServerRoom(window);
  hooks.applyServerBattleRoomState(roomState(), { session });
  await settle();

  const sources = [];
  window.DJBattleSubmission.submitMix = async ({ submissionSource }) => {
    sources.push(submissionSource);
    session.submissionId = null;
    return { error:'stop before network upload' };
  };

  const file = new window.File(['audio'], 'manual-mix.webm', { type:'audio/webm' });
  const fileInput = window.document.getElementById('br-upload-file');
  Object.defineProperty(fileInput, 'files', { value:[file], configurable:true });
  fileInput.dispatchEvent(new window.Event('change', { bubbles:true }));
  window.document.getElementById('br-upload-btn').click();
  await settle();

  window.lastRecordedMixFile = new window.File(['audio'], 'studio-take.webm', { type:'audio/webm' });
  window.pendingBattleSubmissionSource = 'battle_studio';
  window.document.getElementById('br-upload-btn').click();
  await settle();

  assert.deepEqual(sources, ['uploaded_mix', 'battle_studio']);
});

