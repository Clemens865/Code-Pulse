-- Stuck-score per session, computed by lib/stuck.ts from observed tool patterns.
-- 0–1 normalised. Signal breakdown stored in stuck_signals so the UI can show
-- "why" (e.g. "5 Bash failures + crashed").

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS stuck_score    NUMERIC(3,2) NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS stuck_signals  JSONB        NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS stuck_scored_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS sessions_org_stuck_idx
  ON sessions (org_id, stuck_score DESC)
  WHERE stuck_score >= 0.3;
