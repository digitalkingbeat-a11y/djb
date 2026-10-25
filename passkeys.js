// Passkey sign-in (fingerprint / Face ID / screen lock) using Supabase Auth's built-in passkey support.
// Supabase stores the passkeys and issues the session; this file only adds the buttons and the Settings > Security list.
// Email magic-link sign-in stays exactly as it was and is always the fallback. Loaded after app.js and oct20b.js.
(function(){
  'use strict';
  const W = window;
  const D = document;
  const esc = s => (typeof W.esc === 'function' ? W.esc(s) : String(s == null ? '' : s).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c])));
  const signedIn = () => typeof W.djbSignedIn === 'function' && W.djbSignedIn();
  const toast = (title, body) => { if(typeof W.showAppToast === 'function') W.showAppToast(title, body); };
  const state = { status:'idle', items:[], error:'', busy:false };

  function browserSupportsPasskeys(){
    return Boolean(W.PublicKeyCredential && W.navigator && W.navigator.credentials && typeof W.navigator.credentials.create === 'function' && typeof W.navigator.credentials.get === 'function' && W.isSecureContext !== false);
  }
  const client = () => W.supabase && W.supabase.auth ? W.supabase.auth : null;
  const clientSupportsPasskeys = () => { const a = client(); return Boolean(a && typeof a.signInWithPasskey === 'function' && a.passkey); };
  const available = () => browserSupportsPasskeys() && clientSupportsPasskeys();

  // A short, readable name for the device a passkey was made on ("iPhone", "Android phone", "Mac", ...).
  function deviceName(ua){
    ua = String(ua == null ? (W.navigator && W.navigator.userAgent) || '' : ua);
    let device = 'This device';
    if(/iPhone/.test(ua)) device = 'iPhone';
    else if(/iPad/.test(ua)) device = 'iPad';
    else if(/Android/.test(ua)) device = /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
    else if(/Macintosh|Mac OS X/.test(ua)) device = 'Mac';
    else if(/Windows/.test(ua)) device = 'Windows PC';
    else if(/CrOS/.test(ua)) device = 'Chromebook';
    else if(/Linux/.test(ua)) device = 'Linux computer';
    let browser = '';
    if(/Edg\//.test(ua)) browser = 'Edge'; else if(/Firefox\//.test(ua)) browser = 'Firefox'; else if(/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome'; else if(/Safari\//.test(ua)) browser = 'Safari';
    return browser ? `${device} (${browser})` : device;
  }

  // Plain-words error messages. Covers the browser's own errors and Supabase's error codes.
  function describeError(err, action){
    const e = err || {};
    const cause = e.cause || {};
    const name = String(cause.name || e.name || '');
    const code = String(e.code || '');
    const msg = String(e.message || cause.message || '');
    const lower = (code + ' ' + msg).toLowerCase();
    const signIn = action === 'signin';
    if(code === 'ERROR_CEREMONY_ABORTED' || name === 'AbortError') return 'Cancelled. Nothing was changed.';
    if(name === 'NotAllowedError' || /not allowed|timed out|cancel/.test(lower)) return signIn ? 'No passkey was used. If you cancelled, try again, or sign in with an email link instead.' : 'The passkey wasn\u2019t created. If you cancelled, just try again.';
    if(code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || name === 'InvalidStateError') return 'This device already has a passkey for your account. You can use it to sign in.';
    if(code === 'ERROR_INVALID_DOMAIN' || code === 'ERROR_INVALID_RP_ID' || name === 'SecurityError') return 'Passkeys aren\u2019t set up for this web address yet. Dan needs to add it under Passkeys in Supabase (see server/README.md). Use the email link for now.';
    if(/does not support webauthn/.test(lower)) return 'This browser doesn\u2019t support passkeys. Use the email link instead.';
    if(/passkey.*(disabled|not enabled)|webauthn.*(disabled|not enabled)|provider_disabled|feature.*disabled|404/.test(lower)) return 'Passkeys aren\u2019t switched on for DJ Battle yet. Dan turns them on in Supabase. Use the email link for now.';
    if(/challenge_expired|expired/.test(lower)) return 'That took too long and the request expired. Please try again.';
    if(/credential.*not found|not_found|unknown credential|invalid_credentials/.test(lower)) return 'That passkey isn\u2019t linked to a DJ Battle account any more. Sign in with an email link, then add a new passkey in Settings > Security.';
    if(/email_not_confirmed|not confirmed/.test(lower)) return 'Confirm your email first by signing in with the email link once.';
    if(/banned/.test(lower)) return 'This account can\u2019t sign in right now.';
    if(/session|not authenticated|auth session missing/.test(lower)) return 'Your sign-in has expired. Sign in again, then retry.';
    if(/rate limit|too many/.test(lower)) return 'Too many tries. Wait a minute and try again.';
    if(/failed to fetch|network/.test(lower)) return 'Couldn\u2019t reach the sign-in service. Check your connection and try again.';
    return signIn ? 'Passkey sign-in didn\u2019t work. Try again, or use the email link.' : `That didn\u2019t work${msg ? `: ${msg}` : '.'}`;
  }

  /* ---------------- Sign-in screen ---------------- */
  function setMsg(text, kind){
    const el = D.getElementById('auth-email-msg'); if(!el) return;
    el.textContent = text || ''; el.className = 'auth-msg' + (kind ? ` auth-msg-${kind}` : ''); el.hidden = !text;
  }
  async function signInWithPasskey(){
    const btn = D.getElementById('passkey-signin');
    if(btn && btn.disabled) return { error:'busy' };
    if(!available()){ const m = describeError({ message:'does not support webauthn' }, 'signin'); setMsg(m, 'error'); return { error:m }; }
    if(btn){ btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Waiting for your passkey…'; }
    setMsg('', '');
    let result;
    try{ result = await client().signInWithPasskey(); }catch(err){ result = { error:err }; }
    if(btn){ btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = '🔑 Sign in with passkey'; }
    if(result && result.error){ const m = describeError(result.error, 'signin'); setMsg(m, 'error'); return { error:m }; }
    const modal = D.getElementById('modal');
    if(modal && modal.open && typeof modal.close === 'function') modal.close();
    toast('Signed in', 'Welcome back. You used your passkey.');
    return { ok:true };
  }
  function enhanceSignIn(){
    const send = D.getElementById('send-magic');
    if(!send || D.getElementById('passkey-signin')) return false;
    if(!browserSupportsPasskeys()) return false; // Only show the button where it can work.
    const wrap = D.createElement('div');
    wrap.className = 'passkey-signin';
    wrap.innerHTML = '<button class="primary passkey-btn" type="button" id="passkey-signin">🔑 Sign in with passkey</button><small>Use your fingerprint, face or phone screen lock. No email needed.</small><div class="passkey-or" aria-hidden="true"><span>or get an email link</span></div>';
    const anchor = D.querySelector('#modal-content .form-grid') || send.closest('.modal-actions') || send;
    anchor.parentElement.insertBefore(wrap, anchor);
    wrap.querySelector('#passkey-signin').onclick = () => signInWithPasskey();
    return true;
  }
  const originalOpenSignIn = W.openSignInModal;
  if(typeof originalOpenSignIn === 'function'){
    W.openSignInModal = function(){ const out = originalOpenSignIn.apply(this, arguments); enhanceSignIn(); setTimeout(enhanceSignIn, 0); return out; };
  }
  if(W.MutationObserver){
    const host = D.getElementById('modal-content');
    if(host) new W.MutationObserver(() => enhanceSignIn()).observe(host, { childList:true });
  }

  /* ---------------- Settings > Security ---------------- */
  function panel(){
    const grid = D.querySelector('#settings .settings-grid');
    if(!grid) return null;
    let p = D.getElementById('settings-security-panel');
    if(!p){ p = D.createElement('section'); p.className = 'panel'; p.id = 'settings-security-panel'; grid.insertBefore(p, grid.firstChild); }
    return p;
  }
  const shortDate = iso => { const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleDateString([], { year:'numeric', month:'short', day:'numeric' }); };
  function render(){
    const p = panel(); if(!p) return;
    let body;
    if(!signedIn()) body = '<p class="social-note">Sign in with your email link first, then add a passkey here.</p>';
    else if(!browserSupportsPasskeys()) body = '<p class="social-note">This browser can\u2019t use passkeys. Try Safari on iPhone, Chrome on Android, or any up-to-date desktop browser.</p>';
    else if(!clientSupportsPasskeys()) body = '<p class="social-note">Passkeys need the sign-in service to finish loading. Refresh the page and try again.</p>';
    else if(state.status === 'loading') body = '<p class="social-note">Loading your passkeys…</p>';
    else {
      const rows = state.items.map(k => `<li class="passkey-row" data-passkey-id="${esc(k.id)}"><span class="passkey-icon" aria-hidden="true">🔑</span><div class="passkey-meta"><strong>${esc(k.friendly_name || 'Passkey')}</strong><small>Added ${esc(shortDate(k.created_at))} · ${k.last_used_at ? `Last used ${esc(shortDate(k.last_used_at))}` : 'Not used yet'}</small></div><div class="passkey-actions"><button class="ghost small" type="button" data-passkey-rename="${esc(k.id)}">Rename</button><button class="ghost small danger" type="button" data-passkey-remove="${esc(k.id)}">Remove</button></div></li>`).join('');
      body = `${state.items.length ? `<ul class="passkey-list">${rows}</ul>` : '<p class="social-note">No passkeys yet. Add one and you can sign in with a fingerprint or face instead of waiting for an email.</p>'}
        <button class="primary small" type="button" id="passkey-add" ${state.busy ? 'disabled aria-busy="true"' : ''}>${state.busy ? 'Waiting for your device…' : '+ Add a passkey on this device'}</button>`;
    }
    p.innerHTML = `<span class="eyebrow">SECURITY</span><h3>Passkeys</h3><p>Sign in with your fingerprint, face or screen lock. Your email link always still works.</p>${body}<div class="social-note passkey-status" id="passkey-status" role="status" aria-live="polite">${esc(state.error)}</div>`;
    const add = p.querySelector('#passkey-add'); if(add) add.onclick = () => addPasskey();
    p.querySelectorAll('[data-passkey-rename]').forEach(b => { b.onclick = () => renamePasskey(b.dataset.passkeyRename); });
    p.querySelectorAll('[data-passkey-remove]').forEach(b => { b.onclick = () => removePasskey(b.dataset.passkeyRemove); });
  }
  async function load(){
    if(!signedIn() || !available()){ state.items = []; render(); return state; }
    state.status = 'loading'; render();
    let r; try{ r = await client().passkey.list(); }catch(err){ r = { error:err }; }
    state.status = 'ready';
    if(r && r.error){ state.items = []; state.error = describeError(r.error, 'list'); }
    else { state.items = Array.isArray(r && r.data) ? r.data : []; state.error = ''; }
    render();
    return state;
  }
  async function addPasskey(){
    if(state.busy) return { error:'busy' };
    state.busy = true; state.error = ''; render();
    let r; try{ r = await client().registerPasskey(); }catch(err){ r = { error:err }; }
    if(r && r.error){ state.busy = false; state.error = describeError(r.error, 'add'); render(); return { error:state.error }; }
    const id = r && r.data && r.data.id;
    if(id){ try{ await client().passkey.update({ passkeyId:id, friendlyName:deviceName() }); }catch(e){} }
    state.busy = false;
    toast('Passkey added', 'Next time, tap "Sign in with passkey".');
    await load();
    return { ok:true, id };
  }
  async function renamePasskey(id){
    const item = state.items.find(k => k.id === id);
    const answer = typeof W.prompt === 'function' ? W.prompt('Name this passkey (for example "My iPhone")', item && item.friendly_name || '') : null;
    if(answer == null) return { cancelled:true };
    const name = String(answer).trim().slice(0, 60);
    if(!name){ state.error = 'A passkey name can\u2019t be empty.'; render(); return { error:state.error }; }
    let r; try{ r = await client().passkey.update({ passkeyId:id, friendlyName:name }); }catch(err){ r = { error:err }; }
    if(r && r.error){ state.error = describeError(r.error, 'rename'); render(); return { error:state.error }; }
    state.error = ''; await load(); return { ok:true };
  }
  async function removePasskey(id){
    const item = state.items.find(k => k.id === id);
    const label = item && item.friendly_name || 'this passkey';
    const ok = typeof W.confirm === 'function' ? W.confirm(`Remove "${label}"? You won\u2019t be able to sign in with it any more. Your email link still works.`) : false;
    if(!ok) return { cancelled:true };
    let r; try{ r = await client().passkey.delete({ passkeyId:id }); }catch(err){ r = { error:err }; }
    if(r && r.error){ state.error = describeError(r.error, 'remove'); render(); return { error:state.error }; }
    state.error = ''; toast('Passkey removed', `"${label}" can no longer sign in.`);
    await load(); return { ok:true };
  }

  function onView(view){ if(view === 'settings') load().catch(() => {}); }
  W.addEventListener('djb:auth-changed', () => { const v = D.querySelector('.view.active'); if(v && v.id === 'settings') load().catch(() => {}); });

  W.DJBPasskeys = { onView, state:() => state, load, render, add:addPasskey, rename:renamePasskey, remove:removePasskey, signIn:signInWithPasskey, enhanceSignIn, browserSupportsPasskeys, available, deviceName, describeError };
  const active = D.querySelector('.view.active');
  if(active && active.id === 'settings') onView('settings');
})();
