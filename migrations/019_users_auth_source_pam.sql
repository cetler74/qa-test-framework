-- Allow auth_source 'pam' for OS user login
-- Constraint name may be users_auth_source_check (inline CHECK in 015)

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_auth_source_check;
ALTER TABLE users ADD CONSTRAINT users_auth_source_check CHECK (auth_source IN ('local', 'ad', 'pam'));
