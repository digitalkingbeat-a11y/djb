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

function challengeRow(overrides = {}){
  return {
    id:'challenge-1',
    status:'pending',
    direction:'received',
    createdAt:'2026-08-27T12:00:00.000Z',
    expiresAt:'2026-08-30T12:00:00.000Z',
    origin:{ publicProfileId:'dj_recipient', rankingCategory:'competitive_battles', source:'public_profile' },
    challenger:{ publicProfileId:'dj_challenger', displayName:'Challenger DJ', country:'US', belt:'Blue', rating:1810 },
    recipient:{ publicProfileId:'dj_recipient', displayName:'Recipient DJ', country:'GB', belt:'Green', rating:1740 },
    rules:{ modeId:'own_selection_battle', modeLabel:'Own Selection Battle', genre:'Open Format', durationMinutes:20, scoringType:'hybrid', ownSelectionEligible:true, reward:{ type:'xp', metadataStatus:'standard' } },
    eligibility:{ canAccept:true, canDecline:true, canCancel:false, requiresRecipientCrate:true },
    ...overrides
  };
}

function notificationRow(overrides = {}){
  return {
    id:'notification-1',
    eventId:'event-1',
    type:'challenge_received',
    category:'challenge',
    eventVersion:100,
    status:'delivered',
    unread:true,
    readAt:null,
    archivedAt:null,
    muted:false,
    createdAt:'2026-08-27T12:00:00.000Z',
    updatedAt:'2026-08-27T12:00:00.000Z',
    actor:{ publicProfileId:'dj_challenger', displayName:'Challenger DJ', country:'US', belt:'Blue', rating:1810 },
    challenge:challengeRow(),
    destination:{ type:'challenge_inbox', challengeId:'challenge-1', label:'Open Challenges' },
    summary:'Challenger DJ challenged you to Own Selection Battle.',
    ...overrides
  };
}

function roomState(){
  return {
    battle:{ id:'battle-challenge-1', modeId:'own_selection_battle', title:'Challenge Accepted', genre:'Open Format', durationMinutes:20, status:'matched', reward:{ type:'xp', metadata:{} }, battleVersion:2 },
    entry:{ id:'entry-recipient', battleId:'battle-challenge-1', status:'active', battlePrepSnapshotId:'snap-recipient' },
    snapshot:{ id:'snap-recipient', snapshotId:'snap-recipient', snapshotVersion:'snap-v1', battleId:'battle-challenge-1', battleEntryId:'entry-recipient', userId:'user-1', crateId:'crate-server', crateVersion:'crate-v1', purpose:'own_selection', trackSelectionMethod:'own_selection', replacementAllowed:true, tracks:[], ruleDecisions:{ ready:true }, availability:{ status:'available' } },
    participants:[
      { entryId:'entry-recipient', status:'active', ready:false, prepared:true, profile:{ name:'Recipient DJ', country:'GB', belt:'Green' } },
      { status:'active', ready:false, prepared:true, profile:{ name:'Challenger DJ', country:'US', belt:'Blue', email:'hidden@example.com' } }
    ],
    timing:{ serverNow:'2026-08-27T12:05:00.000Z', durationMinutes:20, remainingSeconds:null },
    version:2,
    eventId:'battle-room:battle-challenge-1:2',
    resolution:null
  };
}

test('public profile exposes Challenge DJ only for eligible profiles and sends protected server payload', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  const calls = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    calls.push({ url, body:options.body });
    if(url === '/api/challenges') return { status:201, data:{ challenge:challengeRow({ direction:'sent' }) } };
    if(url === '/api/challenges/count') return { status:200, data:{ counts:{ pendingReceived:0, pendingSent:1, pendingTotal:1 } } };
    return { status:200, data:{} };
  };

  hooks.renderPublicDjProfile(publicProfile());
  await settle();
  assert.ok(window.document.getElementById('challenge-public-dj'));
  window.document.getElementById('challenge-public-dj').click();
  await settle();
  window.document.getElementById('challenge-prep-crate').value = 'crate:crate-server';
  window.document.getElementById('challenge-prep-crate').dispatchEvent(new window.Event('change', { bubbles:true }));
  window.document.getElementById('send-dj-challenge').click();
  await settle();

  const send = calls.find(call => call.url === '/api/challenges');
  assert.ok(send);
  assert.equal(send.body.recipientPublicProfileId, 'dj_recipient');
  assert.equal(send.body.challengerCrateId, 'crate-server');
  assert.equal(send.body.origin.rankingCategory, 'competitive_battles');
  assert.equal(send.body.rules.modeId, 'own_selection_battle');
  assert.doesNotMatch(JSON.stringify(send.body), /private\/|storage_object_path|service_key|token=/i);

  hooks.renderPublicDjProfile(publicProfile({ isSelf:true }));
  await settle();
  assert.equal(window.document.getElementById('challenge-public-dj'), null);
});

