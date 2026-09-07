const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const { validateUploadMetadata, buildUploadObjectPath, issueUploadAuthorization, completeUpload } = require('../battle_submission');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'sql', '010_private_mix_uploads.sql'), 'utf8');
const source = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const now = new Date('2026-01-01T00:00:00Z');

function submission(overrides={}){
  return { id:'sub-1', battle_entry_id:'entry-1', user_id:'user-1', storage_object_path:'private/battle-entries/entry-1/submissions/sub-1', original_filename:'mix.webm', declared_mime_type:'audio/webm', file_size:10, status:'draft', ...overrides };
}

function database(row){
  return { from(){ return { select(){ return this; }, eq(){ return this; }, limit(){ return this; }, update(values){ this.values=values; return this; }, async single(){ return { data:{ ...row, ...(this.values || {}) }, error:null }; } }; } };
}

describe('private mix upload contract', () => {
  it('rejects invalid MIME, zero/oversize files, and unsafe filenames', () => {
    expect(validateUploadMetadata(submission({ declared_mime_type:'text/plain' })).error).to.exist;
    expect(validateUploadMetadata(submission({ declared_mime_type:'audio/mpeg' })).error).to.equal('Unsupported audio file extension');
    expect(validateUploadMetadata(submission({ file_size:0 })).error).to.exist;
    expect(validateUploadMetadata(submission({ file_size:999999999 })).error).to.exist;
    expect(validateUploadMetadata(submission({ original_filename:'../mix.webm' })).error).to.exist;
    expect(buildUploadObjectPath(submission({ storage_object_path:'private/other' }), 'webm')).to.equal(null);
  });

  it('issues an exact private signed upload for an owned draft and moves to uploading', async () => {
    let signedPath;
    const storage={ createSignedUploadUrl:async path=>{ signedPath=path; return {data:{signedUrl:'signed-upload-url',path,token:'upload-token'},error:null}; } };
    const result=await issueUploadAuthorization(database(submission()),storage,'user-1','sub-1',now);
    expect(signedPath).to.equal('private/battle-entries/entry-1/submissions/sub-1/mix.webm');
    expect(result.uploadPath).to.equal(signedPath); expect(result.uploadToken).to.equal('upload-token');
    expect(result.submission.status).to.equal('uploading');
    expect(result.expiresAt).to.equal('2026-01-01T00:15:00.000Z');
  });

  it('rejects foreign, completed, and processing submissions', async () => {
    const storage={ createSignedUploadUrl:async()=>({data:{signedUrl:'x',path:'private/battle-entries/entry-1/submissions/sub-1/mix.webm',token:'token'},error:null}) };
    expect((await issueUploadAuthorization(database(submission({user_id:'user-2'})),storage,'user-1','sub-1',now)).forbidden).to.equal(true);
    expect((await issueUploadAuthorization(database(submission({status:'completed'})),storage,'user-1','sub-1',now)).invalidState).to.equal(true);
    expect((await issueUploadAuthorization(database(submission({status:'processing'})),storage,'user-1','sub-1',now)).invalidState).to.equal(true);
  });

  it('requires exact stored object size and allowed MIME before moving to uploaded', async () => {
    const pending=submission({ status:'uploading', storage_object_path:'private/battle-entries/entry-1/submissions/sub-1/mix.webm', upload_expires_at:'2026-01-01T00:15:00.000Z' });
    const valid={ list:async()=>({data:[{name:'mix.webm',metadata:{size:10,mimetype:'audio/webm'}}],error:null}) };
    const result=await completeUpload(database(pending),valid,'user-1','sub-1',now);
    expect(result.submission.status).to.equal('uploaded');
    expect((await completeUpload(database(pending),{list:async()=>({data:[],error:null})},'user-1','sub-1',now)).verificationFailed).to.equal(true);
    expect((await completeUpload(database(pending),{list:async()=>({data:[{name:'mix.webm',metadata:{size:9,mimetype:'audio/webm'}}],error:null})},'user-1','sub-1',now)).verificationFailed).to.equal(true);
    expect((await completeUpload(database(pending),{list:async()=>({data:[{name:'mix.webm',metadata:{size:10,mimetype:'text/plain'}}],error:null})},'user-1','sub-1',now)).verificationFailed).to.equal(true);
  });

  it('defines a private bucket and protected routes without public URLs or credentials', () => {
    expect(sql).to.include("'battle-mixes', 'battle-mixes', false");
    expect(sql).to.include('upload_expires_at');
    expect(sql).to.include('verified_object_size');
    expect(sql).to.include('verified_mime_type');
    expect(source).to.include("/api/mixSubmissions/:submissionId/uploadAuthorization', requireAuth");
    expect(source).to.include("/api/mixSubmissions/:submissionId/completeUpload', requireAuth");
    expect(source).to.not.include('createPublicUrl');
    expect(source).to.not.include('SUPABASE_SERVICE_KEY:');
  });
});
