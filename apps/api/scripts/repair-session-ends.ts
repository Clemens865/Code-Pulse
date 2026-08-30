// One-shot repair: sessions closed too early by the old Stop → session.end
// mapping (first-end-wins closed every multi-turn session after its first
// reply). For each ended session whose event_log shows activity after
// ended_at, move ended_at to the last event and recompute duration.
//
// sessions is a derived projection — event_log stays canonical — so this is
// safe to re-run; a session already at its last event is untouched.
//
//   cd apps/api && npm run repair:session-ends

import { sql } from "drizzle-orm";
import { db } from "../src/db/index.js";

async function main() {
  const res = await db.execute(sql`
    WITH last_ev AS (
      SELECT session_id, max(hook_ts) AS last_ts
      FROM event_log
      WHERE session_id IS NOT NULL
      GROUP BY session_id
    )
    UPDATE sessions s
    SET ended_at = GREATEST(s.ended_at, l.last_ts),
        duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (GREATEST(s.ended_at, l.last_ts) - s.started_at))::int),
        updated_at = now()
    FROM last_ev l
    WHERE l.session_id = s.id
      AND s.ended_at IS NOT NULL
      AND l.last_ts > s.ended_at
  `);
  const repaired = (res as unknown as { count?: number })?.count ?? 0;
  console.log(`[repair] moved ended_at forward on ${repaired} session(s)`);

  const rows = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM tool_events te
    JOIN sessions s ON s.id = te.session_id
    WHERE s.ended_at IS NOT NULL
      AND te.ts > s.ended_at + interval '60 seconds'
  `);
  const remaining = (rows as unknown as Array<{ n: number }>)[0]?.n ?? -1;
  console.log(`[repair] tool_events still after ended_at+60s: ${remaining}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[repair] failed:", e);
  process.exit(1);
});
