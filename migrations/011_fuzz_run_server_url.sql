-- Store server URL (Base URL) used for the fuzz run so reports can show full request URLs
ALTER TABLE fuzz_runs ADD COLUMN IF NOT EXISTS server_url VARCHAR(500) NULL;
