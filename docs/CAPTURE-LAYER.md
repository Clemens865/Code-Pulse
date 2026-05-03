# The Capture Layer

*Why the hook is the product, what to capture, what to infer, and what to
leave alone. Companion to the engineering [PRD](./team-saas/PRD.md) and the
[metrics catalog](./METRICS-AND-INSIGHTS.md).*

*Status: opinionated draft. Where the PRD says "should", this doc says
"because" or "instead".*

---

## 1. Premise

Everything else in Claude Pulse Team — the dashboard, the reports, the
compliance export, the OAuth flow, the pricing tiers — is a surface for
data the capture layer produces. **If the capture layer is wrong, every
downstream surface is decorating noise.** If the capture layer is right,
even a thin dashboard converts.

The capture layer has three pieces:

1. **The Stop hook** — what we ask developers to type at session end
2. **Implicit signal extraction** — what we observe from tool patterns
   without asking
3. **The SessionStart context payload** — what we inject back into the
   next AI session

Most "AI-logging" tools focus on #1. Pulse Team's wedge is treating all
three as one designed system.

---

## 2. Three audiences, three cuts

A single capture pipeline serves three readers. Each wants something
different. Conflating them is why most observability tools feel verbose
to developers and thin to managers.

| Reader | What they need | Where they read it | Token / volume budget |
|---|---|---|---|
| **The LLM** | Structured, parseable, recency-weighted, project-scoped | SessionStart context payload, injected as system prompt | ~150–300 tokens |
| **The developer** | Scannable; top-N only; headlines first | Sidebar / Recent insights / project drill-down | ~5–10 lines on screen |
| **The consultant / manager / auditor** | Comprehensive, attributable, timestamped, exportable | Compliance audit timeline, weekly report, CSV export | Unbounded (server-rendered, paginated) |

The SessionStart payload serves the first two. The audit/compliance
surfaces serve the third. **Don't try to make one shape do all three
jobs.**

---

## 3. The token-burn analysis (and why it's not the bottleneck)

### 3.1 The math

Numbers are conservative; substitute your own per-customer data later.

**Assumptions:**
- 10-developer team, average usage
- 5 Claude Code sessions per developer per day
- 20 working days per month → 1,000 sessions / month / team
- Pulse SessionStart payload: target 200 tokens (we'll show this is
  generous)
- Claude Sonnet 4.6 pricing (input): ~$3 / million tokens

**Cost of injecting Pulse context into every session start:**

```
1,000 sessions × 200 tokens × $3 / 1,000,000 tokens
= 1,000 × 200 × 0.000003
= $0.60 / month / team
```

At a 10× larger payload (2,000 tokens — verbose):

```
1,000 sessions × 2,000 tokens × $3 / 1,000,000
= $6.00 / month / team
```

A team running Claude Code at typical intensity already spends
$50–200/month per developer on Anthropic API calls. The Pulse context
payload is **0.3% – 3% of that bill at most**.

### 3.2 Therefore

Tokens are not the bottleneck. Optimizing for them is the wrong frame.

What actually limits payload size:

| Real constraint | Why it matters | How to manage |
|---|---|---|
| **Cognitive load on the developer** | Developer eyes glaze past long context blocks. They stop trusting Pulse if it floods their sessions. | Cap visible-to-developer payload at ~10 lines. |
| **Stale signal pollution** | A 30-day-old decision that's been reversed actively misleads the AI. Volume amplifies the wrong signal. | Recency-weighted selection. Decisions older than 14 days drop out unless re-referenced. |
| **AI bias from over-anchoring** | If the payload front-loads "key decisions", the AI references them even when irrelevant to the current task. | Mark context as background, not directive. Word it as "be aware of" not "you must apply". |
| **Privacy / redaction surface** | Every token is a potential leak vector if redaction misses something. | Redact on read, not just write. Cap the payload so a redaction miss is bounded. |
| **Cache invalidation** | If the payload changes every SessionStart, prompt cache hits drop. | Stable structure (same headers); only contents vary. Sort entries deterministically. |

The brief: **maximize signal density per byte, not bytes per dollar.**

### 3.3 Honest counter-case

Tokens *would* become a real constraint at:
- 100k+ events per project per week (huge teams) AND
- Naive payload composition (e.g. "include the last 100 insights")

We will hit this eventually. The architectural hedge: design selection
rules that scale by quality not quantity. A team with 1,000 daily
insights still gets a ~200-token payload — just heavier filtering.

---

## 4. The SessionStart context payload

### 4.1 Designed shape (target)

