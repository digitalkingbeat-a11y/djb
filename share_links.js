// Oct 25: beat share links that credit the DJ who shared.
// Every DJ can grab a personal link for a beat (?beat=<id>&ref=<code>). When someone opens it,
// the visit is counted; a preview play and a purchase made within 7 days are credited too.
// Sellers see, per beat, which DJs' links brought visits, plays and sales (names only).
(function(W){
  'use strict';
  const D = W.document;
  const REF_KEY = 'djbShareRef';
  const REF_DAYS = 7;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const hasApi = () => Boolean(W.DJBattleApi && typeof W.DJBattleApi.apiRequest === 'function');
  const api = (p, o) => hasApi() ? W.DJBattleApi.apiRequest(p, o) : Promise.resolve({ error:'The server is not connected', status:0 });
  const toast = (t, m) => { if(typeof W.showAppToast === 'function') W.showAppToast(t, m); };
  const signedIn = () => typeof W.djbSignedIn === 'function' ? W.djbSignedIn() : false;
  const visitor = () => (typeof W.publicVisitorId === 'function' ? W.publicVisitorId() : null);
  const money = (c, cur) => { try{ return new Intl.NumberFormat('en-US', { style:'currency', currency:cur || 'USD' }).format((c || 0) / 100); }catch(_){ return `$${((c || 0) / 100).toFixed(2)}`; } };
  const CODE_RE = /^[a-z0-9]{10}$/;

  // ---- the visitor side ----
  function linkUrl(listingId, code, loc = W.location){
    return `${loc.origin}${loc.pathname.replace(/[^/]*$/, '')}index.html?beat=${encodeURIComponent(listingId)}&ref=${code}#store`;
  }
  function readRef(now = Date.now()){
    try{
      const r = JSON.parse(W.localStorage.getItem(REF_KEY) || 'null');
      if(!r || !CODE_RE.test(r.code) || now - Number(r.at) > REF_DAYS * 86400000) return null;
      return r;
    }catch(_){ return null; }
  }
  function refFor(listingId){ const r = readRef(); return r && String(r.listingId) === String(listingId) ? r : null; }
  function sendEvent(kind, ref){
    if(!ref) return Promise.resolve(null);
    return api('/api/marketplace/shareEvents', { method:'POST', public:!signedIn(), body:{ code:ref.code, listingId:ref.listingId, kind, visitorId:visitor() } }).catch(() => null);
  }
  // Reads ?beat=&ref= once, remembers it, counts the visit and tidies the address bar.
  function captureShareLink(){
    try{
      const url = new URL(W.location.href);
      const listingId = url.searchParams.get('beat'); const code = String(url.searchParams.get('ref') || '').toLowerCase();
      if(!listingId || !CODE_RE.test(code)) return null;
      const ref = { listingId, code, at:Date.now() };
      W.localStorage.setItem(REF_KEY, JSON.stringify(ref));
      url.searchParams.delete('beat'); url.searchParams.delete('ref');
      W.history.replaceState(null, '', url.pathname + (url.search || '') + (url.hash || '#store'));
      state.focus = listingId;
      sendEvent('visit', ref);
      return ref;
    }catch(_){ return null; }
  }
  // Extra checkout fields: credit the sharer if this beat came from a share link.
  function checkoutExtras(listingId){ const r = refFor(listingId); return r ? { shareCode:r.code } : {}; }
  function onPreviewClick(e){
    const btn = e.target && e.target.closest && e.target.closest('[data-s25-preview]');
    if(!btn) return;
    const id = btn.dataset.s25Preview; const r = refFor(id);
    if(r && signedIn() && !state.played.has(id)){ state.played.add(id); sendEvent('play', r); }
  }

  // ---- the sharer side ----
  async function getLink(listingId){
    if(!signedIn()){ toast('Sign in to share', 'Sign in (free) to get your own link. Sales through it are credited to you.'); return { signedOut:true }; }
    const r = await api(`/api/marketplace/listings/${encodeURIComponent(listingId)}/shareLink`, { method:'POST', body:{} });
    if(r.error){ toast('Share link unavailable', (r.data && r.data.error) || r.error); return { error:r.error }; }
    const code = r.data && r.data.code;
    if(!CODE_RE.test(String(code || ''))) return { error:'bad code' };
    return { code, url:linkUrl(listingId, code) };
  }
  function shareDialog(listing, url){
    let dlg = D.getElementById('share-link-dialog');
    if(!dlg){ dlg = D.createElement('dialog'); dlg.id = 'share-link-dialog'; dlg.className = 'oct20b-dialog s25-dialog share-link-dialog'; D.body.appendChild(dlg); }
    dlg.innerHTML = `<form method="dialog"><span class="eyebrow accent">SHARE</span><h3>Your link for ${esc(listing ? listing.title : 'this beat')}</h3>
      <p class="muted">Post this anywhere. The producer sees how many visits, plays and sales came from your link, shown under your DJ name.</p>
      <input class="share-link-url" id="share-link-url" readonly value="${esc(url)}" aria-label="Your share link">
      <div class="modal-actions"><button class="primary" type="button" id="share-link-copy">Copy link</button>${W.navigator && W.navigator.share ? '<button class="ghost" type="button" id="share-link-native">Share…</button>' : ''}<button class="ghost" value="cancel">Close</button></div></form>`;
    D.getElementById('share-link-copy').onclick = async () => {
      try{ await W.navigator.clipboard.writeText(url); toast('Link copied', 'Paste it wherever you like.'); }catch(_){ const i = D.getElementById('share-link-url'); i.select(); }
    };
    const n = D.getElementById('share-link-native');
    if(n) n.onclick = () => W.navigator.share({ title:listing ? listing.title : 'Beat', url }).catch(() => {});
    if(dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    return dlg;
  }
  async function share(listingId){
    const res = await getLink(listingId);
    if(!res.url) return res;
    const all = typeof W.djbBeatStoreListings === 'function' ? W.djbBeatStoreListings() : [];
    shareDialog(all.find(l => String(l.id) === String(listingId)), res.url);
    return res;
  }
  function addButton(host, id){
    if(!host || host.querySelector('[data-share-link]')) return;
    const b = D.createElement('button'); b.type = 'button'; b.className = 'ghost small share-link-btn'; b.dataset.shareLink = id; b.textContent = '🔗 Share';
    b.title = 'Get your own link. Sales through it are credited to you.';
    b.onclick = () => share(id).catch(() => {});
    host.appendChild(b);
  }
  function decorate(){
    D.querySelectorAll('#store-grid [data-store-listing]').forEach(card => {
      const id = card.dataset.storeListing;
      addButton(card.querySelector('.store-card-foot') || card.querySelector('.store-body') || card, id);
      if(state.focus && String(state.focus) === String(id)){
        card.classList.add('share-focus');
        if(card.scrollIntoView) card.scrollIntoView({ block:'center' });
        state.focus = null;
      }
    });
  }

  // ---- the seller side ----
  const state = { stats:null, statsStatus:'idle', played:new Set(), focus:null };
  function statsHtml(data, sample){
    const tag = sample ? ' <span class="sample-tag">Sample data</span>' : '';
    const head = `<h4>Shared by DJs${tag}</h4>`;
    if(data && data.schemaMissing) return `${head}<p class="muted">Share counts switch on after the server update (SQL 053).</p>`;
    const rows = (data && data.rows) || [];
    if(!rows.length) return `${head}<div class="sales-empty" data-shares-empty><strong>No shared visits yet</strong><p class="muted">When a DJ shares one of your beats with their own link, you'll see what it brought in here.</p></div>`;
    const t = data.totals || {};
    return `${head}<div class="store-earnings"><div><b>${t.sharers || 0}</b><span>DJs sharing</span></div><div><b>${t.visits || 0}</b><span>visits</span></div><div><b>${t.plays || 0}</b><span>plays</span></div><div><b>${t.sales || 0}</b><span>sales</span></div></div>
      <div class="share-table-wrap"><table class="share-table"><thead><tr><th>DJ</th><th>Beat</th><th>Visits</th><th>Plays</th><th>Sales</th></tr></thead><tbody>${rows.slice(0, 25).map(r => `<tr><td>${esc(r.sharerName)}${r.isYou ? ' <em>(you)</em>' : ''}</td><td>${esc(r.listingTitle)}</td><td>${r.visits}</td><td>${r.plays}</td><td>${r.sales}${r.sales ? ` <span class="muted">${esc(money(r.earningsCents, r.currency))}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }
  async function loadStats(){
    if(state.statsStatus === 'loading') return;
    state.statsStatus = 'loading';
    const r = await api('/api/marketplace/shareStats').catch(() => ({ error:'failed' }));
    state.stats = r.error ? null : (r.data || null);
    state.statsStatus = r.error ? 'failed' : 'ready';
    renderStats();
  }
  function renderStats(){
    const box = D.getElementById('store-shares');
    if(!box) return;
    const mine = typeof W.djbBeatStoreMine === 'function' ? W.djbBeatStoreMine() : [];
    if(!state.sample && !mine.length){ box.innerHTML = ''; return; }
    if(state.sample){ box.innerHTML = statsHtml(state.sample, true); return; }
    if(state.statsStatus === 'idle'){ box.innerHTML = '<p class="muted">Loading share counts…</p>'; loadStats(); return; }
    if(state.statsStatus === 'failed'){ box.innerHTML = '<h4>Shared by DJs</h4><p class="muted">Share counts could not be loaded right now.</p>'; return; }
    if(state.statsStatus === 'ready') box.innerHTML = statsHtml(state.stats, false);
  }
  function refresh(){ state.statsStatus = 'idle'; renderStats(); }

  D.addEventListener('click', onPreviewClick, true);
  if(captureShareLink()){
    const go = () => { if(typeof W.switchView === 'function') W.switchView('store'); else W.location.hash = '#store'; };
    if(D.readyState === 'loading') D.addEventListener('DOMContentLoaded', go); else setTimeout(go, 0);
  }

  W.DJBShareLinks = { REF_DAYS, linkUrl, readRef, refFor, captureShareLink, checkoutExtras, getLink, share, decorate, statsHtml, renderStats, refresh, _state:state };
})(window);
