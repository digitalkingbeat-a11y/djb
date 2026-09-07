const { randomUUID, createHash } = require('crypto');
const { ALLOWED_AUDIO_MIME_TYPES, LIMITS, validateAudioMetadata } = require('./ingestion_safety');
const { MIX_BUCKET, getOwnedMixSubmission } = require('./battle_submission');

const LIBRARY_ARTWORK_BUCKET = 'battle-artwork';
const LIBRARY_TRACK_TABLE = 'music_library_tracks';
const LIBRARY_CRATE_TABLE = 'music_library_crates';
const LIBRARY_CRATE_MEMBERSHIP_TABLE = 'music_library_crate_memberships';
const LIBRARY_ARTWORK_MAX_BYTES = 1024 * 1024;
const ALLOWED_ARTWORK_MIME_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
};
const LIBRARY_SOURCE_TYPES = ['track', 'mix', 'submission', 'practice_recording'];
const LIBRARY_VISIBILITIES = ['private', 'profile', 'public'];
const LIBRARY_CRATE_TYPES = ['crate', 'playlist', 'battle_prep', 'smart_crate', 'folder'];
const RIGHTS_CLASSIFICATIONS = [
  'original',
  'licensed',
  'royalty_free',
  'platform_cleared',
  'commercial_copyrighted',
  'unknown'
];
const KEY_TO_CAMELOT = {
  'a minor':'8A','c major':'8B','e minor':'9A','g major':'9B','b minor':'10A','d major':'10B',
  'f# minor':'11A','gb minor':'11A','a major':'11B','c# minor':'12A','db minor':'12A','e major':'12B',
  'g# minor':'1A','ab minor':'1A','b major':'1B','d# minor':'2A','eb minor':'2A','f# major':'2B','gb major':'2B',
  'a# minor':'3A','bb minor':'3A','c# major':'3B','db major':'3B','f minor':'4A','g# major':'4B','ab major':'4B',
  'c minor':'5A','d# major':'5B','eb major':'5B','g minor':'6A','a# major':'6B','bb major':'6B',
  'd minor':'7A','f major':'7B'
};

function normalizeString(value, fallback = ''){
  return String(value == null ? fallback : value).trim();
}

function normalizeKeyName(key){
  return normalizeString(key).toLowerCase().replace(/\bmin\b/g, 'minor').replace(/\bmaj\b/g, 'major').replace(/\s+/g, ' ');
}

function camelotKeyFor(key){
  const raw = normalizeString(key).toUpperCase();
  if(/^(?:[1-9]|1[0-2])[AB]$/.test(raw)) return raw;
  return KEY_TO_CAMELOT[normalizeKeyName(key)] || null;
}

function stableMetadataHash(input){
  const explicit = normalizeString(input.fileHash || input.sha256 || input.storageHash);
  if(explicit && /^[A-Fa-f0-9]{16,128}$/.test(explicit)) return explicit.toLowerCase();
  const basis = [input.originalFilename, input.declaredMimeType, input.fileSize, input.duration].map(value => normalizeString(value)).join('|');
  return createHash('sha256').update(basis).digest('hex');
}

function validateArtworkMetadata(metadata, limits = { artworkBytes: LIBRARY_ARTWORK_MAX_BYTES }){
  const filename = normalizeString(metadata && metadata.filename || metadata && metadata.originalFilename);
  const mimeType = normalizeString(metadata && metadata.mimeType || metadata && metadata.declaredMimeType).toLowerCase();
  const size = Number(metadata && metadata.size != null ? metadata.size : metadata && metadata.fileSize);
  if(!filename || filename.includes('..') || /[\\/]/.test(filename)) return { error: 'Invalid artwork filename' };
  if(!ALLOWED_ARTWORK_MIME_TYPES[mimeType]) return { error: 'Artwork MIME type is not allowed' };
  if(!Number.isFinite(size) || size <= 0 || size > (limits.artworkBytes || LIBRARY_ARTWORK_MAX_BYTES)) return { error: 'Artwork size is not allowed' };
  return { filename, mimeType, size, extension: ALLOWED_ARTWORK_MIME_TYPES[mimeType] };
}

function normalizeLibraryMetadata(input = {}){
  const title = normalizeString(input.title || input.name, 'Untitled Track').slice(0, 160);
  const artist = normalizeString(input.artist, 'Unknown Artist').slice(0, 120);
  const genre = normalizeString(input.genre, 'Unsorted').slice(0, 80);
  const key = normalizeString(input.key || input.musicalKey).slice(0, 40) || null;
  const sourceType = LIBRARY_SOURCE_TYPES.includes(input.sourceType) ? input.sourceType : 'track';
  const visibility = LIBRARY_VISIBILITIES.includes(input.visibility) ? input.visibility : 'private';
  const rights = RIGHTS_CLASSIFICATIONS.includes(input.rightsClassification) ? input.rightsClassification : 'unknown';
  const bpm = input.bpm == null || input.bpm === '' ? null : Number(input.bpm);
  const duration = input.duration == null || input.duration === '' ? null : Number(input.duration);
  const confidence = input.analysisConfidence == null || input.analysisConfidence === '' ? null : Math.max(0, Math.min(1, Number(input.analysisConfidence)));
  return {
    title,
    artist,
    bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : null,
    key,
    camelot_key: input.camelotKey || camelotKeyFor(key),
    genre,
    duration: Number.isFinite(duration) && duration >= 0 ? duration : null,
    tags: Array.isArray(input.tags) ? input.tags.map(tag => normalizeString(tag).slice(0, 40)).filter(Boolean).slice(0, 24) : [],
    rights_classification: rights,
    visibility,
    analysis_confidence: Number.isFinite(confidence) ? confidence : null,
    source_type: sourceType
  };
}

