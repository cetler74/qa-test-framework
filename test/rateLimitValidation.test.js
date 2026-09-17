const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isSetupAuthRequest,
  normalizeRequestIdentity,
  validateRouteLimitPhase
} = require('../services/rateLimitValidation');

test('classifies only exact setup auth path endings', () => {
  assert.equal(isSetupAuthRequest('POST', 'https://example.test/oauth/bc-authorize'), true);
  assert.equal(isSetupAuthRequest('POST', 'https://example.test/oauth/token/'), true);
  assert.equal(isSetupAuthRequest('GET', 'https://example.test/oauth/tokens'), false);
  assert.equal(isSetupAuthRequest('GET', 'https://example.test/token-changerequests'), false);
});

test('global-only evidence is inconclusive for route validation', () => {
  const result = validateRouteLimitPhase({
    window: 'second',
    attempts: [{ evidence: { global_remaining_minute: 0 }, responseCode: 429 }]
  });
  assert.deepEqual(result, { status: 'inconclusive', reason: 'missing_route_second_headers' });
});

test('passes only after route exhaustion and attributable 429', () => {
  const target = normalizeRequestIdentity('GET', 'https://api.test/resource');
  const attempts = [2, 1, 0, 0].map((remaining, index) => ({
    identity: target,
    responseCode: index === 3 ? 429 : 200,
    evidence: { route_limit_second: 3, route_remaining_second: remaining }
  }));
  assert.deepEqual(validateRouteLimitPhase({ attempts, window: 'second', target, requestCeiling: 10 }), {
    status: 'passed',
    reason: 'route_second_limit_enforced'
  });
});

test('does not accept a bare 429 as route proof', () => {
  const result = validateRouteLimitPhase({
    window: 'minute',
    requestCeiling: 10,
    attempts: [
      { responseCode: 200, evidence: { route_limit_minute: 2, route_remaining_minute: 1 } },
      { responseCode: 429, evidence: { global_remaining_minute: 0 } }
    ]
  });
  assert.equal(result.status, 'inconclusive');
});

test('reports an insufficient request ceiling', () => {
  const result = validateRouteLimitPhase({
    window: 'minute',
    requestCeiling: 20,
    attempts: [{ responseCode: 200, evidence: { route_limit_minute: 50, route_remaining_minute: 49 } }]
  });
  assert.deepEqual(result, {
    status: 'inconclusive',
    reason: 'request_ceiling_insufficient',
    requiredRequests: 51,
    requestCeiling: 20
  });
});

test('fails invalid counter ranges', () => {
  const result = validateRouteLimitPhase({
    window: 'second',
    attempts: [{ responseCode: 200, evidence: { route_limit_second: 10, route_remaining_second: 11 } }]
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'invalid_route_second_headers');
});

test('fails malformed numeric route headers', () => {
  const result = validateRouteLimitPhase({
    window: 'minute',
    attempts: [{ responseCode: 200, evidence: { route_limit_minute: 'fifty', route_remaining_minute: 'many' } }]
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'invalid_route_minute_headers');
});