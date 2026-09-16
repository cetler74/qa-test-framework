-- Support Iterations and Rate Limit API test run modes.
ALTER TABLE test_results
  ADD COLUMN IF NOT EXISTS iteration_number INTEGER,
  ADD COLUMN IF NOT EXISTS rate_limit_evidence JSONB;
