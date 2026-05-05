// Pattern auto-suggest per CAPTURE-LAYER.md §9 Sprint 8.
//
// Server-side: take a session's tool_events + insights, ask Claude to
// extract reusable patterns or recurring fixes, return a list of
// suggestions the developer can opt-in to save as `pattern` / `fix`
// insights.
//
// Feature-flagged on env.ANTHROPIC_API_KEY. When unset, every call
// returns { suggestions: [] } — no failure, no spend, no surprise.
// Production deploys set the key; dev environments don't have to.
//
// Cost analysis (per CAPTURE-LAYER §10 question #5):
//   Claude Haiku 4.5 input  ~$1/MT, output ~$5/MT
//   Per session: ~2k input tokens (events + insights summary) +
//                ~200 output tokens (suggestions)
//   Per session: ~$0.003
//   At 30 sessions/dev/week × 4 weeks = 120/dev/mo → ~$0.40/dev/mo
//   For a 10-dev team: ~$4/mo
//   At Studio pricing ($25/seat) that's <2% of revenue.

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { env } from "../env.js";

export type PatternSuggestion = {
  type: "pattern" | "fix";
  title: string;
  content: string;
  reasoning?: string;
  confidence: number; // 0–1
};

const SYSTEM_PROMPT = `You analyse a single Claude Code session and surface up to 3 *reusable* patterns or fixes worth saving to the team's knowledge base.

You ONLY suggest something if it is genuinely reusable — a recurring approach, a non-obvious fix, or a constraint that future sessions in this repo should know about. If the session was routine work, return an empty list.

For each suggestion, output:
- type: "pattern" (reusable approach) or "fix" (recurring bug solved)
- title: ≤ 80 chars, headline form
- content: 1–2 sentences explaining what and how
- reasoning: 1 sentence explaining why this generalises
- confidence: 0.0–1.0 — how sure you are this is reusable, not session-specific

Respond ONLY with JSON of shape: {"suggestions": [...]}. No prose.`;

export async function suggestPatternsForSession(sessionId: string): Promise<PatternSuggestion[]> {
  if (!env.ANTHROPIC_API_KEY) {
    // Feature flag off — no spend, no failure. Returns empty.
    return [];
  }

  // 1. Pull a compact session summary the model can read in ~2k tokens.
  const summary = await loadSessionSummary(sessionId);
  if (!summary) return [];

  // 2. Call Claude. Using fetch directly to avoid pulling in the SDK as a
  //    hard dep — keeps the api/ tree light.
  let completion: { content: Array<{ type: string; text?: string }> };
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL,
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: summary }],
      }),
    });
    if (!resp.ok) {
      console.error("[patterns] Claude API non-200:", resp.status);
      return [];
    }
    completion = (await resp.json()) as typeof completion;
  } catch (err) {
    console.error("[patterns] Claude API error:", err);
    return [];
  }

  // 3. Parse JSON response.
  const text = completion.content?.[0]?.text ?? "";
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleaned) as { suggestions?: PatternSuggestion[] };
    return Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  } catch {
    console.error("[patterns] failed to parse suggestion JSON");
    return [];
  }
}

async function loadSessionSummary(sessionId: string): Promise<string | null> {
  // Compact: tool counts + file paths + first ~5 insights with content.
  const sessionRow = (await db.execute<{
    project_name: string | null;
    started_at: string;
    duration_seconds: number | null;
  }>(sql`
    SELECT p.name AS project_name,
           s.started_at::text AS started_at,
           s.duration_seconds
      FROM sessions s
      LEFT JOIN projects p ON p.id = s.project_id
     WHERE s.id = ${sessionId}
     LIMIT 1
  `)) as unknown as Array<{ project_name: string | null; started_at: string; duration_seconds: number | null }>;
  if (sessionRow.length === 0) return null;
  const session = sessionRow[0]!;

  const tools = (await db.execute<{ tool_name: string; n: string }>(sql`
    SELECT tool_name, COUNT(*)::text AS n
      FROM tool_events
     WHERE session_id = ${sessionId}
     GROUP BY tool_name
     ORDER BY COUNT(*) DESC
  `)) as unknown as Array<{ tool_name: string; n: string }>;

  const files = (await db.execute<{ file_path: string }>(sql`
    SELECT DISTINCT file_path
      FROM tool_events
     WHERE session_id = ${sessionId} AND file_path IS NOT NULL
     LIMIT 10
  `)) as unknown as Array<{ file_path: string }>;

  const insights = (await db.execute<{ type: string; title: string | null; content: string }>(sql`
    SELECT type::text AS type, title, content
      FROM insights
     WHERE session_id = ${sessionId}
     ORDER BY created_at ASC
     LIMIT 6
  `)) as unknown as Array<{ type: string; title: string | null; content: string }>;

  const lines: string[] = [];
  lines.push(`Project: ${session.project_name ?? "(unknown)"}`);
  lines.push(`Started: ${session.started_at}`);
  if (session.duration_seconds) lines.push(`Duration: ${Math.round(session.duration_seconds / 60)} min`);
  lines.push("");
  lines.push("Tool counts:");
  for (const t of tools) lines.push(`  ${t.tool_name}: ${t.n}`);
  lines.push("");
  if (files.length > 0) {
    lines.push("Files touched:");
    for (const f of files) lines.push(`  ${f.file_path}`);
    lines.push("");
  }
  if (insights.length > 0) {
    lines.push("Insights logged this session:");
    for (const i of insights) {
      lines.push(`  [${i.type}] ${i.title ?? i.content.slice(0, 60)}`);
      if (i.content.length > (i.title?.length ?? 0)) {
        lines.push(`    ${i.content.slice(0, 220)}`);
      }
    }
  }
  return lines.join("\n");
}
