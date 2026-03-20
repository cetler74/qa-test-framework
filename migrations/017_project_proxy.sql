-- Add proxy_name to projects (references key in config/proxies.json)
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS proxy_name VARCHAR(100) NULL;