function sanitizeUsageRelationships(value){
  const usage = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    playlists: Array.isArray(usage.playlists) ? usage.playlists.slice(0, 100) : [],
    battles: Array.isArray(usage.battles) ? usage.battles.slice(0, 100) : [],
    posts: Array.isArray(usage.posts) ? usage.posts.slice(0, 100) : [],
    practiceHistory: Array.isArray(usage.practiceHistory) ? usage.practiceHistory.slice(0, 100) : [],
    submissions: Array.isArray(usage.submissions) ? usage.submissions.slice(0, 100) : []
  };
}

function normalizeStringList(value, max = 100){
  if(!Array.isArray(value)) return [];
  return value.map(item => normalizeString(item).slice(0, 128)).filter(Boolean).slice(0, max);
}

function boundedNumber(value, min, max){
  if(value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : null;
}

function sanitizePracticeMetadata(value){
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    practiceHistoryId: normalizeString(input.practiceHistoryId || input.practice_history_id) || null,
    judgeResultId: normalizeString(input.judgeResultId || input.judge_result_id) || null,
    score: boundedNumber(input.score, 0, 100),
    confidence: boundedNumber(input.confidence, 0, 1),
    recommendations: normalizeStringList(input.recommendations, 12).map(item => item.slice(0, 220)),
    submitted: Boolean(input.submitted),
    source: normalizeString(input.source || 'practice').slice(0, 40)
  };
}

function sanitizeAnalysisSummary(value){
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    timingAccuracy: boundedNumber(input.timingAccuracy, 0, 100),
    transitionQuality: boundedNumber(input.transitionQuality, 0, 100),
    keyConfidence: boundedNumber(input.keyConfidence, 0, 1),
    source: normalizeString(input.source || 'measured_rule_based').slice(0, 80)
  };
}

function sanitizeCrateArtworkMetadata(value){
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.keys(input).length ? {
    mimeType: normalizeString(input.mimeType).slice(0, 80),
    size: boundedNumber(input.size, 0, LIBRARY_ARTWORK_MAX_BYTES),
    updatedAt: normalizeString(input.updatedAt) || null
  } : null;
}

function sanitizeSmartCrateRules(rules){
  const input = rules && typeof rules === 'object' && !Array.isArray(rules) ? rules : {};
  const output = {};
  if(input.preset) output.preset = normalizeString(input.preset).slice(0, 80);
  if(input.bpmMin != null) output.bpmMin = Math.max(0, Number(input.bpmMin));
  if(input.bpmMax != null) output.bpmMax = Math.max(0, Number(input.bpmMax));
  if(input.key) output.key = normalizeString(input.key).slice(0, 40);
  if(input.camelotKey) output.camelotKey = normalizeString(input.camelotKey).toUpperCase().slice(0, 4);
  if(input.compatibleWithTrackId) output.compatibleWithTrackId = normalizeString(input.compatibleWithTrackId).slice(0, 128);
  if(input.genre) output.genre = normalizeString(input.genre).slice(0, 80);
  if(input.ratingMin != null) output.ratingMin = Math.max(0, Math.min(5, Number(input.ratingMin)));
  if(input.dateAddedAfter) output.dateAddedAfter = normalizeString(input.dateAddedAfter).slice(0, 40);
  if(input.mediaType || input.sourceType) output.mediaType = normalizeString(input.mediaType || input.sourceType).slice(0, 40);
  if(input.rightsClassification) output.rightsClassification = normalizeString(input.rightsClassification).slice(0, 80);
  if(input.analysisStatus) output.analysisStatus = normalizeString(input.analysisStatus).slice(0, 40);
  if(input.visibility) output.visibility = normalizeString(input.visibility).slice(0, 40);
  if(input.battleReady != null) output.battleReady = Boolean(input.battleReady);
  return output;
}

function buildLibraryTrackPayload(userId, input = {}, now = new Date()){
  const metadata = normalizeLibraryMetadata(input);
  const id = input.id || randomUUID();
  const originalFilename = normalizeString(input.originalFilename || input.filename);
  const declaredMimeType = normalizeString(input.declaredMimeType || input.mimeType);
  const fileSize = input.fileSize == null ? null : Number(input.fileSize);
  let audioValidation = null;
  let audioStorageObjectPath = normalizeString(input.audioStorageObjectPath || input.storageObjectPath) || null;
  if(originalFilename || declaredMimeType || fileSize != null){
    audioValidation = validateAudioMetadata({ filename: originalFilename, mimeType: declaredMimeType, size: fileSize }, LIMITS);
    if(audioValidation.error) throw new Error(audioValidation.error);
    if(!audioStorageObjectPath) audioStorageObjectPath = `private/library-audio/${userId}/tracks/${id}/audio.${ALLOWED_AUDIO_MIME_TYPES[audioValidation.mimeType][0]}`;
  }
  const hasDuplicateEvidence = Boolean(input.fileHash || input.sha256 || input.storageHash || audioValidation || input.sourceSubmissionId || input.linkedSubmissionId);
  return {
    id,
    user_id: userId,
    ...metadata,
    original_filename: originalFilename || null,
    declared_mime_type: audioValidation ? audioValidation.mimeType : (declaredMimeType || null),
    file_size: audioValidation ? audioValidation.size : (Number.isFinite(fileSize) ? fileSize : null),
    file_hash: hasDuplicateEvidence ? stableMetadataHash({ ...input, originalFilename, declaredMimeType, fileSize }) : null,
    audio_storage_bucket: MIX_BUCKET,
    audio_storage_object_path: audioStorageObjectPath,
    linked_submission_id: input.sourceSubmissionId || input.linkedSubmissionId || null,
    artwork_storage_bucket: null,
    artwork_storage_object_path: null,
    artwork_metadata: null,
    usage_relationships: sanitizeUsageRelationships(input.usageRelationships),
    practice_metadata: sanitizePracticeMetadata(input.practiceMetadata),
    analysis_summary: sanitizeAnalysisSummary(input.analysisSummary),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    archived_at: null
  };
}

