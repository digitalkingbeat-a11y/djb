// Oct 27: a DJ's website link and booking info, shown on their public profile.
// Saved on dj_progression_profiles (website_url, booking_info; see sql/055). Everything is
// cleaned here so nothing a DJ types can break a page or run code where it is shown.
const crypto = require('crypto');
const { SOCIAL_KEYS, cleanSocialLink } = require('./social_links');
const SOCIAL_SCHEMA = '056_add_social_links_and_rights';
const SOCIAL_COLUMNS = { instagram:'instagram_url', soundcloud:'soundcloud_url', mixcloud:'mixcloud_url', tiktok:'tiktok_url' };

const PROFILE_TABLE = 'dj_progression_profiles';
const WEBSITE_MAX = 200;
const BOOKING_MAX = 120;
const LINKS_SCHEMA = '055_add_profile_links';

function stablePublicProfileId(userId){
  return `dj_${crypto.createHash('sha256').update(`dj-battle-profile:${userId}`).digest('hex').slice(0, 16)}`;
}

// Website: http(s) only, no user:password, a real-looking host. "djdan.com" becomes "https://djdan.com".
function cleanWebsite(value){
  let text = String(value == null ? '' : value).trim();
  if(!text) return { value:'' };
  if(/[\s<>"'`\\]/.test(text) || /[\u0000-\u001f\u007f]/.test(text)) return { error:'Website must be a web address like https://yoursite.com.' };
  if(!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text.replace(/^\/+/, '')}`;
  let url;
  try{ url = new URL(text); }catch(e){ return { error:'Website must be a web address like https://yoursite.com.' }; }
  if(url.protocol !== 'https:' && url.protocol !== 'http:') return { error:'Website must start with http:// or https://.' };
  if(url.username || url.password) return { error:'Website must not include a username or password.' };
  const host = url.hostname;
  if(!host || !/^[a-z0-9.-]+$/i.test(host) || !/\.[a-z]{2,}$/i.test(host) || /\.\./.test(host)) return { error:'Website must be a web address like https://yoursite.com.' };
  const out = url.href;
  if(out.length > WEBSITE_MAX) return { error:`Website must be ${WEBSITE_MAX} characters or fewer.` };
  return { value:out };
}

// Booking info: one short line of plain text (email, phone, "DM for bookings").
function cleanBookingInfo(value){
  const text = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if(text.length > BOOKING_MAX) return { error:`Booking info must be ${BOOKING_MAX} characters or fewer.` };
  return { value:text };
}

function linksFromRow(row){
  const out = { website:'', bookingInfo:'' };
  SOCIAL_KEYS.forEach(key => { out[key] = ''; });
  if(!row) return out;
  const site = cleanWebsite(row.website_url);
  const booking = cleanBookingInfo(row.booking_info);
  out.website = site.error ? '' : site.value;
  out.bookingInfo = booking.error ? '' : booking.value;
  SOCIAL_KEYS.forEach(key => {
    const cleaned = cleanSocialLink(key, row[SOCIAL_COLUMNS[key]]);
    out[key] = cleaned.error ? '' : cleaned.value;
  });
  return out;
}

function schemaMissing(error){
  return /column|schema cache|does not exist/i.test(String(error && (error.message || error) || ''));
}

async function getProfileLinks(dataClient, userId){
  const found = await dataClient.from(PROFILE_TABLE).select('*').eq('user_id', String(userId)).limit(1);
  if(found.error) return schemaMissing(found.error) ? { links:linksFromRow(null), schemaMissing:true, schema:LINKS_SCHEMA } : { error:found.error };
  return { links:linksFromRow((found.data || [])[0]) };
}

async function updateProfileLinks(dataClient, userId, input = {}, now = new Date()){
  const patch = { updated_at:now.toISOString() };
  if('website' in input){
    const site = cleanWebsite(input.website);
    if(site.error) return { validationError:site.error };
    patch.website_url = site.value || null;
  }
  if('bookingInfo' in input){
    const booking = cleanBookingInfo(input.bookingInfo);
    if(booking.error) return { validationError:booking.error };
    patch.booking_info = booking.value || null;
  }
  for(const key of SOCIAL_KEYS){
    if(!(key in input)) continue;
    const cleaned = cleanSocialLink(key, input[key]);
    if(cleaned.error) return { validationError:cleaned.error, field:key };
    patch[SOCIAL_COLUMNS[key]] = cleaned.value || null;
  }
  const found = await dataClient.from(PROFILE_TABLE).select('*').eq('user_id', String(userId)).limit(1);
  if(found.error) return { error:found.error };
  const exists = Boolean((found.data || [])[0]);
  const write = (values) => exists
    ? dataClient.from(PROFILE_TABLE).update(values).eq('user_id', String(userId))
    : dataClient.from(PROFILE_TABLE).insert([{ user_id:String(userId), ...values }]);
  let result = await write(patch);
  let socialSchemaMissing = false;
  const socialCols = Object.values(SOCIAL_COLUMNS).filter(col => col in patch);
  // Before sql/056 the social columns do not exist: still save website / booking, and say so.
  if(result.error && socialCols.length && schemaMissing(result.error)){
    const basic = { ...patch };
    socialCols.forEach(col => { delete basic[col]; });
    socialSchemaMissing = true;
    result = await write(basic);
    if(!result.error) return { saved:true, links:linksFromRow(basic), socialSchemaMissing:true, schema:SOCIAL_SCHEMA };
  }
  if(result.error) return schemaMissing(result.error) ? { schemaMissing:true, schema:socialSchemaMissing ? SOCIAL_SCHEMA : LINKS_SCHEMA } : { error:result.error };
  return { saved:true, links:linksFromRow(patch) };
}

// Adds website / bookingInfo to a public profile. Private profiles get nothing; a missing column is ignored.
async function attachPublicProfileLinks(dataClient, profile, userId){
  if(!profile || !userId) return profile;
  try{
    const found = await dataClient.from(PROFILE_TABLE).select('*').eq('user_id', String(userId)).limit(1);
    if(found.error) return profile;
    const row = (found.data || [])[0];
    if(!row || String(row.visibility || 'public').toLowerCase() === 'private') return profile;
    const links = linksFromRow(row);
    if(links.website) profile.website = links.website;
    if(links.bookingInfo) profile.bookingInfo = links.bookingInfo;
    SOCIAL_KEYS.forEach(key => { if(links[key]) profile[key] = links[key]; });
  }catch(e){ /* optional extra; never break the profile */ }
  return profile;
}

module.exports = { SOCIAL_SCHEMA, SOCIAL_COLUMNS, PROFILE_TABLE, WEBSITE_MAX, BOOKING_MAX, LINKS_SCHEMA, cleanWebsite, cleanBookingInfo, linksFromRow, getProfileLinks, updateProfileLinks, attachPublicProfileLinks, stablePublicProfileId };
