import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { env } from "./env.js";
import { problem } from "./lib/errors.js";
import { health } from "./routes/health.js";
import { events } from "./routes/events.js";
import { auth } from "./routes/auth.js";
import { projects } from "./routes/projects.js";
import { timeline } from "./routes/timeline.js";
import { members } from "./routes/members.js";
import { insightsRoute } from "./routes/insights.js";
import { reports } from "./routes/reports.js";
import { admin } from "./routes/admin.js";
import { sessionsRoute } from "./routes/sessions.js";
import { startBackgroundJobs } from "./lib/jobs.js";

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: env.DASHBOARD_ORIGINS,
    credentials: true,
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "X-Canary-Token"],
  }),
);

// Trace ID on every response.
app.use("*", async (c, next) => {
  const traceId =
    c.req.header("x-trace-id") ?? crypto.randomUUID();
  c.header("X-Trace-Id", traceId);
  await next();
});

// Mount v1.
app.route("/v1", health);
app.route("/v1", events);
app.route("/v1", auth);
app.route("/v1", projects);
app.route("/v1", timeline);
app.route("/v1", members);
app.route("/v1", insightsRoute);
app.route("/v1", reports);
app.route("/v1", admin);
app.route("/v1", sessionsRoute);

// Default 404.
app.notFound((c) => problem(c, 404, "not_found", "Route not found"));

// Default error handler.
app.onError((err, c) => {
  console.error("[error]", err);
  return problem(c, 500, "server_error", err instanceof Error ? err.message : "Unknown error");
});

const server = serve({ fetch: app.fetch, port: env.PORT, hostname: "0.0.0.0" }, (info) => {
  console.log(`[api] listening on http://${info.address}:${info.port}`);
});

// Periodic background work (crashed-session reclamation, etc.)
startBackgroundJobs();

const shutdown = (signal: string) => {
  console.log(`[api] received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
