function extractBearerToken(header){
  if(typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() || null : null;
}

function getAuthenticatedUserId(req){
  const id = req && req.authUser && req.authUser.id;
  return id == null ? null : String(id);
}

function rejectMissingSupabaseConfig(res, label = 'Supabase'){
  return res.status(503).json({ error: `${label} is not configured` });
}

function requireAuthenticatedUser(authClient){
  return async (req, res, next) => {
    if(!authClient || !authClient.auth || typeof authClient.auth.getUser !== 'function'){
      return rejectMissingSupabaseConfig(res, 'Supabase authentication');
    }

    const token = extractBearerToken(req.get('Authorization'));
    if(!token) return res.status(401).json({ error: 'Authentication required' });

    try{
      const { data, error } = await authClient.auth.getUser(token);
      if(error || !data || !data.user || data.user.id == null) return res.status(401).json({ error: 'Invalid access token' });
      req.authUser = data.user;
      req.authUserId = String(data.user.id);
      return next();
    }catch(err){
      return res.status(401).json({ error: 'Invalid access token' });
    }
  };
}

function requireConfiguredDataClient(dataClient, res, label = 'Supabase data client'){
  if(dataClient) return true;
  rejectMissingSupabaseConfig(res, label);
  return false;
}

function requireOwnedUserIds(req, res, suppliedUserIds){
  const userId = getAuthenticatedUserId(req);
  if(!userId){
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }

  const ids = Array.isArray(suppliedUserIds) ? suppliedUserIds : [suppliedUserIds];
  const foreignId = ids.find(id => id != null && String(id) !== userId);
  if(foreignId != null){
    res.status(403).json({ error: 'Cannot act on behalf of another user' });
    return null;
  }
  return userId;
}

function requireOwnedUserId(req, res, suppliedUserId){
  return requireOwnedUserIds(req, res, [suppliedUserId]);
}

function collectRoleValues(value){
  if(Array.isArray(value)) return value.flatMap(collectRoleValues);
  if(typeof value === 'string') return value.split(/[,\s]+/).filter(Boolean);
  if(value == null) return [];
  return [String(value)];
}

function userHasOperatorRole(user){
  const appMetadata = user && user.app_metadata && typeof user.app_metadata === 'object' ? user.app_metadata : {};
  const userMetadata = user && user.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {};
  const roles = [
    ...collectRoleValues(appMetadata.role),
    ...collectRoleValues(appMetadata.roles),
    ...collectRoleValues(userMetadata.role),
    ...collectRoleValues(userMetadata.roles)
  ].map(role => String(role).toLowerCase());
  return Boolean(
    roles.some(role => ['admin', 'operator', 'judging_operator', 'owner'].includes(role)) ||
    appMetadata.is_admin === true ||
    appMetadata.is_operator === true ||
    userMetadata.is_admin === true ||
    userMetadata.is_operator === true
  );
}

function requireOperatorUser(req, res, next){
  if(!getAuthenticatedUserId(req)){
    return res.status(401).json({ error: 'Authentication required' });
  }
  if(!userHasOperatorRole(req.authUser)){
    return res.status(403).json({ error: 'Operator access required' });
  }
  return next();
}

async function getOwnedBeltAttempt(dataClient, userId, attemptId){
  const result = await dataClient.from('belt_attempts').select('*').eq('id', attemptId).limit(1).single();
  if(result.error) return { error: result.error };
  if(String(result.data.user_id) !== String(userId)) return { forbidden: true };
  return { attempt: result.data };
}

async function getOwnedBeltTest(dataClient, userId, testId){
  const result = await dataClient.from('belt_tests').select('*').eq('id', testId).limit(1).single();
  if(result.error) return { error: result.error };
  if(!result.data.user_id || String(result.data.user_id) !== String(userId)) return { forbidden: true };
  return { test: result.data };
}

module.exports = {
  extractBearerToken,
  getAuthenticatedUserId,
  requireAuthenticatedUser,
  requireConfiguredDataClient,
  requireOwnedUserId,
  requireOwnedUserIds,
  requireOperatorUser,
  userHasOperatorRole,
  getOwnedBeltAttempt,
  getOwnedBeltTest
};
