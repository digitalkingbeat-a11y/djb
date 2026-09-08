const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { apiRequest, getPublicBattle, getSessionToken, submitCommunityBattleVote } = require('../api_client');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function response(status, body, contentType='application/json'){
  return { ok: status >= 200 && status < 300, status, headers: { get: () => contentType }, text: async () => body };
}

function client(session, sessionError){
  return { auth: { getSession: async () => ({ data: { session }, error: sessionError || null }) } };
}

test('authenticated browser API client adds the current session token to protected requests', async () => {
    let call;
    const result = await apiRequest('/api/submitScore', { method:'POST', body:{ score: 90 }, supabase: client({ access_token:'token-1' }), fetch: async (...args) => { call = args; return response(200, '{"success":true}'); } });
  assert.equal(call[1].headers.Authorization, 'Bearer token-1');
  assert.equal(call[1].headers['Content-Type'], 'application/json');
  assert.equal(call[1].body, '{"score":90}');
  assert.equal(result.data.success, true);
});

test('authenticated browser API client does not send protected requests without a session', async () => {
    let called = false;
    const result = await apiRequest('/api/submitScore', { supabase: client(null), fetch: async () => { called = true; } });
  assert.equal(called, false);
  assert.equal(result.status, 401);
  assert.match(result.error, /Sign in is required/);
});

test('authenticated browser API client does not send protected requests when Supabase is not configured', async () => {
    let called = false;
    const result = await apiRequest('/api/submitScore', { fetch: async () => { called = true; } });
  assert.equal(called, false);
  assert.equal(result.status, 503);
  assert.match(result.error, /Supabase is not configured/);
});

test('authenticated browser API client handles invalid sessions and server auth failures clearly', async () => {
    const invalid = await apiRequest('/api/submitScore', { supabase: { auth: { getSession: async () => { throw new Error('expired'); } } } });
    const unauthorized = await apiRequest('/api/submitScore', { supabase: client({ access_token:'token-1' }), fetch: async () => response(401, 'not json', 'text/plain') });
    const forbidden = await apiRequest('/api/submitScore', { supabase: client({ access_token:'token-1' }), fetch: async () => response(403, '{"error":"forbidden"}') });
  assert.equal(invalid.status, 401);
  assert.match(invalid.error, /Sign in is required/);
  assert.match(unauthorized.error, /Sign in is required/);
  assert.match(forbidden.error, /not authorized/);
});

test('authenticated browser API client maps upload and availability failures consistently', async () => {
  const authed = client({ access_token:'token-1' });
  const tooLarge = await apiRequest('/api/battleEntries/entry-1/submissions', { method:'POST', body:{}, supabase: authed, fetch: async () => response(413, '{"error":"server detail"}') });
  const unsupported = await apiRequest('/api/battleEntries/entry-1/submissions', { method:'POST', body:{}, supabase: authed, fetch: async () => response(415, '{}') });
  const rateLimited = await apiRequest('/api/submitScore', { method:'POST', body:{ score:90 }, supabase: authed, fetch: async () => response(429, '{}') });
  const unavailable = await apiRequest('/api/submitJudgeBreakdown', { method:'POST', body:{ analysis:{} }, supabase: authed, fetch: async () => response(503, '{"error":"down"}') });
  const network = await apiRequest('/api/submitBeltAttempt', { method:'POST', body:{}, supabase: authed, fetch: async () => { throw new Error('offline'); } });
  assert.equal(tooLarge.status, 413);
  assert.match(tooLarge.error, /too large/);
  assert.equal(unsupported.status, 415);
  assert.match(unsupported.error, /not supported/);
  assert.equal(rateLimited.status, 429);
  assert.match(rateLimited.error, /Too many requests/);
  assert.equal(unavailable.status, 503);
  assert.match(unavailable.error, /unavailable/);
  assert.equal(network.status, 0);
  assert.match(network.error, /not saved/);
});

test('session token helper returns the current Supabase session token only when available', async () => {
  assert.deepEqual(await getSessionToken({ supabase: client({ access_token:'token-1' }) }), { token:'token-1' });
  assert.equal((await getSessionToken({ supabase: client(null) })).status, 401);
  assert.equal((await getSessionToken({ supabase: null })).status, 503);
});

test('authenticated browser API client loads public belt definitions without a token', async () => {
    let headers;
    const result = await apiRequest('/api/getBelts', { public:true, fetch: async (path, options) => { headers = options.headers; return response(200, '{"success":true,"belts":[]}'); } });
  assert.equal(headers.Authorization, undefined);
  assert.equal(result.data.success, true);
});

test('browser API client loads public battle shares without a token', async () => {
  let call;
  const result = await getPublicBattle('battle share/1', {
    fetch: async (...args) => { call = args; return response(200, '{"success":true,"battle":{"id":"battle share/1"}}'); }
  });
  assert.equal(call[0], '/api/publicBattles/battle%20share%2F1');
  assert.equal(call[1].headers.Authorization, undefined);
  assert.equal(result.data.battle.id, 'battle share/1');
});

test('browser API client submits authenticated community battle votes', async () => {
  let call;
  const result = await submitCommunityBattleVote('battle-1', { publicEntryId:'entry_a', score:92, idempotencyKey:'idem-1' }, {
    supabase: client({ access_token:'token-1' }),
    fetch: async (...args) => { call = args; return response(200, '{"success":true,"vote":{"score":92}}'); }
  });
  assert.equal(call[0], '/api/publicBattles/battle-1/votes');
  assert.equal(call[1].method, 'POST');
  assert.equal(call[1].headers.Authorization, 'Bearer token-1');
  assert.equal(call[1].body, '{"publicEntryId":"entry_a","score":92,"idempotencyKey":"idem-1"}');
  assert.equal(result.data.vote.score, 92);
});

test('protected frontend calls do not use demo identities or direct score writes', () => {
  assert.equal(appSource.includes('local-demo-user'), false);
  assert.equal(appSource.includes('demo-user'), false);
  assert.equal(indexSource.includes('local-demo-user'), false);
  assert.equal(indexSource.includes('demo-user'), false);
  assert.equal(appSource.includes("from('ai_scores').insert"), false);
  assert.equal(indexSource.includes('/api/getBeltAttempts?userId='), false);
  [
    '/api/submitScore', '/api/submitJudgeBreakdown', '/api/requestBeltTest',
    '/api/submitBeltAttempt', '/api/getBeltAttempts', '/api/getBeltAttempt',
    '/api/submissionJudge/status'
  ].forEach(route => assert.match(`${appSource}\n${indexSource}`, new RegExp(`DJBattleApi\\.apiRequest\\('${route}`)));
});
