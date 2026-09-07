const assert = require('assert/strict');
const test = require('node:test');
const { validateFile, submitMix, pollJudgingResult } = require('../submission_upload');

const file = { name:'mix.webm', type:'audio/webm', size:10 };
const storage = new Map();
global.localStorage = { getItem:key=>storage.get(key)||null, setItem:(key,value)=>storage.set(key,String(value)) };

test('rejects invalid files before upload authorization', () => {
  assert.match(validateFile({ ...file, type:'text/plain' }), /Unsupported/);
  assert.match(validateFile({ ...file, size:0 }), /empty/);
  assert.match(validateFile({ ...file, size:101 * 1024 * 1024 }), /100 MB/);
  assert.match(validateFile({ ...file, name:'../mix.webm' }), /safe/);
});

test('uses the secure entry, draft, authorization, upload, and completion sequence', async () => {
  const calls=[]; let completed=0;
  const apiRequest=async(path, options={})=>{ calls.push({path,body:options.body}); if(path==='/api/battleEntries') return {data:{entry:{id:'entry-1'}}}; if(path.includes('/submissions')&&!path.includes('uploadAuthorization')&&!path.includes('completeUpload')) return {data:{submission:{id:'sub-1'}}}; if(path.includes('uploadAuthorization')) return {data:{bucket:'battle-mixes',uploadPath:'private/server-path',uploadToken:'server-token'}}; if(path.includes('completeUpload')){ completed++; return {data:{submission:{status:'uploaded'}}}; } };
  let uploadArgs; const supabase={storage:{from:bucket=>({uploadToSignedUrl:async(...args)=>{uploadArgs=[bucket,...args];return {data:{},error:null};}})}};
  const result=await submitMix({apiRequest,supabase,battleId:'battle-1',file,onStatus:()=>{}});
  assert.equal(result.submissionId,'sub-1'); assert.equal(completed,1);
  assert.deepEqual(calls[0].body,{battleId:'battle-1'});
  assert.deepEqual(calls[1].body,{originalFilename:'mix.webm',declaredMimeType:'audio/webm',fileSize:10,duration:null,submissionSource:'uploaded_mix'});
  assert.equal(JSON.stringify(calls).includes('userId'),false);
  assert.equal(JSON.stringify(calls).includes('battle-mixes'),false);
  assert.deepEqual(uploadArgs,['battle-mixes','private/server-path','server-token',file,{contentType:'audio/webm'}]);
});

test('sends battle context metadata with draft submissions when available', async () => {
  const calls=[];
  const battleContext={ modeId:'bitcoin_battle', reward:{ type:'bitcoin', metadata:{ amountSats:2500, custody:'external_pending', walletConnected:false } } };
  const apiRequest=async(path, options={})=>{
    calls.push({path,body:options.body});
    if(path==='/api/battleEntries') return {data:{entry:{id:'entry-1'}}};
    if(path.includes('/submissions')&&!path.includes('uploadAuthorization')&&!path.includes('completeUpload')) return {data:{submission:{id:'sub-1'}}};
    if(path.includes('uploadAuthorization')) return {data:{bucket:'battle-mixes',uploadPath:'private/server-path',uploadToken:'server-token'}};
    if(path.includes('completeUpload')) return {data:{submission:{status:'uploaded'}}};
  };
  const supabase={storage:{from:()=>({uploadToSignedUrl:async()=>({data:{},error:null})})}};
  await submitMix({apiRequest,supabase,battleId:'battle-1',file,onStatus:()=>{},battleContext});
  assert.deepEqual(calls[1].body.battleContext,battleContext);
});

test('records battle_studio as the explicit submission source for Battle Studio takes', async () => {
  const calls=[];
  const apiRequest=async(path, options={})=>{
    calls.push({path,body:options.body});
    if(path==='/api/battleEntries') return {data:{entry:{id:'entry-1'}}};
    if(path.includes('/submissions')&&!path.includes('uploadAuthorization')&&!path.includes('completeUpload')) return {data:{submission:{id:'sub-1'}}};
    if(path.includes('uploadAuthorization')) return {data:{bucket:'battle-mixes',uploadPath:'private/server-path',uploadToken:'server-token'}};
    if(path.includes('completeUpload')) return {data:{submission:{status:'uploaded'}}};
  };
  const supabase={storage:{from:()=>({uploadToSignedUrl:async()=>({data:{},error:null})})}};
  await submitMix({apiRequest,supabase,battleId:'battle-1',file,onStatus:()=>{},submissionSource:'battle_studio'});
  assert.equal(calls[1].body.submissionSource,'battle_studio');
});

