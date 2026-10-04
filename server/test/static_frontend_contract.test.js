const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { createFrontendRouter, isServableFrontendPath, shouldServeFrontend } = require('../static_frontend');

function get(port, requestPath){
  return new Promise((resolve, reject) => {
    const req = http.request({ host:'127.0.0.1', port, path:requestPath, method:'GET' }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status:res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('static front-end serving', () => {
  let root;
  let server;
  let port;

  before(done => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'djb-frontend-'));
    fs.writeFileSync(path.join(root, 'index.html'), '<h1>DJ Battle</h1>');
    fs.writeFileSync(path.join(root, 'app.js'), 'console.log("app")');
    fs.writeFileSync(path.join(root, 'package.json'), '{"secret":true}');
    fs.writeFileSync(path.join(root, '.env'), 'SUPABASE_SERVICE_KEY=nope');
    fs.mkdirSync(path.join(root, 'studio'));
    fs.writeFileSync(path.join(root, 'studio', 'deck_runtime.js'), 'deck');
    fs.mkdirSync(path.join(root, 'server'));
    fs.writeFileSync(path.join(root, 'server', 'index.js'), 'server source');
    const app = express();
    app.get('/api/ping', (req, res) => res.json({ ok:true }));
    app.use(createFrontendRouter({ root }));
    server = app.listen(0, () => { port = server.address().port; done(); });
  });

  after(done => { server.close(done); });

  it('serves index.html at / and allowlisted front-end assets', async () => {
    expect((await get(port, '/')).body).to.contain('DJ Battle');
    expect((await get(port, '/app.js')).status).to.equal(200);
    expect((await get(port, '/studio/deck_runtime.js')).body).to.equal('deck');
    expect((await get(port, '/api/ping')).body).to.contain('ok');
  });

  it('never serves server code, dotfiles, package metadata, or traversal paths', async () => {
    for(const requestPath of ['/server/index.js', '/.env', '/package.json', '/studio/../server/index.js', '/node_modules/x.js']){
      expect((await get(port, requestPath)).status, requestPath).to.equal(404);
    }
    expect(isServableFrontendPath('/server/index.js')).to.equal(false);
    expect(isServableFrontendPath('/../index.html')).to.equal(false);
    expect(isServableFrontendPath('/styles.css')).to.equal(true);
  });

  it('is enabled by default and can be disabled with SERVE_FRONTEND=false', () => {
    expect(shouldServeFrontend({})).to.equal(true);
    expect(shouldServeFrontend({ SERVE_FRONTEND:'false' })).to.equal(false);
    expect(shouldServeFrontend({ SERVE_FRONTEND:'0' })).to.equal(false);
  });

  it('is mounted by the API server after the API routes', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    expect(source).to.match(/if\(shouldServeFrontend\(\)\) app\.use\(createFrontendRouter\(\)\);/);
    expect(source.indexOf('app.use(createFrontendRouter())')).to.be.greaterThan(source.lastIndexOf("app.post('/api/"));
  });
});
