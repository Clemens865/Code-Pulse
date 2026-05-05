-- Insight quality score per CAPTURE-LAYER.md §7. Used for ranking in
-- the SessionStart context payload, the dashboard's "Top insights"
-- view, and as the rank input for cross-session derivatives.
--
-- 0–1 normalised. Computed by lib/quality.ts at insert time and via
-- a one-shot backfill of existing rows.

ALTER TABLE insights ADD COLUMN IF NOT EXISTS quality_score NUMERIC(3,2) NOT NULL DEFAULT 0.50;

CREATE INDEX IF NOT EXISTS insights_org_quality_idx
  ON insights (org_id, quality_score DESC, created_at DESC)
  WHERE quality_score >= 0.5;
