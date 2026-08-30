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
let _db = null;
export function db() {
    if (_db)
        return _db;
    const exists = existsSync(OUTBOX_PATH);
    _db = new Database(OUTBOX_PATH);
    _db.exec(SCHEMA);
    if (!exists)
        _db.pragma("journal_mode = WAL");
    return _db;
}
export function pendingCount() {
    const row = db()
        .prepare("SELECT COUNT(*) AS n FROM outbox WHERE synced_at IS NULL")
        .get();
    return row.n;
}
export function takeBatch(limit = 100) {
    return db()
        .prepare(`SELECT id, event_kind, session_id, remote_url, hook_ts, client_meta, payload, retry_count
       FROM outbox
       WHERE synced_at IS NULL
       ORDER BY created_at ASC
       LIMIT ?`)
        .all(limit);
}
export function markSynced(ids) {
    if (ids.length === 0)
        return;
    const tx = db().transaction((ids2) => {
        const stmt = db().prepare("UPDATE outbox SET synced_at = datetime('now') WHERE id = ?");
        for (const id of ids2)
            stmt.run(id);
    });
    tx(ids);
}
export function markRejected(ids, reason) {
    if (ids.length === 0)
        return;
    const tx = db().transaction((ids2) => {
        const stmt = db().prepare("UPDATE outbox SET synced_at = datetime('now'), last_error = ? WHERE id = ?");
        for (const id of ids2)
            stmt.run(reason, id);
    });
    tx(ids);
}
// Max times a single event can DETERMINISTICALLY fail before we eject it
// from the queue. Without this, one poisoned payload (a request the server
// rejects the same way every time) sits at the head of the FIFO
// `created_at ASC` queue and every later event behind it stays unsynced.
//
// TRANSIENT failures (network unreachable, 5xx, auth errors) never count
// toward this limit — an API outage must never destroy data. Historical bug:
// counting `fetch failed` toward quarantine silently discarded 26% of one
// workstation's events during a 7-week outage.
const MAX_RETRIES = 10;
export function markRetry(ids, err, opts = {}) {
    if (ids.length === 0)
        return;
    const transient = opts.transient === true;
    const tx = db().transaction((ids2) => {
        const stmt = transient
            ? db().prepare("UPDATE outbox SET last_error = ? WHERE id = ?")
            : db().prepare("UPDATE outbox SET retry_count = retry_count + 1, last_error = ? WHERE id = ?");
        for (const id of ids2)
            stmt.run(err, id);
        if (transient)
            return;
        // Quarantine sweep (deterministic failures only): rows over the retry
        // threshold are retired with a tagged last_error so they are visible in
        // `sqlite3 outbox.db` inspections and recoverable via requeueQuarantined.
        db()
            .prepare(`UPDATE outbox
         SET synced_at = datetime('now'),
             last_error = 'quarantined (max retries exceeded) | ' || COALESCE(last_error, '')
         WHERE synced_at IS NULL AND retry_count >= ?`)
            .run(MAX_RETRIES);
    });
    tx(ids);
}
// Put quarantined rows back in the queue — after a server-side fix, or to
// recover rows quarantined by the pre-fix transient-failure bug.
export function requeueQuarantined() {
    const res = db()
        .prepare(`UPDATE outbox
       SET synced_at = NULL, retry_count = 0,
           last_error = 'requeued | ' || COALESCE(last_error, '')
       WHERE last_error LIKE 'quarantined%'`)
        .run();
    return res.changes;
}
//# sourceMappingURL=outbox.js.map