# Code Pulse — Product Requirements Document

*Status: Draft v0.1 — 2026-05-02*
*Owner: Clemens Hoenig*
*Scope: SaaS team/agency product, distinct from the single-user open-source Claude Pulse*

---

## 1. Vision

Every developer using Claude Code generates a continuous stream of decisions, progress, and blockers — most of it lost the moment the session ends. Within a team, that loss compounds: developers solve the same problem twice, AI assistants restart from zero, managers chase status updates, and clients receive guesswork reports.

**Code Pulse is the middleware that turns each developer's AI session into shared, queryable team knowledge — and feeds that knowledge back into every team member's next AI session as context.**

The single-user Claude Pulse handles individual visibility. Code Pulse adds the collaboration, audit, and reporting layer on top.

## 2. Why now

- Claude Code adoption inside agencies and product teams is growing weekly.
- Cloud dev environments (Codespaces, GitLab Web IDE, Gitpod, Azure Dev Box) are standardising the substrate, making centralised middleware tractable.
- Existing tools (Linear, Jira, WakaTime) track *work items* or *time*; none track AI-assisted decisions, blockers, and context — and none feed that data back into the AI loop.
- Agencies are under client pressure to evidence what AI-assisted developers are actually doing. Today they answer with screenshots and trust.

## 3. Target users

**Primary buyer:** consulting and development agency owners / heads of engineering, ~5–50 developer teams, billing clients per engagement.

**Primary daily users:**

- **Developers** — install once, then forget. Value is invisible: their AI sessions are smarter because the AI knows team context.
- **Engineering managers / agency leads** — daily dashboard, weekly reports, occasional digging into blockers and project status.
- **Clients (read-only)** — monthly digest or read-only portal showing engagement progress (deferred to v1.5; designed for in v1).

**Out of audience for v1:** solo developers (covered by the open-source Pulse), regulated enterprise (FedRAMP/HIPAA — defer to v2), non-Claude-Code workflows.

## 4. Core principles

1. **AI-context-sharing is the product.** Reporting is the wedge for the buyer; context-sharing is what makes developers keep it installed. Design every decision around the SessionStart/UserPromptSubmit context-injection loop.
2. **Overlay layer, never the repo.** No Pulse data is ever written to a project's git tree. Project bindings, member identity, and event data live entirely outside the repo.
3. **Local-first, cloud-synced.** The hook never blocks on the network. Local outbox + async sync daemon. Cloud dev environments use a memory queue and skip local persistence.
4. **At-least-once + idempotent.** Every event has a client-generated UUID; the server deduplicates. No exactly-once attempts.
5. **Server-side redaction before persistence.** Diffs and prompt payloads are filtered server-side per project policy before they hit durable storage.
6. **You always know it's working.** Heartbeats, a `doctor` CLI, and a synthetic canary are first-class features, not afterthoughts.
7. **Single source of truth: the canonical event log.** Derived tables (insights, daily summaries, reports) are rebuildable from the immutable event log.

## 5. Non-goals for v1

- Client-facing white-label portal (designed for, not built).
- Stripe billing automation (manual invoicing while ≤20 customers).
- On-prem / self-hosted deployment.
- Slack / Linear / Jira / GitHub PR integrations.
- Anomaly detection and AI-generated weekly digests.
- Mobile native app.
- Multi-region replication.
- SSO / SAML (defer until first enterprise deal).

## 6. Key user journeys

**J1 — Developer onboarding (cloud env)**
Admin invites Alice. Alice opens her Codespace. The platform secret `CLAUDE_PULSE_API_KEY` is already injected. The hook runs on SessionStart, identifies the project from `git remote`, posts events, and Alice's Claude session immediately receives team context. Alice does nothing.

**J2 — Developer onboarding (local)**
Alice installs the npm package, runs `code-pulse init`, signs in via OAuth device flow, and the API key is written to `~/.code-pulse/config.json`. Hook is wired into her global `~/.claude/settings.json`.

