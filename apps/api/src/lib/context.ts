// SessionStart context payload composer.
//
// Per CAPTURE-LAYER.md §4.1, the payload is bounded across four sections:
//   - open_blockers     ≤5, ≤14 days, exclude blockers raised by the caller
//   - key_decisions     ≤5, ≤7 days, ranked by quality (length + WHY) then recency
//   - hot_files         ≤5, ≤7 days, edited by ≥1 (solo) or ≥2 (team) members
//   - patterns          ≤3, lifetime, type IN ('pattern','fix')
//
// Output:
//   - JSON shape (for the dashboard / hook to parse)
//   - render(payload) → ~150–250 tokens of text suitable for direct injection
//     as Claude system context.

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

export type ContextPayload = {
  project: { id: string; name: string; remote_url: string | null };
  generated_at: string;
  window_days: 7 | 14;
  members_active: number;
  open_blockers: Array<{
    id: string;
    title: string | null;
    content: string;
    member_id: string;
    member_name: string | null;
    file_hint: string | null;
    created_at: string;
    age: string;
  }>;
  key_decisions: Array<{
    id: string;
    title: string | null;
    content: string;
    reasoning: string | null;
    member_id: string;
    member_name: string | null;
    created_at: string;
    age: string;
  }>;
  hot_files: Array<{
    file_path: string;
    edit_count: number;
    last_edit_at: string;
    last_edit_by: string | null;
    distinct_members: number;
  }>;
  patterns: Array<{
    id: string;
    title: string | null;
    content: string;
    member_name: string | null;
    type: "pattern" | "fix";
  }>;
};

export type ComposeOpts = {
  orgId: string;
  projectId: string;
  callerMemberId?: string | null; // exclude self-raised blockers if provided
};

export async function composeContext(opts: ComposeOpts): Promise<ContextPayload> {
  const { orgId, projectId, callerMemberId } = opts;

  const project = await loadProject(orgId, projectId);

  const membersActive = await countActiveMembers(orgId, projectId);
  const minDistinctForHot = membersActive >= 2 ? 2 : 1;

  const [openBlockers, keyDecisions, hotFiles, patterns] = await Promise.all([
    selectOpenBlockers(orgId, projectId, callerMemberId ?? null),
    selectKeyDecisions(orgId, projectId),
    selectHotFiles(orgId, projectId, minDistinctForHot),
    selectPatterns(orgId, projectId),
  ]);

  return {
    project,
    generated_at: new Date().toISOString(),
    window_days: 7,
    members_active: membersActive,
    open_blockers: openBlockers,
    key_decisions: keyDecisions,
    hot_files: hotFiles,
    patterns,
  };
}

// ──────────────────── data loaders ────────────────────

async function loadProject(orgId: string, projectId: string): Promise<ContextPayload["project"]> {
  const r = (await db.execute<{ id: string; name: string; remote_url: string | null }>(sql`
    SELECT id, name, remote_url FROM projects WHERE org_id = ${orgId} AND id = ${projectId} LIMIT 1
  `)) as unknown as Array<{ id: string; name: string; remote_url: string | null }>;
  return r[0] ?? { id: projectId, name: "Unknown project", remote_url: null };
}

async function countActiveMembers(orgId: string, projectId: string): Promise<number> {
  const r = (await db.execute<{ n: string }>(sql`
    SELECT COUNT(DISTINCT te.member_id)::text AS n
      FROM tool_events te
     WHERE te.org_id = ${orgId}
       AND te.project_id = ${projectId}
       AND te.ts > NOW() - INTERVAL '7 days'
  `)) as unknown as Array<{ n: string }>;
  return parseInt(r[0]?.n ?? "0", 10) || 0;
}

async function selectOpenBlockers(
  orgId: string,
  projectId: string,
  excludeMemberId: string | null,
): Promise<ContextPayload["open_blockers"]> {
  const exclude = excludeMemberId ?? "00000000-0000-0000-0000-000000000000"; // dummy uuid (won't match)
  const r = (await db.execute<{
    id: string;
    title: string | null;
    content: string;
    member_id: string;
    member_name: string | null;
    file_hint: string | null;
    created_at: string;
  }>(sql`
    SELECT i.id, i.title, i.content, i.member_id,
           m.name AS member_name,
           (
             SELECT te.file_path
               FROM tool_events te
              WHERE te.session_id = i.session_id
                AND te.file_path IS NOT NULL
              ORDER BY te.ts DESC
              LIMIT 1
           ) AS file_hint,
           i.created_at::text AS created_at
      FROM insights i
      JOIN members m ON m.id = i.member_id
     WHERE i.org_id = ${orgId}
       AND i.project_id = ${projectId}
       AND i.type = 'blocker'
       AND i.resolved_at IS NULL
       AND i.created_at > NOW() - INTERVAL '14 days'
       AND i.member_id <> ${exclude}::uuid
     ORDER BY i.created_at DESC
     LIMIT 5
  `)) as unknown as Array<{
    id: string;
    title: string | null;
    content: string;
    member_id: string;
    member_name: string | null;
    file_hint: string | null;
    created_at: string;
  }>;
  return r.map((row) => ({ ...row, age: ageOf(row.created_at) }));
}

