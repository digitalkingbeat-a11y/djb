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

function demoTracks(){
  return [
    { id:'alpha', name:'Alpha Deck Tool', artist:'DJ One', genre:'House', bpm:128, key:'A minor', duration:'3:20', source:'MY_LIBRARY', rightsCategory:'Original / I Own the Rights', battleEligible:true, permissions:{ download:false } },
    { id:'bravo', name:'Bravo Harmonic Cut', artist:'DJ Two', genre:'House', bpm:130, key:'C major', duration:'4:04', source:'MY_LIBRARY', rightsCategory:'Licensed / I Have Permission', battleEligible:true, permissions:{ download:false } },
    { id:'charlie', name:'Charlie Fast Jump', artist:'DJ Three', genre:'Drum & Bass', bpm:146, key:'F minor', duration:'3:45', source:'MY_LIBRARY', rightsCategory:'Original / I Own the Rights', battleEligible:true, permissions:{ download:false } }
  ];
}

function battleSession(overrides = {}){
  return {
    id:'battle-active',
    battleId:'battle-active',
    modeId:'transition_battle',
    title:'Assigned Transition',
    mode:'Transition Battle',
    genre:'House',
    duration:10,
    assigned:['Alpha Deck Tool'],
    status:'active',
    ...overrides
  };
}

function serverTrack(overrides = {}){
  return {
    id:'srv-alpha',
    userId:'user-1',
    title:'Alpha Deck Tool',
    artist:'DJ One',
    genre:'House',
    bpm:128,
    key:'A minor',
    camelotKey:'8A',
    duration:200,
    fileSize:1234,
    fileHash:'a'.repeat(64),
    sourceType:'track',
    rightsClassification:'original',
    visibility:'private',
    analysisConfidence:0.9,
    usageRelationships:{ playlists:[], battles:[], posts:[], practiceHistory:[], submissions:[] },
    ...overrides
  };
}

function serverCrate(overrides = {}){
  return {
    id:'crate-1',
    userId:'user-1',
    name:'Battle Prep House',
    description:'Ordered battle prep tracks',
    visibility:'private',
    type:'battle_prep',
    parentFolderId:null,
    smartRules:null,
    allowDuplicates:false,
    trackIds:['srv-alpha'],
    memberCount:1,
    syncVersion:'2026-08-25T12:00:00.000Z',
    ...overrides
  };
}

function tick(){
  return new Promise(resolve => setTimeout(resolve, 0));
}

test('music library renders a three-panel workstation and persistent player', () => {
  const window = loadAppDom();

  assert.ok(window.document.querySelector('#music-library-workstation'));
  assert.ok(window.document.querySelector('#library-crates'));
  assert.ok(window.document.querySelector('#library-browser'));
  assert.ok(window.document.querySelector('#library-inspector'));
  assert.ok(window.document.querySelector('#library-player'));
  assert.equal(window.document.querySelector('#crate-count-platform').textContent, '2');
  assert.match(window.document.querySelector('#library-status-strip').textContent, /tracks/i);
});

test('library uses CDJ-style sort controls and color-coordinated key badges', () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setLibraryTracks(demoTracks());

  hooks.setLibrarySort({ field:'bpm', direction:'asc' });
  const rows = hooks.filterLibraryTracks();
  assert.deepEqual(Array.from(rows, track => track.id), ['alpha', 'bravo', 'charlie']);

  hooks.setLibrarySort({ field:'bpm', direction:'desc' });
  assert.deepEqual(Array.from(hooks.filterLibraryTracks(), track => track.id), ['charlie', 'bravo', 'alpha']);
  assert.notEqual(hooks.keyColorClass('A minor'), 'key-unknown');
  assert.ok(window.document.querySelector('#library-table .key-badge'));
});

test('compatible-track search filters by measurable BPM and harmonic key compatibility', () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setLibraryTracks(demoTracks());

  assert.equal(hooks.selectLibraryTrack('my:alpha'), true);
  const matches = hooks.compatibleTracksFor('my:alpha');
  assert.deepEqual(Array.from(matches, track => track.id), ['bravo']);

  hooks.setLibraryFilters({ compatibleOnly:true });
  const tableText = window.document.querySelector('#library-table').textContent;
  assert.match(tableText, /Bravo Harmonic Cut/);
  assert.doesNotMatch(tableText, /Charlie Fast Jump/);
});

test('per-track artwork accepts safe image data and rejects private paths', async () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setLibraryTracks([demoTracks()[0]]);

  const safeArtwork = 'data:image/png;base64,aGVsbG8=';
  const attached = await hooks.attachArtworkToTrack('my:alpha', { type:'image/png', size:128, dataUrl:safeArtwork });
  assert.equal(attached.ok, true);
  assert.equal(hooks.secureArtworkSource(hooks.getLibraryTrackById('my:alpha')), safeArtwork);
  assert.equal(hooks.secureArtworkSource({ artwork:'file:///Users/dj/private/cover.png' }), '');
  assert.equal(hooks.secureArtworkSource({ artwork:'https://example.com/storage/v1/private/cover.png?token=secret' }), '');

  const rejected = await hooks.attachArtworkToTrack('my:alpha', { type:'image/png', size:128, dataUrl:'private/storage/cover.png' });
  assert.equal(rejected.ok, false);
});

