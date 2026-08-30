# Compliance & Audit Mapping

*How Code Pulse data satisfies common audit-trail requirements
for AI-assisted development.*

*Scope: this is a mapping document, not legal advice. Whether any specific
regulation applies to your team's use of AI coding tools depends on
jurisdiction, sector, and risk classification. Consult your compliance
counsel for binding determinations.*

---

## 1. EU AI Act — Article 12 (Record-keeping)

**Requirement.** High-risk AI systems must enable automatic logging of
events ("logs") over the lifetime of the system, appropriate to ensure
traceability of system functioning.

| Article 12 expectation | Pulse Team mechanism |
|---|---|
| Automatic logging of operations | Hook captures every SessionStart, PostToolUse, Stop, StopFailure, PreCompact event without developer action |
| Identification of inputs | `tool_events.command`, `search_pattern`, `agent_description`, `skill_args`; redacted server-side per project policy |
| Identification of outputs | `tool_events.lines_added` / `lines_removed`, `diff_excerpt` (when redaction policy permits), `command_failed` flag |
| Timestamps | `event_log.created_at`, `tool_events.ts`, `sessions.started_at` / `ended_at` (all `TIMESTAMPTZ`, microsecond precision) |
| Identity of natural person responsible | `member_id` server-stamped from API key on every ingest; clients cannot claim identity |
| Lifetime traceability | `event_log` is append-only and immutable; all derived tables rebuildable from it |
| Retention & deletion controls | Per-org retention setting; `audit_log` records retention changes |

## 2. EU AI Act — Article 14 (Human oversight)

**Requirement.** AI systems must be designed and developed to allow
effective human oversight, including the ability to intervene or
override.

| Article 14 expectation | Pulse Team mechanism |
|---|---|
| Visibility of AI operation in real-time | Live SSE stream `/v1/stream` to dashboard; org-wide timeline shows every session live |
| Ability to detect anomalies | Heartbeats per workstation, server-side synthetic canary every 5 minutes, stale-workstation flagging in Admin UI |
| Ability to intervene / disable | Per-member API key revocation; per-project access removal; org-wide hook deactivation flag |
| Audit trail of oversight actions | `audit_log` records every admin action (member changes, project bindings, redaction policy edits, key rotations) |
| Human review of AI-driven decisions | Structured `insights.type='decision'` with `reasoning` field, reviewable on the dashboard's Insights view |

## 3. SOC 2 — Common Criteria mapping

| SOC 2 control area | Pulse Team mechanism |
|---|---|
| CC6.1 Logical access controls | OAuth (Google + GitHub) for dashboard; per-member API keys for hook |
| CC6.6 Identification and authentication | Server-side member identity stamping from API key; keys hashed with HMAC-SHA-256 + server pepper |
| CC7.2 Security event monitoring | `audit_log` (admin actions), heartbeats, canary alerts |
| CC7.3 Anomaly detection | Stale-workstation flagging, dead-letter event spike alerts |
| CC8.1 Change management | Append-only `event_log`; immutable raw event payload as JSONB |

## 4. ISO 42001 (AI Management Systems)

| ISO 42001 clause | Pulse Team mechanism |
|---|---|
| 6.1.4 AI system impact assessment | Per-project redaction policy, member access controls |
| 8.2 Operational planning and control | Hook latency budget <100 ms p99; daemon never blocks the developer |
| 9.1 Monitoring, measurement, analysis | Reports view + CSV export; per-org metrics dashboard |
| 10.2 Nonconformity and corrective action | Doctor CLI + canary + dead-letter inspector |

## 5. Internal governance (regulated sectors)

For finance, healthcare, and legal organizations running coding AI
internally — even when the EU AI Act's high-risk classification does not
formally apply — the same internal-audit patterns apply.

Pulse Team's data model directly answers the questions internal compliance
typically asks:

- *"Which AI agent ran which command, on which file, by which member,
  at which timestamp?"*  →  `tool_events` row with all six dimensions
  indexed.
- *"Which decisions were made with AI assistance and why?"*  →  filter
  `insights` where `type='decision'`; the `reasoning` column is the
  developer's own explanation.
- *"Show me everything that touched this file in the last 90 days."*
  →  `tool_events_file_idx` partial index makes this a single-query
  lookup.
- *"Which sessions failed or crashed?"*  →  `sessions.status IN
  ('crashed')`, plus `command_failed` flags on tool events.
- *"Has any prompt or diff body left this org's boundary?"*  →  per-org
  retention + redaction policy log; redaction runs server-side before
  durable write, defense-in-depth on read.

---

## 6. Compliance Export (planned, Phase 2)

A first-class admin route — `/team/admin/compliance` — will expose a
one-click export pack:

- **Events CSV/JSONL** — all `event_log` rows for the export window, with
  schema version pinned
- **Sessions report** — sessions table joined with member identity and
  project metadata
- **Insights ledger** — typed insight rows with reasoning and resolution
  timestamps
- **Audit log** — all admin actions in the export window
- **Manifest** — SHA-256 of each artifact, schema version, redaction
  policy active at export time, server timestamp, exporting member
  identity

This is the artifact a customer hands to an auditor without modification.
The schema and indexes already support it; the export pipeline is the
primary build-out.

---

## 7. Caveats

- **High-risk classification under the EU AI Act** is determined by use
  case, not by the tool itself. Most coding-assistant deployments fall
  outside Annex III, but regulated customers (e.g., banks running
  internal coding AI) may still apply the same controls voluntarily.
- **Server-side redaction** is configurable per project. Organizations
  with strict policies (no diff bodies persisted, file paths hashed) can
  enable Strict mode org-wide; the trade-off is reduced incident-response
  fidelity.
- **Cross-border data residency.** v1 runs single-region (`iad`, with
  Neon `us-east-2`). EU data-residency customers should defer onboarding
  until the `fra` region rollout in Phase 2 or contract for
  custom routing.
