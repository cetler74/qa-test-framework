-- Add run owner tracking for recorded UI / Playwright runs
ALTER TABLE playwright_runs
  ADD COLUMN IF NOT EXISTS run_by_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_playwright_runs_run_by_user_id
  ON playwright_runs(run_by_user_id);