test('persistent player keeps the selected track while moving between views', () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setLibraryTracks(demoTracks());

  assert.equal(hooks.selectLibraryTrack('my:bravo', { play:true }), true);
  assert.equal(hooks.getLibraryState().player.trackId, 'my:bravo');
  assert.equal(hooks.getLibraryState().player.playing, true);
  assert.equal(window.document.querySelector('#library-player-title').textContent, 'Bravo Harmonic Cut');

  hooks.switchView('profile');
  hooks.switchView('library');
  hooks.renderLibrary();
  assert.equal(window.document.querySelector('#library-player-title').textContent, 'Bravo Harmonic Cut');
});

test('library tracks load directly to Battle Studio decks and record usage', () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setLibraryTracks(demoTracks());
  hooks.setActiveBattleSession(battleSession({ modeId:'full_mix_battle', mode:'Full Mix Battle', assigned:[], duration:60 }));

  const loaded = hooks.loadLibraryTrackToDeck('my:alpha', 'a');
  assert.equal(loaded.ok, true);
  assert.equal(window.document.querySelector('#name-a').textContent, 'Alpha Deck Tool');
  assert.ok(window.document.querySelector('#key-a .key-badge'));
  assert.equal(window.document.querySelector('.deck[data-deck="a"]').dataset.libraryTrackId, 'my:alpha');
  assert.equal(hooks.getStudioDeckState().a.trackId, 'my:alpha');
  assert.ok(hooks.getLibraryState().library[0].usageRelationships.battles.includes('battle-active'));
});

test('active battle rules prevent wrong assigned tracks, premium modes and foreign private tracks', () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setLibraryTracks([
    ...demoTracks(),
    { id:'foreign', name:'Private Rival Tool', artist:'Rival', genre:'House', bpm:128, key:'A minor', duration:'3:00', source:'MY_LIBRARY', rightsCategory:'Original / I Own the Rights', battleEligible:true, visibility:'private', userId:'other-user' }
  ]);

  hooks.setActiveBattleSession(battleSession());
  const wrongAssigned = hooks.loadLibraryTrackToDeck('my:bravo', 'a');
  assert.equal(wrongAssigned.ok, false);
  assert.match(wrongAssigned.error, /assigned tracks only/i);

  const assigned = hooks.loadLibraryTrackToDeck('my:alpha', 'a');
  assert.equal(assigned.ok, true);

  const foreign = hooks.loadLibraryTrackToDeck('my:foreign', 'b');
  assert.equal(foreign.ok, false);
  assert.match(foreign.error, /another DJ/i);

  hooks.setPremium(false);
  hooks.setActiveBattleSession(battleSession({ modeId:'half_hour_mix_battle', mode:'Half-Hour Mix Battle', assigned:[], duration:30 }));
  const premium = hooks.loadLibraryTrackToDeck('my:alpha', 'b');
  assert.equal(premium.ok, false);
  assert.match(premium.error, /Premium/i);
});

test('Battle Studio library drawer preserves battle state and loads selected deck', () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setLibraryTracks(demoTracks());
  hooks.setActiveBattleSession(battleSession({ modeId:'full_mix_battle', mode:'Full Mix Battle', assigned:[], duration:60 }));

  assert.equal(hooks.openStudioLibraryDrawer('b'), true);
  assert.ok(!window.document.querySelector('#studio-library-drawer').classList.contains('hidden'));
  assert.equal(hooks.getActiveBattleSession().battleId, 'battle-active');

  window.document.querySelector('#studio-library-drawer [data-drawer-load="my:bravo"]').click();
  assert.equal(window.document.querySelector('#name-b').textContent, 'Bravo Harmonic Cut');
  assert.equal(hooks.getActiveBattleSession().battleId, 'battle-active');
});

test('permitted library recordings can be selected for submission without re-upload', () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setLibraryTracks([
    { ...demoTracks()[0], id:'recording', sourceType:'submission', linkedSubmissionId:'sub-existing' }
  ]);
  hooks.setActiveBattleSession(battleSession({ modeId:'ai_only_practice', mode:'AI Practice', assigned:[], duration:10 }));

  const selected = hooks.selectLibraryRecordingForSubmission('my:recording');
  assert.equal(selected.ok, true);
  assert.equal(hooks.getActiveBattleSession().librarySubmissionTrackId, 'my:recording');
  assert.equal(hooks.getActiveBattleSession().submissionId, 'sub-existing');
  assert.ok(hooks.getLibraryState().library[0].usageRelationships.submissions.includes('battle-active'));
});

test('authenticated hydration loads server library, deduplicates local cache and keeps signed URLs out of localStorage', async () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setLibraryTracks([{ ...demoTracks()[0], size:1234 }]);
  const calls = [];
  window.DJBattleApi.apiRequest = async url => {
    calls.push(url);
    if(url === '/api/musicLibrary/schemaStatus') return { data:{ ready:true, status:'ready', schema:'012_create_music_library_tracks' } };
    if(url === '/api/musicLibrary/organizationStatus') return { data:{ ready:true, status:'ready', schema:'013_create_music_library_crates' } };
    if(String(url).startsWith('/api/musicLibrary/tracks?')) return { data:{ tracks:[serverTrack()], pagination:{ page:1, limit:50, hasMore:false, nextPage:null } } };
    if(url === '/api/musicLibrary/crates') return { data:{ crates:[serverCrate()] } };
    return { error:'unexpected route' };
  };

  await hooks.handleMusicLibraryAuthChange({ id:'user-1', email:'one@example.test' });
  const state = hooks.getLibraryState();
  assert.equal(state.sync.status, 'synced');
  assert.deepEqual(Array.from(state.library, track => track.id), ['srv-alpha']);
  assert.equal(hooks.filterLibraryTracks()[0].libraryId, 'server:srv-alpha');
  assert.equal(window.document.querySelector('#library-sync-status strong').textContent, 'SYNCED');
  assert.equal(window.localStorage.getItem('djBattleLibrary'), '[]');
  assert.doesNotMatch(window.localStorage.getItem('djBattleLibraryCache:user-1'), /securePlaybackUrl|private\/library-audio|token=/);
  assert.equal(state.crates[0].trackIds[0], 'server:srv-alpha');
  assert.ok(calls.some(url => String(url).includes('page=1')));
});

