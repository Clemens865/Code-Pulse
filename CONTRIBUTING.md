# Contributing

Thanks for helping build Code Pulse.

## Dev setup

See the README quickstart. Short version:

```bash
cd apps/api && docker compose up -d && cp .env.example .env  # fill secrets
npm install && npm run db:migrate && npm run bootstrap -- --org Dev --email dev@example.com
npm run dev                      # API :8787
cd ../.. && npm install && npm run dev   # dashboard :3142
```

The workstation hook lives in `packages/hook` (bash + TypeScript CLI).
`npm run build` there refreshes `dist/` — commit `dist/` together with `src/`
changes; the global CLI runs from it.

## Checks before a PR

```bash
npm run typecheck   # root — dashboard + hook
cd apps/api && npm run typecheck && npm test
```

CI runs the same, plus a migrate-from-empty smoke against Postgres.

## Guidelines

- `event_log` is the immutable source of truth; derived tables must stay
  rebuildable from it.
- The hook must never block or break a Claude Code session: every external
  call gets `|| true`, and failure means silent exit 0.
- Anything that persists new payload data must go through
  `applyRedaction` — the always-on secret masking is not optional.
- Migrations: add a new `drizzle/migrations/NNNN_name.sql` (idempotent,
  `IF NOT EXISTS`, header comment explaining why) and mirror schema changes
  in `src/db/schema.ts`.
- Conventional commits (`feat:`, `fix:`, `docs:` …).

## Reporting security issues

Please do not open public issues for vulnerabilities — see
[SECURITY.md](./SECURITY.md).
