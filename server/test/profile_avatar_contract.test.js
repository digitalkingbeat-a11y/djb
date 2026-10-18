const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const ProfileAvatar = require('../profile_avatar');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

function fakeStorage({ objects = [] } = {}){
  const calls = [];
  return {
    calls,
    createSignedUploadUrl: async (objectPath, options) => { calls.push(['sign', objectPath, options]); return { data:{ path:objectPath, token:'tok' }, error:null }; },
    list: async (folder, options) => { calls.push(['list', folder, options]); return { data:objects, error:null }; },
    getPublicUrl: objectPath => ({ data:{ publicUrl:`https://example.supabase.co/storage/v1/object/public/profile-avatars/${objectPath}` } }),
    remove: async paths => { calls.push(['remove', paths]); return { error:null }; }
  };
}
function fakeAdmin(meta = { full_name:'Dan' }){
  const updates = [];
  return {
    updates,
    getUserById: async () => ({ data:{ user:{ user_metadata:meta } }, error:null }),
    updateUserById: async (id, attrs) => { updates.push([id, attrs]); return { data:{}, error:null }; }
  };
}

describe('profile avatar contract', () => {
  it('validates type and size', () => {
    expect(ProfileAvatar.validateAvatarMetadata({ mimeType:'image/jpeg', size:1000 }).extension).to.equal('jpg');
    expect(ProfileAvatar.validateAvatarMetadata({ mimeType:'image/gif', size:1000 }).error).to.match(/JPG, PNG or WebP/);
    expect(ProfileAvatar.validateAvatarMetadata({ mimeType:'image/png', size:600 * 1024 }).error).to.match(/512 KB/);
    expect(ProfileAvatar.validateAvatarMetadata({ mimeType:'image/png' }).error).to.match(/size/);
  });

  it('issues a signed upload inside the user\'s own avatar folder', async () => {
    const storage = fakeStorage();
    const out = await ProfileAvatar.issueAvatarUploadAuthorization(storage, 'user-1', { mimeType:'image/webp', size:2048 }, new Date('2026-10-18T12:00:00Z'));
    expect(out.bucket).to.equal('profile-avatars');
    expect(out.uploadPath).to.match(/^avatars\/user-1\/avatar-\d+\.webp$/);
    expect(out.uploadToken).to.equal('tok');
    const bad = await ProfileAvatar.issueAvatarUploadAuthorization(storage, 'user-1', { mimeType:'text/html', size:10 });
    expect(bad.validationError).to.be.a('string');
  });

  it('refuses to complete uploads outside the user\'s folder', async () => {
    const out = await ProfileAvatar.completeAvatarUpload(fakeStorage(), fakeAdmin(), 'user-1', { uploadPath:'avatars/user-2/avatar-1.jpg' });
    expect(out.forbidden).to.equal(true);
    expect(ProfileAvatar.isOwnedAvatarPath('user-1', 'avatars/user-1/../user-2/x.jpg')).to.equal(false);
  });

  it('verifies the stored object and saves the public URL on user metadata', async () => {
    const storage = fakeStorage({ objects:[{ name:'avatar-1.jpg', metadata:{ size:20000, mimetype:'image/jpeg' } }] });
    const admin = fakeAdmin({ full_name:'Dan', hometown:'Tampa' });
    const out = await ProfileAvatar.completeAvatarUpload(storage, admin, 'user-1', { uploadPath:'avatars/user-1/avatar-1.jpg' });
    expect(out.avatarUrl).to.match(/^https:\/\/.*profile-avatars\/avatars\/user-1\/avatar-1\.jpg$/);
    expect(admin.updates[0][1].user_metadata).to.include({ full_name:'Dan', hometown:'Tampa', avatar_url:out.avatarUrl });
  });

  it('rejects stored objects that are too big or the wrong type', async () => {
    const big = fakeStorage({ objects:[{ name:'avatar-1.jpg', metadata:{ size:900000, mimetype:'image/jpeg' } }] });
    expect((await ProfileAvatar.completeAvatarUpload(big, fakeAdmin(), 'user-1', { uploadPath:'avatars/user-1/avatar-1.jpg' })).verificationFailed).to.equal(true);
    const html = fakeStorage({ objects:[{ name:'avatar-1.jpg', metadata:{ size:100, mimetype:'text/html' } }] });
    expect((await ProfileAvatar.completeAvatarUpload(html, fakeAdmin(), 'user-1', { uploadPath:'avatars/user-1/avatar-1.jpg' })).verificationFailed).to.equal(true);
  });

  it('removes photos and clears avatar_url', async () => {
    const storage = fakeStorage({ objects:[{ name:'avatar-1.jpg' }] });
    const admin = fakeAdmin({ avatar_url:'https://x/y.jpg' });
    const out = await ProfileAvatar.removeAvatar(storage, admin, 'user-1');
    expect(out.removed).to.equal(true);
    expect(storage.calls.find(c => c[0] === 'remove')[1]).to.deep.equal(['avatars/user-1/avatar-1.jpg']);
    expect(admin.updates[0][1].user_metadata.avatar_url).to.equal(null);
  });

  it('exposes authenticated routes and ships the public bucket migration', () => {
    expect(serverSource).to.match(/app\.post\('\/api\/profile\/avatarUploadAuthorization', requireAuth/);
    expect(serverSource).to.match(/app\.post\('\/api\/profile\/completeAvatarUpload', requireAuth/);
    expect(serverSource).to.match(/app\.delete\('\/api\/profile\/avatar', requireAuth/);
    const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '029_create_profile_avatars_bucket.sql'), 'utf8');
    expect(sql).to.match(/'profile-avatars', 'profile-avatars', true, 524288/);
  });
});