test('authenticated hydration supports incremental pages without dropping earlier server tracks', async () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  let page = 1;
  window.DJBattleApi.apiRequest = async url => {
    if(url === '/api/musicLibrary/schemaStatus') return { data:{ ready:true, status:'ready', schema:'012_create_music_library_tracks' } };
    if(url === '/api/musicLibrary/organizationStatus') return { data:{ ready:true, status:'ready', schema:'013_create_music_library_crates' } };
    if(String(url).includes('page=1')) return { data:{ tracks:[serverTrack({ id:'srv-1', title:'Page One' })], pagination:{ page:1, limit:1, hasMore:true, nextPage:2 } } };
    if(String(url).includes('page=2')){ page = 2; return { data:{ tracks:[serverTrack({ id:'srv-2', title:'Page Two' })], pagination:{ page:2, limit:1, hasMore:false, nextPage:null } } }; }
    if(url === '/api/musicLibrary/crates') return { data:{ crates:[] } };
    return { error:'unexpected route' };
  };

  await hooks.handleMusicLibraryAuthChange({ id:'user-1' });
  assert.equal(hooks.getLibraryState().sync.hasMore, true);
  await hooks.hydrateNextMusicLibraryPage();
  assert.equal(page, 2);
  assert.deepEqual(Array.from(hooks.getLibraryState().library, track => track.id), ['srv-1', 'srv-2']);
});

test('account switching clears private hydrated tracks before loading another DJ cache', async () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  window.DJBattleApi.apiRequest = async url => {
    if(url === '/api/musicLibrary/schemaStatus') return { data:{ ready:true, status:'ready', schema:'012_create_music_library_tracks' } };
    if(url === '/api/musicLibrary/organizationStatus') return { data:{ ready:true, status:'ready', schema:'013_create_music_library_crates' } };
    if(String(url).startsWith('/api/musicLibrary/tracks?')){
      const account = hooks.getLibraryState().sync.accountId;
      return { data:{ tracks:[serverTrack({ id:`srv-${account}`, userId:account, title:`Track ${account}` })], pagination:{ page:1, limit:50, hasMore:false } } };
    }
    if(url === '/api/musicLibrary/crates') return { data:{ crates:[serverCrate({ id:`crate-${hooks.getLibraryState().sync.accountId}`, userId:hooks.getLibraryState().sync.accountId, trackIds:[`srv-${hooks.getLibraryState().sync.accountId}`] })] } };
    return { data:{} };
  };

  await hooks.handleMusicLibraryAuthChange({ id:'user-1' });
  assert.match(window.document.querySelector('#library-table').textContent, /Track user-1/);
  await hooks.handleMusicLibraryAuthChange({ id:'user-2' });
  const table = window.document.querySelector('#library-table').textContent;
  assert.match(table, /Track user-2/);
  assert.doesNotMatch(table, /Track user-1/);
  assert.doesNotMatch(window.localStorage.getItem('djBattleLibrary'), /srv-user/);
});

test('offline metadata changes queue safely and retry through the protected server contract', async () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setLibraryTracks([serverTrack({ serverBacked:true, userId:'user-1', rightsCategory:'Original / I Own the Rights', battleEligible:true })]);
  hooks.getLibraryState().sync.accountId = 'user-1';
  hooks.getLibraryState().sync.status = 'offline';

  const queued = await hooks.updateLibraryTrackMetadataOptimistic('server:srv-alpha', { title:'Offline Rename', visibility:'profile' });
  assert.equal(queued.queued, true);
  assert.equal(hooks.getLibraryTrackById('server:srv-alpha').title, 'Offline Rename');
  assert.equal(hooks.getLibraryState().sync.pendingQueue.length, 1);
  assert.doesNotMatch(window.localStorage.getItem('djBattleMusicLibrarySyncState'), /securePlaybackUrl|private\/library-audio|token=/);

  const routes = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    routes.push({ url, body:options.body });
    return { data:{ track:serverTrack({ title:options.body.title, visibility:options.body.visibility }) } };
  };
  hooks.getLibraryState().sync.status = 'synced';
  const flushed = await hooks.flushMusicLibrarySyncQueue();
  assert.equal(flushed.flushed, 1);
  assert.equal(hooks.getLibraryState().sync.pendingQueue.length, 0);
  assert.equal(routes[0].url, '/api/musicLibrary/tracks/srv-alpha');
});

