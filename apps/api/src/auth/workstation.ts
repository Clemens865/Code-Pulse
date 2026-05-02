// Bearer-token auth middleware for workstation requests.
// Looks up the API key by hashed value, attaches { orgId, memberId, apiKeyId } to ctx.

import type { Context, Next } from "hono";
import { eq, and, isNull } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { hashApiKey, isProbablyApiKey } from "../lib/keys.js";
import { problem } from "../lib/errors.js";

export type WorkstationAuth = {
  orgId: string;
  memberId: string;
  apiKeyId: string;
};

declare module "hono" {
  interface ContextVariableMap {
    auth: WorkstationAuth;
  }
}

export async function workstationAuth(c: Context, next: Next) {
  const header = c.req.header("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    return problem(c, 401, "unauthorized", "Missing bearer token");
  }
  const token = header.slice(7).trim();
  if (!isProbablyApiKey(token)) {
    return problem(c, 401, "unauthorized", "Malformed bearer token");
  }
  const hash = hashApiKey(token);
  const row = await db.query.apiKeys.findFirst({
    where: (k, { eq, and, isNull }) => and(eq(k.keyHash, hash), isNull(k.revokedAt)),
    columns: { id: true, orgId: true, memberId: true },
  });
  if (!row) {
    return problem(c, 401, "unauthorized", "Invalid or revoked API key");
  }
  c.set("auth", { orgId: row.orgId, memberId: row.memberId, apiKeyId: row.id });

  // Fire-and-forget: bump last_used_at. Don't await — keeps p99 low.
  void db
    .update(schema.apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(schema.apiKeys.id, row.id), isNull(schema.apiKeys.revokedAt)))
    .catch(() => {});

  await next();
}
