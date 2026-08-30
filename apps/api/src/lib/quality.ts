// Insight quality score per CAPTURE-LAYER.md §7.
//
// 0–1 normalised. Each component is bounded so a content-only insight tops
// out around 0.4 — full credit requires WHY + file refs + specificity.
//
//   length           up to 0.30   (>= 200 chars maxes)
//   has_why          0.30         (reasoning column OR "because"/"so that"/"to" verb in content)
//   has_file_ref     0.20         (looks like a file path or extension token)
//   has_specifics    0.20         (≥ 2 backticked spans OR ≥ 2 camelCase identifiers)
//
// Tuneable later. The point is to give the SessionStart context payload
// something to rank by other than recency.

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

const FILE_REF_RE =
  /\b[\w./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|rb|java|kt|cs|cpp|c|h|md|json|yaml|yml|html|css|scss|sql|sh|toml|graphql|proto)\b/i;
const CAMEL_RE = /\b[a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)+\b/g;
const BACKTICK_RE = /`[^`]+`/g;
const WHY_HINTS = [/\bbecause\b/i, /\bso that\b/i, /\bin order to\b/i, /\bto avoid\b/i, /\bto enable\b/i];

export type QualityInputs = {
  content: string;
  reasoning: string | null;
};

export function scoreInsight({ content, reasoning }: QualityInputs): number {
  const c = content ?? "";
  const r = reasoning ?? "";

  // 1. Length
  const lengthScore = Math.min(0.3, (c.length / 200) * 0.3);

  // 2. Has WHY
  const hasReasoning = r.trim().length > 10;
  const hasWhyHint = WHY_HINTS.some((re) => re.test(c));
  const hasWhy = hasReasoning || hasWhyHint ? 0.3 : 0;

  // 3. File reference
  const hasFileRef = FILE_REF_RE.test(c) ? 0.2 : 0;

  // 4. Specifics — backticked spans or camelCase identifiers
  const backtickCount = (c.match(BACKTICK_RE) ?? []).length;
  const camelCount = (c.match(CAMEL_RE) ?? []).length;
  const specifics = backtickCount >= 2 || camelCount >= 2 ? 0.2 : backtickCount === 1 || camelCount === 1 ? 0.1 : 0;

  return Math.min(1, Math.round((lengthScore + hasWhy + hasFileRef + specifics) * 100) / 100);
}

/**
 * One-shot backfill: score all insights whose quality_score is at the default
 * 0.50 (untouched since the migration). Caps to maxRows to keep migration
 * latency bounded — re-run until 0.
 */
export async function backfillQualityScores(maxRows = 1000): Promise<number> {
  const rows = (await db.execute<{ id: string; content: string; reasoning: string | null }>(sql`
    SELECT id, content, reasoning
      FROM insights
     WHERE quality_score = 0.50
     LIMIT ${maxRows}
  `)) as unknown as Array<{ id: string; content: string; reasoning: string | null }>;

  let n = 0;
  for (const r of rows) {
    const score = scoreInsight({ content: r.content, reasoning: r.reasoning });
    await db.execute(sql`
      UPDATE insights SET quality_score = ${score.toFixed(2)} WHERE id = ${r.id}
    `);
    n++;
  }
  if (n > 0) console.log(`[quality] backfilled ${n} insight(s)`);
  return n;
}
