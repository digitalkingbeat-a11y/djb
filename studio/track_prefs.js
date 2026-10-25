// Oct 25 Studio: favourites (star), private per-track notes, play counts, "Recently played"
// and "already played in this set / battle". Saved on this device; tracks you uploaded
// (server-backed My Uploads) also sync through the existing music library usage record.
(function(global){
  'use strict';
  const STORE_KEY = 'djBattleTrackPrefs';
  const SET_KEY = 'djBattleCurrentSet';
  const NOTE_MAX = 500;
  const RECENT_MAX = 50;

  function cleanPref(p){
    const v = p && typeof p === 'object' ? p : {};
    const out = {};
    if(v.favourite) out.favourite = true;
    const note = typeof v.note === 'string' ? v.note.slice(0, NOTE_MAX) : '';
    if(note.trim()) out.note = note;
    const plays = Math.max(0, Math.min(1e6, Math.floor(Number(v.playCount) || 0)));
    if(plays) out.playCount = plays;
    if(v.lastPlayedAt && !isNaN(Date.parse(v.lastPlayedAt))) out.lastPlayedAt = new Date(Date.parse(v.lastPlayedAt)).toISOString();
    if(v.editedAt && !isNaN(Date.parse(v.editedAt))) out.editedAt = new Date(Date.parse(v.editedAt)).toISOString();
    return out;
  }
  // Merge two copies (device + server): favourite/note from the newest edit, plays = the larger count.
  function mergePrefs(a, b){
    const x = cleanPref(a), y = cleanPref(b);
    const ex = Date.parse(a && a.editedAt || 0) || 0, ey = Date.parse(b && b.editedAt || 0) || 0;
    const newer = ey > ex ? y : x;
    const out = {};
    if(newer.favourite) out.favourite = true;
    if(newer.note) out.note = newer.note;
    const plays = Math.max(x.playCount || 0, y.playCount || 0);
    if(plays) out.playCount = plays;
    const last = [x.lastPlayedAt, y.lastPlayedAt].filter(Boolean).sort().pop();
    if(last) out.lastPlayedAt = last;
    const edited = Math.max(ex, ey);
    if(edited) out.editedAt = new Date(edited).toISOString();
    return out;
  }

  function create(opts){
    const o = opts || {};
    const store = o.localStorage || (global.localStorage || null);
    const now = o.now || (() => Date.now());
    const listeners = [];
    let prefs = {};
    let set = null;
    try{ prefs = JSON.parse(store && store.getItem(STORE_KEY) || '{}') || {}; }catch(e){ prefs = {}; }
    try{ set = JSON.parse(store && store.getItem(SET_KEY) || 'null'); }catch(e){ set = null; }
    if(!set || !Array.isArray(set.trackIds)) set = { key:'studio', label:'This set', startedAt:new Date(now()).toISOString(), trackIds:[] };

    function save(){ try{ store && store.setItem(STORE_KEY, JSON.stringify(prefs)); store && store.setItem(SET_KEY, JSON.stringify(set)); }catch(e){} }
    function emit(id, kind){ listeners.forEach(fn => { try{ fn(id, get(id), kind); }catch(e){} }); }
    function get(id){ return { favourite:false, note:'', playCount:0, lastPlayedAt:null, ...(prefs[String(id || '')] || {}) }; }
    function write(id, patch, kind){
      const key = String(id || ''); if(!key) return null;
      const cur = prefs[key] || {};
      const next = { ...cleanPref({ ...cur, ...patch }) };
      if(kind !== 'play') next.editedAt = new Date(now()).toISOString(); else if(cur.editedAt) next.editedAt = cur.editedAt;
      if(Object.keys(next).filter(k => k !== 'editedAt').length) prefs[key] = next; else delete prefs[key];
      save(); emit(key, kind); return get(key);
    }
    function toggleFavourite(id, force){ const f = force == null ? !get(id).favourite : Boolean(force); return write(id, { favourite:f }, 'favourite'); }
    function setNote(id, note){ return write(id, { note:String(note || '').slice(0, NOTE_MAX) }, 'note'); }
    // A "set" is either the battle you are preparing/recording for, or your current Studio session.
    function setContext(key, label){
      const k = String(key || 'studio');
      if(set.key !== k){ set = { key:k, label:label || (k === 'studio' ? 'This set' : 'This battle'), startedAt:new Date(now()).toISOString(), trackIds:[] }; save(); emit('', 'set'); }
      return currentSet();
    }
    function newSet(){ set = { key:set.key, label:set.label, startedAt:new Date(now()).toISOString(), trackIds:[] }; save(); emit('', 'set'); return currentSet(); }
    function currentSet(){ return { ...set, trackIds:set.trackIds.slice() }; }
    function playedThisSet(id){ return set.trackIds.includes(String(id || '')); }
    function recordPlay(id){
      const key = String(id || ''); if(!key) return null;
      if(!set.trackIds.includes(key)){ set.trackIds.push(key); if(set.trackIds.length > 500) set.trackIds.shift(); }
      const cur = get(key);
      return write(key, { playCount:(cur.playCount || 0) + 1, lastPlayedAt:new Date(now()).toISOString() }, 'play');
    }
    function favouriteIds(){ return Object.keys(prefs).filter(k => prefs[k].favourite); }
    function recentIds(limit){
      return Object.keys(prefs).filter(k => prefs[k].lastPlayedAt)
        .sort((a, b) => String(prefs[b].lastPlayedAt).localeCompare(String(prefs[a].lastPlayedAt)))
        .slice(0, limit || RECENT_MAX);
    }
    function importServer(id, serverPref){ const key = String(id || ''); if(!key || !serverPref) return get(key); const m = mergePrefs(prefs[key], serverPref); if(Object.keys(m).filter(k => k !== 'editedAt').length) prefs[key] = m; save(); return get(key); }
    function raw(id){ return prefs[String(id || '')] ? { ...prefs[String(id || '')] } : null; }
    function onChange(fn){ if(typeof fn === 'function') listeners.push(fn); }
    function reset(){ prefs = {}; set = { key:'studio', label:'This set', startedAt:new Date(now()).toISOString(), trackIds:[] }; save(); }
    return { get, raw, toggleFavourite, setNote, recordPlay, favouriteIds, recentIds, playedThisSet, setContext, newSet, currentSet, importServer, onChange, reset };
  }

  // Small badges shown next to a track title in the Library and Studio browser.
  function badgesHtml(p, played, esc){
    const e = esc || (s => String(s));
    const bits = [];
    if(p.playCount) bits.push(`<span class="tp-plays" title="Played ${e(p.playCount)} time${p.playCount === 1 ? '' : 's'}">▶ ${e(p.playCount)}</span>`);
    if(played) bits.push('<span class="tp-played" title="Already played in this set or battle">✓ Played</span>');
    if(p.note) bits.push(`<span class="tp-note-flag" title="${e(p.note)}">📝</span>`);
    return bits.join('');
  }
  function starButtonHtml(id, fav, esc){
    const e = esc || (s => String(s));
    return `<button type="button" class="tp-star ${fav ? 'on' : ''}" data-tp-star="${e(id)}" aria-pressed="${fav ? 'true' : 'false'}" aria-label="${fav ? 'Remove from Favourites' : 'Add to Favourites'}" title="${fav ? 'Remove from Favourites' : 'Add to Favourites'}">${fav ? '★' : '☆'}</button>`;
  }

  const api = { create, cleanPref, mergePrefs, badgesHtml, starButtonHtml, STORE_KEY, SET_KEY, NOTE_MAX, RECENT_MAX };
  global.DJBattleTrackPrefs = api;
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