async function selectKeyDecisions(
  orgId: string,
  projectId: string,
): Promise<ContextPayload["key_decisions"]> {
  const r = (await db.execute<{
    id: string;
    title: string | null;
    content: string;
    reasoning: string | null;
    member_id: string;
    member_name: string | null;
    created_at: string;
  }>(sql`
    SELECT i.id, i.title, i.content, i.reasoning, i.member_id,
           m.name AS member_name,
           i.created_at::text AS created_at
      FROM insights i
      JOIN members m ON m.id = i.member_id
     WHERE i.org_id = ${orgId}
       AND i.project_id = ${projectId}
       AND i.type = 'decision'
       AND i.created_at > NOW() - INTERVAL '7 days'
     ORDER BY (LENGTH(i.content) + COALESCE(LENGTH(i.reasoning), 0)) DESC,
              i.created_at DESC
     LIMIT 5
  `)) as unknown as Array<{
    id: string;
    title: string | null;
    content: string;
    reasoning: string | null;
    member_id: string;
    member_name: string | null;
    created_at: string;
  }>;
  return r.map((row) => ({ ...row, age: ageOf(row.created_at) }));
}

async function selectHotFiles(
  orgId: string,
  projectId: string,
  minDistinctMembers: number,
): Promise<ContextPayload["hot_files"]> {
  const r = (await db.execute<{
    file_path: string;
    edit_count: string;
    last_edit_at: string;
    last_edit_by: string | null;
    distinct_members: string;
  }>(sql`
    SELECT te.file_path,
           COUNT(*)::text AS edit_count,
           MAX(te.ts)::text AS last_edit_at,
           COUNT(DISTINCT te.member_id)::text AS distinct_members,
           (
             SELECT m.name
               FROM tool_events te2
               JOIN members m ON m.id = te2.member_id
              WHERE te2.org_id = te.org_id
                AND te2.project_id = te.project_id
                AND te2.file_path = te.file_path
              ORDER BY te2.ts DESC
              LIMIT 1
           ) AS last_edit_by
      FROM tool_events te
     WHERE te.org_id = ${orgId}
       AND te.project_id = ${projectId}
       AND te.tool_name IN ('Edit', 'Write')
       AND te.ts > NOW() - INTERVAL '7 days'
       AND te.file_path IS NOT NULL
     GROUP BY te.org_id, te.project_id, te.file_path
    HAVING COUNT(DISTINCT te.member_id) >= ${minDistinctMembers}
     ORDER BY edit_count DESC, last_edit_at DESC
     LIMIT 5
  `)) as unknown as Array<{
    file_path: string;
    edit_count: string;
    last_edit_at: string;
    last_edit_by: string | null;
    distinct_members: string;
  }>;
  return r.map((row) => ({
    file_path: row.file_path,
    edit_count: parseInt(row.edit_count, 10),
    last_edit_at: row.last_edit_at,
    last_edit_by: row.last_edit_by,
    distinct_members: parseInt(row.distinct_members, 10),
  }));
}

async function selectPatterns(
  orgId: string,
  projectId: string,
): Promise<ContextPayload["patterns"]> {
  const r = (await db.execute<{
    id: string;
    title: string | null;
    content: string;
    type: "pattern" | "fix";
    member_name: string | null;
  }>(sql`
    SELECT i.id, i.title, i.content, i.type::text AS type,
           m.name AS member_name
      FROM insights i
      JOIN members m ON m.id = i.member_id
     WHERE i.org_id = ${orgId}
       AND i.project_id = ${projectId}
       AND i.type IN ('pattern', 'fix')
     ORDER BY i.created_at DESC
     LIMIT 3
  `)) as unknown as Array<{
    id: string;
    title: string | null;
    content: string;
    type: "pattern" | "fix";
    member_name: string | null;
  }>;
  return r;
}

// ──────────────────── text rendering ────────────────────

export function renderContext(p: ContextPayload): string {
  const lines: string[] = [];
  const generatedAge = ageOf(p.generated_at);
  lines.push(
    `[Pulse Team — last ${p.window_days} days · ${p.members_active} active member${p.members_active === 1 ? "" : "s"} · generated ${generatedAge} ago]`,
  );

  if (p.open_blockers.length > 0) {
    lines.push("");
    lines.push("OPEN BLOCKERS (be aware — not your job to solve):");
    for (const b of p.open_blockers) {
      const head = headline(b.title, b.content);
      const meta: string[] = [];
      if (b.member_name) meta.push(b.member_name);
      if (b.file_hint) meta.push(b.file_hint);
      const metaStr = meta.length ? ` [${meta.join(", ")}]` : "";
      lines.push(`- ${b.age.padEnd(4)} ${head}${metaStr}`);
    }
  }

  if (p.key_decisions.length > 0) {
    lines.push("");
    lines.push("KEY DECISIONS (these constrain the work):");
    for (const d of p.key_decisions) {
      const head = headline(d.title, d.content);
      const author = d.member_name ? ` [${d.member_name}]` : "";
      lines.push(`- ${d.age.padEnd(4)} ${head}${author}`);
    }
  }

  if (p.hot_files.length > 0) {
    lines.push("");
    lines.push("HOT FILES (concurrent edits this week):");
    for (const f of p.hot_files) {
      const lastBy = f.last_edit_by ? ` · last by ${f.last_edit_by}` : "";
      lines.push(`- ${f.file_path}    ${f.edit_count} edits${lastBy}`);
    }
  }

  if (p.patterns.length > 0) {
    lines.push("");
    lines.push("PATTERNS THIS REPO USES:");
    for (const pat of p.patterns) {
      const head = headline(pat.title, pat.content);
      lines.push(`- ${head}`);
    }
  }

  lines.push("");
  lines.push("[End Pulse context · respond as you normally would; this is background only]");
  return lines.join("\n");
}

// ──────────────────── helpers ────────────────────

function headline(title: string | null, content: string): string {
  const raw = (title ?? content.split("\n")[0] ?? "").trim();
  return raw.length > 80 ? raw.slice(0, 79) + "…" : raw;
}

function ageOf(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return "?";
  const seconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
