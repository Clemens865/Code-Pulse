-- Project identity is a fingerprint, not a single string. The bash hook emits
-- up to six different remote_url formats for the same physical directory
-- (git remote, worktree common-dir, local://basename, local:/abs/path, ...),
-- so one project accumulates several canonical_keys over its life and
-- resolveOrCreateProject splits it into duplicate rows.
--
-- project_aliases is the resolution index: every canonical_key a project has
-- ever been seen under maps to the one canonical project row. It lets the
-- merge tool collapse historical duplicates WITHOUT dropping the old keys,
-- so in-flight events that still arrive under an old key resolve correctly.
-- projects.canonical_key stays as the "primary" display key.

CREATE TABLE IF NOT EXISTS project_aliases (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    canonical_key text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, canonical_key)
);

CREATE INDEX IF NOT EXISTS project_aliases_project_idx ON project_aliases (project_id);

-- Backfill: every existing project's current canonical_key becomes an alias.
-- Idempotent — re-running skips keys that already resolve.
INSERT INTO project_aliases (org_id, project_id, canonical_key)
SELECT org_id, id, canonical_key FROM projects
ON CONFLICT (org_id, canonical_key) DO NOTHING;
