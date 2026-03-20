-- Add ticket_url field to project_tests for linking external tickets (e.g., Jira)

ALTER TABLE project_tests
ADD COLUMN IF NOT EXISTS ticket_url VARCHAR(500);

