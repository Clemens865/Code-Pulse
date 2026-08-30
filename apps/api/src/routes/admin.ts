// Admin endpoints — members, projects, API keys, audit log.
// All routes go through requireAdmin (dashboardAuth + admin role check).
// All writes record an entry in audit_log.

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { dashboardAuth } from "../auth/session.js";
import { adminAuth } from "../auth/admin.js";
import { problem } from "../lib/errors.js";
import { recordAudit } from "../lib/audit.js";
import { generateApiKey } from "../lib/keys.js";
import { mergeProjects } from "../lib/projects.js";

export const admin = new Hono();

// All admin routes require an authenticated admin session.
admin.use("/admin/*", dashboardAuth, adminAuth);
admin.use("/members/invite", dashboardAuth, adminAuth);
admin.use("/members/:id", dashboardAuth, adminAuth);
admin.use("/members/:id/keys", dashboardAuth, adminAuth);
admin.use("/api-keys/:id", dashboardAuth, adminAuth);
admin.use("/projects/:id/confirm", dashboardAuth, adminAuth);
admin.use("/projects/:id", dashboardAuth, adminAuth);
admin.use("/audit-log", dashboardAuth, adminAuth);

// ────────────────────── members ──────────────────────

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255).optional(),
  role: z.enum(["owner", "admin", "lead", "member"]).default("member"),
});

admin.post(
  "/members/invite",
  zValidator("json", inviteSchema, (r, c) => {
    if (!r.success) return problem(c, 400, "schema_validation_failed", "Invalid invite payload");
    return undefined;
  }),
  async (c) => {
    const s = c.get("session");
    const { email, name, role } = c.req.valid("json");

    // Idempotent on (org_id, email).
    const existing = await db.query.members.findFirst({
      where: (m, { and, eq }) => and(eq(m.orgId, s.org_id), eq(m.email, email)),
      columns: { id: true, status: true },
    });
    if (existing) {
      return c.json({ id: existing.id, status: existing.status, deduped: true });
    }

    const inserted = await db
      .insert(schema.members)
      .values({
        orgId: s.org_id,
        email,
        name: name ?? null,
        role,
        status: "invited",
        invitedBy: s.member_id,
      })
      .returning({ id: schema.members.id });
    const id = inserted[0]?.id;
    if (!id) return problem(c, 500, "server_error", "Insert returned no id");

    await recordAudit(c, "member.invite", { type: "member", id }, { email, role });
    return c.json({ id, status: "invited", deduped: false }, 201);
  },
);

const patchMemberSchema = z.object({
  role: z.enum(["owner", "admin", "lead", "member"]).optional(),
  status: z.enum(["active", "stale", "deactivated"]).optional(),
  name: z.string().min(1).max(255).optional(),
});

admin.patch(
  "/members/:id",
  zValidator("json", patchMemberSchema, (r, c) => {
    if (!r.success) return problem(c, 400, "schema_validation_failed", "Invalid patch payload");
    return undefined;
  }),
  async (c) => {
    const s = c.get("session");
    const id = c.req.param("id");
    const patch = c.req.valid("json");

    const member = await db.query.members.findFirst({
      where: (m, { and, eq }) => and(eq(m.id, id), eq(m.orgId, s.org_id)),
      columns: { id: true },
    });
    if (!member) return problem(c, 404, "not_found", "Member not found");

    const updates: Record<string, unknown> = {};
    if (patch.role !== undefined) updates.role = patch.role;
    if (patch.name !== undefined) updates.name = patch.name;
    if (patch.status !== undefined) {
      updates.status = patch.status;
      if (patch.status === "deactivated") updates.deactivatedAt = new Date();
      if (patch.status === "active") updates.activatedAt = new Date();
    }
    if (Object.keys(updates).length === 0) {
      return c.json({ ok: true });
    }

    await db
      .update(schema.members)
      .set(updates)
      .where(and(eq(schema.members.id, id), eq(schema.members.orgId, s.org_id)));

    await recordAudit(c, "member.update", { type: "member", id }, patch);
    return c.json({ ok: true });
  },
);

// ────────────────────── api keys ──────────────────────

