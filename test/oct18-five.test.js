const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const windows = [];
test.after(() => windows.forEach(w => { try{ w.close(); }catch(e){} }));

const root = path.join(__dirname, '..');
const nextTick = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async (n = 4) => { for(let i = 0; i < n; i++) await nextTick(); };

function loadAppDom({ url = 'http://127.0.0.1/index.html', setup } = {}){
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(index, { url, runScripts:'outside-only', pretendToBeVisual:true });
  const { window } = dom;
  window.alert = () => {};
  window.confirm = () => true;
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = function(){};
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLDialogElement.prototype.showModal = function showModal(){ this.setAttribute('open', ''); this.open = true; };
  window.HTMLDialogElement.prototype.close = function close(){ this.removeAttribute('open'); this.open = false; this.dispatchEvent(new window.Event('close')); };
  window.fetch = async () => ({ ok:false, status:503, text: async () => '{}', json: async () => ({}) });
  if(setup) setup(window);
  const beltScript = Array.from(window.document.querySelectorAll('script:not([src])')).find(s => s.textContent.includes('setCurrentBelt'));
  if(beltScript) window.eval(beltScript.textContent);
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'].forEach(file => {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });
  windows.push(window);
  return window;
}

function judgeResult(){
  return { overallScore:91, won:true, opponentScore:84, breakdown:{ timing:{ available:true, score:92 } }, timing:[], rawMeasurements:[], measurableAnalysis:{ durationSec:90, bpm:128, transitionCount:2 }, confidence:{ measurableComponentRatio:0.8 }, recommendations:['Keep it up.'], evidenceType:'measurable_audio_rule_based' };
}
function addCompletedResult(window, submissionId){
  const created = window.DJBattleModes.createBattleRecord({
    id:'rights-battle', modeId:'transition_battle', genre:'House', title:'Rights Check Battle', status:'submission_pending',
    participants:[{ userId:'local-profile-digital-king', name:'Digital King', status:'submitted', submissionId }, { userId:'opp', name:'Opponent DJ', status:'submitted' }]
  }, { requireAssignedTracks:false });
  assert.ifError(created.error);
  window.__DJBattleTestHooks.getBattles().unshift(created.battle);
  window.__DJBattleTestHooks.completeBattleWithJudgeResult({ id:created.battle.id, battleId:created.battle.id, participants:created.battle.participants, status:'submission_pending', submissionId }, judgeResult(), submissionId);
  return `rights-battle:${submissionId}`;
}
async function answerRightsDialog(window, { tick = true, replay = false, cancel = false } = {}){
  for(let i = 0; i < 20 && !window.document.querySelector('.mix-rights-overlay'); i++) await nextTick();
  const overlay = window.document.querySelector('.mix-rights-overlay');
  assert.ok(overlay, 'rights dialog opened');
  if(cancel){ overlay.querySelector('[data-mix-rights-cancel]').click(); return overlay; }
  const attest = overlay.querySelector('[data-mix-rights-attest]');
  if(tick){ attest.checked = true; attest.dispatchEvent(new window.Event('change')); }
  if(replay) overlay.querySelector('[data-mix-rights-replay]').checked = true;
  overlay.querySelector('[data-mix-rights-confirm]').click();
  return overlay;
}

/* ---------- 1. Make Public rights step ---------- */

test('Make Public asks for music rights after a 409, certifies, then retries and goes public', async () => {
  const window = loadAppDom();
  const calls = [];
  let certified = false;
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    calls.push({ url, method:options.method, body:options.body });
    if(url === '/api/battleResults/sub-rights/visibility'){
      if(!certified) return { error:'Request failed (409).', status:409, data:{ error:'Mix rights certification is required before this battle result can be public', reviewRequired:false, certification:null } };
      return { status:200, data:{ result:{ submissionId:'sub-rights', visibility:'public', verifiedResultId:'vr_rights00000000000000', verifiedResultUrl:'x' } } };
    }
    if(url === '/api/mixRights/certifications/sub-rights'){ certified = true; return { status:201, data:{ certification:{ status:'certified', publicResultAllowed:true } } }; }
    return { error:'Request failed (503).', status:503 };
  };
  const id = addCompletedResult(window, 'sub-rights');
  await settle();
  const pending = window.__DJBattleTestHooks.toggleBattleResultVisibility(id);
  const overlay = await answerRightsDialog(window, { replay:true });
  assert.match(overlay.textContent, /I own or have permission for this music/);
  const result = await pending;
  assert.equal(result.visibility, 'public');
  const cert = calls.find(c => c.url === '/api/mixRights/certifications/sub-rights');
  assert.equal(cert.method, 'POST');
  assert.equal(cert.body.rightsAttested, true);
  assert.equal(cert.body.publicResultConsent, true);
  assert.equal(cert.body.replayConsent, true);
  assert.equal(calls.filter(c => c.url.endsWith('/visibility')).length, 2, 'retried after certifying');
});

