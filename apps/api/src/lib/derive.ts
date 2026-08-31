// Derive typed-table rows from event_log entries on ingest.
// event_log is the immutable source of truth; sessions / tool_events / insights /
// file_activity are denormalized projections used by the dashboard. Without this
// step, live events land only in event_log and the dashboard never sees them.

import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { reassertOpenBlocker, resolveOpenBlocker } from "./resolution.js";
import { scoreInsight } from "./quality.js";

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
    if (ev.eventKind === "turn.end") return await deriveTurnEnd(ev);
    if (ev.eventKind.startsWith("tool.")) return await deriveToolEvent(ev);
    if (ev.eventKind.startsWith("insight.")) return await deriveInsight(ev);
  } catch (err) {
    // Derivation failure must not reject the event_log write — that's the source of truth.
    // Persist to dead_letter_events so the dashboard can surface what's failing;
    // a backfill can rebuild from event_log later.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[derive] failed for", ev.eventKind, ev.id, err);
    try {
      await db.insert(schema.deadLetterEvents).values({
        orgId: ev.orgId,
        eventId: ev.id,
        payload: { eventKind: ev.eventKind, sessionId: ev.sessionId, payload: ev.payload },
        reason: `derive_failed:${ev.eventKind}`,
        lastError: message.slice(0, 2000),
      });
    } catch (dlErr) {
      // Last-resort: even the dead-letter write failed. Don't recurse.
      console.error("[derive] dead-letter write failed for", ev.id, dlErr);
    }
  }
}

async function deriveSessionStart(ev: DerivableEvent) {
  if (!ev.sessionId) return;
  const parentSessionId = parentSessionIdFromMeta(ev);
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
      parentSessionId,
    })
    .onConflictDoNothing({ target: schema.sessions.id });
}

// Insert a minimal "active" session row when a child event (tool/insight)
// arrives before its session.start was derived. onConflictDoNothing means a
// real session.start that lands later (or already landed) wins on the columns
// it owns; this only backfills the row's existence so the FK holds.
async function ensureSessionStub(ev: DerivableEvent) {
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
      parentSessionId: parentSessionIdFromMeta(ev),
    })
    .onConflictDoNothing({ target: schema.sessions.id });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parentSessionIdFromMeta(ev: DerivableEvent): string | null {
  const raw = strOrNull(ev.clientMeta.parent_session_id);
  if (!raw || !UUID_RE.test(raw)) return null;
  if (raw === ev.sessionId) return null;   // never self-reference
  return raw.toLowerCase();
}

async function deriveSessionEnd(ev: DerivableEvent) {
  if (!ev.sessionId) return;
  await ensureSessionStub(ev);
  const summary = strOrNull(ev.payload.summary);

  // Extract token usage from Claude Code's Stop hook payload, if present.
  // Shape: payload.usage = { input_tokens, output_tokens,
  //                          cache_creation_input_tokens,
  //                          cache_read_input_tokens }
  const usage = (ev.payload.usage ?? null) as Record<string, unknown> | null;
  const inputTokens = numOrZero(usage?.input_tokens);
  const outputTokens = numOrZero(usage?.output_tokens);
  const cacheCreationInputTokens = numOrZero(usage?.cache_creation_input_tokens);
  const cacheReadInputTokens = numOrZero(usage?.cache_read_input_tokens);

  // postgres-js + drizzle's raw sql`` doesn't auto-convert Date to timestamptz
  // via parameter binding — pre-serialize and cast in SQL.
  const hookTsIso = ev.hookTs.toISOString();

  // Last-wins with GREATEST: session.end comes from Claude Code's SessionEnd
  // hook (older hook versions emit it on every Stop instead). Taking the
  // latest end time and recomputing duration from it is correct for both:
  // for per-turn legacy ends the final turn IS the session end, and for
  // orchestrator sessions that absorb sub-agent ends, every sub-agent Stop
  // happens inside the orchestrator's own lifetime, so GREATEST never
  // inflates past the real end. event_log keeps all rows as canonical truth.
  await db
    .update(schema.sessions)
    .set({
      endedAt: sql`GREATEST(COALESCE(ended_at, ${hookTsIso}::timestamptz), ${hookTsIso}::timestamptz)`,
      status: "completed",
      updatedAt: new Date(),
      ...(summary !== null ? { summary } : {}),
      durationSeconds: sql`GREATEST(0, EXTRACT(EPOCH FROM (GREATEST(COALESCE(ended_at, ${hookTsIso}::timestamptz), ${hookTsIso}::timestamptz) - started_at))::int)`,
      // Token columns are accumulators across the session — for session.end we
      // overwrite (single emission per session). If the hook later supports
      // mid-session token reports, switch to GREATEST(existing, incoming).
      ...(inputTokens || outputTokens || cacheCreationInputTokens || cacheReadInputTokens
        ? {
            inputTokens,
            outputTokens,
            cacheCreationInputTokens,
            cacheReadInputTokens,
          }
        : {}),
    })
    .where(eq(schema.sessions.id, ev.sessionId));
}

