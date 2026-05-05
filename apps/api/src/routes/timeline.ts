// GET /v1/timeline — paginated activity feed.
//
// Filters (all optional):
//   projects=<uuid>,<uuid>     Multi-select project filter
//   members=<uuid>,<uuid>      Multi-select member filter
//   kinds=session.start,…      Event-kind filter (matches event_kind enum values)
//   range=24h|7d|30d|90d       Time range. Mutually exclusive with `since`.
//   since=<iso>                Only events received_at >= this timestamp
//   limit=<n>                  Page size, default 100, max 200

import { Hono } from "hono";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { dashboardAuth } from "../auth/session.js";

export const timeline = new Hono();

timeline.use("/timeline", dashboardAuth);

const RANGE_TO_MS: Record<string, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
};

const VALID_EVENT_KINDS = new Set([
  "session.start", "session.end", "prompt.submit",
  "tool.edit", "tool.write", "tool.read", "tool.bash", "tool.glob", "tool.grep",
  "tool.agent", "tool.skill", "tool.web_fetch", "tool.web_search", "tool.tool_search",
  "insight.progress", "insight.decision", "insight.blocker",
  "insight.pattern", "insight.fix", "insight.context",
  "blueprint.run", "heartbeat",
]);

function csvOrEmpty(s: string | undefined): string[] {
  if (!s) return [];
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

timeline.get("/timeline", async (c) => {
  const session = c.get("session");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "100", 10), 200);

  // Time window. `range` wins if set; falls back to explicit `since`.
  const rangeParam = c.req.query("range");
  const sinceParam = c.req.query("since");
  let since: Date | undefined;
  if (rangeParam && RANGE_TO_MS[rangeParam]) {
    since = new Date(Date.now() - RANGE_TO_MS[rangeParam]!);
  } else if (sinceParam) {
    const d = new Date(sinceParam);
    if (!isNaN(d.getTime())) since = d;
  }

  // Multi-select filters. Backwards-compatible: legacy `project=<one-uuid>` accepted.
  const projects = csvOrEmpty(c.req.query("projects"));
  const legacyProject = c.req.query("project");
  if (legacyProject && projects.length === 0) projects.push(legacyProject);

  const members = csvOrEmpty(c.req.query("members"));
  const kindsRaw = csvOrEmpty(c.req.query("kinds"));
  const kinds = kindsRaw.filter((k) => VALID_EVENT_KINDS.has(k));

  const conditions = [eq(schema.eventLog.orgId, session.org_id)];
  if (since) conditions.push(gte(schema.eventLog.receivedAt, since));
  if (projects.length > 0) conditions.push(inArray(schema.eventLog.projectId, projects));
  if (members.length > 0) conditions.push(inArray(schema.eventLog.memberId, members));
  if (kinds.length > 0) {
    // event_kind is a Postgres enum; inArray needs string casts handled by drizzle.
    conditions.push(inArray(schema.eventLog.eventKind, kinds as never[]));
  }

  const rows = await db
    .select({
      id: schema.eventLog.id,
      kind: schema.eventLog.eventKind,
      memberId: schema.eventLog.memberId,
      projectId: schema.eventLog.projectId,
      sessionId: schema.eventLog.sessionId,
      payload: schema.eventLog.payload,
      hookTs: schema.eventLog.hookTs,
      receivedAt: schema.eventLog.receivedAt,
    })
    .from(schema.eventLog)
    .where(and(...conditions))
    .orderBy(desc(schema.eventLog.receivedAt))
    .limit(limit);

  return c.json({
    events: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      session_id: r.sessionId,
      member_id: r.memberId,
      project_id: r.projectId,
      payload: r.payload,
      hook_ts: r.hookTs,
      received_at: r.receivedAt,
    })),
  });
});
