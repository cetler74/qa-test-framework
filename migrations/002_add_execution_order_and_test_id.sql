-- Add execution_order and test_id columns to test_results table
-- This ensures tests are displayed in the same order they were executed

ALTER TABLE test_results 
ADD COLUMN IF NOT EXISTS execution_order INTEGER,
ADD COLUMN IF NOT EXISTS test_id VARCHAR(255);

-- Create index for faster sorting by execution order
CREATE INDEX IF NOT EXISTS idx_test_results_execution_order ON test_results(test_run_id, execution_order);
CREATE INDEX IF NOT EXISTS idx_test_results_test_id ON test_results(test_id);
