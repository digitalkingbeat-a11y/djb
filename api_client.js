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

  // When the page is opened straight from disk there is no same-origin server, so default to the local API port.
  const DEFAULT_LOCAL_API_BASE = 'http://localhost:4000';

  function apiBaseUrl(options={}){
    let base = options.apiBase;
    if(base == null && typeof window !== 'undefined'){
      base = window.DJB_API_BASE;
      if(base == null && window.location && window.location.protocol === 'file:') base = DEFAULT_LOCAL_API_BASE;
    }
    return String(base || '').trim().replace(/\/+$/, '');
  }

  // Single place that turns '/api/...' paths into request URLs; an empty base keeps same-origin relative paths.
  function apiUrl(path, options={}){
    const value = String(path || '');
    if(/^https?:\/\//i.test(value)) return value;
    const base = apiBaseUrl(options);
    if(!base) return value;
    return `${base}${value.startsWith('/') ? '' : '/'}${value}`;
  }

  function reportApiStatus(online, detail){
    if(typeof window === 'undefined' || typeof window.dispatchEvent !== 'function' || typeof window.CustomEvent !== 'function') return;
    try{ window.dispatchEvent(new window.CustomEvent('djb:api-status', { detail:{ online, ...detail } })); }catch(err){}
  }

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
      response = await (options.fetch || fetch)(apiUrl(path, options), {
        method: options.method || 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
    }catch(err){
      reportApiStatus(false, { path, base:apiBaseUrl(options) });
      return { error: 'Unable to reach the server. Your submission was not saved.', status: 0 };
    }
    reportApiStatus(true, { path, status:response.status });

    let text = '';
    try{ text = await response.text(); }catch(err){ text = ''; }
    let data = null;
    try{ data = text ? JSON.parse(text) : null; }catch(err){ data = null; }
    if(response.ok) return { data, status: response.status };
    return apiError(response.status, data);
  }

  function publicBattlePath(battleId){
    return `/api/publicBattles/${encodeURIComponent(String(battleId || ''))}`;
  }

  function getPublicBattle(battleId, options = {}){
    return apiRequest(publicBattlePath(battleId), { ...options, public:true });
  }

  function submitCommunityBattleVote(battleId, vote, options = {}){
    return apiRequest(`${publicBattlePath(battleId)}/votes`, { ...options, method:'POST', body:vote || {} });
  }

  return { apiRequest, apiUrl, apiBaseUrl, getSessionToken, apiError, getPublicBattle, submitCommunityBattleVote };
});
