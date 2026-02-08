-- Per-result video and trace paths for Playwright results (so each recorded test can have its own artifacts)
ALTER TABLE playwright_results ADD COLUMN IF NOT EXISTS video_path VARCHAR(512);
ALTER TABLE playwright_results ADD COLUMN IF NOT EXISTS trace_path VARCHAR(512);
