const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { extractBearerToken } = require('./auth');

const DEFAULT_LIMITS = {
  requestBodyBytes: 1 * 1024 * 1024,
  uploadedAudioBytes: 100 * 1024 * 1024,
  webSocketMessageBytes: 1 * 1024 * 1024,
  webSocketSessionStorageBytes: 100 * 1024 * 1024
};

const ALLOWED_AUDIO_MIME_TYPES = {
  'audio/mpeg': ['mp3'],
  'audio/wav': ['wav'],
  'audio/x-wav': ['wav'],
  'audio/webm': ['webm']
};

function parseByteLimit(value, fallback){
  if(value == null || value === '') return fallback;
  if(typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
  const match = String(value).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/);
  if(!match) return fallback;
  const size = Number(match[1]);
  const unit = match[2] || 'b';
  const multiplier = { b:1, kb:1024, mb:1024*1024, gb:1024*1024*1024 }[unit];
  return Number.isFinite(size) && size > 0 ? Math.floor(size * multiplier) : fallback;
}

function getIngestionLimits(env = process.env){
  return {
    requestBodyBytes: parseByteLimit(env.SERVER_REQUEST_BODY_LIMIT_BYTES || env.REQUEST_BODY_LIMIT_BYTES, DEFAULT_LIMITS.requestBodyBytes),
    uploadedAudioBytes: parseByteLimit(env.SERVER_AUDIO_UPLOAD_LIMIT_BYTES || env.UPLOADED_AUDIO_LIMIT_BYTES || env.MAX_MIX_FILE_SIZE, DEFAULT_LIMITS.uploadedAudioBytes),
    webSocketMessageBytes: parseByteLimit(env.SERVER_WS_MESSAGE_LIMIT_BYTES || env.WS_MESSAGE_LIMIT_BYTES, DEFAULT_LIMITS.webSocketMessageBytes),
    webSocketSessionStorageBytes: parseByteLimit(env.SERVER_WS_SESSION_STORAGE_LIMIT_BYTES || env.WS_SESSION_STORAGE_LIMIT_BYTES, DEFAULT_LIMITS.webSocketSessionStorageBytes)
  };
}

const LIMITS = getIngestionLimits();

function byteLength(value){
  if(Buffer.isBuffer(value)) return value.length;
  if(Array.isArray(value)) return Buffer.concat(value.map(part => Buffer.from(part))).length;
  if(value instanceof ArrayBuffer) return value.byteLength;
  if(ArrayBuffer.isView(value)) return value.byteLength;
  return Buffer.byteLength(String(value || ''), 'utf8');
}

function normalizeMimeType(mimeType){
  return String(mimeType || '').split(';')[0].trim().toLowerCase();
}

