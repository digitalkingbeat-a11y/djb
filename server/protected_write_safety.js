const crypto = require('crypto');
const { LIMITS: INGESTION_LIMITS, validateAudioMetadata } = require('./ingestion_safety');
const { SUBMISSION_SOURCES } = require('./battle_submission');

const DEFAULT_PROTECTED_WRITE_LIMITS = {
  rateLimitWindowMs: 60 * 1000,
  rateLimitMax: 30,
  idempotencyReplayTtlMs: 10 * 60 * 1000,
  idempotencyKeyMaxLength: 128
};

const ALLOWED_BATTLE_TYPES = [
  'Practice',
  'Transition Battle',
  'Ahh/Fresh Scratch Battle',
  'Song-to-Song Scratch Battle',
  '5-Song Mix',
  '30-Minute Mix',
  '60-Minute Mix',
  'Standard Battle',
  'Scratch Battle',
  'Own Selection (Premium)',
  'Solo AI Rating'
];

const BATTLE_TYPE_ALIASES = {
  'ahh / fresh scratch battle': 'Ahh/Fresh Scratch Battle'
};

const ALLOWED_GENRES = [
  'Global',
  'All',
  'Hip-Hop',
  'House',
  'Tech House',
  'Bass House',
  'Drum & Bass',
  'Jungle',
  'UK Garage',
  'Bassline',
  'Dubstep',
  'Riddim',
  'Open Format',
  'Scratch',
  'EDM'
];

