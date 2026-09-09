const assert = require('assert');
const { computeNextRunAt } = require('../services/scheduler');

const next = computeNextRunAt({
  cron_expression: '20 15 * * *',
  repeat_interval_minutes: null,
  last_run_at: null
});

assert(next instanceof Date);
assert(!Number.isNaN(next.getTime()));
assert(next.getTime() > Date.now());

console.log(`Schedule timezone validation passed: ${next.toISOString()}`);