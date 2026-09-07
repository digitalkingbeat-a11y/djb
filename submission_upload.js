(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root) root.DJBattleSubmission = api;
})(typeof window !== 'undefined' ? window : globalThis, function(){
  const allowedTypes = new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/webm']);
  const maxSize = 100 * 1024 * 1024;

  function validateFile(file){
    if(!file) return 'Choose a mix file first.';
    if(!allowedTypes.has(file.type)) return 'Unsupported audio format.';
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

  async function submitMix({ apiRequest, supabase, battleId, file, onStatus, battleContext, submissionSource }){
    const validation = validateFile(file); if(validation) return { error: validation };
    onStatus('Preparing upload');
    const entry = await apiRequest('/api/battleEntries', { method:'POST', body:{ battleId } });
    if(entry.error) return entry;
    const draftBody = { originalFilename:file.name, declaredMimeType:file.type, fileSize:file.size, duration:null, submissionSource: submissionSource === 'battle_studio' ? 'battle_studio' : 'uploaded_mix' };
    if(battleContext) draftBody.battleContext = battleContext;
    const draft = await apiRequest(`/api/battleEntries/${entry.data.entry.id}/submissions`, { method:'POST', body:draftBody });
    if(draft.error) return draft;
    const submission = draft.data.submission;
    saveIds(battleId, entry.data.entry.id, submission.id);
    const authorization = await apiRequest(`/api/mixSubmissions/${submission.id}/uploadAuthorization`, { method:'POST' });
    if(authorization.error) return authorization;
    onStatus('Uploading');
    try{
      const storage = supabase && supabase.storage && supabase.storage.from(authorization.data.bucket);
      if(!storage) return { error:'Sign in is required to continue.' };
      const uploaded = await storage.uploadToSignedUrl(authorization.data.uploadPath, authorization.data.uploadToken, file, { contentType:file.type });
      if(uploaded.error) return { error:'Signed upload failed.' };
    }catch(err){ return { error:'Signed upload failed. Please retry with a fresh authorization.' }; }
    onStatus('Verifying');
    const complete = await apiRequest(`/api/mixSubmissions/${submission.id}/completeUpload`, { method:'POST' });
    if(complete.error) return complete;
    if(!complete.data || complete.data.submission.status !== 'uploaded') return { error:'Server did not verify the uploaded mix.' };
    onStatus('Uploaded');
    return { data: complete.data, submissionId: submission.id };
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

  return { validateFile, submitMix, recoverSubmission, fetchJudgingResult, pollJudgingResult };
});
