-- SOAP support: allow wsdl format in api_specs and store operations
ALTER TABLE api_specs DROP CONSTRAINT IF EXISTS api_specs_format_check;
ALTER TABLE api_specs ADD CONSTRAINT api_specs_format_check CHECK (format IN ('yaml', 'json', 'wsdl'));

CREATE TABLE IF NOT EXISTS soap_operations (
    id SERIAL PRIMARY KEY,
    api_spec_id INTEGER NOT NULL REFERENCES api_specs(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    operation_name VARCHAR(255) NOT NULL,
    request_template JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_soap_operations_api_spec_id ON soap_operations(api_spec_id);

-- Mark test_runs as api vs soap for unified list
ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS run_type VARCHAR(20) DEFAULT 'api';
