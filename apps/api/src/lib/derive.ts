// Derive typed-table rows from event_log entries on ingest.
// event_log is the immutable source of truth; sessions / tool_events / insights /
// file_activity are denormalized projections used by the dashboard. Without this
// step, live events land only in event_log and the dashboard never sees them.

import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export type DerivableEvent = {
  id: string;
  orgId: string;
  memberId: string;
  projectId: string;
  sessionId: string | null;
  eventKind: string;
  payload: Record<string, unknown>; // already redacted by applyRedaction
  clientMeta: Record<string, unknown>;
  hookTs: Date;
};

export async function deriveEvent(ev: DerivableEvent): Promise<void> {
  try {
    if (ev.eventKind === "session.start") return await deriveSessionStart(ev);
    if (ev.eventKind === "session.end") return await deriveSessionEnd(ev);
    if (ev.eventKind.startsWith("tool.")) return await deriveToolEvent(ev);
    if (ev.eventKind.startsWith("insight.")) return await deriveInsight(ev);
  } catch (err) {
    // Derivation failure must not reject the event_log write — that's the source of truth.
    // Log and move on; a backfill can rebuild from event_log later.
    console.error("[derive] failed for", ev.eventKind, ev.id, err);
  }
}

async function deriveSessionStart(ev: DerivableEvent) {
  if (!ev.sessionId) return;
  await db
    .insert(schema.sessions)
    .values({
      id: ev.sessionId,
      orgId: ev.orgId,
      memberId: ev.memberId,
      projectId: ev.projectId,
      startedAt: ev.hookTs,
      status: "active",
      hostname: strOrNull(ev.clientMeta.hostname),
      cloudEnv: strOrNull(ev.clientMeta.cloud_env),
      hookVersion: strOrNull(ev.clientMeta.hook_version),
    })
    .onConflictDoNothing({ target: schema.sessions.id });
}

async function deriveSessionEnd(ev: DerivableEvent) {
  if (!ev.sessionId) return;
  const summary = strOrNull(ev.payload.summary);
  await db
    .update(schema.sessions)
    .set({
      endedAt: ev.hookTs,
      status: "completed",
      ...(summary !== null ? { summary } : {}),
      durationSeconds: sql`GREATEST(0, EXTRACT(EPOCH FROM (${ev.hookTs}::timestamptz - started_at))::int)`,
    })
    .where(eq(schema.sessions.id, ev.sessionId));
}

const TOOL_KIND_TO_NAME: Record<string, string> = {
  "tool.edit": "Edit",
  "tool.write": "Write",
  "tool.read": "Read",
  "tool.bash": "Bash",
  "tool.glob": "Glob",
  "tool.grep": "Grep",
  "tool.agent": "Agent",
  "tool.skill": "Skill",
  "tool.web_fetch": "WebFetch",
  "tool.web_search": "WebSearch",
  "tool.tool_search": "ToolSearch",
};

async function deriveToolEvent(ev: DerivableEvent) {
  if (!ev.sessionId) return; // tool_events.session_id is NOT NULL
  const toolName = TOOL_KIND_TO_NAME[ev.eventKind];
  if (!toolName) return;

  const p = ev.payload;
  const filePath = strOrNull(p.file_path);
  const language = filePath ? languageFromPath(filePath) : null;

  let command: string | null = null;
  let commandFailed = false;
  if (toolName === "Bash") {
    command = strOrNull(p.command);
    const exitCode = numOrNull(p.exit_code);
    const error = strOrNull(p.error);
    commandFailed = (exitCode !== null && exitCode !== 0) || error !== null;
  }

  let linesAdded = 0;
  let linesRemoved = 0;
  if (toolName === "Edit") {
    linesAdded = countLines(strOrNull(p.new_string) ?? "");
    linesRemoved = countLines(strOrNull(p.old_string) ?? "");
  } else if (toolName === "Write") {
    linesAdded = countLines(strOrNull(p.content) ?? "");
  }

  await db
    .insert(schema.toolEvents)
    .values({
      id: ev.id,
      orgId: ev.orgId,
      sessionId: ev.sessionId,
      memberId: ev.memberId,
      projectId: ev.projectId,
      toolName,
      ts: ev.hookTs,
      filePath,
      language,
      linesAdded,
      linesRemoved,
      command,
      commandFailed,
      searchPattern: strOrNull(p.pattern),
      agentType: strOrNull(p.subagent_type) ?? strOrNull(p.agent_type),
      agentDescription: strOrNull(p.description),
      skillName: strOrNull(p.skill_name) ?? strOrNull(p.skill),
      skillArgs: jsonStringOrNull(p.skill_args),
      diffExcerpt: null,
      metadata: {},
    })
    .onConflictDoNothing({ target: schema.toolEvents.id });

  if (filePath && (toolName === "Edit" || toolName === "Write" || toolName === "Read")) {
    await upsertFileActivity(ev, filePath, toolName, language, linesAdded, linesRemoved);
  }
}

