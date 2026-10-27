// Oct 25 Store: per-beat licences, short tagged previews and the Beat Store wishlist.
//
// 1. Licences. The seller picks what a buyer may do with each beat (battle use only, use in
//    their own releases, or royalty-free). The plain-words terms are shown before paying, and a
//    copy is frozen onto the order so the buyer's receipt never changes even if the seller later
//    picks a different licence.
// 2. Previews. Paid beats only ever stream a 30-60 second clip that the server cuts with FFmpeg
//    (optionally with a spoken "DJ Battle" tag mixed in). The clean full file is only reachable by
//    the owner or someone with an active purchase/gift entitlement, through short-lived links.
//    The voice tag (assets/dj-battle-voice-tag.wav) was synthesised for this project with the
//    open-source meSpeak/eSpeak speech engine, so it is not anyone's recording.
// 3. Wishlist. Fans tap a heart to save a beat and get an Activity-bell alert (and a phone alert
//    if they turned those on) when its price drops or the producer makes a discount code.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { cleanText, cleanId, isMissingTable, rateLimited } = require('./social_helpers');
const { notifyQuietly } = require('./social_notifications');
const Market = require('./marketplace_foundation');

const WISHLIST_TABLE = 'beat_wishlist_items';
const WISHLIST_SCHEMA = '051_create_beat_wishlist';
const PREVIEW_PREFIX = 'private/marketplace-previews/';
const VOICE_TAG_PATH = path.join(__dirname, 'assets', 'dj-battle-voice-tag.wav');
const MIN_PREVIEW = 30;
const MAX_PREVIEW = 60;
const DEFAULT_PREVIEW = 45;
const TAG_EVERY_SECONDS = 20;
const MAX_WISHLIST = 200;

/* ============================== 1. Licences ============================== */
// What the seller can pick. Plain words, shown to the buyer before paying.
const LICENCE_CHOICES = Object.freeze(['battle_use', 'creator_license', 'royalty_free_use']);
const LICENCE_VERSION = '2026-10-25';
const LICENCE_TERMS = Object.freeze({
  battle_use:Object.freeze({
    label:'Battle use only',
    summary:'Play it in DJ Battle battles, practice and live DJ sets.',
    may:['Play it in DJ Battle battles and practice', 'Play it in live DJ sets and streams of your sets'],
    mayNot:['Release it or a song made with it', 'Upload it to Spotify, YouTube, SoundCloud or other services', 'Resell, share or give the file away', 'Say you made it'],
    commercialUse:false, attributionRequired:false
  }),
  creator_license:Object.freeze({
    label:'Use in your own releases',
    summary:'Use it in your own mixes and songs, and release them, as long as you credit the producer.',
    may:['Everything in "Battle use only"', 'Use it in your own songs and mixes', 'Release those on streaming services and social media, and earn from them'],
    mayNot:['Sell or share the beat on its own', 'Register the beat itself with Content ID or a music library', 'Say you made the beat'],
    mustCredit:true, commercialUse:true, attributionRequired:true
  }),
  royalty_free_use:Object.freeze({
    label:'Royalty-free',
    summary:'Use it in anything, including paid and commercial work, with no further payments.',
    may:['Everything in "Use in your own releases"', 'Use it in ads, videos, games and client work', 'No credit needed (but producers love it)'],
    mayNot:['Sell or share the beat on its own as a beat', 'Say you made the beat'],
    commercialUse:true, attributionRequired:false
  }),
  personal_stream:Object.freeze({ label:'Listen only', summary:'Listen to it in DJ Battle. No downloads or other use.', may:['Listen in DJ Battle'], mayNot:['Download, release or share it'], commercialUse:false, attributionRequired:false }),
  preview_only:Object.freeze({ label:'Preview only', summary:'Hear a short preview. Not for sale.', may:['Hear the preview'], mayNot:['Download or use it'], commercialUse:false, attributionRequired:false })
});