**J3 — Working session with team context**
Bob starts a session in the same project. SessionStart fetches the last N team insights (Alice's progress, decisions, blockers) and injects them into Bob's Claude context. Bob's AI knows what Alice decided yesterday without Bob being told.

**J4 — Blocker capture**
Bob hits a blocker. Stop hook fires the structured-summary prompt. Bob writes `BLOCKED: payment provider sandbox returns 502`. Insight lands in the central store. Carla, the lead, sees it on the dashboard within seconds.

**J5 — Admin: bind a new project**
A new repo appears in the dashboard under "Needs Review". Carla confirms, sets the redaction policy, assigns members. Subsequent events are attributed to the bound project.

**J6 — Manager weekly review**
Carla opens the team dashboard, filters to engagement "ClientX, last 7 days", sees session count, decisions, blockers, hotspot files, and exports a CSV for the client invoice.

**J7 — Doctor / debugging silent failure**
Daniel's events haven't synced in 6 hours. Admin UI flags his workstation as stale. Daniel runs `code-pulse doctor`, sees "API key 401 — rotated", fixes it, sync resumes.

## 7. Functional requirements

### F1 — Hook + sync daemon (client)
- Captures the same event types as the open-source Pulse: SessionStart, UserPromptSubmit, PostToolUse (Edit/Write/Bash/Read/Glob/Grep/Agent/Skill/WebFetch/WebSearch/ToolSearch), Stop, StopFailure, PreCompact.
- Writes to local SQLite outbox (local mode) or in-memory queue (cloud mode); separate daemon ships batches to API.
- Hook latency budget: <100 ms p99. Daemon never blocks the hook.
- Crash-safe: outbox survives reboots; daemon resumes from last unsynced row.
- Event payload includes UUID, version, hook timestamp, member identity is server-stamped from API key.

### F2 — Project identification
- Canonical key = normalized git remote URL (lowercase, strip auth, strip `.git`).
- Enriched server-side with provider repo ID (GitHub repo ID, GitLab project ID, Azure repo GUID) on first sighting via provider API.
- Cloud env env vars (`GITHUB_REPOSITORY`, `CI_PROJECT_PATH`, `BUILD_REPOSITORY_URI`) used as fast path before invoking git.
- Repos with no remote: explicit binding via `code-pulse bind <project-id>`, stored in workstation config — never in the repo.
- Auto-create draft project on first sighting; admin confirms in "Needs Review" queue.

### F3 — Identity & tenancy
- Hierarchy: org → team → member → project.
- Member auth: long-lived API key per workstation, scoped to one member, stored in env var (cloud) or workstation config (local), rotatable from admin UI.
- Dashboard auth: OAuth (Google + GitHub) → session cookie.
- Server stamps `member_id` from API key on every ingest. Clients cannot claim identity.
- Tenancy isolation enforced at every query (`org_id` filter mandatory).

### F4 — Ingest API (`POST /v1/events`)
- Accepts batched events, gzip-compressed, idempotent on event UUID.
- Per-API-key rate limit (default 100 events/sec).
- Validates schema, enforces tenancy, runs redaction pipeline before durable write.
- Synchronous Postgres write; returns 2xx only after durable.
- Versioned payload; server tolerates ≥6 months of older versions.

### F5 — Read API (`GET /v1/projects/:id/context`)
- Returns the SessionStart context payload: recent team insights (progress, decisions, blockers), top files, active members, recent failures, today's stats.
- Pre-aggregated cache; p99 latency <500 ms.
- Per-project access control; rejects requests for projects member doesn't have access to.
- Defense-in-depth redaction applied on read.

### F6 — Live updates
- SSE channel `/v1/stream` for dashboard auto-update on new events/insights.
- No live updates for hook reads (pull-on-demand with short cache TTL is sufficient).

### F7 — Admin UI
- Members: list, invite, role (admin/member), deactivate, rotate API key, last-seen.
- Projects: list (with "Needs Review" badge), bind to remote URL, set redaction policy, assign member access, archive.
- Org settings: name, billing email, retention policy, default redaction policy, audit log.
- API keys: per-member tokens, last-used, revoke.
- Audit log: who changed what, when (sells the compliance story).

### F8 — Team dashboard
- Team timeline: live feed of sessions across the org, filterable by member, project, date range, event type.
- Project view: per-project insights, blockers, hotspot files, member activity, session list.
- Member view: per-member activity, projects touched, contributions.
- Insights search: cross-project search of progress/decisions/blockers/patterns/fixes/context.
- Reports view: configurable date range + project filter, CSV export, summary stats.

### F9 — Doctor CLI (`code-pulse doctor`)
- Verifies: API reachable, key valid, last-sync recent, project bound, hook installed, redaction policy fetched, outbox depth healthy.
- Pass/fail per check; suitable for local invocation and CI.

### F10 — Heartbeat & canary
- Every SessionStart posts a tiny heartbeat event.
- Admin UI surfaces "last seen" per member; flags stale workstations.
- Server-side scheduled synthetic canary (every 5 min) posts a known event and verifies it appears via the read API; pages on failure.

## 8. Functional guarantees

The middleware is functional only if all seven hold:

| # | Guarantee | Enforced by |
|---|-----------|-------------|
| 1 | No event loss across reboots, network blips, hook timeouts | Local outbox + retry-with-backoff + idempotent ingest |
| 2 | At-least-once delivery without duplicates | Client UUID + server `INSERT ... ON CONFLICT DO NOTHING` |
| 3 | Hook latency <100 ms p99 | Hook writes locally only; daemon does network |
| 4 | Tenancy isolation | API key scoped to org+member; every query filtered by `org_id` |
| 5 | Identity provenance | Server stamps `member_id` from API key, ignores client claims |
| 6 | Read freshness <500 ms p99 for SessionStart | Pre-aggregated insight cache; warm-path Postgres index |
| 7 | Redaction before persistence | Server-side pipeline runs before durable write; defense-in-depth on read |

## 9. Architecture overview

```
┌─ Workstation (local or cloud env) ─────────┐
│                                            │
│  Claude Code ──hook──▶ outbox/queue        │
│                            │               │
│                            ▼               │
│                       sync daemon          │
└────────────────────────────│───────────────┘
                             │ HTTPS, gzip, batched
                             ▼
                    ┌──── Ingest API ────┐
                    │ auth, validate,    │
                    │ redact, dedupe     │
                    └─────────│──────────┘
                              ▼
                       ┌── Postgres ──┐
                       │ events log,  │
                       │ derived      │
                       │ tables       │
                       └──────│───────┘
                              │
              ┌───────────────┼─────────────────┐
              ▼               ▼                 ▼
        Read API       SSE stream         Background
        (context,    (live dashboard)     workers
         reports)                         (rollups,
                                           redaction,
                                           aggregates)
                              │
                              ▼
                  Admin UI / Team Dashboard
                  (Next.js, OAuth)
```

- Stateless API tier (Node or Go) behind a load balancer.
- Postgres as canonical store. Defer ClickHouse / queue (SQS/NATS) until QPS or analytics workload demands it.
- Background workers handle redaction, rollups, "needs review" flagging, dead-letter replay.
- Single region for v1.

## 10. Project identification model

- **Canonical key:** normalized git remote URL.
- **Enrichment:** provider repo ID fetched on first sighting (GitHub `repository.id`, etc.) — survives renames and ownership changes.
- **Override mechanism:** explicit per-org binding in admin UI (e.g. "treat fork X as project Y").
- **Monorepo support:** server-side rules can split a single repo into multiple Pulse projects based on `cwd` patterns. Defer until first customer needs it.
- **Edge cases:** repos without remote → explicit `bind` command, workstation-local config only.

## 11. Multi-tenancy model

```
orgs
 └── teams (optional grouping; v1 may collapse to single team per org)
      └── members
           └── api_keys (1:1 with workstation, rotatable)
      └── projects
           └── member_project_access (RBAC per project)
           └── redaction_policy (FK)
      └── sessions / tool_events / insights / blueprint_runs
           (every row carries org_id, member_id, project_id)
```

- Every query in the read path filters by `org_id` first.
- Teams are optional in v1 — most agencies have one team per org. Build the column, hide the UI.

## 12. Privacy & redaction

- Default policy: keep insights, tool counts, file paths; drop `diff_content` and prompt payloads.
- Per-project policy override: keep diffs (for high-trust internal projects), hash file paths (for client work), regex-redact commands (drop tokens that look like secrets).
- Redaction runs server-side before durable write. Defense-in-depth: applied again on read.
- Future: client-side encryption with team-held keys (sell as enterprise tier).

## 13. API surface (high-level)

| Endpoint | Purpose |
|----------|---------|
| `POST /v1/events` | Batched event ingest, idempotent on UUID |
| `GET /v1/projects/:id/context` | SessionStart payload (team insights, hot files, etc.) |
| `GET /v1/stream` | SSE for dashboard live updates |
| `GET /v1/projects` | List org projects (with needs-review status) |
| `POST /v1/projects/:id/bind` | Confirm/rename a needs-review project |
| `GET /v1/members` / `POST /v1/members/invite` | Member management |
| `POST /v1/members/:id/keys` | Issue/rotate API keys |
| `GET /v1/reports?...` | Aggregated reports for date range / project / member |
| `GET /v1/health` | For doctor + canary |

Full request/response contracts are a separate artifact (see Open Decisions).

## 14. Schema additions (on top of existing single-user schema)

- New: `orgs`, `teams`, `members`, `projects` (canonical), `member_project_access`, `redaction_policies`, `api_keys`, `audit_log`, `dead_letter_events`.
- Modified: `sessions`, `tool_events`, `insights`, `blueprint_runs`, `daily_summaries`, `file_activity` — each gains `org_id` (FK), `member_id` (FK), `project_id` (FK to canonical project record).
- Existing `user`/`hostname` columns retained for forensic audit; `member_id` becomes the canonical author.
- `event_log` table: append-only, immutable; raw event payload as JSONB. Source of truth for rebuilds.

## 15. Observability requirements

- Per-event metadata: `hook_version`, `client_os`, `cloud_env_kind` (codespaces/gitpod/local/etc.).
- Per-member: `last_sync_at`, outbox depth (reported via heartbeat).
- Server metrics: ingest p50/p99, error rate per org, dead-letter rate, cache hit rate on context reads.
- Alerts: synthetic canary failure, dead-letter spike, ingest p99 over budget.
- Admin UI surface: stale workstations panel, dead-letter inspector (admin only).

## 16. Decisions (closed 2026-05-02)

| # | Decision | Resolution | Rationale |
|---|----------|------------|-----------|
| D1 | Auto-create vs pre-bind on first project sighting | **Auto-create with "needs review" flag** | Removes onboarding friction; admin queue keeps the dashboard tidy |
| D2 | Synchronous Postgres write vs queue-first ingest | **Synchronous for v1** | Postgres handles expected QPS; queue adds complexity without payoff at this scale |
| D3 | Server-side redaction vs client-side encryption for v1 | **Server-side** | TLS + opt-in retention is enough for SaaS-default; client-side encryption deferred to enterprise tier |
| D4 | OAuth providers for dashboard | **Google + GitHub** | Covers ~95% of agency dev teams; `arctic` (oslo) supports both with one library |
| D5 | Postgres only vs Postgres + ClickHouse | **Postgres only for v1** | Daily aggregate rollups handle reporting workload; revisit if a customer hits >10M events/day |
| D6 | Single team per org vs full team hierarchy in v1 | **Build column, hide UI** | Most agencies = one team per org; column lets us surface UI later without migration |
| D7 | Heartbeat cadence | **Every SessionStart + every 30 min idle while a session is open** | Catches silent failures within minutes; cheaper than per-event ack |
| D8 | Backend stack | **Node 22 + Hono on Fly.io, Postgres on Neon, Drizzle ORM** | TypeScript with the dashboard, minimal ops, branchable preview DBs (see STACK.md) |
| D9 | Workstation API key format | **`cpt_<base32-32B>` stored hashed (HMAC-SHA-256 with server-side pepper); last 4 chars in plaintext for display** | Industry standard; can rotate without re-issuing all keys |

## 17. Success metrics (90 days post-launch)

- ≥10 paying agencies with ≥3 developers each.
- ≥80% of installed workstations heartbeating within last 24h (proxy for "still installed and working").
- p99 hook latency <100 ms across all customers.
- p99 read-context latency <500 ms.
- Zero data-loss incidents reported.
- ≥40% of customers using the reports/export feature monthly (proxy for stickiness beyond context-sharing).

## 18. Phased roadmap

**Phase 0 — Foundations (4–6 weeks)**
- Hook fork with API mode (local outbox + sync daemon, cloud env detection).
- Ingest API + Postgres schema + auth.
- Admin UI: members, projects, API keys.
- Doctor CLI + heartbeat + canary.

**Phase 1 — MVP (4 weeks)**
- Team dashboard (live timeline, project view, member view, insights search).
- Read API for SessionStart context (team-scoped).
- Reports view + CSV export.
- Onboarding flows (cloud + local).
- Pricing + manual invoicing.

**Phase 2 — Stickiness (6 weeks)**
- Read-only client portal (sanitized engagement view).
- Slack integration for blockers.
- Linear/Jira link for insights.
- Stripe billing.

**Phase 3 — Enterprise (deferred)**
- SSO/SAML, SOC2, on-prem option, regional replication.

---

*This document is a living draft. Open decisions in §16 should be closed before each becomes load-bearing.*
