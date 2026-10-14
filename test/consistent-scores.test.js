const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function grab(name){
  const i = src.indexOf(`function ${name}(`); assert.ok(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for(; j < src.length; j++){ if(src[j]==='{') d++; else if(src[j]==='}' && --d===0) break; }
  return src.slice(i, j+1);
}
const body = ['stableHash','practiceDurationSeconds','generatePracticeScore'].map(grab).join('\n');
function load(){
  const ctx = { Math: Object.create(Math) };
  ctx.Math.random = () => { throw new Error('Math.random used'); };
  vm.createContext(ctx); vm.runInContext(body + '\nthis.g=generatePracticeScore;', ctx);
  return ctx.g;
}
const mix = { id:'m1', name:'Friday Set', tracks:[{name:'A',durationSec:200,bpm:124,key:'8A'},{name:'B',durationSec:210,bpm:126,key:'8A'},{name:'C',durationSec:190,bpm:128,key:'9A'}] };

test('same mix gives the same scores every time, without Math.random', () => {
  const g = load();
  const a = g(mix), b = g(JSON.parse(JSON.stringify(mix)));
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.equal(a.breakdown.length, 9);
  a.breakdown.forEach(c => assert.ok(c.score >= 8 && c.score <= 20));
  assert.equal(a.basis, 'mix');
});
test('missing data falls back to a stable fingerprint of the name', () => {
  const g = load();
  const x = g({ name:'Practice Session' }), y = g({ name:'Practice Session' }), z = g({ name:'Other Mix' });
  assert.deepEqual(JSON.parse(JSON.stringify(x)), JSON.parse(JSON.stringify(y)));
  assert.equal(x.basis, 'fingerprint');
  assert.notDeepEqual(x.breakdown.map(c=>c.score), z.breakdown.map(c=>c.score));
});
test('scoring path has no Math.random and shows PREVIEW + how-scored note', () => {
  assert.doesNotMatch(body, /Math\.random/);
  assert.match(src, /AI RATING · PREVIEW/);
  assert.match(src, /id="how-scored-note"/);
  assert.match(src, /How this is scored:/);
});
