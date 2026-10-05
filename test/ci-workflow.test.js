const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

test('CI workflow runs front-end build + tests and server tests on push and pull requests', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(workflow, /^on:\n  push:\n  pull_request:/m);
  assert.match(workflow, /run: npm run build/);
  assert.match(workflow, /run: npm test/);
  assert.match(workflow, /working-directory: server/);
  assert.equal((workflow.match(/run: npm ci/g) || []).length, 2);
});
