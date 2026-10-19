// The embeddable DJ Battle player (embed.html?type=result|beat&id=...). Other sites put this page
// in an iframe; the server lets only this page be framed. It shows a public battle result or a
// Beat Store listing with a "Battle me on DJ Battle" link back to the app. All text is set with
// textContent, never as HTML.
(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root && root.document) root.DJBEmbed = api;
})(typeof window !== 'undefined' ? window : globalThis, function(){
  'use strict';
  function parseParams(search){
    const params = new URLSearchParams(search || '');
    const type = params.get('type') === 'beat' ? 'beat' : params.get('type') === 'result' ? 'result' : '';
    const id = String(params.get('id') || '');
    const valid = type === 'result' ? /^vr_[a-z0-9]{6,40}$/i.test(id) : /^[A-Za-z0-9._:-]{1,128}$/.test(id);
    const theme = params.get('theme') === 'light' ? 'light' : params.get('theme') === 'dark' ? 'dark' : '';
    return { type, id:valid ? id : '', theme };
  }
  function appLink(type, id, href){
    const base = String(href || '').split('?')[0].split('#')[0].replace(/embed\.html$/, 'index.html');
    return `${base}?${type === 'beat' ? 'beat' : 'result'}=${encodeURIComponent(id)}`;
  }
  function bars(id, n = 48){
    let h = 2166136261;
    for(const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    const out = [];
    for(let i = 0; i < n; i++){ h = Math.imul(h ^ (h >>> 13), 1274126177); out.push(25 + ((h >>> 0) % 75)); }
    return out;
  }
  function viewModel(type, data){
    if(type === 'beat'){
      const l = data && data.listing || {};
      const p = l.product || {};
      const price = Number(l.displayPriceCents) || 0;
      return {
        title:l.title || p.title || 'Untitled beat',
        subtitle:[p.genre || l.genre, p.bpm ? `${p.bpm} BPM` : '', p.key || '', l.sellerDisplayName || (l.seller && l.seller.displayName) || ''].filter(Boolean).join(' · ') || 'Beat Store',
        badge:price > 0 ? `$${(price / 100).toFixed(2)}` : 'FREE',
        badgeLabel:price > 0 ? 'price' : 'download',
        audio:null,
        cta:'Get it on DJ Battle'
      };
    }
    const r = data && data.result || {};
    const dj = r.profile && r.profile.displayName || 'DJ';
    return {
      title:r.battle && r.battle.title || r.title || 'Battle result',
      subtitle:[dj, r.battle && r.battle.genre || r.genre, r.outcome ? String(r.outcome).replace(/_/g, ' ') : ''].filter(Boolean).join(' · '),
      badge:r.score == null ? '—' : String(r.score),
      badgeLabel:'/100 score',
      audio:/^https:\/\//.test(r.audioUrl || r.previewUrl || '') ? (r.audioUrl || r.previewUrl) : null,
      cta:'Battle me on DJ Battle'
    };
  }
  function el(doc, tag, cls, text){ const n = doc.createElement(tag); if(cls) n.className = cls; if(text != null) n.textContent = text; return n; }
  function render(doc, rootEl, type, id, model, href){
    rootEl.innerHTML = '';
    const link = appLink(type, id, href);
    const top = el(doc, 'div', 'top');
    let audio = null;
    let play;
    if(model.audio){
      audio = doc.createElement('audio'); audio.preload = 'none'; audio.src = model.audio;
      play = el(doc, 'button', 'play', '▶'); play.type = 'button'; play.setAttribute('aria-label', 'Play');
      play.onclick = () => { if(audio.paused){ audio.play(); play.textContent = '❚❚'; play.setAttribute('aria-label', 'Pause'); } else { audio.pause(); play.textContent = '▶'; play.setAttribute('aria-label', 'Play'); } };
    }else{
      play = el(doc, 'a', 'play', '▶'); play.href = link; play.target = '_blank'; play.rel = 'noopener'; play.setAttribute('aria-label', 'Listen on DJ Battle');
    }
    const meta = el(doc, 'div', 'meta');
    meta.append(el(doc, 'strong', '', model.title), el(doc, 'small', '', model.subtitle));
    const score = el(doc, 'div', 'score');
    score.append(el(doc, 'b', '', model.badge), el(doc, 'small', '', model.badgeLabel));
    top.append(play, meta, score);
    const wave = el(doc, 'div', 'wave'); wave.setAttribute('aria-hidden', 'true');
    bars(id).forEach(h => { const i = doc.createElement('i'); i.style.height = `${h}%`; wave.appendChild(i); });
    if(audio){
      audio.ontimeupdate = () => { const done = audio.duration ? Math.round(audio.currentTime / audio.duration * wave.children.length) : 0; Array.from(wave.children).forEach((b, i) => b.classList.toggle('done', i < done)); };
      rootEl.appendChild(audio);
    }
    const foot = el(doc, 'div', 'foot');
    const cta = el(doc, 'a', 'cta', model.cta); cta.href = link; cta.target = '_blank'; cta.rel = 'noopener';
    foot.append(el(doc, 'span', 'brand', 'DJ BATTLE'), cta);
    rootEl.append(top, wave, foot);
    return rootEl;
  }
  function renderMessage(doc, rootEl, text, href){
    rootEl.innerHTML = '';
    const p = el(doc, 'p', 'msg', text);
    const foot = el(doc, 'div', 'foot');
    const cta = el(doc, 'a', 'cta', 'Open DJ Battle'); cta.href = String(href || '').split('?')[0].replace(/embed\.html$/, 'index.html'); cta.target = '_blank'; cta.rel = 'noopener';
    foot.append(el(doc, 'span', 'brand', 'DJ BATTLE'), cta);
    rootEl.append(p, foot);
  }
  async function boot(win){
    const doc = win.document;
    const rootEl = doc.getElementById('embed-root');
    const { type, id, theme } = parseParams(win.location.search);
    const prefersLight = win.matchMedia && win.matchMedia('(prefers-color-scheme: light)').matches;
    doc.documentElement.dataset.theme = theme || (prefersLight ? 'light' : 'dark');
    if(!type || !id){ renderMessage(doc, rootEl, 'This player link is missing its battle or beat.', win.location.href); return { error:'bad-link' }; }
    const apiRequest = win.DJBattleApi && win.DJBattleApi.apiRequest;
    if(!apiRequest){ renderMessage(doc, rootEl, 'This player needs the DJ Battle server.', win.location.href); return { error:'no-api' }; }
    const path = type === 'beat' ? `/api/marketplace/catalog/${encodeURIComponent(id)}` : `/api/publicBattleResults/${encodeURIComponent(id)}`;
    const response = await apiRequest(path, { public:true });
    if(response.error || !response.data){
      const status = response.status;
      renderMessage(doc, rootEl, status === 403 ? 'This result is private.' : status === 404 ? 'This battle or beat is no longer available.' : 'This player needs the DJ Battle server, which isn\'t reachable right now.', win.location.href);
      return { error:response.error || 'failed', status };
    }
    const model = viewModel(type, response.data);
    render(doc, rootEl, type, id, model, win.location.href);
    return { model };
  }
  if(typeof window !== 'undefined' && window.document && window.document.getElementById('embed-root')) boot(window);
  return { parseParams, appLink, viewModel, render, boot };
});
