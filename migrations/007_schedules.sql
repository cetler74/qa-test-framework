-- Schedules: cron or repeat interval for running a project or a flow
CREATE TABLE IF NOT EXISTS schedules (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    flow_id INTEGER REFERENCES flows(id) ON DELETE CASCADE,
    cron_expression VARCHAR(100),
    repeat_interval_minutes INTEGER,
    enabled BOOLEAN DEFAULT true,
    last_run_at TIMESTAMP,
    next_run_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT schedules_cron_or_repeat CHECK (
        (cron_expression IS NOT NULL AND cron_expression <> '') OR
        (repeat_interval_minutes IS NOT NULL AND repeat_interval_minutes > 0)
    )
);

CREATE INDEX IF NOT EXISTS idx_schedules_project_id ON schedules(project_id);
CREATE INDEX IF NOT EXISTS idx_schedules_flow_id ON schedules(flow_id);
CREATE INDEX IF NOT EXISTS idx_schedules_enabled_next ON schedules(enabled) WHERE enabled = true;
