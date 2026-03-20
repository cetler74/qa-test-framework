-- Preserve collection traversal order for project tests catalogue rendering
ALTER TABLE project_tests
  ADD COLUMN IF NOT EXISTS source_order INTEGER NULL,
  ADD COLUMN IF NOT EXISTS source_path TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_project_tests_source_order ON project_tests(project_id, source_order);
