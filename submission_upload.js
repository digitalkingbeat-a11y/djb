(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root) root.DJBattleSubmission = api;
})(typeof window !== 'undefined' ? window : globalThis, function(){
  const allowedTypes = new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/mp4', 'audio/x-m4a', 'audio/m4a']);
  // Browsers can add codec details ("audio/webm;codecs=opus"); only the base type matters here.
  const baseType = type => String(type || '').split(';')[0].trim().toLowerCase();
  const maxSize = 100 * 1024 * 1024;

  function validateFile(file){
    if(!file) return 'Choose a mix file first.';
    if(!allowedTypes.has(baseType(file.type))) return 'Unsupported audio format. Use MP3, WAV, WebM or M4A.';
    if(!file.size) return 'Mix file is empty.';
    if(file.size > maxSize) return 'Mix file exceeds the 100 MB limit.';
    if(!file.name || /[\\/]|\.\./.test(file.name)) return 'Mix filename is not safe.';
    return null;
  }

  function saveIds(battleId, entryId, submissionId){
    const saved = JSON.parse(localStorage.getItem('djBattleSubmissionIds') || '{}');
    saved[String(battleId)] = { entryId, submissionId };
    localStorage.setItem('djBattleSubmissionIds', JSON.stringify(saved));
  }

  async function submitMix({ apiRequest, supabase, battleId, file, onStatus, onProgress, signal, battleContext, submissionSource }){
    const cancelled = () => ({ error:'Upload cancelled.', cancelled:true });
    const validation = validateFile(file); if(validation) return { error: validation };
    onStatus('Preparing upload');
    const entry = await apiRequest('/api/battleEntries', { method:'POST', body:{ battleId } });
    if(entry.error) return entry;
    const draftBody = { originalFilename:file.name, declaredMimeType:baseType(file.type), fileSize:file.size, duration:null, submissionSource: submissionSource === 'battle_studio' ? 'battle_studio' : 'uploaded_mix' };
    if(battleContext) draftBody.battleContext = battleContext;
    const draft = await apiRequest(`/api/battleEntries/${entry.data.entry.id}/submissions`, { method:'POST', body:draftBody });
    if(draft.error) return draft;
    const submission = draft.data.submission;
    saveIds(battleId, entry.data.entry.id, submission.id);
    const authorization = await apiRequest(`/api/mixSubmissions/${submission.id}/uploadAuthorization`, { method:'POST' });
    if(authorization.error) return authorization;
    if(signal && signal.aborted) return cancelled();
    onStatus('Uploading');
    if(onProgress) onProgress(0);
    try{
      const signedUrl = signedUploadUrl(supabase, authorization.data);
      if(signedUrl && typeof XMLHttpRequest === 'function'){
        const uploaded = await xhrUpload({ url:signedUrl, file, contentType:baseType(file.type), onProgress, signal });
        if(uploaded.cancelled) return cancelled();
        if(uploaded.error) return { error:'Signed upload failed.' };
      } else {
        const storage = supabase && supabase.storage && supabase.storage.from(authorization.data.bucket);
        if(!storage) return { error:'Sign in is required to continue.' };
        const uploaded = await storage.uploadToSignedUrl(authorization.data.uploadPath, authorization.data.uploadToken, file, { contentType:baseType(file.type) });
        if(signal && signal.aborted) return cancelled();
        if(uploaded.error) return { error:'Signed upload failed.' };
      }
      if(onProgress) onProgress(1);
    }catch(err){ return { error:'Signed upload failed. Please retry with a fresh authorization.' }; }
    onStatus('Verifying');
    const complete = await apiRequest(`/api/mixSubmissions/${submission.id}/completeUpload`, { method:'POST' });
    if(complete.error) return complete;
    if(!complete.data || complete.data.submission.status !== 'uploaded') return { error:'Server did not verify the uploaded mix.' };
    onStatus('Uploaded');
    return { data: complete.data, submissionId: submission.id };
  }

  function signedUploadUrl(supabase, data){
    if(data && data.signedUrl) return data.signedUrl;
    const base = supabase && (supabase.supabaseUrl || supabase.storageUrl);
    if(!base || !data || !data.bucket || !data.uploadPath || !data.uploadToken) return null;
    const path = String(data.uploadPath).split('/').map(encodeURIComponent).join('/');
    return `${String(base).replace(/\/$/, '')}/storage/v1/object/upload/sign/${encodeURIComponent(data.bucket)}/${path}?token=${encodeURIComponent(data.uploadToken)}`;
  }

  function xhrUpload({ url, file, contentType, onProgress, signal, XHR }){
    const Ctor = XHR || XMLHttpRequest;
    return new Promise(resolve => {
      const xhr = new Ctor();
      xhr.open('PUT', url);
      if(contentType) xhr.setRequestHeader('Content-Type', contentType);
      xhr.setRequestHeader('x-upsert', 'false');
      if(xhr.upload && onProgress) xhr.upload.onprogress = e => { if(e.lengthComputable && e.total) onProgress(e.loaded / e.total); };
      xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300 ? { ok:true } : { error:`Upload failed (${xhr.status}).` });
      xhr.onerror = () => resolve({ error:'Network error during upload.' });
      xhr.onabort = () => resolve({ cancelled:true, error:'Upload cancelled.' });
      if(signal){ if(signal.aborted){ xhr.abort(); return; } signal.addEventListener('abort', () => xhr.abort(), { once:true }); }
      xhr.send(file);
    });
  }

  async function recoverSubmission({ apiRequest, battleId }){
    const saved = JSON.parse(localStorage.getItem('djBattleSubmissionIds') || '{}')[String(battleId)];
    if(!saved || !saved.submissionId) return null;
    return apiRequest(`/api/mixSubmissions/${saved.submissionId}`);
  }

  async function fetchJudgingResult({ apiRequest, submissionId }){
    if(!submissionId) return { error:'Submission ID is required.' };
    return apiRequest(`/api/mixSubmissions/${submissionId}/judgingResult`);
  }

  async function pollJudgingResult({ apiRequest, submissionId, onStatus, attempts = 4, intervalMs = 1500, wait = null }){
    const sleep = wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    for(let attempt = 0; attempt < attempts; attempt += 1){
      const result = await fetchJudgingResult({ apiRequest, submissionId });
      if(result.error) return result;
      const status = result.data && result.data.status;
      if(status === 'judging') onStatus && onStatus('Judging');
      if(status === 'failed'){
        onStatus && onStatus('Failed');
        return result;
      }
      if(status === 'completed' && result.data.judgeResult) return result;
      if(attempt < attempts - 1) await sleep(intervalMs);
    }
    return { data:{ status:'pending', judgeResult:null } };
  }

  return { validateFile, submitMix, xhrUpload, signedUploadUrl, recoverSubmission, fetchJudgingResult, pollJudgingResult };
});
