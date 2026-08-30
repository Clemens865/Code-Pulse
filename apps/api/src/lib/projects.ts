// Project canonical-key normalization + auto-create.
// See PRD §10 and API §3.2.

import { eq, and, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";

const KNOWN_VCS_HOSTS = new Set([
  "github.com",
  "gitlab.com",
  "bitbucket.org",
  "dev.azure.com",
  "ssh.dev.azure.com",
  "codeberg.org",
]);

export type ResolvedProject = { id: string; name: string; redactionPolicyId: string | null };

export function normalizeRemoteUrl(input: string): {
  canonicalKey: string;
  vcsProvider: string | null;
  vcsRepoId: string | null;
} {
  let url = input.trim();
  if (!url) {
    return { canonicalKey: "", vcsProvider: null, vcsRepoId: null };
  }
  // git@host:owner/repo(.git) → ssh://git@host/owner/repo
  url = url.replace(/^git@([^:]+):/, "ssh://git@$1/");
  // Strip embedded auth: https://x:y@host/... → https://host/...
  url = url.replace(/^(https?:\/\/)[^/@]+@/, "$1");
  // Drop trailing .git
  url = url.replace(/\.git$/i, "");
  // Lowercase host + path
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    let path = u.pathname.replace(/\/+$/g, "").toLowerCase();
    if (path.startsWith("/")) path = path.slice(1);
    const canonicalKey = `${host}/${path}`;
    const vcsProvider = inferVcsProvider(host);
    return { canonicalKey, vcsProvider, vcsRepoId: null };
  } catch {
    return { canonicalKey: url.toLowerCase(), vcsProvider: null, vcsRepoId: null };
  }
}

function inferVcsProvider(host: string): string | null {
  if (host === "github.com") return "github";
  if (host === "gitlab.com" || host.endsWith(".gitlab.com")) return "gitlab";
  if (host === "bitbucket.org") return "bitbucket";
  if (host.endsWith("dev.azure.com")) return "azure_devops";
  if (host === "codeberg.org") return "codeberg";
  if (KNOWN_VCS_HOSTS.has(host)) return host;
  return null;
}

function nameFromCanonicalKey(canonicalKey: string): string {
  const tail = canonicalKey.split("/").filter(Boolean).slice(-2).join("/");
  return tail || canonicalKey;
}

// Register a canonical_key → project_id mapping. Idempotent; safe to call on
// every resolve. This is what keeps a project from re-fragmenting: once a key
// is aliased, every future event under that key resolves to the same project.
async function registerAlias(orgId: string, projectId: string, canonicalKey: string): Promise<void> {
  await db
    .insert(schema.projectAliases)
    .values({ orgId, projectId, canonicalKey })
    .onConflictDoNothing({
      target: [schema.projectAliases.orgId, schema.projectAliases.canonicalKey],
    });
}

export type ProjectFingerprint = {
  git_remote?: string;
  common_dir?: string;
  basename?: string;
};

// Convert each fingerprint signal into a normalized canonical_key, in
// priority order (most-authoritative first). git_remote wins because two
// machines that both have `local:/Users/x/foo` are NOT the same project, but
// two machines that both have `github.com/owner/repo` are.
function fingerprintCandidates(fp: ProjectFingerprint | undefined): Array<{
  source: "git_remote" | "common_dir" | "basename";
  raw: string;
  canonicalKey: string;
  vcsProvider: string | null;
}> {
  if (!fp) return [];
  const out: ReturnType<typeof fingerprintCandidates> = [];
  const add = (source: "git_remote" | "common_dir" | "basename", raw: string | undefined) => {
    if (!raw) return;
    const v = raw.trim();
    if (!v) return;
    // common_dir / basename use the same local: scheme the hook already emits,
    // so normalizeRemoteUrl produces the same canonical_key as today's events.
    const wrapped =
      source === "git_remote" ? v :
      source === "common_dir" ? `local:${v}` :
      `local://${v}`;
    const { canonicalKey, vcsProvider } = normalizeRemoteUrl(wrapped);
    if (canonicalKey) out.push({ source, raw: v, canonicalKey, vcsProvider });
  };
  add("git_remote", fp.git_remote);
  add("common_dir", fp.common_dir);
  add("basename", fp.basename);
  return out;
}

