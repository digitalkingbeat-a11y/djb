const { createHash, randomUUID } = require('crypto');
const { sanitizePublicProfile, PROGRESSION_PROFILE_TABLE } = require('./battle_award_ledger');
const { stablePublicProfileId, getPublicBattleResult } = require('./battle_result_history');
const { getOwnedLibraryTrack, recordLibraryTrackUsage } = require('./music_library');
const {
  DJ_BLOCKS_TABLE,
  DJ_FOLLOWS_TABLE,
  DJ_NOTIFICATION_MUTES_TABLE,
  DJ_NOTIFICATIONS_TABLE
} = require('./dj_challenges');

const COMMUNITY_CATEGORIES_TABLE = 'community_categories';
const COMMUNITY_POSTS_TABLE = 'community_posts';
const COMMUNITY_COMMENTS_TABLE = 'community_comments';
const COMMUNITY_REACTIONS_TABLE = 'community_reactions';
const COMMUNITY_REPORTS_TABLE = 'community_reports';
const COMMUNITY_MODERATION_ACTIONS_TABLE = 'community_moderation_actions';

const COMMUNITY_REACTION_TYPES = new Set(['like', 'fire', 'respect', 'technique']);
const COMMUNITY_REPORT_REASONS = new Set(['spam', 'harassment', 'copyright', 'private_info', 'unsafe_content', 'off_topic', 'other']);
const COMMUNITY_FEEDS = new Set(['recent', 'following', 'popular', 'category', 'my_posts']);
const COMMUNITY_POST_VISIBILITIES = new Set(['public', 'followers', 'private']);
const COMMUNITY_STATUSES = new Set(['active', 'hidden', 'locked', 'deleted']);
const COMMUNITY_MODERATION_ACTIONS = new Set(['review', 'hide', 'restore', 'lock_comments', 'unlock_comments', 'remove_attachment']);
const COMMUNITY_RATE_STATE = new Map();
const DEFAULT_COMMUNITY_LIMIT = 20;
const MAX_COMMUNITY_LIMIT = 50;
const COMMUNITY_SCAN_LIMIT = 500;
const BLOCKED_RIGHTS = new Set(['commercial_copyrighted', 'blocked', 'unlicensed', 'rights_blocked', 'copyright_blocked']);

const DEFAULT_CATEGORIES = Object.freeze([
  { id:'general', slug:'general', label:'General DJ Discussion', description:'General DJ discussion and questions.', sort_order:10, server_default:true },
  { id:'battle_talk', slug:'battle_talk', label:'Battle Talk', description:'Battle prep, opponent reads and judging talk.', sort_order:20, server_default:true },
  { id:'production', slug:'production', label:'Production', description:'Production, edits, flips and mixdown talk.', sort_order:30, server_default:true },
  { id:'gear', slug:'gear', label:'Gear', description:'CDJs, turntables, controllers, mixers and setup notes.', sort_order:40, server_default:true },
  { id:'events', slug:'events', label:'Events', description:'Shows, battles, meetups and streams.', sort_order:50, server_default:true },
  { id:'hip_hop', slug:'hip_hop', label:'Hip-Hop', description:'Hip-hop DJing, selection and scratch culture.', sort_order:60, server_default:true },
  { id:'house', slug:'house', label:'House', description:'House, tech house and club programming.', sort_order:70, server_default:true },
  { id:'scratch', slug:'scratch', label:'Scratching', description:'Scratch technique, drills and routines.', sort_order:80, server_default:true },
  { id:'open_format', slug:'open_format', label:'Open Format', description:'Open-format programming and transitions.', sort_order:90, server_default:true }
]);

function tableQuery(dataClient, table){
  return dataClient.from(table).select('*');
}

