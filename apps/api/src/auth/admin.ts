// Admin-role gate. Composes on top of dashboardAuth.

import type { Context, Next } from "hono";
import { db } from "../db/index.js";
import { problem } from "../lib/errors.js";
import { dashboardAuth } from "./session.js";

const ADMIN_ROLES = new Set(["owner", "admin"]);

export async function adminAuth(c: Context, next: Next) {
  const session = c.get("session");
  if (!session) return problem(c, 401, "unauthorized", "No session");
  const m = await db.query.members.findFirst({
    where: (m, { and, eq }) => and(eq(m.id, session.member_id), eq(m.orgId, session.org_id)),
    columns: { role: true, status: true },
  });
  if (!m || m.status !== "active" || !ADMIN_ROLES.has(m.role)) {
    return problem(c, 403, "forbidden", "Admin role required");
  }
  await next();
}

// Convenience: chain dashboard auth → admin auth.
export const requireAdmin = [dashboardAuth, adminAuth] as const;