admin.post("/members/:id/keys", async (c) => {
  const s = c.get("session");
  const memberId = c.req.param("id");

  const member = await db.query.members.findFirst({
    where: (m, { and, eq }) => and(eq(m.id, memberId), eq(m.orgId, s.org_id)),
    columns: { id: true, status: true },
  });
  if (!member) return problem(c, 404, "not_found", "Member not found");
  if (member.status === "deactivated") {
    return problem(c, 422, "bad_request", "Cannot issue a key for a deactivated member");
  }

  let label: string | undefined;
  try {
    const body = (await c.req.json()) as { label?: string };
    label = body?.label;
  } catch {
    label = undefined;
  }

  const key = generateApiKey();
  const inserted = await db
    .insert(schema.apiKeys)
    .values({
      orgId: s.org_id,
      memberId,
      label: label ?? null,
      keyHash: key.hash,
      keyLast4: key.last4,
    })
    .returning({ id: schema.apiKeys.id });
  const id = inserted[0]?.id;
  if (!id) return problem(c, 500, "server_error", "Insert returned no id");

  await recordAudit(c, "api_key.issue", { type: "api_key", id }, { memberId, label });

  // Return plaintext exactly once.
  return c.json(
    {
      id,
      label: label ?? null,
      last4: key.last4,
      plaintext: key.plaintext,
      created_at: new Date().toISOString(),
    },
    201,
  );
});

admin.delete("/api-keys/:id", async (c) => {
  const s = c.get("session");
  const id = c.req.param("id");

  const row = await db.query.apiKeys.findFirst({
    where: (k, { and, eq, isNull }) =>
      and(eq(k.id, id), eq(k.orgId, s.org_id), isNull(k.revokedAt)),
    columns: { id: true, memberId: true, keyLast4: true },
  });
  if (!row) return problem(c, 404, "not_found", "API key not found or already revoked");

  await db
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.orgId, s.org_id)));

  await recordAudit(c, "api_key.revoke", { type: "api_key", id }, { memberId: row.memberId, last4: row.keyLast4 });
  return c.json({ ok: true });
});

// List keys for the org (admin scope).
admin.get("/admin/api-keys", async (c) => {
  const s = c.get("session");
  const rows = await db
    .select({
      id: schema.apiKeys.id,
      memberId: schema.apiKeys.memberId,
      label: schema.apiKeys.label,
      last4: schema.apiKeys.keyLast4,
      lastUsedAt: schema.apiKeys.lastUsedAt,
      createdAt: schema.apiKeys.createdAt,
      revokedAt: schema.apiKeys.revokedAt,
    })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.orgId, s.org_id))
    .orderBy(desc(schema.apiKeys.createdAt))
    .limit(500);

  return c.json({ keys: rows.map((r) => ({ ...r, status: r.revokedAt ? "revoked" : "active" })) });
});

// ────────────────────── dead-letter events ──────────────────────
// Surfaces events that were accepted into event_log but failed to project into
// the typed tables (sessions / tool_events / insights / file_activity). Without
// this, derive failures only land in stderr and the dashboard silently misses
// rows while the ingest API reports 100% accepted.

admin.get("/admin/dead-letter", async (c) => {
  const s = c.get("session");
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "100", 10) || 100, 1), 500);
  const includeResolved = c.req.query("include_resolved") === "true";

  const rows = await db
    .select({
      id: schema.deadLetterEvents.id,
      eventId: schema.deadLetterEvents.eventId,
      reason: schema.deadLetterEvents.reason,
      lastError: schema.deadLetterEvents.lastError,
      retryCount: schema.deadLetterEvents.retryCount,
      receivedAt: schema.deadLetterEvents.receivedAt,
      resolvedAt: schema.deadLetterEvents.resolvedAt,
      payload: schema.deadLetterEvents.payload,
    })
    .from(schema.deadLetterEvents)
    .where(
      includeResolved
        ? eq(schema.deadLetterEvents.orgId, s.org_id)
        : and(eq(schema.deadLetterEvents.orgId, s.org_id), isNull(schema.deadLetterEvents.resolvedAt)),
    )
    .orderBy(desc(schema.deadLetterEvents.receivedAt))
    .limit(limit);

  return c.json({ events: rows });
});

// ────────────────────── projects ──────────────────────

// Collapse duplicate project rows (same physical directory, different
// canonical_key formats from the hook's fallback chain) into one survivor.
// All child rows are re-pointed, never deleted; the losers' canonical_keys
// survive as aliases on the winner so in-flight events still resolve.

const mergeProjectsSchema = z.object({
  winner_id: z.string().uuid(),
  loser_ids: z.array(z.string().uuid()).min(1).max(50),
});

