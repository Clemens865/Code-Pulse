// One-shot importer: copies the legacy single-user Claude Pulse SQLite tracker
// (~/.claude-pulse/tracker.db) into the team Postgres DB, attributing all rows
// to a single fresh org+member ("Clemens Hoenig").
//
// Run with --dry-run first to print counts; --apply writes.
//   set -a && source .env && set +a
//   npx tsx scripts/import-from-og-pulse.ts --dry-run
//   npx tsx scripts/import-from-og-pulse.ts --apply

import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import postgres from "postgres";
import { env } from "../src/env.js";
import { normalizeRemoteUrl } from "../src/lib/projects.js";

const SRC = process.env.OG_DB ?? `${homedir()}/.claude-pulse/tracker.db`;
const ORG_NAME = "Clemens Hoenig";
const ORG_SLUG = "clemens-hoenig";
const MEMBER_NAME = "Clemens Hoenig";
const MEMBER_EMAIL = "clemens_hoenig@hotmail.com";

const APPLY = process.argv.includes("--apply");
const DRY = !APPLY;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s: string | null | undefined): boolean {
  return !!s && UUID_RE.test(s);
}

// Deterministic UUIDv5 from a string, namespaced under a fixed root.
const NS = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex"); // RFC 4122 URL ns
function uuid5(input: string): string {
  const h = createHash("sha1").update(NS).update(input).digest();
  h[6] = (h[6] & 0x0f) | 0x50; // v5
  h[8] = (h[8] & 0x3f) | 0x80; // variant
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

// Map OG tool_name → event_kind enum value, or null if no clean mapping.
function toolNameToKind(toolName: string): string | null {
  const k = toolName.toLowerCase();
  if (k === "edit") return "tool.edit";
  if (k === "write") return "tool.write";
  if (k === "read") return "tool.read";
  if (k === "bash") return "tool.bash";
  if (k === "glob") return "tool.glob";
  if (k === "grep") return "tool.grep";
  if (k === "agent" || k === "task") return "tool.agent";
  if (k === "skill") return "tool.skill";
  if (k === "webfetch") return "tool.web_fetch";
  if (k === "websearch") return "tool.web_search";
  if (k === "toolsearch") return "tool.tool_search";
  return null;
}

function toIso(s: string | null): string | null {
  if (!s) return null;
  // OG stores "YYYY-MM-DD HH:MM:SS" without TZ — treat as UTC.
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2} /.test(s)) return s.replace(" ", "T") + "Z";
  return s;
}

