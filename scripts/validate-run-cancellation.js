const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
const handlerStart = appSource.indexOf('window.cancelTestRun = async');
const handlerEnd = appSource.indexOf('\nwindow.deleteProject', handlerStart);

assert(handlerStart >= 0 && handlerEnd > handlerStart, 'Could not locate cancelTestRun in public/js/app.js');

const context = vm.createContext({
  window: {},
  confirm: () => true,
  apiRequest: async () => {},
  loadTestRuns: () => {},
  alert: () => {}
});
vm.runInContext(appSource.slice(handlerStart, handlerEnd), context);

const cases = [
  ['api', 'Cancel this API test run? It will stop after the current request.', '/test-runs/42/cancel'],
  ['soap', 'Cancel this SOAP test run? It will stop after the current request.', '/test-runs/42/cancel'],
  ['iterations', 'Cancel this iteration test run? It will stop after the current request.', '/test-runs/42/cancel'],
  ['rate_limit', 'Cancel this rate-limit test run? It will stop after the current request.', '/test-runs/42/cancel'],
  ['ui', 'Cancel this UI test run?', '/playwright-runs/42/cancel'],
  ['fuzz', 'Cancel this fuzz run?', '/fuzz-runs/42/cancel']
];

(async () => {
  for (const [runType, expectedMessage, expectedPath] of cases) {
    let actualMessage = '';
    let actualRequest = null;
    context.confirm = (message) => {
      actualMessage = message;
      return true;
    };
    context.apiRequest = async (requestPath, options) => {
      actualRequest = { path: requestPath, method: options && options.method };
    };

    await context.window.cancelTestRun(runType, 42);

    assert.strictEqual(actualMessage, expectedMessage, `${runType} cancellation message`);
    assert.deepStrictEqual(actualRequest, { path: expectedPath, method: 'POST' }, `${runType} cancellation request`);
  }

  console.log('Run cancellation routing validated for API, SOAP, Iterations, RATE, UI, and Fuzz.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});