const assert = require('assert');
const { validateAudioMetadata, ALLOWED_AUDIO_MIME_TYPES } = require('../ingestion_safety');
const { ALLOWED_MIME_TYPES } = require('../battle_submission');
const { audioFileKind } = require('../marketplace_commerce');
const fs = require('fs');
const path = require('path');

describe('Oct 27 iPhone recordings (MP4/AAC .m4a)', () => {
  it('accepts an iPhone take as audio/mp4 with .m4a or .mp4, codec details included', () => {
    assert.deepStrictEqual(validateAudioMetadata({ filename:'take.m4a', mimeType:'audio/mp4', size:1000 }), { mimeType:'audio/mp4', extension:'m4a', size:1000 });
    assert.strictEqual(validateAudioMetadata({ filename:'take.mp4', mimeType:'audio/mp4;codecs=mp4a.40.2', size:5 }).extension, 'mp4');
    assert.strictEqual(validateAudioMetadata({ filename:'take.m4a', mimeType:'audio/x-m4a', size:5 }).extension, 'm4a');
  });
  it('still rejects a mismatched extension and keeps WebM working', () => {
    assert.ok(validateAudioMetadata({ filename:'take.webm', mimeType:'audio/mp4', size:5 }).error);
    assert.ok(validateAudioMetadata({ filename:'take.m4a', mimeType:'audio/webm', size:5 }).error);
    assert.strictEqual(validateAudioMetadata({ filename:'take.webm', mimeType:'audio/webm;codecs=opus', size:5 }).extension, 'webm');
    assert.ok(validateAudioMetadata({ filename:'take.mov', mimeType:'video/quicktime', size:5 }).error);
  });
  it('stores verified iPhone uploads as .m4a and lets the uploaded object type through', () => {
    assert.strictEqual(ALLOWED_MIME_TYPES['audio/mp4'], 'm4a');
    assert.ok(ALLOWED_AUDIO_MIME_TYPES['audio/mp4'].includes('m4a'));
  });
  it('beat downloads made from an m4a file get the .m4a name and audio/mp4 type', () => {
    assert.deepStrictEqual(audioFileKind({ verified_mime_type:'audio/mp4' }, 'x/beat'), { ext:'m4a', mimeType:'audio/mp4' });
    assert.deepStrictEqual(audioFileKind({}, 'x/beat.m4a'), { ext:'m4a', mimeType:'audio/mp4' });
    assert.deepStrictEqual(audioFileKind({ verified_mime_type:'audio/mpeg' }, 'x/b'), { ext:'mp3', mimeType:'audio/mpeg' });
    assert.deepStrictEqual(audioFileKind({}, 'x/b'), { ext:'webm', mimeType:'audio/webm' });
  });
  it('054 SQL lets the private mix bucket accept audio/mp4 and keeps the old types', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '054_allow_m4a_mix_uploads.sql'), 'utf8');
    assert.match(sql, /battle-mixes/);
    ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/mp4', 'audio/x-m4a'].forEach(t => assert.ok(sql.includes(`'${t}'`), t));
  });
});