function sanitizeLibraryTrack(row, options = {}){
  if(!row) return null;
  const artwork = row.artwork_metadata && typeof row.artwork_metadata === 'object' ? row.artwork_metadata : null;
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    artist: row.artist,
    bpm: row.bpm,
    key: row.key,
    camelotKey: row.camelot_key || camelotKeyFor(row.key),
    genre: row.genre,
    duration: row.duration,
    tags: row.tags || [],
    rightsClassification: row.rights_classification,
    visibility: row.visibility,
    analysisConfidence: row.analysis_confidence,
    sourceType: row.source_type,
    linkedSubmissionId: row.linked_submission_id || null,
    fileHash: row.file_hash || null,
    fileSize: row.file_size == null ? null : Number(row.file_size),
    hasAudio: Boolean(row.audio_storage_object_path || row.linked_submission_id),
    hasArtwork: Boolean(row.artwork_storage_object_path),
    artwork: artwork ? {
      mimeType: artwork.mimeType,
      size: artwork.size,
      width: artwork.width || null,
      height: artwork.height || null,
      updatedAt: artwork.updatedAt || row.updated_at || null
    } : null,
    usageRelationships: sanitizeUsageRelationships(row.usage_relationships),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    archived: Boolean(row.archived_at),
    practiceMetadata: sanitizePracticeMetadata(row.practice_metadata),
    analysisSummary: sanitizeAnalysisSummary(row.analysis_summary),
    playbackAccess: options.playbackAccess || null
  };
}

async function querySingleTrack(dataClient, trackId){
  const result = await dataClient.from(LIBRARY_TRACK_TABLE).select('*').eq('id', trackId).limit(1).single();
  if(result.error) return { error: result.error };
  if(!result.data || result.data.archived_at) return { unavailable: true };
  return { track: result.data };
}

async function getOwnedLibraryTrack(dataClient, userId, trackId){
  const result = await querySingleTrack(dataClient, trackId);
  if(result.error || result.unavailable) return result;
  if(String(result.track.user_id) !== String(userId)) return { forbidden: true };
  return { track: result.track, sanitized: sanitizeLibraryTrack(result.track) };
}

async function listOwnedLibraryTracks(dataClient, userId, options = {}){
  const limit = Math.max(1, Math.min(100, Number(options.limit || 50)));
  const page = Math.max(1, Number(options.page || 1));
  let query = dataClient.from(LIBRARY_TRACK_TABLE).select('*').eq('user_id', userId).limit(limit + 1);
  if(typeof query.range === 'function'){
    const from = (page - 1) * limit;
    query = query.range(from, from + limit);
  }
  const result = await query;
  if(result.error) return { error: result.error };
  const visible = (result.data || []).filter(row => !row.archived_at);
  const hasMore = visible.length > limit;
  const rows = visible.slice(0, limit).map(row => sanitizeLibraryTrack(row));
  return { tracks: rows, pagination:{ page, limit, hasMore, nextPage:hasMore ? page + 1 : null } };
}

async function checkMusicLibrarySchemaReadiness(dataClient){
  if(!dataClient) return { ready:false, schema:'012_create_music_library_tracks', status:'unconfigured', message:'Supabase service client is not configured.' };
  try{
    const result = await dataClient.from(LIBRARY_TRACK_TABLE).select('id').limit(1);
    if(result.error){
      const message = String(result.error.message || result.error);
      const missing = /music_library_tracks|relation|schema|does not exist|not found|cache/i.test(message);
      return {
        ready:false,
        schema:'012_create_music_library_tracks',
        status: missing ? 'migration_required' : 'failed',
        message: missing ? 'Music Library schema 012 is not available.' : 'Music Library schema readiness check failed.'
      };
    }
    return { ready:true, schema:'012_create_music_library_tracks', status:'ready', message:'Music Library schema 012 is available.' };
  }catch(err){
    return { ready:false, schema:'012_create_music_library_tracks', status:'failed', message:'Music Library schema readiness check failed.' };
  }
}

async function checkMusicLibraryOrganizationSchemaReadiness(dataClient){
  if(!dataClient) return { ready:false, schema:'013_create_music_library_crates', status:'unconfigured', message:'Supabase service client is not configured.' };
  try{
    const crates = await dataClient.from(LIBRARY_CRATE_TABLE).select('id').limit(1);
    const memberships = await dataClient.from(LIBRARY_CRATE_MEMBERSHIP_TABLE).select('id').limit(1);
    const error = crates.error || memberships.error;
    if(error){
      const message = String(error.message || error);
      const missing = /music_library_crates|music_library_crate_memberships|relation|schema|does not exist|not found|cache/i.test(message);
      return {
        ready:false,
        schema:'013_create_music_library_crates',
        status: missing ? 'migration_required' : 'failed',
        message: missing ? 'Music Library organization schema 013 is not available.' : 'Music Library organization readiness check failed.'
      };
    }
    return { ready:true, schema:'013_create_music_library_crates', status:'ready', message:'Music Library organization schema 013 is available.' };
  }catch(err){
    return { ready:false, schema:'013_create_music_library_crates', status:'failed', message:'Music Library organization readiness check failed.' };
  }
}

async function findDuplicateLibraryTrack(dataClient, userId, payload){
  const candidates = [
    ['file_hash', payload.file_hash],
    ['audio_storage_object_path', payload.audio_storage_object_path],
    ['linked_submission_id', payload.linked_submission_id]
  ].filter(([, value]) => value);
  for(const [field, value] of candidates){
    const query = dataClient.from(LIBRARY_TRACK_TABLE).select('*').eq('user_id', userId).eq(field, value).limit(1);
    const result = await query;
    if(result.error) return { error: result.error };
    const existing = (result.data || []).find(row => !row.archived_at);
    if(existing) return { duplicate: true, track: existing };
  }
  return { duplicate: false };
}

