-- Link individual result rows back to the project test catalogue for archive evidence

ALTER TABLE test_results
  ADD COLUMN IF NOT EXISTS project_test_id INTEGER REFERENCES project_tests(id) ON DELETE SET NULL;

ALTER TABLE playwright_results
  ADD COLUMN IF NOT EXISTS project_test_id INTEGER REFERENCES project_tests(id) ON DELETE SET NULL;

ALTER TABLE fuzz_results
  ADD COLUMN IF NOT EXISTS project_test_id INTEGER REFERENCES project_tests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_test_results_project_test_id
  ON test_results(project_test_id);

CREATE INDEX IF NOT EXISTS idx_playwright_results_project_test_id
  ON playwright_results(project_test_id);

CREATE INDEX IF NOT EXISTS idx_fuzz_results_project_test_id
  ON fuzz_results(project_test_id);