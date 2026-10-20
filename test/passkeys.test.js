// Passkey sign-in (Supabase Auth's built-in WebAuthn passkeys) + Settings > Security list.
const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const windows = [];
test.after(() => windows.forEach(w => { try{ w.close(); }catch(e){} }));
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const settle = async (n = 8) => { for(let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

function fakeAuth(overrides = {}){
  const calls = [];
  const items = [{ id:'pk1', friendly_name:'iPhone (Safari)', created_at:'2026-10-01T12:00:00Z', last_used_at:'2026-10-19T08:00:00Z' }];
  const auth = {
    calls, items,
    onAuthStateChange(){ return { data:{ subscription:{ unsubscribe(){} } } }; },
    getSession: async () => ({ data:{ session:null } }),
    signInWithPasskey: async () => { calls.push(['signIn']); return { data:{ session:{} }, error:null }; },
    registerPasskey: async () => { calls.push(['register']); items.push({ id:'pk2', created_at:'2026-10-20T07:00:00Z' }); return { data:{ id:'pk2', created_at:'2026-10-20T07:00:00Z' }, error:null }; },
    passkey:{
      list: async () => { calls.push(['list']); return { data:items.slice(), error:null }; },
      update: async p => { calls.push(['update', p]); const k = items.find(i => i.id === p.passkeyId); if(k) k.friendly_name = p.friendlyName; return { data:k, error:null }; },
      delete: async p => { calls.push(['delete', p]); const i = items.findIndex(k => k.id === p.passkeyId); if(i >= 0) items.splice(i, 1); return { data:null, error:null }; }
    },
    ...overrides
  };
  return auth;
}
function loadAppDom({ webauthn = true, auth = fakeAuth() } = {}){
  const dom = new JSDOM(read('index.html'), { url:'https://127.0.0.1/index.html', runScripts:'outside-only', pretendToBeVisual:true });
  const { window } = dom;
  window.alert = () => {}; window.confirm = () => true; window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = function(){};
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLDialogElement.prototype.showModal = function(){ this.setAttribute('open', ''); this.open = true; };
  window.HTMLDialogElement.prototype.close = function(){ this.removeAttribute('open'); this.open = false; this.dispatchEvent(new window.Event('close')); };
  window.fetch = async () => ({ ok:false, status:503, text:async () => '{}', json:async () => ({}) });
  window.matchMedia = q => ({ matches:false, media:q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} });
  if(webauthn){
    window.PublicKeyCredential = function(){};
    Object.defineProperty(window.navigator, 'credentials', { value:{ create(){}, get(){} }, configurable:true });
  }
  window.supabase = { auth };
  const beltScript = Array.from(window.document.querySelectorAll('script:not([src])')).find(s => s.textContent.includes('setCurrentBelt'));
  if(beltScript) window.eval(beltScript.textContent);
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/beatmatch_lessons.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js', 'social.js', 'connect.js', 'oct20.js', 'oct20b.js', 'passkeys.js'].forEach(f => window.eval(read(f)));
  windows.push(window);
  return { window, auth };
}
const signIn = w => w.__DJBattleTestHooks.updateAuthUI({ id:'user-1', email:'dj@example.com', user_metadata:{ full_name:'Sample DJ' } });

test('passkeys.js is wired into the page, offline cache, Pages build and build checks; Supabase client opts in', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('passkeys.js') > html.indexOf('oct20b.js'));
  assert.match(read('sw.js'), /'passkeys\.js'/);
  assert.match(read('scripts/build-pages.js'), /'passkeys\.js'/);
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.build, /node --check passkeys\.js/);
  assert.match(pkg.scripts.test, /test\/passkeys\.test\.js/);
  assert.match(html, /experimental:\{ passkey:true \}/);
  const v = html.match(/supabase-js@(\d+)\.(\d+)\.(\d+)\/\+esm/);
  assert.ok(v && Number(v[1]) === 2 && Number(v[2]) >= 105, 'supabase-js must be pinned to 2.105+ for passkeys');
  assert.match(read('app.js'), /DJBPasskeys\.onView\(view\)/);
});

test('sign-in screen shows "Sign in with passkey" only when the browser supports it, and keeps the email link', async () => {
  const { window } = loadAppDom();
  window.openSignInModal(); await settle();
  const btn = window.document.getElementById('passkey-signin');
  assert.ok(btn, 'passkey button shown');
  assert.ok(window.document.getElementById('send-magic'), 'email link still there');
  assert.equal(window.document.querySelectorAll('#passkey-signin').length, 1);
  const { window: w2 } = loadAppDom({ webauthn:false });
  w2.openSignInModal(); await settle();
  assert.equal(w2.document.getElementById('passkey-signin'), null);
  assert.ok(w2.document.getElementById('send-magic'));
});

