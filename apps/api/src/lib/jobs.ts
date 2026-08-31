// Background jobs run in-process from the API server. Each job is a single
// async function called on an interval; errors are logged and the loop
// continues. This is intentionally simple — graduate to a proper queue (BullMQ
// / Temporal) only when the workload demands it.

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { env } from "../env.js";
import { scorePendingSessions } from "./stuck.js";
import { backfillQualityScores } from "./quality.js";
import { enforceRetention } from "./retention.js";

/**
 * Mark sessions as crashed when:
 *   - status='active' AND ended_at IS NULL
 *   - the latest tool_events.ts for that session is older than 2 hours
 *     (or, if no tool_events, started_at is older than 2 hours)
 *
 * Sets status='crashed', ended_at to the last observed event time, and
 * recomputes duration_seconds.
 *
 * Idempotent — re-running matches no rows once everything is reclaimed.
 */
export async function reclaimCrashedSessions(): Promise<number> {
  // Inline the cutoff via SQL `NOW() - INTERVAL '2 hours'` to avoid JS-side
  // Date parameter binding (which postgres-js doesn't infer cleanly through
  // drizzle's db.execute path).
  const r = await db.execute<{ id: string }>(sql`
    WITH last_event AS (
      SELECT s.id AS session_id,
             COALESCE(MAX(te.ts), s.started_at) AS last_ts
      FROM sessions s
      LEFT JOIN tool_events te ON te.session_id = s.id
      WHERE s.status = 'active' AND s.ended_at IS NULL
      GROUP BY s.id, s.started_at
    )
    UPDATE sessions s
       SET status = 'crashed',
           ended_at = le.last_ts,
           duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (le.last_ts - s.started_at))::int),
           updated_at = NOW()
      FROM last_event le
     WHERE s.id = le.session_id
       AND le.last_ts < NOW() - INTERVAL '2 hours'
    RETURNING s.id
  `);
  // postgres-js returns the rows array directly (or a wrapper with a `length`).
  const n = Array.isArray(r) ? r.length : ((r as { length?: number }).length ?? 0);
  if (n > 0) console.log(`[jobs] reclaimed ${n} crashed session(s)`);
  return n;
}

/**
 * Auto-resolve open blockers that nobody has re-asserted (or resolved) within
 * BLOCKER_STALE_DAYS. Blockers stay open by being repeated — a blocker no
 * session has mentioned in two weeks is not blocking anyone. Reversible via
 * the dashboard's reopen action.
 */
export async function expireStaleBlockers(): Promise<number> {
  const days = env.BLOCKER_STALE_DAYS;
  if (days <= 0) return 0;
  const r = await db.execute<{ id: string }>(sql`
    UPDATE insights
       SET resolved_at = NOW(),
           reasoning = COALESCE(reasoning, 'auto-resolved: not re-asserted for ' || ${days} || ' days')
     WHERE type = 'blocker'
       AND resolved_at IS NULL
       AND COALESCE(last_seen_at, created_at) < NOW() - make_interval(days => ${days})
    RETURNING id
  `);
  const n = (r as unknown as Array<{ id: string }>).length ?? 0;
  if (n > 0) console.log(`[jobs] expireStaleBlockers: auto-resolved ${n} stale blocker(s)`);
  return n;
}

let _started = false;
export function startBackgroundJobs(intervalMs: number = 30 * 60 * 1000): void {
  if (_started) return;
  _started = true;

  const run = async () => {
    try {
      await reclaimCrashedSessions();
    } catch (err) {
      console.error("[jobs] reclaimCrashedSessions failed:", err);
    }
    try {
      await scorePendingSessions();
    } catch (err) {
      console.error("[jobs] scorePendingSessions failed:", err);
    }
    try {
      await backfillQualityScores();
    } catch (err) {
      console.error("[jobs] backfillQualityScores failed:", err);
    }
    try {
      await enforceRetention();
    } catch (err) {
      console.error("[jobs] enforceRetention failed:", err);
    }
    try {
      await expireStaleBlockers();
    } catch (err) {
      console.error("[jobs] expireStaleBlockers failed:", err);
    }
  };

  // First run after a short delay so the API is warm; then every intervalMs.
  setTimeout(run, 30_000);
  setInterval(run, intervalMs);
  console.log(`[jobs] background loop started (interval=${Math.round(intervalMs / 1000)}s)`);
}