```
[Pulse Team — last 7 days · 3 active members · last sync 14m ago]

OPEN BLOCKERS (be aware — not your job to solve):
- 2d   Stripe webhook key rotation needs Acme ops [Alice, src/checkout/stripe.ts]
- 4h   PHI redaction strips trial cohort IDs [Sasha, src/lib/redaction.ts]

KEY DECISIONS (these constrain the work):
- 8h   Adopt RFC-9457 problem details for all checkout errors [Maya]
- 8m   Patient-record sync consolidated to nightly batch (streaming path removed) [Ravi]

HOT FILES (concurrent edits this week):
- src/checkout/stripe.ts        24 edits · last by Joon 14m ago
- src/lib/redaction.ts          11 edits · last by Maya 1h ago
- src/api/auth/session.ts        7 edits · last by Maya 3h ago

PATTERNS THIS REPO USES:
- Durable queue not Sidekiq for at-least-once jobs
- problem+json for all 4xx/5xx responses

[End Pulse context · respond as you normally would; this is background only]
```

Token count of this exact block (Claude tokenizer): ~210 tokens.

Selection rules per section, all bounded:

| Section | Filter | Rank by | Cap |
|---|---|---|---|
| Open blockers | `type='blocker' AND resolved_at IS NULL AND created_at > now()-14d AND member_id != $current_member` | recency desc | 5 |
| Key decisions | `type='decision' AND project_id=$current AND created_at > now()-7d` | quality_score desc, then recency desc | 5 |
| Hot files | `file_activity` where ≥2 distinct members touched in last 7d | edit_count desc | 5 |
| Patterns this repo uses | `type='pattern' AND project_id=$current` (lifetime) | usage_frequency desc | 3 |

The "be aware — not your job to solve" framing matters. Without it, the
AI starts proactively trying to solve other people's blockers,
sidetracking the developer's actual task.

### 4.2 What's deliberately excluded

Things you'll be tempted to add. Don't:

- **The developer's own recent insights** — they remember; redundant signal eats budget
- **Aggregate KPIs** ("team did 24 sessions this week") — irrelevant to the task at hand
- **Long-form reasoning bodies** — only headlines belong in context; full text lives in the dashboard
- **Cross-project references** by default — only when project_path overlap exists
- **Member avatars / roles / org metadata** — visual fluff, no AI value
- **Time-of-day / cadence stats** — vanity metrics

### 4.3 Failure modes and bounds

| Edge case | Behavior |
|---|---|
| 30+ open blockers in repo | Show top 5 by recency + a footer "(+25 more open blockers — see /team/insights)" |
| 0 entries in any section | Hide that section entirely; don't print empty headers |
| Brand-new repo with 0 history | Skip the Pulse block entirely; don't inject "no context yet" |
| First-time developer in repo | Add a one-line "Welcome — these are the team's recent decisions. Look around `src/` first." |
| Sensitive data in a decision | Server-side redaction policy applies on the *read* path. Test: a decision containing "password=foo" must be stripped before injection. |

---

## 5. The Stop hook prompt — minimal version

### 5.1 OG prompt (what we have today)

```
Session ending for ${PROJECT}. Respond with ONLY these lines (skip empty categories):
PROGRESS: <what was accomplished, 1 line>
DECISION: <key choice and why> (repeat if multiple)
BLOCKED: <what's stuck or left to do>
```

This is the prompt that produced 5,415 insights, of which 0% have a
title, 0% have separated reasoning, 0% are typed as pattern/fix/context,
and median 45-per-session because the OG hook *also* scrapes inline
`PROGRESS:` / `DECISION:` / `BLOCKED:` markers from conversation. The
prompt is fine; the **scraping is the noise**.

### 5.2 Proposed v2

Same shape, two surgical changes:

```
Session ending for ${PROJECT}. Reply with the lines you have, skip the rest.
Keep each headline ≤ 80 chars. Add an optional one-line WHY for context.

PROGRESS: <what advanced — headline>
PROGRESS-WHY: <one-line context, optional>

DECISION: <choice — headline>
DECISION-WHY: <reasoning, optional>

BLOCKED: <what's stuck — headline>
BLOCKED-WHY: <context, optional>

If you resolved a previously-flagged blocker, add:
RESOLVED: <one-line referencing the blocker>
```

What changed and why:

