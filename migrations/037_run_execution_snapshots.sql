-- Persist replayable run settings and exact catalogue membership for quick reruns and safe deletion.
ALTER TABLE test_runs
  ADD COLUMN IF NOT EXISTS execution_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS execution_snapshot_version INTEGER,
  ADD COLUMN IF NOT EXISTS rerun_lineage_id UUID,
  ADD COLUMN IF NOT EXISTS rerun_number INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rerun_base_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS rerun_source_id INTEGER;

ALTER TABLE playwright_runs
  ADD COLUMN IF NOT EXISTS execution_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS execution_snapshot_version INTEGER,
  ADD COLUMN IF NOT EXISTS rerun_lineage_id UUID,
  ADD COLUMN IF NOT EXISTS rerun_number INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rerun_base_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS rerun_source_id INTEGER;

ALTER TABLE fuzz_runs
  ADD COLUMN IF NOT EXISTS execution_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS execution_snapshot_version INTEGER,
  ADD COLUMN IF NOT EXISTS rerun_lineage_id UUID,
  ADD COLUMN IF NOT EXISTS rerun_number INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rerun_base_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS rerun_source_id INTEGER;

ALTER TABLE test_runs DROP CONSTRAINT IF EXISTS test_runs_rerun_number_nonnegative;
ALTER TABLE test_runs ADD CONSTRAINT test_runs_rerun_number_nonnegative CHECK (rerun_number >= 0);
ALTER TABLE playwright_runs DROP CONSTRAINT IF EXISTS playwright_runs_rerun_number_nonnegative;
ALTER TABLE playwright_runs ADD CONSTRAINT playwright_runs_rerun_number_nonnegative CHECK (rerun_number >= 0);
ALTER TABLE fuzz_runs DROP CONSTRAINT IF EXISTS fuzz_runs_rerun_number_nonnegative;
ALTER TABLE fuzz_runs ADD CONSTRAINT fuzz_runs_rerun_number_nonnegative CHECK (rerun_number >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS test_runs_rerun_lineage_number_uq
  ON test_runs (rerun_lineage_id, rerun_number)
  WHERE rerun_lineage_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS playwright_runs_rerun_lineage_number_uq
  ON playwright_runs (rerun_lineage_id, rerun_number)
  WHERE rerun_lineage_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fuzz_runs_rerun_lineage_number_uq
  ON fuzz_runs (rerun_lineage_id, rerun_number)
  WHERE rerun_lineage_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS run_catalogue_memberships (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_type VARCHAR(20) NOT NULL CHECK (run_type IN ('api', 'soap', 'ui', 'fuzz')),
  run_id INTEGER NOT NULL,
  project_test_id INTEGER REFERENCES project_tests(id) ON DELETE SET NULL,
  association_status VARCHAR(30) NOT NULL DEFAULT 'exact'
    CHECK (association_status IN ('exact', 'unresolved', 'not_applicable')),
  execution_order INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (run_type, run_id, project_test_id, execution_order)
);

CREATE INDEX IF NOT EXISTS run_catalogue_memberships_run_idx
  ON run_catalogue_memberships (run_type, run_id);
CREATE INDEX IF NOT EXISTS run_catalogue_memberships_project_test_idx
  ON run_catalogue_memberships (project_test_id)
  WHERE project_test_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS run_catalogue_memberships_project_idx
  ON run_catalogue_memberships (project_id);