const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');

function loadAppDom(){
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(index, { url:'http://127.0.0.1/index.html', runScripts:'outside-only', pretendToBeVisual:true });
  const { window } = dom;
  window.alert = () => {};
  window.confirm = () => true;
  window.scrollTo = () => {};
  window.HTMLDialogElement.prototype.showModal = function showModal(){ this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function close(){ this.removeAttribute('open'); };
  window.fetch = async () => ({ ok:false, status:503, text: async () => '{}', json: async () => ({}) });
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'].forEach(file => {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    window.eval(file === 'app.js' ? `${code}\n;window.__inApp = source => eval(source);` : code);
  });
  return { window };
}

function openSignIn(window, impl){
  window.supabase = { auth:{ signInWithOtp: impl } };
  window.__inApp('openSignInModal()');
  return new Promise(r => window.setTimeout(r, 5));
}
const tick = (w, ms=5) => new Promise(r => w.setTimeout(r, ms));

test('invalid email shows an inline message and does not send', async () => {
  const { window } = loadAppDom(); let calls = 0;
  await openSignIn(window, async () => { calls++; return { error:null }; });
  const doc = window.document;
  doc.getElementById('auth-email').value = 'dj.at.mail';
  doc.getElementById('send-magic').click(); await tick(window);
  assert.equal(calls, 0);
  assert.match(doc.getElementById('auth-email-msg').textContent, /doesn't look like an email/);
  assert.equal(doc.getElementById('auth-email').getAttribute('aria-invalid'), 'true');
  doc.getElementById('auth-email').value = '';
  doc.getElementById('send-magic').click(); await tick(window);
  assert.match(doc.getElementById('auth-email-msg').textContent, /Enter your email/);
  assert.equal(calls, 0);
});

test('button shows Sending… and ignores double clicks, then counts down to resend', async () => {
  const { window } = loadAppDom(); let calls = 0, resolve;
  await openSignIn(window, () => { calls++; return new Promise(r => { resolve = r; }); });
  const doc = window.document; const btn = doc.getElementById('send-magic');
  doc.getElementById('auth-email').value = 'dk@djmail.com';
  btn.click(); btn.click(); await tick(window);
  assert.equal(calls, 1);
  assert.equal(btn.disabled, true);
  assert.equal(btn.textContent, 'Sending…');
  resolve({ error:null }); await tick(window);
  assert.equal(btn.textContent, 'Resend in 30s');
  assert.equal(btn.disabled, true);
  assert.match(doc.getElementById('auth-email-msg').textContent, /Magic link sent to dk@djmail.com/);
  window.__inApp('startSignInResendCountdown(document.getElementById("send-magic"), 0)');
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent, 'Resend Magic Link');
});

test('errors show the real reason and re-enable the button', async () => {
  const { window } = loadAppDom();
  await openSignIn(window, async () => ({ error:{ status:429, message:'Email rate limit exceeded' } }));
  const doc = window.document; const btn = doc.getElementById('send-magic');
  doc.getElementById('auth-email').value = 'dk@djmail.com';
  btn.click(); await tick(window);
  assert.match(doc.getElementById('auth-email-msg').textContent, /Too many sign-in emails.*Email rate limit exceeded/);
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent, 'Send Magic Link');
  assert.doesNotMatch(doc.body.textContent, /Sign-in error/);
  assert.match(window.__inApp('describeSignInError(new TypeError("Failed to fetch"))'), /Couldn't reach the sign-in service/);
  assert.equal(window.__inApp('describeSignInError({message:"Database exploded"})'), 'Sign-in failed: Database exploded');
});