test('Confirm stays disabled until the rights box is ticked, and Cancel keeps the result private', async () => {
  const window = loadAppDom();
  window.DJBattleApi.apiRequest = async url => url.endsWith('/visibility')
    ? { error:'x', status:409, data:{ error:'Mix rights certification is required' } }
    : { error:'should not certify', status:500 };
  const id = addCompletedResult(window, 'sub-cancel');
  await settle();
  const pending = window.__DJBattleTestHooks.toggleBattleResultVisibility(id);
  for(let i = 0; i < 20 && !window.document.querySelector('.mix-rights-overlay'); i++) await nextTick();
  assert.equal(window.document.querySelector('[data-mix-rights-confirm]').disabled, true);
  await answerRightsDialog(window, { cancel:true });
  const result = await pending;
  assert.equal(result.cancelled, true);
  assert.match(result.error, /still private/);
});

test('Review-required and blocked certifications explain why the result stays private', async () => {
  const window = loadAppDom();
  let status = 'review_required';
  window.DJBattleApi.apiRequest = async url => url.endsWith('/visibility')
    ? { error:'x', status:409, data:{ error:'required' } }
    : { status:200, data:{ certification:{ status, warnings:['No immutable Battle Prep snapshot was linked to this mix submission'], blockedReasons:status === 'blocked' ? ['track-1: rights classification does not permit public mix use'] : [] } } };
  const id = addCompletedResult(window, 'sub-review');
  await settle();
  let pending = window.__DJBattleTestHooks.toggleBattleResultVisibility(id);
  await answerRightsDialog(window);
  let result = await pending;
  assert.equal(result.reviewRequired, true);
  assert.match(window.document.getElementById('notification-toast-rack').textContent, /moderator needs to review/);
  status = 'blocked';
  pending = window.__DJBattleTestHooks.toggleBattleResultVisibility(id);
  await answerRightsDialog(window);
  result = await pending;
  assert.equal(result.blocked, true);
  assert.match(window.document.getElementById('notification-toast-rack').textContent, /does not permit public mix use/);
});

test('Offline Make Public still asks for rights and says it is this browser only', async () => {
  const window = loadAppDom();
  window.DJBattleApi.apiRequest = async () => ({ error:'Unable to reach the server.', status:0 });
  const id = addCompletedResult(window, 'sub-offline');
  await settle();
  const pending = window.__DJBattleTestHooks.toggleBattleResultVisibility(id);
  const overlay = await answerRightsDialog(window);
  assert.ok(overlay.querySelector('[data-mix-rights-offline]'));
  const result = await pending;
  assert.equal(result.visibility, 'public');
  assert.equal(result.publicLocalOnly, true);
  assert.match(window.document.getElementById('notification-toast-rack').textContent, /browser only/);
});

/* ---------- 2. Address bar routing ---------- */

test('switching pages records #view in the address bar and Back returns to the previous page', async () => {
  const window = loadAppDom();
  await settle();
  const doc = window.document;
  window.__DJBattleTestHooks.switchView('library');
  assert.equal(window.location.hash, '#library');
  window.__DJBattleTestHooks.switchView('studio');
  assert.equal(window.location.hash, '#studio');
  // Simulate the browser Back button landing on #library.
  window.history.replaceState(null, '', '/index.html#library');
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  assert.equal(doc.querySelector('.view.active').id, 'library');
  assert.equal(window.location.hash, '#library', 'Back does not push a new entry');
  // Back to the first entry (no hash) is the Battles page.
  window.history.replaceState(null, '', '/index.html');
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  assert.equal(doc.querySelector('.view.active').id, 'battles');
});

