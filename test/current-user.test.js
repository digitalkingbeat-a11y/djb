const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');

function loadAppDom(before){
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
  window.fetch = async () => ({ ok:false, status:503, text: async () => '{}' });
  if(before) before(window);
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'].forEach(file => {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });
  return window;
}

const text = (window, selector) => window.document.querySelector(selector).textContent.trim();

test('signed out, the app shows a Guest / Local DJ profile everywhere', () => {
  const window = loadAppDom();
  const user = window.__DJBattleTestHooks.currentUser();
  assert.equal(user.displayName, 'Guest');
  assert.equal(user.signedIn, false);
  assert.equal(user.label, 'Local DJ');
  assert.equal(text(window, '#profile-name'), 'Guest');
  assert.equal(text(window, '.profile-chip .avatar'), 'G');
  assert.equal(text(window, '#profile-hero-name'), 'Guest');
  assert.match(text(window, '#profile-hero-tagline'), /Local DJ/);
  assert.equal(text(window, '#br-dj1-name'), 'Guest');
  assert.equal(text(window, '#mini-dj1'), 'Guest');
  assert.doesNotMatch(window.document.querySelector('.topbar').textContent, /Digital King/);
});

test('signing in switches currentUser() to the session user and signing out returns to Guest', () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.updateAuthUI({ id:'user-123', email:'nova@example.com', user_metadata:{ full_name:'Nova Cut' } });
  const user = hooks.currentUser();
  assert.equal(user.id, 'user-123');
  assert.equal(user.displayName, 'Nova Cut');
  assert.equal(user.initials, 'NC');
  assert.equal(text(window, '#profile-name'), 'Nova Cut');
  assert.equal(text(window, '#profile-hero-name'), 'Nova Cut');
  assert.equal(text(window, '#auth-button'), 'Sign Out');
  hooks.updateAuthUI(null);
  assert.equal(hooks.currentUser().displayName, 'Guest');
  assert.equal(text(window, '#profile-name'), 'Guest');
  assert.equal(text(window, '#auth-button'), 'Sign In');
});

test('local post edit permission follows the post owner, not a hard-coded name', () => {
  const window = loadAppDom(win => {
    win.localStorage.setItem('djBattlePosts', JSON.stringify([
      { user:'Digital King', initials:'DK', room:'General DJ Talk', time:'1d', title:'Legacy local post', body:'', likes:0, comments:0 },
      { user:'Guest', initials:'G', room:'General DJ Talk', time:'1d', title:'Someone else called Guest', body:'', likes:0, comments:0 },
      { user:'Maya Mixx', initials:'MM', room:'Track Feedback', time:'8m', title:'Sample post', body:'', likes:0, comments:0 },
      { user:'Guest', userId:'local-profile-digital-king', initials:'G', room:'General DJ Talk', time:'now', title:'My guest post', body:'', likes:0, comments:0 }
    ]));
  });
  const rows = window.__DJBattleTestHooks.localCommunityPosts();
  const byTitle = Object.fromEntries(rows.map(row => [row.title, row.viewer]));
  assert.equal(byTitle['Legacy local post'].canEdit, true, 'posts saved by the old local profile stay editable');
  assert.equal(byTitle['Someone else called Guest'].canEdit, false, 'matching display name alone does not grant edit');
  assert.equal(byTitle['Sample post'].canEdit, false);
  assert.equal(byTitle['My guest post'].canEdit, true);
});

test('app.js and index.html no longer hard-code Digital King as the current user', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(index, /Digital King/);
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const lines = app.split('\n').filter(line => line.includes('Digital King'));
  // Remaining mentions: the legacy-migration constant and sample leaderboard rows only.
  assert.ok(lines.length <= 3, lines.join('\n'));
  assert.ok(lines.some(line => line.includes('LEGACY_LOCAL_PROFILE_NAME')));
  assert.doesNotMatch(app, /textContent \|\| 'Digital King'/);
  assert.match(app, /function currentProfileUserId\(\)\{ return currentUser\(\)\.id; \}/);
});
