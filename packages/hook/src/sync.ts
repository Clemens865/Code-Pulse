// `code-pulse sync` — drains the outbox, posts to the API, marks rows.
// Intended to be invoked fire-and-forget by the hook on every event, AND
// optionally from a launchd/systemd timer for reliability.
//
// Retry policy: transient failures (network down, 5xx, auth) leave rows fully
// intact — they never count toward quarantine, so an API outage can never
// destroy data. Only deterministic rejections increment retry_count. After a
// network failure a short cool-down file stops the per-event sync spawn from
// hammering a down API; the next event after the cool-down retries.

import { existsSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ApiClient, type IngestEvent } from "./api-client.js";
import { requireConfig, TEAM_DIR } from "./config.js";
import {
  markRejected,
  markRetry,
  markSynced,
  pendingCount,
  requeueQuarantined,
  takeBatch,
} from "./outbox.js";

const COOLDOWN_PATH = join(TEAM_DIR, ".sync-cooldown");
const COOLDOWN_MS = 60_000;

function inCooldown(): boolean {
  try {
    return existsSync(COOLDOWN_PATH) && Date.now() - statSync(COOLDOWN_PATH).mtimeMs < COOLDOWN_MS;
  } catch {
    return false;
  }
}

function setCooldown(on: boolean): void {
  try {
    if (on) writeFileSync(COOLDOWN_PATH, String(Date.now()));
    else if (existsSync(COOLDOWN_PATH)) unlinkSync(COOLDOWN_PATH);
  } catch {
    // best-effort
  }
}

export async function sync(
  opts: { quiet?: boolean; requeueQuarantined?: boolean } = {},
): Promise<{
  pending: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  errors: number;
  requeued?: number;
}> {
  const cfg = requireConfig();
  const client = new ApiClient(cfg.api_url, cfg.api_key);

  let requeued: number | undefined;
  if (opts.requeueQuarantined) {
    requeued = requeueQuarantined();
    if (!opts.quiet) console.error(`[sync] requeued ${requeued} quarantined row(s)`);
  } else if (inCooldown()) {
    // Recent network failure — skip this fire-and-forget attempt entirely.
    return { pending: pendingCount(), accepted: 0, duplicates: 0, rejected: 0, errors: 0 };
  }

  let totalAccepted = 0;
  let totalDuplicates = 0;
  let totalRejected = 0;
  let totalErrors = 0;

  while (true) {
    const batch = takeBatch(100);
    if (batch.length === 0) break;

    const events: IngestEvent[] = batch.map((row) => ({
      id: row.id,
      kind: row.event_kind,
      session_id: row.session_id ?? undefined,
      project: { remote_url: row.remote_url ?? "" },
      client: safeJson<IngestEvent["client"]>(row.client_meta) ?? {},
      hook_ts: row.hook_ts,
      // Server expects payload to be an object. The bash hook sometimes stores
      // a JSON-encoded primitive (e.g. last_assistant_message is a string for
      // Stop events). Normalize: wrap non-object values under a `value` key.
      payload: normalizePayload(safeJson<unknown>(row.payload)),
    }));

    const res = await client.ingest(events);

    if (res.status === 0) {
      // Network failure — transient. Rows stay queued, cool-down engages.
      markRetry(events.map((e) => e.id), res.error ?? "network", { transient: true });
      setCooldown(true);
      totalErrors += events.length;
      break;
    }

    if (res.status === 401 || res.status === 403 || res.status === 410) {
      // Auth failure — transient from the queue's perspective: a rotated key
      // fix must let these rows sync. `doctor` surfaces the broken key.
      if (!opts.quiet) {
        console.error(`[sync] auth failure ${res.status}: ${res.error ?? "(no body)"}`);
      }
      markRetry(events.map((e) => e.id), `auth ${res.status}`, { transient: true });
      totalErrors += events.length;
      break;
    }

    if (res.status >= 500) {
      // Server error — treat as transient (outage, deploy, overload). A
      // payload the server deterministically 500s on is a server bug; the
      // server's own dead-letter path is responsible for isolating it.
      markRetry(events.map((e) => e.id), `server ${res.status}`, { transient: true });
      setCooldown(true);
      totalErrors += events.length;
      break;
    }

    if (!res.body) {
      // Unexpected 4xx without a parseable body — deterministic; counts
      // toward quarantine so a poisoned batch can't block the queue forever.
      markRetry(events.map((e) => e.id), `unexpected ${res.status}: ${res.error ?? ""}`);
      totalErrors += events.length;
      break;
    }

    setCooldown(false);

    const okIds: string[] = [];
    const rejectedIds: string[] = [];
    for (const r of res.body.results) {
      if (r.status === "accepted" || r.status === "duplicate") okIds.push(r.id);
      else rejectedIds.push(r.id);
    }
    markSynced(okIds);
    markRejected(rejectedIds, res.body.rejected[0]?.reason ?? "rejected");

    totalAccepted += res.body.accepted;
    totalDuplicates += res.body.duplicates;
    totalRejected += rejectedIds.length;

    // Continue draining if there's more.
    if (batch.length < 100) break;
  }

  return {
    pending: pendingCount(),
    accepted: totalAccepted,
    duplicates: totalDuplicates,
    rejected: totalRejected,
    errors: totalErrors,
    ...(requeued !== undefined ? { requeued } : {}),
  };
}

function safeJson<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function normalizePayload(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  if (v === null || v === undefined) return {};
  return { value: v as unknown };
}
