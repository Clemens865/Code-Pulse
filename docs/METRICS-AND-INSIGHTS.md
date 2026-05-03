# Metrics, Filters, Data Quality & Hook Prompt — Analysis

*Prepared 2026-05-03. Based on the imported "Clemens Hoenig" org
(69 sessions, 15,313 tool events, 5,415 insights, 3,718 file activity
rows, 125 daily summaries, 20,859 event-log entries).*

---

## 1. What we have to work with

### 1.1 Tables and columns (live in Postgres)

| Table | Key columns |
|---|---|
| `sessions` | started_at, ended_at, duration_seconds, status, hostname, summary |
| `tool_events` | tool_name, ts, file_path, language, lines_added, lines_removed, command, detected_framework, command_failed, search_pattern, agent_type, agent_description, skill_name, skill_args, diff_excerpt, metadata (JSONB) |
| `insights` | type (decision/blocker/progress/pattern/fix/context), title, content, reasoning, resolved_at, created_at |
| `file_activity` | file_path, date, edit_count, write_count, read_count, lines_added, lines_removed, language |
| `daily_summaries` | session_count, total_duration_seconds, lines_added/removed/net, files_created/edited/read, tool_calls, bash_commands, bash_failures, searches, agents_spawned, skills_used (JSONB), frameworks_detected (JSONB), languages (JSONB), tool_counts (JSONB) |
| `blueprint_runs` | blueprint, input, status, started_at, completed_at, duration_ms, step_count, steps_done, steps_failed, step_results, worktree info |
| `event_log` | kind, payload (JSONB), hook_ts, redaction_applied — append-only source of truth |
| `heartbeats` | last_seen_at, hook_version, cloud_env |

### 1.2 What's NOT captured (gap inventory)

- **Tokens** (input/output/cache_creation/cache_read) — separate workstream
- **Insight `title`** — column exists, never filled by OG hook
- **Insight `reasoning`** as a separate field — OG concatenates "what + why" in `content`
- **Blocker `resolved_at`** — OG never had a resolution mechanism
- **Outcome of decisions** — was a decision validated later? unknown
- **Tool `command_failed`** — column exists, OG hook never set it (0 of 15,313 marked failed in the import)
- **`tool_events.lines_removed`** — OG only extracted lines added from diffs, removed always 0
- **Per-member daily rollup** — `daily_summaries` is project-scoped only

---

## 2. Metrics catalog (everything derivable today)

Organized by audience. Each metric notes whether it's *currently derivable* (✓) or *needs new capture* (✗).

### 2.1 Activity (manager / agency lead)

| Metric | Derivation |
|---|---|
| Sessions count | ✓ count(*) on sessions, filtered by date range |
| Active days % | ✓ distinct dates with at least one session ÷ window |
| Longest streak / current streak | ✓ run-length on consecutive active dates |
| Avg session duration | ✓ avg(duration_seconds) — *but skewed by sessions that never closed* |
| Sessions per weekday / per hour | ✓ EXTRACT(dow / hour FROM started_at) |
| Time-to-first-event | ✓ min(tool_events.ts) - sessions.started_at |
| Sessions with no summary % | ✓ count where summary IS NULL or '' |

### 2.2 Code authoring (engineering manager)

| Metric | Derivation |
|---|---|
| Lines added/removed/net | ✓ sum of tool_events or daily_summaries — *removed=0 in OG history* |
| Net lines per session | ✓ daily_summaries.net_lines / session_count |
| Net velocity (lines/day) | ✓ daily_summaries aggregated by date |
| Files created / edited / read | ✓ daily_summaries direct fields |
| Hot files | ✓ ORDER BY file_activity.edit_count DESC |
| Cold projects | ✓ projects whose last_activity > 30d ago |
| Stale files in hot projects | ✓ file_activity max date < 90d but project sessions7d > 0 |

### 2.3 Tool usage (engineer / power user)

| Metric | Derivation |
|---|---|
| Tool mix (% per tool) | ✓ count grouped by tool_name |
| Tools per session | ✓ count(tool_events) / count(sessions) |
| Bash failure rate | ✗ command_failed always 0 in import (capture gap) |
| Search-to-edit ratio | ✓ count(Grep+Glob) / count(Edit) |
| Read-to-write ratio | ✓ count(Read) / count(Write) |
| Top skills used | ✓ tool_events where skill_name IS NOT NULL |
| Top agent types spawned | ✓ tool_events where agent_type IS NOT NULL |

### 2.4 Decision / insight quality (compliance + manager)

| Metric | Derivation |
|---|---|
| Insights per session | ✓ aggregate count |
| Insights mix by type | ✓ group by type — *OG only produces 3 of 6 types* |
| Avg insight content length | ✓ avg(length(content)) |
| Sessions without insights | ✓ left join sessions with insights |
| Open blockers | ✗ resolved_at always NULL — needs resolution capture |
| Blocker resolution time (hours) | ✗ resolved_at - created_at — same gap |
| Decision-to-blocker ratio | ✓ count(type='decision') / count(type='blocker') |

