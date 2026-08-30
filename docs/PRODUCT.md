# Code Pulse

> **The code knows *what*. Pulse is the *how* and *why*.**

*The middleware that turns AI-assisted development into shared team
knowledge — and feeds it back into every AI session as context.*

*Master document — for investors, design partners, and prospective customers.*
*Companion to the engineering [PRD](./team-saas/PRD.md).*

---

## 1. The pitch in one paragraph

Git, your IDE, and your repo already record *what* changed: which files,
which lines, which commits. None of them record *how* the change was made
or *why* it was made that way. When AI is doing 60% of the authoring,
that gap is now where most of the value lives — and where every audit,
incident, and onboarding question lands.

**Code Pulse is the middleware layer that captures every
AI-assisted session, turns it into queryable team knowledge, and feeds
that knowledge back into the next AI session as context.** The result:
smarter AI for every developer, real-time visibility for managers,
defensible audit trails for compliance, and evidence for clients —
without anyone changing how they work.

---

## 2. The problem

AI-assisted development is now the default in a growing number of teams.
The shift creates seven problems most teams don't realize they have until
something forces the question — an audit, an incident, a client review, a
new hire onboarding into a project the AI has been building for six
weeks. The first five are felt by engineers and AI itself; the last two
are felt by managers and the people writing checks.

### 2.1 Compliance and the audit trail

The EU AI Act is entering enforcement. **Article 12** requires logs of AI
operations. **Article 14** requires demonstrable human oversight. ISO 42001
and SOC 2 controls increasingly extend the same logic to internal AI usage.
Most teams currently have `git blame` and hope.

Pulse Team captures a complete, immutable, exportable audit trail
automatically — from the first session, with no developer action required.
Every event is server-stamped with member identity (clients can never
claim identity), redacted server-side per project policy before durable
write, and persisted in an append-only `event_log` table that derived
tables are rebuildable from.

### 2.2 Code audit and incident response

Something breaks in production. The code was AI-assisted. *"Which sessions
touched this file?"* — queryable. *"Why was this approach chosen?"* — in
the database, in the developer's own words. *"What commands failed during
that work?"* — logged with `command_failed` flags. *"Which member ran
which agent at which timestamp?"* — every tool invocation has org / member
/ project / session / timestamp / file path / language.

Every question compliance or engineering will ask after an incident — answered
without a postmortem reconstruction. Incident response goes from "let me
check Slack" to a single dashboard query.

### 2.3 Structured decisions, not free text

When developers wrap a session with Pulse, they fill in three typed lines:

```
PROGRESS: <what advanced>
DECISION: <what was decided and why>
BLOCKED: <what's stuck>
```

Each line lands as a typed `insights` row — not a text blob — with a
`type` enum, a `reasoning` field, project and session linkage, and full-text
indexed content. The difference between *"we logged everything"* and *"we
can reconstruct why"* is the difference between an unsearchable transcript
archive and a queryable decision graph.

### 2.4 Cross-project memory — one database

When a developer opens a session, Claude already knows what they did last
time, what's blocked, what other projects they've been active in.
**Bob's AI knows what Alice decided yesterday without Bob being told.**

No manual context setting. No copy-pasting summaries. No "here's a Notion
doc, please catch up." The SessionStart hook fetches the project's
team-scoped context payload (recent insights, hot files, active members,
open blockers) in <500 ms p99 and injects it into the new Claude session.

This is the wedge. Reporting is what gets the buyer to sign. Context-sharing
is what makes developers refuse to uninstall it.

### 2.5 Accumulated knowledge that compounds

Patterns, fixes, context — three of the six insight types are explicitly
designed to be *survivable*. Captured mid-session, surfaced at the start
of the next one, searchable across all projects forever.

Most teams' AI knowledge today disappears the moment the chat window
closes. The next developer working on the same problem starts from zero
and re-derives the same answer. Pulse Team converts ephemeral session
output into accumulating team capital.

### 2.6 Status opacity for engineering managers

When AI drives 60% of the authoring, *"what did the team get done today?"*
becomes unanswerable from git commits or Linear tickets alone. Commits
ship in batches and bury the work that happened between them. Linear
captures intent, not effort. Slack captures complaints. The substance
lives in session transcripts that, until now, no manager could search
across.

