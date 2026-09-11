const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { normalizeApiTaskRef, normalizeUiTaskRef } = require('../services/flowTaskConfig');

const legacyApi = normalizeApiTaskRef({ collectionId: 3, path: [0, 1], label: 'Legacy API test' });
assert.deepStrictEqual(legacyApi.selectedTests, { 3: [[0, 1]] });
assert.strictEqual(legacyApi.selectedTestsOrdered[0].name, 'Legacy API test');

const configuredApi = normalizeApiTaskRef({
  environmentId: 5,
  environmentName: 'QA',
  selectedTestsOrdered: [
    { collectionId: 3, path: [1], name: 'Second' },
    { collectionId: 3, path: [0], name: 'First' }
  ],
  envVars: { token: 123 },
  delayBetweenTests: 1.5
});
assert.deepStrictEqual(configuredApi.selectedTests[3], [[1], [0]]);
assert.strictEqual(configuredApi.envVars.token, '123');
assert.strictEqual(configuredApi.delayBetweenTests, 1.5);
assert.strictEqual(configuredApi.environmentId, 5);
assert.strictEqual(configuredApi.environmentName, 'QA');

const legacyUi = normalizeUiTaskRef({ recordedTestId: 7 });
assert.deepStrictEqual(legacyUi.selectedTestIds, [7]);

const configuredUi = normalizeUiTaskRef({
  selectedTestIds: [8, 7],
  uiVariables: { account: 42 },
  browserName: 'firefox',
  headless: false,
  timeoutMs: 45000
});
assert.deepStrictEqual(configuredUi.selectedTestIds, [8, 7]);
assert.strictEqual(configuredUi.uiVariables.account, '42');
assert.strictEqual(configuredUi.browserName, 'firefox');
assert.strictEqual(configuredUi.headless, false);

assert.throws(() => normalizeApiTaskRef({ selectedTestsOrdered: [] }), /at least one/);
assert.throws(() => normalizeUiTaskRef({ selectedTestIds: [] }), /at least one/);

const runnerSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'flowRunner.js'), 'utf8');
assert.match(runnerSource, /await executeTests\(/);
assert.match(runnerSource, /await runPlaywrightTests\(/);
assert.match(runnerSource, /await executeFuzz\(/);
assert.doesNotMatch(runnerSource, /executeTests\([\s\S]*?\)\.then\(/);
assert.doesNotMatch(runnerSource, /runPlaywrightTests\([\s\S]*?\)\.then\(/);

console.log('Flow configuration validation passed.');