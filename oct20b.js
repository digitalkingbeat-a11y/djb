// Oct 20b: Crews and 2-vs-2 crew battles, Tip a DJ, Beat Store discount codes and
// "Who's watching" view insights. (Beatmatching lessons live in studio/beatmatch_lessons.js.)
// Loaded after app.js, social.js, connect.js and oct20.js. User text always goes through esc().
(function(){
  'use strict';
  const W = window;
  const D = document;
  const esc = s => (typeof W.esc === 'function' ? W.esc(s) : String(s == null ? '' : s).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c])));
  const hasApi = () => Boolean(W.DJBattleApi && typeof W.DJBattleApi.apiRequest === 'function');
  const api = (path, opts) => hasApi() ? W.DJBattleApi.apiRequest(path, opts) : Promise.resolve({ error:'The server is not connected', status:0 });
  const signedIn = () => typeof W.djbSignedIn === 'function' && W.djbSignedIn();
  const needsServer = r => !r || r.status === 0 || r.status === 404 && !r.data || r.status === 502 || (r.status === 503 && !(r.data && (r.data.schemaMissing || r.data.paymentsNotConfigured)));
  const schemaMissing = r => r && r.status === 503 && r.data && r.data.schemaMissing;
  const errText = (r, fallback) => (r && r.data && r.data.error) || (r && typeof r.error === 'string' && r.error) || fallback;
  const toast = (title, body) => { if(typeof W.showAppToast === 'function') W.showAppToast(title, body); };
  const money = cents => `$${(Number(cents || 0) / 100).toFixed(Number(cents) % 100 ? 2 : 0)}`;
  const go = view => { if(typeof W.switchView === 'function') W.switchView(view); };
  function setupNote(r, what){
    if(schemaMissing(r)) return `${what} needs one setup step: run server/sql/${esc(r.data.schema)}.sql in Supabase.`;
    if(needsServer(r)) return `${what} needs the DJ Battle server. It turns on once your server is running.`;
    return esc(errText(r, `${what} could not load.`));
  }
  function ensureView(id, html){
    let section = D.getElementById(id);
    if(section) return section;
    const main = D.querySelector('.main');
    if(!main) return null;
    section = D.createElement('section'); section.id = id; section.className = D.body && D.body.dataset.view === id ? 'view active' : 'view'; section.innerHTML = html;
    main.insertBefore(section, D.getElementById('operations') || null);
    return section;
  }
  function dialog(id, html){
    let dlg = D.getElementById(id);
    if(!dlg){ dlg = D.createElement('dialog'); dlg.id = id; dlg.className = 'oct20b-dialog'; D.body.appendChild(dlg); }
    dlg.innerHTML = html;
    if(typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal(); else dlg.setAttribute('open', '');
    dlg.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => dlg.close ? dlg.close() : dlg.removeAttribute('open'); });
    return dlg;
  }
  const logoHtml = (logo, size = '') => { const l = logo || {}; return l.url ? `<img class="crew-logo ${size}" src="${esc(l.url)}" alt="" loading="lazy">` : `<span class="crew-logo ${size}" style="background:${esc(l.color || '#ff4d6d')}" aria-hidden="true">${esc(l.emoji || '🎧')}</span>`; };

  /* ============================== 1. Crews ============================== */
  const LOGO_COLORS = ['#ff4d6d', '#ffb703', '#2ec4b6', '#4361ee', '#9b5de5', '#f15bb5', '#00bbf9', '#80ed99'];
  const LOGO_EMOJI = ['🎧', '🔥', '⚡', '👑', '🎛️', '💿', '🐍', '🦁'];
  const crews = { status:'idle', mine:null, battles:[], rankings:[], current:null, currentBattles:[], error:'', myResults:null };
  function ensureCrewsView(){
    return ensureView('crews', `<div class="product-page-head"><div><span class="eyebrow accent">CREWS</span><h2>Crews</h2><p>Team up with up to 3 other DJs under one name and logo. Crews challenge each other to 2-vs-2 battles: each side puts up two DJs, every DJ sends one judged mix, and the two scores are added together. Higher total wins.</p></div></div><div class="social-note" id="crews-status" aria-live="polite"></div><div class="crews-layout"><section class="panel" id="crew-mine"></section><section class="panel" id="crew-rankings"></section></div><section class="panel hidden" id="crew-page"></section>`);
  }
  async function loadCrews(){
    ensureCrewsView();
    crews.status = 'loading'; crews.error = ''; renderCrews();
    const rank = await api('/api/crews', { public:!signedIn() });
    if(rank.error){ crews.status = 'error'; crews.error = setupNote(rank, 'Crews'); renderCrews(); return crews; }
    crews.rankings = rank.data.crews || [];
    if(signedIn()){
      const mine = await api('/api/crews/mine');
      if(!mine.error){ crews.mine = mine.data.crew; crews.battles = mine.data.battles || []; }
    }else{ crews.mine = null; crews.battles = []; }
    crews.status = 'ready'; renderCrews();
    return crews;
  }
  function battleRow(b){
    const mineId = crews.mine && crews.mine.id;
    const side = s => `<span class="crew-side">${logoHtml(s.logo, 'small')}<strong>${esc(s.name)}</strong> <small>${s.lineup.map(m => `${esc(m.displayName)}${m.score != null ? ` ${esc(m.score)}` : m.submitted ? '' : ' ⏳'}`).join(' + ') || 'picking lineup'}</small>${s.total != null ? ` <b class="crew-total">${esc(s.total)}</b>` : ''}</span>`;
    const label = b.status === 'pending' ? 'Waiting for an answer' : b.status === 'live' ? 'Live: send your mixes' : b.status === 'declined' ? 'Declined' : b.winnerCrewId === 'draw' ? 'Draw' : b.winnerCrewId === mineId ? 'Your crew won' : b.winnerCrewId ? 'Your crew lost' : 'Finished';
    const meIn = [...b.challenger.lineup, ...b.opponent.lineup].find(m => m.isMe);
    let action = '';
    if(b.status === 'pending' && mineId && b.opponent.crewId === mineId) action = `<button class="primary small" type="button" data-crew-accept="${esc(b.id)}">Accept</button><button class="ghost small" type="button" data-crew-decline="${esc(b.id)}">Decline</button>`;
    if(b.status === 'live' && meIn && !meIn.submitted) action = `<button class="primary small" type="button" data-crew-submit="${esc(b.id)}">Send my mix</button>`;
    return `<li class="crew-battle crew-battle-${esc(b.status)}"><div class="crew-battle-sides">${side(b.challenger)}<span class="crew-vs">vs</span>${side(b.opponent)}</div><div class="crew-battle-foot"><small>${esc(label)}</small>${action}</div></li>`;
  }
  function renderCrews(){
    const view = ensureCrewsView();
    if(!view) return null;
    D.getElementById('crews-status').innerHTML = crews.status === 'loading' ? 'Loading crews…' : crews.error;
    const mine = D.getElementById('crew-mine');
    if(!signedIn()) mine.innerHTML = '<span class="eyebrow">YOUR CREW</span><h3>Join the crew scene</h3><p class="social-note">Sign in to start a crew or join one with a code.</p>';
    else if(crews.mine){
      const c = crews.mine;
      mine.innerHTML = `<span class="eyebrow">YOUR CREW</span><div class="crew-card-head">${logoHtml(c.logo, 'big')}<div><h3>${esc(c.name)}</h3><p class="social-note">${c.wins}W · ${c.losses}L${c.draws ? ` · ${c.draws}D` : ''} · <strong>${c.points} pts</strong> · ${c.memberCount}/${c.maxMembers} DJs</p></div></div>
        <ul class="crew-members">${c.members.map(m => `<li>${esc(m.displayName)}${m.role === 'owner' ? ' <span class="crew-role">owner</span>' : ''}${m.belt ? ` <small>${esc(m.belt)}</small>` : ''}${c.isOwner && !m.isMe ? ` <button class="text-btn" type="button" data-crew-remove="${esc(m.publicProfileId)}">Remove</button>` : ''}</li>`).join('')}</ul>
        ${c.isOwner ? `<p class="crew-invite">Join code: <code id="crew-code">${esc(c.inviteCode || '')}</code> <small>Share it with DJs you want in. ${c.memberCount >= c.maxMembers ? 'Your crew is full.' : ''}</small> <button class="text-btn" type="button" id="crew-new-code">New code</button></p>` : ''}
        <div class="crew-actions"><button class="primary small" type="button" id="crew-challenge">Challenge a crew (2 vs 2)</button><button class="ghost small" type="button" id="crew-leave">Leave crew</button></div>
        <h4>Crew battles</h4>${crews.battles.length ? `<ul class="crew-battles">${crews.battles.map(battleRow).join('')}</ul>` : '<p class="social-note">No crew battles yet.</p>'}`;
    }else{
      mine.innerHTML = `<span class="eyebrow">YOUR CREW</span><h3>Start a crew</h3><form id="crew-create-form" class="crew-form"><label>Crew name <input id="crew-name" maxlength="40" required placeholder="e.g. Night Shift"></label><fieldset class="crew-logo-pick"><legend>Logo</legend>${LOGO_EMOJI.map((e, i) => `<label><input type="radio" name="crew-emoji" value="${e}"${i ? '' : ' checked'}> ${e}</label>`).join('')}<br>${LOGO_COLORS.map((c, i) => `<label class="crew-color" style="background:${c}"><input type="radio" name="crew-color" value="${c}"${i ? '' : ' checked'} aria-label="Color ${c}"></label>`).join('')}<label class="crew-logo-url">or an image link (https) <input id="crew-logo-url" placeholder="https://…"></label></fieldset><button class="primary small" type="submit">Create crew</button></form>
        <h3>Or join one</h3><form id="crew-join-form" class="crew-form"><label>Join code <input id="crew-join-code" maxlength="8" placeholder="8 characters"></label><button class="ghost small" type="submit">Join</button></form><small class="social-note" id="crew-form-status" aria-live="polite"></small>`;
    }
    const rk = D.getElementById('crew-rankings');
    rk.innerHTML = `<span class="eyebrow">CREW RANKINGS</span><h3>Top crews</h3>${crews.rankings.length ? `<div class="crew-rank-scroll"><table class="crew-rank"><thead><tr><th>#</th><th>Crew</th><th>W-L</th><th>Pts</th><th>DJs</th></tr></thead><tbody>${crews.rankings.map(c => `<tr${crews.mine && crews.mine.id === c.id ? ' class="mine"' : ''}><td>${c.rank}</td><td><button class="text-btn crew-link" type="button" data-crew-open="${esc(c.id)}">${logoHtml(c.logo, 'small')} ${esc(c.name)}</button></td><td>${c.wins}-${c.losses}${c.draws ? `-${c.draws}` : ''}</td><td><strong>${c.points}</strong></td><td>${c.memberCount}</td></tr>`).join('')}</tbody></table></div><p class="social-note">Win = 3 points, draw = 1.</p>` : `<p class="social-note">${crews.status === 'ready' ? 'No crews yet. Be the first.' : ''}</p>`}`;
    wireCrews();
    renderCrewPage();
    return view;
  }
  function wireCrews(){
    const status = msg => { const s = D.getElementById('crew-form-status'); if(s) s.textContent = msg; };
    const create = D.getElementById('crew-create-form');
    if(create) create.onsubmit = async e => {
      e.preventDefault();
      const pick = n => (D.querySelector(`input[name="${n}"]:checked`) || {}).value;
      const r = await api('/api/crews', { method:'POST', body:{ name:D.getElementById('crew-name').value, logoEmoji:pick('crew-emoji'), logoColor:pick('crew-color'), logoUrl:D.getElementById('crew-logo-url').value.trim() || null } });
      if(r.error) return status(errText(r, 'Could not create the crew.'));
      toast('Crew created', 'Share your join code to bring DJs in.'); loadCrews();
    };
    const join = D.getElementById('crew-join-form');
    if(join) join.onsubmit = async e => {
      e.preventDefault();
      const r = await api('/api/crews/join', { method:'POST', body:{ inviteCode:D.getElementById('crew-join-code').value.trim() } });
      if(r.error) return status(errText(r, 'Could not join.'));
      toast('You joined a crew', r.data.crew.name); loadCrews();
    };
    const leave = D.getElementById('crew-leave');
    if(leave) leave.onclick = async () => {
      const ok = typeof W.appConfirmDanger === 'function' ? await W.appConfirmDanger('Leave this crew?', 'You can rejoin later with a join code.', 'Leave crew') : W.confirm('Leave this crew?');
      if(!ok) return;
      const r = await api(`/api/crews/${encodeURIComponent(crews.mine.id)}/leave`, { method:'POST', body:{} });
      if(r.error) return toast('Couldn\u2019t leave', errText(r, 'Try again.'));
      loadCrews();
    };
    const code = D.getElementById('crew-new-code');
    if(code) code.onclick = async () => { const r = await api(`/api/crews/${encodeURIComponent(crews.mine.id)}`, { method:'PATCH', body:{ newInviteCode:true } }); if(!r.error){ crews.mine = r.data.crew; renderCrews(); } };
    D.querySelectorAll('[data-crew-remove]').forEach(b => { b.onclick = async () => { const r = await api(`/api/crews/${encodeURIComponent(crews.mine.id)}/members/${encodeURIComponent(b.dataset.crewRemove)}`, { method:'DELETE' }); if(!r.error){ crews.mine = r.data.crew; renderCrews(); } }; });
    const ch = D.getElementById('crew-challenge'); if(ch) ch.onclick = () => openChallenge();
    D.querySelectorAll('[data-crew-open]').forEach(b => { b.onclick = () => openCrew(b.dataset.crewOpen); });
    D.querySelectorAll('[data-crew-accept]').forEach(b => { b.onclick = () => openLineup(b.dataset.crewAccept); });
    D.querySelectorAll('[data-crew-decline]').forEach(b => { b.onclick = async () => { await api(`/api/crewBattles/${encodeURIComponent(b.dataset.crewDecline)}/respond`, { method:'POST', body:{ accept:false } }); loadCrews(); }; });
    D.querySelectorAll('[data-crew-submit]').forEach(b => { b.onclick = () => openSubmit(b.dataset.crewSubmit); });
  }
  async function openCrew(id){
    const r = await api(`/api/crews/${encodeURIComponent(id)}`, { public:!signedIn() });
    if(r.error){ toast('Crew', errText(r, 'Could not open this crew.')); return r; }
    crews.current = r.data.crew; crews.currentBattles = r.data.battles || [];
    renderCrewPage();
    const page = D.getElementById('crew-page'); if(page && page.scrollIntoView) page.scrollIntoView({ behavior:'smooth' });
    return r;
  }
  function renderCrewPage(){
    const page = D.getElementById('crew-page');
    if(!page) return;
    const c = crews.current;
    page.classList.toggle('hidden', !c);
    if(!c) return;
    const done = crews.currentBattles.filter(b => b.status === 'complete');
    page.innerHTML = `<div class="crew-card-head">${logoHtml(c.logo, 'big')}<div><span class="eyebrow">CREW PAGE</span><h3>${esc(c.name)}</h3><p class="social-note">${c.wins}W · ${c.losses}L${c.draws ? ` · ${c.draws}D` : ''} · <strong>${c.points} pts</strong></p></div><button class="ghost small" type="button" id="crew-page-close">Close</button></div>
      <h4>Members (${c.memberCount}/${c.maxMembers})</h4><ul class="crew-members">${c.members.map(m => `<li><button class="text-btn" type="button" data-crew-dj="${esc(m.publicProfileId)}">${esc(m.displayName)}</button>${m.role === 'owner' ? ' <span class="crew-role">owner</span>' : ''}${m.belt ? ` <small>${esc(m.belt)}</small>` : ''}</li>`).join('')}</ul>
      ${crews.mine && crews.mine.id !== c.id ? '<button class="primary small" type="button" id="crew-page-challenge">Challenge this crew</button>' : ''}
      <h4>Recent crew battles</h4>${done.length ? `<ul class="crew-battles">${done.slice(0, 10).map(battleRow).join('')}</ul>` : '<p class="social-note">No finished crew battles yet.</p>'}`;
    page.querySelector('#crew-page-close').onclick = () => { crews.current = null; renderCrewPage(); };
    const chal = page.querySelector('#crew-page-challenge'); if(chal) chal.onclick = () => openChallenge(c.id);
    page.querySelectorAll('[data-crew-dj]').forEach(b => { b.onclick = () => { if(typeof W.loadPublicDjProfile === 'function') W.loadPublicDjProfile(b.dataset.crewDj); }; });
  }
  function lineupChecks(members){ return members.map(m => `<label class="crew-lineup-pick"><input type="checkbox" name="crew-lineup" value="${esc(m.publicProfileId)}"> ${esc(m.displayName)}</label>`).join(''); }
  function pickedLineup(){ return Array.from(D.querySelectorAll('input[name="crew-lineup"]:checked')).map(i => i.value); }
  function openChallenge(opponentId){
    if(!crews.mine) return null;
    const others = crews.rankings.filter(c => c.id !== crews.mine.id && c.memberCount >= 2);
    const dlg = dialog('crew-challenge-dialog', `<form method="dialog" id="crew-challenge-form"><span class="eyebrow accent">2 VS 2</span><h3>Challenge a crew</h3><label>Opponent crew <select id="crew-opponent">${others.map(c => `<option value="${esc(c.id)}"${c.id === opponentId ? ' selected' : ''}>${esc(c.name)} (${c.points} pts)</option>`).join('') || '<option value="">No other crews with 2+ DJs yet</option>'}</select></label><fieldset><legend>Pick 2 DJs from your crew</legend>${lineupChecks(crews.mine.members)}</fieldset><p class="social-note">Once they accept, all four DJs send one judged mix. The two scores on each side are added up.</p><small class="social-note" id="crew-challenge-status" aria-live="polite"></small><div class="modal-actions"><button class="ghost" type="button" data-close>Cancel</button><button class="primary" type="submit">Send challenge</button></div></form>`);
    dlg.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const r = await api('/api/crewBattles', { method:'POST', body:{ opponentCrewId:D.getElementById('crew-opponent').value, lineup:pickedLineup() } });
      if(r.error){ D.getElementById('crew-challenge-status').textContent = errText(r, 'Could not send the challenge.'); return; }
      dlg.close(); toast('Challenge sent', 'They pick their two DJs when they accept.'); loadCrews();
    };
    return dlg;
  }
  function openLineup(battleId){
    const dlg = dialog('crew-lineup-dialog', `<form method="dialog"><span class="eyebrow accent">ACCEPT 2 VS 2</span><h3>Pick your two DJs</h3><fieldset>${lineupChecks(crews.mine.members)}</fieldset><small class="social-note" id="crew-lineup-status" aria-live="polite"></small><div class="modal-actions"><button class="ghost" type="button" data-close>Cancel</button><button class="primary" type="submit">Accept battle</button></div></form>`);
    dlg.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const r = await api(`/api/crewBattles/${encodeURIComponent(battleId)}/respond`, { method:'POST', body:{ accept:true, lineup:pickedLineup() } });
      if(r.error){ D.getElementById('crew-lineup-status').textContent = errText(r, 'Could not accept.'); return; }
      dlg.close(); toast('Crew battle is live', 'All four DJs can send their mixes now.'); loadCrews();
    };
    return dlg;
  }
  async function openSubmit(battleId){
    const r = await api('/api/battleResults');
    const results = (r.data && r.data.results || []).filter(x => x.submissionId && x.score != null);
    const dlg = dialog('crew-submit-dialog', `<form method="dialog"><span class="eyebrow accent">CREW BATTLE</span><h3>Send one judged mix</h3>${results.length ? `<label>Your mix <select id="crew-submit-mix">${results.map(x => `<option value="${esc(x.submissionId)}">${esc((x.battle && x.battle.title) || 'Mix')} · score ${esc(x.score)}</option>`).join('')}</select></label>` : '<p class="social-note">You don\u2019t have a judged mix yet. Record one in Battle Studio and upload it first.</p>'}<p class="social-note">Its judged score counts toward your crew\u2019s total. You can only send one.</p><small class="social-note" id="crew-submit-status" aria-live="polite"></small><div class="modal-actions"><button class="ghost" type="button" data-close>Cancel</button>${results.length ? '<button class="primary" type="submit">Send mix</button>' : ''}</div></form>`);
    dlg.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const s = await api(`/api/crewBattles/${encodeURIComponent(battleId)}/submit`, { method:'POST', body:{ submissionId:D.getElementById('crew-submit-mix').value } });
      if(s.error){ D.getElementById('crew-submit-status').textContent = errText(s, 'Could not send.'); return; }
      dlg.close(); toast('Mix sent', s.data.battle.status === 'complete' ? 'All four mixes are in. Results are up.' : 'Waiting for the other DJs.'); loadCrews();
    };
    return dlg;
  }

  /* ============================== 2. Tip a DJ ============================== */
  const tips = { config:null };
  async function tipConfig(){ if(tips.config) return tips.config; const r = await api('/api/tips/config', { public:true }); tips.config = r.error ? { configured:false, unreachable:true, presetsCents:[200, 500], minCents:100, maxCents:50000, noteMax:280 } : r.data; return tips.config; }
  function addTipButton(container, publicProfileId, verifiedResultId, name){
    if(!container || !publicProfileId || container.querySelector('[data-tip-dj]')) return null;
    const b = D.createElement('button'); b.type = 'button'; b.className = 'ghost tip-btn'; b.dataset.tipDj = publicProfileId; b.textContent = '💸 Tip';
    b.title = `Send ${name || 'this DJ'} a tip`;
    b.onclick = () => openTip(publicProfileId, { verifiedResultId, name });
    container.insertBefore(b, container.firstChild);
    return b;
  }
  async function openTip(publicProfileId, { verifiedResultId = null, name = 'this DJ' } = {}){
    const cfg = await tipConfig();
    const elig = await api(`/api/tips/eligibility/${encodeURIComponent(publicProfileId)}`, { public:true });
    const canTip = !elig.error && elig.data.canTip && cfg.configured;
    const reason = !cfg.configured ? (cfg.unreachable ? 'Tips need the DJ Battle server.' : 'Tips aren\u2019t switched on for the server yet (Stripe setup).') : elig.error ? setupNote(elig, 'Tips') : !elig.data.canTip ? `${esc(name)} hasn\u2019t set up Stripe payouts yet, so they can\u2019t get tips.` : '';
    const presets = cfg.presetsCents || [200, 500];
    const dlg = dialog('tip-dialog', `<form method="dialog" id="tip-form"><span class="eyebrow accent">TIP A DJ</span><h3>Tip ${esc(name)}</h3><div class="tip-amounts" role="radiogroup" aria-label="Tip amount">${presets.map((c, i) => `<label class="tip-amount"><input type="radio" name="tip-amount" value="${c}"${i === presets.length - 1 ? ' checked' : ''}> ${money(c)}</label>`).join('')}<label class="tip-amount"><input type="radio" name="tip-amount" value="custom"> Other</label><label class="tip-custom">$ <input type="number" id="tip-custom" min="1" max="500" step="1" inputmode="decimal" placeholder="10" aria-label="Custom amount in dollars"></label></div><label>Note (optional) <textarea id="tip-message" maxlength="${cfg.noteMax || 280}" rows="2" placeholder="That transition was crazy 🔥"></textarea></label><p class="social-note">You pay by card on Stripe\u2019s secure page. The tip goes straight to ${esc(name)}\u2019s Stripe account; DJ Battle takes no cut (Stripe\u2019s card fee applies).</p><small class="social-note" id="tip-status" aria-live="polite">${reason}</small><div class="modal-actions"><button class="ghost" type="button" data-close>Cancel</button><button class="primary" type="submit" id="tip-send"${canTip ? '' : ' disabled'}>Continue to payment</button></div></form>`);
    const custom = dlg.querySelector('#tip-custom');
    custom.onfocus = () => { const r = dlg.querySelector('input[value="custom"]'); r.checked = true; };
    dlg.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      if(!signedIn()){ dlg.querySelector('#tip-status').textContent = 'Sign in first so your tip is tied to your account.'; return; }
      const choice = (dlg.querySelector('input[name="tip-amount"]:checked') || {}).value;
      const amountCents = choice === 'custom' ? Math.round(Number(custom.value) * 100) : Number(choice);
      const r = await api('/api/tips/checkout', { method:'POST', body:{ toPublicProfileId:publicProfileId, amountCents, message:dlg.querySelector('#tip-message').value, verifiedResultId } });
      if(r.error){ dlg.querySelector('#tip-status').textContent = errText(r, 'Could not start the payment.'); return; }
      const url = r.data.checkout && r.data.checkout.redirectUrl;
      if(url && /^https:\/\/checkout\.stripe\.com\//.test(url)) W.location.assign(url);
    };
    return dlg;
  }
  async function renderTipsPanel(){
    const profile = D.getElementById('profile');
    if(!profile || !signedIn()) return null;
    let panel = D.getElementById('profile-tips');
    if(!panel){ panel = D.createElement('section'); panel.id = 'profile-tips'; panel.className = 'panel profile-tips'; const anchor = D.getElementById('profile-genre-stats'); profile.insertBefore(panel, anchor ? anchor.nextSibling : null); }
    const r = await api('/api/tips/mine');
    if(r.error){ panel.innerHTML = `<span class="eyebrow">TIPS</span><p class="social-note">${setupNote(r, 'Tips')}</p>`; return panel; }
    const list = r.data.tips || [];
    panel.innerHTML = `<span class="eyebrow">TIPS</span><h3>${money(r.data.totalCents)} in tips</h3>${list.length ? `<ul class="tip-list">${list.slice(0, 5).map(t => `<li><strong>${money(t.amountCents)}</strong> from ${esc(t.from && t.from.displayName || 'a fan')}${t.message ? ` · “${esc(t.message)}”` : ''}</li>`).join('')}</ul>` : '<p class="social-note">No tips yet. Fans see a 💸 Tip button on your public profile and battle results once your Stripe payouts are set up in the Beat Store.</p>'}`;
    return panel;
  }
  function tipReturnNotice(){
    let p; try{ p = new URLSearchParams(W.location.search); }catch(e){ return; }
    if(p.get('tip') === 'thanks') toast('Thanks for the tip!', 'Your payment went through. The DJ will see it in their Tips.');
    if(p.get('tip') === 'canceled') toast('Tip canceled', 'No money was taken.');
  }

  /* ============================== 3. Discount codes ============================== */
  const codes = { list:[], status:'idle', error:'', applied:{} };
  W.djbDiscountCodeFor = listingId => (codes.applied[listingId] && codes.applied[listingId].code) || '';
  async function loadCodes(){
    if(!signedIn()) return codes;
    const r = await api('/api/marketplace/discountCodes');
    if(r.error){ codes.status = 'error'; codes.error = setupNote(r, 'Discount codes'); }
    else { codes.status = 'ready'; codes.error = ''; codes.list = r.data.codes || []; }
    renderCodesPanel();
    return codes;
  }
  const codeLabel = c => (c.kind === 'percent' ? `${c.percentOff}% off` : `${money(c.amountOffCents)} off`);
  const stateLabel = { live:'Live', ended:'Ended', used_up:'Used up', off:'Turned off' };
  function renderCodesPanel(){
    const mine = D.getElementById('store-mine');
    if(!mine) return null;
    let panel = D.getElementById('store-codes');
    if(!panel){ panel = D.createElement('div'); panel.id = 'store-codes'; panel.className = 'store-codes'; mine.appendChild(panel); }
    panel.innerHTML = `<h4>Discount codes</h4><p class="social-note">Make a code like <code>BATTLE20</code> and share it. Buyers type it on your beat before paying; Stripe charges the lower price.</p>
      <form id="code-form" class="code-form"><label>Code <input id="code-name" maxlength="20" placeholder="BATTLE20" autocapitalize="characters"></label><label>Type <select id="code-kind"><option value="percent">% off</option><option value="fixed">$ off</option></select></label><label>Amount <input id="code-amount" type="number" min="1" step="1" placeholder="20"></label><label>Ends (optional) <input id="code-ends" type="date"></label><label>Max uses (optional) <input id="code-limit" type="number" min="1" step="1" placeholder="50"></label><button class="primary small" type="submit">Create code</button></form><small class="social-note" id="code-status" aria-live="polite">${codes.error}</small>
      ${codes.list.length ? `<ul class="code-list">${codes.list.map(c => `<li class="code-${esc(c.state)}"><code>${esc(c.code)}</code> <strong>${esc(codeLabel(c))}</strong> <small>${c.endsAt ? `until ${esc(new Date(c.endsAt).toLocaleDateString())} · ` : ''}${c.timesUsed}${c.usageLimit ? `/${c.usageLimit}` : ''} used · ${esc(stateLabel[c.state] || c.state)}</small> <button class="text-btn" type="button" data-code-toggle="${esc(c.id)}" data-active="${c.active}">${c.active ? 'Turn off' : 'Turn on'}</button></li>`).join('')}</ul>` : ''}`;
    panel.querySelector('#code-form').onsubmit = async e => {
      e.preventDefault();
      const kind = D.getElementById('code-kind').value;
      const amount = Number(D.getElementById('code-amount').value);
      const ends = D.getElementById('code-ends').value;
      const body = { code:D.getElementById('code-name').value, kind, percentOff:kind === 'percent' ? amount : undefined, amountOffCents:kind === 'fixed' ? Math.round(amount * 100) : undefined, endsAt:ends ? new Date(`${ends}T23:59:59`).toISOString() : null, usageLimit:D.getElementById('code-limit').value || null };
      const r = await api('/api/marketplace/discountCodes', { method:'POST', body });
      if(r.error){ D.getElementById('code-status').textContent = errText(r, 'Could not create the code.'); return; }
      toast('Code created', r.data.code.code); loadCodes();
    };
    panel.querySelectorAll('[data-code-toggle]').forEach(b => { b.onclick = async () => { await api(`/api/marketplace/discountCodes/${encodeURIComponent(b.dataset.codeToggle)}`, { method:'PATCH', body:{ active:b.dataset.active !== 'true' } }); loadCodes(); }; });
    return panel;
  }
  function decorateBeatStore(){
    D.querySelectorAll('#store-grid [data-store-listing]').forEach(card => {
      const id = card.dataset.storeListing;
      trackListingView(id);
      const buy = card.querySelector('[data-store-buy]');
      if(!buy || card.querySelector('[data-store-code]')) return;
      const b = D.createElement('button'); b.type = 'button'; b.className = 'text-btn store-code-btn'; b.dataset.storeCode = id;
      const applied = codes.applied[id];
      b.textContent = applied ? `Code ${applied.code}: ${money(applied.finalCents)}` : 'Have a code?';
      b.onclick = () => openCodeEntry(id, card);
      buy.parentNode.appendChild(b);
    });
  }
  function openCodeEntry(listingId, card){
    const dlg = dialog('code-entry-dialog', `<form method="dialog"><span class="eyebrow accent">DISCOUNT CODE</span><h3>Enter a code</h3><label>Code <input id="code-entry" maxlength="20" autocapitalize="characters" value="${esc((codes.applied[listingId] || {}).code || '')}"></label><small class="social-note" id="code-entry-status" aria-live="polite"></small><div class="modal-actions"><button class="ghost" type="button" data-close>Cancel</button><button class="primary" type="submit">Apply</button></div></form>`);
    dlg.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const code = dlg.querySelector('#code-entry').value.trim();
      const r = await api(`/api/marketplace/listings/${encodeURIComponent(listingId)}/discountPreview`, { method:'POST', public:true, body:{ code } });
      if(r.error){ dlg.querySelector('#code-entry-status').textContent = errText(r, 'That code didn\u2019t work.'); return; }
      codes.applied[listingId] = r.data.preview;
      const btn = card && card.querySelector('[data-store-code]');
      if(btn) btn.textContent = `Code ${r.data.preview.code}: ${money(r.data.preview.finalCents)}`;
      dlg.close(); toast('Code applied', `${money(r.data.preview.discountCents)} off. You pay ${money(r.data.preview.finalCents)} at checkout.`);
    };
    return dlg;
  }

  /* ============================== 4. Who's watching ============================== */
  const seenListings = new Set();
  function trackListingView(id){
    if(!id || seenListings.has(id) || !hasApi()) return;
    seenListings.add(id);
    api(`/api/marketplace/listings/${encodeURIComponent(id)}/views`, { method:'POST', public:true, body:{ visitorId:typeof W.publicVisitorId === 'function' ? W.publicVisitorId() : null, referrer:D.referrer || '' } }).catch(() => {});
  }
  const KIND_LABEL = { profile:'Profile', result:'Battle results', listing:'Beats' };
  function barsSvg(totals, weeks){
    const max = Math.max(1, ...totals);
    const w = 28, gap = 8, h = 80;
    return `<svg class="watch-bars" viewBox="0 0 ${totals.length * (w + gap)} ${h + 18}" role="img" aria-label="Views per week for the last ${totals.length} weeks">${totals.map((t, i) => { const bh = Math.round(t / max * h); return `<rect x="${i * (w + gap)}" y="${h - bh}" width="${w}" height="${Math.max(bh, 1)}" rx="4" class="${i === totals.length - 1 ? 'now' : ''}"><title>${esc(weeks[i])}: ${t} views</title></rect><text x="${i * (w + gap) + w / 2}" y="${h + 14}" text-anchor="middle">${esc(String(weeks[i]).slice(5))}</text>`; }).join('')}</svg>`;
  }
  async function renderInsights(){
    const profile = D.getElementById('profile');
    if(!profile || !signedIn()) return null;
    let panel = D.getElementById('profile-insights');
    if(!panel){ panel = D.createElement('section'); panel.id = 'profile-insights'; panel.className = 'panel profile-insights'; const anchor = D.getElementById('profile-rating-history'); profile.insertBefore(panel, anchor ? anchor.nextSibling : null); }
    const r = await api('/api/insights/views');
    if(r.error){ panel.innerHTML = `<span class="eyebrow">WHO\u2019S WATCHING</span><p class="social-note">${setupNote(r, 'Who\u2019s watching')}</p>`; return panel; }
    const i = r.data.insights;
    const t = i.trend || {};
    const trend = t.changePercent == null ? 'New this week' : t.direction === 'up' ? `▲ ${t.changePercent}% vs last week` : t.direction === 'down' ? `▼ ${Math.abs(t.changePercent)}% vs last week` : 'Same as last week';
    panel.innerHTML = `<span class="eyebrow">WHO\u2019S WATCHING</span><div class="watch-head"><div><h3>${i.thisWeek.total} view${i.thisWeek.total === 1 ? '' : 's'} this week</h3><p class="watch-trend watch-${esc(t.direction || 'flat')}">${esc(trend)}</p></div><div class="watch-kinds">${['profile', 'result', 'listing'].map(k => `<div><strong>${i.thisWeek[k]}</strong><span>${KIND_LABEL[k]}</span></div>`).join('')}</div></div>
      ${barsSvg(i.totals || [], i.weeks || [])}
      <h4>Where they came from (this week)</h4>${(i.sources || []).length ? `<ul class="watch-sources">${i.sources.map(s => `<li><span>${esc(s.label)}</span><span class="watch-meter"><span style="width:${Math.max(2, s.percent)}%"></span></span><small>${s.views} · ${s.percent}%</small></li>`).join('')}</ul>` : '<p class="social-note">No views yet this week. Share your profile link to get some.</p>'}
      <p class="social-note">Weeks start Monday. Repeat views from the same person within a short time count once. We only keep a rough source (like "Instagram"), never who the visitor was.</p>`;
    return panel;
  }

  /* ============================== hooks ============================== */
  function onView(view){
    if(view === 'crews') loadCrews();
    if(view === 'profile'){ renderInsights(); renderTipsPanel(); }
    if(view === 'store') loadCodes();
    if(view === 'studio' && W.DJBLessons) W.DJBLessons.mount();
  }
  function onPublicProfile(profile){
    const actions = D.querySelector('#modal-content .modal-actions');
    const id = profile && (profile.id || profile.publicProfileId);
    return addTipButton(actions, id, null, profile && profile.displayName);
  }
  function onPublicResult(result){
    const actions = D.querySelector('#modal-content .modal-actions');
    const p = result && result.profile || {};
    return addTipButton(actions, p.publicProfileId || p.id, result && result.verifiedResultId, p.displayName);
  }
  tipReturnNotice();
  if(typeof W.viewFromHash === 'function' && W.viewFromHash() === 'crews' && typeof W.switchView === 'function') W.switchView('crews', { fromHistory:true });
  W.DJBOct20b = {
    onView, onPublicProfile, onPublicResult, decorateBeatStore,
    crews:{ state:() => crews, load:loadCrews, render:renderCrews, open:openCrew, openChallenge, openLineup, openSubmit },
    tips:{ state:() => tips, open:openTip, addButton:addTipButton, renderPanel:renderTipsPanel, config:tipConfig },
    codes:{ state:() => codes, load:loadCodes, render:renderCodesPanel, openEntry:openCodeEntry },
    insights:{ render:renderInsights, barsSvg, trackListingView }
  };
})();
