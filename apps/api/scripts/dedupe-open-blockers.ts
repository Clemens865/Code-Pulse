// One-shot maintenance: collapse near-duplicate OPEN blockers that piled up
// before re-assertion dedup existed (derive now bumps last_seen_at instead of
// inserting a duplicate). Keeps the newest of each similarity cluster per
// project and resolves the older ones. Idempotent — a second run matches
// nothing new. Run: node --env-file=.env --import tsx scripts/dedupe-open-blockers.ts
//
// Uses the same 0.3 trigram threshold as reassertOpenBlocker (see
// src/lib/resolution.ts for the measured rationale).

import { sql } from "drizzle-orm";
import { db } from "../src/db/index.js";

async function main() {
  const r = await db.execute<{ id: string }>(sql`
    WITH open AS (
      SELECT id, org_id, project_id, content, created_at FROM insights
      WHERE type = 'blocker' AND resolved_at IS NULL
    ), dupes AS (
      SELECT DISTINCT a.id
      FROM open a JOIN open b
        ON a.org_id = b.org_id AND a.project_id = b.project_id AND a.id <> b.id
       AND similarity(a.content, b.content) >= 0.3
       AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.id < b.id))
    )
    UPDATE insights
       SET resolved_at = NOW(),
           reasoning = COALESCE(reasoning, 'auto-resolved: superseded by a newer re-assertion of the same blocker')
     WHERE id IN (SELECT id FROM dupes)
    RETURNING id
  `);
  const n = (r as unknown as Array<{ id: string }>).length ?? 0;
  console.log(`dedupe-open-blockers: resolved ${n} superseded duplicate(s)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
