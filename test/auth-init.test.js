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
  if(before) before(window);
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'].forEach(file => {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });
  return window;
}

function fireReady(window, detail){
  window.DJB_SUPABASE_STATE = { ready:true, ...detail };
  window.dispatchEvent(new window.CustomEvent('djb:supabase-ready', { detail:window.DJB_SUPABASE_STATE }));
}

function mockSupabase(calls){
  return {
    auth:{
      getSession: async () => { calls.push('getSession'); return { data:{ session:null } }; },
      onAuthStateChange: () => { calls.push('onAuthStateChange'); return { data:{ subscription:{ unsubscribe(){} } } }; },
      signInWithOtp: async () => ({ error:null }),
      signOut: async () => ({ error:null })
    }
  };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('Sign In explains loading before Supabase setup and "not configured" after setup without config', () => {
  const window = loadAppDom();
  const button = window.document.getElementById('auth-button');
  button.click();
  assert.match(window.document.getElementById('modal-content').textContent, /still loading/i);
  fireReady(window, { configured:false, client:false });
  button.click();
  assert.match(window.document.getElementById('auth-unavailable-title').textContent, /Sign-in not configured/);
  assert.match(window.document.getElementById('auth-unavailable-message').textContent, /supabase-browser-config\.local\.js/);
  assert.equal(window.__DJBattleTestHooks.getAuthInitState().liveMode, false);
});

test('auth initializes from the ready event when Supabase is created after app.js', async () => {
  const calls = [];
  const window = loadAppDom();
  assert.equal(window.__DJBattleTestHooks.getAuthInitState().initialized, false);
  window.SUPABASE_URL = 'https://example.supabase.co';
  window.SUPABASE_ANON_KEY = 'anon';
  window.supabase = mockSupabase(calls);
  fireReady(window, { configured:true, client:true });
  await tick();
  const state = window.__DJBattleTestHooks.getAuthInitState();
  assert.equal(state.reason, 'ready');
  assert.equal(state.liveMode, true);
  assert.ok(calls.includes('getSession'));
  assert.ok(calls.includes('onAuthStateChange'));
  window.document.getElementById('auth-button').click();
  assert.match(window.document.getElementById('modal-content').textContent, /Sign in with email/);
  assert.ok(window.document.getElementById('send-magic'));
});

test('auth initializes immediately when Supabase is already ready before app.js runs', async () => {
  const calls = [];
  const window = loadAppDom(win => {
    win.SUPABASE_URL = 'https://example.supabase.co';
    win.SUPABASE_ANON_KEY = 'anon';
    win.supabase = mockSupabase(calls);
    win.DJB_SUPABASE_STATE = { ready:true, configured:true, client:true };
  });
  await tick();
  assert.equal(window.__DJBattleTestHooks.getAuthInitState().reason, 'ready');
  assert.ok(calls.includes('getSession'));
});

test('Sign In reports an unavailable client when config exists but Supabase failed to load', () => {
  const window = loadAppDom();
  fireReady(window, { configured:true, client:false, error:'network' });
  window.document.getElementById('auth-button').click();
  assert.match(window.document.getElementById('auth-unavailable-title').textContent, /Sign-in unavailable/);
});

test('index.html publishes a Supabase ready event and mobile CSS keeps Sign In visible', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(index, /dispatchEvent\(new CustomEvent\('djb:supabase-ready'/);
  assert.match(index, /window\.DJB_SUPABASE_STATE = supabaseState/);
  const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const redesign = fs.readFileSync(path.join(root, 'professional-redesign.css'), 'utf8');
  assert.match(styles, /\.top-actions \.ghost:not\(#auth-button\)/);
  assert.doesNotMatch(styles, /\.top-actions \.ghost,/);
  assert.match(redesign, /\.top-actions>\.ghost:not\(#auth-button\)\{/);
  assert.doesNotMatch(redesign, /\.top-actions>\.ghost\{/);
});