// Stop fires after every assistant turn. A turn boundary only refreshes the
// session summary (the latest structured PROGRESS/DECISION/BLOCKED reply is
// the one worth keeping) — it never closes the session. stop_hook_active
// marks the reply to the structured-summary block prompt; prefer those, but
// accept any turn summary when none is flagged yet.
async function deriveTurnEnd(ev: DerivableEvent) {
  if (!ev.sessionId) return;
  await ensureSessionStub(ev);
  const summary = strOrNull(ev.payload.summary);
  if (summary === null) return;
  const structured = ev.payload.stop_hook_active === true;
  await db
    .update(schema.sessions)
    .set({ summary, updatedAt: new Date() })
    .where(
      structured
        ? eq(schema.sessions.id, ev.sessionId)
        : and(eq(schema.sessions.id, ev.sessionId), isNull(schema.sessions.endedAt)),
    );
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

  // Self-heal: ensure the parent session exists. session.start can be lost
  // (API down at session start, hook restart mid-session, out-of-order sync),
  // and tool_events.session_id is a NOT NULL FK — without this the insert
  // violates the constraint and the event is dead-lettered. A later
  // session.start/session.end fills/updates the same row.
  await ensureSessionStub(ev);

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

  // Redaction may have stripped edit/write bodies (dropDiffs), leaving the
  // pre-computed counts behind — prefer those, fall back to counting.
  let linesAdded = 0;
  let linesRemoved = 0;
  if (toolName === "Edit") {
    linesAdded = numOrNull(p.lines_added) ?? countLines(strOrNull(p.new_string) ?? "");
    linesRemoved = numOrNull(p.lines_removed) ?? countLines(strOrNull(p.old_string) ?? "");
  } else if (toolName === "Write") {
    linesAdded = numOrNull(p.lines_added) ?? countLines(strOrNull(p.content) ?? "");
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

  // Placeholder answers to the structured-summary prompt are noise, not
  // insights ("nothing", "None.", "n/a", "-"). Refuse them at the door.
  const normalized = content.trim().toLowerCase().replace(/[.!]+$/, "");
  if (
    content.trim().length < 8 ||
    /^(none|nothing|n\/a|na|no|nope|-|—|testing|nothing (new|to report)|no (new )?(work|blockers?|progress|decisions?))$/.test(normalized)
  ) {
    return;
  }

  // Self-heal the parent session (see deriveToolEvent). insights.session_id is
  // a nullable FK (ON DELETE SET NULL), but a stub keeps the insight attached
  // to its session for the dashboard's session tree rather than orphaning it.
  if (ev.sessionId) await ensureSessionStub(ev);

  let title = strOrNull(p.title);
  if (!title) {
    title = content.split("\n")[0]?.slice(0, 80) ?? null;
  }
  const reasoning = strOrNull(p.reasoning) ?? strOrNull(p.why) ?? null;

  // A blocker that trigram-matches an already-open blocker in this project is
  // the same blocker re-asserted (the Stop prompt repeats standing blockers
  // every turn) — bump its last_seen_at instead of stacking a duplicate.
  if (type === "blocker") {
    const re = await reassertOpenBlocker(ev.orgId, ev.projectId, content, ev.hookTs);
    if (re) {
      console.log(
        `[derive] blocker re-asserted → ${re.blockerId} (similarity=${re.similarity.toFixed(2)}), skipping duplicate insert`,
      );
      return;
    }
  }

  const qualityScore = scoreInsight({ content, reasoning });
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
      lastSeenAt: ev.hookTs,
    })
    .onConflictDoNothing({ target: schema.insights.id });
  // quality_score isn't in the Drizzle insights schema yet — write via raw SQL.
  await db.execute(sql`
    UPDATE insights SET quality_score = ${qualityScore.toFixed(2)}
     WHERE id = ${ev.id} AND quality_score = 0.50
  `);

  // If the payload claims this insight resolves a previously-flagged blocker,
  // trigram-match it against the project's open blockers and stamp resolved_at.
  // Triggered by either an explicit `payload.resolves` field or a content line
  // starting with "RESOLVED:" (the convention from the v2 prompt).
  const explicitResolves = strOrNull(p.resolves);
  const inlineResolves = extractResolvedLine(content);
  const resolveText = explicitResolves ?? inlineResolves;
  if (resolveText) {
    const r = await resolveOpenBlocker(ev.orgId, ev.projectId, resolveText, ev.hookTs);
    if (r.matched) {
      console.log(
        `[derive] resolved blocker ${r.blockerId} via similarity=${r.similarity.toFixed(2)} from insight ${ev.id}`,
      );
    }
  }
}

function extractResolvedLine(content: string): string | null {
  if (!content) return null;
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    const m = /^resolved:\s*(.+)$/i.exec(line);
    if (m && m[1]) return m[1].trim();
  }
  return null;
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

function numOrZero(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.floor(v);
  return 0;
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
