-- Fuzz runs and results for REST API fuzzing (CATS)
CREATE TABLE IF NOT EXISTS fuzz_runs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    api_spec_id INTEGER NOT NULL REFERENCES api_specs(id),
    flow_id INTEGER NULL REFERENCES flows(id),
    total_tests INTEGER NULL,
    passed_tests INTEGER NULL,
    failed_tests INTEGER NULL,
    duration_ms INTEGER NULL,
    report_path VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fuzz_results (
    id SERIAL PRIMARY KEY,
    fuzz_run_id INTEGER NOT NULL REFERENCES fuzz_runs(id) ON DELETE CASCADE,
    test_name VARCHAR(500) NOT NULL,
    endpoint VARCHAR(500) NULL,
    method VARCHAR(10) NULL,
    status VARCHAR(50) NOT NULL,
    duration_ms INTEGER NULL,
    request_body TEXT NULL,
    response_body TEXT NULL,
    response_code INTEGER NULL,
    fuzzer_name VARCHAR(255) NULL,
    error_message TEXT NULL,
    execution_order INTEGER NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fuzz_runs_project_id ON fuzz_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_fuzz_runs_created_at ON fuzz_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_fuzz_runs_flow_id ON fuzz_runs(flow_id);
CREATE INDEX IF NOT EXISTS idx_fuzz_results_fuzz_run_id ON fuzz_results(fuzz_run_id);
