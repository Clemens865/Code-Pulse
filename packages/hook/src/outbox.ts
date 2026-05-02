// SQLite outbox helpers.

import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { OUTBOX_PATH } from "./config.js";

const SCHEMA = `
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS outbox (
    id           TEXT PRIMARY KEY,
    event_kind   TEXT NOT NULL,
    session_id   TEXT,
    remote_url   TEXT,
    hook_ts      TEXT NOT NULL,
    client_meta  TEXT NOT NULL DEFAULT '{}',
    payload      TEXT NOT NULL DEFAULT '{}',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    synced_at    TEXT,
    last_error   TEXT,
    retry_count  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS outbox_unsynced_idx ON outbox(synced_at) WHERE synced_at IS NULL;
`;

export type OutboxRow = {
  id: string;
  event_kind: string;
  session_id: string | null;
  remote_url: string | null;
  hook_ts: string;
  client_meta: string;
  payload: string;
  retry_count: number;
};

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  const exists = existsSync(OUTBOX_PATH);
  _db = new Database(OUTBOX_PATH);
  _db.exec(SCHEMA);
  if (!exists) _db.pragma("journal_mode = WAL");
  return _db;
}

export function pendingCount(): number {
  const row = db()
    .prepare("SELECT COUNT(*) AS n FROM outbox WHERE synced_at IS NULL")
    .get() as { n: number };
  return row.n;
}

export function takeBatch(limit = 100): OutboxRow[] {
  return db()
    .prepare(
      `SELECT id, event_kind, session_id, remote_url, hook_ts, client_meta, payload, retry_count
       FROM outbox
       WHERE synced_at IS NULL
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .all(limit) as OutboxRow[];
}

export function markSynced(ids: string[]) {
  if (ids.length === 0) return;
  const tx = db().transaction((ids2: string[]) => {
    const stmt = db().prepare("UPDATE outbox SET synced_at = datetime('now') WHERE id = ?");
    for (const id of ids2) stmt.run(id);
  });
  tx(ids);
}

export function markRejected(ids: string[], reason: string) {
  if (ids.length === 0) return;
  const tx = db().transaction((ids2: string[]) => {
    const stmt = db().prepare(
      "UPDATE outbox SET synced_at = datetime('now'), last_error = ? WHERE id = ?",
    );
    for (const id of ids2) stmt.run(reason, id);
  });
  tx(ids);
}

export function markRetry(ids: string[], err: string) {
  if (ids.length === 0) return;
  const tx = db().transaction((ids2: string[]) => {
    const stmt = db().prepare(
      "UPDATE outbox SET retry_count = retry_count + 1, last_error = ? WHERE id = ?",
    );
    for (const id of ids2) stmt.run(err, id);
  });
  tx(ids);
}