async function createLibraryTrack(dataClient, userId, input = {}, now = new Date()){
  let payload;
  try{ payload = buildLibraryTrackPayload(userId, input, now); }catch(err){ return { validationError: err.message }; }
  if(payload.linked_submission_id){
    const ownedSubmission = await getOwnedMixSubmission(dataClient, userId, payload.linked_submission_id);
    if(ownedSubmission.error || ownedSubmission.forbidden) return ownedSubmission;
    const submission = ownedSubmission.submission;
    if(!['uploaded', 'judging', 'completed'].includes(submission.status)) return { invalidState: true };
    payload.audio_storage_bucket = MIX_BUCKET;
    payload.audio_storage_object_path = submission.storage_object_path;
    payload.original_filename = payload.original_filename || submission.original_filename;
    payload.declared_mime_type = payload.declared_mime_type || submission.verified_mime_type || submission.declared_mime_type;
    payload.file_size = payload.file_size || submission.verified_object_size || submission.file_size;
    payload.duration = payload.duration == null ? submission.duration : payload.duration;
    payload.file_hash = stableMetadataHash({ fileHash: submission.file_hash, originalFilename: payload.original_filename, declaredMimeType: payload.declared_mime_type, fileSize: payload.file_size, duration: payload.duration });
  }
  const duplicate = await findDuplicateLibraryTrack(dataClient, userId, payload);
  if(duplicate.error || duplicate.duplicate) return duplicate;
  const inserted = await dataClient.from(LIBRARY_TRACK_TABLE).insert([payload]).select('*').single();
  if(inserted.error) return { error: inserted.error };
  return { track: sanitizeLibraryTrack(inserted.data), rawTrack: inserted.data, created: true };
}

async function updateLibraryTrack(dataClient, userId, trackId, input = {}, now = new Date()){
  const owned = await getOwnedLibraryTrack(dataClient, userId, trackId);
  if(owned.error || owned.forbidden || owned.unavailable) return owned;
  const metadata = normalizeLibraryMetadata({
    title: input.title != null ? input.title : owned.track.title,
    artist: input.artist != null ? input.artist : owned.track.artist,
    bpm: input.bpm != null ? input.bpm : owned.track.bpm,
    key: input.key != null ? input.key : owned.track.key,
    camelotKey: input.camelotKey != null ? input.camelotKey : (input.key != null ? undefined : owned.track.camelot_key),
    genre: input.genre != null ? input.genre : owned.track.genre,
    duration: input.duration != null ? input.duration : owned.track.duration,
    tags: input.tags != null ? input.tags : owned.track.tags,
    rightsClassification: input.rightsClassification != null ? input.rightsClassification : owned.track.rights_classification,
    visibility: input.visibility != null ? input.visibility : owned.track.visibility,
    analysisConfidence: input.analysisConfidence != null ? input.analysisConfidence : owned.track.analysis_confidence,
    sourceType: input.sourceType != null ? input.sourceType : owned.track.source_type
  });
  const values = {
    title: metadata.title,
    artist: metadata.artist,
    bpm: metadata.bpm,
    key: metadata.key,
    camelot_key: metadata.camelot_key,
    genre: metadata.genre,
    duration: metadata.duration,
    tags: metadata.tags,
    rights_classification: metadata.rights_classification,
    visibility: metadata.visibility,
    analysis_confidence: metadata.analysis_confidence,
    usage_relationships: sanitizeUsageRelationships(input.usageRelationships || owned.track.usage_relationships),
    practice_metadata: input.practiceMetadata != null ? sanitizePracticeMetadata(input.practiceMetadata) : sanitizePracticeMetadata(owned.track.practice_metadata),
    analysis_summary: input.analysisSummary != null ? sanitizeAnalysisSummary(input.analysisSummary) : sanitizeAnalysisSummary(owned.track.analysis_summary),
    updated_at: now.toISOString()
  };
  const updated = await dataClient.from(LIBRARY_TRACK_TABLE).update(values).eq('id', trackId).eq('user_id', userId).select('*').single();
  if(updated.error) return { error: updated.error };
  return { track: sanitizeLibraryTrack(updated.data), rawTrack: updated.data };
}

async function archiveLibraryTrack(dataClient, userId, trackId, now = new Date()){
  const owned = await getOwnedLibraryTrack(dataClient, userId, trackId);
  if(owned.error || owned.forbidden || owned.unavailable) return owned;
  const updated = await dataClient.from(LIBRARY_TRACK_TABLE).update({ archived_at: now.toISOString(), updated_at: now.toISOString() }).eq('id', trackId).eq('user_id', userId).select('*').single();
  if(updated.error) return { error: updated.error };
  return { track: sanitizeLibraryTrack(updated.data) };
}

async function issueLibraryAudioUploadAuthorization(dataClient, storage, userId, trackId, now = new Date()){
  const owned = await getOwnedLibraryTrack(dataClient, userId, trackId);
  if(owned.error || owned.forbidden || owned.unavailable) return owned;
  const track = owned.track;
  if(track.linked_submission_id) return { invalidState: true };
  const validation = validateAudioMetadata({ filename: track.original_filename, mimeType: track.declared_mime_type, size: track.file_size }, LIMITS);
  if(validation.error) return { validationError: validation.error };
  if(!track.audio_storage_object_path || !String(track.audio_storage_object_path).startsWith(`private/library-audio/${userId}/tracks/${track.id}/`)) return { validationError: 'Invalid private audio storage path' };
  const signed = await storage.createSignedUploadUrl(track.audio_storage_object_path, { upsert:false });
  if(signed.error) return { error: signed.error };
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  const updated = await dataClient.from(LIBRARY_TRACK_TABLE).update({ audio_upload_authorized_at: now.toISOString(), audio_upload_expires_at: expiresAt, updated_at: now.toISOString() }).eq('id', trackId).eq('user_id', userId).select('*').single();
  if(updated.error) return { error: updated.error };
  return { uploadPath: signed.data.path, uploadToken: signed.data.token, expiresAt, bucket: MIX_BUCKET, track: sanitizeLibraryTrack(updated.data) };
}

