const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');

function loadAppDom(setup){
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(index, { url:'http://127.0.0.1/index.html', runScripts:'outside-only', pretendToBeVisual:true });
  const { window } = dom;
  window.alert = () => {};
  window.confirm = () => true;
  window.scrollTo = () => {};
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLDialogElement.prototype.showModal = function showModal(){ this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function close(){ this.removeAttribute('open'); };
  window.fetch = async () => ({ ok:false, status:503, text: async () => '{}', json: async () => ({}) });
  if(setup) setup(window);
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'].forEach(file => {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });
  return window;
}

// ---- 1. Recording review ----
function recorderHarness(overrides = {}){
  const { window } = new JSDOM('<button id="restart-recording"></button><button id="save-recording-draft"></button><div id="recording-review" class="hidden"></div><div id="recording-metadata"></div>', { url:'http://127.0.0.1/' });
  global.window = window;
  window.eval(fs.readFileSync(path.join(root, 'studio/studio_recording.js'), 'utf8'));
  const state = { studioRecording:{ state:'review', fileName:'take.webm', duration:'01:00', tracklist:[] } };
  const store = { setItem(){}, getItem(){ return null; } };
  const calls = { confirm:0, saved:[] };
  const mgr = window.DJBattleStudioRecording.create({
    window, document:window.document, state, localStorage:store,
    confirm: async () => { calls.confirm += 1; return overrides.confirmResult !== undefined ? overrides.confirmResult : true; },
    saveDraftToLibrary: async (file, meta) => { calls.saved.push({ file, meta }); return { ok:true, track:{ id:'draft-1' } }; },
    getBattleLimitMs: () => overrides.limitMs || null,
    activeStudioBattleSession: () => ({ id:'b1', genre:'House' }),
    setTimeout: () => 1, clearTimeout: () => {},
    switchView(){}
  });
  window.lastRecordedMixFile = { name:'take.webm', type:'audio/webm' };
  return { mgr, state, calls, window };
}

test('Restart asks in-app first and keeps the take if cancelled', async () => {
  const { mgr, state, calls, window } = recorderHarness({ confirmResult:false });
  const result = await mgr.restart();
  assert.equal(result.cancelled, true);
  assert.equal(calls.confirm, 1);
  assert.equal(state.studioRecording.state, 'review');
  assert.ok(window.lastRecordedMixFile);
});

test('Restart discards the take and returns to the count-in for timed battles', async () => {
  const { mgr, state, window } = recorderHarness({ limitMs:60000 });
  const result = await mgr.restart();
  assert.equal(result.ok, true);
  assert.equal(result.countIn, true);
  assert.equal(window.lastRecordedMixFile, null);
  assert.equal(state.studioRecording.state, 'countin');
  assert.equal(state.studioRecording.countIn, 3);
});

test('Save Draft hands the take to the library and marks it saved once', async () => {
  const { mgr, state, calls } = recorderHarness();
  const result = await mgr.saveDraft();
  assert.equal(result.ok, true);
  assert.equal(calls.saved.length, 1);
  assert.equal(calls.saved[0].meta.battleId, 'b1');
  assert.equal(state.studioRecording.draftSaved, true);
  const again = await mgr.saveDraft();
  assert.equal(again.duplicate, true);
  assert.equal(calls.saved.length, 1);
});

test('app has a built-in Drafts crate and saved drafts land in it with a Submit button', async () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  const src = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(src, /id:'drafts', builtIn:true, name:'Drafts'/);
  assert.match(src, /data-submit-draft/);
  assert.equal(typeof hooks.saveRecordingDraftToLibrary, 'function');
  assert.equal(typeof hooks.submitDraftTake, 'function');
});

// ---- 2/3. Rematch + share ----
const sampleRecord = {
  resultKey:'b9:s9', submissionId:'s9', title:'Friday Night House', genre:'House', score:84, outcome:'win',
  completedAt:'2026-10-13T22:00:00Z', date:'10/13/2026',
  opponent:{ status:'opponent', name:'Nova Cut', publicProfileId:'dj_novacut', score:79 },
  profile:{ displayName:'Digital King' }
};

