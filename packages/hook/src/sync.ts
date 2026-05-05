// `claude-pulse-team sync` — drains the outbox, posts to the API, marks rows.
// Intended to be invoked fire-and-forget by the hook on every event, AND
// optionally from a launchd/systemd timer for reliability.

import { ApiClient, type IngestEvent } from "./api-client.js";
import { requireConfig } from "./config.js";
import { markRejected, markRetry, markSynced, pendingCount, takeBatch } from "./outbox.js";

export async function sync(opts: { quiet?: boolean } = {}): Promise<{
  pending: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  errors: number;
}> {
  const cfg = requireConfig();
  const client = new ApiClient(cfg.api_url, cfg.api_key);

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
      // Network failure — leave rows unsynced for the next attempt.
      markRetry(events.map((e) => e.id), res.error ?? "network");
      totalErrors += events.length;
      break;
    }

    if (res.status === 401 || res.status === 403 || res.status === 410) {
      if (!opts.quiet) {
        console.error(`[sync] auth failure ${res.status}: ${res.error ?? "(no body)"}`);
      }
      markRetry(events.map((e) => e.id), `auth ${res.status}`);
      totalErrors += events.length;
      break;
    }

    if (res.status >= 500) {
      markRetry(events.map((e) => e.id), `server ${res.status}`);
      totalErrors += events.length;
      break;
    }

    if (!res.body) {
      markRetry(events.map((e) => e.id), `unexpected ${res.status}: ${res.error ?? ""}`);
      totalErrors += events.length;
      break;
    }

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