test('Challenge Inbox loads private server rows with filters counts and stale-response protection', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  const pending = [];
  window.DJBattleApi.apiRequest = async (url) => {
    if(url === '/api/challenges/count') return { status:200, data:{ counts:{ pendingReceived:1, pendingSent:0, pendingTotal:1 } } };
    if(url.startsWith('/api/challenges?')) return new Promise(resolve => pending.push({ url, resolve }));
    return { status:200, data:{} };
  };

  hooks.getChallengeState().status = 'manual';
  hooks.renderChallengeInbox();
  const first = hooks.loadDjChallengeInbox();
  const second = hooks.loadDjChallengeInbox();
  pending[pending.length - 1].resolve({ status:200, data:{ challenges:[challengeRow({ id:'fresh', challenger:{ displayName:'Fresh DJ', country:'US', belt:'Blue' } })], pagination:{ page:1, limit:10, total:1, hasMore:false } } });
  await second;
  pending[0].resolve({ status:200, data:{ challenges:[challengeRow({ id:'stale', challenger:{ displayName:'Stale DJ' } })], pagination:{ page:1, limit:10, total:1, hasMore:false } } });
  const stale = await first;

  assert.equal(stale.stale, true);
  assert.equal(hooks.getChallengeState().rows[0].id, 'fresh');
  assert.match(window.document.getElementById('profile-media').textContent, /Fresh DJ/);
  assert.doesNotMatch(window.document.getElementById('profile-media').innerHTML, /private\/|storage|user_id|crate-a|track-/i);
});

test('temporary Challenge Inbox failures keep the last safe page visibly stale', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  let fail = false;
  window.DJBattleApi.apiRequest = async (url) => {
    if(url === '/api/challenges/count') return { status:200, data:{ counts:{ pendingReceived:1, pendingSent:0, pendingTotal:1 } } };
    if(url.startsWith('/api/challenges?')){
      return fail
        ? { status:503, error:'Challenge service unavailable' }
        : { status:200, data:{ challenges:[challengeRow({ id:'safe', challenger:{ displayName:'Safe DJ' } })], pagination:{ page:1, limit:10, total:1, hasMore:false } } };
    }
    return { status:200, data:{} };
  };

  await hooks.loadDjChallengeInbox();
  fail = true;
  await hooks.loadDjChallengeInbox();

  assert.equal(hooks.getChallengeState().status, 'stale');
  assert.match(window.document.getElementById('profile-media').textContent, /Safe DJ/);
  assert.match(window.document.getElementById('profile-media').textContent, /Challenge service unavailable/);
});

test('accepting a DJ challenge posts the recipient crate and restores the server Battle Room', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  const calls = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    calls.push({ url, body:options.body });
    if(url.startsWith('/api/challenges?')) return { status:200, data:{ challenges:[challengeRow()], pagination:{ page:1, limit:10, total:1, hasMore:false } } };
    if(url === '/api/challenges/count') return { status:200, data:{ counts:{ pendingReceived:1, pendingSent:0, pendingTotal:1 } } };
    if(url === '/api/challenges/challenge-1/accept') return { status:201, data:{ challenge:challengeRow({ status:'converted-to-battle', battleId:'battle-challenge-1' }), room:roomState() } };
    if(url.startsWith('/api/battleEntries/') || url.includes('/room?')) return { status:200, data:{} };
    return { status:200, data:{} };
  };

  await hooks.loadDjChallengeInbox();
  window.document.querySelector('[data-challenge-crate]').value = 'crate:crate-server';
  window.document.querySelector('[data-challenge-accept]').click();
  await settle();

  const accept = calls.find(call => call.url === '/api/challenges/challenge-1/accept');
  assert.ok(accept);
  assert.equal(accept.body.recipientCrateId, 'crate-server');
  assert.equal(hooks.getActiveBattleSession().battleId, 'battle-challenge-1');
  assert.equal(hooks.getActiveBattleSession().battleEntryId, 'entry-recipient');
  assert.match(window.document.getElementById('br-title').textContent, /Challenge Accepted/);
  assert.doesNotMatch(window.document.body.textContent, /hidden@example.com|private\/|secret-track/i);
});

