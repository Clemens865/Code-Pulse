# Code Pulse — Onboarding Guide

*Self-hosted setup: ~10 minutes for the admin, ~2 minutes per developer.*

---

## Before you start

You'll need:

- A host for the API (any box with Node 22 + Docker; a laptop works for trials).
- Postgres 16 (the bundled `docker compose` provides one).
- On each developer machine: Claude Code 2.x, `jq`, `sqlite3`, Node 18+.

You won't need:

- Any change to your repos. Pulse Team never writes tracked files into a
  project's git tree.
- Any change to CI.
- Per-project configuration. Project identity is resolved automatically from
  git remotes (with server-side aliasing so worktrees and renames stay on one
  project).

Supported platforms: macOS and Linux. Windows: WSL only.

---

## Step 1 — Stand up the server (admin)

```bash
git clone <repo> && cd code-pulse/apps/api
docker compose up -d          # Postgres 16 on :56432
cp .env.example .env          # fill in secrets (see apps/api/README.md)
npm install
npm run db:migrate            # applies all migrations, tracked in _migrations
npm run bootstrap -- --org "Your Team" --email you@example.com --name "You"
npm run dev                   # API on :8787
```

`bootstrap` prints:

- `ORG_ID` / `MEMBER_ID` — your dashboard sign-in identity
- `API_KEY` (`cpt_…`) — your workstation key, **shown once**

Then start the dashboard from the repo root: `npm install && npm run dev`
(→ `http://localhost:3142/team`) and sign in via the local-login card.

### Redaction defaults

Always on, regardless of policy: secret masking (API keys, tokens, private
keys, credentialed URLs) and body-drop for sensitive files (`.env*`, `*.pem`,
`id_rsa*`, credential stores) — enforced in the hook *and* on the server.

The default policy additionally drops edit/write bodies (line counts are
kept) and prompt text. Loosen or tighten per project in **Admin → Projects**.

---

## Step 2 — Invite members (admin)

**Admin → Members → Invite**: enter email + role. Each member gets a
workstation API key (`cpt_…`), shown once at issue time and hashed at rest.
Keys are rotatable and revocable from **Admin → API keys**; deactivating a
member revokes access.

---

## Step 3 — Each developer installs the hook

```bash
npm install -g <repo>/packages/hook
code-pulse init --api-url http://<api-host>:8787 --api-key cpt_…
code-pulse doctor     # verifies API, key, outbox, hook install
```

The first Claude Code session shows a one-time notice describing what is
captured and how to opt out:

- `code-pulse pause` / `resume` — this machine
- `CODE_PULSE_DISABLED=1` — this shell
- `{"disabled": true}` in `.code-pulse.json` — this repo
- `code-pulse uninstall [--purge]` — remove everything

From then on it's invisible: sessions are captured to a local outbox and
synced in the background (an API outage never loses events — they queue and
drain when it returns), and every session start injects the team's recent
decisions, open blockers, and hot files as context.

---

## Step 4 — Projects appear on first use

The first session in a repo auto-creates a project under **Needs review**.
Confirm it, set its redaction policy, and it's bound — no pre-registration
needed. Fragmented duplicates (renames, worktrees) can be merged in
**Admin → Projects**; old keys keep resolving via aliases.

---

## Data lifecycle

- **Retention**: `orgs.retention_days` (default 365) is enforced by a
  background purge job.
- **Export**: `GET /v1/admin/export` streams the whole org as JSONL.
- **Deletion**: admin endpoints erase a member's data or the entire org
  (org deletion requires typing the org slug).
- **Backup**: `pg_dump` the compose volume (`cpt-api-pgdata`); everything
  derived is rebuildable from `event_log`.

---

## Production notes

- Run the API with `NODE_ENV=production`. There is no built-in OAuth yet:
  either front the API with your own auth proxy and set `LOCAL_LOGIN=true`
  (a startup warning reminds you what that means), or keep it on a trusted
  network/VPN.
- Migrations run via `npm run db:migrate` (or as your deploy's release
  command); they are transactional and tracked.
- One hosted topology (Fly + Neon + Vercel) is described in
  `docs/team-saas/STACK.md`.