test('deep links and refresh open Profile and Studio; shared #dj links are not treated as pages', async () => {
  const profile = loadAppDom({ url:'http://127.0.0.1/index.html#profile' });
  await settle();
  assert.equal(profile.document.querySelector('.view.active').id, 'profile');
  const studio = loadAppDom({ url:'http://127.0.0.1/index.html#studio' });
  await settle();
  assert.equal(studio.document.querySelector('.view.active').id, 'studio');
  const h = studio.__DJBattleTestHooks;
  assert.equal(h.viewFromHash('#dj=dj_abc'), '');
  assert.equal(h.viewFromHash('#result=vr_1'), '');
  assert.equal(h.viewFromHash('#profile?tab=progression'), 'profile');
  assert.equal(h.viewFromHash('#nope'), '');
});

test('Rankings keeps its own detailed address and the More sheet still marks the active page', async () => {
  const window = loadAppDom();
  await settle();
  window.__DJBattleTestHooks.switchView('rankings');
  assert.match(window.location.hash, /^#rankings\?category=/);
  window.__DJBattleTestHooks.switchView('settings');
  assert.equal(window.location.hash, '#settings');
  const more = window.document.getElementById('nav-more');
  if(more) assert.equal(more.classList.contains('active'), true);
});

/* ---------- 3. Belt promotion tests ---------- */

test('signed out, the belt panel says to sign in and offers no test', async () => {
  const window = loadAppDom();
  await settle();
  const panel = window.document.getElementById('promotion-history-panel');
  assert.match(panel.textContent, /Current belt\s*White/);
  assert.match(panel.textContent, /Next belt\s*Yellow/);
  assert.match(panel.textContent, /Score needed\s*60/);
  assert.ok(panel.querySelector('[data-belt-offline]'));
  assert.equal(panel.querySelector('[data-start-belt-test]').disabled, true);
  const result = await window.__DJBattleTestHooks.startBeltTest();
  assert.equal(result.error, 'signed_out');
});

test('tap matching finds the nearest tap per beat and preview grading matches the server rule', () => {
  const h = loadAppDom().__DJBattleTestHooks;
  const offsets = h.beltTapOffsets([1000, 1500, 2000, 2500], [1010, 1480, 2600], 500);
  assert.deepEqual(Array.from(offsets), [10, -20, null, 100]);
  assert.equal(h.beltTapPreviewScore([0, 0, 0, 0], [100]), 100);
  assert.equal(h.beltTapPreviewScore([200, null, 0, 0], [100]), Math.round((50 + 0 + 100 + 100) / 4));
  const runner = h.createBeltTapTest({ code:'yellow', criteria:{ events:[{ targetWindowMs:100 }] } }, { bpm:120 });
  runner.begin(0);
  [2000, 2510, 3000, 3490].forEach(t => runner.tap(t));
  assert.deepEqual(Array.from(runner.offsets()), [0, 10, 0, -10]);
  assert.equal(runner.breakdown().method, 'tap_timing_v1');
});

test('signed in: loads the server belt, runs a test, shows the real server pass and history', async () => {
  const window = loadAppDom();
  const h = window.__DJBattleTestHooks;
  const calls = [];
  let attempts = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    calls.push({ url, body:options.body });
    if(url === '/api/getBelts') return { status:200, data:{ success:true, belts:[{ code:'white', name:'White', order:1, minScore:0 }, { code:'yellow', name:'Yellow', order:2, minScore:60 }, { code:'orange', name:'Orange', order:3, minScore:70 }] } };
    if(url === '/api/myBelt') return { status:200, data:{ success:true, belt:attempts.length ? { code:'yellow', name:'Yellow', next:{ code:'orange', name:'Orange', minScore:70 } } : { code:'white', name:'White', next:{ code:'yellow', name:'Yellow', minScore:60 } } } };
    if(url === '/api/getBeltAttempts') return { status:200, data:{ success:true, attempts } };
    if(url === '/api/generateBeltTest') return { status:200, data:{ success:true, test:{ id:'test-1', code:'yellow', passing_score:60, criteria:{ events:[{ targetWindowMs:200 }] } } } };
    if(url === '/api/submitBeltAttempt'){
      attempts = [{ id:'att-1', score:88, passing_score:60, created_at:new Date().toISOString(), breakdown:{ beltCode:'yellow', serverScored:true } }];
      return { status:200, data:{ success:true, passed:true, score:88, passingScore:60, serverScored:true, award:{ beltCode:'yellow', beltName:'Yellow' } } };
    }
    return { error:'unexpected', status:500 };
  };
  h.updateAuthUI({ id:'user-belt', email:'belt@example.com', user_metadata:{ full_name:'Belt DJ' } });
  await h.loadBeltPromotion();
  const panel = window.document.getElementById('promotion-history-panel');
  assert.match(panel.textContent, /from your account/);
  const start = panel.querySelector('[data-start-belt-test]');
  assert.equal(start.textContent, 'Take your Yellow Belt test');
  assert.equal(start.disabled, false);
  assert.match(panel.textContent, /No belt test attempts yet/);
  const started = await h.startBeltTest();
  assert.equal(started.test.id, 'test-1');
  assert.match(window.document.getElementById('modal-content').textContent, /Yellow Belt test/);
  const runner = h.createBeltTapTest(started.test);
  runner.begin(0); [2000, 2500, 3000, 3500].forEach(t => runner.tap(t));
  const outcome = await h.submitBeltTestAttempt(started.test, { code:'yellow', name:'Yellow', minScore:60 }, runner);
  assert.equal(outcome.passed, true);
  assert.equal(outcome.score, 88, 'shows the server score');
  const submit = calls.find(c => c.url === '/api/submitBeltAttempt');
  assert.equal(submit.body.breakdown.method, 'tap_timing_v1');
  assert.equal(submit.body.testId, 'test-1');
  await settle(6);
  assert.match(panel.textContent, /PASS: 88 \/ 60/);
  assert.match(panel.textContent, /You earned the Yellow Belt/);
  assert.equal(h.currentBeltName(), 'Yellow');
  assert.match(panel.querySelector('[data-start-belt-test]').textContent, /Take your Orange Belt test/);
  assert.match(window.document.getElementById('promotion-history-list').textContent, /Yellow Belt test.*88.*PASS/s);
  assert.equal(window.document.getElementById('profile-belt').textContent, 'Yellow');
  // Signing out drops the account belt and goes back to this browser's belt.
  h.updateAuthUI(null);
  await settle(4);
  assert.equal(h.currentBeltName(), 'White');
  assert.equal(window.document.getElementById('profile-belt').textContent, 'White');
});

