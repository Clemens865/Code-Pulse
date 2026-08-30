// Retention enforcement: orgs.retention_days (default 365) finally does
// something. Runs from the background job loop; deletes event-grain rows
// older than the org's window. Derived aggregates keyed by day
// (file_activity) are pruned on the same horizon; sessions/insights follow
// the event log. Dead letters and audit rows keep a fixed longer window.

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

const AUDIT_RETENTION_DAYS = 730; // audit trail outlives event data
const DEAD_LETTER_RETENTION_DAYS = 90;

export async function enforceRetention(): Promise<number> {
  let total = 0;
  const orgs = await db.execute<{ id: string; retention_days: number }>(
    sql`SELECT id, retention_days FROM orgs WHERE retention_days > 0`,
  );
  for (const org of orgs as unknown as Array<{ id: string; retention_days: number }>) {
    const days = org.retention_days;
    const del = async (q: ReturnType<typeof sql>) => {
      const r = await db.execute(q);
      total += (r as unknown as { count?: number })?.count ?? 0;
    };
    await del(sql`DELETE FROM tool_events   WHERE org_id = ${org.id} AND ts          < NOW() - make_interval(days => ${days})`);
    await del(sql`DELETE FROM event_log     WHERE org_id = ${org.id} AND received_at < NOW() - make_interval(days => ${days})`);
    await del(sql`DELETE FROM insights      WHERE org_id = ${org.id} AND created_at  < NOW() - make_interval(days => ${days})`);
    await del(sql`DELETE FROM file_activity WHERE org_id = ${org.id} AND date        < (NOW() - make_interval(days => ${days}))::date`);
    await del(sql`DELETE FROM sessions      WHERE org_id = ${org.id} AND started_at  < NOW() - make_interval(days => ${days})
                    AND NOT EXISTS (SELECT 1 FROM tool_events te WHERE te.session_id = sessions.id)
                    AND NOT EXISTS (SELECT 1 FROM event_log  el WHERE el.session_id = sessions.id)
                    AND NOT EXISTS (SELECT 1 FROM insights   i  WHERE i.session_id  = sessions.id)
                    AND NOT EXISTS (SELECT 1 FROM sessions   c  WHERE c.parent_session_id = sessions.id)`);
  }
  const dl = await db.execute(
    sql`DELETE FROM dead_letter_events WHERE received_at < NOW() - make_interval(days => ${DEAD_LETTER_RETENTION_DAYS})`,
  );
  total += (dl as unknown as { count?: number })?.count ?? 0;
  const au = await db.execute(
    sql`DELETE FROM audit_log WHERE ts < NOW() - make_interval(days => ${AUDIT_RETENTION_DAYS})`,
  );
  total += (au as unknown as { count?: number })?.count ?? 0;
  if (total > 0) console.log(`[jobs] retention purged ${total} row(s)`);
  return total;
}