test('server rejection rolls optimistic metadata back and reports failed sync', async () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setLibraryTracks([serverTrack({ serverBacked:true, userId:'user-1', rightsCategory:'Original / I Own the Rights', battleEligible:true })]);
  hooks.getLibraryState().sync.accountId = 'user-1';
  hooks.getLibraryState().sync.status = 'synced';
  window.DJBattleApi.apiRequest = async () => ({ status:409, error:'Conflict' });

  const result = await hooks.updateLibraryTrackMetadataOptimistic('server:srv-alpha', { title:'Rejected Rename' });
  assert.equal(result.rolledBack, true);
  assert.equal(hooks.getLibraryTrackById('server:srv-alpha').title, 'Alpha Deck Tool');
  assert.equal(hooks.getLibraryState().sync.status, 'conflict');
});

test('expired playback URLs refresh through protected playback and are not cached permanently', async () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setLibraryTracks([serverTrack({
    serverBacked:true,
    userId:'user-1',
    rightsCategory:'Original / I Own the Rights',
    battleEligible:true,
    securePlaybackUrl:'https://signed.example/old?token=old',
    playbackExpiresAt:'2020-01-01T00:00:00.000Z'
  })]);
  hooks.getLibraryState().sync.accountId = 'user-1';
  window.DJBattleApi.apiRequest = async url => {
    assert.equal(url, '/api/musicLibrary/tracks/srv-alpha/playbackAccess');
    return { data:{ track:serverTrack({ playbackAccess:{ url:'https://signed.example/new?token=new', expiresAt:'2999-01-01T00:00:00.000Z' } }) } };
  };

  const refreshed = await hooks.requestLibraryPlaybackAccess('server:srv-alpha');
  assert.equal(refreshed.data.track.securePlaybackUrl, 'https://signed.example/new?token=new');
  assert.doesNotMatch(window.localStorage.getItem('djBattleLibrary'), /signed\.example|token=/);
  assert.doesNotMatch(window.localStorage.getItem('djBattleLibraryCache:user-1') || '', /signed\.example|token=/);
});

test('server-backed crates hydrate, preserve order, filter the library and avoid private cache leaks', async () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  window.DJBattleApi.apiRequest = async url => {
    if(url === '/api/musicLibrary/schemaStatus') return { data:{ ready:true, status:'ready', schema:'012_create_music_library_tracks' } };
    if(url === '/api/musicLibrary/organizationStatus') return { data:{ ready:true, status:'ready', schema:'013_create_music_library_crates' } };
    if(String(url).startsWith('/api/musicLibrary/tracks?')) return { data:{ tracks:[
      serverTrack({ id:'srv-alpha', title:'Alpha Deck Tool' }),
      serverTrack({ id:'srv-bravo', title:'Bravo Harmonic Cut', fileHash:'b'.repeat(64) })
    ], pagination:{ page:1, limit:50, hasMore:false } } };
    if(url === '/api/musicLibrary/crates') return { data:{ crates:[serverCrate({ trackIds:['srv-bravo', 'srv-alpha'] })] } };
    return { error:'unexpected route' };
  };

  await hooks.handleMusicLibraryAuthChange({ id:'user-1' });
  assert.deepEqual(hooks.getLibraryState().crates[0].trackIds, ['server:srv-bravo', 'server:srv-alpha']);
  hooks.setLibraryFilters({ crate:'crate:crate-1' });
  assert.deepEqual(Array.from(hooks.filterLibraryTracks(), track => track.id), ['srv-bravo', 'srv-alpha']);
  assert.match(window.document.querySelector('#playlists-list').textContent, /Battle Prep House/);
  assert.doesNotMatch(window.localStorage.getItem('djBattleLibraryCratesCache:user-1'), /private\/|token=/);
});

test('smart crates recalculate from real library records and Battle Prep loads next eligible deck tracks', () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setPremium(true);
  hooks.setLibraryTracks([
    serverTrack({ serverBacked:true, id:'srv-alpha', title:'Alpha Deck Tool', userId:'user-1', rightsCategory:'Original / I Own the Rights', battleEligible:true, visibility:'private', analysisConfidence:0.9 }),
    serverTrack({ serverBacked:true, id:'srv-bravo', title:'Bravo Harmonic Cut', userId:'user-1', rightsCategory:'Licensed / I Have Permission', battleEligible:true, visibility:'private', key:'E minor', camelotKey:'9A', bpm:130, fileHash:'b'.repeat(64), analysisConfidence:null })
  ]);
  hooks.getLibraryState().sync.accountId = 'user-1';
  hooks.getLibraryState().crates.push({ id:'prep-1', name:'Set Order', type:'battle_prep', trackIds:['server:srv-alpha', 'server:srv-bravo'], visibility:'private' });
  hooks.selectLibraryTrack('server:srv-alpha');
  hooks.setLibraryFilters({ crate:'smart:compatible-selected' });
  assert.deepEqual(Array.from(hooks.filterLibraryTracks(), track => track.id), ['srv-bravo']);

  hooks.setActiveBattleSession(battleSession({ modeId:'ai_only_practice', mode:'AI Practice', assigned:[], duration:10 }));
  const first = hooks.loadNextFromBattlePrepCrate('crate:prep-1', 'a');
  const second = hooks.loadNextFromBattlePrepCrate('crate:prep-1', 'b');
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(hooks.getStudioDeckState().a.trackId, 'server:srv-alpha');
  assert.equal(hooks.getStudioDeckState().b.trackId, 'server:srv-bravo');
});

