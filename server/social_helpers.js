// Small shared helpers for the Oct 19 features (battle chat, tournaments, timed comments).
const crypto = require('crypto');
const { stablePublicProfileId } = require('./battle_result_history');

const PROFILE_TABLE = 'dj_progression_profiles';
const BLOCKS_TABLE = 'dj_blocks';

// Strips control characters (keeps newlines out too) and caps length. HTML is never
// interpreted server-side: the browser always renders these strings with textContent/esc().
function cleanText(value, max){
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function cleanId(value, max = 128){
  const text = String(value == null ? '' : value).trim().slice(0, max);
  return /^[A-Za-z0-9._:-]{1,128}$/.test(text) ? text : '';
}
function newId(prefix){
  return `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
}
function isMissingTable(error){
  const text = String(error && (error.message || error.code || error) || '');
  return /does not exist|relation .* not found|42P01|schema cache/i.test(text);
}

async function profilesFor(dataClient, userIds){
  const ids = [...new Set(userIds.filter(Boolean).map(String))];
  const out = new Map();
  ids.forEach(id => out.set(id, { publicProfileId:stablePublicProfileId(id), displayName:'DJ' }));
  if(!ids.length) return out;
  let query = dataClient.from(PROFILE_TABLE).select('*');
  query = typeof query.in === 'function' ? query.in('user_id', ids) : query;
  const result = await query;
  if(result && !result.error){
    (result.data || []).forEach(row => {
      const id = String(row.user_id);
      if(!out.has(id)) return;
      const pub = row.public_profile && typeof row.public_profile === 'object' ? row.public_profile : {};
      out.set(id, {
        publicProfileId:row.public_profile_id || pub.publicProfileId || stablePublicProfileId(id),
        displayName:cleanText(row.display_name || pub.displayName, 80) || 'DJ',
        belt:cleanText(row.belt || pub.belt, 40) || null
      });
    });
  }
  return out;
}

// Every active block that touches this user, either direction.
async function blockedUserIdsFor(dataClient, userId){
  const me = String(userId || '');
  const set = new Set();
  if(!me) return set;
  const result = await dataClient.from(BLOCKS_TABLE).select('*').limit(1000);
  if(!result || result.error) return set;
  (result.data || []).forEach(row => {
    if(row.active === false || row.status === 'inactive') return;
    if(String(row.blocker_user_id) === me) set.add(String(row.blocked_user_id));
    if(String(row.blocked_user_id) === me) set.add(String(row.blocker_user_id));
  });
  return set;
}

// Simple in-memory per-user rate limit (the server is single-process).
const buckets = new Map();
function rateLimited(key, now = Date.now(), max = 10, windowMs = 30000){
  const list = (buckets.get(key) || []).filter(t => now - t < windowMs);
  if(list.length >= max){ buckets.set(key, list); return true; }
  list.push(now); buckets.set(key, list);
  return false;
}
function resetRateLimits(){ buckets.clear(); }

module.exports = { cleanText, cleanId, newId, isMissingTable, profilesFor, blockedUserIdsFor, rateLimited, resetRateLimits, stablePublicProfileId };
