-- Preserve exact uploaded Postman collection file for true-original downloads
ALTER TABLE collections
  ADD COLUMN IF NOT EXISTS original_file_content TEXT NULL,
  ADD COLUMN IF NOT EXISTS original_file_name VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS original_is_exact BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_collections_original_is_exact ON collections(original_is_exact);
