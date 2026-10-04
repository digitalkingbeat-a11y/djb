// Safe parser for potentially corrupted localStorage entries
function safeParse(key, fallback){
  try{ const v = localStorage.getItem(key); if(!v) return fallback; return JSON.parse(v); }catch(e){ console.warn('safeParse failed for', key, e); return fallback; }
}

function plainObject(value){
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

const state = {
  premium: false,
  library: safeParse('djBattleLibrary', []),
  posts: safeParse('djBattlePosts', null) || [
    {user:'Maya Mixx', initials:'MM', room:'Track Feedback', time:'8m', title:'New bass house flip — feedback?', body:'Tried a tighter second drop and a vocal chop before the switch.', media:'Night Shift — Bass House Flip', likes:18, comments:7},
    {user:'Turntablist T', initials:'TT', room:'Scratching', time:'22m', title:'Ahh/Fresh 60-second practice', body:'Working on cleaner rhythm and faster chirps. What should I tighten up?', media:'Scratch Practice #14', likes:31, comments:12},
    {user:'Juno', initials:'JU', room:'Promo Feed', time:'1h', title:'Friday rooftop set', body:'Uploading the full mix after the event. Tech House → UKG.', media:null, likes:12, comments:4}
  ],
  practiceHistory: JSON.parse(localStorage.getItem('djBattlePracticeHistory') || '[]'),
  battleResults: safeParse('djBattleBattleResults', []),
  battleProgress: safeParse('djBattleBattleProgress', null) || { xp: 620, rating: 87, rankingRating: 1744, wins: 12, losses: 4, belt: 'White' },
  operatorUser: false,
  battleHistoryFilters: { mode:'all', genre:'all', result:'all', opponent:'all', date:'all' },
  verifiedResultsDiscovery: {
    filters: { country:'all', mode:'all', genre:'all', source:'all', belt:'all', opponent:'all', date:'all' },
    sort:'newest',
    page:1,
    pageSize:10,
    results:[],
    pagination:{ page:1, limit:10, total:0, hasMore:false, nextPage:null },
    rankings:null,
    rankingSource:'local',
    source:'local',
    sortUnsupported:false
  },
  publicRankings: {
    category:'competitive_battles',
    filters:{ country:'all', belt:'all', relationship:'all' },
    page:1,
    pageSize:20,
    rows:[],
    categories:{},
    pagination:{ page:1, limit:20, total:0, hasMore:false, nextPage:null },
    status:'idle',
    stale:false,
    error:'',
    lastSuccessfulAt:null,
    requestSeq:0,
    selectedDj:'',
    deepLinkMessage:'',
    detail:{
      status:'idle',
      scope:'',
      targetId:'',
      category:'competitive_battles',
      data:null,
      error:'',
      stale:false,
      requestSeq:0,
      cursor:null
    },
    personal:{ status:'idle', rankings:null, error:'' }
  },
  profileRanking:{
    public:{
      status:'idle',
      profile:null,
      profileId:'',
      category:'competitive_battles',
      data:null,
      error:'',
      stale:false,
      requestSeq:0,
      selectedResultId:'',
      returnTo:''
    },
    private:{
      status:'idle',
      category:localStorage.getItem('djBattlePrivateProgressionCategory') || 'competitive_battles',
      data:null,
      error:'',
      stale:false,
      requestSeq:0,
      selectedResultId:'',
      returnTo:'profile'
    }
  }
};
state.battleProgress = { xp: 620, rating: 87, rankingRating: 1744, wins: 12, losses: 4, belt: 'White', ...state.battleProgress };
state.publicRankings.filters = { country:'all', belt:'all', relationship:'all', ...(state.publicRankings.filters || {}) };
state.librarySort = safeParse('djBattleLibrarySort', null) || { field:'title', direction:'asc' };
state.libraryFilters = { crate:'all', search:'', compatibleOnly:false };
state.battleFormatFilter = 'all';
state.battleViewTab = localStorage.getItem('djBattleBattleViewTab') || 'open';
state.battleLayout = localStorage.getItem('djBattleBattleLayout') || 'list';
state.battleSort = localStorage.getItem('djBattleBattleSort') || 'ending_soon';
state.studioLibrarySource = localStorage.getItem('djBattleStudioLibrarySource') || 'MY_LIBRARY';
state.selectedLibraryTrackId = localStorage.getItem('djBattleSelectedLibraryTrackId') || '';
state.crateEditor = safeParse('djBattleCrateEditorState', null) || {
  editing:false,
  selectedTrackIds:[],
  anchorTrackId:'',
  undoStack:[],
  dragTrackId:'',
  dragOverTrackId:'',
  validation:null
};
state.libraryPlayer = safeParse('djBattleLibraryPlayer', null) || { trackId:'', playing:false, progress:0 };
state.studioDecks = safeParse('djBattleStudioDecks', null) || { a:null, b:null };
state.studioLibraryDrawer = { open:false, deck:'a' };
state.studioRecording = safeParse('djBattleStudioRecording', null) || {
  state:'idle',
  armed:false,
  startedAt:null,
  elapsedMs:0,
  fileName:'',
  duration:'',
  error:'',
  submitted:false,
  draftSaved:false
};
state.controller = safeParse('djBattleControllerState', null) || {
  status:'disconnected',
  name:'No controller detected',
  mappingStatus:'Not mapped',
  midiActivity:'Idle',
  supported:false,
  message:'Web MIDI is available only in supported browsers after user permission.',
  mappings:{
    playPause:'unassigned',
    cue:'unassigned',
    jogWheel:'unassigned',
    pitch:'unassigned',
    crossfader:'unassigned',
    eq:'unassigned',
    hotCues:'unassigned',
    loops:'unassigned',
    effects:'unassigned'
  }
};
state.audioSetup = {
  status:'unavailable',
  inputDeviceId:'',
  recordingSource:'master',
  devices:[],
  message:'Audio input selection requires browser media-device permission.'
};
state.musicLibrarySync = safeParse('djBattleMusicLibrarySyncState', null) || {
  status:'offline',
  accountId:'',
  page:1,
  pageSize:50,
  hasMore:false,
  lastSyncedAt:null,
  error:'',
  schema:null,
  pendingQueue:[]
};
state.battleLobby = safeParse('djBattleLobbyState', null) || {
  status:'offline',
  rows:[],
  filters:{ mode:'all', genre:'all', duration:'all', entry:'all', search:'', country:'all', belt:'all', scoringType:'all', opponent:'all', relationship:'all', ownSelection:false, bitcoin:false },
  page:1,
  pageSize:20,
  pagination:{ page:1, limit:20, total:0, hasMore:false, nextPage:null },
  selectedCrateId:'',
  lastSyncedAt:null,
  error:'',
  recoveryStatus:'idle'
};
state.battleLobby.filters = { mode:'all', genre:'all', duration:'all', entry:'all', search:'', country:'all', belt:'all', scoringType:'all', opponent:'all', relationship:'all', ownSelection:false, bitcoin:false, ...(state.battleLobby.filters || {}) };
state.battleRoomSync = safeParse('djBattleRoomSyncState', null) || {
  status:'offline',
  battleId:'',
  battleVersion:0,
  eventId:'',
  lastSyncedAt:null,
  lastFailure:'',
  polling:false,
  hidden:false
};
state.djChallenges = {
  status:'idle',
  rows:[],
  filters:{ direction:'received', status:'pending' },
  page:1,
  pageSize:10,
  pagination:{ page:1, limit:10, total:0, hasMore:false, nextPage:null },
  counts:{ pendingReceived:0, pendingSent:0, pendingTotal:0 },
  requestSeq:0,
  stale:false,
  error:'',
  lastSuccessfulAt:null,
  pollTimer:null,
  setup:{ profile:null, idempotencyKey:'' }
};
state.djNotifications = {
  status:'idle',
  rows:[],
  filters:{ filter:'all' },
  page:1,
  pageSize:10,
  pagination:{ page:1, limit:10, total:0, hasMore:false, nextPage:null },
  counts:{ unreadTotal:0, unreadChallenges:0, unreadBattles:0, archived:0 },
  requestSeq:0,
  stale:false,
  error:'',
  lastSuccessfulAt:null,
  pollTimer:null,
  inFlight:null,
  toastWatermark:0,
  seenToastEventIds:new Set()
};
state.djRelationships = {
  status:'idle',
  syncStatus:'idle',
  syncVersion:0,
  syncRequestSeq:0,
  pollTimer:null,
  nextPollAt:null,
  rows:[],
  filters:{ direction:'following' },
  page:1,
  pageSize:10,
  pagination:{ page:1, limit:10, total:0, hasMore:false, nextPage:null },
  counts:{ following:0, followers:0 },
  error:'',
  lastSuccessfulAt:null,
  requestSeq:0,
  publicSummaries:{},
  feed:{
    status:'idle',
    rows:[],
    page:1,
    pageSize:10,
    pagination:{ page:1, limit:10, total:0, hasMore:false, nextPage:null },
    error:'',
    lastSuccessfulAt:null,
    requestSeq:0
  },
  opponents:{
    status:'idle',
    rows:[],
    page:1,
    pageSize:10,
    pagination:{ page:1, limit:10, total:0, hasMore:false, nextPage:null },
    error:'',
    lastSuccessfulAt:null,
    requestSeq:0
  },
  preferences:{
    status:'idle',
    data:null,
    error:'',
    configurationRequired:false
  },
  rematch:{ source:null, idempotencyKey:'' }
};
state.community = {
  status:'idle',
  source:'local',
  stale:false,
  error:'',
  requestSeq:0,
  feed:'recent',
  category:'all',
  page:1,
  pageSize:20,
  posts:[],
  categories:[],
  pagination:{ page:1, limit:20, total:0, hasMore:false, nextPage:null, nextCursor:null },
  lastSuccessfulAt:null,
  comments:{},
  commentStatus:{},
  commentPagination:{}
};

// Platform Battle Library (separate source)
state.platformLibrary = safeParse('djBattlePlatformLibrary', null) || [
  { id: 'plat-1', title: 'Platform Beat 001', artist: 'Label Pool', bpm: 128, key: 'A minor', duration: '3:12', rightsCategory: 'Platform Cleared', battleEligible: true, source: 'PLATFORM' },
  { id: 'plat-2', title: 'Platform Loop 02', artist: 'Label Pool', bpm: 124, key: 'C minor', duration: '2:45', rightsCategory: 'Platform Cleared', battleEligible: true, source: 'PLATFORM' }
];

// Streaming providers surface capability boundaries; direct deck audio is never assumed.
state.streamingProviders = [
  { id:'spotify', name:'Spotify', status:'Metadata Only', icon:'SP', access:'Metadata / Playlist Access Only', audio:'Not available for DJ deck playback in-browser' },
  { id:'apple', name:'Apple Music', status:'Metadata Only', icon:'AM', access:'Metadata / Playlist Access Only', audio:'Playback depends on MusicKit and user subscription; deck routing is unavailable here' },
  { id:'soundcloud', name:'SoundCloud', status:'Connect', icon:'SC', access:'OAuth / Metadata where configured', audio:'Audio only when provider rights and SDK permit' },
  { id:'tidal', name:'TIDAL', status:'Connect', icon:'TI', access:'Provider SDK required', audio:'Audio only when SDK, account and licensing allow' },
  { id:'beatport', name:'Beatport', status:'Metadata Only', icon:'BP', access:'Catalog / playlist metadata where configured', audio:'Streaming audio is not exposed as local battle audio' },
  { id:'youtube', name:'YouTube Music', status:'Unsupported', icon:'YT', access:'Link-out / metadata only', audio:'No direct deck playback support in this browser flow' }
];

// Playlists and crates reference stable library IDs; server-backed crates cache per account after auth.
state.playlists = safeParse('djBattlePlaylists', []);
state.selectedLibraryCrateId = localStorage.getItem('djBattleSelectedLibraryCrateId') || '';

// Per-deck persistent state (cues, hotcues)
state.decks = safeParse('djBattleDecks', null) || { a: { cues: [], hotcues: [] }, b: { cues: [], hotcues: [] } };


// Default rights and permissions shape for new tracks
function defaultPermissions(){ return { privatePlayback:true, battlePlayback:false, publicBattle:false, recordedBattle:false, replay:false, livestream:false, download:false, promotional:false }; }

const GENRES = ['Hip-Hop','House','Tech House','Bass House','Drum & Bass','Jungle','UK Garage','Bassline','Dubstep','Riddim','Open Format','Scratch','EDM'];
const BattleModes = window.DJBattleModes;
if(!BattleModes) throw new Error('DJBattleModes registry must be loaded before app.js');
const StudioModules = {
  recording: window.DJBattleStudioRecording,
  controller: window.DJBattleControllerMapping,
  audio: window.DJBattleAudioSetup,
  streaming: window.DJBattleStudioStreaming,
  playlistTransfer: window.DJBattlePlaylistTransfer,
  browser: window.DJBattleStudioBrowser,
  deckRuntime: window.DJBattleDeckRuntime
};
Object.entries(StudioModules).forEach(([name, module]) => {
  if(!module || typeof module.create !== 'function') throw new Error(`DJ Battle Studio ${name} module must be loaded before app.js`);
});

const BATTLE_MODE_LABELS = {
  transition_battle:'Transition Battle',
  scratching_battle:'Scratch Battle',
  five_song_mix_battle:'5-Song Mix',
  own_selection_battle:'10-Minute Mix',
  half_hour_mix_battle:'30-Minute Mix',
  full_mix_battle:'60-Minute Mix',
  genre_specific_battle:'Genre Battle',
  bitcoin_battle:'Bitcoin Battle',
  open_beat_battle:'Open Beat Battle',
  sample_flip_battle:'Sample Flip Battle',
  genre_challenge_beat_battle:'Genre Challenge Beat Battle',
  bpm_challenge_beat_battle:'BPM Challenge Beat Battle',
  timed_beat_challenge_battle:'Timed Beat Challenge',
  drum_challenge_battle:'Drum Challenge Beat Battle',
  remix_challenge_battle:'Remix Challenge Beat Battle'
};
const BATTLE_MODE_TONES = {
  transition_battle:'cyan',
  scratching_battle:'pink',
  five_song_mix_battle:'amber',
  own_selection_battle:'blue',
  half_hour_mix_battle:'purple',
  full_mix_battle:'green',
  genre_specific_battle:'lime',
  bitcoin_battle:'gold',
  open_beat_battle:'lime',
  sample_flip_battle:'amber',
  genre_challenge_beat_battle:'green',
  bpm_challenge_beat_battle:'cyan',
  timed_beat_challenge_battle:'blue',
  drum_challenge_battle:'pink',
  remix_challenge_battle:'purple'
};
const BATTLE_MODE_ICONS = {
  transition_battle:'TR',
  scratching_battle:'SC',
  five_song_mix_battle:'5',
  own_selection_battle:'10',
  half_hour_mix_battle:'30',
  full_mix_battle:'60',
  genre_specific_battle:'GN',
  bitcoin_battle:'BTC',
  open_beat_battle:'OB',
  sample_flip_battle:'SF',
  genre_challenge_beat_battle:'GC',
  bpm_challenge_beat_battle:'BP',
  timed_beat_challenge_battle:'TM',
  drum_challenge_battle:'DR',
  remix_challenge_battle:'RX'
};

function battleModeDisplayLabel(modeId, fallback = ''){
  return BATTLE_MODE_LABELS[modeId] || fallback || readableComponentName(modeId || 'battle');
}

function battleModeTone(modeId){
  return BATTLE_MODE_TONES[modeId] || 'lime';
}

function battleModeIcon(modeId){
  return BATTLE_MODE_ICONS[modeId] || 'DJ';
}

function battleModeFixedGenre(modeId){
  return modeId === 'transition_battle' ? 'Bass House' : '';
}

function battleModeAllowsGenreSelection(modeId){
  return !battleModeFixedGenre(modeId);
}

// Stable id for profile data saved in this browser before sign-in. Kept unchanged so existing local
// battles, entries, and posts keep their owner; it is never shown in the UI.
const LOCAL_PROFILE_USER_ID = 'local-profile-digital-king';
// Name the local profile used before currentUser() existed; only used to migrate old local posts.
const LEGACY_LOCAL_PROFILE_NAME = 'Digital King';
const currentAuthState = { user:null };

function initialsForName(name){
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if(!parts.length) return 'DJ';
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts[parts.length - 1][0]}`;
  return letters.toUpperCase();
}

// Single source of truth for who is using the app: the Supabase session user when signed in,
// otherwise a Guest / Local DJ profile stored in this browser.
function currentUser(){
  const sessionUser = currentAuthState.user;
  let base;
  if(sessionUser){
    const meta = sessionUser.user_metadata || {};
    const displayName = String(meta.full_name || meta.name || sessionUser.email || 'DJ').trim() || 'DJ';
    base = { id:String(sessionUser.id || LOCAL_PROFILE_USER_ID), displayName, initials:initialsForName(displayName), email:sessionUser.email || '', signedIn:true, isGuest:false, label:'Signed in' };
  } else {
    base = { id:LOCAL_PROFILE_USER_ID, displayName:'Guest', initials:'G', email:'', signedIn:false, isGuest:true, label:'Local DJ' };
  }
  // Edit Profile saves a browser-local display name/initials per user id (there is no profile update API yet).
  const local = readLocalProfile(base.id);
  if(local.displayName) base = { ...base, displayName:local.displayName, initials:local.initials || initialsForName(local.displayName), customized:true };
  else if(local.initials) base = { ...base, initials:local.initials, customized:true };
  return base;
}

const LOCAL_PROFILE_STORAGE_PREFIX = 'djBattleLocalProfile:';
const LOCAL_PROFILE_NAME_MAX = 40;
const LOCAL_PROFILE_INITIALS_MAX = 3;

function readLocalProfile(userId){
  const saved = plainObject(safeParse(`${LOCAL_PROFILE_STORAGE_PREFIX}${userId}`, {}));
  const cleaned = normalizeLocalProfileInput(saved);
  return cleaned.error ? {} : cleaned.value;
}

function normalizeLocalProfileInput(input = {}){
  const displayName = String(input.displayName || '').replace(/\s+/g, ' ').trim();
  const initials = String(input.initials || '').replace(/[^\p{L}\p{N}]/gu, '').toUpperCase();
  if(displayName.length > LOCAL_PROFILE_NAME_MAX) return { error:`Display name must be ${LOCAL_PROFILE_NAME_MAX} characters or fewer.` };
  if(initials.length > LOCAL_PROFILE_INITIALS_MAX) return { error:`Initials must be ${LOCAL_PROFILE_INITIALS_MAX} letters or numbers or fewer.` };
  return { value:{ displayName, initials } };
}

function saveLocalProfile(input){
  const normalized = normalizeLocalProfileInput(input);
  if(normalized.error) return normalized;
  if(!normalized.value.displayName) return { error:'Enter a display name.' };
  const before = currentUser();
  const value = { displayName:normalized.value.displayName, initials:normalized.value.initials || initialsForName(normalized.value.displayName) };
  localStorage.setItem(`${LOCAL_PROFILE_STORAGE_PREFIX}${before.id}`, JSON.stringify(value));
  const after = currentUser();
  // Keep this browser's own local posts in step with the new name.
  let changedPosts = false;
  (state.posts || []).forEach(post => {
    if(isOwnLocalPost(post)){ post.user = after.displayName; post.initials = after.initials; changedPosts = true; }
  });
  if(changedPosts) localStorage.setItem('djBattlePosts', JSON.stringify(state.posts));
  return { value:after };
}

function openEditProfileModal(){
  const user = currentUser();
  const scopeNote = user.signedIn
    ? 'Saved in this browser only. Your account profile on the server is not changed.'
    : 'Saved in this browser only. Sign in later to sync battles and results.';
  openModal(`<span class="eyebrow accent">PROFILE</span><h3>Edit Profile</h3><p style="color:var(--muted)" id="edit-profile-scope">${esc(scopeNote)}</p><div class="form-grid"><label>Display name<input id="edit-profile-name" maxlength="${LOCAL_PROFILE_NAME_MAX}" autocomplete="nickname" value="${esc(user.displayName)}"></label><label>Initials (avatar)<input id="edit-profile-initials" maxlength="${LOCAL_PROFILE_INITIALS_MAX}" value="${esc(user.initials)}"></label></div><p id="edit-profile-error" class="hidden" role="alert" style="color:var(--danger)"></p><div class="modal-actions"><button class="ghost" value="cancel">Cancel</button><button class="primary" type="button" id="save-profile">Save Profile</button></div>`);
  const nameInput = document.getElementById('edit-profile-name');
  const initialsInput = document.getElementById('edit-profile-initials');
  let initialsTouched = false;
  if(initialsInput) initialsInput.addEventListener('input', () => { initialsTouched = true; initialsInput.value = initialsInput.value.toUpperCase(); });
  if(nameInput && initialsInput) nameInput.addEventListener('input', () => { if(!initialsTouched) initialsInput.value = initialsForName(nameInput.value); });
  const save = document.getElementById('save-profile');
  if(save) save.onclick = () => {
    const result = saveLocalProfile({ displayName:nameInput ? nameInput.value : '', initials:initialsInput ? initialsInput.value : '' });
    const errorNode = document.getElementById('edit-profile-error');
    if(result.error){
      if(errorNode){ errorNode.textContent = result.error; errorNode.classList.remove('hidden'); }
      return result;
    }
    document.getElementById('modal').close();
    renderCurrentUserUI();
    renderPosts();
    renderProfile();
    return result;
  };
}

function currentProfileUserId(){ return currentUser().id; }

// Posts saved before currentUser() existed were authored by the local profile under its old fixed name.
(state.posts || []).forEach(post => { if(post && !post.userId && post.user === LEGACY_LOCAL_PROFILE_NAME) post.userId = LOCAL_PROFILE_USER_ID; });

function isCurrentUserName(name){ return String(name || '') === currentUser().displayName; }

// Local posts created in this browser are owned by the local profile (or the signed-in user who wrote them).
function isOwnLocalPost(post){
  if(!post) return false;
  if(post.userId) return post.userId === currentUser().id || post.userId === LOCAL_PROFILE_USER_ID;
  return false;
}

function renderCurrentUserUI(){
  const user = currentUser();
  const setText = (selector, value) => document.querySelectorAll(selector).forEach(node => { node.textContent = value; });
  setText('#profile-name', user.displayName);
  setText('.profile-chip .avatar', user.initials);
  setText('#profile-hero-name', user.displayName);
  setText('#profile-hero-avatar', user.initials);
  setText('#profile-hero-tagline', user.signedIn ? `Signed in${user.email ? ` as ${user.email}` : ''}` : `${user.customized ? 'Local DJ' : 'Guest • Local DJ'} profile saved in this browser`);
  setText('#br-dj1-name', user.displayName);
  setText('#br-dj1 .avatar', user.initials);
  setText('#mini-dj1', user.displayName);
  const chip = document.querySelector('.profile-chip');
  if(chip) chip.dataset.userState = user.signedIn ? 'signed-in' : 'guest';
  return user;
}
function publicVisitorId(){
  const key = 'djBattlePublicVisitor';
  let value = localStorage.getItem(key);
  if(!value){
    const random = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `visitor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    value = `pv_${random}`;
    localStorage.setItem(key, value);
  }
  return value;
}
function createLocalBattleRecord(input){
  const result = BattleModes.createBattleRecord({ status:'open', visibility:'public', createdBy:'platform', ...input }, { requireAssignedTracks:false });
  if(result.error) throw new Error(result.error.map(item=>item.message).join(' '));
  return result.battle;
}

const defaultBattles = [
  createLocalBattleRecord({id:1,modeId:'transition_battle',genre:'Bass House',title:'Bass House Transition',assignedTracks:['Platform Beat 001','Platform Loop 02'],people:18,desc:'Same two tracks. Build the cleanest, most creative transition.'}),
  createLocalBattleRecord({id:2,modeId:'scratching_battle',genre:'Hip-Hop',title:'Ahh / Fresh Scratch',durationMinutes:2,assignedTracks:['Platform Beat 001','Platform Loop 02'],people:11,desc:'Everyone gets the same beat and scratch phrase. Technique wins.'}),
  createLocalBattleRecord({id:3,modeId:'scratching_battle',genre:'Scratch',title:'Song-to-Song Scratch',durationMinutes:5,assignedTracks:['Platform Beat 001','Platform Loop 02'],stems:true,people:8,desc:'Play one assigned track and scratch the second over it.'}),
  createLocalBattleRecord({id:4,modeId:'five_song_mix_battle',genre:'Hip-Hop',title:'2000s Hip-Hop Five',assignedTracks:['Platform Beat 001','Platform Loop 02','Approved Track Slot 3','Approved Track Slot 4','Approved Track Slot 5'],people:24,desc:'Five identical tracks for everyone. Sequence them however you want.'}),
  createLocalBattleRecord({id:5,modeId:'half_hour_mix_battle',genre:'Open Format',title:'30-Minute Mix',stems:true,people:14,desc:'Premium own-selection battle with stems allowed. Pick the genre when you enter.'}),
  createLocalBattleRecord({id:6,modeId:'full_mix_battle',genre:'EDM',title:'Open Format 60',people:9,desc:'One-hour programming, transitions, energy and creativity challenge.'}),
  createLocalBattleRecord({id:7,modeId:'five_song_mix_battle',genre:'Hip-Hop',title:'Modern Hip-Hop Five',assignedTracks:['Platform Beat 001','Platform Loop 02','Approved Track Slot 3','Approved Track Slot 4','Approved Track Slot 5'],people:19,desc:'Current club rap, bounce, and clean-energy blends across five assigned tracks.'}),
  createLocalBattleRecord({id:8,modeId:'genre_specific_battle',genre:'Hip-Hop',title:'Golden Era Transition',people:16,desc:'Two approved Hip-Hop selections. Keep the blend musical, on phrase, and era-aware.'}),
  createLocalBattleRecord({id:9,modeId:'own_selection_battle',genre:'Hip-Hop',title:'10-Minute Hip-Hop Set',durationMinutes:10,people:13,desc:'Bring battle-ready tracks from your crate and prove programming, cuts, and energy control in ten minutes.'})
];
function normalizeBattleCatalogRecord(record){
  const normalized = BattleModes.normalizeBattleRecord(record);
  if(normalized.modeId === 'half_hour_mix_battle' && /30-Minute Tech House/i.test(normalized.title || '')){
    normalized.title = '30-Minute Mix';
    if(normalized.genre === 'Tech House') normalized.genre = 'Open Format';
    normalized.desc = normalized.desc || 'Premium own-selection battle with stems allowed. Pick the genre when you enter.';
  }
  normalized.type = battleModeDisplayLabel(normalized.modeId, normalized.type);
  return normalized;
}
let battles = (safeParse('djBattleBattles', null) || defaultBattles).map(normalizeBattleCatalogRecord);
function persistBattles(){localStorage.setItem('djBattleBattles', JSON.stringify(battles));}
function persistActiveBattleSession(session){ if(session) localStorage.setItem('djBattleActiveSession', JSON.stringify(session)); }
function clearActiveBattleSession(){ localStorage.removeItem('djBattleActiveSession'); }

const defaultAiHighScores = [
  {dj:'DJ Nova', best:96, average:94, attempts:18, last:96, type:'Transition Battle', genre:'Hip-Hop'},
  {dj:'Digital King', best:93, average:89, attempts:21, last:93, type:'Transition Battle', genre:'Bass House'},
  {dj:'MixMaster', best:91, average:88, attempts:14, last:91, type:'5-Song Mix', genre:'Hip-Hop'},
  {dj:'ScratchLab', best:89, average:86, attempts:22, last:89, type:'Ahh/Fresh Scratch Battle', genre:'Scratch'}
];

const rankings = [
  ['1','Nova Cut','Open Format','32-7','92','94','1942'],['2','Maya Mixx','Bass House','27-5','91','92','1898'],['3','Turntablist T','Scratch','41-11','90','95','1875'],['4','Juno','Tech House','22-8','89','90','1810'],['5','Digital King','Bass House','12-4','87','89','1744'],['6','DJ Slate','Hip-Hop','18-9','86','91','1692']
];

const BELT_THRESHOLDS = [
  { name:'White', xp:0 },
  { name:'Yellow', xp:100 },
  { name:'Orange', xp:250 },
  { name:'Green', xp:500 },
  { name:'Blue', xp:850 },
  { name:'Purple', xp:1300 },
  { name:'Brown', xp:1800 },
  { name:'Black', xp:2500 }
];

// Live leaderboard configuration — when the Supabase client is present in the page
// Supabase is created by a module script that runs after this file, so LIVE_MODE is refreshed from initAuth().
function computeLiveMode(){ return Boolean(window && window.supabase && window.SUPABASE_URL && window.SUPABASE_ANON_KEY); }
let LIVE_MODE = computeLiveMode();

// Submit a score through the authenticated server endpoint.
async function submitScoreLive(payload){
  if(!window.DJBattleApi) return { error: 'Sign in is required to continue.' };
  const response = await window.DJBattleApi.apiRequest('/api/submitScore', {
    method: 'POST',
    body: {
      djName: payload.djName,
      battleType: payload.battleType || 'Practice',
      genre: payload.genre || 'Global',
      score: Number(payload.score || 0)
    }
  });
  return response.error ? { error: response.error, status: response.status } : (response.data || {});
}

// Fetch a leaderboard from Supabase and aggregate by user (battleType/genre filter)
async function fetchLeaderboardLive(opts={}){
  if(!LIVE_MODE) return { error: 'live mode disabled', rows: [] };
  try{
    const filter = opts.filter || 'Global';
    let query = supabase.from('ai_scores').select('*');
    if(filter && filter !== 'Global'){
      // Use ilike to match battle_type or genre containing the filter string
      const pattern = `%${filter}%`;
      query = query.or(`battle_type.ilike.${pattern},genre.ilike.${pattern}`);
    }
    const { data, error } = await query;
    if(error) return { error: error.message || String(error), rows: [] };
    const rows = data || [];
    const map = new Map();
    rows.forEach(r=>{
      const key=r.user_id;
      const cur = map.get(key) || { userId: r.user_id, dj: r.dj, best: 0, sum:0, attempts:0, last:0 };
      cur.attempts += 1; cur.sum += Number(r.score||0); cur.last = Number(r.score||0); cur.best = Math.max(cur.best, Number(r.score||0)); map.set(key, cur);
    });
    const agg = Array.from(map.values()).map(v=>({ userId:v.userId, dj:v.dj, best:v.best, average: Math.round((v.sum/v.attempts)*10)/10, attempts:v.attempts, last:v.last }));
    agg.sort((a,b)=>b.best-a.best || b.average-a.average);
    const out = agg.map((r,i)=>({ rank:i+1, ...r }));
    return { success:true, rows: out };
  }catch(err){
    console.error('fetchLeaderboardLive error', err);
    return { error: String(err), rows: [] };
  }
}

const pageTitles={dashboard:'Battle Home',battles:'Battles',studio:'Battle Studio',library:'Music Library',community:'Community','verified-results':'Verified Results',rankings:'Rankings',notifications:'Activity',activity:'Activity',tour:'Virtual Tour',settings:'Settings',operations:'Judging Operations',profile:'Profile'};

function sanitizedTrackForStorage(track){
  if(!track || typeof track !== 'object') return track;
  const clone = { ...track };
  [
    'securePlaybackUrl',
    'playbackUrl',
    'previewUrl',
    'signedUrl',
    'uploadToken',
    'uploadPath',
    'serviceKey',
    'audioStorageObjectPath',
    'storageObjectPath',
    'artworkStorageObjectPath'
  ].forEach(key => { delete clone[key]; });
  if(clone.playbackAccess) delete clone.playbackAccess;
  if(clone.audio && typeof clone.audio === 'string' && /^data:audio\//i.test(clone.audio)) delete clone.audio;
  Object.keys(clone).forEach(key => {
    if(/path|token|service/i.test(key) && typeof clone[key] === 'string' && /(private\/|service[_-]?key|token=)/i.test(clone[key])) delete clone[key];
  });
  return clone;
}
function sanitizedLibraryForStorage(tracks){
  return (tracks || []).map(sanitizedTrackForStorage).filter(Boolean);
}
function sanitizedCrateForStorage(crate){
  if(!crate || typeof crate !== 'object') return crate;
  const clone = { ...crate };
  ['securePlaybackUrl','playbackUrl','previewUrl','signedUrl','uploadToken','uploadPath','serviceKey','storageObjectPath','artworkStorageObjectPath'].forEach(key => { delete clone[key]; });
  Object.keys(clone).forEach(key => {
    if(/path|token|service/i.test(key) && typeof clone[key] === 'string' && /(private\/|service[_-]?key|token=)/i.test(clone[key])) delete clone[key];
  });
  clone.trackIds = Array.isArray(clone.trackIds) ? clone.trackIds.map(id => String(id)).slice(0, 500) : [];
  clone.items = Array.isArray(clone.items) ? clone.items.map(item => ({ id:String(item.id || item.trackId || ''), title:String(item.title || '').slice(0, 160) })).filter(item => item.id) : [];
  return clone;
}
function sanitizedCratesForStorage(crates){
  return (crates || []).map(sanitizedCrateForStorage).filter(Boolean);
}
function persistMusicLibrarySyncState(){
  const sync = { ...state.musicLibrarySync, pendingQueue: state.musicLibrarySync.pendingQueue || [] };
  localStorage.setItem('djBattleMusicLibrarySyncState', JSON.stringify(sync));
}
function libraryCacheKey(accountId){ return `djBattleLibraryCache:${accountId}`; }
function crateCacheKey(accountId){ return `djBattleLibraryCratesCache:${accountId}`; }
function persistLibraryCacheForAccount(accountId){
  if(!accountId) return;
  localStorage.setItem(libraryCacheKey(accountId), JSON.stringify(sanitizedLibraryForStorage(state.library.filter(track => track.serverBacked && String(track.userId || '') === String(accountId)))));
}
function persistCrateCacheForAccount(accountId){
  if(!accountId) return;
  localStorage.setItem(crateCacheKey(accountId), JSON.stringify(sanitizedCratesForStorage(state.playlists.filter(crate => crate.serverBacked && String(crate.userId || '') === String(accountId)))));
}
function persistCrateEditorState(){
  const editor = {
    editing:Boolean(state.crateEditor.editing),
    selectedTrackIds:(state.crateEditor.selectedTrackIds || []).slice(0, 200),
    anchorTrackId:state.crateEditor.anchorTrackId || '',
    undoStack:(state.crateEditor.undoStack || []).slice(-1),
    dragTrackId:'',
    dragOverTrackId:'',
    validation:state.crateEditor.validation ? {
      crateId:state.crateEditor.validation.crateId,
      ready:Boolean(state.crateEditor.validation.ready),
      summary:state.crateEditor.validation.summary || ''
    } : null
  };
  localStorage.setItem('djBattleCrateEditorState', JSON.stringify(editor));
}
function persist(){localStorage.setItem('djBattleLibrary',JSON.stringify(sanitizedLibraryForStorage(state.library.filter(track => !track.serverBacked))));localStorage.setItem('djBattlePlaylists',JSON.stringify(sanitizedCratesForStorage(state.playlists.filter(crate => !crate.serverBacked))));localStorage.setItem('djBattlePosts',JSON.stringify(state.posts));persistCrateEditorState();if(state.musicLibrarySync && state.musicLibrarySync.accountId){ persistLibraryCacheForAccount(state.musicLibrarySync.accountId); persistCrateCacheForAccount(state.musicLibrarySync.accountId); }}
function esc(s=''){return String(s ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

function deckShellHtml(deck, label){
  return `
    <div class="deck professional-deck deck-${deck === 'a' ? 'left' : 'right'}" data-deck="${deck}">
      <div class="deck-top"><span>DECK ${label}</span><span id="meta-${deck}">No track loaded</span></div>
      <div class="deck-core">
        <div class="deck-art" id="art-${deck}">ART</div>
        <div class="deck-readout">
          <div class="lcd-screen small" id="readout-${deck}">
            <div class="deck-title-row">
              <div><strong id="name-${deck}">No Track</strong><small id="artist-${deck}">--</small></div>
              <div class="deck-bpm-key"><div class="readout"><div class="big" id="bpm-${deck}">--</div><small>BPM</small></div><div class="readout"><div class="big" id="key-${deck}">--</div><small>KEY</small></div></div>
            </div>
          </div>
          <div class="wave" id="wave-${deck}"></div>
          <div class="deck-control-grid">
            <button class="ghost small" data-cue="${deck}" type="button">Cue</button>
            <button class="primary small" data-play="${deck}" type="button">Play</button>
            <button class="ghost small" data-sync="${deck}" type="button">Sync</button>
            <button class="ghost small" data-keylock="${deck}" type="button">Key</button>
            <button class="ghost small" data-loop="${deck}" type="button">Loop</button>
            <button class="ghost small" data-set-cue="${deck}" type="button">Set Cue</button>
            <button class="ghost small" data-hotcue="${deck}" type="button">Hot Cue</button>
          </div>
          <div class="deck-lower">
            <label>Pitch <input id="pitch-${deck}" type="range" min="0.94" max="1.06" step="0.001" value="1"><output id="pitch-out-${deck}">0.0%</output></label>
            <div class="meter" id="meter-${deck}"><i></i></div>
            <div class="lcd-screen small deck-time" id="time-${deck}">0:00</div>
          </div>
          <div class="deck-cues" id="cues-${deck}"></div>
        </div>
      </div>
      <button class="ghost small deck-file-load" data-load="${deck}" type="button">Load Local File</button>
      <input type="file" id="file-${deck}" accept="audio/*" hidden>
      <audio id="audio-${deck}"></audio>
    </div>`;
}

function installProfessionalShell(){
  const nav = document.getElementById('nav');
  if(nav){
    const items = [
      ['battles','BT','Battles'],
      ['studio','ST','Battle Studio'],
      ['library','ML','Music Library'],
      ['community','CM','Community'],
      ['rankings','RK','Rankings'],
      ['tour','VT','Virtual Tour'],
      ['activity','AC','Activity'],
      ['profile','PR','Profile'],
      ['settings','SE','Settings']
    ];
    nav.innerHTML = items.map(([view, icon, label]) => `<button class="nav-btn ${view === 'battles' ? 'active' : ''}" data-view="${view}" title="${label}" type="button"><b>${icon}</b><span>${label}</span>${view === 'activity' ? '<span id="notification-count-pill">0</span>' : ''}</button>`).join('');
  }
  const sidebar = document.querySelector('.sidebar');
  if(sidebar && !document.getElementById('sidebar-toggle')){
    const toggle = document.createElement('button');
    toggle.className = 'sidebar-toggle';
    toggle.id = 'sidebar-toggle';
    toggle.type = 'button';
    toggle.textContent = 'Collapse';
    toggle.setAttribute('aria-label', 'Collapse sidebar');
    sidebar.insertBefore(toggle, nav || sidebar.children[1] || null);
  }
  if(sidebar && !document.getElementById('operator-nav')){
    const ops = document.createElement('button');
    ops.className = 'nav-btn operator-only hidden';
    ops.id = 'operator-nav';
    ops.type = 'button';
    ops.dataset.view = 'operations';
    ops.title = 'Judging Operations';
    ops.innerHTML = '<b>OP</b><span>Judging Ops</span>';
    sidebar.insertBefore(ops, sidebar.querySelector('.side-card') || null);
  }
  const studio = document.getElementById('studio');
  if(studio){
    studio.innerHTML = `
      <div class="studio-head product-page-head">
        <div>
          <span class="eyebrow accent">BATTLE STUDIO</span>
          <h2>Decks. Mixer. Browser.</h2>
          <p>Prepare music, connect supported hardware, record a take, review it, then submit when you are ready.</p>
        </div>
        <div class="timer-card"><span>BATTLE CLOCK</span><strong id="battle-clock">10:00</strong><button class="ghost small" id="timer-toggle" type="button">Start</button></div>
      </div>
      <div class="recording-strip" id="studio-recording-panel">
        <button class="ghost small" id="arm-record" type="button">ARM</button>
        <button class="primary small" id="record-mix" type="button" disabled>RECORD</button>
        <button class="ghost small" id="stop-record" type="button" disabled>STOP</button>
        <span class="record-state" id="record-status">Recording idle</span>
        <strong id="record-timer">00:00</strong>
        <div class="record-meters" aria-label="Recording input meters"><i id="record-meter-l"></i><i id="record-meter-r"></i></div>
      </div>
      <div class="studio-grid professional-studio-grid">
        ${deckShellHtml('a', 'A')}
        <section class="mixer professional-mixer" aria-label="Mixer">
          <div class="mixer-head"><span>MIXER</span><strong>MASTER</strong></div>
          <div class="mixer-meter-stack"><div class="channel-meter"><span>A</span><i></i></div><div class="channel-meter master"><span>M</span><i></i></div><div class="channel-meter"><span>B</span><i></i></div></div>
          <div class="mixer-channels">
            <div class="mixer-channel">
              <strong>CH A</strong>
              <label>Gain<input id="gain-a" type="range" min="0" max="1.4" step="0.01" value="1"></label>
              <label>High<input id="eq-high-a" type="range" min="-12" max="12" step="1" value="0"></label>
              <label>Mid<input id="eq-mid-a" type="range" min="-12" max="12" step="1" value="0"></label>
              <label>Low<input id="eq-low-a" type="range" min="-12" max="12" step="1" value="0"></label>
              <label>Filter<input id="filter-a" type="range" min="-1" max="1" step="0.01" value="0"></label>
              <label>Fader<input id="vol-a" type="range" min="0" max="1" step="0.01" value="1"></label>
              <button class="ghost small" type="button">Cue</button>
            </div>
            <div class="mixer-channel">
              <strong>CH B</strong>
              <label>Gain<input id="gain-b" type="range" min="0" max="1.4" step="0.01" value="1"></label>
              <label>High<input id="eq-high-b" type="range" min="-12" max="12" step="1" value="0"></label>
              <label>Mid<input id="eq-mid-b" type="range" min="-12" max="12" step="1" value="0"></label>
              <label>Low<input id="eq-low-b" type="range" min="-12" max="12" step="1" value="0"></label>
              <label>Filter<input id="filter-b" type="range" min="-1" max="1" step="0.01" value="0"></label>
              <label>Fader<input id="vol-b" type="range" min="0" max="1" step="0.01" value="1"></label>
              <button class="ghost small" type="button">Cue</button>
            </div>
          </div>
          <label class="crossfader">Crossfader<input id="xfader" type="range" min="-1" max="1" step="0.01" value="0"></label>
          <label class="master-level">Master<input id="master-level" type="range" min="0" max="1.2" step="0.01" value="1"></label>
          <div class="fx-row"><button class="ghost small" type="button" disabled>FX 1</button><button class="ghost small" type="button" disabled>FX 2</button><span>FX disabled until mapped by provider/device support.</span></div>
        </section>
        ${deckShellHtml('b', 'B')}
        <section class="panel studio-browser-panel">
          <div class="studio-browser-head">
            <div><span class="eyebrow">BATTLE STUDIO MUSIC BROWSER</span><h3>Library</h3></div>
            <div class="hardware-source" role="tablist" aria-label="Studio library source">
              <button class="ghost small active" data-src="MY_LIBRARY" type="button">MY MUSIC</button>
              <button class="ghost small" data-src="STREAMING" type="button">STREAMING</button>
              <button class="ghost small" data-src="PLAYLISTS" type="button">PLAYLISTS</button>
            </div>
          </div>
          <div class="studio-browser-actions">
            <input id="studio-search" type="search" placeholder="Search title, artist, BPM, key or genre">
            <button class="ghost small workstation-file-load" data-load="a" type="button">Load Deck A File</button>
            <button class="ghost small workstation-file-load" data-load="b" type="button">Load Deck B File</button>
            <button class="ghost small" id="open-studio-library-drawer" type="button">Library Drawer</button>
            <button class="ghost small" id="import-playlist" type="button">Import Playlist</button>
            <select id="playlist-export-format" aria-label="Playlist export format"><option value="csv">CSV</option><option value="m3u">M3U</option><option value="m3u8">M3U8</option></select>
            <button class="ghost small" id="export-playlist" type="button">Export Playlist</button>
            <input id="playlist-import-file" type="file" accept=".m3u,.m3u8,.csv,text/csv,audio/x-mpegurl" hidden>
          </div>
          <div id="studio-library-rule-status" class="library-rule-status"></div>
          <div id="streaming-services" class="streaming-service-selector"></div>
          <div id="stream-browser" class="stream-browser"></div>
          <div class="table-wrap studio-table-wrap"><table><thead><tr><th>Load</th><th>Artwork</th><th>Title</th><th>Artist</th><th>BPM</th><th>Key</th><th>Genre</th><th>Source</th><th>Compatibility</th><th>Duration</th></tr></thead><tbody id="studio-library-table"></tbody></table></div>
        </section>
      </div>
      <div class="studio-utility-grid">
        <section class="panel compact-system-panel" id="controller-panel">
          <div class="section-head compact"><div><span class="eyebrow">CONNECT CONTROLLER</span><h3>Hardware</h3></div><button class="ghost small" id="scan-midi" type="button">Scan MIDI</button></div>
          <div class="status-grid dense"><div><span>Controller</span><strong id="controller-name">No controller detected</strong></div><div><span>Status</span><strong id="controller-status">Disconnected</strong></div><div><span>MIDI Activity</span><strong id="midi-activity">Idle</strong></div><div><span>Mapping</span><strong id="mapping-status">Not mapped</strong></div></div>
          <div id="controller-mapping-list" class="mapping-list"></div>
        </section>
        <section class="panel compact-system-panel" id="audio-setup-panel">
          <div class="section-head compact"><div><span class="eyebrow">AUDIO SETUP</span><h3>Inputs</h3></div><button class="ghost small" id="refresh-audio-devices" type="button">Refresh</button></div>
          <div class="status-grid dense"><div><span>Controller</span><strong id="audio-controller-state">Disconnected</strong></div><div><span>Audio</span><strong id="audio-state">Unavailable</strong></div><div><span>Recording</span><strong id="audio-recording-state">Not Armed</strong></div></div>
          <label>Input Source<select id="audio-input-select"><option value="">Browser default</option></select></label>
          <label>Recording Source<select id="recording-source-select"><option value="master">Master mix</option><option value="microphone">Microphone/input</option></select></label>
          <p id="audio-setup-message">Browser output routing is not exposed here.</p>
        </section>
        <section class="panel compact-system-panel" id="mini-battle-panel">
          <div class="mini-battle-line"><strong id="mini-dj1">${esc(currentUser().displayName)}</strong><span>VS</span><strong id="mini-dj2">Solo Mode</strong></div>
          <div class="status-grid dense"><div><span>Mode</span><strong id="mini-mode">Practice</strong></div><div><span>Genre</span><strong id="mini-genre">Global</strong></div><div><span>Clock</span><strong id="mini-battle-clock">10:00</strong></div></div>
          <small id="mini-meta2">AI high-score mode</small><small id="mini-meta1">White / Tampa</small>
        </section>
      </div>
      <div id="studio-library-drawer" class="studio-library-drawer hidden"></div>
      <section class="panel recording-review hidden" id="recording-review">
        <div class="section-head compact"><div><span class="eyebrow">BATTLE RECORDING REVIEW</span><h3 id="recording-review-title">Take ready</h3></div><strong id="recording-duration">00:00</strong></div>
        <div class="review-waveform" id="recording-waveform"></div>
        <audio id="recording-review-audio" controls></audio>
        <div class="review-meta" id="recording-metadata"></div>
        <div class="modal-actions"><button class="ghost" id="restart-recording" type="button">Restart Recording</button><button class="ghost" id="save-recording-draft" type="button">Save Draft</button><button class="primary" id="submit-recording" type="button">Submit Battle</button></div>
      </section>
      <div class="studio-analysis-row">
        <div class="panel ai-panel"><div><span class="eyebrow">JUDGE PANEL</span><h3>Battle Judging</h3><p>Timing / beatmatching / phrase mixing / transitions / technical evidence.</p></div><div class="judge-actions"><button class="primary" id="judge-score-preview" type="button">Generate Practice Score</button><div id="score-breakdown" class="score-breakdown"></div></div></div>
        <div class="panel" id="how-close-wrap"><div><span class="eyebrow">HOW CLOSE WAS I?</span><h3>Timing Accuracy Inspector</h3><p>Compare target landings with measured timing markers.</p></div><div class="judge-actions"><button class="ghost" id="hc-run-timing" type="button">Analyze Timing</button><button class="ghost" id="run-judge-analysis" type="button">Run Judge Analysis</button></div></div>
      </div>`;
  }
  const libraryInspector = document.querySelector('#library-inspector .library-mini-panel .eyebrow');
  const streamingPanel = libraryInspector && libraryInspector.textContent.trim() === 'STREAMING' ? libraryInspector.closest('.library-mini-panel') : null;
  if(streamingPanel) streamingPanel.remove();
  installAuxiliaryViews();
}

function installAuxiliaryViews(){
  const main = document.querySelector('.main');
  if(!main) return;
  if(!document.getElementById('tour')){
    const section = document.createElement('section');
    section.id = 'tour';
    section.className = 'view';
    section.innerHTML = `<div class="product-page-head"><div><span class="eyebrow accent">VIRTUAL TOUR</span><h2>Virtual Tour</h2></div><button class="ghost compact" id="replay-tour" type="button">Replay</button></div><div class="tour-shell"><aside class="tour-steps" id="tour-steps"></aside><div class="panel tour-panel"><span class="eyebrow" id="tour-step-kicker">STEP 1</span><h3 id="tour-step-title">Battles</h3><p id="tour-step-copy">Find and enter battles.</p><div class="modal-actions"><button class="ghost" id="tour-back" type="button">Back</button><button class="ghost" id="tour-skip" type="button">Skip</button><button class="primary" id="tour-next" type="button">Next</button></div></div></div>`;
    main.insertBefore(section, document.getElementById('operations') || null);
  }
  if(!document.getElementById('activity')){
    const section = document.createElement('section');
    section.id = 'activity';
    section.className = 'view';
    section.innerHTML = `<div class="product-page-head"><div><span class="eyebrow accent">ACTIVITY</span><h2>Activity</h2></div><button class="ghost compact" id="activity-refresh" type="button">Refresh</button></div><div id="activity-feed" class="activity-feed"></div>`;
    main.insertBefore(section, document.getElementById('operations') || null);
  }
  if(!document.getElementById('settings')){
    const section = document.createElement('section');
    section.id = 'settings';
    section.className = 'view';
    section.innerHTML = `<div class="product-page-head"><div><span class="eyebrow accent">SETTINGS</span><h2>Settings</h2></div></div><div class="settings-grid"><section class="panel"><span class="eyebrow">TOUR</span><h3>Virtual Tour</h3><p>Replay the product walkthrough from the navigation at any time.</p><button class="primary small" data-view-target="tour" type="button">Open Tour</button></section><section class="panel"><span class="eyebrow">STUDIO</span><h3>Device Preferences</h3><p>Controller and audio device choices are browser-scoped and never imply unsupported output routing.</p><button class="ghost small" data-view-target="studio" type="button">Open Studio Setup</button></section><section class="panel"><span class="eyebrow">ACCOUNT</span><h3>Profile Controls</h3><p>Public profile, relationships, battle history, and privacy controls stay in Profile.</p><button class="ghost small" data-view-target="profile" type="button">Open Profile</button></section></div>`;
    main.insertBefore(section, document.getElementById('operations') || null);
  }
}

installProfessionalShell();
function switchView(view){
  if(isStudioRecordingActive() && view !== 'studio'){
    const proceed = typeof confirm === 'function' ? confirm('A recording is in progress. Leave Battle Studio and risk losing the active take?') : false;
    if(!proceed) return false;
  }
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===view));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  document.getElementById('page-title').textContent=pageTitles[view]||'DJ Battle';
  if(view === 'operations'){
    renderJudgingOperationsAccess();
    if(state.operatorUser) loadJudgingOperationsStatus();
  }
  if(view === 'verified-results') loadVerifiedResultsDiscovery();
  if(view === 'rankings') {
    applyRankingsDeepLink();
    renderRankingsPage();
    loadRankingsPage({ preserve:true }).catch(err=>console.warn('Rankings refresh failed', err));
    loadRankingsPersonalSummary().catch(err=>console.warn('Personal rankings refresh failed', err));
  }
  if(view === 'notifications'){
    renderNotificationCenter();
    loadDjNotifications({ preserve:true }).catch(err=>console.warn('Notification refresh failed', err));
  }
  if(view === 'activity'){
    renderActivityPage();
    loadDjNotifications({ preserve:true }).catch(err=>console.warn('Activity refresh failed', err));
  }
  if(view === 'tour') renderVirtualTour();
  if(view === 'settings') renderSettingsPage();
  if(view === 'community') loadCommunityFeed({ preserve:true }).catch(err=>console.warn('Community refresh failed', err));
  if(view === 'battles') loadServerBattleLobby({ render:false }).then(()=>renderBattles()).catch(err=>console.warn('Battle lobby refresh failed', err));
  if(view === 'studio') recoverBattlePrepSnapshotInStudio(activeStudioBattleSession());
  if(view === 'profile'){
    renderChallengeCountPill();
    loadDjChallengeCount().catch(()=>{});
  }
  window.scrollTo({top:0,behavior:'smooth'});
  return true;
}
document.querySelectorAll('[data-view-target]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.viewTarget)));
document.querySelectorAll('.nav-btn').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
const sidebarToggle = document.getElementById('sidebar-toggle');
if(sidebarToggle){
  const collapsed = localStorage.getItem('djBattleSidebarCollapsed') === '1';
  document.querySelector('.app-shell')?.classList.toggle('sidebar-collapsed', collapsed);
  sidebarToggle.textContent = collapsed ? 'Expand' : 'Collapse';
  sidebarToggle.onclick = () => {
    const shell = document.querySelector('.app-shell');
    const next = !shell?.classList.contains('sidebar-collapsed');
    shell?.classList.toggle('sidebar-collapsed', next);
    sidebarToggle.textContent = next ? 'Expand' : 'Collapse';
    sidebarToggle.setAttribute('aria-label', next ? 'Expand sidebar' : 'Collapse sidebar');
    localStorage.setItem('djBattleSidebarCollapsed', next ? '1' : '0');
  };
}

function isVisibleBattle(b){ return !['completed','cancelled'].includes(b.status) && b.visibility !== 'private'; }
function battleHostName(b){
  if(b.creatorPublicProfile && b.creatorPublicProfile.name) return b.creatorPublicProfile.name;
  if(b.createdBy && b.createdBy !== 'platform') return b.createdBy;
  return 'DJ Battle';
}
function battleDurationMinutes(b){
  if(Number.isFinite(Number(b.durationMinutes))) return Number(b.durationMinutes);
  const value = parseMinutes(b.time || b.duration || '');
  return value || 10;
}
function battleTabMatches(b, tab){
  const status = String(b.status || b.lobbyStatus || 'open').toLowerCase();
  if(tab === 'completed') return ['completed','finished','resolved'].includes(status);
  if(tab === 'mine') return String(b.createdBy || '') === currentProfileUserId() || Boolean(b.entries && b.entries[currentProfileUserId()]);
  if(tab === 'invites') return status === 'invited' || status === 'challenge_pending' || Boolean(b.challengeId);
  return isVisibleBattle(b);
}
function battleEntryKind(b){
  if(b.premiumRequired) return 'premium';
  if(b.trackSelectionMethod === 'open_library' || b.selection === 'Open library') return 'open_library';
  if(b.trackSelectionMethod === 'own_selection' || b.selection === 'DJ-selected') return 'own_selection';
  return 'assigned';
}
function battleSearchText(b){
  return [b.title, battleHostName(b), battleModeDisplayLabel(b.modeId, b.type), b.genre, b.desc, b.judging].join(' ').toLowerCase();
}
function battleCard(b){
  const reward = b.reward && b.reward.type ? b.reward.type.replace('_',' ').toUpperCase() : 'STANDARD';
  const rawStatus = String(b.lobbyStatus || b.status || 'open').toLowerCase();
  const status = ({ matched:'FULL', full:'FULL', open:'OPEN', waiting:'FILLING', started:'STARTED', active:'STARTED', submission_pending:'SUBMISSIONS', judging:'JUDGING', completed:'COMPLETE' })[rawStatus] || rawStatus.replace(/_/g,' ').toUpperCase();
  const tone = battleModeTone(b.modeId);
  const title = b.modeId === 'half_hour_mix_battle' && /30-Minute Tech House/i.test(b.title || '') ? '30-Minute Mix' : b.title;
  const label = battleModeDisplayLabel(b.modeId, b.type);
  const genre = battleModeFixedGenre(b.modeId) || b.genre || 'Open Format';
  const duration = `${battleDurationMinutes(b)} min`;
  const players = Number(b.people || b.participantCount || 0);
  const capacity = Number(b.capacity || 0);
  const remaining = capacity ? Math.max(0, capacity - players) : null;
  const startCondition = rawStatus === 'full' || rawStatus === 'matched' ? 'Roster locked; ready to start' : remaining === 1 ? 'Starts when 1 seat fills' : remaining != null ? `Waiting for ${remaining}` : 'Open entry';
  const category = b.discipline === 'producer' ? 'Beat Battle' : 'DJ Battle';
  const entryKind = battleEntryKind(b);
  const entry = entryKind === 'open_library' ? 'Open Library' : entryKind === 'own_selection' ? 'Own Selection' : entryKind === 'premium' ? 'Premium' : 'Assigned';
  return `<article class="battle-card battle-row tone-${tone}" data-genre="${esc(genre)}" data-format="${esc(b.modeId || '')}">
    <div class="battle-row-main">
      <span class="battle-icon">${esc(battleModeIcon(b.modeId))}</span>
      <div><strong>${esc(title)}</strong><small>${esc(category)} / ${esc(label)} / ${esc(genre)}</small></div>
    </div>
    <div class="battle-row-cell"><span>Duration</span><strong>${esc(duration)}</strong></div>
    <div class="battle-row-cell"><span>Level</span><strong>${esc(b.difficulty || 'Open')}</strong></div>
    <div class="battle-row-cell"><span>Entry</span><strong>${esc(entry)}</strong></div>
    <div class="battle-row-cell"><span>Players</span><strong>${players}${capacity ? `/${capacity}` : ''}</strong></div>
    <div class="battle-row-cell"><span>Seats</span><strong>${remaining == null ? 'N/A' : remaining}</strong></div>
    <div class="battle-row-cell"><span>State</span><strong>${esc(status)}</strong></div>
    <div class="battle-row-cell"><span>Start</span><strong>${esc(startCondition)}</strong></div>
    <button class="${b.premiumRequired?'ghost':'primary'} small enter tone-action" data-enter="${esc(b.id)}" ${b.joinable === false || ['full','matched','started','active','submission_pending','judging','completed'].includes(rawStatus) ? 'disabled' : ''}>${b.premiumRequired?'Premium':'Join'}</button>
    <p>${esc(b.desc || '')}</p>
    <span class="tag battle-status-tag">${esc(status)}</span>
  </article>`;
}
function syncBattleFilterControls(){
  const filters = state.battleLobby.filters || {};
  const modeSelect = document.getElementById('battle-lobby-mode-filter');
  const genreSelect = document.getElementById('battle-lobby-genre-filter');
  const durationSelect = document.getElementById('battle-lobby-duration-filter');
  const entrySelect = document.getElementById('battle-lobby-entry-filter');
  const searchInput = document.getElementById('battle-lobby-search-filter');
  const sortSelect = document.getElementById('battle-lobby-sort');
  if(modeSelect && !modeSelect.options.length){
    modeSelect.innerHTML = ['all', ...BattleModes.listBattleModes().map(mode => mode.id)].map(mode => `<option value="${esc(mode)}">${esc(mode === 'all' ? 'All modes' : battleModeDisplayLabel(mode))}</option>`).join('');
  }
  if(genreSelect && !genreSelect.options.length){
    genreSelect.innerHTML = ['all', ...GENRES].map(genre => `<option value="${esc(genre)}">${esc(genre === 'all' ? 'All genres' : genre)}</option>`).join('');
  }
  if(modeSelect) modeSelect.value = filters.mode || 'all';
  if(genreSelect) genreSelect.value = filters.genre || 'all';
  if(durationSelect) durationSelect.value = filters.duration || 'all';
  if(entrySelect) entrySelect.value = filters.entry || 'all';
  if(searchInput && searchInput.value !== (filters.search || '')) searchInput.value = filters.search || '';
  if(sortSelect) sortSelect.value = state.battleSort || 'ending_soon';
  document.querySelectorAll('[data-battle-tab]').forEach(button=>button.classList.toggle('active', button.dataset.battleTab === (state.battleViewTab || 'open')));
}
function filteredBattleRows(filter='All'){
  const filters = state.battleLobby.filters || {};
  const format = state.battleFormatFilter || 'all';
  const activeGenre = filter !== 'All' ? filter : filters.genre && filters.genre !== 'all' ? filters.genre : 'All';
  const q = String(filters.search || '').trim().toLowerCase();
  let list = battles.filter(b => {
    const genre = battleModeFixedGenre(b.modeId) || b.genre || 'Open Format';
    const duration = battleDurationMinutes(b);
    if(!battleTabMatches(b, state.battleViewTab || 'open')) return false;
    if(format !== 'all' && b.modeId !== format) return false;
    if(filters.mode && filters.mode !== 'all' && b.modeId !== filters.mode) return false;
    if(activeGenre !== 'All' && genre !== activeGenre) return false;
    if(filters.duration === 'short' && duration > 10) return false;
    if(filters.duration === 'medium' && (duration < 20 || duration > 30)) return false;
    if(filters.duration === 'long' && duration < 60) return false;
    if(filters.entry && filters.entry !== 'all' && battleEntryKind(b) !== filters.entry) return false;
    if(q && !battleSearchText(b).includes(q)) return false;
    return true;
  });
  const sort = state.battleSort || 'ending_soon';
  list = list.slice().sort((a,b) => {
    if(sort === 'players') return Number(b.people || b.participantCount || 0) - Number(a.people || a.participantCount || 0);
    if(sort === 'newest') return Number(b.id || 0) - Number(a.id || 0);
    if(sort === 'rating') return Number(b.creatorPublicProfile && b.creatorPublicProfile.rating || 0) - Number(a.creatorPublicProfile && a.creatorPublicProfile.rating || 0);
    return battleDurationMinutes(a) - battleDurationMinutes(b);
  });
  return list;
}
function renderBattles(filter='All'){
  syncBattleFilterControls();
  const list = filteredBattleRows(filter);
  const empty = `<div class="panel battle-empty"><strong>No battles match these filters.</strong><p>Adjust the filters or create a battle for this lane.</p></div>`;
  const grid = document.getElementById('battle-grid');
  if(grid){ grid.classList.toggle('battle-grid-view', state.battleLayout === 'grid'); grid.innerHTML=battleLobbyStatusStripHtml()+(list.length ? list.map(battleCard).join('') : empty); }
  const featured = document.getElementById('featured-battles');
  if(featured) featured.innerHTML=filteredBattleRows('All').slice(0,3).map(battleCard).join('');
  document.querySelectorAll('[data-enter]').forEach(b=>b.onclick=()=>openBattleLifecycle(b.dataset.enter));
  wireBattleLobbyControls(filter);
}

function battleLobbyServerApiAvailable(){
  return Boolean(window.DJBattleApi && typeof window.DJBattleApi.apiRequest === 'function');
}

function battleLobbyQuery(options = {}){
  const filters = { ...(state.battleLobby.filters || {}), ...(options.filters || {}) };
  const params = new URLSearchParams();
  params.set('page', String(options.page || state.battleLobby.page || 1));
  params.set('limit', String(options.limit || state.battleLobby.pageSize || 20));
  Object.entries(filters).forEach(([key, value]) => {
    if(value == null || value === '' || value === false || value === 'all') return;
    params.set(key, String(value));
  });
  if(options.sort) params.set('sort', options.sort);
  return params.toString();
}

function serverLobbyBattleToLocal(row){
  const entry = row.entryRequirements || {};
  const creator = row.creator || {};
  const followerText = creator.relationshipCounts && creator.relationshipCounts.source === 'server'
    ? ` / ${Number(creator.followerCount ?? creator.relationshipCounts.followers ?? 0)} follower(s)`
    : '';
  const record = BattleModes.normalizeBattleRecord({
    id:row.id,
    modeId:row.modeId,
    title:row.title || row.modeLabel,
    genre:row.genre,
    durationMinutes:entry.durationMinutes,
    trackSelectionMethod:entry.trackSelectionMethod,
    trackCount:entry.trackCount,
    minimumTrackCount:entry.minimumTrackCount,
    opponentRequirement:entry.opponentRequirement,
    reward:{ type:row.reward && row.reward.type || (row.bitcoinRewardMetadata ? 'bitcoin' : 'standard'), metadata:{} },
    status:row.status,
    visibility:'public',
    participants:[],
    people:row.participantCount || 0
  });
  return {
    ...record,
    serverBacked:true,
    lobbyStatus:row.status,
    joinable:Boolean(row.joinable),
    participantCount:row.participantCount || 0,
    capacity:row.capacity,
    creatorPublicProfile:creator,
    scoringType:row.scoringType,
    startConditions:row.startConditions || {},
    expiresAt:row.expiresAt || null,
    bitcoinRewardMetadata:row.bitcoinRewardMetadata || null,
    desc:`${creator.name || 'DJ'} ${creator.country ? '('+creator.country+')' : ''}${followerText} is waiting for ${row.modeLabel || record.type}. ${row.bitcoinRewardMetadata ? 'Bitcoin reward metadata is untransferred.' : 'Server-backed battle.'}`,
    people:row.participantCount || 0,
    judging:row.scoringType || 'measured_rule_based'
  };
}

function mergeServerLobbyBattles(rows){
  const safeRows = (rows || []).map(serverLobbyBattleToLocal);
  const ids = new Set(safeRows.map(row => String(row.id)));
  const retained = battles.filter(battle => !(battle.serverBacked && ids.has(String(battle.id)) && !battlePrepSnapshotForUser(battle)));
  safeRows.reverse().forEach(row => {
    const existing = retained.findIndex(item => String(item.id) === String(row.id));
    if(existing >= 0) retained[existing] = { ...retained[existing], ...row, entries:retained[existing].entries || row.entries };
    else retained.unshift(row);
  });
  battles = retained;
}

function battleLobbyStatusStripHtml(){
  const lobby = state.battleLobby || {};
  const status = lobby.status || 'offline';
  const counts = (lobby.rows || []).reduce((acc, row) => {
    const key = row.status || 'open';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const lamps = ['open','waiting','full','started','expired'].map(key => `<span class="tag">${esc(key.toUpperCase())}: ${counts[key] || 0}</span>`).join('');
  const statusLabel = status === 'synced' ? 'SYNCED' : status === 'syncing' ? 'SYNCING' : status === 'failed' ? 'LIMITED' : 'LOCAL';
  const note = status === 'syncing'
    ? 'Syncing open battles'
    : status === 'synced'
      ? `Open battles refreshed ${lobby.lastSyncedAt ? communityDate(lobby.lastSyncedAt) : 'recently'}`
      : status === 'failed' || status === 'configuration_required'
        ? 'Online battle discovery is temporarily unavailable. Saved battles remain playable.'
        : 'Showing saved battles from this browser.';
  return `<div class="notice battle-lobby-strip"><strong>${esc(statusLabel)}</strong><span>${esc(note)}</span><div class="battle-lobby-counts">${lamps}</div><div class="battle-lobby-actions"><button class="ghost small" type="button" id="battle-lobby-refresh">Refresh</button><button class="primary small" type="button" id="battle-lobby-matchmake">Find Match</button>${lobby.pagination && lobby.pagination.hasMore ? '<button class="ghost small" type="button" id="battle-lobby-more">Load More</button>' : ''}</div></div>`;
}

function wireBattleLobbyControls(currentGenre = 'All'){
  const collectFilters = () => ({
    mode:document.getElementById('battle-lobby-mode-filter')?.value || 'all',
    genre:document.getElementById('battle-lobby-genre-filter')?.value || 'all',
    duration:document.getElementById('battle-lobby-duration-filter')?.value || 'all',
    entry:document.getElementById('battle-lobby-entry-filter')?.value || 'all',
    search:document.getElementById('battle-lobby-search-filter')?.value || '',
    country:state.battleLobby.filters.country || 'all',
    belt:state.battleLobby.filters.belt || 'all',
    scoringType:document.getElementById('battle-lobby-scoring-filter')?.value || 'all',
    opponent:document.getElementById('battle-lobby-opponent-filter')?.value || 'all',
    relationship:document.getElementById('battle-lobby-relationship-filter')?.value || 'all',
    ownSelection:Boolean(document.getElementById('battle-lobby-own-filter')?.checked),
    bitcoin:Boolean(document.getElementById('battle-lobby-bitcoin-filter')?.checked)
  });
  const apply = () => {
    state.battleLobby.filters = { ...state.battleLobby.filters, ...collectFilters(), genre:currentGenre === 'All' ? (collectFilters().genre || 'all') : currentGenre };
    state.battleLobby.page = 1;
    const sort = document.getElementById('battle-lobby-sort')?.value || state.battleSort || 'ending_soon';
    state.battleSort = sort;
    localStorage.setItem('djBattleBattleSort', sort);
    renderBattles(currentGenre);
    loadServerBattleLobby({ page:1 }).catch(err=>console.warn('Battle lobby filter failed', err));
  };
  ['battle-lobby-mode-filter','battle-lobby-genre-filter','battle-lobby-duration-filter','battle-lobby-entry-filter','battle-lobby-sort','battle-lobby-scoring-filter','battle-lobby-opponent-filter','battle-lobby-relationship-filter','battle-lobby-own-filter','battle-lobby-bitcoin-filter'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.onchange = apply;
  });
  const search = document.getElementById('battle-lobby-search-filter');
  if(search) search.oninput = apply;
  document.querySelectorAll('[data-battle-tab]').forEach(button => {
    button.onclick = () => {
      state.battleViewTab = button.dataset.battleTab || 'open';
      localStorage.setItem('djBattleBattleViewTab', state.battleViewTab);
      renderBattles(currentGenre);
    };
  });
  document.querySelectorAll('[data-battle-layout]').forEach(button => {
    button.classList.toggle('active', button.dataset.battleLayout === state.battleLayout);
    button.onclick = () => {
      state.battleLayout = button.dataset.battleLayout === 'grid' ? 'grid' : 'list';
      localStorage.setItem('djBattleBattleLayout', state.battleLayout);
      renderBattles(currentGenre);
    };
  });
  const refresh = document.getElementById('battle-lobby-refresh');
  if(refresh) refresh.onclick = apply;
  const more = document.getElementById('battle-lobby-more');
  if(more) more.onclick = () => loadServerBattleLobby({ page:(state.battleLobby.pagination && state.battleLobby.pagination.nextPage) || state.battleLobby.page + 1 }).catch(err=>console.warn('Battle lobby pagination failed', err));
  const match = document.getElementById('battle-lobby-matchmake');
  if(match) match.onclick = async () => {
    const result = await findCompatibleServerBattle(collectFilters());
    if(result.battle) openBattleLifecycle(result.battle.id);
    else if(result.error) openModal(`<span class="eyebrow accent">MATCHMAKING</span><h3>No compatible battle</h3><p style="color:var(--muted)">${esc(result.error)}</p><div class="modal-actions"><button class="ghost" value="cancel">Close</button></div>`);
  };
}

async function loadServerBattleLobby(options = {}){
  if(!battleLobbyServerApiAvailable()){
    state.battleLobby.status = 'offline';
    state.battleLobby.error = 'Server API unavailable; showing local battles only.';
    return { skipped:true, reason:'api_unavailable' };
  }
  state.battleLobby.status = 'syncing';
  state.battleLobby.error = '';
  if(options.render !== false) renderBattles(options.genre || 'All');
  const query = battleLobbyQuery(options);
  const relationshipScope = state.battleLobby.filters.relationship || 'all';
  if(relationshipScope !== 'all' && !state.musicLibrarySync.accountId){
    state.battleLobby.status = 'failed';
    state.battleLobby.error = 'Sign in to discover battles from DJs you follow or prior opponents.';
    if(options.render !== false) renderBattles(options.genre || 'All');
    return { skipped:true, reason:'auth_required' };
  }
  const endpoint = relationshipScope === 'all' ? '/api/battles/lobby' : '/api/battles/relationshipLobby';
  const requestOptions = relationshipScope === 'all' ? { public:true } : {};
  const response = await window.DJBattleApi.apiRequest(`${endpoint}?${query}`, requestOptions);
  if(response.error){
    state.battleLobby.status = response.status === 503 ? 'configuration_required' : 'failed';
    state.battleLobby.error = response.error;
    if(options.render !== false) renderBattles(options.genre || 'All');
    return { error:response.error, response };
  }
  const incomingRows = response.data && response.data.battles || [];
  const requestedPage = Number(options.page || state.battleLobby.page || 1);
  if(requestedPage > 1){
    const mergedRows = [...(state.battleLobby.rows || [])];
    incomingRows.forEach(row => {
      const index = mergedRows.findIndex(existing => String(existing.id) === String(row.id));
      if(index >= 0) mergedRows[index] = row;
      else mergedRows.push(row);
    });
    state.battleLobby.rows = mergedRows;
  }else{
    state.battleLobby.rows = incomingRows;
  }
  state.battleLobby.page = requestedPage;
  state.battleLobby.pagination = response.data && response.data.pagination || state.battleLobby.pagination;
  state.battleLobby.status = 'synced';
  state.battleLobby.lastSyncedAt = new Date().toISOString();
  mergeServerLobbyBattles(state.battleLobby.rows);
  if(options.render !== false) renderBattles(options.genre || 'All');
  return { battles:state.battleLobby.rows, pagination:state.battleLobby.pagination, response };
}

async function findCompatibleServerBattle(filters = {}){
  if(!battlePrepServerApiAvailable()) return { skipped:true, reason:'auth_unavailable' };
  const query = battleLobbyQuery({ filters, page:1, limit:10 });
  const response = await window.DJBattleApi.apiRequest(`/api/battles/matchmaking?${query}`);
  if(response.error) return { error:response.error, response };
  const battle = response.data && response.data.battle;
  if(battle){
    mergeServerLobbyBattles([battle]);
    renderBattles();
  }
  return { battle, candidates:response.data && response.data.candidates || [], response };
}
// Helpers for Enter Battle flow
function parseMinutes(timeStr){const m=(String(timeStr).match(/(\d+)/)||[])[0];return m?Number(m):10}
function assignTracksForBattle(b,num){
  const assigned=[];
  // Prefer platform-approved tracks when available
  const platform = state.platformLibrary.filter(t=>t.battleEligible);
  const userEligible = state.library.filter(t=>t.battleEligible);
  const pool = (platform.length>0 ? platform.map(t=>t.title||t.name) : []).concat(userEligible.map(t=>t.name||t.title));
  if(pool.length>=num){
    for(let i=0;i<num;i++){assigned.push(pool[i]);} 
  } else {
    for(let i=0;i<pool.length;i++) assigned.push(pool[i]);
    for(let i=assigned.length;i<num;i++) assigned.push(`Assignment pending track ${i+1}`);
  }
  return assigned;
}

function generatePracticeScore(){
  const categories=[['Timing',18+Math.random()*8],['Beatmatching',16+Math.random()*8],['Phrasing',15+Math.random()*8],['Transition Quality',15+Math.random()*8],['Creativity',14+Math.random()*8],['Scratching',10+Math.random()*12],['Musicality',17+Math.random()*8],['Energy Flow',15+Math.random()*8],['Rule Compliance',18+Math.random()*8]];
  let total=0;
  const scored = categories.map(([label, raw]) => {
    const fixed = Math.min(20, Math.max(8, Number(raw.toFixed(1))));
    total += fixed;
    return {label, score: fixed};
  });
  return {total: Math.round(total), breakdown: scored};
}

function getAiHighScoreRows(){
  const userRows = state.practiceHistory.reduce((acc, entry) => {
    const key = currentUser().displayName;
    const existing = acc.get(key) || {dj:key, best:0, average:0, attempts:0, last:0, type:entry.type || 'Practice', genre:entry.genre || 'Global'};
    existing.attempts += 1;
    existing.best = Math.max(existing.best, Number(entry.score || 0));
    existing.last = Number(entry.score || 0);
    existing.type = entry.type || existing.type;
    existing.genre = entry.genre || existing.genre;
    acc.set(key, existing);
    return acc;
  }, new Map());

  const merged = [...defaultAiHighScores, ...Array.from(userRows.values())];
  const byDj = new Map();
  merged.forEach(item => {
    const existing = byDj.get(item.dj) || {dj:item.dj, best:0, average:0, attempts:0, last:0, type:item.type || 'Practice', genre:item.genre || 'Global'};
    existing.best = Math.max(existing.best, Number(item.best || 0));
    existing.attempts += Number(item.attempts || 0);
    existing.last = Number(item.last || 0);
    existing.average = Number((((existing.average || 0) * (existing.attempts || 1)) + (Number(item.average || 0) * (Number(item.attempts || 1)))) / Math.max(1, existing.attempts + (Number(item.attempts || 1))));
    existing.type = item.type || existing.type;
    existing.genre = item.genre || existing.genre;
    byDj.set(item.dj, existing);
  });

  const rows = Array.from(byDj.values()).map(row => ({
    ...row,
    average: Number((row.average || ((row.best + row.last)/2)).toFixed(1)),
    personalBest: row.best,
    last: row.last || row.best,
    attempts: Math.max(1, row.attempts || 1)
  }));

  return rows.sort((a,b)=>b.best-a.best || b.average-a.average).map((row,index)=>({ ...row, rank:index+1 }));
}

function renderAiLeaderboard(filter='Global'){
  const aiTarget = document.getElementById('ai-ranking-table');
  if(!aiTarget) return;
  if(LIVE_MODE){
    fetchLeaderboardLive({filter}).then(resp=>{
      if(!resp || resp.error || !Array.isArray(resp.rows)){
        aiTarget.innerHTML = '<tr><td colspan="8">No solo scores yet.</td></tr>';
        return;
      }
      const rows = resp.rows;
      const tableBody = rows.length ? rows.map(row => `
        <tr>
          <td>#${row.rank}</td>
          <td><strong>${esc(row.dj)}</strong></td>
          <td>${row.best}</td>
          <td>${row.average}</td>
          <td>${row.attempts}</td>
          <td>${row.last}</td>
          <td>${row.best}</td>
          <td>${row.genre || filter || 'Global'}</td>
        </tr>
      `).join('') : '<tr><td colspan="8">No solo scores yet.</td></tr>';
      aiTarget.innerHTML = tableBody;
    }).catch(err=>{ console.warn('renderAiLeaderboard live error', err); aiTarget.innerHTML = '<tr><td colspan="8">No solo scores yet.</td></tr>'; });
    return;
  }

  // Fallback: client-side aggregated rows.
  const rows = getAiHighScoreRows();
  const filtered = filter === 'Global' ? rows : rows.filter(row => {
    const rowType = String(row.type || '').toLowerCase();
    const rowGenre = String(row.genre || '').toLowerCase();
    const filterKey = String(filter).toLowerCase();
    return rowType.includes(filterKey) || rowGenre.includes(filterKey) || (filterKey === 'scratch' && rowType.includes('scratch')) || (filterKey === 'transition' && rowType.includes('transition')) || (filterKey === '5-song mix' && rowType.includes('5-song')) || (filterKey === '30-minute mix' && rowType.includes('30')) || (filterKey === '60-minute mix' && rowType.includes('60'));
  });

  const tableBody = filtered.length ? filtered.map(row => `
    <tr>
      <td>#${row.rank}</td>
      <td><strong>${esc(row.dj)}</strong></td>
      <td>${row.best}</td>
      <td>${row.average}</td>
      <td>${row.attempts}</td>
      <td>${row.last}</td>
      <td>${row.personalBest}</td>
      <td>${row.genre || 'Global'}</td>
    </tr>
  `).join('') : '<tr><td colspan="8">No solo scores yet.</td></tr>';

  aiTarget.innerHTML = tableBody;
}

function persistBattleProgress(){
  localStorage.setItem('djBattleBattleProgress', JSON.stringify(state.battleProgress));
  localStorage.setItem('djBattleBattleResults', JSON.stringify(state.battleResults.slice(0,50)));
}

function beltForXp(xp){
  const currentXp = Number(xp || 0);
  return BELT_THRESHOLDS.reduce((best, belt) => currentXp >= belt.xp ? belt : best, BELT_THRESHOLDS[0]);
}

function nextBeltForXp(xp){
  return BELT_THRESHOLDS.find(item => item.xp > Number(xp || 0)) || BELT_THRESHOLDS[BELT_THRESHOLDS.length - 1];
}

function cloneBattleProgressSnapshot(progress = state.battleProgress){
  return {
    xp:Number(progress && progress.xp || 0),
    rating:Number(progress && progress.rating || 0),
    rankingRating:Number(progress && progress.rankingRating || 0),
    wins:Number(progress && progress.wins || 0),
    losses:Number(progress && progress.losses || 0),
    belt:progress && progress.belt || beltForXp(progress && progress.xp).name
  };
}

function localRankForRating(rating){
  const rows = rankings
    .filter(row => !isCurrentUserName(row[1]))
    .map(row => Number(row[6] || 0))
    .concat(Number(rating || 0))
    .sort((a,b)=>b-a);
  return rows.findIndex(value => value === Number(rating || 0)) + 1;
}

function localVerifiedResultId(resultKey){
  let hash = 2166136261;
  const str = String(resultKey || '');
  for(let i = 0; i < str.length; i += 1){
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const base = (hash >>> 0).toString(16).padStart(8, '0');
  const lengthHex = Math.abs(str.length).toString(16).padStart(4, '0');
  return `vr_${base}${lengthHex}${base}`.slice(0, 23);
}

function verifiedResultUrl(verifiedResultId){
  if(!verifiedResultId) return null;
  const base = typeof window !== 'undefined' && window.location ? `${window.location.origin}${window.location.pathname}` : '';
  return `${base}#result=${encodeURIComponent(verifiedResultId)}`;
}

function scoringSourceLabels(result){
  const labels = new Set();
  const evidence = String(result && result.evidenceType || '').toLowerCase();
  const scoringModel = result && result.scoringModel || {};
  const confidence = result && result.confidence || {};
  const trained = confidence.trainedModelJudging || {};
  if(evidence.includes('measurable') || result && result.measurableAnalysis) labels.add('measured');
  if(evidence.includes('rule') || scoringModel.ruleBasedScoring) labels.add('rule-based');
  if(result && result.aiFeedback || trained.used === true) labels.add('AI-assisted');
  if(result && result.humanVoting) labels.add('human-voted');
  if(!labels.size) labels.add('rule-based');
  const values = Array.from(labels);
  return values.length > 1 ? [...values, 'hybrid'] : values;
}

function battleResultOutcome(result, battle){
  if(battle && battle.opponentRequirement === 'none') return 'practice';
  if(result && result.won === true) return 'win';
  if(result && result.won === false) return 'loss';
  if(result && result.opponentScore != null && Number(result.opponentScore) === Number(result.score)) return 'tie';
  return 'recorded';
}

function battleResultOpponentSummary(battle, result){
  const opponent = (battle.participants || []).find(participant => String(participant.userId) !== currentProfileUserId());
  if(!opponent && battle.opponentRequirement === 'none') return { status:'ai_only', name:'AI-only practice', country:null };
  return {
    status: opponent ? 'opponent' : 'unmatched',
    name: opponent ? opponent.name || 'Opponent' : 'Opponent pending',
    country: opponent && (opponent.country || opponent.profileCountry) || null,
    score: result && result.opponentScore
  };
}

function bitcoinMetadataStatus(result){
  const reward = result && result.reward || {};
  if(reward.type !== 'bitcoin') return null;
  const metadata = reward.metadata || {};
  const sats = Number(metadata.amountSats || 0);
  return {
    type:'bitcoin',
    amountSats:Number.isFinite(sats) ? sats : null,
    custody: metadata.custody || 'external_pending',
    transferStatus: metadata.verifiedPaymentId || metadata.paymentVerified === true ? 'verified payment record' : 'untransferred'
  };
}

function buildBattleResultProfileRecord(result, battle, progressionState){
  const resultKey = result.resultKey || `${battle.id}:${result.submissionId}`;
  const before = progressionState && progressionState.before || cloneBattleProgressSnapshot();
  const after = progressionState && progressionState.after || cloneBattleProgressSnapshot();
  const verifiedResultId = localVerifiedResultId(resultKey);
  const opponent = battleResultOpponentSummary(battle, result);
  return {
    resultKey,
    battleId: battle.id,
    title: battle.title,
    modeId: battle.modeId,
    type: battle.type,
    genre: battle.genre,
    date: new Date(result.completedAt || Date.now()).toLocaleDateString(),
    completedAt: result.completedAt || new Date().toISOString(),
    score: result.score,
    outcome: battleResultOutcome(result, battle),
    opponent,
    opponentStatus: opponent.status,
    rewardType: result.reward?.type || battle.rewardType || 'standard',
    bitcoin: bitcoinMetadataStatus(result),
    battlePrep: result.battlePrepSummary || battlePrepSummaryForHistory(battlePrepSnapshotForUser(battle) || result.battleContext && result.battleContext.battlePrepSnapshot, 'private'),
    progression: result.progression || {},
    progressBefore: before,
    progressAfter: after,
    rankBefore: localRankForRating(before.rankingRating),
    rankAfter: localRankForRating(after.rankingRating),
    beltBefore: before.belt,
    beltAfter: after.belt,
    sourceLabels: scoringSourceLabels(result),
    userId: result.userId,
    submissionId: result.submissionId,
    visibility: 'private',
    verifiedResultId,
    verifiedResultUrl: null,
    country: opponent.country || null,
    profile: { displayName: currentUser().displayName, country: null },
    details: {
      breakdown: result.breakdown || {},
      timing: result.timing || [],
      rawMeasurements: result.rawMeasurements || [],
      recommendations: result.recommendations || [],
      confidence: result.confidence || null,
      measurableAnalysis: result.measurableAnalysis || null,
      scoringModel: result.scoringModel || null,
      evidenceType: result.evidenceType || null,
      reward: result.reward || null,
      battlePrep: result.battlePrepSummary || battlePrepSummaryForHistory(result.battleContext && result.battleContext.battlePrepSnapshot, 'private')
    }
  };
}

function updateBattleProgressUi(){
  const progress = state.battleProgress;
  const belt = progress.belt || beltForXp(progress.xp).name;
  if(window.setCurrentBelt) window.setCurrentBelt(belt);
  document.querySelectorAll('.profile-score strong').forEach(el=>{ el.textContent = String(progress.rating || 87); });
  const profileStats = document.querySelectorAll('.profile-stats > div');
  if(profileStats[0]) profileStats[0].querySelector('strong').textContent = String(progress.wins || 0);
  if(profileStats[1]) profileStats[1].querySelector('strong').textContent = String(progress.losses || 0);
  if(profileStats[3]) profileStats[3].querySelector('strong').textContent = String(progress.xp || 0);
  const pathPanel = document.querySelector('#dashboard .progress-wrap');
  if(pathPanel){
    const next = BELT_THRESHOLDS.find(item => item.xp > Number(progress.xp || 0)) || BELT_THRESHOLDS[BELT_THRESHOLDS.length - 1];
    const prev = beltForXp(progress.xp);
    const range = Math.max(1, next.xp - prev.xp);
    const pct = next.xp === prev.xp ? 100 : Math.max(0, Math.min(100, Math.round(((progress.xp - prev.xp) / range) * 100)));
    const label = pathPanel.querySelector('.progress-label strong');
    const bar = pathPanel.querySelector('.progress i');
    if(label) label.textContent = `${progress.xp} / ${next.xp}`;
    if(bar) bar.style.width = `${pct}%`;
  }
}

function normalizeJudgeResultFromResponse(uploadResult){
  const data = uploadResult && uploadResult.data;
  const submission = data && data.submission;
  const processing = submission && submission.processing_info;
  const candidates = [
    uploadResult && uploadResult.judgeResult,
    data && data.judgeResult,
    data && data.judgingResult,
    data && data.result,
    data && data.analysis,
    submission && submission.judgeResult,
    submission && submission.judge_result,
    submission && submission.result,
    submission && submission.analysis,
    processing && processing.judgeResult,
    processing && processing.judgingResult,
    processing && processing.result,
    processing && processing.analysis
  ];
  return candidates.find(candidate => candidate && BattleModes.buildBattleResultPayload({
    battle: { id:'probe', participants:[{ userId:currentProfileUserId() }] },
    userId: currentProfileUserId(),
    submissionId: uploadResult && uploadResult.submissionId || submission && submission.id || 'probe',
    judgeResult: candidate
  }).result?.score != null) || null;
}

function applyBattleProgression(result, battle){
  const resultKey = result.resultKey || `${battle.id}:${result.submissionId}`;
  const existing = state.battleResults.find(item => item.resultKey === resultKey);
  if(existing){
    return {
      applied:false,
      duplicate:true,
      resultKey,
      before: existing.progressBefore || cloneBattleProgressSnapshot(),
      after: existing.progressAfter || cloneBattleProgressSnapshot()
    };
  }
  const progression = result.progression || {};
  const before = cloneBattleProgressSnapshot();
  const progress = state.battleProgress;
  progress.xp = Number(progress.xp || 0) + Number(progression.xp || 0);
  progress.rating = Math.max(0, Math.min(100, Number(progress.rating || 0) + Number(progression.ratingDelta || 0)));
  progress.rankingRating = Math.max(0, Number(progress.rankingRating || 1744) + Number(progression.ratingDelta || 0));
  if(result.won === true) progress.wins = Number(progress.wins || 0) + 1;
  if(result.won === false) progress.losses = Number(progress.losses || 0) + 1;
  progress.belt = beltForXp(progress.xp).name;
  const after = cloneBattleProgressSnapshot(progress);
  const record = buildBattleResultProfileRecord(result, battle, { resultKey, before, after });
  state.battleResults.unshift(record);
  saveCompletedResultHistory(result, battle, { resultKey, before, after });
  persistBattleProgress();
  updateBattleProgressUi();
  renderOfficialRankings();
  renderProfile();
  syncBattleResultProfileToServer(record).catch(err => console.warn('battle result profile sync failed', err));
  return { applied:true, duplicate:false, resultKey, before, after };
}

function saveCompletedResultHistory(result, battle, progressionState){
  if(!result || !result.progression || !result.progression.highScoreEligible) return;
  const resultKey = progressionState && progressionState.resultKey || `${battle.id}:${result.submissionId}`;
  if(state.practiceHistory.some(entry => entry.resultKey === resultKey)) return;
  state.practiceHistory.unshift({
    resultKey,
    title: battle.title || 'Practice result',
    score: result.score,
    date: new Date(result.completedAt || Date.now()).toLocaleDateString(),
    breakdown: result.breakdown || {},
    type: battle.type || 'Practice',
    genre: battle.genre || 'Global',
    highScoreEligible:true
  });
  localStorage.setItem('djBattlePracticeHistory', JSON.stringify(state.practiceHistory.slice(0,20)));
  renderAiLeaderboard();
}

function battleResultServerPayload(record){
  return {
    visibility: record.visibility || 'private',
    title: record.title,
    modeId: record.modeId,
    type: record.type,
    genre: record.genre,
    outcome: record.outcome,
    opponent: record.opponent,
    profile: record.profile,
    progression: record.progression,
    progressBefore: record.progressBefore,
    progressAfter: record.progressAfter,
    rankBefore: record.rankBefore,
    rankAfter: record.rankAfter,
    battlePrep: battlePrepSummaryForHistory(record.battlePrep || record.details && record.details.battlePrep, 'private'),
    completedAt: record.completedAt,
    securePlaybackPermitted: false
  };
}

async function syncBattleResultProfileToServer(record){
  if(!record || !record.submissionId || !window.DJBattleApi || typeof window.DJBattleApi.apiRequest !== 'function') return null;
  const response = await window.DJBattleApi.apiRequest(`/api/battleResults/${encodeURIComponent(record.submissionId)}`, {
    method:'POST',
    body:battleResultServerPayload(record)
  });
  if(response && response.data && response.data.result){
    applyServerBattleResultProfile(response.data.result);
  }
  return response;
}

function applyServerBattleResultProfile(serverResult){
  if(!serverResult) return null;
  const submissionId = serverResult.submissionId;
  const record = state.battleResults.find(item => String(item.submissionId) === String(submissionId));
  if(!record) return null;
  record.visibility = serverResult.visibility || record.visibility;
  record.verifiedResultId = serverResult.verifiedResultId || record.verifiedResultId;
  record.verifiedResultUrl = serverResult.verifiedResultUrl ? verifiedResultUrl(serverResult.verifiedResultId) : null;
  record.country = serverResult.profile && serverResult.profile.country || record.country;
  persistBattleProgress();
  renderProfile();
  return record;
}

function rewardResultText(result){
  const reward = result.reward || {};
  if(reward.type === 'bitcoin'){
    const sats = Number(reward.metadata && reward.metadata.amountSats || 0);
    const amount = sats > 0 ? `${sats} sats` : 'amount pending';
    return `Bitcoin metadata preserved (${amount}, ${reward.metadata?.custody || 'external_pending'}). No wallet custody action was taken; this is not transferred, paid or claimable.`;
  }
  if(reward.type === 'belt') return 'Belt progression updated from the judged result.';
  if(reward.type === 'xp') return 'XP and rating progression updated.';
  if(reward.type === 'high_score') return 'Solo high-score eligible result recorded.';
  return 'Standard battle result recorded.';
}

function readableComponentName(key){
  if(key === 'phrasing') return 'Phrase Mixing';
  return String(key || '').replace(/_/g,' ').replace(/\b\w/g, c=>c.toUpperCase());
}

function componentDisplayValue(value){
  if(value && typeof value === 'object'){
    if(Number.isFinite(Number(value.score))) return Math.round(Number(value.score));
    if(value.available === false) return 'N/A';
    if(value.reason) return value.reason;
    return 'Set';
  }
  return value == null ? 'N/A' : value;
}

function scoreFromBreakdown(result, keys){
  const breakdown = result && result.breakdown || {};
  for(const key of keys){
    const value = breakdown[key];
    if(Number.isFinite(Number(value))) return Math.round(Number(value));
    if(value && Number.isFinite(Number(value.score))) return Math.round(Number(value.score));
  }
  return null;
}

function formatKeyAnalysis(value){
  if(!value) return 'Not detected';
  if(typeof value === 'string') return value;
  if(value.name) return value.name;
  if(value.camelot) return value.camelot;
  return 'Detected';
}

function confidenceText(confidence){
  if(!confidence) return 'Not reported';
  if(Number.isFinite(Number(confidence.measurableComponentRatio))){
    return `${Math.round(Number(confidence.measurableComponentRatio) * 100)}% measurable`;
  }
  if(Number.isFinite(Number(confidence.availableComponents)) && Number.isFinite(Number(confidence.totalComponents))){
    return `${confidence.availableComponents}/${confidence.totalComponents} components`;
  }
  return 'Reported';
}

function opponentInfoForResult(battle, result){
  const opponent = (battle.participants || []).find(participant => String(participant.userId) !== currentProfileUserId());
  if(!opponent && battle.opponentRequirement === 'none') return { label:'AI-only practice', detail:'No opponent required' };
  return {
    label: opponent ? opponent.name || 'Opponent' : 'Opponent pending',
    detail: result.opponentScore == null ? 'No opponent score' : `${result.opponentScore}/100`
  };
}

function outcomeText(battle, result){
  if(battle.opponentRequirement === 'none') return { label:'Practice recorded', level:'ok' };
  if(result.won === true) return { label:'Win', level:'ok' };
  if(result.won === false) return { label:'Loss', level:'danger' };
  if(result.opponentScore != null && Number(result.opponentScore) === Number(result.score)) return { label:'Tie', level:'warn' };
  return { label:'Result recorded', level:'warn' };
}

function progressionSnapshotForResult(battle, result, progressionState){
  const resultKey = result.resultKey || `${battle.id}:${result.submissionId}`;
  const stored = state.battleResults.find(item => item.resultKey === resultKey);
  const before = progressionState && progressionState.before || stored && stored.progressBefore || cloneBattleProgressSnapshot();
  const after = progressionState && progressionState.after || stored && stored.progressAfter || cloneBattleProgressSnapshot();
  return {
    before,
    after,
    rankBefore: stored && stored.rankBefore || localRankForRating(before.rankingRating),
    rankAfter: stored && stored.rankAfter || localRankForRating(after.rankingRating)
  };
}

function renderBattleResultProgress(session, status, options = {}){
  const panel = document.getElementById('br-judge-placeholder');
  if(!panel) return;
  const normalized = String(status || 'uploaded').toLowerCase();
  const failed = normalized === 'failed';
  const completed = normalized === 'completed';
  const judging = normalized === 'judging';
  const uploaded = normalized === 'uploaded' || normalized === 'pending' || normalized === 'submission_pending';
  const lights = [
    ['Uploaded', uploaded || judging || completed, uploaded && !judging && !completed],
    ['Judging', judging || completed, judging],
    ['Completed', completed, false],
    ['Retryable', failed, failed]
  ];
  const level = failed ? 'danger' : judging ? 'warn' : completed ? 'ok' : 'muted';
  const message = failed
    ? 'Judging could not complete. Use Retry Upload if the file or analysis failed; recovery will continue if the server reports a retryable state.'
    : judging
      ? 'Server-side measurable analysis is running. No score is fabricated while evidence is unavailable.'
      : completed
        ? 'Judging completed.'
        : 'Mix uploaded securely and waiting for judging.';
  panel.innerHTML = `<div class="battle-result-surface battle-${level}"><div class="battle-status-strip">${lights.map(([label,on,active])=>`<div class="battle-result-module battle-${on ? (active ? 'warn' : 'ok') : 'muted'}"><div class="battle-lamp-row"><i class="battle-lamp"></i><b>${esc(label)}</b></div></div>`).join('')}</div><div class="battle-progress-shell"><span class="eyebrow">${esc(formatBattleStatus(normalized))}</span><div class="battle-progress-line"><strong>${esc(message)}</strong><span>${esc(options.submissionId || session && session.submissionId || '')}</span></div></div></div>`;
}

function renderCompletedBattleResult(battle, result, options = {}){
  const progression = result.progression || {};
  const progress = progressionSnapshotForResult(battle, result, options.progressionState);
  const outcome = outcomeText(battle, result);
  const opponent = opponentInfoForResult(battle, result);
  const hasMeasurable = Boolean(result.measurableAnalysis);
  const measurable = result.measurableAnalysis || {};
  const timingScore = scoreFromBreakdown(result, ['timing', 'beatmatching']);
  const transitionScore = scoreFromBreakdown(result, ['transition_quality', 'transitions']);
  const keyText = formatKeyAnalysis(measurable.key);
  const confidence = confidenceText(result.confidence);
  const recommendations = Array.isArray(result.recommendations) && result.recommendations.length ? result.recommendations : ['Review the measured evidence and keep transitions controlled.'];
  const breakdownRows = Object.entries(result.breakdown || {}).slice(0,10).map(([key,value])=>`<div class="battle-result-row"><b>${esc(readableComponentName(key))}</b><em>${esc(componentDisplayValue(value))}</em></div>`).join('') || '<div class="battle-result-row"><b>Judge evidence</b><em>Saved</em></div>';
  const timingRows = [
    ['Timing accuracy', timingScore == null ? 'Not targeted' : `${timingScore}/100`],
    ['Transition evidence', `${Number(measurable.transitionCount || 0)} transition(s)`],
    ['Transition score', transitionScore == null ? 'N/A' : `${transitionScore}/100`],
    ['Key analysis', keyText],
    ['BPM', measurable.bpm == null ? 'Not detected' : measurable.bpm],
    ['Duration', measurable.durationSec == null ? 'Not reported' : `${Math.round(Number(measurable.durationSec))}s`]
  ].map(([label,value])=>`<div class="battle-result-row"><b>${esc(label)}</b><em>${esc(value)}</em></div>`).join('');
  const scoringModel = result.scoringModel || {};
  const trained = result.confidence && result.confidence.trainedModelJudging || {};
  const distinctionRows = [
    ['Measurable analysis', hasMeasurable ? 'Audio evidence stored' : 'Unavailable'],
    ['Rule-based scoring', scoringModel.ruleBasedScoring || result.evidenceType || 'Deterministic rules'],
    ['AI feedback', result.aiFeedback ? 'Provided' : trained.used ? 'Trained model used' : 'Not used'],
    ['Human voting', result.humanVoting ? 'Recorded' : 'Not included yet']
  ].map(([label,value])=>`<div class="battle-result-module"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
  const audioUrl = result.securePlaybackUrl || result.playbackUrl || null;
  const playback = audioUrl ? `<audio controls src="${esc(audioUrl)}" style="width:100%"></audio>` : '<p style="color:var(--muted);margin:0">Secure playback is unavailable unless the server supplies a temporary playback URL.</p>';
  const duplicateNote = options.progressionState && options.progressionState.duplicate ? '<div class="battle-reward-note">Progression was already recorded for this submission. No duplicate XP, rating or belt award was applied.</div>' : '';
  const panel = document.getElementById('br-judge-placeholder');
  if(panel){
    panel.innerHTML = `<div class="battle-result-surface">
      <div class="battle-result-top">
        <div class="battle-score-lcd"><span>Overall score</span><strong>${esc(result.score)}</strong><small>/100</small></div>
        <div class="battle-result-module battle-${outcome.level}"><div class="battle-lamp-row"><i class="battle-lamp"></i><b>${esc(outcome.label)}</b></div><strong>${esc(opponent.label)}</strong><p>${esc(opponent.detail)}</p></div>
        <div class="battle-result-module"><span>Confidence</span><strong>${esc(confidence)}</strong><p>${esc(result.explanation || 'Measured audio analysis was scored by deterministic rules.')}</p></div>
      </div>
      <div class="battle-status-strip">${distinctionRows}</div>
      <div class="battle-evidence-grid">
        <div class="battle-result-module"><span>Evidence</span><div class="battle-result-table" style="margin-top:10px">${timingRows}</div></div>
        <div class="battle-result-module"><span>Category breakdown</span><div class="battle-result-table" style="margin-top:10px">${breakdownRows}</div></div>
        <div class="battle-result-module"><span>Judge recommendations</span><ul class="battle-recommendations">${recommendations.slice(0,5).map(item=>`<li>${esc(item)}</li>`).join('')}</ul></div>
      </div>
      <div class="battle-progression-grid">
        <div class="battle-result-module"><span>XP earned</span><strong>+${esc(Number(progression.xp || 0))}</strong><p>${esc(progress.before.xp)} -> ${esc(progress.after.xp)}</p></div>
        <div class="battle-result-module"><span>Rating</span><strong>${Number(progression.ratingDelta || 0) >= 0 ? '+' : ''}${esc(Number(progression.ratingDelta || 0))}</strong><p>${esc(progress.before.rankingRating)} -> ${esc(progress.after.rankingRating)}</p></div>
        <div class="battle-result-module"><span>Ranking movement</span><strong>#${esc(progress.rankBefore)} -> #${esc(progress.rankAfter)}</strong><p>${progress.rankAfter < progress.rankBefore ? 'Moved up' : progress.rankAfter > progress.rankBefore ? 'Moved down' : 'No rank change'}</p></div>
        <div class="battle-result-module"><span>Belt progress</span><strong>${esc(progress.before.belt)} -> ${esc(progress.after.belt)}</strong><p>Next: ${esc(nextBeltForXp(progress.after.xp).name)}</p></div>
      </div>
      <div class="battle-reward-note">${esc(rewardResultText(result))}</div>
      ${duplicateNote}
      <div class="battle-result-module"><span>Submission playback</span>${playback}</div>
    </div>`;
  }
  document.getElementById('br-status').textContent = formatBattleStatus(battle.status);
}

function rewardFromSynchronizedResolution(session, resolution, self){
  if(resolution && resolution.bitcoinRewardMetadata){
    return {
      type:'bitcoin',
      metadata:{
        network:resolution.bitcoinRewardMetadata.network || 'bitcoin',
        amountSats:resolution.bitcoinRewardMetadata.amountSats,
        custody:resolution.bitcoinRewardMetadata.custody || 'external_pending',
        walletConnected:Boolean(resolution.bitcoinRewardMetadata.walletConnected),
        verifiedPaymentId:resolution.bitcoinRewardMetadata.verifiedPayment ? 'verified_payment_record' : null
      }
    };
  }
  return self && self.reward && self.reward.type ? self.reward : session && session.reward || { type:'xp', metadata:{} };
}

function synchronizedResolutionBattleLike(session, resolution, opponent){
  return {
    id:session.battleId || session.id,
    title:session.title || 'Battle',
    modeId:session.modeId,
    type:session.mode || session.type || 'Battle',
    genre:session.genre || 'Open Format',
    durationMinutes:session.duration || 10,
    opponentRequirement:'required',
    reward:rewardFromSynchronizedResolution(session, resolution, resolution && resolution.self),
    participants:[
      { userId:currentProfileUserId(), name:currentUser().displayName },
      { userId:'server-opponent', name:opponent && opponent.profile && opponent.profile.name || 'Opponent', country:opponent && opponent.profile && opponent.profile.country }
    ]
  };
}

function synchronizedResolutionResult(session, resolution){
  const self = resolution && (resolution.self || (resolution.participants || []).find(row => row.self));
  if(!self || self.score == null) return null;
  const opponent = (resolution.participants || []).find(row => !row.self) || null;
  return {
    resultKey:`${session.battleId || session.id}:${resolution.id}:${self.awardId || self.submissionId || 'award'}`,
    battleId:session.battleId || session.id,
    userId:currentProfileUserId(),
    submissionId:self.submissionId || session.submissionId || `${self.entryId || 'entry'}-submission`,
    score:self.score,
    won:self.outcome === 'winner' ? true : self.outcome === 'loser' ? false : null,
    opponentScore:self.opponentScore == null && opponent ? opponent.score : self.opponentScore,
    outcome:self.outcome,
    breakdown:self.breakdown || self.components || {},
    timing:[],
    rawMeasurements:[],
    recommendations:self.recommendations || [],
    confidence:self.confidence || null,
    measurableAnalysis:{ timingEvidenceCount:self.timingEvidenceCount },
    scoringModel:{ serverResolution:'server_competitive_battle_resolution' },
    evidenceType:self.evidenceType || 'server_competitive_battle_resolution',
    completedAt:resolution.resolvedAt || new Date().toISOString(),
    reward:rewardFromSynchronizedResolution(session, resolution, self),
    progression:self.progression || {}
  };
}

function renderSynchronizedBattleResolution(session, resolution){
  const panel = document.getElementById('br-judge-placeholder');
  if(!panel || !resolution) return null;
  if(!resolution.resolved){
    const status = resolution.status || 'waiting_for_submissions';
    const rows = (resolution.participants || []).map((participant, index) => {
      const label = participant.self ? 'You' : participant.profile && participant.profile.name || `Deck ${index + 1}`;
      const stateLabel = participant.completed ? 'Completed' : participant.submitted ? 'Submitted' : formatBattleStatus(participant.status || 'waiting');
      return `<div class="battle-result-module battle-${participant.completed ? 'ok' : participant.submitted ? 'warn' : 'muted'}"><div class="battle-lamp-row"><i class="battle-lamp"></i><b>${esc(label)}</b></div><strong>${esc(stateLabel)}</strong><p>Score hidden until every required judging result is complete.</p></div>`;
    }).join('');
    panel.innerHTML = `<div class="battle-result-surface battle-warn">
      <div class="battle-result-top">
        <div class="battle-score-lcd"><span>Resolution</span><strong>${esc(formatBattleStatus(status))}</strong><small>${esc(`${resolution.completedParticipants || 0}/${resolution.requiredParticipants || 2}`)}</small></div>
        <div class="battle-result-module"><span>Reveal lock</span><strong>Scores hidden</strong><p>Opponent scores, breakdowns, recommendations and evidence stay sealed until synchronized resolution.</p></div>
      </div>
      <div class="battle-status-strip">${rows}</div>
      ${resolution.reason ? `<div class="battle-reward-note">${esc(resolution.reason)}</div>` : ''}
    </div>`;
    return { pending:true };
  }

  const self = resolution.self || (resolution.participants || []).find(row => row.self);
  const opponent = (resolution.participants || []).find(row => !row.self) || null;
  const battle = synchronizedResolutionBattleLike(session, resolution, opponent);
  const result = synchronizedResolutionResult(session, resolution);
  const awardStatus = self && self.progression && self.progression.status || resolution.awardState && resolution.awardState.status || null;
  const progressionConfirmed = !awardStatus || awardStatus === 'applied';
  let progressionState = null;
  if(result && progressionConfirmed){
    progressionState = applyBattleProgression(result, battle);
    session.status = 'completed';
    session.result = result;
    session.completedAt = resolution.resolvedAt;
    session.resolutionId = resolution.id;
    session.resolutionVersion = resolution.version;
    const idx = battles.findIndex(item => String(item.id) === String(battle.id));
    if(idx >= 0) battles[idx] = { ...battles[idx], status:'completed', result, resolution, completedAt:resolution.resolvedAt };
    else battles.unshift({ ...battle, status:'completed', result, resolution, completedAt:resolution.resolvedAt });
    persistBattles();
    persistActiveBattleSession(session);
  }
  const progress = result ? progressionSnapshotForResult(battle, result, progressionState) : null;
  const serverProgress = self && self.progression || {};
  const xpBefore = serverProgress.xpBefore ?? (progress && progress.before.xp);
  const xpAfter = serverProgress.xpAfter ?? (progress && progress.after.xp);
  const ratingBefore = serverProgress.ratingBefore ?? (progress && progress.before.rankingRating);
  const ratingAfter = serverProgress.ratingAfter ?? (progress && progress.after.rankingRating);
  const beltBefore = serverProgress.beltBefore || progress && progress.before.belt;
  const beltAfter = serverProgress.beltAfter || progress && progress.after.belt;
  const rankBefore = serverProgress.rankingBefore || progress && progress.rankBefore;
  const rankAfter = serverProgress.rankingAfter || progress && progress.rankAfter;
  const duplicateNote = progressionState && progressionState.duplicate ? '<div class="battle-reward-note">This synchronized result was already applied. No duplicate XP, rating or belt award was recorded.</div>' : '';
  const awardNote = progressionConfirmed
    ? '<div class="battle-reward-note">Progression is server-confirmed by the award ledger.</div>'
    : `<div class="battle-reward-note">Progression status: ${esc(formatBattleStatus(awardStatus || 'pending'))}. XP, rating, belt and ranking movement are not final until the server ledger applies this award.</div>`;
  const participantPanels = (resolution.participants || []).map(participant => {
    const label = participant.self ? 'You' : participant.profile && participant.profile.name || 'Opponent';
    const source = (participant.scoringSource || []).join(' + ') || participant.evidenceType || 'rule-based';
    const rows = Object.entries(participant.breakdown || participant.components || {}).slice(0, 5).map(([key, value]) => `<div class="battle-result-row"><b>${esc(readableComponentName(key))}</b><em>${esc(componentDisplayValue(value))}</em></div>`).join('') || '<div class="battle-result-row"><b>Score evidence</b><em>Approved summary</em></div>';
    return `<div class="battle-result-module battle-${participant.outcome === 'winner' ? 'ok' : participant.outcome === 'tie' ? 'warn' : 'muted'}">
      <div class="battle-lamp-row"><i class="battle-lamp"></i><b>${esc(label)}</b></div>
      <div class="battle-score-lcd" style="margin:10px 0"><span>${esc(participant.outcome || 'result')}</span><strong>${esc(participant.score)}</strong><small>/100</small></div>
      <p>${esc(source)}</p>
      <div class="battle-result-table" style="margin-top:10px">${rows}</div>
    </div>`;
  }).join('');
  const recommendationRows = self && Array.isArray(self.recommendations) && self.recommendations.length
    ? `<ul class="battle-recommendations">${self.recommendations.slice(0,5).map(item => `<li>${esc(item)}</li>`).join('')}</ul>`
    : '<p style="color:var(--muted);margin:0">Private recommendations are available only when the server approved them for your own result.</p>';
  const bitcoin = resolution.bitcoinRewardMetadata
    ? `<div class="battle-reward-note">Bitcoin Battle metadata preserved (${esc(resolution.bitcoinRewardMetadata.amountSats || 'amount pending')} sats, ${esc(resolution.bitcoinRewardMetadata.custody || 'external_pending')}). Not transferred, paid or claimable without a verified payment record.</div>`
    : '';
  panel.innerHTML = `<div class="battle-result-surface">
    <div class="battle-result-top">
      <div class="battle-score-lcd"><span>Authoritative result</span><strong>${esc(formatBattleStatus(resolution.outcome))}</strong><small>v${esc(resolution.version || 0)}</small></div>
      <div class="battle-result-module"><span>Resolved at</span><strong>${esc(resolution.resolvedAt || 'Server')}</strong><p>${esc(resolution.scoringRule && resolution.scoringRule.type || 'highest_normalized_score')}</p></div>
      <div class="battle-result-module"><span>Score spread</span><strong>${esc(resolution.scoreDifference == null ? 'N/A' : resolution.scoreDifference)}</strong><p>Component evidence preserved; opponent private evidence remains sealed.</p></div>
    </div>
    <div class="battle-evidence-grid">${participantPanels}</div>
    <div class="battle-progression-grid">
      <div class="battle-result-module"><span>XP earned</span><strong>+${esc(Number(serverProgress.xp || 0))}</strong><p>${xpBefore != null && xpAfter != null ? `${esc(xpBefore)} -> ${esc(xpAfter)}` : 'Awaiting ledger'}</p></div>
      <div class="battle-result-module"><span>Rating</span><strong>${Number(serverProgress.ratingDelta || 0) >= 0 ? '+' : ''}${esc(Number(serverProgress.ratingDelta || 0))}</strong><p>${ratingBefore != null && ratingAfter != null ? `${esc(ratingBefore)} -> ${esc(ratingAfter)}` : 'Awaiting ledger'}</p></div>
      <div class="battle-result-module"><span>Ranking movement</span><strong>${rankBefore && rankAfter ? `#${esc(rankBefore)} -> #${esc(rankAfter)}` : 'Pending'}</strong><p>${rankBefore && rankAfter && rankAfter < rankBefore ? 'Moved up' : rankBefore && rankAfter && rankAfter > rankBefore ? 'Moved down' : progressionConfirmed ? 'No rank change' : 'Awaiting ledger'}</p></div>
      <div class="battle-result-module"><span>Belt progress</span><strong>${beltBefore && beltAfter ? `${esc(beltBefore)} -> ${esc(beltAfter)}` : 'Pending'}</strong><p>Award: ${esc(self && self.awardId || serverProgress.awardId || 'server')}</p></div>
    </div>
    <div class="battle-result-module"><span>Your judge recommendations</span>${recommendationRows}</div>
    ${awardNote}
    ${bitcoin}
    ${duplicateNote}
  </div>`;
  const status = document.getElementById('br-status');
  if(status) status.textContent = 'Completed';
  return { result, progressionState };
}

function completeBattleWithJudgeResult(session, judgeResult, submissionId){
  if(!session || !judgeResult) return null;
  const battleId = session.battleId || session.id;
  const idx = battles.findIndex(x=>String(x.id)===String(battleId));
  let battle = idx >= 0 ? battles[idx] : BattleModes.normalizeBattleRecord({ ...session, id:battleId, participants:session.participants || [] });
  if(battle.status === 'completed' && battle.result){
    session.status = 'completed';
    session.result = battle.result;
    const stored = state.battleResults.find(item => item.resultKey === `${battle.id}:${battle.result.submissionId}`);
    const progressionState = { applied:false, duplicate:true, before:stored && stored.progressBefore || cloneBattleProgressSnapshot(), after:stored && stored.progressAfter || cloneBattleProgressSnapshot() };
    renderCompletedBattleResult(battle, battle.result, { progressionState });
    return { battle, result:battle.result, duplicate:true, progressionState };
  }
  if(!BattleModes.buildBattleResultPayload) return { error:'Battle result payload support is unavailable.' };
  const now = new Date().toISOString();
  const judging = battle.status === 'judging' ? { battle } : BattleModes.markBattleJudging(battle, { now });
  if(judging.error) return judging;
  const payload = BattleModes.buildBattleResultPayload({
    battle: judging.battle,
    userId: currentProfileUserId(),
    submissionId: submissionId || session.submissionId,
    judgeResult,
    now
  });
  if(payload.error) return payload;
  if(payload.result.score == null) return { error:'Judging result did not include a score.' };
  const prepSnapshot = battlePrepSnapshotForUser(session) || battlePrepSnapshotForUser(judging.battle);
  if(prepSnapshot){
    payload.result.battlePrepSummary = battlePrepSummaryForHistory(prepSnapshot, 'private');
    payload.result.battleContext = {
      ...(payload.result.battleContext || {}),
      battlePrepSnapshot: safeBattlePrepSnapshotForSubmission(prepSnapshot),
      loadedLibraryTracks: activeSessionLoadedDeckContext(session)
    };
  }
  const completed = BattleModes.completeBattle(judging.battle, { result: payload.result, now });
  if(completed.error) return completed;
  battle = completed.battle;
  if(idx >= 0) battles[idx] = battle;
  else battles.unshift(battle);
  session.status = 'completed';
  session.result = battle.result;
  session.completedAt = battle.completedAt;
  persistBattles();
  persistActiveBattleSession(session);
  const progressionState = applyBattleProgression(battle.result, battle);
  renderCompletedBattleResult(battle, battle.result, { progressionState });
  renderBattles();
  return { battle, result:battle.result, progressionState };
}

function buildBattleSubmissionContext(session){
  if(!session) return null;
  const prepSnapshot = battlePrepSnapshotForUser(session);
  const ownEntry = (session.entries || {})[currentProfileUserId()] || {};
  return {
    battleId: session.battleId || session.id,
    battleEntryId: session.battleEntryId || ownEntry.serverBattleEntryId || ownEntry.battleEntryId || null,
    modeId: session.modeId,
    type: session.type || session.mode,
    genre: session.genre,
    title: session.title,
    durationMinutes: session.duration,
    reward: session.reward || null,
    battleVersion: session.battleVersion || null,
    battleEventId: session.eventId || null,
    serverStartedAt: session.startedAt || null,
    serverDeadlineAt: session.deadlineAt || null,
    battlePrepSnapshotId: prepSnapshot && (prepSnapshot.snapshotId || prepSnapshot.id) || session.battlePrepSnapshotId || ownEntry.battlePrepSnapshotId || null,
    battlePrepSnapshotVersion: prepSnapshot && prepSnapshot.snapshotVersion || session.battlePrepSnapshotVersion || ownEntry.battlePrepSnapshotVersion || null,
    battlePrepSnapshot: safeBattlePrepSnapshotForSubmission(prepSnapshot),
    loadedLibraryTracks: activeSessionLoadedDeckContext(session)
  };
}

async function completeFromJudgingEndpoint(session, submissionId, setUploadStatus, options={}){
  if(!submissionId || !window.DJBattleSubmission?.pollJudgingResult || !window.DJBattleApi?.apiRequest) return null;
  const response = await window.DJBattleSubmission.pollJudgingResult({
    apiRequest: window.DJBattleApi.apiRequest,
    submissionId,
    onStatus: setUploadStatus,
    attempts: options.attempts || 5,
    intervalMs: options.intervalMs || 2500
  });
  if(response.error){
    console.warn('pollJudgingResult failed', response.error);
    renderBattleResultProgress(session, 'failed', { submissionId, error:response.error });
    return response;
  }
  const judgeResult = normalizeJudgeResultFromResponse({ ...response, submissionId });
  if(!judgeResult){
    renderBattleResultProgress(session, response.data && response.data.status || 'uploaded', { submissionId, response });
    return response;
  }
  const completed = completeBattleWithJudgeResult(session, judgeResult, submissionId);
  if(completed && !completed.error) setUploadStatus && setUploadStatus('Completed');
  return completed || response;
}

async function savePracticeResult(entry){
  state.practiceHistory.unshift({
    title: entry.title,
    score: entry.score,
    date: entry.date || new Date().toLocaleDateString(),
    breakdown: entry.breakdown,
    type: entry.type || 'Practice',
    genre: entry.genre || 'Global'
  });
  localStorage.setItem('djBattlePracticeHistory', JSON.stringify(state.practiceHistory.slice(0,20)));
  renderAiLeaderboard();

  // If running in live mode, send the score to the backend and show any server notifications.
  if(LIVE_MODE){
    try{
      let djName = currentUser().displayName;
      try{
        const u = await supabase.auth.getUser(); if(u && u.data && u.data.user){ djName = (u.data.user.user_metadata && u.data.user.user_metadata.full_name) || u.data.user.email || djName; }
      }catch(e){}
      const payload = { djName, battleType: entry.type || 'Practice', genre: entry.genre || 'Global', score: Number(entry.score || 0), meta: { savedAt: Date.now() } };
      const resp = await submitScoreLive(payload);
      if(resp && !resp.error){
        if(resp.newHigh || resp.newPB){
          const noteParts = [];
          if(resp.newHigh) noteParts.push(`NEW HIGH SCORE — #${resp.rank} GLOBAL`);
          if(resp.newPB) noteParts.push(`NEW PERSONAL BEST — ${resp.best}`);
          openModal(`<span class="eyebrow accent">SAVED</span><h3>Practice result saved</h3><p style="color:var(--muted)">${noteParts.join('<br>')}</p><div class="notice"><strong>AI Score</strong><span>${payload.score}/180</span></div><div class="modal-actions"><button class="primary" value="cancel">Continue</button></div>`);
        }
        // refresh leaderboard
        renderAiLeaderboard();
      } else {
        console.warn('submitScoreLive failed', resp && resp.error);
        alert(resp && resp.error ? resp.error : 'Unable to save your score.');
      }
    }catch(err){ console.warn('savePracticeResult live submit failed', err); }
  }
}

function openPracticeMode(battleName='Practice Session', battleType='Practice', battleGenre='Global'){
  openModal(`<span class="eyebrow accent">AI PRACTICE</span><h3>No battle match found</h3><p style="color:var(--muted)">You can still get rated, save the result, and track progress over time.</p><div class="panel" style="margin-top:12px"><strong>Session</strong><p style="color:var(--muted)">${esc(battleName)}</p></div><div class="modal-actions"><button class="ghost" value="cancel">Close</button><button class="primary" type="button" id="get-ai-rating">Get AI Rating</button></div>`);
  setTimeout(()=>{
    const getBtn=document.getElementById('get-ai-rating'); if(!getBtn) return;
    getBtn.onclick=()=>{
      const score = generatePracticeScore();
      const result = `<span class="eyebrow accent">AI RATING</span><h3>${esc(battleName)}</h3><div class="score-breakdown">${score.breakdown.map(item=>`<div class="score-chip">${esc(item.label)} <strong>${item.score.toFixed(1)}/20</strong></div>`).join('')}<div class="score-chip" style="grid-column:1/-1;color:var(--accent)">TOTAL <strong style="color:var(--accent)">${score.total}/180</strong></div></div><div class="modal-actions"><button class="ghost" value="cancel">Close</button><button class="primary" type="button" id="save-practice-rating">Save Session</button></div>`;
      openModal(result);
      setTimeout(()=>{
        const saveBtn=document.getElementById('save-practice-rating'); if(!saveBtn) return; saveBtn.onclick=()=>{
          const prevBest = (() => {
            const rows = getAiHighScoreRows();
            const me = rows.find(row => isCurrentUserName(row.dj));
            return me ? me.best : 0;
          })();

          const saved = {
            title: battleName,
            score: score.total,
            date: new Date().toLocaleDateString(),
            breakdown: score.breakdown,
            type: battleType,
            genre: battleGenre
          };

          savePracticeResult(saved);
          const rows = getAiHighScoreRows();
          const me = rows.find(row => isCurrentUserName(row.dj)) || {best:0, rank:999};
          const rankText = me.rank ? `#${me.rank} GLOBAL` : 'GLOBAL';
          const personalText = prevBest ? `PERSONAL BEST — ${prevBest} → ${me.best}` : `NEW PERSONAL BEST — ${me.best}`;
          const message = me.best > prevBest ? `NEW HIGH SCORE — ${rankText}<br>${personalText}` : `NEW PERSONAL BEST — ${me.best}`;

          openModal(`<span class="eyebrow accent">SAVED</span><h3>Practice result saved</h3><p style="color:var(--muted)">${message}</p><div class="notice"><strong>AI Score</strong><span>${score.total}/180</span></div><div class="modal-actions"><button class="primary" value="cancel">Continue</button></div>`);
        };
      },0);
    };
  },0);
}

function openBattle(id){
  const b=battles.find(x=>x.id===id); if(!b) return;
  // If battle requires stems and user is not premium, show premium modal
  if(b.stems && !state.premium){ openPremium(`“${b.title}” is stem-enabled. Premium unlocks stem battles and AI stem separation.`); return; }
  const stemsAllowed = Boolean(b.stems || state.premium);
  const selectedLength = parseMinutes(b.time);
  const lengthOptions = [10, 20, 30, 60];
  openModal(`<span class="eyebrow accent">READY TO ENTER</span><h3>${b.title}</h3><p>${b.desc}</p><div class="form-grid"><label>Mode<select id="enter-mode"><option value="Standard Battle">Standard Battle</option><option value="Scratch Battle">Scratch Battle</option><option value="Own Selection (Premium)">Own Selection (Premium)</option></select></label><label>Genre<select id="enter-genre">${GENRES.map(g=>`<option value="${g}" ${g===b.genre?'selected':''}>${g}</option>`).join('')}</select></label><label>Battle length<select id="enter-length">${lengthOptions.map(minutes=>`<option value="${minutes}" ${minutes===selectedLength?'selected':''}>${minutes} minutes</option>`).join('')}</select></label><label class="toggle-row">Allow stems <input type="checkbox" id="enter-stems" ${stemsAllowed?'':'disabled'} ${b.stems||state.premium?'checked':''}></label></div><div class="modal-actions"><button class="ghost" value="cancel">Cancel</button><button class="primary" type="button" id="find-opponent">Find Opponent</button><button class="ghost" type="button" id="practice-only">Solo AI Rating</button></div>`);

  setTimeout(()=>{
    const findBtn=document.getElementById('find-opponent'); if(findBtn) findBtn.onclick=()=>{
      const chosenGenre=document.getElementById('enter-genre').value;
      const wantStems=document.getElementById('enter-stems').checked;
      const chosenMode=document.getElementById('enter-mode').value;
      const chosenLength=Number(document.getElementById('enter-length').value||10);
      openModal(`<span class="eyebrow accent">MATCHING</span><h3>Finding compatible DJs...</h3><p style="color:var(--muted)">Genre: ${chosenGenre} • Mode: ${chosenMode} • Length: ${chosenLength}m</p><div class="panel" style="margin-top:12px;text-align:center;color:var(--muted)">Searching…</div>`);
      setTimeout(()=>{
        const noOpponent = Math.random() < 0.35;
        const numMatch=(String(b.tracks).match(/(\d+)/)||[])[0];
        const num = numMatch? Number(numMatch) : (b.type&&b.type.includes('5')?5:2);
        let assigned=[];
        if((b.selection && b.selection.toLowerCase().includes('assigned')) || (b.tracks && b.tracks.toLowerCase().includes('assigned'))){
          assigned = assignTracksForBattle(b,num);
        } else if((b.selection && b.selection.toLowerCase().includes('dj')) || (b.tracks && b.tracks.toLowerCase().includes('own'))){
          if(state.library.length>0) assigned = [state.library[Math.floor(Math.random()*state.library.length)].name+' (use your selection)'];
          else assigned = ['Your selection — choose from My Music'];
        } else {
          assigned = assignTracksForBattle(b,num);
        }
        if(noOpponent){
          // Solo AI Rating fallback
          document.getElementById('modal').close();
          startBattleSession({ id: Date.now(), title: b.title, type: b.type }, { mode: chosenMode, genre: chosenGenre, duration: chosenLength, opponent: null, assigned });
          return;
        }
        // mock opponent
        const opponent = { name: 'Rival DJ', country: 'US', belt: 'Blue', record: '21-4' };
        document.getElementById('modal-content').innerHTML = `<span class="eyebrow accent">ASSIGNED</span><h3>Your Assigned Tracks</h3><p style="color:var(--muted)">${esc(b.desc)}</p><div class="panel" style="margin-top:12px">${assigned.map(a=>`<div style="padding:8px 0;border-bottom:1px solid #1f2730">♫ <strong>${esc(a)}</strong></div>`).join('')}</div><div class="notice" style="margin-top:12px"><strong>Match found</strong><span>Opponent: ${opponent.name} • ${opponent.country} • ${opponent.belt}</span></div><div class="modal-actions" style="margin-top:12px"><button class="ghost" value="cancel">Cancel</button><button class="primary" type="button" id="enter-battle-now">Enter Battle Room</button></div>`;
        setTimeout(()=>{const eb=document.getElementById('enter-battle-now'); if(eb) eb.onclick=()=>{document.getElementById('modal').close(); startBattleSession({ id: Date.now(), title: b.title, type: b.type }, { mode: chosenMode, genre: chosenGenre, duration: chosenLength, opponent, assigned }); };},200);
      },900);
    };

    const practiceBtn=document.getElementById('practice-only'); if(practiceBtn) practiceBtn.onclick=()=>{ const chosenMode = document.getElementById('enter-mode')?.value || 'Solo'; const chosenGenre = document.getElementById('enter-genre')?.value || b.genre; const chosenLength = Number(document.getElementById('enter-length')?.value||10); document.getElementById('modal').close(); startBattleSession({ id: Date.now(), title: b.title, type: b.type }, { mode: 'Solo AI Rating', genre: chosenGenre, duration: chosenLength, opponent: null, assigned: [] }); };
  },0);
}

function openBattleLifecycle(id){
  const b=battles.find(x=>String(x.id)===String(id)); if(!b) return;
  if(b.premiumRequired && !state.premium){ openPremium(`"${b.title}" requires Premium for this battle mode.`); return; }
  if(b.serverBacked && !['open','waiting'].includes(String(b.lobbyStatus || b.status || 'open')) && !battlePrepSnapshotForUser(b)){
    openModal(`<span class="eyebrow accent">BATTLE ${esc(String(b.lobbyStatus || b.status || '').toUpperCase())}</span><h3>${esc(b.title)}</h3><p style="color:var(--muted)">This server-backed battle is no longer joinable. Refreshing the lobby will show current open slots.</p><div class="modal-actions"><button class="ghost" value="cancel">Close</button><button class="primary" type="button" id="refresh-lobby-now">Refresh Lobby</button></div>`);
    setTimeout(()=>{ const btn=document.getElementById('refresh-lobby-now'); if(btn) btn.onclick=()=>loadServerBattleLobby().catch(()=>{}); },0);
    return;
  }
  const mode = BattleModes.getBattleMode(b.modeId || b.type);
  const selectedLength = b.durationMinutes || parseMinutes(b.time);
  const lengthOptions = mode ? mode.allowedDurations : [10, 20, 30, 60];
  const modeOptions = BattleModes.listBattleModes().map(m=>`<option value="${m.id}" ${m.id===b.modeId?'selected':''}>${esc(m.label)}${m.premiumRequired?' (Premium)':''}</option>`).join('');
  const rules = BattleModes.buildBattleRules(b);
  openModal(`<span class="eyebrow accent">READY TO ENTER</span><h3>${esc(b.title)}</h3><p>${esc(b.desc)}</p><div class="form-grid"><label>Mode<select id="enter-mode">${modeOptions}</select></label><label>Genre<select id="enter-genre">${GENRES.map(g=>`<option value="${g}" ${g===b.genre?'selected':''}>${g}</option>`).join('')}</select></label><label>Battle length<select id="enter-length">${lengthOptions.map(minutes=>`<option value="${minutes}" ${minutes===selectedLength?'selected':''}>${minutes} minutes</option>`).join('')}</select></label><label>Visibility<input value="${esc(b.visibility || 'public')}" readonly></label><label>Battle Prep crate<select id="enter-prep-crate">${battlePrepCrateSelectHtml()}</select></label></div><div class="notice"><strong>Rules</strong><span>${esc(rules.trackSelectionMethod)} | ${esc(rules.opponentRequirement)} opponent | ${esc((rules.reward && rules.reward.type) || 'standard')} reward</span></div><div id="enter-prep-status" class="battle-prep-entry-status">${battlePrepEntryValidationHtml(null)}</div><div id="enter-battle-error" style="color:#ff8f8f;margin-top:10px"></div><div class="modal-actions"><button class="ghost" value="cancel">Cancel</button><button class="primary" type="button" id="find-opponent">Join Battle</button><button class="ghost" type="button" id="practice-only">Solo AI Rating</button></div>`);
  setTimeout(()=>{
    const renderEnterPrepValidation=()=>{
      const chosenGenre=document.getElementById('enter-genre')?.value || b.genre;
      const chosenModeId=document.getElementById('enter-mode')?.value || b.modeId;
      const chosenLength=Number(document.getElementById('enter-length')?.value||selectedLength||10);
      const updated = BattleModes.normalizeBattleRecord({...b, modeId: chosenModeId, genre: chosenGenre, durationMinutes: chosenLength});
      const selectedCrate = document.getElementById('enter-prep-crate')?.value || '';
      const validation = validateBattlePrepCrateForBattle(selectedCrate, updated);
      const target = document.getElementById('enter-prep-status');
      if(target) target.innerHTML = battlePrepEntryValidationHtml(validation);
      return validation;
    };
    ['enter-mode','enter-genre','enter-length','enter-prep-crate'].forEach(id=>{
      const el=document.getElementById(id);
      if(el) el.onchange=renderEnterPrepValidation;
    });
    renderEnterPrepValidation();
    const findBtn=document.getElementById('find-opponent'); if(findBtn) findBtn.onclick=()=>joinBattleFromModal(b);
    const practiceBtn=document.getElementById('practice-only'); if(practiceBtn) practiceBtn.onclick=()=>startAiPracticeFromModal(b);
  },0);
}

async function joinBattleFromModal(b){
  const chosenGenre=document.getElementById('enter-genre').value;
  const chosenModeId=document.getElementById('enter-mode').value;
  const chosenLength=Number(document.getElementById('enter-length').value||10);
  const updated = BattleModes.normalizeBattleRecord({...b, modeId: chosenModeId, genre: chosenGenre, durationMinutes: chosenLength});
  const selectedCrate = document.getElementById('enter-prep-crate')?.value || '';
  const validation = validateBattlePrepCrateForBattle(selectedCrate, updated);
  const err = document.getElementById('enter-battle-error');
  if(selectedCrate && !validation.ready){ if(err) err.textContent = validation.blockers.join(' '); return; }
  if(updated.serverBacked){
    const statusValue = String(updated.lobbyStatus || updated.status || 'open');
    if(!['open','waiting'].includes(statusValue) && !battlePrepSnapshotForUser(updated)){
      if(err) err.textContent = `This battle is ${statusValue.replace('_',' ')} and cannot accept another entry.`;
      return;
    }
    if(!battlePrepServerApiAvailable()){
      if(err) err.textContent = 'Sign in and sync your Battle Prep crate before joining a server-backed battle.';
      return;
    }
    if(selectedCrate && !serverBackedBattlePrepCrate(selectedCrate)){
      if(err) err.textContent = 'Choose a synced Battle Prep crate before joining this server-backed battle.';
      return;
    }
    if(!selectedCrate && validation && !validation.optional){
      if(err) err.textContent = 'A synced Battle Prep crate is required for this battle mode.';
      return;
    }
    if(err) err.textContent = 'Requesting server battle entry...';
    const serverResult = await joinAuthenticatedBattleWithPrepSnapshot(updated, selectedCrate, validation);
    if(serverResult.skipped){
      if(err) err.textContent = 'Server battle join is unavailable; no local entry was created.';
      return;
    }
    if(serverResult.error){
      if(serverResult.response && serverResult.response.status === 409) loadServerBattleLobby({ render:false }).then(()=>renderBattles()).catch(()=>{});
      if(err) err.textContent = serverResult.error;
      return;
    }
    const serverBattle = serverResult.battle || {};
    const localBase = BattleModes.normalizeBattleRecord({ ...updated, status:'open' });
    const joined = BattleModes.joinBattle(localBase, { userId: currentProfileUserId(), name: currentUser().displayName }, { now: new Date().toISOString() });
    let joinedBattle = joined.battle || localBase;
    joinedBattle = { ...joinedBattle, status:serverBattle.status || joinedBattle.status, lobbyStatus:serverBattle.status || updated.lobbyStatus || joinedBattle.status, serverBacked:true };
    if(serverResult.snapshot) joinedBattle = attachBattlePrepSnapshotToBattle(joinedBattle, serverResult.snapshot, currentProfileUserId(), serverResult.entry);
    const assigned = resolveBattleTracks(joinedBattle);
    const prepared = BattleModes.prepareBattle(joinedBattle, { userId: currentProfileUserId(), assignedTracks: assigned, now: new Date().toISOString() });
    const preparedBattle = prepared.battle || joinedBattle;
    const idx = battles.findIndex(x=>String(x.id)===String(b.id));
    if(idx >= 0) battles[idx] = preparedBattle;
    persistBattles();
    renderBattles();
    const creator = updated.creatorPublicProfile || {};
    const opponent = creator.name ? { name:creator.name, country:creator.country || '', belt:creator.belt || '', record:creator.rating ? String(creator.rating) : '' } : null;
    const tracksHtml = assigned.length ? assigned.map(a=>`<div style="padding:8px 0;border-bottom:1px solid #1f2730">â™« <strong>${esc(a)}</strong></div>`).join('') : '<div style="color:var(--muted)">Own-selection battle: use the validated server Battle Prep snapshot.</div>';
    document.getElementById('modal-content').innerHTML = `<span class="eyebrow accent">SERVER ENTRY READY</span><h3>${esc(preparedBattle.title)}</h3><p style="color:var(--muted)">Battle entry and immutable prep snapshot are stored server-side.</p><div class="panel" style="margin-top:12px">${tracksHtml}</div><div class="notice" style="margin-top:12px"><strong>${opponent ? 'Opponent visible' : 'Waiting room'}</strong><span>${opponent ? `Creator: ${esc(opponent.name)} | ${esc(opponent.country)} | ${esc(opponent.belt)}` : 'No private opponent prep data is shared.'}</span></div><div class="modal-actions" style="margin-top:12px"><button class="ghost" value="cancel">Cancel</button><button class="primary" type="button" id="enter-battle-now">Enter Battle Room</button><button class="ghost" type="button" id="open-studio-now">Open Studio</button></div>`;
    setTimeout(()=>{
      const eb=document.getElementById('enter-battle-now'); if(eb) eb.onclick=()=>{document.getElementById('modal').close(); startBattleSession(preparedBattle, { opponent, assigned }); };
      const os=document.getElementById('open-studio-now'); if(os) os.onclick=()=>{document.getElementById('modal').close(); startBattleSession(preparedBattle, { opponent, assigned, view:'studio' }); };
    },0);
    return;
  }
  let joined = BattleModes.joinBattle(updated, { userId: currentProfileUserId(), name: currentUser().displayName }, { now: new Date().toISOString() });
  if(joined.error && joined.code !== 'duplicate_entry') return alert(joined.error);
  let joinedBattle = joined.battle || updated;
  let opponent = null;
  if(joinedBattle.opponentRequirement === 'required' && !(joined.error && joined.code === 'duplicate_entry')){
    const rivalId = `local-opponent-${joinedBattle.id}`;
    const rivalJoin = BattleModes.joinBattle(joinedBattle, { userId: rivalId, name:'Rival DJ' }, { now: new Date().toISOString() });
    joinedBattle = rivalJoin.battle || joinedBattle;
    opponent = { userId: rivalId, name:'Rival DJ', country:'US', belt:'Blue', record:'21-4' };
  } else {
    const existingOpponent = (joinedBattle.participants || []).find(p=>p.userId !== currentProfileUserId());
    if(existingOpponent) opponent = { userId: existingOpponent.userId, name: existingOpponent.name || 'Rival DJ', country:'US', belt:'Blue', record:'21-4' };
  }
  const assigned = resolveBattleTracks(joinedBattle);
  const prepared = BattleModes.prepareBattle(joinedBattle, { userId: currentProfileUserId(), assignedTracks: assigned, now: new Date().toISOString() });
  if(prepared.error) return alert(prepared.error);
  if(selectedCrate && validation.ready){
    if(battlePrepServerApiAvailable() && serverBackedBattlePrepCrate(selectedCrate)){
      if(err) err.textContent = 'Syncing Battle Prep snapshot...';
      const serverResult = await joinAuthenticatedBattleWithPrepSnapshot(prepared.battle, selectedCrate, validation);
      if(serverResult.error){ if(err) err.textContent = serverResult.error; return; }
      if(serverResult.snapshot){
        prepared.battle = attachBattlePrepSnapshotToBattle(prepared.battle, serverResult.snapshot, currentProfileUserId(), serverResult.entry);
      }
    } else {
      const snapshot = buildBattlePrepEntrySnapshot(selectedCrate, prepared.battle, validation, currentProfileUserId());
      prepared.battle = attachBattlePrepSnapshotToBattle(prepared.battle, snapshot, currentProfileUserId());
    }
  }
  const idx = battles.findIndex(x=>String(x.id)===String(b.id));
  if(idx >= 0) battles[idx] = prepared.battle;
  persistBattles();
  renderBattles();
  const tracksHtml = assigned.length ? assigned.map(a=>`<div style="padding:8px 0;border-bottom:1px solid #1f2730">♫ <strong>${esc(a)}</strong></div>`).join('') : '<div style="color:var(--muted)">Own-selection battle: choose eligible tracks from My Music.</div>';
  document.getElementById('modal-content').innerHTML = `<span class="eyebrow accent">READY</span><h3>${esc(prepared.battle.title)}</h3><p style="color:var(--muted)">${esc(prepared.battle.desc)}</p><div class="panel" style="margin-top:12px">${tracksHtml}</div><div class="notice" style="margin-top:12px"><strong>${opponent ? 'Match ready' : 'Solo practice ready'}</strong><span>${opponent ? `Opponent: ${esc(opponent.name)} | ${esc(opponent.country)} | ${esc(opponent.belt)}` : 'No opponent required for this mode.'}</span></div><div class="modal-actions" style="margin-top:12px"><button class="ghost" value="cancel">Cancel</button><button class="primary" type="button" id="enter-battle-now">Enter Battle Room</button><button class="ghost" type="button" id="open-studio-now">Open Studio</button></div>`;
  setTimeout(()=>{
    const eb=document.getElementById('enter-battle-now'); if(eb) eb.onclick=()=>{document.getElementById('modal').close(); startBattleSession(prepared.battle, { opponent, assigned }); };
    const os=document.getElementById('open-studio-now'); if(os) os.onclick=()=>{document.getElementById('modal').close(); startBattleSession(prepared.battle, { opponent, assigned, view:'studio' }); };
  },0);
}

function startAiPracticeFromModal(b){
  const chosenGenre = document.getElementById('enter-genre')?.value || b.genre;
  const chosenLength = Number(document.getElementById('enter-length')?.value||10);
  const practice = BattleModes.createBattleRecord({ modeId:'ai_only_practice', genre: chosenGenre, durationMinutes: chosenLength, title:`${chosenGenre} AI Practice`, createdBy:currentProfileUserId(), status:'ready', visibility:'private' });
  if(practice.error) return alert(practice.error.map(item=>item.message).join(' '));
  const joined = BattleModes.joinBattle(practice.battle, { userId: currentProfileUserId(), name: currentUser().displayName }, { now: new Date().toISOString() });
  const selectedCrate = document.getElementById('enter-prep-crate')?.value || '';
  let battle = joined.battle || practice.battle;
  if(selectedCrate){
    const validation = validateBattlePrepCrateForBattle(selectedCrate, battle);
    if(!validation.ready){
      const err = document.getElementById('enter-battle-error');
      if(err) err.textContent = validation.blockers.join(' ');
      return;
    }
    const snapshot = buildBattlePrepEntrySnapshot(selectedCrate, battle, validation, currentProfileUserId());
    battle = attachBattlePrepSnapshotToBattle(battle, snapshot, currentProfileUserId());
  }
  document.getElementById('modal').close();
  startBattleSession(battle, { mode:'AI-Only Practice/High-Score Mode', genre: chosenGenre, duration: chosenLength, opponent:null, assigned:[] });
}

function resolveBattleTracks(b){
  if(b.assignedTracks && b.assignedTracks.length) return b.assignedTracks;
  if(['own_selection','ai_practice','open_library'].includes(b.trackSelectionMethod)) return [];
  return assignTracksForBattle(b, b.trackCount || 2);
}

const genreFilterEl = document.getElementById('genre-filter');
if(genreFilterEl){
  genreFilterEl.addEventListener('click', e => {
    if(e.target.tagName !== 'BUTTON') return;
    [...e.currentTarget.children].forEach(x=>x.classList.remove('active'));
    e.target.classList.add('active');
    renderBattles(e.target.dataset.genre || 'All');
  });
}
const battleFormatFilterEl = document.getElementById('battle-format-filter');
if(battleFormatFilterEl){
  battleFormatFilterEl.addEventListener('click', e => {
    const button = e.target.closest('button[data-battle-format]');
    if(!button) return;
    [...battleFormatFilterEl.querySelectorAll('button')].forEach(item=>item.classList.toggle('active', item === button));
    state.battleFormatFilter = button.dataset.battleFormat || 'all';
    const activeGenre = document.querySelector('#genre-filter .active')?.dataset.genre || 'All';
    renderBattles(activeGenre);
  });
}

const TOUR_STEPS = [
  { view:'battles', title:'Battles', copy:'Battles is the competition lobby. Browse open events and return here while a table fills.', target:'#nav [data-view="battles"]' },
  { view:'battles', title:'Find a Battle', copy:'Browse live battle listings, then narrow the lobby by format, genre, duration, entry type, or search.', target:'#battle-grid' },
  { view:'battles', title:'Join a Seat', copy:'Join an available seat here. The server keeps the participant roster authoritative and locks it when capacity is reached.', target:'#battle-grid [data-enter]:not([disabled])', fallback:'#battle-grid' },
  { view:'studio', title:'Battle Studio', copy:'Battle Studio is the optional performance room. Both decks stay visible while you prepare and record.', target:'#studio .professional-studio-grid' },
  { view:'studio', title:'Two Deck Performance', copy:'Deck A and Deck B are always available together on desktop, with track data, waveform, transport, cue, loop, and pitch controls.', target:'#studio [data-deck="a"]' },
  { view:'studio', title:'Mixer and Master', copy:'Use the channel strips, EQ, faders, crossfader, meters, and master controls to shape the transition.', target:'#studio .professional-mixer' },
  { view:'studio', title:'Music Sources', copy:'Load local files, browse your library, playlists, and permitted streaming metadata without leaving the performance room.', target:'#studio .studio-browser-panel' },
  { view:'studio', title:'Hardware and Recording', copy:'Connect supported MIDI hardware, select audio input, arm recording, then review and submit the resulting battle take.', target:'#studio-recording-panel', fallback:'#controller-panel' },
  { view:'library', title:'Music Library', copy:'Manage uploaded tracks, artwork, crates, playlists, BPM, key, and compatible selections here.', target:'#library' },
  { view:'community', title:'Community', copy:'Use Community to publish posts, discuss music, and discover activity around the platform.', target:'#community' },
  { view:'rankings', title:'Rankings', copy:'Rankings show authoritative competition progress, categories, filtering, and movement history.', target:'#rankings' },
  { view:'profile', title:'Profile and Results', copy:'Profile holds your public identity and progression. Verified Results keeps approved public battle outcomes separate from private evidence.', target:'#profile' }
];
let activeTourStep = Number(localStorage.getItem('djBattleTourStep') || 0);
let activeTourTarget = null;

function clearGuidedTourTarget(){
  if(activeTourTarget) activeTourTarget.classList.remove('guided-tour-target');
  activeTourTarget = null;
}

function closeGuidedTour(options = {}){
  clearGuidedTourTarget();
  document.getElementById('guided-tour-overlay')?.remove();
  if(options.complete) localStorage.setItem('djBattleTourComplete', '1');
  if(options.view) switchView(options.view);
}

function guidedTourTarget(step){
  return document.querySelector(step.target) || (step.fallback ? document.querySelector(step.fallback) : null) || document.querySelector(`#${step.view} .product-page-head, #${step.view} h2, #${step.view}`);
}

function renderGuidedTour(){
  activeTourStep = Math.max(0, Math.min(TOUR_STEPS.length - 1, activeTourStep));
  localStorage.setItem('djBattleTourStep', String(activeTourStep));
  const step = TOUR_STEPS[activeTourStep];
  clearGuidedTourTarget();
  const overlay = document.getElementById('guided-tour-overlay') || document.body.appendChild(document.createElement('div'));
  overlay.id = 'guided-tour-overlay';
  overlay.className = 'guided-tour-overlay';
  overlay.innerHTML = `<div class="guided-tour-backdrop"></div><section class="guided-tour-card" role="dialog" aria-modal="true" aria-label="Guided product tour"><span class="eyebrow accent">GUIDED TOUR</span><strong class="guided-tour-progress">${activeTourStep + 1} of ${TOUR_STEPS.length}</strong><h3>${esc(step.title)}</h3><p>${esc(step.copy)}</p><div class="guided-tour-actions"><button class="ghost small" id="guided-tour-exit" type="button">Exit</button><button class="ghost small" id="guided-tour-skip" type="button">Skip Tour</button><button class="ghost small" id="guided-tour-back" type="button" ${activeTourStep === 0 ? 'disabled' : ''}>Back</button><button class="primary small" id="guided-tour-next" type="button">${activeTourStep === TOUR_STEPS.length - 1 ? 'Finish' : 'Next'}</button></div></section>`;
  document.getElementById('guided-tour-exit').onclick = () => closeGuidedTour({ view:step.view });
  document.getElementById('guided-tour-skip').onclick = () => closeGuidedTour({ complete:true, view:'battles' });
  document.getElementById('guided-tour-back').onclick = () => { activeTourStep -= 1; startGuidedTour(); };
  document.getElementById('guided-tour-next').onclick = () => {
    if(activeTourStep >= TOUR_STEPS.length - 1) return closeGuidedTour({ complete:true, view:'battles' });
    activeTourStep += 1;
    startGuidedTour();
  };
  requestAnimationFrame(()=>{
    const target = guidedTourTarget(step);
    if(!target) return;
    activeTourTarget = target;
    target.classList.add('guided-tour-target');
    if(typeof target.scrollIntoView === 'function') target.scrollIntoView({ behavior:'smooth', block:'center', inline:'nearest' });
  });
}

function startGuidedTour(){
  const step = TOUR_STEPS[Math.max(0, Math.min(TOUR_STEPS.length - 1, activeTourStep))];
  if(!switchView(step.view)) return false;
  renderGuidedTour();
  return true;
}

function renderVirtualTour(){
  const replay = document.getElementById('replay-tour');
  if(replay) replay.onclick = () => { activeTourStep = 0; startGuidedTour(); };
  startGuidedTour();
}

function activityItem(label, title, detail, actionView){
  return `<article class="activity-row"><span>${esc(label)}</span><div><strong>${esc(title)}</strong><small>${esc(detail)}</small></div>${actionView ? `<button class="ghost small" data-view-target="${esc(actionView)}" type="button">Open</button>` : ''}</article>`;
}
function renderActivityPage(){
  const target = document.getElementById('activity-feed');
  if(!target) return;
  const notifications = (state.djNotifications.rows || []).slice(0,4).map(row => activityItem('Alert', row.title || row.type || 'Notification', row.body || row.createdAt || 'Unread platform activity', 'activity'));
  const battleRows = battles.slice(0,5).map(battle => activityItem('Battle', battle.title || 'Battle', `${battleModeDisplayLabel(battle.modeId, battle.type)} / ${battle.genre || 'Open Format'} / ${formatBattleStatus(battle.status || battle.lobbyStatus || 'open')}`, 'battles'));
  const posts = (state.community.posts && state.community.posts.length ? state.community.posts : localCommunityPosts()).slice(0,5).map(post => activityItem('Community', post.title || 'Post', `${post.authorName || post.user || 'DJ'} / ${post.categoryLabel || post.room || 'Feed'}`, 'community'));
  const challenges = (state.djChallenges.rows || []).slice(0,4).map(row => activityItem('Challenge', row.title || 'Battle challenge', row.status || 'Pending', 'profile'));
  target.innerHTML = [...notifications, ...challenges, ...battleRows, ...posts].join('') || '<div class="panel"><strong>No activity yet.</strong><p>Battle entries, follows, challenges, results and community interactions will appear here.</p></div>';
  target.querySelectorAll('[data-view-target]').forEach(button=>button.onclick=()=>switchView(button.dataset.viewTarget));
  const refresh = document.getElementById('activity-refresh');
  if(refresh) refresh.onclick = () => {
    loadDjNotifications({ preserve:true }).catch(()=>{});
    loadDjChallengeInbox({ preserve:true }).catch(()=>{});
    loadDjActivityFeed().catch(()=>{});
    renderActivityPage();
  };
}

function renderSettingsPage(){
  const replay = document.querySelector('#settings [data-view-target="tour"]');
  if(replay) replay.onclick = () => { activeTourStep = 0; startGuidedTour(); };
}

const aiFilterButtons=document.querySelectorAll('[data-ai-filter]');
aiFilterButtons.forEach(btn=>btn.addEventListener('click',()=>{
  aiFilterButtons.forEach(b=>b.classList.toggle('active',b===btn));
  renderAiLeaderboard(btn.dataset.aiFilter);
}));

function renderPosts(){const html=state.posts.map(p=>`<article class="forum-post"><div class="post-head"><div class="avatar">${esc(p.initials)}</div><div><strong>${esc(p.user)}</strong><span>${esc(p.room)} • ${esc(p.time)}</span></div></div><h4>${esc(p.title)}</h4><p>${esc(p.body)}</p>${p.media?`<div class="audio-embed"><button>▶</button><div><strong>${esc(p.media)}</strong><small style="display:block;color:#7f8997">Attached from profile library</small></div><div class="bars"></div></div>`:''}<div class="post-foot"><span>♡ ${p.likes}</span><span>💬 ${p.comments}</span><span>↗ Share</span></div></article>`).join('');document.getElementById('forum-feed').innerHTML=html;document.getElementById('latest-posts').innerHTML=state.posts.slice(0,3).map(p=>`<div class="feed-item"><div class="mini-art">♫</div><div><strong>${esc(p.title)}</strong><p>${esc(p.user)} • ${esc(p.room)}</p></div></div>`).join('');}

document.getElementById('new-post').onclick=()=>{const options=state.library.map((t,i)=>`<option value="${i}">${esc(t.name)}</option>`).join('');openModal(`<span class="eyebrow accent">COMMUNITY</span><h3>Create Post</h3><div class="form-grid"><label>Room<select id="post-room"><option>General DJ Talk</option><option>Transitions</option><option>Scratching</option><option>Track Feedback</option><option>Production</option><option>Promo Feed</option></select></label><label>Title<input id="post-title" placeholder="What are you sharing?"></label><label>Post<textarea id="post-body" placeholder="Tell the community about it..."></textarea></label><label>Attach from My Music<select id="post-media"><option value="">No attachment</option>${options}</select></label></div><div class="modal-actions"><button class="ghost" value="cancel">Cancel</button><button class="primary" type="button" id="publish-post">Publish</button></div>`);setTimeout(()=>document.getElementById('publish-post').onclick=()=>{const mediaIdx=document.getElementById('post-media').value;state.posts.unshift({user:currentUser().displayName,initials:currentUser().initials,userId:currentUser().id,room:document.getElementById('post-room').value,time:'now',title:document.getElementById('post-title').value||'New post',body:document.getElementById('post-body').value||'',media:mediaIdx!==''?state.library[Number(mediaIdx)]?.name:null,likes:0,comments:0});persist();renderPosts();document.getElementById('modal').close();},0)};

const COMMUNITY_DEFAULT_CATEGORIES = [
  { id:'general', label:'General DJ Discussion' },
  { id:'battle_talk', label:'Battle Talk' },
  { id:'production', label:'Production' },
  { id:'gear', label:'Gear' },
  { id:'events', label:'Events' },
  { id:'hip_hop', label:'Hip-Hop' },
  { id:'house', label:'House' },
  { id:'scratch', label:'Scratching' },
  { id:'open_format', label:'Open Format' }
];
const COMMUNITY_REACTIONS = [
  { type:'like', label:'Like' },
  { type:'fire', label:'Fire' },
  { type:'respect', label:'Respect' },
  { type:'technique', label:'Technique' }
];

function communityApiAvailable(){
  return Boolean(window.DJBattleApi && typeof window.DJBattleApi.apiRequest === 'function');
}

function communityAccountId(){
  return state.musicLibrarySync && state.musicLibrarySync.accountId || '';
}

function communityServerMode(){
  return Boolean(communityApiAvailable() && communityAccountId());
}

function clearCommunityState(){
  const nextSeq = Number(state.community && state.community.requestSeq || 0) + 1;
  state.community = {
    status:'idle',
    source:'local',
    stale:false,
    error:'',
    requestSeq:nextSeq,
    feed:'recent',
    category:'all',
    page:1,
    pageSize:20,
    posts:[],
    categories:[],
    pagination:{ page:1, limit:20, total:0, hasMore:false, nextPage:null, nextCursor:null },
    lastSuccessfulAt:null,
    comments:{},
    commentStatus:{},
    commentPagination:{}
  };
  renderPosts();
}

function communityCategories(){
  return state.community.categories && state.community.categories.length ? state.community.categories : COMMUNITY_DEFAULT_CATEGORIES;
}

function communityCategoryLabel(categoryId){
  const found = communityCategories().find(category => String(category.id || category.slug) === String(categoryId));
  return found ? found.label : readableComponentName(categoryId || 'general');
}

function communityDate(value){
  if(!value) return 'not synced';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(value);
}

function communityLamp(status){
  if(['synced','active','public'].includes(status)) return 'green';
  if(['failed','blocked','hidden','deleted'].includes(status)) return 'red';
  if(['loading','syncing','reconnecting','stale','offline','locked'].includes(status)) return 'yellow';
  return 'muted';
}

function communityReactionCounts(counts = {}){
  return {
    like:Number(counts.like || 0),
    fire:Number(counts.fire || 0),
    respect:Number(counts.respect || 0),
    technique:Number(counts.technique || 0),
    total:Number(counts.total || 0)
  };
}

function localCommunityPosts(){
  return (state.posts || []).map((post, index) => ({
    id:`local-post-${index}`,
    title:post.title || 'Local post',
    bodyText:post.body || '',
    categoryId:String(post.room || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    visibility:'local_saved',
    status:'active',
    createdAt:post.createdAt || post.time || '',
    author:{ displayName:post.user || 'Local DJ', name:post.user || 'Local DJ', publicProfileId:isOwnLocalPost(post) ? null : `dj_${String(post.user || 'localdj').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'localdj'}`, profileVisibility:'public' },
    reactionCounts:{ like:Number(post.likes || 0), fire:0, respect:0, technique:0, total:Number(post.likes || 0) },
    commentCount:Number(post.comments || 0),
    attachments:post.media ? [{ id:`local-media-${index}`, type:'library_track', title:post.media, artist:'Local library', status:'local_saved', playbackPermitted:false, playbackContract:'local_saved_only' }] : [],
    viewer:{ canEdit:isOwnLocalPost(post), canDelete:isOwnLocalPost(post), isOwner:isOwnLocalPost(post) },
    localOnly:true
  }));
}

function dedupeCommunityPosts(rows){
  const seen = new Set();
  return (rows || []).filter(row => {
    const key = String(row && row.id || '');
    if(!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderCommunityStatus(){
  const target = document.getElementById('community-status');
  if(!target) return;
  const status = state.community.status || 'idle';
  const copy = status === 'synced'
    ? ['Feed synced', `Refreshed ${communityDate(state.community.lastSuccessfulAt)}`]
    : ['loading','syncing','reconnecting'].includes(status)
      ? ['Loading feed', 'Finding fresh DJ posts']
      : status === 'failed' || status === 'configuration_required'
        ? ['Offline demo data', 'Community server unavailable — showing built-in sample posts saved in this browser']
        : ['Community ready', 'Recent DJ posts are ready'];
  target.innerHTML = `<div><span class="challenge-lamp ${communityLamp(status)}"></span><strong>${esc(copy[0])}</strong><span>${esc(copy[1])}</span></div>`;
}

function renderCommunityControls(){
  const feedSelect = document.getElementById('community-feed-view');
  if(feedSelect) feedSelect.value = state.community.feed || 'recent';
  const categorySelect = document.getElementById('community-category-filter');
  if(categorySelect){
    const current = state.community.category || 'all';
    categorySelect.innerHTML = `<option value="all">All Categories</option>${communityCategories().map(category => `<option value="${esc(category.id || category.slug)}">${esc(category.label)}</option>`).join('')}`;
    categorySelect.value = current;
  }
  const rail = document.getElementById('community-category-rail');
  if(rail){
    const current = state.community.category || 'all';
    rail.innerHTML = `<button class="${current === 'all' ? 'active' : ''}" type="button" data-community-category="all"><span>All Categories</span><b>${esc(state.community.pagination.total || 0)}</b></button>`
      + communityCategories().map(category => `<button class="${current === (category.id || category.slug) ? 'active' : ''}" type="button" data-community-category="${esc(category.id || category.slug)}"><span>${esc(category.label)}</span><b>${esc(category.status || 'on')}</b></button>`).join('');
  }
  const more = document.getElementById('community-load-more');
  if(more) more.disabled = !state.community.pagination?.hasMore || ['loading','reconnecting'].includes(state.community.status);
}

function communityAttachmentHtml(attachment){
  const item = attachment || {};
  if(item.type === 'verified_result'){
    const bitcoin = item.reward && item.reward.type === 'bitcoin' ? '<small>Bitcoin metadata: untransferred</small>' : '';
    return `<div class="community-attachment result"><div><span class="eyebrow">Verified Result</span><strong>${esc(item.title || 'Verified battle result')}</strong><small>${esc(item.score == null ? 'Score pending' : `${item.score}/100`)} / ${esc(item.outcome || 'recorded')} / ${esc((item.scoringSource || []).join(', ') || 'scoring source recorded')}</small>${bitcoin}</div>${item.verifiedResultId ? `<button class="ghost small" type="button" data-community-result="${esc(item.verifiedResultId)}">Open</button>` : ''}</div>`;
  }
    const unavailable = item.status && !['available','rights_unverified','local_saved'].includes(item.status);
  return `<div class="community-attachment ${unavailable ? 'blocked' : ''}">
    <button class="community-play" type="button" data-community-media="${esc(item.id || '')}" ${item.playbackPermitted ? '' : 'disabled'}>Play</button>
    <div><span class="eyebrow">${esc(readableComponentName(item.sourceType || item.type || 'media'))}</span><strong>${esc(item.title || 'Attached media')}</strong><small>${esc(item.artist || 'Public-approved media')} / ${esc(item.bpm || '--')} BPM / ${esc(item.camelotKey || item.key || '--')} / ${esc(readableComponentName(item.rightsStatus || item.rightsClassification || 'classified'))}</small>${unavailable ? `<small>${esc(item.unavailableReason || 'Media is unavailable')}</small>` : ''}</div>
  </div>`;
}

function shortContextValue(value, max = 128){
  return String(value == null ? '' : value).trim().slice(0, max);
}

function communityChallengeOriginForPost(post){
  const source = plainObject(post);
  const author = plainObject(source.author);
  const postId = shortContextValue(source.id || source.postId, 128);
  return {
    source:'community_post',
    publicProfileId:shortContextValue(author.publicProfileId || author.id, 96),
    communityPostId:postId,
    categoryId:shortContextValue(source.categoryId || source.category || source.slug, 80),
    referrer:'community_feed'
  };
}

function communityChallengeProfileForPost(post){
  const source = plainObject(post);
  if(source.tombstone || ['deleted','removed','hidden'].includes(String(source.status || '').toLowerCase())) return null;
  const author = plainObject(source.author);
  if(!author.publicProfileId) return null;
  const originContext = communityChallengeOriginForPost(source);
  return {
    publicProfileId:author.publicProfileId,
    displayName:author.displayName || author.name || 'DJ',
    name:author.name || author.displayName || 'DJ',
    country:author.country,
    belt:author.belt,
    rating:author.rating,
    profileVisibility:author.profileVisibility || author.visibility || 'public',
    isSelf:Boolean(source.viewer && source.viewer.isOwner),
    challengeOrigin:'community_post',
    challengeOriginContext:originContext
  };
}

function communityPostHtml(post){
  const counts = communityReactionCounts(post.reactionCounts);
  const viewerTypes = post.viewerReactionTypes || [];
  const owner = post.viewer && post.viewer.isOwner;
  const edited = post.editedAt ? ' / edited' : '';
  const locked = post.locked ? ' / comments locked' : '';
  const body = post.tombstone ? '<p class="community-tombstone">This discussion item is unavailable.</p>' : `<p>${esc(post.bodyText || '')}</p>`;
  const authorProfileId = post.author && post.author.publicProfileId || '';
  const challengeProfile = communityChallengeProfileForPost(post);
  const canChallenge = challengeProfile && publicProfileCanChallenge(challengeProfile);
  return `<article class="forum-post community-post ${post.localOnly ? 'local' : ''}" data-community-post="${esc(post.id)}">
    <div class="post-head">
      <div class="avatar">${esc((post.author && (post.author.displayName || post.author.name) || 'DJ').split(/\s+/).map(part=>part[0]).join('').slice(0,2).toUpperCase())}</div>
      <div class="post-author-copy"><strong>${esc(post.author && (post.author.displayName || post.author.name) || 'DJ')}</strong><span>${esc(communityCategoryLabel(post.categoryId))} / ${esc(communityDate(post.createdAt))}${esc(edited)}${esc(locked)}</span></div>
      ${canChallenge ? `<button class="ghost small request-battle" type="button" data-community-challenge="${esc(authorProfileId)}" data-community-post="${esc(post.id)}">Request Battle</button>` : ''}
    </div>
    <h4>${esc(post.title || 'Community post')}</h4>
    ${body}
    ${(post.safeLinks || []).length ? `<div class="community-links">${post.safeLinks.map(link => `<a href="${esc(link.url)}" rel="noopener noreferrer" target="_blank">${esc(link.host || link.url)}</a>`).join('')}</div>` : ''}
    ${(post.attachments || []).map(communityAttachmentHtml).join('')}
    <div class="post-foot">
      ${COMMUNITY_REACTIONS.map(reaction => `<button class="ghost small community-reaction ${viewerTypes.includes(reaction.type) ? 'active' : ''}" type="button" data-community-reaction="${reaction.type}" data-post-id="${esc(post.id)}"><span>${esc(reaction.label)}</span><b>${esc(counts[reaction.type] || 0)}</b></button>`).join('')}
      <button class="ghost small" type="button" data-community-comments="${esc(post.id)}">Comments ${esc(post.commentCount || 0)}</button>
      ${authorProfileId ? `<button class="ghost small" type="button" data-community-profile="${esc(authorProfileId)}">Profile</button>` : ''}
      <button class="ghost small" type="button" data-community-report="${esc(post.id)}">Report</button>
      ${owner ? `<button class="ghost small" type="button" data-community-edit="${esc(post.id)}">Edit</button><button class="ghost small" type="button" data-community-delete="${esc(post.id)}">Delete</button>` : ''}
    </div>
  </article>`;
}

function renderPosts(){
  renderCommunityControls();
  renderCommunityStatus();
  const serverCapable = communityApiAvailable();
  const signedIn = Boolean(communityAccountId());
  const useServerRows = state.community.source === 'server' || (serverCapable && signedIn);
  const rows = useServerRows ? state.community.posts : localCommunityPosts();
  const target = document.getElementById('forum-feed');
  if(target){
    const emptyCopy = useServerRows
      ? (state.community.status === 'loading' ? 'Loading DJ posts.' : 'No community posts match this feed.')
      : 'No saved community posts match this feed yet.';
    target.innerHTML = rows.length ? rows.map(communityPostHtml).join('') : `<div class="panel community-empty"><strong>${esc(emptyCopy)}</strong><p>Share a post or adjust the feed filters.</p></div>`;
  }
  const latest = document.getElementById('latest-posts');
  if(latest){
    const latestRows = rows.slice(0, 3);
    latest.innerHTML = latestRows.length
      ? latestRows.map(post => `<div class="feed-item"><div class="mini-art">DJ</div><div><strong>${esc(post.title)}</strong><p>${esc(post.author && (post.author.displayName || post.author.name) || 'DJ')} / ${esc(communityCategoryLabel(post.categoryId))}</p></div></div>`).join('')
      : '<div class="feed-item"><div class="mini-art">DJ</div><div><strong>No community posts yet</strong><p>Latest Drops will fill from public DJ discussions.</p></div></div>';
  }
  wireCommunityControls();
}

function communityFeedQuery(options = {}){
  const params = new URLSearchParams();
  params.set('feed', options.feed || state.community.feed || 'recent');
  params.set('limit', String(options.limit || state.community.pageSize || 20));
  if(options.cursor) params.set('cursor', options.cursor);
  else params.set('page', String(options.page || state.community.page || 1));
  const category = options.category ?? state.community.category;
  if(category && category !== 'all') params.set('category', category);
  return params.toString();
}

async function loadCommunityFeed(options = {}){
  const feed = options.feed || state.community.feed || 'recent';
  const accountId = communityAccountId();
  if(['following','my_posts'].includes(feed) && !accountId){
    state.community.status = 'failed';
    state.community.source = 'server';
    state.community.error = 'Sign in to load this private community feed.';
    state.community.feed = feed;
    renderPosts();
    if(activeProfileTab === 'posts') renderProfileCommunityPosts();
    return { skipped:true, reason:'auth_required' };
  }
  if(!communityApiAvailable()){
    state.community.status = 'offline';
    state.community.source = 'local';
    state.community.error = 'Server Community API unavailable; showing saved local posts only.';
    renderPosts();
    if(activeProfileTab === 'posts') renderProfileCommunityPosts();
    return { skipped:true, reason:'api_unavailable' };
  }
  const append = options.append === true;
  const cursor = append ? state.community.pagination.nextCursor : null;
  const seq = ++state.community.requestSeq;
  state.community.feed = feed;
  if(options.category != null) state.community.category = options.category;
  state.community.status = state.community.posts.length ? 'reconnecting' : 'loading';
  state.community.error = '';
  renderPosts();
  const endpoint = accountId ? '/api/community/myFeed' : '/api/community/feed';
  const response = await window.DJBattleApi.apiRequest(`${endpoint}?${communityFeedQuery({ ...options, feed, cursor, page:append ? state.community.page + 1 : 1 })}`, accountId ? {} : { public:true });
  if(seq !== state.community.requestSeq) return { stale:true, reason:'out_of_order' };
  if(!response || response.error || !response.data){
    state.community.status = state.community.posts.length ? 'stale' : (response && response.status === 503 ? 'configuration_required' : 'failed');
    state.community.stale = Boolean(state.community.posts.length);
    state.community.error = response && response.error || 'Community feed unavailable.';
    renderPosts();
    if(activeProfileTab === 'posts') renderProfileCommunityPosts();
    return response || { error:state.community.error };
  }
  const incoming = response.data.posts || [];
  state.community.categories = response.data.categories || state.community.categories || [];
  state.community.posts = append ? dedupeCommunityPosts([...state.community.posts, ...incoming]) : dedupeCommunityPosts(incoming);
  state.community.pagination = response.data.pagination || state.community.pagination;
  state.community.page = state.community.pagination.page || (append ? state.community.page + 1 : 1);
  state.community.source = 'server';
  state.community.status = 'synced';
  state.community.stale = false;
  state.community.error = '';
  state.community.lastSuccessfulAt = response.data.generatedAt || new Date().toISOString();
  renderPosts();
  if(activeProfileTab === 'posts') renderProfileCommunityPosts();
  return { posts:state.community.posts, response };
}

function communityAttachableLibraryTracks(){
  const accountId = communityAccountId();
  const blockedRights = new Set(['commercial_copyrighted','blocked','unlicensed','rights_blocked','copyright_blocked']);
  return state.library.filter(track => {
    const rights = String(track.rightsClassification || rightsCategoryToClassification(track.rightsCategory)).toLowerCase();
    const approved = track.visibility === 'public' || track.communityPublic === true || track.profileMediaPublic === true || plainObject(track.permissions).community === true || plainObject(track.permissions).publicProfile === true;
    if(accountId && track.serverBacked && String(track.userId || '') !== String(accountId)) return false;
    return (track.serverBacked || !accountId) && approved && !blockedRights.has(rights);
  });
}

function communityAttachmentOptions(){
  const trackOptions = communityAttachableLibraryTracks().map(track => `<option value="track:${esc(track.id)}">${esc(track.title || track.name)} / ${esc(track.bpm || '--')} BPM / ${esc(track.camelotKey || track.key || '--')}</option>`).join('');
  const resultOptions = (state.battleResults || []).filter(result => result.visibility === 'public' && result.verifiedResultId).slice(0, 12).map(result => `<option value="result:${esc(result.verifiedResultId)}">${esc(result.battle && result.battle.title || 'Verified Result')} / ${esc(result.score || '--')}</option>`).join('');
  return `<option value="">No attachment</option>${trackOptions}${resultOptions}`;
}

function openCommunityPostComposer(existingPost){
  const post = existingPost || {};
  const categoryOptions = communityCategories().map(category => `<option value="${esc(category.id || category.slug)}" ${post.categoryId === (category.id || category.slug) ? 'selected' : ''}>${esc(category.label)}</option>`).join('');
  openModal(`<span class="eyebrow accent">COMMUNITY</span><h3>${post.id ? 'Edit Post' : 'Create Post'}</h3>
    <div class="form-grid">
      <label>Category<select id="post-room">${categoryOptions}</select></label>
      <label>Visibility<select id="post-visibility"><option value="public" ${post.visibility === 'public' ? 'selected' : ''}>Public Community</option><option value="followers" ${post.visibility === 'followers' ? 'selected' : ''}>Followers</option><option value="private" ${post.visibility === 'private' ? 'selected' : ''}>Private Draft</option></select></label>
      <label>Title<input id="post-title" maxlength="180" placeholder="What are you sharing?" value="${esc(post.title || '')}"></label>
      <label>Post<textarea id="post-body" maxlength="4000" placeholder="Talk shop, share technique, ask for feedback.">${esc(post.bodyText || '')}</textarea></label>
      <label>Attach approved media<select id="post-media">${communityAttachmentOptions()}</select></label>
      <div class="community-form-note">Attachments use owned media or verified-result IDs only. The post never stores signed URLs, storage paths or private crate data.</div>
    </div>
    <div class="modal-actions"><button class="ghost" value="cancel">Cancel</button><button class="primary" type="button" id="publish-post">${post.id ? 'Save' : 'Publish'}</button></div>`);
  setTimeout(() => {
    const publish = document.getElementById('publish-post');
    if(publish) publish.onclick = () => publishCommunityPostFromModal(post.id).catch(err=>alert(String(err && err.message || err)));
  }, 0);
}

function communityPostPayloadFromModal(postId){
  const mediaValue = document.getElementById('post-media')?.value || '';
  const attachments = [];
  if(mediaValue.startsWith('track:')) attachments.push({ type:'library_track', mediaId:mediaValue.slice(6) });
  if(mediaValue.startsWith('result:')) attachments.push({ type:'verified_result', verifiedResultId:mediaValue.slice(7) });
  const title = document.getElementById('post-title')?.value || '';
  const bodyText = document.getElementById('post-body')?.value || '';
  const categoryId = document.getElementById('post-room')?.value || 'general';
  return {
    title,
    bodyText,
    categoryId,
    visibility:document.getElementById('post-visibility')?.value || 'public',
    attachments,
    idempotencyKey:stableClientIdempotencyKey(postId ? 'community-edit' : 'community-post', { accountId:communityAccountId() || currentProfileUserId(), postId, title, bodyText, categoryId, mediaValue })
  };
}

async function publishCommunityPostFromModal(postId){
  const payload = communityPostPayloadFromModal(postId);
  if(!payload.title.trim() || !payload.bodyText.trim()){
    alert('Title and post body are required.');
    return { error:'missing_fields' };
  }
  if(communityServerMode()){
    const response = await window.DJBattleApi.apiRequest(postId ? `/api/community/posts/${encodeURIComponent(postId)}` : '/api/community/posts', {
      method:postId ? 'PATCH' : 'POST',
      body:payload
    });
    if(response.error){
      alert(response.error);
      return response;
    }
    const post = response.data && response.data.post;
    if(post){
      const others = state.community.posts.filter(row => String(row.id) !== String(post.id));
      state.community.posts = dedupeCommunityPosts([post, ...others]);
      state.community.source = 'server';
      state.community.status = 'synced';
      state.community.lastSuccessfulAt = new Date().toISOString();
    }
  }else{
    const mediaValue = document.getElementById('post-media')?.value || '';
    const mediaTrack = mediaValue.startsWith('track:') ? getLibraryTrackById(mediaValue.slice(6)) : null;
    state.posts.unshift({
      user:currentUser().displayName,
      initials:currentUser().initials,
      userId:currentUser().id,
      room:communityCategoryLabel(payload.categoryId),
      time:'local',
      title:payload.title,
      body:payload.bodyText,
      media:mediaTrack && (mediaTrack.title || mediaTrack.name),
      likes:0,
      comments:0
    });
    persist();
  }
  document.getElementById('modal')?.close();
  renderPosts();
  if(activeProfileTab === 'posts') renderProfileCommunityPosts();
  return { ok:true };
}

async function toggleCommunityReaction(postId, type){
  if(!communityServerMode()){
    alert('Sign in with server Community access to react.');
    return { skipped:true };
  }
  const response = await window.DJBattleApi.apiRequest('/api/community/reactions/toggle', { method:'POST', body:{ targetType:'post', targetId:postId, type, idempotencyKey:stableClientIdempotencyKey('community-reaction', { accountId:communityAccountId(), postId, type }) } });
  if(response.error){ alert(response.error); return response; }
  const post = state.community.posts.find(row => String(row.id) === String(postId));
  if(post && response.data){
    post.reactionCounts = response.data.counts || post.reactionCounts;
    const active = response.data.reaction && response.data.reaction.active;
    post.viewerReactionTypes = active ? [type] : [];
  }
  renderPosts();
  return response;
}

async function loadCommunityComments(postId, options = {}){
  if(!communityApiAvailable()) return { skipped:true, reason:'api_unavailable' };
  const accountId = communityAccountId();
  const endpoint = accountId ? `/api/community/posts/${encodeURIComponent(postId)}/myComments` : `/api/community/posts/${encodeURIComponent(postId)}/comments`;
  const params = new URLSearchParams({ limit:String(options.limit || 30) });
  const current = state.community.commentPagination[postId] || {};
  if(options.append && current.nextCursor) params.set('cursor', current.nextCursor);
  const response = await window.DJBattleApi.apiRequest(`${endpoint}?${params.toString()}`, accountId ? {} : { public:true });
  if(response.error){
    state.community.commentStatus[postId] = response.error;
    return response;
  }
  state.community.comments[postId] = options.append ? [...(state.community.comments[postId] || []), ...(response.data.comments || [])] : (response.data.comments || []);
  state.community.commentPagination[postId] = response.data.pagination || {};
  state.community.commentStatus[postId] = '';
  return { comments:state.community.comments[postId], response };
}

function communityCommentHtml(comment){
  const counts = communityReactionCounts(comment.reactionCounts);
  const owner = comment.viewer && comment.viewer.isOwner;
  return `<div class="community-comment ${comment.parentCommentId ? 'reply' : ''}" data-community-comment="${esc(comment.id)}">
    <div><strong>${esc(comment.author && (comment.author.displayName || comment.author.name) || 'DJ')}</strong><span>${esc(communityDate(comment.createdAt))}${comment.editedAt ? ' / edited' : ''}</span></div>
    <p>${esc(comment.tombstone ? 'Comment unavailable.' : comment.bodyText || '')}</p>
    <div class="community-comment-actions">
      <span>Like ${esc(counts.like)}</span>
      ${communityServerMode() ? `<button class="ghost small" type="button" data-community-reply="${esc(comment.id)}">Reply</button>` : ''}
      ${owner ? `<button class="ghost small" type="button" data-community-comment-delete="${esc(comment.id)}">Remove</button>` : ''}
    </div>
  </div>`;
}

function renderCommunityCommentsModal(postId){
  const list = document.getElementById('community-comments-list');
  if(!list) return;
  const comments = state.community.comments[postId] || [];
  list.innerHTML = comments.length ? comments.map(communityCommentHtml).join('') : `<div class="community-empty"><strong>No comments yet</strong><p>${esc(state.community.commentStatus[postId] || 'Start the thread with a focused reply.')}</p></div>`;
  list.querySelectorAll('[data-community-reply]').forEach(button => {
    button.onclick = event => {
      const input = document.getElementById('community-comment-parent');
      if(input) input.value = event.currentTarget.dataset.communityReply;
      const body = document.getElementById('community-comment-body');
      if(body) body.focus();
    };
  });
  list.querySelectorAll('[data-community-comment-delete]').forEach(button => {
    button.onclick = event => deleteCommunityComment(event.currentTarget.dataset.communityCommentDelete, postId).catch(err=>console.warn('Community comment delete failed', err));
  });
}

async function openCommunityComments(postId){
  const post = state.community.posts.find(row => String(row.id) === String(postId)) || localCommunityPosts().find(row => String(row.id) === String(postId));
  openModal(`<span class="eyebrow accent">DISCUSSION</span><h3>${esc(post && post.title || 'Community comments')}</h3>
    <div id="community-comments-list" class="community-comments-list"><div class="community-empty">Loading comments...</div></div>
    <input type="hidden" id="community-comment-parent" value="">
    <div class="form-grid"><label>Comment<textarea id="community-comment-body" maxlength="2200" placeholder="Add a reply"></textarea></label></div>
    <div class="modal-actions"><button class="ghost" value="cancel">Close</button><button class="primary" type="button" id="community-comment-submit">Send</button></div>`);
  if(communityApiAvailable()) await loadCommunityComments(postId);
  else state.community.comments[postId] = [];
  renderCommunityCommentsModal(postId);
  const submit = document.getElementById('community-comment-submit');
  if(submit) submit.onclick = () => publishCommunityComment(postId).catch(err=>alert(String(err && err.message || err)));
}

async function publishCommunityComment(postId){
  if(!communityServerMode()){
    alert('Sign in with server Community access to comment.');
    return { skipped:true };
  }
  const bodyText = document.getElementById('community-comment-body')?.value || '';
  const parentCommentId = document.getElementById('community-comment-parent')?.value || '';
  const response = await window.DJBattleApi.apiRequest('/api/community/comments', {
    method:'POST',
    body:{ postId, bodyText, parentCommentId:parentCommentId || null, idempotencyKey:stableClientIdempotencyKey('community-comment', { accountId:communityAccountId(), postId, parentCommentId, bodyText }) }
  });
  if(response.error){ alert(response.error); return response; }
  const comment = response.data && response.data.comment;
  if(comment){
    state.community.comments[postId] = dedupeCommunityPosts([...(state.community.comments[postId] || []), comment]);
    const post = state.community.posts.find(row => String(row.id) === String(postId));
    if(post) post.commentCount = Number(post.commentCount || 0) + (response.data.duplicate ? 0 : 1);
  }
  const body = document.getElementById('community-comment-body');
  if(body) body.value = '';
  const parent = document.getElementById('community-comment-parent');
  if(parent) parent.value = '';
  renderCommunityCommentsModal(postId);
  renderPosts();
  return response;
}

async function deleteCommunityComment(commentId, postId){
  if(!communityServerMode()) return { skipped:true };
  const response = await window.DJBattleApi.apiRequest(`/api/community/comments/${encodeURIComponent(commentId)}`, { method:'DELETE' });
  if(response.error){ alert(response.error); return response; }
  state.community.comments[postId] = (state.community.comments[postId] || []).map(comment => String(comment.id) === String(commentId) ? { ...comment, tombstone:true, bodyText:'', status:'deleted' } : comment);
  renderCommunityCommentsModal(postId);
  return response;
}

async function reportCommunityPost(postId){
  if(!communityServerMode()){
    alert('Sign in with server Community access to report posts.');
    return { skipped:true };
  }
  const reason = 'unsafe_content';
  const response = await window.DJBattleApi.apiRequest('/api/community/reports', { method:'POST', body:{ targetType:'post', targetId:postId, reason, context:'Reported from Community panel' } });
  if(response.error) alert(response.error);
  else alert(response.data && response.data.duplicate ? 'Report already queued for review.' : 'Report queued for operator review.');
  return response;
}

async function deleteCommunityPost(postId){
  if(!communityServerMode()) return { skipped:true };
  if(!confirm('Delete this post from the community feed? Comments remain as a thread record.')) return { cancelled:true };
  const response = await window.DJBattleApi.apiRequest(`/api/community/posts/${encodeURIComponent(postId)}`, { method:'DELETE' });
  if(response.error){ alert(response.error); return response; }
  state.community.posts = state.community.posts.filter(post => String(post.id) !== String(postId));
  renderPosts();
  if(activeProfileTab === 'posts') renderProfileCommunityPosts();
  return response;
}

function wireCommunityControls(){
  const refresh = document.getElementById('community-refresh');
  if(refresh) refresh.onclick = () => loadCommunityFeed({ page:1 }).catch(err=>console.warn('Community refresh failed', err));
  const more = document.getElementById('community-load-more');
  if(more) more.onclick = () => loadCommunityFeed({ append:true }).catch(err=>console.warn('Community pagination failed', err));
  const feedSelect = document.getElementById('community-feed-view');
  if(feedSelect) feedSelect.onchange = event => loadCommunityFeed({ feed:event.currentTarget.value, page:1 }).catch(err=>console.warn('Community feed change failed', err));
  const categorySelect = document.getElementById('community-category-filter');
  if(categorySelect) categorySelect.onchange = event => loadCommunityFeed({ category:event.currentTarget.value || 'all', page:1 }).catch(err=>console.warn('Community category change failed', err));
  document.querySelectorAll('[data-community-category]').forEach(button => {
    button.onclick = event => loadCommunityFeed({ category:event.currentTarget.dataset.communityCategory || 'all', feed:'category', page:1 }).catch(err=>console.warn('Community category rail failed', err));
  });
  const newPost = document.getElementById('new-post');
  if(newPost) newPost.onclick = () => openCommunityPostComposer();
  document.querySelectorAll('[data-community-reaction]').forEach(button => {
    button.onclick = event => toggleCommunityReaction(event.currentTarget.dataset.postId, event.currentTarget.dataset.communityReaction).catch(err=>console.warn('Community reaction failed', err));
  });
  document.querySelectorAll('[data-community-comments]').forEach(button => {
    button.onclick = event => openCommunityComments(event.currentTarget.dataset.communityComments).catch(err=>console.warn('Community comments failed', err));
  });
  document.querySelectorAll('[data-community-profile]').forEach(button => {
    button.onclick = event => loadPublicDjProfile(event.currentTarget.dataset.communityProfile);
  });
  document.querySelectorAll('[data-community-challenge]').forEach(button => {
    button.onclick = event => {
      const target = event.currentTarget;
      const postId = target.dataset.communityPost || target.closest('[data-community-post]')?.dataset.communityPost || '';
      const post = (state.community.posts || []).concat(localCommunityPosts()).find(row => String(row.id) === String(postId));
      const context = post ? communityChallengeOriginForPost(post) : { source:'community_post', publicProfileId:target.dataset.communityChallenge, communityPostId:postId, referrer:'community_feed' };
      openProtectedChallengeSetupFromPublicId(target.dataset.communityChallenge, 'community_post', context).catch(err=>console.warn('Community challenge failed', err));
    };
  });
  document.querySelectorAll('[data-community-result]').forEach(button => {
    button.onclick = event => loadPublicVerifiedResult(event.currentTarget.dataset.communityResult);
  });
  document.querySelectorAll('[data-community-report]').forEach(button => {
    button.onclick = event => reportCommunityPost(event.currentTarget.dataset.communityReport).catch(err=>console.warn('Community report failed', err));
  });
  document.querySelectorAll('[data-community-edit]').forEach(button => {
    button.onclick = event => {
      const post = state.community.posts.find(row => String(row.id) === String(event.currentTarget.dataset.communityEdit));
      if(post) openCommunityPostComposer(post);
    };
  });
  document.querySelectorAll('[data-community-delete]').forEach(button => {
    button.onclick = event => deleteCommunityPost(event.currentTarget.dataset.communityDelete).catch(err=>console.warn('Community delete failed', err));
  });
  document.querySelectorAll('[data-community-media]').forEach(button => {
    button.onclick = event => recordCommunityMediaUsage(event.currentTarget.closest('[data-community-post]')?.dataset.communityPost, event.currentTarget.dataset.communityMedia).catch(err=>console.warn('Community media usage failed', err));
  });
}

async function recordCommunityMediaUsage(postId, attachmentId){
  if(!communityServerMode() || !postId || !attachmentId) return { skipped:true };
  const response = await window.DJBattleApi.apiRequest(`/api/community/posts/${encodeURIComponent(postId)}/attachments/${encodeURIComponent(attachmentId)}/usage`, { method:'POST' });
  const access = response && response.data && response.data.playbackAccess;
  if(access && access.url){
    const post = state.community.posts.find(row => String(row.id) === String(postId));
    const attachment = (post && post.attachments || []).find(item => String(item.id) === String(attachmentId));
    const audio = document.getElementById('library-player-audio');
    if(audio){
      audio.src = access.url;
      audio.play().catch(err => console.warn('Community playback failed', err));
    }
    state.libraryPlayer = {
      trackId:`community:${postId}:${attachmentId}`,
      playing:true,
      progress:0
    };
    const title = document.getElementById('library-player-title');
    const artist = document.getElementById('library-player-artist');
    if(title) title.textContent = attachment && attachment.title || 'Community media';
    if(artist) artist.textContent = attachment && attachment.artist || 'Signed community playback';
  }
  return response;
}

function renderProfileCommunityPosts(){
  if(activeProfileTab !== 'posts') return;
  const target = document.getElementById('profile-media');
  if(!target) return;
  target.className = 'community-profile-posts';
  if(communityServerMode()){
    if(state.community.feed !== 'my_posts' || state.community.status === 'idle'){
      target.innerHTML = '<div class="challenge-status-strip"><div><span class="challenge-lamp yellow"></span><strong>Loading My Posts</strong><div class="challenge-meta">Reading owned posts through the protected Community contract.</div></div></div>';
      loadCommunityFeed({ feed:'my_posts', page:1 }).catch(err=>console.warn('Profile community posts failed', err));
      return;
    }
    const rows = state.community.posts || [];
    target.innerHTML = `<div class="challenge-status-strip">
      <div><span class="challenge-lamp ${communityLamp(state.community.status)}"></span><strong>${esc(readableComponentName(state.community.status || 'idle'))}</strong><div class="challenge-meta">${esc(state.community.error || 'Private My Posts view uses the authenticated Community contract.')}</div></div>
      <div class="challenge-actions"><button class="ghost small" id="profile-posts-refresh" type="button">Refresh</button></div>
    </div>${rows.length ? rows.map(communityPostHtml).join('') : '<div class="community-empty panel"><strong>No server-backed posts yet</strong><p>Create a Community post to publish or draft from your DJ profile.</p></div>'}`;
    document.getElementById('profile-posts-refresh')?.addEventListener('click', () => loadCommunityFeed({ feed:'my_posts', page:1 }).catch(err=>console.warn('Profile posts refresh failed', err)));
    wireCommunityControls();
    return;
  }
  const rows = localCommunityPosts().filter(post => post.viewer && post.viewer.isOwner);
  target.innerHTML = rows.length ? rows.map(communityPostHtml).join('') : '<div class="media-card"><div class="cover">P</div><h4>No local posts yet</h4><p>Posts created in this browser appear here until server Community is available.</p></div>';
  wireCommunityControls();
}

async function loadPublicProfileCommunityPosts(publicProfileId, options = {}){
  if(!communityApiAvailable() || !publicProfileId) return { skipped:true };
  const params = new URLSearchParams({ limit:String(options.limit || 6) });
  const response = await window.DJBattleApi.apiRequest(`/api/community/publicProfiles/${encodeURIComponent(publicProfileId)}/posts?${params.toString()}`, { public:true });
  return response.error ? response : { posts:response.data && response.data.posts || [], response };
}

let judgingOpsAutoTimer = null;
const JUDGING_OPS_REFRESH_OPTIONS = new Set([0, 15000, 30000, 60000]);

function roleValues(value){
  if(Array.isArray(value)) return value.flatMap(roleValues);
  if(typeof value === 'string') return value.split(/[,\s]+/).filter(Boolean);
  if(value == null) return [];
  return [String(value)];
}

function isOperatorUser(user){
  const appMeta = user && user.app_metadata && typeof user.app_metadata === 'object' ? user.app_metadata : {};
  const userMeta = user && user.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {};
  const roles = [
    ...roleValues(appMeta.role),
    ...roleValues(appMeta.roles),
    ...roleValues(userMeta.role),
    ...roleValues(userMeta.roles)
  ].map(role => role.toLowerCase());
  return Boolean(
    roles.some(role => ['admin', 'operator', 'judging_operator', 'owner'].includes(role)) ||
    appMeta.is_admin === true ||
    appMeta.is_operator === true ||
    userMeta.is_admin === true ||
    userMeta.is_operator === true
  );
}

function renderJudgingOperationsAccess(){
  const nav = document.getElementById('operator-nav');
  const denied = document.getElementById('judge-ops-denied');
  const content = document.getElementById('judge-ops-content');
  const allowed = Boolean(state.operatorUser);
  if(nav) nav.classList.toggle('hidden', !allowed);
  if(denied) denied.classList.toggle('hidden', allowed);
  if(content) content.classList.toggle('hidden', !allowed);
}

function sanitizeOperatorText(value){
  return String(value || '')
    .replace(/[A-Za-z]:\\[^\s"'`]+/g, '[redacted-path]')
    .replace(/\/(?:var|tmp|home|users|private)\/[^\s"'`]+/gi, '[redacted-path]')
    .replace(/private\/battle-entries\/[^\s"'`]+/g, '[redacted-storage-object]')
    .replace(/(service[_-]?role|anon|bearer|token|key)=?[^\s"'`]+/gi, '$1=[redacted]')
    .slice(0, 500);
}

function formatOpsDate(value){
  if(!value) return 'Not reported';
  const date = new Date(value);
  if(Number.isNaN(date.getTime())) return sanitizeOperatorText(value);
  return date.toLocaleString();
}

function formatOpsMs(value){
  const ms = Number(value);
  if(!Number.isFinite(ms)) return 'Not scheduled';
  if(ms >= 60000) return `${Math.round(ms / 6000) / 10} min`;
  if(ms >= 1000) return `${Math.round(ms / 100) / 10}s`;
  return `${ms}ms`;
}

function opsLevelFromCheck(status){
  if(status === 'ok') return 'ok';
  if(status === 'blocked') return 'danger';
  if(status === 'warning' || status === 'disabled') return 'warn';
  return 'muted';
}

function renderOpsCard(id, level, label, value, detail){
  const target = document.getElementById(id);
  if(!target) return;
  target.className = `panel ops-status-card ops-${level}`;
  target.innerHTML = `<div class="ops-state-line"><i class="ops-lamp"></i><span class="eyebrow">${esc(label)}</span></div><strong>${esc(value)}</strong><p>${esc(detail || '')}</p>`;
}

function renderJudgingOperationsStatus(payload){
  const runner = payload && payload.runner ? payload.runner : payload || {};
  const configuration = runner.configuration || {};
  const checks = Array.isArray(configuration.checks) ? configuration.checks : [];
  const configuredEnabled = Boolean(runner.configuredEnabled || configuration.enabledRequested);
  const enabledLevel = runner.enabled ? 'ok' : configuredEnabled ? 'danger' : 'muted';
  const healthLevel = runner.consecutiveFailures > 0 ? 'danger' : runner.enabled ? 'ok' : configuredEnabled ? 'warn' : 'muted';
  const failure = runner.lastFailure && runner.lastFailure.message ? sanitizeOperatorText(runner.lastFailure.message) : '';

  renderOpsCard('judge-enabled-card', enabledLevel, 'Worker', runner.enabled ? 'Enabled' : configuredEnabled ? 'Blocked' : 'Disabled', runner.disabledReason || (runner.enabled ? 'Ready for automatic judging' : 'Disabled by configuration'));
  renderOpsCard('judge-active-card', runner.active ? 'warn' : 'ok', 'Activity', runner.active ? 'Active' : 'Idle', runner.currentActivity || 'No run in progress');
  renderOpsCard('judge-health-card', healthLevel, 'Health', runner.consecutiveFailures > 0 ? 'Attention' : 'Stable', runner.consecutiveFailures > 0 ? `${runner.consecutiveFailures} consecutive failure(s)` : 'No active failure streak');

  const metrics = [
    ['Last run', formatOpsDate(runner.lastRunAt)],
    ['Last success', formatOpsDate(runner.lastSuccessAt)],
    ['Last failure', formatOpsDate(runner.lastFailureAt)],
    ['Processed', runner.submissionsProcessed == null ? '0' : String(runner.submissionsProcessed)],
    ['Consecutive failures', runner.consecutiveFailures == null ? '0' : String(runner.consecutiveFailures)],
    ['Current backoff', formatOpsMs(runner.nextDelayMs)],
    ['Next scheduled', formatOpsDate(runner.nextScheduledRunAt)],
    ['Recovered stale', runner.staleRecoveriesCompleted == null ? '0' : String(runner.staleRecoveriesCompleted)]
  ];
  const metricTarget = document.getElementById('judge-metrics');
  if(metricTarget){
    metricTarget.innerHTML = metrics.map(([label, value]) => `<div class="ops-meter"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
  }

  const configTarget = document.getElementById('judge-config-checks');
  if(configTarget){
    configTarget.innerHTML = checks.length ? checks.map(check => {
      const level = opsLevelFromCheck(check.status);
      return `<div class="ops-check ops-${level}"><i class="ops-lamp"></i><div><strong>${esc(check.label || check.id)}</strong><span>${esc(sanitizeOperatorText(check.message || check.status || 'Not reported'))}</span></div></div>`;
    }).join('') : '<div class="ops-check ops-warn"><i class="ops-lamp"></i><div><strong>Configuration</strong><span>No configuration details reported.</span></div></div>';
  }

  const errorTarget = document.getElementById('judge-error-readout');
  if(errorTarget) errorTarget.textContent = failure || 'No failure reported.';
  const refreshTarget = document.getElementById('judge-last-refresh');
  if(refreshTarget) refreshTarget.textContent = `Refreshed ${new Date().toLocaleTimeString()}`;
}

async function loadJudgingOperationsStatus(){
  renderJudgingOperationsAccess();
  if(!state.operatorUser) return { denied:true };
  if(!window.DJBattleApi || typeof window.DJBattleApi.apiRequest !== 'function') return { error:'Authenticated server features are unavailable.' };
  const response = await window.DJBattleApi.apiRequest('/api/submissionJudge/status');
  if(response.status === 403 || response.status === 401){
    state.operatorUser = false;
    renderJudgingOperationsAccess();
    return response;
  }
  if(response.error){
    renderJudgingOperationsStatus({ runner:{ configuredEnabled:false, enabled:false, active:false, consecutiveFailures:1, lastFailure:{ message:response.error }, lastFailureAt:new Date().toISOString() } });
    return response;
  }
  renderJudgingOperationsStatus(response.data);
  return response;
}

function setJudgingOpsAutoRefresh(ms){
  const requested = Number(ms);
  const intervalMs = JUDGING_OPS_REFRESH_OPTIONS.has(requested) ? requested : 0;
  if(judgingOpsAutoTimer){
    clearInterval(judgingOpsAutoTimer);
    judgingOpsAutoTimer = null;
  }
  if(intervalMs > 0){
    judgingOpsAutoTimer = setInterval(() => {
      if(document.getElementById('operations')?.classList.contains('active')) loadJudgingOperationsStatus();
    }, intervalMs);
    if(typeof judgingOpsAutoTimer.unref === 'function') judgingOpsAutoTimer.unref();
  }
  return intervalMs;
}

// --- Supabase Auth & UI Helpers ---
async function handleMusicLibraryAuthChange(user){
  const accountId = musicLibraryAccountId(user);
  const previousAccountId = state.musicLibrarySync.accountId || '';
  if(!accountId){
    clearDjChallengeState();
    clearDjNotificationState();
    clearDjRelationshipState();
    clearCommunityState();
    clearAuthenticatedLibraryData();
    return { status:'offline' };
  }
  if(previousAccountId && previousAccountId !== accountId){
    clearDjChallengeState();
    clearDjNotificationState();
    clearDjRelationshipState();
    clearCommunityState();
    clearAuthenticatedLibraryData();
  }
  state.musicLibrarySync.accountId = accountId;
  state.musicLibrarySync.pendingQueue = safeParse(`djBattleMusicLibraryQueue:${accountId}`, state.musicLibrarySync.pendingQueue || []) || [];
  const cached = loadAccountLibraryCache(accountId);
  const cachedCrates = loadAccountCrateCache(accountId);
  state.library = [...state.library.filter(track => !track.serverBacked), ...cached];
  state.playlists = [...state.playlists.filter(crate => !crate.serverBacked), ...cachedCrates];
  setMusicLibrarySyncStatus('syncing', { accountId, error:'', pendingQueue:state.musicLibrarySync.pendingQueue });
  renderLibrary();
  renderStudioLibrary();
  renderProfile();
  const result = await loadServerMusicLibraryTracks({ reset:true, page:1, accountId });
  const cratesResult = await loadServerMusicLibraryCrates({ accountId });
  if(result?.error || cratesResult?.error || state.musicLibrarySync.status !== 'synced'){
    if(state.djChallenges.pollTimer){
      clearInterval(state.djChallenges.pollTimer);
      state.djChallenges.pollTimer = null;
    }
    if(state.djNotifications.pollTimer){
      clearTimeout(state.djNotifications.pollTimer);
      state.djNotifications.pollTimer = null;
    }
    if(state.djRelationships.pollTimer){
      clearTimeout(state.djRelationships.pollTimer);
      state.djRelationships.pollTimer = null;
    }
    return result;
  }
  loadDjChallengeCount().catch(()=>{});
  loadDjNotificationCount().catch(()=>{});
  await loadDjNotifications({ render:false, joinInFlight:false }).catch(()=>{});
  await loadDjRelationshipSync({ render:false }).catch(()=>{});
  scheduleDjChallengePolling();
  scheduleDjNotificationPolling();
  scheduleDjRelationshipPolling();
  localStorage.setItem(`djBattleMusicLibraryQueue:${accountId}`, JSON.stringify(state.musicLibrarySync.pendingQueue || []));
  return result;
}

function updateAuthUI(user){
  const authBtn = document.getElementById('auth-button');
  currentAuthState.user = user || null;
  state.operatorUser = isOperatorUser(user);
  renderJudgingOperationsAccess();
  renderCurrentUserUI();
  if(user){
    if(authBtn){ authBtn.textContent = 'Sign Out'; authBtn.onclick = async ()=>{ await window.supabase.auth.signOut(); updateAuthUI(null); } }
    handleMusicLibraryAuthChange(user).catch(()=>setMusicLibrarySyncStatus('failed', { error:'Library sync failed after sign-in.' }));
  } else {
    if(authBtn){
      authBtn.textContent = 'Sign In';
      authBtn.onclick = window.supabase && window.supabase.auth ? openSignInModal : () => openSignInUnavailableModal(authInitState.reason);
    }
    handleMusicLibraryAuthChange(null).catch(()=>{});
  }
}

function openSignInModal(){
  openModal(`<span class="eyebrow accent">SIGN IN</span><h3>Sign in with email</h3><p style="color:var(--muted)">We'll send a magic link to your email to authenticate.</p><div class="form-grid"><label>Email<input id="auth-email" placeholder="you@djmail.com" type="email"></label></div><div class="modal-actions"><button class="ghost" value="cancel">Cancel</button><button class="primary" type="button" id="send-magic">Send Magic Link</button></div>`);
  setTimeout(()=>{
    const send = document.getElementById('send-magic'); if(!send) return; send.onclick = async ()=>{
      const email = document.getElementById('auth-email').value;
      if(!email) return alert('Enter an email');
      try{
        const { error } = await window.supabase.auth.signInWithOtp({ email });
        if(error) return openModal(`<span class="eyebrow accent">ERROR</span><h3>Sign in failed</h3><p style="color:var(--muted)">${esc(String(error.message||error))}</p><div class="modal-actions"><button class="primary" value="cancel">Close</button></div>`);
        openModal(`<span class="eyebrow accent">CHECK EMAIL</span><h3>Magic link sent</h3><p style="color:var(--muted)">Follow the link in your email to complete sign-in.</p><div class="modal-actions"><button class="primary" value="cancel">Close</button></div>`);
      }catch(err){ console.error(err); alert('Sign-in error'); }
    };
  },0);
}

function openSignInUnavailableModal(reason){
  const loading = reason === 'loading';
  const failed = reason === 'failed';
  const title = loading ? 'Sign-in is still loading' : failed ? 'Sign-in unavailable' : 'Sign-in not configured';
  const body = loading
    ? 'The sign-in service is still starting up. Try again in a moment.'
    : failed
      ? 'The Supabase sign-in library could not be loaded, so sign-in is unavailable right now. Check your connection and reload the page.'
      : 'Sign-in is not configured for this copy of DJ Battle. Copy supabase-browser-config.example.js to supabase-browser-config.local.js, add your Supabase project URL and anon key, then reload. You can keep using the offline demo data in the meantime.';
  openModal(`<span class="eyebrow accent">SIGN IN</span><h3 id="auth-unavailable-title">${esc(title)}</h3><p style="color:var(--muted)" id="auth-unavailable-message">${esc(body)}</p><div class="modal-actions"><button class="primary" value="cancel">Close</button></div>`);
}

// Tracks whether the UI is running on built-in sample data so the banner can say so plainly.
const dataSourceState = { serverReachable:null, serverBase:'', liveConfigured:null };
function renderOfflineDemoBanner(){
  const banner = document.getElementById('offline-demo-banner');
  const text = document.getElementById('offline-demo-banner-text');
  if(!banner || !text) return;
  const unreachable = dataSourceState.serverReachable === false;
  const notConfigured = dataSourceState.liveConfigured === false;
  banner.classList.toggle('hidden', !(unreachable || notConfigured));
  if(unreachable){
    const where = dataSourceState.serverBase ? ` at ${dataSourceState.serverBase}` : '';
    text.textContent = `Can't reach the DJ Battle server${where}. Showing built-in sample battles, posts, and rankings; changes stay in this browser.`;
  } else if(notConfigured){
    text.textContent = 'Sign-in and the live server are not configured. Showing built-in sample battles, posts, and rankings; changes stay in this browser.';
  }
}
window.addEventListener('djb:api-status', event => {
  const detail = event && event.detail || {};
  dataSourceState.serverReachable = Boolean(detail.online);
  if(!detail.online) dataSourceState.serverBase = detail.base || '';
  renderOfflineDemoBanner();
});

const authInitState = { initialized:false, reason:'loading' };
function initAuth(detail = {}){
  if(authInitState.initialized) return authInitState;
  authInitState.initialized = true;
  LIVE_MODE = computeLiveMode();
  dataSourceState.liveConfigured = LIVE_MODE;
  renderOfflineDemoBanner();
  const ab = document.getElementById('auth-button');
  const client = window.supabase;
  if(client && client.auth && typeof client.auth.getSession === 'function'){
    authInitState.reason = 'ready';
    if(ab) ab.onclick = openSignInModal;
    client.auth.getSession().then(({ data })=>{ updateAuthUI(data && data.session ? data.session.user : null); }).catch(()=>{});
    if(typeof client.auth.onAuthStateChange === 'function') client.auth.onAuthStateChange((event, session)=>{ updateAuthUI(session ? session.user : null); });
  } else {
    authInitState.reason = detail && detail.configured && !detail.client ? 'failed' : 'not_configured';
    if(ab){
      ab.textContent = 'Sign In';
      ab.title = authInitState.reason === 'failed' ? 'Sign-in unavailable' : 'Sign-in not configured';
      ab.onclick = () => openSignInUnavailableModal(authInitState.reason);
    }
  }
  return authInitState;
}

// Until Supabase setup reports back, the button explains that sign-in is loading instead of doing nothing.
const editProfileButton = document.getElementById('edit-profile-button');
if(editProfileButton) editProfileButton.onclick = openEditProfileModal;

(function wireAuthButtonUntilReady(){
  renderCurrentUserUI();
  const ab = document.getElementById('auth-button');
  if(ab) ab.onclick = () => openSignInUnavailableModal(authInitState.reason);
  if(window.DJB_SUPABASE_STATE && window.DJB_SUPABASE_STATE.ready) initAuth(window.DJB_SUPABASE_STATE);
  else if(window.supabase) initAuth({ configured:true, client:true });
  else window.addEventListener('djb:supabase-ready', event => initAuth(event.detail || window.DJB_SUPABASE_STATE || {}), { once:true });
})();

const judgeRefreshButton = document.getElementById('judge-refresh');
if(judgeRefreshButton) judgeRefreshButton.onclick = () => loadJudgingOperationsStatus();
const judgeAutoRefresh = document.getElementById('judge-auto-refresh');
if(judgeAutoRefresh) judgeAutoRefresh.onchange = e => setJudgingOpsAutoRefresh(e.target.value);
renderJudgingOperationsAccess();

function persistPlatform(){ localStorage.setItem('djBattlePlatformLibrary', JSON.stringify(state.platformLibrary)); localStorage.setItem('djBattlePlaylists', JSON.stringify(sanitizedCratesForStorage(state.playlists.filter(crate => !crate.serverBacked)))); if(state.musicLibrarySync && state.musicLibrarySync.accountId) persistCrateCacheForAccount(state.musicLibrarySync.accountId); }

const librarySessionAudioUrls = new Map();
const KEY_TO_CAMELOT = {
  'a minor':'8A','c major':'8B','e minor':'9A','g major':'9B','b minor':'10A','d major':'10B',
  'f# minor':'11A','gb minor':'11A','a major':'11B','c# minor':'12A','db minor':'12A','e major':'12B',
  'g# minor':'1A','ab minor':'1A','b major':'1B','d# minor':'2A','eb minor':'2A','f# major':'2B','gb major':'2B',
  'a# minor':'3A','bb minor':'3A','c# major':'3B','db major':'3B','f minor':'4A','g# major':'4B','ab major':'4B',
  'c minor':'5A','d# major':'5B','eb major':'5B','g minor':'6A','a# major':'6B','bb major':'6B',
  'd minor':'7A','f major':'7B'
};
const LIBRARY_SORT_LABELS = { title:'Title', artist:'Artist', bpm:'BPM', key:'Key', genre:'Genre', source:'Source', uploaded:'Uploaded' };

function persistLibraryUiState(){
  localStorage.setItem('djBattleLibrarySort', JSON.stringify(state.librarySort));
  localStorage.setItem('djBattleSelectedLibraryTrackId', state.selectedLibraryTrackId || '');
  localStorage.setItem('djBattleLibraryPlayer', JSON.stringify(state.libraryPlayer));
}

function persistStudioDeckState(){
  localStorage.setItem('djBattleStudioDecks', JSON.stringify(state.studioDecks));
}

function trackTitle(track){ return track?.title || track?.name || 'Untitled Track'; }
function trackArtist(track){ return track?.artist || track?.uploader || 'Unknown Artist'; }
function trackSource(track){ return track?.source || (track?._libraryOrigin === 'platform' ? 'PLATFORM' : 'MY_LIBRARY'); }
function normalizeKeyName(key){
  return String(key || '').trim().toLowerCase()
    .replace(/\bmin\b/g,'minor')
    .replace(/\bmaj\b/g,'major')
    .replace(/\s+/g,' ');
}
function parseBpm(track){
  const raw = typeof track === 'object' ? track?.bpm : track;
  const value = Number(String(raw || '').replace(/[^\d.]/g,''));
  return Number.isFinite(value) && value > 0 ? value : null;
}
function parseCamelotKey(key){
  const raw = String(key || '').trim().toUpperCase();
  if(/^(?:[1-9]|1[0-2])[AB]$/.test(raw)) return raw;
  return KEY_TO_CAMELOT[normalizeKeyName(key)] || '';
}
function keyColorClass(key){
  const camelot = parseCamelotKey(key);
  if(!camelot) return 'key-unknown';
  const number = Number(camelot.replace(/[AB]/,''));
  if([1,2].includes(number)) return 'key-violet';
  if([3,4].includes(number)) return 'key-hot';
  if([5,6].includes(number)) return 'key-warm';
  if([7,8].includes(number)) return 'key-green';
  if([9,10].includes(number)) return 'key-cool';
  return 'key-blue';
}
function keyBadgeHtml(key){
  const label = key && key !== '—' ? key : '--';
  return `<span class="key-badge ${keyColorClass(key)}">${esc(label)}</span>`;
}
function trackInitials(track){
  const title = trackTitle(track).replace(/[^a-z0-9 ]/gi,' ').trim();
  const initials = title.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase();
  return initials || 'DJ';
}
function isSafeArtworkSource(src){
  const value = String(src || '').trim();
  if(!value) return false;
  if(/^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(value)) return true;
  if(/^https:\/\/[^\s]+$/i.test(value) && !/(private|signed|token=|service[_-]?key|supabase|storage\/v1)/i.test(value)) return true;
  return false;
}
function secureArtworkSource(track){
  const src = track?.artworkDataUrl || track?.artworkUrl || track?.artwork || '';
  return isSafeArtworkSource(src) ? String(src).trim() : '';
}
function artworkMarkup(track, className='library-art'){
  const src = secureArtworkSource(track);
  if(src) return `<div class="${className}"><img src="${esc(src)}" alt="${esc(trackTitle(track))} artwork"></div>`;
  return `<div class="${className}" aria-label="No secure artwork">${esc(trackInitials(track))}</div>`;
}
function artworkInnerMarkup(track){
  const src = secureArtworkSource(track);
  if(src) return `<img src="${esc(src)}" alt="${esc(trackTitle(track))} artwork">`;
  return esc(trackInitials(track));
}
function isSafePlaybackSource(src){
  const value = String(src || '').trim();
  if(!value) return false;
  if(/^blob:/i.test(value) || /^data:audio\//i.test(value)) return true;
  if(/^https:\/\/[^\s]+$/i.test(value) && !/(private|signed|token=|service[_-]?key|storage\/v1)/i.test(value)) return true;
  return false;
}
function playbackAccessExpired(track, skewMs = 30 * 1000){
  if(!track || !track.playbackExpiresAt) return false;
  const expires = Date.parse(track.playbackExpiresAt);
  return Number.isFinite(expires) && expires <= Date.now() + skewMs;
}
function securePlaybackSource(track){
  if(!track) return '';
  const sessionUrl = librarySessionAudioUrls.get(track.originalId || track.id);
  if(sessionUrl) return sessionUrl;
  if(track.serverBacked && playbackAccessExpired(track)) return '';
  if(track.serverBacked && /^https:\/\//i.test(String(track.securePlaybackUrl || ''))) return String(track.securePlaybackUrl).trim();
  const src = track.securePlaybackUrl || track.previewUrl || track.playbackUrl || '';
  return isSafePlaybackSource(src) ? String(src).trim() : '';
}
function rightsClassificationLabel(value){
  const labels = {
    original:'Original / I Own the Rights',
    licensed:'Licensed / I Have Permission',
    royalty_free:'Royalty-Free / Cleared',
    platform_cleared:'Platform Cleared',
    commercial_copyrighted:'Commercial / Copyrighted Music',
    unknown:'Unknown'
  };
  return labels[value] || value || 'Unknown';
}
function rightsCategoryToClassification(value){
  const text = String(value || '').toLowerCase();
  if(text.includes('original')) return 'original';
  if(text.includes('licensed') || text.includes('permission')) return 'licensed';
  if(text.includes('royalty') || text.includes('cleared')) return 'royalty_free';
  if(text.includes('platform')) return 'platform_cleared';
  if(text.includes('commercial') || text.includes('copyrighted')) return 'commercial_copyrighted';
  return 'unknown';
}
function serverTrackToLocal(track){
  if(!track) return null;
  const rights = rightsClassificationLabel(track.rightsClassification);
  return {
    id: track.id,
    serverBacked: true,
    userId: track.userId,
    title: track.title,
    name: track.title,
    artist: track.artist,
    genre: track.genre || 'Unsorted',
    bpm: track.bpm || '--',
    key: track.key || '--',
    camelotKey: track.camelotKey || parseCamelotKey(track.key),
    duration: track.duration || '--',
    tags: track.tags || [],
    source:'MY_LIBRARY',
    sourceType: track.sourceType || 'track',
    linkedSubmissionId: track.linkedSubmissionId || null,
    visibility: track.visibility || 'private',
    analysisConfidence: track.analysisConfidence == null ? null : track.analysisConfidence,
    fileHash: track.fileHash || null,
    fileSize: track.fileSize == null ? null : track.fileSize,
    rightsClassification: track.rightsClassification || 'unknown',
    rightsCategory: rights,
    battleEligible: !String(rights).toLowerCase().includes('commercial'),
    artworkMetadata: track.artwork || null,
    usageRelationships: track.usageRelationships || { playlists:[], battles:[], posts:[], practiceHistory:[], submissions:[] },
    practiceMetadata: track.practiceMetadata || null,
    analysisSummary: track.analysisSummary || null,
    securePlaybackUrl: track.playbackAccess && track.playbackAccess.url || null,
    playbackExpiresAt: track.playbackAccess && track.playbackAccess.expiresAt || null,
    permissions: defaultPermissions()
  };
}
function serverLibraryId(trackOrId){ return `server:${typeof trackOrId === 'object' ? trackOrId.id : trackOrId}`; }
function localLibraryId(trackOrId){ return `my:${typeof trackOrId === 'object' ? trackOrId.id : trackOrId}`; }
function rawServerId(value){ const id = String(value || ''); return id.startsWith('server:') ? id.slice(7) : id.startsWith('crate:') ? id.slice(6) : id; }
function stableClientIdempotencyKey(prefix, payload){
  const text = `${prefix}:${JSON.stringify(payload || {})}`;
  let hash = 2166136261;
  for(let i=0;i<text.length;i+=1){ hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}
function musicLibraryAccountId(user){ return user && (user.id || user.email) ? String(user.id || user.email) : ''; }
function setMusicLibrarySyncStatus(status, patch = {}){
  state.musicLibrarySync = {
    status,
    accountId: state.musicLibrarySync.accountId || '',
    page: state.musicLibrarySync.page || 1,
    pageSize: state.musicLibrarySync.pageSize || 50,
    hasMore: Boolean(state.musicLibrarySync.hasMore),
    lastSyncedAt: state.musicLibrarySync.lastSyncedAt || null,
    error:'',
    schema: state.musicLibrarySync.schema || null,
    pendingQueue: state.musicLibrarySync.pendingQueue || [],
    ...patch
  };
  persistMusicLibrarySyncState();
  if(state.musicLibrarySync.accountId) localStorage.setItem(`djBattleMusicLibraryQueue:${state.musicLibrarySync.accountId}`, JSON.stringify(state.musicLibrarySync.pendingQueue || []));
  renderMusicLibrarySyncStatus();
}
function renderMusicLibrarySyncStatus(){
  const target = document.getElementById('library-sync-status');
  if(!target) return;
  const status = state.musicLibrarySync.status || 'offline';
  const labels = {
    syncing:['SYNCING', 'Loading protected server library'],
    synced:['SYNCED', state.musicLibrarySync.hasMore ? 'Server cache ready - more pages available' : 'Server-backed library ready'],
    offline:['OFFLINE CACHE', 'Local library active'],
    conflict:['CONFLICT', state.musicLibrarySync.error || 'Server rejected an optimistic change'],
    failed:['FAILED', state.musicLibrarySync.error || 'Server library unavailable']
  };
  const [label, detail] = labels[status] || labels.offline;
  target.className = `library-sync-status ${status}`;
  target.innerHTML = `<span></span><strong>${esc(label)}</strong><small>${esc(detail)}${state.musicLibrarySync.pendingQueue?.length ? ` / ${state.musicLibrarySync.pendingQueue.length} queued` : ''}</small>`;
}
function loadAccountLibraryCache(accountId){
  if(!accountId) return [];
  return sanitizedLibraryForStorage(safeParse(libraryCacheKey(accountId), []))
    .filter(track => track.serverBacked && String(track.userId || '') === String(accountId));
}
function loadAccountCrateCache(accountId){
  if(!accountId) return [];
  return sanitizedCratesForStorage(safeParse(crateCacheKey(accountId), []))
    .filter(crate => crate.serverBacked && String(crate.userId || '') === String(accountId));
}
function clearTrackPlaybackAccess(track){
  if(!track) return track;
  delete track.securePlaybackUrl;
  delete track.playbackUrl;
  delete track.previewUrl;
  delete track.playbackExpiresAt;
  return track;
}
function clearAuthenticatedLibraryData(){
  const removedIds = new Set();
  state.library = state.library.filter(track => {
    if(track.serverBacked){ removedIds.add(serverLibraryId(track)); removedIds.add(localLibraryId(track)); return false; }
    clearTrackPlaybackAccess(track);
    return true;
  });
  if(removedIds.has(state.selectedLibraryTrackId)) state.selectedLibraryTrackId = '';
  if(removedIds.has(state.libraryPlayer.trackId)) state.libraryPlayer = { trackId:'', playing:false, progress:0 };
  Object.keys(state.studioDecks || {}).forEach(deck => {
    if(state.studioDecks[deck] && removedIds.has(state.studioDecks[deck].trackId)) state.studioDecks[deck] = null;
  });
  state.playlists = state.playlists.filter(crate => !crate.serverBacked);
  state.selectedLibraryCrateId = '';
  state.musicLibrarySync.accountId = '';
  state.musicLibrarySync.pendingQueue = [];
  persist();
  persistStudioDeckState();
  persistLibraryUiState();
  setMusicLibrarySyncStatus('offline', { accountId:'', pendingQueue:[], schema:null, error:'' });
  renderLibrary();
  renderStudioLibrary();
  renderProfile();
}
function trackMatchKey(track){
  if(!track) return '';
  if(track.serverBacked) return `server:${track.id}`;
  if(track.linkedSubmissionId) return `submission:${track.linkedSubmissionId}`;
  if(track.fileHash) return `hash:${track.fileHash}`;
  if(track.storageHash) return `hash:${track.storageHash}`;
  const size = track.size || track.fileSize || '';
  return `meta:${String(trackTitle(track)).toLowerCase()}|${String(trackArtist(track)).toLowerCase()}|${String(track.genre || '').toLowerCase()}|${parseBpm(track) || ''}|${normalizeKeyName(track.key)}|${size}`;
}
function serverDuplicateForLocal(localTrack, serverTracks){
  if(!localTrack) return null;
  const metadataKeyFor = track => {
    const size = track?.size || track?.fileSize || '';
    return `meta:${String(trackTitle(track)).toLowerCase()}|${String(trackArtist(track)).toLowerCase()}|${String(track?.genre || '').toLowerCase()}|${parseBpm(track) || ''}|${normalizeKeyName(track?.key)}|${size}`;
  };
  if(localTrack.serverBacked) return serverTracks.find(track => String(track.id) === String(localTrack.id)) || null;
  const keys = new Set([
    localTrack.linkedSubmissionId ? `submission:${localTrack.linkedSubmissionId}` : '',
    localTrack.fileHash ? `hash:${localTrack.fileHash}` : '',
    localTrack.storageHash ? `hash:${localTrack.storageHash}` : '',
    metadataKeyFor(localTrack),
    trackMatchKey(localTrack)
  ].filter(Boolean));
  return serverTracks.find(track => {
    const serverKeys = [
      track.linkedSubmissionId ? `submission:${track.linkedSubmissionId}` : '',
      track.fileHash ? `hash:${track.fileHash}` : '',
      metadataKeyFor(track),
      trackMatchKey(track)
    ].filter(Boolean);
    return serverKeys.some(key => keys.has(key));
  }) || null;
}
function replaceLibraryTrackIds(idMap){
  Object.entries(idMap).forEach(([from, to]) => {
    if(state.selectedLibraryTrackId === from) state.selectedLibraryTrackId = to;
    if(state.libraryPlayer.trackId === from) state.libraryPlayer.trackId = to;
    Object.keys(state.studioDecks || {}).forEach(deck => {
      if(state.studioDecks[deck] && state.studioDecks[deck].trackId === from) state.studioDecks[deck].trackId = to;
    });
    const session = activeStudioBattleSession();
    if(session && session.librarySubmissionTrackId === from){
      session.librarySubmissionTrackId = to;
      window.activeBattleSession = session;
      persistActiveBattleSession(session);
    }
  });
}
function reconcileMusicLibraryTracks(serverTracks, options = {}){
  const accountId = options.accountId || state.musicLibrarySync.accountId;
  const serverLocals = serverTracks.map(serverTrackToLocal).filter(Boolean).map(track => ({ ...track, userId: track.userId || accountId, syncStatus:'synced' }));
  const idMap = {};
  const existingPlayback = new Map(state.library.filter(track => track.serverBacked && track.securePlaybackUrl && !playbackAccessExpired(track)).map(track => [String(track.id), { securePlaybackUrl:track.securePlaybackUrl, playbackExpiresAt:track.playbackExpiresAt }]));
  const appendServers = options.append
    ? state.library.filter(track => track.serverBacked && String(track.userId || '') === String(accountId) && !serverLocals.some(serverTrack => String(serverTrack.id) === String(track.id))).map(track => clearTrackPlaybackAccess({ ...track }))
    : [];
  const serverIds = new Set([...appendServers, ...serverLocals].map(track => String(track.id)));
  const mergedServers = [...appendServers, ...serverLocals.map(track => ({ ...track, ...(existingPlayback.get(String(track.id)) || {}) }))];
  const survivors = [];
  state.library.forEach(localTrack => {
    const oldId = localTrack.serverBacked ? serverLibraryId(localTrack) : localLibraryId(localTrack);
    const duplicate = serverDuplicateForLocal(localTrack, mergedServers);
    if(duplicate){
      idMap[oldId] = serverLibraryId(duplicate);
      idMap[`my:${duplicate.id}`] = serverLibraryId(duplicate);
      return;
    }
    if(localTrack.serverBacked){
      if(!serverIds.has(String(localTrack.id))) return;
      return;
    }
    survivors.push({ ...localTrack, localOnly: Boolean(accountId), syncStatus: accountId ? 'offline' : localTrack.syncStatus });
  });
  state.library = [...mergedServers, ...survivors];
  replaceLibraryTrackIds(idMap);
  persist();
  persistLibraryUiState();
  persistStudioDeckState();
  return { tracks: state.library, idMap };
}
function mergeServerTrack(track){
  const local = serverTrackToLocal(track);
  if(!local) return null;
  const next = { ...local, userId: local.userId || state.musicLibrarySync.accountId, syncStatus:'synced' };
  const idx = state.library.findIndex(item => item.serverBacked && String(item.id) === String(next.id));
  if(idx >= 0) state.library[idx] = { ...state.library[idx], ...next };
  else state.library.unshift(next);
  replaceLibraryTrackIds({ [`my:${next.id}`]: serverLibraryId(next) });
  persist();
  return local;
}
async function checkMusicLibrarySchemaStatus(){
  if(!window.DJBattleApi || !window.DJBattleApi.apiRequest) return { ready:false, status:'offline', message:'Server API unavailable' };
  const response = await window.DJBattleApi.apiRequest('/api/musicLibrary/schemaStatus');
  if(response.error){
    const data = response.data || {};
    return { ready:false, status:data.status || (response.status === 503 ? 'migration_required' : 'failed'), message:data.message || response.error, schema:data.schema || '012_create_music_library_tracks' };
  }
  return response.data || { ready:false, status:'failed', message:'Schema readiness response was empty.' };
}
async function loadServerMusicLibraryTracks(options = {}){
  if(!window.DJBattleApi || !window.DJBattleApi.apiRequest){
    setMusicLibrarySyncStatus('offline', { error:'Server API unavailable' });
    return { skipped:true, error:'Server API unavailable' };
  }
  const accountId = options.accountId || state.musicLibrarySync.accountId;
  if(!accountId){
    setMusicLibrarySyncStatus('offline', { error:'No authenticated account.' });
    return { skipped:true, error:'No authenticated account.' };
  }
  setMusicLibrarySyncStatus('syncing', { accountId, error:'' });
  const schema = await checkMusicLibrarySchemaStatus();
  state.musicLibrarySync.schema = schema;
  if(!schema.ready){
    setMusicLibrarySyncStatus(schema.status === 'offline' ? 'offline' : 'failed', { accountId, schema, error:schema.message || 'Music Library schema is unavailable.' });
    return { error:schema.message || 'Music Library schema is unavailable.', schema };
  }
  const page = Math.max(1, Number(options.page || (options.reset === false ? state.musicLibrarySync.page || 1 : 1)));
  const limit = Math.max(1, Math.min(100, Number(options.limit || state.musicLibrarySync.pageSize || 50)));
  const response = await window.DJBattleApi.apiRequest(`/api/musicLibrary/tracks?limit=${encodeURIComponent(limit)}&page=${encodeURIComponent(page)}`);
  if(response.error){
    setMusicLibrarySyncStatus(response.status === 0 ? 'offline' : 'failed', { accountId, error:response.error, schema });
    return response;
  }
  const serverTracks = response.data && response.data.tracks || [];
  if(options.reset !== false) state.library = state.library.filter(track => !track.serverBacked || String(track.userId || '') !== String(accountId));
  reconcileMusicLibraryTracks(serverTracks, { accountId, append:options.reset === false });
  const pagination = response.data && response.data.pagination || { page, limit, hasMore:false, nextPage:null };
  setMusicLibrarySyncStatus('synced', { accountId, page:pagination.page || page, pageSize:pagination.limit || limit, hasMore:Boolean(pagination.hasMore), lastSyncedAt:new Date().toISOString(), error:'', schema });
  renderLibrary();
  renderStudioLibrary();
  renderProfile();
  await flushMusicLibrarySyncQueue();
  return { data:{ tracks:serverTracks, pagination }, schema };
}
async function hydrateNextMusicLibraryPage(){
  if(!state.musicLibrarySync.hasMore) return { skipped:true };
  return loadServerMusicLibraryTracks({ reset:false, page:(state.musicLibrarySync.page || 1) + 1, limit:state.musicLibrarySync.pageSize });
}

function crateLibraryId(crateOrId){
  const id = typeof crateOrId === 'object' ? crateOrId && crateOrId.id : crateOrId;
  return `crate:${id}`;
}
function smartCrateId(id){ return `smart:${id}`; }
function trackIdForCrateMembership(trackOrId){
  if(typeof trackOrId === 'object' && trackOrId){
    return trackOrId.libraryId || (trackOrId.serverBacked ? serverLibraryId(trackOrId.id) : localLibraryId(trackOrId.id));
  }
  const id = String(trackOrId || '');
  if(id.includes(':')) return id;
  const track = getLibraryTrackById(id);
  return track ? track.libraryId : `server:${id}`;
}
function rawServerTrackIdForMembership(trackOrId){
  const track = typeof trackOrId === 'object' ? trackOrId : getLibraryTrackById(trackOrId);
  if(track && track.serverBacked) return String(track.id);
  const id = String(trackOrId || '');
  return id.startsWith('server:') ? id.slice(7) : '';
}
function crateTrackIds(crate){
  if(!crate) return [];
  if(Array.isArray(crate.trackIds)) return crate.trackIds.map(trackIdForCrateMembership).filter(Boolean);
  if(Array.isArray(crate.items)) return crate.items.map(item => trackIdForCrateMembership(item.id || item.trackId)).filter(Boolean);
  return [];
}
function serverCrateToLocal(crate){
  if(!crate) return null;
  return {
    id: crate.id,
    serverBacked:true,
    userId: crate.userId,
    name: crate.name || 'Untitled Crate',
    description: crate.description || '',
    artwork: crate.artwork || null,
    visibility: crate.visibility || 'private',
    type: crate.type || 'crate',
    parentFolderId: crate.parentFolderId || null,
    smartRules: crate.smartRules || null,
    allowDuplicates: Boolean(crate.allowDuplicates),
    trackIds: (crate.trackIds || []).map(id => `server:${id}`),
    syncVersion: crate.syncVersion || crate.updatedAt || null,
    memberCount: crate.memberCount || (crate.trackIds || []).length,
    createdAt: crate.createdAt || null,
    updatedAt: crate.updatedAt || null,
    syncStatus:'synced'
  };
}
function normalizeLibraryCrate(crate, index = 0){
  const originalId = String(crate && crate.id || `crate-${index}`);
  const builtIn = Boolean(crate && crate.builtIn);
  return {
    ...crate,
    id: originalId,
    crateId: builtIn ? smartCrateId(originalId) : crateLibraryId(originalId),
    name: crate && crate.name || 'Untitled Crate',
    description: crate && crate.description || '',
    type: crate && crate.type || 'crate',
    visibility: crate && crate.visibility || 'private',
    trackIds: crateTrackIds(crate),
    parentFolderId: crate && crate.parentFolderId || null,
    allowDuplicates: Boolean(crate && crate.allowDuplicates),
    _crateIndex:index
  };
}
function smartCratePresets(){
  return [
    { id:'compatible-selected', builtIn:true, name:'Compatible with Selected Track', type:'smart_crate', smartRules:{ preset:'compatible_with_selected' } },
    { id:'recently-added', builtIn:true, name:'Recently Added', type:'smart_crate', smartRules:{ preset:'recently_added' } },
    { id:'missing-analysis', builtIn:true, name:'Missing Analysis', type:'smart_crate', smartRules:{ analysisStatus:'missing' } },
    { id:'original-music', builtIn:true, name:'Original Music', type:'smart_crate', smartRules:{ rightsClassification:'original' } },
    { id:'battle-ready', builtIn:true, name:'Battle Ready', type:'smart_crate', smartRules:{ battleReady:true } }
  ];
}
function allLibraryCrates(){
  return [
    ...smartCratePresets().map((crate, index)=>normalizeLibraryCrate(crate, index)),
    ...state.playlists.map((crate, index)=>normalizeLibraryCrate(crate, index))
  ];
}
function getLibraryCrateById(crateId){
  const id = String(crateId || '');
  return allLibraryCrates().find(crate => crate.crateId === id || crate.id === id) || null;
}
function getEditableLibraryCrate(crateId){
  const id = String(crateId || '');
  const index = state.playlists.findIndex((crate, i) => {
    const rawId = String(crate.id || `crate-${i}`);
    const normalized = crateLibraryId(rawId);
    return normalized === id || rawId === id;
  });
  return index >= 0 ? { crate:state.playlists[index], index } : null;
}
function trackMatchesSmartCrate(track, crate){
  const rules = crate && crate.smartRules || {};
  if(rules.preset === 'compatible_with_selected'){
    const base = getLibraryTrackById(state.selectedLibraryTrackId || state.libraryPlayer.trackId);
    return base ? compatibleTracksFor(base).some(match => match.libraryId === track.libraryId) : false;
  }
  if(rules.preset === 'recently_added'){
    const added = Date.parse(track.createdAt || track.uploadDate || '');
    return Number.isFinite(added) ? Date.now() - added <= 30 * 24 * 60 * 60 * 1000 : true;
  }
  if(rules.bpmMin != null && (!parseBpm(track) || parseBpm(track) < Number(rules.bpmMin))) return false;
  if(rules.bpmMax != null && (!parseBpm(track) || parseBpm(track) > Number(rules.bpmMax))) return false;
  if(rules.genre && String(track.genre || '').toLowerCase() !== String(rules.genre).toLowerCase()) return false;
  if(rules.mediaType && String(track.sourceType || '').toLowerCase() !== String(rules.mediaType).toLowerCase()) return false;
  if(rules.rightsClassification && String(track.rightsClassification || '').toLowerCase() !== String(rules.rightsClassification).toLowerCase()) return false;
  if(rules.visibility && String(track.visibility || '').toLowerCase() !== String(rules.visibility).toLowerCase()) return false;
  if(rules.analysisStatus === 'missing' && track.analysisConfidence != null) return false;
  if(rules.analysisStatus === 'analyzed' && track.analysisConfidence == null) return false;
  if(rules.battleReady != null && Boolean(track.battleEligible) !== Boolean(rules.battleReady)) return false;
  if(rules.key && normalizeKeyName(track.key) !== normalizeKeyName(rules.key)) return false;
  if(rules.camelotKey && parseCamelotKey(track.key) !== String(rules.camelotKey).toUpperCase()) return false;
  if(rules.compatibleWithTrackId){
    const base = getLibraryTrackById(trackIdForCrateMembership(rules.compatibleWithTrackId));
    if(!base || !bpmCompatible(base, track) || !keyCompatible(base, track)) return false;
  }
  return true;
}
function resolveCrateTrackIds(crateOrId){
  const crate = typeof crateOrId === 'string' ? getLibraryCrateById(crateOrId) : normalizeLibraryCrate(crateOrId || {});
  if(!crate) return [];
  if(crate.type === 'smart_crate') return allLibraryTracks().filter(track => trackMatchesSmartCrate(track, crate)).map(track => track.libraryId);
  return crateTrackIds(crate);
}
function activeEditableCrate(){
  const crate = getLibraryCrateById(state.libraryFilters.crate);
  return crate && !crate.builtIn ? crate : null;
}
function crateEditorActiveFor(crate){
  return Boolean(crate && !crate.builtIn && state.crateEditor.editing && state.libraryFilters.crate === crate.crateId);
}
function setCrateEditorMode(enabled, crateId = state.libraryFilters.crate){
  const crate = getLibraryCrateById(crateId);
  state.crateEditor.editing = Boolean(enabled && crate && !crate.builtIn);
  if(crate && state.crateEditor.editing){
    state.libraryFilters.crate = crate.crateId;
    state.selectedLibraryCrateId = crate.crateId;
  } else {
    state.crateEditor.selectedTrackIds = [];
    state.crateEditor.anchorTrackId = '';
    state.crateEditor.dragTrackId = '';
    state.crateEditor.dragOverTrackId = '';
  }
  persist();
  renderLibrary();
  return state.crateEditor.editing;
}
function pushCrateUndo(crateId, beforeTrackIds, action){
  const crate = getLibraryCrateById(crateId);
  if(!crate || crate.builtIn) return;
  state.crateEditor.undoStack = [{
    crateId:crate.crateId,
    trackIds:(beforeTrackIds || crateTrackIds(crate)).slice(),
    action:action || 'edit',
    savedAt:new Date().toISOString()
  }];
}
function currentCrateRows(crate){
  const ids = resolveCrateTrackIds(crate);
  return ids.map(id => getLibraryTrackById(id)).filter(Boolean);
}
function selectCrateTrack(trackId, options = {}){
  const crate = activeEditableCrate();
  if(!crate) return [];
  const id = trackIdForCrateMembership(trackId);
  const order = resolveCrateTrackIds(crate);
  let selected = new Set(state.crateEditor.selectedTrackIds || []);
  if(options.selectAll){
    selected = new Set(order);
  }else if(options.shift && state.crateEditor.anchorTrackId){
    const a = order.indexOf(state.crateEditor.anchorTrackId);
    const b = order.indexOf(id);
    if(a >= 0 && b >= 0){
      const [from, to] = a < b ? [a, b] : [b, a];
      order.slice(from, to + 1).forEach(item => selected.add(item));
    }else{
      selected.add(id);
    }
  }else if(options.ctrl || options.meta || options.toggle){
    if(selected.has(id)) selected.delete(id);
    else selected.add(id);
    state.crateEditor.anchorTrackId = id;
  }else{
    selected = new Set([id]);
    state.crateEditor.anchorTrackId = id;
  }
  state.crateEditor.selectedTrackIds = Array.from(selected).filter(item => order.includes(item));
  persistCrateEditorState();
  renderLibrary();
  return state.crateEditor.selectedTrackIds;
}
function selectAllCrateTracks(){
  return selectCrateTrack('', { selectAll:true });
}
function clearCrateSelection(){
  state.crateEditor.selectedTrackIds = [];
  state.crateEditor.anchorTrackId = '';
  persistCrateEditorState();
  renderLibrary();
}
async function reorderCrateTrack(crateId, trackId, directionOrTarget, placement = 'before'){
  const crate = getLibraryCrateById(crateId);
  if(!crate || crate.builtIn) return { ok:false, error:'Choose an editable crate.' };
  const before = crateTrackIds(crate);
  const moving = trackIdForCrateMembership(trackId);
  const order = before.filter(id => id !== moving);
  if(!before.includes(moving)) return { ok:false, error:'Track is not in this crate.' };
  if(directionOrTarget === 'up' || directionOrTarget === 'down'){
    const index = before.indexOf(moving);
    const targetIndex = directionOrTarget === 'up' ? Math.max(0, index - 1) : Math.min(before.length - 1, index + 1);
    order.splice(targetIndex, 0, moving);
  }else{
    const target = trackIdForCrateMembership(directionOrTarget);
    const targetIndex = Math.max(0, order.indexOf(target));
    order.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, moving);
  }
  const result = await setCrateTrackOrder(crate.crateId, order, { reason:'reorder' });
  state.crateEditor.dragTrackId = '';
  state.crateEditor.dragOverTrackId = '';
  return result;
}
async function undoLastCrateEdit(){
  const last = (state.crateEditor.undoStack || []).slice(-1)[0];
  if(!last) return { ok:false, error:'No crate edit to undo.' };
  state.crateEditor.undoStack = [];
  const result = await setCrateTrackOrder(last.crateId, last.trackIds, { skipUndo:true, reason:'undo' });
  persistCrateEditorState();
  return result;
}
function mergeConflictingCrateOrder(localIds, serverIds){
  const merged = [];
  [...serverIds, ...localIds].forEach(id => {
    const normalized = trackIdForCrateMembership(id);
    if(normalized && !merged.includes(normalized)) merged.push(normalized);
  });
  return merged;
}
function replacementSuggestionsForTrack(track, session = activeStudioBattleSession()){
  const candidates = allLibraryTracks()
    .filter(candidate => candidate.libraryId !== track.libraryId && candidate._libraryOrigin === 'my')
    .filter(candidate => libraryTrackLoadEligibility(candidate, 'a', session).allowed)
    .map(candidate => ({
      track:candidate,
      compatible:bpmCompatible(track, candidate) && keyCompatible(track, candidate),
      bpmDelta: parseBpm(track) && parseBpm(candidate) ? Math.abs(parseBpm(track) - parseBpm(candidate)) : 99
    }))
    .sort((a, b) => Number(b.compatible) - Number(a.compatible) || a.bpmDelta - b.bpmDelta)
    .slice(0, 3);
  return candidates.map(item => ({
    libraryId:item.track.libraryId,
    title:trackTitle(item.track),
    bpm:parseBpm(item.track) || item.track.bpm || '--',
    key:item.track.key || '--',
    compatible:item.compatible
  }));
}
function validateBattlePrepCrate(crateId, session = activeStudioBattleSession()){
  const crate = getLibraryCrateById(crateId);
  if(!crate || crate.type !== 'battle_prep') return { ready:false, crateId, summary:'Choose a Battle Prep crate.', rows:[], blockers:['Choose a Battle Prep crate.'] };
  const mode = currentBattleModeConfig(session);
  const ordered = resolveCrateTrackIds(crate);
  const tracks = ordered.map(id => getLibraryTrackById(id)).filter(Boolean);
  const blockers = [];
  const warnings = [];
  if(!session) warnings.push('No active battle selected. Studio can open in free mode.');
  if(session && !mode) blockers.push('Active battle mode is unavailable.');
  if(mode && mode.premiumRequired && !state.premium) blockers.push('This Battle Prep crate targets a Premium battle mode.');
  const assigned = (session && (session.assigned || session.assignedTracks) || []).map(normalizedBattleTrackName).filter(Boolean);
  const presentTitles = new Set(tracks.map(track => normalizedBattleTrackName(trackTitle(track))));
  assigned.forEach(title => { if(!presentTitles.has(title)) blockers.push(`Missing assigned track: ${title}`); });
  const rows = tracks.map((track, index) => {
    const eligibility = libraryTrackLoadEligibility(track, index === 1 ? 'b' : 'a', session);
    const reasons = [];
    let status = 'ready';
    if(!eligibility.allowed){ status = 'blocked'; reasons.push(eligibility.reason); }
    if(track.analysisConfidence == null){
      if(status !== 'blocked') status = 'warning';
      reasons.push('Analysis is missing or still pending.');
    }
    if(!securePlaybackSource(track) && track.serverBacked){
      if(status !== 'blocked') status = 'warning';
      reasons.push('Playback access may need refresh before listening.');
    }
    if(status === 'blocked') blockers.push(`${trackTitle(track)}: ${reasons[0]}`);
    if(status === 'warning') warnings.push(`${trackTitle(track)}: ${reasons[0]}`);
    return {
      index,
      libraryId:track.libraryId,
      title:trackTitle(track),
      artist:trackArtist(track),
      bpm:parseBpm(track) || track.bpm || '--',
      key:track.key || '--',
      status,
      reasons,
      suggestions:status === 'blocked' ? replacementSuggestionsForTrack(track, session) : []
    };
  });
  if(!rows.length) blockers.push('Battle Prep crate has no tracks.');
  const ready = blockers.length === 0;
  const validation = {
    crateId:crate.crateId,
    ready,
    rows,
    warnings,
    blockers,
    summary: ready ? `${rows.length} tracks ready for ${mode && mode.label || 'Studio'}.` : `${blockers.length} blockers before Studio.`
  };
  state.crateEditor.validation = validation;
  persistCrateEditorState();
  renderLibrary();
  return validation;
}
function openBattlePrepCrateInStudio(crateId, deck='a'){
  const validation = validateBattlePrepCrate(crateId);
  if(!validation.ready){
    setStudioRuleStatus(validation.summary, 'denied');
    return { ok:false, validation };
  }
  state.studioLibraryDrawer = { open:true, deck: deck === 'b' ? 'b' : 'a', battlePrepCrateId:validation.crateId, validatedOrder:validation.rows.map(row => row.libraryId) };
  renderStudioLibraryDrawer();
  switchView('studio');
  setStudioRuleStatus('Battle Prep crate validated and loaded into the Studio drawer.', 'ok');
  return { ok:true, validation };
}

const BATTLE_PREP_PERSONAL_METHODS = new Set(['own_selection', 'genre_pool', 'open_library', 'ai_practice']);

function ownedBattlePrepCrates(){
  const ownerId = state.musicLibrarySync.accountId || currentProfileUserId();
  return allLibraryCrates().filter(crate => {
    if(!crate || crate.builtIn || crate.type !== 'battle_prep') return false;
    if(crate.userId && String(crate.userId) !== String(ownerId)) return false;
    return true;
  });
}

function battlePrepCrateSelectHtml(selected = ''){
  const crates = ownedBattlePrepCrates();
  const options = ['<option value="">No Battle Prep crate</option>'].concat(
    crates.map(crate => `<option value="${esc(crate.crateId)}" ${crate.crateId === selected ? 'selected' : ''}>${esc(crate.name)} (${resolveCrateTrackIds(crate).length})</option>`)
  ).join('');
  return options;
}

function battlePrepPurposeForBattle(battleLike){
  const mode = BattleModes.getBattleMode(battleLike && (battleLike.modeId || battleLike.type || battleLike.mode));
  const method = battleLike && battleLike.trackSelectionMethod || mode && mode.trackSelectionMethod || 'assigned';
  if(BATTLE_PREP_PERSONAL_METHODS.has(method)) return 'own_selection';
  if(method === 'assigned') return 'reference';
  return 'reference';
}

function battlePrepRequiredTrackCount(battleLike){
  const mode = BattleModes.getBattleMode(battleLike && (battleLike.modeId || battleLike.type || battleLike.mode));
  const method = battleLike && battleLike.trackSelectionMethod || mode && mode.trackSelectionMethod || 'assigned';
  if(method === 'assigned') return 0;
  return Number(battleLike && (battleLike.trackCount || battleLike.minimumTrackCount) || mode && (mode.trackCount || mode.minimumTrackCount) || 1);
}

function syntheticBattleSessionForCrate(battleLike){
  const mode = BattleModes.getBattleMode(battleLike && (battleLike.modeId || battleLike.type || battleLike.mode));
  return {
    id: battleLike && battleLike.id || 'battle-prep-validation',
    battleId: battleLike && battleLike.id || 'battle-prep-validation',
    modeId: battleLike && battleLike.modeId || mode && mode.id || 'transition_battle',
    mode: battleLike && (battleLike.type || battleLike.mode) || mode && mode.label || 'Battle',
    title: battleLike && battleLike.title || mode && mode.label || 'Battle',
    genre: battleLike && battleLike.genre || mode && mode.defaultGenre || 'Open Format',
    duration: Number(battleLike && (battleLike.durationMinutes || battleLike.duration) || mode && mode.defaultDurationMinutes || 10),
    assigned: battleLike && (battleLike.assignedTracks || battleLike.assigned) || [],
    reward: battleLike && battleLike.reward || mode && { type:mode.rewardType, metadata:{ ...(mode.rewardMetadata || {}) } } || null
  };
}

function validateBattlePrepCrateForBattle(crateId, battleLike, options = {}){
  const selectedId = String(crateId || '');
  const purpose = options.purpose || battlePrepPurposeForBattle(battleLike);
  if(!selectedId) return { ready:true, optional:true, crateId:'', purpose, summary:'No Battle Prep crate selected.', rows:[], blockers:[], warnings:[] };
  const crate = getLibraryCrateById(selectedId);
  const mode = BattleModes.getBattleMode(battleLike && (battleLike.modeId || battleLike.type || battleLike.mode));
  const session = syntheticBattleSessionForCrate(battleLike);
  const ownerId = state.musicLibrarySync.accountId || currentProfileUserId();
  const blockers = [];
  const warnings = [];
  if(!crate || crate.type !== 'battle_prep') blockers.push('Choose an owned Battle Prep crate.');
  if(crate && crate.userId && String(crate.userId) !== String(ownerId)) blockers.push('This Battle Prep crate belongs to another DJ.');
  if(mode && mode.premiumRequired && !state.premium) blockers.push('This battle mode requires Premium.');
  if(!mode) blockers.push('Battle mode is unavailable.');
  const ordered = crate ? resolveCrateTrackIds(crate) : [];
  const requiredCount = purpose === 'own_selection' ? battlePrepRequiredTrackCount(battleLike) : 0;
  if(requiredCount && ordered.length < requiredCount) blockers.push(`Battle Prep crate needs at least ${requiredCount} eligible track(s).`);
  const rows = ordered.map((id, index) => {
    const track = getLibraryTrackById(id);
    const reasons = [];
    let status = 'ready';
    let eligibility = { allowed:true, reason:'Reference material is allowed for prep only.' };
    if(!track){
      status = 'blocked';
      reasons.push('Approved track is unavailable in this library cache.');
    }else{
      if(purpose === 'own_selection'){
        eligibility = libraryTrackLoadEligibility(track, index === 1 ? 'b' : 'a', session);
      }else{
        if(!trackIsOwnedOrPublic(track)) eligibility = { allowed:false, reason:'Private tracks from another DJ cannot be used as prep material.' };
        else if(!trackRightsPermitBattle(track)) eligibility = { allowed:false, reason:'Track rights do not permit battle preparation.' };
        const durationSeconds = parseDurationSeconds(track.duration);
        const maxSeconds = Number(session.duration || 0) * 60;
        if(eligibility.allowed && durationSeconds && maxSeconds && durationSeconds > maxSeconds + 5) eligibility = { allowed:false, reason:'Track duration exceeds the active battle window.' };
      }
      if(!eligibility.allowed){
        status = 'blocked';
        reasons.push(eligibility.reason);
      }
      if(purpose === 'reference') reasons.push('Reference crate does not replace assigned battle tracks.');
      if(track.analysisConfidence == null){
        if(status !== 'blocked') status = 'warning';
        reasons.push('Analysis is missing or still pending.');
      }
      if(track.serverBacked && !securePlaybackSource(track)){
        if(status !== 'blocked') status = 'warning';
        reasons.push('Playback access may need refresh before listening.');
      }
    }
    if(status === 'blocked') blockers.push(`${track ? trackTitle(track) : id}: ${reasons[0]}`);
    if(status === 'warning') warnings.push(`${trackTitle(track)}: ${reasons[0]}`);
    return {
      index,
      libraryId:id,
      title:track ? trackTitle(track) : 'Unavailable track',
      artist:track ? trackArtist(track) : 'Unknown Artist',
      bpm:track ? parseBpm(track) || track.bpm || '--' : '--',
      key:track ? track.key || '--' : '--',
      camelotKey:track ? track.camelotKey || parseCamelotKey(track.key) : '',
      genre:track ? track.genre || 'Unsorted' : 'Unsorted',
      duration:track ? track.duration || '--' : '--',
      status,
      reasons:reasons.length ? reasons : ['Ready for battle rules.'],
      analysisConfidence:track && track.analysisConfidence == null ? null : track && track.analysisConfidence,
      rightsClassification:track && (track.rightsClassification || rightsCategoryToClassification(track.rightsCategory)),
      suggestions:status === 'blocked' && track ? replacementSuggestionsForTrack(track, session) : []
    };
  });
  if(crate && !rows.length) blockers.push('Battle Prep crate has no tracks.');
  const ready = blockers.length === 0;
  return {
    ready,
    optional:false,
    crateId:crate ? crate.crateId : selectedId,
    crateName:crate && crate.name || 'Battle Prep crate',
    crateVersion:crate && (crate.syncVersion || crate.updatedAt || crate.createdAt || crateTrackIds(crate).join('|')) || null,
    purpose,
    replacementAllowed: purpose !== 'assigned_required',
    requiredCount,
    rows,
    blockers,
    warnings,
    summary: ready
      ? `${rows.length} ${purpose === 'reference' ? 'reference' : 'own-selection'} track(s) validated.`
      : `${blockers.length} blocker(s) before battle entry.`
  };
}

function battlePrepEntryValidationHtml(validation){
  if(!validation || validation.optional) return '<small style="color:var(--muted)">Select a Battle Prep crate to validate a private entry snapshot.</small>';
  const level = validation.ready ? (validation.warnings && validation.warnings.length ? 'warning' : 'ready') : 'blocked';
  const rows = validation.rows || [];
  return `<div class="battle-prep-validation ${validation.ready ? 'ready' : 'blocked'}">
    <div class="crate-validation-summary"><strong>${esc(level.toUpperCase())}</strong><small>${esc(validation.summary)}</small></div>
    <div class="crate-validation-list">${rows.map(row=>`
      <div class="crate-validation-row ${esc(row.status)}">
        <span>${esc(row.status.toUpperCase())}</span>
        <b>${esc(row.title)}</b>
        <em>${esc(row.bpm)} BPM / ${keyBadgeHtml(row.key)}</em>
        <small>${esc((row.reasons || [])[0] || 'Ready for battle rules.')}</small>
      </div>`).join('')}</div>
  </div>`;
}

function battlePrepServerApiAvailable(){
  return Boolean(state.musicLibrarySync.accountId && window.DJBattleApi && typeof window.DJBattleApi.apiRequest === 'function');
}

function serverBackedBattlePrepCrate(crateId){
  const crate = getLibraryCrateById(crateId);
  return crate && crate.serverBacked ? crate : null;
}

function serverBattlePrepSnapshotToLocal(snapshot, battleLike, fallback = {}){
  if(!snapshot) return null;
  const tracks = (snapshot.tracks || []).map((row, index) => {
    const libraryId = row.libraryId || row.libraryTrackId ? serverLibraryId(row.libraryId || row.libraryTrackId) : '';
    const local = getLibraryTrackById(libraryId);
    return {
      order:Number(row.order == null ? index + 1 : row.order + 1),
      libraryId,
      title:local ? trackTitle(local) : 'Track unavailable',
      artist:local ? trackArtist(local) : 'Server library track',
      bpm:row.bpm || local && local.bpm || '--',
      key:row.key || local && local.key || '--',
      camelotKey:row.camelotKey || local && local.camelotKey || parseCamelotKey(row.key),
      genre:row.genre || local && local.genre || 'Unsorted',
      duration:row.duration || local && local.duration || '--',
      status:row.status || row.availability || 'ready',
      reasons:row.reasons || [],
      analysisConfidence:row.analysisConfidence == null ? local && local.analysisConfidence : row.analysisConfidence,
      rightsClassification:row.rightsClassification || local && local.rightsClassification || 'unknown'
    };
  });
  return {
    id:snapshot.snapshotId || snapshot.id,
    snapshotId:snapshot.snapshotId || snapshot.id,
    snapshotVersion:snapshot.snapshotVersion || snapshot.version || null,
    source:'server_battle_prep_snapshot',
    serverBacked:true,
    syncStatus:'server',
    userId:String(snapshot.userId || currentProfileUserId()),
    battleId:snapshot.battleId || battleLike && (battleLike.id || battleLike.battleId) || null,
    battleEntryId:snapshot.battleEntryId || null,
    crateId:snapshot.crateId ? crateLibraryId(rawServerId(snapshot.crateId)) : fallback.crateId || null,
    crateName:fallback.crateName || 'Server Battle Prep snapshot',
    crateVersion:snapshot.crateVersion || null,
    purpose:snapshot.purpose,
    createdAt:snapshot.createdAt || new Date().toISOString(),
    replacementAllowed:Boolean(snapshot.replacementAllowed),
    availability:snapshot.availability || null,
    replacements:snapshot.replacements || [],
    battleRules:{
      battleId:snapshot.battleId || battleLike && battleLike.id || null,
      modeId:battleLike && battleLike.modeId || snapshot.ruleDecisions && snapshot.ruleDecisions.modeId || null,
      trackSelectionMethod:snapshot.trackSelectionMethod || battleLike && battleLike.trackSelectionMethod || null,
      genre:battleLike && battleLike.genre || null,
      durationMinutes:Number(battleLike && (battleLike.durationMinutes || battleLike.duration) || 0)
    },
    ruleDecisions:snapshot.ruleDecisions || {},
    tracks
  };
}

async function createAuthenticatedBattleWithPrepSnapshot(draft, selectedCrateId, localBattle, validation){
  if(!battlePrepServerApiAvailable()) return { skipped:true, reason:'server_unavailable' };
  const crate = selectedCrateId ? serverBackedBattlePrepCrate(selectedCrateId) : null;
  if(selectedCrateId && !crate) return { skipped:true, reason:'local_crate' };
  const body = {
    ...draft,
    battleId:localBattle.id,
    crateId:crate ? rawServerId(crate.id) : null,
    purpose:validation && validation.purpose,
    idempotencyKey:stableClientIdempotencyKey('battle-create', { userId:state.musicLibrarySync.accountId, battleId:localBattle.id, crateId:crate && crate.id }),
    isPremium:Boolean(state.premium),
    publicProfile:{
      name:currentUser().displayName,
      country:document.getElementById('profile-country')?.textContent || '',
      belt:document.getElementById('profile-belt')?.textContent || '',
      rating:state.battleProgress && state.battleProgress.rankingRating || null
    }
  };
  const response = await window.DJBattleApi.apiRequest('/api/battles/withPrepSnapshot', { method:'POST', body });
  if(response.error){
    if(response.status === 0 || response.status === 503) return { skipped:true, reason:'offline', response };
    return { error:response.error, response };
  }
  const battle = BattleModes.normalizeBattleRecord({ ...localBattle, id:response.data.battle.id, status:response.data.battle.status || localBattle.status });
  const snapshot = serverBattlePrepSnapshotToLocal(response.data.snapshot, battle, { crateId:selectedCrateId, crateName:validation && validation.crateName });
  const withSnapshot = snapshot ? attachBattlePrepSnapshotToBattle(battle, snapshot, currentProfileUserId(), response.data.entry) : battle;
  return { battle:withSnapshot, entry:response.data.entry, snapshot, response };
}

async function joinAuthenticatedBattleWithPrepSnapshot(battle, selectedCrateId, validation){
  if(!battlePrepServerApiAvailable()) return { skipped:true, reason:'server_unavailable' };
  const crate = selectedCrateId ? serverBackedBattlePrepCrate(selectedCrateId) : null;
  if(selectedCrateId && !crate) return { skipped:true, reason:'local_crate' };
  const body = {
    crateId:crate ? rawServerId(crate.id) : null,
    purpose:validation && validation.purpose,
    idempotencyKey:stableClientIdempotencyKey('battle-join', { userId:state.musicLibrarySync.accountId, battleId:battle.id, crateId:crate && crate.id })
  };
  const response = await window.DJBattleApi.apiRequest(`/api/battles/${encodeURIComponent(battle.id)}/join`, { method:'POST', body });
  if(response.error){
    if(response.status === 0 || response.status === 503) return { skipped:true, reason:'offline', response };
    return { error:response.error, response };
  }
  const snapshot = serverBattlePrepSnapshotToLocal(response.data.snapshot, battle, { crateId:selectedCrateId, crateName:validation && validation.crateName });
  return { battle:response.data && response.data.battle || null, entry:response.data.entry, snapshot, response };
}

async function hydrateServerBattlePrepSnapshot(entryId, options = {}){
  if(!battlePrepServerApiAvailable() || !entryId) return { skipped:true };
  const response = await window.DJBattleApi.apiRequest(`/api/battleEntries/${encodeURIComponent(entryId)}/prepSnapshot`);
  if(response.error) return response;
  const serverSnapshot = response.data && response.data.snapshot;
  if(serverSnapshot && serverSnapshot.userId && state.musicLibrarySync.accountId && String(serverSnapshot.userId) !== String(state.musicLibrarySync.accountId)){
    return { forbidden:true, error:'Server Battle Prep snapshot belongs to a different DJ account.' };
  }
  const session = options.session || activeStudioBattleSession();
  const snapshot = serverBattlePrepSnapshotToLocal(serverSnapshot, session || {}, {});
  if(!snapshot) return { unavailable:true };
  const battleId = snapshot.battleId || session && (session.battleId || session.id);
  const idx = battles.findIndex(item => String(item.id) === String(battleId));
  if(idx >= 0){
    battles[idx] = attachBattlePrepSnapshotToBattle(battles[idx], snapshot, currentProfileUserId(), response.data && response.data.entry);
    persistBattles();
  }
  if(session && String(session.battleId || session.id) === String(battleId)){
    session.entries = {
      ...(session.entries || {}),
      [currentProfileUserId()]: {
        ...((session.entries || {})[currentProfileUserId()] || {}),
        battlePrepSnapshot:snapshot,
        battlePrepSnapshotId:snapshot.id,
        battlePrepSnapshotVersion:snapshot.snapshotVersion,
        serverBattleEntryId:snapshot.battleEntryId || entryId,
        battleEntryId:snapshot.battleEntryId || entryId
      }
    };
    session.battlePrepSnapshot = snapshot;
    session.battlePrepSnapshotId = snapshot.id;
    session.battlePrepSnapshotVersion = snapshot.snapshotVersion;
    session.battleEntryId = snapshot.battleEntryId || entryId;
    session.battlePrepSyncStatus = 'server';
    window.activeBattleSession = session;
    persistActiveBattleSession(session);
    renderBattleRoom(session);
    recoverBattlePrepSnapshotInStudio(session);
  }
  return { snapshot, response };
}

function serverRecoveredBattleToLocal(item){
  const row = item && item.battle || {};
  const entry = item && item.entry || {};
  const record = BattleModes.normalizeBattleRecord({
    id:row.id,
    modeId:row.modeId,
    title:row.title,
    genre:row.genre,
    durationMinutes:row.durationMinutes,
    trackSelectionMethod:row.trackSelectionMethod,
    trackCount:row.trackCount,
    minimumTrackCount:row.minimumTrackCount,
    opponentRequirement:row.opponentRequirement,
    reward:row.reward,
    status:row.status || 'open',
    visibility:'public',
    people:item && item.participants ? 1 + (item.participants.opponents || []).length : 1
  });
  let battle = {
    ...record,
    serverBacked:true,
    lobbyStatus:row.status,
    scoringType:row.scoringType,
    creatorPublicProfile:row.creatorPublicProfile || {},
    bitcoinRewardMetadata:row.bitcoinRewardMetadata || null,
    battleEntryId:entry.id,
    battlePrepSnapshotVersion:item && item.snapshot && item.snapshot.snapshotVersion || null,
    submissionStatus:item && item.submission && item.submission.status || null
  };
  const snapshot = serverBattlePrepSnapshotToLocal(item && item.snapshot, battle, {});
  if(snapshot) battle = attachBattlePrepSnapshotToBattle(battle, snapshot, currentProfileUserId(), entry);
  return { battle, snapshot, entry, submission:item && item.submission || null, participants:item && item.participants || {} };
}

function recoveredBattleSession(recovered, existingSession = null){
  const battle = recovered.battle;
  const snapshot = recovered.snapshot || battlePrepSnapshotForUser(battle);
  const opponentProfile = recovered.participants && recovered.participants.opponents && recovered.participants.opponents[0] && recovered.participants.opponents[0].profile || null;
  return {
    ...(existingSession || {}),
    id:battle.id,
    battleId:battle.id,
    modeId:battle.modeId,
    title:battle.title || 'Battle',
    mode:battle.type || battle.modeId || 'Battle',
    genre:battle.genre || 'Global',
    duration:battle.durationMinutes || parseMinutes(battle.time) || 10,
    assigned:existingSession && existingSession.assigned || resolveBattleTracks(battle),
    opponent:opponentProfile && opponentProfile.name && opponentProfile.name !== 'DJ' ? {
      name:opponentProfile.name,
      country:opponentProfile.country || '',
      belt:opponentProfile.belt || '',
      record:opponentProfile.rating ? String(opponentProfile.rating) : ''
    } : existingSession && existingSession.opponent || null,
    entries:battle.entries || existingSession && existingSession.entries || {},
    battlePrepSnapshot:snapshot,
    battlePrepSnapshotId:snapshot && snapshot.id || null,
    battlePrepSnapshotVersion:snapshot && snapshot.snapshotVersion || null,
    battleEntryId:recovered.entry && recovered.entry.id || snapshot && snapshot.battleEntryId || existingSession && existingSession.battleEntryId || null,
    battlePrepSyncStatus:snapshot && snapshot.syncStatus || existingSession && existingSession.battlePrepSyncStatus || 'server',
    startedAt:existingSession && existingSession.startedAt || battle.startedAt || null,
    status:battle.status || existingSession && existingSession.status || 'waiting',
    submissionId:recovered.submission && recovered.submission.id || existingSession && existingSession.submissionId || null
  };
}

async function recoverServerBattleRoom(options = {}){
  if(!battlePrepServerApiAvailable()) return { skipped:true, reason:'auth_unavailable' };
  state.battleLobby.recoveryStatus = 'syncing';
  const response = await window.DJBattleApi.apiRequest('/api/battles/recovery?limit=20');
  if(response.error){
    state.battleLobby.recoveryStatus = 'failed';
    state.battleLobby.error = response.error;
    return { error:response.error, response };
  }
  const recovered = (response.data && response.data.battles || []).map(serverRecoveredBattleToLocal);
  recovered.forEach(item => {
    const idx = battles.findIndex(battle => String(battle.id) === String(item.battle.id));
    if(idx >= 0) battles[idx] = { ...battles[idx], ...item.battle, entries:item.battle.entries || battles[idx].entries };
    else battles.unshift(item.battle);
  });
  persistBattles();
  state.battleLobby.recoveryStatus = 'synced';
  const existing = options.session || activeStudioBattleSession() || safeParse('djBattleActiveSession', null);
  const target = recovered.find(item => existing && String(item.battle.id) === String(existing.battleId || existing.id)) || recovered.find(item => !['cancelled','completed'].includes(item.battle.status)) || recovered[0];
  if(target){
    const session = recoveredBattleSession(target, existing && String(target.battle.id) === String(existing.battleId || existing.id) ? existing : null);
    window.activeBattleSession = session;
    persistActiveBattleSession(session);
    renderBattleRoom(session);
    recoverBattlePrepSnapshotInStudio(session);
  }
  renderBattles();
  return { recovered, response };
}

let battleRoomPollTimer = null;
let battleRoomHeartbeatTimer = null;

function battleRoomServerApiAvailable(){
  return battlePrepServerApiAvailable();
}

function livePollingDisabledForTest(){
  return typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '') && !state.battleRoomSync.forcePolling;
}

function ensureBattleRoomLivePanel(){
  if(document.getElementById('br-live-panel')) return;
  const meta = document.getElementById('br-meta');
  if(!meta || !meta.parentElement) return;
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.id = 'br-live-panel';
  panel.style.marginTop = '12px';
  panel.innerHTML = `<span class="eyebrow">LIVE SYNC</span><div class="battle-meta" style="margin-top:8px"><div><span>Connection</span><strong id="br-live-status">Offline</strong></div><div><span>Version</span><strong id="br-live-version">0</strong></div></div><div id="br-live-participants" style="margin-top:10px;display:grid;gap:8px"></div><div class="modal-actions" style="margin-top:10px"><button class="primary" type="button" id="br-ready">Ready</button><button class="ghost" type="button" id="br-not-ready">Not Ready</button><button class="ghost" type="button" id="br-server-start">Start Server Battle</button><button class="ghost" type="button" id="br-cancel">Cancel</button><button class="ghost" type="button" id="br-withdraw">Withdraw</button></div>`;
  meta.parentElement.appendChild(panel);
}

function renderBattleRoomLiveState(session){
  ensureBattleRoomLivePanel();
  const status = document.getElementById('br-live-status');
  if(status) status.textContent = formatBattleStatus(state.battleRoomSync.status || session.liveStatus || 'offline');
  const version = document.getElementById('br-live-version');
  if(version) version.textContent = String(session.battleVersion || state.battleRoomSync.battleVersion || 0);
  const participants = document.getElementById('br-live-participants');
  if(participants){
    const rows = (session.liveParticipants || []).map((participant, index) => {
      const label = participant.profile && participant.profile.name || (index === 0 ? 'You' : 'Opponent');
      const presence = participant.presence && participant.presence.status || 'unknown';
      const submitted = participant.submission && participant.submission.submitted || participant.submitted;
      return `<div class="track" style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center"><div><strong>${esc(label)}</strong><div style="color:var(--muted);font-size:12px">${esc(formatBattleStatus(participant.status))} | ${esc(formatBattleStatus(presence))}${submitted?' | Submitted':''}</div></div><span class="tag">${participant.ready?'READY':'WAIT'}</span></div>`;
    });
    participants.innerHTML = rows.join('') || '<div style="color:var(--muted)">Server room sync is waiting for authenticated participants.</div>';
  }
  renderBattleRoomChallengeNotice(session);
}

function renderBattleRoomChallengeNotice(session){
  const livePanel = document.getElementById('br-live-panel');
  if(!livePanel || !livePanel.parentElement) return;
  let notice = document.getElementById('br-challenge-notice');
  const text = session && session.challengeNotice;
  if(!text){
    if(notice) notice.remove();
    return;
  }
  if(!notice){
    notice = document.createElement('div');
    notice.id = 'br-challenge-notice';
    notice.className = 'panel';
    notice.style.marginTop = '12px';
    livePanel.parentElement.insertBefore(notice, livePanel.nextSibling);
  }
  notice.innerHTML = `<span class="eyebrow">CHALLENGE ENTRY</span><p style="color:var(--muted);margin:8px 0 0">${esc(text)}</p>`;
}

function applyServerBattleTimer(session, timing = {}){
  if(!timing || !timing.deadlineAt) return;
  const remaining = Number(timing.remainingSeconds);
  if(!Number.isFinite(remaining)) return;
  const nextSeconds = Math.max(0, Math.floor(remaining));
  timerSeconds = timerInt ? Math.min(timerSeconds, nextSeconds) : nextSeconds;
  timerText();
  const note = document.getElementById('br-timer-note');
  if(note) note.textContent = nextSeconds > 0 ? 'Server clock' : 'Submission window';
  if(nextSeconds <= 0 && session.status !== 'completed'){
    session.status = 'submission_pending';
    document.getElementById('br-status').textContent = formatBattleStatus(session.status);
  }
}

function applyServerBattleRoomState(room, options = {}){
  if(!room || !room.battle) return { skipped:true };
  const battleId = room.battle.id;
  const version = Number(room.version || room.battle.battleVersion || 0);
  if(state.battleRoomSync.battleId === battleId && version < Number(state.battleRoomSync.battleVersion || 0)){
    state.battleRoomSync.status = 'conflict';
    return { stale:true };
  }
  const existing = options.session || activeStudioBattleSession() || {};
  const session = String(existing.battleId || existing.id || '') === String(battleId) ? existing : {};
  const snapshot = serverBattlePrepSnapshotToLocal(room.snapshot, room.battle, {});
  const self = (room.participants || []).find(participant => participant.entryId) || {};
  const opponent = (room.participants || []).find(participant => !participant.entryId && participant.profile && participant.profile.name);
  Object.assign(session, {
    id:battleId,
    battleId,
    modeId:room.battle.modeId,
    title:room.battle.title || session.title || 'Battle',
    mode:session.mode || room.battle.title || room.battle.modeId || 'Battle',
    genre:room.battle.genre || session.genre || 'Global',
    duration:room.timing && room.timing.durationMinutes || room.battle.durationMinutes || session.duration || 10,
    status:room.battle.status || session.status || 'waiting',
    startedAt:room.timing && room.timing.startedAt || room.battle.startedAt || session.startedAt || null,
    deadlineAt:room.timing && room.timing.deadlineAt || room.battle.deadlineAt || session.deadlineAt || null,
    battleVersion:version,
    eventId:room.eventId,
    battleEntryId:self.entryId || room.entry && room.entry.id || session.battleEntryId || snapshot && snapshot.battleEntryId || null,
    battlePrepSnapshot:snapshot || session.battlePrepSnapshot || null,
    battlePrepSnapshotId:snapshot && snapshot.id || session.battlePrepSnapshotId || null,
    battlePrepSnapshotVersion:snapshot && snapshot.snapshotVersion || session.battlePrepSnapshotVersion || null,
    battlePrepSyncStatus:snapshot ? 'server' : session.battlePrepSyncStatus,
    liveParticipants:room.participants || [],
    resolution:room.resolution || session.resolution || null,
    resolutionId:room.resolution && room.resolution.id || session.resolutionId || null,
    resolutionVersion:room.resolution && room.resolution.version || session.resolutionVersion || null,
    resolutionStatus:room.resolution && room.resolution.status || session.resolutionStatus || null,
    liveStatus:'live',
    opponent:opponent && opponent.profile ? { name:opponent.profile.name, country:opponent.profile.country || '', belt:opponent.profile.belt || '', record:opponent.profile.rating ? String(opponent.profile.rating) : '' } : session.opponent || null,
    submissionId:self.submission && self.submission.id || session.submissionId || null,
    opponentSubmitted:Boolean(opponent && opponent.submission && opponent.submission.submitted)
  });
  state.battleRoomSync.status = 'live';
  state.battleRoomSync.battleId = battleId;
  state.battleRoomSync.battleVersion = version;
  state.battleRoomSync.eventId = room.eventId || '';
  state.battleRoomSync.lastSyncedAt = new Date().toISOString();
  window.activeBattleSession = session;
  persistActiveBattleSession(session);
  const idx = battles.findIndex(battle => String(battle.id) === String(battleId));
  if(idx >= 0) battles[idx] = { ...battles[idx], status:session.status, battleVersion:version, startedAt:session.startedAt, deadlineAt:session.deadlineAt };
  if(options.render !== false){
    renderBattleRoom(session);
    renderBattleRoomLiveState(session);
    renderBattleStudioContext(session);
    if(room.resolution) renderSynchronizedBattleResolution(session, room.resolution);
  }
  applyServerBattleTimer(session, room.timing);
  return { session };
}

async function fetchServerBattleRoomState(session = activeStudioBattleSession(), options = {}){
  if(!battleRoomServerApiAvailable() || !session || !(session.battleId || session.id)) return { skipped:true };
  const version = options.ifVersion == null ? state.battleRoomSync.battleVersion || session.battleVersion || 0 : options.ifVersion;
  const response = await window.DJBattleApi.apiRequest(`/api/battles/${encodeURIComponent(session.battleId || session.id)}/room?ifVersion=${encodeURIComponent(version)}`);
  if(response.error){
    state.battleRoomSync.status = response.status === 0 ? 'offline' : 'reconnecting';
    state.battleRoomSync.lastFailure = response.error;
    renderBattleRoomLiveState(session);
    return { error:response.error, response };
  }
  return { ...applyServerBattleRoomState(response.data && response.data.room, { session, render:options.render }), response };
}

async function setServerBattleReady(session = activeStudioBattleSession(), ready = true){
  if(!battleRoomServerApiAvailable() || !session || !session.battleEntryId) return { skipped:true, error:'Authenticated Battle Room entry is unavailable.' };
  const response = await window.DJBattleApi.apiRequest(`/api/battleEntries/${encodeURIComponent(session.battleEntryId)}/ready`, {
    method:'POST',
    body:{ ready:Boolean(ready), idempotencyKey:stableClientIdempotencyKey('battle-ready', { entryId:session.battleEntryId, ready:Boolean(ready), version:session.battleVersion || 0 }) }
  });
  if(response.error) return { error:response.error, response };
  return { ...applyServerBattleRoomState(response.data && response.data.room, { session }), response };
}

async function startServerBattleFromRoom(session = activeStudioBattleSession()){
  if(!battleRoomServerApiAvailable() || !session || !(session.battleId || session.id)) return { skipped:true, error:'Authenticated Battle Room is unavailable.' };
  const response = await window.DJBattleApi.apiRequest(`/api/battles/${encodeURIComponent(session.battleId || session.id)}/start`, {
    method:'POST',
    body:{ idempotencyKey:stableClientIdempotencyKey('battle-start', { battleId:session.battleId || session.id, version:session.battleVersion || 0 }) }
  });
  if(response.error) return { error:response.error, response };
  return { ...applyServerBattleRoomState(response.data && response.data.room, { session }), response };
}

async function requestServerBattleResolution(session = activeStudioBattleSession()){
  if(!battleRoomServerApiAvailable() || !session || !(session.battleId || session.id)) return { skipped:true, error:'Authenticated Battle Room is unavailable.' };
  const response = await window.DJBattleApi.apiRequest(`/api/battles/${encodeURIComponent(session.battleId || session.id)}/resolve`, {
    method:'POST',
    body:{ idempotencyKey:stableClientIdempotencyKey('battle-resolve', { battleId:session.battleId || session.id, version:session.battleVersion || 0 }) }
  });
  if(response.error) return { error:response.error, response };
  return { ...applyServerBattleRoomState(response.data && response.data.room, { session }), response };
}

async function sendBattleRoomPresence(session = activeStudioBattleSession(), presence = 'online'){
  if(!battleRoomServerApiAvailable() || !session || !session.battleEntryId) return { skipped:true };
  const response = await window.DJBattleApi.apiRequest(`/api/battleEntries/${encodeURIComponent(session.battleEntryId)}/presence`, { method:'POST', body:{ presence } });
  if(response.error) return { error:response.error, response };
  return { ...applyServerBattleRoomState(response.data && response.data.room, { session, render:false }), response };
}

async function cancelServerBattleFromRoom(session = activeStudioBattleSession()){
  if(!battleRoomServerApiAvailable() || !session) return { skipped:true, error:'Authenticated Battle Room is unavailable.' };
  if(!confirm('Cancel this battle for all participants?')) return { cancelled:false };
  const response = await window.DJBattleApi.apiRequest(`/api/battles/${encodeURIComponent(session.battleId || session.id)}/cancel`, {
    method:'POST',
    body:{ idempotencyKey:stableClientIdempotencyKey('battle-cancel', { battleId:session.battleId || session.id, version:session.battleVersion || 0 }) }
  });
  if(response.error) return { error:response.error, response };
  session.status = 'cancelled';
  state.battleRoomSync.status = 'conflict';
  persistActiveBattleSession(session);
  renderBattleRoom(session);
  return { response };
}

async function withdrawServerBattleEntryFromRoom(session = activeStudioBattleSession()){
  if(!battleRoomServerApiAvailable() || !session || !session.battleEntryId) return { skipped:true, error:'Authenticated Battle Room entry is unavailable.' };
  if(!confirm('Withdraw from this battle? Your prep snapshot will remain in history evidence.')) return { withdrawn:false };
  const response = await window.DJBattleApi.apiRequest(`/api/battleEntries/${encodeURIComponent(session.battleEntryId)}/withdraw`, {
    method:'POST',
    body:{ idempotencyKey:stableClientIdempotencyKey('battle-withdraw', { entryId:session.battleEntryId, version:session.battleVersion || 0 }) }
  });
  if(response.error) return { error:response.error, response };
  session.status = 'withdrawn';
  state.battleRoomSync.status = 'conflict';
  persistActiveBattleSession(session);
  renderBattleRoom(session);
  return { response };
}

function stopBattleRoomLiveSync(){
  if(battleRoomPollTimer){ clearTimeout(battleRoomPollTimer); battleRoomPollTimer = null; }
  if(battleRoomHeartbeatTimer){ clearTimeout(battleRoomHeartbeatTimer); battleRoomHeartbeatTimer = null; }
  state.battleRoomSync.polling = false;
}

function scheduleBattleRoomLiveSync(session = activeStudioBattleSession()){
  if(!session || !session.battleEntryId || !battleRoomServerApiAvailable() || livePollingDisabledForTest()) return;
  stopBattleRoomLiveSync();
  state.battleRoomSync.polling = true;
  const poll = async () => {
    const active = activeStudioBattleSession();
    if(!active || String(active.battleEntryId || '') !== String(session.battleEntryId || '')) return stopBattleRoomLiveSync();
    const hidden = document.visibilityState === 'hidden';
    state.battleRoomSync.status = hidden ? 'reconnecting' : 'connecting';
    await fetchServerBattleRoomState(active, { render:!hidden });
    battleRoomPollTimer = setTimeout(poll, hidden ? 15000 : 5000);
    if(battleRoomPollTimer && battleRoomPollTimer.unref) battleRoomPollTimer.unref();
  };
  const heartbeat = async () => {
    const active = activeStudioBattleSession();
    if(!active || String(active.battleEntryId || '') !== String(session.battleEntryId || '')) return;
    await sendBattleRoomPresence(active, document.visibilityState === 'hidden' ? 'reconnecting' : 'online');
    battleRoomHeartbeatTimer = setTimeout(heartbeat, document.visibilityState === 'hidden' ? 30000 : 12000);
    if(battleRoomHeartbeatTimer && battleRoomHeartbeatTimer.unref) battleRoomHeartbeatTimer.unref();
  };
  poll();
  heartbeat();
}

async function replaceServerBattlePrepSnapshotTrack(fromTrackId, toTrackId, session = activeStudioBattleSession()){
  const snapshot = battlePrepSnapshotForUser(session);
  if(!snapshot || !snapshot.serverBacked) return replaceBattlePrepSnapshotTrack(fromTrackId, toTrackId, session);
  if(!battlePrepServerApiAvailable()) return { ok:false, error:'Authenticated Battle Prep replacement is unavailable.' };
  const snapshotId = snapshot.snapshotId || snapshot.id;
  const response = await window.DJBattleApi.apiRequest(`/api/battlePrepSnapshots/${encodeURIComponent(snapshotId)}/replacements`, {
    method:'POST',
    body:{
      fromTrackId:rawServerTrackIdForMembership(fromTrackId),
      toTrackId:rawServerTrackIdForMembership(toTrackId)
    }
  });
  if(response.error) return { ok:false, error:response.error, response };
  const serverSnapshot = serverBattlePrepSnapshotToLocal(response.data && response.data.snapshot, session || {}, {
    crateId:snapshot.crateId,
    crateName:snapshot.crateName
  });
  if(!serverSnapshot) return { ok:false, error:'Server replacement response did not include a snapshot.' };
  const battleId = serverSnapshot.battleId || session && (session.battleId || session.id);
  const idx = battles.findIndex(item => String(item.id) === String(battleId));
  if(idx >= 0){
    battles[idx] = attachBattlePrepSnapshotToBattle(battles[idx], serverSnapshot, currentProfileUserId(), { id:serverSnapshot.battleEntryId });
    persistBattles();
  }
  if(session){
    session.entries = {
      ...(session.entries || {}),
      [currentProfileUserId()]: {
        ...((session.entries || {})[currentProfileUserId()] || {}),
        battlePrepSnapshot:serverSnapshot,
        battlePrepSnapshotId:serverSnapshot.id,
        battlePrepSnapshotVersion:serverSnapshot.snapshotVersion,
        serverBattleEntryId:serverSnapshot.battleEntryId,
        battleEntryId:serverSnapshot.battleEntryId
      }
    };
    session.battlePrepSnapshot = serverSnapshot;
    session.battlePrepSnapshotId = serverSnapshot.id;
    session.battlePrepSnapshotVersion = serverSnapshot.snapshotVersion;
    window.activeBattleSession = session;
    persistActiveBattleSession(session);
    recoverBattlePrepSnapshotInStudio(session);
  }
  return { ok:true, snapshot:serverSnapshot, response };
}

function buildBattlePrepEntrySnapshot(crateId, battleLike, validation, userId = currentProfileUserId()){
  if(!validation || validation.optional || !validation.ready) return null;
  const crate = getLibraryCrateById(crateId);
  const now = new Date().toISOString();
  const mode = BattleModes.getBattleMode(battleLike && (battleLike.modeId || battleLike.type || battleLike.mode));
  const battleId = battleLike && battleLike.id || 'draft';
  return {
    id:`prep-${Math.abs(String(`${battleId}:${userId}:${validation.crateId}:${validation.crateVersion || now}`).split('').reduce((hash, ch)=>((hash << 5) - hash + ch.charCodeAt(0))|0, 0))}`,
    source:'battle_prep_crate_snapshot',
    serverBacked:false,
    syncStatus:'local_unsynced',
    userId:String(userId),
    crateId:validation.crateId,
    crateName:validation.crateName || crate && crate.name || 'Battle Prep crate',
    crateType:crate && crate.type || 'battle_prep',
    crateVersion:validation.crateVersion || null,
    purpose:validation.purpose,
    createdAt:now,
    replacementAllowed:Boolean(validation.replacementAllowed),
    battleRules:{
      battleId,
      modeId:battleLike && battleLike.modeId || mode && mode.id || null,
      trackSelectionMethod:battleLike && battleLike.trackSelectionMethod || mode && mode.trackSelectionMethod || null,
      genre:battleLike && battleLike.genre || mode && mode.defaultGenre || null,
      durationMinutes:Number(battleLike && (battleLike.durationMinutes || battleLike.duration) || mode && mode.defaultDurationMinutes || 0),
      requiredTrackCount:validation.requiredCount || 0,
      rewardType:battleLike && (battleLike.rewardType || battleLike.reward && battleLike.reward.type) || mode && mode.rewardType || 'standard'
    },
    ruleDecisions:{
      ready:Boolean(validation.ready),
      blockers:(validation.blockers || []).slice(),
      warnings:(validation.warnings || []).slice(),
      rows:(validation.rows || []).map(row => ({ libraryId:row.libraryId, status:row.status, reasons:(row.reasons || []).slice(0,3) }))
    },
    tracks:(validation.rows || []).map((row, index) => ({
      order:index + 1,
      libraryId:row.libraryId,
      title:row.title,
      artist:row.artist,
      bpm:row.bpm,
      key:row.key,
      camelotKey:row.camelotKey,
      genre:row.genre,
      duration:row.duration,
      status:row.status,
      reasons:(row.reasons || []).slice(0,3),
      analysisConfidence:row.analysisConfidence == null ? null : row.analysisConfidence,
      rightsClassification:row.rightsClassification || 'unknown'
    }))
  };
}

function attachBattlePrepSnapshotToBattle(battle, snapshot, userId = currentProfileUserId(), serverEntry = null){
  if(!battle || !snapshot) return battle;
  const entries = { ...(battle.entries || {}) };
  const entry = { ...(entries[userId] || {}) };
  entries[userId] = {
    ...entry,
    userId:String(userId),
    battleEntryId:serverEntry && serverEntry.id || entry.battleEntryId || snapshot.battleEntryId || null,
    serverBattleEntryId:serverEntry && serverEntry.id || entry.serverBattleEntryId || snapshot.battleEntryId || null,
    battlePrepSnapshot:snapshot,
    battlePrepSnapshotId:snapshot.id,
    battlePrepSnapshotVersion:snapshot.snapshotVersion || entry.battlePrepSnapshotVersion || null,
    battlePrepSyncStatus:snapshot.syncStatus || entry.battlePrepSyncStatus || 'local_unsynced',
    preparedAt:snapshot.createdAt
  };
  let participants = (battle.participants || []).map(participant => String(participant.userId) === String(userId)
    ? { ...participant, battlePrepSnapshotId:snapshot.id, battlePrepSnapshotVersion:snapshot.snapshotVersion || null }
    : participant);
  if(!participants.some(participant => String(participant.userId) === String(userId))){
    participants = [...participants, {
      userId:String(userId),
      name:currentUser().displayName,
      status:'joined',
      battlePrepSnapshotId:snapshot.id,
      battlePrepSnapshotVersion:snapshot.snapshotVersion || null
    }];
  }
  return { ...battle, entries, participants };
}

function battlePrepSnapshotForUser(battleOrSession, userId = currentProfileUserId()){
  if(!battleOrSession) return null;
  const accountId = state.musicLibrarySync.accountId || '';
  const ownsSnapshot = snapshot => {
    if(!snapshot) return false;
    if(String(snapshot.userId || userId) === String(userId)) return true;
    return Boolean(snapshot.serverBacked && accountId && String(snapshot.userId || '') === String(accountId));
  };
  if(ownsSnapshot(battleOrSession.battlePrepSnapshot)) return battleOrSession.battlePrepSnapshot;
  const entries = battleOrSession.entries || {};
  const entry = entries[userId] || entries[String(userId)] || (accountId ? entries[accountId] : null);
  return entry && ownsSnapshot(entry.battlePrepSnapshot) ? entry.battlePrepSnapshot : null;
}

function safeBattlePrepSnapshotForSubmission(snapshot){
  if(!snapshot) return null;
  return {
    id:snapshot.id,
    snapshotId:snapshot.snapshotId || snapshot.id,
    snapshotVersion:snapshot.snapshotVersion || null,
    source:snapshot.source,
    serverBacked:Boolean(snapshot.serverBacked),
    syncStatus:snapshot.syncStatus || (snapshot.serverBacked ? 'server' : 'local_unsynced'),
    battleEntryId:snapshot.battleEntryId || null,
    purpose:snapshot.purpose,
    crateName:snapshot.crateName,
    crateVersion:snapshot.crateVersion,
    createdAt:snapshot.createdAt,
    battleRules:snapshot.battleRules,
    ruleDecisions:snapshot.ruleDecisions,
    tracks:(snapshot.tracks || []).map(track => ({
      order:track.order,
      libraryId:track.libraryId,
      title:track.title,
      artist:track.artist,
      bpm:track.bpm,
      key:track.key,
      camelotKey:track.camelotKey,
      genre:track.genre,
      duration:track.duration,
      status:track.status,
      reasons:track.reasons,
      analysisConfidence:track.analysisConfidence,
      rightsClassification:track.rightsClassification,
      loadedDeck:track.loadedDeck || null,
      loadedAt:track.loadedAt || null
    }))
  };
}

function battlePrepSummaryForHistory(snapshot, visibility = 'private'){
  if(!snapshot) return null;
  if(['validated_battle_prep_snapshot', 'server_battle_prep_snapshot'].includes(snapshot.source) && snapshot.trackCount != null){
    const summary = {
      source:snapshot.source,
      serverBacked:Boolean(snapshot.serverBacked),
      snapshotVersion:snapshot.snapshotVersion || null,
      purpose:snapshot.purpose,
      crateName:snapshot.crateName,
      trackCount:snapshot.trackCount,
      createdAt:snapshot.createdAt,
      ruleSummary:snapshot.ruleSummary || null
    };
    if(visibility === 'public') return summary;
    return {
      ...summary,
      snapshotId:snapshot.snapshotId || snapshot.id || null,
      crateId:snapshot.crateId || null,
      crateVersion:snapshot.crateVersion || null,
      tracks:Array.isArray(snapshot.tracks) ? snapshot.tracks.map(track => ({
        order:track.order,
        libraryId:track.libraryId,
        title:track.title,
        artist:track.artist,
        bpm:track.bpm,
        key:track.key,
        genre:track.genre,
        status:track.status,
        loadedDeck:track.loadedDeck || null
      })) : []
    };
  }
  const base = {
    source:snapshot.source || (snapshot.serverBacked ? 'server_battle_prep_snapshot' : 'validated_battle_prep_snapshot'),
    serverBacked:Boolean(snapshot.serverBacked),
    snapshotVersion:snapshot.snapshotVersion || null,
    purpose:snapshot.purpose,
    crateName:snapshot.crateName,
    trackCount:(snapshot.tracks || []).length,
    createdAt:snapshot.createdAt,
    ruleSummary:snapshot.ruleDecisions && {
      ready:Boolean(snapshot.ruleDecisions.ready),
      blockerCount:(snapshot.ruleDecisions.blockers || []).length,
      warningCount:(snapshot.ruleDecisions.warnings || []).length
    }
  };
  if(visibility === 'public') return base;
  return {
    ...base,
    snapshotId:snapshot.snapshotId || snapshot.id,
    battleEntryId:snapshot.battleEntryId || null,
    crateId:snapshot.crateId,
    crateVersion:snapshot.crateVersion,
    tracks:(snapshot.tracks || []).map(track => ({
      order:track.order,
      libraryId:track.libraryId,
      title:track.title,
      artist:track.artist,
      bpm:track.bpm,
      key:track.key,
      genre:track.genre,
      status:track.status,
      loadedDeck:track.loadedDeck || null
    }))
  };
}

function activeSessionLoadedDeckContext(session = activeStudioBattleSession()){
  const battleId = session && (session.battleId || session.id) || 'studio';
  return Object.entries(state.studioDecks || {}).filter(([, deck]) => deck && deck.trackId).map(([deck, record]) => ({
    deck,
    libraryId:record.trackId,
    libraryTrackId:rawServerTrackIdForMembership(record.trackId) || record.trackId,
    title:record.title,
    artist:record.artist,
    bpm:record.bpm,
    key:record.key,
    genre:record.genre,
    sourceType:record.sourceType,
    loadedAt:record.loadedAt,
    battleId
  }));
}

function recoverBattlePrepSnapshotInStudio(session = activeStudioBattleSession()){
  const snapshot = battlePrepSnapshotForUser(session);
  if(!snapshot) return { skipped:true };
  const order = (snapshot.tracks || []).map(track => track.libraryId).filter(Boolean);
  const missing = order.filter(id => !getLibraryTrackById(id));
  state.studioLibraryDrawer = {
    ...state.studioLibraryDrawer,
    open:true,
    deck:state.studioLibraryDrawer.deck || 'a',
    battlePrepCrateId:snapshot.crateId,
    battlePrepCrateName:snapshot.crateName,
    battlePrepPurpose:snapshot.purpose,
    battlePrepSnapshotId:snapshot.id,
    validatedOrder:order
  };
  renderStudioLibraryDrawer();
  if(missing.length) setStudioRuleStatus(`${missing.length} approved Battle Prep track(s) are unavailable. Replacement is ${snapshot.replacementAllowed ? 'allowed when rules pass' : 'not allowed for this battle'}.`, 'warn');
  else setStudioRuleStatus(`${snapshot.crateName} recovered from the immutable battle-entry snapshot.`, 'ok');
  return { ok:true, snapshot, missing };
}

function replaceBattlePrepSnapshotTrack(fromTrackId, toTrackId, session = activeStudioBattleSession()){
  const snapshot = battlePrepSnapshotForUser(session);
  if(!snapshot) return { ok:false, error:'No Battle Prep snapshot is active.' };
  if(!snapshot.replacementAllowed) return { ok:false, error:'Battle rules do not allow replacing this prepared track.' };
  const replacement = getLibraryTrackById(toTrackId);
  if(!replacement) return { ok:false, error:'Replacement track is unavailable.' };
  const eligibility = libraryTrackLoadEligibility(replacement, 'a', session);
  if(!eligibility.allowed) return { ok:false, error:eligibility.reason };
  const from = trackIdForCrateMembership(fromTrackId);
  const nextTracks = (snapshot.tracks || []).map(track => track.libraryId === from ? {
    ...track,
    libraryId:replacement.libraryId,
    title:trackTitle(replacement),
    artist:trackArtist(replacement),
    bpm:parseBpm(replacement) || replacement.bpm || '--',
    key:replacement.key || '--',
    camelotKey:replacement.camelotKey || parseCamelotKey(replacement.key),
    genre:replacement.genre || 'Unsorted',
    duration:replacement.duration || '--',
    status:'ready',
    reasons:['Replacement validated against active battle rules.'],
    replacedFrom:from,
    replacedAt:new Date().toISOString()
  } : track);
  snapshot.tracks = nextTracks;
  snapshot.ruleDecisions = {
    ...(snapshot.ruleDecisions || {}),
    warnings:[...((snapshot.ruleDecisions && snapshot.ruleDecisions.warnings) || []), `Replacement selected for ${from}.`]
  };
  session.battlePrepSnapshot = snapshot;
  window.activeBattleSession = session;
  persistActiveBattleSession(session);
  recoverBattlePrepSnapshotInStudio(session);
  return { ok:true, snapshot };
}
function mergeServerCrate(crate){
  const local = serverCrateToLocal(crate);
  if(!local) return null;
  const next = { ...local, userId: local.userId || state.musicLibrarySync.accountId, syncStatus:'synced' };
  const idx = state.playlists.findIndex(item => item.serverBacked && String(item.id) === String(next.id));
  if(idx >= 0) state.playlists[idx] = { ...state.playlists[idx], ...next };
  else state.playlists.unshift(next);
  persist();
  return next;
}
function reconcileMusicLibraryCrates(serverCrates, options = {}){
  const accountId = options.accountId || state.musicLibrarySync.accountId;
  const locals = (serverCrates || []).map(serverCrateToLocal).filter(Boolean).map(crate => ({ ...crate, userId: crate.userId || accountId }));
  const serverIds = new Set(locals.map(crate => String(crate.id)));
  const survivors = state.playlists.filter(crate => !crate.serverBacked || String(crate.userId || '') !== String(accountId) || serverIds.has(String(crate.id)));
  state.playlists = [...locals, ...survivors.filter(crate => !locals.some(serverCrate => serverCrate.serverBacked && crate.serverBacked && String(serverCrate.id) === String(crate.id)))];
  persist();
  return state.playlists;
}
async function checkMusicLibraryOrganizationStatus(){
  if(!window.DJBattleApi || !window.DJBattleApi.apiRequest) return { ready:false, status:'offline', message:'Server API unavailable' };
  const response = await window.DJBattleApi.apiRequest('/api/musicLibrary/organizationStatus');
  if(response.error){
    const data = response.data || {};
    return { ready:false, status:data.status || (response.status === 503 ? 'migration_required' : 'failed'), message:data.message || response.error, schema:data.schema || '013_create_music_library_crates' };
  }
  return response.data || { ready:false, status:'failed', message:'Organization schema readiness response was empty.' };
}
async function loadServerMusicLibraryCrates(options = {}){
  if(!window.DJBattleApi || !window.DJBattleApi.apiRequest) return { skipped:true, error:'Server API unavailable' };
  const accountId = options.accountId || state.musicLibrarySync.accountId;
  if(!accountId) return { skipped:true, error:'No authenticated account.' };
  const organization = await checkMusicLibraryOrganizationStatus();
  if(!organization.ready){
    setMusicLibrarySyncStatus(organization.status === 'offline' ? 'offline' : 'failed', { accountId, organization, error:organization.message || 'Music Library organization schema is unavailable.' });
    return { error:organization.message, organization };
  }
  const response = await window.DJBattleApi.apiRequest('/api/musicLibrary/crates');
  if(response.error){
    setMusicLibrarySyncStatus(response.status === 0 ? 'offline' : 'failed', { accountId, error:response.error, organization });
    return response;
  }
  reconcileMusicLibraryCrates(response.data && response.data.crates || [], { accountId });
  setMusicLibrarySyncStatus('synced', { accountId, error:'', organization, lastSyncedAt:new Date().toISOString() });
  renderLibrary();
  renderStudioLibrary();
  renderProfile();
  await flushMusicLibrarySyncQueue();
  return { data:{ crates:response.data && response.data.crates || [] }, organization };
}
function localCratePayload(input = {}){
  return {
    id: input.id || `local-crate-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: input.name || 'My Playlist',
    description: input.description || '',
    visibility: input.visibility || 'private',
    type: input.type || 'playlist',
    parentFolderId: input.parentFolderId || null,
    smartRules: input.smartRules || null,
    allowDuplicates:Boolean(input.allowDuplicates),
    trackIds:(input.trackIds || []).map(trackIdForCrateMembership),
    createdAt:new Date().toISOString(),
    updatedAt:new Date().toISOString(),
    syncStatus: state.musicLibrarySync.accountId ? 'offline' : 'local'
  };
}
async function createLibraryCrateOptimistic(input = {}){
  const local = localCratePayload(input);
  state.playlists.unshift(local);
  persist();
  renderLibrary();
  if(!window.DJBattleApi || !window.DJBattleApi.apiRequest || state.musicLibrarySync.status === 'offline'){
    if(state.musicLibrarySync.accountId) queueMusicLibrarySyncChange({ type:'crate', action:'create', body:{ ...input, trackIds:(input.trackIds || []).map(rawServerTrackIdForMembership).filter(Boolean) } });
    return { ok:true, queued:Boolean(state.musicLibrarySync.accountId), crate:local };
  }
  const response = await window.DJBattleApi.apiRequest('/api/musicLibrary/crates', { method:'POST', body:{ ...input, trackIds:(input.trackIds || []).map(rawServerTrackIdForMembership).filter(Boolean) } });
  if(response.error){
    if(state.musicLibrarySync.accountId) queueMusicLibrarySyncChange({ type:'crate', action:'create', body:{ ...input, trackIds:(input.trackIds || []).map(rawServerTrackIdForMembership).filter(Boolean) } });
    return { ok:true, queued:Boolean(state.musicLibrarySync.accountId), crate:local };
  }
  state.playlists = state.playlists.filter(crate => crate.id !== local.id);
  const merged = mergeServerCrate(response.data && response.data.crate);
  renderLibrary();
  return { ok:true, crate:merged };
}
async function updateLibraryCrateOptimistic(crateId, patch = {}){
  const editable = getEditableLibraryCrate(crateId);
  if(!editable) return { ok:false, error:'Crate is unavailable.' };
  const before = JSON.parse(JSON.stringify(editable.crate));
  Object.assign(editable.crate, patch, { updatedAt:new Date().toISOString(), syncStatus: editable.crate.serverBacked ? 'optimistic' : editable.crate.syncStatus });
  if(patch.trackIds) editable.crate.trackIds = patch.trackIds.map(trackIdForCrateMembership);
  persist();
  renderLibrary();
  if(!editable.crate.serverBacked) return { ok:true, local:true, crate:editable.crate };
  if(!window.DJBattleApi || !window.DJBattleApi.apiRequest || state.musicLibrarySync.status === 'offline'){
    queueMusicLibrarySyncChange({ type:'crate', action:'update', crateId:editable.crate.id, body:patch });
    return { ok:true, queued:true, crate:editable.crate };
  }
  const response = await window.DJBattleApi.apiRequest(`/api/musicLibrary/crates/${encodeURIComponent(editable.crate.id)}`, { method:'PATCH', body:patch });
  if(response.error){
    state.playlists[editable.index] = before;
    setMusicLibrarySyncStatus(response.status === 409 ? 'conflict' : 'failed', { error:response.error });
    persist();
    renderLibrary();
    return { ok:false, error:response.error, rolledBack:true };
  }
  return { ok:true, crate:mergeServerCrate(response.data && response.data.crate) };
}
async function duplicateLibraryCrateOptimistic(crateId, name){
  const crate = getLibraryCrateById(crateId);
  if(!crate || crate.builtIn) return { ok:false, error:'Choose an editable crate.' };
  const duplicateName = name || `${crate.name} Copy`;
  if(crate.serverBacked && window.DJBattleApi && window.DJBattleApi.apiRequest && state.musicLibrarySync.status !== 'offline'){
    const response = await window.DJBattleApi.apiRequest(`/api/musicLibrary/crates/${encodeURIComponent(crate.id)}/duplicate`, { method:'POST', body:{ name:duplicateName } });
    if(!response.error){
      const merged = mergeServerCrate(response.data && response.data.crate);
      renderLibrary();
      return { ok:true, crate:merged };
    }
  }
  const local = localCratePayload({ ...crate, id:null, name:duplicateName, trackIds:crateTrackIds(crate) });
  state.playlists.unshift(local);
  if(crate.serverBacked) queueMusicLibrarySyncChange({ type:'crate', action:'create', body:{ name:duplicateName, description:crate.description, type:crate.type, visibility:crate.visibility, trackIds:crateTrackIds(crate).map(rawServerTrackIdForMembership).filter(Boolean) } });
  persist();
  renderLibrary();
  return { ok:true, queued:Boolean(crate.serverBacked), crate:local };
}
async function deleteLibraryCrateOptimistic(crateId){
  const editable = getEditableLibraryCrate(crateId);
  if(!editable) return { ok:false, error:'Crate is unavailable.' };
  const [removed] = state.playlists.splice(editable.index, 1);
  if(state.libraryFilters.crate === crateLibraryId(removed.id)) state.libraryFilters.crate = 'all';
  persist();
  renderLibrary();
  if(removed.serverBacked){
    if(window.DJBattleApi && window.DJBattleApi.apiRequest && state.musicLibrarySync.status !== 'offline'){
      const response = await window.DJBattleApi.apiRequest(`/api/musicLibrary/crates/${encodeURIComponent(removed.id)}`, { method:'DELETE' });
      if(!response.error) return { ok:true, crate:removed };
    }
    queueMusicLibrarySyncChange({ type:'crate', action:'delete', crateId:removed.id, body:{} });
  }
  return { ok:true, queued:Boolean(removed.serverBacked), crate:removed };
}
async function setCrateTrackOrder(crateId, trackIds, options = {}){
  const editable = getEditableLibraryCrate(crateId);
  if(!editable) return { ok:false, error:'Crate is unavailable.' };
  const before = crateTrackIds(editable.crate);
  const normalized = (trackIds || []).map(trackIdForCrateMembership).filter(Boolean);
  if(!options.allowDuplicates && !editable.crate.allowDuplicates && new Set(normalized).size !== normalized.length) return { ok:false, error:'Duplicate crate memberships are not allowed.' };
  if(!options.skipUndo) pushCrateUndo(crateLibraryId(editable.crate.id), before, options.reason || 'order');
  editable.crate.trackIds = normalized;
  editable.crate.updatedAt = new Date().toISOString();
  editable.crate.syncStatus = editable.crate.serverBacked ? 'optimistic' : editable.crate.syncStatus;
  persist();
  renderLibrary();
  if(editable.crate.serverBacked){
    const body = { trackIds:normalized.map(rawServerTrackIdForMembership).filter(Boolean), allowDuplicates:Boolean(options.allowDuplicates || editable.crate.allowDuplicates) };
    if(!window.DJBattleApi || !window.DJBattleApi.apiRequest || state.musicLibrarySync.status === 'offline'){
      queueMusicLibrarySyncChange({ type:'crate_membership', crateId:editable.crate.id, body });
      return { ok:true, queued:true, crate:editable.crate };
    }
    const response = await window.DJBattleApi.apiRequest(`/api/musicLibrary/crates/${encodeURIComponent(editable.crate.id)}/tracks`, { method:'PUT', body });
    if(response.error){
      if(response.status === 409 && response.data && response.data.crate){
        const serverCrate = serverCrateToLocal(response.data.crate);
        const merged = mergeConflictingCrateOrder(normalized, serverCrate ? serverCrate.trackIds : before);
        editable.crate.trackIds = merged;
        editable.crate.syncStatus = 'conflict';
        queueMusicLibrarySyncChange({ type:'crate_membership', crateId:editable.crate.id, body:{ trackIds:merged.map(rawServerTrackIdForMembership).filter(Boolean), allowDuplicates:Boolean(options.allowDuplicates || editable.crate.allowDuplicates) } });
        setMusicLibrarySyncStatus('conflict', { error:'Crate order changed on another device. Merged order queued for review.' });
        persist();
        renderLibrary();
        return { ok:false, conflict:true, merged, error:response.error };
      }
      editable.crate.trackIds = before;
      editable.crate.syncStatus = 'failed';
      setMusicLibrarySyncStatus('failed', { error:response.error || 'Crate order save failed.' });
      persist();
      renderLibrary();
      return { ok:false, error:response.error, rolledBack:true };
    }
    const merged = mergeServerCrate(response.data && response.data.crate);
    setMusicLibrarySyncStatus('synced', { error:'', lastSyncedAt:new Date().toISOString() });
    renderLibrary();
    return { ok:true, crate:merged };
  }
  return { ok:true, local:true, crate:editable.crate };
}
async function addTracksToCrate(crateId, trackIds, options = {}){
  const crate = getLibraryCrateById(crateId);
  if(!crate || crate.builtIn) return { ok:false, error:'Choose an editable crate.' };
  const current = crateTrackIds(crate);
  const additions = (Array.isArray(trackIds) ? trackIds : [trackIds]).map(trackIdForCrateMembership).filter(Boolean);
  const next = options.allowDuplicates || crate.allowDuplicates ? [...current, ...additions] : [...current, ...additions.filter(id => !current.includes(id))];
  return setCrateTrackOrder(crate.crateId, next, options);
}
async function removeTracksFromCrate(crateId, trackIds){
  const crate = getLibraryCrateById(crateId);
  if(!crate || crate.builtIn) return { ok:false, error:'Choose an editable crate.' };
  const remove = new Set((Array.isArray(trackIds) ? trackIds : [trackIds]).map(trackIdForCrateMembership));
  return setCrateTrackOrder(crate.crateId, crateTrackIds(crate).filter(id => !remove.has(id)));
}
function loadNextFromBattlePrepCrate(crateId, deck='a'){
  const crate = getLibraryCrateById(crateId);
  if(!crate || crate.type !== 'battle_prep') return { ok:false, error:'Choose a Battle Prep crate.' };
  const ordered = resolveCrateTrackIds(crate);
  const loaded = new Set(Object.values(state.studioDecks || {}).filter(Boolean).map(record => record.trackId));
  const nextId = ordered.find(id => !loaded.has(id)) || ordered[0];
  if(!nextId) return { ok:false, error:'Battle Prep crate has no tracks.' };
  return loadLibraryTrackToDeck(nextId, deck);
}
function loadBattlePrepCrateToDecks(crateId){
  const crate = getLibraryCrateById(crateId);
  if(!crate || crate.type !== 'battle_prep') return { ok:false, error:'Choose a Battle Prep crate.' };
  const ordered = resolveCrateTrackIds(crate);
  const first = ordered[0] ? loadLibraryTrackToDeck(ordered[0], 'a') : { ok:false, error:'Battle Prep crate has no tracks.' };
  const second = ordered[1] ? loadLibraryTrackToDeck(ordered[1], 'b') : { ok:true, skipped:true };
  return { ok:Boolean(first.ok && second.ok !== false), first, second };
}
async function createPracticeRecordingFromSubmissionLocal(input = {}){
  const body = {
    sourceSubmissionId: input.sourceSubmissionId || input.linkedSubmissionId,
    title: input.title || 'Practice Recording',
    artist: input.artist || currentUser().displayName,
    genre: input.genre || 'Practice',
    bpm: input.bpm,
    key: input.key,
    duration: input.duration,
    rightsClassification: input.rightsClassification || 'original',
    visibility: input.visibility || 'private',
    practiceHistoryId: input.practiceHistoryId,
    score: input.score,
    recommendations: input.recommendations || [],
    practiceMetadata: input.practiceMetadata || {},
    analysisSummary: input.analysisSummary || {}
  };
  if(window.DJBattleApi && window.DJBattleApi.apiRequest && state.musicLibrarySync.status !== 'offline'){
    const response = await window.DJBattleApi.apiRequest('/api/musicLibrary/practiceRecordings', { method:'POST', body });
    if(!response.error){
      const merged = mergeServerTrack(response.data && response.data.track);
      renderLibrary();
      renderStudioLibrary();
      return { ok:true, track:merged };
    }
    if(response.status === 409 && response.data && response.data.track) return { ok:true, duplicate:true, track:mergeServerTrack(response.data.track) };
  }
  const local = {
    id:`practice-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title:body.title,
    name:body.title,
    artist:body.artist,
    genre:body.genre,
    bpm:body.bpm || '--',
    key:body.key || '--',
    duration:body.duration || '--',
    source:'MY_LIBRARY',
    sourceType:'practice_recording',
    linkedSubmissionId:body.sourceSubmissionId,
    visibility:body.visibility,
    rightsCategory:rightsClassificationLabel(body.rightsClassification),
    rightsClassification:body.rightsClassification,
    battleEligible:true,
    practiceMetadata:{ ...body.practiceMetadata, score:body.score, recommendations:body.recommendations },
    analysisSummary:body.analysisSummary,
    usageRelationships:{ playlists:[], battles:[], posts:[], practiceHistory:body.practiceHistoryId ? [body.practiceHistoryId] : [], submissions:[] },
    syncStatus:state.musicLibrarySync.accountId ? 'offline' : 'local',
    permissions:defaultPermissions()
  };
  state.library.unshift(local);
  if(state.musicLibrarySync.accountId) queueMusicLibrarySyncChange({ type:'practice_recording', body });
  persist();
  renderLibrary();
  renderStudioLibrary();
  return { ok:true, queued:Boolean(state.musicLibrarySync.accountId), track:normalizeLibraryTrack(local, 'my', 0) };
}
async function requestLibraryPlaybackAccess(trackId){
  const track = getLibraryTrackById(trackId);
  if(!track || !track.serverBacked || !window.DJBattleApi || !window.DJBattleApi.apiRequest) return { skipped:true };
  const response = await window.DJBattleApi.apiRequest(`/api/musicLibrary/tracks/${encodeURIComponent(track.id)}/playbackAccess`, { method:'POST' });
  if(response.error) return response;
  const updated = mergeServerTrack(response.data && response.data.track);
  return { data:{ track:updated } };
}
async function ensureLibraryPlaybackAccess(track){
  if(!track || !track.serverBacked || securePlaybackSource(track)) return;
  const result = await requestLibraryPlaybackAccess(track.libraryId || track.id);
  if(result && result.data && result.data.track){
    const deckIds = Object.entries(state.studioDecks || {}).filter(([, deckTrack]) => deckTrack && deckTrack.trackId === (track.libraryId || `my:${track.id}`)).map(([deck]) => deck);
    deckIds.forEach(deck => {
      const audio = document.getElementById(`audio-${deck}`);
      const src = securePlaybackSource(getLibraryTrackById(track.libraryId || `my:${track.id}`));
      if(audio && src) audio.setAttribute('src', src);
    });
  }
}
async function createServerBackedLibraryTrackFromFile(file, metadata){
  if(!window.DJBattleApi || !window.DJBattleApi.apiRequest || !window.supabase || !window.supabase.storage) return { skipped:true };
  const created = await window.DJBattleApi.apiRequest('/api/musicLibrary/tracks', {
    method:'POST',
    body:{
      title:metadata.title,
      artist:metadata.artist,
      genre:metadata.genre,
      rightsClassification:metadata.rightsClassification,
      originalFilename:file.name,
      declaredMimeType:file.type,
      fileSize:file.size,
      sourceType:'track',
      visibility:'private'
    }
  });
  if(created.error) return created;
  const track = created.data && created.data.track;
  const authorization = await window.DJBattleApi.apiRequest(`/api/musicLibrary/tracks/${encodeURIComponent(track.id)}/audioUploadAuthorization`, { method:'POST' });
  if(authorization.error) return authorization;
  const storage = window.supabase.storage.from(authorization.data.bucket);
  const uploaded = await storage.uploadToSignedUrl(authorization.data.uploadPath, authorization.data.uploadToken, file, { contentType:file.type });
  if(uploaded.error) return { error: uploaded.error.message || 'Library audio upload failed' };
  const completed = await window.DJBattleApi.apiRequest(`/api/musicLibrary/tracks/${encodeURIComponent(track.id)}/completeAudioUpload`, { method:'POST' });
  if(completed.error) return completed;
  return { data:{ track:mergeServerTrack(completed.data.track) } };
}
function normalizeLibraryTrack(track, origin, index){
  const source = track?.source || (origin === 'platform' ? 'PLATFORM' : 'MY_LIBRARY');
  const originalId = String(track?.id || `${source}-${index}`);
  const libraryId = track?.serverBacked ? serverLibraryId(originalId) : `${origin}:${originalId}`;
  return {
    ...track,
    id: originalId,
    originalId,
    libraryId,
    _libraryOrigin: origin,
    _libraryIndex: index,
    title: trackTitle(track),
    name: trackTitle(track),
    artist: trackArtist(track),
    genre: track?.genre || 'Unsorted',
    source,
    rightsCategory: track?.rightsCategory || (origin === 'platform' ? 'Platform Cleared' : 'Unverified'),
    battleEligible: Boolean(track?.battleEligible),
    duration: track?.duration || '—',
    bpm: track?.bpm || '—',
    key: track?.key || '—',
    camelotKey: track?.camelotKey || parseCamelotKey(track?.key),
    visibility: track?.visibility || (origin === 'platform' ? 'public' : 'private'),
    userId: track?.userId || track?.user_id || currentProfileUserId(),
    sourceType: track?.sourceType || track?.source_type || (origin === 'platform' ? 'platform' : 'track'),
    linkedSubmissionId: track?.linkedSubmissionId || track?.linked_submission_id || null,
    usageRelationships: track?.usageRelationships || track?.usage_relationships || { playlists:[], battles:[], posts:[], practiceHistory:[], submissions:[] }
  };
}
function allLibraryTracks(){
  return [
    ...state.library.map((track, index)=>normalizeLibraryTrack(track, 'my', index)),
    ...state.platformLibrary.map((track, index)=>normalizeLibraryTrack(track, 'platform', index))
  ];
}
function getLibraryTrackById(trackId){
  const id = String(trackId || '');
  return allLibraryTracks().find(track => track.libraryId === id || track.id === id) || null;
}
function getEditableLibraryTrack(trackId){
  const id = String(trackId || '');
  const index = state.library.findIndex((track, i) => {
    const rawId = String(track.id || `MY_LIBRARY-${i}`);
    const libraryId = track.serverBacked ? serverLibraryId(rawId) : `my:${rawId}`;
    return libraryId === id || rawId === id || `my:${rawId}` === id;
  });
  return index >= 0 ? { track: state.library[index], index } : null;
}
function bpmCompatible(a, b){
  const left = parseBpm(a);
  const right = parseBpm(b);
  if(!left || !right) return false;
  return Math.abs(left - right) / left <= 0.06;
}
function keyCompatible(a, b){
  const left = parseCamelotKey(typeof a === 'object' ? a?.key : a);
  const right = parseCamelotKey(typeof b === 'object' ? b?.key : b);
  if(!left || !right) return false;
  if(left === right) return true;
  const leftNum = Number(left.slice(0,-1));
  const rightNum = Number(right.slice(0,-1));
  const leftMode = left.slice(-1);
  const rightMode = right.slice(-1);
  const adjacent = Math.abs(leftNum - rightNum) === 1 || Math.abs(leftNum - rightNum) === 11;
  return (leftNum === rightNum && leftMode !== rightMode) || (leftMode === rightMode && adjacent);
}
function compatibilityReason(base, candidate){
  const baseBpm = parseBpm(base);
  const candidateBpm = parseBpm(candidate);
  const baseKey = parseCamelotKey(base?.key);
  const candidateKey = parseCamelotKey(candidate?.key);
  const bpmDelta = baseBpm && candidateBpm ? `${Math.abs(baseBpm - candidateBpm).toFixed(1)} BPM` : 'BPM unknown';
  const keyText = baseKey && candidateKey ? `${baseKey}/${candidateKey}` : 'key unknown';
  return `${bpmDelta} / ${keyText}`;
}
function compatibleTracksFor(baseTrackOrId, pool){
  const base = typeof baseTrackOrId === 'string' ? getLibraryTrackById(baseTrackOrId) : normalizeLibraryTrack(baseTrackOrId || {}, baseTrackOrId?._libraryOrigin || 'my', baseTrackOrId?._libraryIndex || 0);
  if(!base || !base.libraryId) return [];
  const rows = (pool || allLibraryTracks()).map(track => track.libraryId ? track : normalizeLibraryTrack(track, track._libraryOrigin || 'my', track._libraryIndex || 0));
  return rows
    .filter(track => track.libraryId !== base.libraryId)
    .filter(track => bpmCompatible(base, track) && keyCompatible(base, track))
    .map(track => ({ ...track, compatibility: compatibilityReason(base, track) }));
}
function librarySortValue(track, field){
  if(field === 'bpm') return parseBpm(track) || 0;
  if(field === 'key') return parseCamelotKey(track.key) || normalizeKeyName(track.key);
  if(field === 'uploaded') return Date.parse(track.uploadDate || track.createdAt || '') || 0;
  if(field === 'source') return trackSource(track).toLowerCase();
  return String(track[field] || trackTitle(track)).toLowerCase();
}
function sortLibraryTracks(rows, sort=state.librarySort){
  const field = sort?.field || 'title';
  const direction = sort?.direction === 'desc' ? -1 : 1;
  return [...rows].sort((a,b)=>{
    const av = librarySortValue(a, field);
    const bv = librarySortValue(b, field);
    if(typeof av === 'number' && typeof bv === 'number') return (av - bv) * direction;
    return String(av).localeCompare(String(bv), undefined, { numeric:true, sensitivity:'base' }) * direction;
  });
}
function matchesLibrarySearch(track, query){
  const q = String(query || '').trim().toLowerCase();
  if(!q) return true;
  return [trackTitle(track), trackArtist(track), track.genre, trackSource(track), track.bpm, track.key, track.rightsCategory]
    .some(value => String(value || '').toLowerCase().includes(q));
}
function filterLibraryTracks(){
  let rows = allLibraryTracks();
  const crate = state.libraryFilters.crate || 'all';
  let crateOrder = null;
  if(crate === 'my') rows = rows.filter(track => track._libraryOrigin === 'my');
  if(crate === 'platform') rows = rows.filter(track => track._libraryOrigin === 'platform');
  if(crate === 'battle_ready') rows = rows.filter(track => track.battleEligible);
  if(crate === 'missing_artwork') rows = rows.filter(track => !secureArtworkSource(track));
  if(crate.startsWith('crate:') || crate.startsWith('smart:')){
    crateOrder = resolveCrateTrackIds(crate);
    const ids = new Set(crateOrder);
    rows = rows.filter(track => ids.has(track.libraryId));
  }
  rows = rows.filter(track => matchesLibrarySearch(track, state.libraryFilters.search));
  if(state.libraryFilters.compatibleOnly){
    const base = getLibraryTrackById(state.selectedLibraryTrackId || state.libraryPlayer.trackId);
    rows = base ? compatibleTracksFor(base, rows) : [];
  }
  if(crateOrder && !state.libraryFilters.compatibleOnly){
    const order = new Map(crateOrder.map((id, index) => [id, index]));
    return rows.sort((a, b) => (order.get(a.libraryId) ?? 9999) - (order.get(b.libraryId) ?? 9999));
  }
  return sortLibraryTracks(rows);
}
function updateLibraryCrateCounts(){
  const rows = allLibraryTracks();
  const counts = {
    all: rows.length,
    my: rows.filter(t=>t._libraryOrigin === 'my').length,
    platform: rows.filter(t=>t._libraryOrigin === 'platform').length,
    ready: rows.filter(t=>t.battleEligible).length,
    artwork: rows.filter(t=>!secureArtworkSource(t)).length
  };
  Object.entries(counts).forEach(([key,value])=>{
    const el = document.getElementById(`crate-count-${key}`);
    if(el) el.textContent = value;
  });
  renderLibraryCrateList();
  document.querySelectorAll('[data-library-crate]').forEach(button=>{
    button.classList.toggle('active', button.dataset.libraryCrate === (state.libraryFilters.crate || 'all'));
  });
}
function renderLibraryCrateList(){
  const target = document.getElementById('playlists-list');
  if(!target) return;
  const crates = allLibraryCrates();
  if(!crates.length){
    target.innerHTML = '<small>No crates yet.</small>';
    return;
  }
  target.innerHTML = crates.map(crate => {
    const count = resolveCrateTrackIds(crate).length;
    const editable = !crate.builtIn;
    const prep = crate.type === 'battle_prep';
    return `<div class="library-crate-row ${state.libraryFilters.crate === crate.crateId ? 'active' : ''}">
      <button data-open-crate="${esc(crate.crateId)}"><span>${esc(crate.name)}</span><strong>${count}</strong></button>
      <div>
        ${prep ? `<button class="ghost small" data-crate-next-a="${esc(crate.crateId)}">A</button><button class="ghost small" data-crate-next-b="${esc(crate.crateId)}">B</button>` : ''}
        ${editable ? `<button class="ghost small" data-crate-duplicate="${esc(crate.crateId)}">Copy</button><button class="ghost small" data-crate-delete="${esc(crate.crateId)}">Del</button>` : ''}
      </div>
    </div>`;
  }).join('');
  target.querySelectorAll('[data-open-crate]').forEach(button=>button.onclick=()=>{ state.libraryFilters.crate = button.dataset.openCrate; state.selectedLibraryCrateId = button.dataset.openCrate; localStorage.setItem('djBattleSelectedLibraryCrateId', state.selectedLibraryCrateId); renderLibrary(); });
  target.querySelectorAll('[data-crate-next-a]').forEach(button=>button.onclick=()=>loadNextFromBattlePrepCrate(button.dataset.crateNextA, 'a'));
  target.querySelectorAll('[data-crate-next-b]').forEach(button=>button.onclick=()=>loadNextFromBattlePrepCrate(button.dataset.crateNextB, 'b'));
  target.querySelectorAll('[data-crate-duplicate]').forEach(button=>button.onclick=()=>duplicateLibraryCrateOptimistic(button.dataset.crateDuplicate));
  target.querySelectorAll('[data-crate-delete]').forEach(button=>button.onclick=()=>deleteLibraryCrateOptimistic(button.dataset.crateDelete));
}
function renderLibraryStatus(rows){
  const target = document.getElementById('library-status-strip');
  if(!target) return;
  const sort = state.librarySort || { field:'title', direction:'asc' };
  const base = getLibraryTrackById(state.selectedLibraryTrackId || state.libraryPlayer.trackId);
  const compatible = state.libraryFilters.compatibleOnly && base ? `compatible with ${esc(trackTitle(base))}` : 'all compatible states visible';
  const crate = getLibraryCrateById(state.libraryFilters.crate);
  target.innerHTML = `<span><b>${rows.length}</b> tracks</span><span>${crate ? esc(crate.name) : esc(LIBRARY_SORT_LABELS[sort.field] || sort.field)} ${crate ? '' : String(sort.direction || 'asc').toUpperCase()}</span><span>${compatible}</span>`;
}
function battlePrepValidationHtml(validation){
  if(!validation) return '<small style="color:var(--muted)">Run validation before opening this crate in Battle Studio.</small>';
  const rows = validation.rows || [];
  return `<div class="battle-prep-validation ${validation.ready ? 'ready' : 'blocked'}">
    <div class="crate-validation-summary"><strong>${validation.ready ? 'READY' : 'BLOCKED'}</strong><small>${esc(validation.summary)}</small></div>
    <div class="crate-validation-list">${rows.map(row=>`
      <div class="crate-validation-row ${esc(row.status)}">
        <span>${esc(row.status.toUpperCase())}</span>
        <b>${esc(row.title)}</b>
        <em>${esc(row.bpm)} BPM / ${keyBadgeHtml(row.key)}</em>
        <small>${esc((row.reasons || [])[0] || 'Ready for battle rules.')}</small>
        ${(row.suggestions || []).length ? `<div class="crate-suggestions">${row.suggestions.map(item=>`<button class="ghost small" data-crate-suggestion="${esc(row.libraryId)}" data-suggestion-track="${esc(item.libraryId)}">${esc(item.title)} / ${esc(item.bpm)} BPM</button>`).join('')}</div>` : ''}
      </div>
    `).join('')}</div>
  </div>`;
}
function renderCrateEditorPanel(){
  const crate = getLibraryCrateById(state.libraryFilters.crate);
  if(!crate) return '';
  const editable = !crate.builtIn;
  const editing = crateEditorActiveFor(crate);
  const selectedCount = (state.crateEditor.selectedTrackIds || []).length;
  const targetOptions = state.playlists
    .filter(item => item.id !== crate.id)
    .map(item => normalizeLibraryCrate(item))
    .filter(item => !item.builtIn)
    .map(item => `<option value="${esc(item.crateId)}">${esc(item.name)}</option>`)
    .join('');
  const validation = state.crateEditor.validation && state.crateEditor.validation.crateId === crate.crateId ? state.crateEditor.validation : null;
  return `<div class="crate-editor-panel" data-crate-editor="${esc(crate.crateId)}">
    <div class="crate-editor-head">
      <div><span class="eyebrow">${editable ? 'CRATE EDITOR' : 'SMART CRATE'}</span><h3>${esc(crate.name)}</h3><p>${esc(crate.description || (crate.type === 'smart_crate' ? 'Rule-based crate recalculated from current library records.' : 'Ordered library crate.'))}</p></div>
      <button class="${editing ? 'primary' : 'ghost'} small" data-crate-edit-toggle="${esc(crate.crateId)}">${editing ? 'Done' : 'Edit'}</button>
    </div>
    ${editable && editing ? `<div class="crate-editor-form">
      <label>Name<input id="crate-edit-name" value="${esc(crate.name)}"></label>
      <label>Description<input id="crate-edit-description" value="${esc(crate.description || '')}"></label>
      <label>Visibility<select id="crate-edit-visibility"><option value="private" ${crate.visibility === 'private' ? 'selected' : ''}>Private</option><option value="profile" ${crate.visibility === 'profile' ? 'selected' : ''}>Profile</option><option value="public" ${crate.visibility === 'public' ? 'selected' : ''}>Public</option></select></label>
      <label>Type<select id="crate-edit-type"><option value="playlist" ${crate.type === 'playlist' ? 'selected' : ''}>Playlist</option><option value="crate" ${crate.type === 'crate' ? 'selected' : ''}>Crate</option><option value="battle_prep" ${crate.type === 'battle_prep' ? 'selected' : ''}>Battle Prep</option><option value="folder" ${crate.type === 'folder' ? 'selected' : ''}>Folder</option></select></label>
      <label>Artwork<input type="file" accept="image/*" data-crate-artwork="${esc(crate.crateId)}"></label>
      <div class="crate-editor-actions">
        <button class="primary small" data-crate-save-meta="${esc(crate.crateId)}">Save Meta</button>
        <button class="ghost small" data-crate-duplicate-editor="${esc(crate.crateId)}">Duplicate</button>
        <button class="ghost small danger" data-crate-archive-editor="${esc(crate.crateId)}">Archive</button>
      </div>
    </div>
    <div class="crate-bulk-console">
      <button class="ghost small" data-crate-select-all>Select All</button>
      <button class="ghost small" data-crate-clear-selection>Clear</button>
      <button class="ghost small" data-crate-bulk-remove="${esc(crate.crateId)}" ${selectedCount ? '' : 'disabled'}>Remove ${selectedCount || ''}</button>
      <button class="ghost small" data-crate-undo ${state.crateEditor.undoStack?.length ? '' : 'disabled'}>Undo</button>
      <select id="crate-bulk-targets" multiple aria-label="Add selected tracks to crates">${targetOptions}</select>
      <button class="ghost small" data-crate-bulk-add ${selectedCount && targetOptions ? '' : 'disabled'}>Add Selected</button>
    </div>` : ''}
    ${crate.type === 'battle_prep' ? `<div class="crate-battle-prep">
      <div class="crate-editor-actions">
        <button class="primary small" data-crate-validate="${esc(crate.crateId)}">Validate Battle Prep</button>
        <button class="ghost small" data-crate-open-studio="${esc(crate.crateId)}" ${validation && validation.ready ? '' : 'disabled'}>Open Studio</button>
      </div>
      ${battlePrepValidationHtml(validation)}
    </div>` : ''}
  </div>`;
}
async function attachArtworkToCrate(crateId, file){
  const editable = getEditableLibraryCrate(crateId);
  if(!editable) return { ok:false, error:'Crate is unavailable.' };
  if(!file || !/^image\//i.test(file.type || '')) return { ok:false, error:'Choose a PNG, JPG, GIF or WebP image.' };
  if(Number(file.size || 0) > 1024 * 1024) return { ok:false, error:'Crate artwork must be 1 MB or smaller.' };
  const artwork = { mimeType:file.type, size:file.size, updatedAt:new Date().toISOString() };
  editable.crate.artwork = artwork;
  return updateLibraryCrateOptimistic(crateId, { artwork });
}
async function addSelectedTracksToCrates(crateIds){
  const targets = (Array.isArray(crateIds) ? crateIds : [crateIds]).filter(Boolean);
  const selected = state.crateEditor.selectedTrackIds || [];
  const results = [];
  for(const target of targets){
    results.push(await addTracksToCrate(target, selected));
  }
  return results;
}
async function replaceTrackInCrate(crateId, fromTrackId, toTrackId){
  const crate = getLibraryCrateById(crateId);
  if(!crate || crate.builtIn) return { ok:false, error:'Choose an editable crate.' };
  const from = trackIdForCrateMembership(fromTrackId);
  const to = trackIdForCrateMembership(toTrackId);
  const next = crateTrackIds(crate).map(id => id === from ? to : id);
  return setCrateTrackOrder(crate.crateId, next, { reason:'replace' });
}
function attachCrateEditorHandlers(){
  document.querySelectorAll('[data-crate-edit-toggle]').forEach(button=>button.onclick=()=>setCrateEditorMode(!state.crateEditor.editing, button.dataset.crateEditToggle));
  document.querySelectorAll('[data-crate-save-meta]').forEach(button=>button.onclick=()=>updateLibraryCrateOptimistic(button.dataset.crateSaveMeta, {
    name:document.getElementById('crate-edit-name')?.value || 'Untitled Crate',
    description:document.getElementById('crate-edit-description')?.value || '',
    visibility:document.getElementById('crate-edit-visibility')?.value || 'private',
    type:document.getElementById('crate-edit-type')?.value || 'playlist'
  }));
  document.querySelectorAll('[data-crate-duplicate-editor]').forEach(button=>button.onclick=()=>duplicateLibraryCrateOptimistic(button.dataset.crateDuplicateEditor));
  document.querySelectorAll('[data-crate-archive-editor]').forEach(button=>button.onclick=()=>{ if(typeof confirm === 'function' && !confirm('Archive this crate? Audio files will not be deleted.')) return; deleteLibraryCrateOptimistic(button.dataset.crateArchiveEditor); });
  document.querySelectorAll('[data-crate-artwork]').forEach(input=>input.onchange=async e=>{ const result = await attachArtworkToCrate(e.currentTarget.dataset.crateArtwork, e.currentTarget.files && e.currentTarget.files[0]); if(!result.ok) alert(result.error); });
  document.querySelectorAll('[data-crate-select-all]').forEach(button=>button.onclick=selectAllCrateTracks);
  document.querySelectorAll('[data-crate-clear-selection]').forEach(button=>button.onclick=clearCrateSelection);
  document.querySelectorAll('[data-crate-bulk-remove]').forEach(button=>button.onclick=()=>removeTracksFromCrate(button.dataset.crateBulkRemove, state.crateEditor.selectedTrackIds || []));
  document.querySelectorAll('[data-crate-undo]').forEach(button=>button.onclick=()=>undoLastCrateEdit());
  document.querySelectorAll('[data-crate-bulk-add]').forEach(button=>button.onclick=()=>addSelectedTracksToCrates(Array.from(document.getElementById('crate-bulk-targets')?.selectedOptions || []).map(option => option.value)));
  document.querySelectorAll('[data-crate-validate]').forEach(button=>button.onclick=()=>validateBattlePrepCrate(button.dataset.crateValidate));
  document.querySelectorAll('[data-crate-open-studio]').forEach(button=>button.onclick=()=>openBattlePrepCrateInStudio(button.dataset.crateOpenStudio));
  document.querySelectorAll('[data-crate-suggestion]').forEach(button=>button.onclick=()=>replaceTrackInCrate(state.crateEditor.validation && state.crateEditor.validation.crateId || state.libraryFilters.crate, button.dataset.crateSuggestion, button.dataset.suggestionTrack));
}
function renderCompatibleList(base){
  const target = document.getElementById('compatible-track-list');
  if(!target) return;
  if(!base){
    target.innerHTML = '<small>Select a track to see harmonic and tempo matches.</small>';
    return;
  }
  const matches = compatibleTracksFor(base).slice(0,6);
  if(!matches.length){
    target.innerHTML = '<small>No BPM/key-compatible tracks found yet.</small>';
    return;
  }
  target.innerHTML = `<div class="compatible-list">${matches.map(track=>`<button class="compatible-item" data-library-select="${esc(track.libraryId)}"><span><strong>${esc(trackTitle(track))}</strong><small>${esc(trackArtist(track))} / ${esc(track.compatibility)}</small></span>${keyBadgeHtml(track.key)}</button>`).join('')}</div>`;
}
function renderLibraryDetail(track){
  const target = document.getElementById('library-detail');
  if(!target) return;
  if(!track){
    target.innerHTML = `<span class="eyebrow">TRACK DETAIL</span><h3>No Track Selected</h3><p style="color:var(--muted)">Load music or select a platform-cleared track.</p>${renderCrateEditorPanel()}`;
    renderCompatibleList(null);
    return;
  }
  const editable = track._libraryOrigin === 'my';
  target.innerHTML = `
    ${artworkMarkup(track, 'library-detail-art')}
    <div style="margin-top:12px"><span class="eyebrow">TRACK DETAIL</span><h3>${esc(trackTitle(track))}</h3><p style="color:var(--muted);margin:4px 0">${esc(trackArtist(track))}</p></div>
    <div class="library-readout-grid">
      <div class="library-readout"><span>BPM</span><strong>${esc(track.bpm)}</strong></div>
      <div class="library-readout"><span>KEY</span><strong>${keyBadgeHtml(track.key)}</strong></div>
      <div class="library-readout"><span>SOURCE</span><strong>${esc(trackSource(track))}</strong></div>
      <div class="library-readout"><span>RIGHTS</span><strong>${track.battleEligible ? 'READY' : 'LOCKED'}</strong></div>
    </div>
    ${editable ? `<label class="artwork-control">Track artwork<input type="file" accept="image/*" data-artwork-track="${esc(track.libraryId)}"></label>` : '<small style="color:var(--muted)">Platform artwork is controlled by the approved source catalog.</small>'}
    ${renderCrateEditorPanel()}
  `;
  renderCompatibleList(track);
}
function renderLibraryPlayer(){
  const track = getLibraryTrackById(state.libraryPlayer.trackId || state.selectedLibraryTrackId);
  const art = document.getElementById('library-player-art');
  const title = document.getElementById('library-player-title');
  const artist = document.getElementById('library-player-artist');
  const bpm = document.getElementById('library-player-bpm');
  const key = document.getElementById('library-player-key');
  const toggle = document.getElementById('library-player-toggle');
  const progress = document.getElementById('library-player-progress');
  const audio = document.getElementById('library-player-audio');
  if(!title || !artist || !toggle) return;
  if(!track){
    if(art) art.innerHTML = '';
    title.textContent = 'No track loaded';
    artist.textContent = 'Select a track from My Music';
    if(bpm) bpm.textContent = '-- BPM';
    if(key){ key.textContent = '--'; key.className = 'key-badge key-unknown'; }
    toggle.textContent = 'Play';
    toggle.disabled = true;
    return;
  }
  if(art) art.innerHTML = artworkInnerMarkup(track);
  title.textContent = trackTitle(track);
  artist.textContent = `${trackArtist(track)} / ${trackSource(track)}`;
  if(bpm) bpm.textContent = `${parseBpm(track) || '--'} BPM`;
  if(key){ key.textContent = track.key && track.key !== '—' ? track.key : '--'; key.className = `key-badge ${keyColorClass(track.key)}`; }
  const src = securePlaybackSource(track);
  if(audio && src && audio.getAttribute('src') !== src) audio.setAttribute('src', src);
  if(progress) progress.value = String(state.libraryPlayer.progress || 0);
  toggle.disabled = false;
  toggle.textContent = state.libraryPlayer.playing ? 'Pause' : 'Play';
}
function selectLibraryTrack(trackId, options={}){
  const track = getLibraryTrackById(trackId);
  if(!track) return false;
  state.selectedLibraryTrackId = track.libraryId;
  if(options.loadPlayer !== false) state.libraryPlayer.trackId = track.libraryId;
  if(options.play) state.libraryPlayer.playing = true;
  persistLibraryUiState();
  renderLibrary();
  return true;
}
function toggleLibraryPlayer(){
  const track = getLibraryTrackById(state.libraryPlayer.trackId || state.selectedLibraryTrackId);
  if(!track) return;
  state.libraryPlayer.trackId = track.libraryId;
  state.libraryPlayer.playing = !state.libraryPlayer.playing;
  const audio = document.getElementById('library-player-audio');
  const src = securePlaybackSource(track);
  if(audio && src){
    try{
      if(state.libraryPlayer.playing && audio.play) audio.play().catch(()=>{});
      if(!state.libraryPlayer.playing && audio.pause) audio.pause();
    }catch(e){}
  }
  persistLibraryUiState();
  renderLibraryPlayer();
}

function parseDurationSeconds(value){
  if(value == null || value === '—' || value === '--') return null;
  if(typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if(/^\d+:\d{2}$/.test(text)){
    const [minutes, seconds] = text.split(':').map(Number);
    return minutes * 60 + seconds;
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function activeStudioBattleSession(){
  return window.activeBattleSession || safeParse('djBattleActiveSession', null);
}

function normalizedBattleTrackName(value){
  return String(value && (value.title || value.name) || value || '').trim().toLowerCase();
}

function currentBattleModeConfig(session = activeStudioBattleSession()){
  if(!session) return null;
  return BattleModes.getBattleMode(session.modeId || session.mode || session.type) || null;
}

function trackIsOwnedOrPublic(track){
  if(!track) return false;
  if(track.visibility !== 'private') return true;
  if(track._libraryOrigin === 'platform') return true;
  const ownerId = state.musicLibrarySync.accountId || currentProfileUserId();
  return String(track.userId || ownerId) === String(ownerId);
}

function trackRightsPermitBattle(track){
  const rights = String(track.rightsCategory || track.rightsClassification || '').toLowerCase();
  if(rights.includes('commercial') || rights.includes('copyrighted')) return false;
  return Boolean(track.battleEligible || rights.includes('original') || rights.includes('licensed') || rights.includes('royalty') || rights.includes('platform'));
}

function libraryTrackLoadEligibility(track, deck='a', session = activeStudioBattleSession()){
  if(!track) return { allowed:false, reason:'Track is unavailable.' };
  if(!['a', 'b'].includes(String(deck))) return { allowed:false, reason:'Choose Deck A or Deck B.' };
  if(!trackIsOwnedOrPublic(track)) return { allowed:false, reason:'Private tracks from another DJ cannot be loaded.' };
  if(!trackRightsPermitBattle(track)) return { allowed:false, reason:'Track rights do not permit battle loading.' };
  if(!session) return { allowed:true, reason:'No active battle. Free studio loading is allowed.' };
  const mode = currentBattleModeConfig(session);
  if(!mode) return { allowed:false, reason:'Active battle mode is unavailable.' };
  if(mode.premiumRequired && !state.premium) return { allowed:false, reason:'This battle mode requires Premium.' };
  const assigned = (session.assigned || session.assignedTracks || []).map(normalizedBattleTrackName).filter(Boolean);
  const title = normalizedBattleTrackName(trackTitle(track));
  if(mode.trackSelectionMethod === 'assigned'){
    if(assigned.length && !assigned.includes(title)) return { allowed:false, reason:'This battle uses assigned tracks only.' };
  }
  if(mode.trackSelectionMethod === 'genre_pool'){
    const battleGenre = String(session.genre || '').toLowerCase();
    const trackGenre = String(track.genre || '').toLowerCase();
    if(battleGenre && !['global','all','open format'].includes(battleGenre) && trackGenre !== battleGenre) return { allowed:false, reason:'Track does not match the active genre pool.' };
  }
  if(['own_selection', 'ai_practice', 'open_library'].includes(mode.trackSelectionMethod) && !trackRightsPermitBattle(track)){
    return { allowed:false, reason:'Own-selection battles require cleared tracks.' };
  }
  const durationSeconds = parseDurationSeconds(track.duration);
  const maxSeconds = Number(session.duration || mode.defaultDurationMinutes || 0) * 60;
  if(durationSeconds && maxSeconds && durationSeconds > maxSeconds + 5) return { allowed:false, reason:'Track duration exceeds the active battle window.' };
  return { allowed:true, reason:`Ready for ${mode.label}.` };
}

function setStudioRuleStatus(message, kind='ok'){
  const target = document.getElementById('studio-library-rule-status');
  if(!target) return;
  target.textContent = message || '';
  target.className = `library-rule-status ${kind}`;
}

function normalizedDeckRecord(track){
  return {
    libraryId: track.libraryId,
    title: trackTitle(track),
    name: trackTitle(track),
    artist: trackArtist(track),
    bpm: parseBpm(track) || track.bpm || '--',
    key: track.key || '--',
    camelotKey: track.camelotKey || parseCamelotKey(track.key),
    genre: track.genre || 'Unsorted',
    source: trackSource(track),
    rights: track.rightsCategory || track.rightsClassification || 'Unverified',
    elig: track.battleEligible ? 'YES' : 'NO',
    dur: track.duration || '--',
    artwork: secureArtworkSource(track),
    sourceType: track.sourceType,
    linkedSubmissionId: track.linkedSubmissionId || null,
    usageRelationships: track.usageRelationships || {}
  };
}

function queueMusicLibrarySyncChange(change){
  if(!change || !['metadata','visibility','usage','crate','crate_membership','practice_recording'].includes(change.type)) return null;
  if(['metadata','visibility','usage'].includes(change.type) && !change.trackId) return null;
  if(['crate','crate_membership'].includes(change.type) && !change.crateId && change.action !== 'create') return null;
  const safe = {
    id: change.id || `q-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: change.type,
    action: change.action || '',
    trackId: change.trackId == null ? '' : String(change.trackId),
    crateId: change.crateId == null ? '' : String(change.crateId),
    body: change.body && typeof change.body === 'object' ? JSON.parse(JSON.stringify(change.body)) : {},
    queuedAt: new Date().toISOString()
  };
  delete safe.body.securePlaybackUrl;
  delete safe.body.playbackUrl;
  delete safe.body.previewUrl;
  delete safe.body.uploadToken;
  state.musicLibrarySync.pendingQueue = [...(state.musicLibrarySync.pendingQueue || []), safe];
  setMusicLibrarySyncStatus('offline', { pendingQueue:state.musicLibrarySync.pendingQueue, error:'Changes queued until the server is reachable.' });
  return safe;
}

function applyTrackPatchLocal(track, patch){
  if(!track || !patch) return track;
  if(patch.title != null){ track.title = patch.title; track.name = patch.title; }
  if(patch.artist != null) track.artist = patch.artist;
  if(patch.bpm != null) track.bpm = patch.bpm;
  if(patch.key != null){ track.key = patch.key; track.camelotKey = parseCamelotKey(patch.key); }
  if(patch.genre != null) track.genre = patch.genre;
  if(patch.duration != null) track.duration = patch.duration;
  if(patch.tags != null) track.tags = Array.isArray(patch.tags) ? patch.tags : [];
  if(patch.visibility != null) track.visibility = patch.visibility;
  if(patch.rightsClassification != null){ track.rightsClassification = patch.rightsClassification; track.rightsCategory = rightsClassificationLabel(patch.rightsClassification); track.battleEligible = !String(track.rightsCategory).toLowerCase().includes('commercial'); }
  if(patch.analysisConfidence != null) track.analysisConfidence = patch.analysisConfidence;
  if(patch.usageRelationships != null) track.usageRelationships = patch.usageRelationships;
  track.syncStatus = track.serverBacked ? 'optimistic' : track.syncStatus;
  return track;
}

async function updateLibraryTrackMetadataOptimistic(trackId, patch){
  const editable = getEditableLibraryTrack(trackId);
  if(!editable) return { ok:false, error:'Library track is unavailable.' };
  const before = JSON.parse(JSON.stringify(editable.track));
  applyTrackPatchLocal(editable.track, patch);
  persist();
  renderLibrary();
  renderStudioLibrary();
  renderProfile();
  if(!editable.track.serverBacked) return { ok:true, local:true, track:editable.track };
  if(!window.DJBattleApi || !window.DJBattleApi.apiRequest || state.musicLibrarySync.status === 'offline'){
    queueMusicLibrarySyncChange({ type: patch.visibility != null ? 'visibility' : 'metadata', trackId:editable.track.id, body:patch });
    return { ok:true, queued:true, track:editable.track };
  }
  const response = await window.DJBattleApi.apiRequest(`/api/musicLibrary/tracks/${encodeURIComponent(editable.track.id)}`, { method:'PATCH', body:patch });
  if(response.error){
    state.library[editable.index] = before;
    persist();
    setMusicLibrarySyncStatus(response.status === 409 ? 'conflict' : 'failed', { error:response.error });
    renderLibrary();
    renderStudioLibrary();
    renderProfile();
    return { ok:false, error:response.error, rolledBack:true };
  }
  const merged = mergeServerTrack(response.data && response.data.track);
  setMusicLibrarySyncStatus('synced', { error:'', lastSyncedAt:new Date().toISOString() });
  renderLibrary();
  renderStudioLibrary();
  renderProfile();
  return { ok:true, track:merged };
}

async function flushMusicLibrarySyncQueue(){
  const queue = state.musicLibrarySync.pendingQueue || [];
  if(!queue.length) return { flushed:0, remaining:0 };
  if(!window.DJBattleApi || !window.DJBattleApi.apiRequest) {
    setMusicLibrarySyncStatus('offline', { error:'Server API unavailable', pendingQueue:queue });
    return { flushed:0, remaining:queue.length };
  }
  const remaining = [];
  let flushed = 0;
  for(const item of queue){
    let response;
    if(item.type === 'usage'){
      response = await window.DJBattleApi.apiRequest(`/api/musicLibrary/tracks/${encodeURIComponent(item.trackId)}/usage`, { method:'POST', body:item.body });
    } else if(item.type === 'crate'){
      if(item.action === 'create') response = await window.DJBattleApi.apiRequest('/api/musicLibrary/crates', { method:'POST', body:item.body });
      else if(item.action === 'delete') response = await window.DJBattleApi.apiRequest(`/api/musicLibrary/crates/${encodeURIComponent(item.crateId)}`, { method:'DELETE' });
      else response = await window.DJBattleApi.apiRequest(`/api/musicLibrary/crates/${encodeURIComponent(item.crateId)}`, { method:'PATCH', body:item.body });
    } else if(item.type === 'crate_membership'){
      response = await window.DJBattleApi.apiRequest(`/api/musicLibrary/crates/${encodeURIComponent(item.crateId)}/tracks`, { method:'PUT', body:item.body });
    } else if(item.type === 'practice_recording'){
      response = await window.DJBattleApi.apiRequest('/api/musicLibrary/practiceRecordings', { method:'POST', body:item.body });
    } else {
      response = await window.DJBattleApi.apiRequest(`/api/musicLibrary/tracks/${encodeURIComponent(item.trackId)}`, { method:'PATCH', body:item.body });
    }
    if(response.error) remaining.push(item);
    else {
      flushed += 1;
      if(response.data && response.data.track) mergeServerTrack(response.data.track);
      if(response.data && response.data.crate) mergeServerCrate(response.data.crate);
    }
  }
  state.musicLibrarySync.pendingQueue = remaining;
  setMusicLibrarySyncStatus(remaining.length ? 'offline' : 'synced', { pendingQueue:remaining, error:remaining.length ? 'Some queued changes still need retry.' : '', lastSyncedAt:remaining.length ? state.musicLibrarySync.lastSyncedAt : new Date().toISOString() });
  persist();
  renderLibrary();
  renderStudioLibrary();
  renderProfile();
  return { flushed, remaining:remaining.length };
}

function recordLibraryTrackUsageLocal(track, relationship){
  if(!track || track._libraryOrigin !== 'my') return;
  const editable = getEditableLibraryTrack(track.libraryId);
  if(!editable) return;
  const usage = editable.track.usageRelationships || editable.track.usage_relationships || { playlists:[], battles:[], posts:[], practiceHistory:[], submissions:[] };
  const bucket = relationship.type === 'battle' ? 'battles'
    : relationship.type === 'post' ? 'posts'
    : relationship.type === 'practice' ? 'practiceHistory'
    : relationship.type === 'submission' ? 'submissions'
    : 'playlists';
  if(!Array.isArray(usage[bucket])) usage[bucket] = [];
  if(relationship.id && !usage[bucket].includes(relationship.id)) usage[bucket].push(relationship.id);
  editable.track.usageRelationships = usage;
  persist();
  if(editable.track.serverBacked){
    if(window.DJBattleApi && window.DJBattleApi.apiRequest && state.musicLibrarySync.status !== 'offline'){
      window.DJBattleApi.apiRequest(`/api/musicLibrary/tracks/${encodeURIComponent(editable.track.id)}/usage`, { method:'POST', body:relationship }).catch(()=>queueMusicLibrarySyncChange({ type:'usage', trackId:editable.track.id, body:relationship }));
    } else {
      queueMusicLibrarySyncChange({ type:'usage', trackId:editable.track.id, body:relationship });
    }
  }
}

function loadLibraryTrackToDeck(trackId, deck='a'){
  return deckRuntimeManager ? deckRuntimeManager.loadLibraryTrackToDeck(trackId, deck) : { ok:false, error:'Deck runtime module unavailable.' };
}

function selectLibraryRecordingForSubmission(trackId){
  return deckRuntimeManager ? deckRuntimeManager.selectLibraryRecordingForSubmission(trackId) : { ok:false, error:'Deck runtime module unavailable.' };
}

function openStudioLibraryDrawer(deck='a'){
  return deckRuntimeManager ? deckRuntimeManager.openDrawer(deck) : false;
}

function closeStudioLibraryDrawer(){
  return deckRuntimeManager ? deckRuntimeManager.closeDrawer() : undefined;
}

function renderStudioLibraryDrawer(){
  return deckRuntimeManager ? deckRuntimeManager.renderDrawer() : undefined;
}

async function attachArtworkToTrack(trackId, file){
  const editable = getEditableLibraryTrack(trackId);
  if(!editable) return { ok:false, error:'Artwork can only be attached to your own uploaded tracks.' };
  if(!file || !/^image\//i.test(file.type || '')) return { ok:false, error:'Choose a PNG, JPG, GIF or WebP image.' };
  if(Number(file.size || 0) > 1024 * 1024) return { ok:false, error:'Artwork must be 1 MB or smaller.' };
  if(editable.track.serverBacked && window.DJBattleApi && window.DJBattleApi.apiRequest && window.supabase && window.supabase.storage){
    const authorization = await window.DJBattleApi.apiRequest(`/api/musicLibrary/tracks/${encodeURIComponent(editable.track.id)}/artworkUploadAuthorization`, {
      method:'POST',
      body:{ filename:file.name || 'artwork', mimeType:file.type, size:file.size }
    });
    if(authorization.error) return { ok:false, error:authorization.error };
    const storage = window.supabase.storage.from(authorization.data.bucket);
    const uploaded = await storage.uploadToSignedUrl(authorization.data.uploadPath, authorization.data.uploadToken, file, { contentType:file.type });
    if(uploaded.error) return { ok:false, error:uploaded.error.message || 'Artwork upload failed.' };
    const completed = await window.DJBattleApi.apiRequest(`/api/musicLibrary/tracks/${encodeURIComponent(editable.track.id)}/completeArtworkUpload`, { method:'POST' });
    if(completed.error) return { ok:false, error:completed.error };
    const updated = mergeServerTrack(completed.data && completed.data.track);
    renderLibrary();
    renderStudioLibrary();
    return { ok:true, track:updated };
  }
  const dataUrl = file.dataUrl || await new Promise((resolve, reject)=>{
    if(typeof FileReader === 'undefined') return reject(new Error('FileReader unavailable'));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Artwork could not be read.'));
    reader.readAsDataURL(file);
  }).catch(error => ({ error }));
  if(typeof dataUrl !== 'string' || !isSafeArtworkSource(dataUrl)) return { ok:false, error:'Artwork source was rejected for privacy.' };
  editable.track.artworkDataUrl = dataUrl;
  editable.track.artwork = dataUrl;
  editable.track.artworkUpdatedAt = new Date().toISOString();
  persist();
  renderLibrary();
  renderStudioLibrary();
  return { ok:true, src:dataUrl };
}

function handleLibraryFilesWithMeta(files){
  const list = Array.from(files || []);
  function next(){
    if(list.length===0){ persist(); persistPlatform(); renderLibrary(); renderPlatformLibrary(); renderStreamingServices(); return; }
    const f = list.shift();
    openModal(`<span class="eyebrow accent">UPLOAD TRACK</span><h3>Upload ${esc(f.name)}</h3><div class="form-grid"><label>Title<input id="meta-title" value="${esc(f.name.replace(/\.[^/.]+$/, ''))}"></label><label>Artist<input id="meta-artist" placeholder="Artist"></label><label>Genre<input id="meta-genre" placeholder="Genre"></label><label>Rights Category<select id="meta-rights"><option>Original / I Own the Rights</option><option>Licensed / I Have Permission</option><option>Royalty-Free / Cleared</option><option>Commercial / Copyrighted Music</option><option>Unsure</option></select></label><label class="toggle-row">I confirm that I own the necessary rights to this music or have permission to upload and use it on this platform.<input type="checkbox" id="meta-declare"></label></div><div class="modal-actions"><button class="ghost" value="cancel">Cancel</button><button class="primary" id="meta-save">Upload</button></div>`);
    setTimeout(()=>{
      document.getElementById('meta-save').onclick = async ()=>{
        const title = document.getElementById('meta-title').value || f.name;
        const artist = document.getElementById('meta-artist').value || 'Unknown';
        const genre = document.getElementById('meta-genre').value || 'Unsorted';
        const rights = document.getElementById('meta-rights').value;
        const declared = !!document.getElementById('meta-declare').checked;
        const serverUpload = await createServerBackedLibraryTrackFromFile(f, { title, artist, genre, rightsClassification:rightsCategoryToClassification(rights) }).catch(error => ({ error:String(error && error.message || error) }));
        if(serverUpload && serverUpload.data && serverUpload.data.track){
          if(window.URL && window.URL.createObjectURL){
            try{ librarySessionAudioUrls.set(serverUpload.data.track.id, window.URL.createObjectURL(f)); }catch(e){}
          }
          document.getElementById('modal').close();
          next();
          return;
        }
        const track = { id: 'u-'+Date.now(), title, name: title, artist, uploader: (document.getElementById('profile-name')?.textContent||'You'), album:null, artwork:null, artworkDataUrl:null, genre, bpm:'--', key:'--', duration:'--', uploadDate: new Date().toISOString(), size: f.size||0, source:'MY_LIBRARY', rightsCategory: rights, rightsDeclared: declared, copyrightCheck: 'Not Checked', battleEligible: rights !== 'Commercial / Copyrighted Music', permissions: defaultPermissions(), stems:false };
        if(window.URL && window.URL.createObjectURL){
          try{ librarySessionAudioUrls.set(track.id, window.URL.createObjectURL(f)); }catch(e){}
        }
        state.library.push(track);
        persist();
        document.getElementById('modal').close();
        next();
      };
    },0);
  }
  next();
}
document.getElementById('library-upload').onchange=e=>handleLibraryFilesWithMeta(e.target.files);
document.getElementById('quick-upload').onclick=()=>{switchView('library');document.getElementById('library-upload').click();};

function renderLibrary(){
  const body=document.getElementById('library-table');
  if(!state.library.length){
    body.innerHTML='<tr><td colspan="7"><small>No tracks yet. Upload music to build your DJ library.</small></td></tr>';
  } else {
    body.innerHTML=state.library.map((t,i)=>`<tr><td><strong>${esc(t.name)}</strong><small>${(t.size/1024/1024||0).toFixed(1)} MB</small></td><td>${t.source||'MY_LIBRARY'}</td><td>${t.genre}</td><td>${t.bpm}</td><td>${t.key}</td><td>${t.rightsCategory?('<span style="color:'+ (t.rightsCategory.includes('Commercial')? '#f66':'var(--accent)') +'">'+esc(t.rightsCategory)+'</span>'):'—'}</td><td class="track-actions"><button data-rights-check="${i}">Check Rights</button> <button data-add-playlist="${i}">＋Pl</button> <button data-remove="${i}">×</button></td></tr>`).join('');
  }
  const max=state.premium?50:5;
  document.getElementById('storage-progress').style.width=`${Math.min(100,state.library.length/max*100)}%`;
  document.getElementById('storage-label').textContent=`${state.library.length} / ${max} tracks`;
  document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{state.library.splice(Number(b.dataset.remove),1);persist();renderLibrary();});
  document.querySelectorAll('[data-rights-check]').forEach(b=>b.onclick=async(e)=>{const idx=Number(e.currentTarget.dataset.rightsCheck); await runCopyrightCheck(state.library[idx]); renderLibrary();});
  document.querySelectorAll('[data-add-playlist]').forEach(b=>b.onclick=()=>{ const idx=Number(b.dataset.addPlaylist); addTrackToPlaylist(state.library[idx]); });
  renderProfile();
}

function renderLibrary(){
  const body=document.getElementById('library-table');
  if(!body) return;
  renderMusicLibrarySyncStatus();
  updateLibraryCrateCounts();
  const sortField = document.getElementById('library-sort-field');
  const sortDirection = document.getElementById('library-sort-direction');
  const search = document.getElementById('global-search');
  const compatibleOnly = document.getElementById('library-compatible-only');
  document.querySelectorAll('[data-library-crate]').forEach(button=>button.onclick=()=>{ state.libraryFilters.crate = button.dataset.libraryCrate || 'all'; renderLibrary(); });
  if(sortField) sortField.onchange = e => { state.librarySort.field = e.target.value || 'title'; persistLibraryUiState(); renderLibrary(); };
  if(sortDirection) sortDirection.onclick = () => { state.librarySort.direction = state.librarySort.direction === 'desc' ? 'asc' : 'desc'; persistLibraryUiState(); renderLibrary(); };
  if(search) search.oninput = e => { state.libraryFilters.search = e.target.value || ''; renderLibrary(); renderStreamBrowser(state.libraryFilters.search); };
  if(compatibleOnly) compatibleOnly.onchange = e => { state.libraryFilters.compatibleOnly = Boolean(e.target.checked); renderLibrary(); };
  const playerToggle = document.getElementById('library-player-toggle');
  if(playerToggle) playerToggle.onclick = toggleLibraryPlayer;
  const playerProgress = document.getElementById('library-player-progress');
  if(playerProgress) playerProgress.oninput = e => { state.libraryPlayer.progress = Number(e.target.value || 0); persistLibraryUiState(); renderLibraryPlayer(); };
  if(sortField) sortField.value = state.librarySort.field || 'title';
  if(sortDirection) sortDirection.textContent = (state.librarySort.direction || 'asc').toUpperCase();
  if(search && search.value !== state.libraryFilters.search) search.value = state.libraryFilters.search || '';
  if(compatibleOnly) compatibleOnly.checked = Boolean(state.libraryFilters.compatibleOnly);
  const rows = filterLibraryTracks();
  const activeCrate = getLibraryCrateById(state.libraryFilters.crate);
  const crateEditing = crateEditorActiveFor(activeCrate);
  const selectedCrateIds = new Set(state.crateEditor.selectedTrackIds || []);
  const selected = getLibraryTrackById(state.selectedLibraryTrackId) || getLibraryTrackById(state.libraryPlayer.trackId) || rows[0] || null;
  if(selected) state.selectedLibraryTrackId = selected.libraryId;
  if(!rows.length){
    body.innerHTML='<tr><td colspan="9"><small>No tracks match this crate, search or compatibility filter.</small></td></tr>';
  } else {
    body.innerHTML=rows.map((t)=>`
      <tr data-library-row="${esc(t.libraryId)}" tabindex="0" draggable="${crateEditing ? 'true' : 'false'}" class="${selected && selected.libraryId === t.libraryId ? 'selected' : ''} ${selectedCrateIds.has(t.libraryId) ? 'crate-selected' : ''} ${state.crateEditor.dragOverTrackId === t.libraryId ? 'crate-drop-target' : ''}">
        <td>${crateEditing ? `<label class="crate-row-select"><input type="checkbox" data-crate-select-track="${esc(t.libraryId)}" ${selectedCrateIds.has(t.libraryId) ? 'checked' : ''}><span class="drag-handle" data-crate-drag="${esc(t.libraryId)}" aria-label="Drag reorder handle">::</span></label>` : artworkMarkup(t)}</td>
        <td><strong class="library-track-title">${esc(trackTitle(t))}</strong><small class="library-track-meta">${esc(t.duration || '—')} / ${t.battleEligible ? 'Battle ready' : 'Rights locked'}</small></td>
        <td>${esc(trackArtist(t))}</td>
        <td>${esc(trackSource(t))}</td>
        <td>${esc(t.genre || 'Unsorted')}</td>
        <td>${esc(parseBpm(t) || t.bpm || '—')}</td>
        <td>${keyBadgeHtml(t.key)}</td>
        <td>${t.rightsCategory ? `<span style="color:${String(t.rightsCategory).includes('Commercial')? '#f66':'var(--accent)'}">${esc(t.rightsCategory)}</span>`:'—'}</td>
        <td class="track-actions">
          <button data-library-play="${esc(t.libraryId)}">Load</button>
          <button data-library-load-deck="a" data-library-track="${esc(t.libraryId)}">Deck A</button>
          <button data-library-load-deck="b" data-library-track="${esc(t.libraryId)}">Deck B</button>
          ${crateEditing ? `<button data-crate-move="up" data-crate-track="${esc(t.libraryId)}">Up</button><button data-crate-move="down" data-crate-track="${esc(t.libraryId)}">Down</button>` : ''}
          ${t._libraryOrigin === 'my' ? `<button data-rights-check="${esc(t.libraryId)}">Rights</button> <button data-add-playlist="${esc(t.libraryId)}">+Pl</button> <button data-remove="${esc(t.libraryId)}">X</button>` : `<button data-library-select="${esc(t.libraryId)}">Cue</button>`}
        </td>
      </tr>
    `).join('');
  }
  const max=state.premium?50:5;
  const storageProgress = document.getElementById('storage-progress');
  const storageLabel = document.getElementById('storage-label');
  if(storageProgress) storageProgress.style.width=`${Math.min(100,state.library.length/max*100)}%`;
  if(storageLabel) storageLabel.textContent=`${state.library.length} / ${max} tracks`;
  renderLibraryStatus(rows);
  renderLibraryDetail(selected);
  renderLibraryPlayer();
  document.querySelectorAll('[data-library-row]').forEach(row=>row.onclick=(e)=>{ if(e.target.closest('button,input,label')) return; selectLibraryTrack(row.dataset.libraryRow, { loadPlayer:false }); });
  document.querySelectorAll('[data-library-select]').forEach(b=>b.onclick=(e)=>selectLibraryTrack(e.currentTarget.dataset.librarySelect, { loadPlayer:false }));
  document.querySelectorAll('[data-library-play]').forEach(b=>b.onclick=(e)=>selectLibraryTrack(e.currentTarget.dataset.libraryPlay, { play:true }));
  document.querySelectorAll('[data-library-load-deck]').forEach(b=>b.onclick=(e)=>loadLibraryTrackToDeck(e.currentTarget.dataset.libraryTrack, e.currentTarget.dataset.libraryLoadDeck));
  document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{const editable=getEditableLibraryTrack(b.dataset.remove); if(editable){state.library.splice(editable.index,1);persist();renderLibrary();renderStudioLibrary();}});
  document.querySelectorAll('[data-rights-check]').forEach(b=>b.onclick=async(e)=>{const editable=getEditableLibraryTrack(e.currentTarget.dataset.rightsCheck); if(editable){ await runCopyrightCheck(editable.track); renderLibrary(); }});
  document.querySelectorAll('[data-add-playlist]').forEach(b=>b.onclick=()=>{ const editable=getEditableLibraryTrack(b.dataset.addPlaylist); if(editable) addTrackToPlaylist(editable.track); });
  document.querySelectorAll('[data-artwork-track]').forEach(input=>input.onchange=async(e)=>{ const result = await attachArtworkToTrack(e.currentTarget.dataset.artworkTrack, e.currentTarget.files && e.currentTarget.files[0]); if(!result.ok) alert(result.error); });
  document.querySelectorAll('[data-crate-select-track]').forEach(input=>input.onchange=e=>selectCrateTrack(e.currentTarget.dataset.crateSelectTrack, { shift:e.shiftKey, ctrl:e.ctrlKey, meta:e.metaKey, toggle:true }));
  document.querySelectorAll('[data-crate-move]').forEach(button=>button.onclick=()=>reorderCrateTrack(state.libraryFilters.crate, button.dataset.crateTrack, button.dataset.crateMove));
  document.querySelectorAll('tr[data-library-row]').forEach(row=>{
    row.ondragstart = e => { if(!crateEditing) return; state.crateEditor.dragTrackId = row.dataset.libraryRow; e.dataTransfer?.setData('text/plain', row.dataset.libraryRow); };
    row.ondragover = e => { if(!crateEditing) return; e.preventDefault(); state.crateEditor.dragOverTrackId = row.dataset.libraryRow; row.classList.add('crate-drop-target'); };
    row.ondragleave = () => row.classList.remove('crate-drop-target');
    row.ondrop = e => { if(!crateEditing) return; e.preventDefault(); const moving = state.crateEditor.dragTrackId || e.dataTransfer?.getData('text/plain'); reorderCrateTrack(state.libraryFilters.crate, moving, row.dataset.libraryRow); };
    row.onkeydown = e => {
      if(!crateEditing) return;
      if(e.key === ' '){ e.preventDefault(); selectCrateTrack(row.dataset.libraryRow, { toggle:true, ctrl:true }); }
      if(e.key === 'ArrowUp' && (e.altKey || e.ctrlKey)){ e.preventDefault(); reorderCrateTrack(state.libraryFilters.crate, row.dataset.libraryRow, 'up'); }
      if(e.key === 'ArrowDown' && (e.altKey || e.ctrlKey)){ e.preventDefault(); reorderCrateTrack(state.libraryFilters.crate, row.dataset.libraryRow, 'down'); }
      if((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)){ e.preventDefault(); selectAllCrateTracks(); }
    };
  });
  attachCrateEditorHandlers();
  renderProfile();
}

let studioStreamingManager = null;
let playlistTransferManager = null;
let studioBrowserManager = null;
let deckRuntimeManager = null;

function streamingCatalogRows(){
  return studioStreamingManager ? studioStreamingManager.catalogRows() : [];
}
function renderStreamingServices(){
  return studioStreamingManager ? studioStreamingManager.renderServices() : undefined;
}
function metadataPlaylistCrate(){
  return studioStreamingManager ? studioStreamingManager.metadataPlaylistCrate() : null;
}
function importStreamingMetadataRow(row){
  return studioStreamingManager ? studioStreamingManager.importRow(row) : { ok:false, error:'Streaming module unavailable.' };
}
function renderStreamBrowser(q){
  return studioStreamingManager ? studioStreamingManager.renderBrowser(q) : undefined;
}

function parsePlaylistText(text, fileName){
  return playlistTransferManager ? playlistTransferManager.parsePlaylistText(text, fileName) : [];
}
function importPlaylistFile(file){
  return playlistTransferManager ? playlistTransferManager.importPlaylistFile(file) : { ok:false, error:'Playlist transfer module unavailable.' };
}
function exportActiveStudioPlaylist(format){
  return playlistTransferManager ? playlistTransferManager.exportActiveStudioPlaylist(format) : { ok:false, error:'Playlist transfer module unavailable.' };
}
function wirePlaylistTransferControls(){
  return playlistTransferManager ? playlistTransferManager.wireControls() : undefined;
}

function playlistBrowserRows(){
  return studioBrowserManager ? studioBrowserManager.playlistBrowserRows() : [];
}
function renderStudioSourcePanels(source){
  return studioBrowserManager ? studioBrowserManager.renderSourcePanels(source) : undefined;
}
function renderStudioLibrary(filterQ){
  return studioBrowserManager ? studioBrowserManager.renderLibrary(filterQ) : undefined;
}
function loadTrackToDeck(rec, deck){
  return deckRuntimeManager ? deckRuntimeManager.loadTrackToDeck(rec, deck) : { ok:false, error:'Deck runtime module unavailable.' };
}
function renderWaveformForDeck(deck, rec){
  return deckRuntimeManager ? deckRuntimeManager.renderWaveformForDeck(deck, rec) : undefined;
}
function startMeterAnimation(deck){
  return deckRuntimeManager ? deckRuntimeManager.startMeterAnimation(deck) : undefined;
}
function stopMeterAnimation(deck){
  return deckRuntimeManager ? deckRuntimeManager.stopMeterAnimation(deck) : undefined;
}
function setFocusedDeck(deck){
  return deckRuntimeManager ? deckRuntimeManager.setFocusedDeck(deck) : 'a';
}
function getFocusedDeck(){
  return deckRuntimeManager ? deckRuntimeManager.getFocusedDeck() : 'a';
}
function renderDeckCues(deck){
  return deckRuntimeManager ? deckRuntimeManager.renderDeckCues(deck) : undefined;
}
function setCue(deck){
  return deckRuntimeManager ? deckRuntimeManager.setCue(deck) : { ok:false, error:'Deck runtime module unavailable.' };
}
function addHotcue(deck){
  return deckRuntimeManager ? deckRuntimeManager.addHotcue(deck) : { ok:false, error:'Deck runtime module unavailable.' };
}
function persistDecks(){
  return deckRuntimeManager ? deckRuntimeManager.persistDecks() : undefined;
}

// Mobile studio view switches
const studioGrid = document.querySelector('.studio-grid');
function setStudioMobileView(view){ if(!studioGrid) return; studioGrid.classList.add('mobile-mode'); studioGrid.classList.remove('mobile-show-decka','mobile-show-deckb'); if(view==='decka') studioGrid.classList.add('mobile-show-decka'); if(view==='deckb') studioGrid.classList.add('mobile-show-deckb'); }

// wire mobile switcher buttons (if present)
setTimeout(()=>{
  const controls = document.createElement('div'); controls.className='studio-controls-mobile'; controls.innerHTML = '<button class="ghost small" id="mobile-decka">DECK A</button><button class="ghost small" id="mobile-library">LIBRARY</button><button class="ghost small" id="mobile-deckb">DECK B</button><button class="ghost small" id="mobile-battle">BATTLE</button>';
  const parent = document.querySelector('.studio-head'); if(parent) parent.insertAdjacentElement('afterend', controls);
  document.getElementById('mobile-decka').onclick = ()=> setStudioMobileView('decka');
  document.getElementById('mobile-deckb').onclick = ()=> setStudioMobileView('deckb');
  document.getElementById('mobile-library').onclick = ()=>{ if(studioGrid) studioGrid.classList.remove('mobile-mode','mobile-show-decka','mobile-show-deckb'); };
  document.getElementById('mobile-battle').onclick = ()=>{ if(studioGrid) { studioGrid.classList.add('mobile-mode'); studioGrid.classList.remove('mobile-show-decka'); studioGrid.classList.add('mobile-show-deckb'); } };
},400);

let activeProfileTab = 'music';
function profileCard(title, detail, icon='♫'){return `<article class="media-card"><div class="cover">${icon}</div><h4>${esc(title)}</h4><p>${esc(detail)}</p></article>`;}
function historyResultId(result){
  return result && (result.resultKey || result.submissionId || result.verifiedResultId || result.id);
}

function historyBattle(result){
  return result && result.battle || {};
}

function historyTitle(result){
  return result && (result.title || historyBattle(result).title) || 'Battle Result';
}

function historyMode(result){
  return result && (result.modeId || historyBattle(result).modeId || result.type || historyBattle(result).type) || 'battle';
}

function historyType(result){
  return result && (result.type || historyBattle(result).type || result.modeId || historyBattle(result).modeId) || 'Battle';
}

function historyGenre(result){
  return result && (result.genre || historyBattle(result).genre) || 'Open Format';
}

function historyCompletedAt(result){
  return result && (result.completedAt || result.date) || null;
}

function historyDateText(result){
  const value = historyCompletedAt(result);
  if(!value) return 'Date pending';
  const parsed = new Date(value);
  if(Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString();
}

function historyOpponent(result){
  const opponent = result && result.opponent || {};
  if(opponent.status === 'ai_only' || opponent.status === 'practice') return 'AI-only';
  if(opponent.name) return opponent.country ? `${opponent.name} (${opponent.country})` : opponent.name;
  if(result && result.outcome === 'practice') return 'AI-only';
  return 'Opponent pending';
}

function historyOpponentStatus(result){
  const opponent = result && result.opponent || {};
  if(opponent.status === 'ai_only' || result && result.outcome === 'practice') return 'ai_only';
  if(opponent.status === 'opponent' || opponent.name) return 'opponent';
  return opponent.status || 'unmatched';
}

function historyProgression(result){
  const progression = result && result.progression || {};
  const before = result && result.progressBefore || {};
  const after = result && result.progressAfter || {};
  return {
    xp: Number(progression.xp || 0),
    ratingDelta: Number(progression.ratingDelta || 0),
    beltBefore: progression.beltBefore || result && result.beltBefore || before.belt || 'Unranked',
    beltAfter: progression.beltAfter || result && result.beltAfter || after.belt || 'Unranked',
    rankBefore: progression.rankingBefore || result && result.rankBefore || null,
    rankAfter: progression.rankingAfter || result && result.rankAfter || null
  };
}

function historyDetails(result){
  const evidence = result && result.evidence || {};
  const details = result && result.details || {};
  return {
    breakdown: details.breakdown || evidence.breakdown || {},
    timing: details.timing || evidence.timing || [],
    rawMeasurements: details.rawMeasurements || evidence.rawMeasurements || [],
    recommendations: details.recommendations || evidence.recommendations || [],
    confidence: details.confidence || evidence.confidence || null,
    measurableAnalysis: details.measurableAnalysis || evidence.measurableAnalysis || null,
    scoringModel: details.scoringModel || result && result.scoringModel || null,
    evidenceType: details.evidenceType || result && result.evidenceType || null,
    reward: details.reward || result && result.reward || null,
    battlePrep: details.battlePrep || result && result.battlePrep || null
  };
}

function historySourceLabels(result){
  const labels = result && (result.sourceLabels || result.scoringSource);
  if(Array.isArray(labels) && labels.length) return labels;
  const details = historyDetails(result);
  return scoringSourceLabels({
    evidenceType: details.evidenceType,
    measurableAnalysis: details.measurableAnalysis,
    scoringModel: details.scoringModel,
    confidence: details.confidence,
    aiFeedback: result && result.aiFeedback,
    humanVoting: result && result.humanVoting
  });
}

function historyBitcoin(result){
  if(result && result.bitcoin) return result.bitcoin;
  const reward = result && result.reward || historyDetails(result).reward || {};
  if(reward.type !== 'bitcoin') return null;
  const metadata = reward.metadata || {};
  return {
    amountSats: Number.isFinite(Number(metadata.amountSats)) ? Number(metadata.amountSats) : null,
    custody: metadata.custody || 'external_pending',
    transferStatus: reward.transferStatus || (metadata.verifiedPaymentId || metadata.paymentVerified === true ? 'verified payment record' : 'untransferred')
  };
}

function bitcoinHistoryText(result){
  const bitcoin = historyBitcoin(result);
  if(!bitcoin) return 'No Bitcoin metadata';
  const sats = bitcoin.amountSats == null ? 'amount pending' : `${bitcoin.amountSats} sats`;
  const status = String(bitcoin.transferStatus || 'untransferred');
  return `Bitcoin reward metadata: ${sats}, ${status === 'verified_payment_record' ? 'verified payment record' : status}.`;
}

function uniqueHistoryOptions(kind){
  const values = new Set();
  state.battleResults.forEach(result => {
    const value = kind === 'mode' ? historyMode(result) : historyGenre(result);
    if(value) values.add(value);
  });
  return Array.from(values).sort((a,b)=>String(a).localeCompare(String(b)));
}

function dateBucketMatches(result, bucket){
  if(bucket === 'all') return true;
  const value = historyCompletedAt(result);
  const date = value ? new Date(value) : null;
  if(!date || Number.isNaN(date.getTime())) return false;
  const ageMs = Date.now() - date.getTime();
  if(bucket === '7d') return ageMs <= 7 * 24 * 60 * 60 * 1000;
  if(bucket === '30d') return ageMs <= 30 * 24 * 60 * 60 * 1000;
  if(bucket === 'year') return ageMs <= 365 * 24 * 60 * 60 * 1000;
  return true;
}

function filterBattleHistoryResults(results = state.battleResults, filters = state.battleHistoryFilters){
  const current = filters || {};
  return results.filter(result => {
    if(current.mode && current.mode !== 'all' && historyMode(result) !== current.mode) return false;
    if(current.genre && current.genre !== 'all' && historyGenre(result) !== current.genre) return false;
    if(current.result && current.result !== 'all' && String(result.outcome || 'recorded') !== current.result) return false;
    if(current.opponent && current.opponent !== 'all' && historyOpponentStatus(result) !== current.opponent) return false;
    if(current.date && !dateBucketMatches(result, current.date)) return false;
    return true;
  });
}

function historyChip(label, value, className = ''){
  return `<div class="battle-history-chip ${className}"><span>${esc(label)}</span><b>${esc(value == null || value === '' ? 'N/A' : value)}</b></div>`;
}

function findBattleHistoryResult(identifier){
  const key = String(identifier || '');
  return state.battleResults.find(result => String(historyResultId(result)) === key || String(result.submissionId || '') === key || String(result.verifiedResultId || '') === key) || null;
}

function renderBattleHistory(){
  const target=document.getElementById('profile-media'); if(!target) return;
  target.className = 'battle-history-panel';
  const filters = state.battleHistoryFilters;
  const modeOptions = ['all', ...uniqueHistoryOptions('mode')].map(value=>`<option value="${esc(value)}" ${filters.mode===value?'selected':''}>${esc(value === 'all' ? 'All modes' : readableComponentName(value))}</option>`).join('');
  const genreOptions = ['all', ...uniqueHistoryOptions('genre')].map(value=>`<option value="${esc(value)}" ${filters.genre===value?'selected':''}>${esc(value === 'all' ? 'All genres' : value)}</option>`).join('');
  const resultOptions = ['all','win','loss','tie','practice','recorded'].map(value=>`<option value="${value}" ${filters.result===value?'selected':''}>${esc(value === 'all' ? 'All results' : readableComponentName(value))}</option>`).join('');
  const opponentOptions = [['all','All opponents'],['opponent','Opponent'],['ai_only','AI-only'],['unmatched','Pending']].map(([value,label])=>`<option value="${value}" ${filters.opponent===value?'selected':''}>${esc(label)}</option>`).join('');
  const dateOptions = [['all','Any date'],['7d','Last 7 days'],['30d','Last 30 days'],['year','Last year']].map(([value,label])=>`<option value="${value}" ${filters.date===value?'selected':''}>${esc(label)}</option>`).join('');
  const rows = filterBattleHistoryResults();
  const body = rows.length ? rows.map(result => {
    const id = historyResultId(result);
    const progression = historyProgression(result);
    const delta = progression.ratingDelta >= 0 ? `+${progression.ratingDelta}` : `${progression.ratingDelta}`;
    const rank = progression.rankBefore && progression.rankAfter ? `#${progression.rankBefore} -> #${progression.rankAfter}` : 'Pending';
    const belt = `${progression.beltBefore} -> ${progression.beltAfter}`;
    const visibility = result.visibility === 'public' ? 'Public verified' : 'Private';
    const share = result.visibility === 'public' && result.verifiedResultId ? verifiedResultUrl(result.verifiedResultId) : null;
    const bitcoin = bitcoinHistoryText(result);
    const country = result.country || result.profile && result.profile.country || result.opponent && result.opponent.country || 'Country unavailable';
    const prep = battlePrepSummaryForHistory(result.battlePrep || result.details && result.details.battlePrep, 'private');
    return `<article class="battle-history-row" data-history-row="${esc(id)}">
      <div class="battle-history-main">
        <div class="battle-history-title"><strong>${esc(historyTitle(result))}</strong><span class="history-visibility">${esc(visibility)}</span>${historySourceLabels(result).map(label=>`<span class="history-source-tag">${esc(label)}</span>`).join('')}</div>
        <div class="battle-history-meta">
          ${historyChip('Date', historyDateText(result))}
          ${historyChip('Mode', historyType(result))}
          ${historyChip('Genre', historyGenre(result))}
          ${historyChip('Opponent', historyOpponent(result))}
          ${historyChip('Outcome', readableComponentName(result.outcome || 'recorded'))}
          ${historyChip('Score', `${result.score == null ? 'N/A' : result.score}/100`)}
          ${historyChip('XP', `+${progression.xp}`)}
          ${historyChip('Rating', delta)}
          ${historyChip('Rank', rank)}
          ${historyChip('Belt', belt)}
          ${historyChip('Country', country)}
          ${historyChip('Bitcoin', bitcoin)}
          ${historyChip('Battle Prep', prep ? `${prep.trackCount} frozen / ${prep.purpose}` : 'None')}
        </div>
        ${share ? `<div class="battle-history-share"><span>Verified URL</span><code>${esc(share)}</code></div>` : ''}
      </div>
      <div class="battle-history-actions">
        <button class="ghost" type="button" data-open-battle-result="${esc(id)}">Inspect</button>
        ${historyRematchProfileId(result) ? `<button class="primary" type="button" data-history-rematch="${esc(id)}">Rematch</button>` : ''}
        <button class="ghost" type="button" data-history-ranking-impact="${esc(id)}">View Ranking Impact</button>
        <button class="ghost" type="button" data-toggle-battle-result="${esc(id)}">${result.visibility === 'public' ? 'Make Private' : 'Make Public'}</button>
      </div>
    </article>`;
  }).join('') : '<div class="battle-history-row"><div class="battle-history-main"><strong>No completed battle results yet.</strong><p style="color:var(--muted);margin:0">Completed judging results will appear here with privacy and verified sharing controls.</p></div></div>';
  target.innerHTML = `<div class="battle-history-filters">
    <label>Mode<select data-history-filter="mode">${modeOptions}</select></label>
    <label>Genre<select data-history-filter="genre">${genreOptions}</select></label>
    <label>Result<select data-history-filter="result">${resultOptions}</select></label>
    <label>Opponent<select data-history-filter="opponent">${opponentOptions}</select></label>
    <label>Date<select data-history-filter="date">${dateOptions}</select></label>
  </div><div class="battle-history-list">${body}</div>`;
  target.querySelectorAll('[data-history-filter]').forEach(select => {
    select.onchange = event => {
      state.battleHistoryFilters[event.currentTarget.dataset.historyFilter] = event.currentTarget.value;
      renderBattleHistory();
    };
  });
  target.querySelectorAll('[data-open-battle-result]').forEach(button => {
    button.onclick = event => openBattleHistoryResult(event.currentTarget.dataset.openBattleResult);
  });
  target.querySelectorAll('[data-toggle-battle-result]').forEach(button => {
    button.onclick = event => toggleBattleResultVisibility(event.currentTarget.dataset.toggleBattleResult);
  });
  target.querySelectorAll('[data-history-ranking-impact]').forEach(button => {
    button.onclick = event => openPrivateRankingImpactFromResult(event.currentTarget.dataset.historyRankingImpact);
  });
  target.querySelectorAll('[data-history-rematch]').forEach(button => {
    button.onclick = event => openRematchSetupFromHistory(event.currentTarget.dataset.historyRematch);
  });
  document.querySelectorAll('[data-profile-tab]').forEach(button=>button.classList.toggle('active',button.dataset.profileTab===activeProfileTab));
}

function evidenceRowsFromObject(object){
  const entries = Object.entries(object || {}).slice(0,12);
  return entries.length
    ? entries.map(([key,value])=>`<div class="battle-result-row"><b>${esc(readableComponentName(key))}</b><em>${esc(componentDisplayValue(value))}</em></div>`).join('')
    : '<div class="battle-result-row"><b>Evidence</b><em>Unavailable</em></div>';
}

function openBattleHistoryResult(identifier){
  const result = findBattleHistoryResult(identifier);
  if(!result) return false;
  const details = historyDetails(result);
  const measurable = details.measurableAnalysis || {};
  const timingScore = scoreFromBreakdown({ breakdown:details.breakdown }, ['timing','beatmatching']);
  const timingRows = [
    ['Timing accuracy', timingScore == null ? 'Not targeted' : `${timingScore}/100`],
    ['Transition evidence', `${Number(measurable.transitionCount || details.timing.length || 0)} transition(s)`],
    ['Key analysis', formatKeyAnalysis(measurable.key)],
    ['BPM', measurable.bpm == null ? 'Not detected' : measurable.bpm],
    ['Duration', measurable.durationSec == null ? 'Not reported' : `${Math.round(Number(measurable.durationSec))}s`],
    ['Confidence', confidenceText(details.confidence)]
  ].map(([label,value])=>`<div class="battle-result-row"><b>${esc(label)}</b><em>${esc(value)}</em></div>`).join('');
  const recommendations = Array.isArray(details.recommendations) && details.recommendations.length ? details.recommendations : ['No judge recommendation was stored for this result.'];
  const progression = historyProgression(result);
  const share = result.visibility === 'public' && result.verifiedResultId ? verifiedResultUrl(result.verifiedResultId) : null;
  const rematch = historyRematchProfileId(result);
  const playback = result.securePlaybackUrl || result.playbackUrl
    ? `<audio controls src="${esc(result.securePlaybackUrl || result.playbackUrl)}" style="width:100%"></audio>`
    : '<p style="color:var(--muted);margin:0">Secure playback stays on-site when permitted by the server. Public download links are not created.</p>';
  const prep = battlePrepSummaryForHistory(details.battlePrep || result.battlePrep, 'private');
  openModal(`<span class="eyebrow accent">VERIFIED RESULT</span><h3>${esc(historyTitle(result))}</h3>
    <div class="battle-result-surface">
      <div class="battle-result-top">
        <div class="battle-score-lcd"><span>Overall score</span><strong>${esc(result.score == null ? 'N/A' : result.score)}</strong><small>/100</small></div>
        <div class="battle-result-module"><span>Outcome</span><strong>${esc(readableComponentName(result.outcome || 'recorded'))}</strong><p>${esc(historyOpponent(result))}</p></div>
        <div class="battle-result-module"><span>Source</span><strong>${esc(historySourceLabels(result).join(' + '))}</strong><p>Measured analysis, rule scoring, AI feedback and human voting are separated by source.</p></div>
      </div>
      <div class="battle-evidence-grid">
        <div class="battle-result-module"><span>Timing, key and transition evidence</span><div class="battle-result-table" style="margin-top:10px">${timingRows}</div></div>
        <div class="battle-result-module"><span>Original category breakdown</span><div class="battle-result-table" style="margin-top:10px">${evidenceRowsFromObject(details.breakdown)}</div></div>
        <div class="battle-result-module"><span>Judge recommendations</span><ul class="battle-recommendations">${recommendations.slice(0,6).map(item=>`<li>${esc(item)}</li>`).join('')}</ul></div>
      </div>
      <div class="battle-progression-grid">
        <div class="battle-result-module"><span>XP earned</span><strong>+${esc(progression.xp)}</strong></div>
        <div class="battle-result-module"><span>Rating move</span><strong>${progression.ratingDelta >= 0 ? '+' : ''}${esc(progression.ratingDelta)}</strong></div>
        <div class="battle-result-module"><span>Ranking move</span><strong>${progression.rankBefore && progression.rankAfter ? `#${progression.rankBefore} -> #${progression.rankAfter}` : 'Pending'}</strong></div>
        <div class="battle-result-module"><span>Belt progress</span><strong>${esc(progression.beltBefore)} -> ${esc(progression.beltAfter)}</strong></div>
      </div>
      <div class="battle-reward-note">${esc(bitcoinHistoryText(result))}${share ? ` Verified profile: ${esc(share)}` : ' Result is private until you make it public.'}</div>
      ${prep ? `<div class="battle-result-module"><span>Battle Prep snapshot</span><strong>${esc(prep.crateName)}</strong><p>${esc(prep.trackCount)} frozen ${esc(prep.purpose)} track(s). Active battle results use this snapshot, not later crate edits.</p></div>` : ''}
      <div class="battle-result-module"><span>Submission playback</span>${playback}</div>
    </div>
    <div class="modal-actions"><button class="primary" type="button" data-history-ranking-impact="${esc(historyResultId(result))}">View Ranking Impact</button>${rematch ? `<button class="primary" type="button" data-history-rematch="${esc(historyResultId(result))}">Request Rematch</button>` : ''}<button class="ghost" value="cancel">Close</button></div>`);
  setTimeout(() => {
    const button = document.querySelector('[data-history-ranking-impact]');
    if(button) button.onclick = event => openPrivateRankingImpactFromResult(event.currentTarget.dataset.historyRankingImpact);
    const rematchButton = document.querySelector('[data-history-rematch]');
    if(rematchButton) rematchButton.onclick = event => openRematchSetupFromHistory(event.currentTarget.dataset.historyRematch);
  },0);
  return true;
}

async function toggleBattleResultVisibility(identifier){
  const result = findBattleHistoryResult(identifier);
  if(!result) return { error:'not_found' };
  if(result.userId && String(result.userId) !== currentProfileUserId()) return { error:'unauthorized' };
  const nextVisibility = result.visibility === 'public' ? 'private' : 'public';
  if(window.DJBattleApi && typeof window.DJBattleApi.apiRequest === 'function' && result.submissionId){
    const response = await window.DJBattleApi.apiRequest(`/api/battleResults/${encodeURIComponent(result.submissionId)}/visibility`, {
      method:'PATCH',
      body:{ visibility: nextVisibility }
    });
    if(response && response.data && response.data.result){
      applyServerBattleResultProfile(response.data.result);
      renderBattleHistory();
      return response.data.result;
    }
    if(response && response.error) return response;
  }
  result.visibility = nextVisibility;
  result.verifiedResultId = result.verifiedResultId || localVerifiedResultId(historyResultId(result));
  result.verifiedResultUrl = nextVisibility === 'public' ? verifiedResultUrl(result.verifiedResultId) : null;
  persistBattleProgress();
  renderBattleHistory();
  return result;
}

function renderPublicVerifiedResultProfile(result, status){
  if(!result){
    const message = status === 403 ? 'This result is private.' : status === 404 ? 'This verified result is unavailable.' : 'Verified result could not be loaded.';
    openModal(`<span class="eyebrow accent">RESULT UNAVAILABLE</span><h3>Battle result unavailable</h3><p style="color:var(--muted)">${esc(message)}</p><div class="modal-actions"><button class="ghost" value="cancel">Close</button></div>`);
    return null;
  }
  const safe = {
    ...result,
    title: result.battle && result.battle.title || result.title,
    type: result.battle && result.battle.type || result.type,
    genre: result.battle && result.battle.genre || result.genre,
    details: result.evidence || {},
    sourceLabels: result.scoringSource,
    opponent: result.opponent || {},
    visibility: 'public'
  };
  const profile = result.profile || {};
  const country = profile.country || result.country || safe.opponent.country || 'Country unavailable';
  const prep = battlePrepSummaryForHistory(result.battlePrep || safe.battlePrep, 'public');
  const rankingImpact = profile.publicProfileId && result.verifiedResultId
    ? `<button class="primary" type="button" data-public-result-ranking-impact="${esc(result.verifiedResultId)}">View Ranking Impact</button>`
    : '';
  openModal(`<span class="eyebrow accent">PUBLIC VERIFIED RESULT</span><h3>${esc(historyTitle(safe))}</h3>
    <div class="battle-result-surface">
      <div class="battle-result-top">
        <div class="battle-score-lcd"><span>Score</span><strong>${esc(result.score == null ? 'N/A' : result.score)}</strong><small>/100</small></div>
        <div class="battle-result-module"><span>DJ</span><strong>${esc(profile.displayName || 'DJ')}</strong><p>${esc(country)}</p></div>
        <div class="battle-result-module"><span>Outcome</span><strong>${esc(readableComponentName(result.outcome || 'recorded'))}</strong><p>${esc(historyOpponent(safe))}</p></div>
      </div>
      <div class="battle-status-strip">${historySourceLabels(safe).map(label=>`<div class="battle-result-module"><span>Scoring source</span><strong>${esc(label)}</strong></div>`).join('')}</div>
      <div class="battle-evidence-grid">
        <div class="battle-result-module"><span>Approved evidence</span><div class="battle-result-table" style="margin-top:10px">${evidenceRowsFromObject(result.evidence && result.evidence.breakdown)}</div></div>
        <div class="battle-result-module"><span>Recommendations</span><ul class="battle-recommendations">${((result.evidence && result.evidence.recommendations) || []).slice(0,5).map(item=>`<li>${esc(item)}</li>`).join('') || '<li>No public recommendations stored.</li>'}</ul></div>
      </div>
      <div class="battle-reward-note">${esc(bitcoinHistoryText(safe))}</div>
      ${prep ? `<div class="battle-result-module"><span>Battle Prep</span><strong>${esc(prep.trackCount)} frozen track(s)</strong><p>${esc(prep.purpose)} prep snapshot. Private crate IDs, storage paths and track library identifiers are not public.</p></div>` : ''}
      <p style="color:var(--muted);margin:0">Private storage paths, internal processing data and service credentials are not included. Public downloads are not created.</p>
    </div><div class="modal-actions">${rankingImpact}<button class="ghost" value="cancel">Close</button></div>`);
  setTimeout(() => {
    const button = document.querySelector('[data-public-result-ranking-impact]');
    if(button) button.onclick = () => openPublicProfileRankingImpactFromResult(result, { returnTo:'verified-result' });
  },0);
  return safe;
}

async function trackVerifiedResultView(verifiedResultId){
  if(!verifiedResultId || !window.DJBattleApi || typeof window.DJBattleApi.apiRequest !== 'function') return null;
  return window.DJBattleApi.apiRequest(`/api/publicBattleResults/${encodeURIComponent(verifiedResultId)}/views`, {
    method:'POST',
    public:true,
    body:{ visitorId:publicVisitorId() }
  });
}

async function loadPublicVerifiedResult(verifiedResultId){
  if(!verifiedResultId || !/^vr_[a-z0-9]+$/i.test(String(verifiedResultId))){
    return renderPublicVerifiedResultProfile(null, 404);
  }
  if(!window.DJBattleApi || typeof window.DJBattleApi.apiRequest !== 'function'){
    return renderPublicVerifiedResultProfile(null, 503);
  }
  const response = await window.DJBattleApi.apiRequest(`/api/publicBattleResults/${encodeURIComponent(verifiedResultId)}`, { public:true });
  if(response && response.data && response.data.result){
    const rendered = renderPublicVerifiedResultProfile(response.data.result);
    trackVerifiedResultView(verifiedResultId).then(viewResponse => {
      if(viewResponse && viewResponse.data && viewResponse.data.views){
        const row = state.verifiedResultsDiscovery.results.find(item => item.verifiedResultId === verifiedResultId);
        if(row) row.viewCount = viewResponse.data.views.total;
      }
    });
    return rendered;
  }
  return renderPublicVerifiedResultProfile(null, response && response.status);
}

const VERIFIED_RANKING_CATEGORIES = {
  competitive_battles:'Competitive Battles',
  country_rankings:'Country Rankings',
  ai_only_high_scores:'AI-Only High Scores',
  transition_battles:'Transition Battles',
  scratching_battles:'Scratching Battles',
  mix_battles:'Mix Battles',
  producer_beat_battles:'Producer Beat Battles',
  bitcoin_battles:'Bitcoin Battles',
  belt_rankings:'Belt-Level Rankings'
};

const PUBLIC_RANKING_CATEGORY_ORDER = [
  'competitive_battles',
  'country_rankings',
  'transition_battles',
  'scratching_battles',
  'mix_battles',
  'producer_beat_battles',
  'bitcoin_battles',
  'belt_rankings',
  'ai_only_high_scores'
];

function countryCode(value){
  const text = String(value || '').trim();
  if(!text) return 'NA';
  const upper = text.toUpperCase();
  const aliases = {
    'UNITED STATES':'US',
    'USA':'US',
    'UNITED KINGDOM':'GB',
    'UK':'GB',
    'CANADA':'CA',
    'GERMANY':'DE',
    'FRANCE':'FR',
    'SPAIN':'ES',
    'JAPAN':'JP',
    'AUSTRALIA':'AU'
  };
  return (aliases[upper] || upper).replace(/[^A-Z]/g,'').slice(0,2) || 'NA';
}

function publicResultId(result){
  return result && (result.verifiedResultId || result.id);
}

function publicProfileId(result){
  const profile = result && result.profile || {};
  return profile.publicProfileId || profile.userId || String(profile.displayName || 'dj').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'dj';
}

function publicProfileUrl(result){
  return `#dj=${encodeURIComponent(publicProfileId(result))}`;
}

function safePublicMediaItems(media){
  return (Array.isArray(media) ? media : []).filter(item => {
    const url = String(item.publicUrl || '');
    return (item.public === true || item.visibility === 'public' || item.securePlaybackPermitted === true)
      && !/private\/battle-entries|storage_object_path|service_key|secret/i.test(url);
  }).slice(0,8);
}

function localPublicProfileFromResult(row){
  const profileId = publicProfileId(row);
  const rows = state.verifiedResultsDiscovery.results.filter(item => publicProfileId(item) === profileId);
  const rankings = buildVerifiedPublicRankings(rows);
  const statsRows = rows.filter(Boolean);
  const competitiveHistory = statsRows.filter(item => verifiedOpponentCategory(item) !== 'ai_only');
  const aiOnlyHighScores = statsRows.filter(item => verifiedOpponentCategory(item) === 'ai_only');
  const bestScore = statsRows.reduce((best,item)=>Math.max(best, Number(item.score || 0)), 0);
  const averageScore = statsRows.length ? Math.round(statsRows.reduce((sum,item)=>sum+Number(item.score || 0),0) / statsRows.length) : 0;
  return {
    id:profileId,
    displayName:row.profile && row.profile.displayName || 'DJ',
    country:row.profile && row.profile.country || 'Unknown',
    belt:row.belt || 'Unranked',
    rating:statsRows.reduce((sum,item)=>sum+Number(item.ratingMovement || 0),0),
    rank:null,
    bio:row.profile && row.profile.bio || null,
    specialties:Array.from(new Set(statsRows.flatMap(item => [item.battle && item.battle.modeId, item.battle && item.battle.type, ...(item.profile && item.profile.specialties || [])]).filter(Boolean))).slice(0,10),
    stats:{
      totalResults:statsRows.length,
      competitiveBattles:competitiveHistory.length,
      aiOnlyHighScores:aiOnlyHighScores.length,
      wins:statsRows.filter(item => item.outcome === 'win').length,
      losses:statsRows.filter(item => item.outcome === 'loss').length,
      ties:statsRows.filter(item => item.outcome === 'tie').length,
      bestScore,
      averageScore,
      totalViews:statsRows.reduce((sum,item)=>sum+Number(item.viewCount || 0),0)
    },
    media:safePublicMediaItems(row.profile && row.profile.media),
    rankings,
    competitiveHistory,
    aiOnlyHighScores,
    verifiedResults:statsRows,
    views:{ total:0, uniqueEstimate:0 }
  };
}

function normalizeVerifiedDiscoveryResult(result){
  if(!result) return null;
  const battle = result.battle || {};
  const details = historyDetails(result);
  const profile = result.profile || {};
  const progression = historyProgression(result);
  const id = publicResultId(result);
  const visibility = result.visibility || 'private';
  if(visibility !== 'public' || !id || result.deleted === true || result.unavailable === true || result.status === 'deleted') return null;
  return {
    id,
    verifiedResultId:id,
    verifiedResultUrl:verifiedResultUrl(id),
    visibility:'public',
    title:result.title || battle.title || historyTitle(result),
    battle:{
      modeId:result.modeId || battle.modeId || historyMode(result),
      type:result.type || battle.type || historyType(result),
      genre:result.genre || battle.genre || historyGenre(result)
    },
    profile:{
      displayName:profile.displayName || 'DJ',
      country:profile.country || result.country || null,
      publicProfileId:profile.publicProfileId || publicProfileId(result),
      bio:profile.bio || profile.publicBio || null,
      specialties:Array.isArray(profile.specialties) ? profile.specialties : [],
      media:Array.isArray(profile.media) ? profile.media : []
    },
    opponent:result.opponent || {},
    score:Number(result.score || 0),
    outcome:result.outcome || 'recorded',
    scoringSource:historySourceLabels(result),
    sourceLabels:historySourceLabels(result),
    reward:result.reward || details.reward || null,
    battlePrep:battlePrepSummaryForHistory(result.battlePrep || details.battlePrep, 'public'),
    progression:{
      ...progression,
      xp:Number(progression.xp || 0),
      ratingDelta:Number(result.ratingMovement ?? progression.ratingDelta ?? 0)
    },
    belt:result.belt || progression.beltAfter || 'Unranked',
    ratingMovement:Number(result.ratingMovement ?? progression.ratingDelta ?? 0),
    completedAt:historyCompletedAt(result) || result.completedAt || null,
    viewCount:Number(result.viewCount || 0),
    uniqueViewEstimate:Number(result.uniqueViewEstimate || 0),
    evidence:result.evidence || details,
    securePlaybackUrl:null,
    playbackUrl:null
  };
}

function publicVerifiedResultsFromLocal(){
  const seen = new Set();
  const rows = [];
  state.battleResults.forEach(result => {
    const normalized = normalizeVerifiedDiscoveryResult(result);
    if(!normalized || seen.has(normalized.verifiedResultId)) return;
    seen.add(normalized.verifiedResultId);
    rows.push(normalized);
  });
  return rows;
}

function verifiedOpponentCategory(result){
  const opponent = result && result.opponent || {};
  if(opponent.status === 'ai_only' || result && result.outcome === 'practice') return 'ai_only';
  if(opponent.status === 'opponent' || opponent.name) return 'opponent';
  return opponent.status || 'unmatched';
}

function verifiedResultIsProducer(result){
  const battle = result && result.battle || {};
  const mode = String(result && (result.modeId || result.type) || battle.modeId || battle.type || '').toLowerCase();
  const modeConfig = BattleModes.getBattleMode(battle.modeId || result && result.modeId || battle.type || result && result.type);
  return String(battle.discipline || result && result.battleDiscipline || '').toLowerCase() === 'producer'
    || (modeConfig && modeConfig.discipline === 'producer')
    || mode.includes('beat_battle')
    || mode.includes('sample_flip')
    || mode.includes('drum_challenge')
    || mode.includes('remix_challenge');
}

function verifiedResultCategories(result){
  const categories = new Set();
  if(!result || result.visibility !== 'public' || !result.verifiedResultId) return [];
  const mode = String(result.battle && result.battle.modeId || result.battle && result.battle.type || '').toLowerCase();
  const type = String(result.battle && result.battle.type || '').toLowerCase();
  const producer = verifiedResultIsProducer(result);
  if(verifiedOpponentCategory(result) === 'ai_only') categories.add('ai_only_high_scores');
  else categories.add('competitive_battles');
  if(producer) categories.add('producer_beat_battles');
  else {
    if(mode.includes('transition') || type.includes('transition')) categories.add('transition_battles');
    if(mode.includes('scratch') || type.includes('scratch')) categories.add('scratching_battles');
    if(mode.includes('mix') || type.includes('mix') || type.includes('song')) categories.add('mix_battles');
  }
  if(mode.includes('bitcoin') || result.reward && result.reward.type === 'bitcoin') categories.add('bitcoin_battles');
  return Array.from(categories);
}

function verifiedDateMatches(result, bucket){
  return dateBucketMatches({ completedAt:result.completedAt }, bucket);
}

function filterVerifiedResultsDiscovery(results, filters = state.verifiedResultsDiscovery.filters){
  const current = filters || {};
  return results.filter(result => {
    if(!result || result.visibility !== 'public' || !result.verifiedResultId) return false;
    if(current.country && current.country !== 'all' && countryCode(result.profile && result.profile.country) !== countryCode(current.country)) return false;
    if(current.mode && current.mode !== 'all' && String(result.battle && result.battle.modeId || '').toLowerCase() !== current.mode.toLowerCase()) return false;
    if(current.genre && current.genre !== 'all' && String(result.battle && result.battle.genre || '').toLowerCase() !== current.genre.toLowerCase()) return false;
    if(current.source && current.source !== 'all' && !(result.scoringSource || []).some(source => String(source).toLowerCase() === current.source.toLowerCase())) return false;
    if(current.belt && current.belt !== 'all' && String(result.belt || '').toLowerCase() !== current.belt.toLowerCase()) return false;
    if(current.opponent && current.opponent !== 'all' && verifiedOpponentCategory(result) !== current.opponent) return false;
    if(current.date && !verifiedDateMatches(result, current.date)) return false;
    return true;
  });
}

function sortVerifiedResultsDiscovery(results, sort = state.verifiedResultsDiscovery.sort){
  const rows = [...results];
  if(sort === 'highest_score') rows.sort((a,b)=>Number(b.score || 0) - Number(a.score || 0) || String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
  else if(sort === 'rating_movement') rows.sort((a,b)=>Math.abs(Number(b.ratingMovement || 0)) - Math.abs(Number(a.ratingMovement || 0)) || Number(b.score || 0) - Number(a.score || 0));
  else if(sort === 'most_viewed') rows.sort((a,b)=>Number(b.viewCount || 0) - Number(a.viewCount || 0) || String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
  else rows.sort((a,b)=>String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
  return rows;
}

function buildVerifiedPublicRankings(results, options = {}){
  const deduped = [];
  const seen = new Set();
  results.forEach(result => {
    const normalized = normalizeVerifiedDiscoveryResult(result);
    if(!normalized || seen.has(normalized.verifiedResultId)) return;
    seen.add(normalized.verifiedResultId);
    deduped.push(normalized);
  });
  const maps = Object.fromEntries(Object.keys(VERIFIED_RANKING_CATEGORIES).map(category => [category, new Map()]));
  deduped.forEach(result => {
    const country = result.profile.country || 'Unknown';
    if(options.country && options.country !== 'all' && countryCode(options.country) !== countryCode(country)) return;
    verifiedResultCategories(result).forEach(category => {
      if(options.category && options.category !== 'all' && options.category !== category) return;
      const key = `${category}:${countryCode(country)}:${publicProfileId(result)}`;
      const row = maps[category].get(key) || {
        category,
        categoryLabel:VERIFIED_RANKING_CATEGORIES[category],
        djName:result.profile.displayName || 'DJ',
        publicProfileId:publicProfileId(result),
        country,
        belt:result.belt || 'Unranked',
        resultCount:0,
        wins:0,
        losses:0,
        ties:0,
        scoreTotal:0,
        bestScore:0,
        ratingMovement:0,
        latestCompletedAt:null
      };
      row.resultCount += 1;
      row.scoreTotal += Number(result.score || 0);
      row.bestScore = Math.max(row.bestScore, Number(result.score || 0));
      row.ratingMovement += Number(result.ratingMovement || 0);
      row.latestCompletedAt = !row.latestCompletedAt || String(result.completedAt || '').localeCompare(String(row.latestCompletedAt)) > 0 ? result.completedAt : row.latestCompletedAt;
      if(result.outcome === 'win') row.wins += 1;
      else if(result.outcome === 'loss') row.losses += 1;
      else if(result.outcome === 'tie') row.ties += 1;
      row.belt = result.belt || row.belt;
      maps[category].set(key, row);
    });
  });
  const categories = {};
  Object.entries(maps).forEach(([category, map]) => {
    const rows = Array.from(map.values()).map(row => ({
      ...row,
      averageScore: row.resultCount ? Number((row.scoreTotal / row.resultCount).toFixed(1)) : 0
    })).sort((a,b)=>b.ratingMovement-a.ratingMovement || b.averageScore-a.averageScore || b.bestScore-a.bestScore).map((row,index)=>({ ...row, rank:index+1 }));
    categories[category] = {
      label:VERIFIED_RANKING_CATEGORIES[category],
      rows,
      countries: rows.reduce((acc,row)=>{ acc[row.country]=acc[row.country]||[]; acc[row.country].push(row); return acc; }, {})
    };
  });
  return { categories };
}

function normalizeServerLeaderboardRankings(payload){
  const source = payload && (payload.leaderboard || payload.rankings || payload);
  if(!source || !source.categories) return null;
  const categories = {};
  Object.entries(source.categories).forEach(([key, category]) => {
    const rows = (Array.isArray(category.rows) ? category.rows : []).map(row => {
      const qualifyingBattles = Number(row.qualifyingBattles ?? row.resultCount ?? 0);
      const movement = Number(row.movement ?? row.ratingMovement ?? 0);
      return {
        category:key,
        categoryLabel:category.label || VERIFIED_RANKING_CATEGORIES[key] || readableComponentName(key),
        rank:Number(row.rank || 0) || 0,
        previousRank:Number(row.previousRank || row.rank || 0) || 0,
        movement,
        djName:row.djName || row.displayName || 'Ranked DJ',
        publicProfileId:row.publicProfileId || row.public_profile_id || '',
        profileVisibility:row.profileVisibility || 'public',
        country:row.country || 'Unknown',
        belt:row.belt || 'Unranked',
        rating:Number(row.rating || 0),
        resultCount:qualifyingBattles,
        qualifyingBattles,
        wins:Number(row.eligibleWins ?? row.wins ?? 0),
        losses:Number(row.eligibleLosses ?? row.losses ?? 0),
        ties:Number(row.eligibleTies ?? row.ties ?? 0),
        winRate:row.winRate == null ? null : Number(row.winRate),
        averageScore:Number(row.averageScore || 0),
        bestScore:Number(row.bestScore || 0),
        ratingMovement:movement,
        minimumEligibility:row.minimumEligibility || { requiredBattles:1, met:qualifyingBattles > 0 },
        lastQualifyingActivity:row.lastQualifyingActivity || row.latestCompletedAt || null,
        followerCount:Number.isFinite(Number(row.followerCount ?? row.followers ?? row.relationshipCounts?.followers)) ? Number(row.followerCount ?? row.followers ?? row.relationshipCounts?.followers) : null,
        followingCount:Number.isFinite(Number(row.followingCount ?? row.relationshipCounts?.following)) ? Number(row.followingCount ?? row.relationshipCounts?.following) : null,
        relationshipSource:row.relationshipSource || row.relationshipCounts?.source || ''
      };
    });
    categories[key] = {
      label:category.label || VERIFIED_RANKING_CATEGORIES[key] || readableComponentName(key),
      rows,
      countries: rows.reduce((acc,row)=>{ const country = row.country || 'Unknown'; acc[country]=acc[country]||[]; acc[country].push(row); return acc; }, {})
    };
  });
  return {
    categories,
    source:source.source || 'award_ledger',
    calculationVersion:source.calculationVersion || null
  };
}

function validPublicRankingCategory(category){
  return PUBLIC_RANKING_CATEGORY_ORDER.includes(String(category || '')) ? String(category) : 'competitive_battles';
}

function publicRankingCategoryLabel(category){
  if(category === 'competitive_battles') return 'Global Competitive';
  if(category === 'ai_only_high_scores') return 'AI High Scores';
  return VERIFIED_RANKING_CATEGORIES[category] || readableComponentName(category);
}

function publicRankingRowKey(row){
  return [
    row && row.publicProfileId || row && row.djName || 'private',
    row && row.country || '',
    row && row.belt || '',
    row && row.rank || ''
  ].join(':');
}

function normalizePublicRankingRow(row = {}){
  const qualifyingBattles = Number(row.qualifyingBattles ?? row.resultCount ?? 0);
  const movement = Number(row.movement ?? row.ratingMovement ?? 0);
  return {
    rank:Number(row.rank || 0) || 0,
    previousRank:Number(row.previousRank || row.rank || 0) || 0,
    movement,
    publicProfileId:row.profileVisibility === 'private' ? '' : row.publicProfileId || row.public_profile_id || '',
    djName:row.profileVisibility === 'private' ? 'Private DJ' : row.djName || row.displayName || 'Ranked DJ',
    profileVisibility:row.profileVisibility || (row.publicProfileId ? 'public' : 'private'),
    country:row.country || 'Unknown',
    countryCode:row.countryCode || countryCode(row.country),
    belt:row.belt || 'Unranked',
    rating:Number(row.rating || 0),
    eligibleWins:Number(row.eligibleWins ?? row.wins ?? 0),
    eligibleLosses:Number(row.eligibleLosses ?? row.losses ?? 0),
    eligibleTies:Number(row.eligibleTies ?? row.ties ?? 0),
    winRate:row.winRate == null ? null : Number(row.winRate),
    qualifyingBattles,
    averageScore:Number(row.averageScore || 0),
    bestScore:Number(row.bestScore || 0),
    lastQualifyingActivity:row.lastQualifyingActivity || row.latestCompletedAt || null,
    minimumEligibility:row.minimumEligibility || { requiredBattles:1, met:qualifyingBattles > 0 },
    followerCount:Number.isFinite(Number(row.followerCount ?? row.followers ?? row.relationshipCounts?.followers)) ? Number(row.followerCount ?? row.followers ?? row.relationshipCounts?.followers) : null,
    followingCount:Number.isFinite(Number(row.followingCount ?? row.relationshipCounts?.following)) ? Number(row.followingCount ?? row.relationshipCounts?.following) : null,
    relationshipSource:row.relationshipSource || row.relationshipCounts?.source || '',
    status:row.status || (qualifyingBattles > 0 ? 'eligible' : 'unranked')
  };
}

function mergePublicRankingRows(existing, incoming){
  const map = new Map();
  [...(existing || []), ...(incoming || [])].forEach(row => {
    const normalized = normalizePublicRankingRow(row);
    const key = publicRankingRowKey(normalized);
    const previous = map.get(key);
    map.set(key, previous && previous.rank <= normalized.rank ? previous : normalized);
  });
  return Array.from(map.values()).sort((a,b)=>Number(a.rank || 0) - Number(b.rank || 0));
}

function publicRankingQuery(page){
  const params = new URLSearchParams();
  const ranking = state.publicRankings;
  params.set('category', ranking.category);
  if(ranking.filters.country && ranking.filters.country !== 'all') params.set('country', ranking.filters.country);
  if(ranking.filters.belt && ranking.filters.belt !== 'all') params.set('belt', ranking.filters.belt);
  if(ranking.filters.relationship && ranking.filters.relationship !== 'all') params.set('relationship', ranking.filters.relationship);
  params.set('page', String(page || ranking.page || 1));
  params.set('limit', String(ranking.pageSize || 20));
  return params.toString();
}

function publicRankingDeepLink(){
  const ranking = state.publicRankings;
  const params = new URLSearchParams();
  params.set('category', ranking.category);
  if(ranking.filters.country && ranking.filters.country !== 'all') params.set('country', ranking.filters.country);
  if(ranking.filters.belt && ranking.filters.belt !== 'all') params.set('belt', ranking.filters.belt);
  if(ranking.filters.relationship && ranking.filters.relationship !== 'all') params.set('relationship', ranking.filters.relationship);
  if(ranking.page && ranking.page > 1) params.set('page', String(ranking.page));
  if(ranking.selectedDj) params.set('dj', ranking.selectedDj);
  return `#rankings?${params.toString()}`;
}

function updateRankingsDeepLink(){
  if(!window.history || !window.location) return;
  const target = `${window.location.pathname}${publicRankingDeepLink()}`;
  window.history.replaceState(null, '', target);
}

function applyRankingsDeepLink(hash = window.location && window.location.hash){
  const raw = String(hash || '');
  if(!raw.startsWith('#rankings')) return false;
  const query = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '';
  const params = new URLSearchParams(query);
  const requestedCategory = params.get('category');
  const category = validPublicRankingCategory(requestedCategory);
  state.publicRankings.category = category;
  state.publicRankings.filters.country = params.get('country') || 'all';
  state.publicRankings.filters.belt = params.get('belt') || 'all';
  state.publicRankings.filters.relationship = params.get('relationship') || 'all';
  state.publicRankings.page = Math.max(1, Number(params.get('page') || 1) || 1);
  state.publicRankings.selectedDj = params.get('dj') || '';
  state.publicRankings.deepLinkMessage = requestedCategory && requestedCategory !== category
    ? 'Invalid ranking category link; showing Global Competitive.'
    : '';
  return true;
}

function categoryRowsFromAuthoritativeData(){
  const categories = state.publicRankings.categories || {};
  return Object.values(categories).flatMap(category => Array.isArray(category.rows) ? category.rows.map(normalizePublicRankingRow) : []);
}

function rankingFilterOptions(){
  const rows = categoryRowsFromAuthoritativeData().concat(state.publicRankings.rows || []);
  const countries = Array.from(new Set(rows.map(row => row.country).filter(Boolean))).sort((a,b)=>String(a).localeCompare(String(b)));
  const belts = Array.from(new Set(rows.map(row => row.belt).filter(Boolean))).sort((a,b)=>String(a).localeCompare(String(b)));
  return { countries, belts };
}

function setSelectOptions(select, labelAll, values, selected, formatter = value => value){
  if(!select) return;
  select.innerHTML = ['all', ...values].map(value => `<option value="${esc(value)}" ${selected === value ? 'selected' : ''}>${esc(value === 'all' ? labelAll : formatter(value))}</option>`).join('');
}

function renderRankingCategoryTabs(){
  const target = document.getElementById('rankings-category-tabs');
  if(!target) return;
  target.innerHTML = PUBLIC_RANKING_CATEGORY_ORDER.map(category => {
    const active = category === state.publicRankings.category;
    const ai = category === 'ai_only_high_scores';
    return `<button class="rankings-tab ${active ? 'active' : ''} ${ai ? 'ai-tab' : ''}" type="button" role="tab" aria-selected="${active ? 'true' : 'false'}" data-ranking-category="${esc(category)}">${esc(publicRankingCategoryLabel(category))}</button>`;
  }).join('');
  target.querySelectorAll('[data-ranking-category]').forEach(button => {
    button.onclick = () => {
      state.publicRankings.category = button.dataset.rankingCategory;
      state.publicRankings.page = 1;
      state.publicRankings.rows = [];
      state.publicRankings.selectedDj = '';
      updateRankingsDeepLink();
      renderRankingsPage();
      loadRankingsPage().catch(err=>console.warn('Rankings category load failed', err));
    };
  });
}

function rankingStatusLabel(){
  const ranking = state.publicRankings;
  if(ranking.status === 'loading') return ['Loading authoritative rankings', 'warn'];
  if(ranking.status === 'reconnecting') return ['Reconnecting; keeping last safe page', 'warn'];
  if(ranking.status === 'stale') return ['Stale data; refresh failed', 'warn'];
  if(ranking.status === 'configuration_required') return ['Configuration required for server rankings', 'error'];
  if(ranking.status === 'offline') return ['Offline; server rankings unavailable', 'error'];
  if(ranking.status === 'failed') return ['Leaderboard request failed', 'error'];
  if(ranking.status === 'synced') return ['Award ledger rankings', 'ok'];
  return ['Ready for authoritative rankings', 'warn'];
}

function movementText(value){
  const movement = Number(value || 0);
  if(movement > 0) return `+${movement}`;
  if(movement < 0) return String(movement);
  return '0';
}

function movementClass(value){
  const movement = Number(value || 0);
  if(movement > 0) return 'up';
  if(movement < 0) return 'down';
  return 'flat';
}

function dateText(value){
  if(!value) return 'Pending';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
}

function renderRankingsFilters(){
  const { countries, belts } = rankingFilterOptions();
  const countrySelect = document.getElementById('rankings-filter-country');
  const beltSelect = document.getElementById('rankings-filter-belt');
  const relationshipSelect = document.getElementById('rankings-filter-relationship');
  setSelectOptions(countrySelect, 'Global', countries, state.publicRankings.filters.country, value => `${countryCode(value)} - ${value}`);
  setSelectOptions(beltSelect, 'All belts', belts, state.publicRankings.filters.belt);
  if(relationshipSelect){
    relationshipSelect.innerHTML = [
      ['all','All ranked DJs'],
      ['following','Following'],
      ['prior_opponents','Prior opponents']
    ].map(([value, label]) => `<option value="${value}" ${state.publicRankings.filters.relationship === value ? 'selected' : ''}>${label}</option>`).join('');
    relationshipSelect.onchange = event => updateRankingsFilter('relationship', event.currentTarget.value);
  }
  if(countrySelect) countrySelect.onchange = event => updateRankingsFilter('country', event.currentTarget.value);
  if(beltSelect) beltSelect.onchange = event => updateRankingsFilter('belt', event.currentTarget.value);
  const reset = document.getElementById('rankings-reset');
  if(reset) reset.onclick = () => {
    state.publicRankings.filters = { country:'all', belt:'all', relationship:'all' };
    state.publicRankings.page = 1;
    state.publicRankings.rows = [];
    updateRankingsDeepLink();
    renderRankingsPage();
    loadRankingsPage().catch(err=>console.warn('Rankings reset failed', err));
  };
  const global = document.getElementById('rankings-global');
  if(global) global.onclick = () => updateRankingsFilter('country', 'all');
  const myCountry = document.getElementById('rankings-my-country');
  if(myCountry) myCountry.onclick = () => {
    const owned = firstPersonalRankedRow();
    const country = owned && owned.country;
    if(!country){
      state.publicRankings.error = 'Your approved country is not available from the server ranking contract.';
      renderRankingsPage();
      return;
    }
    updateRankingsFilter('country', country);
  };
}

function updateRankingsFilter(key, value){
  state.publicRankings.filters[key] = value || 'all';
  state.publicRankings.page = 1;
  state.publicRankings.rows = [];
  state.publicRankings.selectedDj = '';
  updateRankingsDeepLink();
  renderRankingsPage();
  loadRankingsPage().catch(err=>console.warn('Rankings filter load failed', err));
}

function firstPersonalRankedRow(){
  const rankings = state.publicRankings.personal && state.publicRankings.personal.rankings || {};
  return Object.values(rankings).find(row => row && row.status !== 'not_yet_ranked' && row.country);
}

function renderRankingsStatus(){
  const target = document.getElementById('rankings-status');
  if(!target) return;
  const [label, tone] = rankingStatusLabel();
  const ranking = state.publicRankings;
  const p = ranking.pagination || {};
  const category = publicRankingCategoryLabel(ranking.category);
  const source = ranking.status === 'synced' || ranking.stale ? 'Server award ledger' : 'No browser ranking formula';
  const error = ranking.error ? `<span class="ranking-status-pill ${ranking.stale ? 'warn' : 'error'}"><i></i>${esc(ranking.error)}</span>` : '';
  const deeplink = ranking.deepLinkMessage ? `<span class="ranking-status-pill warn"><i></i>${esc(ranking.deepLinkMessage)}</span>` : '';
  const selected = ranking.selectedDj ? `<span class="ranking-status-pill warn"><i></i>${esc(`Selected DJ ${ranking.selectedDj}`)}</span>` : '';
  target.innerHTML = `<span class="ranking-status-pill ${tone === 'ok' ? '' : tone}"><i></i>${esc(label)}</span><span class="ranking-status-pill"><i></i>${esc(category)}</span><span class="ranking-status-pill"><i></i>${esc(source)}</span><span class="ranking-status-pill"><i></i>${esc(`${p.total || ranking.rows.length} ranked DJ(s)`)}</span>${selected}${deeplink}${error}`;
}

function renderActiveRankingFilters(){
  const target = document.getElementById('rankings-active-filters');
  if(!target) return;
  const chips = [];
  chips.push(['Category', publicRankingCategoryLabel(state.publicRankings.category)]);
  if(state.publicRankings.filters.country && state.publicRankings.filters.country !== 'all') chips.push(['Country', state.publicRankings.filters.country]);
  if(state.publicRankings.filters.belt && state.publicRankings.filters.belt !== 'all') chips.push(['Belt', state.publicRankings.filters.belt]);
  if(state.publicRankings.filters.relationship && state.publicRankings.filters.relationship !== 'all') chips.push(['Discovery', readableComponentName(state.publicRankings.filters.relationship)]);
  target.innerHTML = chips.map(([label,value]) => `<span class="ranking-filter-chip">${esc(label)}: <strong>${esc(value)}</strong></span>`).join('');
}

function rankingEligibilityText(row){
  if(!row) return 'Unranked';
  if(row.minimumEligibility && row.minimumEligibility.met === false) return `Provisional: ${row.qualifyingBattles || 0}/${row.minimumEligibility.requiredBattles || 1}`;
  if(row.status === 'not_yet_ranked' || row.status === 'unranked') return 'Unranked';
  return 'Fully eligible';
}

function renderRankingRows(){
  const target = document.getElementById('rankings-list');
  const empty = document.getElementById('rankings-empty');
  if(!target || !empty) return;
  const rows = state.publicRankings.rows || [];
  if(!rows.length){
    target.innerHTML = '';
    empty.classList.remove('hidden');
    empty.innerHTML = state.publicRankings.status === 'loading'
      ? '<strong>Loading authoritative leaderboard...</strong><p>Waiting for the server award-ledger contract.</p>'
      : `<strong>No authoritative rows for ${esc(publicRankingCategoryLabel(state.publicRankings.category))}.</strong><p>Only eligible server-confirmed rankings appear here.</p>`;
    return;
  }
  empty.classList.add('hidden');
  target.innerHTML = rows.map(row => {
    const isPrivate = row.profileVisibility === 'private' || !row.publicProfileId;
    const selected = state.publicRankings.selectedDj && row.publicProfileId === state.publicRankings.selectedDj;
    const movement = movementText(row.movement);
    const lamp = movementClass(row.movement);
    const followerLabel = row.relationshipSource === 'server' && row.followerCount != null ? `<span class="ranking-mini">${esc(row.followerCount)} follower(s)</span>` : '';
    const summary = state.djRelationships.publicSummaries[row.publicProfileId] || {};
    const followLabel = summary.following ? 'Following' : 'Follow';
    return `<article class="ranking-row ${selected ? 'selected' : ''}" data-ranking-dj="${esc(row.publicProfileId || '')}">
      <div class="ranking-rank-cell"><strong>#${esc(row.rank || '-')}</strong><span>Prev #${esc(row.previousRank || '-')}</span></div>
      <div class="ranking-main">
        <div class="ranking-title">
          <strong>${esc(row.djName || 'Ranked DJ')}</strong>
          <span class="ranking-country">${esc(row.countryCode || countryCode(row.country))}</span>
          <span class="ranking-belt">${esc(row.belt || 'Unranked')}</span>
          <span class="ranking-mini">${esc(rankingEligibilityText(row))}</span>
          ${followerLabel}
        </div>
        <div class="ranking-subline">
          <span class="ranking-mini">${esc(row.country || 'Unknown')}</span>
          <span class="ranking-mini">${esc(`${row.eligibleWins || 0}-${row.eligibleLosses || 0}-${row.eligibleTies || 0}`)} W-L-T</span>
          <span class="ranking-mini">${esc(row.qualifyingBattles || 0)} eligible battle(s)</span>
          <span class="ranking-mini">Last ${esc(dateText(row.lastQualifyingActivity))}</span>
        </div>
      </div>
      <div class="ranking-rating-cell"><strong>${esc(row.rating || 0)}</strong><span><i class="movement-lamp ${esc(lamp)}"></i> ${esc(movement)} rank movement</span><span>Avg ${esc(row.averageScore || 0)} / Best ${esc(row.bestScore || 0)}</span></div>
      <div class="ranking-actions">
        ${isPrivate ? '<button class="ghost small" type="button" disabled>Private DJ</button>' : `<button class="ghost small" type="button" data-ranking-profile="${esc(row.publicProfileId)}">DJ Profile</button>`}
        <button class="ghost small" type="button" data-ranking-results="${esc(row.publicProfileId || '')}" ${isPrivate ? 'disabled' : ''}>Verified Results</button>
        ${isPrivate ? '<button class="ghost small" type="button" disabled>Ranking Detail</button>' : `<button class="ghost small" type="button" data-ranking-detail="${esc(row.publicProfileId)}">Ranking Detail</button>`}
        ${isPrivate ? '' : `<button class="ghost small" type="button" data-ranking-follow="${esc(row.publicProfileId)}">${esc(followLabel)}</button><button class="primary small" type="button" data-ranking-challenge="${esc(row.publicProfileId)}">Challenge</button>`}
      </div>
    </article>`;
  }).join('');
  target.querySelectorAll('[data-ranking-profile]').forEach(button => {
    button.onclick = () => {
      state.publicRankings.selectedDj = button.dataset.rankingProfile || '';
      updateRankingsDeepLink();
      loadPublicDjProfile(button.dataset.rankingProfile);
    };
  });
  target.querySelectorAll('[data-ranking-results]').forEach(button => {
    button.onclick = () => openRankingVerifiedResults(button.dataset.rankingResults);
  });
  target.querySelectorAll('[data-ranking-detail]').forEach(button => {
    button.onclick = () => loadPublicRankingDetail(button.dataset.rankingDetail).catch(err=>console.warn('Ranking detail load failed', err));
  });
  target.querySelectorAll('[data-ranking-follow]').forEach(button => {
    button.onclick = () => toggleRankingFollow(button.dataset.rankingFollow).catch(err=>console.warn('Ranking follow failed', err));
  });
  target.querySelectorAll('[data-ranking-challenge]').forEach(button => {
    button.onclick = () => openProtectedChallengeSetupFromPublicId(button.dataset.rankingChallenge, 'ranking_row').catch(err=>console.warn('Ranking challenge failed', err));
  });
}

function publicProfileFromRankingRow(publicProfileIdValue){
  const row = (state.publicRankings.rows || []).find(item => item.publicProfileId === publicProfileIdValue);
  if(!row) return null;
  return {
    publicProfileId:row.publicProfileId,
    displayName:row.djName,
    name:row.djName,
    country:row.country,
    belt:row.belt,
    rating:row.rating,
    rank:row.rank,
    profileVisibility:row.profileVisibility
  };
}

function publicProfileFromRelationshipSources(publicProfileIdValue){
  const fromRows = (state.djRelationships.rows || []).map(row => row.profile || row)
    .concat((state.djRelationships.feed.rows || []).flatMap(row => [row.actor, row.target]))
    .concat((state.djRelationships.opponents.rows || []).map(row => row.opponent))
    .concat(Object.values(state.djRelationships.publicSummaries || {}).map(row => row && row.profile))
    .find(row => row && row.publicProfileId === publicProfileIdValue);
  return fromRows ? {
    publicProfileId:fromRows.publicProfileId,
    displayName:fromRows.displayName || fromRows.name || fromRows.djName,
    name:fromRows.name || fromRows.displayName || fromRows.djName,
    country:fromRows.country,
    belt:fromRows.belt,
    rating:fromRows.rating,
    rank:fromRows.rank,
    profileVisibility:fromRows.profileVisibility || fromRows.visibility || 'public'
  } : null;
}

function publicProfileFromCommunitySources(publicProfileIdValue){
  const fromPost = (state.community.posts || []).concat(localCommunityPosts())
    .find(row => row && row.author && row.author.publicProfileId === publicProfileIdValue);
  if(!fromPost) return null;
  return communityChallengeProfileForPost(fromPost);
}

async function toggleRankingFollow(publicProfileIdValue){
  const profile = publicProfileFromRankingRow(publicProfileIdValue);
  if(!profile) return { skipped:true };
  const response = await togglePublicProfileFollow(profile);
  renderRankingRows();
  return response;
}

function challengeOriginContextForProfile(profile, fallbackSource = 'public_profile', extra = {}){
  const profileOrigin = plainObject(profile && profile.challengeOriginContext);
  const extraOrigin = plainObject(extra);
  const source = shortContextValue(extraOrigin.source || profileOrigin.source || profile && profile.challengeOrigin || fallbackSource, 80);
  const publicProfileIdValue = shortContextValue(extraOrigin.publicProfileId || profileOrigin.publicProfileId || challengeProfileId(profile), 96);
  const context = {
    ...profileOrigin,
    ...extraOrigin,
    source,
    publicProfileId:publicProfileIdValue
  };
  if(!context.rankingCategory) context.rankingCategory = state.profileRanking.public.category || 'competitive_battles';
  return context;
}

function challengeOriginTitle(profile){
  const context = challengeOriginContextForProfile(profile, profile && profile.challengeOrigin || 'public_profile');
  if(context.source === 'community_post') return 'Community Post';
  if(context.source === 'ranking_row') return 'Ranking Row';
  if(context.source === 'relationship_list') return 'Relationship List';
  if(context.source === 'activity_feed') return 'Activity Feed';
  if(context.source === 'opponent_history') return 'Opponent History';
  return 'Public Profile';
}

function challengeOriginDetail(profile){
  const context = challengeOriginContextForProfile(profile, profile && profile.challengeOrigin || 'public_profile');
  if(context.source === 'community_post'){
    return context.communityPostId
      ? `Request started beside a forum author from post ${context.communityPostId}.`
      : 'Request started beside a forum author.';
  }
  return 'Challenge started from this approved public profile.';
}

async function openProtectedChallengeSetupFromPublicId(publicProfileIdValue, origin = 'public_action', originContext = {}){
  const profile = publicProfileFromRankingRow(publicProfileIdValue)
    || (state.profileRanking.public.profileId === publicProfileIdValue ? state.profileRanking.public.profile : null)
    || publicProfileFromRelationshipSources(publicProfileIdValue)
    || publicProfileFromCommunitySources(publicProfileIdValue)
    || { publicProfileId:publicProfileIdValue, displayName:'DJ', profileVisibility:'public' };
  if(!djChallengeApiAvailable() || !state.musicLibrarySync.accountId){
    openModal(`<span class="eyebrow accent">CHALLENGE UNAVAILABLE</span><h3>Sign in required</h3><p style="color:var(--muted)">Protected challenge eligibility must be checked before opening the composer.</p><div class="modal-actions"><button class="ghost" value="cancel">Close</button></div>`);
    return { skipped:true, reason:'auth_required' };
  }
  const response = await window.DJBattleApi.apiRequest(`/api/challenges/eligibility/${encodeURIComponent(publicProfileIdValue)}`);
  const eligibility = response && response.data && response.data.eligibility || (!response || response.error ? null : { available:true, source:'protected_default' });
  if(response.error || !eligibility || eligibility.available === false){
    openModal(`<span class="eyebrow accent">CHALLENGE UNAVAILABLE</span><h3>DJ unavailable</h3><p style="color:var(--muted)">This DJ cannot receive that protected challenge right now.</p><div class="modal-actions"><button class="ghost" value="cancel">Close</button></div>`);
    return response.error ? response : { unavailable:true, eligibility };
  }
  const resolvedOriginContext = challengeOriginContextForProfile(profile, origin, originContext);
  const enriched = { ...profile, challengeEligibility:eligibility, challengeOrigin:resolvedOriginContext.source, challengeOriginContext:resolvedOriginContext };
  openChallengeSetup(enriched);
  return { profile:enriched, response };
}

function openRankingVerifiedResults(publicProfileIdValue){
  const row = (state.publicRankings.rows || []).find(item => item.publicProfileId === publicProfileIdValue);
  if(row){
    state.verifiedResultsDiscovery.filters = {
      ...state.verifiedResultsDiscovery.filters,
      country:row.country || 'all',
      belt:row.belt || 'all'
    };
  }
  state.verifiedResultsDiscovery.rankings = null;
  switchView('verified-results');
}

function renderPersonalRankings(){
  const target = document.getElementById('rankings-my-summary');
  if(!target) return;
  const personal = state.publicRankings.personal || {};
  if(personal.status === 'loading'){
    target.innerHTML = '<div class="ranking-personal-row"><strong>Loading server ranks</strong><small>No browser-calculated movement is shown as confirmed.</small></div>';
    return;
  }
  if(['signed_out','offline','configuration_required','failed'].includes(personal.status)){
    const text = personal.status === 'signed_out'
      ? 'Sign in to see server-confirmed personal ranks.'
      : personal.status === 'configuration_required'
        ? 'Server ranking configuration is required.'
        : personal.error || 'Personal rankings are unavailable.';
    target.innerHTML = `<div class="ranking-personal-row"><strong>${esc(readableComponentName(personal.status))}</strong><small>${esc(text)}</small></div>`;
    return;
  }
  const rankings = personal.rankings || {};
  const keys = PUBLIC_RANKING_CATEGORY_ORDER.filter(category => rankings[category]);
  if(!keys.length){
    target.innerHTML = '<div class="ranking-personal-row"><strong>No server rank yet</strong><small>Complete an eligible battle with an applied award to enter rankings.</small></div>';
    return;
  }
  target.innerHTML = keys.map(category => {
    const row = rankings[category];
    if(!row || row.status === 'not_yet_ranked'){
      return `<div class="ranking-personal-row"><strong>${esc(publicRankingCategoryLabel(category))}</strong><small>${esc(row && row.requirement || 'Complete one eligible resolved competitive battle with an applied progression award.')}</small><button class="ghost small" type="button" data-personal-ranking-detail="${esc(category)}">Detail</button></div>`;
    }
    const normalized = normalizePublicRankingRow(row);
    return `<div class="ranking-personal-row"><strong>${esc(publicRankingCategoryLabel(category))}: #${esc(normalized.rank)}</strong><small>${esc(normalized.belt)} - Rating ${esc(normalized.rating)} - ${esc(movementText(normalized.movement))} movement - ${esc(`${normalized.eligibleWins}-${normalized.eligibleLosses}-${normalized.eligibleTies}`)} W-L-T</small><button class="ghost small" type="button" data-personal-ranking-detail="${esc(category)}">Detail</button></div>`;
  }).join('');
  target.querySelectorAll('[data-personal-ranking-detail]').forEach(button => {
    button.onclick = () => loadPersonalRankingDetail(button.dataset.personalRankingDetail).catch(err=>console.warn('Personal ranking detail load failed', err));
  });
}

function normalizeRankingDetail(payload){
  const detail = payload && (payload.detail || payload.rankingDetail || payload);
  if(!detail || typeof detail !== 'object') return null;
  return {
    ...detail,
    profile: detail.profile || {},
    current: detail.current || {},
    eligibility: detail.eligibility || {},
    beltProgression: detail.beltProgression || {},
    movementHistory: Array.isArray(detail.movementHistory) ? detail.movementHistory : [],
    qualifyingBattles: Array.isArray(detail.qualifyingBattles) ? detail.qualifyingBattles : [],
    pagination: detail.pagination || { hasMore:false, nextCursor:null }
  };
}

function mergeRankingDetailList(existing, incoming, keyField){
  const map = new Map();
  [...(existing || []), ...(incoming || [])].forEach((item, index) => {
    const key = item && (item[keyField] || item.historyId || item.battleRef) || `row_${index}`;
    map.set(key, item);
  });
  return Array.from(map.values());
}

function rankingDetailSourceText(detail){
  if(!detail) return 'Award ledger detail';
  const snapshot = detail.current && detail.current.publishedSnapshot;
  return snapshot ? 'Award ledger + published snapshot' : 'Award ledger';
}

function rankingBattleTitle(battle){
  if(!battle) return 'Qualifying battle';
  if(battle.private) return battle.title || 'Private qualifying battle';
  const result = battle.result || {};
  return result.battle && result.battle.title || battle.title || 'Verified qualifying battle';
}

function rankingBattleMeta(battle){
  const result = battle && battle.result || {};
  const progression = result.progression || battle && battle.progression || {};
  const reward = result.reward || battle && battle.reward || {};
  const pieces = [];
  pieces.push(`Score ${Number(battle && battle.score || result.score || 0)}`);
  if(result.outcome || battle && battle.outcome) pieces.push(readableComponentName(result.outcome || battle.outcome));
  if(progression.ratingDelta != null) pieces.push(`${Number(progression.ratingDelta) >= 0 ? '+' : ''}${progression.ratingDelta} rating`);
  if(reward.type === 'bitcoin') pieces.push(`Bitcoin metadata: ${reward.transferStatus || 'untransferred'}`);
  return pieces.join(' - ');
}

function renderRankingDetail(){
  const target = document.getElementById('rankings-detail');
  if(!target) return;
  const detailState = state.publicRankings.detail || {};
  const detail = detailState.data;
  const error = detailState.error ? `<div class="ranking-detail-alert ${detailState.stale ? 'warn' : 'error'}">${esc(detailState.error)}</div>` : '';
  if(detailState.status === 'idle' || (!detail && detailState.status !== 'loading')){
    target.innerHTML = '<div class="ranking-detail-empty"><strong>Select a ranked DJ</strong><small>Open a leaderboard row or personal rank to view server-confirmed movement, qualifying battles and belt progress.</small></div>';
    return;
  }
  if(detailState.status === 'loading' && !detail){
    target.innerHTML = '<div class="ranking-detail-empty"><strong>Loading ranking history</strong><small>Requesting the authoritative ledger detail.</small></div>';
    return;
  }
  if(!detail){
    target.innerHTML = `${error}<div class="ranking-detail-empty"><strong>Ranking detail unavailable</strong><small>No local fallback is used for confirmed ranking history.</small></div>`;
    return;
  }
  const current = detail.current || {};
  const eligibility = detail.eligibility || {};
  const belt = detail.beltProgression || {};
  const profile = detail.profile || {};
  const pct = belt.nextThresholdXp ? Math.min(100, Math.round((Number(belt.currentXp || 0) / Number(belt.nextThresholdXp || 1)) * 100)) : 0;
  const historyRows = (detail.movementHistory || []).map(row => `<div class="ranking-timeline-row">
    <span>${esc(dateText(row.rankingPeriod || row.authoritativeTimestamp))}</span>
    <strong>#${esc(row.rank || '-')}</strong>
    <small>${esc(movementText(row.movement))} movement - Rating ${esc(row.ratingAfter || '-')} - ${esc(readableComponentName(row.movementStatus || 'unchanged'))}</small>
  </div>`).join('') || '<div class="ranking-detail-empty"><small>No applied award movement yet.</small></div>';
  const battleRows = (detail.qualifyingBattles || []).map(battle => `<div class="ranking-evidence-row ${battle.private ? 'private' : ''}">
    <strong>${esc(rankingBattleTitle(battle))}</strong>
    <small>${esc(rankingBattleMeta(battle))}</small>
    ${battle.result && battle.result.verifiedResultUrl ? `<a class="ghost small" href="${esc(battle.result.verifiedResultUrl)}">Verified Result</a>` : '<span class="ranking-private-note">Private or unavailable evidence</span>'}
  </div>`).join('') || '<div class="ranking-detail-empty"><small>No qualifying result records available.</small></div>';
  const more = detail.pagination && detail.pagination.hasMore ? '<button class="ghost small" type="button" data-ranking-detail-more>Load Detail</button>' : '';
  target.innerHTML = `${error}
    <div class="ranking-detail-readout">
      <span>${esc(detail.scope === 'owned' ? 'Personal Rank' : 'Public Rank')}</span>
      <strong>${esc(profile.djName || profile.displayName || 'Ranked DJ')}</strong>
      <small>${esc(publicRankingCategoryLabel(detail.category))} - ${esc(rankingDetailSourceText(detail))}</small>
    </div>
    <div class="ranking-detail-meters">
      <div><span>Rank</span><strong>#${esc(current.rank || '-')}</strong><small>${esc(movementText(current.movement))} movement</small></div>
      <div><span>Rating</span><strong>${esc(current.rating || '-')}</strong><small>${esc(readableComponentName(current.movementStatus || current.status || 'unranked'))}</small></div>
      <div><span>Eligible</span><strong>${esc(eligibility.qualifyingBattleCount || 0)}/${esc(eligibility.requiredBattles || 0)}</strong><small>${esc(readableComponentName(eligibility.status || 'unranked'))}</small></div>
    </div>
    <div class="ranking-detail-section"><h4>Belt Progress</h4><div class="belt-progress-meter"><i style="width:${esc(pct)}%"></i></div><small>${esc(belt.currentBelt || 'Unranked')} - ${esc(belt.currentXp || 0)} XP - next ${esc(belt.nextBelt || 'max')} (${esc(belt.remainingXp || 0)} XP)</small></div>
    <div class="ranking-detail-section"><h4>Movement</h4>${historyRows}</div>
    <div class="ranking-detail-section"><h4>Qualifying Battles</h4>${battleRows}</div>
    ${more}`;
  const button = target.querySelector('[data-ranking-detail-more]');
  if(button){
    button.onclick = () => {
      if(detailState.scope === 'owned') loadPersonalRankingDetail(detail.category, { append:true }).catch(err=>console.warn('Personal ranking detail pagination failed', err));
      else loadPublicRankingDetail(detailState.targetId, { append:true }).catch(err=>console.warn('Ranking detail pagination failed', err));
    };
  }
}

async function loadPublicRankingDetail(publicProfileIdValue, options = {}){
  const targetId = publicProfileIdValue || state.publicRankings.selectedDj;
  if(!targetId) return { skipped:true, reason:'missing_public_profile' };
  if(!window.DJBattleApi || typeof window.DJBattleApi.apiRequest !== 'function'){
    state.publicRankings.detail = { ...state.publicRankings.detail, status:'failed', error:'Server API is required for ranking detail.', stale:Boolean(state.publicRankings.detail.data) };
    renderRankingDetail();
    return { skipped:true, reason:'api_unavailable' };
  }
  const append = Boolean(options.append);
  const existing = state.publicRankings.detail || {};
  const category = options.category || state.publicRankings.category || existing.category || 'competitive_battles';
  const cursor = append && existing.data && existing.data.pagination ? existing.data.pagination.nextCursor : null;
  const seq = (existing.requestSeq || 0) + 1;
  state.publicRankings.selectedDj = targetId;
  state.publicRankings.detail = { ...existing, status:existing.data ? 'reconnecting' : 'loading', scope:'public', targetId, category, error:'', stale:false, requestSeq:seq };
  renderRankingsPage();
  const params = new URLSearchParams({ category, limit:'10' });
  if(cursor) params.set('cursor', cursor);
  const response = await window.DJBattleApi.apiRequest(`/api/publicRankings/${encodeURIComponent(targetId)}/history?${params.toString()}`, { public:true });
  if(seq !== state.publicRankings.detail.requestSeq) return { stale:true, reason:'out_of_order' };
  if(!response || response.error || !response.data){
    state.publicRankings.detail = { ...state.publicRankings.detail, status:state.publicRankings.detail.data ? 'stale' : 'failed', stale:Boolean(state.publicRankings.detail.data), error:response && response.error || 'Ranking detail unavailable.' };
    renderRankingDetail();
    return response || { error:state.publicRankings.detail.error };
  }
  const incoming = normalizeRankingDetail(response.data.detail || response.data);
  if(append && existing.data && incoming){
    incoming.movementHistory = mergeRankingDetailList(existing.data.movementHistory, incoming.movementHistory, 'historyId');
    incoming.qualifyingBattles = mergeRankingDetailList(existing.data.qualifyingBattles, incoming.qualifyingBattles, 'battleRef');
  }
  state.publicRankings.detail = { ...state.publicRankings.detail, status:'synced', stale:false, error:'', data:incoming, cursor:incoming && incoming.pagination && incoming.pagination.nextCursor || null };
  updateRankingsDeepLink();
  renderRankingsPage();
  return response;
}

async function loadPersonalRankingDetail(category = state.publicRankings.category, options = {}){
  if(!window.DJBattleApi || typeof window.DJBattleApi.apiRequest !== 'function'){
    state.publicRankings.detail = { ...state.publicRankings.detail, status:'failed', scope:'owned', category, error:'Server API is required for personal ranking detail.', stale:Boolean(state.publicRankings.detail.data) };
    renderRankingDetail();
    return { skipped:true, reason:'api_unavailable' };
  }
  const append = Boolean(options.append);
  const existing = state.publicRankings.detail || {};
  const cursor = append && existing.data && existing.data.pagination ? existing.data.pagination.nextCursor : null;
  const seq = (existing.requestSeq || 0) + 1;
  state.publicRankings.detail = { ...existing, status:existing.data ? 'reconnecting' : 'loading', scope:'owned', targetId:'me', category, error:'', stale:false, requestSeq:seq };
  renderRankingDetail();
  const params = new URLSearchParams({ category, limit:'10' });
  if(cursor) params.set('cursor', cursor);
  const response = await window.DJBattleApi.apiRequest(`/api/myRankings/history?${params.toString()}`);
  if(seq !== state.publicRankings.detail.requestSeq) return { stale:true, reason:'out_of_order' };
  if(!response || response.error || !response.data){
    state.publicRankings.detail = { ...state.publicRankings.detail, status:state.publicRankings.detail.data ? 'stale' : 'failed', stale:Boolean(state.publicRankings.detail.data), error:response && response.error || 'Personal ranking detail unavailable.' };
    renderRankingDetail();
    return response || { error:state.publicRankings.detail.error };
  }
  const incoming = normalizeRankingDetail(response.data.detail || response.data);
  if(append && existing.data && incoming){
    incoming.movementHistory = mergeRankingDetailList(existing.data.movementHistory, incoming.movementHistory, 'historyId');
    incoming.qualifyingBattles = mergeRankingDetailList(existing.data.qualifyingBattles, incoming.qualifyingBattles, 'battleRef');
  }
  state.publicRankings.detail = { ...state.publicRankings.detail, status:'synced', stale:false, error:'', data:incoming, cursor:incoming && incoming.pagination && incoming.pagination.nextCursor || null };
  renderRankingDetail();
  return response;
}

function rankingCategoryButtonsHtml(activeCategory, scope){
  return PUBLIC_RANKING_CATEGORY_ORDER.map(category => {
    const active = category === activeCategory;
    return `<button class="profile-ranking-tab ${active ? 'active' : ''}" type="button" data-profile-ranking-category="${esc(category)}" data-profile-ranking-scope="${esc(scope)}">${esc(publicRankingCategoryLabel(category))}</button>`;
  }).join('');
}

function rankingBlockerText(blocker){
  return readableComponentName(String(blocker || '').replace(/^missing_/, 'missing '));
}

function rankingDetailSummaryHtml(detailState, options = {}){
  const detail = detailState && detailState.data;
  const error = detailState && detailState.error ? `<div class="ranking-detail-alert ${detailState.stale ? 'warn' : 'error'}">${esc(detailState.error)}</div>` : '';
  if(!detail && detailState && detailState.status === 'loading'){
    return `${error}<div class="ranking-detail-empty"><strong>${esc(options.loadingTitle || 'Loading ranking history')}</strong><small>Requesting server-confirmed profile ranking history.</small></div>`;
  }
  if(!detail){
    const text = detailState && detailState.status === 'idle'
      ? (options.emptyText || 'Select a category to load authoritative ranking history.')
      : 'No browser fallback is used for profile ranking history.';
    return `${error}<div class="ranking-detail-empty"><strong>${esc(options.emptyTitle || 'Ranking history unavailable')}</strong><small>${esc(text)}</small></div>`;
  }
  const current = detail.current || {};
  const eligibility = detail.eligibility || {};
  const belt = detail.beltProgression || {};
  const profile = detail.profile || {};
  const snapshot = current.publishedSnapshot;
  const pct = belt.nextThresholdXp ? Math.min(100, Math.round((Number(belt.currentXp || 0) / Number(belt.nextThresholdXp || 1)) * 100)) : 0;
  const blockers = (eligibility.blockers || []).length
    ? `<div class="profile-ranking-blockers">${eligibility.blockers.map(blocker => `<span>${esc(rankingBlockerText(blocker))}</span>`).join('')}</div>`
    : '<div class="profile-ranking-blockers"><span>No server blockers</span></div>';
  const publishedSnapshots = Array.isArray(detail.publishedSnapshots) && detail.publishedSnapshots.length ? detail.publishedSnapshots : (snapshot ? [snapshot] : []);
  const snapshotRows = publishedSnapshots.length
    ? publishedSnapshots.map(item => `<div class="ranking-timeline-row"><span>${esc(dateText(item.publishedAt))}</span><strong>#${esc(item.rank || '-')}</strong><small>${esc(movementText(item.movement))} movement - published snapshot - ${esc(item.calculationVersion || detail.calculationVersion || 'version pending')}</small></div>`).join('')
    : '<div class="ranking-detail-empty"><small>Insufficient published snapshot history. No daily or weekly movement is fabricated.</small></div>';
  const historyRows = (detail.movementHistory || []).map(row => {
    const selected = detailState && detailState.selectedResultId && (String(row.historyId) === String(detailState.selectedResultId));
    return `<div class="ranking-timeline-row ${selected ? 'selected' : ''}">
      <span>${esc(dateText(row.rankingPeriod || row.authoritativeTimestamp))}</span>
      <strong>#${esc(row.rank || '-')}</strong>
      <small>${esc(movementText(row.movement))} movement - ${esc(row.ratingBefore == null ? 'Rating pending' : `${row.ratingBefore} -> ${row.ratingAfter}`)} - ${esc(row.calculationVersion || detail.calculationVersion || 'version pending')}</small>
    </div>`;
  }).join('') || '<div class="ranking-detail-empty"><small>No applied award movement in this category yet.</small></div>';
  const battleRows = (detail.qualifyingBattles || []).map(battle => {
    const result = battle.result || {};
    const selected = detailState && detailState.selectedResultId && [battle.battleRef, result.verifiedResultId, result.submissionId].some(value => String(value || '') === String(detailState.selectedResultId));
    return `<div class="ranking-evidence-row ${battle.private ? 'private' : ''} ${selected ? 'selected' : ''}">
      <strong>${esc(rankingBattleTitle(battle))}</strong>
      <small>${esc(rankingBattleMeta(battle))}</small>
      ${result.verifiedResultUrl ? `<button class="ghost small" type="button" data-profile-result-link="${esc(result.verifiedResultId)}">Verified Result</button>` : '<span class="ranking-private-note">Anonymous qualifying activity</span>'}
    </div>`;
  }).join('') || '<div class="ranking-detail-empty"><small>No qualifying result records are available for this category.</small></div>';
  const promotionRows = (belt.promotions || []).length
    ? belt.promotions.slice(0, 6).map(item => `<div class="battle-result-row"><b>${esc(item.from)} -> ${esc(item.to)}</b><em>${esc(dateText(item.awardedAt))} / ${esc(item.xpAfter || 0)} XP</em></div>`).join('')
    : '<div class="battle-result-row"><b>Promotions</b><em>No server-confirmed promotions yet</em></div>';
  const more = detail.pagination && detail.pagination.hasMore
    ? `<button class="ghost small" type="button" data-profile-ranking-more="${esc(detail.scope || options.scope || '')}">Load More History</button>`
    : '';
  return `${error}
    <div class="profile-ranking-overview">
      <div class="profile-rank-lcd"><span>${esc(detail.scope === 'owned' ? 'Private Rank' : 'Public Rank')}</span><strong>#${esc(current.rank || '-')}</strong><small>${esc(publicRankingCategoryLabel(detail.category))}</small></div>
      <div class="profile-ranking-meter"><span>Rating</span><strong>${esc(current.rating || '-')}</strong><small>${esc(current.previousRating == null ? 'Previous rating unavailable' : `from ${current.previousRating}`)}</small></div>
      <div class="profile-ranking-meter"><span>Eligible Record</span><strong>${esc(current.eligibleRecord ? `${current.eligibleRecord.wins || 0}-${current.eligibleRecord.losses || 0}-${current.eligibleRecord.ties || 0}` : `${eligibility.qualifyingBattleCount || 0} battle(s)`)}</strong><small>${esc(readableComponentName(eligibility.status || 'unranked'))}</small></div>
      <div class="profile-ranking-meter"><span>Belt</span><strong>${esc(belt.currentBelt || profile.belt || 'Unranked')}</strong><small>${esc(belt.remainingXp == null ? 'Threshold unconfirmed' : `${belt.remainingXp} XP to ${belt.nextBelt || 'next belt'}`)}</small></div>
    </div>
    <div class="ranking-detail-section"><h4>Eligibility</h4><small>${esc(eligibility.qualifyingBattleCount || 0)} qualifying battle(s), ${esc(eligibility.remainingBattles || 0)} remaining for full status. Source: ${esc(eligibility.source || 'server')}</small>${blockers}</div>
    <div class="ranking-detail-section"><h4>Belt Progression</h4><div class="belt-progress-meter"><i style="width:${esc(pct)}%"></i></div><small>${esc(belt.currentXp || 0)} XP / ${esc(belt.nextThresholdXp || 'threshold pending')} - ${esc(belt.ruleVersion || 'rule version pending')}</small><div class="battle-result-table" style="margin-top:10px">${promotionRows}</div></div>
    <div class="ranking-detail-section"><h4>Published Snapshot Timeline</h4>${snapshotRows}</div>
    <div class="ranking-detail-section"><h4>Movement Timeline</h4>${historyRows}</div>
    <div class="ranking-detail-section"><h4>Verified Battle Evidence</h4>${battleRows}</div>
    ${more}`;
}

function attachProfileRankingControls(root = document){
  root.querySelectorAll('[data-profile-ranking-category]').forEach(button => {
    button.onclick = event => {
      const category = validPublicRankingCategory(event.currentTarget.dataset.profileRankingCategory);
      const scope = event.currentTarget.dataset.profileRankingScope;
      if(scope === 'public'){
        loadPublicProfileRankingDetail(state.profileRanking.public.profileId, { category }).catch(err=>console.warn('Public profile ranking load failed', err));
      }else{
        loadPrivateProfileRankingDetail(category).catch(err=>console.warn('Private profile ranking load failed', err));
      }
    };
  });
  root.querySelectorAll('[data-profile-ranking-more]').forEach(button => {
    button.onclick = event => {
      const scope = event.currentTarget.dataset.profileRankingMore;
      if(scope === 'public') loadPublicProfileRankingDetail(state.profileRanking.public.profileId, { append:true }).catch(err=>console.warn('Public profile ranking pagination failed', err));
      else loadPrivateProfileRankingDetail(state.profileRanking.private.category, { append:true }).catch(err=>console.warn('Private profile ranking pagination failed', err));
    };
  });
  root.querySelectorAll('[data-profile-result-link]').forEach(button => {
    button.onclick = event => loadPublicVerifiedResult(event.currentTarget.dataset.profileResultLink);
  });
  root.querySelectorAll('[data-public-result-ranking-impact]').forEach(button => {
    button.onclick = event => openPublicProfileRankingImpactFromResult(event.currentTarget.dataset.publicResultRankingImpact, { returnTo:'public-profile' });
  });
}

function updatePublicProfileRankingHash(){
  if(!window.history || !state.profileRanking.public.profileId) return;
  const params = new URLSearchParams();
  params.set('dj', state.profileRanking.public.profileId);
  params.set('rankingCategory', state.profileRanking.public.category);
  if(state.profileRanking.public.selectedResultId) params.set('result', state.profileRanking.public.selectedResultId);
  if(state.profileRanking.public.returnTo) params.set('return', state.profileRanking.public.returnTo);
  window.history.replaceState(null, '', `${window.location.pathname}#profile?${params.toString()}`);
}

function updatePrivateProfileProgressionState(category){
  state.profileRanking.private.category = validPublicRankingCategory(category);
  localStorage.setItem('djBattlePrivateProgressionCategory', state.profileRanking.private.category);
}

async function loadPublicProfileRankingDetail(publicProfileIdValue, options = {}){
  const profileIdValue = publicProfileIdValue || state.profileRanking.public.profileId;
  if(!profileIdValue || !/^dj_[a-z0-9]+$/i.test(String(profileIdValue))){
    state.profileRanking.public = { ...state.profileRanking.public, status:'failed', error:'Public ranking history requires a stable public profile identifier.', stale:Boolean(state.profileRanking.public.data) };
    if(state.profileRanking.public.profile) renderPublicDjProfile(state.profileRanking.public.profile);
    return { skipped:true, reason:'invalid_public_profile' };
  }
  if(!window.DJBattleApi || typeof window.DJBattleApi.apiRequest !== 'function'){
    state.profileRanking.public = { ...state.profileRanking.public, status:'configuration_required', error:'Server API is required for profile ranking history.', stale:Boolean(state.profileRanking.public.data) };
    if(state.profileRanking.public.profile) renderPublicDjProfile(state.profileRanking.public.profile);
    return { skipped:true, reason:'api_unavailable' };
  }
  const existing = state.profileRanking.public;
  const append = Boolean(options.append);
  const category = validPublicRankingCategory(options.category || existing.category || 'competitive_battles');
  const cursor = append && existing.data && existing.data.pagination ? existing.data.pagination.nextCursor : null;
  const seq = (existing.requestSeq || 0) + 1;
  state.profileRanking.public = {
    ...existing,
    profileId:profileIdValue,
    category,
    selectedResultId:options.selectedResultId != null ? options.selectedResultId : existing.selectedResultId,
    returnTo:options.returnTo != null ? options.returnTo : existing.returnTo,
    status:existing.data ? 'reconnecting' : 'loading',
    error:'',
    stale:false,
    requestSeq:seq
  };
  if(state.profileRanking.public.profile) renderPublicDjProfile(state.profileRanking.public.profile);
  const params = new URLSearchParams({ category, limit:'10' });
  if(cursor) params.set('cursor', cursor);
  const response = await window.DJBattleApi.apiRequest(`/api/publicRankings/${encodeURIComponent(profileIdValue)}/history?${params.toString()}`, { public:true });
  if(seq !== state.profileRanking.public.requestSeq) return { stale:true, reason:'out_of_order' };
  if(!response || response.error || !response.data){
    state.profileRanking.public = { ...state.profileRanking.public, status:state.profileRanking.public.data ? 'stale' : (response && response.status === 503 ? 'configuration_required' : 'failed'), stale:Boolean(state.profileRanking.public.data), error:response && response.error || 'Public profile ranking history unavailable.' };
    if(state.profileRanking.public.profile) renderPublicDjProfile(state.profileRanking.public.profile);
    return response || { error:state.profileRanking.public.error };
  }
  const incoming = normalizeRankingDetail(response.data.detail || response.data);
  if(append && existing.data && incoming){
    incoming.movementHistory = mergeRankingDetailList(existing.data.movementHistory, incoming.movementHistory, 'historyId');
    incoming.qualifyingBattles = mergeRankingDetailList(existing.data.qualifyingBattles, incoming.qualifyingBattles, 'battleRef');
  }
  state.profileRanking.public = { ...state.profileRanking.public, status:'synced', stale:false, error:'', data:incoming };
  updatePublicProfileRankingHash();
  if(state.profileRanking.public.profile) renderPublicDjProfile(state.profileRanking.public.profile);
  return response;
}

async function loadPrivateProfileRankingDetail(category = state.profileRanking.private.category, options = {}){
  updatePrivateProfileProgressionState(category);
  if(!window.DJBattleApi || typeof window.DJBattleApi.apiRequest !== 'function'){
    state.profileRanking.private = { ...state.profileRanking.private, status:'configuration_required', error:'Server API is required for private progression history.', stale:Boolean(state.profileRanking.private.data) };
    renderProfileProgressionHistory();
    return { skipped:true, reason:'api_unavailable' };
  }
  const existing = state.profileRanking.private;
  const append = Boolean(options.append);
  const cursor = append && existing.data && existing.data.pagination ? existing.data.pagination.nextCursor : null;
  const seq = (existing.requestSeq || 0) + 1;
  state.profileRanking.private = {
    ...existing,
    selectedResultId:options.selectedResultId != null ? options.selectedResultId : existing.selectedResultId,
    returnTo:options.returnTo != null ? options.returnTo : existing.returnTo,
    status:existing.data ? 'reconnecting' : 'loading',
    error:'',
    stale:false,
    requestSeq:seq
  };
  renderProfileProgressionHistory();
  const params = new URLSearchParams({ category:state.profileRanking.private.category, limit:'10' });
  if(cursor) params.set('cursor', cursor);
  const response = await window.DJBattleApi.apiRequest(`/api/myRankings/history?${params.toString()}`);
  if(seq !== state.profileRanking.private.requestSeq) return { stale:true, reason:'out_of_order' };
  if(!response || response.error || !response.data){
    state.profileRanking.private = { ...state.profileRanking.private, status:state.profileRanking.private.data ? 'stale' : (response && response.status === 503 ? 'configuration_required' : response && response.status === 401 ? 'signed_out' : 'failed'), stale:Boolean(state.profileRanking.private.data), error:response && response.error || 'Private progression history unavailable.' };
    renderProfileProgressionHistory();
    return response || { error:state.profileRanking.private.error };
  }
  const incoming = normalizeRankingDetail(response.data.detail || response.data);
  if(append && existing.data && incoming){
    incoming.movementHistory = mergeRankingDetailList(existing.data.movementHistory, incoming.movementHistory, 'historyId');
    incoming.qualifyingBattles = mergeRankingDetailList(existing.data.qualifyingBattles, incoming.qualifyingBattles, 'battleRef');
  }
  state.profileRanking.private = { ...state.profileRanking.private, status:'synced', stale:false, error:'', data:incoming };
  renderProfileProgressionHistory();
  return response;
}

function renderRankingsPage(){
  renderRankingCategoryTabs();
  renderRankingsFilters();
  renderActiveRankingFilters();
  renderRankingsStatus();
  renderRankingRows();
  renderPersonalRankings();
  renderRankingDetail();
  renderAiLeaderboard();
  const refresh = document.getElementById('rankings-refresh');
  if(refresh) refresh.onclick = () => loadRankingsPage({ force:true }).catch(err=>console.warn('Rankings refresh failed', err));
  const more = document.getElementById('rankings-load-more');
  if(more){
    more.disabled = !state.publicRankings.pagination?.hasMore || state.publicRankings.status === 'loading' || state.publicRankings.category === 'ai_only_high_scores';
    more.onclick = () => loadRankingsPage({ append:true }).catch(err=>console.warn('Rankings pagination failed', err));
  }
}

async function loadRankingsPage(options = {}){
  const append = Boolean(options.append);
  const nextPage = append ? state.publicRankings.pagination.nextPage || state.publicRankings.page + 1 : state.publicRankings.page || 1;
  if(!window.DJBattleApi || typeof window.DJBattleApi.apiRequest !== 'function'){
    state.publicRankings.status = 'configuration_required';
    state.publicRankings.error = 'Server API is required for authoritative rankings.';
    state.publicRankings.stale = Boolean(state.publicRankings.rows.length);
    renderRankingsPage();
    return { skipped:true, reason:'api_unavailable' };
  }
  const relationshipScope = state.publicRankings.filters.relationship || 'all';
  if(relationshipScope !== 'all' && !state.musicLibrarySync.accountId){
    state.publicRankings.status = state.publicRankings.rows.length ? 'stale' : 'failed';
    state.publicRankings.error = 'Sign in to view relationship-scoped rankings.';
    state.publicRankings.stale = Boolean(state.publicRankings.rows.length);
    renderRankingsPage();
    return { skipped:true, reason:'auth_required' };
  }
  const seq = state.publicRankings.requestSeq + 1;
  state.publicRankings.requestSeq = seq;
  state.publicRankings.status = state.publicRankings.rows.length ? 'reconnecting' : 'loading';
  state.publicRankings.error = '';
  renderRankingsPage();
  const endpoint = relationshipScope === 'all' ? '/api/publicLeaderboards' : '/api/relationshipLeaderboards';
  const requestOptions = relationshipScope === 'all' ? { public:true } : {};
  const response = await window.DJBattleApi.apiRequest(`${endpoint}?${publicRankingQuery(nextPage)}`, requestOptions);
  if(seq !== state.publicRankings.requestSeq) return { stale:true, reason:'out_of_order' };
  if(!response || response.error || !response.data){
    state.publicRankings.status = state.publicRankings.rows.length ? 'stale' : (response && response.status === 503 ? 'configuration_required' : 'failed');
    state.publicRankings.stale = Boolean(state.publicRankings.rows.length);
    state.publicRankings.error = response && response.error || 'Authoritative leaderboard unavailable.';
    renderRankingsPage();
    return response || { error:state.publicRankings.error };
  }
  const data = response.data.leaderboard || response.data.rankings || response.data;
  const normalized = normalizeServerLeaderboardRankings(data);
  const rows = (response.data.rows || data.rows || []).map(normalizePublicRankingRow);
  state.publicRankings.categories = normalized && normalized.categories || state.publicRankings.categories || {};
  state.publicRankings.rows = append ? mergePublicRankingRows(state.publicRankings.rows, rows) : mergePublicRankingRows([], rows);
  state.publicRankings.pagination = data.pagination || response.data.pagination || { page:nextPage, limit:state.publicRankings.pageSize, total:state.publicRankings.rows.length, hasMore:false, nextPage:null };
  state.publicRankings.page = state.publicRankings.pagination.page || nextPage;
  state.publicRankings.status = 'synced';
  state.publicRankings.stale = false;
  state.publicRankings.error = '';
  state.publicRankings.lastSuccessfulAt = new Date().toISOString();
  updateRankingsDeepLink();
  renderRankingsPage();
  return response;
}

async function loadRankingsPersonalSummary(){
  if(!window.DJBattleApi || typeof window.DJBattleApi.apiRequest !== 'function'){
    state.publicRankings.personal = { status:'offline', rankings:null, error:'Sign in and server API are required for personal ranks.' };
    renderPersonalRankings();
    return { skipped:true, reason:'api_unavailable' };
  }
  state.publicRankings.personal = { ...state.publicRankings.personal, status:'loading', error:'' };
  renderPersonalRankings();
  const response = await window.DJBattleApi.apiRequest('/api/myRankings');
  if(response && response.data && response.data.rankings){
    state.publicRankings.personal = { status:'synced', rankings:response.data.rankings, error:'', calculationVersion:response.data.calculationVersion };
  }else{
    const status = response && response.status;
    state.publicRankings.personal = {
      status:status === 401 ? 'signed_out' : status === 503 ? 'configuration_required' : 'failed',
      rankings:null,
      error:response && response.error || 'Personal rankings unavailable.'
    };
  }
  renderPersonalRankings();
  renderRankingsFilters();
  return response;
}

function optionList(labelAll, values, selected, formatter = value => value){
  const unique = Array.from(new Set(values.filter(Boolean))).sort((a,b)=>String(a).localeCompare(String(b)));
  return ['all', ...unique].map(value => `<option value="${esc(value)}" ${selected===value?'selected':''}>${esc(value === 'all' ? labelAll : formatter(value))}</option>`).join('');
}

function verifiedDiscoveryQuery(page){
  const params = new URLSearchParams();
  const filters = state.verifiedResultsDiscovery.filters;
  Object.entries(filters).forEach(([key,value]) => { if(value && value !== 'all') params.set(key, value); });
  params.set('sort', state.verifiedResultsDiscovery.sort || 'newest');
  params.set('page', String(page || state.verifiedResultsDiscovery.page || 1));
  params.set('limit', String(state.verifiedResultsDiscovery.pageSize || 10));
  return params.toString();
}

function setVerifiedDiscoveryStateFromRows(rows, pagination, rankings, options = {}){
  state.verifiedResultsDiscovery.results = rows.map(normalizeVerifiedDiscoveryResult).filter(Boolean);
  state.verifiedResultsDiscovery.pagination = pagination || { page:1, limit:state.verifiedResultsDiscovery.pageSize, total:state.verifiedResultsDiscovery.results.length, hasMore:false, nextPage:null };
  state.verifiedResultsDiscovery.page = state.verifiedResultsDiscovery.pagination.page || 1;
  state.verifiedResultsDiscovery.rankings = rankings || buildVerifiedPublicRankings(state.verifiedResultsDiscovery.results);
  state.verifiedResultsDiscovery.rankingSource = state.verifiedResultsDiscovery.rankings && state.verifiedResultsDiscovery.rankings.source || options.rankingSource || options.source || 'local';
  state.verifiedResultsDiscovery.source = options.source || 'local';
  state.verifiedResultsDiscovery.sortUnsupported = Boolean(options.sortUnsupported);
}

async function loadAuthoritativeLeaderboards(options = {}){
  if(!window.DJBattleApi || typeof window.DJBattleApi.apiRequest !== 'function') return null;
  const params = new URLSearchParams();
  const filters = state.verifiedResultsDiscovery.filters || {};
  params.set('category', options.category || 'competitive_battles');
  if(filters.country && filters.country !== 'all') params.set('country', filters.country);
  if(filters.belt && filters.belt !== 'all') params.set('belt', filters.belt);
  params.set('page', String(options.page || 1));
  params.set('limit', String(options.limit || 50));
  const response = await window.DJBattleApi.apiRequest(`/api/publicLeaderboards?${params.toString()}`, { public:true });
  const normalized = normalizeServerLeaderboardRankings(response && response.data);
  if(normalized){
    state.verifiedResultsDiscovery.rankings = normalized;
    state.verifiedResultsDiscovery.rankingSource = normalized.source || 'award_ledger';
    renderVerifiedRankingsSummary(normalized, 'verified-ranking-categories');
    renderVerifiedRankingsSummary(normalized, 'rankings-verified-summary');
  }
  return response;
}

async function loadMyServerRankings(){
  if(!window.DJBattleApi || typeof window.DJBattleApi.apiRequest !== 'function') return null;
  const response = await window.DJBattleApi.apiRequest('/api/myRankings');
  if(response && response.data && response.data.rankings){
    state.verifiedResultsDiscovery.myRankings = response.data.rankings;
  }
  return response;
}

async function loadVerifiedResultsDiscovery(options = {}){
  const append = Boolean(options.append);
  const nextPage = append ? state.verifiedResultsDiscovery.pagination.nextPage || state.verifiedResultsDiscovery.page + 1 : 1;
  const shouldUseServer = options.forceServer === true || LIVE_MODE;
  if(shouldUseServer && window.DJBattleApi && typeof window.DJBattleApi.apiRequest === 'function'){
    const response = await window.DJBattleApi.apiRequest(`/api/publicBattleResults?${verifiedDiscoveryQuery(nextPage)}`, { public:true });
    if(response && response.data && Array.isArray(response.data.results)){
      const incoming = response.data.results.map(normalizeVerifiedDiscoveryResult).filter(Boolean);
      const merged = append ? [...state.verifiedResultsDiscovery.results, ...incoming] : incoming;
      const seen = new Set();
      const deduped = merged.filter(row => {
        if(seen.has(row.verifiedResultId)) return false;
        seen.add(row.verifiedResultId);
        return true;
      });
      const ordered = sortVerifiedResultsDiscovery(deduped);
      const ledgerRankings = normalizeServerLeaderboardRankings(response.data.rankings || response.data.leaderboard || response.data);
      setVerifiedDiscoveryStateFromRows(ordered, response.data.pagination, ledgerRankings || buildVerifiedPublicRankings(ordered), { source:'server', rankingSource:ledgerRankings && ledgerRankings.source, sortUnsupported:response.data.sortUnsupported });
      renderVerifiedResultsDiscovery();
      return response;
    }
  }
  const all = publicVerifiedResultsFromLocal();
  const filtered = filterVerifiedResultsDiscovery(all);
  const sorted = sortVerifiedResultsDiscovery(filtered);
  const start = (nextPage - 1) * state.verifiedResultsDiscovery.pageSize;
  const pageRows = sorted.slice(0, start + state.verifiedResultsDiscovery.pageSize);
  setVerifiedDiscoveryStateFromRows(pageRows, {
    page:nextPage,
    limit:state.verifiedResultsDiscovery.pageSize,
    total:sorted.length,
    hasMore:start + state.verifiedResultsDiscovery.pageSize < sorted.length,
    nextPage:start + state.verifiedResultsDiscovery.pageSize < sorted.length ? nextPage + 1 : null
  }, buildVerifiedPublicRankings(filtered), {
    source:'local',
    sortUnsupported:state.verifiedResultsDiscovery.sort === 'most_viewed' && !filtered.some(row => Number(row.viewCount || 0) > 0)
  });
  renderVerifiedResultsDiscovery();
  return { status:200, data:{ results:pageRows, pagination:state.verifiedResultsDiscovery.pagination, rankings:state.verifiedResultsDiscovery.rankings } };
}

function verifiedChip(label, value){
  return `<div class="verified-chip"><span>${esc(label)}</span><b>${esc(value == null || value === '' ? 'N/A' : value)}</b></div>`;
}

function renderVerifiedResultsDiscovery(){
  const list = document.getElementById('verified-results-list');
  if(!list) return;
  const allLocal = publicVerifiedResultsFromLocal();
  const rows = state.verifiedResultsDiscovery.results;
  const filters = state.verifiedResultsDiscovery.filters;
  const sourceValues = Array.from(new Set([...allLocal, ...rows].flatMap(row => row.scoringSource || [])));
  const setOptions = (id, html) => { const el = document.getElementById(id); if(el) el.innerHTML = html; };
  setOptions('verified-filter-country', optionList('All countries', [...allLocal, ...rows].map(row => row.profile && row.profile.country), filters.country, value => `${countryCode(value)} - ${value}`));
  setOptions('verified-filter-mode', optionList('All modes', [...allLocal, ...rows].map(row => row.battle && row.battle.modeId), filters.mode, readableComponentName));
  setOptions('verified-filter-genre', optionList('All genres', [...allLocal, ...rows].map(row => row.battle && row.battle.genre), filters.genre));
  setOptions('verified-filter-source', optionList('All sources', sourceValues, filters.source, readableComponentName));
  setOptions('verified-filter-belt', optionList('All belts', [...allLocal, ...rows].map(row => row.belt), filters.belt));
  setOptions('verified-filter-opponent', [['all','All opponents'],['opponent','Opponent'],['ai_only','AI-only'],['unmatched','Pending']].map(([value,label])=>`<option value="${value}" ${filters.opponent===value?'selected':''}>${label}</option>`).join(''));
  setOptions('verified-filter-date', [['all','Any date'],['7d','Last 7 days'],['30d','Last 30 days'],['year','Last year']].map(([value,label])=>`<option value="${value}" ${filters.date===value?'selected':''}>${label}</option>`).join(''));
  setOptions('verified-sort', [['newest','Newest'],['highest_score','Highest score'],['rating_movement','Strongest rating movement'],['most_viewed','Most viewed']].map(([value,label])=>`<option value="${value}" ${state.verifiedResultsDiscovery.sort===value?'selected':''}>${label}</option>`).join(''));

  const status = document.getElementById('verified-discovery-status');
  if(status){
    const p = state.verifiedResultsDiscovery.pagination || {};
    const rankingLabel = state.verifiedResultsDiscovery.rankingSource === 'award_ledger' ? 'Award ledger rankings' : 'History-derived rankings';
    status.innerHTML = `<span class="verified-status-pill"><i></i>${esc(state.verifiedResultsDiscovery.source === 'server' ? 'Server verified contract' : 'Local public history fallback')}</span><span class="verified-status-pill"><i></i>${esc(rankingLabel)}</span><span class="verified-status-pill ${state.verifiedResultsDiscovery.sortUnsupported?'warn':''}"><i></i>${esc(state.verifiedResultsDiscovery.sortUnsupported ? 'Most-viewed sort needs real view data' : `${p.total || rows.length} public result(s)`)}</span>`;
  }

  list.innerHTML = rows.length ? rows.map(row => {
    const scoreSource = (row.scoringSource || []).join(' + ');
    const rating = Number(row.ratingMovement || 0);
    const bitcoin = bitcoinHistoryText(row);
    const country = row.profile && row.profile.country || 'Unknown';
    return `<article class="verified-result-row" data-verified-result="${esc(row.verifiedResultId)}">
      <div class="verified-score-cell"><span class="verified-country-marker">${esc(countryCode(country))}</span><strong>${esc(row.score)}</strong><span class="verified-belt-marker">${esc(row.belt || 'Unranked')}</span></div>
      <div class="verified-main">
        <div class="verified-title"><strong>${esc(row.title)}</strong><span class="history-visibility">Public verified</span>${(row.scoringSource || []).map(label=>`<span class="history-source-tag">${esc(label)}</span>`).join('')}</div>
        <div class="verified-meta">
          ${verifiedChip('DJ', `${row.profile.displayName} (${countryCode(country)})`)}
          ${verifiedChip('Mode', row.battle.type || readableComponentName(row.battle.modeId))}
          ${verifiedChip('Genre', row.battle.genre)}
          ${verifiedChip('Opponent', historyOpponent(row))}
          ${verifiedChip('Outcome', readableComponentName(row.outcome))}
          ${verifiedChip('Score Source', scoreSource)}
          ${verifiedChip('Rating Move', `${rating >= 0 ? '+' : ''}${rating}`)}
          ${verifiedChip('Belt', row.belt)}
          ${verifiedChip('Completed', historyDateText(row))}
          ${verifiedChip('Bitcoin', bitcoin)}
        </div>
      </div>
      <div class="verified-actions-column">
        <button class="ghost" type="button" data-open-verified-result="${esc(row.verifiedResultId)}">Result</button>
        <button class="ghost" type="button" data-open-public-dj="${esc(row.verifiedResultId)}">DJ Profile</button>
        <button class="ghost" type="button" data-open-result-ranking="${esc(row.verifiedResultId)}">View Ranking</button>
        <button class="ghost" type="button" data-open-result-ranking-impact="${esc(row.verifiedResultId)}">View Ranking Impact</button>
      </div>
    </article>`;
  }).join('') : '<div class="verified-result-row"><div class="verified-main"><strong>No public verified results yet.</strong><p style="color:var(--muted);margin:0">Only completed results explicitly marked public appear here.</p></div></div>';

  document.querySelectorAll('[id^="verified-filter-"]').forEach(select => {
    select.onchange = event => {
      const key = event.currentTarget.id.replace('verified-filter-','');
      state.verifiedResultsDiscovery.filters[key] = event.currentTarget.value;
      loadVerifiedResultsDiscovery();
    };
  });
  const sortSelect = document.getElementById('verified-sort');
  if(sortSelect) sortSelect.onchange = event => { state.verifiedResultsDiscovery.sort = event.currentTarget.value; loadVerifiedResultsDiscovery(); };
  const refresh = document.getElementById('verified-refresh');
  if(refresh) refresh.onclick = () => loadVerifiedResultsDiscovery({ forceServer:LIVE_MODE });
  const loadMore = document.getElementById('verified-load-more');
  if(loadMore){
    loadMore.disabled = !state.verifiedResultsDiscovery.pagination?.hasMore;
    loadMore.onclick = () => loadVerifiedResultsDiscovery({ append:true, forceServer:LIVE_MODE });
  }
  list.querySelectorAll('[data-open-verified-result]').forEach(button => {
    button.onclick = event => openVerifiedResultFromDiscovery(event.currentTarget.dataset.openVerifiedResult);
  });
  list.querySelectorAll('[data-open-public-dj]').forEach(button => {
    button.onclick = event => openPublicDjProfileFromDiscovery(event.currentTarget.dataset.openPublicDj);
  });
  list.querySelectorAll('[data-open-result-ranking]').forEach(button => {
    button.onclick = event => openRankingFromVerifiedResult(event.currentTarget.dataset.openResultRanking);
  });
  list.querySelectorAll('[data-open-result-ranking-impact]').forEach(button => {
    button.onclick = event => openPublicProfileRankingImpactFromResult(event.currentTarget.dataset.openResultRankingImpact, { returnTo:'verified-results' });
  });
  renderVerifiedRankingsSummary(state.verifiedResultsDiscovery.rankings, 'verified-ranking-categories');
  renderVerifiedRankingsSummary(state.verifiedResultsDiscovery.rankings, 'rankings-verified-summary');
}

function openVerifiedResultFromDiscovery(verifiedResultId){
  const row = state.verifiedResultsDiscovery.results.find(item => item.verifiedResultId === verifiedResultId);
  if(row && state.verifiedResultsDiscovery.source !== 'server') return renderPublicVerifiedResultProfile(row);
  return loadPublicVerifiedResult(verifiedResultId);
}

function openRankingFromVerifiedResult(verifiedResultId){
  const row = state.verifiedResultsDiscovery.results.find(item => item.verifiedResultId === verifiedResultId);
  const categories = verifiedResultCategories(row);
  state.publicRankings.category = validPublicRankingCategory(categories.find(category => category !== 'ai_only_high_scores') || categories[0] || 'competitive_battles');
  state.publicRankings.filters.country = row && row.profile && row.profile.country || 'all';
  state.publicRankings.filters.belt = row && row.belt || 'all';
  state.publicRankings.selectedDj = row ? publicProfileId(row) : '';
  state.publicRankings.page = 1;
  state.publicRankings.rows = [];
  updateRankingsDeepLink();
  switchView('rankings');
}

function rankingCategoryForResult(result){
  const battle = result && result.battle || {};
  const mode = String(result && (result.modeId || result.type) || battle.modeId || battle.type || '').toLowerCase();
  const reward = result && result.reward || {};
  if(mode.includes('bitcoin') || reward.type === 'bitcoin') return 'bitcoin_battles';
  if(verifiedResultIsProducer(result)) return 'producer_beat_battles';
  if(mode.includes('transition')) return 'transition_battles';
  if(mode.includes('scratch')) return 'scratching_battles';
  if(mode.includes('mix') || mode.includes('song')) return 'mix_battles';
  if(verifiedOpponentCategory(result) === 'ai_only') return 'ai_only_high_scores';
  const categories = verifiedResultCategories(normalizeVerifiedDiscoveryResult(result) || result);
  return validPublicRankingCategory(categories.find(category => category !== 'ai_only_high_scores') || categories[0] || 'competitive_battles');
}

function openPublicProfileRankingImpactFromResult(resultOrId, options = {}){
  const row = typeof resultOrId === 'string'
    ? state.verifiedResultsDiscovery.results.find(item => item.verifiedResultId === resultOrId || item.id === resultOrId)
    : resultOrId;
  const profileIdValue = row && row.profile && row.profile.publicProfileId || publicProfileId(row);
  if(!row || !profileIdValue || !/^dj_[a-z0-9]+$/i.test(String(profileIdValue))){
    return renderPublicDjProfile(null, 404);
  }
  return loadPublicDjProfile(profileIdValue, {
    category:rankingCategoryForResult(row),
    selectedResultId:row.verifiedResultId || row.id || '',
    returnTo:options.returnTo || 'verified-results'
  });
}

function openPrivateRankingImpactFromResult(identifier){
  const result = findBattleHistoryResult(identifier);
  if(!result) return false;
  const category = rankingCategoryForResult(normalizeVerifiedDiscoveryResult({ ...result, visibility:'public', verifiedResultId:result.verifiedResultId || 'vr_localimpact00000000', profile:{ displayName:'You', publicProfileId:'dj_localimpact' } }) || result);
  activeProfileTab = 'progression';
  state.profileRanking.private.selectedResultId = result.verifiedResultId || result.submissionId || historyResultId(result);
  state.profileRanking.private.returnTo = 'battle-history';
  updatePrivateProfileProgressionState(category);
  if(window.location && window.history) window.history.replaceState(null, '', `${window.location.pathname}#profile?tab=progression&category=${encodeURIComponent(category)}&result=${encodeURIComponent(state.profileRanking.private.selectedResultId || '')}&return=battle-history`);
  switchView('profile');
  renderProfile();
  loadPrivateProfileRankingDetail(category, { selectedResultId:state.profileRanking.private.selectedResultId, returnTo:'battle-history' }).catch(err=>console.warn('Private ranking impact load failed', err));
  return true;
}

function profileResultList(rows, label){
  const list = (rows || []).slice(0,8);
  if(!list.length) return `<div class="battle-result-module"><span>${esc(label)}</span><p style="color:var(--muted);margin:0">No public results in this category.</p></div>`;
  return `<div class="battle-result-module"><span>${esc(label)}</span><div class="battle-result-table" style="margin-top:10px">${list.map(row => `<div class="battle-result-row"><b>${esc(row.battle && row.battle.type || row.title || 'Result')}</b><em><button class="ghost small" type="button" data-profile-result-link="${esc(row.verifiedResultId)}">${esc(row.score)} / ${esc(readableComponentName(row.outcome || 'recorded'))}</button> <button class="ghost small" type="button" data-public-result-ranking-impact="${esc(row.verifiedResultId)}">Impact</button></em></div>`).join('')}</div></div>`;
}

function clearDjChallengeState(){
  if(state.djChallenges.pollTimer){
    clearInterval(state.djChallenges.pollTimer);
    state.djChallenges.pollTimer = null;
  }
  state.djChallenges.rows = [];
  state.djChallenges.status = 'idle';
  state.djChallenges.error = '';
  state.djChallenges.stale = false;
  state.djChallenges.counts = { pendingReceived:0, pendingSent:0, pendingTotal:0 };
  renderChallengeCountPill();
}

function clearDjNotificationState(options = {}){
  if(state.djNotifications.pollTimer){
    clearInterval(state.djNotifications.pollTimer);
    state.djNotifications.pollTimer = null;
  }
  state.djNotifications.rows = [];
  state.djNotifications.status = 'idle';
  state.djNotifications.error = '';
  state.djNotifications.stale = false;
  state.djNotifications.counts = { unreadTotal:0, unreadChallenges:0, unreadBattles:0, archived:0 };
  state.djNotifications.pagination = { page:1, limit:10, total:0, hasMore:false, nextPage:null };
  state.djNotifications.inFlight = null;
  state.djNotifications.toastWatermark = 0;
  if(!options.keepSeen) state.djNotifications.seenToastEventIds = new Set();
  renderNotificationCountPill();
  renderNotificationCenter();
}

function clearDjRelationshipState(){
  if(state.djRelationships.pollTimer){
    clearTimeout(state.djRelationships.pollTimer);
    state.djRelationships.pollTimer = null;
  }
  state.djRelationships.status = 'idle';
  state.djRelationships.syncStatus = 'idle';
  state.djRelationships.syncVersion = 0;
  state.djRelationships.syncRequestSeq += 1;
  state.djRelationships.nextPollAt = null;
  state.djRelationships.rows = [];
  state.djRelationships.page = 1;
  state.djRelationships.pagination = { page:1, limit:10, total:0, hasMore:false, nextPage:null };
  state.djRelationships.counts = { following:0, followers:0 };
  state.djRelationships.error = '';
  state.djRelationships.lastSuccessfulAt = null;
  state.djRelationships.requestSeq += 1;
  state.djRelationships.publicSummaries = {};
  state.djRelationships.feed = { ...state.djRelationships.feed, status:'idle', rows:[], page:1, pagination:{ page:1, limit:10, total:0, hasMore:false, nextPage:null }, error:'', lastSuccessfulAt:null, requestSeq:state.djRelationships.feed.requestSeq + 1 };
  state.djRelationships.opponents = { ...state.djRelationships.opponents, status:'idle', rows:[], page:1, pagination:{ page:1, limit:10, total:0, hasMore:false, nextPage:null }, error:'', lastSuccessfulAt:null, requestSeq:state.djRelationships.opponents.requestSeq + 1 };
  state.djRelationships.preferences = { status:'idle', data:null, error:'', configurationRequired:false };
  state.djRelationships.rematch = { source:null, idempotencyKey:'' };
  renderProfileRelationshipPanel();
  renderDjActivityFeed();
  renderOpponentHistoryPanel();
}

function djChallengeApiAvailable(){
  return Boolean(window.DJBattleApi && typeof window.DJBattleApi.apiRequest === 'function');
}

function djNotificationApiAvailable(){
  return Boolean(window.DJBattleApi && typeof window.DJBattleApi.apiRequest === 'function');
}

function djRelationshipApiAvailable(){
  return Boolean(window.DJBattleApi && typeof window.DJBattleApi.apiRequest === 'function' && state.musicLibrarySync.accountId);
}

function challengeProfileId(profile){
  return profile && (profile.publicProfileId || profile.id) || '';
}

function currentPublicChallengeProfileIds(){
  const ids = new Set();
  const collect = source => Object.values(source || {}).forEach(row => {
    if(row && row.publicProfileId) ids.add(String(row.publicProfileId));
    if(row && row.profile && row.profile.publicProfileId) ids.add(String(row.profile.publicProfileId));
  });
  collect(state.publicRankings.personal && state.publicRankings.personal.rankings);
  collect(state.verifiedResultsDiscovery.myRankings);
  return ids;
}

function publicProfileCanChallenge(profile){
  const profileIdValue = challengeProfileId(profile);
  if(!profile || !/^dj_[a-z0-9_-]+$/i.test(String(profileIdValue))) return false;
  if(profile.isSelf || profile.self || profile.owned || profile.viewerIsOwner) return false;
  if(profile.profileVisibility === 'private' || profile.visibility === 'private') return false;
  if(profile.challengeEligibility && profile.challengeEligibility.available === false) return false;
  if(currentPublicChallengeProfileIds().has(String(profileIdValue))) return false;
  return true;
}

function publicChallengeButtonHtml(profile){
  if(!publicProfileCanChallenge(profile)) return '';
  const checking = profile && profile.challengeEligibility && profile.challengeEligibility.status === 'checking';
  return `<button class="primary" type="button" id="challenge-public-dj" ${checking ? 'disabled' : ''}>${checking ? 'Checking...' : 'Challenge DJ'}</button>`;
}

function publicProfileCanFollow(profile){
  const profileIdValue = challengeProfileId(profile);
  if(!profile || !/^dj_[a-z0-9_-]+$/i.test(String(profileIdValue))) return false;
  if(!state.musicLibrarySync.accountId) return false;
  if(profile.isSelf || profile.self || profile.owned || profile.viewerIsOwner) return false;
  if(profile.profileVisibility === 'private' || profile.visibility === 'private') return false;
  return true;
}

function publicFollowButtonHtml(profile){
  if(!publicProfileCanFollow(profile)) return '';
  const profileIdValue = challengeProfileId(profile);
  const summary = state.djRelationships.publicSummaries[profileIdValue] || {};
  const following = summary.following === true;
  const unavailable = summary.unavailable === true || summary.canFollow === false && !following;
  return `<button class="ghost" type="button" id="follow-public-dj" ${unavailable ? 'disabled' : ''}>${following ? 'Following' : unavailable ? 'Unavailable' : 'Follow DJ'}</button>`;
}

function updatePublicFollowButton(profile){
  const button = document.getElementById('follow-public-dj');
  if(!button) return;
  const profileIdValue = challengeProfileId(profile);
  const summary = state.djRelationships.publicSummaries[profileIdValue] || {};
  const following = summary.following === true;
  const unavailable = summary.unavailable === true || summary.canFollow === false && !following;
  button.disabled = Boolean(unavailable);
  button.textContent = following ? 'Following' : unavailable ? 'Unavailable' : 'Follow DJ';
}

async function hydratePublicProfileRelationshipSummary(profile){
  const profileIdValue = challengeProfileId(profile);
  if(!profileIdValue || !djRelationshipApiAvailable()) return { skipped:true };
  const button = document.getElementById('follow-public-dj');
  if(button){ button.disabled = true; button.textContent = 'Checking follow...'; }
  const response = await window.DJBattleApi.apiRequest(`/api/relationships/${encodeURIComponent(profileIdValue)}`);
  if(response.error){
    if(button){ button.disabled = false; button.textContent = 'Follow DJ'; }
    return response;
  }
  const summary = response.data && response.data.relationship;
  if(summary) state.djRelationships.publicSummaries[profileIdValue] = summary;
  updatePublicFollowButton(profile);
  return { summary, response };
}

async function togglePublicProfileFollow(profile){
  const profileIdValue = challengeProfileId(profile);
  if(!profileIdValue || !djRelationshipApiAvailable()) return { skipped:true, error:'Sign in with server access to follow DJs.' };
  const summary = state.djRelationships.publicSummaries[profileIdValue] || {};
  const following = summary.following === true;
  const button = document.getElementById('follow-public-dj');
  if(button){ button.disabled = true; button.textContent = following ? 'Unfollowing...' : 'Following...'; }
  const response = await window.DJBattleApi.apiRequest(`/api/relationships/${encodeURIComponent(profileIdValue)}/follow`, {
    method:following ? 'DELETE' : 'POST',
    body:{ idempotencyKey:stableClientIdempotencyKey(following ? 'dj-unfollow' : 'dj-follow', { accountId:state.musicLibrarySync.accountId || '', profileId:profileIdValue }) }
  });
  if(response.error){
    if(button){ button.disabled = false; button.textContent = following ? 'Following' : 'Follow DJ'; }
    return response;
  }
  state.djRelationships.publicSummaries[profileIdValue] = {
    ...summary,
    profile:{ ...(summary.profile || {}), publicProfileId:profileIdValue },
    following:!following,
    canFollow:true
  };
  updatePublicFollowButton(profile);
  if(activeProfileTab === 'relationships') loadDjRelationships({ preserve:true }).catch(()=>{});
  if(activeProfileTab === 'feed') loadDjActivityFeed({ preserve:true }).catch(()=>{});
  loadDjRelationshipSync({ render:false }).catch(()=>{});
  loadDjNotificationCount().catch(()=>{});
  return { following:!following, response };
}

async function hydratePublicProfileChallengeEligibility(profile){
  const profileIdValue = challengeProfileId(profile);
  if(!profileIdValue || !djChallengeApiAvailable() || !state.musicLibrarySync.accountId) return { skipped:true };
  const button = document.getElementById('challenge-public-dj');
  if(button){ button.disabled = true; button.textContent = 'Checking...'; }
  const response = await window.DJBattleApi.apiRequest(`/api/challenges/eligibility/${encodeURIComponent(profileIdValue)}`);
  if(response.error){
    if(button){ button.disabled = false; button.textContent = 'Challenge DJ'; }
    return response;
  }
  const eligibility = response.data && response.data.eligibility;
  if(!eligibility){
    if(button){ button.disabled = false; button.textContent = 'Challenge DJ'; }
    return { skipped:true, response };
  }
  profile.challengeEligibility = eligibility;
  const current = document.getElementById('challenge-public-dj');
  if(current){
    if(eligibility.available){
      current.disabled = false;
      current.textContent = 'Challenge DJ';
    }else{
      current.disabled = true;
      current.textContent = 'Challenge unavailable';
    }
  }
  return { eligibility, response };
}

function challengeDate(value){
  if(!value) return 'Not set';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(value);
}

function challengeStatusLamp(status){
  if(status === 'converted-to-battle') return 'green';
  if(['declined','cancelled','expired'].includes(status)) return 'red';
  return status === 'pending' ? 'yellow' : '';
}

function challengeProfileSummary(profile){
  const source = profile || {};
  return `${source.displayName || source.name || 'DJ'}${source.country ? ` (${source.country})` : ''}`;
}

function challengeRulesSummary(rules = {}){
  const reward = rules.reward || {};
  const rewardText = reward.type === 'bitcoin'
    ? `Bitcoin metadata ${reward.metadata && reward.metadata.amountSats ? `${reward.metadata.amountSats} sats` : ''} untransferred`
    : `${reward.type || 'standard'} reward`;
  return `${rules.modeLabel || rules.modeId || 'Battle'} / ${rules.genre || 'Open Format'} / ${rules.durationMinutes || 10} min / ${rules.scoringType || 'hybrid'} / ${rewardText}`;
}

function challengeModeOptionsHtml(selected = ''){
  const order = ['transition_battle','scratching_battle','five_song_mix_battle','own_selection_battle','half_hour_mix_battle','full_mix_battle','genre_specific_battle','bitcoin_battle'];
  const modes = BattleModes.listBattleModes()
    .filter(mode => mode.opponentRequirement !== 'none')
    .sort((a, b) => {
      const left = order.indexOf(a.id);
      const right = order.indexOf(b.id);
      return (left === -1 ? 99 : left) - (right === -1 ? 99 : right);
    });
  return modes
    .map(mode => `<option value="${esc(mode.id)}" ${mode.id === selected ? 'selected' : ''}>${esc(battleModeDisplayLabel(mode.id, mode.label))}${mode.premiumRequired ? ' (Premium)' : ''}</option>`)
    .join('');
}

function genreOptionsHtml(selected = 'Open Format'){
  return GENRES.map(genre => `<option value="${esc(genre)}" ${genre === selected ? 'selected' : ''}>${esc(genre)}</option>`).join('');
}

function syncBattleGenreControl(prefix, modeId){
  const genre = document.getElementById(`${prefix}-genre`);
  if(!genre) return;
  const fixedGenre = battleModeFixedGenre(modeId);
  if(fixedGenre){
    genre.value = fixedGenre;
    genre.disabled = true;
    genre.title = `${battleModeDisplayLabel(modeId)} uses ${fixedGenre}.`;
  }else{
    genre.disabled = false;
    genre.title = '';
  }
}

function challengeDurationOptionsHtml(modeId, selected){
  const mode = BattleModes.getBattleMode(modeId) || BattleModes.getBattleMode('transition_battle');
  return mode.allowedDurations.map(minutes => `<option value="${minutes}" ${Number(selected || mode.defaultDurationMinutes) === Number(minutes) ? 'selected' : ''}>${minutes} minutes</option>`).join('');
}

function challengeScoringOptionsHtml(selected = 'hybrid'){
  return ['hybrid','measured_rule_based','rule_based','ai_assisted','human_voted']
    .map(value => `<option value="${value}" ${value === selected ? 'selected' : ''}>${esc(readableComponentName(value))}</option>`)
    .join('');
}

function challengeSetupBattleDraft(profile){
  const modeId = document.getElementById('challenge-mode')?.value || 'own_selection_battle';
  const mode = BattleModes.getBattleMode(modeId) || BattleModes.getBattleMode('transition_battle');
  const ownSelection = document.getElementById('challenge-own-selection')?.checked && BATTLE_PREP_PERSONAL_METHODS.has(mode.trackSelectionMethod);
  const reward = { type:mode.rewardType || 'xp', metadata:{ ...(mode.rewardMetadata || {}) } };
  if(reward.type === 'bitcoin'){
    reward.metadata = { ...reward.metadata, custody:'external_pending', walletConnected:false, amountSats:Number(document.getElementById('challenge-bitcoin-sats')?.value || 0) };
  }
  return {
    modeId,
    title:`${document.getElementById('profile-name')?.textContent || 'DJ'} vs ${profile && (profile.displayName || profile.name) || 'DJ'}`,
    genre:battleModeFixedGenre(modeId) || document.getElementById('challenge-genre')?.value || mode.defaultGenre,
    durationMinutes:Number(document.getElementById('challenge-duration')?.value || mode.defaultDurationMinutes),
    trackSelectionMethod:ownSelection ? 'own_selection' : mode.trackSelectionMethod,
    trackCount:mode.trackCount,
    minimumTrackCount:mode.minimumTrackCount,
    opponentRequirement:'required',
    reward,
    scoringType:document.getElementById('challenge-scoring')?.value || 'hybrid'
  };
}

function renderChallengeSetupValidation(profile){
  const modeId = document.getElementById('challenge-mode')?.value || 'own_selection_battle';
  const mode = BattleModes.getBattleMode(modeId) || BattleModes.getBattleMode('transition_battle');
  syncBattleGenreControl('challenge', modeId);
  const duration = document.getElementById('challenge-duration');
  if(duration && !Array.from(duration.options).some(option => Number(option.value) === Number(duration.value))){
    duration.innerHTML = challengeDurationOptionsHtml(modeId, mode.defaultDurationMinutes);
  }
  const own = document.getElementById('challenge-own-selection');
  if(own){
    own.disabled = !BATTLE_PREP_PERSONAL_METHODS.has(mode.trackSelectionMethod);
    if(own.disabled) own.checked = false;
  }
  const draft = challengeSetupBattleDraft(profile);
  const selectedCrate = document.getElementById('challenge-prep-crate')?.value || '';
  const validation = validateBattlePrepCrateForBattle(selectedCrate, draft);
  const required = BATTLE_PREP_PERSONAL_METHODS.has(draft.trackSelectionMethod);
  if(required && !selectedCrate){
    validation.ready = false;
    validation.optional = false;
    validation.blockers = ['A synced Battle Prep crate is required for this challenge mode.'];
    validation.summary = 'Battle Prep crate required.';
  }
  const target = document.getElementById('challenge-prep-status');
  if(target) target.innerHTML = battlePrepEntryValidationHtml(validation);
  return validation;
}

function openChallengeSetup(profile){
  const profileIdValue = challengeProfileId(profile);
  if(!publicProfileCanChallenge(profile)) return null;
  const mode = BattleModes.getBattleMode('own_selection_battle') || BattleModes.listBattleModes()[0];
  const setupProfile = { ...profile, challengeOriginContext:challengeOriginContextForProfile(profile, profile && profile.challengeOrigin || 'public_profile') };
  setupProfile.challengeOrigin = setupProfile.challengeOriginContext.source;
  state.djChallenges.setup = {
    profile:setupProfile,
    originContext:setupProfile.challengeOriginContext,
    idempotencyKey:stableClientIdempotencyKey('profile-challenge', {
      accountId:state.musicLibrarySync.accountId || '',
      profileId:profileIdValue,
      origin:setupProfile.challengeOriginContext.source,
      originRef:setupProfile.challengeOriginContext.communityPostId || setupProfile.challengeOriginContext.rankingCategory || '',
      openedAt:Date.now()
    })
  };
  openModal(`<span class="eyebrow accent">DJ CHALLENGE</span><h3>Challenge ${esc(setupProfile.displayName || setupProfile.name || 'DJ')}</h3>
    <div class="challenge-setup-panel">
      <div class="challenge-context-grid">
        <div class="battle-result-module"><span>Recipient</span><strong>${esc(challengeProfileSummary(setupProfile))}</strong><p>${esc(setupProfile.belt || 'Unranked')} / ${esc(setupProfile.rating == null ? 'rating pending' : `${setupProfile.rating} rating`)}</p></div>
        <div class="battle-result-module"><span>Origin</span><strong>${esc(challengeOriginTitle(setupProfile))}</strong><p>${esc(challengeOriginDetail(setupProfile))}</p></div>
      </div>
      <div class="form-grid" style="margin-top:12px">
        <label>Battle mode<select id="challenge-mode">${challengeModeOptionsHtml(mode.id)}</select></label>
        <label>Genre<select id="challenge-genre">${genreOptionsHtml(battleModeFixedGenre(mode.id) || mode.defaultGenre)}</select></label>
        <label>Duration<select id="challenge-duration">${challengeDurationOptionsHtml(mode.id, mode.defaultDurationMinutes)}</select></label>
        <label>Scoring<select id="challenge-scoring">${challengeScoringOptionsHtml('hybrid')}</select></label>
        <label>Battle Prep crate<select id="challenge-prep-crate">${battlePrepCrateSelectHtml()}</select></label>
        <label>Bitcoin sats<input id="challenge-bitcoin-sats" type="number" min="0" step="1" placeholder="Metadata only"></label>
        <label class="toggle-row">Own-selection tracks <input id="challenge-own-selection" type="checkbox" ${BATTLE_PREP_PERSONAL_METHODS.has(mode.trackSelectionMethod) ? 'checked' : ''}></label>
      </div>
      <div id="challenge-prep-status" class="battle-prep-entry-status">${battlePrepEntryValidationHtml(null)}</div>
      <div id="challenge-send-error" class="challenge-meta" style="color:#ff8f8f;margin-top:8px"></div>
    </div>
    <div class="modal-actions"><button class="ghost" value="cancel">Close</button><button class="primary" type="button" id="send-dj-challenge">Send Challenge</button></div>`);
  setTimeout(() => {
    const rerenderDurations = () => {
      const modeId = document.getElementById('challenge-mode')?.value || mode.id;
      const cfg = BattleModes.getBattleMode(modeId) || mode;
      const duration = document.getElementById('challenge-duration');
      if(duration) duration.innerHTML = challengeDurationOptionsHtml(modeId, cfg.defaultDurationMinutes);
      syncBattleGenreControl('challenge', modeId);
      renderChallengeSetupValidation(setupProfile);
    };
    ['challenge-mode','challenge-genre','challenge-duration','challenge-scoring','challenge-prep-crate','challenge-own-selection','challenge-bitcoin-sats'].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.onchange = id === 'challenge-mode' ? rerenderDurations : () => renderChallengeSetupValidation(setupProfile);
    });
    renderChallengeSetupValidation(setupProfile);
    const send = document.getElementById('send-dj-challenge');
    if(send) send.onclick = () => sendDjChallengeFromModal(setupProfile);
  },0);
  return setupProfile;
}

async function sendDjChallengeFromModal(profile = state.djChallenges.setup.profile){
  const err = document.getElementById('challenge-send-error');
  if(!djChallengeApiAvailable()){
    if(err) err.textContent = 'Sign in and connect the server before sending a DJ challenge.';
    return { skipped:true, reason:'api_unavailable' };
  }
  const draft = challengeSetupBattleDraft(profile);
  const validation = renderChallengeSetupValidation(profile);
  const selectedCrate = document.getElementById('challenge-prep-crate')?.value || '';
  if(!validation.ready){
    if(err) err.textContent = (validation.blockers || []).join(' ') || 'Battle Prep crate does not pass these rules.';
    return { error:err && err.textContent };
  }
  if(selectedCrate && !serverBackedBattlePrepCrate(selectedCrate)){
    if(err) err.textContent = 'Choose a synced server-backed Battle Prep crate for DJ challenges.';
    return { error:err && err.textContent };
  }
  if(BATTLE_PREP_PERSONAL_METHODS.has(draft.trackSelectionMethod) && !selectedCrate){
    if(err) err.textContent = 'A synced Battle Prep crate is required for own-selection challenges.';
    return { error:err && err.textContent };
  }
  const setup = state.djChallenges.setup || {};
  if(setup.sending) return { skipped:true, reason:'sending' };
  setup.sending = true;
  state.djChallenges.setup = setup;
  const sendButton = document.getElementById('send-dj-challenge');
  if(sendButton){ sendButton.disabled = true; sendButton.textContent = 'Sending...'; }
  if(err) err.textContent = 'Sending protected server challenge...';
  const originPayload = challengeOriginContextForProfile(profile, profile && profile.challengeOrigin || 'public_profile', setup.originContext);
  originPayload.publicProfileId = challengeProfileId(profile);
  originPayload.rankingCategory = originPayload.rankingCategory || state.profileRanking.public.category || 'competitive_battles';
  originPayload.source = originPayload.source || 'public_profile';
  const body = {
    recipientPublicProfileId:challengeProfileId(profile),
    challengerCrateId:selectedCrate ? rawServerId(selectedCrate) : null,
    idempotencyKey:setup.idempotencyKey,
    origin:originPayload,
    rules:{
      modeId:draft.modeId,
      title:draft.title,
      genre:draft.genre,
      durationMinutes:draft.durationMinutes,
      scoringType:draft.scoringType,
      ownSelection:BATTLE_PREP_PERSONAL_METHODS.has(draft.trackSelectionMethod),
      trackSelectionMethod:draft.trackSelectionMethod,
      reward:draft.reward,
      isPremium:Boolean(state.premium)
    }
  };
  try{
    const response = await window.DJBattleApi.apiRequest('/api/challenges', { method:'POST', body });
    if(response.error){
      if(err) err.textContent = response.error;
      if(sendButton){ sendButton.disabled = false; sendButton.textContent = 'Send Challenge'; }
      return response;
    }
    const challenge = response.data && response.data.challenge;
    if(err) err.textContent = 'Challenge sent. It will appear in your sent list until accepted, declined, cancelled or expired.';
    if(sendButton){ sendButton.disabled = true; sendButton.textContent = 'Challenge Sent'; }
    loadDjChallengeCount().catch(()=>{});
    loadDjNotificationCount().catch(()=>{});
    if(activeProfileTab === 'challenges') loadDjChallengeInbox({ preserve:true }).catch(()=>{});
    if(document.getElementById('notifications')?.classList.contains('active')) loadDjNotifications({ joinInFlight:false }).catch(()=>{});
    return { challenge, response };
  }catch(error){
    const message = error && error.message || 'DJ challenge request failed.';
    if(err) err.textContent = message;
    if(sendButton){ sendButton.disabled = false; sendButton.textContent = 'Send Challenge'; }
    return { error:message };
  }finally{
    setup.sending = false;
  }
}

function relationshipDate(value){
  if(!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(value);
}

function relationshipLamp(status){
  if(['synced','active','public','win'].includes(status)) return 'green';
  if(['failed','blocked','loss','conflict'].includes(status)) return 'red';
  return 'yellow';
}

function relationshipProfileSummary(profile = {}){
  return `${profile.displayName || profile.name || 'DJ'}${profile.country ? ` (${profile.country})` : ''}`;
}

function dedupeRelationshipRows(rows){
  const seen = new Set();
  return (rows || []).filter(row => {
    const key = String(row.id || row.publicProfileId || row.sourceId || '');
    if(!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function relationshipQuery(options = {}){
  const params = new URLSearchParams();
  params.set('direction', options.direction || state.djRelationships.filters.direction || 'following');
  params.set('page', String(options.page || state.djRelationships.page || 1));
  params.set('limit', String(options.limit || state.djRelationships.pageSize || 10));
  return params.toString();
}

async function loadDjRelationships(options = {}){
  if(!djRelationshipApiAvailable()){
    state.djRelationships.status = 'offline';
    state.djRelationships.error = 'Sign in with server access to load private DJ relationships.';
    renderProfileRelationshipPanel();
    return { skipped:true };
  }
  const seq = ++state.djRelationships.requestSeq;
  const append = options.append === true;
  const page = append ? state.djRelationships.pagination.nextPage || state.djRelationships.page + 1 : options.page || 1;
  state.djRelationships.status = state.djRelationships.rows.length ? 'reconnecting' : 'loading';
  state.djRelationships.error = '';
  renderProfileRelationshipPanel();
  const response = await window.DJBattleApi.apiRequest(`/api/relationships?${relationshipQuery({ ...options, page })}`);
  if(seq !== state.djRelationships.requestSeq) return { stale:true };
  if(response.error){
    state.djRelationships.status = state.djRelationships.rows.length ? 'stale' : 'failed';
    state.djRelationships.error = response.error;
    renderProfileRelationshipPanel();
    return response;
  }
  const incoming = response.data && response.data.relationships || [];
  state.djRelationships.rows = append ? dedupeRelationshipRows([...state.djRelationships.rows, ...incoming]) : incoming;
  state.djRelationships.counts = response.data && response.data.counts || state.djRelationships.counts;
  state.djRelationships.pagination = response.data && response.data.pagination || state.djRelationships.pagination;
  state.djRelationships.page = state.djRelationships.pagination.page || page;
  state.djRelationships.status = 'synced';
  state.djRelationships.lastSuccessfulAt = new Date().toISOString();
  renderProfileRelationshipPanel();
  return { relationships:state.djRelationships.rows, response };
}

function relationshipSyncQuery(options = {}){
  const params = new URLSearchParams();
  params.set('sinceVersion', String(options.sinceVersion ?? state.djRelationships.syncVersion ?? 0));
  params.set('relationshipLimit', String(options.relationshipLimit || state.djRelationships.pageSize || 10));
  params.set('feedLimit', String(options.feedLimit || state.djRelationships.feed.pageSize || 10));
  params.set('opponentLimit', String(options.opponentLimit || state.djRelationships.opponents.pageSize || 10));
  params.set('direction', options.direction || state.djRelationships.filters.direction || 'following');
  return params.toString();
}

function applyRelationshipSyncPayload(sync = {}){
  const incomingVersion = Number(sync.syncVersion || sync.eventVersion || 0);
  const currentVersion = Number(state.djRelationships.syncVersion || 0);
  if(incomingVersion && currentVersion && incomingVersion < currentVersion) return { stale:true, reason:'older_event_version' };
  state.djRelationships.syncVersion = Math.max(currentVersion, incomingVersion || currentVersion);
  state.djRelationships.syncStatus = 'synced';
  state.djRelationships.status = 'synced';
  state.djRelationships.error = '';
  state.djRelationships.lastSuccessfulAt = sync.generatedAt || new Date().toISOString();
  if(sync.counts) state.djRelationships.counts = sync.counts;
  if(Array.isArray(sync.relationships)){
    state.djRelationships.rows = dedupeRelationshipRows(sync.relationships);
    state.djRelationships.pagination = sync.relationshipPagination || state.djRelationships.pagination;
  }
  if(Array.isArray(sync.events)){
    state.djRelationships.feed.rows = dedupeRelationshipRows(sync.events);
    state.djRelationships.feed.pagination = sync.feedPagination || state.djRelationships.feed.pagination;
    state.djRelationships.feed.status = 'synced';
    state.djRelationships.feed.error = '';
    state.djRelationships.feed.lastSuccessfulAt = state.djRelationships.lastSuccessfulAt;
  }
  if(Array.isArray(sync.opponents)){
    state.djRelationships.opponents.rows = dedupeRelationshipRows(sync.opponents);
    state.djRelationships.opponents.pagination = sync.opponentPagination || state.djRelationships.opponents.pagination;
    state.djRelationships.opponents.status = 'synced';
    state.djRelationships.opponents.error = '';
    state.djRelationships.opponents.lastSuccessfulAt = state.djRelationships.lastSuccessfulAt;
  }
  if(sync.preferences){
    state.djRelationships.preferences.data = sync.preferences;
    state.djRelationships.preferences.status = 'synced';
    state.djRelationships.preferences.configurationRequired = Boolean(sync.configurationRequired);
    state.djRelationships.preferences.error = '';
  }
  renderProfileRelationshipPanel();
  renderDjActivityFeed();
  renderOpponentHistoryPanel();
  renderRankingsPage();
  return { synced:true, syncVersion:state.djRelationships.syncVersion };
}

async function loadDjRelationshipSync(options = {}){
  if(!djRelationshipApiAvailable()){
    state.djRelationships.syncStatus = 'offline';
    state.djRelationships.error = 'Sign in with server access to sync DJ relationships.';
    if(options.render !== false){
      renderProfileRelationshipPanel();
      renderDjActivityFeed();
      renderOpponentHistoryPanel();
    }
    return { skipped:true, reason:'api_unavailable' };
  }
  const seq = ++state.djRelationships.syncRequestSeq;
  state.djRelationships.syncStatus = 'syncing';
  if(options.render !== false) renderProfileRelationshipPanel();
  const response = await window.DJBattleApi.apiRequest(`/api/relationships/sync?${relationshipSyncQuery(options)}`);
  if(seq !== state.djRelationships.syncRequestSeq) return { stale:true, reason:'out_of_order' };
  if(response.error){
    state.djRelationships.syncStatus = state.djRelationships.syncVersion ? 'stale' : 'failed';
    state.djRelationships.error = response.error;
    if(options.render !== false){
      renderProfileRelationshipPanel();
      renderDjActivityFeed();
      renderOpponentHistoryPanel();
    }
    return response;
  }
  const applied = applyRelationshipSyncPayload(response.data && (response.data.sync || response.data) || {});
  return { ...applied, response };
}

function scheduleDjRelationshipPolling(intervalMs = 30000){
  if(state.djRelationships.pollTimer) clearTimeout(state.djRelationships.pollTimer);
  state.djRelationships.pollTimer = null;
  if(!djRelationshipApiAvailable() || livePollingDisabledForTest()) return 0;
  const tick = async () => {
    const hidden = document.visibilityState === 'hidden';
    if(!hidden) await loadDjRelationshipSync({ render:document.getElementById('profile')?.classList.contains('active') }).catch(()=>{});
    const delay = hidden ? Math.max(intervalMs * 2, 90000) : intervalMs;
    state.djRelationships.nextPollAt = new Date(Date.now() + delay).toISOString();
    state.djRelationships.pollTimer = setTimeout(tick, delay);
    if(state.djRelationships.pollTimer && typeof state.djRelationships.pollTimer.unref === 'function') state.djRelationships.pollTimer.unref();
  };
  state.djRelationships.nextPollAt = new Date(Date.now() + intervalMs).toISOString();
  state.djRelationships.pollTimer = setTimeout(tick, intervalMs);
  if(state.djRelationships.pollTimer && typeof state.djRelationships.pollTimer.unref === 'function') state.djRelationships.pollTimer.unref();
  return intervalMs;
}

function relationshipRowHtml(row){
  const profile = row.profile || row;
  return `<article class="challenge-row relationship-row" data-relationship-row="${esc(row.id || row.publicProfileId)}">
    <div><span class="challenge-lamp green"></span><strong>${esc(profile.displayName || profile.name || 'DJ')}</strong><div class="challenge-meta">${esc(profile.country || 'Country unavailable')} / ${esc(profile.belt || 'Unranked')} / ${esc(profile.rating == null ? 'rating pending' : `${profile.rating} rating`)}</div></div>
    <div><span class="notification-destination">${esc(readableComponentName(row.direction || 'relationship'))}</span><div class="challenge-meta">Since ${esc(relationshipDate(row.followedAt || row.createdAt))}. Public profile only; private lists and auth IDs stay hidden.</div></div>
    <div class="challenge-actions">${profile.publicProfileId ? `<button class="ghost small" type="button" data-open-relationship-profile="${esc(profile.publicProfileId)}">Profile</button><button class="primary small" type="button" data-relationship-challenge="${esc(profile.publicProfileId)}">Challenge</button>` : ''}</div>
  </article>`;
}

function renderProfileRelationshipPanel(){
  if(activeProfileTab !== 'relationships') return;
  const target = document.getElementById('profile-media');
  if(!target) return;
  target.className = 'challenge-console relationship-console';
  const status = state.djRelationships.status || 'idle';
  const filters = state.djRelationships.filters || {};
  const statusLine = state.djRelationships.error || (status === 'synced' ? `Synced ${relationshipDate(state.djRelationships.lastSuccessfulAt)}` : status === 'idle' ? 'Private follows and followers load from the protected relationship contract.' : readableComponentName(status));
  const rows = state.djRelationships.rows || [];
  const body = rows.length
    ? rows.map(relationshipRowHtml).join('')
    : '<div class="challenge-row relationship-row"><div><strong>No relationships loaded</strong><div class="challenge-meta">Follow DJs from public profiles to build a private relationship list and activity feed.</div></div></div>';
  target.innerHTML = `<div class="challenge-status-strip">
    <div><span class="challenge-lamp ${relationshipLamp(status)}"></span><strong>${esc(readableComponentName(status))}</strong><div class="challenge-meta">${esc(statusLine)}</div></div>
    <div class="challenge-actions"><button class="ghost small" id="relationship-refresh" type="button">Refresh</button><button class="ghost small" id="relationship-load-more" type="button" ${state.djRelationships.pagination.hasMore ? '' : 'disabled'}>Load More</button></div>
  </div>
  <div class="challenge-filters">
    <label>Direction<select id="relationship-direction">${['following','followers','all'].map(value => `<option value="${value}" ${filters.direction === value ? 'selected' : ''}>${esc(readableComponentName(value))}</option>`).join('')}</select></label>
    <div class="relationship-counts"><span>Following <strong>${esc(state.djRelationships.counts.following || 0)}</strong></span><span>Followers <strong>${esc(state.djRelationships.counts.followers || 0)}</strong></span></div>
  </div>${body}`;
  document.getElementById('relationship-refresh')?.addEventListener('click', () => loadDjRelationships().catch(err=>console.warn('Relationship refresh failed', err)));
  document.getElementById('relationship-load-more')?.addEventListener('click', () => loadDjRelationships({ append:true }).catch(err=>console.warn('Relationship pagination failed', err)));
  document.getElementById('relationship-direction')?.addEventListener('change', event => {
    state.djRelationships.filters.direction = event.currentTarget.value || 'following';
    state.djRelationships.rows = [];
    loadDjRelationships({ page:1 }).catch(err=>console.warn('Relationship filter failed', err));
  });
  target.querySelectorAll('[data-open-relationship-profile]').forEach(button => {
    button.onclick = event => loadPublicDjProfile(event.currentTarget.dataset.openRelationshipProfile);
  });
  target.querySelectorAll('[data-relationship-challenge]').forEach(button => {
    button.onclick = event => openProtectedChallengeSetupFromPublicId(event.currentTarget.dataset.relationshipChallenge, 'relationship_list').catch(err=>console.warn('Relationship challenge failed', err));
  });
}

function feedQuery(options = {}){
  const params = new URLSearchParams();
  params.set('page', String(options.page || state.djRelationships.feed.page || 1));
  params.set('limit', String(options.limit || state.djRelationships.feed.pageSize || 10));
  return params.toString();
}

async function loadDjActivityFeed(options = {}){
  const feed = state.djRelationships.feed;
  if(!djRelationshipApiAvailable()){
    feed.status = 'offline';
    feed.error = 'Sign in with server access to load followed DJ activity.';
    renderDjActivityFeed();
    return { skipped:true };
  }
  const seq = ++feed.requestSeq;
  const append = options.append === true;
  const page = append ? feed.pagination.nextPage || feed.page + 1 : options.page || 1;
  feed.status = feed.rows.length ? 'reconnecting' : 'loading';
  feed.error = '';
  renderDjActivityFeed();
  const response = await window.DJBattleApi.apiRequest(`/api/activityFeed?${feedQuery({ ...options, page })}`);
  if(seq !== feed.requestSeq) return { stale:true };
  if(response.error){
    feed.status = feed.rows.length ? 'stale' : 'failed';
    feed.error = response.error;
    renderDjActivityFeed();
    return response;
  }
  const incoming = response.data && response.data.events || [];
  feed.rows = append ? dedupeRelationshipRows([...feed.rows, ...incoming]) : incoming;
  feed.pagination = response.data && response.data.pagination || feed.pagination;
  feed.page = feed.pagination.page || page;
  feed.status = 'synced';
  feed.lastSuccessfulAt = new Date().toISOString();
  renderDjActivityFeed();
  return { events:feed.rows, response };
}

function activityEventHtml(event){
  const actor = event.actor || {};
  const result = event.result || {};
  const reward = result.reward || {};
  const bitcoin = reward.type === 'bitcoin' ? ' / Bitcoin metadata untransferred' : '';
  const rankingCategory = result.rankingCategory || rankingCategoryForResult(result);
  return `<article class="challenge-row relationship-row" data-feed-event="${esc(event.id || event.sourceId)}">
    <div><span class="challenge-lamp ${relationshipLamp(event.sourceType === 'verified_result' ? 'synced' : 'idle')}"></span><strong>${esc(event.title || 'DJ activity')}</strong><div class="challenge-meta">${esc(relationshipProfileSummary(actor))} / ${esc(relationshipDate(event.createdAt))}</div></div>
    <div><span class="notification-destination">${esc(readableComponentName(event.sourceType || 'activity'))}</span><div class="challenge-meta">${esc(event.summary || 'Public activity from followed DJs.')}${esc(bitcoin)}</div></div>
    <div class="challenge-actions">
      ${actor.publicProfileId ? `<button class="ghost small" type="button" data-feed-profile="${esc(actor.publicProfileId)}">Profile</button>` : ''}
      ${result.verifiedResultId ? `<button class="ghost small" type="button" data-feed-result="${esc(result.verifiedResultId)}">Result</button>` : ''}
      ${rankingCategory ? `<button class="ghost small" type="button" data-feed-ranking="${esc(rankingCategory)}">Ranking</button>` : ''}
      ${actor.publicProfileId ? `<button class="primary small" type="button" data-feed-challenge="${esc(actor.publicProfileId)}">Challenge</button>` : ''}
    </div>
  </article>`;
}

function renderDjActivityFeed(){
  if(activeProfileTab !== 'feed') return;
  const target = document.getElementById('profile-media');
  if(!target) return;
  const feed = state.djRelationships.feed;
  target.className = 'challenge-console relationship-console';
  const statusLine = feed.error || (feed.status === 'synced' ? `Synced ${relationshipDate(feed.lastSuccessfulAt)}` : feed.status === 'idle' ? 'Followed DJs public battles and public relationship activity appear here.' : readableComponentName(feed.status));
  const body = feed.rows.length
    ? feed.rows.map(activityEventHtml).join('')
    : '<div class="challenge-row relationship-row"><div><strong>No feed events</strong><div class="challenge-meta">Only public, approved events from DJs you follow are eligible for this feed.</div></div></div>';
  target.innerHTML = `<div class="challenge-status-strip">
    <div><span class="challenge-lamp ${relationshipLamp(feed.status)}"></span><strong>${esc(readableComponentName(feed.status || 'idle'))}</strong><div class="challenge-meta">${esc(statusLine)}</div></div>
    <div class="challenge-actions"><button class="ghost small" id="feed-refresh" type="button">Refresh</button><button class="ghost small" id="feed-load-more" type="button" ${feed.pagination.hasMore ? '' : 'disabled'}>Load More</button></div>
  </div>${body}`;
  document.getElementById('feed-refresh')?.addEventListener('click', () => loadDjActivityFeed().catch(err=>console.warn('Activity feed refresh failed', err)));
  document.getElementById('feed-load-more')?.addEventListener('click', () => loadDjActivityFeed({ append:true }).catch(err=>console.warn('Activity feed pagination failed', err)));
  target.querySelectorAll('[data-feed-profile]').forEach(button => {
    button.onclick = event => loadPublicDjProfile(event.currentTarget.dataset.feedProfile);
  });
  target.querySelectorAll('[data-feed-result]').forEach(button => {
    button.onclick = event => loadPublicVerifiedResult(event.currentTarget.dataset.feedResult);
  });
  target.querySelectorAll('[data-feed-ranking]').forEach(button => {
    button.onclick = event => {
      state.publicRankings.category = validPublicRankingCategory(event.currentTarget.dataset.feedRanking);
      state.publicRankings.page = 1;
      state.publicRankings.rows = [];
      updateRankingsDeepLink();
      switchView('rankings');
    };
  });
  target.querySelectorAll('[data-feed-challenge]').forEach(button => {
    button.onclick = event => openProtectedChallengeSetupFromPublicId(event.currentTarget.dataset.feedChallenge, 'activity_feed').catch(err=>console.warn('Feed challenge failed', err));
  });
}

function opponentQuery(options = {}){
  const params = new URLSearchParams();
  params.set('page', String(options.page || state.djRelationships.opponents.page || 1));
  params.set('limit', String(options.limit || state.djRelationships.opponents.pageSize || 10));
  if(options.opponentPublicProfileId) params.set('opponentPublicProfileId', options.opponentPublicProfileId);
  return params.toString();
}

async function loadOpponentHistory(options = {}){
  const opponents = state.djRelationships.opponents;
  if(!djRelationshipApiAvailable()){
    opponents.status = 'offline';
    opponents.error = 'Sign in with server access to load private opponent history.';
    renderOpponentHistoryPanel();
    return { skipped:true };
  }
  const seq = ++opponents.requestSeq;
  const append = options.append === true;
  const page = append ? opponents.pagination.nextPage || opponents.page + 1 : options.page || 1;
  opponents.status = opponents.rows.length ? 'reconnecting' : 'loading';
  opponents.error = '';
  renderOpponentHistoryPanel();
  const response = await window.DJBattleApi.apiRequest(`/api/opponentHistory?${opponentQuery({ ...options, page })}`);
  if(seq !== opponents.requestSeq) return { stale:true };
  if(response.error){
    opponents.status = opponents.rows.length ? 'stale' : 'failed';
    opponents.error = response.error;
    renderOpponentHistoryPanel();
    return response;
  }
  const incoming = response.data && response.data.opponents || [];
  opponents.rows = append ? dedupeRelationshipRows([...opponents.rows, ...incoming]) : incoming;
  opponents.pagination = response.data && response.data.pagination || opponents.pagination;
  opponents.page = opponents.pagination.page || page;
  opponents.status = 'synced';
  opponents.lastSuccessfulAt = new Date().toISOString();
  renderOpponentHistoryPanel();
  return { opponents:opponents.rows, response };
}

function opponentRowHtml(row){
  const opponent = row.opponent || {};
  const movement = row.progression && row.progression.ratingDelta;
  const reward = row.suggestedRules && row.suggestedRules.reward || {};
  const bitcoin = reward.type === 'bitcoin' ? ' / Bitcoin metadata untransferred' : '';
  return `<article class="challenge-row relationship-row" data-opponent-row="${esc(row.id)}">
    <div><span class="challenge-lamp ${relationshipLamp(row.outcome)}"></span><strong>${esc(opponent.displayName || opponent.name || 'Opponent DJ')}</strong><div class="challenge-meta">${esc(opponent.country || 'Country unavailable')} / ${esc(opponent.belt || 'Unranked')} / ${esc(relationshipDate(row.completedAt))}</div></div>
    <div><span class="challenge-lcd">${esc(row.score == null ? 'N/A' : row.score)}</span><div class="challenge-meta">${esc(row.battle && (row.battle.type || row.battle.modeId) || 'Battle')} / ${esc(readableComponentName(row.outcome || 'recorded'))} / Rating ${movement == null ? 'pending' : movement >= 0 ? `+${movement}` : movement}${esc(bitcoin)}</div></div>
    <div class="challenge-actions">
      ${row.verifiedResultId ? `<button class="ghost small" type="button" data-opponent-result="${esc(row.verifiedResultId)}">Result</button>` : ''}
      ${opponent.publicProfileId ? `<button class="ghost small" type="button" data-opponent-profile="${esc(opponent.publicProfileId)}">Profile</button>` : ''}
      ${opponent.publicProfileId ? `<button class="ghost small" type="button" data-opponent-challenge="${esc(opponent.publicProfileId)}">Challenge</button>` : ''}
      ${row.rematchEligible ? `<button class="primary small" type="button" data-opponent-rematch="${esc(row.id)}">Rematch</button>` : ''}
    </div>
  </article>`;
}

function renderOpponentHistoryPanel(){
  if(activeProfileTab !== 'opponents') return;
  const target = document.getElementById('profile-media');
  if(!target) return;
  const opponents = state.djRelationships.opponents;
  target.className = 'challenge-console relationship-console';
  const statusLine = opponents.error || (opponents.status === 'synced' ? `Synced ${relationshipDate(opponents.lastSuccessfulAt)}` : opponents.status === 'idle' ? 'Private opponent history loads from completed server battle results.' : readableComponentName(opponents.status));
  const body = opponents.rows.length
    ? opponents.rows.map(opponentRowHtml).join('')
    : '<div class="challenge-row relationship-row"><div><strong>No opponent history loaded</strong><div class="challenge-meta">Completed DJ-vs-DJ results will appear here with rematch controls when eligible.</div></div></div>';
  target.innerHTML = `<div class="challenge-status-strip">
    <div><span class="challenge-lamp ${relationshipLamp(opponents.status)}"></span><strong>${esc(readableComponentName(opponents.status || 'idle'))}</strong><div class="challenge-meta">${esc(statusLine)}</div></div>
    <div class="challenge-actions"><button class="ghost small" id="opponent-refresh" type="button">Refresh</button><button class="ghost small" id="opponent-load-more" type="button" ${opponents.pagination.hasMore ? '' : 'disabled'}>Load More</button></div>
  </div>${body}`;
  document.getElementById('opponent-refresh')?.addEventListener('click', () => loadOpponentHistory().catch(err=>console.warn('Opponent history refresh failed', err)));
  document.getElementById('opponent-load-more')?.addEventListener('click', () => loadOpponentHistory({ append:true }).catch(err=>console.warn('Opponent history pagination failed', err)));
  target.querySelectorAll('[data-opponent-profile]').forEach(button => {
    button.onclick = event => loadPublicDjProfile(event.currentTarget.dataset.opponentProfile);
  });
  target.querySelectorAll('[data-opponent-result]').forEach(button => {
    button.onclick = event => loadPublicVerifiedResult(event.currentTarget.dataset.opponentResult);
  });
  target.querySelectorAll('[data-opponent-rematch]').forEach(button => {
    button.onclick = event => openRematchSetupFromOpponent(event.currentTarget.dataset.opponentRematch);
  });
  target.querySelectorAll('[data-opponent-challenge]').forEach(button => {
    button.onclick = event => openProtectedChallengeSetupFromPublicId(event.currentTarget.dataset.opponentChallenge, 'opponent_history').catch(err=>console.warn('Opponent challenge failed', err));
  });
}

function historyRematchProfileId(result){
  const opponent = result && result.opponent || {};
  const details = result && result.details || {};
  const detailOpponent = details.opponent || {};
  return opponent.publicProfileId || opponent.profileId || result.opponentPublicProfileId || detailOpponent.publicProfileId || '';
}

function historyRematchRules(result){
  const battle = result && (result.battle || result.details && result.details.battle) || {};
  const reward = result && result.reward || {};
  return {
    modeId:battle.modeId || result.modeId || 'own_selection_battle',
    title:`Rematch - ${battle.title || historyTitle(result) || 'Battle'}`,
    genre:battle.genre || historyGenre(result) || 'Open Format',
    durationMinutes:battle.durationMinutes || result.durationMinutes || 20,
    scoringType:battle.scoringType || result.scoringType || 'hybrid',
    ownSelection:true,
    reward:reward.type === 'bitcoin'
      ? { type:'bitcoin', metadata:{ amountSats:reward.metadata && reward.metadata.amountSats, custody:'external_pending', walletConnected:false } }
      : { type:'xp', metadata:{} }
  };
}

function openRematchSetupFromOpponent(rowId){
  const row = (state.djRelationships.opponents.rows || []).find(item => String(item.id) === String(rowId));
  if(!row) return false;
  return openRematchSetup({
    previousResultId:row.id,
    opponent:row.opponent,
    rules:row.suggestedRules || {},
    title:row.battle && (row.battle.title || row.battle.type) || 'Battle'
  });
}

function openRematchSetupFromHistory(identifier){
  const result = findBattleHistoryResult(identifier);
  if(!result) return false;
  const opponentPublicProfileId = historyRematchProfileId(result);
  if(!opponentPublicProfileId) return false;
  return openRematchSetup({
    previousResultId:result.submissionId || historyResultId(result),
    opponent:{ ...(result.opponent || {}), publicProfileId:opponentPublicProfileId, displayName:historyOpponent(result) },
    rules:historyRematchRules(result),
    title:historyTitle(result)
  });
}

function openRematchSetup(source){
  const opponent = source && source.opponent || {};
  const rules = { modeId:'own_selection_battle', genre:'Open Format', durationMinutes:20, scoringType:'hybrid', ...plainObject(source && source.rules) };
  const mode = BattleModes.getBattleMode(rules.modeId) || BattleModes.getBattleMode('own_selection_battle') || BattleModes.listBattleModes()[0];
  state.djRelationships.rematch = {
    source,
    idempotencyKey:stableClientIdempotencyKey('dj-rematch', {
      accountId:state.musicLibrarySync.accountId || '',
      opponent:opponent.publicProfileId || '',
      previousResultId:source && source.previousResultId || ''
    })
  };
  openModal(`<span class="eyebrow accent">REMATCH REQUEST</span><h3>Rematch ${esc(opponent.displayName || opponent.name || 'DJ')}</h3>
    <div class="challenge-setup-panel">
      <div class="challenge-context-grid">
        <div class="battle-result-module"><span>Opponent</span><strong>${esc(opponent.displayName || opponent.name || 'Opponent DJ')}</strong><p>${esc(opponent.country || 'Country unavailable')} / ${esc(opponent.belt || 'Unranked')}</p></div>
        <div class="battle-result-module"><span>Fresh prep required</span><strong>New crate</strong><p>Previous battle snapshots are never reused for rematches.</p></div>
      </div>
      <div class="form-grid" style="margin-top:12px">
        <label>Battle mode<select id="rematch-mode">${challengeModeOptionsHtml(mode.id)}</select></label>
        <label>Genre<select id="rematch-genre">${genreOptionsHtml(battleModeFixedGenre(mode.id) || rules.genre || mode.defaultGenre)}</select></label>
        <label>Duration<select id="rematch-duration">${challengeDurationOptionsHtml(mode.id, rules.durationMinutes || mode.defaultDurationMinutes)}</select></label>
        <label>Scoring<select id="rematch-scoring">${challengeScoringOptionsHtml(rules.scoringType || 'hybrid')}</select></label>
        <label>Fresh Battle Prep crate<select id="rematch-prep-crate">${battlePrepCrateSelectHtml()}</select></label>
      </div>
      <div id="rematch-prep-status" class="battle-prep-entry-status">${battlePrepEntryValidationHtml(null)}</div>
      <div id="rematch-send-error" class="challenge-meta" style="color:#ff8f8f;margin-top:8px"></div>
    </div>
    <div class="modal-actions"><button class="ghost" value="cancel">Close</button><button class="primary" type="button" id="send-rematch-request">Send Rematch</button></div>`);
  setTimeout(() => {
    const rerender = () => renderRematchSetupValidation(source);
    const modeSelect = document.getElementById('rematch-mode');
    if(modeSelect) modeSelect.onchange = () => {
      const cfg = BattleModes.getBattleMode(modeSelect.value) || mode;
      const duration = document.getElementById('rematch-duration');
      if(duration) duration.innerHTML = challengeDurationOptionsHtml(cfg.id, cfg.defaultDurationMinutes);
      syncBattleGenreControl('rematch', cfg.id);
      rerender();
    };
    ['rematch-genre','rematch-duration','rematch-scoring','rematch-prep-crate'].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.onchange = rerender;
    });
    syncBattleGenreControl('rematch', mode.id);
    renderRematchSetupValidation(source);
    const send = document.getElementById('send-rematch-request');
    if(send) send.onclick = () => sendRematchRequestFromModal(source);
  },0);
  return source;
}

function rematchBattleDraft(){
  const modeId = document.getElementById('rematch-mode')?.value || 'own_selection_battle';
  const mode = BattleModes.getBattleMode(modeId) || BattleModes.getBattleMode('own_selection_battle') || {};
  return {
    modeId,
    title:'Rematch',
    genre:battleModeFixedGenre(modeId) || document.getElementById('rematch-genre')?.value || mode.defaultGenre || 'Open Format',
    durationMinutes:Number(document.getElementById('rematch-duration')?.value || mode.defaultDurationMinutes || 20),
    trackSelectionMethod:'own_selection',
    trackCount:mode.trackCount,
    minimumTrackCount:mode.minimumTrackCount,
    opponentRequirement:'required',
    scoringType:document.getElementById('rematch-scoring')?.value || 'hybrid',
    reward:plainObject(state.djRelationships.rematch.source && state.djRelationships.rematch.source.rules && state.djRelationships.rematch.source.rules.reward).type === 'bitcoin'
      ? { type:'bitcoin', metadata:{ ...plainObject(state.djRelationships.rematch.source.rules.reward.metadata), custody:'external_pending', walletConnected:false } }
      : { type:'xp', metadata:{} }
  };
}

function renderRematchSetupValidation(){
  const selectedCrate = document.getElementById('rematch-prep-crate')?.value || '';
  const draft = rematchBattleDraft();
  const validation = validateBattlePrepCrateForBattle(selectedCrate, draft);
  if(!selectedCrate){
    validation.ready = false;
    validation.optional = false;
    validation.blockers = ['Choose a fresh synced Battle Prep crate for this rematch.'];
    validation.summary = 'Fresh crate required.';
  }
  const target = document.getElementById('rematch-prep-status');
  if(target) target.innerHTML = battlePrepEntryValidationHtml(validation);
  return validation;
}

async function sendRematchRequestFromModal(source = state.djRelationships.rematch.source){
  const err = document.getElementById('rematch-send-error');
  if(!djRelationshipApiAvailable()){
    if(err) err.textContent = 'Sign in with server access to request a rematch.';
    return { skipped:true };
  }
  const selectedCrate = document.getElementById('rematch-prep-crate')?.value || '';
  const validation = renderRematchSetupValidation();
  if(!validation.ready){
    if(err) err.textContent = (validation.blockers || []).join(' ') || 'Battle Prep crate does not pass rematch rules.';
    return { error:err && err.textContent };
  }
  if(!serverBackedBattlePrepCrate(selectedCrate)){
    if(err) err.textContent = 'Choose a synced server-backed Battle Prep crate for rematches.';
    return { error:err && err.textContent };
  }
  const opponent = source && source.opponent || {};
  const body = {
    previousResultId:source && source.previousResultId || null,
    opponentPublicProfileId:opponent.publicProfileId,
    challengerCrateId:rawServerId(selectedCrate),
    rules:rematchBattleDraft(),
    idempotencyKey:state.djRelationships.rematch.idempotencyKey
  };
  if(err) err.textContent = 'Sending protected rematch request...';
  const response = await window.DJBattleApi.apiRequest('/api/rematches', { method:'POST', body });
  if(response.error){
    if(err) err.textContent = response.error;
    return response;
  }
  if(err) err.textContent = 'Rematch request sent. It will appear in Challenges.';
  loadDjChallengeCount().catch(()=>{});
  loadDjNotificationCount().catch(()=>{});
  if(activeProfileTab === 'challenges') loadDjChallengeInbox({ preserve:true }).catch(()=>{});
  return response;
}

function defaultChallengePreferenceState(){
  return {
    whoMayChallenge:'everyone',
    allowedModes:[],
    allowedGenres:[],
    ratingRange:{ min:null, max:null },
    allowedBelts:[],
    bitcoinBattles:'metadata_only',
    autoDeclineOutsideRules:false
  };
}

async function loadChallengePreferences(){
  const prefs = state.djRelationships.preferences;
  if(!djRelationshipApiAvailable()){
    prefs.status = 'offline';
    prefs.error = 'Sign in with server access to load challenge preferences.';
    renderChallengePreferencesPanel();
    return { skipped:true };
  }
  prefs.status = prefs.data ? 'reconnecting' : 'loading';
  prefs.error = '';
  renderChallengePreferencesPanel();
  const response = await window.DJBattleApi.apiRequest('/api/challengePreferences');
  if(response.error){
    prefs.status = prefs.data ? 'stale' : 'failed';
    prefs.error = response.error;
    renderChallengePreferencesPanel();
    return response;
  }
  prefs.data = response.data && response.data.preferences || defaultChallengePreferenceState();
  prefs.configurationRequired = Boolean(response.data && response.data.configurationRequired);
  prefs.status = 'synced';
  renderChallengePreferencesPanel();
  return { preferences:prefs.data, response };
}

function csvInputValue(values){
  return (values || []).join(', ');
}

function csvInputArray(value){
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean).slice(0, 40);
}

function renderChallengePreferencesPanel(){
  if(activeProfileTab !== 'preferences') return;
  const target = document.getElementById('profile-media');
  if(!target) return;
  const prefsState = state.djRelationships.preferences;
  const prefs = { ...defaultChallengePreferenceState(), ...(prefsState.data || {}) };
  const statusLine = prefsState.error || (prefsState.configurationRequired ? 'Relationship schema 019 is required before preferences can sync live.' : prefsState.status === 'synced' ? 'Challenge preferences are loaded from the protected server contract.' : readableComponentName(prefsState.status || 'idle'));
  target.className = 'challenge-console relationship-console';
  target.innerHTML = `<div class="challenge-status-strip">
    <div><span class="challenge-lamp ${relationshipLamp(prefsState.status || 'idle')}"></span><strong>${esc(readableComponentName(prefsState.status || 'idle'))}</strong><div class="challenge-meta">${esc(statusLine)}</div></div>
    <div class="challenge-actions"><button class="ghost small" id="preference-refresh" type="button">Refresh</button><button class="primary small" id="preference-save" type="button">Save</button></div>
  </div>
  <div class="relationship-preferences-grid">
    <label>Who may challenge<select id="pref-who">${['everyone','followed','prior_opponents','nobody'].map(value => `<option value="${value}" ${prefs.whoMayChallenge === value ? 'selected' : ''}>${esc(readableComponentName(value))}</option>`).join('')}</select></label>
    <label>Bitcoin Battles<select id="pref-bitcoin">${['metadata_only','allow','deny'].map(value => `<option value="${value}" ${prefs.bitcoinBattles === value ? 'selected' : ''}>${esc(readableComponentName(value))}</option>`).join('')}</select></label>
    <label>Allowed modes<input id="pref-modes" value="${esc(csvInputValue(prefs.allowedModes))}" placeholder="Blank allows all"></label>
    <label>Allowed genres<input id="pref-genres" value="${esc(csvInputValue(prefs.allowedGenres))}" placeholder="Blank allows all"></label>
    <label>Min rating<input id="pref-min-rating" type="number" value="${prefs.ratingRange && prefs.ratingRange.min != null ? esc(prefs.ratingRange.min) : ''}"></label>
    <label>Max rating<input id="pref-max-rating" type="number" value="${prefs.ratingRange && prefs.ratingRange.max != null ? esc(prefs.ratingRange.max) : ''}"></label>
    <label>Allowed belts<input id="pref-belts" value="${esc(csvInputValue(prefs.allowedBelts))}" placeholder="Blank allows all"></label>
    <label class="toggle-row">Auto-decline outside rules <input id="pref-auto-decline" type="checkbox" ${prefs.autoDeclineOutsideRules ? 'checked' : ''}></label>
  </div>
  <p class="challenge-meta">These settings are enforced server-side during challenge and rematch creation. Opponents receive a generic unavailable response when rules block a request.</p>`;
  document.getElementById('preference-refresh')?.addEventListener('click', () => loadChallengePreferences().catch(err=>console.warn('Challenge preferences refresh failed', err)));
  document.getElementById('preference-save')?.addEventListener('click', () => saveChallengePreferencesFromPanel().catch(err=>console.warn('Challenge preferences save failed', err)));
}

async function saveChallengePreferencesFromPanel(){
  const prefs = {
    whoMayChallenge:document.getElementById('pref-who')?.value || 'everyone',
    bitcoinBattles:document.getElementById('pref-bitcoin')?.value || 'metadata_only',
    allowedModes:csvInputArray(document.getElementById('pref-modes')?.value),
    allowedGenres:csvInputArray(document.getElementById('pref-genres')?.value),
    ratingRange:{
      min:document.getElementById('pref-min-rating')?.value === '' ? null : Number(document.getElementById('pref-min-rating')?.value),
      max:document.getElementById('pref-max-rating')?.value === '' ? null : Number(document.getElementById('pref-max-rating')?.value)
    },
    allowedBelts:csvInputArray(document.getElementById('pref-belts')?.value),
    autoDeclineOutsideRules:Boolean(document.getElementById('pref-auto-decline')?.checked)
  };
  const response = await window.DJBattleApi.apiRequest('/api/challengePreferences', {
    method:'PATCH',
    body:{ preferences:prefs, idempotencyKey:stableClientIdempotencyKey('challenge-preferences', { accountId:state.musicLibrarySync.accountId || '', prefs }) }
  });
  if(response.error){
    state.djRelationships.preferences.status = 'failed';
    state.djRelationships.preferences.error = response.error;
    renderChallengePreferencesPanel();
    return response;
  }
  state.djRelationships.preferences.data = response.data && response.data.preferences || prefs;
  state.djRelationships.preferences.status = 'synced';
  state.djRelationships.preferences.error = '';
  renderChallengePreferencesPanel();
  return response;
}

function challengeQuery(options = {}){
  const filters = { ...(state.djChallenges.filters || {}), ...(options.filters || {}) };
  const params = new URLSearchParams();
  params.set('direction', filters.direction || 'received');
  params.set('status', filters.status || 'pending');
  params.set('page', String(options.page || state.djChallenges.page || 1));
  params.set('limit', String(options.limit || state.djChallenges.pageSize || 10));
  return params.toString();
}

function dedupeChallenges(rows){
  const seen = new Set();
  return (rows || []).filter(row => {
    if(!row || seen.has(String(row.id))) return false;
    seen.add(String(row.id));
    return true;
  });
}

function renderChallengeCountPill(){
  const pill = document.getElementById('challenge-count-pill');
  if(pill){
    const count = Number(state.djChallenges.counts.pendingReceived || 0);
    pill.textContent = String(count);
    pill.classList.toggle('has-unread', count > 0);
  }
}

function renderNotificationCountPill(){
  const pill = document.getElementById('notification-count-pill');
  if(!pill) return;
  const count = Number(state.djNotifications.counts.unreadTotal || 0);
  pill.textContent = String(count);
  pill.classList.toggle('has-unread', count > 0);
}

async function loadDjChallengeCount(){
  if(!djChallengeApiAvailable()) return { skipped:true };
  const response = await window.DJBattleApi.apiRequest('/api/challenges/count');
  if(response.data && response.data.counts){
    state.djChallenges.counts = response.data.counts;
    renderChallengeCountPill();
  }
  return response;
}

function notificationQuery(options = {}){
  const filters = { ...(state.djNotifications.filters || {}), ...(options.filters || {}) };
  const params = new URLSearchParams();
  params.set('filter', filters.filter || 'all');
  params.set('page', String(options.page || state.djNotifications.page || 1));
  params.set('limit', String(options.limit || state.djNotifications.pageSize || 10));
  return params.toString();
}

function dedupeNotifications(rows){
  const seen = new Set();
  return (rows || []).filter(row => {
    const key = String(row && (row.eventId || row.id) || '');
    if(!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function notificationStatusLamp(notification){
  if(!notification) return '';
  if(notification.category === 'battle' || notification.type === 'challenge_converted_to_battle') return 'green';
  if(['challenge_declined','challenge_cancelled','challenge_expired'].includes(notification.type)) return 'red';
  return notification.unread ? 'yellow' : '';
}

function notificationDate(value){
  return challengeDate(value);
}

function notificationExpirationText(notification){
  const expiresAt = notification && notification.challenge && notification.challenge.expiresAt;
  if(!expiresAt) return 'No active expiration';
  const date = new Date(expiresAt);
  if(!Number.isFinite(date.getTime())) return 'Expiration unavailable';
  const ms = date.getTime() - Date.now();
  if(ms <= 0) return `Expired ${notificationDate(expiresAt)}`;
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m remaining`;
}

async function loadDjNotificationCount(){
  if(!djNotificationApiAvailable()) return { skipped:true };
  const response = await window.DJBattleApi.apiRequest('/api/notifications/count');
  if(response.data && response.data.counts){
    state.djNotifications.counts = response.data.counts;
    renderNotificationCountPill();
  }
  return response;
}

async function loadDjNotifications(options = {}){
  if(!djNotificationApiAvailable()){
    state.djNotifications.status = 'offline';
    state.djNotifications.error = 'Sign in and server access are required for private notifications.';
    renderNotificationCenter();
    return { skipped:true, reason:'api_unavailable' };
  }
  if(state.djNotifications.inFlight && options.joinInFlight !== false) return state.djNotifications.inFlight;
  const seq = ++state.djNotifications.requestSeq;
  const append = options.append === true;
  const nextPage = append ? state.djNotifications.pagination.nextPage || state.djNotifications.page + 1 : options.page || 1;
  const previousWatermark = Number(state.djNotifications.toastWatermark || 0);
  state.djNotifications.status = state.djNotifications.rows.length ? 'reconnecting' : 'loading';
  state.djNotifications.error = '';
  state.djNotifications.stale = false;
  if(options.render !== false) renderNotificationCenter();
  const request = window.DJBattleApi.apiRequest(`/api/notifications?${notificationQuery({ page:nextPage })}`)
    .then(response => {
      if(seq !== state.djNotifications.requestSeq) return { stale:true };
      if(response.error){
        state.djNotifications.status = state.djNotifications.rows.length ? 'stale' : 'failed';
        state.djNotifications.stale = Boolean(state.djNotifications.rows.length);
        state.djNotifications.error = response.error;
        renderNotificationCenter();
        return response;
      }
      const incoming = response.data && response.data.notifications || [];
      const rows = append ? dedupeNotifications([...state.djNotifications.rows, ...incoming]) : incoming;
      state.djNotifications.rows = rows;
      state.djNotifications.pagination = response.data && response.data.pagination || state.djNotifications.pagination;
      state.djNotifications.page = state.djNotifications.pagination.page || nextPage;
      state.djNotifications.status = 'synced';
      state.djNotifications.lastSuccessfulAt = new Date().toISOString();
      const maxVersion = Math.max(previousWatermark, ...incoming.map(row => Number(row.eventVersion || 0)));
      if(options.emitToasts){
        incoming
          .filter(row => row.unread && !row.muted && Number(row.eventVersion || 0) > previousWatermark)
          .forEach(showDjNotificationToast);
      }
      state.djNotifications.toastWatermark = maxVersion;
      renderNotificationCenter();
      loadDjNotificationCount().catch(()=>{});
      return { notifications:state.djNotifications.rows, response };
    })
    .finally(() => {
      if(state.djNotifications.inFlight === request) state.djNotifications.inFlight = null;
    });
  state.djNotifications.inFlight = request;
  return request;
}

function renderNotificationCenter(){
  const target = document.getElementById('notification-center');
  if(!target) return;
  target.className = 'challenge-console';
  const status = state.djNotifications.status || 'idle';
  const lamp = status === 'synced' ? 'green' : status === 'failed' ? 'red' : 'yellow';
  const filters = state.djNotifications.filters || {};
  const rows = state.djNotifications.rows || [];
  const statusLine = state.djNotifications.error || (status === 'synced' ? `Synced ${notificationDate(state.djNotifications.lastSuccessfulAt)}` : status === 'idle' ? 'Server-backed challenge and battle notifications appear here after sign-in.' : readableComponentName(status));
  const controls = `<div class="challenge-status-strip">
    <div><span class="challenge-lamp ${lamp}"></span><strong>${esc(readableComponentName(status))}</strong><div class="challenge-meta">${esc(statusLine)}</div></div>
    <div class="challenge-actions"><button class="ghost small" id="notification-list-refresh" type="button">Refresh</button><button class="ghost small" id="notification-list-more" type="button" ${state.djNotifications.pagination.hasMore ? '' : 'disabled'}>Load More</button></div>
  </div>
  <div class="challenge-filters">
    <label>Filter<select id="notification-filter">${['all','unread','challenges','battles','relationships','archived'].map(value => `<option value="${value}" ${filters.filter === value ? 'selected' : ''}>${esc(readableComponentName(value))}</option>`).join('')}</select></label>
  </div>`;
  const list = rows.length ? rows.map(notificationRowHtml).join('') : `<div class="challenge-row notification-row"><div><strong>No notifications</strong><div class="challenge-meta">No server-backed challenge activity has been delivered for this account.</div></div></div>`;
  target.innerHTML = controls + list;
  document.getElementById('notification-list-refresh')?.addEventListener('click', () => loadDjNotifications({ joinInFlight:false }).catch(err=>console.warn('Notification refresh failed', err)));
  document.getElementById('notification-list-more')?.addEventListener('click', () => loadDjNotifications({ append:true }).catch(err=>console.warn('Notification pagination failed', err)));
  document.getElementById('notification-filter')?.addEventListener('change', event => {
    state.djNotifications.filters = { filter:event.currentTarget.value || 'all' };
    state.djNotifications.rows = [];
    loadDjNotifications({ joinInFlight:false }).catch(err=>console.warn('Notification filter failed', err));
  });
  document.querySelectorAll('[data-notification-open]').forEach(button => {
    button.onclick = event => openDjNotificationDestination(event.currentTarget.dataset.notificationOpen);
  });
  document.querySelectorAll('[data-notification-read]').forEach(button => {
    button.onclick = event => markDjNotificationReadState(event.currentTarget.dataset.notificationRead, true);
  });
  document.querySelectorAll('[data-notification-unread]').forEach(button => {
    button.onclick = event => markDjNotificationReadState(event.currentTarget.dataset.notificationUnread, false);
  });
  document.querySelectorAll('[data-notification-mute]').forEach(button => {
    button.onclick = event => muteDjNotificationSource(event.currentTarget.dataset.notificationMute);
  });
  document.querySelectorAll('[data-notification-block]').forEach(button => {
    button.onclick = event => blockDjNotificationSource(event.currentTarget.dataset.notificationBlock);
  });
  const refresh = document.getElementById('notification-refresh');
  if(refresh) refresh.onclick = () => loadDjNotifications({ joinInFlight:false }).catch(err=>console.warn('Notification refresh failed', err));
  const markAll = document.getElementById('notification-mark-all');
  if(markAll) markAll.onclick = () => markAllDjNotificationsRead();
}

function notificationRowHtml(notification){
  const actor = notification.actor || {};
  const challenge = notification.challenge || {};
  const destination = notification.destination || {};
  const lamp = notificationStatusLamp(notification);
  const readButton = notification.unread
    ? `<button class="ghost small" type="button" data-notification-read="${esc(notification.id)}">Mark Read</button>`
    : `<button class="ghost small" type="button" data-notification-unread="${esc(notification.id)}">Mark Unread</button>`;
  const canRecover = destination.type === 'battle_room' && destination.battleId;
  const canSafetyAction = actor.publicProfileId && actor.profileVisibility !== 'private';
  return `<div class="challenge-row notification-row ${notification.unread ? 'unread' : ''} ${notification.muted ? 'muted' : ''}" data-notification-row="${esc(notification.id)}">
    <div>
      <span class="challenge-lamp ${lamp}"></span><strong>${esc(actor.displayName || actor.name || 'DJ')}</strong>
      <div class="challenge-meta">${esc(actor.country || 'Country unavailable')} / ${esc(actor.belt || 'Unranked')} ${notification.muted ? '/ muted' : ''}</div>
    </div>
    <div>
      <span class="notification-destination">${esc(readableComponentName(notification.type))}</span>
      <div class="challenge-meta">${esc(notification.summary || 'Challenge update')}<br>${esc(challengeRulesSummary(challenge.rules || {}))}<br>${esc(notificationExpirationText(notification))}</div>
    </div>
    <div class="challenge-actions">
      ${canRecover ? `<button class="primary small" type="button" data-notification-open="${esc(notification.id)}">Enter Battle Room</button>` : `<button class="ghost small" type="button" data-notification-open="${esc(notification.id)}">Open</button>`}
      ${readButton}
      ${canSafetyAction ? `<button class="ghost small" type="button" data-notification-mute="${esc(notification.id)}">Mute</button><button class="ghost small" type="button" data-notification-block="${esc(notification.id)}">Block</button>` : ''}
    </div>
  </div>`;
}

function showDjNotificationToast(notification){
  if(!notification || notification.muted) return false;
  const key = String(notification.eventId || notification.id || '');
  if(!key || state.djNotifications.seenToastEventIds.has(key)) return false;
  state.djNotifications.seenToastEventIds.add(key);
  let rack = document.getElementById('notification-toast-rack');
  if(!rack){
    rack = document.createElement('div');
    rack.id = 'notification-toast-rack';
    rack.className = 'notification-toast-rack';
    document.body.appendChild(rack);
  }
  const toast = document.createElement('button');
  toast.type = 'button';
  toast.className = 'notification-toast';
  toast.innerHTML = `<strong>${esc(notification.actor && (notification.actor.displayName || notification.actor.name) || 'Challenge update')}</strong><small>${esc(notification.summary || readableComponentName(notification.type))}</small>`;
  toast.onclick = () => openDjNotificationDestination(notification.id);
  rack.appendChild(toast);
  const timer = setTimeout(() => toast.remove(), 6500);
  if(timer && typeof timer.unref === 'function') timer.unref();
  return true;
}

async function openDjNotificationDestination(notificationId){
  const notification = (state.djNotifications.rows || []).find(row => String(row.id) === String(notificationId));
  if(!notification) return { skipped:true };
  const destination = notification.destination || {};
  if(destination.type === 'battle_room' && destination.battleId){
    const result = await recoverAcceptedChallengeBattle(destination.battleId);
    const active = result && result.session || activeStudioBattleSession();
    if(active){
      active.challengeNotice = notification.summary || 'This Battle Room was opened from an accepted DJ challenge.';
      persistActiveBattleSession(active);
      renderBattleRoomChallengeNotice(active);
    }
    return { ...result, session:active };
  }
  activeProfileTab = 'challenges';
  switchView('profile');
  await loadDjChallengeInbox({ preserve:true }).catch(()=>{});
  return { opened:'challenges' };
}

async function markDjNotificationReadState(notificationId, read){
  const response = await window.DJBattleApi.apiRequest(`/api/notifications/${encodeURIComponent(notificationId)}/${read ? 'read' : 'unread'}`, {
    method:'POST',
    body:{ idempotencyKey:stableClientIdempotencyKey(`notification-${read ? 'read' : 'unread'}`, { accountId:state.musicLibrarySync.accountId || '', notificationId }) }
  });
  if(response.error){
    state.djNotifications.status = state.djNotifications.rows.length ? 'stale' : 'failed';
    state.djNotifications.error = response.error;
    renderNotificationCenter();
    return response;
  }
  const updated = response.data && response.data.notification;
  if(updated){
    state.djNotifications.rows = state.djNotifications.rows.map(row => String(row.id) === String(updated.id) ? updated : row);
    renderNotificationCenter();
    loadDjNotificationCount().catch(()=>{});
  }
  return response;
}

async function markAllDjNotificationsRead(){
  const response = await window.DJBattleApi.apiRequest('/api/notifications/mark-all-read', {
    method:'POST',
    body:{ filter:state.djNotifications.filters.filter || 'unread', idempotencyKey:stableClientIdempotencyKey('notifications-mark-all', { accountId:state.musicLibrarySync.accountId || '', filter:state.djNotifications.filters.filter || 'unread' }) }
  });
  if(response.error){
    state.djNotifications.status = state.djNotifications.rows.length ? 'stale' : 'failed';
    state.djNotifications.error = response.error;
    renderNotificationCenter();
    return response;
  }
  await loadDjNotifications({ joinInFlight:false }).catch(()=>{});
  await loadDjNotificationCount().catch(()=>{});
  return response;
}

async function muteDjNotificationSource(notificationId){
  const notification = (state.djNotifications.rows || []).find(row => String(row.id) === String(notificationId));
  if(!notification || !notification.actor || !notification.actor.publicProfileId) return { skipped:true };
  const response = await window.DJBattleApi.apiRequest('/api/notificationMutes', {
    method:'POST',
    body:{
      mutedPublicProfileId:notification.actor.publicProfileId,
      category:'challenge',
      idempotencyKey:stableClientIdempotencyKey('notification-mute', { accountId:state.musicLibrarySync.accountId || '', actor:notification.actor.publicProfileId })
    }
  });
  if(response.error){
    state.djNotifications.error = response.error;
    renderNotificationCenter();
    return response;
  }
  state.djNotifications.rows = state.djNotifications.rows.map(row => String(row.id) === String(notificationId) ? { ...row, muted:true } : row);
  renderNotificationCenter();
  loadDjNotificationCount().catch(()=>{});
  return response;
}

async function blockDjNotificationSource(notificationId){
  const notification = (state.djNotifications.rows || []).find(row => String(row.id) === String(notificationId));
  if(!notification || !notification.actor || !notification.actor.publicProfileId) return { skipped:true };
  if(!confirm('Block this DJ from challenge interactions? Pending challenges may be cancelled, but active battles stay controlled by Battle Room rules.')) return { cancelled:true };
  const response = await window.DJBattleApi.apiRequest('/api/blocks', {
    method:'POST',
    body:{
      blockedPublicProfileId:notification.actor.publicProfileId,
      idempotencyKey:stableClientIdempotencyKey('dj-block', { accountId:state.musicLibrarySync.accountId || '', actor:notification.actor.publicProfileId })
    }
  });
  if(response.error){
    state.djNotifications.error = response.error;
    renderNotificationCenter();
    return response;
  }
  await loadDjNotifications({ joinInFlight:false }).catch(()=>{});
  await loadDjChallengeInbox({ preserve:true }).catch(()=>{});
  await loadDjNotificationCount().catch(()=>{});
  await loadDjChallengeCount().catch(()=>{});
  return response;
}

async function loadDjChallengeInbox(options = {}){
  if(!djChallengeApiAvailable()){
    state.djChallenges.status = 'offline';
    state.djChallenges.error = 'Sign in and server access are required for the Challenge Inbox.';
    renderChallengeInbox();
    return { skipped:true, reason:'api_unavailable' };
  }
  const seq = ++state.djChallenges.requestSeq;
  const append = options.append === true;
  const nextPage = append ? state.djChallenges.pagination.nextPage || state.djChallenges.page + 1 : options.page || 1;
  state.djChallenges.status = state.djChallenges.rows.length ? 'reconnecting' : 'loading';
  state.djChallenges.error = '';
  state.djChallenges.stale = false;
  if(options.render !== false) renderChallengeInbox();
  const response = await window.DJBattleApi.apiRequest(`/api/challenges?${challengeQuery({ page:nextPage })}`);
  if(seq !== state.djChallenges.requestSeq) return { stale:true };
  if(response.error){
    state.djChallenges.status = state.djChallenges.rows.length ? 'stale' : 'failed';
    state.djChallenges.stale = Boolean(state.djChallenges.rows.length);
    state.djChallenges.error = response.error;
    renderChallengeInbox();
    return response;
  }
  const incoming = response.data && response.data.challenges || [];
  state.djChallenges.rows = append ? dedupeChallenges([...state.djChallenges.rows, ...incoming]) : incoming;
  state.djChallenges.pagination = response.data && response.data.pagination || state.djChallenges.pagination;
  state.djChallenges.page = state.djChallenges.pagination.page || nextPage;
  state.djChallenges.status = 'synced';
  state.djChallenges.lastSuccessfulAt = new Date().toISOString();
  renderChallengeInbox();
  loadDjChallengeCount().catch(()=>{});
  return { challenges:state.djChallenges.rows, response };
}

function renderChallengeInbox(){
  const target = document.getElementById('profile-media');
  if(!target) return;
  target.className = 'challenge-console';
  const status = state.djChallenges.status || 'idle';
  const lamp = status === 'synced' ? 'green' : status === 'failed' ? 'red' : 'yellow';
  const rows = state.djChallenges.rows || [];
  const filters = state.djChallenges.filters || {};
  const statusLine = state.djChallenges.error || (status === 'synced' ? `Synced ${challengeDate(state.djChallenges.lastSuccessfulAt)}` : status === 'idle' ? 'Ready to load private challenge records.' : readableComponentName(status));
  const controls = `<div class="challenge-status-strip">
    <div><span class="challenge-lamp ${lamp}"></span><strong>${esc(readableComponentName(status))}</strong><div class="challenge-meta">${esc(statusLine)}</div></div>
    <div class="challenge-actions"><button class="ghost small" id="challenge-refresh" type="button">Refresh</button><button class="ghost small" id="challenge-load-more" type="button" ${state.djChallenges.pagination.hasMore ? '' : 'disabled'}>Load More</button></div>
  </div>
  <div class="challenge-filters">
    <label>Direction<select id="challenge-filter-direction"><option value="received" ${filters.direction === 'received' ? 'selected' : ''}>Received</option><option value="sent" ${filters.direction === 'sent' ? 'selected' : ''}>Sent</option><option value="all" ${filters.direction === 'all' ? 'selected' : ''}>All</option></select></label>
    <label>Status<select id="challenge-filter-status">${['pending','converted-to-battle','declined','cancelled','expired','all'].map(value => `<option value="${value}" ${filters.status === value ? 'selected' : ''}>${esc(readableComponentName(value))}</option>`).join('')}</select></label>
  </div>`;
  const list = rows.length ? rows.map(challengeRowHtml).join('') : `<div class="challenge-row"><div><strong>No challenges</strong><div class="challenge-meta">Server-backed challenge records appear here after sign-in.</div></div></div>`;
  target.innerHTML = controls + list;
  document.getElementById('challenge-refresh')?.addEventListener('click', () => loadDjChallengeInbox().catch(err=>console.warn('Challenge inbox refresh failed', err)));
  document.getElementById('challenge-load-more')?.addEventListener('click', () => loadDjChallengeInbox({ append:true }).catch(err=>console.warn('Challenge inbox pagination failed', err)));
  ['challenge-filter-direction','challenge-filter-status'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.onchange = () => {
      state.djChallenges.filters = {
        direction:document.getElementById('challenge-filter-direction')?.value || 'received',
        status:document.getElementById('challenge-filter-status')?.value || 'pending'
      };
      state.djChallenges.rows = [];
      loadDjChallengeInbox().catch(err=>console.warn('Challenge inbox filter failed', err));
    };
  });
  document.querySelectorAll('[data-challenge-accept]').forEach(button => {
    button.onclick = event => acceptDjChallengeFromInbox(event.currentTarget.dataset.challengeAccept);
  });
  document.querySelectorAll('[data-challenge-decline]').forEach(button => {
    button.onclick = event => updateDjChallengeTerminal(event.currentTarget.dataset.challengeDecline, 'decline');
  });
  document.querySelectorAll('[data-challenge-cancel]').forEach(button => {
    button.onclick = event => updateDjChallengeTerminal(event.currentTarget.dataset.challengeCancel, 'cancel');
  });
  document.querySelectorAll('[data-challenge-open-battle]').forEach(button => {
    button.onclick = event => recoverAcceptedChallengeBattle(event.currentTarget.dataset.challengeOpenBattle);
  });
  document.querySelectorAll('[data-profile-tab]').forEach(button=>button.classList.toggle('active',button.dataset.profileTab===activeProfileTab));
}

function challengeRowHtml(challenge){
  const incoming = challenge.direction === 'received';
  const other = incoming ? challenge.challenger : challenge.recipient;
  const lamp = challengeStatusLamp(challenge.status);
  const canAccept = challenge.eligibility && challenge.eligibility.canAccept;
  const canDecline = challenge.eligibility && challenge.eligibility.canDecline;
  const canCancel = challenge.eligibility && challenge.eligibility.canCancel;
  const crateSelect = canAccept ? `<select data-challenge-crate="${esc(challenge.id)}">${battlePrepCrateSelectHtml()}</select>` : '';
  return `<div class="challenge-row" data-challenge-row="${esc(challenge.id)}">
    <div>
      <span class="challenge-lamp ${lamp}"></span><strong>${esc(challengeProfileSummary(other))}</strong>
      <div class="challenge-meta">${esc(incoming ? 'Challenger' : 'Recipient')} / ${esc(other && other.belt || 'Unranked')} / ${esc(other && other.rating == null ? 'rating pending' : `${other.rating} rating`)}</div>
    </div>
    <div>
      <span class="challenge-lcd">${esc(readableComponentName(challenge.status))}</span>
      <div class="challenge-meta">${esc(challengeRulesSummary(challenge.rules))}<br>Expires ${esc(challengeDate(challenge.expiresAt))}</div>
    </div>
    <div class="challenge-actions">
      ${crateSelect}
      ${canAccept ? `<button class="primary small" type="button" data-challenge-accept="${esc(challenge.id)}">Accept</button>` : ''}
      ${canDecline ? `<button class="ghost small" type="button" data-challenge-decline="${esc(challenge.id)}">Decline</button>` : ''}
      ${canCancel ? `<button class="ghost small" type="button" data-challenge-cancel="${esc(challenge.id)}">Cancel</button>` : ''}
      ${challenge.battleId ? `<button class="primary small" type="button" data-challenge-open-battle="${esc(challenge.battleId)}">Battle Room</button>` : ''}
    </div>
  </div>`;
}

async function acceptDjChallengeFromInbox(challengeId){
  const challenge = (state.djChallenges.rows || []).find(row => String(row.id) === String(challengeId));
  const row = Array.from(document.querySelectorAll('[data-challenge-row]')).find(item => String(item.dataset.challengeRow) === String(challengeId));
  const crateId = row && row.querySelector('[data-challenge-crate]')?.value || '';
  if(challenge && challenge.eligibility && challenge.eligibility.requiresRecipientCrate && !crateId){
    state.djChallenges.error = 'Choose your synced Battle Prep crate before accepting this challenge.';
    renderChallengeInbox();
    return { error:state.djChallenges.error };
  }
  if(crateId && !serverBackedBattlePrepCrate(crateId)){
    state.djChallenges.error = 'Challenge acceptance requires a synced server-backed Battle Prep crate.';
    renderChallengeInbox();
    return { error:state.djChallenges.error };
  }
  const response = await window.DJBattleApi.apiRequest(`/api/challenges/${encodeURIComponent(challengeId)}/accept`, {
    method:'POST',
    body:{
      recipientCrateId:crateId ? rawServerId(crateId) : null,
      idempotencyKey:stableClientIdempotencyKey('challenge-accept', { accountId:state.musicLibrarySync.accountId || '', challengeId, crateId })
    }
  });
  if(response.error){
    state.djChallenges.error = response.error;
    state.djChallenges.status = state.djChallenges.rows.length ? 'stale' : 'failed';
    renderChallengeInbox();
    return response;
  }
  const routed = routeAcceptedChallengeToBattleRoom(response.data || {});
  await loadDjChallengeInbox({ preserve:true }).catch(()=>{});
  await loadDjNotificationCount().catch(()=>{});
  if(document.getElementById('notifications')?.classList.contains('active')) await loadDjNotifications({ joinInFlight:false }).catch(()=>{});
  return { response, routed };
}

async function updateDjChallengeTerminal(challengeId, action){
  const response = await window.DJBattleApi.apiRequest(`/api/challenges/${encodeURIComponent(challengeId)}/${action}`, {
    method:'POST',
    body:{ idempotencyKey:stableClientIdempotencyKey(`challenge-${action}`, { accountId:state.musicLibrarySync.accountId || '', challengeId }) }
  });
  if(response.error){
    state.djChallenges.error = response.error;
    state.djChallenges.status = state.djChallenges.rows.length ? 'stale' : 'failed';
    renderChallengeInbox();
    return response;
  }
  await loadDjChallengeInbox({ preserve:true }).catch(()=>{});
  await loadDjNotificationCount().catch(()=>{});
  if(document.getElementById('notifications')?.classList.contains('active')) await loadDjNotifications({ joinInFlight:false }).catch(()=>{});
  return response;
}

function upsertChallengeBattleFromPayload(data){
  const serverBattle = data && data.battle || data && data.room && data.room.battle;
  if(!serverBattle || !serverBattle.id) return null;
  let battle = BattleModes.normalizeBattleRecord({
    id:serverBattle.id,
    modeId:serverBattle.modeId,
    title:serverBattle.title,
    genre:serverBattle.genre,
    durationMinutes:serverBattle.durationMinutes,
    trackSelectionMethod:serverBattle.trackSelectionMethod,
    trackCount:serverBattle.trackCount,
    minimumTrackCount:serverBattle.minimumTrackCount,
    opponentRequirement:serverBattle.opponentRequirement || 'required',
    status:serverBattle.status || 'matched',
    visibility:serverBattle.visibility || 'available',
    reward:serverBattle.reward || { type:'xp', metadata:{} },
    createdBy:serverBattle.createdBy || 'server-challenge'
  });
  battle.serverBacked = true;
  battle.lobbyStatus = serverBattle.status || battle.status;
  if(data.snapshot) battle = attachBattlePrepSnapshotToBattle(battle, serverBattlePrepSnapshotToLocal(data.snapshot, battle, {}), currentProfileUserId(), data.entry);
  const idx = battles.findIndex(item => String(item.id) === String(battle.id));
  if(idx >= 0) battles[idx] = { ...battles[idx], ...battle };
  else battles.unshift(battle);
  persistBattles();
  return idx >= 0 ? battles[idx] : battle;
}

function routeAcceptedChallengeToBattleRoom(data){
  if(data && data.room){
    const applied = applyServerBattleRoomState(data.room, { render:true });
    if(applied.session && data.challenge){
      const other = data.challenge.direction === 'received' ? data.challenge.challenger : data.challenge.recipient;
      applied.session.challengeNotice = `${challengeProfileSummary(other)} joined through a server-backed DJ challenge.`;
      persistActiveBattleSession(applied.session);
      renderBattleRoomChallengeNotice(applied.session);
    }
    switchView('battle-room');
    return applied;
  }
  const battle = upsertChallengeBattleFromPayload(data);
  if(battle){
    startBattleSession(battle);
    return { battle };
  }
  return { skipped:true };
}

async function recoverAcceptedChallengeBattle(battleId){
  const session = activeStudioBattleSession();
  if(session && String(session.battleId || session.id) === String(battleId)){
    switchView('battle-room');
    return { session };
  }
  const response = await window.DJBattleApi.apiRequest(`/api/battles/${encodeURIComponent(battleId)}/room?ifVersion=0`);
  if(response.error){
    state.djChallenges.error = response.error;
    renderChallengeInbox();
    return response;
  }
  return routeAcceptedChallengeToBattleRoom({ room:response.data && response.data.room });
}

function scheduleDjChallengePolling(intervalMs = 30000){
  if(state.djChallenges.pollTimer) clearInterval(state.djChallenges.pollTimer);
  state.djChallenges.pollTimer = null;
  if(!djChallengeApiAvailable() || !state.musicLibrarySync.accountId || livePollingDisabledForTest()) return 0;
  state.djChallenges.pollTimer = setInterval(() => {
    loadDjChallengeCount().catch(()=>{});
    if(activeProfileTab === 'challenges' && document.getElementById('profile')?.classList.contains('active')){
      loadDjChallengeInbox({ preserve:true }).catch(()=>{});
    }
  }, intervalMs);
  if(typeof state.djChallenges.pollTimer.unref === 'function') state.djChallenges.pollTimer.unref();
  return intervalMs;
}

function scheduleDjNotificationPolling(intervalMs = 30000){
  if(state.djNotifications.pollTimer) clearTimeout(state.djNotifications.pollTimer);
  state.djNotifications.pollTimer = null;
  if(!djNotificationApiAvailable() || !state.musicLibrarySync.accountId || livePollingDisabledForTest()) return 0;
  const tick = async () => {
    const hidden = document.visibilityState === 'hidden';
    if(!hidden){
      await loadDjNotificationCount().catch(()=>{});
      await loadDjNotifications({ render:document.getElementById('notifications')?.classList.contains('active'), emitToasts:true }).catch(()=>{});
    }
    const delay = hidden ? Math.max(intervalMs * 2, 60000) : intervalMs;
    state.djNotifications.pollTimer = setTimeout(tick, delay);
    if(state.djNotifications.pollTimer && typeof state.djNotifications.pollTimer.unref === 'function') state.djNotifications.pollTimer.unref();
  };
  state.djNotifications.pollTimer = setTimeout(tick, intervalMs);
  if(state.djNotifications.pollTimer && typeof state.djNotifications.pollTimer.unref === 'function') state.djNotifications.pollTimer.unref();
  return intervalMs;
}

function renderPublicDjProfile(profile, status){
  if(!profile){
    const message = status === 403 ? 'This public DJ profile is private.' : status === 404 ? 'This public DJ profile is unavailable.' : 'Public DJ profile could not be loaded.';
    openModal(`<span class="eyebrow accent">PROFILE UNAVAILABLE</span><h3>Public DJ profile unavailable</h3><p style="color:var(--muted)">${esc(message)}</p><div class="modal-actions"><button class="ghost" value="cancel">Close</button></div>`);
    return null;
  }
  const profileIdValue = profile.id || profile.publicProfileId || '';
  if(state.profileRanking.public.profileId !== profileIdValue){
    state.profileRanking.public = {
      ...state.profileRanking.public,
      profileId:profileIdValue,
      profile,
      data:null,
      status:/^dj_[a-z0-9]+$/i.test(String(profileIdValue)) ? 'idle' : 'configuration_required',
      error:/^dj_[a-z0-9]+$/i.test(String(profileIdValue)) ? '' : 'Server-backed ranking history needs a stable public profile identifier.',
      stale:false
    };
  }else{
    state.profileRanking.public.profile = profile;
  }
  const stats = profile.stats || {};
  const country = profile.country || 'Unknown';
  const media = safePublicMediaItems(profile.media);
  const rankingState = state.profileRanking.public;
  const relationshipCounts = profile.relationshipCounts || (state.djRelationships.publicSummaries[profileIdValue] && state.djRelationships.publicSummaries[profileIdValue].counts) || {};
  const followerText = relationshipCounts.source === 'server' || profile.followerCount != null
    ? ` / ${Number(profile.followerCount ?? relationshipCounts.followers ?? 0)} follower(s)`
    : '';
  const rankingControls = `<div class="profile-ranking-tabs">${rankingCategoryButtonsHtml(rankingState.category, 'public')}</div>`;
  const rankingHtml = rankingDetailSummaryHtml(rankingState, {
    scope:'public',
    emptyTitle:'Authoritative ranking history',
    emptyText:'Ranking history loads from the server ranking-history contract when available.'
  });
  const followAction = publicFollowButtonHtml(profile);
  const challengeAction = publicChallengeButtonHtml(profile);
  const mediaHtml = media.length
    ? media.map(item => `<div class="battle-result-row"><b>${esc(item.title || 'Public media')}</b><em>${item.securePlaybackPermitted && item.publicUrl ? `<audio controls src="${esc(item.publicUrl)}" style="max-width:220px"></audio>` : 'On-site playback unavailable'}</em></div>`).join('')
    : '<div class="battle-result-row"><b>Public media</b><em>None approved</em></div>';
  openModal(`<span class="eyebrow accent">PUBLIC DJ PROFILE</span><h3>${esc(profile.displayName || 'DJ')}</h3>
    <div class="battle-result-surface">
      <div class="battle-result-top">
        <div class="battle-result-module"><span>Country</span><strong>${esc(countryCode(country))}</strong><p>${esc(country)}</p></div>
        <div class="battle-result-module"><span>Belt / rating</span><strong>${esc(profile.belt || 'Unranked')}</strong><p>Approved public profile info only. ${esc(profile.rating == null ? 'Rating pending' : `${profile.rating} rating movement`)}</p></div>
        <div class="battle-result-module"><span>Rank</span><strong>${esc(profile.rank ? `#${profile.rank}` : 'Pending')}</strong><p>${esc(stats.totalResults || 0)} public result(s)${esc(followerText)}</p></div>
      </div>
      <div class="profile-ranking-surface">
        <div class="section-head compact"><div><span class="eyebrow">AUTHORITATIVE RANKING HISTORY</span><h3>Competitive Overview</h3></div></div>
        ${rankingControls}
        ${rankingHtml}
      </div>
      <div class="battle-progression-grid">
        <div class="battle-result-module"><span>Battle stats</span><strong>${esc(`${stats.wins || 0}-${stats.losses || 0}-${stats.ties || 0}`)}</strong><p>Competitive: ${esc(stats.competitiveBattles || 0)} / AI-only: ${esc(stats.aiOnlyHighScores || 0)}</p></div>
        <div class="battle-result-module"><span>Scores</span><strong>${esc(stats.bestScore || 0)}</strong><p>Average ${esc(stats.averageScore || 0)}</p></div>
        <div class="battle-result-module"><span>Specialties</span><strong>${esc((profile.specialties || []).slice(0,3).map(readableComponentName).join(', ') || 'Open Format')}</strong></div>
        <div class="battle-result-module"><span>Views</span><strong>${esc(profile.views && profile.views.total || stats.totalViews || 0)}</strong><p>${esc(profile.views && profile.views.uniqueEstimate || 0)} unique estimate</p></div>
      </div>
      ${profile.bio ? `<div class="battle-result-module"><span>Public bio</span><p>${esc(profile.bio)}</p></div>` : ''}
      <div class="battle-evidence-grid">
        ${profileResultList(profile.competitiveHistory, 'Competitive history')}
        ${profileResultList(profile.aiOnlyHighScores, 'AI-only high scores')}
        <div class="battle-result-module"><span>Public profile media</span><div class="battle-result-table" style="margin-top:10px">${mediaHtml}</div></div>
      </div>
      <p style="color:var(--muted);margin:0">Email, auth IDs, private history, private uploads, storage paths, credentials and internal metadata are not included. Public download links are not created.</p>
    </div><div class="modal-actions">${followAction}${challengeAction}<button class="ghost" value="cancel">Close</button></div>`);
  setTimeout(() => {
    attachProfileRankingControls(document);
    const followBtn = document.getElementById('follow-public-dj');
    if(followBtn) followBtn.onclick = () => togglePublicProfileFollow(profile);
    hydratePublicProfileRelationshipSummary(profile).catch(()=>{});
    const challengeBtn = document.getElementById('challenge-public-dj');
    if(challengeBtn) challengeBtn.onclick = () => openProtectedChallengeSetupFromPublicId(profileIdValue, 'public_profile');
    hydratePublicProfileChallengeEligibility(profile).then(result => {
      if(result && result.eligibility && result.eligibility.available === false){
        const current = document.getElementById('challenge-public-dj');
        if(current) current.onclick = null;
      }
    }).catch(()=>{});
    document.querySelectorAll('[data-public-result-ranking-impact]').forEach(button => {
      button.onclick = event => openPublicProfileRankingImpactFromResult(event.currentTarget.dataset.publicResultRankingImpact, { returnTo:'public-profile' });
    });
  },0);
  return profile;
}

async function trackPublicProfileView(publicProfileIdValue){
  if(!publicProfileIdValue || !window.DJBattleApi || typeof window.DJBattleApi.apiRequest !== 'function') return null;
  return window.DJBattleApi.apiRequest(`/api/publicProfiles/${encodeURIComponent(publicProfileIdValue)}/views`, {
    method:'POST',
    public:true,
    body:{ visitorId:publicVisitorId() }
  });
}

async function loadPublicDjProfile(publicProfileIdValue, options = {}){
  if(!publicProfileIdValue || !/^dj_[a-z0-9]+$/i.test(String(publicProfileIdValue))) return renderPublicDjProfile(null, 404);
  if(!window.DJBattleApi || typeof window.DJBattleApi.apiRequest !== 'function') return renderPublicDjProfile(null, 503);
  state.profileRanking.public = {
    ...state.profileRanking.public,
    profileId:publicProfileIdValue,
    category:validPublicRankingCategory(options.category || state.profileRanking.public.category || 'competitive_battles'),
    selectedResultId:options.selectedResultId || '',
    returnTo:options.returnTo || state.profileRanking.public.returnTo || '',
    status:state.profileRanking.public.data ? 'reconnecting' : 'loading',
    error:''
  };
  const response = await window.DJBattleApi.apiRequest(`/api/publicProfiles/${encodeURIComponent(publicProfileIdValue)}`, { public:true });
  if(response && response.data && response.data.profile){
    state.profileRanking.public = { ...state.profileRanking.public, profile:response.data.profile, profileId:publicProfileIdValue };
    const rendered = renderPublicDjProfile(response.data.profile);
    trackPublicProfileView(publicProfileIdValue).then(viewResponse => {
      if(viewResponse && viewResponse.data && viewResponse.data.views && response.data.profile.views){
        response.data.profile.views = viewResponse.data.views;
      }
    });
    await loadPublicProfileRankingDetail(publicProfileIdValue, {
      category:state.profileRanking.public.category,
      selectedResultId:state.profileRanking.public.selectedResultId,
      returnTo:state.profileRanking.public.returnTo
    }).catch(err=>console.warn('Public profile ranking detail failed', err));
    return rendered;
  }
  return renderPublicDjProfile(null, response && response.status);
}

function openPublicDjProfileFromDiscovery(verifiedResultId){
  const row = state.verifiedResultsDiscovery.results.find(item => item.verifiedResultId === verifiedResultId);
  if(!row) return null;
  const profileIdValue = publicProfileId(row);
  if(state.verifiedResultsDiscovery.source === 'server') return loadPublicDjProfile(profileIdValue);
  return renderPublicDjProfile(localPublicProfileFromResult(row));
}

function renderVerifiedRankingsSummary(rankings = state.verifiedResultsDiscovery.rankings, targetId = 'rankings-verified-summary'){
  const target = document.getElementById(targetId);
  if(!target) return;
  const data = rankings || buildVerifiedPublicRankings(publicVerifiedResultsFromLocal());
  const categories = data && data.categories || {};
  const active = Object.entries(categories).filter(([,category]) => category.rows && category.rows.length);
  if(!active.length){
    target.innerHTML = '<div class="verified-ranking-category"><h4>No verified public rankings yet</h4><p style="color:var(--muted);margin:0">Public completed results will populate country-aware categories here.</p></div>';
    return;
  }
  target.innerHTML = active.map(([key,category]) => `<section class="verified-ranking-category" data-ranking-category="${esc(key)}"><h4>${esc(category.label)}</h4>${category.rows.slice(0,5).map(row => {
    const movement = Number(row.movement ?? row.ratingMovement ?? 0);
    const wins = Number(row.wins ?? row.eligibleWins ?? 0);
    const losses = Number(row.losses ?? row.eligibleLosses ?? 0);
    const ties = Number(row.ties ?? row.eligibleTies ?? 0);
    const battleCount = Number(row.qualifyingBattles ?? row.resultCount ?? 0);
    return `<div class="verified-ranking-row"><span>#${esc(row.rank)}</span><div><strong>${esc(row.djName)}</strong><small>${esc(countryCode(row.country))} ${esc(row.country)} - ${esc(row.belt)} - Rating ${esc(row.rating || 'N/A')} - ${esc(`${wins}-${losses}-${ties}`)} - ${esc(battleCount)} battle(s)</small></div><div class="verified-score-cell" style="padding:5px"><strong style="font-size:18px">${esc(row.averageScore)}</strong><span>${movement >= 0 ? '+' : ''}${esc(movement)}</span></div></div>`;
  }).join('')}</section>`).join('');
}

function renderProfileProgressionHistory(){
  const target = document.getElementById('profile-media');
  if(!target) return;
  target.className = 'profile-ranking-history-panel';
  const detailState = state.profileRanking.private;
  target.innerHTML = `<div class="profile-ranking-header">
    <div><span class="eyebrow accent">PRIVATE PROGRESSION HISTORY</span><h3>Server-Confirmed Ranking Impact</h3><p>Rating, XP, belt and eligibility are loaded from the authenticated ranking-history contract.</p></div>
    <button class="ghost small" type="button" id="profile-progression-refresh">Refresh</button>
  </div>
  <div class="profile-ranking-tabs">${rankingCategoryButtonsHtml(detailState.category, 'private')}</div>
  ${rankingDetailSummaryHtml(detailState, {
    scope:'owned',
    emptyTitle:'Private progression history',
    emptyText:'Sign in with server access to load your approved ranking history across categories.'
  })}`;
  const refresh = document.getElementById('profile-progression-refresh');
  if(refresh) refresh.onclick = () => loadPrivateProfileRankingDetail(detailState.category, { selectedResultId:detailState.selectedResultId }).catch(err=>console.warn('Private progression refresh failed', err));
  attachProfileRankingControls(target);
  document.querySelectorAll('[data-profile-tab]').forEach(button=>button.classList.toggle('active',button.dataset.profileTab===activeProfileTab));
}

function renderProfile(){
  const target=document.getElementById('profile-media'); if(!target) return;
  target.className = 'card-grid';
  let cards=[];
  if(activeProfileTab==='music'){
    const items=state.library.length?state.library.slice(0,6):[{name:'Your uploaded music will appear here',genre:'My Music'}];
    cards=items.map(t=>profileCard(t.name,`${t.genre||'Unsorted'} ${t.stems?'• Stems ready ✦':''}`));
  } else if(activeProfileTab==='history'){
    renderBattleHistory();
    return;
  } else if(activeProfileTab==='progression'){
    renderProfileProgressionHistory();
    if(state.profileRanking.private.status === 'idle'){
      loadPrivateProfileRankingDetail(state.profileRanking.private.category).catch(err=>console.warn('Initial private progression load failed', err));
    }
    return;
  } else if(activeProfileTab==='challenges'){
    renderChallengeInbox();
    if(['idle','offline'].includes(state.djChallenges.status)){
      loadDjChallengeInbox().catch(err=>console.warn('Initial challenge inbox load failed', err));
    }
    loadDjChallengeCount().catch(()=>{});
    return;
  } else if(activeProfileTab==='relationships'){
    renderProfileRelationshipPanel();
    if(['idle','offline'].includes(state.djRelationships.status)){
      loadDjRelationships().catch(err=>console.warn('Initial relationships load failed', err));
    }
    return;
  } else if(activeProfileTab==='feed'){
    renderDjActivityFeed();
    if(['idle','offline'].includes(state.djRelationships.feed.status)){
      loadDjActivityFeed().catch(err=>console.warn('Initial activity feed load failed', err));
    }
    return;
  } else if(activeProfileTab==='opponents'){
    renderOpponentHistoryPanel();
    if(['idle','offline'].includes(state.djRelationships.opponents.status)){
      loadOpponentHistory().catch(err=>console.warn('Initial opponent history load failed', err));
    }
    return;
  } else if(activeProfileTab==='preferences'){
    renderChallengePreferencesPanel();
    if(['idle','offline'].includes(state.djRelationships.preferences.status)){
      loadChallengePreferences().catch(err=>console.warn('Initial challenge preferences load failed', err));
    }
    return;
  } else if(activeProfileTab==='mixes'){
    cards=state.practiceHistory.length?state.practiceHistory.map(entry=>profileCard(entry.title||'Practice mix',`${entry.type||'Practice'} • ${entry.score||'—'} score • ${entry.date||''}`,'◉')):[profileCard('No local mix sessions yet','Complete a local practice session to track it here.','◉')];
  } else if(activeProfileTab==='battles'){
    cards=battles.slice(0,6).map(b=>profileCard(b.title,`${b.type} • ${b.genre} • ${b.time}`,'⚔'));
  } else if(activeProfileTab==='posts'){
    const posts=state.posts.filter(isOwnLocalPost);
    cards=posts.length?posts.map(post=>profileCard(post.title,`${post.room} • ${post.time}`,'☷')):[profileCard('No local posts yet','Posts created in this browser appear here.','☷')];
  } else {
    const belt=document.getElementById('profile-belt')?.textContent||'White';
    cards=[profileCard(`${belt} Belt`, 'Local belt progress', '◆'),profileCard(`${state.practiceHistory.length} practice sessions`, 'Local practice history', '★')];
  }
  target.innerHTML=cards.join('');
  document.querySelectorAll('[data-profile-tab]').forEach(button=>button.classList.toggle('active',button.dataset.profileTab===activeProfileTab));
}
document.querySelectorAll('[data-profile-tab]').forEach(button=>button.onclick=()=>{activeProfileTab=button.dataset.profileTab;renderProfile();});

// Platform library renderer
function renderPlatformLibrary(){
  const target=document.getElementById('platform-library');
  if(!target) return;
  target.innerHTML = state.platformLibrary.map(t=>`<div class="media-card" style="padding:10px;display:flex;justify-content:space-between;align-items:center"><div><strong>${esc(t.title)}</strong><div style="color:var(--muted);font-size:12px">${esc(t.artist)} • ${esc(t.genre||'—')}</div></div><div style="text-align:right"><div style="font-weight:700;color:var(--accent)">${t.battleEligible? 'APPROVED' : 'NOT APPROVED'}</div><div style="margin-top:6px"><button class="ghost" data-use-platform="${esc(t.id)}">Use</button></div></div></div>`).join('');
  document.querySelectorAll('[data-use-platform]').forEach(b=>b.onclick=(e)=>{
    const id=e.currentTarget.dataset.usePlatform;
    const t = state.platformLibrary.find(x=>String(x.id)===String(id));
    if(!t) return;
    openModal(`<span class="eyebrow accent">PLATFORM TRACK</span><h3>${esc(t.title)}</h3><p style="color:var(--muted)">Platform-approved track - ${t.battleEligible? 'Eligible for battles':'Not approved'}</p><div class="modal-actions"><button class="ghost" value="cancel">Close</button><button class="primary" id="br-use">Load into Studio</button></div>`);
    setTimeout(()=>{
      const btn=document.getElementById('br-use');
      if(btn) btn.onclick=()=>{
        const deck = getFocusedDeck();
        const result = loadLibraryTrackToDeck(`platform:${id}`, deck);
        if(result.ok){
          document.getElementById('modal').close();
          switchView('studio');
        }
      };
    },0);
  });
}

async function addTrackToPlaylist(track){
  if(!track) return { ok:false, error:'Track is unavailable.' };
  const normalized = track.libraryId ? track : normalizeLibraryTrack(track, 'my', 0);
  let target = state.playlists.find(crate => !crate.builtIn && ['playlist','crate','battle_prep'].includes(crate.type || 'playlist'));
  if(!target){
    const created = await createLibraryCrateOptimistic({ name:'My Playlist', type:'playlist', visibility:'private' });
    target = created.crate;
  }
  const result = await addTracksToCrate(crateLibraryId(target.id), [normalized.libraryId]);
  if(result.ok) setMusicLibrarySyncStatus(state.musicLibrarySync.status || 'offline', { error:'' });
  return result;
}

// Copyright check simulator
async function runCopyrightCheck(track){ if(!track) return; track.copyrightCheck='Checking'; persist(); renderLibrary(); await new Promise(r=>setTimeout(r,800)); const rand=Math.random(); if(rand<0.6) track.copyrightCheck='No Match Found'; else if(rand<0.85) track.copyrightCheck='Possible Copyright Match'; else track.copyrightCheck='Cleared'; persist(); }

async function renderOfficialRankings(){
  renderRankingsPage();
  renderVerifiedRankingsSummary();
}
renderOfficialRankings();

function openModal(html){document.getElementById('modal-content').innerHTML=html;document.getElementById('modal').showModal();}
studioStreamingManager = StudioModules.streaming.create({
  document,
  state,
  esc,
  now: () => Date.now(),
  openModal,
  persist,
  renderLibrary,
  renderLibraryCrateList,
  renderStudioLibrary: q => renderStudioLibrary(q),
  setStudioRuleStatus,
  localStorage,
  getStudioSearchValue: () => document.getElementById('studio-search')?.value || ''
});
playlistTransferManager = StudioModules.playlistTransfer.create({
  window,
  document,
  state,
  now: () => Date.now(),
  FileReader: window.FileReader,
  localStorage,
  persist,
  renderLibrary,
  renderStudioLibrary: q => renderStudioLibrary(q),
  setStudioRuleStatus,
  getLibraryCrateById,
  allLibraryCrates,
  resolveCrateTrackIds,
  getLibraryTrackById,
  trackTitle,
  trackArtist,
  parseBpm,
  secureArtworkSource,
  trackSource,
  rawServerTrackIdForMembership,
  securePlaybackSource
});
studioBrowserManager = StudioModules.browser.create({
  window,
  document,
  state,
  esc,
  allLibraryTracks,
  matchesLibrarySearch,
  normalizedDeckRecord,
  compatibleTracksFor,
  allLibraryCrates,
  resolveCrateTrackIds,
  getLibraryTrackById,
  trackTitle,
  libraryTrackLoadEligibility,
  artworkMarkup,
  keyBadgeHtml,
  loadLibraryTrackToDeck,
  getFocusedDeck,
  renderStreamingServices,
  renderStreamBrowser,
  streamingCatalogRows,
  importStreamingMetadataRow
});
deckRuntimeManager = StudioModules.deckRuntime.create({
  window,
  document,
  state,
  localStorage,
  esc,
  now: () => Date.now(),
  getLibraryTrackById,
  libraryTrackLoadEligibility,
  normalizedDeckRecord,
  ensureLibraryPlaybackAccess,
  activeStudioBattleSession,
  battlePrepSnapshotForUser,
  persistActiveBattleSession,
  recordLibraryTrackUsageLocal,
  persistStudioDeckState,
  setStudioRuleStatus,
  getLibraryCrateById,
  allLibraryCrates,
  resolveCrateTrackIds,
  allLibraryTracks,
  sortLibraryTracks,
  compatibleTracksFor,
  trackTitle,
  trackArtist,
  parseBpm,
  keyBadgeHtml,
  artworkMarkup,
  securePlaybackSource,
  loadNextFromBattlePrepCrate
});
function openPremium(msg='Premium unlocks stems, higher storage limits, own-selection battles and advanced analysis.') {openModal(`<span class="eyebrow accent">DJ BATTLE PREMIUM</span><h3>More tools. Same fair rules.</h3><p style="color:var(--muted);line-height:1.6">${msg}</p><div class="panel" style="margin:16px 0"><strong>Premium benefits</strong><p>AI stem separation<br>Stem-enabled battles<br>More cloud-library storage<br>Own-selection battles<br>Advanced analysis</p></div><div class="modal-actions"><button class="ghost" value="cancel">Not now</button><button class="primary" type="button" id="enable-premium">Enable Premium</button></div>`);setTimeout(()=>document.getElementById('enable-premium').onclick=()=>{state.premium=true;document.getElementById('modal').close();renderLibrary();alert('Premium enabled for this session.');},0)}
document.querySelector('[data-action="premium"]').onclick=()=>openPremium();

// Battle creation shell
document.getElementById('create-battle').onclick=()=>openModal(`<span class="eyebrow accent">CREATE BATTLE</span><h3>Battle Rules</h3><div class="form-grid"><label>Battle type<select id="new-battle-type"><option>Transition Battle</option><option>Ahh / Fresh Scratch Battle</option><option>Song-to-Song Scratch Battle</option><option>5-Song Mix</option><option>30-Minute Mix</option><option>60-Minute Mix</option></select></label><label>Genre<select id="new-battle-genre"><option>EDM</option><option>Hip-Hop</option><option>Bass House</option><option>Tech House</option><option>Dubstep</option><option>Drum &amp; Bass</option><option>Riddim</option><option>UK Garage</option><option>Scratch</option></select></label><label>Prep time<select id="new-battle-time"><option value="10 min">10 minutes</option><option value="20 min">20 minutes</option><option value="30 min">30 minutes</option><option value="60 min">60 minutes</option></select></label><label class="toggle-row">Allow stems <input id="new-battle-stems" type="checkbox"></label><label class="toggle-row">AI judging <input id="new-battle-ai" type="checkbox" checked></label><label class="toggle-row">Community judging <input id="new-battle-community" type="checkbox" checked></label></div><div class="modal-actions"><button class="ghost" value="cancel">Cancel</button><button class="primary" type="button" id="save-new-battle">Create Draft</button></div>`);setTimeout(()=>{const saveBtn=document.getElementById('save-new-battle');if(!saveBtn)return;saveBtn.onclick=()=>{const type=document.getElementById('new-battle-type').value;const genre=document.getElementById('new-battle-genre').value;const time=document.getElementById('new-battle-time').value;const stems=document.getElementById('new-battle-stems').checked;const ai=document.getElementById('new-battle-ai').checked;const community=document.getElementById('new-battle-community').checked;const title=`${genre} ${type}`;const newBattle={id:Date.now(),type,genre,title,tracks:stems?'Own selection':'2 assigned',selection:stems?'DJ-selected':'Assigned',time,stems,people:Math.floor(10+Math.random()*18),desc:`${type} battle in ${genre}. ${ai&&community?'AI + community judging is active.':ai?'AI judging is active.':'Community judging is active.'}`,judging: ai&&community ? 'Hybrid (AI + Community)' : ai ? 'AI Only' : 'Community Only'};battles.unshift(newBattle);persistBattles();renderBattles();document.getElementById('modal').close();};},0);

function openCreateBattleModal(){
  const modes = BattleModes.listBattleModes();
  const firstMode = modes[0];
  const modeOptions = modes.map(m=>`<option value="${m.id}">${esc(m.label)}${m.premiumRequired?' (Premium)':''}</option>`).join('');
  const rewardOptions = BattleModes.REWARD_TYPES.map(type=>`<option value="${type}">${esc(type.replace('_',' '))}</option>`).join('');
  openModal(`<span class="eyebrow accent">CREATE BATTLE</span><h3>Battle Rules</h3><div class="form-grid"><label>Battle mode<select id="new-battle-mode">${modeOptions}</select></label><label>Title<input id="new-battle-title" placeholder="Optional battle title"></label><label>Genre<select id="new-battle-genre">${GENRES.map(g=>`<option value="${g}" ${g===firstMode.defaultGenre?'selected':''}>${g}</option>`).join('')}</select></label><label>Duration<select id="new-battle-duration"></select></label><label>Track rule<select id="new-battle-track-rule"><option value="assigned">Assigned tracks</option><option value="own_selection">Own selection</option><option value="genre_pool">Genre pool</option><option value="open_library">Open library</option><option value="ai_practice">AI practice</option></select></label><label>Track count<input id="new-battle-track-count" type="number" min="1" max="40"></label><label>Opponent<select id="new-battle-opponent"><option value="required">Required</option><option value="optional">Optional</option><option value="none">None</option></select></label><label>Visibility<select id="new-battle-visibility"><option value="public">Public</option><option value="private">Private</option><option value="available">Available</option></select></label><label>Reward<select id="new-battle-reward">${rewardOptions}</select></label><label>Bitcoin sats<input id="new-battle-sats" type="number" min="0" step="1" placeholder="Metadata only"></label><label>Battle Prep crate<select id="new-battle-prep-crate">${battlePrepCrateSelectHtml()}</select></label></div><div id="new-battle-prep-status" class="battle-prep-entry-status">${battlePrepEntryValidationHtml(null)}</div><div id="new-battle-error" style="color:#ff8f8f;margin-top:10px"></div><div class="modal-actions"><button class="ghost" value="cancel">Cancel</button><button class="primary" type="button" id="save-new-battle">Create Battle</button></div>`);
  setTimeout(()=>{
    const modeSelect=document.getElementById('new-battle-mode');
    const buildDraftFromInputs=()=>{
      const modeId=document.getElementById('new-battle-mode').value;
      const cfg = BattleModes.getBattleMode(modeId);
      const rewardType=document.getElementById('new-battle-reward').value;
      const reward = { type: rewardType, metadata:{} };
      if(rewardType === 'bitcoin'){
        reward.metadata = { network:'bitcoin', custody:'external_pending', walletConnected:false, amountSats:Number(document.getElementById('new-battle-sats').value || 0) };
      }
      const trackCountValue = document.getElementById('new-battle-track-count').value;
      return {
        modeId,
        title: document.getElementById('new-battle-title').value || undefined,
        genre: document.getElementById('new-battle-genre').value,
        durationMinutes: Number(document.getElementById('new-battle-duration').value),
        trackSelectionMethod: document.getElementById('new-battle-track-rule').value,
        trackCount: trackCountValue ? Number(trackCountValue) : cfg.trackCount,
        minimumTrackCount: cfg.minimumTrackCount,
        opponentRequirement: document.getElementById('new-battle-opponent').value,
        visibility: document.getElementById('new-battle-visibility').value,
        reward,
        createdBy: currentProfileUserId(),
        status: 'open',
        people: 0
      };
    };
    const renderPrepValidation=()=>{
      const target = document.getElementById('new-battle-prep-status');
      const selectedCrate = document.getElementById('new-battle-prep-crate')?.value || '';
      const validation = validateBattlePrepCrateForBattle(selectedCrate, buildDraftFromInputs());
      if(target) target.innerHTML = battlePrepEntryValidationHtml(validation);
      return validation;
    };
    const applyModeDefaults=()=>{
      const cfg = BattleModes.getBattleMode(modeSelect.value);
      document.getElementById('new-battle-duration').innerHTML = cfg.allowedDurations.map(minutes=>`<option value="${minutes}" ${minutes===cfg.defaultDurationMinutes?'selected':''}>${minutes} minutes</option>`).join('');
      document.getElementById('new-battle-track-rule').value = cfg.trackSelectionMethod;
      document.getElementById('new-battle-track-count').value = cfg.trackCount || cfg.minimumTrackCount || '';
      document.getElementById('new-battle-opponent').value = cfg.opponentRequirement;
      document.getElementById('new-battle-reward').value = cfg.rewardType;
      if(cfg.defaultGenre && GENRES.includes(cfg.defaultGenre)) document.getElementById('new-battle-genre').value = cfg.defaultGenre;
      renderPrepValidation();
    };
    modeSelect.onchange=applyModeDefaults;
    applyModeDefaults();
    ['new-battle-genre','new-battle-duration','new-battle-track-rule','new-battle-track-count','new-battle-prep-crate','new-battle-reward','new-battle-sats'].forEach(id=>{
      const el=document.getElementById(id);
      if(el) el.onchange=renderPrepValidation;
    });
    const saveBtn=document.getElementById('save-new-battle'); if(!saveBtn)return;
    saveBtn.onclick=async ()=>{
      const draft = buildDraftFromInputs();
      const result = BattleModes.createBattleRecord(draft, { isPremium: state.premium, requireAssignedTracks:false });
      const err=document.getElementById('new-battle-error');
      if(result.error){ err.textContent = result.error.map(item=>item.message).join(' '); return; }
      const selectedCrate = document.getElementById('new-battle-prep-crate')?.value || '';
      const validation = renderPrepValidation();
      if(selectedCrate && !validation.ready){ err.textContent = validation.blockers.join(' '); return; }
      let battle = result.battle;
      battle.assignedTracks = resolveBattleTracks(battle);
      if(selectedCrate && battlePrepServerApiAvailable() && serverBackedBattlePrepCrate(selectedCrate)){
        saveBtn.disabled = true;
        err.textContent = 'Syncing Battle Prep snapshot...';
        const serverResult = await createAuthenticatedBattleWithPrepSnapshot(draft, selectedCrate, battle, validation);
        saveBtn.disabled = false;
        if(serverResult.error){ err.textContent = serverResult.error; return; }
        if(serverResult.battle){
          battle = serverResult.battle;
          battle.assignedTracks = resolveBattleTracks(battle);
          battle.people = battle.participants.length;
          battles.unshift(battle);
          persistBattles();
          renderBattles();
          document.getElementById('modal').close();
          return;
        }
        err.textContent = serverResult.skipped ? 'Server unavailable; saved as an unsynced local Battle Prep snapshot.' : '';
      }
      if(selectedCrate && validation.ready){
        const snapshot = buildBattlePrepEntrySnapshot(selectedCrate, battle, validation, currentProfileUserId());
        battle = attachBattlePrepSnapshotToBattle(battle, snapshot, currentProfileUserId());
      }
      battle.people = battle.participants.length;
      battles.unshift(battle);
      persistBattles();
      renderBattles();
      document.getElementById('modal').close();
    };
  },0);
}
document.getElementById('create-battle').onclick=openCreateBattleModal;

// Battle session flow: start a battle room using the shared battle lifecycle.
function startBattleSession(battle, opts={}){
  const record = BattleModes.normalizeBattleRecord(battle);
  const activated = record.status === 'active'
    ? { battle: record }
    : BattleModes.activateBattle(record, { userId: currentProfileUserId(), now: new Date().toISOString() });
  const activeBattle = activated.battle || record;
  const battlePrepSnapshot = battlePrepSnapshotForUser(activeBattle);
  const ownEntry = (activeBattle.entries || {})[currentProfileUserId()] || {};
  const session = {
    id: activeBattle.id,
    battleId: activeBattle.id,
    modeId: activeBattle.modeId,
    title: activeBattle.title || 'Battle',
    type: activeBattle.type || activeBattle.title || 'Practice',
    mode: opts.mode || activeBattle.type || 'Battle',
    genre: opts.genre || activeBattle.genre || 'Open Format',
    duration: Number(opts.duration || activeBattle.durationMinutes || 10),
    opponent: opts.opponent || null,
    assigned: opts.assigned || activeBattle.assignedTracks || [],
    rules: BattleModes.buildBattleRules(activeBattle),
    reward: activeBattle.reward,
    participants: activeBattle.participants || [],
    entries: activeBattle.entries || {},
    battlePrepSnapshot,
    battlePrepSnapshotId: battlePrepSnapshot && battlePrepSnapshot.id || null,
    battlePrepSnapshotVersion: battlePrepSnapshot && battlePrepSnapshot.snapshotVersion || ownEntry.battlePrepSnapshotVersion || null,
    battleEntryId: ownEntry.serverBattleEntryId || ownEntry.battleEntryId || battlePrepSnapshot && battlePrepSnapshot.battleEntryId || null,
    battlePrepSyncStatus: battlePrepSnapshot && battlePrepSnapshot.syncStatus || ownEntry.battlePrepSyncStatus || (battlePrepSnapshot ? 'local_unsynced' : ''),
    startedAt: activeBattle.startedAt || null,
    status: activeBattle.status || 'active',
    submissionId: activeBattle.submissionId || null
  };
  const idx = battles.findIndex(x=>String(x.id)===String(activeBattle.id));
  if(idx >= 0){ battles[idx] = activeBattle; persistBattles(); }
  window.activeBattleSession = session;
  persistActiveBattleSession(session);
  renderBattleRoom(session);
  if(session.deadlineAt) applyServerBattleTimer(session, { deadlineAt:session.deadlineAt, remainingSeconds:Math.max(0, Math.floor((new Date(session.deadlineAt).getTime() - Date.now()) / 1000)) });
  else resetTimer(session.duration);
  document.getElementById('br-status').textContent = formatBattleStatus(session.status);
  switchView(opts.view === 'studio' ? 'studio' : 'battle-room');
  if(session.battleEntryId && (!battlePrepSnapshot || battlePrepSnapshot.serverBacked)) hydrateServerBattlePrepSnapshot(session.battleEntryId, { session }).catch(err => console.warn('Battle Prep snapshot hydration failed', err));
  if(session.battleEntryId && session.battlePrepSyncStatus === 'server') scheduleBattleRoomLiveSync(session);
}

function formatBattleStatus(status){ return String(status || 'ready').replace(/_/g,' ').replace(/\b\w/g, c=>c.toUpperCase()); }

function renderBattleRoom(session){
  if(!session) return;
  document.getElementById('br-title').textContent = session.title;
  document.getElementById('br-mode').textContent = session.mode;
  document.getElementById('br-genre').textContent = session.genre;
  document.getElementById('br-duration').textContent = `${session.duration} min`;
  document.getElementById('br-dj1-name').textContent = document.getElementById('profile-name')?.textContent || 'You';
  document.getElementById('br-dj1-meta').textContent = `${document.getElementById('profile-belt')?.textContent || 'Unranked'}`;
  if(session.opponent){
    document.getElementById('br-dj2-name').textContent = session.opponent.name || 'Opponent';
    document.getElementById('br-dj2-meta').textContent = `${session.opponent.country || ''} • ${session.opponent.record || ''}`;
    document.getElementById('br-dj2-belt').textContent = session.opponent.belt || '—';
  } else {
    document.getElementById('br-dj2-name').textContent = 'Solo Mode';
    document.getElementById('br-dj2-meta').textContent = 'AI Rating';
    document.getElementById('br-dj2-belt').textContent = '—';
  }
  const tracksWrap = document.getElementById('br-tracks'); tracksWrap.innerHTML='';
  const assignedTracks = Array.isArray(session.assigned) ? session.assigned : [];
  assignedTracks.forEach((t,i)=>{ const div = document.createElement('div'); div.className='track'; div.innerHTML = `<div>♫ <strong>${esc(t)}</strong></div><div style="color:var(--muted)">BPM — — • Key —</div>`; tracksWrap.appendChild(div); });
  const prepSnapshot = battlePrepSnapshotForUser(session);
  if(prepSnapshot){
    const div = document.createElement('div');
    div.className = 'track battle-prep-snapshot-track';
    const label = prepSnapshot.purpose === 'reference' ? 'Prep/reference crate' : 'Own-selection crate';
    div.innerHTML = `<div><strong>${esc(label)}</strong> <span style="color:var(--accent)">${esc(prepSnapshot.crateName)}</span></div><div style="color:var(--muted)">${esc((prepSnapshot.tracks || []).length)} validated track(s) frozen for this entry. Later crate edits will not change this battle.</div>`;
    tracksWrap.appendChild(div);
  }
  document.getElementById('br-track-count').textContent = `${assignedTracks.length} track(s)`;
  renderBattleRoomLiveState(session);

  // wire controls
  document.getElementById('br-start').onclick = ()=>{
    if(session.status === 'finished') return;
    session.startedAt = session.startedAt || Date.now();
    session.status = 'running';
    document.getElementById('br-status').textContent = 'Running';
    // start clock
    if(!timerInt){ document.getElementById('br-timer-note').textContent = 'Live'; timerInt=setInterval(()=>{ timerSeconds--; timerText(); if(timerSeconds<=0){ clearInterval(timerInt); timerInt=null; session.status='finished'; document.getElementById('br-status').textContent='Finished'; document.getElementById('br-timer-note').textContent='Time up'; } },1000); }
  };
  document.getElementById('br-pause').onclick = ()=>{ if(timerInt){ clearInterval(timerInt); timerInt=null; document.getElementById('br-status').textContent='Paused'; document.getElementById('br-timer-note').textContent='Paused'; } else { document.getElementById('br-start').click(); } };
  document.getElementById('br-end').onclick = ()=>{ if(timerInt){ clearInterval(timerInt); timerInt=null; } session.status='finished'; document.getElementById('br-status').textContent='Finished'; document.getElementById('br-timer-note').textContent='Ended'; };

  // upload handlers
  const uploadFile = document.getElementById('br-upload-file'); const uploadStatus = document.getElementById('br-upload-status'); const uploadProgress = document.querySelector('#br-upload-progress i');
  const setUploadStatus = status=>{ uploadStatus.textContent=status; uploadProgress.style.width=({Draft:'0%', 'Preparing upload':'20%', Uploading:'60%', Verifying:'85%', Uploaded:'90%', Judging:'95%', Completed:'100%', Failed:'100%'}[status]||'0%'); if(['Uploaded','Judging','Completed','Failed'].includes(status)) renderBattleResultProgress(session, status.toLowerCase(), { submissionId:session.submissionId }); };
  uploadFile.onchange = e=>{ const file=e.target.files[0]; const error=window.DJBattleSubmission?.validateFile(file); if(error){ setUploadStatus('Failed'); alert(error); return; } if(file){ setUploadStatus('Draft'); uploadStatus.textContent=`Draft: ${file.name}`; uploadStatus.title=file.name; } };
  const submitSecureMix = async ()=>{
    const file=uploadFile.files[0] || window.lastRecordedMixFile; if(!file){ alert('Choose a mix file first.'); return; }
    const result=await window.DJBattleSubmission.submitMix({ apiRequest:window.DJBattleApi.apiRequest, supabase:window.supabase, battleId:session.id, file, onStatus:setUploadStatus, battleContext:buildBattleSubmissionContext(session) });
    if(result.error){ setUploadStatus('Failed'); alert(result.error); return; }
    const completedFromPoll = await completeFromJudgingEndpoint(session, result.submissionId, setUploadStatus, { attempts: 2, intervalMs: 1500 });
    if(completedFromPoll && completedFromPoll.battle) return;
    document.getElementById('br-judge-placeholder').innerHTML='<div class="panel"><strong>Mix uploaded securely.</strong><p style="color:var(--muted)">Waiting for processing.</p></div>';
  };
  document.getElementById('br-upload-btn').onclick=submitSecureMix;
  document.getElementById('br-submit-btn').onclick=submitSecureMix;
  window.DJBattleSubmission?.recoverSubmission({ apiRequest:window.DJBattleApi.apiRequest, battleId:session.id }).then(async result=>{ if(result?.data?.submission?.status){ setUploadStatus(result.data.submission.status === 'uploaded' ? 'Uploaded' : result.data.submission.status); if(result.data.submission.id) await completeFromJudgingEndpoint(session, result.data.submission.id, setUploadStatus, { attempts: 2, intervalMs: 1500 }); } });

  document.getElementById('br-leave').onclick = ()=>{ if(timerInt){ clearInterval(timerInt); timerInt=null; } switchView('battles'); };
  wireLifecycleBattleRoom(session);
}

function wireLifecycleBattleRoom(session){
  document.getElementById('br-status').textContent = formatBattleStatus(session.status);
  renderBattleStudioContext(session);
  renderBattleRoomLiveState(session);
  const readyBtn = document.getElementById('br-ready');
  if(readyBtn) readyBtn.onclick = async () => {
    const result = await setServerBattleReady(session, true);
    if(result.error) alert(result.error);
  };
  const notReadyBtn = document.getElementById('br-not-ready');
  if(notReadyBtn) notReadyBtn.onclick = async () => {
    const result = await setServerBattleReady(session, false);
    if(result.error) alert(result.error);
  };
  const serverStartBtn = document.getElementById('br-server-start');
  if(serverStartBtn) serverStartBtn.onclick = async () => {
    const result = await startServerBattleFromRoom(session);
    if(result.error) alert(result.error);
  };
  const cancelBtn = document.getElementById('br-cancel');
  if(cancelBtn) cancelBtn.onclick = async () => {
    const result = await cancelServerBattleFromRoom(session);
    if(result.error) alert(result.error);
  };
  const withdrawBtn = document.getElementById('br-withdraw');
  if(withdrawBtn) withdrawBtn.onclick = async () => {
    const result = await withdrawServerBattleEntryFromRoom(session);
    if(result.error) alert(result.error);
  };
  const uploadFile = document.getElementById('br-upload-file');
  const uploadStatus = document.getElementById('br-upload-status');
  const uploadProgress = document.querySelector('#br-upload-progress i');
  const setUploadStatus = status=>{
    if(uploadStatus) uploadStatus.textContent=status;
    if(uploadProgress) uploadProgress.style.width=({Draft:'0%', 'Preparing upload':'20%', Uploading:'60%', Verifying:'85%', Uploaded:'90%', Judging:'95%', Completed:'100%', Failed:'100%'}[status]||'0%');
    if(['Uploaded','Judging','Completed','Failed'].includes(status)) renderBattleResultProgress(session, status.toLowerCase(), { submissionId:session.submissionId });
  };
  document.getElementById('br-start').onclick = ()=>{
    if(session.battleEntryId && session.battlePrepSyncStatus === 'server'){
      startServerBattleFromRoom(session).then(result => { if(result.error) alert(result.error); });
      return;
    }
    if(session.status === 'completed') return;
    session.startedAt = session.startedAt || Date.now();
    session.status = 'active';
    persistActiveBattleSession(session);
    document.getElementById('br-status').textContent = formatBattleStatus(session.status);
    renderBattleStudioContext(session);
    if(!timerInt){
      document.getElementById('br-timer-note').textContent = 'Live';
      timerInt=setInterval(()=>{
        timerSeconds--;
        timerText();
        if(timerSeconds<=0){
          clearInterval(timerInt);
          timerInt=null;
          session.status='submission_pending';
          persistActiveBattleSession(session);
          document.getElementById('br-status').textContent=formatBattleStatus(session.status);
          document.getElementById('br-timer-note').textContent='Time up';
        }
      },1000);
    }
  };
  document.getElementById('br-end').onclick = ()=>{
    if(timerInt){ clearInterval(timerInt); timerInt=null; }
    session.status='submission_pending';
    persistActiveBattleSession(session);
    document.getElementById('br-status').textContent=formatBattleStatus(session.status);
    document.getElementById('br-timer-note').textContent='Ended';
  };
  if(uploadFile){
    uploadFile.onchange = e=>{
      window.pendingBattleSubmissionSource = 'uploaded_mix';
      const file=e.target.files[0];
      const error=window.DJBattleSubmission?.validateFile(file);
      if(error){ setUploadStatus('Failed'); alert(error); return; }
      if(file){ setUploadStatus('Draft'); uploadStatus.textContent=`Draft: ${file.name}`; uploadStatus.title=file.name; }
    };
  }
  const submitSecureMix = async ()=>{
    if(session.submissionId && !['failed','retryable_failed'].includes(String(session.submissionStatus || '').toLowerCase())){
      alert('This battle entry already has a submission in progress.');
      return;
    }
    const file=(uploadFile && uploadFile.files && uploadFile.files[0]) || window.lastRecordedMixFile;
    if(!file){ alert('Choose a mix file first.'); return; }
    if(!window.DJBattleSubmission || !window.DJBattleApi){ alert('Authenticated upload is unavailable.'); return; }
    const submissionSource = window.pendingBattleSubmissionSource === 'battle_studio' ? 'battle_studio' : 'uploaded_mix';
    window.pendingBattleSubmissionSource = 'uploaded_mix';
    const result=await window.DJBattleSubmission.submitMix({ apiRequest:window.DJBattleApi.apiRequest, supabase:window.supabase, battleId:session.battleId || session.id, file, onStatus:setUploadStatus, battleContext:buildBattleSubmissionContext(session), submissionSource });
    if(result.error){ setUploadStatus('Failed'); alert(result.error); return; }
    session.submissionId = result.submissionId;
    session.submissionStatus = 'uploaded';
    session.status = 'submission_pending';
    persistActiveBattleSession(session);
    const idx = battles.findIndex(x=>String(x.id)===String(session.battleId || session.id));
    if(idx >= 0){
      const marked = BattleModes.markSubmissionUploaded(battles[idx], { userId: currentProfileUserId(), submissionId: result.submissionId, now: new Date().toISOString() });
      if(!marked.error){ battles[idx] = marked.battle; persistBattles(); }
    }
    document.getElementById('br-status').textContent = formatBattleStatus(session.status);
    const judgeResult = normalizeJudgeResultFromResponse(result);
    if(judgeResult){
      const completed = completeBattleWithJudgeResult(session, judgeResult, result.submissionId);
      if(completed && !completed.error) return;
      if(completed && completed.error) console.warn('completeBattleWithJudgeResult failed', completed.error);
    }
    const completedFromPoll = await completeFromJudgingEndpoint(session, result.submissionId, setUploadStatus);
    if(session.battleEntryId && session.battlePrepSyncStatus === 'server') fetchServerBattleRoomState(session).catch(err=>console.warn('Battle room submission sync failed', err));
    if(completedFromPoll && completedFromPoll.battle) return;
    document.getElementById('br-judge-placeholder').innerHTML='<div class="panel"><strong>Mix uploaded securely.</strong><p style="color:var(--muted)">Submission is saved and waiting for server-side judging. No score is fabricated while analysis is unavailable.</p></div>';
  };
  document.getElementById('br-upload-btn').onclick=submitSecureMix;
  document.getElementById('br-submit-btn').onclick=submitSecureMix;
  window.DJBattleSubmission?.recoverSubmission({ apiRequest:window.DJBattleApi.apiRequest, battleId:session.battleId || session.id }).then(async result=>{
    if(result?.data?.submission?.status){
      setUploadStatus(result.data.submission.status === 'uploaded' ? 'Uploaded' : result.data.submission.status);
      if(result.data.submission.id) session.submissionId = result.data.submission.id;
      persistActiveBattleSession(session);
      const judgeResult = normalizeJudgeResultFromResponse(result);
      if(judgeResult){
        const completed = completeBattleWithJudgeResult(session, judgeResult, session.submissionId);
        if(completed && completed.error) console.warn('recover completed battle failed', completed.error);
      }
      await completeFromJudgingEndpoint(session, session.submissionId, setUploadStatus, { attempts: 2, intervalMs: 1500 });
    }
  });
  document.getElementById('br-leave').onclick = ()=>{ if(timerInt){ clearInterval(timerInt); timerInt=null; } stopBattleRoomLiveSync(); persistActiveBattleSession(session); switchView('battles'); };
  if(session.battleEntryId && session.battlePrepSyncStatus === 'server') scheduleBattleRoomLiveSync(session);
}

function renderBattleStudioContext(session){
  const miniMode=document.getElementById('mini-mode'); if(miniMode) miniMode.textContent=session.mode || session.type || 'Battle';
  const miniGenre=document.getElementById('mini-genre'); if(miniGenre) miniGenre.textContent=session.genre || 'Global';
  const clockText=document.getElementById('br-clock')?.textContent || `${String(session.duration||10).padStart(2,'0')}:00`;
  const miniClock=document.getElementById('mini-battle-clock'); if(miniClock) miniClock.textContent=clockText;
  const mainClock=document.getElementById('battle-clock'); if(mainClock) mainClock.textContent=clockText;
  const miniDj1=document.getElementById('mini-dj1'); if(miniDj1) miniDj1.textContent=currentUser().displayName;
  const miniDj2=document.getElementById('mini-dj2'); if(miniDj2) miniDj2.textContent=session.opponent ? (session.opponent.name || 'Opponent') : 'Solo Mode';
  const miniMeta2=document.getElementById('mini-meta2'); if(miniMeta2) miniMeta2.textContent=session.opponent ? `${session.opponent.belt || ''} ${session.opponent.record || ''}`.trim() : 'AI high-score mode';
}

function ensureAudioGraph(){
  return deckRuntimeManager ? deckRuntimeManager.ensureAudioGraph() : { ok:false, error:'Deck runtime module unavailable.' };
}
function applyMix(){
  return deckRuntimeManager ? deckRuntimeManager.applyMix() : undefined;
}
function teardownDeckAudioGraph(){
  return deckRuntimeManager ? deckRuntimeManager.teardownAudioGraph() : Promise.resolve({ ok:false, error:'Deck runtime module unavailable.' });
}
function getDeckRuntimeDiagnostics(){
  return deckRuntimeManager ? deckRuntimeManager.diagnostics() : {};
}

const studioRecordingManager = StudioModules.recording.create({
  window,
  document,
  state,
  localStorage,
  esc,
  now: () => Date.now(),
  ensureAudioGraph,
  getAudioContext: () => deckRuntimeManager && deckRuntimeManager.getAudioContext(),
  getRecordingDestination: () => deckRuntimeManager && deckRuntimeManager.getRecordingDestination(),
  getMediaRecorder: () => window.MediaRecorder,
  activeStudioBattleSession,
  switchView
});
const controllerMappingManager = StudioModules.controller.create({
  window,
  document,
  state,
  localStorage,
  esc,
  readableComponentName,
  getNavigator: () => navigator
});
const audioSetupManager = StudioModules.audio.create({
  window,
  document,
  state,
  esc,
  readableComponentName,
  getMediaDevices: () => navigator.mediaDevices,
  updateRecordingUi
});

function isStudioRecordingActive(){ return studioRecordingManager.isActive(); }
function recordingElapsedText(ms){ return studioRecordingManager.elapsedText(ms); }
function persistStudioRecordingState(){ return studioRecordingManager.persist(); }
function updateRecordingUi(){ return studioRecordingManager.updateUi(); }
function animateRecordingMeters(active){ return studioRecordingManager.animateMeters(active); }
function armStudioRecording(){ return studioRecordingManager.arm(); }
function startStudioRecording(){ return studioRecordingManager.start(); }
function stopStudioRecording(){ return studioRecordingManager.stop(); }
function renderRecordingWaveform(){ return studioRecordingManager.renderWaveform(); }
function restartStudioRecording(){ return studioRecordingManager.restart(); }
function saveRecordingDraft(){ return studioRecordingManager.saveDraft(); }
function submitStudioRecording(){ return studioRecordingManager.submit(); }
function wireStudioRecordingControls(){ return studioRecordingManager.wireControls(); }

function persistControllerState(){ return controllerMappingManager.persist(); }
function renderControllerPanel(){ return controllerMappingManager.renderPanel(); }
function midiMappingStatus(inputName){ return controllerMappingManager.midiMappingStatus(inputName); }
function handleMidiMessage(event){ return controllerMappingManager.handleMidiMessage(event); }
function scanMidiControllers(){ return controllerMappingManager.scanControllers(); }
function renderAudioSetupPanel(){ return audioSetupManager.renderPanel(); }
function refreshAudioDevices(){ return audioSetupManager.refreshDevices(); }
function wireControllerAndAudioControls(){ controllerMappingManager.wireControls(); audioSetupManager.wireControls(); }
function wireDeckRuntimeControls(){ return deckRuntimeManager ? deckRuntimeManager.wireControls() : undefined; }
wireDeckRuntimeControls();
wireStudioRecordingControls();
const stemUnlock = document.getElementById('stem-unlock');
if(stemUnlock) stemUnlock.onclick=()=>{if(!state.premium){openPremium('Premium unlocks stem-enabled battles and stem controls.');return;}document.getElementById('stem-buttons')?.classList.toggle('hidden');};

let timerSeconds=600,timerInt=null;
function timerText(){
  const txt = `${Math.floor(timerSeconds/60)}:${String(timerSeconds%60).padStart(2,'0')}`;
  const bc = document.getElementById('battle-clock'); if(bc) bc.textContent = txt;
  const mini = document.getElementById('mini-battle-clock'); if(mini) mini.textContent = txt;
  const br = document.getElementById('br-clock'); if(br){ br.textContent = txt; if(timerSeconds<=60) br.classList.add('warning'); else br.classList.remove('warning'); }
}
function resetTimer(m=10){clearInterval(timerInt);timerInt=null;timerSeconds=m*60;timerText();const tbtn=document.getElementById('timer-toggle'); if(tbtn) tbtn.textContent='Start'; const brnote=document.getElementById('br-timer-note'); if(brnote) brnote.textContent='Ready';}
document.getElementById('timer-toggle').onclick=()=>{if(timerInt){clearInterval(timerInt);timerInt=null;document.getElementById('timer-toggle').textContent='Start';return;}document.getElementById('timer-toggle').textContent='Pause';timerInt=setInterval(()=>{timerSeconds--;timerText();if(timerSeconds<=0){clearInterval(timerInt);timerInt=null;document.getElementById('timer-toggle').textContent='Done';}},1000)};

document.getElementById('judge-score-preview').onclick=()=>{const cats=[['Timing',20],['Phrasing',20],['Transition',20],['EQ / Frequency',15],['Energy',10],['Creativity',10],['Audio',5]];let total=0;const scores=cats.map(([n,m])=>{const s=Math.max(Math.floor(m*.7),Math.floor(m*(.78+Math.random()*.2)));total+=s;return [n,s,m]});document.getElementById('score-breakdown').innerHTML=scores.map(x=>`<div class="score-chip">${x[0]} <strong>${x[1]}/${x[2]}</strong></div>`).join('')+`<div class="score-chip" style="grid-column:1/-1;color:var(--accent)">PRACTICE SCORE <strong style="color:var(--accent)">${total}/100</strong></div>`;};

function recoverActiveBattleSession(){
  const saved = safeParse('djBattleActiveSession', null);
  if(!saved || !saved.id || ['completed','cancelled'].includes(saved.status)){
    recoverServerBattleRoom({ silent:true }).catch(err => console.warn('Server battle recovery failed', err));
    return;
  }
  window.activeBattleSession = saved;
  renderBattleRoom(saved);
  resetTimer(saved.duration || 10);
  document.getElementById('br-status').textContent = formatBattleStatus(saved.status);
  switchView(saved.status === 'active' || saved.status === 'submission_pending' ? 'battle-room' : 'studio');
  if(saved.battleEntryId || saved.battlePrepSyncStatus === 'server') recoverServerBattleRoom({ session:saved, silent:true }).catch(err => console.warn('Server battle recovery failed', err));
}

document.addEventListener('visibilitychange', () => {
  state.battleRoomSync.hidden = document.visibilityState === 'hidden';
  if(document.visibilityState === 'visible' && state.musicLibrarySync.accountId && !livePollingDisabledForTest()){
    loadDjNotificationCount().catch(()=>{});
    loadDjNotifications({ render:document.getElementById('notifications')?.classList.contains('active'), emitToasts:true }).catch(err=>console.warn('Notification visibility reconcile failed', err));
    loadDjChallengeCount().catch(()=>{});
    if(activeProfileTab === 'challenges' && document.getElementById('profile')?.classList.contains('active')) loadDjChallengeInbox({ preserve:true }).catch(()=>{});
    loadDjRelationshipSync({ render:document.getElementById('profile')?.classList.contains('active') }).catch(err=>console.warn('Relationship visibility reconcile failed', err));
  }
  const session = activeStudioBattleSession();
  if(!session || !session.battleEntryId || session.battlePrepSyncStatus !== 'server') return;
  if(document.visibilityState === 'visible'){
    fetchServerBattleRoomState(session).catch(err => console.warn('Battle room visibility reconcile failed', err));
    sendBattleRoomPresence(session, 'online').catch(()=>{});
  }else{
    sendBattleRoomPresence(session, 'reconnecting').catch(()=>{});
  }
});
window.addEventListener('beforeunload', event => {
  if(!isStudioRecordingActive()) return;
  event.preventDefault();
  event.returnValue = 'A recording is in progress.';
});

state.library = sanitizedLibraryForStorage(state.library).filter(track => !track.serverBacked);
state.playlists = sanitizedCratesForStorage(state.playlists).filter(crate => !crate.serverBacked);
renderBattles();renderPosts();renderLibrary();renderProfile();renderPlatformLibrary();renderStreamingServices();renderStreamBrowser();renderAiLeaderboard();updateBattleProgressUi();timerText();recoverActiveBattleSession();

setTimeout(()=>{
  const hash = String(window.location && window.location.hash || '');
  if(hash.startsWith('#rankings')){
    applyRankingsDeepLink(hash);
    switchView('rankings');
    return;
  }
  const resultMatch = hash.match(/(?:^#|[?&])result=([^&]+)/);
  const profileMatch = hash.match(/(?:^#|[?&])dj=([^&]+)/);
  if(resultMatch) loadPublicVerifiedResult(decodeURIComponent(resultMatch[1]));
  if(profileMatch) loadPublicDjProfile(decodeURIComponent(profileMatch[1]));
},0);

window.__DJBattleTestHooks = {
  initAuth,
  currentUser,
  renderCurrentUserUI,
  saveLocalProfile,
  openEditProfileModal,
  localCommunityPosts,
  getAuthInitState: () => ({ ...authInitState, liveMode:LIVE_MODE }),
  getDataSourceState: () => ({ ...dataSourceState }),
  completeBattleWithJudgeResult,
  normalizeJudgeResultFromResponse,
  buildBattleSubmissionContext,
  isOperatorUser,
  updateAuthUI,
  renderJudgingOperationsAccess,
  renderJudgingOperationsStatus,
  loadJudgingOperationsStatus,
  setJudgingOpsAutoRefresh,
  renderBattleResultProgress,
  renderBattleHistory,
  loadServerBattleLobby,
  findCompatibleServerBattle,
  recoverServerBattleRoom,
  serverLobbyBattleToLocal,
  fetchServerBattleRoomState,
  applyServerBattleRoomState,
  setServerBattleReady,
  startServerBattleFromRoom,
  requestServerBattleResolution,
  sendBattleRoomPresence,
  renderSynchronizedBattleResolution,
  cancelServerBattleFromRoom,
  withdrawServerBattleEntryFromRoom,
  stopBattleRoomLiveSync,
  openBattleHistoryResult,
  toggleBattleResultVisibility,
  openCreateBattleModal,
  openBattleLifecycle,
  joinBattleFromModal,
  createAuthenticatedBattleWithPrepSnapshot,
  joinAuthenticatedBattleWithPrepSnapshot,
  hydrateServerBattlePrepSnapshot,
  replaceServerBattlePrepSnapshotTrack,
  serverBattlePrepSnapshotToLocal,
  startBattleSession,
  filterBattleHistoryResults,
  renderPublicVerifiedResultProfile,
  loadPublicVerifiedResult,
  loadVerifiedResultsDiscovery,
  loadAuthoritativeLeaderboards,
  loadMyServerRankings,
  loadRankingsPage,
  loadRankingsPersonalSummary,
  loadPublicRankingDetail,
  loadPersonalRankingDetail,
  renderRankingsPage,
  startGuidedTour,
  closeGuidedTour,
  getGuidedTourState: () => ({ step:activeTourStep, total:TOUR_STEPS.length, view:TOUR_STEPS[activeTourStep].view }),
  renderRankingDetail,
  openRankingFromVerifiedResult,
  renderVerifiedResultsDiscovery,
  filterVerifiedResultsDiscovery,
  sortVerifiedResultsDiscovery,
  buildVerifiedPublicRankings,
  normalizeServerLeaderboardRankings,
  normalizePublicRankingRow,
  openVerifiedResultFromDiscovery,
  openPublicDjProfileFromDiscovery,
  openPublicProfileRankingImpactFromResult,
  openPrivateRankingImpactFromResult,
  renderPublicDjProfile,
  loadPublicDjProfile,
  openChallengeSetup,
  sendDjChallengeFromModal,
  loadDjChallengeInbox,
  loadDjChallengeCount,
  renderChallengeInbox,
  acceptDjChallengeFromInbox,
  updateDjChallengeTerminal,
  routeAcceptedChallengeToBattleRoom,
  publicProfileCanChallenge,
  hydratePublicProfileChallengeEligibility,
  loadDjNotifications,
  loadDjNotificationCount,
  renderNotificationCenter,
  markDjNotificationReadState,
  markAllDjNotificationsRead,
  openDjNotificationDestination,
  muteDjNotificationSource,
  blockDjNotificationSource,
  scheduleDjNotificationPolling,
  clearDjChallengeState,
  clearDjNotificationState,
  clearDjRelationshipState,
  clearCommunityState,
  loadCommunityFeed,
  renderPosts,
  openCommunityPostComposer,
  publishCommunityPostFromModal,
  toggleCommunityReaction,
  loadCommunityComments,
  publishCommunityComment,
  deleteCommunityPost,
  deleteCommunityComment,
  reportCommunityPost,
  recordCommunityMediaUsage,
  getChallengeState: () => state.djChallenges,
  getNotificationState: () => state.djNotifications,
  getRelationshipState: () => state.djRelationships,
  getCommunityState: () => state.community,
  loadDjRelationshipSync,
  scheduleDjRelationshipPolling,
  applyRelationshipSyncPayload,
  hydratePublicProfileRelationshipSummary,
  togglePublicProfileFollow,
  toggleRankingFollow,
  openProtectedChallengeSetupFromPublicId,
  loadDjRelationships,
  renderProfileRelationshipPanel,
  loadDjActivityFeed,
  renderDjActivityFeed,
  loadOpponentHistory,
  renderOpponentHistoryPanel,
  loadChallengePreferences,
  renderChallengePreferencesPanel,
  saveChallengePreferencesFromPanel,
  openRematchSetupFromHistory,
  openRematchSetupFromOpponent,
  openRematchSetup,
  sendRematchRequestFromModal,
  loadPublicProfileRankingDetail,
  loadPrivateProfileRankingDetail,
  trackVerifiedResultView,
  trackPublicProfileView,
  publicVisitorId,
  syncBattleResultProfileToServer,
  switchView,
  setProfileTab: tab => { activeProfileTab = tab; renderProfile(); },
  setVerifiedDiscoveryFilters: filters => { state.verifiedResultsDiscovery.filters = { ...state.verifiedResultsDiscovery.filters, ...filters }; },
  setVerifiedDiscoverySort: sort => { state.verifiedResultsDiscovery.sort = sort; },
  getVerifiedDiscoveryState: () => state.verifiedResultsDiscovery,
  getPublicRankingsState: () => state.publicRankings,
  getRankingDetailState: () => state.publicRankings.detail,
  getProfileRankingState: () => state.profileRanking,
  setPublicRankingsState: patch => { state.publicRankings = { ...state.publicRankings, ...patch, filters:{ ...state.publicRankings.filters, ...(patch && patch.filters || {}) } }; },
  getBattleResults: () => state.battleResults,
  getBattleProgress: () => state.battleProgress,
  getPracticeHistory: () => state.practiceHistory,
  getBattleHistoryFilters: () => state.battleHistoryFilters,
  getBattles: () => battles,
  getBattleLobbyState: () => state.battleLobby,
  setBattleLobbyFilters: filters => { state.battleLobby.filters = { ...state.battleLobby.filters, ...filters }; },
  getBattleRoomSyncState: () => state.battleRoomSync,
  getOperatorState: () => state.operatorUser,
  renderLibrary,
  allLibraryTracks,
  filterLibraryTracks,
  sortLibraryTracks,
  compatibleTracksFor,
  keyColorClass,
  secureArtworkSource,
  attachArtworkToTrack,
  selectLibraryTrack,
  loadLibraryTrackToDeck,
  libraryTrackLoadEligibility,
  openStudioLibraryDrawer,
  closeStudioLibraryDrawer,
  renderStudioLibraryDrawer,
  selectLibraryRecordingForSubmission,
  loadServerMusicLibraryTracks,
  loadServerMusicLibraryCrates,
  hydrateNextMusicLibraryPage,
  checkMusicLibrarySchemaStatus,
  checkMusicLibraryOrganizationStatus,
  handleMusicLibraryAuthChange,
  clearAuthenticatedLibraryData,
  updateLibraryTrackMetadataOptimistic,
  createLibraryCrateOptimistic,
  updateLibraryCrateOptimistic,
  duplicateLibraryCrateOptimistic,
  deleteLibraryCrateOptimistic,
  addTracksToCrate,
  removeTracksFromCrate,
  setCrateTrackOrder,
  resolveCrateTrackIds,
  setCrateEditorMode,
  selectCrateTrack,
  selectAllCrateTracks,
  clearCrateSelection,
  reorderCrateTrack,
  undoLastCrateEdit,
  validateBattlePrepCrate,
  openBattlePrepCrateInStudio,
  validateBattlePrepCrateForBattle,
  buildBattlePrepEntrySnapshot,
  attachBattlePrepSnapshotToBattle,
  battlePrepSnapshotForUser,
  safeBattlePrepSnapshotForSubmission,
  battlePrepSummaryForHistory,
  recoverBattlePrepSnapshotInStudio,
  replaceBattlePrepSnapshotTrack,
  addSelectedTracksToCrates,
  replaceTrackInCrate,
  attachArtworkToCrate,
  loadNextFromBattlePrepCrate,
  loadBattlePrepCrateToDecks,
  createPracticeRecordingFromSubmissionLocal,
  flushMusicLibrarySyncQueue,
  queueMusicLibrarySyncChange,
  requestLibraryPlaybackAccess,
  createServerBackedLibraryTrackFromFile,
  getLibraryTrackById,
  getLibraryState: () => ({
    library: state.library,
    platformLibrary: state.platformLibrary,
    crates: state.playlists,
    sort: state.librarySort,
    filters: state.libraryFilters,
    selectedLibraryTrackId: state.selectedLibraryTrackId,
    player: state.libraryPlayer,
    sync: state.musicLibrarySync,
    crateEditor: state.crateEditor,
    studioLibraryDrawer: state.studioLibraryDrawer
  }),
  setLibraryTracks: tracks => { state.library = tracks; persist(); renderLibrary(); },
  setLibraryCrates: crates => { state.playlists = crates; persist(); renderLibrary(); renderStudioLibrary(); },
  setPlatformLibrary: tracks => { state.platformLibrary = tracks; persistPlatform(); renderLibrary(); renderStudioLibrary(); },
  setLibrarySort: sort => { state.librarySort = { ...state.librarySort, ...sort }; persistLibraryUiState(); renderLibrary(); },
  setLibraryFilters: filters => { state.libraryFilters = { ...state.libraryFilters, ...filters }; renderLibrary(); },
  getStudioDeckState: () => state.studioDecks,
  getFocusedDeck,
  ensureAudioGraph,
  teardownDeckAudioGraph,
  getDeckRuntimeDiagnostics,
  getStudioRecordingState: () => state.studioRecording,
  armStudioRecording,
  startStudioRecording,
  stopStudioRecording,
  restartStudioRecording,
  saveRecordingDraft,
  submitStudioRecording,
  isStudioRecordingActive,
  recordingElapsedText,
  getControllerState: () => state.controller,
  scanMidiControllers,
  midiMappingStatus,
  handleMidiMessage,
  getAudioSetupState: () => state.audioSetup,
  refreshAudioDevices,
  parsePlaylistText,
  exportActiveStudioPlaylist,
  importPlaylistFile,
  streamingCatalogRows,
  importStreamingMetadataRow,
  renderStudioLibrary,
  setStudioLibrarySource: source => { state.studioLibrarySource = source || 'MY_LIBRARY'; localStorage.setItem('djBattleStudioLibrarySource', state.studioLibrarySource); renderStudioLibrary(); },
  setPremium: value => { state.premium = Boolean(value); renderStudioLibrary(); renderLibrary(); },
  setActiveBattleSession: session => { window.activeBattleSession = session; if(session) persistActiveBattleSession(session); else clearActiveBattleSession(); renderStudioLibrary(); renderStudioLibraryDrawer(); },
  getActiveBattleSession: () => window.activeBattleSession
};

// Global search across sources
const gs = document.getElementById('global-search'); if(gs){ gs.oninput = (e)=>{ state.libraryFilters.search = e.target.value || ''; renderLibrary(); renderStreamBrowser(state.libraryFilters.search); }; }
const newPlaylistButton = document.getElementById('new-playlist');
if(newPlaylistButton){ newPlaylistButton.onclick = () => createLibraryCrateOptimistic({ name:`Battle Prep ${state.playlists.length + 1}`, type:'battle_prep', visibility:'private' }); }
const openPlaylistsButton = document.getElementById('open-playlists');
if(openPlaylistsButton){ openPlaylistsButton.onclick = () => { state.libraryFilters.crate = state.selectedLibraryCrateId || 'all'; renderLibrary(); }; }

// Stream browser search hook
const sb = document.getElementById('stream-browser'); const searchInput = document.getElementById('global-search'); if(searchInput){ searchInput.addEventListener('search', (e)=>{ renderStreamBrowser(e.target.value); }); }

// Studio search box: wire to studio library
const studioSearch = document.getElementById('studio-search'); if(studioSearch){ studioSearch.oninput = (e)=>{ renderStudioLibrary(e.target.value || ''); }; }
const studioDrawerButton = document.getElementById('open-studio-library-drawer'); if(studioDrawerButton){ studioDrawerButton.onclick = () => openStudioLibraryDrawer(getFocusedDeck()); }

// Hardware source buttons in studio: filter displayed source
document.querySelectorAll('.hardware-source [data-src]').forEach(btn=>btn.onclick=(e)=>{ const src = e.currentTarget.dataset.src || 'MY_LIBRARY'; state.studioLibrarySource = src; localStorage.setItem('djBattleStudioLibrarySource', src); document.querySelectorAll('.hardware-source [data-src]').forEach(b=>b.classList.toggle('active', b === e.currentTarget)); renderStudioLibrary(document.getElementById('studio-search')?.value || ''); });

wirePlaylistTransferControls();
wireControllerAndAudioControls();

// initial render of studio library if present
renderStudioLibrary();
renderStudioLibraryDrawer();
