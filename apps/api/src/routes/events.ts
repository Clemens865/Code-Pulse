// POST /v1/events — idempotent batched ingest.
// See API.md §3.1.

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { workstationAuth } from "../auth/workstation.js";
import { problem } from "../lib/errors.js";
import { resolveOrCreateProject } from "../lib/projects.js";
import { applyRedaction } from "../lib/redaction.js";
import { deriveEvent } from "../lib/derive.js";
import {
  ingestRequestSchema,
  type IngestEvent,
  type IngestResult,
} from "../schemas/events.js";

export const events = new Hono();

events.use("/events", workstationAuth);

events.post("/events", zValidator("json", ingestRequestSchema, (result, c) => {
  if (!result.success) {
    return problem(
      c,
      400,
      "schema_validation_failed",
      "Request body failed validation",
      result.error.issues.map((iss) => ({
        path: "/" + iss.path.join("/"),
        code: iss.code,
        message: iss.message,
      })),
    );
  }
  return undefined;
}), async (c) => {
  const auth = c.get("auth");
  const body = c.req.valid("json");
  const result: IngestResult = { received: body.events.length, accepted: 0, duplicates: 0, rejected: [], results: [] };

  // Group events by canonical project so we resolve each project once per batch.
  const byProjectKey = new Map<string, IngestEvent[]>();
  for (const ev of body.events) {
    const k = ev.project.remote_url;
    const list = byProjectKey.get(k) ?? [];
    list.push(ev);
    byProjectKey.set(k, list);
  }

  type Row = typeof schema.eventLog.$inferInsert;
  const rows: Row[] = [];

  for (const [remoteUrl, evs] of byProjectKey) {
    // All events in a batch from one session/dir carry the same fingerprint;
    // take it from the first event of the group. Optional — older hooks omit
    // it and resolveOrCreateProject falls back to remote_url-only behavior.
    const firstClient = evs[0]?.client as Record<string, unknown> | undefined;
    const rawFingerprint = firstClient?.fingerprint as Record<string, unknown> | undefined;
    const fingerprint = rawFingerprint
      ? {
          git_remote: typeof rawFingerprint.git_remote === "string" ? rawFingerprint.git_remote : undefined,
          common_dir: typeof rawFingerprint.common_dir === "string" ? rawFingerprint.common_dir : undefined,
          basename: typeof rawFingerprint.basename === "string" ? rawFingerprint.basename : undefined,
        }
      : undefined;

    const project = await resolveOrCreateProject(auth.orgId, remoteUrl, {
      vcsProvider: evs[0]?.project.vcs_provider ?? null,
      vcsRepoId: evs[0]?.project.vcs_repo_id ?? null,
      createdBy: auth.memberId,
      fingerprint,
    });

    // Look up the redaction policy for this project (if any).
    const policy = project.redactionPolicyId
      ? await db.query.redactionPolicies.findFirst({
          where: (p, { eq }) => eq(p.id, project.redactionPolicyId!),
          columns: {
            dropDiffs: true,
            hashFilePaths: true,
            dropPrompts: true,
            regexRedactions: true,
            maxPayloadBytes: true,
          },
        })
      : null;

    for (const ev of evs) {
      const redaction = applyRedaction(ev.payload, policy ?? null);

      if (redaction.rejected) {
        result.rejected.push({
          id: ev.id,
          reason: redaction.rejected.reason,
          detail: redaction.rejected.detail,
        });
        result.results.push({ id: ev.id, status: "rejected" });
        continue;
      }

      rows.push({
        id: ev.id,
        orgId: auth.orgId,
        memberId: auth.memberId,
        projectId: project.id,
        sessionId: ev.session_id ?? null,
        eventKind: ev.kind,
        payload: redaction.payload,
        clientMeta: ev.client,
        hookTs: new Date(ev.hook_ts),
        redactionApplied: redaction.applied,
        apiKeyId: auth.apiKeyId,
      });
    }
  }

  if (rows.length === 0) {
    return c.json(result, result.rejected.length > 0 ? 207 : 200);
  }

  // Idempotent insert. Returns the IDs that were actually inserted; the rest are duplicates.
  const inserted = await db
    .insert(schema.eventLog)
    .values(rows)
    .onConflictDoNothing({ target: schema.eventLog.id })
    .returning({ id: schema.eventLog.id });

  const insertedIds = new Set(inserted.map((r) => r.id));
  for (const row of rows) {
    if (insertedIds.has(row.id)) {
      result.accepted++;
      result.results.push({ id: row.id, status: "accepted" });
    } else {
      result.duplicates++;
      result.results.push({ id: row.id, status: "duplicate" });
    }
  }

  // Project event_log rows into the typed denormalized tables (sessions /
  // tool_events / insights / file_activity) that the dashboard reads from.
  // Only newly-accepted rows. Run sequentially in arrival order so that
  // session.start always writes its row before session.end tries to update
  // it (the OG hook can batch both into a single ingest call).
  for (const r of rows) {
    if (!insertedIds.has(r.id)) continue;
    await deriveEvent({
      id: r.id,
      orgId: r.orgId,
      memberId: r.memberId,
      projectId: r.projectId,
      sessionId: r.sessionId ?? null,
      eventKind: r.eventKind,
      payload: (r.payload ?? {}) as Record<string, unknown>,
      clientMeta: (r.clientMeta ?? {}) as Record<string, unknown>,
      hookTs: r.hookTs,
    });
  }

  // Best-effort heartbeat update for the workstation.
  await db
    .insert(schema.heartbeats)
    .values({
      apiKeyId: auth.apiKeyId,
      orgId: auth.orgId,
      memberId: auth.memberId,
      lastEventId: rows[rows.length - 1]?.id ?? null,
      lastEventTs: rows[rows.length - 1]?.hookTs ?? null,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.heartbeats.apiKeyId,
      set: {
        lastEventId: sql`EXCLUDED.last_event_id`,
        lastEventTs: sql`EXCLUDED.last_event_ts`,
        lastSeenAt: sql`EXCLUDED.last_seen_at`,
      },
    });

  return c.json(result, result.rejected.length > 0 ? 207 : 200);
});
