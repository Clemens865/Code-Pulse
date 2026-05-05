// Compliance audit endpoints. Per CAPTURE-LAYER.md §9 Sprint 4 + COMPLIANCE.md.
//
//   GET /v1/audit/files?q=<prefix>&limit=20
//     Distinct file paths the org has touched, prefix-filtered for
//     autocomplete. Ordered by recency of last activity.
//
//   GET /v1/audit/file?path=<path>&limit=200
//     Chronological timeline of every tool_event for that file: who,
//     when, tool, lines added/removed, session id. Optional CSV via
//     Accept: text/csv (or ?format=csv).
//
//   GET /v1/audit/failures?limit=200
//     Command failures (Bash with command_failed=true) for incident
//     reconstruction. Same CSV option.

import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { dashboardAuth } from "../auth/session.js";
import { problem } from "../lib/errors.js";

export const audit = new Hono();

audit.use("/audit/*", dashboardAuth);

audit.get("/audit/files", async (c) => {
  const session = c.get("session");
  const q = (c.req.query("q") ?? "").trim();
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 50);

  const r = (await db.execute<{ file_path: string; edits: string; last_ts: string }>(sql`
    SELECT te.file_path,
           COUNT(*)::text AS edits,
           MAX(te.ts)::text AS last_ts
      FROM tool_events te
     WHERE te.org_id = ${session.org_id}
       AND te.file_path IS NOT NULL
       ${q ? sql`AND te.file_path ILIKE ${"%" + q + "%"}` : sql``}
     GROUP BY te.file_path
     ORDER BY MAX(te.ts) DESC
     LIMIT ${limit}
  `)) as unknown as Array<{ file_path: string; edits: string; last_ts: string }>;

  return c.json({
    files: r.map((row) => ({
      file_path: row.file_path,
      edits: parseInt(row.edits, 10),
      last_ts: row.last_ts,
    })),
  });
});

audit.get("/audit/file", async (c) => {
  const session = c.get("session");
  const path = c.req.query("path");
  if (!path) return problem(c, 400, "schema_validation_failed", "Missing ?path=");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "200", 10), 500);

  const r = (await db.execute<{
    id: string;
    ts: string;
    tool_name: string;
    member_id: string;
    member_name: string | null;
    project_id: string;
    project_name: string;
    session_id: string;
    lines_added: string;
    lines_removed: string;
    command: string | null;
    command_failed: string;
  }>(sql`
    SELECT te.id, te.ts::text AS ts,
           te.tool_name,
           te.member_id, m.name AS member_name,
           te.project_id, p.name AS project_name,
           te.session_id,
           te.lines_added::text AS lines_added,
           te.lines_removed::text AS lines_removed,
           te.command,
           te.command_failed::text AS command_failed
      FROM tool_events te
      JOIN members m ON m.id = te.member_id
      JOIN projects p ON p.id = te.project_id
     WHERE te.org_id = ${session.org_id}
       AND te.file_path = ${path}
     ORDER BY te.ts DESC
     LIMIT ${limit}
  `)) as unknown as Array<{
    id: string;
    ts: string;
    tool_name: string;
    member_id: string;
    member_name: string | null;
    project_id: string;
    project_name: string;
    session_id: string;
    lines_added: string;
    lines_removed: string;
    command: string | null;
    command_failed: string;
  }>;

  const events = r.map((row) => ({
    id: row.id,
    ts: row.ts,
    tool_name: row.tool_name,
    member: { id: row.member_id, name: row.member_name },
    project: { id: row.project_id, name: row.project_name },
    session_id: row.session_id,
    lines_added: parseInt(row.lines_added, 10),
    lines_removed: parseInt(row.lines_removed, 10),
    command: row.command,
    command_failed: row.command_failed === "true",
  }));

  if (wantsCsv(c)) {
    return c.body(toCsv(events, [
      "ts", "tool_name", "member.name", "project.name", "session_id",
      "lines_added", "lines_removed", "command_failed", "command",
    ]), 200, csvHeaders(`audit-file-${sanitizePath(path)}.csv`));
  }
  return c.json({ path, events });
});

audit.get("/audit/failures", async (c) => {
  const session = c.get("session");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "200", 10), 500);
  const sinceParam = c.req.query("since");
  const r = (await db.execute<{
    id: string;
    ts: string;
    member_id: string;
    member_name: string | null;
    project_id: string;
    project_name: string;
    session_id: string;
    command: string | null;
  }>(sql`
    SELECT te.id, te.ts::text AS ts,
           te.member_id, m.name AS member_name,
           te.project_id, p.name AS project_name,
           te.session_id,
           te.command
      FROM tool_events te
      JOIN members m ON m.id = te.member_id
      JOIN projects p ON p.id = te.project_id
     WHERE te.org_id = ${session.org_id}
       AND te.command_failed = TRUE
       ${sinceParam ? sql`AND te.ts >= ${sinceParam}::timestamptz` : sql``}
     ORDER BY te.ts DESC
     LIMIT ${limit}
  `)) as unknown as Array<{
    id: string;
    ts: string;
    member_id: string;
    member_name: string | null;
    project_id: string;
    project_name: string;
    session_id: string;
    command: string | null;
  }>;

  const events = r.map((row) => ({
    id: row.id,
    ts: row.ts,
    member: { id: row.member_id, name: row.member_name },
    project: { id: row.project_id, name: row.project_name },
    session_id: row.session_id,
    command: row.command,
  }));

  if (wantsCsv(c)) {
    return c.body(
      toCsv(events, ["ts", "member.name", "project.name", "session_id", "command"]),
      200,
      csvHeaders("audit-failures.csv"),
    );
  }
  return c.json({ events });
});

// ──────────────────── helpers ────────────────────

function wantsCsv(c: { req: { header: (k: string) => string | undefined; query: (k: string) => string | undefined } }): boolean {
  if (c.req.query("format") === "csv") return true;
  const accept = c.req.header("accept") ?? "";
  return accept.includes("text/csv");
}

function csvHeaders(filename: string): Record<string, string> {
  return {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${filename}"`,
  };
}

function sanitizePath(p: string): string {
  return p.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80);
}

function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const get = (row: Record<string, unknown>, path: string): unknown => {
    const parts = path.split(".");
    let cur: unknown = row;
    for (const p of parts) {
      if (cur === null || typeof cur !== "object") return null;
      cur = (cur as Record<string, unknown>)[p];
    }
    return cur;
  };
  const lines: string[] = [];
  lines.push(columns.join(","));
  for (const row of rows) {
    lines.push(columns.map((c) => escape(get(row, c))).join(","));
  }
  return lines.join("\n") + "\n";
}
