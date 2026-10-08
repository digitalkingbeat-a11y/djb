// Browser-safe configuration only. Never add a service-role or secret key here.
// Copy this file to supabase-browser-config.local.js (git-ignored) and fill in your values.
window.DJ_BATTLE_SUPABASE_CONFIG = {
  url: '<YOUR_SUPABASE_PROJECT_URL>',
  anonKey: '<YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY>'
};

// Where the DJ Battle API server lives. Leave empty ('') when the server also serves this front end
// (http://localhost:4000). Set it when the front end is served separately, for example:
//   window.DJB_API_BASE = 'http://localhost:4000';
// When index.html is opened straight from disk (file://) and this is unset, http://localhost:4000 is used.
window.DJB_API_BASE = '';
