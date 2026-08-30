// Dashboard auth endpoints.
// /v1/auth/dev-login is the LOCAL LOGIN for self-hosted installs: pass
// org_id + member_id, get a session. Gated by LOCAL_LOGIN (auto = non-prod
// only; true = always, for self-hosters without OAuth; false = never).
// /v1/auth/me returns the current session's member + org.
// /v1/auth/logout clears the cookie.

function localLoginEnabled(): boolean {
  if (env.LOCAL_LOGIN === "true") return true;
  if (env.LOCAL_LOGIN === "false") return false;
  return env.NODE_ENV !== "production";
}

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
    if (!localLoginEnabled()) {
      return problem(c, 404, "not_found", "Local login is disabled (set LOCAL_LOGIN=true to enable it on a self-hosted install)");
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

// Dev-only: list available orgs and their members so the dev sign-in page can
// render a clickable identity picker without first authenticating.
auth.get("/auth/dev-list", async (c) => {
  if (!localLoginEnabled()) {
    return problem(c, 404, "not_found", "Local login is disabled (set LOCAL_LOGIN=true to enable it on a self-hosted install)");
  }
  const orgs = await db.query.orgs.findMany({
    columns: { id: true, name: true, slug: true, plan: true },
    orderBy: (o, { asc }) => asc(o.name),
  });
  const out = await Promise.all(
    orgs.map(async (o) => {
      const members = await db.query.members.findMany({
        where: (m, { eq }) => eq(m.orgId, o.id),
        columns: { id: true, name: true, email: true, role: true, status: true },
        orderBy: (m, { asc }) => asc(m.name),
        limit: 10,
      });
      return { ...o, members };
    }),
  );
  return c.json({ orgs: out });
});
