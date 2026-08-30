import { z } from "zod";

const ISO_DATETIME = z.string().datetime({ offset: true });

export const eventKindSchema = z.enum([
  "session.start",
  "session.end",
  "turn.end",
  "prompt.submit",
  "tool.edit",
  "tool.write",
  "tool.read",
  "tool.bash",
  "tool.glob",
  "tool.grep",
  "tool.agent",
  "tool.skill",
  "tool.web_fetch",
  "tool.web_search",
  "tool.tool_search",
  "insight.progress",
  "insight.decision",
  "insight.blocker",
  "insight.pattern",
  "insight.fix",
  "insight.context",
  "blueprint.run",
  "heartbeat",
]);

export const projectRefSchema = z.object({
  remote_url: z.string().min(1).max(2048),
  vcs_provider: z.string().max(64).optional(),
  vcs_repo_id: z.string().max(128).optional(),
});

// fingerprint carries every project-identity signal the hook computed for this
// session. The server picks the strongest one as primary canonical_key and
// registers the rest as aliases — this closes the local://basename →
// github.com/owner/repo re-fragmentation that the alias table alone can't catch
// (alias lookup only works on keys we've seen before; fingerprint introduces
// new ones up-front, all on one project).
export const fingerprintSchema = z.object({
  git_remote: z.string().max(2048).optional(),
  common_dir: z.string().max(4096).optional(),
  basename: z.string().max(255).optional(),
});

export const clientMetaSchema = z
  .object({
    hook_version: z.string().max(64).optional(),
    os: z.string().max(64).optional(),
    cloud_env: z.string().max(64).optional(),
    hostname: z.string().max(255).optional(),
    fingerprint: fingerprintSchema.optional(),
  })
  .passthrough(); // tolerate forward-compatible client_meta fields (e.g. parent_session_id)

export const eventSchema = z.object({
  id: z.string().uuid(),
  kind: eventKindSchema,
  session_id: z.string().uuid().optional(),
  project: projectRefSchema,
  client: clientMetaSchema.default({}),
  hook_ts: ISO_DATETIME,
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type IngestEvent = z.infer<typeof eventSchema>;

export const ingestRequestSchema = z.object({
  v: z.literal(1),
  events: z.array(eventSchema).min(1).max(100),
});

export type IngestRequest = z.infer<typeof ingestRequestSchema>;

export const ingestResultSchema = z.object({
  received: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  rejected: z
    .array(
      z.object({
        id: z.string().uuid(),
        reason: z.string(),
        detail: z.string().optional(),
      }),
    )
    .default([]),
  results: z
    .array(
      z.object({
        id: z.string().uuid(),
        status: z.enum(["accepted", "duplicate", "rejected"]),
      }),
    )
    .default([]),
});

export type IngestResult = z.infer<typeof ingestResultSchema>;
