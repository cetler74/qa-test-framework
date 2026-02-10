-- Store screenshot path for failed UI test results (full-page screenshot at failure)
ALTER TABLE playwright_results ADD COLUMN IF NOT EXISTS screenshot_path VARCHAR(512) NULL;
