const path = require('path');
const { expect } = require('chai');
const {
  authenticateWebSocketRequest,
  getIngestionLimits,
  persistIngestionBuffer,
  safeStoragePath,
  sanitizeGeneratedFilename,
  validateAudioMetadata,
  validateRequestBodySize,
  validateSessionQuota,
  validateWebSocketMessage,
  writeBufferAtomically
} = require('../ingestion_safety');

function mockFs({ failWrite = false } = {}){
  const files = new Set();
  return {
    files,
    existsSync(file){ return files.has(file); },
    mkdirSync(){},
    writeFileSync(file){
      files.add(file);
      if(failWrite) throw new Error('disk full');
    },
    renameSync(from, to){
      if(!files.has(from)) throw new Error('missing temp file');
      files.delete(from);
      files.add(to);
    },
    unlinkSync(file){ files.delete(file); }
  };
}

describe('ingestion safety contract', () => {
  const root = path.resolve(__dirname, '..', 'tmp', 'ingestion-contract');
  const limits = {
    requestBodyBytes: 16,
    uploadedAudioBytes: 32,
    webSocketMessageBytes: 16,
    webSocketSessionStorageBytes: 40
  };

  it('parses configurable byte limits and accepts valid audio metadata', () => {
    const parsed = getIngestionLimits({
      SERVER_REQUEST_BODY_LIMIT_BYTES: '2kb',
      SERVER_AUDIO_UPLOAD_LIMIT_BYTES: '3mb',
      SERVER_WS_MESSAGE_LIMIT_BYTES: '4kb',
      SERVER_WS_SESSION_STORAGE_LIMIT_BYTES: '5mb'
    });
    expect(parsed.requestBodyBytes).to.equal(2048);
    expect(parsed.uploadedAudioBytes).to.equal(3 * 1024 * 1024);
    expect(parsed.webSocketMessageBytes).to.equal(4096);
    expect(parsed.webSocketSessionStorageBytes).to.equal(5 * 1024 * 1024);
    expect(validateAudioMetadata({ filename: 'mix.webm', mimeType: 'audio/webm', size: 12 }, limits)).to.deep.include({ extension: 'webm', mimeType: 'audio/webm', size: 12 });
  });

  it('rejects oversized request, audio, and WebSocket payloads', () => {
    expect(validateRequestBodySize(17, limits).error).to.equal('Request body exceeds configured limit');
    expect(validateAudioMetadata({ filename: 'mix.webm', mimeType: 'audio/webm', size: 33 }, limits).error).to.equal('File exceeds the maximum allowed size');
    expect(validateWebSocketMessage(Buffer.alloc(17), limits).error).to.equal('WebSocket message exceeds configured limit');
  });

  it('rejects invalid MIME types, mismatched extensions, and traversal attempts', () => {
    expect(validateAudioMetadata({ filename: 'mix.webm', mimeType: 'text/plain', size: 10 }, limits).error).to.equal('Unsupported audio MIME type');
    expect(validateAudioMetadata({ filename: 'mix.mp3', mimeType: 'audio/webm', size: 10 }, limits).error).to.equal('Unsupported audio file extension');
    expect(validateAudioMetadata({ filename: '../mix.webm', mimeType: 'audio/webm', size: 10 }, limits).error).to.equal('Invalid filename');
    expect(() => safeStoragePath(root, '../mix.webm')).to.throw('Invalid filename');
  });

  it('sanitizes generated filenames and prevents path traversal on persistence', () => {
    const fsImpl = mockFs();
    const filename = sanitizeGeneratedFilename('../Audio Capture', '.webm');
    expect(filename).to.match(/^audio_capture_\d+_[a-f0-9]+\.webm$/);
    const saved = persistIngestionBuffer({ storageDir: root, prefix: '../Audio Capture', extension: 'webm', buffer: Buffer.from('audio'), currentUsageBytes: 0, limits, mimeType: 'audio/webm', fsImpl });
    expect(saved.error).to.equal(undefined);
    expect(saved.filename).to.match(/^audio_capture_\d+_[a-f0-9]+\.webm$/);
    expect(saved.path.startsWith(root + path.sep)).to.equal(true);
    expect(fsImpl.files.has(saved.path)).to.equal(true);
  });

  it('cleans up incomplete temporary files when atomic writes fail', () => {
    const fsImpl = mockFs({ failWrite: true });
    expect(() => writeBufferAtomically({ storageDir: root, filename: 'audio.webm', buffer: Buffer.from('audio'), fsImpl })).to.throw('disk full');
    expect([...fsImpl.files].filter(file => file.endsWith('.tmp'))).to.deep.equal([]);
  });

  it('enforces per-session storage quota before writing', () => {
    const fsImpl = mockFs();
    expect(validateSessionQuota(35, 6, limits).error).to.equal('WebSocket session storage quota exceeded');
    const rejected = persistIngestionBuffer({ storageDir: root, prefix: 'audio', extension: 'webm', buffer: Buffer.alloc(6), currentUsageBytes: 35, limits, mimeType: 'audio/webm', fsImpl });
    expect(rejected.error).to.equal('WebSocket session storage quota exceeded');
    expect(fsImpl.files.size).to.equal(0);
  });

  it('requires verified authentication for WebSocket ingestion', async () => {
    const authClient = { auth: { getUser: async token => ({ data: { user: token === 'good' ? { id: 'user-1' } : null }, error: token === 'good' ? null : new Error('invalid') }) } };
    expect((await authenticateWebSocketRequest({ headers: {} }, authClient)).statusCode).to.equal(401);
    expect((await authenticateWebSocketRequest({ headers: { authorization: 'Bearer bad' } }, authClient)).statusCode).to.equal(401);
    expect((await authenticateWebSocketRequest({ headers: { authorization: 'Bearer good' } }, authClient))).to.deep.include({ ok: true, userId: 'user-1' });
    expect((await authenticateWebSocketRequest({ headers: { authorization: 'Bearer good' } }, null)).statusCode).to.equal(503);
  });
});
