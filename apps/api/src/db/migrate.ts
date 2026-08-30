// Migration runner: applies every drizzle/migrations/*.sql in lexical order,
// exactly once, and records what it applied in `_migrations`.
//
//   npm run db:migrate              apply pending migrations
//   npm run db:migrate -- --status  list applied / pending, change nothing
//   npm run db:migrate -- --baseline
//                                   mark every file as applied WITHOUT running it
//                                   (for a database whose schema was created by
//                                   hand before this runner existed)
//
// Each file runs inside its own transaction; a failure rolls that file back and
// stops the run, so the database is always at a file boundary. In production
// (Fly) this is the release_command, so a failing migration blocks the deploy.
//
// Baseline heuristic: if `_migrations` is empty but the schema already exists
// (a pre-runner database), a file that fails with "already exists" is treated
// as already applied and recorded — the hand-applied schema becomes tracked
// without operator intervention. On a tracked database that shortcut is off:
// "already exists" is a real error.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { env } from "../env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "drizzle", "migrations");

type MigrationFile = { name: string; sql: string; checksum: string };

function loadMigrations(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => {
      const raw = readFileSync(join(MIGRATIONS_DIR, name), "utf-8");
      // Files may carry their own BEGIN;/COMMIT; from the pre-runner era. We
      // wrap each file in a transaction ourselves, so strip those lines —
      // a nested BEGIN only warns, but a COMMIT would end our transaction early.
      const sql = raw
        .split("\n")
        .filter((line) => !/^\s*(BEGIN|COMMIT)\s*;\s*$/i.test(line))
        .join("\n");
      return { name, sql, checksum: createHash("sha256").update(raw).digest("hex") };
    });
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const files = loadMigrations();
  const client = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });

  try {
    await client.unsafe(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name       text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    const appliedRows = await client<{ name: string; checksum: string }[]>`
      SELECT name, checksum FROM _migrations ORDER BY name`;
    const applied = new Map(appliedRows.map((r) => [r.name, r.checksum]));

    for (const f of files) {
      const prev = applied.get(f.name);
      if (prev && prev !== f.checksum) {
        console.warn(`[migrate] WARNING ${f.name} changed on disk since it was applied (checksum mismatch)`);
      }
    }

    const pending = files.filter((f) => !applied.has(f.name));

    if (args.has("--status")) {
      for (const f of files) console.log(`[migrate] ${applied.has(f.name) ? "applied" : "pending"}  ${f.name}`);
      console.log(`[migrate] ${applied.size} applied, ${pending.length} pending`);
      return;
    }

    if (args.has("--baseline")) {
      for (const f of pending) {
        await client`INSERT INTO _migrations (name, checksum) VALUES (${f.name}, ${f.checksum})`;
        console.log(`[migrate] baselined ${f.name} (recorded, not run)`);
      }
      console.log(`[migrate] baseline complete — ${pending.length} file(s) recorded`);
      return;
    }

    // Pre-runner database: schema exists but nothing is tracked.
    const schemaRows = await client<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orgs') AS exists`;
    const untrackedExisting = applied.size === 0 && schemaRows[0]?.exists === true;
    if (untrackedExisting) {
      console.warn("[migrate] existing schema with no migration history — files that already exist will be recorded as applied");
    }

    if (pending.length === 0) {
      console.log(`[migrate] up to date (${applied.size} applied)`);
      return;
    }

    for (const f of pending) {
      try {
        await client.begin(async (tx) => {
          await tx.unsafe(f.sql);
          await tx`INSERT INTO _migrations (name, checksum) VALUES (${f.name}, ${f.checksum})`;
        });
        console.log(`[migrate] applied ${f.name}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (untrackedExisting && /already exists/i.test(message)) {
          await client`INSERT INTO _migrations (name, checksum) VALUES (${f.name}, ${f.checksum})`;
          console.warn(`[migrate] ${f.name} already present in schema — recorded as applied`);
          continue;
        }
        console.error(`[migrate] FAILED ${f.name}: ${message}`);
        throw err;
      }
    }
    console.log(`[migrate] done — ${pending.length} applied, ${applied.size + pending.length} total`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
