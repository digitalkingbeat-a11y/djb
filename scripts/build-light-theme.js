#!/usr/bin/env node
// Generates light-theme.css: the light-mode overrides for every hard-coded dark colour in the
// app's stylesheets. Each override is scoped to html[data-theme="light"], so dark mode (the
// default) is untouched. Re-run after changing colours in any CSS file:
//   node scripts/build-light-theme.js        (writes light-theme.css)
//   node scripts/build-light-theme.js --check (fails if light-theme.css is out of date)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const OUT = 'light-theme.css';
const SKIP = new Set([OUT, 'themes.css', 'social.css']);
const PREFIX = 'html[data-theme="light"]';

function sourceFiles(){
  const css = fs.readdirSync(root).filter(n => n.endsWith('.css') && !SKIP.has(n)).sort()
    .map(name => ({ name, text:fs.readFileSync(path.join(root, name), 'utf8') }));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const inline = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  return [...css, { name:'index.html <style>', text:inline }];
}

/* ---------- colour maths ---------- */
function parseColor(text){
  let m = /^#([0-9a-f]{3,8})$/i.exec(text);
  if(m){
    let h = m[1];
    if(h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
    const n = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r:n[0], g:n[1], b:n[2], a };
  }
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(text);
  if(m){
    const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r:+m[1], g:+m[2], b:+m[3], a };
  }
  return null;
}
function toHsl({ r, g, b }){
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if(max !== min){
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return { h, s, l };
}
function fromHsl({ h, s, l }){
  const f = n => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return { r:f(0), g:f(8), b:f(4) };
}
const LIGHT_PANEL = { r:0xe6, g:0xe9, b:0xef };
function luminance({ r, g, b }){
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(x, y){ const a = luminance(x), b = luminance(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }
function fmt({ r, g, b }, a){
  const hex = '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
  return a == null || a >= 1 ? hex : `rgba(${r},${g},${b},${+a.toFixed(3)})`;
}

// role: 'surface' (backgrounds), 'line' (borders), 'text'
function mapColor(text, role){
  const c = parseColor(text);
  if(!c) return null;
  const hsl = toHsl(c);
  if(role === 'text'){
    if(hsl.l < 0.5) return null; // already dark text, usually on a bright button
    if(c.a < 1 && hsl.s < 0.2) return fmt({ r:17, g:24, b:38 }, Math.min(1, c.a + 0.25)); // translucent white text
    // Darken until the text clears AA (with margin) on a light grey panel.
    let l = hsl.s > 0.35 ? 0.3 : Math.max(0.1, Math.min(0.34, 1.02 - hsl.l));
    let rgb = fromHsl({ h:hsl.h, s:hsl.s, l });
    while(contrast(rgb, LIGHT_PANEL) < 5.2 && l > 0.05){ l -= 0.01; rgb = fromHsl({ h:hsl.h, s:hsl.s, l }); }
    return fmt(rgb, c.a);
  }
  if(c.a < 1){
    // Translucent white washes become translucent dark washes; tinted glows stay.
    if(hsl.l > 0.85 && hsl.s < 0.2) return fmt({ r:15, g:23, b:42 }, Math.min(0.12, c.a * 1.5));
    if(hsl.l < 0.12 && role === 'surface' && c.a <= 0.5 && hsl.s < 0.3) return fmt({ r:15, g:23, b:42 }, Math.max(0.03, Math.min(0.06, c.a * 0.25)));
    if(hsl.l < 0.2 && role === 'surface' && c.a > 0.5) return fmt(fromHsl({ h:hsl.h, s:Math.min(hsl.s, 0.3), l:0.96 - hsl.l * 0.3 }), c.a);
    return null;
  }
  if(hsl.l >= 0.5) return null; // light or bright surfaces (accent buttons, white) keep their colour
  if(hsl.s > 0.55 && hsl.l > 0.3) return null; // saturated mid tones (danger red, blue) stay
  const s = Math.min(hsl.s, 0.35);
  const l = role === 'line' ? 0.86 - hsl.l * 0.25 : 0.985 - hsl.l * 0.4;
  return fmt(fromHsl({ h:hsl.h, s, l }), 1);
}

const COLOR_TOKEN = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
function roleFor(prop){
  if(/^(color|fill|stroke|caret-color|-webkit-text-fill-color|text-decoration-color|accent-color)$/.test(prop)) return 'text';
  if(/^(border|outline|column-rule)/.test(prop)) return 'line';
  if(/^(background|background-color|background-image)$/.test(prop)) return 'surface';
  return null;
}
function mapValue(prop, value){
  const role = roleFor(prop);
  if(!role) return null;
  let changed = false;
  let out = value.replace(COLOR_TOKEN, token => { const m = mapColor(token, role); if(m){ changed = true; return m; } return token; });
  if(role === 'text' && /var\(--accent2?\b[^)]*\)/.test(out)){ out = out.replace(/var\(--accent2?\b[^)]*\)/g, 'var(--accent-text)'); changed = true; }
  return changed ? out : null;
}

/* ---------- tiny CSS walker ---------- */
function stripComments(text){ return text.replace(/\/\*[\s\S]*?\*\//g, ''); }
function splitTop(text, sep){
  const parts = []; let depth = 0, quote = null, cur = '';
  for(const ch of text){
    if(quote){ cur += ch; if(ch === quote) quote = null; continue; }
    if(ch === '"' || ch === "'"){ quote = ch; cur += ch; continue; }
    if(ch === '(') depth++;
    if(ch === ')') depth--;
    if(ch === sep && depth === 0){ parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if(cur.trim()) parts.push(cur);
  return parts;
}
function readBlock(text, start){ // start at '{'; returns index after matching '}'
  let depth = 0, quote = null;
  for(let i = start; i < text.length; i++){
    const ch = text[i];
    if(quote){ if(ch === quote && text[i - 1] !== '\\') quote = null; continue; }
    if(ch === '"' || ch === "'"){ quote = ch; continue; }
    if(ch === '{') depth++;
    if(ch === '}'){ depth--; if(depth === 0) return i + 1; }
  }
  return text.length;
}
function scopeSelector(sel){
  return splitTop(sel, ',').map(s => s.trim()).filter(Boolean).map(s => {
    if(/^:root\b/.test(s)) return null;
    if(/^html\b/.test(s)) return s.replace(/^html/, PREFIX);
    return `${PREFIX} ${s}`;
  }).filter(Boolean).join(',');
}
function walk(text){
  const out = [];
  let i = 0;
  while(i < text.length){
    const open = text.indexOf('{', i);
    if(open < 0) break;
    const head = text.slice(i, open).trim();
    const end = readBlock(text, open);
    const body = text.slice(open + 1, end - 1);
    if(/^@(media|supports)/i.test(head)){
      const inner = walk(body);
      if(inner.length) out.push(`${head}{${inner.join('')}}`);
    }else if(!head.startsWith('@')){
      const decls = splitTop(body, ';').map(d => {
        const idx = d.indexOf(':');
        if(idx < 0) return null;
        const prop = d.slice(0, idx).trim().toLowerCase();
        if(prop.startsWith('--')) return null;
        let value = d.slice(idx + 1).trim();
        const important = /!important\s*$/.test(value);
        value = value.replace(/\s*!important\s*$/, '');
        const mapped = mapValue(prop, value);
        return mapped ? `${prop}:${mapped}${important ? '!important' : ''}` : null;
      }).filter(Boolean);
      const sel = scopeSelector(head);
      if(decls.length && sel) out.push(`${sel}{${decls.join(';')}}`);
    }
    i = end;
  }
  return out;
}

function buildLightTheme(){
  const parts = ['/* Generated by scripts/build-light-theme.js from the app stylesheets. Do not edit by hand;\n   hand-tuned light-mode rules live in themes.css. */'];
  for(const file of sourceFiles()){
    const rules = walk(stripComments(file.text));
    if(rules.length) parts.push(`/* ${file.name} */\n${rules.join('\n')}`);
  }
  return parts.join('\n') + '\n';
}

module.exports = { buildLightTheme, mapColor, OUT };

if(require.main === module){
  const css = buildLightTheme();
  const target = path.join(root, OUT);
  if(process.argv.includes('--check')){
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if(current !== css){ console.error(`${OUT} is out of date. Run: node scripts/build-light-theme.js`); process.exit(1); }
    console.log(`${OUT} is up to date`);
  }else{
    fs.writeFileSync(target, css);
    console.log(`Wrote ${OUT} (${css.length} bytes)`);
  }
}