test('a failed server grade shows FAIL and never awards a belt', async () => {
  const window = loadAppDom();
  const h = window.__DJBattleTestHooks;
  window.DJBattleApi.apiRequest = async url => {
    if(url === '/api/submitBeltAttempt') return { status:200, data:{ success:true, passed:false, score:41, passingScore:60, serverScored:true, award:null } };
    if(url === '/api/myBelt') return { status:200, data:{ success:true, belt:{ code:'white', name:'White', next:{ code:'yellow', name:'Yellow', minScore:60 } } } };
    if(url === '/api/getBeltAttempts') return { status:200, data:{ success:true, attempts:[] } };
    return { status:200, data:{ success:true, belts:[] } };
  };
  h.updateAuthUI({ id:'user-fail', email:'f@example.com', user_metadata:{} });
  await h.loadBeltPromotion();
  const runner = h.createBeltTapTest({ id:'t', code:'yellow', criteria:{} });
  runner.begin(0);
  const out = await h.submitBeltTestAttempt({ id:'t', code:'yellow' }, { code:'yellow', name:'Yellow', minScore:60 }, runner);
  assert.equal(out.passed, false);
  assert.match(window.document.getElementById('promotion-history-panel').textContent, /FAIL: 41 \/ 60/);
  assert.equal(h.currentBeltName(), 'White');
});

test('index.html no longer fakes belt test analysis', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.equal(index.includes("label:'Transition A', idealSec:32, actualSec:32.05"), false);
  assert.equal(index.includes("document.getElementById('take-belt-test').onclick"), false);
});

/* ---------- 4. Studio keyboard shortcuts ---------- */

function key(window, k, opts = {}){
  const target = opts.target || window.document.body;
  const ev = new window.KeyboardEvent('keydown', { key:k, bubbles:true, cancelable:true, shiftKey:Boolean(opts.shiftKey), ctrlKey:Boolean(opts.ctrlKey) });
  target.dispatchEvent(ev);
  return ev;
}

