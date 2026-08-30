// One-off backfill: re-derive denormalized tables (sessions / tool_events /
// insights / file_activity) from event_log, the immutable source of truth.
//
// Why: when session.start was lost (API down at session start, hook restart,
// out-of-order sync), tool/insight events failed their session_id FK and were
// dead-lettered, freezing the dashboard. derive.ts now self-heals with a
// session stub; this replays the backlog through that fixed path.
//
// Safe to re-run: deriveEvent uses onConflictDoNothing / guarded updates, so
// replaying already-derived rows is a no-op.
//
// Usage: from apps/api, with env loaded:
//   set -a && . ./.env && set +a && npx tsx scripts/backfill-derive.ts

import { asc } from "drizzle-orm";
import { db, schema } from "../src/db/index.js";
import { deriveEvent } from "../src/lib/derive.js";

async function main() {
  console.log("[backfill] loading event_log in hook_ts order…");
  // Replay in chronological order so session.start (when present) creates the
  // row before its children; the stub upsert covers the cases where it's absent.
  const rows = await db
    .select({
      id: schema.eventLog.id,
      orgId: schema.eventLog.orgId,
      memberId: schema.eventLog.memberId,
      projectId: schema.eventLog.projectId,
      sessionId: schema.eventLog.sessionId,
      eventKind: schema.eventLog.eventKind,
      payload: schema.eventLog.payload,
      clientMeta: schema.eventLog.clientMeta,
      hookTs: schema.eventLog.hookTs,
    })
    .from(schema.eventLog)
    .orderBy(asc(schema.eventLog.hookTs));

  console.log(`[backfill] ${rows.length} event_log rows to replay`);

  let done = 0;
  for (const r of rows) {
    await deriveEvent({
      id: r.id,
      orgId: r.orgId,
      memberId: r.memberId,
      projectId: r.projectId,
      sessionId: r.sessionId ?? null,
      eventKind: r.eventKind,
      payload: (r.payload ?? {}) as Record<string, unknown>,
      clientMeta: (r.clientMeta ?? {}) as Record<string, unknown>,
      hookTs: r.hookTs,
    });
    done++;
    if (done % 2000 === 0) console.log(`[backfill] ${done}/${rows.length}`);
  }

  console.log(`[backfill] replayed ${done} events. done.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill] failed:", err);
  process.exit(1);
});
