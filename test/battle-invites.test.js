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

test('signed-out Invites tab asks the guest to sign in', () => {
  const window = loadAppDom();
  window.document.querySelector('[data-battle-tab="invites"]').click();
  const empty = window.document.getElementById('battle-invites-empty');
  assert.ok(empty);
  assert.match(empty.textContent, /Sign in to see invites/i);
  assert.ok(window.document.getElementById('battle-invites-signin'));
});

test('signed-in Invites tab lists pending challenges and offers Challenge Inbox', () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.updateAuthUI({ id:'user-9', email:'dj@example.com', user_metadata:{ full_name:'Maya Mixx' } });
  const challenges = hooks.getDjChallenges();
  challenges.status = 'synced';
  challenges.rows = [{
    id:'chal-1',
    direction:'received',
    status:'pending',
    expiresAt:new Date(Date.now() + 86400000).toISOString(),
    challenger:{ displayName:'Nova Cut', name:'Nova Cut', belt:'Blue', rating:91, publicProfileId:'dj_novacut' },
    recipient:{ displayName:'Maya Mixx', name:'Maya Mixx', publicProfileId:'dj_mayamixx' },
    rules:{ modeId:'transition_battle', genre:'Bass House' },
    eligibility:{ canAccept:true, canDecline:true, canCancel:false }
  }];
  window.document.querySelector('[data-battle-tab="invites"]').click();
  const grid = window.document.getElementById('battle-grid');
  assert.match(grid.textContent, /Nova Cut/);
  assert.match(grid.textContent, /PENDING INVITES|Challenges/i);
  assert.ok(window.document.getElementById('battle-invites-open-inbox'));
  assert.equal(hooks.pendingInviteChallenges().length, 1);
});

test('signed-in empty Invites copy points to Challenge Inbox instead of filter advice', () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.updateAuthUI({ id:'user-9', email:'dj@example.com', user_metadata:{ full_name:'Maya Mixx' } });
  const challenges = hooks.getDjChallenges();
  challenges.status = 'synced';
  challenges.rows = [];
  window.document.querySelector('[data-battle-tab="invites"]').click();
  const empty = window.document.getElementById('battle-invites-empty');
  assert.ok(empty);
  assert.match(empty.textContent, /No pending invites/i);
  assert.doesNotMatch(empty.textContent, /Adjust the filters/i);
  assert.ok(window.document.getElementById('battle-invites-open-inbox'));
});