test('sign-out clears private challenge rows and counters', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  hooks.getChallengeState().rows = [challengeRow()];
  hooks.getChallengeState().counts = { pendingReceived:2, pendingSent:1, pendingTotal:3 };
  hooks.getNotificationState().rows = [notificationRow()];
  hooks.getNotificationState().counts = { unreadTotal:1, unreadChallenges:1, unreadBattles:0, archived:0 };
  hooks.clearDjChallengeState();
  hooks.clearDjNotificationState();

  assert.equal(hooks.getChallengeState().rows.length, 0);
  assert.equal(hooks.getChallengeState().counts.pendingReceived, 0);
  assert.equal(hooks.getNotificationState().rows.length, 0);
  assert.equal(hooks.getNotificationState().counts.unreadTotal, 0);
});

test('Notification Center loads server events, badges and read-state actions', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  const calls = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    calls.push({ url, body:options.body });
    if(url === '/api/notifications/count') return { status:200, data:{ counts:{ unreadTotal:1, unreadChallenges:1, unreadBattles:0, archived:0 } } };
    if(url.startsWith('/api/notifications?')) return { status:200, data:{ notifications:[notificationRow()], pagination:{ page:1, limit:10, total:1, hasMore:false } } };
    if(url === '/api/notifications/notification-1/read') return { status:200, data:{ notification:notificationRow({ unread:false, readAt:'2026-08-27T12:02:00.000Z' }) } };
    if(url === '/api/notifications/mark-all-read') return { status:200, data:{ updatedCount:1 } };
    return { status:200, data:{} };
  };

  await hooks.loadDjNotificationCount();
  await hooks.loadDjNotifications({ joinInFlight:false });
  assert.equal(window.document.getElementById('notification-count-pill').textContent, '1');
  assert.match(window.document.getElementById('notification-center').textContent, /Challenger DJ/);
  assert.doesNotMatch(window.document.getElementById('notification-center').innerHTML, /private\/|storage|snapshot|track-|dj-1|dj-2|email/i);

  await hooks.markDjNotificationReadState('notification-1', true);
  await hooks.markAllDjNotificationsRead();

  assert.ok(calls.some(call => call.url === '/api/notifications/notification-1/read'));
  assert.ok(calls.some(call => call.url === '/api/notifications/mark-all-read'));
});

test('notification polling rejects stale responses and prevents old toast replay', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  const pending = [];
  window.DJBattleApi.apiRequest = async (url) => {
    if(url === '/api/notifications/count') return { status:200, data:{ counts:{ unreadTotal:1, unreadChallenges:1, unreadBattles:0, archived:0 } } };
    if(url.startsWith('/api/notifications?')) return new Promise(resolve => pending.push(resolve));
    return { status:200, data:{} };
  };

  const first = hooks.loadDjNotifications({ joinInFlight:false });
  const second = hooks.loadDjNotifications({ joinInFlight:false });
  pending[1]({ status:200, data:{ notifications:[notificationRow({ id:'notification-fresh', eventId:'event-fresh', eventVersion:200, summary:'Fresh challenge event' })], pagination:{ page:1, limit:10, total:1, hasMore:false } } });
  await second;
  pending[0]({ status:200, data:{ notifications:[notificationRow({ id:'notification-stale', eventId:'event-stale', eventVersion:150, summary:'Stale challenge event' })], pagination:{ page:1, limit:10, total:1, hasMore:false } } });
  const stale = await first;
  assert.equal(stale.stale, true);
  assert.equal(hooks.getNotificationState().rows[0].id, 'notification-fresh');

  window.DJBattleApi.apiRequest = async (url) => {
    if(url === '/api/notifications/count') return { status:200, data:{ counts:{ unreadTotal:1, unreadChallenges:1, unreadBattles:0, archived:0 } } };
    if(url.startsWith('/api/notifications?')) return { status:200, data:{ notifications:[notificationRow({ id:'notification-old', eventId:'event-old', eventVersion:100 })], pagination:{ page:1, limit:10, total:1, hasMore:false } } };
    return { status:200, data:{} };
  };
  await hooks.loadDjNotifications({ joinInFlight:false, emitToasts:false });
  assert.equal(window.document.getElementById('notification-toast-rack'), null);

  window.DJBattleApi.apiRequest = async (url) => {
    if(url === '/api/notifications/count') return { status:200, data:{ counts:{ unreadTotal:1, unreadChallenges:1, unreadBattles:0, archived:0 } } };
    if(url.startsWith('/api/notifications?')) return { status:200, data:{ notifications:[notificationRow({ id:'notification-new', eventId:'event-new', eventVersion:300, summary:'New challenge event' })], pagination:{ page:1, limit:10, total:1, hasMore:false } } };
    return { status:200, data:{} };
  };
  await hooks.loadDjNotifications({ joinInFlight:false, emitToasts:true });
  await hooks.loadDjNotifications({ joinInFlight:false, emitToasts:true });
  assert.equal(window.document.querySelectorAll('.notification-toast').length, 1);
});

