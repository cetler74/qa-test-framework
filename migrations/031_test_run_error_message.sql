-- Add error_message column to test_runs to surface run-level failures (e.g. missing JWKS keys)
ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS error_message TEXT;
