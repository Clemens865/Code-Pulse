import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { env } from "../env.js";
import { problem } from "../lib/errors.js";

const startedAt = Date.now();

export const health = new Hono();

health.get("/health", (c) => {
  return c.json({
    ok: true,
    version: process.env.npm_package_version ?? "0.1.0",
    uptime_s: Math.floor((Date.now() - startedAt) / 1000),
  });
});

// Deep health requires shared canary token. Verifies DB connectivity + simple query.
health.get("/health/deep", async (c) => {
  const provided = c.req.header("x-canary-token");
  if (provided !== env.HEALTH_DEEP_TOKEN) {
    return problem(c, 401, "unauthorized", "Missing or invalid canary token");
  }
  try {
    const start = Date.now();
    await db.execute(sql`select 1 as ok`);
    const latencyMs = Date.now() - start;
    return c.json({ ok: true, db: "up", db_latency_ms: latencyMs });
  } catch (err) {
    return problem(c, 503, "service_unavailable", err instanceof Error ? err.message : "db error");
  }
});