test('does not complete after signed upload failure and requests fresh authorization on retry', async () => {
  let authorizations=0; let completions=0;
  const apiRequest=async(path)=>{ if(path==='/api/battleEntries') return {data:{entry:{id:'entry-1'}}}; if(path.includes('uploadAuthorization')) return {data:{bucket:'battle-mixes',uploadPath:'path',uploadToken:`token-${++authorizations}`}}; if(path.includes('completeUpload')){ completions++; return {data:{submission:{status:'uploaded'}}}; } return {data:{submission:{id:'sub-1'}}}; };
  const failed=await submitMix({apiRequest,supabase:{storage:{from:()=>({uploadToSignedUrl:async()=>({error:new Error('failed')})})}},battleId:'battle-1',file,onStatus:()=>{}});
  assert.match(failed.error,/Signed upload failed/); assert.equal(completions,0);
  await submitMix({apiRequest,supabase:{storage:{from:()=>({uploadToSignedUrl:async()=>({data:{},error:null})})}},battleId:'battle-1',file,onStatus:()=>{}});
  assert.equal(authorizations,2); assert.equal(completions,1);
});

test('does not upload or report success when backend authentication is unavailable', async () => {
  let uploads=0; let completions=0;
  const apiRequest=async(path)=>{
    if(path==='/api/battleEntries') return {error:'Authenticated server features are unavailable because Supabase is not configured.',status:503};
    if(path.includes('completeUpload')) completions++;
    return {data:{}};
  };
  const result=await submitMix({apiRequest,supabase:{storage:{from:()=>({uploadToSignedUrl:async()=>{ uploads++; return {data:{},error:null}; }})}},battleId:'battle-1',file,onStatus:()=>{}});
  assert.equal(result.status,503);
  assert.match(result.error,/Supabase is not configured/);
  assert.equal(uploads,0);
  assert.equal(completions,0);
});

test('does not upload or complete when upload authorization fails', async () => {
  let uploads=0; let completions=0;
  const apiRequest=async(path)=>{
    if(path==='/api/battleEntries') return {data:{entry:{id:'entry-1'}}};
    if(path.includes('/submissions')&&!path.includes('uploadAuthorization')&&!path.includes('completeUpload')) return {data:{submission:{id:'sub-1'}}};
    if(path.includes('uploadAuthorization')) return {error:'The authenticated server is unavailable. Please try again later.',status:503};
    if(path.includes('completeUpload')){ completions++; return {data:{submission:{status:'uploaded'}}}; }
  };
  const result=await submitMix({apiRequest,supabase:{storage:{from:()=>({uploadToSignedUrl:async()=>{ uploads++; return {data:{},error:null}; }})}},battleId:'battle-1',file,onStatus:()=>{}});
  assert.equal(result.status,503);
  assert.match(result.error,/unavailable/);
  assert.equal(uploads,0);
  assert.equal(completions,0);
});

test('polls the owned judging-result endpoint until a completed judge result is available', async () => {
  const paths = [];
  const statuses = [];
  const responses = [
    { data:{ status:'uploaded', judgeResult:null } },
    { data:{ status:'judging', judgeResult:null } },
    { data:{ status:'completed', judgeResult:{ overallScore:88, components:{ timing:92 } } } }
  ];
  const result = await pollJudgingResult({
    apiRequest: async path => {
      paths.push(path);
      return responses.shift();
    },
    submissionId: 'sub-1',
    onStatus: status => statuses.push(status),
    attempts: 3,
    intervalMs: 0,
    wait: async () => {}
  });

  assert.equal(result.data.status, 'completed');
  assert.equal(result.data.judgeResult.overallScore, 88);
  assert.deepEqual(paths, [
    '/api/mixSubmissions/sub-1/judgingResult',
    '/api/mixSubmissions/sub-1/judgingResult',
    '/api/mixSubmissions/sub-1/judgingResult'
  ]);
  assert.deepEqual(statuses, ['Judging']);
});

test('polling returns pending without fabricating judge scores', async () => {
  const result = await pollJudgingResult({
    apiRequest: async () => ({ data:{ status:'uploaded', judgeResult:null } }),
    submissionId: 'sub-1',
    attempts: 2,
    intervalMs: 0,
    wait: async () => {}
  });

  assert.equal(result.data.status, 'pending');
  assert.equal(result.data.judgeResult, null);
});

test('polling returns failed judging status for retry messaging', async () => {
  const statuses = [];
  const result = await pollJudgingResult({
    apiRequest: async () => ({ data:{ status:'failed', judgeResult:null, submission:{ processing_info:{ judging_retryable:true } } } }),
    submissionId: 'sub-1',
    onStatus: status => statuses.push(status),
    attempts: 2,
    intervalMs: 0,
    wait: async () => {}
  });

  assert.equal(result.data.status, 'failed');
  assert.deepEqual(statuses, ['Failed']);
});
