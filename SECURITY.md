# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately via GitHub's **Security → Report a
vulnerability** (private advisory) on this repository, or by email to the
address on the maintainer's GitHub profile. Do not open public issues for
security reports.

You can expect an acknowledgement within a few days. Please include
reproduction steps and affected versions.

## Scope notes for self-hosters

- The API's local login (`LOCAL_LOGIN=true`) intentionally trusts anyone who
  can reach the API. Only run it behind your own auth proxy or on a trusted
  network — the server logs a warning at startup when it is enabled in
  production.
- Workstation API keys are bearer tokens; they are stored hashed server-side
  (HMAC + pepper) and `0600` client-side. Rotate them from Admin → API keys.
- Captured payloads pass through always-on secret masking and sensitive-file
  body dropping, but redaction is pattern-based — treat the database as
  sensitive infrastructure regardless.