async function completeLibraryAudioUpload(dataClient, storage, userId, trackId, now = new Date()){
  const owned = await getOwnedLibraryTrack(dataClient, userId, trackId);
  if(owned.error || owned.forbidden || owned.unavailable) return owned;
  const track = owned.track;
  if(track.linked_submission_id) return { invalidState: true };
  if(!track.audio_upload_expires_at || new Date(track.audio_upload_expires_at) < now) return { invalidState: true };
  const validation = validateAudioMetadata({ filename: track.original_filename, mimeType: track.declared_mime_type, size: track.file_size }, LIMITS);
  if(validation.error) return { validationError: validation.error };
  const slash = track.audio_storage_object_path.lastIndexOf('/');
  const listed = await storage.list(track.audio_storage_object_path.slice(0, slash), { search: track.audio_storage_object_path.slice(slash + 1) });
  if(listed.error) return { error: listed.error };
  const object = (listed.data || []).find(item => item.name === track.audio_storage_object_path.slice(slash + 1));
  const size = object && object.metadata && Number(object.metadata.size);
  const mimeType = object && object.metadata && object.metadata.mimetype;
  if(!object || size !== Number(track.file_size) || mimeType !== validation.mimeType) return { verificationFailed: true };
  const updated = await dataClient.from(LIBRARY_TRACK_TABLE).update({
    verified_object_size: size,
    verified_mime_type: mimeType,
    audio_upload_verified_at: now.toISOString(),
    updated_at: now.toISOString()
  }).eq('id', trackId).eq('user_id', userId).select('*').single();
  if(updated.error) return { error: updated.error };
  return { track: sanitizeLibraryTrack(updated.data), rawTrack: updated.data };
}

async function issueLibraryArtworkUploadAuthorization(dataClient, storage, userId, trackId, metadata, now = new Date()){
  const owned = await getOwnedLibraryTrack(dataClient, userId, trackId);
  if(owned.error || owned.forbidden || owned.unavailable) return owned;
  const validation = validateArtworkMetadata(metadata);
  if(validation.error) return { validationError: validation.error };
  const objectPath = `private/library-artwork/${userId}/tracks/${trackId}/artwork.${validation.extension}`;
  const signed = await storage.createSignedUploadUrl(objectPath, { upsert:true });
  if(signed.error) return { error: signed.error };
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  const pending = { filename: validation.filename, mimeType: validation.mimeType, size: validation.size, objectPath, expiresAt };
  const updated = await dataClient.from(LIBRARY_TRACK_TABLE).update({ pending_artwork_metadata: pending, updated_at: now.toISOString() }).eq('id', trackId).eq('user_id', userId).select('*').single();
  if(updated.error) return { error: updated.error };
  return { uploadPath: signed.data.path, uploadToken: signed.data.token, expiresAt, bucket: LIBRARY_ARTWORK_BUCKET, track: sanitizeLibraryTrack(updated.data) };
}

async function completeLibraryArtworkUpload(dataClient, storage, userId, trackId, now = new Date()){
  const owned = await getOwnedLibraryTrack(dataClient, userId, trackId);
  if(owned.error || owned.forbidden || owned.unavailable) return owned;
  const pending = owned.track.pending_artwork_metadata;
  if(!pending || !pending.objectPath || new Date(pending.expiresAt) < now) return { invalidState: true };
  const slash = pending.objectPath.lastIndexOf('/');
  const listed = await storage.list(pending.objectPath.slice(0, slash), { search: pending.objectPath.slice(slash + 1) });
  if(listed.error) return { error: listed.error };
  const object = (listed.data || []).find(item => item.name === pending.objectPath.slice(slash + 1));
  const size = object && object.metadata && Number(object.metadata.size);
  const mimeType = object && object.metadata && object.metadata.mimetype;
  if(!object || size !== Number(pending.size) || mimeType !== pending.mimeType) return { verificationFailed: true };
  const artwork = { filename: pending.filename, mimeType, size, updatedAt: now.toISOString() };
  const updated = await dataClient.from(LIBRARY_TRACK_TABLE).update({
    artwork_storage_bucket: LIBRARY_ARTWORK_BUCKET,
    artwork_storage_object_path: pending.objectPath,
    artwork_metadata: artwork,
    pending_artwork_metadata: null,
    updated_at: now.toISOString()
  }).eq('id', trackId).eq('user_id', userId).select('*').single();
  if(updated.error) return { error: updated.error };
  return { track: sanitizeLibraryTrack(updated.data) };
}

async function removeLibraryArtwork(dataClient, storage, userId, trackId, now = new Date()){
  const owned = await getOwnedLibraryTrack(dataClient, userId, trackId);
  if(owned.error || owned.forbidden || owned.unavailable) return owned;
  const artworkPath = owned.track.artwork_storage_object_path;
  if(artworkPath && storage && typeof storage.remove === 'function') await storage.remove([artworkPath]);
  const updated = await dataClient.from(LIBRARY_TRACK_TABLE).update({
    artwork_storage_bucket: null,
    artwork_storage_object_path: null,
    artwork_metadata: null,
    pending_artwork_metadata: null,
    updated_at: now.toISOString()
  }).eq('id', trackId).eq('user_id', userId).select('*').single();
  if(updated.error) return { error: updated.error };
  return { track: sanitizeLibraryTrack(updated.data) };
}

