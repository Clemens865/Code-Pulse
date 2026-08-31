# Changelog

## Unreleased

- Blocker lifecycle: a blocker now stays open by being re-asserted, not by never
  being resolved. New `BLOCKED` lines that trigram-match an open blocker bump its
  `last_seen_at` instead of stacking a duplicate; a background job auto-resolves
  blockers not re-asserted within `BLOCKER_STALE_DAYS` (default 14, 0 disables);
  the dashboard's Insights page gains Resolve/Reopen actions on blockers; the
  hook now emits `RESOLVED:` lines even when the solo tracker is installed
  (previously that path silently dropped them, so nothing ever resolved).
  One-shot cleanup for existing installs: `scripts/dedupe-open-blockers.ts`.
- Dashboard no longer crashes on insights of type `fix`, `pattern`, or `context`.

## 0.1.0 — unreleased

First open-source-ready cut. Highlights since the private alpha:

- Tracked migration runner (`_migrations`), `bootstrap` org creation, `LOCAL_LOGIN` self-host login
- Outbox never drops events on outages; `sync --requeue-quarantined`; sessions end on `SessionEnd`, per-turn `turn.end`
- Always-on secret masking + sensitive-file body drop; working redaction policies; retro `scrub:secrets`
- Consent notice, `pause`/`resume`, kill switches, full `uninstall`
- Retention enforcement, JSONL export, member/org data deletion
- Hook parses PROGRESS/DECISION/BLOCKED/RESOLVED itself (no solo-tracker dependency); activity-gated summary prompt
- Project aliases + fingerprint identity; duplicate-project merge; dead-letter admin view
- CI (typecheck, unit tests, migrate-from-empty smoke), CONTRIBUTING, SECURITY
