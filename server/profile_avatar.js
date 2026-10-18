// Profile photos: signed upload to a public "profile-avatars" bucket, verification, and
// saving the public URL on the Supabase user's metadata (avatar_url).
const PROFILE_AVATAR_BUCKET = 'profile-avatars';
const PROFILE_AVATAR_MAX_BYTES = 512 * 1024;
const AVATAR_MIME_TYPES = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp' };
const UPLOAD_WINDOW_MS = 15 * 60 * 1000;

function cleanUserId(userId){
  const text = String(userId || '').trim();
  return /^[A-Za-z0-9._:-]{1,128}$/.test(text) ? text : '';
}

function validateAvatarMetadata(input = {}){
  const mimeType = String(input.mimeType || input.mime_type || '').toLowerCase();
  const size = Number(input.size);
  if(!AVATAR_MIME_TYPES[mimeType]) return { error:'Profile photo must be a JPG, PNG or WebP image.' };
  if(!Number.isFinite(size) || size <= 0) return { error:'Profile photo size is missing.' };
  if(size > PROFILE_AVATAR_MAX_BYTES) return { error:'Profile photo must be 512 KB or smaller.' };
  return { mimeType, size, extension:AVATAR_MIME_TYPES[mimeType] };
}

function avatarFolder(userId){ return `avatars/${userId}`; }

function isOwnedAvatarPath(userId, uploadPath){
  const path = String(uploadPath || '');
  return Boolean(userId) && path.startsWith(`${avatarFolder(userId)}/`) && !path.includes('..') && /^[A-Za-z0-9._:/-]+$/.test(path);
}

async function issueAvatarUploadAuthorization(storage, userId, input = {}, now = new Date()){
  const owner = cleanUserId(userId);
  if(!owner) return { forbidden:true };
  const validation = validateAvatarMetadata(input);
  if(validation.error) return { validationError:validation.error };
  // A fresh object name per upload so browsers and CDNs never show a stale photo.
  const objectPath = `${avatarFolder(owner)}/avatar-${now.getTime()}.${validation.extension}`;
  const signed = await storage.createSignedUploadUrl(objectPath, { upsert:true });
  if(signed.error) return { error:signed.error };
  return {
    bucket:PROFILE_AVATAR_BUCKET,
    uploadPath:signed.data && signed.data.path || objectPath,
    uploadToken:signed.data && signed.data.token,
    expiresAt:new Date(now.getTime() + UPLOAD_WINDOW_MS).toISOString(),
    maxBytes:PROFILE_AVATAR_MAX_BYTES
  };
}

async function completeAvatarUpload(storage, authAdmin, userId, input = {}){
  const owner = cleanUserId(userId);
  if(!owner) return { forbidden:true };
  const uploadPath = String(input.uploadPath || input.upload_path || '');
  if(!isOwnedAvatarPath(owner, uploadPath)) return { forbidden:true };
  const slash = uploadPath.lastIndexOf('/');
  const listed = await storage.list(uploadPath.slice(0, slash), { search:uploadPath.slice(slash + 1) });
  if(listed.error) return { error:listed.error };
  const object = (listed.data || []).find(item => item.name === uploadPath.slice(slash + 1));
  const size = object && object.metadata && Number(object.metadata.size);
  const mimeType = object && object.metadata && String(object.metadata.mimetype || '').toLowerCase();
  if(!object || !AVATAR_MIME_TYPES[mimeType] || !(size > 0) || size > PROFILE_AVATAR_MAX_BYTES) return { verificationFailed:true };
  const publicUrl = storage.getPublicUrl(uploadPath);
  const avatarUrl = publicUrl && publicUrl.data && publicUrl.data.publicUrl;
  if(!avatarUrl || !/^https:\/\//i.test(avatarUrl)) return { error:new Error('Avatar public URL unavailable') };
  const saved = await saveAvatarUrl(authAdmin, owner, avatarUrl);
  if(saved.error) return saved;
  return { avatarUrl, uploadPath };
}

async function saveAvatarUrl(authAdmin, userId, avatarUrl){
  if(!authAdmin || typeof authAdmin.getUserById !== 'function' || typeof authAdmin.updateUserById !== 'function') return { error:new Error('Supabase auth admin unavailable') };
  const current = await authAdmin.getUserById(userId);
  if(current.error) return { error:current.error };
  const meta = current.data && current.data.user && current.data.user.user_metadata || {};
  const updated = await authAdmin.updateUserById(userId, { user_metadata:{ ...meta, avatar_url:avatarUrl || null } });
  if(updated.error) return { error:updated.error };
  return { saved:true };
}

async function removeAvatar(storage, authAdmin, userId){
  const owner = cleanUserId(userId);
  if(!owner) return { forbidden:true };
  const listed = await storage.list(avatarFolder(owner), {});
  if(!listed.error && Array.isArray(listed.data) && listed.data.length && typeof storage.remove === 'function'){
    await storage.remove(listed.data.map(item => `${avatarFolder(owner)}/${item.name}`));
  }
  const saved = await saveAvatarUrl(authAdmin, owner, null);
  if(saved.error) return saved;
  return { removed:true };
}

module.exports = {
  PROFILE_AVATAR_BUCKET,
  PROFILE_AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
  validateAvatarMetadata,
  isOwnedAvatarPath,
  issueAvatarUploadAuthorization,
  completeAvatarUpload,
  removeAvatar
};