| Change | Purpose | Cost |
|---|---|---|
| Optional WHY second line per category | Splits `title` from `reasoning`. Improves search and quality scoring. | One extra line max per type, optional. |
| Explicit "≤80 chars" | Forces a useful headline column for list views. | Negligible. |
| `RESOLVED:` opt-in line | Closes blocker loop. Server trigram-matches against open blockers. | One optional line. |
| Drop PATTERN/FIX/CONTEXT from the prompt | Patterns are auto-suggested separately (§7); free-form fields stay unused. | Reduces noise. |

Net change vs OG: same 3-line minimum, optional WHY lines, optional
RESOLVED. **Total prompt lines a developer types: 3–7 typical, 1–10
maximum.**

### 5.3 The scraping decision

Drop OG's inline `PROGRESS:/DECISION:/BLOCKED:` scraping. **Only the
Stop hook produces insight rows.** 

Why:
- Inline scraping is what produced median 45 insights/session
- 80% of those are the developer thinking aloud, not curated takeaways
- The Stop hook is the right capture point because it's the moment the
  developer reflects on what's worth keeping
- A team can still chat about progress mid-session — it just doesn't
  pollute the typed-insight stream

If a customer wants raw transcript capture (some compliance scenarios),
that's an opt-in `event_log` payload — not insights.

---

## 6. Implicit signal capture — observation > self-report

The capture layer already has rich behavioral signal. Right now we
ignore most of it. The Stop hook is for what only the developer knows
(intent, decisions, reasoning). Everything else can be inferred.

### 6.1 The "stuck score"

A blocker isn't always declared. From tool patterns we can compute a
stuck_score per session in real time:

| Signal | Weight | Threshold |
|---|---|---|
| Bash command failures | +0.3 each | 3+ failures in 10 min → strong signal |
| Same Grep / Glob pattern repeated | +0.2 each | Same pattern 3× in 15 min → searching for missing thing |
| WebFetch / WebSearch density | +0.15 each | 4+ in a session → looking for help |
| Idle time (no tool events) | +0.1 per 10 min | 30+ min idle → stepped away or stalled |
| Session-end with no PROGRESS line | +0.5 | Wrapping with nothing to show → likely stuck |
| StopFailure or `status='crashed'` | +1.0 | Definitive |

Score normalised 0–1. Display rules:
- **<0.3**: don't surface
- **0.3–0.6**: surface privately to the developer next session — *"Last session looked tough — log a blocker?"*
- **>0.6**: surface to the manager dashboard as an implicit blocker, anonymised by default ("a session in `mercer-pricing` showed signs of being stuck")

### 6.2 Capture fixes worth doing for "free"

Things the OG hook captures but populates wrong:

| Field | Current state | Fix |
|---|---|---|
| `tool_events.command_failed` | always `false` (0 of 15,313 in import) | Set from Bash exit code in PostToolUse payload |
| `tool_events.lines_removed` | always `0` | Parse `^-` lines in diff (excluding `^---`) |
| `sessions.ended_at` | often null on crash | If session has events but no Stop event for >2h, server-side mark `status='crashed'` and set `ended_at = max(tool_events.ts)` |
| `sessions.duration_seconds` | wrong when ended_at missing | Recompute from above |

Half a day of work. Unlocks bash-failure-rate metrics, accurate
net-lines, and reliable session duration distributions.

### 6.3 What NOT to infer

Don't try to infer:
- **Decisions** — can't reverse-engineer intent from edits
- **Patterns** — needs developer judgment on whether something generalises
- **Quality of work** — out of scope and creepy

The line: infer mechanical / behavioural / structural signals. Ask
developers for judgement / intent / reasoning.

---

## 7. Cross-session derivatives — the "why" library

These are the second-order signals that prove "Pulse is the why". None
of them are derivable from the OG schema in its current state because
none of them are computed today.

| Derivative | Signal | Surface |
|---|---|---|
| **Recurring blocker** | Same blocker raised by 2+ members in 30 days, trigram-similarity > 0.7 | Project detail → "this team has hit `<blocker>` twice — pattern?" |
| **Decision reversal** | Decision X then later "decided not to X" or "switched from X to Y" | Insights timeline → annotate as superseded |
| **Pattern adoption** | Same `pattern` insight referenced (by file path or content) across 2+ projects | Patterns library → mark as "adopted across N projects" |
| **Stale decision** | Decision >60 days old, not referenced in any subsequent insight, files mentioned still active | Optional weekly review surface — "still valid?" |
| **Decision velocity** | Decisions/week per project | Trend chart on project detail |
| **Knowledge gap** | Question-shaped phrases in insight content with no follow-up | Surface as "open questions" |

These don't require new capture — they require **derivation jobs** on
existing insight + tool_event data. Run nightly; cache results.

