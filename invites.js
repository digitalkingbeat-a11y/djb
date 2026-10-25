// Oct 20c: personal invite-a-friend links. Profile shows "Invite friends" with your own link
// (Copy / Share), how many friends joined through it and a badge. Opening a link with
// ?invite=CODE remembers the code; once that person signs up and signs in, the server credits the
// inviter (brand-new accounts only, once). Loaded after app.js, social.js, oct20b.js and passkeys.js.
(function(){
  'use strict';
  const W = window;
  const D = document;
  const esc = s => (typeof W.esc === 'function' ? W.esc(s) : String(s == null ? '' : s).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c])));
  const hasApi = () => Boolean(W.DJBattleApi && typeof W.DJBattleApi.apiRequest === 'function');
  const api = (path, opts) => hasApi() ? W.DJBattleApi.apiRequest(path, opts) : Promise.resolve({ error:'The server is not connected', status:0 });
  const signedIn = () => typeof W.djbSignedIn === 'function' && W.djbSignedIn();
  const toast = (title, body) => { if(typeof W.showAppToast === 'function') W.showAppToast(title, body); };
  const needsServer = r => !r || r.status === 0 || r.status === 404 && !r.data || r.status === 502 || (r.status === 503 && !(r.data && r.data.schemaMissing));
  const schemaMissing = r => r && r.status === 503 && r.data && r.data.schemaMissing;
  const errText = (r, fallback) => (r && r.data && r.data.error) || (r && typeof r.error === 'string' && r.error) || fallback;
  const KEY = 'djbPendingInvite';
  const KEEP_MS = 30 * 24 * 60 * 60 * 1000; // a remembered link is good for 30 days
  const normCode = v => String(v == null ? '' : v).trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  const state = { status:'idle', invite:null, error:'', copied:false, pending:null, claiming:false };

  /* ---------- the link itself ---------- */
  function inviteUrl(code){
    let base;
    try{ const u = new URL(W.location.href); base = `${u.origin}${u.pathname.replace(/index\.html$/, '')}`; }catch(e){ base = ''; }
    return `${base}?invite=${encodeURIComponent(normCode(code))}`;
  }
  function readPending(now = Date.now()){
    try{
      const v = JSON.parse(W.localStorage.getItem(KEY) || 'null');
      if(!v || !/^[A-Z0-9]{6,12}$/.test(v.code || '') || now - Number(v.at || 0) > KEEP_MS){ W.localStorage.removeItem(KEY); return null; }
      return v;
    }catch(e){ return null; }
  }
  function clearPending(){ try{ W.localStorage.removeItem(KEY); }catch(e){} state.pending = null; }
  // Reads ?invite=CODE from the address, remembers it and tidies the address bar.
  function captureFromUrl(){
    let url;
    try{ url = new URL(W.location.href); }catch(e){ return null; }
    const code = normCode(url.searchParams.get('invite'));
    if(!/^[A-Z0-9]{6,12}$/.test(code)) return readPending();
    const pending = { code, at:Date.now(), inviterName:null };
    try{ W.localStorage.setItem(KEY, JSON.stringify(pending)); }catch(e){}
    url.searchParams.delete('invite');
    try{ W.history.replaceState(W.history.state, '', `${url.pathname}${url.search}${url.hash}`); }catch(e){}
    return pending;
  }

  /* ---------- someone arriving through a link ---------- */
  function renderWelcome(){
    const p = state.pending;
    let bar = D.getElementById('invite-welcome');
    if(!p || signedIn()){ if(bar) bar.remove(); return; }
    if(!bar){
      bar = D.createElement('div'); bar.id = 'invite-welcome'; bar.className = 'invite-welcome'; bar.setAttribute('role', 'status');
      const main = D.querySelector('.main'); if(!main) return;
      main.insertBefore(bar, main.firstChild);
    }
    const who = p.inviterName ? `<strong>${esc(p.inviterName)}</strong> invited you` : 'A friend invited you';
    bar.innerHTML = `<span class="invite-welcome-icon" aria-hidden="true">🎧</span><span>${who} to DJ Battle. Make a free account to battle them and climb the rankings.</span><button class="primary small" type="button" id="invite-welcome-join">Sign up free</button><button class="text-btn" type="button" id="invite-welcome-close" aria-label="Hide">✕</button>`;
    D.getElementById('invite-welcome-join').onclick = () => { if(typeof W.openSignInModal === 'function') W.openSignInModal(); };
    D.getElementById('invite-welcome-close').onclick = () => bar.remove();
  }
  async function lookupInviter(){
    const p = state.pending;
    if(!p || p.inviterName) return p;
    const r = await api(`/api/invites/${encodeURIComponent(p.code)}`, { public:true });
    if(!r.error && r.data && r.data.invite){ p.inviterName = r.data.invite.inviter && r.data.invite.inviter.displayName || null; try{ W.localStorage.setItem(KEY, JSON.stringify(p)); }catch(e){} }
    else if(r.status === 404 && r.data && r.data.error === 'Not found'){ clearPending(); } // a code that doesn't exist (not just "server offline")
    renderWelcome();
    return state.pending;
  }
  // After sign-in: tell the server which link brought this DJ here (it decides if it counts).
  async function claimPending(){
    const p = state.pending || readPending();
    if(!p || !signedIn() || state.claiming) return null;
    state.claiming = true;
    try{
      const r = await api('/api/invites/claim', { method:'POST', body:{ code:p.code } });
      if(r.error && (needsServer(r) || schemaMissing(r) || r.status === 429)) return r; // keep it and try again next time
      clearPending(); renderWelcome();
      if(!r.error && r.data && r.data.claimed){
        const name = r.data.inviter && r.data.inviter.displayName;
        toast('Welcome to DJ Battle!', name ? `You joined through ${name}'s invite. Challenge them to a battle!` : 'You joined through a friend\u2019s invite.');
      }
      return r;
    }finally{ state.claiming = false; }
  }

  /* ---------- the inviter's Profile card ---------- */
  function ensurePanel(){
    const profile = D.getElementById('profile');
    if(!profile) return null;
    let panel = D.getElementById('profile-invite');
    if(!panel){
      panel = D.createElement('section'); panel.className = 'panel profile-invite'; panel.id = 'profile-invite';
      profile.insertBefore(panel, profile.querySelector('.profile-tabs') || null);
    }
    return panel;
  }
  function badgeHtml(inv){
    if(!inv || !inv.badge) return '';
    return `<span class="invite-badge" id="invite-badge" title="Invite badge">${esc(inv.badge.emoji)} ${esc(inv.badge.label)}</span>`;
  }
  function render(){
    const panel = ensurePanel();
    if(!panel) return;
    const inv = state.invite;
    let body;
    if(state.status === 'signed-out') body = '<p class="social-note">Sign in to get your personal invite link.</p>';
    else if(state.status === 'loading' && !inv) body = '<p class="social-note">Loading…</p>';
    else if(state.status === 'needs-server') body = '<p class="social-note">Your invite link shows here once the DJ Battle server is running.</p>';
    else if(state.status === 'schema-missing') body = '<p class="social-note">Invite links need one setup step: run server/sql/048_create_dj_invites.sql in Supabase.</p>';
    else if(!inv) body = `<p class="social-note" role="alert">${esc(state.error || 'Your invite link could not load.')}</p>`;
    else{
      const url = inviteUrl(inv.code);
      const canShare = Boolean(W.navigator && typeof W.navigator.share === 'function');
      const count = Number(inv.joinCount || 0);
      const next = inv.next ? `<small class="invite-next">${esc(inv.next.needed)} more to unlock ${esc(inv.next.emoji)} ${esc(inv.next.label)}</small>` : '<small class="invite-next">Top badge unlocked. Legend.</small>';
      const friends = (inv.friends || []).length
        ? `<ul class="invite-friends" id="invite-friends">${inv.friends.map(f => `<li><span class="avatar" aria-hidden="true">${esc(String(f.displayName || 'DJ').slice(0, 1).toUpperCase())}</span><span><strong>${esc(f.displayName || 'DJ')}</strong><small>joined ${esc(new Date(f.joinedAt).toLocaleDateString())}</small></span></li>`).join('')}</ul>`
        : '<p class="social-note">No friends have joined yet. Send your link to a DJ you want to battle.</p>';
      body = `<p class="social-note">Send this link to DJ friends. When they make an account through it, they count as your invite.</p>
        <div class="invite-link-row"><input class="invite-link" id="invite-link" readonly value="${esc(url)}" aria-label="Your invite link"><button class="primary small" type="button" id="invite-copy">${state.copied ? 'Copied!' : 'Copy link'}</button>${canShare ? '<button class="ghost small" type="button" id="invite-share">Share</button>' : ''}</div>
        <div class="invite-stats"><div class="invite-count"><strong id="invite-join-count">${esc(count)}</strong><span>${count === 1 ? 'friend joined' : 'friends joined'}</span></div><div class="invite-badge-wrap">${badgeHtml(inv) || '<span class="invite-badge locked">🔒 First badge at 1 friend</span>'}${next}</div></div>
        ${friends}`;
    }
    panel.innerHTML = `<div class="section-head compact"><div><span class="eyebrow">INVITE FRIENDS</span><h3>Your invite link</h3></div></div>${body}`;
    const copy = D.getElementById('invite-copy');
    if(copy) copy.onclick = () => copyLink();
    const share = D.getElementById('invite-share');
    if(share) share.onclick = () => shareLink();
  }
  async function copyLink(){
    const input = D.getElementById('invite-link');
    if(!input) return false;
    let ok = false;
    try{ if(W.navigator.clipboard){ await W.navigator.clipboard.writeText(input.value); ok = true; } }catch(e){}
    if(!ok){ try{ input.select(); ok = D.execCommand('copy'); }catch(e){} }
    if(ok){ state.copied = true; render(); setTimeout(() => { state.copied = false; render(); }, 2000); toast('Invite link copied', 'Paste it in a text, DM or group chat.'); }
    else toast('Copy the link', 'Select the link and copy it.');
    return ok;
  }
  async function shareLink(){
    if(!state.invite) return false;
    try{ await W.navigator.share({ title:'Battle me on DJ Battle', text:'Join me on DJ Battle and let\u2019s battle!', url:inviteUrl(state.invite.code) }); return true; }catch(e){ return false; }
  }
  async function load(){
    if(!signedIn()){ state.status = 'signed-out'; state.invite = null; render(); return null; }
    state.status = 'loading'; state.error = ''; render();
    const r = await api('/api/invites/mine');
    if(r.error){
      state.status = schemaMissing(r) ? 'schema-missing' : needsServer(r) ? 'needs-server' : 'error';
      state.error = errText(r, 'Your invite link could not load.');
      if(state.status !== 'error') state.invite = null;
    }else{ state.invite = r.data.invite || null; state.status = 'ready'; }
    render();
    return r;
  }
  // Activity-bell "A friend joined" alert opens Profile at the invite card.
  async function focus(){
    if(typeof W.switchView === 'function') W.switchView('profile');
    await load();
    const panel = D.getElementById('profile-invite');
    if(panel && panel.scrollIntoView) panel.scrollIntoView({ block:'start', behavior:'smooth' });
    return panel;
  }
  function onView(view){ if(view === 'profile') load().catch(() => {}); }
  W.addEventListener('djb:auth-changed', e => {
    if(e && e.detail && e.detail.signedIn) claimPending().catch(() => {});
    renderWelcome();
    const v = D.querySelector('.view.active'); if(v && v.id === 'profile') load().catch(() => {});
  });

  state.pending = captureFromUrl();
  W.DJBInvites = { onView, load, render, state:() => state, inviteUrl, captureFromUrl, readPending, claimPending, lookupInviter, renderWelcome, copyLink, shareLink, focus, normCode };
  if(state.pending){ renderWelcome(); lookupInviter().catch(() => {}); if(signedIn()) claimPending().catch(() => {}); }
  const active = D.querySelector('.view.active');
  if(active && active.id === 'profile') onView('profile');
})();
