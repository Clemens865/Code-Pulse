// Project canonical-key normalization + auto-create.
// See PRD §10 and API §3.2.

import { eq, and } from "drizzle-orm";
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

/**
 * Resolve a remote_url to a project record for the given org. Auto-creates a
 * needs_review project if no match is found, so events never get rejected for
 * being from an "unknown" project.
 */
export async function resolveOrCreateProject(
  orgId: string,
  remoteUrl: string,
  opts: { vcsProvider?: string | null; vcsRepoId?: string | null; createdBy?: string | null } = {},
): Promise<ResolvedProject> {
  const { canonicalKey, vcsProvider } = normalizeRemoteUrl(remoteUrl);

  const found = await db.query.projects.findFirst({
    where: (p, { eq, and }) => and(eq(p.orgId, orgId), eq(p.canonicalKey, canonicalKey)),
    columns: { id: true, name: true, redactionPolicyId: true },
  });
  if (found) return found;

  // Look up the org's default redaction policy.
  const org = await db.query.orgs.findFirst({
    where: (o, { eq }) => eq(o.id, orgId),
    columns: { defaultRedactionPolicyId: true },
  });

  const inserted = await db
    .insert(schema.projects)
    .values({
      orgId,
      canonicalKey,
      name: nameFromCanonicalKey(canonicalKey),
      remoteUrl,
      vcsProvider: opts.vcsProvider ?? vcsProvider,
      vcsRepoId: opts.vcsRepoId ?? null,
      redactionPolicyId: org?.defaultRedactionPolicyId ?? null,
      needsReview: true,
      createdBy: opts.createdBy ?? null,
    })
    .onConflictDoNothing({ target: [schema.projects.orgId, schema.projects.canonicalKey] })
    .returning({ id: schema.projects.id, name: schema.projects.name, redactionPolicyId: schema.projects.redactionPolicyId });

  if (inserted[0]) return inserted[0];

  // Lost the race; re-read.
  const after = await db.query.projects.findFirst({
    where: (p, { eq, and }) => and(eq(p.orgId, orgId), eq(p.canonicalKey, canonicalKey)),
    columns: { id: true, name: true, redactionPolicyId: true },
  });
  if (!after) throw new Error("project resolution failed");
  return after;
}

// Re-export so callers can use the operators without importing drizzle-orm directly.
export { eq, and };
