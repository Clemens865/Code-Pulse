# Changelog

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
