-- Per-project master test catalogue and execution stats
-- project_tests: unified list of tests (API, SOAP, UI) per project
-- project_test_stats: aggregated execution statistics per catalogue entry
-- project_test_notes: free-form notes/comments per test

CREATE TABLE IF NOT EXISTS project_tests (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    test_type VARCHAR(32) NOT NULL,
    source_id INTEGER,
    source_kind VARCHAR(64),
    stable_key VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    endpoint VARCHAR(500),
    method VARCHAR(32),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (project_id, stable_key)
);

CREATE INDEX IF NOT EXISTS idx_project_tests_project_id ON project_tests(project_id);
CREATE INDEX IF NOT EXISTS idx_project_tests_type ON project_tests(test_type);

CREATE TABLE IF NOT EXISTS project_test_stats (
    id SERIAL PRIMARY KEY,
    project_test_id INTEGER NOT NULL REFERENCES project_tests(id) ON DELETE CASCADE,
    total_runs INTEGER NOT NULL DEFAULT 0,
    last_status VARCHAR(32) NOT NULL DEFAULT 'not_run',
    last_run_at TIMESTAMP,
    last_run_source VARCHAR(32),
    last_run_type VARCHAR(32),
    last_run_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_project_test_stats_project_test_id ON project_test_stats(project_test_id);
CREATE INDEX IF NOT EXISTS idx_project_test_stats_last_status ON project_test_stats(last_status);

CREATE TABLE IF NOT EXISTS project_test_notes (
    id SERIAL PRIMARY KEY,
    project_test_id INTEGER NOT NULL REFERENCES project_tests(id) ON DELETE CASCADE,
    author_id INTEGER,
    note TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_project_test_notes_project_test_id ON project_test_notes(project_test_id);