function licenceTerms(type){
  const key = Market.RIGHTS_LICENSE_TYPES.includes(type) && LICENCE_TERMS[type] ? type : 'battle_use';
  const t = LICENCE_TERMS[key];
  return { type:key, version:LICENCE_VERSION, label:t.label, summary:t.summary, may:[...t.may], mayNot:[...t.mayNot], mustCredit:Boolean(t.mustCredit), commercialUse:t.commercialUse };
}
// Plain text copy for receipts and emails.
function licenceText(snapshot){
  const t = snapshot && snapshot.label ? snapshot : licenceTerms(snapshot && snapshot.type);
  return [`Licence: ${t.label}`, t.summary, 'You may:', ...t.may.map(x => `  - ${x}`), 'You may not:', ...t.mayNot.map(x => `  - ${x}`)].join('\n');
}

async function loadOwnedListing(db, userId, listingId){
  const id = cleanId(listingId, 160);
  if(!id) return { validationError:'A listing is required' };
  const l = await db.from(Market.MARKETPLACE_LISTING_TABLE).select('*').eq('id', id).limit(1);
  if(l.error) return { error:l.error };
  const listing = (l.data || [])[0];
  if(!listing || listing.status === 'archived') return { unavailable:true };
  if(String(listing.seller_user_id) !== String(userId)) return { forbidden:true };
  const p = await db.from(Market.MARKETPLACE_PRODUCT_TABLE).select('*').eq('id', listing.product_id).limit(1);
  if(p.error) return { error:p.error };
  const product = (p.data || [])[0];
  if(!product) return { unavailable:true };
  const r = await db.from(Market.MARKETPLACE_RIGHTS_TABLE).select('*').eq('product_id', product.id).limit(1);
  if(r.error) return { error:r.error };
  return { listing, product, rights:(r.data || [])[0] || null };
}

// Seller picks the licence. Updates the rights row the checkout already checks against.
async function setListingLicence(db, userId, listingId, input = {}, now = new Date()){
  const type = String(input.licenseType || input.licenceType || '');
  if(!LICENCE_CHOICES.includes(type)) return { validationError:'Pick Battle use only, Use in your own releases, or Royalty-free' };
  if(input.confirmRights !== true) return { validationError:'Confirm you have the right to offer these terms' };
  const owned = await loadOwnedListing(db, userId, listingId);
  if(owned.error || owned.forbidden || owned.unavailable || owned.validationError) return owned;
  if(!owned.rights) return { unavailable:true };
  // A track you licensed from someone else can't be passed on royalty-free.
  if(type === 'royalty_free_use' && owned.product.rights_classification === 'licensed') return { validationError:'Music you licensed from someone else can\'t be offered royalty-free. Pick another licence.' };
  const terms = licenceTerms(type);
  const patch = { license_type:type, commercial_use_allowed:terms.commercialUse, attribution_required:Boolean(terms.mustCredit), battle_use_allowed:true,
    terms:{ version:LICENCE_VERSION, label:terms.label, summary:terms.summary }, updated_at:now.toISOString() };
  const up = await db.from(Market.MARKETPLACE_RIGHTS_TABLE).update(patch).eq('id', owned.rights.id);
  if(up.error) return { error:up.error };
  return { licence:terms, listingId:owned.listing.id };
}

/* ============================== 2. Previews ============================== */
function previewWindow(durationSeconds, input = {}){
  const length = Math.round(Math.min(MAX_PREVIEW, Math.max(MIN_PREVIEW, Number(input.lengthSeconds) || DEFAULT_PREVIEW)));
  const duration = Number(durationSeconds) > 0 ? Number(durationSeconds) : null;
  const auto = input.startSeconds == null || input.startSeconds === '' || input.auto === true;
  let start;
  if(auto) start = duration ? Math.round(duration * 0.3) : 30; // about a third in = usually past the intro
  else start = Math.max(0, Math.round(Number(input.startSeconds) || 0));
  if(duration){
    if(duration <= length) return { start:0, length:Math.max(1, Math.floor(duration * 0.5)), auto, shortTrack:true };
    start = Math.min(start, Math.floor(duration - length));
  }
  return { start, length, auto };
}

