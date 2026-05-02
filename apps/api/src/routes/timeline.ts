// GET /v1/timeline — paginated activity feed.

import { Hono } from "hono";
import { and, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { dashboardAuth } from "../auth/session.js";

export const timeline = new Hono();

timeline.use("/timeline", dashboardAuth);

timeline.get("/timeline", async (c) => {
  const session = c.get("session");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "100", 10), 200);
  const since = c.req.query("since");
  const projectId = c.req.query("project");

  const conditions = [eq(schema.eventLog.orgId, session.org_id)];
  if (since) conditions.push(gte(schema.eventLog.receivedAt, new Date(since)));
  if (projectId) conditions.push(eq(schema.eventLog.projectId, projectId));

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
