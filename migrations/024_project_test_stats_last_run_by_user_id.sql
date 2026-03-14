-- Store who last ran/set the test status (for manual updates or when not linked to a run)
ALTER TABLE project_test_stats
  ADD COLUMN IF NOT EXISTS last_run_by_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_test_stats_last_run_by_user_id ON project_test_stats(last_run_by_user_id);
