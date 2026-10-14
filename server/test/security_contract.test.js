const assert = require('assert');
const { buildCorsOptions, securityHeaders, parseAllowedOrigins } = require('../security');
const check = (opts, origin) => new Promise(r => opts.origin(origin, (e, ok) => r(ok)));
const quiet = { warn(){} };
describe('security: CORS allowlist', () => {
  it('parses list', () => assert.deepStrictEqual(parseAllowedOrigins(' https://a.com/, https://b.com '), ['https://a.com','https://b.com']));
  it('allows no-origin requests', async () => assert.strictEqual(await check(buildCorsOptions({NODE_ENV:'production'}, quiet), undefined), true));
  it('allows listed origins, blocks others', async () => {
    const o = buildCorsOptions({NODE_ENV:'production', ALLOWED_ORIGINS:'https://djb.app'}, quiet);
    assert.strictEqual(await check(o, 'https://djb.app'), true);
    assert.strictEqual(await check(o, 'https://evil.com'), false);
    assert.strictEqual(await check(o, 'http://localhost:3000'), false);
  });
  it('allows localhost any port outside production', async () => {
    const o = buildCorsOptions({}, quiet);
    assert.strictEqual(await check(o, 'http://localhost:5173'), true);
    assert.strictEqual(await check(o, 'http://127.0.0.1:8080'), true);
    assert.strictEqual(await check(o, 'https://evil.com'), false);
  });
  it('warns when production has no allowlist', () => {
    let msg = ''; buildCorsOptions({NODE_ENV:'production'}, { warn(m){ msg = m; } });
    assert.match(msg, /ALLOWED_ORIGINS/);
  });
});
describe('security: headers', () => {
  it('sets headers', () => {
    const h = {}; const res = { setHeader:(k,v)=>{h[k]=v;}, removeHeader(){} };
    securityHeaders({}, res, () => {});
    assert.strictEqual(h['X-Frame-Options'], 'DENY');
    assert.strictEqual(h['X-Content-Type-Options'], 'nosniff');
    assert.ok(h['Referrer-Policy']);
    assert.match(h['Content-Security-Policy'], /frame-ancestors 'none'/);
    assert.match(h['Content-Security-Policy'], /cdn\.jsdelivr\.net/);
  });
  it('is wired into index.js', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../index.js'), 'utf8');
    assert.match(src, /app\.use\(securityHeaders\)/);
    assert.match(src, /cors\(buildCorsOptions\(\)\)/);
  });
});