### 2.5 Project health

| Metric | Derivation |
|---|---|
| Sessions per project per week | ✓ aggregate |
| Lines per project | ✓ aggregate |
| Distinct files per project | ✓ count(distinct file_path) |
| Distinct languages per project | ✓ count(distinct language) |
| Open blockers per project | ✗ same gap as 2.4 |
| Project trend (sessions vs prior week) | ✓ week-over-week % change |

### 2.6 Cross-project knowledge

| Metric | Derivation |
|---|---|
| Patterns library | ✗ insights.type='pattern' has 0 rows in OG — needs hook prompt update |
| Common fixes | ✗ same — type='fix' has 0 rows |
| Recurring blocker categories | ✓ trigram-similarity cluster on blocker content |
| Skill adoption curve | ✓ count of distinct skills × week |
| Framework distribution | ✓ daily_summaries.frameworks_detected JSONB aggregation |

### 2.7 Time / cadence

| Metric | Derivation |
|---|---|
| Working hour distribution | ✓ EXTRACT(hour FROM started_at) histogram |
| Weekend vs weekday split | ✓ |
| Focus depth (events/min) | ✓ count(tool_events) / duration_seconds × 60 |
| Working pattern (e.g. early/late) | ✓ derive from above |

### 2.8 Compliance / audit (procurement, regulated buyers)

| Metric | Derivation |
|---|---|
| Sessions touching file X | ✓ tool_events.file_path filter |
| Who-edited-what-when | ✓ tool_events with member, file, ts |
| Failed commands timeline | ✗ same gap (command_failed) |
| Diff bodies retained vs redacted | ✓ count(diff_excerpt IS NOT NULL) per project |

### 2.9 Cost (deferred)

| Metric | Derivation |
|---|---|
| Tokens per session / project / member | ✗ tokens not captured |
| Cost per session × $/1k tokens | ✗ same |

---

## 3. Filter dimensions

Universal filters that should appear on every list page (Timeline / Projects / Members / Insights / Reports):

- **Time range** — 24h / 7d / 30d / 90d / custom
- **Project** — multi-select
- **Member** — multi-select (single-user today; matters in v1.0+)

Page-specific filters:

| Page | Filters |
|---|---|
| Timeline | event-kind chips (session / insight / commit), with-summary-only toggle |
| Projects | status (active/archived), redaction (standard/strict), needs-review, has-real-remote vs local-only |
| Insights | insight type (multi), has resolution (when capture lands), text search |
| Reports | date range only — already in scope |
| Member detail | tool kind, language |

---

## 4. Data quality observations from the OG import

Concrete numbers from the imported set, with implication:

1. **Insight type distribution: 56% decision / 23% progress / 21% blocker. `pattern` / `fix` / `context` types: 0 instances.**
   → OG hook prompt only asks for the first three. The schema's other three types are dead weight until the prompt is updated.

2. **Insights per session: median 45, p95 367, max 1040.**
   → OG's `tag-insights.sh` extracts every line containing `PROGRESS:` / `DECISION:` / `BLOCKED:` from the conversation, not just at session end. That explains the high cardinality but also means many "insights" are mid-stream commentary, not curated takeaways. Quality is uneven.

3. **Title fill rate: 0/5,415 (0%).**
   → OG schema has no title concept. Search has to do trigram on `content`. UI has to derive headlines via `content.slice(0, 80)`.

4. **Reasoning fill rate: 0/5,415 (0%).**
   → "what + why" is concatenated in `content`. Splitting them would improve searchability and reasoning extraction.

5. **Resolved-at fill rate: 0/5,415 (0%).**
   → No blocker resolution mechanism. Open-blocker count is meaningless until this is captured.

6. **Tool `command_failed` fill rate: 0/15,313 (0%).**
   → OG hook captures the column but apparently never sets it. Bash failures are invisible to incident-response queries.

7. **Tool `lines_removed` always 0.**
   → OG only extracted `+lines` from diffs, ignored `-lines`. Net-lines metrics are inflated.

8. **9,739 tool_events without language.**
   → Bash + Read events don't have a language; that's expected. ~63% of events. Don't display "missing" as a problem.

9. **Sessions w/o summary: 7 / 69 (10%).**
   → 90% adoption — surprisingly good baseline.

10. **Avg session duration: 3,162 minutes (52h).**
    → Sessions linger because OG only marks `ended_at` when `Stop` fires successfully; crashes / Ctrl+C / forgotten terminals leave sessions open. Use median or filter to status='completed' for valid duration metrics.

---

## 5. Stop-hook prompt — current state and proposed evolution

### 5.1 Current OG prompt (verbatim, from `hook/claude-pulse-hook.sh:741`)