function plainObject(value){
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeArray(value){
  return Array.isArray(value) ? value : [];
}

function cleanString(value, max = 160){
  if(value == null) return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return text ? text.slice(0, max) : null;
}

function safeNumber(value){
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nowIso(now = new Date()){
  return now instanceof Date ? now.toISOString() : new Date(now || Date.now()).toISOString();
}

function safeDate(value){
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function stableHash(value){
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function stableId(prefix, value){
  return `${prefix}-${stableHash(value).slice(0, 24)}`;
}

function optionalTableMissing(error){
  const message = String(error && (error.message || error.details || error.hint || error.code || error) || '').toLowerCase();
  return message.includes('does not exist')
    || message.includes('schema cache')
    || message.includes('could not find')
    || message.includes('relation')
    || message.includes('42p01');
}

function normalizeLimit(value, fallback = DEFAULT_COMMUNITY_LIMIT){
  const number = Number(value);
  if(!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(MAX_COMMUNITY_LIMIT, Math.max(1, Math.floor(number)));
}

function normalizePage(value){
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 1;
}

function cursorOffset(cursor){
  const match = String(cursor || '').match(/^offset_(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function paginationFor(total, offset, limit){
  const nextOffset = offset + limit;
  return {
    cursor: offset ? `offset_${offset}` : null,
    nextCursor: nextOffset < total ? `offset_${nextOffset}` : null,
    limit,
    total,
    hasMore: nextOffset < total,
    page: Math.floor(offset / limit) + 1,
    nextPage: nextOffset < total ? Math.floor(nextOffset / limit) + 1 : null
  };
}

function normalizeCategoryId(value){
  return cleanString(value, 80) || 'general';
}

function sanitizeCategory(row){
  const fallback = DEFAULT_CATEGORIES.find(item => item.id === row.id || item.slug === row.slug) || {};
  return {
    id: cleanString(row.id || row.slug || fallback.id, 80) || 'general',
    slug: cleanString(row.slug || row.id || fallback.slug, 80) || 'general',
    label: cleanString(row.label || row.name || fallback.label, 120) || 'General DJ Discussion',
    description: cleanString(row.description || fallback.description, 260),
    sortOrder: safeNumber(row.sort_order ?? row.sortOrder ?? fallback.sort_order) || 0,
    status: cleanString(row.status, 40) || 'active',
    serverDefault: row.server_default === true || fallback.server_default === true
  };
}

async function listCommunityCategories(dataClient){
  const result = await tableQuery(dataClient, COMMUNITY_CATEGORIES_TABLE).limit(200);
  if(result.error){
    if(optionalTableMissing(result.error)) return { categories: DEFAULT_CATEGORIES.map(sanitizeCategory), configurationRequired:true };
    return { error:result.error };
  }
  const rows = result.data && result.data.length ? result.data : DEFAULT_CATEGORIES;
  const categories = rows.map(sanitizeCategory)
    .filter(row => row.status !== 'archived')
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
  return { categories, configurationRequired:!result.data || !result.data.length };
}

async function validateCategory(dataClient, value){
  const categoryId = normalizeCategoryId(value);
  const listed = await listCommunityCategories(dataClient);
  if(listed.error) return listed;
  const category = listed.categories.find(row => row.id === categoryId || row.slug === categoryId);
  if(!category) return { validationError:'Choose an available community category.' };
  return { category };
}

async function fetchProfiles(dataClient){
  const result = await tableQuery(dataClient, PROGRESSION_PROFILE_TABLE).limit(2000);
  if(result.error){
    if(optionalTableMissing(result.error)) return { rows:[], byUser:new Map(), byPublic:new Map(), missing:true };
    return { error:result.error };
  }
  const byUser = new Map();
  const byPublic = new Map();
  (result.data || []).forEach(row => {
    const profile = publicProfileFromRow(row);
    byUser.set(String(row.user_id), { row, profile });
    if(profile.publicProfileId) byPublic.set(String(profile.publicProfileId), { row, profile });
    if(row.public_profile_id) byPublic.set(String(row.public_profile_id), { row, profile });
  });
  return { rows:result.data || [], byUser, byPublic };
}

function publicProfileFromRow(row){
  const embedded = plainObject(row && row.public_profile);
  const visibility = cleanString(row && row.visibility, 40) || cleanString(embedded.visibility, 40) || 'public';
  const profile = sanitizePublicProfile({
    ...embedded,
    publicProfileId: row && (row.public_profile_id || embedded.publicProfileId),
    displayName: row && (row.display_name || embedded.displayName || embedded.name || embedded.djName),
    country: row && (row.country || embedded.country),
    flag: embedded.flag,
    belt: row && (row.belt || embedded.belt),
    visibility
  }, row && row.user_id);
  if(profile.visibility === 'private' || visibility === 'private'){
    return {
      publicProfileId:null,
      displayName:'Private DJ',
      name:'Private DJ',
      profileVisibility:'private',
      country:null,
      flag:null,
      belt:'Unranked',
      rating:null,
      rank:null
    };
  }
  return {
    publicProfileId:profile.publicProfileId,
    displayName:profile.displayName,
    name:profile.displayName,
    profileVisibility:'public',
    country:profile.country || null,
    flag:profile.flag || null,
    belt:profile.belt || row.belt || 'Unranked',
    rating:safeNumber(row.rating ?? row.ranking_rating),
    rank:safeNumber(row.global_rank || row.rank)
  };
}

async function profileForUser(dataClient, userId, profiles){
  const resolved = profiles || await fetchProfiles(dataClient);
  if(resolved.error) return resolved;
  const found = resolved.byUser.get(String(userId));
  if(found) return { profile:found.profile, profiles:resolved };
  const fallback = sanitizePublicProfile({ publicProfileId:stablePublicProfileId(userId), displayName:'DJ' }, userId);
  return {
    profile:{
      ...fallback,
      name:fallback.displayName,
      profileVisibility:fallback.visibility
    },
    profiles:resolved
  };
}

async function fetchRows(dataClient, table, limit = COMMUNITY_SCAN_LIMIT){
  const result = await tableQuery(dataClient, table).limit(limit);
  if(result.error){
    if(optionalTableMissing(result.error)) return { rows:[], missing:true };
    return { error:result.error };
  }
  return { rows:result.data || [] };
}

function activeBlockRows(rows){
  return safeArray(rows).filter(row => row.active !== false && row.status !== 'inactive' && !row.removed_at);
}

function blockedBetween(rows, userA, userB){
  if(!userA || !userB) return false;
  return activeBlockRows(rows).some(row => {
    const blocker = String(row.blocker_user_id || '');
    const blocked = String(row.blocked_user_id || '');
    return (blocker === String(userA) && blocked === String(userB))
      || (blocker === String(userB) && blocked === String(userA));
  });
}

function activeFollowRows(rows){
  return safeArray(rows).filter(row => row.active !== false && row.status !== 'inactive' && !row.unfollowed_at);
}

function normalizeVisibility(value){
  const key = String(value || '').toLowerCase();
  return COMMUNITY_POST_VISIBILITIES.has(key) ? key : 'public';
}

function postStatus(row){
  const status = String(row && row.status || '').toLowerCase();
  if(row && row.deleted_at) return 'deleted';
  if(COMMUNITY_STATUSES.has(status)) return status;
  return 'active';
}

function commentStatus(row){
  const status = String(row && row.status || '').toLowerCase();
  if(row && row.deleted_at) return 'deleted';
  if(status === 'hidden') return 'hidden';
  return 'active';
}

function sanitizeBodyText(value, max = 4000){
  return (cleanString(value, max) || '').replace(/\s+$/g, '');
}

function safeLinksFromText(value){
  const seen = new Set();
  const links = [];
  const text = String(value || '');
  const matches = text.match(/https?:\/\/[^\s<>"')]+/gi) || [];
  for(const match of matches){
    try{
      const url = new URL(match);
      if(!['http:', 'https:'].includes(url.protocol)) continue;
      const normalized = url.toString().slice(0, 240);
      if(!seen.has(normalized)){
        seen.add(normalized);
        links.push({ url:normalized, host:url.hostname.slice(0, 120) });
      }
    }catch(err){}
    if(links.length >= 5) break;
  }
  return links;
}

function sanitizeReactionType(value){
  const type = String(value || '').toLowerCase();
  return COMMUNITY_REACTION_TYPES.has(type) ? type : null;
}

function safeTargetType(value){
  const type = String(value || '').toLowerCase();
  return ['post', 'comment'].includes(type) ? type : null;
}

function targetKey(type, id){
  return `${type}:${id}`;
}

function countComments(rows){
  const counts = new Map();
  safeArray(rows).forEach(row => {
    if(commentStatus(row) !== 'active') return;
    const postId = String(row.post_id || '');
    if(!postId) return;
    counts.set(postId, (counts.get(postId) || 0) + 1);
  });
  return counts;
}

function countReactions(rows){
  const counts = new Map();
  safeArray(rows).forEach(row => {
    if(row.active === false || row.removed_at) return;
    const type = sanitizeReactionType(row.reaction_type || row.type);
    const targetType = safeTargetType(row.target_type);
    const targetId = cleanString(row.target_id, 128);
    if(!type || !targetType || !targetId) return;
    const key = targetKey(targetType, targetId);
    const current = counts.get(key) || { like:0, fire:0, respect:0, technique:0, total:0 };
    current[type] += 1;
    current.total += 1;
    counts.set(key, current);
  });
  return counts;
}

function viewerReactions(rows, viewerUserId){
  const byTarget = new Map();
  if(!viewerUserId) return byTarget;
  safeArray(rows).forEach(row => {
    if(row.active === false || row.removed_at || String(row.user_id) !== String(viewerUserId)) return;
    const type = sanitizeReactionType(row.reaction_type || row.type);
    const targetType = safeTargetType(row.target_type);
    const targetId = cleanString(row.target_id, 128);
    if(!type || !targetType || !targetId) return;
    const key = targetKey(targetType, targetId);
    const current = byTarget.get(key) || [];
    if(!current.includes(type)) current.push(type);
    byTarget.set(key, current);
  });
  return byTarget;
}

function sanitizeAttachmentSnapshot(attachment){
  const row = plainObject(attachment);
  const type = cleanString(row.type, 40);
  if(type === 'library_track' || type === 'profile_media'){
    const safe = {
      id: cleanString(row.id, 128),
      type,
      mediaId: cleanString(row.mediaId || row.trackId, 128),
      title: cleanString(row.title, 160) || 'Library media',
      artist: cleanString(row.artist, 120),
      duration: safeNumber(row.duration),
      bpm: safeNumber(row.bpm),
      key: cleanString(row.key, 40),
      camelotKey: cleanString(row.camelotKey, 8),
      genre: cleanString(row.genre, 80),
      rightsClassification: cleanString(row.rightsClassification, 80) || 'unknown',
      rightsStatus: cleanString(row.rightsStatus, 60) || 'classified',
      sourceType: cleanString(row.sourceType, 60) || 'track',
      artwork: plainObject(row.artwork),
      playbackPermitted: row.playbackPermitted === true,
      playbackContract: 'protected_on_site_library_playback',
      status: cleanString(row.status, 60) || 'available',
      unavailableReason: cleanString(row.unavailableReason, 160)
    };
    delete safe.artwork.storagePath;
    delete safe.artwork.storageObjectPath;
    delete safe.artwork.signedUrl;
    delete safe.artwork.privateUrl;
    return safe;
  }
  if(type === 'verified_result'){
    return {
      id: cleanString(row.id, 128),
      type,
      verifiedResultId: cleanString(row.verifiedResultId, 96),
      title: cleanString(row.title, 160) || 'Verified battle result',
      score: safeNumber(row.score),
      outcome: cleanString(row.outcome, 40),
      battle: {
        modeId: cleanString(plainObject(row.battle).modeId, 80),
        type: cleanString(plainObject(row.battle).type, 120),
        genre: cleanString(plainObject(row.battle).genre, 80)
      },
      reward: safeCommunityReward(row.reward),
      scoringSource: safeArray(row.scoringSource).map(item => cleanString(item, 80)).filter(Boolean).slice(0, 5),
      status: cleanString(row.status, 60) || 'available'
    };
  }
  return null;
}

function safeCommunityReward(reward){
  const source = plainObject(reward);
  if(source.type === 'bitcoin'){
    return {
      type:'bitcoin',
      transferStatus:'untransferred',
      metadata:{
        network: cleanString(plainObject(source.metadata).network, 40) || 'bitcoin',
        amountSats: safeNumber(plainObject(source.metadata).amountSats),
        custody: cleanString(plainObject(source.metadata).custody, 80) || 'external_pending'
      }
    };
  }
  return { type: cleanString(source.type, 40) || 'standard', metadata:{} };
}

function trackCommunityApproved(row){
  const permissions = plainObject(row.permissions || row.public_permissions || row.usage_permissions);
  const media = plainObject(row.profile_media || row.media_permissions || row.community_media);
  return row.community_approved === true
    || row.community_public === true
    || row.profile_media_public === true
    || row.public_profile_media === true
    || permissions.community === true
    || permissions.communityPost === true
    || permissions.publicProfile === true
    || media.community === true
    || String(row.visibility || '').toLowerCase() === 'public';
}

function trackRightsState(row){
  const rights = cleanString(row.rights_classification || row.rightsClassification, 80) || 'unknown';
  if(BLOCKED_RIGHTS.has(rights)) return { rights, blocked:true, status:'rights_blocked' };
  if(rights === 'unknown') return { rights, blocked:false, status:'rights_unverified' };
  return { rights, blocked:false, status:'classified' };
}

async function sanitizeIncomingAttachment(dataClient, userId, item, now = new Date()){
  const source = plainObject(item);
  const type = cleanString(source.type || source.kind, 40);
  if(!type) return { validationError:'Attachment type is required.' };
  if(type === 'library_track' || type === 'profile_media'){
    const trackId = cleanString(source.mediaId || source.trackId || source.id, 128);
    if(!trackId) return { validationError:'Choose an owned library media item.' };
    if(source.storagePath || source.storageObjectPath || source.signedUrl || source.url) return { validationError:'Community media must use owned media IDs, not storage paths or signed URLs.' };
    const owned = await getOwnedLibraryTrack(dataClient, userId, trackId);
    if(owned.error) return owned;
    if(owned.forbidden) return { forbidden:true };
    if(owned.unavailable || !owned.track) return { unavailable:true };
    const rights = trackRightsState(owned.track);
    if(rights.blocked) return { validationError:'This media rights classification cannot be posted to the community.' };
    if(!trackCommunityApproved(owned.track)) return { validationError:'Media must be approved for public profile or community use before it can be attached.' };
    const artwork = plainObject(owned.track.artwork_metadata);
    return {
      attachment:sanitizeAttachmentSnapshot({
        id: stableId('community-attachment', { type, trackId, userId, now:nowIso(now) }),
        type,
        mediaId: trackId,
        title: owned.track.title,
        artist: owned.track.artist,
        duration: owned.track.duration,
        bpm: owned.track.bpm,
        key: owned.track.key,
        camelotKey: owned.track.camelot_key,
        genre: owned.track.genre,
        rightsClassification:rights.rights,
        rightsStatus:rights.status,
        sourceType:owned.track.source_type,
        artwork: artwork ? { mimeType:artwork.mimeType, size:safeNumber(artwork.size), updatedAt:cleanString(artwork.updatedAt || owned.track.updated_at, 80) } : null,
        playbackPermitted:Boolean(owned.track.audio_storage_object_path || owned.track.linked_submission_id),
        status:'available'
      })
    };
  }
  if(type === 'verified_result'){
    const verifiedResultId = cleanString(source.verifiedResultId || source.resultId || source.id, 96);
    if(!verifiedResultId) return { validationError:'Choose a public verified result.' };
    const result = await getPublicBattleResult(dataClient, verifiedResultId);
    if(result.error) return result;
    if(result.private || result.notFound || result.unavailable) return { unavailable:true };
    return {
      attachment:sanitizeAttachmentSnapshot({
        id: stableId('community-result-attachment', { verifiedResultId, userId }),
        type:'verified_result',
        verifiedResultId,
        title: result.result.battle && result.result.battle.title || 'Verified battle result',
        score: result.result.score,
        outcome: result.result.outcome,
        battle: result.result.battle,
        reward: result.result.reward,
        scoringSource: result.result.scoringSource,
        status:'available'
      })
    };
  }
  return { validationError:'Choose an approved community attachment type.' };
}

async function sanitizeIncomingAttachments(dataClient, userId, attachments = [], now = new Date()){
  const selected = safeArray(attachments).slice(0, 4);
  const sanitized = [];
  for(const item of selected){
    const result = await sanitizeIncomingAttachment(dataClient, userId, item, now);
    if(result.error || result.validationError || result.forbidden || result.unavailable) return result;
    if(result.attachment) sanitized.push(result.attachment);
  }
  return { attachments:sanitized };
}

async function refreshAttachmentAvailability(dataClient, attachments){
  const refreshed = [];
  for(const attachment of safeArray(attachments).map(sanitizeAttachmentSnapshot).filter(Boolean)){
    if(['library_track', 'profile_media'].includes(attachment.type) && attachment.mediaId){
      const result = await tableQuery(dataClient, 'music_library_tracks').eq('id', attachment.mediaId).limit(1).single();
      if(result.error){
        refreshed.push({ ...attachment, status:optionalTableMissing(result.error) ? 'unavailable' : 'unavailable', unavailableReason:'Media availability cannot be verified.' });
        continue;
      }
      const track = result.data;
      if(!track || track.archived_at || !trackCommunityApproved(track)){
        refreshed.push({ ...attachment, status:'unavailable', playbackPermitted:false, unavailableReason:'Media is no longer public-approved.' });
        continue;
      }
      const rights = trackRightsState(track);
      if(rights.blocked){
        refreshed.push({ ...attachment, status:'rights_blocked', playbackPermitted:false, unavailableReason:'Media rights no longer permit community playback.' });
        continue;
      }
      refreshed.push({ ...attachment, status:rights.status === 'rights_unverified' ? 'rights_unverified' : 'available', playbackPermitted:attachment.playbackPermitted === true });
    }else{
      refreshed.push(attachment);
    }
  }
  return refreshed;
}

function sanitizePost(row, options = {}){
  if(!row) return null;
  const viewerUserId = options.viewerUserId ? String(options.viewerUserId) : '';
  const isOwner = viewerUserId && String(row.user_id) === viewerUserId;
  const status = postStatus(row);
  const counts = options.reactionCounts || { like:0, fire:0, respect:0, technique:0, total:0 };
  const author = options.authorProfile || { displayName:'DJ', profileVisibility:'public' };
  const base = {
    id:String(row.id),
    categoryId:normalizeCategoryId(row.category_id || row.categoryId),
    visibility:normalizeVisibility(row.visibility),
    status,
    createdAt:row.created_at || null,
    updatedAt:row.updated_at || null,
    editedAt:row.edited_at || null,
    deletedAt:row.deleted_at || null,
    locked:Boolean(row.locked_at || status === 'locked'),
    hidden:Boolean(row.hidden_at || status === 'hidden'),
    author,
    viewer:{ canEdit:Boolean(isOwner && status !== 'deleted'), canDelete:Boolean(isOwner && status !== 'deleted'), isOwner:Boolean(isOwner) },
    reactionCounts:counts,
    viewerReactionTypes:options.viewerReactionTypes || [],
    commentCount:options.commentCount || 0
  };
  if(status === 'deleted'){
    return { ...base, title:'Deleted post', bodyText:'', tombstone:true, attachments:[], safeLinks:[] };
  }
  if(status === 'hidden' && !isOwner){
    return { ...base, title:'Hidden post', bodyText:'', tombstone:true, attachments:[], safeLinks:[] };
  }
  return {
    ...base,
    title:cleanString(row.title, 180) || 'Community post',
    bodyText:sanitizeBodyText(row.body_text || row.bodyText, 4000),
    safeLinks:safeArray(row.safe_links || row.safeLinks).map(link => ({ url:cleanString(plainObject(link).url, 240), host:cleanString(plainObject(link).host, 120) })).filter(link => link.url),
    attachments:safeArray(options.attachments || row.attachments).map(sanitizeAttachmentSnapshot).filter(Boolean)
  };
}

function sanitizeComment(row, options = {}){
  if(!row) return null;
  const viewerUserId = options.viewerUserId ? String(options.viewerUserId) : '';
  const isOwner = viewerUserId && String(row.user_id) === viewerUserId;
  const status = commentStatus(row);
  const counts = options.reactionCounts || { like:0, fire:0, respect:0, technique:0, total:0 };
  const author = options.authorProfile || { displayName:'DJ', profileVisibility:'public' };
  const base = {
    id:String(row.id),
    postId:String(row.post_id),
    parentCommentId:cleanString(row.parent_comment_id, 128),
    status,
    createdAt:row.created_at || null,
    updatedAt:row.updated_at || null,
    editedAt:row.edited_at || null,
    deletedAt:row.deleted_at || null,
    author,
    viewer:{ canEdit:Boolean(isOwner && status !== 'deleted'), canDelete:Boolean(isOwner && status !== 'deleted'), isOwner:Boolean(isOwner) },
    reactionCounts:counts,
    viewerReactionTypes:options.viewerReactionTypes || []
  };
  if(status === 'deleted') return { ...base, bodyText:'', tombstone:true };
  if(status === 'hidden' && !isOwner) return { ...base, bodyText:'', tombstone:true };
  return { ...base, bodyText:sanitizeBodyText(row.body_text || row.bodyText, 2200), safeLinks:safeLinksFromText(row.body_text || row.bodyText) };
}

async function postById(dataClient, postId){
  const result = await tableQuery(dataClient, COMMUNITY_POSTS_TABLE).eq('id', postId).limit(1).single();
  if(result.error) return { error:result.error };
  if(!result.data) return { notFound:true };
  return { post:result.data };
}

async function commentById(dataClient, commentId){
  const result = await tableQuery(dataClient, COMMUNITY_COMMENTS_TABLE).eq('id', commentId).limit(1).single();
  if(result.error) return { error:result.error };
  if(!result.data) return { notFound:true };
  return { comment:result.data };
}

async function findExistingPostByIdempotency(dataClient, userId, key){
  if(!key) return { post:null };
  const result = await tableQuery(dataClient, COMMUNITY_POSTS_TABLE)
    .eq('user_id', userId)
    .eq('idempotency_key', key)
    .limit(1);
  if(result.error) return { error:result.error };
  return { post:result.data && result.data[0] || null };
}

async function createCommunityPost(dataClient, userId, input = {}, now = new Date()){
  const category = await validateCategory(dataClient, input.categoryId || input.category_id || input.category);
  if(category.error || category.validationError) return category;
  const idempotencyKey = cleanString(input.idempotencyKey || input.idempotency_key, 128);
  const existing = await findExistingPostByIdempotency(dataClient, userId, idempotencyKey);
  if(existing.error) return existing;
  if(existing.post){
    const profile = await profileForUser(dataClient, userId);
    const attachments = await refreshAttachmentAvailability(dataClient, existing.post.attachments || []);
    return { post:sanitizePost(existing.post, { viewerUserId:userId, authorProfile:profile.profile, attachments }), duplicate:true, created:false };
  }
  const title = cleanString(input.title, 180);
  const bodyText = sanitizeBodyText(input.bodyText || input.body_text || input.body, 4000);
  if(!title) return { validationError:'Post title is required.' };
  if(!bodyText) return { validationError:'Post body is required.' };
  const attachments = await sanitizeIncomingAttachments(dataClient, userId, input.attachments, now);
  if(attachments.error || attachments.validationError || attachments.forbidden || attachments.unavailable) return attachments;
  const createdAt = nowIso(now);
  const payload = {
    id: cleanString(input.postId || input.id, 128) || stableId('community-post', { userId, title, bodyText, idempotencyKey: idempotencyKey || randomUUID(), createdAt }),
    user_id:String(userId),
    category_id:category.category.id,
    title,
    body_text:bodyText,
    safe_links:safeLinksFromText(bodyText),
    attachments:attachments.attachments,
    visibility:normalizeVisibility(input.visibility),
    status:'active',
    idempotency_key:idempotencyKey,
    edited_at:null,
    hidden_at:null,
    locked_at:null,
    deleted_at:null,
    created_at:createdAt,
    updated_at:createdAt
  };
  const inserted = await dataClient.from(COMMUNITY_POSTS_TABLE).insert([payload]).select('*').single();
  if(inserted.error) return { error:inserted.error };
  const profile = await profileForUser(dataClient, userId);
  return { post:sanitizePost(inserted.data, { viewerUserId:userId, authorProfile:profile.profile, attachments:attachments.attachments }), created:true };
}

async function updateCommunityPost(dataClient, userId, postId, input = {}, now = new Date()){
  const found = await postById(dataClient, postId);
  if(found.error || found.notFound) return found;
  if(String(found.post.user_id) !== String(userId)) return { forbidden:true };
  if(postStatus(found.post) === 'deleted') return { unavailable:true };
  const patch = { updated_at:nowIso(now), edited_at:nowIso(now) };
  if(input.title != null){
    const title = cleanString(input.title, 180);
    if(!title) return { validationError:'Post title is required.' };
    patch.title = title;
  }
  if(input.bodyText != null || input.body_text != null || input.body != null){
    const bodyText = sanitizeBodyText(input.bodyText || input.body_text || input.body, 4000);
    if(!bodyText) return { validationError:'Post body is required.' };
    patch.body_text = bodyText;
    patch.safe_links = safeLinksFromText(bodyText);
  }
  if(input.categoryId || input.category_id || input.category){
    const category = await validateCategory(dataClient, input.categoryId || input.category_id || input.category);
    if(category.error || category.validationError) return category;
    patch.category_id = category.category.id;
  }
  if(input.visibility != null) patch.visibility = normalizeVisibility(input.visibility);
  if(input.attachments != null){
    const attachments = await sanitizeIncomingAttachments(dataClient, userId, input.attachments, now);
    if(attachments.error || attachments.validationError || attachments.forbidden || attachments.unavailable) return attachments;
    patch.attachments = attachments.attachments;
  }
  const updated = await dataClient.from(COMMUNITY_POSTS_TABLE).update(patch).eq('id', postId).eq('user_id', userId).select('*').single();
  if(updated.error) return { error:updated.error };
  const profile = await profileForUser(dataClient, userId);
  const attachments = await refreshAttachmentAvailability(dataClient, updated.data.attachments || []);
  return { post:sanitizePost(updated.data, { viewerUserId:userId, authorProfile:profile.profile, attachments }), updated:true };
}

async function deleteCommunityPost(dataClient, userId, postId, now = new Date()){
  const found = await postById(dataClient, postId);
  if(found.error || found.notFound) return found;
  if(String(found.post.user_id) !== String(userId)) return { forbidden:true };
  const timestamp = nowIso(now);
  const updated = await dataClient.from(COMMUNITY_POSTS_TABLE)
    .update({ status:'deleted', deleted_at:timestamp, updated_at:timestamp })
    .eq('id', postId)
    .eq('user_id', userId)
    .select('*')
    .single();
  if(updated.error) return { error:updated.error };
  return { post:sanitizePost(updated.data, { viewerUserId:userId }), deleted:true };
}

async function listCommunityFeed(dataClient, viewerUserId, options = {}, now = new Date()){
  const feed = COMMUNITY_FEEDS.has(String(options.feed || options.view || 'recent')) ? String(options.feed || options.view || 'recent') : 'recent';
  if(['following', 'my_posts'].includes(feed) && !viewerUserId) return { validationError:'Sign in to view this community feed.' };
  const limit = normalizeLimit(options.limit);
  const page = normalizePage(options.page);
  const offset = options.cursor ? cursorOffset(options.cursor) : (page - 1) * limit;
  const postsResult = await fetchRows(dataClient, COMMUNITY_POSTS_TABLE, COMMUNITY_SCAN_LIMIT);
  if(postsResult.error) return postsResult;
  const commentsResult = await fetchRows(dataClient, COMMUNITY_COMMENTS_TABLE, COMMUNITY_SCAN_LIMIT);
  if(commentsResult.error) return commentsResult;
  const reactionsResult = await fetchRows(dataClient, COMMUNITY_REACTIONS_TABLE, COMMUNITY_SCAN_LIMIT);
  if(reactionsResult.error) return reactionsResult;
  const profiles = await fetchProfiles(dataClient);
  if(profiles.error) return profiles;
  const blocks = await fetchRows(dataClient, DJ_BLOCKS_TABLE, 2000);
  if(blocks.error) return blocks;
  const follows = await fetchRows(dataClient, DJ_FOLLOWS_TABLE, 2000);
  if(follows.error) return follows;
  const followedIds = new Set(activeFollowRows(follows.rows).filter(row => String(row.follower_user_id) === String(viewerUserId)).map(row => String(row.followed_user_id)));
  const categoryFilter = normalizeCategoryId(options.category || options.categoryId);
  const commentCounts = countComments(commentsResult.rows);
  const reactionCounts = countReactions(reactionsResult.rows);
  const viewerReactionMap = viewerReactions(reactionsResult.rows, viewerUserId);
  let rows = safeArray(postsResult.rows).filter(row => {
    const status = postStatus(row);
    if(status === 'deleted' || status === 'hidden') return false;
    if(row.visibility !== 'public' && String(row.user_id) !== String(viewerUserId)) return false;
    if(viewerUserId && blockedBetween(blocks.rows, viewerUserId, row.user_id)) return false;
    if(feed === 'my_posts' && String(row.user_id) !== String(viewerUserId)) return false;
    if(feed === 'following' && !followedIds.has(String(row.user_id))) return false;
    if((feed === 'category' || options.category && options.category !== 'all') && categoryFilter !== 'all' && normalizeCategoryId(row.category_id) !== categoryFilter) return false;
    return true;
  });
  if(feed === 'popular'){
    rows.sort((a, b) => {
      const aScore = (reactionCounts.get(targetKey('post', a.id))?.total || 0) * 3 + (commentCounts.get(String(a.id)) || 0);
      const bScore = (reactionCounts.get(targetKey('post', b.id))?.total || 0) * 3 + (commentCounts.get(String(b.id)) || 0);
      return bScore - aScore || String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(a.id).localeCompare(String(b.id));
    });
  }else{
    rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(a.id).localeCompare(String(b.id)));
  }
  const pageRows = rows.slice(offset, offset + limit);
  const items = [];
  for(const row of pageRows){
    const author = await profileForUser(dataClient, row.user_id, profiles);
    const attachments = await refreshAttachmentAvailability(dataClient, row.attachments || []);
    items.push(sanitizePost(row, {
      viewerUserId,
      authorProfile:author.profile,
      attachments,
      reactionCounts:reactionCounts.get(targetKey('post', row.id)) || { like:0, fire:0, respect:0, technique:0, total:0 },
      viewerReactionTypes:viewerReactionMap.get(targetKey('post', row.id)) || [],
      commentCount:commentCounts.get(String(row.id)) || 0
    }));
  }
  return {
    posts:items.filter(Boolean),
    categories:(await listCommunityCategories(dataClient)).categories || [],
    feed,
    pagination:paginationFor(rows.length, offset, limit),
    generatedAt:nowIso(now),
    source:'server_community'
  };
}

async function findExistingCommentByIdempotency(dataClient, userId, postId, key){
  if(!key) return { comment:null };
  const result = await tableQuery(dataClient, COMMUNITY_COMMENTS_TABLE)
    .eq('user_id', userId)
    .eq('post_id', postId)
    .eq('idempotency_key', key)
    .limit(1);
  if(result.error) return { error:result.error };
  return { comment:result.data && result.data[0] || null };
}

async function createCommunityComment(dataClient, userId, input = {}, now = new Date()){
  const postId = cleanString(input.postId || input.post_id, 128);
  const bodyText = sanitizeBodyText(input.bodyText || input.body_text || input.body, 2200);
  if(!postId) return { validationError:'Post is required.' };
  if(!bodyText) return { validationError:'Comment body is required.' };
  const found = await postById(dataClient, postId);
  if(found.error || found.notFound) return found;
  const status = postStatus(found.post);
  if(status === 'deleted' || status === 'hidden') return { unavailable:true };
  if(found.post.locked_at || status === 'locked') return { conflict:true, reason:'Comments are locked for this post.' };
  if(found.post.visibility !== 'public' && String(found.post.user_id) !== String(userId)) return { forbidden:true };
  const blocks = await fetchRows(dataClient, DJ_BLOCKS_TABLE, 2000);
  if(blocks.error) return blocks;
  if(blockedBetween(blocks.rows, userId, found.post.user_id)) return { forbidden:true };
  const parentCommentId = cleanString(input.parentCommentId || input.parent_comment_id, 128);
  if(parentCommentId){
    const parent = await commentById(dataClient, parentCommentId);
    if(parent.error || parent.notFound) return { validationError:'Parent comment is unavailable.' };
    if(String(parent.comment.post_id) !== String(postId)) return { validationError:'Parent comment must belong to this post.' };
    if(parent.comment.parent_comment_id) return { validationError:'Only one reply level is supported.' };
  }
  const idempotencyKey = cleanString(input.idempotencyKey || input.idempotency_key, 128);
  const existing = await findExistingCommentByIdempotency(dataClient, userId, postId, idempotencyKey);
  if(existing.error) return existing;
  if(existing.comment){
    const profile = await profileForUser(dataClient, userId);
    return { comment:sanitizeComment(existing.comment, { viewerUserId:userId, authorProfile:profile.profile }), duplicate:true, created:false };
  }
  const timestamp = nowIso(now);
  const payload = {
    id: cleanString(input.commentId || input.id, 128) || stableId('community-comment', { userId, postId, bodyText, parentCommentId, idempotencyKey: idempotencyKey || randomUUID(), timestamp }),
    post_id:postId,
    parent_comment_id:parentCommentId,
    user_id:String(userId),
    body_text:bodyText,
    status:'active',
    idempotency_key:idempotencyKey,
    edited_at:null,
    deleted_at:null,
    hidden_at:null,
    created_at:timestamp,
    updated_at:timestamp
  };
  const inserted = await dataClient.from(COMMUNITY_COMMENTS_TABLE).insert([payload]).select('*').single();
  if(inserted.error) return { error:inserted.error };
  await emitCommunityNotification(dataClient, {
    recipientUserId:parentCommentId ? null : found.post.user_id,
    actorUserId:userId,
    type:parentCommentId ? 'reply_received' : 'comment_received',
    post:found.post,
    comment:inserted.data,
    parentCommentId,
    now
  });
  if(parentCommentId){
    const parent = await commentById(dataClient, parentCommentId);
    if(parent.comment) await emitCommunityNotification(dataClient, {
      recipientUserId:parent.comment.user_id,
      actorUserId:userId,
      type:'reply_received',
      post:found.post,
      comment:inserted.data,
      parentCommentId,
      now
    });
  }
  const profile = await profileForUser(dataClient, userId);
  return { comment:sanitizeComment(inserted.data, { viewerUserId:userId, authorProfile:profile.profile }), created:true };
}

async function listCommunityComments(dataClient, viewerUserId, postId, options = {}, now = new Date()){
  const found = await postById(dataClient, postId);
  if(found.error || found.notFound) return found;
  if(postStatus(found.post) === 'deleted') return { unavailable:true };
  if(found.post.visibility !== 'public' && String(found.post.user_id) !== String(viewerUserId)) return { forbidden:true };
  const limit = normalizeLimit(options.limit, 30);
  const page = normalizePage(options.page);
  const offset = options.cursor ? cursorOffset(options.cursor) : (page - 1) * limit;
  const commentsResult = await tableQuery(dataClient, COMMUNITY_COMMENTS_TABLE).eq('post_id', postId).limit(COMMUNITY_SCAN_LIMIT);
  if(commentsResult.error) return { error:commentsResult.error };
  const reactionsResult = await fetchRows(dataClient, COMMUNITY_REACTIONS_TABLE, COMMUNITY_SCAN_LIMIT);
  if(reactionsResult.error) return reactionsResult;
  const profiles = await fetchProfiles(dataClient);
  if(profiles.error) return profiles;
  const reactionCounts = countReactions(reactionsResult.rows);
  const viewerReactionMap = viewerReactions(reactionsResult.rows, viewerUserId);
  const rows = (commentsResult.data || [])
    .filter(row => commentStatus(row) !== 'hidden' || String(row.user_id) === String(viewerUserId))
    .sort((a, b) => {
      const aParent = a.parent_comment_id || a.id;
      const bParent = b.parent_comment_id || b.id;
      return String(aParent).localeCompare(String(bParent)) || String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
  const pageRows = rows.slice(offset, offset + limit);
  const comments = [];
  for(const row of pageRows){
    const author = await profileForUser(dataClient, row.user_id, profiles);
    comments.push(sanitizeComment(row, {
      viewerUserId,
      authorProfile:author.profile,
      reactionCounts:reactionCounts.get(targetKey('comment', row.id)) || { like:0, fire:0, respect:0, technique:0, total:0 },
      viewerReactionTypes:viewerReactionMap.get(targetKey('comment', row.id)) || []
    }));
  }
  return { comments:comments.filter(Boolean), pagination:paginationFor(rows.length, offset, limit), generatedAt:nowIso(now) };
}

async function updateCommunityComment(dataClient, userId, commentId, input = {}, now = new Date()){
  const found = await commentById(dataClient, commentId);
  if(found.error || found.notFound) return found;
  if(String(found.comment.user_id) !== String(userId)) return { forbidden:true };
  if(commentStatus(found.comment) === 'deleted') return { unavailable:true };
  const bodyText = sanitizeBodyText(input.bodyText || input.body_text || input.body, 2200);
  if(!bodyText) return { validationError:'Comment body is required.' };
  const timestamp = nowIso(now);
  const updated = await dataClient.from(COMMUNITY_COMMENTS_TABLE)
    .update({ body_text:bodyText, edited_at:timestamp, updated_at:timestamp })
    .eq('id', commentId)
    .eq('user_id', userId)
    .select('*')
    .single();
  if(updated.error) return { error:updated.error };
  const profile = await profileForUser(dataClient, userId);
  return { comment:sanitizeComment(updated.data, { viewerUserId:userId, authorProfile:profile.profile }), updated:true };
}

async function deleteCommunityComment(dataClient, userId, commentId, now = new Date()){
  const found = await commentById(dataClient, commentId);
  if(found.error || found.notFound) return found;
  if(String(found.comment.user_id) !== String(userId)) return { forbidden:true };
  const timestamp = nowIso(now);
  const updated = await dataClient.from(COMMUNITY_COMMENTS_TABLE)
    .update({ status:'deleted', deleted_at:timestamp, updated_at:timestamp })
    .eq('id', commentId)
    .eq('user_id', userId)
    .select('*')
    .single();
  if(updated.error) return { error:updated.error };
  return { comment:sanitizeComment(updated.data, { viewerUserId:userId }), deleted:true };
}

function checkCommunityRateLimit(key, now = new Date(), options = {}){
  const windowMs = options.windowMs || 60 * 1000;
  const max = options.max || 30;
  const nowMs = safeDate(now)?.getTime() || Date.now();
  const bucket = COMMUNITY_RATE_STATE.get(key) || [];
  const recent = bucket.filter(timestamp => nowMs - timestamp < windowMs);
  if(recent.length >= max){
    COMMUNITY_RATE_STATE.set(key, recent);
    return { rateLimited:true, retryAfterMs:Math.max(1000, windowMs - (nowMs - recent[0])) };
  }
  recent.push(nowMs);
  COMMUNITY_RATE_STATE.set(key, recent);
  return { ok:true };
}

async function validateReactionTarget(dataClient, viewerUserId, targetType, targetId){
  if(targetType === 'post'){
    const found = await postById(dataClient, targetId);
    if(found.error || found.notFound) return found;
    if(postStatus(found.post) !== 'active' && postStatus(found.post) !== 'locked') return { unavailable:true };
    if(found.post.visibility !== 'public' && String(found.post.user_id) !== String(viewerUserId)) return { forbidden:true };
    return { target:found.post, ownerUserId:found.post.user_id };
  }
  const found = await commentById(dataClient, targetId);
  if(found.error || found.notFound) return found;
  if(commentStatus(found.comment) !== 'active') return { unavailable:true };
  const post = await postById(dataClient, found.comment.post_id);
  if(post.error || post.notFound) return post;
  if(post.post.visibility !== 'public' && String(post.post.user_id) !== String(viewerUserId)) return { forbidden:true };
  return { target:found.comment, post:post.post, ownerUserId:found.comment.user_id };
}

async function toggleCommunityReaction(dataClient, userId, input = {}, now = new Date()){
  const type = sanitizeReactionType(input.type || input.reactionType || input.reaction_type);
  const targetType = safeTargetType(input.targetType || input.target_type);
  const targetId = cleanString(input.targetId || input.target_id, 128);
  if(!type || !targetType || !targetId) return { validationError:'Choose a valid reaction target and type.' };
  const rate = checkCommunityRateLimit(`reaction:${userId}`, now, { max:40 });
  if(rate.rateLimited) return rate;
  const target = await validateReactionTarget(dataClient, userId, targetType, targetId);
  if(target.error || target.notFound || target.unavailable || target.forbidden) return target;
  const existing = await tableQuery(dataClient, COMMUNITY_REACTIONS_TABLE)
    .eq('user_id', userId)
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .eq('reaction_type', type)
    .limit(1);
  if(existing.error) return { error:existing.error };
  const timestamp = nowIso(now);
  let reaction;
  let active = true;
  if(existing.data && existing.data[0]){
    active = existing.data[0].active === false || existing.data[0].removed_at ? true : false;
    const updated = await dataClient.from(COMMUNITY_REACTIONS_TABLE)
      .update({ active, removed_at:active ? null : timestamp, updated_at:timestamp })
      .eq('id', existing.data[0].id)
      .select('*')
      .single();
    if(updated.error) return { error:updated.error };
    reaction = updated.data;
  }else{
    const payload = {
      id: stableId('community-reaction', { userId, targetType, targetId, type }),
      user_id:String(userId),
      target_type:targetType,
      target_id:targetId,
      reaction_type:type,
      active:true,
      removed_at:null,
      created_at:timestamp,
      updated_at:timestamp
    };
    const inserted = await dataClient.from(COMMUNITY_REACTIONS_TABLE).insert([payload]).select('*').single();
    if(inserted.error) return { error:inserted.error };
    reaction = inserted.data;
  }
  if(active && String(target.ownerUserId || '') !== String(userId)){
    await emitCommunityNotification(dataClient, {
      recipientUserId:target.ownerUserId,
      actorUserId:userId,
      type:'reaction_received',
      post:target.post || target.target,
      comment:targetType === 'comment' ? target.target : null,
      reactionType:type,
      now
    });
  }
  const reactions = await fetchRows(dataClient, COMMUNITY_REACTIONS_TABLE, COMMUNITY_SCAN_LIMIT);
  const counts = countReactions(reactions.rows).get(targetKey(targetType, targetId)) || { like:0, fire:0, respect:0, technique:0, total:0 };
  return { reaction:{ type, targetType, targetId, active:Boolean(active), id:String(reaction.id) }, counts, toggled:true };
}

async function reportCommunityTarget(dataClient, userId, input = {}, now = new Date()){
  const targetType = safeTargetType(input.targetType || input.target_type);
  const targetId = cleanString(input.targetId || input.target_id, 128);
  const reason = cleanString(input.reason, 40);
  if(!targetType || !targetId || !COMMUNITY_REPORT_REASONS.has(reason)) return { validationError:'Choose a valid report target and reason.' };
  const rate = checkCommunityRateLimit(`report:${userId}`, now, { max:10, windowMs:5 * 60 * 1000 });
  if(rate.rateLimited) return rate;
  const target = await validateReactionTarget(dataClient, userId, targetType, targetId);
  if(target.error || target.notFound || target.unavailable || target.forbidden) return target;
  const existing = await tableQuery(dataClient, COMMUNITY_REPORTS_TABLE)
    .eq('reporter_user_id', userId)
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .eq('reason', reason)
    .limit(1);
  if(existing.error) return { error:existing.error };
  const duplicate = (existing.data || []).find(row => ['open', 'reviewing'].includes(row.status || 'open'));
  if(duplicate) return { report:sanitizeReport(duplicate), duplicate:true };
  const timestamp = nowIso(now);
  const payload = {
    id: stableId('community-report', { userId, targetType, targetId, reason, timestamp }),
    reporter_user_id:String(userId),
    target_type:targetType,
    target_id:targetId,
    reason,
    context:cleanString(input.context, 800),
    status:'open',
    created_at:timestamp,
    updated_at:timestamp
  };
  const inserted = await dataClient.from(COMMUNITY_REPORTS_TABLE).insert([payload]).select('*').single();
  if(inserted.error) return { error:inserted.error };
  return { report:sanitizeReport(inserted.data), created:true };
}

function sanitizeReport(row){
  return {
    id:String(row.id),
    targetType:cleanString(row.target_type, 40),
    targetId:cleanString(row.target_id, 128),
    reason:cleanString(row.reason, 40),
    status:cleanString(row.status, 40) || 'open',
    createdAt:row.created_at || null,
    reporterPrivate:true
  };
}

async function moderateCommunityTarget(dataClient, operatorUserId, input = {}, now = new Date()){
  const targetType = safeTargetType(input.targetType || input.target_type);
  const targetId = cleanString(input.targetId || input.target_id, 128);
  const action = cleanString(input.action, 40);
  if(!targetType || !targetId || !COMMUNITY_MODERATION_ACTIONS.has(action)) return { validationError:'Choose a valid moderation action.' };
  const timestamp = nowIso(now);
  let updateResult = null;
  if(targetType === 'post'){
    const patch = { updated_at:timestamp };
    if(action === 'hide') patch.status = 'hidden', patch.hidden_at = timestamp;
    if(action === 'restore') patch.status = 'active', patch.hidden_at = null, patch.deleted_at = null;
    if(action === 'lock_comments') patch.locked_at = timestamp, patch.status = 'locked';
    if(action === 'unlock_comments') patch.locked_at = null, patch.status = 'active';
    if(action === 'remove_attachment'){
      const found = await postById(dataClient, targetId);
      if(found.error || found.notFound) return found;
      patch.attachments = safeArray(found.post.attachments).filter(item => String(plainObject(item).id) !== String(input.attachmentId));
    }
    if(Object.keys(patch).length > 1) updateResult = await dataClient.from(COMMUNITY_POSTS_TABLE).update(patch).eq('id', targetId).select('*').single();
  }else if(['hide', 'restore'].includes(action)){
    const patch = action === 'hide'
      ? { status:'hidden', hidden_at:timestamp, updated_at:timestamp }
      : { status:'active', hidden_at:null, updated_at:timestamp };
    updateResult = await dataClient.from(COMMUNITY_COMMENTS_TABLE).update(patch).eq('id', targetId).select('*').single();
  }
  if(updateResult && updateResult.error) return { error:updateResult.error };
  const payload = {
    id: stableId('community-moderation', { operatorUserId, targetType, targetId, action, timestamp }),
    operator_user_id:String(operatorUserId),
    target_type:targetType,
    target_id:targetId,
    action,
    reason:cleanString(input.reason, 400),
    metadata:{
      attachmentId:cleanString(input.attachmentId, 128),
      reportId:cleanString(input.reportId || input.report_id, 128)
    },
    created_at:timestamp
  };
  const inserted = await dataClient.from(COMMUNITY_MODERATION_ACTIONS_TABLE).insert([payload]).select('*').single();
  if(inserted.error) return { error:inserted.error };
  return { action:sanitizeModerationAction(inserted.data), target:updateResult && updateResult.data || null };
}

function sanitizeModerationAction(row){
  return {
    id:String(row.id),
    targetType:cleanString(row.target_type, 40),
    targetId:cleanString(row.target_id, 128),
    action:cleanString(row.action, 40),
    reason:cleanString(row.reason, 400),
    createdAt:row.created_at || null,
    auditTrail:'recorded'
  };
}

async function emitCommunityNotification(dataClient, input = {}){
  const recipientUserId = cleanString(input.recipientUserId, 128);
  const actorUserId = cleanString(input.actorUserId, 128);
  if(!recipientUserId || !actorUserId || recipientUserId === actorUserId) return { skipped:true };
  const type = cleanString(input.type, 80);
  if(!['comment_received', 'reply_received', 'reaction_received', 'moderation_update'].includes(type)) return { skipped:true };
  const actor = await profileForUser(dataClient, actorUserId);
  if(actor.error) return actor;
  const mutes = await tableQuery(dataClient, DJ_NOTIFICATION_MUTES_TABLE).eq('user_id', recipientUserId).limit(200);
  if(mutes.error && !optionalTableMissing(mutes.error)) return { error:mutes.error };
  const muted = safeArray(mutes.data).some(row => {
    if(row.muted === false || row.active === false) return false;
    const category = cleanString(row.category, 40) || 'community';
    const notificationType = cleanString(row.notification_type, 80);
    if(category !== 'all' && category !== 'community') return false;
    if(notificationType && notificationType !== type) return false;
    const mutedUserId = cleanString(row.muted_user_id, 128);
    const mutedProfile = cleanString(row.muted_public_profile_id, 96);
    if(mutedUserId && mutedUserId !== actorUserId) return false;
    if(mutedProfile && mutedProfile !== actor.profile.publicProfileId) return false;
    return true;
  });
  if(muted) return { skipped:true, muted:true };
  const eventKey = stableHash({
    recipientUserId,
    actorUserId,
    type,
    postId:input.post && input.post.id,
    commentId:input.comment && input.comment.id,
    reactionType:input.reactionType
  });
  const existing = await tableQuery(dataClient, DJ_NOTIFICATIONS_TABLE)
    .eq('user_id', recipientUserId)
    .eq('event_key', eventKey)
    .limit(1);
  if(existing.error && !optionalTableMissing(existing.error)) return { error:existing.error };
  if(existing.data && existing.data[0]) return { notification:existing.data[0], duplicate:true };
  const postTitle = cleanString(input.post && input.post.title, 140) || 'a community post';
  const summary = type === 'reaction_received'
    ? `${actor.profile.displayName || 'A DJ'} reacted to ${postTitle}.`
    : type === 'reply_received'
      ? `${actor.profile.displayName || 'A DJ'} replied in ${postTitle}.`
      : `${actor.profile.displayName || 'A DJ'} commented on ${postTitle}.`;
  const timestamp = nowIso(input.now);
  const payload = {
    id:`notification-${eventKey.slice(0, 24)}`,
    user_id:recipientUserId,
    type,
    category:'community',
    subject_type:'community',
    subject_id:cleanString(input.comment && input.comment.id || input.post && input.post.id, 128),
    event_key:eventKey,
    event_version:1,
    actor_user_id:actorUserId,
    actor_public_profile_id:actor.profile.publicProfileId || null,
    actor_profile:actor.profile,
    challenge_snapshot:null,
    destination:{ type:'community_post', postId:cleanString(input.post && input.post.id, 128), label:'Open Discussion' },
    summary,
    status:'delivered',
    read_at:null,
    archived_at:null,
    created_at:timestamp,
    updated_at:timestamp
  };
  const inserted = await dataClient.from(DJ_NOTIFICATIONS_TABLE).insert([payload]).select('*').single();
  if(inserted.error && !optionalTableMissing(inserted.error)) return { error:inserted.error };
  return { notification:inserted.data || payload, created:true };
}

async function recordCommunityAttachmentUsage(dataClient, userId, postId, attachmentId, now = new Date()){
  const found = await postById(dataClient, postId);
  if(found.error || found.notFound) return found;
  const attachment = safeArray(found.post.attachments).map(sanitizeAttachmentSnapshot).find(item => String(item.id) === String(attachmentId));
  if(!attachment) return { notFound:true };
  if(!['library_track', 'profile_media'].includes(attachment.type)) return { unavailable:true };
  const rate = checkCommunityRateLimit(`media:${userId || 'public'}`, now, { max:60 });
  if(rate.rateLimited) return rate;
  if(userId){
    const usage = await recordLibraryTrackUsage(dataClient, userId, attachment.mediaId, { relationship:'posts', relatedId:postId, source:'community_playback' }, now);
    if(usage.error && !usage.forbidden && !usage.unavailable) return usage;
  }
  return {
    attachment:{ ...attachment, playbackContract:'protected_on_site_library_playback', playbackAccess:null },
    usage:{ recorded:true, privacy:'bounded_no_public_download', createdAt:nowIso(now) }
  };
}

async function listPublicProfileCommunityPosts(dataClient, publicProfileId, options = {}){
  const profiles = await fetchProfiles(dataClient);
  if(profiles.error) return profiles;
  const found = profiles.byPublic.get(String(publicProfileId));
  if(!found || !found.profile || found.profile.profileVisibility === 'private') return { notFound:true };
  const feed = await listCommunityFeed(dataClient, null, { ...options, feed:'recent', limit:options.limit || 10 });
  if(feed.error || feed.validationError) return feed;
  return {
    posts:feed.posts.filter(post => post.author && post.author.publicProfileId === publicProfileId),
    pagination:feed.pagination
  };
}

async function checkCommunitySchemaReadiness(dataClient){
  const required = [
    COMMUNITY_CATEGORIES_TABLE,
    COMMUNITY_POSTS_TABLE,
    COMMUNITY_COMMENTS_TABLE,
    COMMUNITY_REACTIONS_TABLE,
    COMMUNITY_REPORTS_TABLE,
    COMMUNITY_MODERATION_ACTIONS_TABLE
  ];
  const missing = [];
  for(const table of required){
    const result = await tableQuery(dataClient, table).limit(1);
    if(result.error){
      if(optionalTableMissing(result.error)) missing.push(table);
      else return { ready:false, status:'failed', schema:'020_create_community_forum', message:'Community schema readiness check failed.', error:cleanString(result.error.message || result.error, 240) };
    }
  }
  return missing.length
    ? { ready:false, status:'missing_schema', schema:'020_create_community_forum', missing, message:'Apply local migration 020 before enabling server-backed Community in deployment.' }
    : { ready:true, status:'ready', schema:'020_create_community_forum', message:'Community forum schema is available.' };
}

module.exports = {
  COMMUNITY_CATEGORIES_TABLE,
  COMMUNITY_COMMENTS_TABLE,
  COMMUNITY_MODERATION_ACTIONS_TABLE,
  COMMUNITY_POSTS_TABLE,
  COMMUNITY_REACTIONS_TABLE,
  COMMUNITY_REPORTS_TABLE,
  COMMUNITY_REACTION_TYPES,
  COMMUNITY_REPORT_REASONS,
  checkCommunityRateLimit,
  checkCommunitySchemaReadiness,
  createCommunityComment,
  createCommunityPost,
  deleteCommunityComment,
  deleteCommunityPost,
  listCommunityCategories,
  listCommunityComments,
  listCommunityFeed,
  listPublicProfileCommunityPosts,
  moderateCommunityTarget,
  recordCommunityAttachmentUsage,
  reportCommunityTarget,
  sanitizeAttachmentSnapshot,
  sanitizeComment,
  sanitizePost,
  toggleCommunityReaction,
  updateCommunityComment,
  updateCommunityPost
};
