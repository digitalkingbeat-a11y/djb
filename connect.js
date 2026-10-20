// Oct 19c: direct messages, Find DJs, watch battles live, shared crate tracklists and weekly
// practice goals. Loaded after app.js and social.js; only uses their global functions.
// Every piece of user text goes through esc() or textContent, never raw HTML.
(function(){
  'use strict';
  const W = window;
  const D = document;
  const esc = s => (typeof W.esc === 'function' ? W.esc(s) : String(s == null ? '' : s).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c])));
  const hasApi = () => Boolean(W.DJBattleApi && typeof W.DJBattleApi.apiRequest === 'function');
  const api = (path, opts) => hasApi() ? W.DJBattleApi.apiRequest(path, opts) : Promise.resolve({ error:'The server is not connected', status:0 });
  const signedIn = () => typeof W.djbSignedIn === 'function' && W.djbSignedIn();
  const needsServer = r => !r || r.status === 0 || r.status === 404 && !r.data || r.status === 502 || (r.status === 503 && !(r.data && r.data.schemaMissing));
  const schemaMissing = r => r && r.status === 503 && r.data && r.data.schemaMissing;
  const errText = (r, fallback) => (r && r.data && r.data.error) || (r && typeof r.error === 'string' && r.error) || fallback;
  const isJsdom = () => typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '');
  const store = { get(k, d){ try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } }, set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} } };
  const timeLabel = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }); };
  const REPORT_REASONS = [['harassment', 'Harassment'], ['spam', 'Spam'], ['unsafe_content', 'Unsafe content'], ['other', 'Something else']];
  const BELTS = ['White', 'Yellow', 'Orange', 'Green', 'Blue', 'Purple', 'Brown', 'Red', 'Black'];
  const isActive = id => { const el = D.getElementById(id); return Boolean(el && el.classList.contains('active')); };
  const go = view => { if(typeof W.switchView === 'function') W.switchView(view); };
  function ensureView(id, html){
    let section = D.getElementById(id);
    if(section) return section;
    const main = D.querySelector('.main');
    if(!main) return null;
    section = D.createElement('section');
    section.id = id;
    section.className = 'view';
    section.innerHTML = html;
    main.insertBefore(section, D.getElementById('operations') || null);
    return section;
  }
  function setupNote(r, what){
    if(schemaMissing(r)) return `${what} needs one setup step: run server/sql/${esc(r.data.schema)}.sql in Supabase.`;
    if(needsServer(r)) return `${what} needs the DJ Battle server. It turns on once your server is running.`;
    return esc(errText(r, `${what} could not load.`));
  }

  /* ============================== 1. Direct messages ============================== */
  const DM_POLL_MS = 5000;
  const dm = { status:'idle', conversations:[], unread:0, current:null, thread:null, error:'', timer:null };
  function ensureMessagesView(){
    return ensureView('messages', `<div class="product-page-head"><div><span class="eyebrow accent">MESSAGES</span><h2>Messages</h2><p>One-on-one chats with other DJs. Set up a battle or talk beats. Blocked DJs can't message you, and muted DJs don't ping your bell.</p></div><div><button class="ghost compact" type="button" id="dm-find">Find a DJ to message</button></div></div><div class="social-note" id="dm-status" aria-live="polite"></div><div class="dm-layout" id="dm-layout"><aside class="panel dm-list" id="dm-list" aria-label="Conversations"></aside><section class="panel dm-thread" id="dm-thread" aria-label="Conversation"></section></div>`);
  }
  function renderConversations(){
    const view = ensureMessagesView();
    if(!view) return;
    view.querySelector('#dm-find').onclick = () => go('find-djs');
    const status = D.getElementById('dm-status');
    const list = D.getElementById('dm-list');
    D.getElementById('dm-layout').classList.toggle('has-thread', Boolean(dm.current));
    status.innerHTML = dm.status === 'signed-out' ? 'Sign in to send and read messages.' : dm.error ? dm.error : '';
    if(!dm.conversations.length){
      list.innerHTML = `<p class="dm-empty">${dm.status === 'loading' ? 'Loading…' : 'No conversations yet. Open a DJ from Find DJs and tap Message.'}</p>`;
    }else{
      list.innerHTML = `<ul>${dm.conversations.map(c => `<li><button type="button" class="dm-convo${dm.current === c.with.publicProfileId ? ' active' : ''}" data-dm-open="${esc(c.with.publicProfileId)}"><span class="avatar small">${esc((c.with.displayName || 'DJ').slice(0, 2).toUpperCase())}</span><span class="dm-convo-text"><strong>${esc(c.with.displayName)}</strong><small>${c.lastMessage.mine ? 'You: ' : ''}${esc(c.lastMessage.body.slice(0, 60))}</small></span>${c.unread ? `<span class="dm-unread" aria-label="${c.unread} unread">${c.unread}</span>` : ''}${c.muted ? '<span class="dm-muted" title="Muted">🔕</span>' : ''}</button></li>`).join('')}</ul>`;
      list.querySelectorAll('[data-dm-open]').forEach(b => { b.onclick = () => openConversation(b.dataset.dmOpen); });
    }
    renderThread();
    renderNavBadge();
  }
  function renderThread(){
    const box = D.getElementById('dm-thread');
    if(!box) return;
    const t = dm.thread;
    if(!dm.current || !t){
      box.innerHTML = `<p class="dm-empty">${dm.current ? 'Loading conversation…' : 'Pick a conversation.'}</p>`;
      return;
    }
    const draft = (D.getElementById('dm-input') || {}).value || '';
    box.innerHTML = `<div class="dm-thread-head"><button class="ghost small dm-back" type="button" id="dm-back">← All</button><strong>${esc(t.with.displayName)}</strong>${t.with.belt ? `<span class="belt-badge">${esc(t.with.belt)}</span>` : ''}<span class="dm-thread-actions"><button class="ghost small" type="button" id="dm-mute">${t.muted ? 'Muted' : 'Mute'}</button><button class="ghost small danger" type="button" id="dm-block">${t.blocked ? 'Blocked' : 'Block'}</button></span></div>
      <ul class="dm-messages" id="dm-messages" aria-live="polite"></ul>
      <p class="social-note" id="dm-thread-error" role="alert">${esc(t.error || '')}</p>
      ${t.canSend ? `<form class="dm-form" id="dm-form"><input id="dm-input" type="text" maxlength="${t.maxLength || 1000}" autocomplete="off" placeholder="Message ${esc(t.with.displayName)}" aria-label="Message"><button class="primary small" type="submit">Send</button></form>` : `<p class="dm-empty">You can't message this DJ${t.blocked ? ' because one of you has blocked the other' : ''}.</p>`}`;
    const ul = D.getElementById('dm-messages');
    if(!t.messages.length) ul.innerHTML = '<li class="dm-empty">No messages yet. Say hi!</li>';
    t.messages.forEach(m => {
      const li = D.createElement('li');
      li.className = `dm-msg${m.mine ? ' mine' : ''}`;
      li.dataset.dmMsg = m.id;
      const p = D.createElement('p'); p.textContent = m.body;
      const small = D.createElement('small'); small.textContent = timeLabel(m.createdAt);
      li.append(p, small);
      const act = D.createElement('button');
      act.type = 'button'; act.className = 'text-btn small';
      if(m.mine){ act.textContent = 'Unsend'; act.dataset.dmUnsend = m.id; act.onclick = () => unsendMessage(m.id); }
      else{ act.textContent = 'Report'; act.dataset.dmReport = m.id; act.onclick = () => reportMessage(li, m.id); }
      li.appendChild(act);
      ul.appendChild(li);
    });
    ul.scrollTop = ul.scrollHeight;
    D.getElementById('dm-back').onclick = () => { dm.current = null; dm.thread = null; stopDmPolling(); renderConversations(); };
    D.getElementById('dm-mute').onclick = () => muteCurrent();
    D.getElementById('dm-block').onclick = () => blockCurrent();
    const form = D.getElementById('dm-form');
    if(form){
      const input = D.getElementById('dm-input');
      input.value = draft;
      form.onsubmit = e => { e.preventDefault(); sendMessage(input.value); };
    }
  }
  function renderNavBadge(){
    D.querySelectorAll('.nav-btn[data-view="messages"]').forEach(btn => {
      let pill = btn.querySelector('.dm-nav-count');
      if(!pill){ pill = D.createElement('span'); pill.className = 'dm-nav-count'; btn.appendChild(pill); }
      pill.textContent = dm.unread > 99 ? '99+' : String(dm.unread);
      pill.hidden = !dm.unread;
      pill.setAttribute('aria-label', `${dm.unread} unread messages`);
    });
  }
  async function loadConversations(){
    ensureMessagesView();
    if(!signedIn()){ dm.status = 'signed-out'; dm.conversations = []; renderConversations(); return { skipped:true }; }
    dm.status = 'loading'; dm.error = '';
    renderConversations();
    const r = await api('/api/messages');
    if(r.error || !r.data){ dm.status = 'error'; dm.error = setupNote(r, 'Messages'); renderConversations(); return r; }
    dm.status = 'ready'; dm.conversations = r.data.conversations || []; dm.unread = Number(r.data.unread) || 0;
    renderConversations();
    return r;
  }
  async function openConversation(publicProfileId, options = {}){
    if(!publicProfileId) return { skipped:true };
    if(options.switchView !== false && !isActive('messages')){ dm.opening = true; try{ go('messages'); }finally{ dm.opening = false; } }
    ensureMessagesView();
    if(!signedIn()){ dm.status = 'signed-out'; renderConversations(); return { skipped:true }; }
    if(dm.current !== publicProfileId) dm.thread = null;
    dm.current = publicProfileId;
    renderConversations();
    const r = await refreshThread();
    startDmPolling();
    if(!dm.conversations.length) loadConversations();
    return r;
  }
  async function refreshThread(){
    const id = dm.current;
    if(!id) return { skipped:true };
    const r = await api(`/api/messages/${encodeURIComponent(id)}`);
    if(dm.current !== id) return r;
    if(r.error || !r.data){ dm.thread = { with:{ displayName:(dm.thread && dm.thread.with.displayName) || 'DJ', publicProfileId:id }, messages:[], canSend:false, error:setupNote(r, 'Messages') }; renderThread(); return r; }
    const before = dm.thread && JSON.stringify(dm.thread.messages);
    dm.thread = { ...r.data, error:'' };
    const c = dm.conversations.find(x => x.with.publicProfileId === id);
    if(c && c.unread){ dm.unread = Math.max(0, dm.unread - c.unread); c.unread = 0; renderConversations(); }
    else if(before !== JSON.stringify(dm.thread.messages)) renderThread();
    return r;
  }
  function startDmPolling(){ stopDmPolling(); if(isJsdom()) return; dm.timer = setInterval(() => { if(!D.hidden) refreshThread(); }, DM_POLL_MS); }
  function stopDmPolling(){ if(dm.timer){ clearInterval(dm.timer); dm.timer = null; } }
  async function sendMessage(text){
    const body = String(text || '').trim();
    if(!body || !dm.current || !dm.thread) return { skipped:true };
    const r = await api(`/api/messages/${encodeURIComponent(dm.current)}`, { method:'POST', body:{ body } });
    if(r.error || !r.data){
      dm.thread.error = errText(r, 'Message not sent.');
      if(r.data && r.data.blocked) dm.thread.canSend = false;
      renderThread();
      return r;
    }
    const input = D.getElementById('dm-input'); if(input) input.value = '';
    dm.thread.messages = dm.thread.messages.concat(r.data.message);
    dm.thread.error = '';
    const c = dm.conversations.find(x => x.with.publicProfileId === dm.current);
    if(c) c.lastMessage = r.data.message;
    else dm.conversations.unshift({ with:dm.thread.with, lastMessage:r.data.message, unread:0, muted:false });
    renderConversations();
    return r;
  }
  async function unsendMessage(id){
    const r = await api(`/api/messages/item/${encodeURIComponent(id)}`, { method:'DELETE' });
    if(!r.error && dm.thread){ dm.thread.messages = dm.thread.messages.filter(m => m.id !== id); renderThread(); }
    else if(dm.thread){ dm.thread.error = errText(r, 'Could not unsend.'); renderThread(); }
    return r;
  }
  function reportMessage(li, id){
    if(li.querySelector('.inline-report')) return;
    const box = D.createElement('div');
    box.className = 'inline-report';
    box.innerHTML = `<label class="social-note">Why? <select aria-label="Report reason">${REPORT_REASONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label><button class="ghost small" type="button" data-send>Send report</button><button class="ghost small" type="button" data-cancel>Cancel</button>`;
    li.appendChild(box);
    box.querySelector('[data-cancel]').onclick = () => box.remove();
    box.querySelector('[data-send]').onclick = async () => {
      const r = await api('/api/community/reports', { method:'POST', body:{ targetType:'direct_message', targetId:id, reason:box.querySelector('select').value } });
      box.innerHTML = `<span class="social-note" role="status">${r.error ? esc(errText(r, 'Report could not be sent.')) : 'Thanks, a moderator will take a look.'}</span>`;
    };
  }
  async function muteCurrent(){
    const t = dm.thread; if(!t || t.muted) return { skipped:true };
    const r = await api('/api/notificationMutes', { method:'POST', body:{ mutedPublicProfileId:t.with.publicProfileId, category:'all', idempotencyKey:`dm-mute-${t.with.publicProfileId}` } });
    if(r.error){ t.error = errText(r, 'Could not mute.'); } else { t.muted = true; t.error = 'Muted. Their messages still arrive, but your bell stays quiet. Undo in Settings → Blocked & muted.'; }
    renderThread();
    return r;
  }
  async function blockCurrent(){
    const t = dm.thread; if(!t || t.blocked) return { skipped:true };
    const ok = typeof W.appConfirmDanger === 'function' ? await W.appConfirmDanger('Block this DJ?', 'They can\'t message, challenge or follow you, and this conversation is hidden for both of you. You can undo this in Settings.', 'Block DJ') : W.confirm('Block this DJ?');
    if(!ok) return { cancelled:true };
    const r = await api('/api/blocks', { method:'POST', body:{ blockedPublicProfileId:t.with.publicProfileId, idempotencyKey:`dm-block-${t.with.publicProfileId}` } });
    if(r.error){ t.error = errText(r, 'Could not block.'); renderThread(); return r; }
    dm.conversations = dm.conversations.filter(c => c.with.publicProfileId !== t.with.publicProfileId);
    Object.assign(t, { blocked:true, canSend:false, messages:[], error:'Blocked. You won\'t see each other\'s messages.' });
    renderConversations();
    return r;
  }

  /* ============================== 2. Find DJs ============================== */
  const find = { status:'idle', results:[], error:'', query:{ q:'', city:'', genre:'', belt:'' }, following:{} };
  function ensureFindView(){
    return ensureView('find-djs', `<div class="product-page-head"><div><span class="eyebrow accent">FIND DJS</span><h2>Find DJs</h2><p>Search by name, city, genre or belt. Follow DJs you like, or challenge them to a battle.</p></div></div>
      <form class="panel find-form" id="find-form" role="search"><label>Name<input id="find-q" type="search" maxlength="60" placeholder="DJ name"></label><label>City<input id="find-city" type="text" maxlength="60" placeholder="e.g. Atlanta"></label><label>Genre<input id="find-genre" type="text" maxlength="60" placeholder="e.g. House"></label><label>Belt<select id="find-belt"><option value="">Any belt</option>${BELTS.map(b => `<option>${b}</option>`).join('')}</select></label><button class="primary" type="submit">Search</button></form>
      <div class="social-note" id="find-status" aria-live="polite"></div><div class="find-results" id="find-results"></div>
      <section class="panel find-me" id="find-me"><span class="eyebrow">YOUR LISTING</span><h3>How other DJs find you</h3><p>Add your city and main genre so people nearby can find you. Turn search off any time.</p><div class="find-me-grid"><label>City<input id="find-me-city" maxlength="60" placeholder="e.g. Atlanta, GA"></label><label>Main genre<input id="find-me-genre" maxlength="40" placeholder="e.g. Hip-Hop"></label><label class="find-me-toggle"><input type="checkbox" id="find-me-searchable" checked> Show me in Find DJs</label><button class="ghost small" type="button" id="find-me-save">Save</button></div><small class="social-note" id="find-me-status" aria-live="polite"></small></section>`);
  }
  function wireFindView(){
    const view = ensureFindView();
    if(!view || view.dataset.wired) return;
    view.dataset.wired = '1';
    view.querySelector('#find-form').onsubmit = e => {
      e.preventDefault();
      searchDjs({ q:view.querySelector('#find-q').value, city:view.querySelector('#find-city').value, genre:view.querySelector('#find-genre').value, belt:view.querySelector('#find-belt').value });
    };
    view.querySelector('#find-me-save').onclick = () => saveListing({ hometown:view.querySelector('#find-me-city').value, genre:view.querySelector('#find-me-genre').value, searchable:view.querySelector('#find-me-searchable').checked });
    const user = typeof W.currentUser === 'function' ? W.currentUser() : null;
    if(user && user.hometown) view.querySelector('#find-me-city').value = user.hometown;
  }
  function renderFind(){
    wireFindView();
    const status = D.getElementById('find-status');
    const box = D.getElementById('find-results');
    if(!box) return;
    status.innerHTML = find.status === 'loading' ? 'Searching…' : find.error || (find.status === 'ready' ? `${find.results.length} DJ${find.results.length === 1 ? '' : 's'} found` : '');
    if(find.status === 'ready' && !find.results.length){ box.innerHTML = '<p class="dm-empty">No DJs match. Try fewer filters.</p>'; return; }
    box.innerHTML = find.results.map(dj => {
      const following = Boolean(find.following[dj.publicProfileId]);
      return `<article class="panel find-card" data-find-dj="${esc(dj.publicProfileId)}"><div class="find-card-top"><span class="avatar">${esc((dj.displayName || 'DJ').slice(0, 2).toUpperCase())}</span><div><strong>${esc(dj.displayName)}</strong><small>${esc([dj.city, dj.genre].filter(Boolean).join(' · ') || 'No city or genre yet')}</small></div><span class="belt-badge">${esc(dj.belt)}</span></div><small class="find-card-wins">${dj.wins} win${dj.wins === 1 ? '' : 's'}</small><div class="find-card-actions"><button class="ghost small${following ? ' active' : ''}" type="button" data-find-follow="${esc(dj.publicProfileId)}">${following ? 'Following' : 'Follow'}</button><button class="primary small" type="button" data-find-challenge="${esc(dj.publicProfileId)}">Challenge</button><button class="ghost small" type="button" data-find-message="${esc(dj.publicProfileId)}">Message</button></div></article>`;
    }).join('');
    box.querySelectorAll('[data-find-follow]').forEach(b => { b.onclick = () => followDj(b.dataset.findFollow); });
    box.querySelectorAll('[data-find-challenge]').forEach(b => { b.onclick = () => challengeDj(b.dataset.findChallenge); });
    box.querySelectorAll('[data-find-message]').forEach(b => { b.onclick = () => openConversation(b.dataset.findMessage); });
  }
  async function searchDjs(query = {}){
    find.query = { ...find.query, ...query };
    const params = new URLSearchParams();
    Object.entries(find.query).forEach(([k, v]) => { if(String(v || '').trim()) params.set(k, String(v).trim()); });
    find.status = 'loading'; find.error = '';
    renderFind();
    const r = await api(`/api/djs/search${params.toString() ? `?${params}` : ''}`, { public:!signedIn() });
    if(r.error || !r.data){ find.status = 'error'; find.results = []; find.error = setupNote(r, 'Find DJs'); renderFind(); return r; }
    find.status = 'ready'; find.results = r.data.results || [];
    renderFind();
    return r;
  }
  const cardProfile = id => { const dj = find.results.find(x => x.publicProfileId === id) || { publicProfileId:id, displayName:'DJ' }; return { publicProfileId:dj.publicProfileId, displayName:dj.displayName, name:dj.displayName, belt:dj.belt, country:dj.city, profileVisibility:'public' }; };
  async function followDj(id){
    if(!signedIn()){ find.error = 'Sign in to follow DJs.'; renderFind(); return { skipped:true }; }
    const was = Boolean(find.following[id]);
    const r = typeof W.togglePublicProfileFollow === 'function'
      ? await W.togglePublicProfileFollow({ ...cardProfile(id), following:was })
      : await api(`/api/relationships/${encodeURIComponent(id)}/follow`, { method:was ? 'DELETE' : 'POST', body:{ idempotencyKey:`find-${was ? 'unfollow' : 'follow'}-${id}` } });
    if(r && r.error){ find.error = esc(errText(r, 'Follow failed.')); } else find.following[id] = !was;
    renderFind();
    return r;
  }
  async function challengeDj(id){
    if(typeof W.openProtectedChallengeSetupFromPublicId === 'function') return W.openProtectedChallengeSetupFromPublicId(id, 'find_djs');
    return { skipped:true };
  }
  async function saveListing(input){
    const status = D.getElementById('find-me-status');
    if(!signedIn()){ if(status) status.textContent = 'Sign in to list yourself.'; return { skipped:true }; }
    const r = await api('/api/me/searchProfile', { method:'PUT', body:input });
    if(status) status.innerHTML = r.error ? setupNote(r, 'Your listing') : input.searchable === false ? 'Saved. You\'re hidden from Find DJs.' : 'Saved. Other DJs can find you now.';
    return r;
  }

  /* ============================== 3. Watch battles live ============================== */
  const WATCH_POLL_MS = 5000;
  const WATCH_BEAT_MS = 20000;
  const watch = { status:'idle', list:[], current:null, data:null, error:'', timer:null, beat:null, voted:null };
  function viewerKey(){
    let k = store.get('djbViewerKey', null);
    if(!k || !/^[a-z0-9]{8,40}$/.test(k)){ k = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); store.set('djbViewerKey', k); }
    return k;
  }
  function ensureWatchView(){
    return ensureView('watch', `<div class="product-page-head"><div><span class="eyebrow accent">WATCH LIVE</span><h2>Watch battles live</h2><p>Follow a battle while it happens: see each DJ's status and read the battle chat. Crowd voting opens the moment it ends.</p></div><div><button class="ghost compact" type="button" id="watch-refresh">Refresh</button></div></div><div class="social-note" id="watch-status" aria-live="polite"></div><div id="watch-detail"></div><div class="watch-list" id="watch-list"></div>`);
  }
  function renderWatch(){
    const view = ensureWatchView();
    if(!view) return;
    view.querySelector('#watch-refresh').onclick = () => watch.current ? refreshLive() : loadLiveBattles();
    D.getElementById('watch-status').innerHTML = watch.error || '';
    const list = D.getElementById('watch-list');
    const detail = D.getElementById('watch-detail');
    if(watch.current && watch.data){
      list.innerHTML = '';
      const b = watch.data.battle;
      const live = b.status === 'live';
      detail.innerHTML = `<section class="panel watch-room" data-watch-battle="${esc(b.id)}"><div class="watch-head"><button class="ghost small" type="button" id="watch-back">← All live battles</button><span class="watch-live-pill ${live ? 'on' : ''}">${live ? '● LIVE' : b.status === 'finished' ? 'FINISHED' : 'ENDED'}</span><span class="watch-count" id="watch-count">👀 Watching: ${Number(watch.data.watching) || 0}</span></div><h3>${esc(b.title)}</h3><small class="social-note">${esc(b.genre || '')}</small>
        <div class="watch-djs">${watch.data.djs.map(dj => `<div class="watch-dj"><span class="avatar">${esc((dj.displayName || 'DJ').slice(0, 2).toUpperCase())}</span><strong>${esc(dj.displayName)}</strong><small class="watch-dj-status" data-dj-status>${esc(dj.status)}</small>${watch.data.votingOpen && dj.canVoteFor && dj.publicProfileId && !watch.data.viewerIsDj ? `<button class="primary small" type="button" data-watch-vote="${esc(dj.publicProfileId)}">${watch.voted === dj.publicProfileId ? 'Voted ✓' : 'Vote'}</button>` : ''}</div>`).join('')}</div>
        ${watch.data.votingOpen ? `<p class="watch-vote-note" id="watch-vote-note">${watch.data.viewerIsDj ? 'Crowd voting is open. DJs in the battle can\'t vote.' : signedIn() ? 'The battle is over. Crowd voting is open: pick who won.' : 'The battle is over. Sign in to vote for who won.'}</p>` : '<p class="watch-vote-note">Crowd voting opens when the battle ends.</p>'}
        <div class="watch-chat"><span class="eyebrow">BATTLE CHAT · READ-ONLY</span><ul class="battle-chat-list" id="watch-chat"></ul></div></section>`;
      const ul = D.getElementById('watch-chat');
      if(!watch.data.chat.length) ul.innerHTML = '<li class="battle-chat-empty">No chat messages yet.</li>';
      watch.data.chat.forEach(m => {
        const li = D.createElement('li'); li.className = 'battle-chat-msg';
        const who = D.createElement('small'); who.textContent = `${m.author.displayName} · ${timeLabel(m.createdAt)}`;
        const p = D.createElement('p'); p.textContent = m.body;
        li.append(who, p); ul.appendChild(li);
      });
      D.getElementById('watch-back').onclick = () => closeLive();
      detail.querySelectorAll('[data-watch-vote]').forEach(btn => { btn.onclick = () => crowdVote(btn.dataset.watchVote); });
      return;
    }
    detail.innerHTML = '';
    if(watch.status === 'loading'){ list.innerHTML = '<p class="dm-empty">Loading live battles…</p>'; return; }
    list.innerHTML = watch.list.length ? watch.list.map(b => `<button class="panel watch-card" type="button" data-watch-open="${esc(b.id)}"><span class="watch-live-pill on">● LIVE</span><strong>${esc(b.title)}</strong><small>${esc(b.genre || '')} · 👀 ${Number(b.watching) || 0} watching</small></button>`).join('') : (watch.status === 'ready' ? '<p class="dm-empty">No battles are live right now. Check back soon.</p>' : '');
    list.querySelectorAll('[data-watch-open]').forEach(b => { b.onclick = () => openLive(b.dataset.watchOpen); });
  }
  async function loadLiveBattles(){
    watch.current = null; watch.data = null; stopWatchTimers();
    watch.status = 'loading'; watch.error = '';
    renderWatch();
    const r = await api('/api/liveBattles', { public:true });
    if(r.error || !r.data){ watch.status = 'error'; watch.list = []; watch.error = setupNote(r, 'Watching live'); renderWatch(); return r; }
    watch.status = 'ready'; watch.list = r.data.battles || [];
    renderWatch();
    return r;
  }
  async function openLive(battleId){
    if(!battleId) return { skipped:true };
    if(!isActive('watch')){ watch.opening = true; try{ go('watch'); }finally{ watch.opening = false; } }
    ensureWatchView();
    watch.current = battleId; watch.data = null; watch.voted = null; watch.error = '';
    await sendHeartbeat();
    const r = await refreshLive();
    startWatchTimers();
    return r;
  }
  async function refreshLive(){
    const id = watch.current;
    if(!id) return { skipped:true };
    const r = await api(`/api/battles/${encodeURIComponent(id)}/live`, { public:!signedIn() });
    if(watch.current !== id) return r;
    if(r.error || !r.data){ watch.error = setupNote(r, 'This battle'); watch.data = null; renderWatch(); return r; }
    watch.data = r.data; watch.error = '';
    if(r.data.battle.status !== 'live') stopWatchTimers();
    renderWatch();
    return r;
  }
  async function sendHeartbeat(){
    if(!watch.current) return null;
    const r = await api(`/api/battles/${encodeURIComponent(watch.current)}/watch`, { method:'POST', body:{ viewerKey:viewerKey() }, public:true });
    if(r && r.data && watch.data){ watch.data.watching = r.data.watching; const el = D.getElementById('watch-count'); if(el) el.textContent = `👀 Watching: ${r.data.watching}`; }
    return r;
  }
  function startWatchTimers(){
    stopWatchTimers();
    if(isJsdom() || !watch.data || watch.data.battle.status !== 'live') return;
    watch.timer = setInterval(() => { if(!D.hidden) refreshLive(); }, WATCH_POLL_MS);
    watch.beat = setInterval(() => { if(!D.hidden) sendHeartbeat(); }, WATCH_BEAT_MS);
  }
  function stopWatchTimers(){ if(watch.timer) clearInterval(watch.timer); if(watch.beat) clearInterval(watch.beat); watch.timer = watch.beat = null; }
  function closeLive(){ stopWatchTimers(); watch.current = null; watch.data = null; loadLiveBattles(); }
  async function crowdVote(publicProfileId){
    if(!signedIn()){ watch.error = 'Sign in to vote.'; renderWatch(); return { skipped:true }; }
    const r = await api(`/api/battles/${encodeURIComponent(watch.current)}/live/vote`, { method:'POST', body:{ publicProfileId } });
    if(r.error){ watch.error = esc(errText(r, 'Vote failed.')); } else { watch.voted = publicProfileId; watch.error = r.data && r.data.duplicate ? 'You already voted on this battle.' : 'Thanks for voting!'; }
    renderWatch();
    return r;
  }

  /* ============================== 4. Shared crate tracklists ============================== */
  const TOFIND_KEY = 'djbToFindLists';
  const share = { lastLink:'', error:'', viewing:null };
  const appState = () => { try{ return typeof state !== 'undefined' ? state : null; }catch(e){ return null; } }; // eslint-disable-line no-undef
  function shareableCrates(){
    if(typeof W.allLibraryCrates !== 'function') return [];
    return W.allLibraryCrates().filter(c => c && !c.builtIn);
  }
  function crateTracklist(crate){
    const hooks = W.__DJBattleTestHooks || {};
    const s = appState();
    const ids = typeof W.resolveCrateTrackIds === 'function' ? W.resolveCrateTrackIds(crate) : [];
    const lib = (typeof hooks.getLibraryTracksState === 'function' && hooks.getLibraryTracksState()) || (s && s.library) || [];
    return ids.map(id => lib.find(t => String(t.id) === String(id))).filter(Boolean)
      .map(t => ({ title:t.title || t.name || '', artist:t.artist || null, bpm:Number(t.bpm) || null, key:t.camelotKey || t.key || null }))
      .filter(t => t.title);
  }
  const shareUrl = id => { try{ const u = new URL(W.location.href); u.search = `?tracklist=${encodeURIComponent(id)}`; u.hash = ''; return u.toString(); }catch(e){ return `?tracklist=${id}`; } };
  function renderSharePanel(){
    const lib = D.getElementById('library');
    if(!lib) return;
    let panel = D.getElementById('crate-share-panel');
    if(!panel){ panel = D.createElement('section'); panel.className = 'panel crate-share-panel'; panel.id = 'crate-share-panel'; lib.appendChild(panel); }
    const crates = shareableCrates();
    panel.innerHTML = `<span class="eyebrow">SHARE</span><h3>Share a crate as a tracklist</h3><p>Other DJs see each track's name, artist, BPM and key. Your audio files are never shared.</p>${crates.length ? `<div class="crate-share-row"><select id="crate-share-select" aria-label="Crate to share">${crates.map(c => `<option value="${esc(c.crateId || c.id)}">${esc(c.name)} (${crateTracklist(c).length})</option>`).join('')}</select><button class="primary small" type="button" id="crate-share-go">Get share link</button></div>` : '<p class="dm-empty">Make a crate first, then share it here.</p>'}<div id="crate-share-result" aria-live="polite">${share.lastLink ? `<div class="crate-share-link"><input readonly id="crate-share-url" value="${esc(share.lastLink)}" aria-label="Share link"><button class="ghost small" type="button" id="crate-share-copy">Copy link</button></div>` : ''}${share.error ? `<p class="social-note">${share.error}</p>` : ''}</div>${renderToFind()}`;
    const goBtn = D.getElementById('crate-share-go');
    if(goBtn) goBtn.onclick = () => shareCrate(D.getElementById('crate-share-select').value);
    const copy = D.getElementById('crate-share-copy');
    if(copy) copy.onclick = () => { try{ navigator.clipboard.writeText(share.lastLink); copy.textContent = 'Copied'; }catch(e){ D.getElementById('crate-share-url').select(); } };
    panel.querySelectorAll('[data-tofind-remove]').forEach(b => { b.onclick = () => { removeToFind(b.dataset.tofindRemove); renderSharePanel(); }; });
    panel.querySelectorAll('[data-tofind-toggle]').forEach(b => { b.onchange = () => { toggleToFind(b.dataset.tofindToggle, Number(b.dataset.index), b.checked); }; });
  }
  async function shareCrate(crateId){
    const crate = typeof W.getLibraryCrateById === 'function' ? W.getLibraryCrateById(crateId) : null;
    if(!crate) return { skipped:true };
    share.error = ''; share.lastLink = '';
    const tracks = crateTracklist(crate);
    if(!tracks.length){ share.error = 'This crate has no tracks yet.'; renderSharePanel(); return { skipped:true }; }
    if(!signedIn()){ share.error = 'Sign in to share a tracklist.'; renderSharePanel(); return { skipped:true }; }
    const r = await api('/api/sharedCrates', { method:'POST', body:{ name:crate.name, crateId:String(crate.crateId || crate.id), tracks } });
    if(r.error || !r.data){ share.error = setupNote(r, 'Sharing'); renderSharePanel(); return r; }
    share.lastLink = shareUrl(r.data.tracklist.id);
    renderSharePanel();
    return r;
  }
  function toFindLists(){ const v = store.get(TOFIND_KEY, []); return Array.isArray(v) ? v : []; }
  function renderToFind(){
    const lists = toFindLists();
    if(!lists.length) return '';
    return `<div class="tofind" id="tofind-lists"><span class="eyebrow">TO FIND</span><p class="social-note">Tracklists you copied. Tick a track once you have it in your library.</p>${lists.map(l => `<details class="tofind-list" open><summary><strong>${esc(l.name)}</strong> <small>from ${esc(l.from || 'a DJ')} · ${l.tracks.filter(t => t.found).length}/${l.tracks.length} found</small> <button class="text-btn small" type="button" data-tofind-remove="${esc(l.id)}">Remove</button></summary><ol>${l.tracks.map((t, i) => `<li><label><input type="checkbox" data-tofind-toggle="${esc(l.id)}" data-index="${i}"${t.found ? ' checked' : ''}> ${esc(t.title)}${t.artist ? ` <small>— ${esc(t.artist)}</small>` : ''} <small class="tofind-meta">${t.bpm ? `${esc(t.bpm)} BPM` : ''}${t.key ? ` · ${esc(t.key)}` : ''}</small></label></li>`).join('')}</ol></details>`).join('')}</div>`;
  }
  function copyToFind(tracklist){
    const lists = toFindLists().filter(l => l.id !== tracklist.id);
    lists.unshift({ id:tracklist.id, name:tracklist.name, from:tracklist.owner && tracklist.owner.displayName, savedAt:new Date().toISOString(), tracks:tracklist.tracks.map(t => ({ title:String(t.title || ''), artist:t.artist || null, bpm:t.bpm || null, key:t.key || null, found:false })) });
    store.set(TOFIND_KEY, lists.slice(0, 50));
    return lists[0];
  }
  function removeToFind(id){ store.set(TOFIND_KEY, toFindLists().filter(l => l.id !== id)); }
  function toggleToFind(id, index, found){ const lists = toFindLists(); const l = lists.find(x => x.id === id); if(l && l.tracks[index]){ l.tracks[index].found = Boolean(found); store.set(TOFIND_KEY, lists); } }
  async function openSharedTracklist(id){
    const r = await api(`/api/sharedCrates/${encodeURIComponent(id)}`, { public:!signedIn() });
    if(r.error || !r.data){
      if(typeof W.openModal === 'function') W.openModal(`<span class="eyebrow accent">TRACKLIST</span><h3>Tracklist unavailable</h3><p class="social-note">${setupNote(r, 'This tracklist')}</p><div class="modal-actions"><button class="ghost" value="cancel">Close</button></div>`);
      return r;
    }
    const t = r.data.tracklist;
    share.viewing = t;
    if(typeof W.openModal === 'function') W.openModal(`<span class="eyebrow accent">SHARED TRACKLIST</span><h3 id="tracklist-title"></h3><p class="social-note" id="tracklist-owner"></p><div class="tracklist-table-wrap"><table class="tracklist-table"><thead><tr><th>#</th><th>Track</th><th class="tl-col">BPM</th><th class="tl-col">Key</th></tr></thead><tbody id="tracklist-rows"></tbody></table></div><p class="social-note">Names, BPMs and keys only. No audio is shared.</p><p class="social-note" id="tracklist-copied" role="status"></p><div class="modal-actions"><button class="ghost" value="cancel">Close</button>${t.mine ? '<button class="ghost danger" type="button" id="tracklist-stop">Stop sharing</button>' : ''}<button class="primary" type="button" id="tracklist-copy">Copy to my library</button></div>`);
    const title = D.getElementById('tracklist-title'); if(title) title.textContent = t.name;
    const owner = D.getElementById('tracklist-owner'); if(owner) owner.textContent = `${t.tracks.length} track${t.tracks.length === 1 ? '' : 's'} · shared by ${t.owner.displayName}`;
    const body = D.getElementById('tracklist-rows');
    if(body) t.tracks.forEach((tr, i) => {
      const row = D.createElement('tr');
      [String(i + 1), tr.artist ? `${tr.title} — ${tr.artist}` : tr.title, tr.bpm ? String(tr.bpm) : '—', tr.key || '—'].forEach((v, col) => {
        const td = D.createElement('td'); td.textContent = v;
        if(col >= 2) td.className = 'tl-col';
        if(col === 1 && (tr.bpm || tr.key)){ const meta = D.createElement('small'); meta.className = 'tl-meta-inline'; meta.textContent = [tr.bpm ? `${tr.bpm} BPM` : '', tr.key || ''].filter(Boolean).join(' · '); td.appendChild(meta); }
        row.appendChild(td);
      });
      body.appendChild(row);
    });
    const copyBtn = D.getElementById('tracklist-copy');
    if(copyBtn) copyBtn.onclick = () => { copyToFind(t); D.getElementById('tracklist-copied').textContent = 'Saved to Music Library → To find. Tick tracks off as you get them.'; copyBtn.disabled = true; renderSharePanel(); };
    const stop = D.getElementById('tracklist-stop');
    if(stop) stop.onclick = async () => { const x = await api(`/api/sharedCrates/${encodeURIComponent(t.id)}`, { method:'DELETE' }); D.getElementById('tracklist-copied').textContent = x.error ? errText(x, 'Could not stop sharing.') : 'This link no longer works.'; stop.disabled = !x.error; };
    return r;
  }

  /* ============================== 5. Weekly practice goals ============================== */
  const GOAL_KEY = 'djbPracticeGoal';
  const goal = { sessionsPerWeek:store.get(GOAL_KEY, 0) || 0, synced:false, error:'' };
  function weekStart(date = new Date()){
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - day);
    return d;
  }
  function practiceSessions(){
    try{ return typeof W.mergedPracticeSessions === 'function' ? W.mergedPracticeSessions() : []; }catch(e){ return []; }
  }
  function goalProgress(now = new Date(), sessions = practiceSessions(), target = goal.sessionsPerWeek){
    const start = weekStart(now).getTime();
    const counts = new Map();
    sessions.forEach(s => {
      const t = Date.parse(s.recordedAt);
      if(!Number.isFinite(t)) return;
      const w = weekStart(new Date(t)).getTime();
      counts.set(w, (counts.get(w) || 0) + 1);
    });
    const done = counts.get(start) || 0;
    let streak = 0;
    if(target > 0){
      const cursor = new Date(start);
      if(done >= target) streak = 1;
      for(;;){
        cursor.setDate(cursor.getDate() - 7);
        if((counts.get(cursor.getTime()) || 0) >= target) streak += 1; else break;
      }
    }
    const resetsIn = Math.ceil((start + 7 * 86400000 - now.getTime()) / 86400000);
    return { done, target, hit:target > 0 && done >= target, streak, resetsIn };
  }
  function ringSvg(done, target){
    const pct = target > 0 ? Math.min(1, done / target) : 0;
    const r = 42, c = 2 * Math.PI * r;
    return `<svg class="goal-ring" viewBox="0 0 100 100" role="img" aria-label="${done} of ${target} practice sessions this week"><circle cx="50" cy="50" r="${r}" class="goal-ring-track"/><circle cx="50" cy="50" r="${r}" class="goal-ring-fill" stroke-dasharray="${(c * pct).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)"/><text x="50" y="48" text-anchor="middle" class="goal-ring-num">${done}/${target}</text><text x="50" y="64" text-anchor="middle" class="goal-ring-sub">this week</text></svg>`;
  }
  function renderGoal(){
    const dash = D.getElementById('dashboard');
    if(!dash) return;
    let panel = D.getElementById('practice-goal');
    if(!panel){
      panel = D.createElement('section');
      panel.className = 'panel practice-goal';
      panel.id = 'practice-goal';
      const hero = dash.querySelector('.hero');
      if(hero && hero.nextSibling) dash.insertBefore(panel, hero.nextSibling); else dash.appendChild(panel);
    }
    const p = goalProgress();
    const options = [0, 1, 2, 3, 4, 5, 7, 10, 14].map(n => `<option value="${n}"${n === goal.sessionsPerWeek ? ' selected' : ''}>${n ? `${n} session${n === 1 ? '' : 's'} a week` : 'No goal'}</option>`).join('');
    panel.innerHTML = `<div class="goal-body">${goal.sessionsPerWeek ? ringSvg(p.done, p.target) : ''}<div class="goal-text"><span class="eyebrow">WEEKLY PRACTICE GOAL</span><h3>${goal.sessionsPerWeek ? (p.hit ? 'Goal hit this week! 🔥' : `${p.target - p.done} more to hit your goal`) : 'Set a weekly goal'}</h3><p class="social-note">${goal.sessionsPerWeek ? `Resets Monday (${p.resetsIn} day${p.resetsIn === 1 ? '' : 's'} left). Goal streak: <strong id="goal-streak">${p.streak} week${p.streak === 1 ? '' : 's'}</strong>.` : 'Pick how many practice sessions you want each week. A ring tracks it here and every week you hit it adds to your streak.'}</p><label class="goal-pick">Goal <select id="goal-select" aria-label="Weekly practice goal">${options}</select></label> <button class="ghost small" type="button" data-view-target="practice" id="goal-open-practice">Practice log</button><small class="social-note" id="goal-status" aria-live="polite">${esc(goal.error)}</small></div></div>`;
    D.getElementById('goal-select').onchange = e => setGoal(Number(e.target.value));
    D.getElementById('goal-open-practice').onclick = () => go('practice');
  }
  async function loadGoal(){
    if(!signedIn()){ renderGoal(); return { skipped:true }; }
    const r = await api('/api/practiceGoal');
    if(!r.error && r.data && r.data.goal){ goal.sessionsPerWeek = Number(r.data.goal.sessionsPerWeek) || 0; goal.synced = true; store.set(GOAL_KEY, goal.sessionsPerWeek); }
    renderGoal();
    return r;
  }
  async function setGoal(n){
    goal.sessionsPerWeek = Math.max(0, Math.min(21, Math.round(Number(n) || 0)));
    store.set(GOAL_KEY, goal.sessionsPerWeek);
    goal.error = '';
    let r = { skipped:true };
    if(signedIn()){
      r = await api('/api/practiceGoal', { method:'PUT', body:{ sessionsPerWeek:goal.sessionsPerWeek } });
      goal.error = r.error ? (schemaMissing(r) || needsServer(r) ? 'Saved on this device. It will sync once the server is set up.' : errText(r, 'Saved on this device only.')) : 'Saved to your account.';
    }
    renderGoal();
    return r;
  }

  /* ============================== wiring ============================== */
  function onView(view){
    if(view === 'messages' && !dm.opening) loadConversations();
    if(view !== 'messages') stopDmPolling();
    if(view === 'find-djs'){ wireFindView(); if(find.status === 'idle') searchDjs({}); else renderFind(); }
    if(view === 'watch' && !watch.opening) loadLiveBattles();
    if(view !== 'watch') stopWatchTimers();
    if(view === 'library') renderSharePanel();
    if(view === 'dashboard') loadGoal();
  }
  ensureMessagesView(); ensureFindView(); ensureWatchView();
  renderGoal(); renderSharePanel(); renderNavBadge();
  const hashView = typeof W.viewFromHash === 'function' ? W.viewFromHash() : '';
  if(['messages', 'find-djs', 'watch'].includes(hashView) && typeof W.switchView === 'function') W.switchView(hashView, { fromHistory:true });
  (function deepLinks(){
    let params; try{ params = new URLSearchParams(W.location.search); }catch(e){ return; }
    const tl = params.get('tracklist');
    const live = params.get('watch');
    if(tl && /^tl_[a-f0-9]{6,40}$/i.test(tl)) openSharedTracklist(tl);
    if(live && /^[A-Za-z0-9._:-]{1,128}$/.test(live)) openLive(live);
  })();
  // Unread message count for the nav badge, refreshed once a minute while signed in.
  if(!isJsdom()) setInterval(() => { if(signedIn() && !D.hidden && !dm.timer) api('/api/messages').then(r => { if(r && r.data){ dm.unread = Number(r.data.unread) || 0; renderNavBadge(); } }); }, 60000);

  W.DJBConnect = {
    onView,
    loadConversations, openConversation, refreshThread, sendMessage, unsendMessage, muteCurrent, blockCurrent, dmState:() => dm,
    searchDjs, followDj, challengeDj, saveListing, findState:() => find,
    loadLiveBattles, openLive, refreshLive, sendHeartbeat, crowdVote, closeLive, watchState:() => watch, viewerKey,
    renderSharePanel, shareCrate, crateTracklist, openSharedTracklist, copyToFind, toFindLists, removeToFind, toggleToFind, shareState:() => share,
    weekStart, goalProgress, renderGoal, loadGoal, setGoal, goalState:() => goal
  };
})();