admin.post(
  "/admin/projects/merge",
  zValidator("json", mergeProjectsSchema, (r, c) => {
    if (!r.success) return problem(c, 400, "schema_validation_failed", "Invalid merge payload");
    return undefined;
  }),
  async (c) => {
    const s = c.get("session");
    const { winner_id, loser_ids } = c.req.valid("json");

    if (loser_ids.includes(winner_id)) {
      return problem(c, 400, "invalid_merge", "winner_id cannot also be a loser_id");
    }
    const uniqueLosers = [...new Set(loser_ids)];

    // Every project must exist and belong to this org — tenant guard.
    const found = await db.query.projects.findMany({
      where: (p, { and, eq, inArray }) =>
        and(eq(p.orgId, s.org_id), inArray(p.id, [winner_id, ...uniqueLosers])),
      columns: { id: true },
    });
    const foundIds = new Set(found.map((p) => p.id));
    if (!foundIds.has(winner_id)) {
      return problem(c, 404, "not_found", "winner project not found in this org");
    }
    const missing = uniqueLosers.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      return problem(c, 404, "not_found", `loser project(s) not found in this org: ${missing.join(", ")}`);
    }

    const { repointed } = await db.transaction((tx) =>
      mergeProjects(tx, s.org_id, winner_id, uniqueLosers),
    );

    await recordAudit(
      c,
      "project.merge",
      { type: "project", id: winner_id },
      { loser_ids: uniqueLosers, repointed },
    );

    return c.json({ ok: true, winner_id, merged: uniqueLosers, repointed });
  },
);

const patchProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  needs_review: z.boolean().optional(),
  redaction_policy_id: z.string().uuid().nullable().optional(),
  status: z.enum(["active", "archived"]).optional(),
});

admin.patch(
  "/projects/:id",
  zValidator("json", patchProjectSchema, (r, c) => {
    if (!r.success) return problem(c, 400, "schema_validation_failed", "Invalid patch payload");
    return undefined;
  }),
  async (c) => {
    const s = c.get("session");
    const id = c.req.param("id");
    const patch = c.req.valid("json");

    const project = await db.query.projects.findFirst({
      where: (p, { and, eq }) => and(eq(p.id, id), eq(p.orgId, s.org_id)),
      columns: { id: true },
    });
    if (!project) return problem(c, 404, "not_found", "Project not found");

    const updates: Record<string, unknown> = {};
    if (patch.name !== undefined) updates.name = patch.name;
    if (patch.needs_review !== undefined) updates.needsReview = patch.needs_review;
    if (patch.redaction_policy_id !== undefined) updates.redactionPolicyId = patch.redaction_policy_id;
    if (patch.status !== undefined) {
      updates.status = patch.status;
      if (patch.status === "archived") updates.archivedAt = new Date();
    }
    if (Object.keys(updates).length === 0) return c.json({ ok: true });

    await db
      .update(schema.projects)
      .set(updates)
      .where(and(eq(schema.projects.id, id), eq(schema.projects.orgId, s.org_id)));

    await recordAudit(c, "project.update", { type: "project", id }, patch);
    return c.json({ ok: true });
  },
);

// Convenience: confirm a needs-review project (clears the flag, optional rename).
admin.post(
  "/projects/:id/confirm",
  zValidator(
    "json",
    z.object({ name: z.string().min(1).max(255).optional() }),
    (r, c) => {
      if (!r.success) return problem(c, 400, "schema_validation_failed", "Invalid payload");
      return undefined;
    },
  ),
  async (c) => {
    const s = c.get("session");
    const id = c.req.param("id");
    const { name } = c.req.valid("json");

    const project = await db.query.projects.findFirst({
      where: (p, { and, eq }) => and(eq(p.id, id), eq(p.orgId, s.org_id)),
      columns: { id: true, needsReview: true },
    });
    if (!project) return problem(c, 404, "not_found", "Project not found");

    const updates: Record<string, unknown> = { needsReview: false };
    if (name) updates.name = name;
    await db
      .update(schema.projects)
      .set(updates)
      .where(and(eq(schema.projects.id, id), eq(schema.projects.orgId, s.org_id)));

    await recordAudit(c, "project.confirm", { type: "project", id }, { name });
    return c.json({ ok: true });
  },
);

// ────────────────────── audit log ──────────────────────

admin.get("/audit-log", async (c) => {
  const s = c.get("session");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "100", 10), 500);
  const action = c.req.query("action");
  const conditions = [eq(schema.auditLog.orgId, s.org_id)];
  if (action) conditions.push(eq(schema.auditLog.action, action));

  const rows = await db
    .select({
      id: schema.auditLog.id,
      ts: schema.auditLog.ts,
      actorMemberId: schema.auditLog.actorMemberId,
      action: schema.auditLog.action,
      targetType: schema.auditLog.targetType,
      targetId: schema.auditLog.targetId,
      payload: schema.auditLog.payload,
    })
    .from(schema.auditLog)
    .where(and(...conditions))
    .orderBy(desc(schema.auditLog.ts))
    .limit(limit);

  return c.json({
    entries: rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      actor_member_id: r.actorMemberId,
      action: r.action,
      target_type: r.targetType,
      target_id: r.targetId,
      payload: r.payload,
    })),
  });
});

// Re-export referenced schemas to keep ts-strict happy with isNull import.
export const __unused_isNull = isNull;
