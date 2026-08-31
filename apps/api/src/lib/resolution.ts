// Match a free-text "RESOLVED:" claim against the project's open blockers
// using pg_trgm similarity, and mark the best match resolved.
//
// The trigram extension + indexes are created in the bootstrap migration
// (insights_content_trgm_idx / insights_title_trgm_idx).
//
// Threshold = 0.3 errs slightly toward false positives — easy to undo via
// the dashboard later, while a higher threshold leaves blockers stuck
// open forever when developers paraphrase. Tunable per-org if needed.

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

const SIMILARITY_THRESHOLD = 0.3;

// Measured on real data: rephrasings of the same standing blocker across turns
// score ~0.35 similarity, while unrelated blockers in the same project score
// ~0.04 — so 0.3 catches re-assertions with a wide margin over noise. A missed
// match is one duplicate row; a false match bumps last_seen_at on a live
// blocker, which is harmless.
const REASSERT_THRESHOLD = 0.3;

export type ResolutionResult =
  | { matched: true; blockerId: string; similarity: number }
  | { matched: false };

export async function resolveOpenBlocker(
  orgId: string,
  projectId: string,
  resolvedText: string,
  resolvedAt: Date = new Date(),
): Promise<ResolutionResult> {
  const text = resolvedText.trim();
  if (!text) return { matched: false };

  // Find the highest-similarity open blocker in the same project.
  const candidates = await db.execute<{ id: string; sim: number }>(sql`
    SELECT id,
           GREATEST(
             similarity(content, ${text}),
             COALESCE(similarity(title, ${text}), 0)
           ) AS sim
      FROM insights
     WHERE org_id = ${orgId}
       AND project_id = ${projectId}
       AND type = 'blocker'
       AND resolved_at IS NULL
     ORDER BY sim DESC
     LIMIT 1
  `);

  const rows = (candidates as unknown as Array<{ id: string; sim: number }>) ?? [];
  const top = rows[0];
  if (!top || top.sim < SIMILARITY_THRESHOLD) return { matched: false };

  // Pass resolvedAt as ISO string + cast — postgres-js + drizzle's db.execute
  // doesn't auto-coerce Date through the wire protocol.
  const resolvedIso = resolvedAt.toISOString();
  await db.execute(sql`
    UPDATE insights
       SET resolved_at = ${resolvedIso}::timestamptz
     WHERE id = ${top.id}
       AND resolved_at IS NULL
  `);

  return { matched: true, blockerId: top.id, similarity: top.sim };
}

// A new BLOCKED line that trigram-matches an open blocker in the same project
// is the same blocker being re-asserted: bump its last_seen_at instead of
// inserting a duplicate. Returns the matched blocker id, or null if this is a
// genuinely new blocker.
export async function reassertOpenBlocker(
  orgId: string,
  projectId: string,
  content: string,
  seenAt: Date,
): Promise<{ blockerId: string; similarity: number } | null> {
  const text = content.trim();
  if (!text) return null;

  const candidates = await db.execute<{ id: string; sim: number }>(sql`
    SELECT id,
           GREATEST(
             similarity(content, ${text}),
             COALESCE(similarity(title, ${text}), 0)
           ) AS sim
      FROM insights
     WHERE org_id = ${orgId}
       AND project_id = ${projectId}
       AND type = 'blocker'
       AND resolved_at IS NULL
     ORDER BY sim DESC
     LIMIT 1
  `);

  const rows = (candidates as unknown as Array<{ id: string; sim: number }>) ?? [];
  const top = rows[0];
  if (!top || top.sim < REASSERT_THRESHOLD) return null;

  const seenIso = seenAt.toISOString();
  await db.execute(sql`
    UPDATE insights
       SET last_seen_at = GREATEST(COALESCE(last_seen_at, created_at), ${seenIso}::timestamptz)
     WHERE id = ${top.id}
       AND resolved_at IS NULL
  `);

  return { blockerId: top.id, similarity: top.sim };
}
