// Serves the browser front end from the repository root so the app and API can share one origin
// (http://localhost:4000). Only an explicit allowlist of front-end files is exposed: server code,
// node_modules, SQL, env files, and other repo content are never served.
const path = require('path');
const fs = require('fs');
const express = require('express');

const DEFAULT_FRONTEND_ROOT = path.join(__dirname, '..');
const ROOT_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*\.(html|css|js)$/;
const ASSET_DIRECTORIES = new Set(['studio', 'judge']);
const ASSET_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*\.js$/;

function isServableFrontendPath(requestPath){
  const value = String(requestPath || '');
  if(value === '/' || value === '') return true;
  if(value.includes('\\') || value.includes('\0')) return false;
  const parts = value.replace(/^\/+/, '').split('/');
  if(parts.some(part => !part || part === '.' || part === '..')) return false;
  if(parts.length === 1) return ROOT_FILE_PATTERN.test(parts[0]);
  if(parts.length === 2) return ASSET_DIRECTORIES.has(parts[0]) && ASSET_FILE_PATTERN.test(parts[1]);
  return false;
}

function shouldServeFrontend(env = process.env){
  const flag = String(env.SERVE_FRONTEND == null ? '' : env.SERVE_FRONTEND).trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(flag);
}

function createFrontendRouter(options = {}){
  const root = path.resolve(options.root || DEFAULT_FRONTEND_ROOT);
  const router = express.Router();
  router.get('*', (req, res, next) => {
    const requestPath = req.path;
    if(requestPath.startsWith('/api/') || !isServableFrontendPath(requestPath)) return next();
    const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    const absolute = path.join(root, relative);
    if(!absolute.startsWith(root + path.sep)) return next();
    fs.stat(absolute, (err, stats) => {
      if(err || !stats.isFile()) return next();
      return res.sendFile(absolute, { dotfiles:'deny', headers:{ 'Cache-Control':'no-cache' } });
    });
  });
  return router;
}

module.exports = { createFrontendRouter, isServableFrontendPath, shouldServeFrontend, DEFAULT_FRONTEND_ROOT };