The Overview dashboard converts that substance into a single live surface:
sessions trailing 7 days, decisions logged, open blockers (with one-click
drill-down to the originating session), lines net, active members, top
projects, top contributors. The manager's daily question — *"is anything
on fire and is anyone stuck?"* — gets a 30-second answer instead of a
15-minute Slack scroll.

### 2.7 Client invisibility for agencies

Agencies billing for AI-augmented work face client pushback: *"What did
your team actually do?"* Today, agencies answer with screenshots and
trust. That doesn't survive procurement, and it definitely doesn't
survive a fixed-fee renegotiation.

Pulse Team's Reports view + CSV export is designed to be the artifact an
agency hands to a client without modification. Filter by engagement
(project) and date range. The export contains: sessions, hours of
AI-assisted work, decisions logged, blockers raised and resolved, lines
added/removed, files touched, member-by-member breakdown. This is the
evidence trail that converts *"trust us"* into *"here's the data."*

### 2.8 The category gap

Existing tools target adjacent problems but none target this one:

| Tool | What it tracks | Gap |
|---|---|---|
| Linear / Jira | Manually entered work items | Misses everything in between tickets |
| WakaTime / RescueTime | Time spent in editor | No content; no AI signal |
| GitHub / GitLab | Commits and PRs | Lossy; the lossless work happens *between* commits |
| Cursor / Copilot dashboards | Per-user usage of *one tool* | Single-vendor, single-user; no team layer |
| Datadog / Sentry | Production errors | Wrong category — runtime, not authoring |

**There is no "Datadog for AI-assisted development."** That's the category
this product creates.

---

## 3. Why now

Three things changed in 2025 that make this a tractable category:

1. **Claude Code adoption has crossed the chasm inside agencies and
   product teams.** Most engineering managers we talk to now run Claude
   Code as a default tool, not a curiosity.
2. **Cloud development environments (Codespaces, Gitpod, GitLab Web IDE,
   Coder, Azure Dev Box) have standardized the substrate.** This makes
   centralized middleware tractable: a single workstation API key as a
   workspace secret is enough to onboard a developer with zero touch.
3. **Procurement-driven demand.** Agencies are under client pressure to
   evidence what AI-assisted developers are actually doing. Today they
   answer with screenshots. As AI's share of billed hours grows, that
   answer stops being acceptable.

The window is now: the substrate is ready, the demand is real, and no
incumbent has noticed. In 18 months the obvious players (Linear, GitHub,
Datadog) will all add some version of this. By then, we own the data
ingestion layer and the AI-context-feedback loop.

---

## 4. What we do

Three product surfaces, one data backbone.

### 4.1 The hook + sync daemon (every developer)

A small, local-first agent that runs inside Claude Code. It captures every
session start, every tool invocation (Edit / Write / Bash / Read / Agent /
Skill / WebFetch), every structured summary at session end, and every
blueprint run. It writes to a local SQLite outbox in <100 ms p99 and ships
batches asynchronously. The developer does nothing.

### 4.2 The team dashboard (every role)

A multi-tenant SaaS surface that organizes captured data into views that
serve four audiences:

- **Engineering managers** — daily Overview, weekly Reports, blocker triage
- **Developers** — search teammates' insights, see what changed in projects
  they're about to work on
- **Org admins** — member management, project binding, redaction policy,
  audit log
- **Clients** *(post-v1)* — read-only sanitized engagement summary

### 4.3 The context-feedback loop (the moat)

This is what makes the product different from a passive activity tracker.
On every `SessionStart`, the developer's hook fetches `GET /v1/projects/:id/context`
— a server-rendered summary of recent team decisions, open blockers, and
hot files for the project they're about to work on. That payload is
injected into the new Claude session as system context.

**Bob's AI knows what Alice decided yesterday without Bob being told.**

This is the wedge. Reporting is what gets the buyer to sign. Context-sharing
is what makes developers refuse to uninstall it.

---

## 5. How it works (customer view)

```
  Workstation (local or cloud)
  ─────────────────────────────
  Claude Code ──hook──▶ outbox/queue
                            │
                            ▼
                       sync daemon
                            │
                            ▼ HTTPS · gzip · batched · idempotent
                  ─────────────────────
                  Ingest API (Hono/Node)
                  · validates · redacts ·
                  · stamps identity ·
                  ─────────────────────
                            │
                            ▼
                    Postgres (Neon)
                            │
              ┌─────────────┼──────────────┐
              ▼             ▼              ▼
        Read API       SSE stream     Background
       (context,     (live update)     workers
        reports)                       (rollups,
                                        canaries)
                            │
                            ▼
              Admin UI / Team Dashboard
                  (Next.js, OAuth)
```