test('passkey sign-in success closes the dialog; a cancelled prompt gives a clear message', async () => {
  const { window, auth } = loadAppDom();
  window.openSignInModal(); await settle();
  const res = await window.DJBPasskeys.signIn();
  assert.equal(res.ok, true);
  assert.deepEqual(auth.calls[0], ['signIn']);
  assert.equal(window.document.getElementById('modal').open, false);

  const failing = fakeAuth({ signInWithPasskey: async () => ({ data:null, error:{ code:'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY', message:'x', cause:{ name:'NotAllowedError' } } }) });
  const { window: w2 } = loadAppDom({ auth:failing });
  w2.openSignInModal(); await settle();
  const r2 = await w2.DJBPasskeys.signIn();
  assert.match(r2.error, /email link/);
  const msg = w2.document.getElementById('auth-email-msg');
  assert.equal(msg.hidden, false);
  assert.match(msg.textContent, /No passkey was used/);
  assert.equal(w2.document.getElementById('passkey-signin').disabled, false);
});

test('error messages are plain words for the common cases', () => {
  const { window } = loadAppDom();
  const d = window.DJBPasskeys.describeError;
  assert.match(d({ code:'ERROR_INVALID_RP_ID' }, 'signin'), /web address/);
  assert.match(d({ message:'webauthn_challenge_expired' }, 'signin'), /expired/);
  assert.match(d({ code:'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' }, 'add'), /already has a passkey/);
  assert.match(d({ message:'Passkey authentication is disabled' }, 'signin'), /switched on/);
  assert.match(d({ message:'Failed to fetch' }, 'signin'), /connection/);
  assert.equal(window.DJBPasskeys.deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'), 'iPhone (Safari)');
  assert.equal(window.DJBPasskeys.deviceName('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36'), 'Android phone (Chrome)');
});

test('Settings > Security lists passkeys and lets a signed-in DJ add, rename and remove them', async () => {
  const { window, auth } = loadAppDom();
  await window.DJBPasskeys.load();
  assert.match(window.document.getElementById('settings-security-panel').textContent, /Sign in with your email link first/);
  signIn(window);
  await window.DJBPasskeys.load();
  const panel = window.document.getElementById('settings-security-panel');
  assert.match(panel.textContent, /iPhone \(Safari\)/);
  assert.match(panel.textContent, /Added/);
  assert.match(panel.textContent, /Last used/);
  // add: registers, then names it after this device
  const added = await window.DJBPasskeys.add();
  assert.equal(added.ok, true);
  const upd = auth.calls.find(c => c[0] === 'update');
  assert.equal(upd[1].passkeyId, 'pk2');
  assert.ok(upd[1].friendlyName.length > 0);
  assert.match(panel.textContent, /Not used yet/);
  // rename
  window.prompt = () => '  Studio laptop  ';
  assert.equal((await window.DJBPasskeys.rename('pk2')).ok, true);
  assert.equal(auth.items.find(k => k.id === 'pk2').friendly_name, 'Studio laptop');
  window.prompt = () => '   ';
  assert.match((await window.DJBPasskeys.rename('pk2')).error, /empty/);
  // remove asks first
  window.confirm = () => false;
  assert.equal((await window.DJBPasskeys.remove('pk1')).cancelled, true);
  window.confirm = () => true;
  assert.equal((await window.DJBPasskeys.remove('pk1')).ok, true);
  assert.ok(!/iPhone \(Safari\)/.test(panel.textContent));
  // user text is escaped
  auth.items.push({ id:'pk3', friendly_name:'<img src=x onerror=alert(1)>', created_at:'2026-10-20T07:00:00Z' });
  await window.DJBPasskeys.load();
  assert.equal(panel.querySelector('img'), null);
});

test('a failed add shows a clear message and re-enables the button', async () => {
  const auth = fakeAuth({ registerPasskey: async () => ({ data:null, error:{ code:'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY', cause:{ name:'NotAllowedError' } } }) });
  const { window } = loadAppDom({ auth });
  await settle();
  signIn(window);
  await window.DJBPasskeys.load();
  const r = await window.DJBPasskeys.add();
  assert.match(r.error, /wasn.t created/);
  const btn = window.document.getElementById('passkey-add');
  assert.equal(btn.disabled, false);
  assert.match(window.document.getElementById('passkey-status').textContent, /wasn.t created/);
});

test('server README documents the Passkeys setup (Supabase dashboard, RP ID, origins)', () => {
  const readme = read('server/README.md');
  assert.match(readme, /## Passkeys/);
  assert.match(readme, /Relying Party ID/);
  assert.match(readme, /digitalkingbeat-a11y\.github\.io/);
});