// FFmpeg arguments: cut, fade in/out, and (optionally) mix the voice tag in every 20 seconds.
function previewFfmpegArgs({ input, output, start, length, tagPath }){
  const fadeOut = Math.max(0, length - 2);
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-t', String(length), '-i', input];
  let filter = `[0:a]afade=t=in:d=0.5,afade=t=out:st=${fadeOut}:d=2[main]`;
  if(tagPath){
    const times = [];
    for(let t = 2; t < length - 1; t += TAG_EVERY_SECONDS) times.push(t);
    args.push('-i', tagPath);
    filter += `;[1:a]aresample=44100,volume=1.4,asplit=${times.length}${times.map((_, i) => `[t${i}]`).join('')}`;
    times.forEach((t, i) => { filter += `;[t${i}]adelay=${t * 1000}:all=1[d${i}]`; });
    filter += `;[main]${times.map((_, i) => `[d${i}]`).join('')}amix=inputs=${times.length + 1}:duration=first:normalize=0[out]`;
  }else filter = filter.replace('[main]', '[out]');
  args.push('-filter_complex', filter, '-map', '[out]', '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k', output);
  return args;
}

function runFfmpeg(ffmpegPath, args, timeoutMs = 60000){
  return new Promise(resolve => {
    let err = '';
    let child;
    try{ child = spawn(ffmpegPath, args, { stdio:['ignore', 'ignore', 'pipe'] }); }catch(e){ resolve({ error:e }); return; }
    const timer = setTimeout(() => { try{ child.kill('SIGKILL'); }catch(e){} }, timeoutMs);
    child.stderr.on('data', d => { if(err.length < 4000) err += String(d); });
    child.on('error', e => { clearTimeout(timer); resolve({ error:e }); });
    child.on('close', code => { clearTimeout(timer); resolve(code === 0 ? { ok:true } : { error:new Error(`ffmpeg exited ${code}: ${err.slice(0, 300)}`) }); });
  });
}

// Cuts a preview from local audio. deps: { ffmpegPath }.
async function cutPreviewFile(inputPath, opts = {}, deps = {}){
  const ffmpegPath = deps.ffmpegPath;
  if(!ffmpegPath) return { ffmpegUnavailable:true };
  const out = path.join(os.tmpdir(), `djb-preview-${crypto.randomBytes(6).toString('hex')}.mp3`);
  const tagPath = opts.voiceTag && fs.existsSync(VOICE_TAG_PATH) ? VOICE_TAG_PATH : null;
  const run = await runFfmpeg(ffmpegPath, previewFfmpegArgs({ input:inputPath, output:out, start:opts.start, length:opts.length, tagPath }));
  if(run.error) return { error:run.error };
  return { file:out, tagged:Boolean(tagPath) };
}

async function blobToBuffer(data){
  if(!data) return null;
  if(Buffer.isBuffer(data)) return data;
  if(typeof data.arrayBuffer === 'function') return Buffer.from(await data.arrayBuffer());
  if(data instanceof ArrayBuffer) return Buffer.from(data);
  return null;
}