test('offline crate ordering queues safely and retries through the protected crate contract', async () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setLibraryTracks([serverTrack({ serverBacked:true, userId:'user-1', rightsCategory:'Original / I Own the Rights', battleEligible:true })]);
  hooks.getLibraryState().sync.accountId = 'user-1';
  hooks.getLibraryState().sync.status = 'offline';
  hooks.getLibraryState().crates.push({ ...serverCrate(), serverBacked:true, trackIds:[] });

  const queued = await hooks.addTracksToCrate('crate:crate-1', ['server:srv-alpha']);
  assert.equal(queued.queued, true);
  assert.equal(hooks.getLibraryState().sync.pendingQueue[0].type, 'crate_membership');
  assert.doesNotMatch(window.localStorage.getItem('djBattleMusicLibrarySyncState'), /private\/|token=/);

  const routes = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    routes.push({ url, body:options.body });
    return { data:{ crate:serverCrate({ trackIds:options.body.trackIds }) } };
  };
  hooks.getLibraryState().sync.status = 'synced';
  const flushed = await hooks.flushMusicLibrarySyncQueue();
  assert.equal(flushed.flushed, 1);
  assert.equal(routes[0].url, '/api/musicLibrary/crates/crate-1/tracks');
  assert.deepEqual(Array.from(routes[0].body.trackIds), ['srv-alpha']);
});

test('practice recordings sync as reusable library submissions without re-upload', async () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.getLibraryState().sync.accountId = 'user-1';
  hooks.getLibraryState().sync.status = 'synced';
  const routes = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    routes.push({ url, body:options.body });
    assert.equal(url, '/api/musicLibrary/practiceRecordings');
    return { data:{ track:serverTrack({ id:'practice-track-1', sourceType:'practice_recording', linkedSubmissionId:'practice-sub-1', title:options.body.title, practiceMetadata:{ score:92, recommendations:options.body.recommendations } }) } };
  };

  const created = await hooks.createPracticeRecordingFromSubmissionLocal({
    sourceSubmissionId:'practice-sub-1',
    practiceHistoryId:'practice-history-1',
    title:'Practice Keeper',
    score:92,
    recommendations:['Keep the outro tighter']
  });
  assert.equal(created.ok, true);
  assert.equal(routes[0].body.sourceSubmissionId, 'practice-sub-1');
  hooks.setActiveBattleSession(battleSession({ modeId:'ai_only_practice', mode:'AI Practice', assigned:[], duration:10 }));
  const selected = hooks.selectLibraryRecordingForSubmission('server:practice-track-1');
  assert.equal(selected.ok, true);
  assert.equal(hooks.getActiveBattleSession().librarySubmissionTrackId, 'server:practice-track-1');
  assert.equal(hooks.getActiveBattleSession().submissionId, 'practice-sub-1');
});

test('crate editor renders hardware controls, supports shift selection and undo reorder', async () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setLibraryTracks(demoTracks());
  hooks.getLibraryState().crates.push({
    id:'prep-editor',
    name:'Editor Prep',
    description:'Manual battle order',
    type:'battle_prep',
    visibility:'private',
    trackIds:['my:alpha', 'my:bravo', 'my:charlie']
  });

  hooks.setLibraryFilters({ crate:'crate:prep-editor' });
  assert.equal(hooks.setCrateEditorMode(true, 'crate:prep-editor'), true);
  assert.equal(window.document.querySelectorAll('#library-table .drag-handle').length, 3);
  assert.ok(window.document.querySelector('.crate-editor-panel'));

  hooks.selectCrateTrack('my:alpha');
  hooks.selectCrateTrack('my:charlie', { shift:true });
  assert.deepEqual(Array.from(hooks.getLibraryState().crateEditor.selectedTrackIds), ['my:alpha', 'my:bravo', 'my:charlie']);
  assert.equal(window.document.querySelectorAll('#library-table tr.crate-selected').length, 3);

  const moved = await hooks.reorderCrateTrack('crate:prep-editor', 'my:charlie', 'up');
  assert.equal(moved.ok, true);
  assert.deepEqual(Array.from(hooks.resolveCrateTrackIds('crate:prep-editor')), ['my:alpha', 'my:charlie', 'my:bravo']);

  const undone = await hooks.undoLastCrateEdit();
  assert.equal(undone.ok, true);
  assert.deepEqual(Array.from(hooks.resolveCrateTrackIds('crate:prep-editor')), ['my:alpha', 'my:bravo', 'my:charlie']);
});

