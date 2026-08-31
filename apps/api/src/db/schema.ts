// Drizzle table definitions for query type inference.
// The canonical DDL lives in drizzle/migrations/0000_init.sql (copy of docs/team-saas/SCHEMA.sql).
// When the SQL changes, mirror the changes here.

import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ───────────── helpers ─────────────
const citext = customType<{ data: string; driverData: string }>({
  dataType: () => "citext",
});
const inet = customType<{ data: string; driverData: string }>({
  dataType: () => "inet",
});
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});

// ───────────── enums ─────────────
export const planTier = pgEnum("plan_tier", ["free", "studio", "team", "enterprise"]);
export const memberRole = pgEnum("member_role", ["owner", "admin", "lead", "member"]);
export const memberStatus = pgEnum("member_status", ["invited", "active", "stale", "deactivated"]);
export const projectStatus = pgEnum("project_status", ["active", "archived"]);
export const redactionMode = pgEnum("redaction_mode", ["off", "standard", "strict"]);
export const insightType = pgEnum("insight_type", [
  "progress",
  "decision",
  "blocker",
  "pattern",
  "fix",
  "context",
]);
export const eventKind = pgEnum("event_kind", [
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
export const blueprintStatus = pgEnum("blueprint_status", ["running", "completed", "failed"]);

// ───────────── orgs / teams / members / policies ─────────────
export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: citext("slug").notNull().unique(),
  plan: planTier("plan").notNull().default("free"),
  billingEmail: citext("billing_email"),
  retentionDays: integer("retention_days").notNull().default(365),
  defaultRedactionPolicyId: uuid("default_redaction_policy_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("teams_org_idx").on(t.orgId),
    nameUq: uniqueIndex("teams_org_name_uq").on(t.orgId, t.name),
  }),
);

export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    email: citext("email").notNull(),
    name: text("name"),
    role: memberRole("role").notNull().default("member"),
    status: memberStatus("status").notNull().default("invited"),
    oauthProvider: text("oauth_provider"),
    oauthSubject: text("oauth_subject"),
    invitedBy: uuid("invited_by"),
    invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgEmailUq: uniqueIndex("members_org_email_uq").on(t.orgId, t.email),
    statusIdx: index("members_org_status_idx").on(t.orgId, t.status),
  }),
);

export const redactionPolicies = pgTable(
  "redaction_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mode: redactionMode("mode").notNull().default("standard"),
    dropDiffs: boolean("drop_diffs").notNull().default(true),
    hashFilePaths: boolean("hash_file_paths").notNull().default(false),
    dropPrompts: boolean("drop_prompts").notNull().default(true),
    regexRedactions: jsonb("regex_redactions").notNull().default([]),
    maxPayloadBytes: integer("max_payload_bytes").notNull().default(65536),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgNameUq: uniqueIndex("redaction_policies_org_name_uq").on(t.orgId, t.name),
    orgIdx: index("redaction_policies_org_idx").on(t.orgId),
  }),
);

// ───────────── projects ─────────────
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    canonicalKey: text("canonical_key").notNull(),
    name: text("name").notNull(),
    vcsProvider: text("vcs_provider"),
    vcsRepoId: text("vcs_repo_id"),
    remoteUrl: text("remote_url"),
    redactionPolicyId: uuid("redaction_policy_id").references(() => redactionPolicies.id, {
      onDelete: "set null",
    }),
    status: projectStatus("status").notNull().default("active"),
    needsReview: boolean("needs_review").notNull().default(true),
    createdBy: uuid("created_by").references(() => members.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => ({
    canonicalUq: uniqueIndex("projects_org_canonical_uq").on(t.orgId, t.canonicalKey),
    statusIdx: index("projects_org_status_idx").on(t.orgId, t.status),
  }),
);

// Every canonical_key a project has ever been seen under. resolveOrCreateProject
// resolves through this table, so the six remote_url formats the hook emits for
// one physical directory all land on the same project. See 0005_project_aliases.sql.
export const projectAliases = pgTable(
  "project_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    canonicalKey: text("canonical_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyUq: uniqueIndex("project_aliases_org_canonical_uq").on(t.orgId, t.canonicalKey),
    projectIdx: index("project_aliases_project_idx").on(t.projectId),
  }),
);

export const memberProjectAccess = pgTable("member_project_access", {
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  role: memberRole("role").notNull().default("member"),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  grantedBy: uuid("granted_by").references(() => members.id, { onDelete: "set null" }),
});

