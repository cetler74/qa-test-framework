-- Project-scoped UI tests (Option B: global recorded tests + project selection)
-- 1. Add project_id to playwright_runs (nullable for existing rows)
ALTER TABLE playwright_runs
  ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_playwright_runs_project_id ON playwright_runs(project_id);

-- 2. Junction table: which recorded tests are linked to which project (like project_api_specs)
CREATE TABLE IF NOT EXISTS project_recorded_tests (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    recorded_test_id INTEGER NOT NULL REFERENCES playwright_recorded_tests(id) ON DELETE CASCADE,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, recorded_test_id)
);

CREATE INDEX IF NOT EXISTS idx_project_recorded_tests_project_id ON project_recorded_tests(project_id);
CREATE INDEX IF NOT EXISTS idx_project_recorded_tests_recorded_test_id ON project_recorded_tests(recorded_test_id);