Seven engineering guarantees define the middleware:

| # | Guarantee | How |
|---|---|---|
| 1 | No event loss across reboots, network blips, hook timeouts | Local outbox + retry-with-backoff + idempotent ingest |
| 2 | At-least-once delivery without duplicates | Client UUID + server `INSERT ... ON CONFLICT DO NOTHING` |
| 3 | Hook latency <100 ms p99 | Hook writes locally only; daemon does network |
| 4 | Tenancy isolation | API key scoped to org+member; every query filtered by `org_id` |
| 5 | Identity provenance | Server stamps `member_id` from API key; clients cannot claim identity |
| 6 | Read freshness <500 ms p99 for SessionStart | Pre-aggregated insight cache; warm-path Postgres index |
| 7 | Redaction before persistence | Server-side pipeline runs before durable write; defense-in-depth on read |

If any of these fail, the product is broken. They are first-class
requirements, not nice-to-haves.

---

## 6. Who it's for

### Primary buyer (v1)

**Heads of engineering and agency owners running 5–50 developer teams.**
They sign the contract and run the dashboard. They have three explicit
pains: status opacity, client evidencing, and the ratchet of AI cost
without visibility.

### Primary daily users

- **Developers** — install once, then forget. Value is invisible: their
  AI sessions are smarter because the AI knows team context.
- **Engineering managers / agency leads** — daily dashboard, weekly
  reports, blocker triage.
- **Clients** *(read-only, post-v1)* — monthly digest or read-only
  portal showing engagement progress.

### Out of audience for v1