The insight quality score (length × specificity × WHY-presence ×
file-linkability, normalised 0–1) feeds these derivatives. Low-quality
insights drop out; high-quality ones cluster.

---

## 8. Privacy on the read path

The PRD has redaction running before durable write. **It must also run
on the read path** — specifically when composing the SessionStart
context payload.

Threat model: Alice types "DECISION: skip the security review because
we're behind on the quarterly audit" → captured as insight → injected
into Bob's next session → Bob's AI suggests a code change, references
"per team decision, security review skipped" → leaks via PR description
or commit message.

Defenses, in order:

1. **Server-side regex redaction on the durable write path** (already
   designed in PRD §F4)
2. **Defense-in-depth: re-apply on read** — same regex policy, applied
   when the SessionStart payload is composed
3. **Per-org sensitive-pattern overrides** — customer-tunable regex
   list applied at both points
4. **Audit-log every read** of the context endpoint with member id +
   project id + timestamp + bytes returned. Compliance teams want this.
5. **Cap payload size** — bounded payload bounds the leak surface

Test cases worth adding:
- Decision containing `password=` → stripped
- Decision containing internal customer name in a strict-redaction
  project → hashed
- Member explicitly marked "external" cannot see decisions tagged
  internal-only

---

## 9. Sprint plan (revised, with reasoning)

The order changed from the v1 metrics doc. Here's the why for each.

| # | Sprint | Effort | Why this position |
|---|---|---|---|
| **1** | **Hook v2 minimal prompt + capture fixes** (command_failed, lines_removed, ended_at recovery) | 1.5 days | Foundation. Every downstream metric uses these fields. Wrong here = wrong everywhere. |
| **2** | **SessionStart payload v1** — server endpoint with the §4.1 shape, hardcoded selection rules, redaction on read | 1.5 days | This is the moat. The product's "smart AI" promise depends on this payload. |
| **3** | **Token capture** (schema migration + Stop payload extraction) | 0.5 day | The CFO story; complete the cost narrative. Cheap. |
| **4** | **Compliance audit timeline** (`/team/audit`) — file-scoped query, who-decided-what-when, command-failure timeline, CSV/JSONL export pack | 1.5 days | Procurement wedge. Closes deals. The capture fixes from #1 unlock command_failed visibility here. |
| **5** | **Stuck score implicit-signal job** — server-side nightly scoring + private surface to developer + opt-in manager surface | 1 day | First "Pulse is the why" demonstration without forcing developer overhead. |
| **6** | **Universal filter wiring + live KPI/heatmap aggregation** | 2 days | NOW the dashboard buttons mean something. Wire filters against real, clean data. |
| **7** | **Cross-session derivatives v1** — recurring blocker cluster, decision reversal detection, pattern adoption rate. Insight quality score | 2 days | The "why" library. Builds on clean capture from #1. |
| **8** | **Pattern auto-suggestion from session diff** — at Stop time, server analyses the session and prompts "looks like you used the [Y] pattern — save?" | 1 day | Closes the loop on PATTERN/FIX without forcing labelled lines on every developer. |

Total: ~11 days. Ships an actual product, not a scaffold.

The earlier "Sprint 1: filter wiring" framing was wrong. Filters on
noisy data is wrong filters on noise. Get the data right first.

---

## 10. What I want challenged

These are the load-bearing assumptions. If any are wrong, the plan
shifts:

1. **"Tokens are not the bottleneck."** True at 10-dev teams. Possibly
   wrong at 200-dev orgs hitting 1k+ daily sessions. Re-evaluate at
   first enterprise prospect.

2. **"Drop the inline insight scraping."** Some teams will *want* the
   noise — for compliance transcript-style capture. Make scraping
   opt-in per project rather than removing it.

3. **"Implicit blockers should default to developer-first."** Manager
   buyers may want them surfaced directly. Set defaults conservatively;
   make org-wide policy.

4. **"Compliance audit is a top-nav item."** Maybe v1.5 — adds breadth
   in the IA at a cost. Could start as a project-detail tab, promote
   later.

5. **"Pattern auto-suggestion at Stop time."** Adds a server-side LLM
   call per Stop hook. Costs real money at scale (~$0.01 per session
   if we use Sonnet). Compare to value before building.

If you push back on any of these, the sprint plan changes. That's the
point of writing them down.

---

## 11. The one-line summary

**The capture layer is the product. Capture quality > capture quantity.
Observation > self-report. The SessionStart payload is the moat.
Tokens aren't the bottleneck — selection quality is.**
