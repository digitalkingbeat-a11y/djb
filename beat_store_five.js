// Oct 25 Store (Beat Store): per-beat licences, short tagged previews, the wishlist heart and
// gifting a beat at checkout. Loaded after app.js. Hooks: renderBeatStorePage → decorateBeatStore,
// renderBeatStoreMine → decorateMine, buyBeat → confirmPurchase. User text always goes through esc().
(function(){
  'use strict';
  const W = window;
  const D = document;
  const esc = s => (typeof W.esc === 'function' ? W.esc(s) : String(s == null ? '' : s).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c])));
  const hasApi = () => Boolean(W.DJBattleApi && typeof W.DJBattleApi.apiRequest === 'function');
  const api = (path, opts) => hasApi() ? W.DJBattleApi.apiRequest(path, opts) : Promise.resolve({ error:'The server is not connected', status:0 });
  const signedIn = () => typeof W.djbSignedIn === 'function' && W.djbSignedIn();
  const errText = (r, fallback) => (r && r.data && r.data.error) || (r && typeof r.error === 'string' && r.error) || fallback;
  const toast = (title, body) => { if(typeof W.showAppToast === 'function') W.showAppToast(title, body); };
  const money = (cents, currency = 'USD') => { try{ return new Intl.NumberFormat(undefined, { style:'currency', currency }).format((Number(cents) || 0) / 100); }catch(e){ return `$${((Number(cents) || 0) / 100).toFixed(2)}`; } };
  const listings = () => (typeof W.djbBeatStoreListings === 'function' ? W.djbBeatStoreListings() : []);
  const listingById = id => listings().find(l => l && l.id === id) || null;

  // Same wording as the server (server/store_five.js). The server copy wins when it is sent.
  const LICENCES = {
    battle_use:{ label:'Battle use only', summary:'Play it in DJ Battle battles, practice and live DJ sets.', may:['Play it in DJ Battle battles and practice', 'Play it in live DJ sets and streams of your sets'], mayNot:['Release it or a song made with it', 'Upload it to Spotify, YouTube, SoundCloud or other services', 'Resell, share or give the file away', 'Say you made it'] },
    creator_license:{ label:'Use in your own releases', summary:'Use it in your own mixes and songs, and release them, as long as you credit the producer.', may:['Everything in "Battle use only"', 'Use it in your own songs and mixes', 'Release those on streaming services and social media, and earn from them'], mayNot:['Sell or share the beat on its own', 'Register the beat itself with Content ID or a music library', 'Say you made the beat'] },
    royalty_free_use:{ label:'Royalty-free', summary:'Use it in anything, including paid and commercial work, with no further payments.', may:['Everything in "Use in your own releases"', 'Use it in ads, videos, games and client work', 'No credit needed (but producers love it)'], mayNot:['Sell or share the beat on its own as a beat', 'Say you made the beat'] }
  };
  const CHOICES = ['battle_use', 'creator_license', 'royalty_free_use'];
  const licenceOf = listing => (listing && listing.rights && listing.rights.licence && listing.rights.licence.label ? listing.rights.licence : LICENCES[listing && listing.rights && listing.rights.licenseType] || LICENCES.creator_license);
  const termsHtml = t => `<div class="s25-terms"><strong>${esc(t.label)}</strong><p>${esc(t.summary)}</p><div class="s25-terms-cols"><div><b>You may</b><ul>${(t.may || []).map(x => `<li>✓ ${esc(x)}</li>`).join('')}</ul></div><div><b>You may not</b><ul>${(t.mayNot || []).map(x => `<li>✕ ${esc(x)}</li>`).join('')}</ul></div></div></div>`;

  const s25 = { wish:new Set(), wishLoaded:false, wishItems:[], orders:null, sentGifts:null, panel:'saved', audio:null, playing:null };

  function dialog(id, html){
    let dlg = D.getElementById(id);
    if(!dlg){ dlg = D.createElement('dialog'); dlg.id = id; dlg.className = 'oct20b-dialog s25-dialog'; D.body.appendChild(dlg); }
    dlg.innerHTML = html;
    if(typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal(); else dlg.setAttribute('open', '');
    dlg.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => closeDlg(dlg); });
    return dlg;
  }
  const closeDlg = dlg => (dlg.close ? dlg.close() : dlg.removeAttribute('open'));

  /* ------------------------------ 1. licences ------------------------------ */
  function licencePickerHtml(name, current = 'creator_license'){
    return `<fieldset class="s25-licence-pick" data-s25-licence="${esc(name)}"><legend>Licence buyers get</legend>${CHOICES.map(t => `<label class="s25-licence-opt"><input type="radio" name="${esc(name)}" value="${t}" ${t === current ? 'checked' : ''}><span><strong>${esc(LICENCES[t].label)}</strong><small>${esc(LICENCES[t].summary)}</small></span></label>`).join('')}</fieldset>`;
  }
  function pickedLicence(name){
    const el = D.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : 'creator_license';
  }
  function openLicenceEditor(listingId){
    const listing = listingById(listingId);
    const current = listing && listing.rights && listing.rights.licenseType;
    const dlg = dialog('s25-licence-dialog', `<form method="dialog"><span class="eyebrow accent">LICENCE</span><h3>What can buyers do with ${esc(listing ? listing.title : 'this beat')}?</h3>
      ${licencePickerHtml('s25-licence-edit', CHOICES.includes(current) ? current : 'creator_license')}
      <p class="social-note">Buyers see these terms in plain words before they pay, and keep a copy in their receipt. Changing it only affects new sales.</p>
      <label class="store-attest"><input type="checkbox" id="s25-licence-ok"> I have the right to offer these terms.</label>
      <p class="store-create-error" id="s25-licence-err" role="alert"></p>
      <div class="modal-actions"><button class="ghost" type="button" data-close>Cancel</button><button class="primary" type="submit">Save licence</button></div></form>`);
    dlg.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const body = { licenseType:pickedLicence('s25-licence-edit'), confirmRights:dlg.querySelector('#s25-licence-ok').checked };
      const r = await api(`/api/marketplace/listings/${encodeURIComponent(listingId)}/licence`, { method:'PATCH', body });
      if(r.error){ dlg.querySelector('#s25-licence-err').textContent = errText(r, 'Couldn\u2019t save the licence.'); return; }
      if(listing){ listing.rights = { ...(listing.rights || {}), licenseType:body.licenseType, licence:r.data.licence }; }
      closeDlg(dlg); toast('Licence saved', r.data.licence.label);
      if(typeof W.renderBeatStorePage === 'function') W.renderBeatStorePage();
    };
    return dlg;
  }

  // Shown before Stripe: price, licence terms in plain words, and the "send as a gift" option.
  function confirmPurchase(listing){
    return new Promise(resolve => {
      const t = licenceOf(listing);
      const price = money(listing.displayPriceCents, listing.currency || 'USD');
      const dlg = dialog('s25-buy-dialog', `<form method="dialog" class="s25-buy"><span class="eyebrow accent">BEFORE YOU PAY</span><h3>${esc(listing.title || 'Beat')} · ${esc(price)}</h3>
        <p class="social-note">Here's what this licence lets you do. A copy goes in your receipt.</p>${termsHtml(t)}
        <label class="s25-gift-toggle"><input type="checkbox" id="s25-gift-on"> 🎁 Send it as a gift</label>
        <div class="s25-gift hidden" id="s25-gift-fields">
          <label>Their email<input type="email" id="s25-gift-email" maxlength="254" autocomplete="off" placeholder="friend@example.com"></label>
          <label>Your name (optional)<input id="s25-gift-from" maxlength="60" placeholder="Shown in the email"></label>
          <label>Message (optional)<textarea id="s25-gift-msg" maxlength="280" rows="2" placeholder="Happy birthday! Use this in your next battle."></textarea></label>
          <small class="social-note">We email them a one-time link after you pay. It lands in their purchases when they sign in with that email.</small>
        </div>
        <label class="store-attest"><input type="checkbox" id="s25-agree"> I've read the licence terms.</label>
        <p class="store-create-error" id="s25-buy-err" role="alert"></p>
        <div class="modal-actions"><button class="ghost" type="button" data-close>Cancel</button><button class="primary" type="submit" id="s25-buy-go">Continue to payment</button></div></form>`);
      let done = false;
      const finish = v => { if(done) return; done = true; resolve(v); };
      dlg.addEventListener('close', () => finish({ cancelled:true }), { once:true });
      const giftOn = dlg.querySelector('#s25-gift-on');
      giftOn.onchange = () => { dlg.querySelector('#s25-gift-fields').classList.toggle('hidden', !giftOn.checked); dlg.querySelector('#s25-buy-go').textContent = giftOn.checked ? 'Pay & send gift' : 'Continue to payment'; };
      dlg.querySelector('form').onsubmit = e => {
        e.preventDefault();
        const err = dlg.querySelector('#s25-buy-err');
        if(!dlg.querySelector('#s25-agree').checked){ err.textContent = 'Tick the box to confirm you\u2019ve read the licence.'; return; }
        let gift = null;
        if(giftOn.checked){
          const email = dlg.querySelector('#s25-gift-email').value.trim();
          if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){ err.textContent = 'Enter the email of the person you\u2019re gifting this to.'; return; }
          gift = { recipientEmail:email, message:dlg.querySelector('#s25-gift-msg').value.trim(), fromName:dlg.querySelector('#s25-gift-from').value.trim() };
        }
        finish({ confirmed:true, gift });
        closeDlg(dlg);
      };
    });
  }

  /* ------------------------------ 2. previews ------------------------------ */
  async function playPreview(listingId, btn){
    if(s25.audio && s25.playing === listingId){ s25.audio.pause(); s25.playing = null; if(btn) btn.textContent = '▶ Preview'; return { stopped:true }; }
    if(!signedIn()){ toast('Sign in to hear previews', 'Previews are short clips. Sign in (free) to listen.'); return { signedOut:true }; }
    if(btn){ btn.disabled = true; btn.textContent = 'Loading…'; }
    const r = await api('/api/marketplace/player/access', { method:'POST', body:{ listingId, preview:true } });
    if(btn) btn.disabled = false;
    if(r.error || !r.data || !r.data.playerAccess){ if(btn) btn.textContent = '▶ Preview'; toast('Preview unavailable', errText(r, 'This preview couldn\u2019t load.')); return { error:true }; }
    if(s25.audio) s25.audio.pause();
    D.querySelectorAll('[data-s25-preview]').forEach(b => { b.textContent = '▶ Preview'; });
    s25.audio = new Audio(r.data.playerAccess.url);
    s25.playing = listingId;
    s25.audio.onended = () => { s25.playing = null; if(btn) btn.textContent = '▶ Preview'; };
    if(btn) btn.textContent = '❚❚ Stop';
    try{ await s25.audio.play(); }catch(e){ /* autoplay blocked: user can tap again */ }
    return { playing:true, scope:r.data.playerAccess.accessScope };
  }
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  function openPreviewMaker(listingId){
    const listing = listingById(listingId);
    const p = listing && listing.metadata && listing.metadata.preview || {};
    const dur = Number(listing && listing.product && listing.product.duration) || 0;
    const dlg = dialog('s25-preview-dialog', `<form method="dialog"><span class="eyebrow accent">PREVIEW CLIP</span><h3>Preview for ${esc(listing ? listing.title : 'this beat')}</h3>
      <p class="social-note">Buyers hear a 30–60 second clip cut on our server. The clean full file only unlocks after they buy.</p>
      <label class="s25-row"><input type="radio" name="s25-start" value="auto" ${p.auto !== false ? 'checked' : ''}> Pick the start for me <small>(about a third of the way in)</small></label>
      <label class="s25-row"><input type="radio" name="s25-start" value="manual" ${p.auto === false ? 'checked' : ''}> Start at <input id="s25-start-at" inputmode="numeric" placeholder="1:05" value="${p.auto === false ? esc(mmss(p.startSeconds || 0)) : ''}" style="width:5.5em">${dur ? `<small> of ${esc(mmss(dur))}</small>` : ''}</label>
      <label>Length: <b id="s25-len-out">${esc(p.lengthSeconds || 45)}s</b><input type="range" id="s25-len" min="30" max="60" step="5" value="${esc(p.lengthSeconds || 45)}"></label>
      <label class="s25-row"><input type="checkbox" id="s25-tag" ${p.voiceTag === false ? '' : 'checked'}> Add the spoken "DJ Battle" tag (made by us, no copyrighted audio)</label>
      <p class="store-create-error" id="s25-prev-err" role="alert"></p>
      <div class="modal-actions"><button class="ghost" type="button" data-close>Cancel</button><button class="primary" type="submit" id="s25-prev-go">${listing && listing.previewEnabled ? 'Remake preview' : 'Make preview'}</button></div></form>`);
    const len = dlg.querySelector('#s25-len');
    len.oninput = () => { dlg.querySelector('#s25-len-out').textContent = `${len.value}s`; };
    dlg.querySelector('#s25-start-at').onfocus = () => { dlg.querySelector('input[name="s25-start"][value="manual"]').checked = true; };
    dlg.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const manual = dlg.querySelector('input[name="s25-start"]:checked').value === 'manual';
      const body = { lengthSeconds:Number(len.value), voiceTag:dlg.querySelector('#s25-tag').checked };
      if(manual){
        const raw = dlg.querySelector('#s25-start-at').value.trim();
        const m = raw.match(/^(\d+):([0-5]?\d)$/) || raw.match(/^(\d+)$/);
        if(!m){ dlg.querySelector('#s25-prev-err').textContent = 'Type the start like 1:05 (minutes:seconds).'; return; }
        body.startSeconds = m[2] != null ? Number(m[1]) * 60 + Number(m[2]) : Number(m[1]);
      }
      const go = dlg.querySelector('#s25-prev-go'); go.disabled = true; go.textContent = 'Cutting…';
      const r = await api(`/api/marketplace/listings/${encodeURIComponent(listingId)}/preview`, { method:'POST', body });
      go.disabled = false; go.textContent = 'Make preview';
      if(r.error){ dlg.querySelector('#s25-prev-err').textContent = errText(r, 'Couldn\u2019t make the preview.'); return; }
      const pv = r.data.preview;
      if(listing){ listing.previewEnabled = true; listing.metadata = { ...(listing.metadata || {}), preview:pv }; }
      closeDlg(dlg);
      toast('Preview ready', `${pv.lengthSeconds}s from ${mmss(pv.startSeconds)}${pv.voiceTag ? ' with the DJ Battle tag' : ''}.`);
      if(typeof W.renderBeatStorePage === 'function') W.renderBeatStorePage();
    };
    return dlg;
  }

  /* ------------------------------ 3. wishlist ------------------------------ */
  async function loadWishlist(){
    if(!signedIn()) return { skipped:true };
    const r = await api('/api/marketplace/wishlist');
    if(r.error) return { error:r.error };
    s25.wishItems = r.data.items || [];
    s25.wish = new Set(r.data.listingIds || []);
    s25.wishLoaded = true;
    return { items:s25.wishItems };
  }
  async function toggleHeart(listingId, btn){
    if(!signedIn()){ toast('Sign in to save beats', 'Saved beats alert you when the price drops or a code comes out.'); return { signedOut:true }; }
    const saved = s25.wish.has(listingId);
    const r = await api(`/api/marketplace/wishlist/${encodeURIComponent(listingId)}`, { method:saved ? 'DELETE' : 'POST' });
    if(r.error){ toast('Couldn\u2019t save', errText(r, 'Try again in a moment.')); return { error:true }; }
    if(saved) s25.wish.delete(listingId); else s25.wish.add(listingId);
    if(btn) paintHeart(btn, !saved);
    if(!saved) toast('Saved to your wishlist', 'We\u2019ll tell you if the price drops or the producer makes a discount code. Turn this off in Settings.');
    loadWishlist().then(renderPanel).catch(() => {});
    return { saved:!saved };
  }
  function paintHeart(btn, on){
    btn.textContent = on ? '♥' : '♡';
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('aria-label', on ? 'Remove from wishlist' : 'Save to wishlist');
  }

  /* ------------------------------ 4. gifts ------------------------------ */
  const GIFT_KEY = 'djb.pendingGiftClaim';
  function captureGiftLink(){
    try{
      const url = new URL(W.location.href);
      const giftId = url.searchParams.get('gift'), token = url.searchParams.get('gt');
      if(!giftId || !token) return null;
      sessionStorage.setItem(GIFT_KEY, JSON.stringify({ giftId, token }));
      url.searchParams.delete('gift'); url.searchParams.delete('gt');
      W.history.replaceState(null, '', url.pathname + (url.search || '') + (url.hash || '#store'));
      return { giftId };
    }catch(e){ return null; }
  }
  async function claimPendingGift(){
    let pending = null;
    try{ pending = JSON.parse(sessionStorage.getItem(GIFT_KEY) || 'null'); }catch(e){}
    if(!pending) return { none:true };
    if(!signedIn()){ toast('🎁 You\u2019ve been sent a beat', 'Sign in or sign up with the email it was sent to, and it\u2019s yours.'); return { needsSignIn:true }; }
    const r = await api('/api/marketplace/gifts/claim', { method:'POST', body:pending });
    try{ sessionStorage.removeItem(GIFT_KEY); }catch(e){}
    if(r.error){ dialog('s25-gift-dialog', `<form method="dialog"><span class="eyebrow accent">GIFT</span><h3>Couldn't claim this gift</h3><p>${esc(errText(r, 'The link didn\u2019t work.'))}</p><div class="modal-actions"><button class="primary" type="button" data-close>OK</button></div></form>`); return { error:true }; }
    const g = r.data.gift || {};
    dialog('s25-gift-dialog', `<form method="dialog"><span class="eyebrow accent">GIFT</span><h3>🎁 ${esc(g.fromName || 'Someone')} sent you a beat!</h3>${g.message ? `<blockquote class="s25-quote">${esc(g.message)}</blockquote>` : ''}<p>It\u2019s in <b>My purchases</b> below the Beat Store, with its licence terms.</p><div class="modal-actions"><button class="primary" type="button" data-close>Nice</button></div></form>`);
    s25.orders = null; renderPanel();
    return { claimed:true };
  }
  async function claimInbox(){
    if(!signedIn()) return { skipped:true };
    const r = await api('/api/marketplace/gifts/inbox');
    const n = !r.error && r.data && (r.data.claimed || []).length;
    if(n){ toast('🎁 Gift added', `${n} gifted beat${n === 1 ? ' was' : 's were'} added to your purchases.`); s25.orders = null; renderPanel(); }
    return { claimed:n || 0 };
  }

  /* ------------------------------ store decoration ------------------------------ */
  function decorateBeatStore(){
    D.querySelectorAll('#store-grid [data-store-listing]').forEach(card => {
      const id = card.dataset.storeListing;
      const listing = listingById(id);
      if(!listing || card.querySelector('[data-s25-heart]')) return;
      const heart = D.createElement('button'); heart.type = 'button'; heart.className = 's25-heart'; heart.dataset.s25Heart = id;
      paintHeart(heart, s25.wish.has(id));
      heart.onclick = () => toggleHeart(id, heart);
      card.appendChild(heart);
      const body = card.querySelector('.store-body');
      const price = Number(listing.displayPriceCents) || 0;
      if(body && price > 0){
        const t = licenceOf(listing);
        const chip = D.createElement('button'); chip.type = 'button'; chip.className = 's25-licence-chip'; chip.dataset.s25Terms = id;
        chip.textContent = `📄 ${t.label}`;
        chip.onclick = () => dialog('s25-terms-dialog', `<form method="dialog"><span class="eyebrow accent">LICENCE</span><h3>${esc(listing.title)}</h3>${termsHtml(t)}<div class="modal-actions"><button class="primary" type="button" data-close>Got it</button></div></form>`);
        const foot = body.querySelector('.store-card-foot');
        body.insertBefore(chip, foot || null);
      }
      const foot = card.querySelector('.store-card-foot');
      if(foot && listing.previewEnabled){
        const pv = D.createElement('button'); pv.type = 'button'; pv.className = 'ghost small s25-preview-btn'; pv.dataset.s25Preview = id; pv.textContent = '▶ Preview';
        const len = Number(listing.previewDuration) || 0;
        if(len) pv.title = `${len}-second preview`;
        pv.onclick = () => playPreview(id, pv);
        foot.insertBefore(pv, foot.firstChild.nextSibling);
        const tag = foot.querySelector('.store-tag'); if(tag && /Preview only/.test(tag.textContent)) tag.remove();
      }
    });
    renderPanel();
  }
  function decorateMine(){
    D.querySelectorAll('#store-mine-list [data-store-mine]').forEach(row => {
      const id = row.dataset.storeMine;
      const actions = row.querySelector('.store-mine-actions');
      if(!actions || actions.querySelector('[data-s25-licence-edit]')) return;
      const listing = listingById(id);
      const lic = D.createElement('button'); lic.type = 'button'; lic.className = 'ghost small'; lic.dataset.s25LicenceEdit = id;
      lic.textContent = `Licence: ${licenceOf(listing).label}`;
      lic.onclick = () => openLicenceEditor(id);
      const pv = D.createElement('button'); pv.type = 'button'; pv.className = 'ghost small'; pv.dataset.s25PreviewMake = id;
      pv.textContent = listing && listing.previewEnabled ? 'Preview ✓' : 'Make preview';
      pv.onclick = () => openPreviewMaker(id);
      actions.appendChild(lic); actions.appendChild(pv);
    });
  }

  // "Saved beats / My purchases / Gifts I sent" panel under the store grid.
  function ensurePanel(){
    let panel = D.getElementById('s25-panel');
    if(panel) return panel;
    const grid = D.getElementById('store-grid');
    if(!grid || !grid.parentNode) return null;
    panel = D.createElement('section'); panel.id = 's25-panel'; panel.className = 'panel s25-panel';
    const more = D.getElementById('store-load-more');
    const anchor = more && more.parentNode && more.parentNode.parentNode === grid.parentNode ? more.parentNode : grid;
    anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    return panel;
  }
  async function loadOrders(){
    const [o, g] = await Promise.all([api('/api/marketplace/orders'), api('/api/marketplace/gifts/sent')]);
    s25.orders = o.error ? [] : (o.data.orders || []).filter(x => x.paymentStatus === 'paid' && !x.gift);
    s25.sentGifts = g.error ? [] : (g.data.gifts || []);
    renderPanel();
  }
  function renderPanel(){
    const panel = ensurePanel(); if(!panel) return null;
    if(!signedIn()){ panel.classList.add('hidden'); return panel; }
    panel.classList.remove('hidden');
    const tab = (k, label) => `<button type="button" class="s25-tab${s25.panel === k ? ' is-on' : ''}" data-s25-tab="${k}" aria-pressed="${s25.panel === k}">${label}</button>`;
    let body = '';
    if(s25.panel === 'saved'){
      body = !s25.wishLoaded ? '<p class="muted">Loading…</p>' : s25.wishItems.length ? `<ul class="s25-list">${s25.wishItems.map(i => `<li><span><strong>${esc(i.title)}</strong><small>${i.available ? esc(i.priceCents ? money(i.priceCents, i.currency) : 'Free') : 'No longer available'}${i.priceDropped ? ` · <b class="s25-drop">was ${esc(money(i.savedPriceCents, i.currency))}</b>` : ''}</small></span><button type="button" class="text-btn" data-s25-unsave="${esc(i.listingId)}">Remove</button></li>`).join('')}</ul>` : '<p class="muted">Tap ♡ on a beat to save it. We\u2019ll tell you when its price drops or the producer makes a discount code.</p>';
    }else if(s25.panel === 'bought'){
      if(s25.orders == null){ body = '<p class="muted">Loading…</p>'; loadOrders(); }
      else body = s25.orders.length ? `<ul class="s25-list">${s25.orders.map(o => { const l = listingById(o.listingId); return `<li><span><strong>${esc(l ? l.title : 'Beat')}</strong><small>${esc(money(o.grossAmountCents, o.currency))} · ${esc(new Date(o.paidAt || o.createdAt).toLocaleDateString())} · ${esc(o.licence && o.licence.label || '')}</small></span><span class="s25-actions"><button type="button" class="ghost small" data-s25-receipt="${esc(o.id)}">Receipt & licence</button><button type="button" class="primary small" data-s25-dl="${esc(o.id)}">Download</button></span></li>`; }).join('')}</ul>` : '<p class="muted">Beats you buy (and gifts you claim) show up here with their licence terms.</p>';
    }else{
      if(s25.sentGifts == null){ body = '<p class="muted">Loading…</p>'; loadOrders(); }
      else body = s25.sentGifts.length ? `<ul class="s25-list">${s25.sentGifts.map(g => { const l = listingById(g.listingId); const st = { pending_payment:'Waiting for payment', sent:'Sent · not claimed yet', claimed:'Claimed 🎉', cancelled:'Cancelled' }[g.status] || g.status; return `<li><span><strong>${esc(l ? l.title : 'Beat')}</strong><small>To ${esc(g.recipientEmail)} · ${esc(st)}</small></span></li>`; }).join('')}</ul>` : '<p class="muted">Tick "Send it as a gift" when you buy a beat to send it to a friend\u2019s email.</p>';
    }
    panel.innerHTML = `<div class="s25-tabs" role="group" aria-label="Your Beat Store">${tab('saved', `♥ Saved beats${s25.wish.size ? ` (${s25.wish.size})` : ''}`)}${tab('bought', 'My purchases')}${tab('gifts', '🎁 Gifts I sent')}</div>${body}`;
    panel.querySelectorAll('[data-s25-tab]').forEach(b => { b.onclick = () => { s25.panel = b.dataset.s25Tab; renderPanel(); }; });
    panel.querySelectorAll('[data-s25-unsave]').forEach(b => { b.onclick = () => toggleHeart(b.dataset.s25Unsave).then(() => { const h = D.querySelector(`[data-s25-heart="${b.dataset.s25Unsave}"]`); if(h) paintHeart(h, false); }); });
    panel.querySelectorAll('[data-s25-receipt]').forEach(b => { b.onclick = () => openReceipt(b.dataset.s25Receipt); });
    panel.querySelectorAll('[data-s25-dl]').forEach(b => { b.onclick = () => (typeof W.downloadPurchasedBeat === 'function' ? W.downloadPurchasedBeat(null, b.dataset.s25Dl) : null); });
    return panel;
  }
  function openReceipt(orderId){
    const o = (s25.orders || []).find(x => x.id === orderId);
    if(!o) return null;
    const l = listingById(o.listingId);
    return dialog('s25-receipt-dialog', `<form method="dialog"><span class="eyebrow accent">RECEIPT</span><h3>${esc(l ? l.title : 'Beat')}</h3>
      <dl class="s25-receipt"><dt>Order</dt><dd>${esc(o.id)}</dd><dt>Paid</dt><dd>${esc(money(o.grossAmountCents, o.currency))} on ${esc(new Date(o.paidAt || o.createdAt).toLocaleString())}</dd></dl>
      <p class="social-note">Your licence (as agreed at checkout):</p>${termsHtml(o.licence || LICENCES.creator_license)}
      <div class="modal-actions"><button class="ghost" type="button" onclick="window.print()">Print</button><button class="primary" type="button" data-close>Close</button></div></form>`);
  }

  function onView(view){
    if(view !== 'store') return;
    claimPendingGift().catch(() => {});
    claimInbox().catch(() => {});
    loadWishlist().then(() => { D.querySelectorAll('[data-s25-heart]').forEach(b => paintHeart(b, s25.wish.has(b.dataset.s25Heart))); renderPanel(); }).catch(() => {});
  }

  if(captureGiftLink()){
    const go = () => { if(typeof W.switchView === 'function') W.switchView('store'); else W.location.hash = '#store'; };
    if(D.readyState === 'loading') D.addEventListener('DOMContentLoaded', go); else setTimeout(go, 0);
  }

  W.DJBStore25 = { LICENCES, CHOICES, licencePickerHtml, pickedLicence, confirmPurchase, openLicenceEditor, openPreviewMaker, playPreview, toggleHeart, loadWishlist, decorateBeatStore, decorateMine, renderPanel, openReceipt, captureGiftLink, claimPendingGift, claimInbox, onView, _state:s25 };
})();
