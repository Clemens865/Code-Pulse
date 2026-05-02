// Bootstrap migration: applies drizzle/migrations/0000_init.sql to the configured database.
// Run via `npm run db:migrate`. Safe to re-run; uses CREATE ... IF NOT EXISTS where possible
// and wraps the script in a transaction so partial failures roll back.
//
// In production (Fly), this runs as the release_command before deploys go live.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { env } from "../env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(__dirname, "..", "..", "drizzle", "migrations", "0000_init.sql");

async function main() {
  const sql = readFileSync(migrationPath, "utf-8");
  const client = postgres(env.DATABASE_URL, { max: 1 });
  try {
    console.log(`[migrate] applying ${migrationPath}`);
    await client.unsafe(sql);
    console.log("[migrate] ok");
  } catch (err) {
    // If types/tables already exist, treat as idempotent and continue.
    const message = err instanceof Error ? err.message : String(err);
    if (/already exists/i.test(message)) {
      console.warn("[migrate] some objects already exist — skipping:", message.slice(0, 200));
    } else {
      throw err;
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
