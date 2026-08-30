-- Add token-usage columns to sessions.
-- Captured at session.end from Claude Code's Stop hook payload.usage.
-- Default 0 so existing rows aren't NULL.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS input_tokens                 BIGINT NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS output_tokens                BIGINT NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cache_creation_input_tokens  BIGINT NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cache_read_input_tokens      BIGINT NOT NULL DEFAULT 0;

-- Index for "expensive sessions" queries (sort by total input + output).
CREATE INDEX IF NOT EXISTS sessions_org_total_tokens_idx
  ON sessions (org_id, ((input_tokens + output_tokens)) DESC);
