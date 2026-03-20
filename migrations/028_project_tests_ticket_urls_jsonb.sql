-- Multiple ticket URLs per project test (Jira, etc.)
ALTER TABLE project_tests ADD COLUMN IF NOT EXISTS ticket_urls JSONB DEFAULT '[]'::jsonb;

UPDATE project_tests
SET ticket_urls = jsonb_build_array(ticket_url)
WHERE ticket_url IS NOT NULL AND trim(ticket_url) <> ''
  AND (ticket_urls IS NULL OR ticket_urls = '[]'::jsonb);

COMMENT ON COLUMN project_tests.ticket_urls IS 'Array of ticket/issue tracker URLs; ticket_url remains first entry for legacy consumers';
