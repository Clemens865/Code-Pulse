// RFC 9457 problem+json error helpers.

import type { Context } from "hono";

export type ProblemBody = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: Array<{ path: string; code: string; [k: string]: unknown }>;
};

const TYPE_BASE = "https://docs.claude-pulse-team.com/errors/";

export function problem(c: Context, status: number, code: string, detail?: string, errors?: ProblemBody["errors"]) {
  const body: ProblemBody = {
    type: TYPE_BASE + code,
    title: TITLES[code] ?? code,
    status,
    instance: new URL(c.req.url).pathname,
  };
  if (detail) body.detail = detail;
  if (errors && errors.length) body.errors = errors;
  return c.json(body, status as 400 | 401 | 403 | 404 | 409 | 410 | 413 | 422 | 429 | 500 | 503, {
    "Content-Type": "application/problem+json",
  });
}

const TITLES: Record<string, string> = {
  bad_request: "Bad request",
  schema_validation_failed: "Schema validation failed",
  unauthorized: "Unauthorized",
  forbidden: "Forbidden",
  not_found: "Not found",
  conflict: "Conflict",
  gone: "Resource gone",
  payload_too_large: "Payload too large",
  redaction_policy_violation: "Redaction policy violation",
  rate_limited: "Too many requests",
  server_error: "Internal server error",
  service_unavailable: "Service unavailable",
};
