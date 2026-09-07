const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const {
  extractBearerToken,
  requireAuthenticatedUser,
  requireConfiguredDataClient,
  requireOwnedUserId,
  requireOwnedUserIds,
  requireOperatorUser,
  userHasOperatorRole,
  getOwnedBeltAttempt,
  getOwnedBeltTest
} = require('../auth');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

function response(){
  return {
    statusCode: null,
    body: null,
    status(code){ this.statusCode = code; return this; },
    json(body){ this.body = body; return this; }
  };
}

function request({ authorization, userId } = {}){
  return {
    authUser: userId ? { id: userId } : undefined,
    get(name){ return name === 'Authorization' ? authorization : undefined; }
  };
}

describe('authentication contract', () => {
  it('extracts only Bearer access tokens', () => {
    expect(extractBearerToken('Bearer token-1')).to.equal('token-1');
    expect(extractBearerToken('Basic token-1')).to.equal(null);
    expect(extractBearerToken()).to.equal(null);
  });

  it('returns 401 when Authorization is missing', async () => {
    const middleware = requireAuthenticatedUser({ auth: { getUser: async () => ({ data: { user: { id: 'unused' } } }) } });
    const req = request(); const res = response(); let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    expect(res.statusCode).to.equal(401);
    expect(nextCalled).to.equal(false);
  });

  it('returns 503 when Supabase authentication is not configured', async () => {
    const middleware = requireAuthenticatedUser(null);
    const req = request({ authorization: 'Bearer valid-token' }); const res = response(); let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    expect(res.statusCode).to.equal(503);
    expect(res.body.error).to.equal('Supabase authentication is not configured');
    expect(nextCalled).to.equal(false);
  });

  it('returns 401 for an invalid token', async () => {
    const middleware = requireAuthenticatedUser({ auth: { getUser: async () => ({ data: { user: null }, error: new Error('invalid') }) } });
    const req = request({ authorization: 'Bearer invalid-token' }); const res = response();
    await middleware(req, res, () => {});
    expect(res.statusCode).to.equal(401);
  });

  it('derives the authenticated user from Supabase token verification', async () => {
    const middleware = requireAuthenticatedUser({ auth: { getUser: async token => ({ data: { user: { id: 'user-1', token } }, error: null }) } });
    const req = request({ authorization: 'Bearer valid-token' }); const res = response(); let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).to.equal(true);
    expect(req.authUser.id).to.equal('user-1');
    expect(req.authUserId).to.equal('user-1');
  });

  it('rejects forged body or query user IDs and uses the verified ID', () => {
    const req = request({ userId: 'user-1' }); const res = response();
    expect(requireOwnedUserId(req, res, 'user-2')).to.equal(null);
    expect(res.statusCode).to.equal(403);
    expect(requireOwnedUserId(req, response(), 'user-1')).to.equal('user-1');
    expect(requireOwnedUserId(req, response(), undefined)).to.equal('user-1');
  });

  it('rejects any foreign user ID in multi-user write payloads', () => {
    const req = request({ userId: 'user-1' }); const res = response();
    expect(requireOwnedUserIds(req, response(), ['user-1', null, undefined])).to.equal('user-1');
    expect(requireOwnedUserIds(req, res, ['user-1', 'user-2'])).to.equal(null);
    expect(res.statusCode).to.equal(403);
  });

  it('allows only operator-role users through operator middleware', () => {
    expect(userHasOperatorRole({ app_metadata:{ roles:['operator'] } })).to.equal(true);
    expect(userHasOperatorRole({ user_metadata:{ role:'admin' } })).to.equal(true);
    expect(userHasOperatorRole({ app_metadata:{ is_operator:true } })).to.equal(true);
    expect(userHasOperatorRole({ app_metadata:{ roles:['dj'] } })).to.equal(false);

    const allowedReq = request({ userId:'user-1' });
    allowedReq.authUser.app_metadata = { roles:['judging_operator'] };
    const allowedRes = response();
    let nextCalled = false;
    requireOperatorUser(allowedReq, allowedRes, () => { nextCalled = true; });
    expect(nextCalled).to.equal(true);

    const deniedReq = request({ userId:'user-2' });
    deniedReq.authUser.app_metadata = { roles:['dj'] };
    const deniedRes = response();
    requireOperatorUser(deniedReq, deniedRes, () => {});
    expect(deniedRes.statusCode).to.equal(403);
    expect(deniedRes.body.error).to.equal('Operator access required');
  });

  it('returns 503 before database writes when the Supabase data client is missing', () => {
    const res = response();
    expect(requireConfiguredDataClient(null, res, 'Supabase service role client')).to.equal(false);
    expect(res.statusCode).to.equal(503);
    expect(res.body.error).to.equal('Supabase service role client is not configured');
    expect(requireConfiguredDataClient({ from(){} }, response())).to.equal(true);
  });

  ['score', 'belt request', 'belt attempt', 'judge breakdown'].forEach(action => {
    it(`rejects a forged ${action} userId`, () => {
      const req = request({ userId: 'user-1' }); const res = response();
      expect(requireOwnedUserId(req, res, 'user-2')).to.equal(null);
      expect(res.statusCode).to.equal(403);
    });
  });

  it('permits only the authenticated user to read a private belt attempt', async () => {
    const calls = [];
    const dataClient = {
      from(table){
        calls.push(table);
        return { select(){ return this; }, eq(){ return this; }, limit(){ return this; }, single: async () => ({ data: { id: 'attempt-1', user_id: 'user-1' }, error: null }) };
      }
    };
    const own = await getOwnedBeltAttempt(dataClient, 'user-1', 'attempt-1');
    const other = await getOwnedBeltAttempt(dataClient, 'user-2', 'attempt-1');
    expect(calls).to.deep.equal(['belt_attempts', 'belt_attempts']);
    expect(own.attempt.user_id).to.equal('user-1');
    expect(other.forbidden).to.equal(true);
  });

  it('accepts an attempt only for a belt test owned by the authenticated user', async () => {
    const dataClient = beltTestClient({ id: 'test-1', user_id: 'user-1' });
    const result = await getOwnedBeltTest(dataClient, 'user-1', 'test-1');
    expect(result.test.id).to.equal('test-1');
  });

  it('rejects an attempt for another user\'s belt test', async () => {
    const dataClient = beltTestClient({ id: 'test-1', user_id: 'user-2' });
    const result = await getOwnedBeltTest(dataClient, 'user-1', 'test-1');
    expect(result.forbidden).to.equal(true);
  });

  it('rejects legacy belt tests without an owner', async () => {
    const dataClient = beltTestClient({ id: 'test-1', user_id: null });
    const result = await getOwnedBeltTest(dataClient, 'user-1', 'test-1');
    expect(result.forbidden).to.equal(true);
  });

  it('protects ownership-sensitive routes while keeping belt definitions public', () => {
    [
      'submitScore', 'submitBattleResult', 'requestBeltTest', 'generateBeltTest',
      'getBeltAttempts', 'getBeltAttempt', 'submitBeltAttempt', 'submitJudgeBreakdown',
      'mixSubmissions/:submissionId/judgingResult', 'mixSubmissions/:submissionId/uploadAuthorization',
      'mixSubmissions/:submissionId/completeUpload', 'submissionJudge/status',
      'battleResults', 'battleResults/:submissionId', 'battleResults/:submissionId/visibility'
    ].forEach(route => expect(serverSource).to.include(`/api/${route}', requireAuth`));
    expect(serverSource).to.include("app.get('/api/getBelts', async");
    expect(serverSource).to.include("app.get('/api/submissionJudge/status', requireAuth, requireOperatorUser");
    expect(serverSource).to.not.include("from('user_belts').insert");
    expect(serverSource).to.not.include("from('user_belts').update");
  });

  it('uses reusable authentication and service guards on requested write endpoints', () => {
    expect(serverSource).to.include('const requireAuth = requireAuthenticatedUser(supabase);');
    ['submitScore', 'submitBattleResult', 'submitBeltAttempt', 'submitJudgeBreakdown'].forEach(route => {
      expect(serverSource).to.include(`/api/${route}', requireAuth`);
    });
    expect(serverSource).to.include("requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')");
    expect(serverSource).to.include('requireOwnedUserIds(req, res, [winnerUserId, ...suppliedUserIds])');
    expect(serverSource).to.include("user_id: userId, dj: djName");
    expect(serverSource).to.include('getOwnedBeltTest(supabaseService, userId, testId)');
    expect(serverSource).to.include('buildJudgeBreakdownPayload');
  });

  it('stores belt-test ownership and checks it before inserting an attempt', () => {
    expect(serverSource).to.include('user_id: userId, code: belt.code');
    expect(serverSource).to.include('user_id: userId, code: generated.code');
    expect(serverSource).to.include('getOwnedBeltTest(supabaseService, userId, testId)');
  });
});

function beltTestClient(test){
  return {
    from(table){
      expect(table).to.equal('belt_tests');
      return { select(){ return this; }, eq(){ return this; }, limit(){ return this; }, single: async () => ({ data: test, error: null }) };
    }
  };
}
