const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { apiUrl, apiBaseUrl, apiRequest } = require('../api_client');

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

const okResponse = () => ({ ok:true, status:200, text: async () => '{"posts":[]}' });

test('apiUrl joins a configured base and keeps relative paths by default', () => {
  assert.equal(apiUrl('/api/community/feed'), '/api/community/feed');
  assert.equal(apiUrl('/api/community/feed', { apiBase:'http://localhost:4000/' }), 'http://localhost:4000/api/community/feed');
  assert.equal(apiUrl('api/x', { apiBase:'https://api.example.com/base' }), 'https://api.example.com/base/api/x');
  assert.equal(apiUrl('https://other.example.com/api/x', { apiBase:'http://localhost:4000' }), 'https://other.example.com/api/x');
  assert.equal(apiBaseUrl({ apiBase:'  http://localhost:4000//  ' }), 'http://localhost:4000');
});

test('apiRequest sends requests to the configured API base', async () => {
  let url;
  await apiRequest('/api/publicLeaderboards', { public:true, apiBase:'http://localhost:4000', fetch: async target => { url = target; return okResponse(); } });
  assert.equal(url, 'http://localhost:4000/api/publicLeaderboards');
});

test('window.DJB_API_BASE routes app requests to the separate server', async () => {
  const urls = [];
  const window = loadAppDom(win => {
    win.DJB_API_BASE = 'http://localhost:4000';
    win.fetch = async target => { urls.push(target); return okResponse(); };
  });
  await window.DJBattleApi.apiRequest('/api/community/feed?page=1', { public:true });
  assert.ok(urls.includes('http://localhost:4000/api/community/feed?page=1'));
  assert.ok(urls.every(target => !String(target).startsWith('/api/')), 'no relative /api calls when a base is configured');
});

test('file:// pages default to the local API server port', () => {
  const { window } = new JSDOM('<!doctype html><body></body>', { url:'file:///home/dj/djb/index.html', runScripts:'outside-only' });
  window.eval(fs.readFileSync(path.join(root, 'api_client.js'), 'utf8'));
  assert.equal(window.DJBattleApi.apiBaseUrl(), 'http://localhost:4000');
});

test('offline demo banner explains sample data when live mode is not configured', () => {
  const window = loadAppDom(win => { win.fetch = async () => okResponse(); });
  const banner = window.document.getElementById('offline-demo-banner');
  assert.ok(banner.classList.contains('hidden'));
  window.DJB_SUPABASE_STATE = { ready:true, configured:false, client:false };
  window.dispatchEvent(new window.CustomEvent('djb:supabase-ready', { detail:window.DJB_SUPABASE_STATE }));
  assert.equal(banner.classList.contains('hidden'), false);
  assert.match(banner.textContent, /Offline demo data/);
  assert.match(banner.textContent, /built-in sample/);
});

test('offline demo banner and community status show when the server is unreachable', async () => {
  const window = loadAppDom(win => {
    win.DJB_API_BASE = 'http://localhost:4000';
    win.fetch = async () => { throw new Error('connection refused'); };
  });
  await window.__DJBattleTestHooks.loadCommunityFeed({ feed:'recent', page:1 });
  const banner = window.document.getElementById('offline-demo-banner');
  assert.equal(banner.classList.contains('hidden'), false);
  assert.match(banner.textContent, /Can't reach the DJ Battle server at http:\/\/localhost:4000/);
  const status = window.document.getElementById('community-status').textContent;
  assert.match(status, /Offline demo data/);
  assert.match(status, /built-in sample posts/);
  assert.doesNotMatch(status, /Showing available community posts/);
  assert.equal(window.__DJBattleTestHooks.getDataSourceState().serverReachable, false);
});

test('example browser config documents DJB_API_BASE', () => {
  const example = fs.readFileSync(path.join(root, 'supabase-browser-config.example.js'), 'utf8');
  assert.match(example, /window\.DJB_API_BASE = ''/);
  const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.doesNotMatch(appSource, /[^.\w]fetch\(\s*['`]\/api/, 'app.js routes API calls through DJBattleApi');
});
