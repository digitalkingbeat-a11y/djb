(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root) root.DJBattleApi = api;
})(typeof window !== 'undefined' ? window : globalThis, function(){
  const STATUS_MESSAGES = {
    401: 'Sign in is required, or your session has expired. Please sign in and try again.',
    403: 'You are not authorized to perform this action.',
    413: 'The request is too large. Choose a smaller file or payload.',
    415: 'This file type is not supported.',
    429: 'Too many requests. Please wait and try again.',
    503: 'The authenticated server is unavailable. Please try again later.'
  };

  function getSupabaseClient(options={}){
    if(options.supabase) return options.supabase;
    return typeof window !== 'undefined' ? window.supabase : null;
  }

  async function getSessionToken(options={}){
    const client = getSupabaseClient(options);
    if(!client || !client.auth || typeof client.auth.getSession !== 'function'){
      return { error: 'Authenticated server features are unavailable because Supabase is not configured.', status: 503 };
    }
    try{
      const { data, error } = await client.auth.getSession();
      const token = data && data.session && data.session.access_token;
      if(error || !token) return { error: STATUS_MESSAGES[401], status: 401 };
      return { token };
    }catch(err){
      return { error: STATUS_MESSAGES[401], status: 401 };
    }
  }

  function apiError(status, data){
    const serverError = data && typeof data.error === 'string' ? data.error : null;
    return { error: STATUS_MESSAGES[status] || serverError || `Request failed (${status}).`, status, data };
  }

  async function apiRequest(path, options={}){
    const isPublic = options.public === true;
    let token = null;

    if(!isPublic){
      const session = await getSessionToken(options);
      if(session.error) return session;
      token = session.token;
    }

    const headers = { ...(options.headers || {}) };
    if(token) headers.Authorization = `Bearer ${token}`;
    if(options.body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

    let response;
    try{
      response = await (options.fetch || fetch)(path, {
        method: options.method || 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
    }catch(err){
      return { error: 'Unable to reach the server. Your submission was not saved.', status: 0 };
    }

    let text = '';
    try{ text = await response.text(); }catch(err){ text = ''; }
    let data = null;
    try{ data = text ? JSON.parse(text) : null; }catch(err){ data = null; }
    if(response.ok) return { data, status: response.status };
    return apiError(response.status, data);
  }

  return { apiRequest, getSessionToken, apiError };
});