/**
 * Resolve a remote_url to a project record for the given org. Resolution goes
 * through project_aliases — a project can have several canonical_keys (the hook
 * emits up to six formats for the same directory), and the alias table maps all
 * of them to one row.
 *
 * When `fingerprint` is supplied, every signal it carries (git_remote /
 * common_dir / basename) is also tried as an alias lookup in priority order;
 * the first hit wins. This is how the local://basename → github.com/owner/repo
 * transition stays on one project: the second session sends the new git_remote
 * AND the unchanged common_dir, the alias lookup finds the project via
 * common_dir, and git_remote gets added as a new alias on the same project.
 *
 * Auto-creates a needs_review project if no signal matches, registering EVERY
 * supplied canonical_key as an alias so future events resolve correctly.
 */
export async function resolveOrCreateProject(
  orgId: string,
  remoteUrl: string,
  opts: {
    vcsProvider?: string | null;
    vcsRepoId?: string | null;
    createdBy?: string | null;
    fingerprint?: ProjectFingerprint;
  } = {},
): Promise<ResolvedProject> {
  const primary = normalizeRemoteUrl(remoteUrl);
  // Candidate keys, strongest-first. Primary remote_url is the hook's pick
  // from its existing 6-step chain — keep it in the mix for backward compat.
  const candidates = [
    ...fingerprintCandidates(opts.fingerprint),
    {
      source: "remote_url" as const,
      raw: remoteUrl,
      canonicalKey: primary.canonicalKey,
      vcsProvider: primary.vcsProvider,
    },
  ].filter((c) => c.canonicalKey);

  // Try each signal in priority order until an alias resolves.
  for (const cand of candidates) {
    const alias = await db.query.projectAliases.findFirst({
      where: (a, { eq, and }) => and(eq(a.orgId, orgId), eq(a.canonicalKey, cand.canonicalKey)),
      columns: { projectId: true },
    });
    if (!alias) continue;
    const found = await db.query.projects.findFirst({
      where: (p, { eq }) => eq(p.id, alias.projectId),
      columns: { id: true, name: true, redactionPolicyId: true },
    });
    if (!found) continue; // alias points at a deleted project (shouldn't happen) — try next signal
    // Register the OTHER candidate keys as aliases on this project, so a
    // session that later drops one signal (e.g. `git remote rm origin`) still
    // resolves here.
    for (const other of candidates) {
      if (other.canonicalKey !== cand.canonicalKey) {
        await registerAlias(orgId, found.id, other.canonicalKey);
      }
    }
    return found;
  }

  // No alias hit — create a new project under the STRONGEST candidate as
  // primary canonical_key, and register every other candidate as an alias.
  const winner = candidates[0] ?? {
    source: "remote_url" as const,
    raw: remoteUrl,
    canonicalKey: primary.canonicalKey,
    vcsProvider: primary.vcsProvider,
  };

  const org = await db.query.orgs.findFirst({
    where: (o, { eq }) => eq(o.id, orgId),
    columns: { defaultRedactionPolicyId: true },
  });

  const inserted = await db
    .insert(schema.projects)
    .values({
      orgId,
      canonicalKey: winner.canonicalKey,
      name: nameFromCanonicalKey(winner.canonicalKey),
      remoteUrl,
      vcsProvider: opts.vcsProvider ?? winner.vcsProvider,
      vcsRepoId: opts.vcsRepoId ?? null,
      redactionPolicyId: org?.defaultRedactionPolicyId ?? null,
      needsReview: true,
      createdBy: opts.createdBy ?? null,
    })
    .onConflictDoNothing({ target: [schema.projects.orgId, schema.projects.canonicalKey] })
    .returning({ id: schema.projects.id, name: schema.projects.name, redactionPolicyId: schema.projects.redactionPolicyId });

  if (inserted[0]) {
    for (const cand of candidates) {
      await registerAlias(orgId, inserted[0].id, cand.canonicalKey);
    }
    return inserted[0];
  }

  // Lost the race against a concurrent insert; re-read and make sure all
  // candidate aliases exist.
  const after = await db.query.projects.findFirst({
    where: (p, { eq, and }) => and(eq(p.orgId, orgId), eq(p.canonicalKey, winner.canonicalKey)),
    columns: { id: true, name: true, redactionPolicyId: true },
  });
  if (!after) throw new Error("project resolution failed");
  for (const cand of candidates) {
    await registerAlias(orgId, after.id, cand.canonicalKey);
  }
  return after;
}