test('Studio keys press play/cue, hot cues, crossfader and recording buttons', async () => {
  const window = loadAppDom();
  await settle();
  const doc = window.document;
  window.__DJBattleTestHooks.switchView('studio');
  const clicks = [];
  ['[data-play="a"]', '[data-cue="a"]', '[data-play="b"]', '[data-cue="b"]'].forEach(sel => doc.querySelector(sel).addEventListener('click', () => clicks.push(sel)));
  key(window, 'w'); key(window, 'q'); key(window, 'p'); key(window, 'o');
  assert.deepEqual(clicks, ['[data-play="a"]', '[data-cue="a"]', '[data-play="b"]', '[data-cue="b"]']);
  const xf = doc.getElementById('xfader');
  key(window, 'ArrowRight');
  assert.equal(Number(xf.value), 0.05);
  key(window, 'ArrowLeft', { shiftKey:true });
  assert.equal(Number(xf.value), -0.2);
  key(window, 'x');
  assert.equal(Number(xf.value), 0);
  const pads = doc.getElementById('hotcue-pads-a');
  const padClicks = [];
  if(pads && !pads.querySelector('[data-hotcue-pad="0"]')) pads.innerHTML = '<button data-hotcue-pad="0"></button>';
  pads.querySelector('[data-hotcue-pad="0"]').addEventListener('click', () => padClicks.push(1));
  key(window, '1');
  assert.equal(padClicks.length, 1);
  const arm = doc.getElementById('arm-record');
  let armed = 0; arm.addEventListener('click', () => { armed++; });
  key(window, 'r');
  assert.equal(armed, 1, 'R arms first when Record is not ready');
});

test('shortcuts are ignored while typing, off the Studio page, and with Ctrl held', async () => {
  const window = loadAppDom();
  await settle();
  const doc = window.document;
  window.__DJBattleTestHooks.switchView('studio');
  let plays = 0; doc.querySelector('[data-play="a"]').addEventListener('click', () => { plays++; });
  key(window, 'w', { target:doc.getElementById('studio-search') || doc.querySelector('#studio input[type="search"], #studio input:not([type])') });
  key(window, 'w', { ctrlKey:true });
  assert.equal(plays, 0);
  window.__DJBattleTestHooks.switchView('library');
  key(window, 'w');
  assert.equal(plays, 0);
  window.__DJBattleTestHooks.switchView('studio');
  key(window, 'w');
  assert.equal(plays, 1);
});

test('? opens the shortcut list, Esc closes it, and Esc is left alone otherwise (MIDI Learn keeps it)', async () => {
  const window = loadAppDom();
  await settle();
  const doc = window.document; const h = window.__DJBattleTestHooks;
  h.switchView('studio');
  key(window, '?', { shiftKey:true });
  const help = doc.getElementById('shortcut-help');
  assert.ok(help);
  assert.match(help.textContent, /Keyboard shortcuts/);
  assert.match(help.textContent, /Deck A Play/);
  assert.match(help.textContent, /Crossfader to center/);
  const esc = key(window, 'Escape');
  assert.equal(doc.getElementById('shortcut-help'), null);
  assert.equal(esc.defaultPrevented, true);
  doc.querySelector('[data-midi-learn="xfader"]').click();
  assert.equal(h.midiLearning(), 'xfader');
  const esc2 = key(window, 'Escape');
  assert.equal(esc2.defaultPrevented, false);
  assert.equal(h.midiLearning(), null, 'MIDI Learn still cancels on Escape');
  assert.ok(doc.getElementById('studio-shortcuts-button'));
});

/* ---------- 5. Profile photos ---------- */

const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

test('photo validation rejects wrong types, huge files and unsafe URLs', async () => {
  const h = loadAppDom().__DJBattleTestHooks;
  assert.match(h.validateAvatarFile({ type:'application/pdf', size:10 }).error, /JPG, PNG, WebP or GIF/);
  assert.match(h.validateAvatarFile({ type:'image/png', size:9 * 1024 * 1024 }).error, /8 MB/);
  assert.equal(h.validateAvatarFile({ type:'image/png', size:1000 }).ok, true);
  assert.equal(h.isSafeAvatarUrl(TINY_JPEG), true);
  assert.equal(h.isSafeAvatarUrl('javascript:alert(1)'), false);
  assert.equal(h.isSafeAvatarUrl('http://insecure.example/x.jpg'), false);
  assert.equal(h.isSafeAvatarUrl('https://x.example/a.jpg" onerror="x'), false);
  assert.equal(h.isSafeAvatarUrl('data:image/svg+xml;base64,PHN2Zz4='), false);
});