async function issueLibraryPlaybackAccess(dataClient, storage, userId, trackId, now = new Date()){
  const owned = await getOwnedLibraryTrack(dataClient, userId, trackId);
  if(owned.error || owned.forbidden || owned.unavailable) return owned;
  const path = owned.track.audio_storage_object_path;
  if(!path || /^(https?|data|file):/i.test(path)) return { unavailable: true };
  const expiresIn = 5 * 60;
  const signed = await storage.createSignedUrl(path, expiresIn);
  if(signed.error) return { error: signed.error };
  return {
    track: sanitizeLibraryTrack(owned.track, {
      playbackAccess: {
        url: signed.data.signedUrl,
        expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString()
      }
    })
  };
}

async function recordLibraryTrackUsage(dataClient, userId, trackId, relationship = {}, now = new Date()){
  const owned = await getOwnedLibraryTrack(dataClient, userId, trackId);
  if(owned.error || owned.forbidden || owned.unavailable) return owned;
  const usage = sanitizeUsageRelationships(owned.track.usage_relationships);
  const bucket = relationship.type === 'battle' ? 'battles'
    : relationship.type === 'post' ? 'posts'
    : relationship.type === 'practice' ? 'practiceHistory'
    : relationship.type === 'submission' ? 'submissions'
    : 'playlists';
  const id = normalizeString(relationship.id);
  if(id && !usage[bucket].includes(id)) usage[bucket].push(id);
  const updated = await dataClient.from(LIBRARY_TRACK_TABLE).update({ usage_relationships: usage, updated_at: now.toISOString() }).eq('id', trackId).eq('user_id', userId).select('*').single();
  if(updated.error) return { error: updated.error };
  return { track: sanitizeLibraryTrack(updated.data) };
}

function normalizeCratePayload(userId, input = {}, now = new Date(), existing = null){
  const type = LIBRARY_CRATE_TYPES.includes(input.type) ? input.type : (existing && existing.type) || 'crate';
  const visibility = LIBRARY_VISIBILITIES.includes(input.visibility) ? input.visibility : (existing && existing.visibility) || 'private';
  return {
    id: input.id || existing && existing.id || randomUUID(),
    user_id: userId,
    name: normalizeString(input.name, existing && existing.name || 'New Crate').slice(0, 120) || 'New Crate',
    description: normalizeString(input.description, existing && existing.description || '').slice(0, 500),
    artwork_metadata: input.artwork != null ? sanitizeCrateArtworkMetadata(input.artwork) : existing && existing.artwork_metadata || null,
    visibility,
    type,
    parent_folder_id: normalizeString(input.parentFolderId || input.parent_folder_id || existing && existing.parent_folder_id) || null,
    smart_rules: type === 'smart_crate' ? sanitizeSmartCrateRules(input.smartRules || input.smart_rules || existing && existing.smart_rules) : null,
    allow_duplicates: Boolean(input.allowDuplicates != null ? input.allowDuplicates : existing && existing.allow_duplicates),
    created_at: existing && existing.created_at || now.toISOString(),
    updated_at: now.toISOString(),
    archived_at: existing && existing.archived_at || null
  };
}

function camelotCompatible(left, right){
  const a = camelotKeyFor(left) || normalizeString(left).toUpperCase();
  const b = camelotKeyFor(right) || normalizeString(right).toUpperCase();
  if(!/^(?:[1-9]|1[0-2])[AB]$/.test(a) || !/^(?:[1-9]|1[0-2])[AB]$/.test(b)) return false;
  if(a === b) return true;
  const aNum = Number(a.slice(0, -1));
  const bNum = Number(b.slice(0, -1));
  const adjacent = Math.abs(aNum - bNum) === 1 || Math.abs(aNum - bNum) === 11;
  return (a.slice(-1) === b.slice(-1) && adjacent) || (aNum === bNum && a.slice(-1) !== b.slice(-1));
}

function trackBattleReady(row){
  const rights = normalizeString(row && row.rights_classification).toLowerCase();
  return Boolean(row && !row.archived_at && row.audio_storage_object_path && !rights.includes('commercial'));
}

function trackMatchesSmartRules(row, rules = {}, tracksById = new Map()){
  if(!row || row.archived_at) return false;
  const bpm = Number(row.bpm);
  if(rules.bpmMin != null && (!Number.isFinite(bpm) || bpm < Number(rules.bpmMin))) return false;
  if(rules.bpmMax != null && (!Number.isFinite(bpm) || bpm > Number(rules.bpmMax))) return false;
  if(rules.genre && normalizeString(row.genre).toLowerCase() !== normalizeString(rules.genre).toLowerCase()) return false;
  if(rules.mediaType && normalizeString(row.source_type).toLowerCase() !== normalizeString(rules.mediaType).toLowerCase()) return false;
  if(rules.rightsClassification && normalizeString(row.rights_classification).toLowerCase() !== normalizeString(rules.rightsClassification).toLowerCase()) return false;
  if(rules.visibility && normalizeString(row.visibility).toLowerCase() !== normalizeString(rules.visibility).toLowerCase()) return false;
  if(rules.analysisStatus === 'missing' && row.analysis_confidence != null) return false;
  if(rules.analysisStatus === 'analyzed' && row.analysis_confidence == null) return false;
  if(rules.battleReady != null && trackBattleReady(row) !== Boolean(rules.battleReady)) return false;
  if(rules.ratingMin != null && Number(row.rating || row.user_rating || 0) < Number(rules.ratingMin)) return false;
  if(rules.dateAddedAfter && Date.parse(row.created_at || '') < Date.parse(rules.dateAddedAfter)) return false;
  if(rules.key && normalizeKeyName(row.key) !== normalizeKeyName(rules.key)) return false;
  if(rules.camelotKey && (row.camelot_key || camelotKeyFor(row.key)) !== normalizeString(rules.camelotKey).toUpperCase()) return false;
  if(rules.compatibleWithTrackId){
    const base = tracksById.get(normalizeString(rules.compatibleWithTrackId));
    if(!base || !camelotCompatible(base.camelot_key || base.key, row.camelot_key || row.key)) return false;
    if(base.bpm && row.bpm && Math.abs(Number(base.bpm) - Number(row.bpm)) / Number(base.bpm) > 0.06) return false;
  }
  return true;
}