function getFileExtension(filename){
  const base = path.basename(String(filename || ''));
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function hasPathTraversal(filename){
  const name = String(filename || '');
  return !name || name !== path.basename(name) || name.includes('..') || /[\\/]/.test(name);
}

function validateRequestBodySize(sizeBytes, limits = LIMITS){
  const size = Number(sizeBytes);
  if(!Number.isFinite(size) || size < 0) return { error: 'Invalid request body size' };
  if(size > limits.requestBodyBytes) return { error: 'Request body exceeds configured limit' };
  return { ok: true };
}

function validateAudioMetadata({ filename, mimeType, size }, limits = LIMITS){
  const numericSize = Number(size);
  if(!Number.isFinite(numericSize) || numericSize <= 0) return { error: 'File size must be greater than zero' };
  if(numericSize > limits.uploadedAudioBytes) return { error: 'File exceeds the maximum allowed size' };
  if(hasPathTraversal(filename)) return { error: 'Invalid filename' };

  const normalizedMimeType = normalizeMimeType(mimeType);
  const allowedExtensions = ALLOWED_AUDIO_MIME_TYPES[normalizedMimeType];
  if(!allowedExtensions) return { error: 'Unsupported audio MIME type' };

  const extension = getFileExtension(filename);
  if(!allowedExtensions.includes(extension)) return { error: 'Unsupported audio file extension' };

  return { mimeType: normalizedMimeType, extension, size: numericSize };
}

function validateWebSocketMessage(message, limits = LIMITS){
  const size = byteLength(message);
  if(size > limits.webSocketMessageBytes) return { error: 'WebSocket message exceeds configured limit', size };
  return { ok: true, size };
}

function validateSessionQuota(currentBytes, nextBytes, limits = LIMITS){
  const current = Number(currentBytes || 0);
  const next = Number(nextBytes || 0);
  if(!Number.isFinite(current) || current < 0 || !Number.isFinite(next) || next < 0) return { error: 'Invalid session storage size' };
  if(current + next > limits.webSocketSessionStorageBytes) return { error: 'WebSocket session storage quota exceeded' };
  return { ok: true, nextUsageBytes: current + next };
}

function sanitizeNamePart(value, fallback){
  const sanitized = String(value || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return sanitized || fallback;
}

function sanitizeExtension(extension){
  const sanitized = String(extension || '').replace(/^\./, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if(!sanitized) throw new Error('Invalid generated file extension');
  return sanitized;
}

function sanitizeGeneratedFilename(prefix, extension){
  const safePrefix = sanitizeNamePart(prefix, 'ingest');
  const safeExtension = sanitizeExtension(extension);
  const suffix = crypto.randomUUID().replace(/-/g, '');
  return `${safePrefix}_${Date.now()}_${suffix}.${safeExtension}`;
}

function safeStoragePath(storageDir, filename){
  if(hasPathTraversal(filename)) throw new Error('Invalid filename');
  const root = path.resolve(storageDir);
  const target = path.resolve(root, filename);
  if(target !== root && target.startsWith(root + path.sep)) return target;
  throw new Error('Invalid storage path');
}

function cleanupIncompleteFile(filePath, fsImpl = fs){
  try{
    if(fsImpl.existsSync(filePath)) fsImpl.unlinkSync(filePath);
  }catch(err){
    // Best-effort cleanup; the caller still receives the original write error.
  }
}

function writeBufferAtomically({ storageDir, filename, buffer, fsImpl = fs }){
  const targetPath = safeStoragePath(storageDir, filename);
  const tempPath = safeStoragePath(storageDir, `${filename}.${crypto.randomUUID().replace(/-/g, '')}.tmp`);
  fsImpl.mkdirSync(storageDir, { recursive: true });
  try{
    fsImpl.writeFileSync(tempPath, buffer, { flag: 'wx' });
    fsImpl.renameSync(tempPath, targetPath);
  }catch(err){
    cleanupIncompleteFile(tempPath, fsImpl);
    throw err;
  }
  return targetPath;
}

function persistIngestionBuffer({ storageDir, prefix, extension, buffer, currentUsageBytes = 0, limits = LIMITS, mimeType, fsImpl = fs }){
  const payload = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if(mimeType){
    const audioCheck = validateAudioMetadata({ filename: `upload.${extension}`, mimeType, size: payload.length }, limits);
    if(audioCheck.error) return audioCheck;
  }
  const quota = validateSessionQuota(currentUsageBytes, payload.length, limits);
  if(quota.error) return quota;
  const filename = sanitizeGeneratedFilename(prefix, extension);
  const filePath = writeBufferAtomically({ storageDir, filename, buffer: payload, fsImpl });
  return { filename, path: filePath, bytes: payload.length, nextUsageBytes: quota.nextUsageBytes };
}

function persistJsonPayload({ storageDir, prefix, data, currentUsageBytes = 0, limits = LIMITS, fsImpl = fs }){
  const buffer = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
  return persistIngestionBuffer({ storageDir, prefix, extension: 'json', buffer, currentUsageBytes, limits, fsImpl });
}

function validateBridgeUserId(data, authenticatedUserId){
  const supplied = data && (data.userId || data.user_id);
  if(supplied != null && String(supplied) !== String(authenticatedUserId)){
    return { error: 'Cannot ingest telemetry for another user' };
  }
  return { ok: true };
}

async function authenticateWebSocketRequest(req, authClient){
  if(!authClient || !authClient.auth || typeof authClient.auth.getUser !== 'function'){
    return { ok: false, statusCode: 503, reason: 'Supabase authentication is not configured' };
  }

  const token = extractBearerToken(req && req.headers && req.headers.authorization);
  if(!token) return { ok: false, statusCode: 401, reason: 'Authentication required' };

  try{
    const { data, error } = await authClient.auth.getUser(token);
    if(error || !data || !data.user || data.user.id == null) return { ok: false, statusCode: 401, reason: 'Invalid access token' };
    return { ok: true, user: data.user, userId: String(data.user.id) };
  }catch(err){
    return { ok: false, statusCode: 401, reason: 'Invalid access token' };
  }
}

module.exports = {
  ALLOWED_AUDIO_MIME_TYPES,
  DEFAULT_LIMITS,
  LIMITS,
  authenticateWebSocketRequest,
  byteLength,
  cleanupIncompleteFile,
  getFileExtension,
  getIngestionLimits,
  hasPathTraversal,
  normalizeMimeType,
  parseByteLimit,
  persistIngestionBuffer,
  persistJsonPayload,
  safeStoragePath,
  sanitizeGeneratedFilename,
  validateAudioMetadata,
  validateBridgeUserId,
  validateRequestBodySize,
  validateSessionQuota,
  validateWebSocketMessage,
  writeBufferAtomically
};