test('Edit Profile photo is cropped, saved, and shown on the chip, profile, battle card, posts and rankings', async () => {
  const window = loadAppDom();
  await settle();
  const doc = window.document; const h = window.__DJBattleTestHooks;
  let cropped = null;
  h.setAvatarCropper(async file => { cropped = file; return { dataUrl:TINY_JPEG, blob:null }; });
  h.openEditProfileModal();
  assert.ok(doc.getElementById('edit-profile-photo'));
  assert.match(doc.getElementById('modal-content').textContent, /cropped to a square/);
  const processed = await h.processAvatarFile({ type:'image/png', size:5000, name:'me.png' });
  assert.equal(processed.dataUrl, TINY_JPEG);
  assert.equal(cropped.name, 'me.png');
  h.editProfileModalState.setPendingAvatar(processed);
  doc.getElementById('edit-profile-name').value = 'Photo DJ';
  doc.getElementById('save-profile').click();
  const user = h.currentUser();
  assert.equal(user.avatar, TINY_JPEG);
  const chipImg = doc.querySelector('.profile-chip .avatar img');
  assert.ok(chipImg); assert.equal(chipImg.getAttribute('src'), TINY_JPEG);
  assert.ok(doc.querySelector('#profile-hero-avatar img'));
  assert.ok(doc.querySelector('#br-dj1 .avatar img'));
  const ownPost = { id:'p1', title:'Mine', author:{ displayName:'Photo DJ' }, viewer:{ isOwner:true }, reactionCounts:{}, createdAt:new Date().toISOString() };
  assert.match(h.communityPostHtml(ownPost), /<img src="data:image\/jpeg/);
  const otherPost = { id:'p2', title:'Theirs', author:{ displayName:'Other DJ' }, viewer:{ isOwner:false }, reactionCounts:{}, createdAt:new Date().toISOString() };
  assert.doesNotMatch(h.communityPostHtml(otherPost), /<img src=/);
  assert.match(h.djAvatarHtml('Photo DJ', h.avatarUrlForDj({ name:'Photo DJ' }), 'ranking-avatar'), /has-photo/);
  assert.match(h.djAvatarHtml('Some DJ', h.avatarUrlForDj({ name:'Some DJ' })), />SD</);
  // Keeping the photo when saving other fields, then removing it.
  h.saveLocalProfile({ displayName:'Photo DJ 2' });
  assert.equal(h.currentUser().avatar, TINY_JPEG);
  h.saveLocalProfile({ displayName:'Photo DJ 2', avatar:'' });
  assert.equal(h.currentUser().avatar, '');
  h.renderCurrentUserUI();
  assert.equal(doc.querySelector('.profile-chip .avatar img'), null);
});

test('signed in, the photo uploads through the server authorization and the returned URL is kept', async () => {
  const window = loadAppDom();
  await settle();
  const h = window.__DJBattleTestHooks;
  const calls = [];
  window.supabase = { storage:{ from:bucket => ({ uploadToSignedUrl: async (p, token, blob, opts) => { calls.push({ upload:bucket, p, token, type:opts.contentType }); return { data:{}, error:null }; } }) } };
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    calls.push({ url, body:options.body });
    if(url === '/api/profile/avatarUploadAuthorization') return { status:200, data:{ bucket:'profile-avatars', uploadPath:'avatars/user-photo/avatar-1.jpg', uploadToken:'tok' } };
    if(url === '/api/profile/completeAvatarUpload') return { status:200, data:{ avatarUrl:'https://proj.supabase.co/storage/v1/object/public/profile-avatars/avatars/user-photo/avatar-1.jpg' } };
    return { error:'nope', status:503 };
  };
  h.updateAuthUI({ id:'user-photo', email:'p@example.com', user_metadata:{ full_name:'Photo Signed' } });
  await settle(6);
  calls.length = 0;
  const out = await h.syncAvatarToServer({ dataUrl:TINY_JPEG, blob:null });
  assert.match(out.avatarUrl, /^https:\/\/proj\.supabase\.co/);
  assert.equal(calls[0].url, '/api/profile/avatarUploadAuthorization');
  assert.equal(calls[0].body.mimeType, 'image/jpeg');
  assert.ok(calls[0].body.size > 0);
  assert.equal(calls[1].upload, 'profile-avatars');
  assert.equal(calls[2].body.uploadPath, 'avatars/user-photo/avatar-1.jpg');
  assert.equal(h.currentUser().avatar, out.avatarUrl);
});

test('signed out, the photo stays in this browser only and nothing is uploaded', async () => {
  const window = loadAppDom();
  await settle();
  let called = false;
  window.DJBattleApi.apiRequest = async () => { called = true; return { status:200, data:{} }; };
  const out = await window.__DJBattleTestHooks.syncAvatarToServer({ dataUrl:TINY_JPEG });
  assert.equal(out.localOnly, true);
  assert.equal(called, false);
});
