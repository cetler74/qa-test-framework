-- Video, trace artifact paths and browser name for Playwright runs
ALTER TABLE playwright_runs ADD COLUMN IF NOT EXISTS video_path VARCHAR(512);
ALTER TABLE playwright_runs ADD COLUMN IF NOT EXISTS trace_path VARCHAR(512);
ALTER TABLE playwright_runs ADD COLUMN IF NOT EXISTS browser_name VARCHAR(50);
