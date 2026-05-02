// GET /v1/projects, GET /v1/projects/:id
// Dashboard-side reads scoped to the session's org_id.

import { Hono } from "hono";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { dashboardAuth } from "../auth/session.js";
import { problem } from "../lib/errors.js";

export const projects = new Hono();

projects.use("/projects", dashboardAuth);
projects.use("/projects/*", dashboardAuth);

projects.get("/projects", async (c) => {
  const session = c.get("session");
  const rows = await db.query.projects.findMany({
    where: (p, { eq }) => eq(p.orgId, session.org_id),
    orderBy: (p) => [desc(p.updatedAt)],
    columns: {
      id: true,
      name: true,
      remoteUrl: true,
      vcsProvider: true,
      status: true,
      needsReview: true,
      redactionPolicyId: true,
      updatedAt: true,
      createdAt: true,
    },
  });

  // Per-project rollups: open blockers, sessions in last 7d.
  const stats = await db
    .select({
      projectId: schema.eventLog.projectId,
      sessions7d: sql<number>`count(*) filter (where ${schema.eventLog.eventKind} = 'session.start' and ${schema.eventLog.receivedAt} > now() - interval '7 days')`.mapWith(Number),
      lastActivity: sql<string | null>`max(${schema.eventLog.receivedAt})`,
    })
    .from(schema.eventLog)
    .where(eq(schema.eventLog.orgId, session.org_id))
    .groupBy(schema.eventLog.projectId);

  const byProject = new Map(stats.map((s) => [s.projectId, s]));

  const blockerRows = await db
    .select({
      projectId: schema.insights.projectId,
      open: sql<number>`count(*) filter (where ${schema.insights.resolvedAt} is null)`.mapWith(Number),
    })
    .from(schema.insights)
    .where(and(eq(schema.insights.orgId, session.org_id), eq(schema.insights.type, "blocker")))
    .groupBy(schema.insights.projectId);
  const blockersByProject = new Map(blockerRows.map((b) => [b.projectId, b.open]));

  return c.json({
    projects: rows.map((p) => ({
      id: p.id,
      name: p.name,
      repo: p.remoteUrl ?? "—",
      vcs_provider: p.vcsProvider,
      status: p.status,
      needs_review: p.needsReview,
      redaction: redactionLabel(p.redactionPolicyId),
      sessions7d: byProject.get(p.id)?.sessions7d ?? 0,
      blockers: blockersByProject.get(p.id) ?? 0,
      last_activity: byProject.get(p.id)?.lastActivity ?? p.updatedAt,
    })),
  });
});

projects.get("/projects/:id", async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");

  const p = await db.query.projects.findFirst({
    where: (p, { and, eq }) => and(eq(p.id, id), eq(p.orgId, session.org_id)),
  });
  if (!p) return problem(c, 404, "not_found", "Project not found");

  const recentInsights = await db.query.insights.findMany({
    where: (i, { and, eq }) => and(eq(i.projectId, p.id), eq(i.orgId, session.org_id)),
    orderBy: (i) => [desc(i.createdAt)],
    limit: 8,
    columns: { id: true, type: true, title: true, content: true, memberId: true, createdAt: true },
  });

  // Hotspot files: top file_paths from event_log payloads for tool.edit / tool.write.
  const hotRows = (await db.execute<{ path: string; edits: number }>(sql`
    SELECT
      payload->>'file_path' AS path,
      count(*)::int AS edits
    FROM event_log
    WHERE org_id = ${session.org_id}
      AND project_id = ${p.id}
      AND event_kind IN ('tool.edit', 'tool.write')
      AND payload->>'file_path' IS NOT NULL
    GROUP BY payload->>'file_path'
    ORDER BY edits DESC
    LIMIT 10
  `)) as unknown as Array<{ path: string; edits: number }>;

  // Members who have touched this project (any event in event_log).
  const memberIdRows = await db
    .selectDistinct({ memberId: schema.eventLog.memberId })
    .from(schema.eventLog)
    .where(and(eq(schema.eventLog.orgId, session.org_id), eq(schema.eventLog.projectId, p.id)))
    .limit(50);
  const memberIds = memberIdRows.map((r) => r.memberId);
  const projectMembers =
    memberIds.length === 0
      ? []
      : await db.query.members.findMany({
          where: (m, { inArray }) => inArray(m.id, memberIds),
          columns: { id: true, name: true, email: true, role: true, status: true },
        });

  return c.json({
    project: {
      id: p.id,
      name: p.name,
      repo: p.remoteUrl ?? "—",
      redaction: redactionLabel(p.redactionPolicyId),
      needs_review: p.needsReview,
    },
    recent_insights: recentInsights.map((i) => ({
      id: i.id,
      type: i.type,
      title: i.title ?? "",
      content: i.content,
      member_id: i.memberId,
      created_at: i.createdAt,
    })),
    hot_files: hotRows.map((r) => ({ path: r.path, edits: r.edits })),
    members: projectMembers,
  });
});

function redactionLabel(_policyId: string | null): "standard" | "strict" {
  // Until we surface policy.mode in the read shape, default to standard.
  return "standard";
}
