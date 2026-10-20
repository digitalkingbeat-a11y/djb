// Oct 19: battle room chat, tournaments, timed comments on public results, light mode and the
// embeddable player. Loaded after app.js and only uses its global functions (esc, openModal,
// switchView, activeStudioBattleSession, ...). Every piece of user text is rendered through
// esc() or textContent, never as HTML.
(function(){
  'use strict';
  const W = window;
  const D = document;
  const escHtml = s => (typeof W.esc === 'function' ? W.esc(s) : String(s == null ? '' : s).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c])));
  const hasApi = () => Boolean(W.DJBattleApi && typeof W.DJBattleApi.apiRequest === 'function');
  const api = (path, opts) => hasApi() ? W.DJBattleApi.apiRequest(path, opts) : Promise.resolve({ error:'The server is not connected', status:0 });
  const signedIn = () => typeof W.djbSignedIn === 'function' && W.djbSignedIn();
  const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
  const isJsdom = () => typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '');
  const needsServer = response => !response || response.status === 0 || response.status === 404 && !response.data || response.status === 503 || response.status === 502;
  const REPORT_REASONS = [['harassment', 'Harassment'], ['spam', 'Spam'], ['unsafe_content', 'Unsafe content'], ['other', 'Something else']];
  const toast = msg => { if(typeof W.showErrorToast === 'function') W.showErrorToast(msg); };
  function fmtTime(sec){
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
  }
  function serverMessage(response, fallback){
    if(response && response.data && response.data.error) return response.data.error;
    if(response && typeof response.error === 'string') return response.error;
    return fallback;
  }
  // Inline "report this" picker, so reporting never closes the pop-up you're reading.
  function inlineReport(host, targetType, targetId){
    if(host.querySelector('.inline-report')) return;
    const box = D.createElement('div');
    box.className = 'inline-report timed-form';
    box.innerHTML = `<label class="social-note">Why? <select aria-label="Report reason">${REPORT_REASONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label><button class="ghost small" type="button" data-send>Send report</button><button class="ghost small" type="button" data-cancel>Cancel</button>`;
    host.appendChild(box);
    box.querySelector('[data-cancel]').onclick = () => box.remove();
    box.querySelector('[data-send]').onclick = async () => {
      const reason = box.querySelector('select').value;
      const response = await api('/api/community/reports', { method:'POST', body:{ targetType, targetId, reason } });
      box.innerHTML = `<span class="social-note" role="status">${response.error ? escHtml(serverMessage(response, 'Report could not be sent.')) : 'Thanks, a moderator will take a look.'}</span>`;
    };
  }

  /* ============================== 4. Light mode ============================== */
  const THEME_KEY = 'djbTheme';
  const THEME_COLORS = { dark:'#0b0f14', light:'#f3f5f9' };
  function themePref(){
    try{ const v = localStorage.getItem(THEME_KEY); return ['dark', 'light', 'system'].includes(v) ? v : 'dark'; }catch(e){ return 'dark'; }
  }
  function systemTheme(){ return W.matchMedia && W.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }
  function resolvedTheme(pref = themePref()){ return pref === 'system' ? systemTheme() : pref; }
  function applyTheme(pref = themePref()){
    const theme = resolvedTheme(pref);
    D.documentElement.dataset.theme = theme;
    D.documentElement.dataset.themeChoice = pref;
    D.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', THEME_COLORS[theme]));
    return theme;
  }
  function setThemePref(pref){
    if(!['dark', 'light', 'system'].includes(pref)) return themePref();
    try{ localStorage.setItem(THEME_KEY, pref); }catch(e){}
    D.documentElement.classList.add('theme-switching');
    applyTheme(pref);
    setTimeout(() => D.documentElement.classList.remove('theme-switching'), 300);
    renderThemePanel();
    return pref;
  }
  if(W.matchMedia){
    const mq = W.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => { if(themePref() === 'system') applyTheme('system'); };
    if(mq.addEventListener) mq.addEventListener('change', onChange); else if(mq.addListener) mq.addListener(onChange);
  }
  function renderThemePanel(){
    const grid = D.querySelector('#settings .settings-grid');
    if(!grid) return;
    let panel = D.getElementById('settings-theme-panel');
    if(!panel){
      panel = D.createElement('section');
      panel.className = 'panel';
      panel.id = 'settings-theme-panel';
      grid.insertBefore(panel, grid.firstChild);
    }
    const pref = themePref();
    const opts = [['dark', 'Dark'], ['light', 'Light'], ['system', 'Match my device']];
    panel.innerHTML = `<span class="eyebrow">APPEARANCE</span><h3>Theme</h3><p>Light mode is easier to read outside in sunlight. "Match my device" follows your phone or computer setting.</p><div class="theme-switch" role="radiogroup" aria-label="Theme">${opts.map(([v, l]) => `<button class="ghost small" type="button" role="radio" data-theme-pref="${v}" aria-checked="${pref === v}">${l}</button>`).join('')}</div><small class="social-note" id="settings-theme-note">${pref === 'system' ? `Your device is set to ${resolvedTheme(pref)} right now.` : ''}</small>`;
    panel.querySelectorAll('[data-theme-pref]').forEach(btn => { btn.onclick = () => setThemePref(btn.dataset.themePref); });
  }
  applyTheme();

  /* ============================== 1. Battle room chat ============================== */
  const CHAT_MAX = 280;
  const CHAT_POLL_MS = 4000;
  const chat = { battleId:null, messages:[], timer:null, status:'idle', canSend:true, muted:false, error:'' };
  const muteKey = id => `djbChatMuted:${id}`;
  function chatSessionInfo(session){
    if(!session) return null;
    const battleId = session.battleId || session.id;
    const serverBacked = Boolean(session.battleEntryId || session.battlePrepSyncStatus === 'server');
    return { battleId, serverBacked, solo:!session.opponent };
  }
  function ensureChatPanel(){
    const room = D.getElementById('battle-room');
    if(!room) return null;
    let panel = D.getElementById('battle-chat');
    if(!panel){
      panel = D.createElement('section');
      panel.className = 'panel battle-chat';
      panel.id = 'battle-chat';
      panel.setAttribute('aria-label', 'Battle chat');
      room.appendChild(panel);
    }
    return panel;
  }
  function renderChat(){
    const panel = ensureChatPanel();
    if(!panel) return;
    const hadFocus = D.activeElement && D.activeElement.id === 'battle-chat-input';
    const muteLabel = chat.muted ? 'Unmute chat' : 'Mute chat';
    let body;
    let populate = null;
    if(chat.status === 'needs-server'){
      body = `<p class="social-note warn" id="battle-chat-needs-server">Chat needs the DJ Battle server. It turns on once your server is running and both DJs are signed in to a live battle.</p>`;
    }else if(chat.status === 'solo'){
      body = `<p class="battle-chat-note">Chat opens when another DJ joins this battle.</p>`;
    }else{
      const shown = chat.messages.filter(m => m.mine || !chat.muted);
      const hiddenCount = chat.messages.length - shown.length;
      body = `<ul class="battle-chat-list" id="battle-chat-list" aria-live="polite">${shown.length ? '' : `<li class="battle-chat-empty">${chat.status === 'loading' ? 'Loading chat…' : 'No messages yet. Say good luck!'}</li>`}</ul>
        ${hiddenCount ? `<p class="battle-chat-note">${hiddenCount} message${hiddenCount === 1 ? '' : 's'} hidden while chat is muted.</p>` : ''}
        ${chat.error ? `<p class="social-note" role="alert">${escHtml(chat.error)}</p>` : ''}
        ${chat.canSend ? `<form class="battle-chat-form" id="battle-chat-form"><input id="battle-chat-input" type="text" maxlength="${CHAT_MAX}" autocomplete="off" placeholder="Message your opponent" aria-label="Chat message"><button class="primary small" type="submit">Send</button></form>` : '<p class="battle-chat-note">You can\'t message this DJ.</p>'}`;
      populate = () => {
        const list = D.getElementById('battle-chat-list');
        if(!list) return;
        shown.forEach(m => {
          const li = D.createElement('li');
          li.className = `battle-chat-msg${m.mine ? ' mine' : ''}`;
          const who = D.createElement('small');
          who.textContent = `${m.mine ? 'You' : (m.author && m.author.displayName) || 'DJ'} · ${m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }) : ''}`;
          const p = D.createElement('p');
          p.textContent = m.body;
          li.append(who, p);
          if(m.mine){
            const unsend = D.createElement('button');
            unsend.type = 'button'; unsend.className = 'ghost small chat-unsend'; unsend.textContent = 'Unsend';
            unsend.setAttribute('aria-label', 'Unsend this message');
            unsend.onclick = () => unsendChat(m.id);
            li.appendChild(unsend);
          }
          if(!m.mine){
            const report = D.createElement('button');
            report.type = 'button'; report.className = 'ghost small chat-report'; report.textContent = 'Report';
            report.onclick = () => inlineReport(li, 'battle_chat_message', m.id);
            li.appendChild(report);
          }
          list.appendChild(li);
        });
        list.scrollTop = list.scrollHeight;
      };
    }
    panel.innerHTML = `<div class="battle-chat-head"><div><span class="eyebrow">BATTLE CHAT</span><h3>Talk to your opponent</h3></div>${chat.status === 'ready' || chat.status === 'loading' ? `<button class="ghost small" type="button" id="battle-chat-mute" aria-pressed="${chat.muted}">${muteLabel}</button>` : ''}</div>${body}`;
    if(populate) populate();
    renderChatButton();
    const mute = D.getElementById('battle-chat-mute');
    if(mute) mute.onclick = () => { chat.muted = !chat.muted; try{ localStorage.setItem(muteKey(chat.battleId), chat.muted ? '1' : ''); }catch(e){} renderChat(); };
    const form = D.getElementById('battle-chat-form');
    if(form){
      const input = D.getElementById('battle-chat-input');
      input.value = chat.draft || '';
      input.addEventListener('input', () => { chat.draft = input.value; });
      input.addEventListener('focus', () => markChatSeen());
      if(hadFocus) input.focus();
      form.onsubmit = e => { e.preventDefault(); sendChat(input.value); };
    }
  }
  async function loadChat(){
    if(!chat.battleId) return;
    const response = await api(`/api/battles/${encodeURIComponent(chat.battleId)}/chat`);
    if(response.error){
      if(needsServer(response) || response.data && response.data.schemaMissing){ chat.status = 'needs-server'; stopChatPolling(); }
      else chat.error = serverMessage(response, 'Chat could not load.');
      renderChat();
      return response;
    }
    chat.messages = (response.data && response.data.messages) || [];
    chat.canSend = response.data ? response.data.canSend !== false : true;
    chat.status = 'ready';
    chat.error = '';
    if(!chatSeenAt() && !chat.messages.some(m => !m.mine)) markChatSeen();
    else if(chatPanelOnScreen() && !isJsdom()) markChatSeen();
    renderChat();
    return response;
  }
  /* Oct 19b: unread count on the Chat button, and Unsend for your own messages. */
  const seenKey = id => `djbChatSeen:${id}`;
  function chatSeenAt(){ try{ return Number(localStorage.getItem(seenKey(chat.battleId)) || 0); }catch(e){ return 0; } }
  function unreadChatCount(){
    if(!chat.battleId || chat.muted) return 0;
    const seen = chatSeenAt();
    return chat.messages.filter(m => !m.mine && new Date(m.createdAt).getTime() > seen).length;
  }
  function chatPanelOnScreen(){
    const panel = D.getElementById('battle-chat');
    if(!panel || !chatVisible() || typeof panel.getBoundingClientRect !== 'function') return false;
    const r = panel.getBoundingClientRect();
    const h = W.innerHeight || D.documentElement.clientHeight || 0;
    return r.height > 0 && r.top < h && r.bottom > 0;
  }
  function markChatSeen(){
    if(!chat.battleId) return;
    const latest = chat.messages.reduce((max, m) => Math.max(max, new Date(m.createdAt).getTime() || 0), Date.now());
    try{ localStorage.setItem(seenKey(chat.battleId), String(latest)); }catch(e){}
    renderChatButton();
  }
  function renderChatButton(){
    const room = D.getElementById('battle-room');
    if(!room) return;
    let btn = D.getElementById('battle-chat-jump');
    const show = chat.battleId && (chat.status === 'ready' || chat.status === 'loading');
    if(!show){ if(btn) btn.remove(); return; }
    if(!btn){
      btn = D.createElement('button');
      btn.type = 'button'; btn.id = 'battle-chat-jump'; btn.className = 'ghost small battle-chat-jump';
      btn.onclick = () => { const panel = D.getElementById('battle-chat'); if(panel && panel.scrollIntoView) panel.scrollIntoView({ behavior:'smooth', block:'start' }); markChatSeen(); const input = D.getElementById('battle-chat-input'); if(input) input.focus({ preventScroll:true }); };
      const head = room.querySelector('.section-head');
      if(head) head.appendChild(btn); else room.insertBefore(btn, room.firstChild);
    }
    const n = unreadChatCount();
    btn.innerHTML = `<span aria-hidden="true">💬</span> Chat${n ? ` <span class="chat-unread-badge" id="battle-chat-unread">${n > 99 ? '99+' : n}</span>` : ''}`;
    btn.setAttribute('aria-label', n ? `Battle chat, ${n} unread message${n === 1 ? '' : 's'}` : 'Battle chat');
  }
  async function unsendChat(messageId){
    if(!chat.battleId || !messageId) return null;
    const ok = typeof W.appConfirm === 'function' ? await W.appConfirm({ title:'Unsend this message?', body:'It disappears for both DJs.', confirmLabel:'Unsend', cancelLabel:'Keep it', danger:true }) : true;
    if(!ok) return null;
    const response = await api(`/api/battles/${encodeURIComponent(chat.battleId)}/chat/${encodeURIComponent(messageId)}`, { method:'DELETE' });
    if(response.error && response.status !== 404){ chat.error = serverMessage(response, 'Message not unsent.'); renderChat(); return response; }
    chat.messages = chat.messages.filter(m => m.id !== messageId);
    chat.error = '';
    renderChat();
    return response;
  }
  async function sendChat(text){
    const body = String(text || '').trim().slice(0, CHAT_MAX);
    if(!body || !chat.battleId) return null;
    const response = await api(`/api/battles/${encodeURIComponent(chat.battleId)}/chat`, { method:'POST', body:{ body } });
    if(response.error){ chat.error = serverMessage(response, 'Message not sent.'); renderChat(); return response; }
    chat.messages.push(response.data.message);
    chat.draft = '';
    chat.error = '';
    markChatSeen();
    renderChat();
    return response;
  }
  function stopChatPolling(){ if(chat.timer){ clearInterval(chat.timer); chat.timer = null; } }
  function chatVisible(){ const room = D.getElementById('battle-room'); return Boolean(room && room.classList.contains('active')) && !D.hidden; }
  function startChatPolling(){
    stopChatPolling();
    if(chat.status === 'needs-server' || chat.status === 'solo' || isJsdom() && !W.__djbForceSocialPolling) return;
    chat.timer = setInterval(() => { if(chatVisible()) loadChat(); else if(D.hidden) stopChatPolling(); }, CHAT_POLL_MS);
  }
  D.addEventListener('visibilitychange', () => {
    if(D.hidden){ stopChatPolling(); return; }
    if(chat.battleId && chat.status === 'ready' && chatVisible()){ loadChat(); startChatPolling(); }
  });
  function onBattleRoom(session){
    const info = chatSessionInfo(session);
    if(!info) return;
    if(chat.battleId !== info.battleId){ chat.messages = []; chat.error = ''; }
    chat.battleId = info.battleId;
    try{ chat.muted = Boolean(localStorage.getItem(muteKey(info.battleId))); }catch(e){ chat.muted = false; }
    if(info.solo){ chat.status = 'solo'; stopChatPolling(); renderChat(); return; }
    if(!info.serverBacked || !hasApi() || !signedIn() || offline()){ chat.status = 'needs-server'; stopChatPolling(); renderChat(); return; }
    chat.status = 'loading';
    renderChat();
    loadChat().then(() => startChatPolling());
  }

  /* ============================== 2. Tournaments ============================== */
  const tour = { status:'idle', list:[], current:null, error:'' };
  function ensureTournamentView(){
    const main = D.querySelector('.main');
    if(!main || D.getElementById('tournaments')) return;
    const section = D.createElement('section');
    section.id = 'tournaments';
    section.className = 'view';
    section.innerHTML = `<div class="product-page-head tournament-head"><div><span class="eyebrow accent">TOURNAMENTS</span><h2>Knockout tournaments</h2><p>8 or 16 DJs, single elimination. Every match is a normal battle, and winners move on automatically until there's a champion.</p></div><div class="tournament-actions"><button class="ghost compact" id="tournament-refresh" type="button">Refresh</button><button class="primary compact" id="tournament-create" type="button">Create a tournament</button></div></div><div class="social-note" id="tournament-status" aria-live="polite"></div><div id="tournament-detail"></div><div class="tournament-list" id="tournament-list"></div>`;
    main.insertBefore(section, D.getElementById('operations') || null);
  }
  function roundName(round, rounds){
    const left = rounds - round;
    return left === 0 ? 'Final' : left === 1 ? 'Semifinals' : left === 2 ? 'Quarterfinals' : `Round ${round}`;
  }
  function statusLabel(t){
    if(t.status === 'open') return `Sign-up open · ${t.entrantCount}/${t.capacity}`;
    if(t.status === 'active') return 'In progress';
    if(t.status === 'completed') return 'Finished';
    if(t.status === 'cancelled') return 'Cancelled';
    return t.status;
  }
  function renderTournamentList(){
    const list = D.getElementById('tournament-list');
    const status = D.getElementById('tournament-status');
    if(!list || !status) return;
    const create = D.getElementById('tournament-create');
    if(create){ create.onclick = () => openCreateTournament(); }
    const refresh = D.getElementById('tournament-refresh');
    if(refresh) refresh.onclick = () => loadTournaments();
    status.className = 'social-note';
    if(tour.status === 'needs-server'){ status.className = 'social-note warn'; status.textContent = 'Tournaments need the DJ Battle server. Once your server is running (and SQL file 032 is applied), tournaments appear here.'; }
    else if(tour.status === 'loading') status.textContent = 'Loading tournaments…';
    else if(tour.error) status.textContent = tour.error;
    else if(!signedIn()) status.textContent = 'Sign in to create or join a tournament. Anyone can watch the brackets.';
    else status.textContent = '';
    if(tour.current) { list.innerHTML = ''; renderTournamentDetail(); return; }
    D.getElementById('tournament-detail').innerHTML = '';
    if(!tour.list.length){ list.innerHTML = tour.status === 'ready' ? '<div class="store-empty"><strong>No tournaments yet</strong><p>Create one and invite your crew.</p></div>' : ''; return; }
    list.innerHTML = tour.list.map(t => `<article class="tournament-card" data-tournament="${escHtml(t.id)}"><span class="tournament-status">${escHtml(statusLabel(t))}</span><h4>${escHtml(t.title)}</h4><p>${escHtml(t.capacity)} DJs · ${escHtml(t.genre)} · hosted by ${escHtml(t.host ? t.host.displayName : 'DJ')}</p>${t.champion ? `<p>🏆 Champion: <strong>${escHtml(t.champion.displayName)}</strong></p>` : ''}<button class="ghost small" type="button" data-open-tournament="${escHtml(t.id)}">${t.status === 'open' ? 'View & sign up' : 'View bracket'}</button></article>`).join('');
    list.querySelectorAll('[data-open-tournament]').forEach(btn => { btn.onclick = () => openTournament(btn.dataset.openTournament); });
  }
  /* Oct 19b: round deadlines with a live countdown. */
  function countdownText(deadlineAt, now = Date.now()){
    const ms = new Date(deadlineAt).getTime() - now;
    if(!Number.isFinite(ms)) return '';
    if(ms <= 0) return 'Time\'s up · settling by forfeit';
    const mins = Math.floor(ms / 60000);
    const d = Math.floor(mins / 1440), h = Math.floor(mins % 1440 / 60), m = mins % 60;
    return `${d ? `${d}d ` : ''}${d || h ? `${h}h ` : ''}${d ? '' : `${m}m `}left`.trim();
  }
  function roundLengthLabel(h){ return h === 168 ? '1 week' : `${h} hours`; }
  let countdownTimer = null;
  function tickCountdowns(){
    D.querySelectorAll('[data-deadline]').forEach(el => {
      const text = countdownText(el.dataset.deadline);
      el.textContent = `⏱ ${text}`;
      const ms = new Date(el.dataset.deadline).getTime() - Date.now();
      el.classList.toggle('urgent', ms > 0 && ms < 6 * 3600000);
      el.classList.toggle('overdue', ms <= 0);
    });
  }
  function startCountdowns(){
    tickCountdowns();
    if(countdownTimer || isJsdom()) return;
    countdownTimer = setInterval(() => { if(!D.querySelector('[data-deadline]')){ clearInterval(countdownTimer); countdownTimer = null; return; } tickCountdowns(); }, 30000);
  }
  function deadlineHtml(m){
    if(!m.deadlineAt || m.winner || !['ready', 'active'].includes(m.status)) return '';
    const when = new Date(m.deadlineAt);
    return `<span class="bracket-deadline" data-deadline="${escHtml(m.deadlineAt)}" title="Play by ${escHtml(when.toLocaleString([], { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }))}">⏱ ${escHtml(countdownText(m.deadlineAt))}</span>`;
  }
  function forfeitHtml(m){
    if(!m.forfeit || !m.winner) return '';
    return `<span class="bracket-forfeit">Won by forfeit · ${escHtml(m.forfeit.displayName)} didn't play</span>`;
  }
  function slotHtml(p, match){
    if(!p) return `<div class="bracket-slot empty">${match.status === 'bye' || match.status === 'void' ? 'Bye' : 'TBD'}</div>`;
    const winner = match.winner && match.winner.publicProfileId === p.publicProfileId;
    return `<div class="bracket-slot${winner ? ' winner' : ''}${p.you ? ' you' : ''}"><span>${p.seed ? `<small>${escHtml(p.seed)}</small> ` : ''}${escHtml(p.displayName)}${p.you ? ' (you)' : ''}</span></div>`;
  }
  function bracketHtml(t){
    const rounds = [];
    for(let r = 1; r <= t.rounds; r++) rounds.push(t.matches.filter(m => m.round === r));
    const yourMatch = t.you && t.you.matchId;
    return `<div class="bracket-scroll" role="region" aria-label="Tournament bracket" tabindex="0"><div class="bracket">${rounds.map((ms, i) => `<div class="bracket-round"><h5>${escHtml(roundName(i + 1, t.rounds))}</h5>${ms.map(m => `<div class="bracket-match${m.status === 'ready' || m.status === 'active' ? ' is-ready' : ''}" data-match="${escHtml(m.id)}">${slotHtml(m.first, m)}${slotHtml(m.second, m)}${deadlineHtml(m)}${forfeitHtml(m)}<div class="bracket-match-foot">${m.id === yourMatch ? `<button class="primary small" type="button" data-play-match="${escHtml(m.id)}">${m.hasBattle ? 'Go to your battle' : 'Start your battle'}</button>` : escHtml({ ready:'Ready to battle', active:'Battle in progress', completed:'Finished', bye:'Free pass', void:'No match', pending:'Waiting' }[m.status] || m.status)}</div></div>`).join('')}</div>`).join('')}</div></div>`;
  }
  function renderTournamentDetail(){
    const host = D.getElementById('tournament-detail');
    const t = tour.current;
    if(!host || !t) return;
    const you = t.you || {};
    const actions = [];
    actions.push('<button class="ghost small" type="button" id="tournament-back">← All tournaments</button>');
    const hostCanEdit = you.host && ['open', 'active'].includes(t.status);
    if(t.status === 'open' && signedIn() && !you.joined) actions.push('<button class="primary small" type="button" id="tournament-join">Sign up</button>');
    if(t.status === 'open' && you.joined && !you.host) actions.push('<button class="ghost small" type="button" id="tournament-leave">Leave</button>');
    if(t.status === 'open' && you.host) actions.push(`<button class="primary small" type="button" id="tournament-start" ${t.entrantCount < 2 ? 'disabled' : ''}>Start now${t.entrantCount < t.capacity ? ' (empty seats become byes)' : ''}</button>`);
    const startLine = t.status === 'open' && t.startsAt ? `<p class="tournament-starts" id="tournament-starts">Starts ${escHtml(new Date(t.startsAt).toLocaleString([], { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }))} (if at least 2 DJs have signed up)</p>` : '';
    const hostTools = hostCanEdit ? `<div class="tournament-host-tools" id="tournament-host-tools"><span class="eyebrow">HOST CONTROLS</span><div class="tournament-actions"><button class="ghost small" type="button" id="tournament-edit">Edit name${t.status === 'open' ? ' & start date' : ''}</button><button class="ghost small" type="button" id="tournament-remove-dj" ${t.entrants.length > 1 ? '' : 'disabled'}>Remove a DJ</button><button class="danger-btn small" type="button" id="tournament-cancel">Cancel tournament</button></div></div>` : '';
    host.innerHTML = `<section class="panel"><span class="tournament-status">${escHtml(statusLabel(t))}</span><h3>${escHtml(t.title)}</h3><p class="social-note">${escHtml(t.capacity)}-DJ single elimination · ${escHtml(t.genre)} · ${t.seeding === 'signup' ? 'seeded in sign-up order' : 'random pairings'} · ${escHtml(roundLengthLabel(t.roundHours || 48))} per round · hosted by ${escHtml(t.host ? t.host.displayName : 'DJ')}</p>${startLine}
      ${t.champion ? `<div class="tournament-champion" id="tournament-champion"><span style="font-size:32px" aria-hidden="true">🏆</span><div><span class="eyebrow">CHAMPION</span><br><strong>${escHtml(t.champion.displayName)}</strong></div></div>` : ''}
      <div class="tournament-actions">${actions.join('')}</div>${hostTools}
      ${t.status === 'active' ? `<p class="social-note">Each round has ${escHtml(roundLengthLabel(t.roundHours || 48))}. If a DJ doesn't send in a mix before the timer runs out, they lose by forfeit.</p>` : ''}
      ${t.status === 'open' ? `<h4>Signed up (${escHtml(t.entrantCount)}/${escHtml(t.capacity)})</h4><ul class="tournament-entrants">${t.entrants.map(e => `<li>${escHtml(e.displayName)}${e.you ? ' (you)' : ''}</li>`).join('')}</ul><p class="social-note">The bracket is drawn when all ${escHtml(t.capacity)} seats fill, or when the host starts early.</p>` : bracketHtml(t)}
      <p class="social-note" id="tournament-action-status" aria-live="polite"></p></section>`;
    const wire = (id, fn) => { const el = D.getElementById(id); if(el) el.onclick = fn; };
    wire('tournament-back', () => { tour.current = null; renderTournamentList(); loadTournaments(); });
    wire('tournament-join', () => tournamentAction('join'));
    wire('tournament-leave', () => tournamentAction('leave'));
    wire('tournament-start', () => tournamentAction('start'));
    wire('tournament-edit', () => openEditTournament());
    wire('tournament-remove-dj', () => openRemoveDj());
    wire('tournament-cancel', () => cancelTournamentFlow());
    host.querySelectorAll('[data-play-match]').forEach(btn => { btn.onclick = () => playMatch(btn.dataset.playMatch); });
    startCountdowns();
  }
  async function loadTournaments(){
    ensureTournamentView();
    tour.status = 'loading'; tour.error = '';
    renderTournamentList();
    const response = await api('/api/tournaments', { public:!signedIn() });
    if(response.error){
      if(needsServer(response) || response.data && response.data.schemaMissing) tour.status = 'needs-server';
      else { tour.status = 'failed'; tour.error = serverMessage(response, 'Tournaments could not load.'); }
    }else{ tour.list = response.data.tournaments || []; tour.status = 'ready'; }
    renderTournamentList();
    return response;
  }
  async function openTournament(id){
    const response = await api(`/api/tournaments/${encodeURIComponent(id)}`, { public:!signedIn() });
    if(response.error){ tour.error = serverMessage(response, 'Tournament could not load.'); renderTournamentList(); return response; }
    tour.current = response.data.tournament;
    renderTournamentList();
    return response;
  }
  async function tournamentAction(action){
    const t = tour.current;
    if(!t) return null;
    const response = await api(`/api/tournaments/${encodeURIComponent(t.id)}/${action}`, { method:'POST', body:{} });
    const note = D.getElementById('tournament-action-status');
    if(response.error){ if(note) note.textContent = serverMessage(response, 'That didn\'t work, try again.'); return response; }
    tour.current = response.data.tournament;
    renderTournamentDetail();
    return response;
  }
  async function playMatch(matchId){
    const t = tour.current;
    const response = await api(`/api/tournaments/${encodeURIComponent(t.id)}/matches/${encodeURIComponent(matchId)}/battle`, { method:'POST', body:{} });
    const note = D.getElementById('tournament-action-status');
    if(response.error){ if(note) note.textContent = serverMessage(response, 'Your battle could not start.'); return response; }
    if(response.data.room && typeof W.routeAcceptedChallengeToBattleRoom === 'function') W.routeAcceptedChallengeToBattleRoom({ room:response.data.room });
    else if(note) note.textContent = 'Your battle is ready. Open it from Battles.';
    return response;
  }
  /* Oct 19b: host controls. */
  function localInputValue(iso){
    if(!iso) return '';
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const ROUND_OPTIONS = [[12, '12 hours'], [24, '24 hours'], [48, '48 hours (recommended)'], [72, '72 hours'], [168, '1 week']];
  async function hostRequest(path, opts){
    const response = await api(path, opts);
    if(response.error) return response;
    if(response.data && response.data.tournament) tour.current = response.data.tournament;
    return response;
  }
  function openEditTournament(){
    const t = tour.current;
    if(!t) return null;
    const open = t.status === 'open';
    W.openModal(`<span class="eyebrow accent">HOST CONTROLS</span><h3>Edit tournament</h3><div class="form-grid" id="tournament-edit-form">
      <label>Name<input id="tournament-edit-title" maxlength="120" value="${escHtml(t.title)}"></label>
      ${open ? `<label>Start date (optional)<input id="tournament-edit-starts" type="datetime-local" value="${escHtml(localInputValue(t.startsAt))}"></label>
      <label>Time per round<select id="tournament-edit-hours">${ROUND_OPTIONS.map(([v, l]) => `<option value="${v}" ${Number(t.roundHours || 48) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <p class="social-note">Leave the start date empty to start by hand. When the date arrives, the bracket is drawn with whoever has signed up (at least 2 DJs).</p>` : '<p class="social-note">The tournament has started, so only the name can change.</p>'}
      <p class="social-note" id="tournament-edit-error" role="alert"></p>
      <div class="modal-actions"><button class="ghost" type="button" id="tournament-edit-close">Close</button><button class="primary" type="button" id="tournament-edit-save">Save</button></div></div>`);
    D.getElementById('tournament-edit-close').onclick = () => D.getElementById('modal').close();
    D.getElementById('tournament-edit-save').onclick = async () => {
      const body = { title:D.getElementById('tournament-edit-title').value };
      if(open){
        const starts = D.getElementById('tournament-edit-starts').value;
        body.startsAt = starts ? new Date(starts).toISOString() : null;
        body.roundHours = Number(D.getElementById('tournament-edit-hours').value);
      }
      const response = await hostRequest(`/api/tournaments/${encodeURIComponent(t.id)}`, { method:'PATCH', body });
      if(response.error){ D.getElementById('tournament-edit-error').textContent = serverMessage(response, 'Could not save.'); return; }
      D.getElementById('modal').close();
      renderTournamentDetail();
    };
    return true;
  }
  function openRemoveDj(){
    const t = tour.current;
    if(!t) return null;
    const others = t.entrants.filter(e => e && !e.you);
    W.openModal(`<span class="eyebrow accent">HOST CONTROLS</span><h3>Remove a DJ</h3><p class="social-note">${t.status === 'open' ? 'Their seat opens up for someone else.' : 'They lose their current match by forfeit and their opponent moves on.'}</p><ul class="tournament-remove-list" id="tournament-remove-list">${others.map(e => `<li><span>${escHtml(e.displayName)}</span><button class="danger-btn small" type="button" data-remove-dj="${escHtml(e.publicProfileId)}" data-remove-name="${escHtml(e.displayName)}">Remove</button></li>`).join('') || '<li>No other DJs yet.</li>'}</ul><p class="social-note" id="tournament-remove-error" role="alert"></p><div class="modal-actions"><button class="ghost" type="button" id="tournament-remove-close">Done</button></div>`);
    D.getElementById('tournament-remove-close').onclick = () => D.getElementById('modal').close();
    D.querySelectorAll('[data-remove-dj]').forEach(btn => { btn.onclick = () => removeDj(btn.dataset.removeDj, btn.dataset.removeName); });
    return true;
  }
  async function removeDj(publicProfileId, name){
    const t = tour.current;
    const ok = typeof W.appConfirm === 'function' ? await W.appConfirm({ title:`Remove ${name || 'this DJ'}?`, body:t.status === 'open' ? 'They can sign up again later if there is room.' : 'They lose their current match by forfeit. This can\'t be undone.', confirmLabel:'Remove', cancelLabel:'Keep them', danger:true }) : true;
    if(!ok) return null;
    const response = await hostRequest(`/api/tournaments/${encodeURIComponent(t.id)}/remove`, { method:'POST', body:{ publicProfileId } });
    if(response.error){ const el = D.getElementById('tournament-remove-error'); if(el) el.textContent = serverMessage(response, 'Could not remove that DJ.'); return response; }
    const modal = D.getElementById('modal'); if(modal && modal.open) modal.close();
    renderTournamentDetail();
    return response;
  }
  async function cancelTournamentFlow(){
    const t = tour.current;
    if(!t) return null;
    const ok = typeof W.appConfirm === 'function' ? await W.appConfirm({ title:`Cancel ${t.title}?`, body:'The bracket stops and the tournament disappears from the list for everyone. This can\'t be undone.', confirmLabel:'Cancel tournament', cancelLabel:'Keep it', danger:true }) : true;
    if(!ok) return null;
    const response = await api(`/api/tournaments/${encodeURIComponent(t.id)}/cancel`, { method:'POST', body:{} });
    const note = D.getElementById('tournament-action-status');
    if(response.error){ if(note) note.textContent = serverMessage(response, 'Could not cancel.'); return response; }
    tour.current = null;
    tour.list = tour.list.filter(x => x.id !== t.id);
    tour.error = '';
    renderTournamentList();
    const status = D.getElementById('tournament-status'); if(status) status.textContent = `${t.title} was cancelled.`;
    return response;
  }
  function openCreateTournament(){
    if(!signedIn()){ if(typeof W.appAlert === 'function') W.appAlert('Sign in to create a tournament.', 'Tournaments'); return null; }
    W.openModal(`<span class="eyebrow accent">NEW TOURNAMENT</span><h3>Create a tournament</h3><div class="form-grid" id="tournament-create-form">
      <label>Name<input id="tournament-title" maxlength="120" required placeholder="Friday Night Knockout"></label>
      <label>Size<select id="tournament-capacity"><option value="8">8 DJs (3 rounds)</option><option value="16">16 DJs (4 rounds)</option></select></label>
      <label>Genre<input id="tournament-genre" maxlength="60" placeholder="Open Format"></label>
      <label>Pairings<select id="tournament-seeding"><option value="random">Random draw</option><option value="signup">Sign-up order (first to join is seed 1)</option></select></label>
      <label>Time per round<select id="tournament-hours">${ROUND_OPTIONS.map(([v, l]) => `<option value="${v}" ${v === 48 ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Start date (optional)<input id="tournament-starts" type="datetime-local"></label>
      <p class="social-note">You're signed up as the first DJ. If seats are still empty when you start, top seeds get a free pass to the next round.</p>
      <p class="social-note" id="tournament-create-error" role="alert"></p>
      <div class="modal-actions"><button class="ghost" value="cancel" type="button" id="tournament-create-cancel">Cancel</button><button class="primary" type="button" id="tournament-create-submit">Create</button></div></div>`);
    D.getElementById('tournament-create-cancel').onclick = () => D.getElementById('modal').close();
    D.getElementById('tournament-create-submit').onclick = async () => {
      const body = { title:D.getElementById('tournament-title').value, capacity:Number(D.getElementById('tournament-capacity').value), genre:D.getElementById('tournament-genre').value, seeding:D.getElementById('tournament-seeding').value, roundHours:Number(D.getElementById('tournament-hours').value) };
      const starts = D.getElementById('tournament-starts').value;
      if(starts) body.startsAt = new Date(starts).toISOString();
      const response = await api('/api/tournaments', { method:'POST', body });
      if(response.error){ D.getElementById('tournament-create-error').textContent = needsServer(response) ? 'Tournaments need the DJ Battle server.' : serverMessage(response, 'Could not create the tournament.'); return; }
      D.getElementById('modal').close();
      tour.current = response.data.tournament;
      renderTournamentList();
    };
    return true;
  }

  /* ============================== 3. Timed comments ============================== */
  const timed = { resultId:null, duration:300, comments:[], status:'idle', activeId:null, audio:null, maxLength:500 };
  function hashBars(id, count = 72){
    let h = 2166136261;
    for(const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    const out = [];
    for(let i = 0; i < count; i++){ h = Math.imul(h ^ (h >>> 13), 1274126177); out.push(25 + ((h >>> 0) % 75)); }
    return out;
  }
  function resultDuration(result){
    const n = Number(result.durationSeconds || result.mixDurationSeconds || result.evidence && result.evidence.durationSeconds || result.battle && result.battle.durationMinutes * 60 || result.durationMinutes * 60);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 4 * 3600) : 300;
  }
  function seekTo(sec, commentId){
    timed.position = Math.max(0, Math.min(timed.duration, sec));
    timed.activeId = commentId || null;
    if(timed.audio){ try{ timed.audio.currentTime = timed.position; }catch(e){} }
    renderTimed();
  }
  function renderTimed(){
    const host = D.getElementById('timed-comments');
    if(!host) return;
    const pct = sec => `${(Math.max(0, Math.min(timed.duration, sec)) / timed.duration * 100).toFixed(2)}%`;
    const signed = signedIn();
    let note = '';
    if(timed.status === 'needs-server') note = '<p class="social-note warn">Timed comments need the DJ Battle server, so they can\'t load right now.</p>';
    else if(timed.status === 'loading') note = '<p class="social-note">Loading comments…</p>';
    else if(timed.error) note = `<p class="social-note" role="alert">${escHtml(timed.error)}</p>`;
    host.innerHTML = `<span class="eyebrow">COMMENTS IN THE MIX</span><p class="social-note">${signed ? 'Tap the waveform to comment on that exact moment. Tap a dot to jump to it.' : 'Tap a dot to jump to that moment. Sign in to add your own.'}</p>
      ${timed.audio ? '' : '<p class="social-note">This result has no public audio, so the playhead shows the moment without playing it.</p>'}
      <div class="timed-wave" id="timed-wave" role="slider" aria-label="Mix timeline" aria-valuemin="0" aria-valuemax="${Math.round(timed.duration)}" aria-valuenow="${Math.round(timed.position || 0)}" aria-valuetext="${fmtTime(timed.position || 0)}" tabindex="0"><div class="timed-wave-bars" aria-hidden="true">${hashBars(timed.resultId).map(h => `<i style="height:${h}%"></i>`).join('')}</div><div class="timed-wave-playhead" style="left:${pct(timed.position || 0)}"></div>${timed.comments.map(c => `<button type="button" class="timed-marker${c.id === timed.activeId ? ' active' : ''}" style="left:${pct(c.atSeconds)}" data-marker="${escHtml(c.id)}" aria-label="Jump to ${fmtTime(c.atSeconds)}: ${escHtml(c.body.slice(0, 60))}"></button>`).join('')}</div>
      <div class="timed-wave-times"><span>0:00</span><span>${fmtTime(timed.duration)}</span></div>
      ${note}
      <div id="timed-form-host"></div>
      <ol class="timed-list" id="timed-list"></ol>`;
    const wave = D.getElementById('timed-wave');
    wave.onclick = e => {
      if(e.target.closest('[data-marker]')) return;
      const rect = wave.getBoundingClientRect();
      const sec = rect.width ? (e.clientX - rect.left) / rect.width * timed.duration : 0;
      seekTo(sec);
      if(signed && timed.status !== 'needs-server') openTimedForm(timed.position);
    };
    wave.onkeydown = e => {
      if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){ e.preventDefault(); seekTo((timed.position || 0) + (e.key === 'ArrowRight' ? 5 : -5)); D.getElementById('timed-wave').focus(); }
      if(e.key === 'Enter' && signed){ openTimedForm(timed.position || 0); }
    };
    wave.querySelectorAll('[data-marker]').forEach(btn => { btn.onclick = () => { const c = timed.comments.find(x => x.id === btn.dataset.marker); if(c) seekTo(c.atSeconds, c.id); }; });
    const list = D.getElementById('timed-list');
    if(!timed.comments.length && timed.status === 'ready'){ const li = D.createElement('li'); li.className = 'social-note'; li.textContent = 'No comments yet.'; list.appendChild(li); }
    timed.comments.forEach(c => list.appendChild(timedItem(c)));
    if(timed.formAt != null) openTimedForm(timed.formAt);
  }
  function timedItem(c){
    const li = D.createElement('li');
    li.className = `timed-item${c.id === timed.activeId ? ' active' : ''}`;
    li.dataset.timedComment = c.id;
    const head = D.createElement('div'); head.className = 'timed-item-head';
    const time = D.createElement('button'); time.type = 'button'; time.className = 'ghost small timed-time'; time.textContent = fmtTime(c.atSeconds); time.setAttribute('aria-label', `Jump to ${fmtTime(c.atSeconds)}`);
    time.onclick = () => seekTo(c.atSeconds, c.id);
    const who = D.createElement('strong'); who.textContent = c.mine ? 'You' : (c.author && c.author.displayName) || 'DJ';
    head.append(time, who);
    if(c.editedAt){ const ed = D.createElement('small'); ed.className = 'social-note'; ed.textContent = '(edited)'; head.appendChild(ed); }
    const p = D.createElement('p'); p.textContent = c.body;
    const actions = D.createElement('div'); actions.className = 'timed-item-actions';
    const btn = (label, fn) => { const b = D.createElement('button'); b.type = 'button'; b.className = 'ghost small'; b.textContent = label; b.onclick = fn; actions.appendChild(b); return b; };
    if(c.mine){
      btn('Edit', () => editTimed(li, c));
      btn('Delete', () => {
        actions.innerHTML = '';
        const q = D.createElement('span'); q.className = 'social-note'; q.textContent = 'Delete this comment?'; actions.appendChild(q);
        btn('Yes, delete', () => deleteTimed(c.id));
        btn('Keep it', () => renderTimed());
      });
    }else if(signedIn()) btn('Report', () => inlineReport(li, 'timed_comment', c.id));
    li.append(head, p, actions);
    return li;
  }
  function openTimedForm(at){
    timed.formAt = at;
    const host = D.getElementById('timed-form-host');
    if(!host) return;
    host.innerHTML = `<div class="timed-form" id="timed-form"><span class="social-note">At <strong>${fmtTime(at)}</strong></span><input id="timed-input" maxlength="${timed.maxLength}" placeholder="What happened here?" aria-label="Comment at ${fmtTime(at)}"><button class="primary small" type="button" id="timed-post">Post</button><button class="ghost small" type="button" id="timed-cancel">Cancel</button></div>`;
    const input = D.getElementById('timed-input');
    D.getElementById('timed-cancel').onclick = () => { timed.formAt = null; host.innerHTML = ''; };
    D.getElementById('timed-post').onclick = () => addTimed(at, input.value);
    input.onkeydown = e => { if(e.key === 'Enter'){ e.preventDefault(); addTimed(at, input.value); } };
    try{ input.focus({ preventScroll:true }); }catch(e){}
  }
  function editTimed(li, c){
    const p = li.querySelector('p');
    const form = D.createElement('div'); form.className = 'timed-form';
    const input = D.createElement('input'); input.maxLength = timed.maxLength; input.value = c.body; input.setAttribute('aria-label', 'Edit comment');
    const save = D.createElement('button'); save.type = 'button'; save.className = 'primary small'; save.textContent = 'Save';
    const cancel = D.createElement('button'); cancel.type = 'button'; cancel.className = 'ghost small'; cancel.textContent = 'Cancel'; cancel.onclick = () => renderTimed();
    form.append(input, save, cancel);
    const doSave = async () => {
      const response = await api(`/api/timedComments/${encodeURIComponent(c.id)}`, { method:'PATCH', body:{ body:input.value } });
      if(response.error){ timed.error = serverMessage(response, 'Edit not saved.'); return renderTimed(); }
      Object.assign(c, response.data.comment); timed.error = ''; renderTimed();
    };
    save.onclick = doSave;
    input.onkeydown = e => { if(e.key === 'Enter'){ e.preventDefault(); doSave(); } };
    p.replaceWith(form);
    input.focus();
  }
  async function addTimed(at, text){
    const body = String(text || '').trim();
    if(!body) return null;
    const response = await api(`/api/publicBattleResults/${encodeURIComponent(timed.resultId)}/timedComments`, { method:'POST', body:{ atSeconds:Math.round(at * 10) / 10, body } });
    if(response.error){ timed.error = serverMessage(response, 'Comment not posted.'); renderTimed(); return response; }
    timed.comments.push(response.data.comment);
    timed.comments.sort((a, b) => a.atSeconds - b.atSeconds);
    timed.formAt = null; timed.error = ''; timed.activeId = response.data.comment.id;
    renderTimed();
    return response;
  }
  async function deleteTimed(id){
    const response = await api(`/api/timedComments/${encodeURIComponent(id)}`, { method:'DELETE' });
    if(response.error){ timed.error = serverMessage(response, 'Comment not deleted.'); return renderTimed(); }
    timed.comments = timed.comments.filter(c => c.id !== id);
    renderTimed();
    return response;
  }
  async function loadTimed(){
    const response = await api(`/api/publicBattleResults/${encodeURIComponent(timed.resultId)}/timedComments`, { public:!signedIn() });
    if(response.error){
      if(needsServer(response) || response.data && response.data.schemaMissing) timed.status = 'needs-server';
      else { timed.status = 'failed'; timed.error = serverMessage(response, 'Comments could not load.'); }
    }else{ timed.comments = (response.data.comments || []).slice().sort((a, b) => a.atSeconds - b.atSeconds); timed.maxLength = response.data.maxLength || 500; timed.status = 'ready'; }
    renderTimed();
    return response;
  }
  function onPublicResult(result){
    const surface = D.querySelector('#modal-content .battle-result-surface');
    if(!surface || !result || !result.verifiedResultId) return null;
    Object.assign(timed, { resultId:result.verifiedResultId, duration:resultDuration(result), comments:[], status:'loading', activeId:null, position:0, formAt:null, error:'' });
    const audioUrl = result.audioUrl || result.previewUrl || result.playbackUrl;
    timed.audio = null;
    if(audioUrl && /^https:\/\//.test(audioUrl)){
      const audio = D.createElement('audio'); audio.controls = true; audio.preload = 'none'; audio.src = audioUrl; audio.className = 'timed-audio'; audio.style.width = '100%';
      audio.ontimeupdate = () => { timed.position = audio.currentTime; const ph = D.querySelector('.timed-wave-playhead'); if(ph) ph.style.left = `${(audio.currentTime / timed.duration * 100).toFixed(2)}%`; };
      surface.appendChild(audio); timed.audio = audio;
    }
    const host = D.createElement('div'); host.className = 'timed-comments'; host.id = 'timed-comments';
    surface.appendChild(host);
    const actions = D.querySelector('#modal-content .modal-actions');
    if(actions && !actions.querySelector('[data-embed-result]')){
      const b = D.createElement('button'); b.type = 'button'; b.className = 'ghost'; b.dataset.embedResult = result.verifiedResultId; b.textContent = 'Embed';
      b.onclick = () => showEmbedInline(surface, 'result', result.verifiedResultId);
      actions.insertBefore(b, actions.firstChild);
    }
    renderTimed();
    loadTimed();
    return host;
  }

  /* ============================== 5. Embeddable player ============================== */
  function embedUrl(type, id){
    let base;
    try{ base = new URL('embed.html', W.location.href); }catch(e){ base = { href:'embed.html' }; }
    const url = `${String(base.href).split('?')[0].split('#')[0]}?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
    return url;
  }
  function embedSnippet(type, id){
    const title = type === 'beat' ? 'DJ Battle beat player' : 'DJ Battle result player';
    return `<iframe src="${embedUrl(type, id)}" width="100%" height="170" style="border:0;border-radius:12px;max-width:480px" loading="lazy" title="${title}"></iframe>`;
  }
  function embedPanelHtml(type, id){
    const code = embedSnippet(type, id);
    return `<div class="embed-panel" id="embed-panel"><span class="eyebrow">EMBED</span><p class="social-note">Paste this into your website or link-in-bio page. It shows a small player with a "Battle me on DJ Battle" button.</p><textarea class="embed-code" id="embed-code" readonly aria-label="Embed code">${escHtml(code)}</textarea><div class="modal-actions" style="justify-content:flex-start"><button class="primary small" type="button" id="embed-copy">Copy code</button><span class="social-note" id="embed-copied" aria-live="polite"></span></div></div>`;
  }
  function wireEmbedCopy(){
    const btn = D.getElementById('embed-copy');
    if(!btn) return;
    btn.onclick = async () => {
      const ta = D.getElementById('embed-code');
      let ok = false;
      try{ if(navigator.clipboard){ await navigator.clipboard.writeText(ta.value); ok = true; } }catch(e){}
      if(!ok){ ta.select(); try{ ok = D.execCommand('copy'); }catch(e){} }
      D.getElementById('embed-copied').textContent = ok ? 'Copied!' : 'Select the code and copy it.';
    };
  }
  function showEmbedInline(container, type, id){
    const old = D.getElementById('embed-panel');
    if(old){ old.remove(); return null; }
    container.insertAdjacentHTML('beforeend', embedPanelHtml(type, id));
    wireEmbedCopy();
    return D.getElementById('embed-panel');
  }
  function openBeatEmbed(listingId){
    W.openModal(`<h3>Embed this beat</h3>${embedPanelHtml('beat', listingId)}<div class="modal-actions"><button class="ghost" value="cancel">Close</button></div>`);
    wireEmbedCopy();
  }
  function decorateBeatStore(){
    D.querySelectorAll('#store-grid [data-store-listing]').forEach(card => {
      if(card.querySelector('[data-store-embed]')) return;
      const foot = card.querySelector('.store-card-foot');
      if(!foot) return;
      const b = D.createElement('button'); b.type = 'button'; b.className = 'ghost small'; b.dataset.storeEmbed = card.dataset.storeListing; b.textContent = 'Embed';
      b.onclick = () => openBeatEmbed(card.dataset.storeListing);
      foot.appendChild(b);
    });
  }

  /* ============================== Oct 19b: notification switches ============================== */
  const NOTIFY_TYPES = [
    ['tournament_match_ready', 'Tournament match is ready', 'When your next tournament battle can start (with its deadline).'],
    ['battle_chat_message', 'Battle chat messages', 'When your opponent writes in battle chat (at most one alert every 10 minutes).'],
    ['timed_comment_received', 'Comments on your mixes', 'When someone pins a comment to a moment in one of your public mixes.']
  ];
  const notify = { status:'idle', prefs:null, error:'' };
  function renderNotifyPanel(){
    const grid = D.querySelector('#settings .settings-grid');
    if(!grid) return;
    let panel = D.getElementById('settings-social-notify');
    if(!panel){
      panel = D.createElement('section');
      panel.className = 'panel';
      panel.id = 'settings-social-notify';
      const theme = D.getElementById('settings-theme-panel');
      grid.insertBefore(panel, theme ? theme.nextSibling : grid.firstChild);
    }
    const prefs = notify.prefs || {};
    const disabled = notify.status !== 'ready';
    const note = notify.status === 'needs-server' ? '<p class="social-note warn" id="settings-notify-note">These switches need the DJ Battle server and a signed-in account.</p>'
      : notify.status === 'signed-out' ? '<p class="social-note" id="settings-notify-note">Sign in to choose which alerts you get.</p>'
      : notify.status === 'loading' ? '<p class="social-note" id="settings-notify-note">Loading…</p>' : '';
    panel.innerHTML = `<span class="eyebrow">ACTIVITY BELL</span><h3>Battle notifications</h3><p>Pick what shows up in your Activity bell.</p>${note}<div class="notify-switches">${NOTIFY_TYPES.map(([type, label, help]) => `<label class="notify-switch"><input type="checkbox" data-notify-type="${type}" ${prefs[type] !== false ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span><strong>${escHtml(label)}</strong><small>${escHtml(help)}</small></span></label>`).join('')}</div>${notify.error ? `<p class="social-note" role="alert">${escHtml(notify.error)}</p>` : ''}`;
    panel.querySelectorAll('[data-notify-type]').forEach(box => { box.onchange = () => saveNotifyPref(box.dataset.notifyType, box.checked); });
  }
  async function loadNotifyPrefs(){
    if(!signedIn()){ notify.status = 'signed-out'; renderNotifyPanel(); return null; }
    notify.status = 'loading'; notify.error = ''; renderNotifyPanel();
    const response = await api('/api/notificationPreferences/social');
    if(response.error){ notify.status = needsServer(response) ? 'needs-server' : 'ready'; if(notify.status === 'ready') notify.error = serverMessage(response, 'Could not load your notification settings.'); }
    else { notify.prefs = response.data.prefs || {}; notify.status = 'ready'; }
    renderNotifyPanel();
    return response;
  }
  async function saveNotifyPref(type, enabled){
    const before = { ...(notify.prefs || {}) };
    notify.prefs = { ...before, [type]:enabled };
    const response = await api('/api/notificationPreferences/social', { method:'PUT', body:{ type, enabled } });
    if(response.error){ notify.prefs = before; notify.error = serverMessage(response, 'That setting was not saved.'); }
    else { notify.prefs = response.data.prefs || notify.prefs; notify.error = ''; }
    renderNotifyPanel();
    return response;
  }

  /* ============================== Oct 19b: tournament wins ============================== */
  const wins = { status:'idle', mine:null, champions:null };
  function ensureProfileTournaments(){
    const profile = D.getElementById('profile');
    if(!profile) return null;
    let panel = D.getElementById('profile-tournaments');
    if(!panel){
      panel = D.createElement('section');
      panel.className = 'panel profile-tournaments';
      panel.id = 'profile-tournaments';
      const tabs = profile.querySelector('.profile-tabs');
      profile.insertBefore(panel, tabs || null);
    }
    return panel;
  }
  function championBadgeHtml(count){
    return count ? `<span class="champion-badge" id="profile-champion-badge" title="Tournament champion">🏆 ${count > 1 ? `${escHtml(count)}× ` : ''}Champion</span>` : '';
  }
  function renderProfileTournaments(){
    const panel = ensureProfileTournaments();
    if(!panel) return;
    const data = wins.mine;
    let body;
    if(wins.status === 'needs-server') body = '<p class="social-note">Your tournament results show here once the DJ Battle server is running.</p>';
    else if(wins.status === 'signed-out') body = '<p class="social-note">Sign in to see your tournament results.</p>';
    else if(wins.status === 'loading') body = '<p class="social-note">Loading…</p>';
    else if(!data || !data.tournaments.length) body = '<p class="social-note">No tournaments yet. Join one from the Tournaments page.</p>';
    else body = `<ul class="profile-tournament-list">${data.tournaments.map(t => `<li class="${t.champion ? 'is-champion' : ''}"><span class="placement">${t.champion ? '🏆 ' : ''}${escHtml(t.placement)}</span><span><strong>${escHtml(t.title)}</strong><small>${escHtml(t.capacity)} DJs · ${escHtml(t.status === 'completed' ? 'Finished' : t.status === 'active' ? 'In progress' : 'Sign-up open')}${t.wonByForfeit ? ' · includes a forfeit win' : ''}</small></span><button class="ghost small" type="button" data-profile-tournament="${escHtml(t.id)}">View</button></li>`).join('')}</ul>`;
    panel.innerHTML = `<div class="section-head compact"><div><span class="eyebrow">TOURNAMENTS</span><h3>Tournament results ${championBadgeHtml(data && data.wins)}</h3></div></div>${body}`;
    panel.querySelectorAll('[data-profile-tournament]').forEach(btn => { btn.onclick = () => openTournamentFromAnywhere(btn.dataset.profileTournament); });
  }
  async function loadProfileTournaments(){
    if(!signedIn()){ wins.status = 'signed-out'; renderProfileTournaments(); return null; }
    wins.status = 'loading'; renderProfileTournaments();
    const response = await api('/api/me/tournaments');
    if(response.error) wins.status = needsServer(response) || response.data && response.data.schemaMissing ? 'needs-server' : 'ready';
    else { wins.mine = { tournaments:response.data.tournaments || [], wins:response.data.wins || 0 }; wins.status = 'ready'; }
    renderProfileTournaments();
    return response;
  }
  async function loadChampions(){
    if(wins.champions) return wins.champions;
    const response = await api('/api/tournamentChampions', { public:true });
    wins.champions = response.error ? [] : (response.data.champions || []);
    return wins.champions;
  }
  // Adds a trophy next to the name of every tournament champion in the Rankings list.
  function decorateRankings(){
    const list = wins.champions;
    if(!list){ loadChampions().then(() => decorateRankings()); return; }
    const byId = new Map(list.map(c => [String(c.publicProfileId), c.wins]));
    D.querySelectorAll('[data-ranking-dj]').forEach(row => {
      const n = byId.get(String(row.dataset.rankingDj || ''));
      const title = row.querySelector('.ranking-title strong');
      if(!title || !n || row.querySelector('.ranking-trophy')) return;
      const t = D.createElement('span');
      t.className = 'ranking-trophy';
      t.title = `Won ${n} tournament${n === 1 ? '' : 's'}`;
      t.setAttribute('aria-label', t.title);
      t.textContent = n > 1 ? `🏆×${n}` : '🏆';
      title.after(t);
    });
  }
  async function openTournamentFromAnywhere(id){
    tour.opening = true;
    try{ if(typeof W.switchView === 'function') W.switchView('tournaments'); }finally{ tour.opening = false; }
    ensureTournamentView();
    return openTournament(id);
  }

  /* ============================== wiring ============================== */
  ensureTournamentView();
  const navBtn = D.querySelector('.sidebar .nav-btn[data-view="tournaments"]');
  if(navBtn && !navBtn.dataset.socialWired){ navBtn.dataset.socialWired = '1'; }
  function onView(view){
    if(view === 'tournaments' && !tour.opening){ tour.current = null; loadTournaments(); }
    if(view === 'settings'){ renderThemePanel(); loadNotifyPrefs(); }
    if(view === 'profile') loadProfileTournaments();
    if(view === 'rankings') decorateRankings();
    if(view === 'battle-room' && chat.battleId && chat.status === 'ready'){ loadChat(); startChatPolling(); }
    if(view !== 'battle-room') stopChatPolling();
  }
  if(typeof W.viewFromHash === 'function' && W.viewFromHash() === 'tournaments' && typeof W.switchView === 'function') W.switchView('tournaments', { fromHistory:true });
  renderThemePanel();
  // Links back from the embed player: index.html?result=vr_... or index.html?beat=<listing id>.
  (function openEmbedDeepLink(){
    let params;
    try{ params = new URLSearchParams(W.location.search); }catch(e){ return; }
    const result = params.get('result');
    const beat = params.get('beat');
    if(result && /^vr_[a-z0-9]+$/i.test(result) && typeof W.loadPublicVerifiedResult === 'function'){
      if(typeof W.switchView === 'function') W.switchView('verified-results', { fromHistory:true });
      W.loadPublicVerifiedResult(result);
    }else if(beat && typeof W.switchView === 'function') W.switchView('store', { fromHistory:true });
  })();

  W.DJBSocial = {
    onBattleRoom, onPublicResult, onView, decorateBeatStore, renderThemePanel,
    themePref, setThemePref, applyTheme, resolvedTheme,
    loadChat, sendChat, renderChat, chatState:() => chat, stopChatPolling, unsendChat, unreadChatCount, markChatSeen, renderChatButton,
    countdownText, openEditTournament, openRemoveDj, removeDj, cancelTournamentFlow, openTournamentFromAnywhere,
    loadNotifyPrefs, saveNotifyPref, notifyState:() => notify, renderNotifyPanel,
    loadProfileTournaments, renderProfileTournaments, decorateRankings, loadChampions, winsState:() => wins,
    loadTournaments, openTournament, openCreateTournament, tournamentAction, playMatch, tournamentState:() => tour,
    loadTimed, addTimed, deleteTimed, seekTo, timedState:() => timed, openTimedForm,
    embedUrl, embedSnippet, openBeatEmbed, fmtTime
  };
})();