function sanitizeLibraryCrate(row, memberships = [], tracks = []){
  if(!row) return null;
  const activeMemberships = memberships
    .filter(item => !item.archived_at && String(item.crate_id) === String(row.id))
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const tracksById = new Map(tracks.filter(track => !track.archived_at).map(track => [String(track.id), track]));
  const smartRules = row.type === 'smart_crate' ? sanitizeSmartCrateRules(row.smart_rules) : null;
  const trackIds = row.type === 'smart_crate'
    ? tracks.filter(track => trackMatchesSmartRules(track, smartRules, tracksById)).map(track => String(track.id))
    : activeMemberships.map(item => String(item.track_id));
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description || '',
    artwork: row.artwork_metadata || null,
    visibility: row.visibility || 'private',
    type: row.type || 'crate',
    parentFolderId: row.parent_folder_id || null,
    smartRules,
    allowDuplicates: Boolean(row.allow_duplicates),
    trackIds,
    memberCount: trackIds.length,
    syncVersion: row.updated_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    archived: Boolean(row.archived_at)
  };
}

async function getOwnedLibraryCrate(dataClient, userId, crateId){
  const result = await dataClient.from(LIBRARY_CRATE_TABLE).select('*').eq('id', crateId).limit(1).single();
  if(result.error) return { error: result.error };
  if(!result.data || result.data.archived_at) return { unavailable: true };
  if(String(result.data.user_id) !== String(userId)) return { forbidden: true };
  return { crate: result.data };
}

async function listOwnedLibraryCrates(dataClient, userId){
  const cratesResult = await dataClient.from(LIBRARY_CRATE_TABLE).select('*').eq('user_id', userId);
  if(cratesResult.error) return { error: cratesResult.error };
  const membershipsResult = await dataClient.from(LIBRARY_CRATE_MEMBERSHIP_TABLE).select('*').eq('user_id', userId);
  if(membershipsResult.error) return { error: membershipsResult.error };
  const tracksResult = await dataClient.from(LIBRARY_TRACK_TABLE).select('*').eq('user_id', userId);
  if(tracksResult.error) return { error: tracksResult.error };
  const crates = (cratesResult.data || [])
    .filter(row => !row.archived_at)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric:true, sensitivity:'base' }))
    .map(row => sanitizeLibraryCrate(row, membershipsResult.data || [], tracksResult.data || []));
  return { crates };
}

async function createLibraryCrate(dataClient, userId, input = {}, now = new Date()){
  const payload = normalizeCratePayload(userId, input, now);
  const inserted = await dataClient.from(LIBRARY_CRATE_TABLE).insert([payload]).select('*').single();
  if(inserted.error) return { error: inserted.error };
  if(Array.isArray(input.trackIds) && input.trackIds.length){
    return setLibraryCrateMemberships(dataClient, userId, inserted.data.id, input.trackIds, { allowDuplicates:payload.allow_duplicates }, now);
  }
  return { crate: sanitizeLibraryCrate(inserted.data), rawCrate: inserted.data, created:true };
}

async function updateLibraryCrate(dataClient, userId, crateId, input = {}, now = new Date()){
  const owned = await getOwnedLibraryCrate(dataClient, userId, crateId);
  if(owned.error || owned.forbidden || owned.unavailable) return owned;
  if(input.expectedSyncVersion && owned.crate.updated_at && String(input.expectedSyncVersion) !== String(owned.crate.updated_at)) return { conflict:true };
  const payload = normalizeCratePayload(userId, input, now, owned.crate);
  const updated = await dataClient.from(LIBRARY_CRATE_TABLE).update({
    name: payload.name,
    description: payload.description,
    visibility: payload.visibility,
    type: payload.type,
    parent_folder_id: payload.parent_folder_id,
    artwork_metadata: payload.artwork_metadata,
    smart_rules: payload.smart_rules,
    allow_duplicates: payload.allow_duplicates,
    updated_at: payload.updated_at
  }).eq('id', crateId).eq('user_id', userId).select('*').single();
  if(updated.error) return { error: updated.error };
  return { crate: sanitizeLibraryCrate(updated.data), rawCrate: updated.data };
}

async function archiveLibraryCrate(dataClient, userId, crateId, now = new Date()){
  const owned = await getOwnedLibraryCrate(dataClient, userId, crateId);
  if(owned.error || owned.forbidden || owned.unavailable) return owned;
  const updated = await dataClient.from(LIBRARY_CRATE_TABLE).update({ archived_at: now.toISOString(), updated_at: now.toISOString() }).eq('id', crateId).eq('user_id', userId).select('*').single();
  if(updated.error) return { error: updated.error };
  await dataClient.from(LIBRARY_CRATE_MEMBERSHIP_TABLE).update({ archived_at: now.toISOString() }).eq('crate_id', crateId).eq('user_id', userId);
  return { crate: sanitizeLibraryCrate(updated.data) };
}