```
Session ending for ${PROJECT}. Respond with ONLY these lines (skip empty categories):
PROGRESS: <what was accomplished, 1 line>
DECISION: <key choice and why> (repeat if multiple)
BLOCKED: <what's stuck or left to do>
```

### 5.2 Pain points

- 3 of 6 schema types are unreachable
- "1 line" forces "what + why" into one sentence — `reasoning` field stays empty
- No title separation — search/list views have nothing to scan
- No resolution capture — blockers pile up forever
- Captures every PROGRESS/DECISION/BLOCKED line in conversation, not just session end → noise

### 5.3 Proposed evolution (zero-overhead)

Two-line structure per entry, all three categories optional:

```
Session ending for ${PROJECT}. Respond with ONLY the lines you have, in this format:

PROGRESS: <one-line headline>
PROGRESS-WHY: <one-line context — what advanced and why it matters>

DECISION: <one-line headline>
DECISION-WHY: <one-line reasoning>

BLOCKED: <one-line headline>
BLOCKED-WHY: <one-line context>

PATTERN: <reusable approach you discovered>
FIX: <recurring bug you solved>

If yesterday flagged a blocker that's now resolved, say:
RESOLVED: <one-line summary referencing the blocker>
```

Why this works:

- **Title separation**: first line per category is the headline → `insights.title`. Second line → `insights.reasoning`. Empty WHY lines just stay null.
- **Optional categories**: developers self-select what's worth capturing.
- **Pattern + fix opt-in**: appear on the prompt but only filled when applicable. Drives the Patterns Library feature.
- **Resolution opt-in**: developer paraphrases the original blocker; we link via trigram match to the open blocker rows. Closes the loop without forcing structured tags.

Adoption cost: same one-paragraph response, slightly different structure. Developers already type these — the change is *how* they format.

### 5.4 What I would NOT add to the hook

- **Per-event line-by-line tagging** (the OG approach): too noisy, dilutes the curated insights.
- **Free-text "category"** field: defeats typing.
- **Resolution as a separate prompt** at session-start: forces interruption; opt-in RESOLVED line is enough.
- **Token/cost capture in the Stop hook**: belongs in a separate event payload. Doing it via the prompt invites errors.

---

## 6. Recommended build order

The metrics catalog is large but the leverage is uneven. Concrete first sprints:

### Sprint 1: Wire the universal filter dimensions (~2 days)

- **Time-range chips** (24h / 7d / 30d / 90d / custom) — drive every list query
- **Project multi-select** — single dropdown reused across pages
- **Member multi-select** — same component
- **Insight-type filter** on `/team/insights`
- **Status / redaction / needs-review** filters on `/team/projects`

This is mostly dashboard wiring against existing API endpoints. Unblocks the user-facing buttons that currently look interactive but aren't.

### Sprint 2: Live KPI/heatmap aggregation (~1 day)

Replace synthetic `lastNDaysActivity`/`projectWeekStats` with real aggregation endpoints:

- `GET /v1/reports/weekly` is already designed — extend to support project filter
- New `GET /v1/projects/:id/activity?days=90` returning real sessions-per-day
- Wire Overview KPI cards + heatmap to these

### Sprint 3: Stop-hook prompt v2 + capture upgrades (~half day each)

- Update `packages/hook` to use the new 2-line structured prompt
- Set `command_failed` correctly from Bash exit codes
- Extract removed lines from diffs (regex on `^-` lines that aren't `^---`)
- Add `RESOLVED:` parsing → trigram-match to open blockers → set `resolved_at`

### Sprint 4: Token capture (~half day, separate workstream)

- Schema migration: `sessions.input_tokens` / `output_tokens` / `cache_creation_tokens` / `cache_read_tokens`
- Hook reads `usage` from Stop payload, posts as a `session.usage` event
- API ingest stores → daily_summaries gains a token rollup
- Dashboard adds Tokens KPI card

### Sprint 5: Patterns Library + file-scoped incident view (~1 day each)

Once the hook starts producing `pattern`/`fix`/`context` rows, the Library page becomes meaningful. The incident view (`/team/projects/[id]/files/[path]`) is a single new page on top of existing indexes.

---

## 7. Open questions

1. **Member-day rollup table?** Currently per-member week stats need on-the-fly aggregation. If the dashboard hits perf issues at >10k events/member/week, add a `member_daily_summaries` table.
2. **Historical retro-tag of OG insights?** OG `content` often contains both what and why. We could re-parse imported insights to populate `title` / `reasoning` heuristically. Risk: false splits. Probably skip unless a customer asks.
3. **"Insight quality score"?** Surfaces sessions where developer actually wrote thoughtful summaries vs one-line throwaways. Could power a "team capture health" metric. Heuristic: content length, presence of WHY, type diversity. Defer until v1.5.
4. **Auto-merge `local:<path>` projects** when a real remote is later detected? E.g., `git init` happens after first session. UX call: do we merge silently or surface a "merge candidate" banner.