test('share card data names both DJs, scores and the winner', () => {
  const window = loadAppDom();
  const data = window.__DJBattleTestHooks.battleShareCardData(sampleRecord);
  assert.equal(data.me, 'Digital King');
  assert.equal(data.opponent, 'Nova Cut');
  assert.equal(data.myScore, 84);
  assert.equal(data.oppScore, 79);
  assert.equal(data.winner, 'Digital King');
  assert.equal(window.__DJBattleTestHooks.battleShareFileName(data), 'djbattle-result-friday-night-house.png');
});

test('shareBattleResult uses navigator.share with a file when supported', async () => {
  const window = loadAppDom();
  const shared = [];
  const fakeCanvas = { width:0, height:0, getContext: () => new Proxy({}, { get: (t, k) => k === 'createRadialGradient' ? () => ({ addColorStop(){} }) : (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } }), toBlob: cb => cb(new window.Blob(['png'], { type:'image/png' })) };
  const nav = { canShare: () => true, share: async payload => { shared.push(payload); } };
  const result = await window.__DJBattleTestHooks.shareBattleResult(sampleRecord, { canvas:fakeCanvas, navigator:nav });
  assert.equal(result.shared, true);
  assert.equal(shared.length, 1);
  assert.equal(shared[0].files[0].name, 'djbattle-result-friday-night-house.png');
  assert.equal(fakeCanvas.width, 1080);
  assert.equal(fakeCanvas.height, 1080);
});

test('Battle Home score card shows Rematch and Share for the latest result', () => {
  const window = loadAppDom(w => w.localStorage.setItem('djBattleBattleResults', JSON.stringify([sampleRecord])));
  const hooks = window.__DJBattleTestHooks;
  const state = hooks.state || null;
  const src = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(src, /hero-score-actions/);
  const wrap = window.document.getElementById('hero-score-actions');
  assert.ok(wrap, 'hero actions container exists');
  hooks.renderHeroScore();
  assert.equal(wrap.hidden, false);
  assert.ok(wrap.querySelector('[data-result-share]'));
  assert.ok(wrap.querySelector('[data-result-rematch]'));
  void state;
});

test('results screen actions include Share and reuse history rematch', () => {
  const src = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(src, /battle-result-actions/);
  assert.match(src, /openRematchSetupFromHistory\(event\.currentTarget\.dataset\.resultRematch\)/);
});

// ---- 4. Tour ----
test('nav no longer has a Virtual Tour page and the old route opens the pop-up tour', () => {
  const window = loadAppDom();
  const doc = window.document;
  assert.equal(doc.querySelector('#nav [data-view="tour"]'), null);
  window.__DJBattleTestHooks.switchView('tour');
  assert.ok(doc.getElementById('guided-tour-overlay'));
  assert.equal(doc.getElementById('tour'), null);
});

test('first-run tour shows once and Settings has Replay tour', () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  window.localStorage.removeItem('djBattleTourSeen');
  window.localStorage.removeItem('djBattleTourComplete');
  assert.equal(hooks.shouldShowFirstRunTour(window.localStorage), true);
  hooks.maybeShowFirstRunTour(window.localStorage);
  assert.ok(window.document.getElementById('guided-tour-overlay'));
  assert.equal(hooks.shouldShowFirstRunTour(window.localStorage), false);
  assert.equal(hooks.maybeShowFirstRunTour(window.localStorage), false);
  window.document.getElementById('guided-tour-overlay')?.remove();
  hooks.switchView('settings');
  const replay = window.document.getElementById('settings-replay-tour');
  assert.ok(replay);
  assert.match(replay.textContent, /Replay tour/);
  replay.click();
  assert.ok(window.document.getElementById('guided-tour-overlay'));
});

