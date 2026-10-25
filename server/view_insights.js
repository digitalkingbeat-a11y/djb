// Oct 20b: "Who's watching". Every counted view on a public profile, public battle result or
// Beat Store listing also writes one small row (what was viewed, the week, and where the visitor
// came from as a broad category). Nothing identifies the visitor: no IP, no user agent, no
// visitor id is stored here. Owners then see weekly counts, the trend and top sources.
const { newId, isMissingTable, stablePublicProfileId } = require('./social_helpers');

const SCHEMA = '046_create_view_events';
const KINDS = ['profile', 'result', 'listing'];
const WEEKS = 8;
const SOURCE_LABELS = { direct:'Direct / typed in', djbattle:'Inside DJ Battle', instagram:'Instagram', tiktok:'TikTok', x:'X / Twitter', facebook:'Facebook', youtube:'YouTube', reddit:'Reddit', discord:'Discord', search:'Search engines', embed:'Embedded player', other:'Other websites' };

// Turns a referrer URL into a broad bucket. Only the bucket is ever stored.
function sourceFromReferrer(referrer, ownHost = '', embed = false){
  if(embed) return 'embed';
  let host = '';
  try{ host = new URL(String(referrer || '')).hostname.toLowerCase().replace(/^www\./, ''); }catch(e){ return 'direct'; }
  if(!host) return 'direct';
  const own = String(ownHost || '').toLowerCase().replace(/^www\./, '');
  if((own && host === own) || /djbattle/.test(host)) return 'djbattle';
  if(/(^|\.)instagram\.com$|(^|\.)l\.instagram\.com$/.test(host)) return 'instagram';
  if(/(^|\.)tiktok\.com$/.test(host)) return 'tiktok';
  if(/(^|\.)(x\.com|twitter\.com|t\.co)$/.test(host)) return 'x';
  if(/(^|\.)(facebook\.com|fb\.com|l\.facebook\.com|m\.facebook\.com)$/.test(host)) return 'facebook';
  if(/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return 'youtube';
  if(/(^|\.)reddit\.com$/.test(host)) return 'reddit';
  if(/(^|\.)discord(app)?\.com$/.test(host)) return 'discord';
  if(/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|yahoo\.com|ecosia\.org)$/.test(host)) return 'search';
  return 'other';
}
// Monday 00:00 UTC of the week containing `d`.
function weekStart(d){
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dow);
  return t.toISOString().slice(0, 10);
}

async function logViewEvent(db, { kind, targetId, ownerUserId, referrer, ownHost, embed, now = new Date() }){
  if(!KINDS.includes(kind) || !targetId || !ownerUserId) return { skipped:true };
  const row = { id:newId('vev'), kind, target_id:String(targetId).slice(0, 80), owner_user_id:String(ownerUserId), source:sourceFromReferrer(referrer, ownHost, embed), week_start:weekStart(now), viewed_at:now.toISOString() };
  try{
    const r = await db.from('view_events').insert([row]);
    if(r && r.error) return isMissingTable(r.error) ? { schemaMissing:true, schema:SCHEMA } : { error:r.error };
  }catch(err){ return { error:err }; }
  return { logged:true, row };
}

function summarize(rows, now = new Date()){
  const weeks = [];
  for(let i = WEEKS - 1; i >= 0; i--){ const d = new Date(now.getTime() - i * 7 * 86400000); weeks.push(weekStart(d)); }
  const empty = () => Object.fromEntries(weeks.map(w => [w, 0]));
  const byKind = Object.fromEntries(KINDS.map(k => [k, empty()]));
  const sources = {};
  const targets = {};
  rows.forEach(r => {
    if(!byKind[r.kind] || byKind[r.kind][r.week_start] == null) return;
    byKind[r.kind][r.week_start] += 1;
    if(r.week_start === weeks[weeks.length - 1]) sources[r.source] = (sources[r.source] || 0) + 1;
    const key = `${r.kind}:${r.target_id}`;
    if(r.week_start === weeks[weeks.length - 1]) targets[key] = (targets[key] || 0) + 1;
  });
  const total = w => KINDS.reduce((s, k) => s + byKind[k][w], 0);
  const thisWeek = total(weeks[weeks.length - 1]);
  const lastWeek = total(weeks[weeks.length - 2]);
  const changePercent = lastWeek ? Math.round((thisWeek - lastWeek) / lastWeek * 100) : (thisWeek ? null : 0);
  const srcTotal = Object.values(sources).reduce((a, b) => a + b, 0);
  return {
    weeks,
    series:Object.fromEntries(KINDS.map(k => [k, weeks.map(w => byKind[k][w])])),
    totals:weeks.map(total),
    thisWeek:{ total:thisWeek, profile:byKind.profile[weeks[WEEKS - 1]], result:byKind.result[weeks[WEEKS - 1]], listing:byKind.listing[weeks[WEEKS - 1]] },
    lastWeek:{ total:lastWeek },
    trend:{ changePercent, direction:thisWeek > lastWeek ? 'up' : thisWeek < lastWeek ? 'down' : 'flat' },
    sources:Object.entries(sources).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([source, views]) => ({ source, label:SOURCE_LABELS[source] || source, views, percent:srcTotal ? Math.round(views / srcTotal * 100) : 0 })),
    topItems:Object.entries(targets).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([key, views]) => { const [kind, ...rest] = key.split(':'); return { kind, targetId:rest.join(':'), views }; })
  };
}
async function getInsights(db, userId, now = new Date()){
  const r = await db.from('view_events').select('*').eq('owner_user_id', String(userId)).limit(20000);
  if(r.error) return isMissingTable(r.error) ? { schemaMissing:true, schema:SCHEMA } : { error:r.error };
  const cutoff = new Date(now.getTime() - (WEEKS + 1) * 7 * 86400000).toISOString();
  const rows = (r.data || []).filter(x => String(x.viewed_at) >= cutoff);
  return { insights:{ publicProfileId:stablePublicProfileId(userId), ...summarize(rows, now) } };
}

module.exports = { SCHEMA, KINDS, WEEKS, SOURCE_LABELS, sourceFromReferrer, weekStart, logViewEvent, summarize, getInsights };
