# Claude Pulse Team — API

Node 22 + Hono + Drizzle. See `docs/team-saas/API.md` for the contract and `docs/team-saas/SCHEMA.sql` for the canonical DDL (mirrored at `drizzle/migrations/0000_init.sql`).

## Local development

Prerequisites: Node 22+, Docker.

```bash
# Postgres
docker compose up -d

# Env
cp .env.example .env
# Generate the two required secrets:
node -e "console.log('API_KEY_PEPPER=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('HEALTH_DEEP_TOKEN=' + require('crypto').randomBytes(16).toString('hex'))"

# Schema
npm install
npm run db:migrate

# Run
npm run dev
# → http://localhost:8787/v1/health
```

## Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET  | /v1/health      | none           | liveness |
| GET  | /v1/health/deep | canary token   | DB connectivity probe |
| POST | /v1/events      | workstation    | idempotent batched ingest |

Other endpoints (context, stream, dashboard reads, admin) land in subsequent sprints.

## Smoke test

```bash
# 1. Seed an org, member, and api key (use psql until admin endpoints land):
psql $DATABASE_URL <<SQL
INSERT INTO orgs (id, name, slug) VALUES ('00000000-0000-0000-0000-000000000001', 'Smoke', 'smoke');
INSERT INTO members (id, org_id, email, name, role, status)
  VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'smoke@example.com', 'Smoke', 'owner', 'active');
SQL

# 2. Issue an API key (TODO once admin endpoint exists). For now, hand-roll with the
#    `generateApiKey()` util via a one-off script.

# 3. POST a synthetic event:
curl -s -X POST http://localhost:8787/v1/events \
  -H "Authorization: Bearer cpt_<your-token>" \
  -H "Content-Type: application/json" \
  --data @- <<JSON
{
  "v": 1,
  "events": [{
    "id": "01957b4c-e2a0-7e1d-8a10-3c4f9b1e2d77",
    "kind": "session.start",
    "session_id": "0195789a-8000-7000-8000-000000000001",
    "project": { "remote_url": "https://github.com/smoke/test.git" },
    "client": { "hook_version": "1.4.0", "os": "darwin", "cloud_env": "local" },
    "hook_ts": "2026-05-02T12:00:00Z",
    "payload": {}
  }]
}
JSON
```

## Deploy (Fly.io)

```bash
fly launch --no-deploy            # one-time, creates the app
fly secrets set DATABASE_URL=... API_KEY_PEPPER=... HEALTH_DEEP_TOKEN=...
fly deploy
```

Migrations run as the Fly `release_command` before each new version goes live.

## Layout

```
apps/api/
├── src/
│   ├── index.ts                 # Hono entrypoint
│   ├── env.ts                   # Zod-validated env
│   ├── auth/workstation.ts      # bearer-token middleware
│   ├── lib/
│   │   ├── errors.ts            # problem+json helpers
│   │   ├── keys.ts              # API key gen + HMAC hashing
│   │   ├── projects.ts          # canonical-key + auto-create
│   │   └── redaction.ts         # stub redaction pipeline
│   ├── schemas/events.ts        # Zod request/response shapes
│   ├── routes/
│   │   ├── health.ts            # /v1/health, /v1/health/deep
│   │   └── events.ts            # POST /v1/events
│   └── db/
│       ├── index.ts             # Drizzle client
│       ├── schema.ts            # Drizzle table definitions
│       └── migrate.ts           # bootstrap migration runner
├── drizzle/migrations/0000_init.sql
├── docker-compose.yml
├── Dockerfile
├── fly.toml
└── tsconfig.json
```