// ───────────── api keys ─────────────
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
    label: text("label"),
    keyHash: bytea("key_hash").notNull(),
    keyLast4: text("key_last4").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    lastSeenMeta: jsonb("last_seen_meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    keyHashUq: uniqueIndex("api_keys_key_hash_uq").on(t.keyHash),
    memberIdx: index("api_keys_member_idx").on(t.memberId),
    orgIdx: index("api_keys_org_idx").on(t.orgId),
  }),
);

// ───────────── event log ─────────────
export const eventLog = pgTable(
  "event_log",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "restrict" }),
    sessionId: uuid("session_id"),
    eventKind: eventKind("event_kind").notNull(),
    payload: jsonb("payload").notNull(),
    clientMeta: jsonb("client_meta").notNull().default({}),
    hookTs: timestamp("hook_ts", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    redactionApplied: jsonb("redaction_applied").notNull().default({}),
    apiKeyId: uuid("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
  },
  (t) => ({
    orgReceivedIdx: index("event_log_org_received_idx").on(t.orgId, t.receivedAt),
    orgProjectReceivedIdx: index("event_log_org_project_received_idx").on(
      t.orgId,
      t.projectId,
      t.receivedAt,
    ),
    orgMemberReceivedIdx: index("event_log_org_member_received_idx").on(
      t.orgId,
      t.memberId,
      t.receivedAt,
    ),
    sessionIdx: index("event_log_session_idx").on(t.sessionId),
  }),
);

// ───────────── derived tables (subset needed for ingest writes) ─────────────
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "restrict" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  durationSeconds: integer("duration_seconds"),
  summary: text("summary"),
  status: text("status").notNull().default("active"),
  hostname: text("hostname"),
  cloudEnv: text("cloud_env"),
  hookVersion: text("hook_version"),
  inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
  outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
  cacheCreationInputTokens: bigint("cache_creation_input_tokens", { mode: "number" }).notNull().default(0),
  cacheReadInputTokens: bigint("cache_read_input_tokens", { mode: "number" }).notNull().default(0),
  stuckScore: text("stuck_score").notNull().default("0"),
  stuckSignals: jsonb("stuck_signals").notNull().default({}),
  stuckScoredAt: timestamp("stuck_scored_at", { withTimezone: true }),
  parentSessionId: uuid("parent_session_id").references((): AnyPgColumn => sessions.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const heartbeats = pgTable("heartbeats", {
  apiKeyId: uuid("api_key_id")
    .primaryKey()
    .references(() => apiKeys.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  hostname: text("hostname"),
  cloudEnv: text("cloud_env"),
  hookVersion: text("hook_version"),
  outboxDepth: integer("outbox_depth").notNull().default(0),
  lastEventId: uuid("last_event_id"),
  lastEventTs: timestamp("last_event_ts", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deadLetterEvents = pgTable("dead_letter_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  orgId: uuid("org_id").references(() => orgs.id, { onDelete: "cascade" }),
  apiKeyId: uuid("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
  eventId: uuid("event_id"),
  payload: jsonb("payload").notNull(),
  reason: text("reason").notNull(),
  retryCount: integer("retry_count").notNull().default(0),
  lastError: text("last_error"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const insights = pgTable("insights", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "restrict" }),
  type: insightType("type").notNull(),
  title: text("title"),
  content: text("content").notNull(),
  reasoning: text("reasoning"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const toolEvents = pgTable("tool_events", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "restrict" }),
  toolName: text("tool_name").notNull(),
  ts: timestamp("ts", { withTimezone: true }).notNull(),
  filePath: text("file_path"),
  language: text("language"),
  linesAdded: integer("lines_added").notNull().default(0),
  linesRemoved: integer("lines_removed").notNull().default(0),
  command: text("command"),
  detectedFramework: text("detected_framework"),
  commandFailed: boolean("command_failed").notNull().default(false),
  searchPattern: text("search_pattern"),
  agentType: text("agent_type"),
  agentDescription: text("agent_description"),
  skillName: text("skill_name"),
  skillArgs: text("skill_args"),
  diffExcerpt: text("diff_excerpt"),
  metadata: jsonb("metadata").notNull().default({}),
});

export const fileActivity = pgTable("file_activity", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  filePath: text("file_path").notNull(),
  date: date("date").notNull(),
  editCount: integer("edit_count").notNull().default(0),
  writeCount: integer("write_count").notNull().default(0),
  readCount: integer("read_count").notNull().default(0),
  linesAdded: integer("lines_added").notNull().default(0),
  linesRemoved: integer("lines_removed").notNull().default(0),
  language: text("language"),
});

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  actorMemberId: uuid("actor_member_id").references(() => members.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  payload: jsonb("payload").notNull().default({}),
  ip: inet("ip"),
  userAgent: text("user_agent"),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
});

