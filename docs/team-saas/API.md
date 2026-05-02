# Claude Pulse Team — API v1

*Status: Draft — 2026-05-02*
*Companions: PRD.md, STACK.md, SCHEMA.sql*

This document is the contract between three independent components:

- **Workstation hook + sync daemon** (producer of events, consumer of context).
- **API server** (the only writer to Postgres).
- **Dashboard** (consumer of reads + SSE).

When the contract changes, this file changes first; clients change second.

---

## 1. Conventions

- **Base URL**: `https://api.claude-pulse-team.com/v1` (production), `http://localhost:8787/v1` (local).
- **Content type**: `application/json` unless noted.
- **Date/time**: RFC 3339 UTC strings, e.g. `2026-05-02T12:00:00Z`. Server stamps `received_at` independently of client clocks.
- **IDs**: UUIDv7 generated client-side for events; UUIDv4 server-side for everything else.
- **Versioning**: This file is `v1`. The path is `/v1/...`. Breaking changes ship as `/v2/...` and run alongside `/v1` for ≥6 months.
- **Hook payload version**: every event carries `"v": 1`. Server tolerates older versions for ≥6 months past EOL.
- **Compression**: `Accept-Encoding: gzip` and `Content-Encoding: gzip` supported on all endpoints.

## 2. Authentication

Two distinct flows:

### 2.1 Workstation auth (hook + sync daemon)

```
Authorization: Bearer cpt_<base32-32B>
```

- Issued via admin UI, one per member workstation.
- Stored hashed (HMAC-SHA-256 with server-side pepper) in `api_keys.key_hash`.
- `api_keys.key_last4` retains the last 4 chars in plaintext for display.
- Server stamps `member_id` and `org_id` from the key. Clients cannot claim identity.
- Rotation: issue a new key, the old one stays valid until explicitly revoked.

### 2.2 Dashboard auth (browser)

OAuth (Google or GitHub) → session cookie.

```
POST /v1/auth/oauth/start          { provider: "google" | "github" }   → 302 to provider
GET  /v1/auth/oauth/callback?code  → sets cookie `cpt_session`, 302 to /team
POST /v1/auth/logout               → clears cookie
GET  /v1/auth/me                   → { member, org }
```

Cookie attributes: `HttpOnly; Secure; SameSite=Lax; Domain=.claude-pulse-team.com; Max-Age=2592000`.

## 3. Endpoints

### 3.1 `POST /v1/events` — ingest

Workstation only. Idempotent on `event.id`.

**Request**

```json
{
  "v": 1,
  "events": [
    {
      "id": "01957b4c-e2a0-7e1d-8a10-3c4f9b1e2d77",
      "kind": "tool.edit",
      "session_id": "0195789a-8000-7000-8000-000000000001",
      "project": {
        "remote_url": "https://github.com/northbeam/acme-store.git",
        "vcs_provider": "github",
        "vcs_repo_id": "847291"
      },
      "client": {
        "hook_version": "1.4.0",
        "os": "darwin",
        "cloud_env": "local",
        "hostname": "alice-mbp"
      },
      "hook_ts": "2026-05-02T12:00:01Z",
      "payload": {
        "tool_name": "Edit",
        "file_path": "app/checkout/intent.ts",
        "language": "TypeScript",
        "lines_added": 12,
        "lines_removed": 4,
        "diff": "..."
      }
    }
  ]
}
```

**Event kinds** (see SCHEMA.sql `event_kind` enum):

- `session.start`, `session.end`
- `prompt.submit`
- `tool.edit`, `tool.write`, `tool.read`, `tool.bash`, `tool.glob`, `tool.grep`, `tool.agent`, `tool.skill`, `tool.web_fetch`, `tool.web_search`, `tool.tool_search`
- `insight.progress`, `insight.decision`, `insight.blocker`, `insight.pattern`, `insight.fix`, `insight.context`
- `blueprint.run`
- `heartbeat`

**Response**

`200 OK`:

```json
{
  "received": 1,
  "accepted": 1,
  "duplicates": 0,
  "rejected": [],
  "results": [
    { "id": "01957b4c-...", "status": "accepted" }
  ]
}
```

`207 Multi-Status` (partial success — some events rejected by redaction or schema validation):

```json
{
  "received": 3,
  "accepted": 2,
  "duplicates": 0,
  "rejected": [
    {
      "id": "01957b4c-...",
      "reason": "redaction_policy_violation",
      "detail": "diff exceeds 64KB limit; would be truncated; policy strict requires drop"
    }
  ]
}
```

**Constraints**

- Max batch: 100 events per request.
- Max body: 5 MB compressed, 32 MB uncompressed.
- Max single event payload: 64 KB after redaction.
- Server discards (does not 4xx) on malformed individual events; returns them in `rejected[]` so the daemon can drop them from the outbox rather than retry forever.

