-- Users and project access control
-- Database: use DB_NAME from .env (e.g. qa_testing)

-- 1. Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255),
    email VARCHAR(255),
    display_name VARCHAR(255),
    auth_source VARCHAR(50) NOT NULL CHECK (auth_source IN ('local', 'ad')),
    ad_dn TEXT,
    is_admin BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_auth_source ON users(auth_source);

-- 2. Alter projects: add owner and visibility
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS visibility VARCHAR(50) NOT NULL DEFAULT 'private';

-- Ensure constraint for visibility (may already exist from prior run)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_visibility_check'
  ) THEN
    ALTER TABLE projects ADD CONSTRAINT projects_visibility_check
      CHECK (visibility IN ('private', 'shared', 'public'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id);

-- 3. Project members (shared with)
CREATE TABLE IF NOT EXISTS project_members (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id);
