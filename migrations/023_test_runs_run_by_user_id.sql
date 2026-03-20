-- Add run_by_user_id to test_runs so we can show who ran each test
ALTER TABLE test_runs
  ADD COLUMN IF NOT EXISTS run_by_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_test_runs_run_by_user_id ON test_runs(run_by_user_id);