test('bulk add and remove update crate memberships without deleting audio and queue offline saves', async () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setLibraryTracks([
    serverTrack({ serverBacked:true, id:'srv-alpha', userId:'user-1', title:'Alpha Deck Tool', rightsCategory:'Original / I Own the Rights', battleEligible:true }),
    serverTrack({ serverBacked:true, id:'srv-bravo', userId:'user-1', title:'Bravo Harmonic Cut', fileHash:'b'.repeat(64), rightsCategory:'Licensed / I Have Permission', battleEligible:true })
  ]);
  hooks.getLibraryState().sync.accountId = 'user-1';
  hooks.getLibraryState().sync.status = 'offline';
  hooks.getLibraryState().crates.push(
    { ...serverCrate({ id:'crate-main', trackIds:['srv-alpha', 'srv-bravo'] }), serverBacked:true },
    { ...serverCrate({ id:'crate-target', name:'Second Prep', trackIds:[] }), serverBacked:true }
  );

  hooks.setLibraryFilters({ crate:'crate:crate-main' });
  hooks.setCrateEditorMode(true, 'crate:crate-main');
  hooks.selectCrateTrack('server:srv-alpha');
  const removed = await hooks.removeTracksFromCrate('crate:crate-main', hooks.getLibraryState().crateEditor.selectedTrackIds);
  assert.equal(removed.queued, true);
  assert.deepEqual(Array.from(hooks.resolveCrateTrackIds('crate:crate-main')), ['server:srv-bravo']);
  assert.equal(hooks.getLibraryState().library.length, 2);

  hooks.selectCrateTrack('server:srv-bravo');
  const added = await hooks.addSelectedTracksToCrates(['crate:crate-target']);
  assert.equal(added[0].queued, true);
  assert.deepEqual(Array.from(hooks.resolveCrateTrackIds('crate:crate-target')), ['server:srv-bravo']);
  assert.ok(hooks.getLibraryState().sync.pendingQueue.every(item => item.type === 'crate_membership'));
});

test('server crate order conflicts merge remote and local changes predictably', async () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setLibraryTracks([
    serverTrack({ serverBacked:true, id:'srv-alpha', userId:'user-1' }),
    serverTrack({ serverBacked:true, id:'srv-bravo', userId:'user-1', title:'Bravo Harmonic Cut', fileHash:'b'.repeat(64) }),
    serverTrack({ serverBacked:true, id:'srv-charlie', userId:'user-1', title:'Charlie Fast Jump', fileHash:'c'.repeat(64) })
  ]);
  hooks.getLibraryState().sync.accountId = 'user-1';
  hooks.getLibraryState().sync.status = 'synced';
  hooks.getLibraryState().crates.push({ ...serverCrate({ trackIds:['srv-alpha', 'srv-bravo'] }), serverBacked:true });
  window.DJBattleApi.apiRequest = async () => ({
    status:409,
    error:'Conflict',
    data:{ crate:serverCrate({ trackIds:['srv-bravo', 'srv-charlie'] }) }
  });

  const result = await hooks.setCrateTrackOrder('crate:crate-1', ['server:srv-alpha', 'server:srv-bravo']);
  assert.equal(result.conflict, true);
  assert.deepEqual(Array.from(hooks.resolveCrateTrackIds('crate:crate-1')), ['server:srv-bravo', 'server:srv-charlie', 'server:srv-alpha']);
  assert.equal(hooks.getLibraryState().sync.status, 'conflict');
  assert.equal(hooks.getLibraryState().sync.pendingQueue[0].type, 'crate_membership');
});

test('crate duplicate preserves order and archive removes only the crate', async () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setLibraryTracks(demoTracks());
  hooks.getLibraryState().crates.push({
    id:'prep-copy-source',
    name:'Copy Source',
    type:'battle_prep',
    visibility:'private',
    trackIds:['my:bravo', 'my:alpha']
  });

  const duplicated = await hooks.duplicateLibraryCrateOptimistic('crate:prep-copy-source', 'Copy Target');
  assert.equal(duplicated.ok, true);
  assert.deepEqual(Array.from(hooks.resolveCrateTrackIds(duplicated.crate)), ['my:bravo', 'my:alpha']);

  const archived = await hooks.deleteLibraryCrateOptimistic('crate:prep-copy-source');
  assert.equal(archived.ok, true);
  assert.equal(hooks.getLibraryTrackById('my:alpha').id, 'alpha');
  assert.equal(hooks.getLibraryState().crates.some(crate => crate.id === 'prep-copy-source'), false);
});

test('Battle Prep validation blocks invalid crates, suggests replacements and loads valid order into Studio', async () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setPremium(true);
  hooks.setLibraryTracks(demoTracks());
  hooks.setActiveBattleSession(battleSession());
  hooks.getLibraryState().crates.push({
    id:'prep-validate',
    name:'Validation Prep',
    type:'battle_prep',
    visibility:'private',
    trackIds:['my:bravo', 'my:alpha']
  });
  hooks.setLibraryFilters({ crate:'crate:prep-validate' });

  const blocked = hooks.validateBattlePrepCrate('crate:prep-validate');
  assert.equal(blocked.ready, false);
  assert.match(blocked.blockers.join(' '), /assigned tracks only/i);
  assert.ok(blocked.rows[0].suggestions.some(item => item.libraryId === 'my:alpha'));
  assert.match(window.document.querySelector('.crate-editor-panel').textContent, /BLOCKED/);

  const openBlocked = hooks.openBattlePrepCrateInStudio('crate:prep-validate');
  assert.equal(openBlocked.ok, false);

  await hooks.setCrateTrackOrder('crate:prep-validate', ['my:alpha']);
  const ready = hooks.validateBattlePrepCrate('crate:prep-validate');
  assert.equal(ready.ready, true);
  const opened = hooks.openBattlePrepCrateInStudio('crate:prep-validate');
  assert.equal(opened.ok, true);
  assert.deepEqual(Array.from(hooks.getLibraryState().studioLibraryDrawer.validatedOrder), ['my:alpha']);
  assert.ok(window.document.querySelector('#studio-library-drawer [data-drawer-load="my:alpha"]'));
  assert.match(window.document.querySelector('#studio-library-drawer').textContent, /Validated order: Validation Prep/);
});