function jsonOrNull(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function main() {
  console.log(`[import] source: ${SRC}`);
  console.log(`[import] mode:   ${APPLY ? "APPLY (writes)" : "DRY-RUN (no writes)"}`);
  console.log("");

  const og = new Database(SRC, { readonly: true, fileMustExist: true });
  const sql = postgres(env.DATABASE_URL, { max: 5, prepare: false });

  try {
    await runImport(og, sql);
  } finally {
    og.close();
    await sql.end();
  }
}

main().catch((err) => {
  console.error("[import] failed:", err);
  process.exit(1);
});

async function runImport(og: Database.Database, sql: postgres.Sql) {
  const summary: Record<string, number> = {};

  // 1. Org + member
  const orgId = await ensureOrg(sql);
  const memberId = await ensureMember(sql, orgId);
  summary.org = 1;
  summary.member = 1;

  // 2. Projects (dedup by lowercased name)
  const projectMap = await ensureProjects(og, sql, orgId);
  summary.projects = projectMap.size;

  // 3. Sessions
  summary.sessions = await importSessions(og, sql, orgId, memberId, projectMap);

  // 4. Tool events
  summary.toolEvents = await importToolEvents(og, sql, orgId, memberId, projectMap);

  // 5. Insights
  summary.insights = await importInsights(og, sql, orgId, memberId, projectMap);

  // 6. File activity
  summary.fileActivity = await importFileActivity(og, sql, orgId, projectMap);

  // 7. Daily summaries
  summary.dailySummaries = await importDailySummaries(og, sql, orgId, projectMap);

  // 8. Blueprint runs
  summary.blueprintRuns = await importBlueprintRuns(og, sql, orgId, memberId, projectMap);

  // 9. Synthesize event_log
  summary.eventLog = await synthesizeEventLog(og, sql, orgId, memberId, projectMap);

  console.log("");
  console.log("[import] summary:");
  for (const [k, v] of Object.entries(summary)) {
    console.log(`  ${k.padEnd(16)} ${v}`);
  }
  console.log("");
  if (DRY) console.log("[import] DRY-RUN — no writes performed. Re-run with --apply to commit.");
  else console.log("[import] done.");
}

// ──────────────────── helpers (write or report) ────────────────────

async function ensureOrg(sql: postgres.Sql): Promise<string> {
  const existing = await sql<{ id: string }[]>`SELECT id FROM orgs WHERE slug = ${ORG_SLUG} LIMIT 1`;
  if (existing.length > 0) {
    console.log(`[org] exists: ${existing[0].id}`);
    return existing[0].id;
  }
  const id = randomUUID();
  if (APPLY) {
    await sql`INSERT INTO orgs (id, name, slug, plan) VALUES (${id}, ${ORG_NAME}, ${ORG_SLUG}, 'free')`;
    console.log(`[org] created: ${id} (${ORG_NAME})`);
  } else {
    console.log(`[org] would create: ${id} (${ORG_NAME})`);
  }
  return id;
}

async function ensureMember(sql: postgres.Sql, orgId: string): Promise<string> {
  const existing = await sql<{ id: string }[]>`
    SELECT id FROM members WHERE org_id = ${orgId} AND email = ${MEMBER_EMAIL} LIMIT 1
  `;
  if (existing.length > 0) {
    console.log(`[member] exists: ${existing[0].id}`);
    return existing[0].id;
  }
  const id = randomUUID();
  if (APPLY) {
    await sql`
      INSERT INTO members (id, org_id, email, name, role, status)
      VALUES (${id}, ${orgId}, ${MEMBER_EMAIL}, ${MEMBER_NAME}, 'owner', 'active')
    `;
    console.log(`[member] created: ${id} (${MEMBER_NAME} <${MEMBER_EMAIL}>)`);
  } else {
    console.log(`[member] would create: ${id} (${MEMBER_NAME} <${MEMBER_EMAIL}>)`);
  }
  return id;
}

const SOFTWARE_PROJECTS_ROOT = join(homedir(), "Documents", "Software-Projects");

// Manual overrides for OG project names whose on-disk folder differs from the name
// or lives outside SOFTWARE_PROJECTS_ROOT.
const MANUAL_OVERRIDES: Record<string, string> = {
  "FPAW": join(homedir(), "Documents", "FPAW"),
  "Steuer 2025": join(homedir(), "Documents", "Steuer 2025"),
  "clemenshoenig": join(homedir(), "Documents", "Clemens Hoenig"),
};

function tryGitRemote(dir: string): string | null {
  if (!dir || !existsSync(join(dir, ".git"))) return null;
  try {
    const out = execFileSync("git", ["-C", dir, "config", "--get", "remote.origin.url"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

// Build a basename → absolute-path index for every directory under the root
// (depth-limited). Used to resolve OG project names to local paths even when
// they're nested (e.g. Art/NewSical) or differ in case.
function buildDirIndex(root: string, maxDepth = 3): Map<string, string> {
  const out = new Map<string, string>();
  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.startsWith(".") && e !== ".git") continue;
      const full = join(dir, e);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (!s.isDirectory()) continue;
      // Don't index the project's `.git` itself.
      if (e === ".git" || e === "node_modules" || e === "dist") continue;
      const lower = e.toLowerCase();
      if (!out.has(lower)) out.set(lower, full);
      walk(full, depth + 1);
    }
  }
  if (existsSync(root)) walk(root, 0);
  return out;
}

const DIR_INDEX = buildDirIndex(SOFTWARE_PROJECTS_ROOT);

function detectRemoteUrl(og: Database.Database, ogName: string): { remoteUrl: string; source: string } {
  // 0. Manual override.
  const override = MANUAL_OVERRIDES[ogName];
  if (override && existsSync(override)) {
    const url = tryGitRemote(override);
    if (url) return { remoteUrl: url, source: `override:${override}` };
    return { remoteUrl: `local:${override}`, source: `override-local:${override}` };
  }

  // 1. Try every non-empty project_path OG ever recorded for this name.
  const paths = og
    .prepare("SELECT DISTINCT project_path FROM sessions WHERE project = ? AND project_path != ''")
    .all(ogName) as { project_path: string }[];
  for (const p of paths) {
    const url = tryGitRemote(p.project_path);
    if (url) return { remoteUrl: url, source: `og:${p.project_path}` };
    if (existsSync(p.project_path) && basename(p.project_path).toLowerCase() !== "software-projects") {
      return { remoteUrl: `local:${p.project_path}`, source: `og-local:${p.project_path}` };
    }
  }

  // 2. Look up the OG name in the directory index (handles nested + case).
  const indexed = DIR_INDEX.get(ogName.toLowerCase());
  if (indexed && basename(indexed).toLowerCase() !== "software-projects") {
    const url = tryGitRemote(indexed);
    if (url) return { remoteUrl: url, source: `index:${indexed}` };
    return { remoteUrl: `local:${indexed}`, source: `index-local:${indexed}` };
  }

  // 3. Fallback to direct path under the root.
  const direct = join(SOFTWARE_PROJECTS_ROOT, ogName);
  if (existsSync(direct)) {
    const url = tryGitRemote(direct);
    if (url) return { remoteUrl: url, source: `probe:${direct}` };
    return { remoteUrl: `local:${direct}`, source: `probe-local:${direct}` };
  }

  // 4. Give up — synthesize from name only.
  return { remoteUrl: `local:${ogName.toLowerCase()}`, source: "synthetic" };
}

async function ensureProjects(
  og: Database.Database,
  sql: postgres.Sql,
  orgId: string,
): Promise<Map<string, string>> {
  // Collect distinct project names from all OG tables.
  const names = new Set<string>();
  for (const tbl of ["sessions", "daily_summaries", "file_activity", "blueprint_runs"]) {
    const rows = og.prepare(`SELECT DISTINCT project FROM ${tbl}`).all() as { project: string }[];
    for (const r of rows) if (r.project) names.add(r.project);
  }

  // Dedup by lowercased name → first-seen original spelling. Sort for stable output.
  const canon = new Map<string, string>();
  for (const n of [...names].sort()) {
    const k = n.toLowerCase();
    if (!canon.has(k)) canon.set(k, n);
  }

  // Resolve a real remote URL per canonical project name.
  type Resolved = {
    slug: string;
    name: string;
    remoteUrlRaw: string;
    canonicalKey: string;
    vcsProvider: string | null;
    source: string;
    isLocal: boolean;
  };
  const resolved: Resolved[] = [];
  for (const [slug, name] of canon) {
    const { remoteUrl, source } = detectRemoteUrl(og, name);
    const isLocal = remoteUrl.startsWith("local:");
    if (isLocal) {
      resolved.push({
        slug,
        name,
        remoteUrlRaw: remoteUrl,
        canonicalKey: remoteUrl,
        vcsProvider: null,
        source,
        isLocal: true,
      });
    } else {
      const norm = normalizeRemoteUrl(remoteUrl);
      resolved.push({
        slug,
        name,
        remoteUrlRaw: remoteUrl,
        canonicalKey: norm.canonicalKey,
        vcsProvider: norm.vcsProvider,
        source,
        isLocal: false,
      });
    }
  }

  // Pretty-print the mapping for review.
  console.log("[projects] resolution table:");
  console.log("  " + "name".padEnd(34) + "remote".padEnd(64) + "source");
  for (const r of resolved) {
    const tag = r.isLocal ? "(local)" : "(real) ";
    console.log("  " + r.name.padEnd(34) + (tag + " " + r.remoteUrlRaw).padEnd(64) + r.source);
  }
  const realCount = resolved.filter((r) => !r.isLocal).length;
  const localCount = resolved.length - realCount;
  console.log(`  → ${realCount} bound to real git remotes, ${localCount} synthetic local: keys`);

  const out = new Map<string, string>();

  for (const r of resolved) {
    const existing = await sql<{ id: string }[]>`
      SELECT id FROM projects WHERE org_id = ${orgId} AND canonical_key = ${r.canonicalKey} LIMIT 1
    `;
    let projectId: string;
    if (existing.length > 0) {
      projectId = existing[0].id;
    } else {
      projectId = uuid5(`project:${orgId}:${r.canonicalKey}`);
      if (APPLY) {
        await sql`
          INSERT INTO projects (id, org_id, name, remote_url, canonical_key, vcs_provider, status, needs_review)
          VALUES (${projectId}, ${orgId}, ${r.name}, ${r.remoteUrlRaw}, ${r.canonicalKey}, ${r.vcsProvider}, 'active', false)
          ON CONFLICT (org_id, canonical_key) DO NOTHING
        `;
      }
    }
    // Map every OG name variant (case-insensitive) to this project ID.
    for (const n of names) {
      if (n.toLowerCase() === r.slug) out.set(n, projectId);
    }
  }
  return out;
}

type SessionRow = {
  id: string;
  project: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  status: string;
  summary: string | null;
  hostname: string | null;
};

async function importSessions(
  og: Database.Database,
  sql: postgres.Sql,
  orgId: string,
  memberId: string,
  pmap: Map<string, string>,
): Promise<number> {
  const all = og.prepare("SELECT id, project, started_at, ended_at, duration_seconds, status, summary, hostname FROM sessions").all() as SessionRow[];
  const rows = all.filter((r) => isUuid(r.id));
  const skipped = all.length - rows.length;
  if (skipped > 0) console.log(`[sessions] skipping ${skipped} non-UUID rows (test fixtures)`);
  if (DRY) return rows.length;
  let n = 0;
  for (const batch of chunk(rows, 200)) {
    const values = batch
      .map((r) => {
        const pid = pmap.get(r.project);
        if (!pid) return null;
        return {
          id: r.id,
          org_id: orgId,
          member_id: memberId,
          project_id: pid,
          started_at: toIso(r.started_at),
          ended_at: toIso(r.ended_at),
          duration_seconds: r.duration_seconds,
          summary: r.summary,
          status: ["active", "completed", "crashed"].includes(r.status) ? r.status : "completed",
          hostname: r.hostname,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    if (values.length === 0) continue;
    const inserted = await sql`
      INSERT INTO sessions ${sql(values, "id", "org_id", "member_id", "project_id", "started_at", "ended_at", "duration_seconds", "summary", "status", "hostname")}
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    n += inserted.length;
  }
  console.log(`[sessions] inserted ${n}/${rows.length}`);
  return n;
}

type ToolEventRow = {
  id: number;
  session_id: string;
  tool_name: string;
  timestamp: string;
  file_path: string | null;
  language: string | null;
  lines_added: number;
  lines_removed: number;
  command: string | null;
  detected_framework: string | null;
  command_failed: number;
  search_pattern: string | null;
  agent_type: string | null;
  agent_description: string | null;
  skill_name: string | null;
  skill_args: string | null;
  metadata: string;
  diff_content: string | null;
};

async function importToolEvents(
  og: Database.Database,
  sql: postgres.Sql,
  orgId: string,
  memberId: string,
  pmap: Map<string, string>,
): Promise<number> {
  // Need project per row → join via sessions. Filter to valid-UUID sessions only.
  const all = og.prepare(`
    SELECT te.*, s.project
    FROM tool_events te
    JOIN sessions s ON s.id = te.session_id
  `).all() as (ToolEventRow & { project: string })[];
  const rows = all.filter((r) => isUuid(r.session_id));
  if (DRY) return rows.length;

  let n = 0;
  for (const batch of chunk(rows, 500)) {
    const values = batch
      .map((r) => {
        const pid = pmap.get(r.project);
        if (!pid) return null;
        return {
          id: uuid5(`tool_event:${r.id}`),
          org_id: orgId,
          session_id: r.session_id,
          member_id: memberId,
          project_id: pid,
          tool_name: r.tool_name,
          ts: toIso(r.timestamp),
          file_path: r.file_path,
          language: r.language,
          lines_added: r.lines_added ?? 0,
          lines_removed: r.lines_removed ?? 0,
          command: r.command,
          detected_framework: r.detected_framework,
          command_failed: !!r.command_failed,
          search_pattern: r.search_pattern,
          agent_type: r.agent_type,
          agent_description: r.agent_description,
          skill_name: r.skill_name,
          skill_args: r.skill_args,
          diff_excerpt: r.diff_content ? r.diff_content.slice(0, 16384) : null,
          metadata: jsonOrNull(r.metadata) ?? {},
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    if (values.length === 0) continue;
    const inserted = await sql`
      INSERT INTO tool_events ${sql(
        values,
        "id", "org_id", "session_id", "member_id", "project_id",
        "tool_name", "ts", "file_path", "language", "lines_added", "lines_removed",
        "command", "detected_framework", "command_failed", "search_pattern",
        "agent_type", "agent_description", "skill_name", "skill_args",
        "diff_excerpt", "metadata",
      )}
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    n += inserted.length;
  }
  console.log(`[tool_events] inserted ${n}/${rows.length}`);
  return n;
}

type InsightRow = {
  id: number;
  session_id: string | null;
  project: string;
  type: string;
  content: string;
  reasoning: string | null;
  created_at: string;
};

async function importInsights(
  og: Database.Database,
  sql: postgres.Sql,
  orgId: string,
  memberId: string,
  pmap: Map<string, string>,
): Promise<number> {
  const rows = (og.prepare("SELECT id, session_id, project, type, content, reasoning, created_at FROM insights").all() as InsightRow[])
    .map((r) => ({ ...r, session_id: isUuid(r.session_id) ? r.session_id : null }));
  if (DRY) return rows.length;

  let n = 0;
  for (const batch of chunk(rows, 500)) {
    const values = batch
      .map((r) => {
        const pid = pmap.get(r.project);
        if (!pid) return null;
        const t = r.type === "blocked" ? "blocker" : r.type;
        if (!["progress", "decision", "blocker", "pattern", "fix", "context"].includes(t)) return null;
        return {
          id: uuid5(`insight:${r.id}`),
          org_id: orgId,
          session_id: r.session_id,
          member_id: memberId,
          project_id: pid,
          type: t,
          title: null,
          content: r.content,
          reasoning: r.reasoning,
          created_at: toIso(r.created_at),
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    if (values.length === 0) continue;
    const inserted = await sql`
      INSERT INTO insights ${sql(values, "id", "org_id", "session_id", "member_id", "project_id", "type", "title", "content", "reasoning", "created_at")}
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    n += inserted.length;
  }
  console.log(`[insights] inserted ${n}/${rows.length}`);
  return n;
}

type FileActivityRow = {
  file_path: string;
  project: string;
  date: string;
  edit_count: number;
  write_count: number;
  read_count: number;
  lines_added: number;
  lines_removed: number;
  language: string | null;
};

async function importFileActivity(
  og: Database.Database,
  sql: postgres.Sql,
  orgId: string,
  pmap: Map<string, string>,
): Promise<number> {
  const rows = og.prepare("SELECT file_path, project, date, edit_count, write_count, read_count, lines_added, lines_removed, language FROM file_activity").all() as FileActivityRow[];
  if (DRY) return rows.length;

  let n = 0;
  for (const batch of chunk(rows, 500)) {
    const values = batch
      .map((r) => {
        const pid = pmap.get(r.project);
        if (!pid) return null;
        return {
          org_id: orgId,
          project_id: pid,
          file_path: r.file_path,
          date: r.date,
          edit_count: r.edit_count ?? 0,
          write_count: r.write_count ?? 0,
          read_count: r.read_count ?? 0,
          lines_added: r.lines_added ?? 0,
          lines_removed: r.lines_removed ?? 0,
          language: r.language,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    if (values.length === 0) continue;
    const inserted = await sql`
      INSERT INTO file_activity ${sql(values, "org_id", "project_id", "file_path", "date", "edit_count", "write_count", "read_count", "lines_added", "lines_removed", "language")}
      ON CONFLICT (project_id, file_path, date) DO NOTHING
      RETURNING id
    `;
    n += inserted.length;
  }
  console.log(`[file_activity] inserted ${n}/${rows.length}`);
  return n;
}

type DailySummaryRow = {
  date: string;
  project: string;
  session_count: number;
  total_duration_seconds: number;
  lines_added: number;
  lines_removed: number;
  net_lines: number;
  files_created: number;
  files_edited: number;
  files_read: number;
  tool_calls: number;
  bash_commands: number;
  bash_failures: number;
  searches: number;
  agents_spawned: number;
  skills_used: string;
  frameworks_detected: string;
  languages: string;
  tool_counts: string;
};

async function importDailySummaries(
  og: Database.Database,
  sql: postgres.Sql,
  orgId: string,
  pmap: Map<string, string>,
): Promise<number> {
  const rows = og.prepare("SELECT * FROM daily_summaries").all() as DailySummaryRow[];
  if (DRY) return rows.length;

  let n = 0;
  for (const batch of chunk(rows, 200)) {
    const values = batch
      .map((r) => {
        const pid = pmap.get(r.project);
        if (!pid) return null;
        return {
          org_id: orgId,
          project_id: pid,
          date: r.date,
          session_count: r.session_count ?? 0,
          total_duration_seconds: r.total_duration_seconds ?? 0,
          lines_added: r.lines_added ?? 0,
          lines_removed: r.lines_removed ?? 0,
          net_lines: r.net_lines ?? 0,
          files_created: r.files_created ?? 0,
          files_edited: r.files_edited ?? 0,
          files_read: r.files_read ?? 0,
          tool_calls: r.tool_calls ?? 0,
          bash_commands: r.bash_commands ?? 0,
          bash_failures: r.bash_failures ?? 0,
          searches: r.searches ?? 0,
          agents_spawned: r.agents_spawned ?? 0,
          skills_used: jsonOrNull(r.skills_used) ?? {},
          frameworks_detected: jsonOrNull(r.frameworks_detected) ?? {},
          languages: jsonOrNull(r.languages) ?? {},
          tool_counts: jsonOrNull(r.tool_counts) ?? {},
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    if (values.length === 0) continue;
    const inserted = await sql`
      INSERT INTO daily_summaries ${sql(
        values,
        "org_id", "project_id", "date",
        "session_count", "total_duration_seconds",
        "lines_added", "lines_removed", "net_lines",
        "files_created", "files_edited", "files_read",
        "tool_calls", "bash_commands", "bash_failures",
        "searches", "agents_spawned",
        "skills_used", "frameworks_detected", "languages", "tool_counts",
      )}
      ON CONFLICT (project_id, date) DO NOTHING
      RETURNING id
    `;
    n += inserted.length;
  }
  console.log(`[daily_summaries] inserted ${n}/${rows.length}`);
  return n;
}

type BlueprintRunRow = {
  id: string;
  project: string;
  project_path: string;
  blueprint: string;
  input: string | null;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  step_count: number;
  steps_done: number;
  steps_failed: number;
  worktree_path: string | null;
  worktree_branch: string | null;
  base_branch: string | null;
  step_results: string;
  source_file: string;
  source_mtime: number;
  ingested_at: string;
  session_id: string | null;
};

async function importBlueprintRuns(
  og: Database.Database,
  sql: postgres.Sql,
  orgId: string,
  memberId: string,
  pmap: Map<string, string>,
): Promise<number> {
  const all = og.prepare("SELECT * FROM blueprint_runs").all() as BlueprintRunRow[];
  const rows = all
    .filter((r) => isUuid(r.id))
    .map((r) => ({ ...r, session_id: isUuid(r.session_id) ? r.session_id : null }));
  if (DRY) return rows.length;

  let n = 0;
  for (const r of rows) {
    const pid = pmap.get(r.project);
    if (!pid) continue;
    const inserted = await sql`
      INSERT INTO blueprint_runs (
        id, org_id, member_id, project_id, session_id,
        blueprint, input, status, started_at, completed_at, duration_ms,
        step_count, steps_done, steps_failed, step_results,
        worktree_path, worktree_branch, base_branch,
        source_file, source_mtime, ingested_at
      )
      VALUES (
        ${r.id}, ${orgId}, ${memberId}, ${pid}, ${r.session_id},
        ${r.blueprint}, ${r.input}, ${r.status}, ${toIso(r.started_at)}, ${toIso(r.completed_at)}, ${r.duration_ms},
        ${r.step_count}, ${r.steps_done}, ${r.steps_failed}, ${jsonOrNull(r.step_results) ?? []}::jsonb,
        ${r.worktree_path}, ${r.worktree_branch}, ${r.base_branch},
        ${r.source_file}, ${r.source_mtime}, ${toIso(r.ingested_at)}
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    n += inserted.length;
  }
  console.log(`[blueprint_runs] inserted ${n}/${rows.length}`);
  return n;
}

async function synthesizeEventLog(
  og: Database.Database,
  sql: postgres.Sql,
  orgId: string,
  memberId: string,
  pmap: Map<string, string>,
): Promise<number> {
  // Synthesize: session.start + session.end (if ended) + tool.* per tool_event + insight.* per insight.
  type EvRow = {
    id: string;
    org_id: string;
    member_id: string;
    project_id: string;
    session_id: string | null;
    event_kind: string;
    payload: unknown;
    hook_ts: string | null;
    redaction_applied: unknown;
    received_at: string | null;
  };
  const sessions = (og.prepare("SELECT id, project, started_at, ended_at, status, summary FROM sessions").all() as {
    id: string;
    project: string;
    started_at: string;
    ended_at: string | null;
    status: string;
    summary: string | null;
  }[]).filter((s) => isUuid(s.id));

  const tools = (og.prepare(`
    SELECT te.id, te.session_id, te.tool_name, te.timestamp, te.file_path, te.command, s.project
    FROM tool_events te
    JOIN sessions s ON s.id = te.session_id
  `).all() as {
    id: number;
    session_id: string;
    tool_name: string;
    timestamp: string;
    file_path: string | null;
    command: string | null;
    project: string;
  }[]).filter((t) => isUuid(t.session_id));

  const insights = (og.prepare("SELECT id, session_id, project, type, content, created_at FROM insights").all() as {
    id: number;
    session_id: string | null;
    project: string;
    type: string;
    content: string;
    created_at: string;
  }[]).map((i) => ({ ...i, session_id: isUuid(i.session_id) ? i.session_id : null }));

  const evs: EvRow[] = [];
  const legacy = { legacy_imported: true };

  for (const s of sessions) {
    const pid = pmap.get(s.project);
    if (!pid) continue;
    evs.push({
      id: uuid5(`event_log:session_start:${s.id}`),
      org_id: orgId,
      member_id: memberId,
      project_id: pid,
      session_id: s.id,
      event_kind: "session.start",
      payload: { ...legacy, source: "og" },
      hook_ts: toIso(s.started_at),
      redaction_applied: {},
      received_at: toIso(s.started_at),
    });
    if (s.ended_at) {
      evs.push({
        id: uuid5(`event_log:session_end:${s.id}`),
        org_id: orgId,
        member_id: memberId,
        project_id: pid,
        session_id: s.id,
        event_kind: "session.end",
        payload: { ...legacy, source: "og", summary: s.summary, status: s.status },
        hook_ts: toIso(s.ended_at),
        redaction_applied: {},
        received_at: toIso(s.ended_at),
      });
    }
  }

  for (const t of tools) {
    const kind = toolNameToKind(t.tool_name);
    if (!kind) continue;
    const pid = pmap.get(t.project);
    if (!pid) continue;
    evs.push({
      id: uuid5(`event_log:tool:${t.id}`),
      org_id: orgId,
      member_id: memberId,
      project_id: pid,
      session_id: t.session_id,
      event_kind: kind,
      payload: { ...legacy, source: "og", file_path: t.file_path, command: t.command, og_tool_event_id: t.id },
      hook_ts: toIso(t.timestamp),
      redaction_applied: {},
      received_at: toIso(t.timestamp),
    });
  }

  for (const i of insights) {
    const pid = pmap.get(i.project);
    if (!pid) continue;
    const t = i.type === "blocked" ? "blocker" : i.type;
    if (!["progress", "decision", "blocker", "pattern", "fix", "context"].includes(t)) continue;
    evs.push({
      id: uuid5(`event_log:insight:${i.id}`),
      org_id: orgId,
      member_id: memberId,
      project_id: pid,
      session_id: i.session_id,
      event_kind: `insight.${t}`,
      payload: { ...legacy, source: "og", content: i.content, og_insight_id: i.id },
      hook_ts: toIso(i.created_at),
      redaction_applied: {},
      received_at: toIso(i.created_at),
    });
  }

  if (DRY) return evs.length;

  let n = 0;
  for (const batch of chunk(evs, 500)) {
    const inserted = await sql`
      INSERT INTO event_log ${sql(batch, "id", "org_id", "member_id", "project_id", "session_id", "event_kind", "payload", "hook_ts", "redaction_applied", "received_at")}
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    n += inserted.length;
  }
  console.log(`[event_log] inserted ${n}/${evs.length}`);
  return n;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
