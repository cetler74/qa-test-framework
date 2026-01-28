-- Playwright / UI test runs (separate from API test_runs)
CREATE TABLE IF NOT EXISTS playwright_runs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL,
    base_url VARCHAR(500),
    total_tests INTEGER,
    passed_tests INTEGER,
    failed_tests INTEGER,
    duration_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Individual results for each Playwright run
CREATE TABLE IF NOT EXISTS playwright_results (
    id SERIAL PRIMARY KEY,
    playwright_run_id INTEGER NOT NULL REFERENCES playwright_runs(id) ON DELETE CASCADE,
    test_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL,
    duration_ms INTEGER,
    endpoint VARCHAR(500),
    error_message TEXT,
    assertions JSONB,
    execution_order INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_playwright_runs_created_at ON playwright_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_playwright_results_run_id ON playwright_results(playwright_run_id);
