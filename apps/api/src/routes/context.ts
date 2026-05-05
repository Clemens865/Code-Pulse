// GET /v1/projects/:id/context — SessionStart context payload.
//
// Two callers:
//   1. The hook on SessionStart, authenticated via workstation API key.
//      Use `?remote_url=<url>` to resolve the project by canonical_key
//      instead of by id (since the hook only knows the git remote URL).
//   2. The dashboard, authenticated via session cookie. Pass the project
//      id directly.
//
// Two response formats:
//   - default JSON ({ ...payload, text: <rendered string> })
//   - `?format=text` returns just the rendered text block (text/plain)

import { Hono } from "hono";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { workstationAuth } from "../auth/workstation.js";
import { dashboardAuth } from "../auth/session.js";
import { problem } from "../lib/errors.js";
import { normalizeRemoteUrl } from "../lib/projects.js";
import { composeContext, renderContext } from "../lib/context.js";

export const contextRoute = new Hono();

const querySchema = z.object({
  format: z.enum(["json", "text"]).optional().default("json"),
  remote_url: z.string().optional(),
});

// Workstation-auth path — hook calls this with API key.
//   GET /v1/context?remote_url=https://github.com/foo/bar.git
// or
//   GET /v1/context?project_id=<uuid>
// Mounted outside /projects/* to avoid the dashboard-auth middleware on that
// prefix. Same response shape as the dashboard route below.
contextRoute.get("/context", workstationAuth, async (c) => {
  const auth = c.get("auth");
  const parsed = querySchema.extend({ project_id: z.string().uuid().optional() }).safeParse(c.req.query());
  if (!parsed.success) return problem(c, 400, "schema_validation_failed", "Invalid query");
  const { format, remote_url, project_id } = parsed.data;
  if (!remote_url && !project_id) {
    return problem(c, 400, "schema_validation_failed", "Either remote_url or project_id is required");
  }

  const project = await resolveProject(auth.orgId, project_id ?? "", remote_url ?? null);
  if (!project) return problem(c, 404, "not_found", "Project not found");

  const payload = await composeContext({
    orgId: auth.orgId,
    projectId: project.id,
    callerMemberId: auth.memberId,
  });

  if (format === "text") {
    c.header("content-type", "text/plain; charset=utf-8");
    return c.body(renderContext(payload));
  }
  return c.json({ ...payload, text: renderContext(payload) });
});

// Dashboard-auth alternate path. Same response shape but expects a
// real project UUID (no remote_url shortcut).
contextRoute.get("/dashboard/projects/:id/context", dashboardAuth, async (c) => {
  const session = c.get("session");
  const idParam = c.req.param("id");
  const parsed = querySchema.safeParse(c.req.query());
  if (!parsed.success) return problem(c, 400, "schema_validation_failed", "Invalid query");
  const { format } = parsed.data;
  if (!idParam) return problem(c, 400, "schema_validation_failed", "Missing project id");

  const project = await db.query.projects.findFirst({
    where: (p, { and, eq }) => and(eq(p.id, idParam), eq(p.orgId, session.org_id)),
    columns: { id: true, name: true, remoteUrl: true },
  });
  if (!project) return problem(c, 404, "not_found", "Project not found");

  const payload = await composeContext({
    orgId: session.org_id,
    projectId: project.id,
    callerMemberId: session.member_id,
  });

  if (format === "text") {
    c.header("content-type", "text/plain; charset=utf-8");
    return c.body(renderContext(payload));
  }
  return c.json({ ...payload, text: renderContext(payload) });
});

async function resolveProject(
  orgId: string,
  idParam: string,
  remoteUrl: string | null,
): Promise<{ id: string; name: string; remoteUrl: string | null } | null> {
  // Prefer remote_url lookup when supplied — that's how the hook calls.
  if (remoteUrl) {
    const { canonicalKey } = normalizeRemoteUrl(remoteUrl);
    if (canonicalKey) {
      const p = await db.query.projects.findFirst({
        where: (p, { and, eq }) =>
          and(eq(p.orgId, orgId), eq(p.canonicalKey, canonicalKey)),
        columns: { id: true, name: true, remoteUrl: true },
      });
      if (p) return p;
    }
  }
  // Otherwise treat :id as the project UUID.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idParam)) {
    const p = await db.query.projects.findFirst({
      where: (p, { and, eq }) => and(eq(p.orgId, orgId), eq(p.id, idParam)),
      columns: { id: true, name: true, remoteUrl: true },
    });
    if (p) return p;
  }
  return null;
}
