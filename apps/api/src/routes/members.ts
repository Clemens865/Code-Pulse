// GET /v1/members — list org members with last-seen + key status.

import { Hono } from "hono";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { dashboardAuth } from "../auth/session.js";

export const members = new Hono();

members.use("/members", dashboardAuth);

members.get("/members", async (c) => {
  const session = c.get("session");

  const ms = await db.query.members.findMany({
    where: (m, { eq }) => eq(m.orgId, session.org_id),
    orderBy: (m) => [desc(m.activatedAt), desc(m.invitedAt)],
    columns: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      activatedAt: true,
      invitedAt: true,
    },
  });

  // Latest heartbeat per member (max one workstation tracked here).
  const heartbeats = await db
    .select({
      memberId: schema.heartbeats.memberId,
      lastSeenAt: schema.heartbeats.lastSeenAt,
      hookVersion: schema.heartbeats.hookVersion,
      cloudEnv: schema.heartbeats.cloudEnv,
    })
    .from(schema.heartbeats)
    .where(eq(schema.heartbeats.orgId, session.org_id));
  const hbByMember = new Map(heartbeats.map((h) => [h.memberId, h]));

  // Active key indicator.
  const liveKeys = await db
    .select({ memberId: schema.apiKeys.memberId })
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.orgId, session.org_id), isNull(schema.apiKeys.revokedAt)));
  const liveKeyMembers = new Set(liveKeys.map((k) => k.memberId));

  return c.json({
    members: ms.map((m) => ({
      id: m.id,
      email: m.email,
      name: m.name ?? m.email,
      role: m.role,
      status: m.status,
      last_seen: hbByMember.get(m.id)?.lastSeenAt ?? null,
      key_status: liveKeyMembers.has(m.id) ? "active" : "none",
      hook_version: hbByMember.get(m.id)?.hookVersion ?? null,
      cloud_env: hbByMember.get(m.id)?.cloudEnv ?? null,
    })),
  });
});