async function setLibraryCrateMemberships(dataClient, userId, crateId, trackIds = [], options = {}, now = new Date()){
  const owned = await getOwnedLibraryCrate(dataClient, userId, crateId);
  if(owned.error || owned.forbidden || owned.unavailable) return owned;
  const ids = normalizeStringList(trackIds, 500);
  const allowDuplicates = Boolean(options.allowDuplicates || owned.crate.allow_duplicates);
  if(!allowDuplicates && new Set(ids).size !== ids.length) return { validationError:'Duplicate crate memberships are not allowed' };
  const tracksResult = await dataClient.from(LIBRARY_TRACK_TABLE).select('*').eq('user_id', userId);
  if(tracksResult.error) return { error: tracksResult.error };
  const ownedTrackIds = new Set((tracksResult.data || []).filter(row => !row.archived_at).map(row => String(row.id)));
  const foreign = ids.find(id => !ownedTrackIds.has(String(id)));
  if(foreign) return { forbidden:true };
  await dataClient.from(LIBRARY_CRATE_MEMBERSHIP_TABLE).update({ archived_at: now.toISOString() }).eq('crate_id', crateId).eq('user_id', userId);
  const rows = ids.map((trackId, position) => ({
    id: randomUUID(),
    user_id: userId,
    crate_id: crateId,
    track_id: trackId,
    position,
    created_at: now.toISOString(),
    archived_at: null
  }));
  if(rows.length){
    const inserted = await dataClient.from(LIBRARY_CRATE_MEMBERSHIP_TABLE).insert(rows).select('*');
    if(inserted.error) return { error: inserted.error };
  }
  const crateUpdated = await dataClient.from(LIBRARY_CRATE_TABLE).update({ updated_at: now.toISOString() }).eq('id', crateId).eq('user_id', userId).select('*').single();
  if(crateUpdated.error) return { error: crateUpdated.error };
  return { crate: sanitizeLibraryCrate(crateUpdated.data, rows, tracksResult.data || []), memberships: rows };
}

async function duplicateLibraryCrate(dataClient, userId, crateId, input = {}, now = new Date()){
  const owned = await getOwnedLibraryCrate(dataClient, userId, crateId);
  if(owned.error || owned.forbidden || owned.unavailable) return owned;
  const memberships = await dataClient.from(LIBRARY_CRATE_MEMBERSHIP_TABLE).select('*').eq('crate_id', crateId).eq('user_id', userId);
  if(memberships.error) return { error: memberships.error };
  const created = await createLibraryCrate(dataClient, userId, {
    name: input.name || `${owned.crate.name} Copy`,
    description: owned.crate.description,
    visibility: owned.crate.visibility,
    type: owned.crate.type,
    parentFolderId: owned.crate.parent_folder_id,
    smartRules: owned.crate.smart_rules,
    allowDuplicates: owned.crate.allow_duplicates
  }, now);
  if(created.error) return created;
  if(owned.crate.type !== 'smart_crate'){
    const orderedIds = (memberships.data || []).filter(row => !row.archived_at).sort((a, b) => Number(a.position || 0) - Number(b.position || 0)).map(row => row.track_id);
    if(orderedIds.length) return setLibraryCrateMemberships(dataClient, userId, created.rawCrate.id, orderedIds, { allowDuplicates:owned.crate.allow_duplicates }, now);
  }
  return created;
}

async function createPracticeRecordingFromSubmission(dataClient, userId, input = {}, now = new Date()){
  if(!input.sourceSubmissionId && !input.linkedSubmissionId) return { validationError:'A source submission is required' };
  return createLibraryTrack(dataClient, userId, {
    ...input,
    sourceType:'practice_recording',
    sourceSubmissionId: input.sourceSubmissionId || input.linkedSubmissionId,
    usageRelationships: {
      ...sanitizeUsageRelationships(input.usageRelationships),
      practiceHistory: normalizeStringList([input.practiceHistoryId || input.practiceMetadata && input.practiceMetadata.practiceHistoryId].filter(Boolean))
    },
    practiceMetadata: {
      ...sanitizePracticeMetadata(input.practiceMetadata),
      practiceHistoryId: input.practiceHistoryId || input.practiceMetadata && input.practiceMetadata.practiceHistoryId || null,
      score: input.score != null ? input.score : input.practiceMetadata && input.practiceMetadata.score,
      recommendations: input.recommendations || input.practiceMetadata && input.practiceMetadata.recommendations || []
    },
    analysisSummary: input.analysisSummary
  }, now);
}

module.exports = {
  LIBRARY_ARTWORK_BUCKET,
  LIBRARY_TRACK_TABLE,
  LIBRARY_CRATE_TABLE,
  LIBRARY_CRATE_MEMBERSHIP_TABLE,
  LIBRARY_ARTWORK_MAX_BYTES,
  ALLOWED_ARTWORK_MIME_TYPES,
  LIBRARY_SOURCE_TYPES,
  LIBRARY_CRATE_TYPES,
  buildLibraryTrackPayload,
  camelotKeyFor,
  checkMusicLibrarySchemaReadiness,
  checkMusicLibraryOrganizationSchemaReadiness,
  validateArtworkMetadata,
  sanitizeLibraryTrack,
  sanitizeLibraryCrate,
  sanitizeSmartCrateRules,
  trackMatchesSmartRules,
  createLibraryTrack,
  getOwnedLibraryTrack,
  listOwnedLibraryTracks,
  updateLibraryTrack,
  archiveLibraryTrack,
  issueLibraryAudioUploadAuthorization,
  completeLibraryAudioUpload,
  issueLibraryArtworkUploadAuthorization,
  completeLibraryArtworkUpload,
  removeLibraryArtwork,
  issueLibraryPlaybackAccess,
  recordLibraryTrackUsage,
  createLibraryCrate,
  updateLibraryCrate,
  archiveLibraryCrate,
  duplicateLibraryCrate,
  listOwnedLibraryCrates,
  setLibraryCrateMemberships,
  createPracticeRecordingFromSubmission
};
