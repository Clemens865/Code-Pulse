// GET /v1/sessions/:id — full forensic view of a single Claude Code session.
// Derived from event_log directly (the rollup table `sessions` isn't written
// to by ingestion yet — see PRD §14, derived workers are deferred).

import { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { dashboardAuth } from "../auth/session.js";
import { problem } from "../lib/errors.js";

export const sessionsRoute = new Hono();

sessionsRoute.use("/sessions/:id", dashboardAuth);

sessionsRoute.get("/sessions/:id", async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");

  const events = await db
    .select({
      id: schema.eventLog.id,
      kind: schema.eventLog.eventKind,
      memberId: schema.eventLog.memberId,
      projectId: schema.eventLog.projectId,
      payload: schema.eventLog.payload,
      clientMeta: schema.eventLog.clientMeta,
      hookTs: schema.eventLog.hookTs,
      receivedAt: schema.eventLog.receivedAt,
    })
    .from(schema.eventLog)
    .where(
      and(eq(schema.eventLog.orgId, session.org_id), eq(schema.eventLog.sessionId, id)),
    )
    .orderBy(asc(schema.eventLog.hookTs))
    .limit(2000);

  if (events.length === 0) return problem(c, 404, "not_found", "Session not found");

  const first = events[0]!;
  const last = events[events.length - 1]!;
  const startedAt = new Date(first.hookTs).toISOString();
  const endedAt = new Date(last.hookTs).toISOString();
  const durationSec = Math.max(
    0,
    Math.round((new Date(last.hookTs).getTime() - new Date(first.hookTs).getTime()) / 1000),
  );

  // Derived KPIs.
  let linesAdded = 0;
  let linesRemoved = 0;
  const files = new Set<string>();
  const tools = new Set<string>();
  let bashFailures = 0;
  for (const e of events) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    if (e.kind.startsWith("tool.")) tools.add(e.kind.slice("tool.".length));
    if (e.kind === "tool.edit" || e.kind === "tool.write") {
      const f = p["file_path"];
      if (typeof f === "string") files.add(f);
      const newStr = typeof p["new_string"] === "string" ? (p["new_string"] as string) : "";
      const oldStr = typeof p["old_string"] === "string" ? (p["old_string"] as string) : "";
      const content = typeof p["content"] === "string" ? (p["content"] as string) : "";
      const newLines = countLines(newStr || content);
      const oldLines = countLines(oldStr);
      linesAdded += newLines;
      linesRemoved += oldLines;
    }
    if (e.kind === "tool.bash") {
      const exit = p["exit_code"];
      if (typeof exit === "number" && exit !== 0) bashFailures++;
    }
  }

  // Project + member identity for the header.
  const project = await db.query.projects.findFirst({
    where: (p, { and, eq }) => and(eq(p.id, first.projectId), eq(p.orgId, session.org_id)),
    columns: { id: true, name: true, remoteUrl: true },
  });
  const member = await db.query.members.findFirst({
    where: (m, { and, eq }) => and(eq(m.id, first.memberId), eq(m.orgId, session.org_id)),
    columns: { id: true, name: true, email: true, role: true },
  });

  // Stuck score (computed by the periodic job on lib/stuck.ts).
  const stuckRow = await db.query.sessions.findFirst({
    where: (s, { and, eq }) => and(eq(s.id, id), eq(s.orgId, session.org_id)),
    columns: { stuckScore: true, stuckSignals: true, stuckScoredAt: true },
  });
  const stuckScore = stuckRow ? parseFloat(stuckRow.stuckScore) : 0;
  const stuckSignals = (stuckRow?.stuckSignals ?? {}) as Record<string, unknown>;

  return c.json({
    session: {
      id,
      project: project ?? null,
      member: member ?? null,
      started_at: startedAt,
      ended_at: endedAt,
      duration_seconds: durationSec,
      hostname: (first.clientMeta as Record<string, unknown> | null)?.["hostname"] ?? null,
      cloud_env: (first.clientMeta as Record<string, unknown> | null)?.["cloud_env"] ?? null,
      hook_version: (first.clientMeta as Record<string, unknown> | null)?.["hook_version"] ?? null,
      os: (first.clientMeta as Record<string, unknown> | null)?.["os"] ?? null,
    },
    stats: {
      events: events.length,
      lines_added: linesAdded,
      lines_removed: linesRemoved,
      net_lines: linesAdded - linesRemoved,
      files: files.size,
      tools: tools.size,
      bash_failures: bashFailures,
    },
    stuck: {
      score: stuckScore,
      signals: stuckSignals,
      scored_at: stuckRow?.stuckScoredAt ?? null,
    },
    events: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      member_id: e.memberId,
      payload: e.payload,
      hook_ts: e.hookTs,
      received_at: e.receivedAt,
    })),
  });
});

function countLines(s: string): number {
  if (!s) return 0;
  // Inclusive line count: a non-empty string with no newline still counts as 1 line.
  let n = 1;
  for (const ch of s) if (ch === "\n") n++;
  return n;
}
