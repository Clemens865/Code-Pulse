-- Sessions form a tree: a sub-agent run (ruflo / Claude Agent SDK worktree)
-- is just a session with a parent_session_id pointing at the orchestrator.
-- Solo sessions stay parent_session_id = NULL. Self-FK with ON DELETE SET
-- NULL so deleting the orchestrator doesn't cascade away the children's
-- (otherwise valid) telemetry.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS parent_session_id uuid REFERENCES sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sessions_parent_idx
  ON sessions (parent_session_id)
  WHERE parent_session_id IS NOT NULL;
