-- Progress message for running fuzz runs (streamed from CATS stdout)
ALTER TABLE fuzz_runs ADD COLUMN IF NOT EXISTS progress_message TEXT NULL;
