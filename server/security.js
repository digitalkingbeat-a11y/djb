// CORS allowlist and security headers for the Express server.
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

function parseAllowedOrigins(value){
  return String(value || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
}

function buildCorsOptions(env = process.env, logger = console){
  const production = env.NODE_ENV === 'production';
  const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  if(production && !allowed.length){
    logger.warn('[security] ALLOWED_ORIGINS is not set. Cross-site browser requests are blocked; only same-origin requests (the bundled front end) and non-browser clients will work. Set ALLOWED_ORIGINS=https://your-app.example to allow your front end.');
  }
  return {
    origin(origin, cb){
      if(!origin) return cb(null, true); // curl, server-to-server, same-origin GETs
      const o = origin.replace(/\/+$/, '');
      if(allowed.includes(o)) return cb(null, true);
      if(!production && LOCAL_ORIGIN.test(o)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true
  };
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https: wss: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

function securityHeaders(req, res, next){
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.removeHeader('X-Powered-By');
  next();
}

module.exports = { parseAllowedOrigins, buildCorsOptions, securityHeaders, CSP };
