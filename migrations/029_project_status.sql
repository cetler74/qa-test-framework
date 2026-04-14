ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ongoing';

UPDATE projects
SET status = 'ongoing'
WHERE status IS NULL OR TRIM(status) = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_status_check'
  ) THEN
    ALTER TABLE projects ADD CONSTRAINT projects_status_check
      CHECK (status IN ('ongoing', 'closed'));
  END IF;
END $$;