// ---- 5. Mentions + follow ----
function seedPosts(w){
  w.localStorage.setItem('djBattlePosts', JSON.stringify([
    { user:'Nova Cut', room:'General', title:'Sunday set', body:'Who is around?', createdAt:'2026-10-13T10:00:00Z' },
    { user:'Bass Queen', room:'General', title:'Tips', body:'Phrase it right', createdAt:'2026-10-13T11:00:00Z' }
  ]));
}

test('mentions autocomplete from known DJs and render escaped links', () => {
  const window = loadAppDom(seedPosts);
  const hooks = window.__DJBattleTestHooks;
  const names = hooks.mentionSuggestions('No').map(dj => dj.handle);
  assert.ok(names.includes('NovaCut'));
  const html = hooks.mentionifyText('yo @NovaCut <img src=x onerror=alert(1)> @nobody');
  assert.match(html, /<a href="#" class="mention-link" data-mention-profile="dj_novacut">@NovaCut<\/a>/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /mention-link unresolved">@nobody/);
  assert.deepEqual([...hooks.mentionedProfileIdsFor('hey @NovaCut and @BassQueen')], ['dj_novacut', 'dj_bassqueen']);
});

test('autocomplete inserts the picked handle', () => {
  const window = loadAppDom(seedPosts);
  const doc = window.document;
  const ta = doc.createElement('textarea');
  doc.body.appendChild(ta);
  window.__DJBattleTestHooks.wireMentionAutocomplete(ta);
  ta.value = 'great mix @No';
  ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.dispatchEvent(new window.Event('input'));
  const option = doc.querySelector('.mention-suggest [data-mention-handle="NovaCut"]');
  assert.ok(option);
  option.click();
  assert.equal(ta.value, 'great mix @NovaCut ');
});

test('mention alerts are stored locally and show in Activity for the mentioned DJ', () => {
  const window = loadAppDom(seedPosts);
  const hooks = window.__DJBattleTestHooks;
  window.localStorage.setItem('djBattleMentionAlerts', JSON.stringify([{ id:'m1', handle:'Guest', byName:'Nova Cut', title:'Sunday set', createdAt:'2026-10-14T09:00:00Z' }]));
  const created = hooks.recordLocalMentionAlerts('nice @NovaCut', { title:'Tips' });
  assert.equal(created[0].publicProfileId, 'dj_novacut');
  const mine = hooks.localMentionAlertsForMe();
  assert.equal(mine.length, 1);
  assert.ok(hooks.collectActivityEntries().some(entry => entry.label === 'Mention' && /Nova Cut mentioned you/.test(entry.title)));
});

test('post authors get a Follow button that toggles locally without a server', async () => {
  const window = loadAppDom(seedPosts);
  const hooks = window.__DJBattleTestHooks;
  const html = hooks.postAuthorFollowButtonHtml({ author:{ publicProfileId:'dj_novacut' }, viewer:{ isOwner:false } });
  assert.match(html, /data-follow-author="dj_novacut"/);
  assert.match(html, />Follow</);
  assert.equal(hooks.postAuthorFollowButtonHtml({ author:{ publicProfileId:'dj_me' }, viewer:{ isOwner:true } }), '');
  const result = await hooks.followPostAuthor('dj_novacut');
  assert.equal(result.following, true);
  assert.match(hooks.postAuthorFollowButtonHtml({ author:{ publicProfileId:'dj_novacut' }, viewer:{} }), />Following</);
});

test('server sends mention notifications to resolved DJs', async () => {
  const community = require(path.join(root, 'server/community.js'));
  assert.deepEqual(community.extractMentionHandles('hi @NovaCut and @novacut, mail a@b.com'), ['novacut']);
  const src = fs.readFileSync(path.join(root, 'server/community.js'), 'utf8');
  assert.match(src, /'mention_received'/);
  assert.match(src, /mentioned you in/);
});
