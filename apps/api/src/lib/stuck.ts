// Stuck-score computer per CAPTURE-LAYER.md §6.1.
//
// Observed signals → 0–1 normalised score. Goal: surface developers
// who appeared to struggle without forcing them to type a BLOCKED line.
//
// Signal weights (sum capped to 1.0):
//   bash_failures           +0.10 each, max +0.30
//   repeated_searches       +0.20 each repetition, max +0.40
//   web_help_density        +0.075 each, max +0.30  (WebFetch / WebSearch)
//   idle_minutes (per 10)   +0.10 each 10-min block, max +0.30
//   no_progress_at_end      +0.50  (session ended, zero PROGRESS insights)
//   crashed                 +1.00  (status='crashed' or StopFailure)

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

export type StuckSignals = {
  bash_failures: number;
  repeated_searches: number;
  web_help_density: number;
  idle_minutes: number;
  no_progress_at_end: boolean;
  crashed: boolean;
};

export function scoreFromSignals(s: StuckSignals): number {
  const score =
    Math.min(0.3, s.bash_failures * 0.1) +
    Math.min(0.4, s.repeated_searches * 0.2) +
    Math.min(0.3, s.web_help_density * 0.075) +
    Math.min(0.3, Math.floor(s.idle_minutes / 10) * 0.1) +
    (s.no_progress_at_end ? 0.5 : 0) +
    (s.crashed ? 1.0 : 0);
  return Math.min(1, Math.round(score * 100) / 100);
}

type SessionRow = { id: string; status: string };

/**
 * Compute the stuck score for a single session and write it to the row.
 * Returns the {score, signals} that were stored.
 */
export async function computeStuckScoreForSession(
  sessionId: string,
): Promise<{ score: number; signals: StuckSignals } | null> {
  // 1. Pull the session
  const sessionRows = (await db.execute<SessionRow>(sql`
    SELECT id, status FROM sessions WHERE id = ${sessionId} LIMIT 1
  `)) as unknown as SessionRow[];
  const session = sessionRows[0];
  if (!session) return null;

  // 2. Count bash failures
  const bashFailRows = (await db.execute<{ n: string }>(sql`
    SELECT COUNT(*)::text AS n
      FROM tool_events
     WHERE session_id = ${sessionId}
       AND tool_name = 'Bash'
       AND command_failed = TRUE
  `)) as unknown as Array<{ n: string }>;
  const bashFailures = parseInt(bashFailRows[0]?.n ?? "0", 10);

  // 3. Repeated Grep / Glob patterns: count of (pattern, count) where count >= 2,
  //    summed as (count - 1) per pattern (so a 3× repetition contributes 2).
  const searchRows = (await db.execute<{ pattern: string; n: string }>(sql`
    SELECT search_pattern AS pattern, COUNT(*)::text AS n
      FROM tool_events
     WHERE session_id = ${sessionId}
       AND tool_name IN ('Grep', 'Glob')
       AND search_pattern IS NOT NULL
     GROUP BY search_pattern
    HAVING COUNT(*) >= 2
  `)) as unknown as Array<{ pattern: string; n: string }>;
  const repeatedSearches = searchRows.reduce(
    (acc, r) => acc + (parseInt(r.n, 10) - 1),
    0,
  );

  // 4. Web help density
  const webRows = (await db.execute<{ n: string }>(sql`
    SELECT COUNT(*)::text AS n
      FROM tool_events
     WHERE session_id = ${sessionId}
       AND tool_name IN ('WebFetch', 'WebSearch')
  `)) as unknown as Array<{ n: string }>;
  const webHelpDensity = parseInt(webRows[0]?.n ?? "0", 10);

  // 5. Idle time: sum of gaps > 5 min between consecutive tool_events
  const idleRows = (await db.execute<{ idle_min: string }>(sql`
    WITH gaps AS (
      SELECT EXTRACT(EPOCH FROM (ts - LAG(ts) OVER (ORDER BY ts))) / 60.0 AS gap_min
        FROM tool_events
       WHERE session_id = ${sessionId}
    )
    SELECT COALESCE(SUM(gap_min) FILTER (WHERE gap_min > 5), 0)::text AS idle_min
      FROM gaps
  `)) as unknown as Array<{ idle_min: string }>;
  const idleMinutes = Math.round(parseFloat(idleRows[0]?.idle_min ?? "0"));

  // 6. No-progress-at-end: session has 0 progress insights AND session ended
  const progressRows = (await db.execute<{ n: string }>(sql`
    SELECT COUNT(*)::text AS n
      FROM insights
     WHERE session_id = ${sessionId} AND type = 'progress'
  `)) as unknown as Array<{ n: string }>;
  const progressCount = parseInt(progressRows[0]?.n ?? "0", 10);
  const noProgressAtEnd = progressCount === 0 && session.status !== "active";

  // 7. Crashed
  const crashed = session.status === "crashed";

  const signals: StuckSignals = {
    bash_failures: bashFailures,
    repeated_searches: repeatedSearches,
    web_help_density: webHelpDensity,
    idle_minutes: idleMinutes,
    no_progress_at_end: noProgressAtEnd,
    crashed,
  };
  const score = scoreFromSignals(signals);

  await db.execute(sql`
    UPDATE sessions
       SET stuck_score = ${score.toFixed(2)},
           stuck_signals = ${JSON.stringify(signals)}::jsonb,
           stuck_scored_at = NOW()
     WHERE id = ${sessionId}
  `);

  return { score, signals };
}

/**
 * Score every recently-ended session that hasn't been scored yet (or whose
 * score is older than the session's last activity). Caps work to keep job
 * latency bounded.
 */
export async function scorePendingSessions(maxPerTick = 100): Promise<number> {
  const rows = (await db.execute<{ id: string }>(sql`
    SELECT s.id
      FROM sessions s
     WHERE s.status IN ('completed', 'crashed')
       AND s.ended_at > NOW() - INTERVAL '30 days'
       AND (s.stuck_scored_at IS NULL OR s.stuck_scored_at < s.updated_at)
     ORDER BY s.ended_at DESC
     LIMIT ${maxPerTick}
  `)) as unknown as Array<{ id: string }>;

  let n = 0;
  for (const r of rows) {
    const result = await computeStuckScoreForSession(r.id);
    if (result) n++;
  }
  if (n > 0) console.log(`[jobs] scored stuck for ${n} session(s)`);
  return n;
}
