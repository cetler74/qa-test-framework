ALTER TABLE project_test_notes
  ALTER COLUMN note DROP NOT NULL;

CREATE TABLE IF NOT EXISTS project_test_note_attachments (
    id SERIAL PRIMARY KEY,
    project_test_note_id INTEGER NOT NULL REFERENCES project_test_notes(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type VARCHAR(255) NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_project_test_note_attachments_note_id
  ON project_test_note_attachments(project_test_note_id);