// Event-grain tables keyed by their own id — re-pointing project_id can never
// collide, so the losers' rows move onto the winner and nothing is lost.
const REPOINT_TABLES: Array<{ table: string; hasOrgId: boolean }> = [
  { table: "event_log", hasOrgId: true },
  { table: "sessions", hasOrgId: true },
  { table: "tool_events", hasOrgId: true },
  { table: "insights", hasOrgId: true },
  { table: "blueprint_runs", hasOrgId: true },
];

// Derived aggregates (file_activity, daily_summaries) keyed by
// (project_id, file_path|—, date), plus the unused access join table. Their
// project-scoped unique keys collide when two merged projects touched the same
// file/day, so the losers' rows are DROPPED rather than re-pointed. This loses
// nothing recoverable: the canonical event_log / tool_events rows survive
// re-pointed under the winner, and per PRD §6 these tables are rebuildable from
// them. member_project_access has no org_id column, hence the flag.
const DROP_LOSER_TABLES: Array<{ table: string; hasOrgId: boolean }> = [
  { table: "file_activity", hasOrgId: true },
  { table: "daily_summaries", hasOrgId: true },
  { table: "member_project_access", hasOrgId: false },
];

function rowCount(res: unknown): number {
  return (res as { count?: number })?.count ?? 0;
}

/**
 * Collapse one or more duplicate projects into a single survivor — all in one
 * transaction. Event-grain rows (event_log / sessions / tool_events / insights /
 * blueprint_runs) are re-pointed onto the winner; no canonical row is ever
 * deleted. Derived-aggregate rows (file_activity / daily_summaries) for the
 * losers are dropped — they're rebuildable from the re-pointed events. The
 * losers' canonical_keys survive as aliases on the winner, so events still in
 * flight under an old key resolve to the survivor.
 *
 * Must run inside a caller-supplied transaction so the whole merge is atomic.
 */
export async function mergeProjects(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  orgId: string,
  winnerId: string,
  loserIds: string[],
): Promise<{ repointed: Record<string, number> }> {
  const repointed: Record<string, number> = {};
  // drizzle's sql`` doesn't bind a JS array for ANY(); build an IN (...) list.
  const loserList = sql.join(
    loserIds.map((id) => sql`${id}`),
    sql`, `,
  );

  for (const { table, hasOrgId } of REPOINT_TABLES) {
    const res = await tx.execute(
      hasOrgId
        ? sql`UPDATE ${sql.identifier(table)} SET project_id = ${winnerId}
              WHERE org_id = ${orgId} AND project_id IN (${loserList})`
        : sql`UPDATE ${sql.identifier(table)} SET project_id = ${winnerId}
              WHERE project_id IN (${loserList})`,
    );
    repointed[table] = rowCount(res);
  }

  for (const { table, hasOrgId } of DROP_LOSER_TABLES) {
    const res = await tx.execute(
      hasOrgId
        ? sql`DELETE FROM ${sql.identifier(table)}
              WHERE org_id = ${orgId} AND project_id IN (${loserList})`
        : sql`DELETE FROM ${sql.identifier(table)} WHERE project_id IN (${loserList})`,
    );
    repointed[`${table}_dropped`] = rowCount(res);
  }

  // Transfer the losers' aliases onto the winner so their canonical_keys keep
  // resolving to the survivor.
  const aliasRes = await tx.execute(
    sql`UPDATE project_aliases SET project_id = ${winnerId}
        WHERE org_id = ${orgId} AND project_id IN (${loserList})`,
  );
  repointed["project_aliases"] = rowCount(aliasRes);

  // Losers now have no child rows — delete the project headers.
  const delRes = await tx.execute(
    sql`DELETE FROM projects WHERE org_id = ${orgId} AND id IN (${loserList})`,
  );
  repointed["projects_deleted"] = rowCount(delRes);

  return { repointed };
}

// Re-export so callers can use the operators without importing drizzle-orm directly.
export { eq, and };