### 3.2 `GET /v1/projects/me` — workstation project resolution

Maps a `remote_url` to the bound project record. Used by the hook on SessionStart.

**Request**

```
GET /v1/projects/me?remote_url=https%3A%2F%2Fgithub.com%2Fnorthbeam%2Facme-store.git
```

**Response**

```json
{
  "project": {
    "id": "0195789a-...",
    "name": "Acme · Storefront",
    "canonical_key": "github.com/northbeam/acme-store",
    "redaction_policy": {
      "id": "01957b4c-...",
      "drop_diffs": false,
      "hash_file_paths": false,
      "regex_redactions": ["AKIA[0-9A-Z]{16}"]
    },
    "needs_review": false
  }
}
```

`404 Not Found` if no project matches; the hook should still post events (server will auto-create a `needs_review: true` project on first ingest).

### 3.3 `GET /v1/projects/:id/context` — SessionStart context

Returns the team context payload for a project. Hook injects this into Claude's session at `SessionStart`.

**Auth**: workstation token *or* dashboard cookie. Workstation must have access to the project via member.

**Response**

```json
{
  "project": {
    "id": "0195789a-...",
    "name": "Acme · Storefront",
    "redaction_policy_id": "01957b4c-..."
  },
  "stats": {
    "sessions_today": 8,
    "events_today": 412,
    "active_members_today": ["m1", "m2", "m3"]
  },
  "recent_sessions": [
    {
      "started_at": "2026-05-02T11:00:00Z",
      "duration_seconds": 1820,
      "summary": "Refactored payment intent retry logic; covered 3 of 4 user shapes.",
      "member_id": "m1"
    }
  ],
  "insights": {
    "progress_decisions": [
      { "type": "decision", "content": "Adopted RFC-9457 problem details", "member_id": "m1", "ts": "2026-05-02T04:00:00Z" }
    ],
    "blockers": [
      { "content": "Stripe webhook signing key rotation needs Acme ops", "member_id": "m3", "ts": "2026-05-02T11:46:00Z" }
    ],
    "knowledge": [
      { "type": "pattern", "content": "Use durable queue, not Sidekiq, for abandonment jobs", "member_id": "m3", "ts": "2026-05-02T01:00:00Z" }
    ]
  },
  "hot_files": [
    { "path": "app/checkout/intent.ts", "edits": 11 },
    { "path": "lib/stripe/webhook.ts", "edits": 8 }
  ],
  "recent_failures": [
    { "command": "npm test -- payments", "ts": "2026-05-02T10:30:00Z" }
  ],
  "other_active_projects": ["Helio Health · Portal", "Mercer · Pricing v3"]
}
```

`If-None-Match` / `ETag` supported; the hook sends the last seen ETag and the server returns `304 Not Modified` if nothing relevant has changed.

Latency budget: p99 < 500 ms.

### 3.4 `POST /v1/heartbeats` — workstation health beacon

```json
{
  "v": 1,
  "hook_version": "1.4.0",
  "os": "darwin",
  "cloud_env": "local",
  "outbox_depth": 3,
  "last_event_id": "01957b4c-...",
  "last_event_ts": "2026-05-02T11:59:50Z"
}
```

`204 No Content` on success. Heartbeat does not return team context (separate endpoint above) — keep this lightweight.

### 3.5 `GET /v1/stream` — SSE for dashboard

Server-Sent Events for live dashboard updates.

**Auth**: dashboard cookie only.

**Subscriptions** via query string:

```
GET /v1/stream?org_id=current&projects=acme,helio&kinds=insight.*,session.*
```

**Event format**

```
event: timeline
id: 01957b4c-e2a0-7e1d-8a10-3c4f9b1e2d77
data: {"id":"01957b4c-...","kind":"insight.decision","project_id":"...","member_id":"...","content":"...","ts":"..."}
```

**Reconnection**: clients send `Last-Event-ID` header on reconnect; server replays from there if buffer still has it (~5 min retention), otherwise responds with `event: resync` telling the client to refetch.

### 3.6 Reads (dashboard)

All require dashboard cookie. All filtered by session's `org_id`.

| Endpoint | Purpose |
|---|---|
| `GET /v1/timeline?cursor=&kinds=&projects=&members=&since=` | Paginated timeline feed |
| `GET /v1/projects` | List projects, with sparkline + open blocker counts |
| `GET /v1/projects/:id` | Project detail (header + summary cards + insights + hotspots) |
| `GET /v1/members` | List members, role + last_seen + key status |
| `GET /v1/members/:id` | Per-member detail |
| `GET /v1/insights?q=&types=&projects=&members=&since=&cursor=` | Faceted insight search |
| `GET /v1/reports/weekly?start=&projects=&members=` | Weekly report (cards + heatmap + per-project breakdown) |
| `GET /v1/reports/weekly.csv?start=&...` | Same data, CSV |

