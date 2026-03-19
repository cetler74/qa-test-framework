-- Folder support for project tests catalogue (default from source + user override)
ALTER TABLE project_tests
  ADD COLUMN IF NOT EXISTS default_folder_path TEXT NULL,
  ADD COLUMN IF NOT EXISTS folder_path_override TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_project_tests_default_folder_path ON project_tests(project_id, default_folder_path);
CREATE INDEX IF NOT EXISTS idx_project_tests_folder_path_override ON project_tests(project_id, folder_path_override);
