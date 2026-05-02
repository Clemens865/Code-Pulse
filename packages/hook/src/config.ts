// ~/.claude-pulse-team/config.json — workstation config.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type Config = {
  api_url: string;
  api_key: string;
  org_id?: string;
  member_id?: string;
};

export const TEAM_DIR = join(homedir(), ".claude-pulse-team");
export const CONFIG_PATH = join(TEAM_DIR, "config.json");
export const OUTBOX_PATH = join(TEAM_DIR, "outbox.db");

export function ensureDir() {
  if (!existsSync(TEAM_DIR)) mkdirSync(TEAM_DIR, { recursive: true });
}

export function readConfig(): Config | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Config;
  } catch {
    return null;
  }
}

export function writeConfig(c: Config): void {
  ensureDir();
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2));
}

export function requireConfig(): Config {
  const c = readConfig();
  if (!c) {
    console.error(`No config at ${CONFIG_PATH}. Run \`claude-pulse-team init\` first.`);
    process.exit(2);
  }
  if (!c.api_url || !c.api_key) {
    console.error(`Config at ${CONFIG_PATH} is missing api_url or api_key.`);
    process.exit(2);
  }
  return c;
}