**Pagination**: cursor-based on `(received_at, id)`. Cursor is opaque base64. Page size 50 default, 200 max.

### 3.7 Admin (dashboard, admin role only)

| Endpoint | Purpose |
|---|---|
| `POST /v1/projects` | Create/bind a project |
| `PATCH /v1/projects/:id` | Rename, change redaction policy, archive |
| `POST /v1/projects/:id/confirm` | Confirm a needs-review project |
| `GET /v1/redaction-policies` / `POST /v1/redaction-policies` / `PATCH /v1/redaction-policies/:id` | Policy CRUD |
| `GET /v1/members` (admin scope) | Includes pending invites |
| `POST /v1/members/invite` | Invite by email |
| `PATCH /v1/members/:id` | Change role, deactivate |
| `POST /v1/members/:id/keys` | Issue a new API key. Returns plaintext **once**. |
| `DELETE /v1/api-keys/:id` | Revoke |
| `GET /v1/audit-log?cursor=&actor=&action=` | Append-only audit trail |
| `GET /v1/org` / `PATCH /v1/org` | Org settings |

### 3.8 Health

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /v1/health` | none | Liveness ping; `{ ok: true, version, uptime_s }` |
| `GET /v1/health/deep` | shared canary token | Verifies DB reachability + recent ingest; used by synthetic canary |

## 4. Errors

All error responses use `application/problem+json` (RFC 9457):

```json
{
  "type": "https://docs.claude-pulse-team.com/errors/redaction_policy_violation",
  "title": "Redaction policy violation",
  "status": 422,
  "detail": "diff exceeds 64KB limit; policy 'strict' requires drop",
  "instance": "/v1/events",
  "errors": [
    { "path": "/events/0/payload/diff", "code": "size_exceeded", "limit": 65536 }
  ]
}
```

| Status | Meaning |
|---|---|
| 400 | Schema validation failed |
| 401 | Missing or invalid auth |
| 403 | Authenticated but lacks access to the resource |
| 404 | Not found |
| 409 | Conflict (e.g. project canonical_key already bound) |
| 410 | Gone (revoked API key) |
| 413 | Payload too large |
| 422 | Semantic rejection (redaction policy, retention rules, etc.) |
| 429 | Rate limit; `Retry-After` header set |
| 500 | Server error; logged with trace ID |
| 503 | Database or downstream unavailable; `Retry-After: 5` |

Every error response includes `X-Trace-Id` so support can correlate.

## 5. Rate limits

| Endpoint | Limit | Scope |
|---|---|---|
| `POST /v1/events` | 100 events/sec | Per API key |
| `POST /v1/heartbeats` | 1/min | Per API key |
| `GET /v1/projects/:id/context` | 10/min | Per API key |
| Dashboard reads | 60 req/min | Per session |
| `GET /v1/stream` | 5 concurrent connections | Per session |
| Admin writes | 30/min | Per session |

Headers on every response:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1714650000
```

## 6. Idempotency

- **Events**: deduped on `event.id` (UUID v7). Server returns `status: "duplicate"` for re-sent events.
- **Member invites**: deduped on `(org_id, email)`.
- **Project bindings**: deduped on `(org_id, canonical_key)`.
- **Heartbeats**: not idempotent; server takes the latest by `received_at`.

## 7. Soft failures the hook must handle

| Server signal | Hook behavior |
|---|---|
| 401 / 410 (key revoked) | Surface to user via doctor; stop sending until rotated |
| 403 (project access denied) | Hold events; admin must grant access; surface in admin "needs review" UI |
| 422 (redaction violation) | Drop the offending event from outbox, log locally, do not retry |
| 429 | Back off honoring `Retry-After`; never lose events from outbox |
| 5xx | Exponential backoff with jitter, max 5 min |
| Network error | Same as 5xx |

## 8. Schema-level guarantees we promise

- Server never modifies `event.id`, `hook_ts`, or the original `payload` JSON. They land in `event_log` verbatim post-redaction.
- Derived tables (`sessions`, `tool_events`, `insights`, etc.) are rebuildable from `event_log` alone. Loss of a derived row is a recoverable bug, not data loss.
- `received_at` is server-stamped at ingest time and is the canonical ordering field for cross-machine timelines.

## 9. Open contract questions (small)

- **Q1**: Should `/v1/projects/me` accept multiple `remote_url` values for monorepos? (Defer until first customer needs it.)
- **Q2**: Should context endpoint return raw insights or a pre-formatted markdown blob? (Lean: raw — the hook composes the markdown for Claude.)
- **Q3**: Should we return ETags on the timeline feed, or only on context? (Lean: only on context for v1; timeline uses cursor.)

These don't block Phase 0; revisit after the first internal dogfood week.
