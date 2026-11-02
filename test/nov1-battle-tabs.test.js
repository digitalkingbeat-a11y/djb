// Nov 1: phone battle tabs land visibly on the list, each tab has its own empty state, titles clear the notch.
const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const html = read('index.html'), app = read('app.js'), css = read('professional-redesign.css');

test('viewport opts into safe areas so env(safe-area-inset-top) works on iPhone', () => {
  assert.match(html, /name="viewport" content="[^"]*viewport-fit=cover/);
  assert.match(css, /\.main\{padding-top:calc\(14px \+ env\(safe-area-inset-top,0px\)\)!important/);
});
test('phone filters fold behind a Filters button so the list sits under the tabs', () => {
  assert.match(html, /id="battle-filters-toggle"[^>]*aria-controls="battle-filter-row"/);
  assert.match(html, /class="battle-filter-row" id="battle-filter-row"/);
  assert.match(css, /#battles:not\(\.filters-open\) \.battle-filter-row/);
  assert.match(css, /#battles:not\(\.filters-open\) #saved-searches/);
  assert.match(app, /function wireBattleFiltersToggle\(\)/);
});
test('each tab has its own empty-state text and a tab tap reveals the list', () => {
  for(const t of ['You are not in any battles yet.', 'No completed battles yet.', 'No open battles right now.']) assert.ok(app.includes(t), t);
  assert.match(app, /const empty = battleTabEmptyHtml\(state\.battleViewTab \|\| 'open'\);/);
  assert.match(app, /renderBattles\(currentGenre\);\n\s*revealBattleList\(\);/);
});
