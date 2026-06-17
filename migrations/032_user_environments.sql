-- User-scoped environments: stored per user, reusable across all projects.
-- Variables are stored as a flat JSONB object (key→value pairs, no nesting).

CREATE TABLE IF NOT EXISTS user_environments (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    variables   JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_user_environments_user_id ON user_environments(user_id);
