-- Blocker lifecycle: a blocker stays open by being RE-ASSERTED, not by never
-- being resolved. Before this, resolution only happened via explicit
-- "RESOLVED:" claims — which never fired in practice — so open blockers
-- accumulated forever (3.6k open / 0 resolved on the reference install).
--
-- last_seen_at is bumped whenever a new BLOCKED line trigram-matches an
-- existing open blocker (instead of inserting a duplicate). A background job
-- auto-resolves open blockers not re-asserted within BLOCKER_STALE_DAYS.

ALTER TABLE insights ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
UPDATE insights SET last_seen_at = created_at WHERE last_seen_at IS NULL;

CREATE INDEX IF NOT EXISTS insights_open_blockers_idx
  ON insights (org_id, project_id, last_seen_at)
  WHERE type = 'blocker' AND resolved_at IS NULL;
