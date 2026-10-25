// "Download all stems" for remix contests: a tiny store-only ZIP writer (no compression, audio
// is already compressed) that runs in the browser, so no server change and no extra library.
// Each part is fetched through the same per-part download endpoint as the single Download
// buttons, so exactly the same access rules apply. Exposed as window.DJBStemsZip.
(function(root){
  'use strict';
  const CRC_TABLE = (() => { const t = new Uint32Array(256); for(let n = 0; n < 256; n++){ let c = n; for(let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(bytes){ let c = 0xFFFFFFFF; for(let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function utf8(str){ if(typeof TextEncoder === 'function') return new TextEncoder().encode(str); const b = unescape(encodeURIComponent(str)); const out = new Uint8Array(b.length); for(let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i); return out; }
  function safeName(name, fallback){
    let s = String(name == null ? '' : name).normalize ? String(name == null ? '' : name).normalize('NFKD') : String(name || '');
    s = s.replace(/[\u0300-\u036f]/g, '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s.]+/, '').trim().slice(0, 80).trim();
    return s || fallback || 'file';
  }
  function zipFileName(title){ return `${safeName(title, 'remix-contest').replace(/ /g, '-')}-stems.zip`; }
  function uniqueNames(names){
    const seen = new Map();
    return names.map(n => {
      const base = safeName(n, 'part'); const key = base.toLowerCase();
      if(!seen.has(key)){ seen.set(key, 1); return base; }
      const i = seen.get(key) + 1; seen.set(key, i);
      const dot = base.lastIndexOf('.');
      return dot > 0 ? `${base.slice(0, dot)} (${i})${base.slice(dot)}` : `${base} (${i})`;
    });
  }
  // files: [{ name, data:Uint8Array }] -> Uint8Array of a valid ZIP (store method, UTF-8 names).
  function buildZip(files){
    const enc = { encode: utf8 }; const locals = []; const centrals = []; let offset = 0;
    const d = new Date(); const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for(const f of files){
      const name = enc.encode(f.name); const data = f.data; const crc = crc32(data);
      if(data.length > 0xFFFFFFFE || offset > 0xFFFFFFFE) throw new Error('The parts are too big for one zip (over 4 GB). Download them one at a time.');
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      locals.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      centrals.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = centrals.reduce((n, b) => n + b.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
    const parts = [...locals, ...centrals, new Uint8Array(e.buffer)];
    const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0)); let p = 0;
    parts.forEach(b => { out.set(b, p); p += b.length; });
    return out;
  }
  // getUrl(part) -> { url, filename } | throws; fetchImpl(url) -> Response. onProgress({ done, total, label }).
  async function collect(parts, { getUrl, fetchImpl, onProgress } = {}){
    const list = parts.filter(p => p && p.uploaded !== false);
    if(!list.length) throw new Error('No parts are ready to download yet.');
    const names = uniqueNames(list.map(p => p.filename || p.label));
    const files = [];
    for(let i = 0; i < list.length; i++){
      const p = list[i]; const label = p.label || p.filename || `Part ${i + 1}`;
      if(onProgress) onProgress({ done:i, total:list.length, label });
      let bytes;
      try{
        const link = await getUrl(p);
        const res = await fetchImpl(link.url);
        if(!res || !res.ok) throw new Error(`the server answered ${res ? res.status : 'nothing'}`);
        bytes = new Uint8Array(await res.arrayBuffer());
      }catch(err){
        const e = new Error(`\u201c${label}\u201d couldn\u2019t be downloaded (${(err && err.message) || 'network error'}). Nothing was saved. Try again, or download that part on its own.`);
        e.part = p; throw e;
      }
      files.push({ name:names[i], data:bytes });
    }
    if(onProgress) onProgress({ done:list.length, total:list.length, label:'Packing zip' });
    return buildZip(files);
  }
  const api = { crc32, safeName, zipFileName, uniqueNames, buildZip, collect };
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root) root.DJBStemsZip = api;
})(typeof window !== 'undefined' ? window : null);
