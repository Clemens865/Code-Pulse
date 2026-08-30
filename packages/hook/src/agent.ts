// `code-pulse agent` — long-running drain loop.
// Wakes every ~5s when there's work, backs off when idle.
// Run as a launchd LaunchAgent on macOS or a systemd user service on Linux
// (see launchd/ and systemd/ templates).

import { sync } from "./sync.js";
import { pendingCount } from "./outbox.js";

type AgentOpts = { quiet?: boolean; minMs?: number; maxMs?: number; once?: boolean };

const DEFAULTS: Required<Omit<AgentOpts, "once" | "quiet">> = {
  minMs: 5_000,
  maxMs: 60_000,
};

export async function agent(opts: AgentOpts = {}): Promise<void> {
  const minMs = opts.minMs ?? DEFAULTS.minMs;
  const maxMs = opts.maxMs ?? DEFAULTS.maxMs;
  const log = opts.quiet ? () => {} : (msg: string) => console.log(`[agent] ${msg}`);

  let waitMs = minMs;
  let stopping = false;

  const stop = () => {
    if (stopping) return;
    stopping = true;
    log("stopping");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  log(`started · drains every ${minMs / 1000}–${maxMs / 1000}s`);

  while (!stopping) {
    const before = pendingCount();
    if (before > 0) {
      try {
        const r = await sync({ quiet: opts.quiet });
        if (!opts.quiet) {
          log(
            `drained · accepted=${r.accepted} dup=${r.duplicates} rej=${r.rejected} err=${r.errors} pending=${r.pending}`,
          );
        }
        // Reset backoff after any work, even if errors — sync handles retries.
        waitMs = minMs;
      } catch (err) {
        log(`error · ${err instanceof Error ? err.message : String(err)}`);
        waitMs = Math.min(waitMs * 2, maxMs);
      }
    } else {
      // Idle: gradually back off to maxMs.
      waitMs = Math.min(Math.max(minMs, waitMs * 1.5), maxMs);
    }

    if (opts.once) return;

    await sleep(waitMs);
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    // Don't keep the process alive just for this timer.
    if (typeof t.unref === "function") t.unref();
    // But if we get a signal we'll fire-resolve early via the next tick.
  });
}
