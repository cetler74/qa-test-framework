ALTER TABLE playwright_recorded_tests
    ADD COLUMN IF NOT EXISTS label VARCHAR(120);

CREATE INDEX IF NOT EXISTS idx_playwright_recorded_tests_label
    ON playwright_recorded_tests(label);
