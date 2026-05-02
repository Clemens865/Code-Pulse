// Dashboard auth endpoints.
// /v1/auth/dev-login is the dev-mode shortcut: pass org_id + member_id, get a session.
// /v1/auth/me returns the current session's member + org.
// /v1/auth/logout clears the cookie.

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db/index.js";
import { env } from "../env.js";
import { problem } from "../lib/errors.js";
import {
  clearSessionCookie,
  dashboardAuth,
  issueSession,
  setSessionCookie,
} from "../auth/session.js";

export const auth = new Hono();

const devLoginSchema = z.object({
  org_id: z.string().uuid(),
  member_id: z.string().uuid(),
});

auth.post(
  "/auth/dev-login",
  zValidator("json", devLoginSchema, (result, c) => {
    if (!result.success) {
      return problem(c, 400, "schema_validation_failed", "Invalid request body");
    }
    return undefined;
  }),
  async (c) => {
    if (env.NODE_ENV === "production") {
      return problem(c, 404, "not_found", "Dev login is not enabled in production");
    }
    const { org_id, member_id } = c.req.valid("json");

    // Verify the (org, member) tuple exists.
    const member = await db.query.members.findFirst({
      where: (m, { and, eq }) => and(eq(m.id, member_id), eq(m.orgId, org_id)),
      columns: { id: true, name: true, email: true, role: true, status: true },
    });
    if (!member) {
      return problem(c, 404, "not_found", "Org/member not found");
    }
    const token = issueSession(org_id, member_id);
    setSessionCookie(c, token);
    return c.json({ ok: true, member });
  },
);

auth.get("/auth/me", dashboardAuth, async (c) => {
  const s = c.get("session");
  const [member, org] = await Promise.all([
    db.query.members.findFirst({
      where: (m, { eq }) => eq(m.id, s.member_id),
      columns: { id: true, name: true, email: true, role: true, status: true },
    }),
    db.query.orgs.findFirst({
      where: (o, { eq }) => eq(o.id, s.org_id),
      columns: { id: true, name: true, slug: true, plan: true },
    }),
  ]);
  if (!member || !org) return problem(c, 404, "not_found", "Session refers to missing data");
  return c.json({ member, org });
});

auth.post("/auth/logout", async (c) => {
  clearSessionCookie(c);
  return c.json({ ok: true });
});
