const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const app = fs.readFileSync(__dirname + '/../app.js', 'utf8');
const css = fs.readFileSync(__dirname + '/../professional-redesign.css', 'utf8');
test('practice history uses safeParse', () => {
  assert.match(app, /practiceHistory: safeParse\('djBattlePracticeHistory', \[\]\)/);
  assert.doesNotMatch(app, /JSON\.parse\(localStorage\.getItem\('djBattlePracticeHistory'/);
});
test('polling pauses when hidden and resumes on visible', () => {
  assert.match(app, /addEventListener\('visibilitychange', handleDjPollingVisibility\)/);
  const fn = app.slice(app.indexOf('function handleDjPollingVisibility'), app.indexOf('function scheduleDjChallengePolling'));
  assert.match(fn, /document\.hidden/);
  assert.match(fn, /clearInterval\(state\.djChallenges\.pollTimer\)/);
  assert.match(fn, /pollDjAlertsNow\(\)/);
});
test('reduced motion media query', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: 0\.01ms[\s\S]*transition-duration: 0\.01ms/);
});
