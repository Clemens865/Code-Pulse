// Retroactive scrub: re-apply the always-on redaction layers (secret masking
// + sensitive-file body drop) to payloads ALREADY in event_log, and null out
// matching tool_events.command rows.
//
// event_log is normally immutable, but stored secrets are a breach, not
// history. The scrub is surgical: only rows whose serialized payload matches
// a secret pattern or whose file_path is on the sensitive list are touched.
//
//   cd apps/api && npm run scrub:secrets            # report + scrub
//   cd apps/api && npm run scrub:secrets -- --dry   # report only

import { sql } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { applyRedaction, isSensitivePath, maskSecrets } from "../src/lib/redaction.js";

const DRY = process.argv.includes("--dry");

async function main() {
  const rows = await db.execute<{ id: string; payload: unknown; event_kind: string }>(sql`
    SELECT id, payload, event_kind
    FROM event_log
    WHERE payload::text ~ '(sk-ant-|sk-[A-Za-z0-9_-]{20}|ghp_|github_pat_|glpat-|xox[baprs]-|AKIA[0-9A-Z]{16}|cpt_[a-z0-9]{20}|BEGIN [A-Z ]*PRIVATE KEY|(postgres(ql)?|mysql|mongodb|redis|amqp)://[^\\s:@/]+:[^\\s@/]+@)'
       OR (payload->>'file_path') ~ '(^|/)\\.env(\\.[^/]*)?$|\\.pem$|\\.key$|(^|/)id_(rsa|ed25519|ecdsa)|(^|/)(credentials|\\.netrc|\\.npmrc|\\.pypirc)$'
  `);
  const list = rows as unknown as Array<{ id: string; payload: unknown; event_kind: string }>;
  console.log(`[scrub] ${list.length} event_log row(s) match secret/sensitive patterns`);

  let scrubbed = 0;
  for (const row of list) {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    // Re-run the full pipeline with a body-preserving policy: only the
    // always-on layers (secrets, sensitive paths, null bytes) act here.
    const r = applyRedaction(payload, {
      dropDiffs: false,
      hashFilePaths: false,
      dropPrompts: false,
      regexRedactions: [],
      maxPayloadBytes: Number.MAX_SAFE_INTEGER,
    });
    const before = JSON.stringify(payload);
    const after = JSON.stringify(r.payload);
    if (before === after) continue;
    scrubbed++;
    if (DRY) continue;
    await db.execute(sql`
      UPDATE event_log
      SET payload = ${after}::jsonb,
          redaction_applied = redaction_applied || ${JSON.stringify({ ...r.applied, retro_scrub: true })}::jsonb
      WHERE id = ${row.id}
    `);
  }
  console.log(`[scrub] ${DRY ? "would scrub" : "scrubbed"} ${scrubbed} event_log row(s)`);

  // tool_events.command copies of the same content.
  const cmds = await db.execute<{ id: string; command: string }>(sql`
    SELECT id, command FROM tool_events
    WHERE command IS NOT NULL
      AND command ~ '(sk-ant-|sk-[A-Za-z0-9_-]{20}|ghp_|github_pat_|glpat-|xox[baprs]-|AKIA[0-9A-Z]{16}|cpt_[a-z0-9]{20}|BEGIN [A-Z ]*PRIVATE KEY|(postgres(ql)?|mysql|mongodb|redis|amqp)://[^\\s:@/]+:[^\\s@/]+@|(api[_-]?key|token|secret|password|passwd)\\s*[=:])'
  `);
  const cmdList = cmds as unknown as Array<{ id: string; command: string }>;
  let cmdScrubbed = 0;
  for (const row of cmdList) {
    const masked = maskSecrets(row.command).value;
    if (masked === row.command) continue;
    cmdScrubbed++;
    if (DRY) continue;
    await db.execute(sql`UPDATE tool_events SET command = ${masked} WHERE id = ${row.id}`);
  }
  console.log(`[scrub] ${DRY ? "would scrub" : "scrubbed"} ${cmdScrubbed} of ${cmdList.length} matching tool_events command(s)`);

  // diff-bearing payloads of sensitive files → report only (bodies were kept
  // pre-fix); the applyRedaction pass above already dropped them.
  const senVerify = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM event_log
    WHERE (payload->>'file_path') IS NOT NULL
      AND (payload ? 'content' OR payload ? 'new_string' OR payload ? 'old_string')
      AND (payload->>'file_path') ~ '(^|/)\\.env(\\.[^/]*)?$|\\.pem$|\\.key$|(^|/)id_(rsa|ed25519|ecdsa)|(^|/)(credentials|\\.netrc|\\.npmrc|\\.pypirc)$'
  `);
  console.log(`[scrub] sensitive-file rows still carrying bodies: ${(senVerify as unknown as Array<{ n: number }>)[0]?.n ?? "?"}`);
  console.log(`[scrub] isSensitivePath('.env') sanity: ${isSensitivePath(".env")}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[scrub] failed:", e);
  process.exit(1);
});
