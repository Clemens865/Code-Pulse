# Code Pulse — Stack & Deployment

*Status: Decided 2026-05-02*
*Companion: PRD.md, API.md, SCHEMA.sql*

This document records the v1 technology stack and deployment topology. Closed decisions are in PRD §16; this file gives the reasoning and the operational shape.

---

## 1. Components

```
                        ┌─ Vercel ─────────────────────┐
                        │ Next.js dashboard (existing) │
                        │  /            single-user    │
                        │  /team/*      team product   │
                        └────────────│─────────────────┘
                                     │ HTTPS + cookie session
                        ┌─ Fly.io ───▼─────────────────┐
                        │ API server (Node 22 + Hono)  │
                        │  /v1/events    ingest        │
                        │  /v1/projects/:id/context    │
                        │  /v1/stream    SSE           │
                        │  /v1/...       admin reads   │
                        └────────────│─────────────────┘
                                     │ TLS, pooled
                        ┌─ Neon ─────▼─────────────────┐
                        │ Postgres 16 (per-org isolated │
                        │ via row-level org_id filter) │
                        └──────────────────────────────┘
                                     ▲
            ┌────────────────────────┘
            │ HTTPS, gzip, batched
┌─ Workstation (local or cloud env) ────────────────────┐
│ Hook → outbox/queue → sync daemon → API              │
│ ~/.code-pulse/ (local mode)             │
│ env-only (cloud env mode: Codespaces, Gitpod, etc.)  │
└──────────────────────────────────────────────────────┘
```

## 2. Stack choices

### Backend (`/api/team-saas/` in a future server repo, or a workspace package)

| Concern | Choice | Why |
|---|---|---|
| Runtime | **Node 22 LTS** | Conservative, matches dashboard runtime, broad library support |
| Framework | **Hono v4** | Tiny, fast, edge-compatible; native streaming for SSE; first-class Zod validator |
| Validation | **Zod** + `@hono/zod-validator` | Single source of truth for request/response shapes; runtime + types |
| ORM | **Drizzle** + Drizzle Kit | Typed, lightweight, SQL-first migrations; works with Neon serverless driver |
| Auth (workstation) | Custom HMAC-keyed bearer token (`cpt_<base32-32B>`) | Long-lived API keys per workstation, revocable, hashed at rest |
| Auth (dashboard) | **Lucia v3** + **arctic** for OAuth | Google + GitHub with one library; session cookie pattern is well-trodden |
| Background jobs | **pg-boss** | Postgres-backed queue keeps infra count to one; sufficient for redaction + rollups |
| Rate limiting | `hono-rate-limiter` (in-memory) | Per-API-key bucket; one Fly machine for v1, swap to Redis later if needed |
| Observability | **OpenTelemetry → Honeycomb** (or Axiom) | One Fly app emits traces + structured logs; cheaper than building dashboards |
| SSE | Hono streaming | Native, no extra dependency |

### Database

| Concern | Choice | Why |
|---|---|---|
| Engine | **Postgres 16** | Boring, capable, JSONB for raw event payloads |
| Hosting | **Neon** | Branchable databases for preview environments; generous free tier; serverless driver compatible with Fly's edge |
| Migrations | **Drizzle Kit** | Versioned SQL, baseline from `SCHEMA.sql`, applied via Fly release command |
| Backups | Neon point-in-time | Built-in 7-day retention on free tier; upgrade if a customer demands more |

### Dashboard

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js 16** | Already in this repo |
| Hosting | **Vercel** | Free dev URLs, branch previews, fast for the team-product surface |
| State | React Server Components + `fetch` to API | No SWR/Tanstack Query needed for v1; revalidate on mutate |
| Auth client | Cookie set by API after OAuth callback | Dashboard is a thin client of the API |

### Workstation hook

| Concern | Choice | Why |
|---|---|---|
| Hook script | Bash + jq + sqlite3 (existing approach) | Already proven in single-user Pulse; no runtime to install |
| Sync daemon | Node script bundled into `code-pulse` npm package | Reuses TypeScript types from API contract |
| Local store | SQLite outbox + WAL | Survives reboots; existing approach |
| Cloud env detection | Standard env vars (`CODESPACES`, `GITPOD_WORKSPACE_ID`, `GITLAB_CI`, `TF_BUILD`, etc.) | Switches to in-memory queue mode |

## 3. Environments

| Environment | Purpose | URL pattern |
|---|---|---|
| Local dev | Developer machines | `http://localhost:8787` API, `http://localhost:3142` dashboard |
| Preview | Per-PR ephemeral environments | `pr-<n>.api.code-pulse.dev` + Neon branch DB |
| Staging | Internal dogfood + canary target | `staging.api.code-pulse.dev` |
| Production | Customer traffic | `api.code-pulse.dev`, `app.code-pulse.dev` |

Single region (initially `iad` on Fly, `us-east-2` on Neon). Add `fra` and a Neon EU branch when first EU customer signs.

## 4. Repositories / packages

For v1, keep a single repo with workspace packages:

```
code-pulse/
├── apps/
│   ├── dashboard/      ← existing Next.js (move src/app here later)
│   └── api/            ← Hono server (new)
├── packages/
│   ├── contracts/      ← shared TypeScript types from Zod schemas
│   ├── hook/           ← workstation hook + sync daemon
│   └── db/             ← Drizzle schema + migrations
└── docs/
```

Defer the workspace migration until the API is far enough along that sharing types becomes painful. For now: keep API + DB schema as standalone files under `docs/team-saas/` and a future `apps/api/` directory.

## 5. CI/CD

- **GitHub Actions** for typecheck, build, test on every PR.
- **Fly deploy** on push to `main` for the API.
- **Vercel deploy** on push to `main` for the dashboard.
- **Drizzle migrations** run as a Fly release command before each deploy.
- **Neon branches** auto-created per PR via Neon's GitHub integration; cleaned up on merge.

## 6. Cost envelope (v1, ~10 customers, ~50 active workstations)

| Service | Estimate |
|---|---|
| Fly.io (1× shared-cpu-1x app, US region) | ~$5/mo |
| Neon (free tier, then Launch ~$19/mo at ~10GB) | $0–19/mo |
| Vercel (Pro for team) | $20/mo |
| Honeycomb (free tier covers <20M events/mo) | $0 |
| Domain + email | ~$5/mo |
| **Total** | **~$30–50/mo before significant traffic** |

The architecture scales horizontally on Fly. Postgres scaling is the limit; pg-boss + connection pooling buys ~6 months of headroom before we'd consider read replicas or ClickHouse.

## 7. Migration triggers

We'll re-evaluate when any of these crosses:

- **>10M events/day across all orgs** → revisit ClickHouse for analytics offload (D5).
- **>1k concurrent SSE connections** → revisit pushing dashboard updates via Postgres `LISTEN/NOTIFY` or moving to Redis.
- **First enterprise/regulated buyer** → revisit on-prem option, SSO/SAML, regional replication.
- **>50 RPS sustained ingest** → revisit queue-first ingest (D2).

## 8. What's intentionally not in v1

- Multi-region replication.
- Redis (would only buy us cross-instance rate limit; one Fly machine is enough for now).
- Service mesh, k8s, or any container orchestration beyond Fly's machines.
- ClickHouse, BigQuery, or a separate analytics warehouse.
- Custom CLI auth flows beyond OAuth device flow.
- WebSockets (SSE is enough for our push needs and far simpler).
