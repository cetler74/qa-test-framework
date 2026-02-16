-- Add suspended flag to users (suspended users cannot log in)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS suspended BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_users_suspended ON users(suspended);
