# Claude Pulse Team — Onboarding Guide

*For new customers setting up their first organization. ~10 minutes for the
admin, near-zero for each developer.*

---

## Before you start

You'll need:

- A workspace email (used to claim your org via OAuth).
- Admin access to your team's GitHub or Google org (for OAuth sign-in).
- Repo URLs or git remote URLs for the projects you want to track.
- (Optional) Access to your team's cloud dev environment platform
  (GitHub Codespaces, Gitpod, GitLab Web IDE, Coder, Azure Dev Box) to
  inject the workstation API key as a secret.

You won't need:

- Any change to your repos. Pulse Team never writes to a project's git tree.
- Any change to your CI. Pulse runs in the developer's local environment.
- Per-project configuration files. All bindings live server-side.

---

## Step 1 — Create your organization (5 min, admin)

1. Go to `app.claude-pulse-team.com` and sign in with **Google** or **GitHub**.
2. The first sign-in creates your **Org** automatically. You'll be prompted
   to set:
   - Org display name (e.g. "Northbeam Studio")
   - Billing email
   - Default **redaction policy** (see below)
3. The signed-in user becomes the **Owner** of the org.

### Redaction policy — pick one

| Policy | Keeps | Drops |
|---|---|---|
| **Standard** *(recommended)* | Insights, tool counts, file paths, line counts | Diff bodies, prompt payloads |
| **Strict** | Insights, tool counts, line counts | Diff bodies, prompt payloads, *file paths hashed* |

Per-project overrides are available later. Redaction runs server-side **before**
durable storage and again on read (defense in depth). You can always tighten;
loosening retroactively only affects new events.

---

## Step 2 — Invite members (2 min)

Open **Admin → Members & roles → Invite**.

- Enter email + role (`Owner` / `Admin` / `Member`).
- Each invite generates a **workstation API key** in the format
  `cpt_<32-byte base32>`. The key is shown **once** at issue time —
  hashed at rest with a server-side pepper.
- Members can rotate their own keys at any time.

For agencies: invite client-facing roles only when the read-only client portal
is rolled out (planned, post-MVP).

---

## Step 3 — Bind your first projects (3 min)

You have two options:

### Option A — pre-bind (deterministic)

**Admin → Projects → Add project** → paste the canonical git remote URL
(e.g. `https://github.com/northbeam/acme-store`). Set:

- Project display name
- Redaction policy (defaults to org default)
- Member access (which members can see this project's data)

### Option B — auto-bind (frictionless)

Skip pre-binding. The first time a developer opens a session against a repo,
Pulse auto-creates a draft project in **Needs Review**. An admin confirms
the name, redaction, and member access in one click.

The Overview banner ("*N auto-created projects awaiting confirmation*")
links straight to this queue.

---

## Step 4 — Onboard developers

### Cloud dev environments (zero-touch)

Add the workstation API key once as a workspace-level secret:

| Platform | Secret to set |
|---|---|
| GitHub Codespaces | Repository or org secret `CLAUDE_PULSE_API_KEY` |
| Gitpod | Workspace secret `CLAUDE_PULSE_API_KEY` |
| Coder | Workspace template variable `CLAUDE_PULSE_API_KEY` |
| Azure Dev Box | Image-baked env var `CLAUDE_PULSE_API_KEY` |

Add the hook to your dev image (or your team's `.devcontainer.json`):

```jsonc
{
  "postCreateCommand": "npm install -g @claude-pulse-team/hook && claude-pulse-team install --cloud"
}
```

Developers do **nothing**. They open their IDE; the hook fires on
SessionStart and they're in.

### Local install (per developer, ~30 seconds)

```bash
npm install -g @claude-pulse-team/hook
claude-pulse-team init       # OAuth device flow; writes ~/.claude-pulse-team/config.json
claude-pulse-team doctor     # verifies API reachable, key valid, hook installed
```

`init` reads your invite email, walks you through OAuth, and wires the hook
into your global `~/.claude/settings.json`. The config file lives entirely
outside any repo.

### Repos without a git remote

Run once inside the repo:

```bash
claude-pulse-team bind <project-id>
```

The binding is stored in workstation config — never in the repo.

---

## Step 5 — Verify it's working

In the dashboard, open **`/team` Overview**. Within ~1 minute of any
developer starting a session, you should see:

- `Sessions` count tick up in the top KPI row
- A new entry in `Recent insights` (after the developer wraps the session)
- An updated cell in the **Org-wide activity** heatmap (today's column)
- The developer's `last seen` value in **Members** updates

If nothing appears after 5 minutes:

```bash
claude-pulse-team doctor
```

This runs eight checks: API reachable, key valid, last-sync recent, project
bound, hook installed, redaction policy fetched, outbox depth healthy,
canary received. The first failing check tells you what to fix.

---

## Daily flow — what each role actually does

### Developers

**Nothing new.** Use Claude Code as you always have. The hook runs on:

- `SessionStart` — fetches the last 7 days of team insights for this project
  and injects them into your Claude session. Your AI knows what teammates
  decided yesterday.
- `PostToolUse` — captures Edit / Write / Bash / Read / Agent / Skill /
  WebFetch events to the local outbox.
- `Stop` — asks for a one-line **structured summary**:
  ```
  PROGRESS: <what advanced>
  DECISION: <what was decided and why>
  BLOCKED: <what's stuck>
  ```
  These become typed `insights` rows that everyone else sees.

The whole flow is local-first. The hook never blocks on the network; the
sync daemon ships batches asynchronously.

### Engineering managers / agency leads

Most days, you only need the **Overview** page:

- KPIs (sessions, decisions, blockers, lines net, active members)
- Open blockers — click any to jump to the originating session
- Top contributors and Top projects for the trailing week
- Needs-review banner if a new repo appeared
- Recent insights across all projects

Once a week, open **Reports** → set date range + project filter → export CSV.
This is the artifact you send to clients or staple to internal reviews.

### Admins

Recurring tasks:

- Confirm new entries in **Needs Review** (typically 1–2/week per active
  team)
- Rotate API keys when a workstation changes hands
- Tighten redaction policy on a per-project basis if a customer requests it
- Review the audit log monthly (every admin action is recorded)

---

## When something goes silent

Three signals tell you a workstation has stopped reporting:

1. **Members** page shows `last seen` >24h ago.
2. **Doctor CLI** on the affected workstation shows the failing check.
3. **Server-side canary** (every 5 min) failing pages the on-call admin.

Most often it's a rotated API key, a corrupted local outbox, or a hook
config that was overwritten by another tool.

---

## FAQ

**Q. Will this slow Claude Code down?**
No. Hook latency budget is <100 ms p99. The hook only writes to a local
SQLite outbox; the network sync runs in a separate daemon.

**Q. What about secrets in prompts or diffs?**
Default redaction drops diff bodies and prompt payloads server-side
*before* durable write. File paths and structured insights remain.
Strict policy hashes file paths too. Per-project regex redaction is
available for command lines.

**Q. Can clients see this?**
Not yet. A read-only sanitized client portal is on the roadmap (Phase 2).
Until then, **Reports** + CSV export is the client-facing surface.

**Q. What if a developer doesn't write the structured summary?**
Sessions still capture tool counts, file activity, line counts, and
blueprint runs. Insights are richer when developers fill in PROGRESS /
DECISION / BLOCKED, but everything else lands automatically.

**Q. Does it work without internet?**
Yes — locally. The outbox accumulates; the daemon drains when connectivity
returns. Cloud envs use a memory queue and skip local persistence.

**Q. Does it support self-hosted / on-prem?**
Not in v1. Enterprise tier (Phase 3) will offer it.

---

## Compliance & audit

For regulated customers and procurement reviews:

- Every event is captured in an append-only `event_log` table; derived
  views are rebuildable from it.
- Member identity is server-stamped from the API key — clients cannot
  claim a different identity.
- Server-side redaction runs before durable write; defense-in-depth
  redaction runs again on read.
- The `audit_log` records every admin action (member invites, project
  bindings, redaction edits, key rotations) with timestamp + actor.
- A first-class **Compliance Export pack** (Phase 2) will produce a
  one-click bundle suitable for handoff to an auditor without
  modification.

See [COMPLIANCE.md](./team-saas/COMPLIANCE.md) for the full mapping
against EU AI Act Articles 12 and 14, SOC 2 common criteria, and
ISO 42001.

---

## Next reads

- [PRODUCT.md](./PRODUCT.md) — master product / commercial doc
- [PRD](./team-saas/PRD.md) — full engineering spec
- [API.md](./team-saas/API.md) — ingest & read API contracts
- [STACK.md](./team-saas/STACK.md) — hosting, regions, dependencies
- [DESIGN-PRD.md](./team-saas/DESIGN-PRD.md) — visual & interaction system
- [COMPLIANCE.md](./team-saas/COMPLIANCE.md) — audit-trail mapping
