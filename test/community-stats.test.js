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

const finished = { id:'b-done', title:'Sunday Clash', status:'completed', participants:[{ userId:'dj-a', name:'Nova Cut' }, { userId:'dj-b', name:'Maya Mixx' }] };

test('crowd vote: listener votes once, participants cannot, text shows percentages', () => {
  const window = loadAppDom();
  const h = window.__DJBattleTestHooks;
  assert.equal(h.crowdVoteEligibility(finished).canVote, true);
  assert.equal(h.crowdVoteEligibility({ ...finished, status:'judging' }).canVote, false);
  const me = window.__DJBattleTestHooks.communityStatsState() && 'local-profile-digital-king';
  assert.equal(h.crowdVoteEligibility({ ...finished, participants:[{ userId:me, name:'Me' }, { userId:'dj-b', name:'B' }] }).reason, 'participant');
  window.localStorage.setItem('djBattleCrowdVotes', JSON.stringify({ 'b-done':{ votes:{ f1:'dj-a', f2:'dj-b', f3:'dj-a' } } }));
  const first = h.recordLocalCrowdVote(finished, 'dj-a');
  assert.equal(first.ok, true);
  assert.equal(first.summary.totalVotes, 4);
  assert.equal(h.crowdVoteText(first.summary), 'Crowd: 75% / 25% (4 votes)');
  assert.equal(h.recordLocalCrowdVote(finished, 'dj-b').duplicate, true);
  assert.match(h.crowdVoteCardButtonHtml(finished), /data-crowd-vote="b-done"/);
  assert.equal(h.crowdVoteCardButtonHtml({ ...finished, status:'open' }), '');
});

test('result screen replaces "Human voting: Not included yet" with the crowd vote', () => {
  const src = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.doesNotMatch(src, /Not included yet/);
  const window = loadAppDom();
  const html = window.__DJBattleTestHooks.crowdVoteResultModuleHtml(finished);
  assert.match(html, /Crowd vote/);
  assert.match(html, /Crowd: No votes yet/);
});

test('owners get an inline editor for local posts and the edit is tagged', async () => {
  const window = loadAppDom(w => {
    w.localStorage.setItem('djBattlePosts', JSON.stringify([{ user:'Guest', userId:'local-profile-digital-king', title:'Old title', body:'Old body', createdAt:'2026-10-14T09:00:00Z', room:'General' }]));
  });
  const h = window.__DJBattleTestHooks;
  h.renderPosts();
  const card = window.document.querySelector('[data-community-post^="local-post-"].community-post');
  assert.ok(card, 'local post card renders');
  const editBtn = card.querySelector('[data-community-edit]');
  assert.ok(editBtn, 'owner sees Edit');
  const editor = h.startInlinePostEdit(editBtn.dataset.communityEdit);
  assert.equal(editor.querySelector('[data-edit-title]').getAttribute('maxlength'), '180');
  assert.equal(editor.querySelector('[data-edit-body]').getAttribute('maxlength'), '4000');
  editor.querySelector('[data-edit-body]').value = '<img src=x onerror=alert(1)> new body';
  editor.dispatchEvent(new window.Event('submit', { cancelable:true }));
  await new Promise(r => setTimeout(r, 0));
  const saved = JSON.parse(window.localStorage.getItem('djBattlePosts'))[0];
  assert.ok(saved.editedAt);
  const updated = window.document.querySelector('[data-community-post^="local-post-"].community-post');
  assert.match(updated.innerHTML, /edited-tag/);
  assert.equal(updated.querySelector('img'), null, 'typed HTML stays escaped');
});

test('comment owners get Edit; others do not', () => {
  const window = loadAppDom();
  const h = window.__DJBattleTestHooks;
  assert.match(h.communityCommentHtml({ id:'c1', bodyText:'hi', viewer:{ isOwner:true }, editedAt:'2026-10-14T00:00:00Z' }), /data-community-comment-edit="c1"[\s\S]*|edited-tag/);
  assert.match(h.communityCommentHtml({ id:'c1', bodyText:'hi', viewer:{ isOwner:true } }), /data-community-comment-edit="c1"/);
  assert.doesNotMatch(h.communityCommentHtml({ id:'c2', bodyText:'hi', viewer:{ isOwner:false } }), /data-community-comment-edit/);
});

const history = [
  { resultKey:'r1', outcome:'win', score:88, completedAt:'2026-10-01T10:00:00Z', opponent:{ status:'opponent', name:'DJ Nova', publicProfileId:'dj_nova', score:80 } },
  { resultKey:'r2', outcome:'win', score:85, completedAt:'2026-10-03T10:00:00Z', opponent:{ status:'opponent', name:'DJ Nova', publicProfileId:'dj_nova', score:82 } },
  { resultKey:'r3', outcome:'loss', score:70, completedAt:'2026-10-05T10:00:00Z', opponent:{ status:'opponent', name:'DJ Nova', publicProfileId:'dj_nova', score:79 } },
  { resultKey:'r4', outcome:'win', score:90, completedAt:'2026-10-07T10:00:00Z', opponent:{ status:'opponent', name:'DJ Nova', publicProfileId:'dj_nova', score:84 } },
  { resultKey:'r5', outcome:'win', score:91, completedAt:'2026-10-08T10:00:00Z', opponent:{ status:'opponent', name:'Maya Mixx', publicProfileId:'dj_maya', score:80 } },
  { resultKey:'r6', outcome:'practice', score:60, completedAt:'2026-10-09T10:00:00Z', opponent:{ status:'ai_only' } }
];

test('head-to-head record and last meeting come from battle history', () => {
  const window = loadAppDom();
  const h = window.__DJBattleTestHooks;
  const record = h.headToHeadRecord({ publicProfileId:'dj_nova', name:'DJ Nova' }, history);
  assert.equal(h.headToHeadSummaryText(record), "You're 3–1 vs DJ Nova");
  assert.match(h.headToHeadLastMeetingText(record), /^Last meeting: Won 90–84/);
  assert.match(h.headToHeadProfileHtml({ publicProfileId:'dj_none', name:'Nobody' }), /No battles vs Nobody yet/);
});

test('streaks and badges only count real results', () => {
  const window = loadAppDom();
  const h = window.__DJBattleTestHooks;
  assert.deepEqual({ ...h.winStreaks(history) }, { current:2, best:2, battles:5, wins:4 });
  const badges = Object.fromEntries(h.battleBadges(history).map(b => [b.id, b.earned]));
  assert.deepEqual(badges, { first_win:true, five_battles:true, ten_battles:false, streak_3:false, streak_5:false });
  assert.equal(h.winStreaks([]).best, 0);
  assert.ok(h.battleBadges([]).every(b => !b.earned));
  h.communityStatsState().battleResults = [];
  h.renderProfileStreaks();
  assert.equal(window.document.querySelectorAll('#profile-streaks .dj-badge.locked').length, 5);
});

test('drafts do not count toward the library track limit', () => {
  const window = loadAppDom();
  const h = window.__DJBattleTestHooks;
  const counts = h.libraryLimitCounts([{ id:'1' }, { id:'2' }, { id:'d1', sourceType:'draft_take' }, { id:'d2', sourceType:'draft_take' }]);
  assert.deepEqual({ ...counts }, { tracks:2, drafts:2 });
  h.communityStatsState().library = [{ id:'t1', title:'A' }, { id:'d1', title:'Draft', sourceType:'draft_take' }]; h.renderLibrary();
  assert.match(window.document.getElementById('storage-label').textContent, /^1 \/ 5 tracks · 1 draft \(don't count\)/);
});
