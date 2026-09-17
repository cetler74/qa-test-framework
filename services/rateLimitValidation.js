function normalizeRequestIdentity(method, rawUrl) {
  let pathname = '';
  let origin = '';
  try {
    const parsed = new URL(String(rawUrl || ''));
    pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    origin = parsed.origin.toLowerCase();
  } catch (_) {
    pathname = String(rawUrl || '').split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
  }
  return {
    method: String(method || '').toUpperCase(),
    origin,
    pathname
  };
}

function isSetupAuthRequest(method, rawUrl) {
  const { pathname } = normalizeRequestIdentity(method, rawUrl);
  return /(?:^|\/)bc-authorize$/i.test(pathname) || /(?:^|\/)token$/i.test(pathname);
}

function sameRequestIdentity(left, right) {
  return left.method === right.method && left.origin === right.origin && left.pathname === right.pathname;
}

function validateRouteLimitPhase({ attempts = [], window, target, requestCeiling }) {
  const suffix = window === 'minute' ? 'minute' : 'second';
  const limitKey = `route_limit_${suffix}`;
  const remainingKey = `route_remaining_${suffix}`;
  const relevant = attempts.filter((attempt) => {
    if (!attempt || !attempt.evidence) return false;
    if (!target || !attempt.identity) return true;
    return sameRequestIdentity(attempt.identity, target);
  });

  if (relevant.length === 0 || relevant.every((attempt) => attempt.evidence[limitKey] == null && attempt.evidence[remainingKey] == null)) {
    return { status: 'inconclusive', reason: `missing_route_${suffix}_headers` };
  }

  const numeric = relevant.filter((attempt) =>
    Number.isFinite(attempt.evidence[limitKey]) && Number.isFinite(attempt.evidence[remainingKey]));
  if (numeric.length === 0 || numeric.some((attempt) =>
    attempt.evidence[limitKey] < 0 ||
    attempt.evidence[remainingKey] < 0 ||
    attempt.evidence[remainingKey] > attempt.evidence[limitKey])) {
    return { status: 'failed', reason: `invalid_route_${suffix}_headers` };
  }

  const firstRemaining = numeric[0].evidence[remainingKey];
  const requiredRequests = firstRemaining + 2;
  if (Number.isInteger(requestCeiling) && requiredRequests > requestCeiling) {
    return {
      status: 'inconclusive',
      reason: 'request_ceiling_insufficient',
      requiredRequests,
      requestCeiling
    };
  }

  let declined = false;
  let exhausted = false;
  let attributable429 = false;
  let previous = firstRemaining;
  for (const attempt of numeric) {
    const remaining = attempt.evidence[remainingKey];
    if (remaining < previous) declined = true;
    if (remaining === 0) exhausted = true;
    if (attempt.responseCode === 429 && exhausted && attempt.evidence[remainingKey] != null) attributable429 = true;
    previous = remaining;
  }

  if (declined && exhausted && attributable429) {
    return { status: 'passed', reason: `route_${suffix}_limit_enforced` };
  }
  if (exhausted && !attributable429) {
    return { status: 'failed', reason: `route_${suffix}_exhausted_without_429` };
  }
  return { status: 'inconclusive', reason: `route_${suffix}_limit_not_exhausted` };
}

module.exports = {
  isSetupAuthRequest,
  normalizeRequestIdentity,
  sameRequestIdentity,
  validateRouteLimitPhase
};