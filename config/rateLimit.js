const DEFAULT_MAX_REQUESTS = 100;

function getRateLimitMaxRequests() {
  const configured = Number.parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10);
  return Number.isInteger(configured) && configured >= 2
    ? configured
    : DEFAULT_MAX_REQUESTS;
}

module.exports = {
  DEFAULT_MAX_REQUESTS,
  getRateLimitMaxRequests
};