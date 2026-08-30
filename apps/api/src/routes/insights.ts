// GET /v1/insights — faceted insight search.

import { Hono } from "hono";
import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { dashboardAuth } from "../auth/session.js";

export const insightsRoute = new Hono();

insightsRoute.use("/insights", dashboardAuth);

insightsRoute.get("/insights", async (c) => {
  const session = c.get("session");
  const q = c.req.query("q") ?? "";
  const types = (c.req.query("types") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const projectIds = (c.req.query("projects") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "100", 10), 200);

  const conditions = [eq(schema.insights.orgId, session.org_id)];
  if (types.length > 0) {
    conditions.push(
      inArray(schema.insights.type, types as ("progress" | "decision" | "blocker" | "pattern" | "fix" | "context")[]),
    );
  }
  if (projectIds.length > 0) {
    conditions.push(inArray(schema.insights.projectId, projectIds));
  }
  if (q) {
    conditions.push(
      or(
        ilike(schema.insights.title, `%${q}%`),
        ilike(schema.insights.content, `%${q}%`),
      )!,
    );
  }

  const rows = await db
    .select({
      id: schema.insights.id,
      type: schema.insights.type,
      title: schema.insights.title,
      content: schema.insights.content,
      memberId: schema.insights.memberId,
      projectId: schema.insights.projectId,
      createdAt: schema.insights.createdAt,
    })
    .from(schema.insights)
    .where(and(...conditions))
    .orderBy(desc(schema.insights.createdAt))
    .limit(limit);

  return c.json({
    insights: rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      content: r.content,
      member_id: r.memberId,
      project_id: r.projectId,
      created_at: r.createdAt,
    })),
  });
});
