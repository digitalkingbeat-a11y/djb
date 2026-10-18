// Other DJs' profile photos. A photo's public URL lives on the owner's Supabase user metadata
// (avatar_url, see profile_avatar.js). This directory adds `avatarUrl` to every public profile
// object in an API response, keyed by publicProfileId, without one lookup per row:
//   * one storage listing of the public bucket tells us which users have a photo at all,
//   * one profile-table read maps public profile ids to those users,
//   * auth metadata is read only for photo owners, a few at a time, and cached.
// Only https URLs inside the public "profile-avatars" bucket are ever exposed, and private
// profiles (publicProfileId null or profileVisibility "private") never get a photo.
const crypto = require('crypto');

const AVATAR_BUCKET = 'profile-avatars';
const PUBLIC_AVATAR_MARKER = `/storage/v1/object/public/${AVATAR_BUCKET}/avatars/`;
const PROFILE_TABLE = 'dj_progression_profiles';
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_WALK_NODES = 5000;

function stablePublicProfileId(userId){
  return `dj_${crypto.createHash('sha256').update(`dj-battle-profile:${userId}`).digest('hex').slice(0, 16)}`;
}

function isPublicAvatarUrl(value){
  const text = String(value || '');
  return text.length > 0 && text.length <= 1000 && /^https:\/\/[^\s"'<>()]+$/i.test(text) && text.includes(PUBLIC_AVATAR_MARKER);
}

function plainObject(value){
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function rowIsPrivate(row){
  const embedded = plainObject(row && row.public_profile);
  return String(row && row.visibility || embedded.visibility || 'public').toLowerCase() === 'private';
}

// Collect every object in a payload that names a public profile and has no photo yet.
function collectProfileTargets(payload){
  const targets = [];
  const seen = new Set();
  let nodes = 0;
  const visit = (value, depth) => {
    if(!value || typeof value !== 'object' || depth > 10 || nodes > MAX_WALK_NODES || seen.has(value)) return;
    seen.add(value);
    nodes += 1;
    if(Array.isArray(value)){ value.forEach(item => visit(item, depth + 1)); return; }
    const id = value.publicProfileId;
    if(typeof id === 'string' && id && value.profileVisibility !== 'private' && !value.avatarUrl) targets.push(value);
    Object.keys(value).forEach(key => { const child = value[key]; if(child && typeof child === 'object') visit(child, depth + 1); });
  };
  visit(payload, 0);
  return targets;
}

function createAvatarDirectory(options = {}){
  const { dataClient, authAdmin, storage } = options;
  const ttlMs = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : DEFAULT_TTL_MS;
  const concurrency = Math.max(1, Math.min(16, Number(options.concurrency) || 6));
  const clock = typeof options.now === 'function' ? options.now : () => Date.now();
  let index = { at:0, owners:null, byPublic:new Map(), privateUsers:new Set() };
  let indexPromise = null;
  const avatars = new Map(); // userId -> { url, at }
  const stats = { storageLists:0, profileReads:0, userLookups:0 };

  async function buildIndex(){
    const byPublic = new Map();
    const privateUsers = new Set();
    let owners = null;
    if(storage && typeof storage.list === 'function'){
      stats.storageLists += 1;
      const listed = await storage.list('avatars', { limit:1000 });
      if(!listed.error && Array.isArray(listed.data)){
        owners = new Set(listed.data.map(item => String(item && item.name || '')).filter(name => /^[A-Za-z0-9._:-]{1,128}$/.test(name)));
      }
    }
    if(dataClient && typeof dataClient.from === 'function'){
      stats.profileReads += 1;
      let query = dataClient.from(PROFILE_TABLE).select('user_id, public_profile_id, visibility, public_profile');
      if(typeof query.limit === 'function') query = query.limit(2000);
      const result = await query;
      if(!result.error){
        (result.data || []).forEach(row => {
          const userId = String(row && row.user_id || '');
          if(!userId) return;
          if(rowIsPrivate(row)){ privateUsers.add(userId); return; }
          const embedded = plainObject(row.public_profile);
          [row.public_profile_id, embedded.publicProfileId, stablePublicProfileId(userId)].filter(Boolean).forEach(id => byPublic.set(String(id), userId));
        });
      }
    }
    // Photo owners with no ranking row yet still appear under their stable id.
    if(owners) owners.forEach(userId => { if(!privateUsers.has(userId)){ const id = stablePublicProfileId(userId); if(!byPublic.has(id)) byPublic.set(id, userId); } });
    return { at:clock(), owners, byPublic, privateUsers };
  }

  async function ensureIndex(){
    if(index.at && clock() - index.at < ttlMs) return index;
    if(!indexPromise) indexPromise = buildIndex().then(next => { index = next; return next; }).finally(() => { indexPromise = null; });
    return indexPromise;
  }

  async function lookupUser(userId){
    stats.userLookups += 1;
    try{
      const result = await authAdmin.getUserById(userId);
      const meta = result && !result.error && result.data && result.data.user && result.data.user.user_metadata || {};
      return isPublicAvatarUrl(meta.avatar_url) ? String(meta.avatar_url) : '';
    }catch(err){ return ''; }
  }

  async function avatarsForUserIds(userIds){
    const current = await ensureIndex();
    const wanted = Array.from(new Set((userIds || []).map(String).filter(Boolean)))
      .filter(id => !current.privateUsers.has(id) && (!current.owners || current.owners.has(id)));
    const out = new Map();
    const missing = [];
    wanted.forEach(id => {
      const cached = avatars.get(id);
      if(cached && clock() - cached.at < ttlMs) out.set(id, cached.url);
      else missing.push(id);
    });
    if(missing.length && authAdmin && typeof authAdmin.getUserById === 'function'){
      for(let i = 0; i < missing.length; i += concurrency){
        const batch = missing.slice(i, i + concurrency);
        const urls = await Promise.all(batch.map(lookupUser));
        batch.forEach((id, n) => { avatars.set(id, { url:urls[n], at:clock() }); out.set(id, urls[n]); });
      }
    }
    return out;
  }

  async function attach(payload){
    const targets = collectProfileTargets(payload);
    if(!targets.length) return payload;
    const current = await ensureIndex();
    const userFor = target => current.byPublic.get(String(target.publicProfileId));
    const urls = await avatarsForUserIds(targets.map(userFor).filter(Boolean));
    targets.forEach(target => {
      const url = urls.get(String(userFor(target) || ''));
      if(url && isPublicAvatarUrl(url)) target.avatarUrl = url;
    });
    return payload;
  }

  // Called after a user saves or removes their own photo so others see it right away.
  function remember(userId, avatarUrl){
    const id = String(userId || '');
    if(!id) return;
    const url = isPublicAvatarUrl(avatarUrl) ? String(avatarUrl) : '';
    avatars.set(id, { url, at:clock() });
    if(index.owners){ if(url) index.owners.add(id); }
    if(url && !index.privateUsers.has(id)){ const stable = stablePublicProfileId(id); if(!index.byPublic.has(stable)) index.byPublic.set(stable, id); }
  }

  return { attach, avatarsForUserIds, remember, stats, ensureIndex };
}

// Express middleware: wraps res.json on the listed public routes so their profiles carry photos.
function avatarResponseMiddleware(directory){
  return (req, res, next) => {
    if(!directory || req.method !== 'GET') return next();
    const original = res.json.bind(res);
    res.json = body => {
      if(res.statusCode >= 400 || !body || typeof body !== 'object') return original(body);
      directory.attach(body).then(() => original(body), () => original(body));
      return res;
    };
    return next();
  };
}

module.exports = {
  AVATAR_BUCKET,
  PUBLIC_AVATAR_MARKER,
  isPublicAvatarUrl,
  stablePublicProfileId,
  collectProfileTargets,
  createAvatarDirectory,
  avatarResponseMiddleware
};
