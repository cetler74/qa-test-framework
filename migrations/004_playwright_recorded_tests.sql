-- Recorded UI tests (Codegen paste-and-save)
CREATE TABLE IF NOT EXISTS playwright_recorded_tests (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    spec_content TEXT NOT NULL,
    base_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_playwright_recorded_tests_created_at ON playwright_recorded_tests(created_at);
