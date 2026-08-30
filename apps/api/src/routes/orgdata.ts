// Org data lifecycle: export everything, delete a member's data, delete the
// org. The compliance story COMPLIANCE.md promises — implemented.
//
//   GET    /v1/admin/export                 stream org data as JSONL (admin)
//   DELETE /v1/admin/members/:id/data       erase one member's captured data
//   DELETE /v1/admin/org                    erase the entire org (irreversible;
//                                           requires body {"confirm": "<org slug>"})

import { Hono } from "hono";
import { stream } from "hono/streaming";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { dashboardAuth } from "../auth/session.js";
import { adminAuth } from "../auth/admin.js";
import { problem } from "../lib/errors.js";
import { recordAudit } from "../lib/audit.js";

export const orgdata = new Hono();

orgdata.use("/admin/export", dashboardAuth, adminAuth);
orgdata.use("/admin/members/:id/data", dashboardAuth, adminAuth);
orgdata.use("/admin/org", dashboardAuth, adminAuth);

const EXPORT_TABLES: Array<{ table: string; orderBy: string }> = [
  { table: "orgs", orderBy: "created_at" },
  { table: "teams", orderBy: "created_at" },
  { table: "members", orderBy: "created_at" },
  { table: "projects", orderBy: "created_at" },
  { table: "project_aliases", orderBy: "created_at" },
  { table: "redaction_policies", orderBy: "created_at" },
  { table: "sessions", orderBy: "started_at" },
  { table: "insights", orderBy: "created_at" },
  { table: "tool_events", orderBy: "ts" },
  { table: "file_activity", orderBy: "date" },
  { table: "event_log", orderBy: "received_at" },
  { table: "audit_log", orderBy: "ts" },
];

// JSONL export: one line per row, prefixed with its table name. Streams in
// pages so a 100k-event org doesn't buffer in memory.
orgdata.get("/admin/export", async (c) => {
  const s = c.get("session");
  await recordAudit(c, "org.export", { type: "org", id: s.org_id }, {});
  c.header("Content-Type", "application/jsonl");
  c.header("Content-Disposition", `attachment; filename="pulse-export-${s.org_id}.jsonl"`);
  return stream(c, async (out) => {
    for (const { table, orderBy } of EXPORT_TABLES) {
      const pageSize = 1000;
      let offset = 0;
      for (;;) {
        const rows = await db.execute(
          sql`SELECT * FROM ${sql.identifier(table)}
              WHERE ${table === "orgs" ? sql`id = ${s.org_id}` : sql`org_id = ${s.org_id}`}
              ORDER BY ${sql.identifier(orderBy)} ASC
              LIMIT ${pageSize} OFFSET ${offset}`,
        );
        const list = rows as unknown as Array<Record<string, unknown>>;
        for (const row of list) {
          await out.write(JSON.stringify({ table, row }) + "\n");
        }
        if (list.length < pageSize) break;
        offset += pageSize;
      }
    }
  });
});

// Erase one member's captured data (event-grain rows). The member row itself
// is kept (deactivated) so the org's history of "who was here" survives; pass
// ?delete_member=true to remove the row entirely.
orgdata.delete("/admin/members/:id/data", async (c) => {
  const s = c.get("session");
  const memberId = c.req.param("id");
  const deleteMember = c.req.query("delete_member") === "true";

  const member = await db.query.members.findFirst({
    where: (m, { and, eq }) => and(eq(m.id, memberId), eq(m.orgId, s.org_id)),
    columns: { id: true, role: true },
  });
  if (!member) return problem(c, 404, "not_found", "Member not found in this org");
  if (memberId === s.member_id) {
    return problem(c, 400, "invalid_request", "Use org deletion to remove your own data as the last admin");
  }

  const counts: Record<string, number> = {};
  const del = async (label: string, q: ReturnType<typeof sql>) => {
    const r = await db.execute(q);
    counts[label] = (r as unknown as { count?: number })?.count ?? 0;
  };
  await del("tool_events", sql`DELETE FROM tool_events WHERE org_id = ${s.org_id} AND member_id = ${memberId}`);
  await del("insights", sql`DELETE FROM insights WHERE org_id = ${s.org_id} AND member_id = ${memberId}`);
  await del("event_log", sql`DELETE FROM event_log WHERE org_id = ${s.org_id} AND member_id = ${memberId}`);
  await del("sessions", sql`DELETE FROM sessions WHERE org_id = ${s.org_id} AND member_id = ${memberId}
      AND NOT EXISTS (SELECT 1 FROM sessions ch WHERE ch.parent_session_id = sessions.id AND ch.member_id <> ${memberId})`);
  await del("heartbeats", sql`DELETE FROM heartbeats WHERE org_id = ${s.org_id} AND member_id = ${memberId}`);
  await del("api_keys", sql`UPDATE api_keys SET revoked_at = NOW() WHERE org_id = ${s.org_id} AND member_id = ${memberId} AND revoked_at IS NULL`);
  if (deleteMember) {
    await del("member_row", sql`DELETE FROM members WHERE org_id = ${s.org_id} AND id = ${memberId}`);
  } else {
    await db.execute(sql`UPDATE members SET status = 'deactivated', deactivated_at = NOW() WHERE org_id = ${s.org_id} AND id = ${memberId}`);
  }

  await recordAudit(c, "member.data_erased", { type: "member", id: memberId }, { counts, delete_member: deleteMember });
  return c.json({ ok: true, member_id: memberId, deleted: counts });
});

// Delete the whole org. Everything cascades from the orgs row (FKs are
// ON DELETE CASCADE); requires typing the org slug to confirm.
orgdata.delete("/admin/org", async (c) => {
  const s = c.get("session");
  const body = (await c.req.json().catch(() => null)) as { confirm?: string } | null;
  const org = await db.query.orgs.findFirst({
    where: (o, { eq }) => eq(o.id, s.org_id),
    columns: { id: true, slug: true, name: true },
  });
  if (!org) return problem(c, 404, "not_found", "Org not found");
  if (!body?.confirm || body.confirm !== org.slug) {
    return problem(c, 400, "confirmation_required", `Pass {"confirm": "${org.slug}"} to delete this org and ALL its data`);
  }
  console.warn(`[orgdata] deleting org ${org.id} (${org.slug}) requested by member ${s.member_id}`);
  await db.execute(sql`DELETE FROM orgs WHERE id = ${s.org_id}`);
  return c.json({ ok: true, deleted_org: org.slug });
});
