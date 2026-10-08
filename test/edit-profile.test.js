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

function fillAndSave(window, name, initials){
  const doc = window.document;
  doc.getElementById('edit-profile-button').click();
  const nameInput = doc.getElementById('edit-profile-name');
  nameInput.value = name;
  nameInput.dispatchEvent(new window.Event('input'));
  if(initials != null){
    const initialsInput = doc.getElementById('edit-profile-initials');
    initialsInput.value = initials;
    initialsInput.dispatchEvent(new window.Event('input'));
  }
  doc.getElementById('save-profile').click();
}

test('Edit Profile opens a modal prefilled with the current user', () => {
  const window = loadAppDom();
  window.document.getElementById('edit-profile-button').click();
  assert.equal(window.document.getElementById('modal').hasAttribute('open'), true);
  assert.equal(window.document.getElementById('edit-profile-name').value, 'Guest');
  assert.equal(window.document.getElementById('edit-profile-initials').value, 'G');
  assert.match(text(window, '#edit-profile-scope'), /this browser only/);
});

test('saving a display name and initials updates the UI and persists locally', () => {
  const window = loadAppDom();
  fillAndSave(window, '  DJ   Test Pilot ', 'tp');
  assert.equal(window.document.getElementById('modal').hasAttribute('open'), false);
  assert.equal(text(window, '#profile-name'), 'DJ Test Pilot');
  assert.equal(text(window, '.profile-chip .avatar'), 'TP');
  assert.equal(text(window, '#profile-hero-name'), 'DJ Test Pilot');
  assert.equal(text(window, '#profile-hero-avatar'), 'TP');
  assert.equal(text(window, '#br-dj1-name'), 'DJ Test Pilot');
  const saved = JSON.parse(window.localStorage.getItem('djBattleLocalProfile:local-profile-digital-king'));
  assert.deepEqual(saved, { displayName:'DJ Test Pilot', initials:'TP' });
  assert.equal(window.__DJBattleTestHooks.currentUser().displayName, 'DJ Test Pilot');
});

test('saved local profile is restored on reload and own local posts follow the new name', () => {
  const window = loadAppDom(win => {
    win.localStorage.setItem('djBattleLocalProfile:local-profile-digital-king', JSON.stringify({ displayName:'Night Owl', initials:'NO' }));
    win.localStorage.setItem('djBattlePosts', JSON.stringify([
      { user:'Guest', userId:'local-profile-digital-king', initials:'G', room:'General DJ Talk', time:'now', title:'Mine', body:'', likes:0, comments:0 },
      { user:'Maya Mixx', initials:'MM', room:'Track Feedback', time:'8m', title:'Theirs', body:'', likes:0, comments:0 }
    ]));
  });
  assert.equal(text(window, '#profile-name'), 'Night Owl');
  assert.equal(text(window, '.profile-chip .avatar'), 'NO');
  fillAndSave(window, 'Night Owl Two');
  const rows = window.__DJBattleTestHooks.localCommunityPosts();
  assert.equal(rows.find(row => row.title === 'Mine').author.displayName, 'Night Owl Two');
  assert.equal(rows.find(row => row.title === 'Theirs').author.displayName, 'Maya Mixx');
});

test('initials default from the name and invalid input shows an error without saving', () => {
  const window = loadAppDom();
  window.document.getElementById('edit-profile-button').click();
  const nameInput = window.document.getElementById('edit-profile-name');
  nameInput.value = 'Bass Face';
  nameInput.dispatchEvent(new window.Event('input'));
  assert.equal(window.document.getElementById('edit-profile-initials').value, 'BF');
  nameInput.value = '   ';
  window.document.getElementById('save-profile').click();
  assert.equal(window.document.getElementById('modal').hasAttribute('open'), true);
  assert.match(text(window, '#edit-profile-error'), /Enter a display name/);
  assert.equal(window.localStorage.getItem('djBattleLocalProfile:local-profile-digital-king'), null);
  assert.ok(window.__DJBattleTestHooks.saveLocalProfile({ displayName:'x'.repeat(41) }).error);
});

test('signed in, the local profile edit is scoped to that user and stays local', () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.updateAuthUI({ id:'user-9', email:'dj9@example.com', user_metadata:{ full_name:'Server Name' } });
  window.document.getElementById('edit-profile-button').click();
  assert.match(text(window, '#edit-profile-scope'), /account profile on the server is not changed/);
  window.document.getElementById('edit-profile-name').value = 'Club Name';
  window.document.getElementById('save-profile').click();
  assert.equal(text(window, '#profile-name'), 'Club Name');
  assert.ok(window.localStorage.getItem('djBattleLocalProfile:user-9'));
  hooks.updateAuthUI(null);
  assert.equal(text(window, '#profile-name'), 'Guest');
});
