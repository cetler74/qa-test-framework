-- Flows: ordered task sequences per project
CREATE TABLE IF NOT EXISTS flows (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_flows_project_id ON flows(project_id);

-- Flow tasks: ordered steps (api or ui task refs)
CREATE TABLE IF NOT EXISTS flow_tasks (
    id SERIAL PRIMARY KEY,
    flow_id INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    task_type VARCHAR(20) NOT NULL CHECK (task_type IN ('api', 'ui')),
    task_ref JSONB NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_flow_tasks_flow_id ON flow_tasks(flow_id);
CREATE INDEX IF NOT EXISTS idx_flow_tasks_flow_position ON flow_tasks(flow_id, position);

-- Link test_runs and playwright_runs to flow (for "Trigger: Flow X" in Test Runs list)
ALTER TABLE test_runs
  ADD COLUMN IF NOT EXISTS flow_id INTEGER REFERENCES flows(id) ON DELETE SET NULL;

ALTER TABLE playwright_runs
  ADD COLUMN IF NOT EXISTS flow_id INTEGER REFERENCES flows(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_test_runs_flow_id ON test_runs(flow_id);
CREATE INDEX IF NOT EXISTS idx_playwright_runs_flow_id ON playwright_runs(flow_id);
