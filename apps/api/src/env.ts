import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8787),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  DATABASE_URL: z.string().url(),
  API_KEY_PEPPER: z.string().min(32, "API_KEY_PEPPER must be at least 32 characters"),
  HEALTH_DEEP_TOKEN: z.string().min(16, "HEALTH_DEEP_TOKEN must be at least 16 characters"),
  DASHBOARD_ORIGINS: z
    .string()
    .default("http://localhost:3142")
    .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean)),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  // Local (identity-picker) login for the dashboard. "auto" enables it outside
  // production only; self-hosters running NODE_ENV=production without OAuth set
  // LOCAL_LOGIN=true deliberately. "false" disables it everywhere.
  LOCAL_LOGIN: z.enum(["auto", "true", "false"]).default("auto"),
  // Open blockers not re-asserted (or explicitly resolved) within this many
  // days are auto-resolved as stale by the background job. 0 disables the sweep.
  BLOCKER_STALE_DAYS: z.coerce.number().int().min(0).default(14),
  // Optional: enables pattern auto-suggest at Stop time (Sprint 8). When unset,
  // the suggestion endpoint returns empty — feature flag, not failure.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-haiku-4-5-20251001"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("[env] invalid environment:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
