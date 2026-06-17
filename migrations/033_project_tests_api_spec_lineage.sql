-- Add API spec lineage and canonical operation matching metadata to project_tests

ALTER TABLE project_tests
  ADD COLUMN IF NOT EXISTS source_api_spec_id INTEGER REFERENCES api_specs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_api_spec_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS source_api_spec_original_filename VARCHAR(255),
  ADD COLUMN IF NOT EXISTS source_api_spec_status VARCHAR(32) NOT NULL DEFAULT 'current',
  ADD COLUMN IF NOT EXISTS source_api_operation_key VARCHAR(500),
  ADD COLUMN IF NOT EXISTS stale_reason VARCHAR(255),
  ADD COLUMN IF NOT EXISTS stale_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_project_tests_api_operation_key
  ON project_tests(project_id, source_api_operation_key);

CREATE INDEX IF NOT EXISTS idx_project_tests_api_spec_status
  ON project_tests(project_id, source_api_spec_status);