test('battle creation validates an owned Battle Prep crate and stores an immutable creator snapshot', async () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setPremium(true);
  hooks.setLibraryTracks(demoTracks());
  hooks.getLibraryState().crates.push({
    id:'creator-prep',
    name:'Creator Prep',
    type:'battle_prep',
    visibility:'private',
    trackIds:['my:alpha', 'my:bravo']
  });

  hooks.openCreateBattleModal();
  await tick();
  window.document.getElementById('new-battle-mode').value = 'own_selection_battle';
  window.document.getElementById('new-battle-mode').dispatchEvent(new window.Event('change', { bubbles:true }));
  window.document.getElementById('new-battle-title').value = 'Crate Snapshot Test';
  window.document.getElementById('new-battle-prep-crate').value = 'crate:creator-prep';
  window.document.getElementById('new-battle-prep-crate').dispatchEvent(new window.Event('change', { bubbles:true }));
  assert.match(window.document.getElementById('new-battle-prep-status').textContent, /validated/i);
  window.document.getElementById('save-new-battle').click();

  const battle = hooks.getBattles().find(item => item.title === 'Crate Snapshot Test');
  assert.ok(battle);
  const snapshot = hooks.battlePrepSnapshotForUser(battle);
  assert.ok(snapshot);
  assert.deepEqual(Array.from(snapshot.tracks, track => track.libraryId), ['my:alpha', 'my:bravo']);

  await hooks.setCrateTrackOrder('crate:creator-prep', ['my:charlie', 'my:alpha']);
  assert.deepEqual(Array.from(hooks.resolveCrateTrackIds('crate:creator-prep')), ['my:charlie', 'my:alpha']);
  assert.deepEqual(Array.from(snapshot.tracks, track => track.libraryId), ['my:alpha', 'my:bravo']);
});

test('battle creation blocks invalid prep crates before creating the battle', async () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setPremium(true);
  hooks.setLibraryTracks([demoTracks()[0]]);
  hooks.getLibraryState().crates.push({
    id:'short-prep',
    name:'Short Prep',
    type:'battle_prep',
    visibility:'private',
    trackIds:['my:alpha']
  });

  hooks.openCreateBattleModal();
  await tick();
  window.document.getElementById('new-battle-mode').value = 'own_selection_battle';
  window.document.getElementById('new-battle-mode').dispatchEvent(new window.Event('change', { bubbles:true }));
  window.document.getElementById('new-battle-title').value = 'Blocked Crate Battle';
  window.document.getElementById('new-battle-track-count').value = '2';
  window.document.getElementById('new-battle-prep-crate').value = 'crate:short-prep';
  window.document.getElementById('new-battle-prep-crate').dispatchEvent(new window.Event('change', { bubbles:true }));
  window.document.getElementById('save-new-battle').click();

  assert.match(window.document.getElementById('new-battle-error').textContent, /at least 2 eligible track/i);
  assert.equal(hooks.getBattles().some(item => item.title === 'Blocked Crate Battle'), false);
});

test('joining validates the DJ-owned crate and keeps opponent prep data private', async () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setPremium(true);
  hooks.setLibraryTracks(demoTracks());
  hooks.getLibraryState().crates.push({
    id:'joiner-prep',
    name:'Joiner Prep',
    type:'battle_prep',
    visibility:'private',
    trackIds:['my:alpha', 'my:bravo']
  });
  const created = window.DJBattleModes.createBattleRecord({
    id:'join-prep-battle',
    modeId:'own_selection_battle',
    title:'Join Prep Battle',
    genre:'Open Format',
    status:'open',
    createdBy:'opponent-1',
    entries:{
      'opponent-1':{
        battlePrepSnapshot:{
          id:'opponent-secret',
          userId:'opponent-1',
          crateName:'Opponent Secret Crate',
          tracks:[{ libraryId:'server:private-opponent-track', title:'Private Opponent Track' }]
        }
      }
    },
    participants:[{ userId:'opponent-1', name:'Rival DJ', status:'joined' }]
  }, { isPremium:true, requireAssignedTracks:false });
  hooks.getBattles().unshift(created.battle);

  hooks.openBattleLifecycle('join-prep-battle');
  await tick();
  assert.doesNotMatch(window.document.getElementById('modal-content').textContent, /Opponent Secret Crate|Private Opponent Track/);
  window.document.getElementById('enter-prep-crate').value = 'crate:joiner-prep';
  window.document.getElementById('enter-prep-crate').dispatchEvent(new window.Event('change', { bubbles:true }));
  window.document.getElementById('find-opponent').click();

  const joined = hooks.getBattles().find(item => item.id === 'join-prep-battle');
  assert.ok(joined.entries['local-profile-digital-king'].battlePrepSnapshot);
  assert.equal(joined.participants.filter(item => item.userId === 'local-profile-digital-king').length, 1);
  assert.equal(joined.entries['local-profile-digital-king'].battlePrepSnapshot.crateName, 'Joiner Prep');
});