const DEFAULT_BELT_CODES = ['white', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black'];

const SAFE_ERROR_MESSAGES = {
  400: 'Invalid request payload',
  409: 'Duplicate submission',
  422: 'Invalid field value',
  429: 'Too many requests'
};

function parsePositiveInteger(value, fallback){
  if(value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function getProtectedWriteLimits(env = process.env){
  return {
    rateLimitWindowMs: parsePositiveInteger(env.SERVER_WRITE_RATE_LIMIT_WINDOW_MS || env.PROTECTED_WRITE_RATE_LIMIT_WINDOW_MS, DEFAULT_PROTECTED_WRITE_LIMITS.rateLimitWindowMs),
    rateLimitMax: parsePositiveInteger(env.SERVER_WRITE_RATE_LIMIT_MAX || env.PROTECTED_WRITE_RATE_LIMIT_MAX, DEFAULT_PROTECTED_WRITE_LIMITS.rateLimitMax),
    idempotencyReplayTtlMs: parsePositiveInteger(env.SERVER_IDEMPOTENCY_REPLAY_TTL_MS || env.PROTECTED_WRITE_IDEMPOTENCY_TTL_MS, DEFAULT_PROTECTED_WRITE_LIMITS.idempotencyReplayTtlMs),
    idempotencyKeyMaxLength: parsePositiveInteger(env.SERVER_IDEMPOTENCY_KEY_MAX_LENGTH || env.PROTECTED_WRITE_IDEMPOTENCY_KEY_MAX_LENGTH, DEFAULT_PROTECTED_WRITE_LIMITS.idempotencyKeyMaxLength)
  };
}

const PROTECTED_WRITE_LIMITS = getProtectedWriteLimits();

function isPlainObject(value){
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function validationFailure(status, error){
  return { ok: false, status, error: error || SAFE_ERROR_MESSAGES[status] || 'Invalid request' };
}

function validationSuccess(value){
  return { ok: true, value };
}

function isMissing(value){
  return value == null || (typeof value === 'string' && value.trim() === '');
}

function hasControlCharacters(value){
  return /[\u0000-\u001f\u007f]/.test(value);
}

function normalizeString(value, rule = {}){
  if(isMissing(value)){
    if(Object.prototype.hasOwnProperty.call(rule, 'default')) return { value: rule.default };
    if(rule.required) return { error: validationFailure(400) };
    return { value: undefined };
  }
  if(typeof value !== 'string' && typeof value !== 'number') return { error: validationFailure(422) };
  const normalized = String(value).trim();
  if(!rule.allowEmpty && normalized === ''){
    if(rule.required) return { error: validationFailure(400) };
    return { value: undefined };
  }
  if(hasControlCharacters(normalized)) return { error: validationFailure(422) };
  if(rule.maxLength && normalized.length > rule.maxLength) return { error: validationFailure(422) };
  return { value: normalized };
}

function normalizeNumber(value, rule = {}){
  if(isMissing(value)){
    if(Object.prototype.hasOwnProperty.call(rule, 'default')) return { value: rule.default };
    if(rule.required) return { error: validationFailure(400) };
    return { value: undefined };
  }
  const number = Number(value);
  if(!Number.isFinite(number)) return { error: validationFailure(422) };
  if(rule.integer && !Number.isInteger(number)) return { error: validationFailure(422) };
  if(rule.min != null && number < rule.min) return { error: validationFailure(422) };
  if(rule.max != null && number > rule.max) return { error: validationFailure(422) };
  return { value: number };
}

function normalizeEnum(value, rule = {}){
  const stringResult = normalizeString(value, rule);
  if(stringResult.error || stringResult.value === undefined) return stringResult;
  const allowed = rule.allowed || [];
  const key = stringResult.value.toLowerCase();
  const aliased = rule.aliases && rule.aliases[key];
  if(aliased) return { value: aliased };
  const canonical = allowed.find(item => String(item).toLowerCase() === key);
  if(!canonical) return { error: validationFailure(422) };
  return { value: canonical };
}

function isSafeIdentifier(value){
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) && !value.includes('..');
}

function normalizeIdentifier(value, rule = {}){
  const stringResult = normalizeString(value, { maxLength: rule.maxLength || 128, required: rule.required });
  if(stringResult.error || stringResult.value === undefined) return stringResult;
  if(!isSafeIdentifier(stringResult.value)) return { error: validationFailure(422) };
  return { value: stringResult.value };
}

function normalizeObject(value, rule = {}){
  if(isMissing(value)){
    if(Object.prototype.hasOwnProperty.call(rule, 'default')) return { value: rule.default };
    if(rule.required) return { error: validationFailure(400) };
    return { value: undefined };
  }
  if(!isPlainObject(value)) return { error: validationFailure(422) };
  return { value };
}

function normalizeArray(value, rule = {}){
  if(isMissing(value)){
    if(Object.prototype.hasOwnProperty.call(rule, 'default')) return { value: rule.default };
    if(rule.required) return { error: validationFailure(400) };
    return { value: undefined };
  }
  if(!Array.isArray(value)) return { error: validationFailure(422) };
  if(rule.minLength != null && value.length < rule.minLength) return { error: validationFailure(400) };
  if(rule.maxLength != null && value.length > rule.maxLength) return { error: validationFailure(422) };
  return { value };
}

function validateSchema(body, fields){
  if(!isPlainObject(body)) return validationFailure(400);
  const value = {};
  for(const [name, rule] of Object.entries(fields)){
    let result;
    if(rule.type === 'number') result = normalizeNumber(body[name], rule);
    else if(rule.type === 'enum') result = normalizeEnum(body[name], rule);
    else if(rule.type === 'identifier') result = normalizeIdentifier(body[name], rule);
    else if(rule.type === 'object') result = normalizeObject(body[name], rule);
    else if(rule.type === 'array') result = normalizeArray(body[name], rule);
    else result = normalizeString(body[name], rule);

    if(result.error) return result.error;
    if(result.value !== undefined) value[name] = result.value;
  }
  return validationSuccess(value);
}

function validateSubmitScorePayload(body){
  return validateSchema(body, {
    djName: { type: 'string', required: true, maxLength: 80 },
    battleType: { type: 'enum', allowed: ALLOWED_BATTLE_TYPES, aliases: BATTLE_TYPE_ALIASES, default: 'Practice', maxLength: 80 },
    genre: { type: 'enum', allowed: ALLOWED_GENRES, default: 'Global', maxLength: 40 },
    score: { type: 'number', required: true, min: 0, max: 180 }
  });
}

function validateBattleEntryPayload(body){
  return validateSchema(body, {
    battleId: { type: 'identifier', required: true, maxLength: 128 }
  });
}

function validateBattleResultPayload(body){
  const base = validateSchema(body, {
    battleId: { type: 'identifier', maxLength: 128 },
    battleType: { type: 'enum', allowed: ALLOWED_BATTLE_TYPES, aliases: BATTLE_TYPE_ALIASES, default: 'Practice', maxLength: 80 },
    genre: { type: 'enum', allowed: ALLOWED_GENRES, default: 'Global', maxLength: 40 },
    winnerUserId: { type: 'identifier', required: true, maxLength: 128 },
    results: { type: 'array', required: true, minLength: 1, maxLength: 16 }
  });
  if(base.error) return base;

  const results = [];
  for(const result of base.value.results){
    if(!isPlainObject(result)) return validationFailure(422);
    const row = validateSchema(result, {
      userId: { type: 'identifier', required: true, maxLength: 128 },
      dj: { type: 'string', maxLength: 80 },
      aiScore: { type: 'number', min: 0, max: 180 },
      communityScore: { type: 'number', min: 0, max: 100 },
      score: { type: 'number', min: 0, max: 180 }
    });
    if(row.error) return row;
    results.push(row.value);
  }
  return validationSuccess({ ...base.value, results });
}

function validateDraftSubmissionPayload(body, limits = INGESTION_LIMITS){
  const base = validateSchema(body, {
    originalFilename: { type: 'string', required: true, maxLength: 255 },
    declaredMimeType: { type: 'string', required: true, maxLength: 100 },
    fileSize: { type: 'number', required: true, min: 1, max: limits.uploadedAudioBytes },
    duration: { type: 'number', min: 0, max: 24 * 60 * 60 },
    submissionSource: { type: 'enum', allowed: SUBMISSION_SOURCES, required: true, maxLength: 32 }
  });
  if(base.error) return base;

  const audio = validateAudioMetadata({
    filename: base.value.originalFilename,
    mimeType: base.value.declaredMimeType,
    size: base.value.fileSize
  }, limits);
  if(audio.error) return validationFailure(422);

  const battleContextResult = normalizeObject(body && body.battleContext, { default: {} });
  if(battleContextResult.error) return battleContextResult.error;
  const context = sanitizeBattleContext(battleContextResult.value);

  return validationSuccess({
    originalFilename: base.value.originalFilename,
    declaredMimeType: audio.mimeType,
    fileSize: audio.size,
    duration: base.value.duration == null ? null : base.value.duration,
    submissionSource: base.value.submissionSource,
    battleContext: context
  });
}

function sanitizeBattleContext(input){
  const context = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = {};
  ['battleId', 'modeId', 'type', 'genre', 'title', 'battleEntryId', 'battlePrepSnapshotId', 'battlePrepSnapshotVersion'].forEach(key => {
    if(context[key] != null){
      const value = String(context[key]).trim();
      if(value && value.length <= 128 && !hasControlCharacters(value)) out[key] = value;
    }
  });
  if(context.discipline != null){
    const discipline = String(context.discipline).trim().toLowerCase();
    if(discipline === 'producer' || discipline === 'dj') out.discipline = discipline;
  }
  if(Array.isArray(context.loadedLibraryTracks)){
    out.loadedLibraryTracks = context.loadedLibraryTracks.slice(0, 40).map(item => {
      const track = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
      return {
        libraryTrackId: track.libraryTrackId != null ? String(track.libraryTrackId).slice(0, 128) : null,
        deck: track.deck != null ? String(track.deck).replace(/[^abAB]/g, '').toLowerCase().slice(0, 1) : null,
        loadedAt: track.loadedAt != null ? String(track.loadedAt).slice(0, 80) : null
      };
    }).filter(item => item.libraryTrackId);
  }
  if(context.durationMinutes != null && Number.isFinite(Number(context.durationMinutes))){
    out.durationMinutes = Math.max(0, Math.min(24 * 60, Number(context.durationMinutes)));
  }
  if(context.reward && typeof context.reward === 'object' && !Array.isArray(context.reward)){
    const reward = {};
    if(context.reward.type != null){
      const type = String(context.reward.type).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
      if(type) reward.type = type;
    }
    const metadata = context.reward.metadata && typeof context.reward.metadata === 'object' && !Array.isArray(context.reward.metadata) ? context.reward.metadata : {};
    reward.metadata = {};
    ['network', 'custody'].forEach(key => {
      if(metadata[key] != null){
        const value = String(metadata[key]).trim().slice(0, 80);
        if(value && !hasControlCharacters(value)) reward.metadata[key] = value;
      }
    });
    if(metadata.walletConnected != null) reward.metadata.walletConnected = Boolean(metadata.walletConnected);
    if(metadata.amountSats != null && Number.isFinite(Number(metadata.amountSats))){
      reward.metadata.amountSats = Math.max(0, Math.floor(Number(metadata.amountSats)));
    }
    out.reward = reward;
  }
  return out;
}

function validateBeltCodePayload(body, allowedBeltCodes = DEFAULT_BELT_CODES){
  return validateSchema(body, {
    beltCode: { type: 'enum', allowed: allowedBeltCodes, required: true, maxLength: 40 }
  });
}

function validateBeltAttemptPayload(body){
  return validateSchema(body, {
    testId: { type: 'identifier', required: true, maxLength: 128 },
    score: { type: 'number', required: true, min: 0, max: 100 },
    breakdown: { type: 'object', default: {} }
  });
}

function normalizeMeasurementArray(value){
  if(value == null) return { value: [] };
  if(!Array.isArray(value)) return { error: validationFailure(422) };
  if(value.length > 5000) return { error: validationFailure(422) };
  return { value };
}

function normalizeRecommendations(value){
  if(value == null) return { value: [] };
  if(!Array.isArray(value)) return { error: validationFailure(422) };
  if(value.length > 50) return { error: validationFailure(422) };
  const normalized = value.map(item => String(item || '').trim()).filter(Boolean);
  if(normalized.some(item => item.length > 500 || hasControlCharacters(item))) return { error: validationFailure(422) };
  return { value: normalized };
}

function validateJudgeBreakdownPayload(body){
  const base = validateSchema(body, {
    battleId: { type: 'identifier', maxLength: 128 },
    analysis: { type: 'object', required: true }
  });
  if(base.error) return base;

  const analysis = { ...base.value.analysis };
  const overall = normalizeNumber(analysis.overallScore, { min: 0, max: 100 });
  if(overall.error) return overall.error;
  if(overall.value !== undefined) analysis.overallScore = overall.value;

  const rawMeasurements = normalizeMeasurementArray(analysis.rawMeasurements || analysis.perEvent);
  if(rawMeasurements.error) return rawMeasurements.error;
  analysis.rawMeasurements = rawMeasurements.value;
  delete analysis.perEvent;

  const components = normalizeObject(analysis.components, { default: {} });
  if(components.error) return components.error;
  analysis.components = components.value;

  const recommendations = normalizeRecommendations(analysis.recommendations);
  if(recommendations.error) return recommendations.error;
  analysis.recommendations = recommendations.value;

  if(analysis.meta != null){
    const meta = normalizeObject(analysis.meta);
    if(meta.error) return meta.error;
    analysis.meta = meta.value;
    if(analysis.meta.duration != null){
      const duration = normalizeNumber(analysis.meta.duration, { min: 0, max: 24 * 60 * 60 });
      if(duration.error) return duration.error;
      analysis.meta = { ...analysis.meta, duration: duration.value };
    }
  }else{
    analysis.meta = {};
  }

  return validationSuccess({ battleId: base.value.battleId, analysis });
}

function validateRouteIdentifier(value, fieldName = 'id'){
  const result = normalizeIdentifier(value, { required: true, maxLength: 128 });
  if(result.error) return result.error;
  return validationSuccess({ [fieldName]: result.value });
}

function getHeader(req, name){
  if(req && typeof req.get === 'function') return req.get(name);
  const headers = (req && req.headers) || {};
  const lower = name.toLowerCase();
  return headers[name] || headers[lower];
}

function getRequesterKey(req){
  const userId = req && (req.authUserId || (req.authUser && req.authUser.id));
  if(userId != null) return `user:${String(userId)}`;
  const ip = req && (req.ip || (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress));
  return `ip:${ip || 'unknown'}`;
}

function stableSerialize(value){
  if(Array.isArray(value)) return value.map(stableSerialize);
  if(value && typeof value === 'object'){
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stableSerialize(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function fingerprintPayload(value){
  return crypto.createHash('sha256').update(JSON.stringify(stableSerialize(value))).digest('hex');
}

function extractIdempotencyKey(req, limits = PROTECTED_WRITE_LIMITS){
  const key = getHeader(req, 'Idempotency-Key');
  if(key == null || key === '') return { value: null };
  if(typeof key !== 'string') return { error: validationFailure(400) };
  const normalized = key.trim();
  if(!normalized || normalized.length > limits.idempotencyKeyMaxLength || !/^[A-Za-z0-9._:-]+$/.test(normalized)){
    return { error: validationFailure(400) };
  }
  return { value: normalized };
}

function createProtectedWriteSafety(options = {}){
  const limits = { ...PROTECTED_WRITE_LIMITS, ...(options.limits || {}) };
  const rateBuckets = new Map();
  const replayEntries = new Map();
  const now = options.now || (() => Date.now());

  function prune(currentTime){
    for(const [key, bucket] of rateBuckets.entries()){
      if(bucket.resetAt <= currentTime) rateBuckets.delete(key);
    }
    for(const [key, entry] of replayEntries.entries()){
      if(entry.expiresAt <= currentTime) replayEntries.delete(key);
    }
  }

  function checkRateLimit(req, routeKey){
    const currentTime = now();
    prune(currentTime);
    const key = `${getRequesterKey(req)}:${routeKey}`;
    const bucket = rateBuckets.get(key) || { count: 0, resetAt: currentTime + limits.rateLimitWindowMs };
    if(bucket.resetAt <= currentTime){
      bucket.count = 0;
      bucket.resetAt = currentTime + limits.rateLimitWindowMs;
    }
    if(bucket.count >= limits.rateLimitMax) return { error: validationFailure(429) };
    bucket.count += 1;
    rateBuckets.set(key, bucket);
    return { ok: true };
  }

  function checkReplay(req, routeKey, payload, fingerprintReplay){
    const idempotency = extractIdempotencyKey(req, limits);
    if(idempotency.error) return { error: idempotency.error };
    if(!idempotency.value && !fingerprintReplay) return { ok: true };

    const currentTime = now();
    const requester = getRequesterKey(req);
    const fingerprint = fingerprintPayload({ routeKey, payload });
    const replayKey = idempotency.value
      ? `${requester}:${routeKey}:key:${idempotency.value}`
      : `${requester}:${routeKey}:fingerprint:${fingerprint}`;
    const existing = replayEntries.get(replayKey);
    if(existing && existing.expiresAt > currentTime) return { error: validationFailure(409) };
    replayEntries.set(replayKey, { fingerprint, expiresAt: currentTime + limits.idempotencyReplayTtlMs });
    return { ok: true };
  }

  function guard(req, res, routeKey, options = {}){
    const rate = checkRateLimit(req, routeKey);
    if(rate.error) return rejectProtectedWriteError(res, rate.error);

    const payload = Object.prototype.hasOwnProperty.call(options, 'payload')
      ? options.payload
      : { body: req && req.body, params: req && req.params };
    if(options.idempotencyReplay !== false){
      const replay = checkReplay(req, routeKey, payload, options.fingerprintReplay !== false);
      if(replay.error) return rejectProtectedWriteError(res, replay.error);
    }
    return true;
  }

  return { checkRateLimit, guard, limits, rateBuckets, replayEntries };
}

function rejectProtectedWriteError(res, result){
  const status = result && result.status ? result.status : 400;
  const message = SAFE_ERROR_MESSAGES[status] || 'Request failed';
  res.status(status).json({ error: message });
  return false;
}

const defaultProtectedWriteSafety = createProtectedWriteSafety();

function guardProtectedWrite(req, res, routeKey, options){
  return defaultProtectedWriteSafety.guard(req, res, routeKey, options);
}

module.exports = {
  ALLOWED_BATTLE_TYPES,
  ALLOWED_GENRES,
  DEFAULT_BELT_CODES,
  DEFAULT_PROTECTED_WRITE_LIMITS,
  PROTECTED_WRITE_LIMITS,
  createProtectedWriteSafety,
  extractIdempotencyKey,
  fingerprintPayload,
  getProtectedWriteLimits,
  guardProtectedWrite,
  isPlainObject,
  rejectProtectedWriteError,
  validateBattleEntryPayload,
  validateBattleResultPayload,
  validateBeltAttemptPayload,
  validateBeltCodePayload,
  validateDraftSubmissionPayload,
  validateJudgeBreakdownPayload,
  validateRouteIdentifier,
  validateSchema,
  validateSubmitScorePayload
};
