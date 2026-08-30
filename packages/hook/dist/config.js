// ~/.code-pulse/config.json — workstation config.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
export const TEAM_DIR = join(homedir(), ".code-pulse");
export const CONFIG_PATH = join(TEAM_DIR, "config.json");
export const OUTBOX_PATH = join(TEAM_DIR, "outbox.db");
export function ensureDir() {
    // One-time migration from the pre-rename data dir (~/.claude-pulse-team).
    const legacy = join(homedir(), ".claude-pulse-team");
    if (!existsSync(TEAM_DIR) && existsSync(legacy)) {
        try {
            renameSync(legacy, TEAM_DIR);
        }
        catch {
            // cross-device or permission issue — fall through to a fresh dir
        }
    }
    if (!existsSync(TEAM_DIR))
        mkdirSync(TEAM_DIR, { recursive: true, mode: 0o700 });
}
export function readConfig() {
    ensureDir();
    if (!existsSync(CONFIG_PATH))
        return null;
    try {
        return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    }
    catch {
        return null;
    }
}
export function writeConfig(c) {
    ensureDir();
    const dir = dirname(CONFIG_PATH);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    // 0600: the file holds the workstation API key.
    writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2), { mode: 0o600 });
}
export function requireConfig() {
    const c = readConfig();
    if (!c) {
        console.error(`No config at ${CONFIG_PATH}. Run \`code-pulse init\` first.`);
        process.exit(2);
    }
    if (!c.api_url || !c.api_key) {
        console.error(`Config at ${CONFIG_PATH} is missing api_url or api_key.`);
        process.exit(2);
    }
    return c;
}
//# sourceMappingURL=config.js.map