test('accepted challenge notification recovers Battle Room without resetting deck state', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  hooks.getStudioDeckState().a = { trackId:'server:srv-alpha', title:'Alpha Prep' };
  const calls = [];
  hooks.getNotificationState().rows = [notificationRow({
    id:'notification-room',
    eventId:'event-room',
    type:'challenge_converted_to_battle',
    category:'battle',
    eventVersion:250,
    destination:{ type:'battle_room', battleId:'battle-challenge-1', label:'Enter Battle Room' },
    summary:'Challenger DJ is ready in the Battle Room.'
  })];
  window.DJBattleApi.apiRequest = async (url) => {
    calls.push(url);
    if(url.startsWith('/api/battles/battle-challenge-1/room?')) return { status:200, data:{ room:roomState() } };
    if(url.startsWith('/api/battleEntries/')) return { status:200, data:{} };
    return { status:200, data:{} };
  };

  await hooks.openDjNotificationDestination('notification-room');

  assert.ok(calls.some(url => url.startsWith('/api/battles/battle-challenge-1/room?')));
  assert.equal(hooks.getActiveBattleSession().battleId, 'battle-challenge-1');
  assert.equal(hooks.getStudioDeckState().a.trackId, 'server:srv-alpha');
  assert.match(window.document.getElementById('br-challenge-notice').textContent, /Battle Room/);
  assert.doesNotMatch(window.document.getElementById('br-challenge-notice').textContent, /hidden@example.com|private\/|secret-track|snapshot/i);
});

test('public profile challenge action obeys protected eligibility and hides block details', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  window.DJBattleApi.apiRequest = async (url) => {
    if(url === '/api/challenges/eligibility/dj_recipient') return { status:200, data:{ eligibility:{ available:false, reason:'Challenge unavailable' } } };
    return { status:200, data:{} };
  };

  hooks.renderPublicDjProfile(publicProfile());
  await settle();

  const button = window.document.getElementById('challenge-public-dj');
  assert.ok(button);
  assert.equal(button.disabled, true);
  assert.match(button.textContent, /unavailable/i);
  assert.doesNotMatch(window.document.getElementById('modal-content').textContent, /blocked|muted|block list/i);
});

test('notification mute and block actions use protected endpoints without exposing private lists', async () => {
  const window = loadAppDom();
  const hooks = configureServerLibrary(window);
  const calls = [];
  hooks.getNotificationState().rows = [notificationRow()];
  hooks.renderNotificationCenter();
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    calls.push({ url, body:options.body });
    if(url === '/api/notificationMutes') return { status:201, data:{ mute:{ id:'mute-1', category:'challenge', active:true } } };
    if(url === '/api/blocks') return { status:201, data:{ block:{ id:'block-1', status:'active', blockedProfile:{ publicProfileId:'dj_challenger', displayName:'Challenger DJ' } }, cancelledChallengeCount:1 } };
    if(url.startsWith('/api/notifications?')) return { status:200, data:{ notifications:[notificationRow({ muted:true })], pagination:{ page:1, limit:10, total:1, hasMore:false } } };
    if(url.startsWith('/api/challenges?')) return { status:200, data:{ challenges:[], pagination:{ page:1, limit:10, total:0, hasMore:false } } };
    if(url === '/api/notifications/count') return { status:200, data:{ counts:{ unreadTotal:0, unreadChallenges:0, unreadBattles:0, archived:0 } } };
    if(url === '/api/challenges/count') return { status:200, data:{ counts:{ pendingReceived:0, pendingSent:0, pendingTotal:0 } } };
    return { status:200, data:{} };
  };

  await hooks.muteDjNotificationSource('notification-1');
  await hooks.blockDjNotificationSource('notification-1');

  assert.ok(calls.some(call => call.url === '/api/notificationMutes' && call.body.mutedPublicProfileId === 'dj_challenger'));
  assert.ok(calls.some(call => call.url === '/api/blocks' && call.body.blockedPublicProfileId === 'dj_challenger'));
  assert.doesNotMatch(window.document.getElementById('notification-center').textContent, /blocker_user_id|blocked_user_id|private\/|storage|email/i);
});
