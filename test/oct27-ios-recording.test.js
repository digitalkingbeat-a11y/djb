const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
function loadRecording(){
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts:'outside-only', url:'http://localhost/' });
  dom.window.eval(fs.readFileSync(path.join(root, 'studio', 'studio_recording.js'), 'utf8'));
  return dom.window;
}
function fakeRecorder(supported, reportedMime){
  const made = [];
  function Rec(stream, opts){ this.opts = opts; this.mimeType = reportedMime !== undefined ? reportedMime : (opts && opts.mimeType) || ''; this.state = 'inactive'; made.push(this); }
  Rec.isTypeSupported = m => supported.includes(m);
  Rec.prototype.start = function(){ this.state = 'recording'; };
  Rec.prototype.stop = function(){ this.state = 'inactive'; this.ondataavailable({ data:new this.win.Blob(['x'], { type:this.mimeType }) }); this.onstop(); };
  return { Rec, made };
}
function makeStudio(win, Rec){
  Rec.prototype.win = win;
  const state = { studioRecording:{ state:'armed', armed:true } };
  const mod = win.DJBattleStudioRecording.create({
    window:win, document:win.document, state, localStorage:{ setItem(){}, getItem(){ return null; } },
    now:() => 1700000000000, getMediaRecorder:() => Rec,
    ensureAudioGraph(){}, getAudioContext:() => ({}), getRecordingDestination:() => ({ stream:{} }),
    activeStudioBattleSession:() => ({ title:'Friday Night House' })
  });
  return { mod, state };
}

test('picks WebM/Opus where supported (Chrome, Firefox, Android)', () => {
  const win = loadRecording();
  const R = win.DJBattleStudioRecording;
  const fmt = R.pickRecordingFormat({ isTypeSupported:m => /webm/.test(m) || /mp4/.test(m) });
  assert.equal(fmt.mime, 'audio/webm;codecs=opus');
  assert.equal(fmt.ext, 'webm');
});

test('falls back to MP4/AAC (.m4a) when WebM is not supported (iPhone, Safari)', () => {
  const R = loadRecording().DJBattleStudioRecording;
  const fmt = R.pickRecordingFormat({ isTypeSupported:m => /mp4/.test(m) });
  assert.equal(fmt.type, 'audio/mp4');
  assert.equal(fmt.ext, 'm4a');
  assert.equal(fmt.label, 'M4A (AAC)');
  assert.equal(R.pickRecordingFormat({}), null, 'no isTypeSupported → let the browser choose');
  assert.equal(R.formatFromMime('audio/mp4;codecs=mp4a.40.2').ext, 'm4a');
  assert.equal(R.formatFromMime('audio/webm;codecs=opus').ext, 'webm');
  assert.equal(R.formatFromMime('').ext, 'webm');
});

test('an iPhone take is saved as .m4a with type audio/mp4 and shows its format', async () => {
  const win = loadRecording();
  const { Rec, made } = fakeRecorder(['audio/mp4;codecs=mp4a.40.2', 'audio/mp4']);
  const { mod, state } = makeStudio(win, Rec);
  assert.equal((await mod.start()).ok, true);
  assert.equal(made[0].opts.mimeType, 'audio/mp4;codecs=mp4a.40.2');
  made[0].stop();
  const file = win.lastRecordedMixFile;
  assert.match(file.name, /\.m4a$/);
  assert.equal(file.type, 'audio/mp4');
  assert.equal(state.studioRecording.state, 'review');
  assert.deepEqual({ ...state.studioRecording.format }, { type:'audio/mp4', ext:'m4a', label:'M4A (AAC)' });
});

test('uses what the recorder really reports when the requested type is ignored', async () => {
  const win = loadRecording();
  // Asked for WebM, but the browser silently produced MP4 (seen on some Safari builds).
  const { Rec, made } = fakeRecorder(['audio/webm;codecs=opus'], 'audio/mp4');
  const { mod } = makeStudio(win, Rec);
  await mod.start();
  made[0].stop();
  assert.match(win.lastRecordedMixFile.name, /\.m4a$/);
});

test('a Chrome take is still .webm, and a constructor that rejects options still records', async () => {
  const win = loadRecording();
  const { Rec, made } = fakeRecorder(['audio/webm;codecs=opus']);
  const { mod } = makeStudio(win, Rec);
  await mod.start();
  made[0].stop();
  assert.match(win.lastRecordedMixFile.name, /\.webm$/);
  assert.equal(win.lastRecordedMixFile.type, 'audio/webm');

  const win2 = loadRecording();
  function Picky(stream, opts){ if(opts) throw new Error('NotSupportedError'); this.mimeType = 'audio/mp4'; Picky.made = this; }
  Picky.isTypeSupported = () => true;
  Picky.prototype.start = function(){};
  Picky.prototype.stop = function(){ this.ondataavailable({ data:new win2.Blob(['x'], { type:'audio/mp4' }) }); this.onstop(); };
  const s2 = makeStudio(win2, Picky);
  assert.equal((await s2.mod.start()).ok, true);
  Picky.made.stop();
  assert.match(win2.lastRecordedMixFile.name, /\.m4a$/);
});

test('download names keep the right extension', async () => {
  const win = loadRecording();
  const { Rec } = fakeRecorder([]);
  const { mod } = makeStudio(win, Rec);
  const d = new Date(2026, 9, 27);
  assert.equal(mod.downloadFileName('Friday Night House', d, 'm4a'), 'friday-night-house-2026-10-27.m4a');
  assert.equal(mod.downloadFileName('Friday Night House', d, 'webm'), 'friday-night-house-2026-10-27.webm');
  assert.equal(mod.downloadFileName('x', d, 'exe'), 'x-2026-10-27.webm');
  win.lastRecordedMixFile = new win.File(['x'], 'dj-battle-take-1.m4a', { type:'audio/mp4' });
  win.URL.createObjectURL = () => 'blob:1'; win.URL.revokeObjectURL = () => {};
  win.HTMLAnchorElement.prototype.click = () => {};
  const res = mod.download();
  assert.equal(res.name, 'friday-night-house-2023-11-14.m4a');
});

test('mix upload accepts iPhone recordings and strips codec details', () => {
  const api = require('../submission_upload.js');
  const ok = (type, size = 1000) => api.validateFile({ name:'t', type, size });
  assert.equal(ok('audio/mp4'), null);
  assert.equal(ok('audio/x-m4a'), null);
  assert.equal(ok('audio/webm;codecs=opus'), null);
  assert.match(ok('video/quicktime'), /M4A/);
});

test('054 migration and README mention the new types; button text is no longer WebM-only', () => {
  const sql = fs.readFileSync(path.join(root, 'server', 'sql', '054_allow_m4a_mix_uploads.sql'), 'utf8');
  assert.match(sql, /'audio\/mp4'/);
  assert.match(fs.readFileSync(path.join(root, 'server', 'sql', 'README.md'), 'utf8'), /054_allow_m4a_mix_uploads/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), /as a \.webm file/);
});
