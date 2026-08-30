// `code-pulse doctor` — health checks for the workstation install.

import { existsSync } from "node:fs";
import { ApiClient } from "./api-client.js";
import { CONFIG_PATH, OUTBOX_PATH, readConfig } from "./config.js";
import { pendingCount } from "./outbox.js";

type Check = { name: string; ok: boolean; detail?: string };

export async function doctor(): Promise<{ checks: Check[]; ok: boolean }> {
  const checks: Check[] = [];

  // Config
  checks.push({
    name: "config file present",
    ok: existsSync(CONFIG_PATH),
    detail: CONFIG_PATH,
  });
  const cfg = readConfig();
  checks.push({
    name: "config has api_url + api_key",
    ok: !!(cfg && cfg.api_url && cfg.api_key),
  });

  // Outbox
  let depth = -1;
  let outboxOk = false;
  try {
    if (existsSync(OUTBOX_PATH)) {
      depth = pendingCount();
      outboxOk = true;
    } else {
      outboxOk = true; // not yet created — fine before first event
    }
  } catch (err) {
    outboxOk = false;
  }
  checks.push({
    name: "outbox readable",
    ok: outboxOk,
    detail: depth >= 0 ? `${depth} unsynced` : undefined,
  });

  // API reachable
  if (cfg?.api_url && cfg.api_key) {
    const r = await new ApiClient(cfg.api_url, cfg.api_key).health();
    checks.push({
      name: "API reachable (/v1/health)",
      ok: r.ok,
      detail: r.status === 0 ? "no response" : `HTTP ${r.status}`,
    });
  } else {
    checks.push({ name: "API reachable (/v1/health)", ok: false, detail: "no config" });
  }

  return { checks, ok: checks.every((c) => c.ok) };
}

export function renderDoctor(result: { checks: Check[]; ok: boolean }): string {
  const lines = result.checks.map((c) => {
    const marker = c.ok ? "✓" : "✗";
    return `  ${marker} ${c.name}${c.detail ? `  (${c.detail})` : ""}`;
  });
  lines.push("");
  lines.push(result.ok ? "Status: OK" : "Status: FAIL");
  return lines.join("\n");
}
