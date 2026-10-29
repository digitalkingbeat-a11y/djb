// Oct 29: "Show my QR code" on the Profile. The code is made right here in the browser with the
// vendored qrcode-generator (assets/vendor/qrcode.js, MIT); no outside service sees the link.
(function(W){
  'use strict';
  const D = W.document;
  const QUIET = 4; // modules of white border, as the QR spec asks

  // Grid of true/false for a link, or null when the library is missing or the text is too long.
  function qrMatrix(text, level = 'M'){
    const lib = W.qrcode;
    const value = String(text || '');
    if(typeof lib !== 'function' || !value || value.length > 1200) return null;
    try{
      const qr = lib(0, level);
      qr.addData(value, 'Byte');
      qr.make();
      const n = qr.getModuleCount();
      const rows = [];
      for(let r = 0; r < n; r += 1){ const row = []; for(let c = 0; c < n; c += 1) row.push(qr.isDark(r, c)); rows.push(row); }
      return rows;
    }catch(e){ return null; }
  }

  // Crisp on-screen SVG (one path; nothing from the link is put into the markup).
  function qrSvg(matrix, px = 240){
    if(!matrix) return '';
    const n = matrix.length + QUIET * 2;
    let d = '';
    matrix.forEach((row, r) => row.forEach((dark, c) => { if(dark) d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`; }));
    return `<svg class="profile-qr-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="QR code for your profile link"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  // Draws onto a canvas (for the PNG). Returns false when canvas drawing is not available.
  function drawQr(canvas, matrix, scale = 10){
    if(!canvas || !matrix) return false;
    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if(!ctx) return false;
    const n = matrix.length + QUIET * 2;
    canvas.width = n * scale;
    canvas.height = n * scale;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000000';
    matrix.forEach((row, r) => row.forEach((dark, c) => { if(dark) ctx.fillRect((c + QUIET) * scale, (r + QUIET) * scale, scale, scale); }));
    return true;
  }

  function qrFileName(name){
    const slug = String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
    return `${slug || 'dj'}-profile-qr.png`;
  }

  function downloadQrPng(link, name){
    const matrix = qrMatrix(link);
    const canvas = D.createElement('canvas');
    if(!drawQr(canvas, matrix, 12) || typeof canvas.toDataURL !== 'function') return { ok:false, error:'png_unavailable' };
    let url = '';
    try{ url = canvas.toDataURL('image/png'); }catch(e){ url = ''; }
    if(!/^data:image\/png;base64,/.test(url)) return { ok:false, error:'png_unavailable' };
    const a = D.createElement('a');
    a.href = url;
    a.download = qrFileName(name);
    a.rel = 'noopener';
    a.style.display = 'none';
    D.body.appendChild(a);
    a.click();
    a.remove();
    return { ok:true, name:a.download };
  }

  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch])); }

  function openProfileQr(){
    const user = typeof W.currentUser === 'function' ? W.currentUser() : null;
    const link = typeof W.currentProfileShareUrl === 'function' ? W.currentProfileShareUrl() : '';
    const open = typeof W.openModal === 'function' ? W.openModal : null;
    if(!open) return { ok:false, error:'no_modal' };
    if(!link){
      open(`<span class="eyebrow accent">PROFILE QR CODE</span><h3>Sign in for a QR code</h3><p style="color:var(--muted)" id="profile-qr-local-note">This browser profile is local only. Sign in to get a public DJ link, then show its QR code at gigs so people can find you.</p><div class="modal-actions"><button class="primary" value="cancel">OK</button></div>`);
      return { ok:false, error:'local_only' };
    }
    const matrix = qrMatrix(link);
    if(!matrix){
      open(`<span class="eyebrow accent">PROFILE QR CODE</span><h3>QR code unavailable</h3><p style="color:var(--muted)">The QR code maker did not load. Refresh the page and try again.</p><div class="modal-actions"><button class="primary" value="cancel">OK</button></div>`);
      return { ok:false, error:'qr_unavailable' };
    }
    open(`<span class="eyebrow accent">PROFILE QR CODE</span><h3>Scan to see my DJ profile</h3><div class="profile-qr-frame" id="profile-qr-frame">${qrSvg(matrix)}</div><p class="profile-qr-link" id="profile-qr-link">${esc(link)}</p><p style="color:var(--muted)">Made on this device. Show it at gigs, or save it for flyers.</p><div class="modal-actions"><button class="ghost" value="cancel">Close</button><button class="primary" type="button" id="profile-qr-download">Download PNG</button></div>`);
    const btn = D.getElementById('profile-qr-download');
    if(btn) btn.onclick = () => {
      const r = downloadQrPng(link, user && user.displayName);
      if(!r.ok && typeof W.appAlert === 'function') W.appAlert('This browser could not make the PNG. Take a screenshot of the code instead.', 'QR code');
      return r;
    };
    return { ok:true, link, size:matrix.length };
  }

  function wire(){
    const btn = D.getElementById('profile-qr-button');
    if(btn && !btn.dataset.wired){ btn.dataset.wired = '1'; btn.addEventListener('click', openProfileQr); }
  }
  wire();
  if(D.readyState === 'loading') D.addEventListener('DOMContentLoaded', wire);

  W.DJBattleProfileQr = { qrMatrix, qrSvg, drawQr, qrFileName, downloadQrPng, openProfileQr, QUIET };
})(window);