test('cross-account Battle Prep crates are rejected for lifecycle entry validation', () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setLibraryTracks(demoTracks());
  hooks.getLibraryState().crates.push({
    id:'foreign-prep',
    userId:'other-user',
    name:'Foreign Prep',
    type:'battle_prep',
    visibility:'private',
    trackIds:['my:alpha', 'my:bravo']
  });

  const validation = hooks.validateBattlePrepCrateForBattle('crate:foreign-prep', {
    id:'foreign-check',
    modeId:'own_selection_battle',
    genre:'Open Format',
    durationMinutes:20,
    trackSelectionMethod:'own_selection',
    minimumTrackCount:2
  });
  assert.equal(validation.ready, false);
  assert.match(validation.blockers.join(' '), /belongs to another DJ/i);
});

test('Studio recovers the immutable prep snapshot, warns on unavailable tracks and allows safe replacement', async () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setPremium(true);
  hooks.setLibraryTracks(demoTracks());
  const validation = hooks.validateBattlePrepCrateForBattle('', { modeId:'own_selection_battle' });
  assert.equal(validation.optional, true);
  const battle = window.DJBattleModes.createBattleRecord({
    id:'studio-recovery-battle',
    modeId:'own_selection_battle',
    title:'Studio Recovery Battle',
    genre:'Open Format',
    status:'active',
    participants:[{ userId:'local-profile-digital-king', name:'Digital King', status:'joined' }]
  }, { isPremium:true, requireAssignedTracks:false }).battle;
  const crate = { id:'recover-prep', name:'Recover Prep', type:'battle_prep', visibility:'private', trackIds:['my:alpha', 'my:bravo'] };
  hooks.getLibraryState().crates.push(crate);
  const prepValidation = hooks.validateBattlePrepCrateForBattle('crate:recover-prep', battle);
  const snapshot = hooks.buildBattlePrepEntrySnapshot('crate:recover-prep', battle, prepValidation);
  const withSnapshot = hooks.attachBattlePrepSnapshotToBattle(battle, snapshot);
  hooks.startBattleSession(withSnapshot, { view:'studio' });
  hooks.loadLibraryTrackToDeck('my:alpha', 'a');
  const beforeDeck = { ...hooks.getStudioDeckState().a };

  hooks.setLibraryTracks([demoTracks()[0], demoTracks()[2]]);
  const recovered = hooks.recoverBattlePrepSnapshotInStudio(hooks.getActiveBattleSession());
  assert.equal(recovered.missing.length, 1);
  assert.equal(JSON.stringify(hooks.getStudioDeckState().a), JSON.stringify(beforeDeck));
  assert.match(window.document.getElementById('studio-library-rule-status').textContent, /unavailable/i);

  const replaced = hooks.replaceBattlePrepSnapshotTrack('my:bravo', 'my:charlie');
  assert.equal(replaced.ok, true);
  assert.deepEqual(Array.from(replaced.snapshot.tracks, track => track.libraryId), ['my:alpha', 'my:charlie']);
});

test('submission and result history keep private prep context while public summaries redact track IDs', () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setPlatformLibrary([]);
  hooks.setPremium(true);
  hooks.setLibraryTracks(demoTracks());
  hooks.getLibraryState().crates.push({
    id:'result-prep',
    name:'Result Prep',
    type:'battle_prep',
    visibility:'private',
    trackIds:['my:alpha', 'my:bravo']
  });
  const created = window.DJBattleModes.createBattleRecord({
    id:'result-prep-battle',
    modeId:'bitcoin_battle',
    title:'Result Prep Battle',
    genre:'Open Format',
    status:'submission_pending',
    assignedTracks:['Platform Beat 001', 'Platform Loop 02'],
    reward:{ type:'bitcoin', metadata:{ network:'bitcoin', custody:'external_pending', amountSats:5000 } },
    participants:[{ userId:'local-profile-digital-king', name:'Digital King', status:'submitted', submissionId:'sub-prep' }]
  }, { requireAssignedTracks:false });
  const validation = hooks.validateBattlePrepCrateForBattle('crate:result-prep', created.battle);
  assert.equal(validation.ready, true);
  const snapshot = hooks.buildBattlePrepEntrySnapshot('crate:result-prep', created.battle, validation);
  const battle = hooks.attachBattlePrepSnapshotToBattle(created.battle, snapshot);
  hooks.getBattles().unshift(battle);
  hooks.startBattleSession(battle, { assigned:battle.assignedTracks });

  const context = hooks.buildBattleSubmissionContext(hooks.getActiveBattleSession());
  assert.equal(context.reward.type, 'bitcoin');
  assert.equal(context.battlePrepSnapshot.purpose, 'reference');
  assert.doesNotMatch(JSON.stringify(context), /storage_object_path|private\/|token=/i);

  const completed = hooks.completeBattleWithJudgeResult(
    { id:battle.id, battleId:battle.id, participants:battle.participants, battlePrepSnapshot:snapshot, status:'submission_pending', submissionId:'sub-prep' },
    { overallScore:89, won:true, components:{ timing:91 }, evidenceType:'measurable_audio_rule_based' },
    'sub-prep'
  );
  assert.ifError(completed.error);
  const record = hooks.getBattleResults()[0];
  assert.equal(record.battlePrep.trackCount, 2);
  assert.ok(record.battlePrep.tracks.some(track => track.libraryId === 'my:alpha'));
  const publicSummary = hooks.battlePrepSummaryForHistory(record.battlePrep, 'public');
  assert.equal(publicSummary.trackCount, 2);
  assert.doesNotMatch(JSON.stringify(publicSummary), /my:alpha|crate:result-prep|libraryId|private\/|token=/i);
});
