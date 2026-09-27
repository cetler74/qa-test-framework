'use strict';

/**
 * Offline checks for services/uiDiscoverer.js.
 * Run with: node scripts/validate-ui-discover.js
 * No browser is launched.
 */

const {
  normalizeDiscoverUrl,
  shouldEnqueue,
  expandQueue,
  suggestSmokes,
  suggestJourneys,
  specFromSteps,
  stepsFromSpec
} = require('../services/uiDiscoverer');
const { validateSpecContent } = require('../services/recordedTestValidation');
const { applyRecordedSpecTemplate } = require('../services/recordedSpecTemplate');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log('  ✓ ' + message);
    passed += 1;
  } else {
    console.error('  ✗ FAIL: ' + message);
    failed += 1;
  }
}

const origin = 'https://example.com/app';

console.log('\nURL queue');
const start = normalizeDiscoverUrl('https://example.com/app/');
const graph = {};
graph[start] = [
  'https://example.com/app#section',
  'https://example.com/app/?utm_source=ads',
  'https://example.com/app/billing',
  'https://example.com/app/billing?fbclid=1&gclid=2',
  '#details',
  'mailto:ops@example.com',
  'https://other.example/app'
];
graph[normalizeDiscoverUrl('https://example.com/app/billing')] = [
  'https://example.com/app/billing/invoice',
  'https://example.com/app/billing'
];
const crawled = expandQueue('https://example.com/app/', graph, { maxPages: 20, maxDepth: 3 });
const urls = crawled.map((page) => page.url);
assert(urls.filter((url) => url === start).length === 1, 'the start route is queued once');
assert(urls.filter((url) => url === 'https://example.com/app/billing').length === 1, 'tracking params and the hash do not enqueue the same route twice');
assert(!urls.some((url) => url.includes('#') || url.includes('utm_') || url.includes('fbclid')), 'normalized queue URLs drop the hash and tracking params');
assert(shouldEnqueue('#details', origin) === false, 'tab activation does not create a new queue URL');
assert(shouldEnqueue('javascript:void(0)', origin) === false, 'javascript links are not queued');
assert(!urls.includes('https://other.example/app'), 'other hosts stay out of the queue');

const capped = expandQueue('https://example.com/start', {
  'https://example.com/start': ['https://example.com/a', 'https://example.com/b', 'https://example.com/c']
}, { maxPages: 2, maxDepth: 3 });
assert(capped.length === 2, 'the queue stops at maxPages');

const shallow = expandQueue('https://example.com/start', {
  'https://example.com/start': ['https://example.com/a'],
  'https://example.com/a': ['https://example.com/b']
}, { maxPages: 20, maxDepth: 1 });
assert(shallow.some((page) => page.url === 'https://example.com/a'), 'depth 1 is visited');
assert(!shallow.some((page) => page.url === 'https://example.com/b'), 'the queue stops at maxDepth');

console.log('\nSmoke suggestions');
const inventory = [
  { pageUrl: 'https://example.com/app', role: 'button', name: 'Save draft', kind: 'button', destructive: false, reach: [{ type: 'tab', name: 'Billing' }] },
  { pageUrl: 'https://example.com/app', role: 'button', name: 'Log out', kind: 'button', destructive: false, reach: [] },
  { pageUrl: 'https://example.com/app', role: 'button', name: 'Delete', kind: 'button', destructive: false, reach: [] },
  { pageUrl: 'https://example.com/app', role: 'button', name: 'Pagar agora', kind: 'button', destructive: false, reach: [] },
  { pageUrl: 'https://example.com/app', role: 'button', name: 'Save draft', kind: 'button', destructive: false, reach: [] }
];
const smokes = suggestSmokes(inventory);
const smokeNames = smokes.map((smoke) => smoke.controlName);
assert(smokeNames.includes('Save draft'), 'a non-destructive control is suggested');
assert(!smokeNames.includes('Log out') && !smokeNames.includes('Delete') && !smokeNames.includes('Pagar agora'), 'denylisted names are absent from default suggested smokes');
assert(smokes.filter((smoke) => smoke.controlName === 'Save draft').length === 1, 'role, name, and page dedupe a smoke');
const smokeSpec = smokes[0].spec_content;
const clickAt = smokeSpec.lastIndexOf('.click()');
assert(smokeSpec.includes('getByRole'), 'a smoke spec uses getByRole');
assert(clickAt > -1 && smokeSpec.indexOf('expect(', clickAt) > clickAt, 'a smoke spec expects something after the action');
assert(validateSpecContent(smokeSpec).valid, 'a smoke spec passes recorded-test validation');

console.log('\nJourney suggestions');
const journeys = suggestJourneys([
  { pageUrl: 'https://example.com/login', role: 'textbox', name: 'Email', kind: 'field', destructive: false, reach: [] },
  { pageUrl: 'https://example.com/login', role: 'textbox', name: 'Password', kind: 'field', destructive: false, reach: [] },
  { pageUrl: 'https://example.com/login', role: 'button', name: 'Sign in', kind: 'submit', destructive: false, reach: [] },
  { pageUrl: 'https://example.com/app', role: 'tab', name: 'Overview', kind: 'tab', destructive: false, reach: [] },
  { pageUrl: 'https://example.com/app', role: 'tab', name: 'Billing', kind: 'tab', destructive: false, reach: [] },
  { pageUrl: 'https://example.com/app', role: 'searchbox', name: 'Search', kind: 'field', destructive: false, reach: [] },
  { pageUrl: 'https://example.com/app', role: 'button', name: 'Search', kind: 'button', destructive: false, reach: [] }
]);
assert(journeys.length <= 8, 'journeys stay within the cap');
assert(journeys.some((journey) => journey.spec_content.includes('${USERNAME}') && journey.spec_content.includes('${PASSWORD}')), 'the login journey uses username and password placeholders');
assert(journeys.some((journey) => journey.name.indexOf('Tabs') !== -1), 'a section with tabs becomes a journey');
assert(journeys.some((journey) => journey.steps.some((step) => step.check === 'results')), 'search becomes a journey with a results check');

console.log('\nStep round-trip');
const steps = [
  { type: 'open', url: 'https://example.com/app' },
  { type: 'reach', reachType: 'tab', name: 'Billing' },
  { type: 'activate', role: 'button', name: 'Save draft' },
  { type: 'check', check: 'dialog' }
];
const spec = specFromSteps(steps, { name: 'Journey: Billing' });
const restored = stepsFromSpec(applyRecordedSpecTemplate(spec));
assert(restored && restored[0].url === 'https://example.com/app', 'round-trip keeps the page');
assert(restored && restored[2].role === 'button' && restored[2].name === 'Save draft', 'round-trip keeps the role and name');
assert(restored && restored[3].check === 'dialog', 'round-trip keeps the check');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
