const fs = require('fs');
const path = require('path');

const SAFE_UNAVAILABLE_MESSAGE = 'FFmpeg is unavailable. Set FFMPEG_PATH or install FFmpeg.';
const SAFE_AVAILABLE_MESSAGE = 'FFmpeg is available.';

function executableNames(platform = process.platform){
  return platform === 'win32' ? ['ffmpeg.exe', 'ffmpeg.cmd', 'ffmpeg.bat'] : ['ffmpeg'];
}

function cleanConfiguredPath(value){
  if(typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/^["']|["']$/g, '');
  if(!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

function canUseFile(filePath, fsImpl = fs, platform = process.platform){
  try{
    const stat = fsImpl.statSync(filePath);
    if(!stat || !stat.isFile()) return false;
    if(platform !== 'win32' && fsImpl.accessSync){
      fsImpl.accessSync(filePath, fs.constants.X_OK);
    }
    return true;
  }catch(err){
    return false;
  }
}

function canUseDirectory(dirPath, fsImpl = fs){
  try{
    const stat = fsImpl.statSync(dirPath);
    return Boolean(stat && stat.isDirectory());
  }catch(err){
    return false;
  }
}

function collectConfiguredCandidates(rawPath, options){
  const configured = cleanConfiguredPath(rawPath);
  if(!configured) return [];
  const resolved = path.resolve(configured);
  const candidates = [{ filePath: resolved, source: 'env' }];
  for(const name of executableNames(options.platform)){
    candidates.push({ filePath: path.join(resolved, name), source: 'env' });
    candidates.push({ filePath: path.join(resolved, 'bin', name), source: 'env' });
  }
  return candidates;
}

function walkExecutableCandidates(root, options, maxDepth = 4){
  const { fsImpl, platform } = options;
  const rootPath = path.resolve(root);
  const names = new Set(executableNames(platform));
  const found = [];

  function visit(dir, depth){
    if(depth > maxDepth || !canUseDirectory(dir, fsImpl)) return;
    let entries;
    try{
      entries = fsImpl.readdirSync(dir, { withFileTypes: true });
    }catch(err){
      return;
    }

    for(const entry of entries){
      const fullPath = path.join(dir, entry.name);
      if(!path.resolve(fullPath).startsWith(rootPath + path.sep) && path.resolve(fullPath) !== rootPath) continue;
      if(entry.isFile && entry.isFile() && names.has(entry.name.toLowerCase())){
        found.push({ filePath: fullPath, source: 'bundled' });
      }else if(entry.isDirectory && entry.isDirectory()){
        visit(fullPath, depth + 1);
      }
    }
  }

  visit(rootPath, 0);
  return found;
}

function bundledCandidates(options){
  const root = options.bundledRoot || path.join(__dirname, 'bin', 'ffmpeg');
  const candidates = [];
  for(const name of executableNames(options.platform)){
    candidates.push({ filePath: path.join(root, name), source: 'bundled' });
    candidates.push({ filePath: path.join(root, 'bin', name), source: 'bundled' });
  }
  return candidates.concat(walkExecutableCandidates(root, options));
}

function pathCandidates(env, options){
  const pathValue = env.PATH || env.Path || '';
  if(typeof pathValue !== 'string' || !pathValue.trim()) return [];
  const candidates = [];
  for(const dir of pathValue.split(path.delimiter)){
    const cleaned = cleanConfiguredPath(dir);
    if(!cleaned) continue;
    const resolved = path.resolve(cleaned);
    for(const name of executableNames(options.platform)){
      candidates.push({ filePath: path.join(resolved, name), source: 'path' });
    }
  }
  return candidates;
}

function getFFmpegCapability(options = {}){
  const env = options.env || process.env;
  const fsImpl = options.fsImpl || fs;
  const platform = options.platform || process.platform;
  const checkOptions = { fsImpl, platform, bundledRoot: options.bundledRoot };
  const configured = cleanConfiguredPath(env.FFMPEG_PATH);
  const seen = new Set();
  const candidates = [
    ...collectConfiguredCandidates(env.FFMPEG_PATH, checkOptions),
    ...bundledCandidates(checkOptions),
    ...pathCandidates(env, checkOptions)
  ].filter(candidate => {
    const key = path.resolve(candidate.filePath).toLowerCase();
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  for(const candidate of candidates){
    if(canUseFile(candidate.filePath, fsImpl, platform)){
      return {
        available: true,
        executablePath: candidate.filePath,
        source: candidate.source,
        reason: null
      };
    }
  }

  return {
    available: false,
    executablePath: null,
    source: null,
    reason: configured ? 'configured_path_unavailable' : 'not_found'
  };
}

function publicFFmpegCapabilityStatus(capability){
  const status = capability || getFFmpegCapability();
  return {
    available: Boolean(status.available),
    source: status.available ? status.source : null,
    reason: status.available ? null : status.reason,
    message: status.available ? SAFE_AVAILABLE_MESSAGE : SAFE_UNAVAILABLE_MESSAGE
  };
}

function createFFmpegUnavailableError(capability){
  const err = new Error(SAFE_UNAVAILABLE_MESSAGE);
  err.code = 'FFMPEG_UNAVAILABLE';
  err.capability = publicFFmpegCapabilityStatus(capability);
  return err;
}

function requireFFmpegCapability(options){
  const capability = getFFmpegCapability(options);
  if(!capability.available) throw createFFmpegUnavailableError(capability);
  return capability;
}

module.exports = {
  SAFE_AVAILABLE_MESSAGE,
  SAFE_UNAVAILABLE_MESSAGE,
  createFFmpegUnavailableError,
  getFFmpegCapability,
  publicFFmpegCapabilityStatus,
  requireFFmpegCapability
};
