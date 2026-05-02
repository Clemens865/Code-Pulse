// Audit-log helper. Always called inside admin write handlers.

import type { Context } from "hono";
import { db, schema } from "../db/index.js";

export async function recordAudit(
  c: Context,
  action: string,
  target?: { type?: string; id?: string },
  payload: Record<string, unknown> = {},
) {
  const s = c.get("session");
  if (!s) return;
  await db.insert(schema.auditLog).values({
    orgId: s.org_id,
    actorMemberId: s.member_id,
    action,
    targetType: target?.type ?? null,
    targetId: target?.id ?? null,
    payload,
    ip: c.req.header("x-forwarded-for") ?? null,
    userAgent: c.req.header("user-agent") ?? null,
  });
}
