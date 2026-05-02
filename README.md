# Claude Pulse Team

Multi-tenant SaaS dashboard for AI-assisted development teams. Turns each developer's
Claude Code session into shared, queryable team knowledge — and feeds that knowledge
back into every team member's next AI session as context.

> **Status:** pre-MVP scaffold. Sprint 2 (admin + agent + drill-down + sessions) complete.

## Architecture

- **Dashboard** — Next.js 16 (Turbopack, React 19) on `:3142`
- **API** — Hono on Node 22, Drizzle ORM, Postgres (Neon)
- **Hook** — Node CLI (`packages/hook`) with local SQLite outbox + async sync daemon
- **Auth** — OAuth (Google + GitHub) via `arctic`
- **Hosting (planned)** — Fly.io (api), Vercel (dashboard), Neon (db)

See `docs/team-saas/PRD.md`, `STACK.md`, `API.md`, `DESIGN-PRD.md` for full specs.

## Repo layout

```
src/app/team/        team dashboard (Next.js App Router)
src/app/page.tsx     redirects / → /team
apps/api/            ingest + read API (Hono)
packages/hook/       workstation hook + sync daemon
docs/team-saas/      product, stack, API, design specs
```

## Local dev

```bash
npm install
npm run dev
# http://localhost:3142  (redirects to /team)
```

## License

MIT — see [LICENSE](./LICENSE).
