-- Store structured API request/response header evidence for test result tracing.
ALTER TABLE test_results
  ADD COLUMN IF NOT EXISTS request_headers_sent JSONB,
  ADD COLUMN IF NOT EXISTS response_headers_received JSONB,
  ADD COLUMN IF NOT EXISTS request_meta JSONB,
  ADD COLUMN IF NOT EXISTS response_meta JSONB,
  ADD COLUMN IF NOT EXISTS trace_evidence JSONB,
  ADD COLUMN IF NOT EXISTS trace_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS npu_id VARCHAR(255);