// Seller makes (or remakes) the preview. deps: { storage, ffmpegPath }.
async function generateListingPreview(db, userId, listingId, input = {}, deps = {}, now = new Date()){
  const owned = await loadOwnedListing(db, userId, listingId);
  if(owned.error || owned.forbidden || owned.unavailable || owned.validationError) return owned;
  if(rateLimited(`preview:${userId}`, now.getTime(), 10, 60 * 60 * 1000)) return { rateLimited:true };
  if(!deps.ffmpegPath) return { ffmpegUnavailable:true };
  const { listing, product } = owned;
  const source = product.audio_storage_object_path;
  if(!source || !/^private\/(library-audio|battle-entries)\//.test(source)) return { validationError:'This beat has no uploaded audio to preview' };
  const win = previewWindow(product.duration, input);
  const voiceTag = input.voiceTag !== false;
  const dl = await deps.storage.download(source);
  if(dl.error) return { error:dl.error };
  const buf = await blobToBuffer(dl.data);
  if(!buf || !buf.length) return { validationError:'Couldn\'t read the beat\'s audio' };
  const tmpIn = path.join(os.tmpdir(), `djb-src-${crypto.randomBytes(6).toString('hex')}`);
  fs.writeFileSync(tmpIn, buf);
  let cut;
  try{ cut = await cutPreviewFile(tmpIn, { start:win.start, length:win.length, voiceTag }, deps); }finally{ try{ fs.unlinkSync(tmpIn); }catch(e){} }
  if(cut.ffmpegUnavailable) return cut;
  if(cut.error) return { error:cut.error };
  const objectPath = `${PREVIEW_PREFIX}${product.id}/${crypto.randomBytes(8).toString('hex')}.mp3`;
  let upload;
  try{ upload = await deps.storage.upload(objectPath, fs.readFileSync(cut.file), { contentType:'audio/mpeg', upsert:true }); }finally{ try{ fs.unlinkSync(cut.file); }catch(e){} }
  if(upload.error) return { error:upload.error };
  const old = product.preview_storage_object_path;
  const ts = now.toISOString();
  const pu = await db.from(Market.MARKETPLACE_PRODUCT_TABLE).update({ preview_storage_object_path:objectPath, updated_at:ts }).eq('id', product.id);
  if(pu.error) return { error:pu.error };
  const meta = { ...(listing.metadata && typeof listing.metadata === 'object' ? listing.metadata : {}), preview:{ startSeconds:win.start, lengthSeconds:win.length, auto:win.auto, voiceTag:cut.tagged, madeAt:ts } };
  const lu = await db.from(Market.MARKETPLACE_LISTING_TABLE).update({ preview_enabled:true, preview_duration:win.length, metadata:meta, updated_at:ts }).eq('id', listing.id);
  if(lu.error) return { error:lu.error };
  if(old && old !== objectPath && old.startsWith(PREVIEW_PREFIX) && typeof deps.storage.remove === 'function'){ try{ await deps.storage.remove([old]); }catch(e){} }
  return { preview:{ listingId:listing.id, startSeconds:win.start, lengthSeconds:win.length, auto:win.auto, voiceTag:cut.tagged, shortTrack:Boolean(win.shortTrack) } };
}

/* ============================== 3. Wishlist ============================== */
const wfail = r => (isMissingTable(r.error) ? { schemaMissing:true, schema:WISHLIST_SCHEMA } : { error:r.error });

async function listWishlist(db, userId){
  const r = await db.from(WISHLIST_TABLE).select('*').eq('user_id', String(userId)).limit(MAX_WISHLIST);
  if(r.error) return wfail(r);
  const rows = (r.data || []).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const items = [];
  for(const row of rows){
    const got = await Market.getMarketplaceListing(db, row.listing_id);
    const listing = got && got.listing;
    items.push({ listingId:row.listing_id, savedAt:row.created_at, savedPriceCents:row.saved_price_cents == null ? null : Number(row.saved_price_cents), available:Boolean(listing),
      title:listing ? listing.title : 'No longer available', priceCents:listing ? Number(listing.displayPriceCents) || 0 : null, currency:listing ? listing.currency : 'USD',
      priceDropped:Boolean(listing && row.saved_price_cents != null && Number(listing.displayPriceCents) < Number(row.saved_price_cents)) });
  }
  return { items, listingIds:items.map(i => i.listingId) };
}

async function addToWishlist(db, userId, listingId, now = new Date()){
  const id = cleanId(listingId, 160);
  if(!id) return { validationError:'A beat is required' };
  if(rateLimited(`wishlist:${userId}`, now.getTime(), 60, 60 * 60 * 1000)) return { rateLimited:true };
  const got = await Market.getMarketplaceListing(db, id);
  if(got.error) return { error:got.error };
  if(!got.listing) return { unavailable:true };
  const listingRow = await db.from(Market.MARKETPLACE_LISTING_TABLE).select('*').eq('id', id).limit(1);
  if(listingRow.error) return { error:listingRow.error };
  if((listingRow.data || [])[0] && String(listingRow.data[0].seller_user_id) === String(userId)) return { validationError:'That\'s your own beat' };
  const existing = await db.from(WISHLIST_TABLE).select('*').eq('user_id', String(userId)).limit(MAX_WISHLIST + 1);
  if(existing.error) return wfail(existing);
  if((existing.data || []).some(r => r.listing_id === id)) return { saved:true, duplicate:true };
  if((existing.data || []).length >= MAX_WISHLIST) return { validationError:`Your wishlist is full (${MAX_WISHLIST} beats)` };
  const ins = await db.from(WISHLIST_TABLE).insert([{ user_id:String(userId), listing_id:id, saved_price_cents:Number(got.listing.displayPriceCents) || 0, created_at:now.toISOString() }]);
  if(ins.error) return /duplicate|unique/i.test(String(ins.error.message)) ? { saved:true, duplicate:true } : wfail(ins);
  return { saved:true };
}

async function removeFromWishlist(db, userId, listingId){
  const id = cleanId(listingId, 160);
  if(!id) return { validationError:'A beat is required' };
  const del = await db.from(WISHLIST_TABLE).delete().eq('user_id', String(userId)).eq('listing_id', id);
  if(del && del.error) return wfail(del);
  return { removed:true };
}

const money = cents => `$${(Number(cents) / 100).toFixed(2)}`;

async function savers(db, listingId){
  const r = await db.from(WISHLIST_TABLE).select('*').eq('listing_id', String(listingId)).limit(5000);
  if(r.error) return isMissingTable(r.error) ? [] : [];
  return r.data || [];
}

// Called after a seller changes a price. Only a real drop on a paid beat alerts anyone.
async function notifyPriceDrop(db, { listingId, sellerUserId, title, oldCents, newCents }, now = new Date()){
  const before = Number(oldCents) || 0, after = Number(newCents) || 0;
  if(!(after < before)) return { notified:0 };
  let n = 0;
  for(const row of await savers(db, listingId)){
    if(String(row.user_id) === String(sellerUserId)) continue;
    const r = await notifyQuietly(db, { recipientUserId:row.user_id, actorUserId:sellerUserId, type:'wishlist_alert', subjectId:listingId, eventKey:`wishlist-price:${listingId}:${after}`,
      destination:{ type:'store', listingId, label:'Open the Beat Store' },
      summary:after === 0 ? `${cleanText(title, 80) || 'A beat you saved'} is now free.` : `${cleanText(title, 80) || 'A beat you saved'} dropped from ${money(before)} to ${money(after)}.`, now });
    if(r && !r.error) n++;
  }
  return { notified:n };
}

// Called when a seller creates (or turns back on) a discount code. Codes cover all their beats.
async function notifyDiscountCode(db, { sellerUserId, code }, now = new Date()){
  if(!code || !code.code || code.active === false || (code.state && code.state !== 'live')) return { notified:0 };
  const listings = await db.from(Market.MARKETPLACE_LISTING_TABLE).select('*').eq('seller_user_id', String(sellerUserId));
  if(listings.error) return { notified:0 };
  const paid = (listings.data || []).filter(l => l.status === 'published' && Number(l.display_price_cents) > 0);
  const off = code.kind === 'percent' ? `${code.percentOff}% off` : `${money(code.amountOffCents)} off`;
  const told = new Set();
  let n = 0;
  for(const listing of paid){
    for(const row of await savers(db, listing.id)){
      if(String(row.user_id) === String(sellerUserId) || told.has(String(row.user_id))) continue;
      told.add(String(row.user_id)); // one alert per person per code, even if they saved several beats
      const r = await notifyQuietly(db, { recipientUserId:row.user_id, actorUserId:sellerUserId, type:'wishlist_alert', subjectId:listing.id, eventKey:`wishlist-code:${code.id}:${row.user_id}`,
        destination:{ type:'store', listingId:listing.id, label:'Open the Beat Store' },
        summary:`Code ${cleanText(code.code, 20)} takes ${off} ${cleanText(listing.title, 80) || 'a beat you saved'}${code.endsAt ? ` until ${new Date(code.endsAt).toDateString()}` : ''}.`, now });
      if(r && !r.error) n++;
    }
  }
  return { notified:n };
}

module.exports = {
  WISHLIST_TABLE, WISHLIST_SCHEMA, PREVIEW_PREFIX, VOICE_TAG_PATH, MIN_PREVIEW, MAX_PREVIEW, DEFAULT_PREVIEW,
  LICENCE_CHOICES, LICENCE_TERMS, LICENCE_VERSION, licenceTerms, licenceText, setListingLicence,
  previewWindow, previewFfmpegArgs, cutPreviewFile, generateListingPreview,
  listWishlist, addToWishlist, removeFromWishlist, notifyPriceDrop, notifyDiscountCode
};