- Solo developers (covered by the open-source [Claude Pulse](https://github.com/Clemens865/Claude-Pulse))
- Regulated enterprise (FedRAMP, HIPAA strict) — Phase 3
- Non-Claude-Code workflows (Cursor, Cody, etc.) — adjacent expansion

---

## 7. Differentiation

Six things, in order of moat depth:

1. **The context-feedback loop.** Other tools observe activity. We feed
   what we observe *back* into the AI loop. This produces a step-change
   in AI usefulness inside teams that incumbents can't match without
   building the same data backbone.
2. **Typed, queryable decisions.** Most "AI logging" tools store
   transcripts. We store typed insight rows with `decision`, `blocker`,
   `progress`, `pattern`, `fix`, and `context` enums plus a `reasoning`
   field. This is what makes the data a *graph* rather than an *archive*.
3. **Local-first + cloud-synced architecture.** Hook never blocks. Outbox
   survives reboots. We built it on top of six months of single-user
   open-source experience that already proved the architecture.
4. **Observability of the toolchain itself.** Hooks fail. Keys rotate.
   Sync stalls. Most "AI logging" tools have no answer for silent
   degradation — they just stop sending. We treat the tool chain as the
   primary thing being observed: per-session heartbeats, server-side
   synthetic canary every 5 minutes, stale-workstation flagging in the
   Admin UI, and a `doctor` CLI that runs eight checks and tells you the
   first failing one. *"Why has nobody on the team logged anything for
   three days?"* gets answered in seconds, not after the manager finally
   notices.
5. **Server-side redaction before persistence.** Most observability tools
   collect raw data and trust the consumer. We treat redaction as a
   product feature, not an afterthought — which is what makes us sellable
   to procurement at agencies handling regulated client work.
6. **Model-agnostic data backbone.** The schema and ingest API are
   tool-neutral. Adding a Cursor, Cody, or Aider adapter is a hook fork
   (~1–2 weeks each), not a re-platform. See §7.5 below.

### 7.5 Is this model-agnostic?

The data backbone is, today. The hook is currently Claude-specific.

| Layer | Status | Notes |
|---|---|---|
| Database schema | **Already model-agnostic** | `tool_events.tool_name` is plain TEXT; sessions/insights/projects carry no Claude-specific columns |
| Ingest API | **Already model-agnostic** | Validates against a generic event envelope; no Claude-specific fields |
| Read API (SessionStart context) | **Already model-agnostic** | Returns plain insight + file activity; consumed via JSON, no agent assumption |
| Hook (`packages/hook`) | **Claude Code only** | Wraps Claude Code's hook contract (SessionStart / UserPromptSubmit / PostToolUse / Stop / StopFailure / PreCompact) |
| Dashboard | **Agnostic by design** | Renders whatever lands in the database |

**Adapter strategy.** Each LLM agent gets its own thin adapter package
that normalizes that agent's primitives onto the canonical event schema
we already have:

- `@code-pulse/hook-claude` *(current)* — Claude Code
- `@code-pulse/hook-cursor` *(planned, Phase 2)* — Cursor
- `@code-pulse/hook-cody` *(planned, Phase 3)* — Sourcegraph Cody
- `@code-pulse/hook-aider` *(planned, Phase 3)* — Aider CLI
- Generic IDE adapter via LSP-level events *(speculative)* — fallback for
  unsupported agents

The only schema add for clean multi-vendor is `sessions.agent_kind TEXT`
(`claude_code` | `cursor` | `cody` | `aider` | `other`) so reports can
split by agent. Trivial migration.

This positioning matters strategically: **if Anthropic ships native team
observability for Claude Code, we become the multi-vendor superset.** Most
agency teams already use more than one AI agent — Cursor in some IDEs,
Claude Code in others, sometimes both on the same repo. The pulse layer is
where they unify.

---

## 8. Commercial model

### 8.1 Pricing hypothesis (v1)

Per-seat SaaS, three tiers. Pricing benchmarked against GitHub Copilot
Business ($19/seat/mo) and Linear ($8–14/user/mo).

| Tier | Price | Seats | Includes |
|---|---|---|---|
| **Starter** | $15 / seat / mo | up to 10 | Full team dashboard, ingest API, hook + doctor CLI, standard redaction |
| **Studio** | $25 / seat / mo | up to 50 | Adds: per-project redaction policy, audit log, CSV export, multiple projects per org |
| **Enterprise** | Custom (target $40+ / seat / mo) | unlimited | Adds: SSO/SAML, on-prem option, custom retention, regional replication, dedicated support |

Manual invoicing while ≤20 customers; Stripe billing wired in Phase 2.

### 8.2 Unit economics (early)

Per-developer monthly cost to serve, at typical activity:

- **Compute (API + dashboard, Fly.io):** ~$0.40 / dev / mo
- **Database (Neon Postgres):** ~$0.60 / dev / mo at 30 sessions/dev/week, 90-day retention
- **Outbound bandwidth:** ~$0.10 / dev / mo
- **Total cost to serve:** ~$1.10 / dev / mo

At Studio pricing ($25/seat), that's a 95%+ gross margin pre-S&M.

### 8.3 Go-to-market motion

- **Land:** Direct sales to agency owners and heads of engineering at
  shops already running Claude Code. The OSS [Claude Pulse](https://github.com/Clemens865/Claude-Pulse)
  acts as a top-of-funnel signal: solo users self-select into a curiosity
  about team-level visibility.
- **Expand:** Per-seat expansion is mechanical (every new hire is a new
  seat). Per-project pricing tier upgrade kicks in once an agency hits
  multiple client engagements.
- **Retain:** The context-feedback loop is the retention engine. Once a
  team relies on AI-with-team-memory, removing it visibly degrades AI
  quality. Reporting is the buyer's reason to renew; context-sharing is
  the developer's reason to keep it installed.

### 8.4 Sales benchmarks (rough targets, 90 days post-launch)

- ≥10 paying agencies with ≥3 developers each (~50 paid seats).
- ≥80% of installed workstations heartbeating within last 24h (proxy for
  "still installed and working").
- p99 hook latency <100 ms across all customers.
- p99 read-context latency <500 ms.
- Zero data-loss incidents reported.
- ≥40% of customers using Reports / CSV export monthly (proxy for
  stickiness beyond context-sharing).

---

## 9. Risk register

The five risks most likely to bend the trajectory:

1. **Anthropic ships team observability natively.** Mitigation: the data
   backbone (schema + ingest API + read API + dashboard) is already
   model-agnostic. The Claude-specific surface is the hook itself, which
   is a thin wrapper (~600 lines) easily forked into a per-agent adapter.
   If Anthropic ships a team feature, we ship adapters for Cursor, Cody,
   and Aider on the same week and become the multi-vendor superset
   instead of competing head-on. See §7.5.
2. **A team can't articulate ROI in the first 30 days.** Mitigation: the
   Reports view + CSV export is designed to be the artifact a manager
   shows their leadership in week 2.
3. **Client redaction concerns block agency adoption.** Mitigation:
   server-side redaction policy + per-project override + audit log is a
   first-class part of the v1 surface, not Phase 2.
4. **Hook latency creep degrades developer experience.** Mitigation: <100ms
   p99 is a hard guarantee; canaries page on regression.
5. **Single-vendor reliance on Claude Code.** Mitigation: PRD-level
   commitment to abstract event capture; the schema and ingest API are
   tool-neutral. Adding Cursor or Cody is a hook fork, not a re-platform.

---

## 10. Phased roadmap

**Phase 0 — Foundations** *(4–6 weeks, in progress)*
Hook fork with API mode (local outbox + sync daemon, cloud env detection).
Ingest API + Postgres schema + auth. Admin UI: members, projects, API keys.
Doctor CLI + heartbeat + canary.

**Phase 1 — MVP** *(4 weeks)*
Team dashboard: live timeline, project view, member view, insights search.
Read API for SessionStart context (team-scoped). Reports view + CSV export.
Onboarding flows (cloud + local). Pricing + manual invoicing.

**Phase 2 — Stickiness** *(6 weeks)*
Read-only client portal. Slack integration for blockers. Linear / Jira link
for insights. Stripe billing. **Compliance Export** (Article 12 / SOC 2
audit pack). **Cursor adapter** (`hook-cursor`) — first multi-vendor
proof point. **File-scoped incident view** (`/team/projects/[id]/files/[path]`).
**Patterns Library** (`/team/patterns` — cross-project pattern/fix/context
view).

**Phase 3 — Enterprise** *(post-product-market-fit)*
SSO / SAML. SOC 2. On-prem option. Regional replication. Cody and Aider
adapters. ISO 42001 alignment pack.

---

## 11. Where we are today (honest snapshot)

This section is a moving target. Last updated 2026-05-02.

- **Open-source Claude Pulse** (single-user predecessor): shipped, tested
  in production by ~hundreds of developers. Established the local-first
  architecture and the structured-summary capture pattern.
- **Team product scaffold:** dashboard exists at all major routes
  (`/team/{overview, timeline, projects, projects/[id], members,
  insights, reports, sessions/[id], admin/...}`). Sample data wired
  end-to-end.
- **Backend (`apps/api`):** Hono on Node 22, Drizzle ORM, Postgres
  schema migrated. Auth scaffolded (OAuth + workstation API keys).
  Ingest API stubbed.
- **Hook (`packages/hook`):** CLI, install, doctor, sync daemon, outbox,
  agent — all scaffolded, end-to-end wiring in progress.
- **Live data path:** not yet end-to-end. Dashboard renders sample data
  with API adapters that fall through gracefully when ingest is empty.

The **Phase 0 → Phase 1 transition** is the next concrete milestone:
flipping the dashboard from sample-data to live-data, completing the
SessionStart context read API, and shipping the doctor + canary loop.

---

## 12. Why this is important

There is a generational shift happening in how software gets built. AI is
now writing more lines than humans on the teams we care about. The
infrastructure for **observing, sharing, and governing that work** does not
yet exist. Whoever builds it first becomes the data layer for the next
decade of software development — analogous to what GitHub became for
source control or what Datadog became for runtime.

The market signals are clear: agencies are paying for it manually today
(in screenshots and Slack updates), incumbents haven't noticed, and the
substrate (cloud dev environments + Claude Code adoption) is finally
mature enough to make it tractable.

We have a working open-source single-user predecessor proving the
architecture, a small ahead-of-curve advantage in the team layer, and a
clear path to ship the first commercial version in under three months.

---

## 13. Appendix — read further

- [Onboarding guide](./onboarding.md)
- [Compliance & audit mapping](./team-saas/COMPLIANCE.md) — EU AI Act, SOC 2, ISO 42001
- [Engineering PRD](./team-saas/PRD.md)
- [API contract](./team-saas/API.md)
- [Stack & hosting](./team-saas/STACK.md)
- [Design system & screens](./team-saas/DESIGN-PRD.md)
- [Database schema](./team-saas/SCHEMA.sql)
