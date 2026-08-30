# Code Pulse — API

Node 22 + Hono + Drizzle + Postgres. See `docs/team-saas/API.md` for the
contract and `docs/team-saas/SCHEMA.sql` for the canonical DDL (mirrored
at `drizzle/migrations/0000_init.sql`).

## Quickstart (5 minutes, end-to-end)

Prereqs: Node 22+, Docker.

```bash
cd apps/api

# 1. Postgres
docker compose up -d

# 2. Env — generate secrets and write .env
PEPPER=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
SESSION=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
CANARY=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
cat > .env <<EOF
NODE_ENV=development
PORT=8787
LOG_LEVEL=info
DATABASE_URL=postgres://cpt:cpt@localhost:56432/cpt_dev
API_KEY_PEPPER=$PEPPER
HEALTH_DEEP_TOKEN=$CANARY
DASHBOARD_ORIGINS=http://localhost:3142,http://localhost:3000
SESSION_SECRET=$SESSION
EOF

# 3. Schema
npm install
set -a && source .env && set +a
npm run db:migrate   # applies ALL drizzle/migrations/*.sql, tracked in _migrations

# 4. Run the API
npm run dev
# → http://localhost:8787/v1/health  (returns ok)
```

## Smoke test the data path

```bash
# 5. Seed an org + admin member + workstation API key (one shot)
set -a && source .env && set +a
npx tsx scripts/seed-smoke.ts
# → prints ORG_ID, MEMBER_ID, API_KEY=cpt_...

# 6. POST a synthetic event with the API key
KEY="cpt_<paste-from-step-5>"
EVID=$(node -e "console.log(crypto.randomUUID())")
SID=$(node -e "console.log(crypto.randomUUID())")
TS=$(node -e "console.log(new Date().toISOString())")
curl -s -X POST http://localhost:8787/v1/events \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"v\": 1,
    \"events\": [{
      \"id\": \"$EVID\",
      \"kind\": \"session.start\",
      \"session_id\": \"$SID\",
      \"project\": { \"remote_url\": \"https://github.com/test/smoke-repo\" },
      \"client\": { \"hook_version\": \"0.1.0-smoke\", \"os\": \"darwin\" },
      \"hook_ts\": \"$TS\",
      \"payload\": {}
    }]
  }"
# → {"received":1,"accepted":1,"duplicates":0,"rejected":[],...}

# 7. Verify the event landed
docker exec cpt-api-pg psql -U cpt -d cpt_dev \
  -c "SELECT id, event_kind, project_id, member_id, hook_ts FROM event_log ORDER BY hook_ts DESC LIMIT 3;"
```

## Connect the dashboard (live data)

The Next dashboard (`src/app/team/`) defaults `NEXT_PUBLIC_API_URL` to
`http://localhost:8787`.

```bash
# Create your org + owner + API key (prints sign-in ids and the key):
npm run bootstrap -- --org "Your Team" --email you@example.com

# In another shell:
cd ../..
npm run dev      # → http://localhost:3142
```

Open http://localhost:3142/team — the sign-in card lists your org and name
(local login; gated by LOCAL_LOGIN, enabled by default outside production).

## Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET  | /v1/health           | none         | liveness |
| GET  | /v1/health/deep      | canary token | DB connectivity probe |
| POST | /v1/auth/dev-login   | none (dev)   | dev-mode session bootstrap |
| GET  | /v1/auth/me          | dashboard    | current member + org |
| POST | /v1/auth/logout      | dashboard    | clear session cookie |
| POST | /v1/events           | workstation  | idempotent batched ingest |
| GET  | /v1/projects         | dashboard    | org's projects |
| GET  | /v1/projects/:id     | dashboard    | project detail (insights, hot files) |
| POST | /v1/projects/:id/confirm | dashboard | confirm needs-review project |
| PATCH| /v1/projects/:id     | dashboard    | rename / archive / un-flag |
| GET  | /v1/members          | dashboard    | org members + key status |
| POST | /v1/members/invite   | dashboard    | invite by email |
| PATCH| /v1/members/:id      | dashboard    | role / status changes |
| POST | /v1/members/:id/keys | dashboard    | issue workstation key (plaintext shown once) |
| GET  | /v1/admin/api-keys   | dashboard    | list keys |
| DELETE | /v1/api-keys/:id   | dashboard    | revoke a key |
| GET  | /v1/sessions/:id     | dashboard    | session detail (events, stats) |
| GET  | /v1/timeline         | dashboard    | live activity feed |
| GET  | /v1/insights         | dashboard    | typed insights search |
| GET  | /v1/reports/weekly   | dashboard    | aggregated weekly report |
| GET  | /v1/audit-log        | dashboard    | admin actions log |

## Layout

```
apps/api/
├── src/
│   ├── index.ts                 # Hono entrypoint, CORS, route mounts
│   ├── env.ts                   # Zod-validated env
│   ├── auth/
│   │   ├── workstation.ts       # bearer-token middleware (hook → API)
│   │   ├── session.ts           # signed-cookie session for dashboard
│   │   └── admin.ts             # role-gated middleware
│   ├── lib/
│   │   ├── errors.ts            # problem+json helpers
│   │   ├── keys.ts              # API key gen + HMAC hashing
│   │   ├── projects.ts          # canonical-key + auto-create
│   │   ├── redaction.ts         # per-project redaction pipeline
│   │   └── audit.ts             # audit_log writers
│   ├── schemas/events.ts        # Zod request/response shapes
│   ├── routes/
│   │   ├── health.ts            # /v1/health, /v1/health/deep
│   │   ├── auth.ts              # /v1/auth/{dev-login,me,logout}
│   │   ├── events.ts            # POST /v1/events
│   │   ├── projects.ts          # /v1/projects/...
│   │   ├── members.ts           # /v1/members/...
│   │   ├── sessions.ts          # /v1/sessions/:id
│   │   ├── timeline.ts          # /v1/timeline
│   │   ├── insights.ts          # /v1/insights
│   │   ├── reports.ts           # /v1/reports/weekly
│   │   └── admin.ts             # /v1/admin/api-keys, /v1/audit-log
│   └── db/
│       ├── index.ts             # Drizzle client
│       ├── schema.ts            # Drizzle table definitions
│       └── migrate.ts           # bootstrap migration runner
├── scripts/seed-smoke.ts        # one-shot seeder (org + member + key)
├── drizzle/migrations/0000_init.sql
├── docker-compose.yml
├── Dockerfile
├── fly.toml
└── tsconfig.json
```

## Deploy (Fly.io)

```bash
fly launch --no-deploy            # one-time
fly secrets set DATABASE_URL=... API_KEY_PEPPER=... HEALTH_DEEP_TOKEN=... SESSION_SECRET=...
fly deploy
```

Migrations run as the Fly `release_command` before each new version goes
live.
