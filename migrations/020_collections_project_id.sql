-- Make collections project-specific: standalone collections belong to one project
ALTER TABLE collections
  ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_collections_project_id ON collections(project_id);

COMMENT ON COLUMN collections.project_id IS 'For standalone Postman collections: the project this collection belongs to. NULL for legacy or spec-derived collections.';
