const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const windows = [];
test.after(() => windows.forEach(w => { try{ w.close(); }catch(e){} }));

const root = path.join(__dirname, '..');

function loadAppDom(setup){
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(index, { url:'http://127.0.0.1/index.html', runScripts:'outside-only', pretendToBeVisual:true });
  const { window } = dom;
  window.alert = () => {};
  window.confirm = () => true;
  window.scrollTo = () => {};
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLDialogElement.prototype.showModal = function showModal(){ this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function close(){ this.removeAttribute('open'); };
  window.fetch = async () => ({ ok:false, status:503, text: async () => '{}', json: async () => ({}) });
  if(setup) setup(window);
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'].forEach(file => {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });
  windows.push(window);
  return window;
}


function id3(frames, ver = 3){
  const parts = frames.map(([id, body]) => {
    const b = Buffer.from(body); const h = Buffer.alloc(10); h.write(id, 0, 'latin1');
    if(ver === 4){ h[4]=(b.length>>21)&0x7f; h[5]=(b.length>>14)&0x7f; h[6]=(b.length>>7)&0x7f; h[7]=b.length&0x7f; } else h.writeUInt32BE(b.length, 4);
    return Buffer.concat([h, b]);
  });
  const all = Buffer.concat(parts); const h = Buffer.from([0x49,0x44,0x33,ver,0,0,0,0,0,0]);
  const n = all.length; h[6]=(n>>21)&0x7f; h[7]=(n>>14)&0x7f; h[8]=(n>>7)&0x7f; h[9]=n&0x7f;
  return Buffer.concat([h, all, Buffer.alloc(64)]);
}
const txt = s => Buffer.concat([Buffer.from([3]), Buffer.from(s, 'utf8')]);
const utf16 = s => Buffer.concat([Buffer.from([1, 0xFF, 0xFE]), Buffer.from(s, 'utf16le')]);

test('parses ID3v2.3/2.4 title, artist, genre and cover art', () => {
  const h = loadAppDom().__DJBattleTestHooks;
  const pic = Buffer.concat([Buffer.from([0]), Buffer.from('image/png\0', 'latin1'), Buffer.from([3]), Buffer.from('\0'), Buffer.from([0x89,0x50,0x4e,0x47])]);
  const t = h.parseId3Tags(new Uint8Array(id3([['TIT2', txt('Night Drive')], ['TPE1', utf16('DJ Nova')], ['TCON', txt('(13)House')], ['APIC', pic]])));
  assert.equal(t.title, 'Night Drive'); assert.equal(t.artist, 'DJ Nova'); assert.equal(t.genre, 'House');
  assert.equal(t.artwork, 'data:image/png;base64,iVBORw==');
  const t4 = h.parseId3Tags(new Uint8Array(id3([['TIT2', txt('Four')]], 4)));
  assert.equal(t4.title, 'Four');
});

test('ID3v1 fallback and filename fallback', () => {
  const h = loadAppDom().__DJBattleTestHooks;
  const v1 = Buffer.alloc(128); v1.write('TAG', 0, 'latin1'); v1.write('Old Song', 3, 'latin1'); v1.write('Old Artist', 33, 'latin1');
  const t = h.parseId3Tags(new Uint8Array(Buffer.concat([Buffer.alloc(200), v1])));
  assert.equal(t.title, 'Old Song'); assert.equal(t.artist, 'Old Artist');
  assert.deepEqual({ ...h.parseArtistTitleFromFilename('Daft_Punk - One More Time.mp3') }, { artist:'Daft Punk', title:'One More Time' });
  assert.deepEqual({ ...h.parseArtistTitleFromFilename('mixdown.wav') }, { artist:'', title:'mixdown' });
});

test('audio detection rejects non-audio', () => {
  const window = loadAppDom(); const h = window.__DJBattleTestHooks;
  const F = (n, t) => new window.File(['x'], n, { type:t });
  assert.equal(h.isAudioFile(F('a.mp3', 'audio/mpeg')), true);
  assert.equal(h.isAudioFile(F('a.flac', '')), true);
  assert.equal(h.isAudioFile(F('a.png', 'image/png')), false);
  assert.equal(h.isAudioFile(F('notes.txt', '')), false);
  const s = h.splitDroppedFiles([F('a.mp3','audio/mpeg'), F('b.pdf','application/pdf')]);
  assert.equal(s.audio.length, 1); assert.equal(s.rejected.length, 1);
});

test('library drop opens Upload prefilled from filename, toasts on non-audio', async () => {
  const window = loadAppDom(); const h = window.__DJBattleTestHooks; const doc = window.document;
  const pdf = new window.File(['x'], 'flyer.pdf', { type:'application/pdf' });
  const bad = await h.handleLibraryDrop([pdf]);
  assert.equal(bad.ok, false);
  assert.match(doc.body.textContent, /Not an audio file/);
  const mp3 = new window.File([new Uint8Array(id3([['TIT2', txt('Tagged Title')], ['TPE1', txt('Tagged Artist')]]))], 'x - y.mp3', { type:'audio/mpeg' });
  const ok = await h.handleLibraryDrop([mp3]);
  assert.equal(ok.ok, true);
  await new Promise(r => setTimeout(r, 5));
  assert.equal(doc.getElementById('meta-title').value, 'Tagged Title');
  assert.equal(doc.getElementById('meta-artist').value, 'Tagged Artist');
  assert.match(doc.getElementById('meta-prefill-note').textContent, /tags/);
});

test('dragover highlights the library and a drop on a deck loads it', async () => {
  const window = loadAppDom(); const h = window.__DJBattleTestHooks; const doc = window.document;
  const lib = doc.getElementById('library');
  const ev = new window.Event('dragenter', { bubbles:true, cancelable:true });
  ev.dataTransfer = { types:['Files'], files:[] };
  lib.dispatchEvent(ev);
  assert.equal(lib.classList.contains('drop-active'), true);
  const deckEl = doc.querySelector('#studio [data-deck="b"]');
  assert.ok(deckEl.dataset.dropWired);
  window.URL.createObjectURL = () => 'blob:x';
  const f = new window.File(['x'], 'Artist - Tune.wav', { type:'audio/wav' });
  const res = h.handleDeckDrop('b', [f]);
  assert.equal(res.ok, true);
  await new Promise(r => setTimeout(r, 150));
  assert.equal(doc.getElementById('name-b').textContent, 'Artist - Tune');
  assert.equal(h.handleDeckDrop('a', [new window.File(['x'], 'p.png', { type:'image/png' })]).ok, false);
});