const VALID_INSIGHT_TYPES = new Set(["progress", "decision", "blocker", "pattern", "fix", "context"]);

async function deriveInsight(ev: DerivableEvent) {
  const type = ev.eventKind.split(".")[1];
  if (!type || !VALID_INSIGHT_TYPES.has(type)) return;

  const p = ev.payload;
  const content = strOrNull(p.content) ?? strOrNull(p.text) ?? "";
  if (!content) return;

  let title = strOrNull(p.title);
  if (!title) {
    title = content.split("\n")[0]?.slice(0, 80) ?? null;
  }
  const reasoning = strOrNull(p.reasoning) ?? strOrNull(p.why) ?? null;

  await db
    .insert(schema.insights)
    .values({
      id: ev.id,
      orgId: ev.orgId,
      sessionId: ev.sessionId,
      memberId: ev.memberId,
      projectId: ev.projectId,
      type: type as "progress" | "decision" | "blocker" | "pattern" | "fix" | "context",
      title,
      content,
      reasoning,
      createdAt: ev.hookTs,
    })
    .onConflictDoNothing({ target: schema.insights.id });
}

async function upsertFileActivity(
  ev: DerivableEvent,
  filePath: string,
  toolName: string,
  language: string | null,
  linesAdded: number,
  linesRemoved: number,
) {
  const date = ev.hookTs.toISOString().slice(0, 10);
  const editIncr = toolName === "Edit" ? 1 : 0;
  const writeIncr = toolName === "Write" ? 1 : 0;
  const readIncr = toolName === "Read" ? 1 : 0;

  await db
    .insert(schema.fileActivity)
    .values({
      orgId: ev.orgId,
      projectId: ev.projectId,
      filePath,
      date,
      editCount: editIncr,
      writeCount: writeIncr,
      readCount: readIncr,
      linesAdded,
      linesRemoved,
      language,
    })
    .onConflictDoUpdate({
      target: [schema.fileActivity.projectId, schema.fileActivity.filePath, schema.fileActivity.date],
      set: {
        editCount: sql`${schema.fileActivity.editCount} + ${editIncr}`,
        writeCount: sql`${schema.fileActivity.writeCount} + ${writeIncr}`,
        readCount: sql`${schema.fileActivity.readCount} + ${readIncr}`,
        linesAdded: sql`${schema.fileActivity.linesAdded} + ${linesAdded}`,
        linesRemoved: sql`${schema.fileActivity.linesRemoved} + ${linesRemoved}`,
        language: sql`COALESCE(${schema.fileActivity.language}, EXCLUDED.language)`,
      },
    });
}

// ──────────────────── helpers ────────────────────

function strOrNull(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function jsonStringOrNull(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  if (v && typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return null;
    }
  }
  return null;
}

function countLines(s: string): number {
  if (!s) return 0;
  // Count newline characters; this gives "lines that exist" which is the closest
  // simple proxy without a real diff.
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n + (s.length > 0 ? 1 : 0);
}

const EXT_TO_LANG: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript",
  js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  py: "Python", rb: "Ruby", java: "Java", kt: "Kotlin",
  rs: "Rust", go: "Go", cs: "C#", swift: "Swift",
  c: "C", h: "C", cpp: "C++", hpp: "C++", cc: "C++",
  md: "Markdown", json: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML",
  html: "HTML", css: "CSS", scss: "CSS", sass: "CSS",
  sh: "Shell", bash: "Shell", zsh: "Shell", fish: "Shell",
  sql: "SQL", graphql: "GraphQL", gql: "GraphQL",
  proto: "Protobuf", dockerfile: "Dockerfile",
};

function languageFromPath(filePath: string): string | null {
  const base = filePath.split("/").pop() ?? "";
  if (base.toLowerCase() === "dockerfile") return "Dockerfile";
  const m = /\.([a-z0-9]+)$/i.exec(base);
  if (!m || !m[1]) return null;
  return EXT_TO_LANG[m[1].toLowerCase()] ?? null;
}
