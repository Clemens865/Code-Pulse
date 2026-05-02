// `claude-pulse-team init` — write config, install hook into ~/.claude/settings.json.
// Replaces the original Claude Pulse hook entries with a single unified hook.
// Idempotent.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { writeConfig } from "./config.js";
const CLAUDE_DIR = join(homedir(), ".claude");
const SETTINGS_PATH = join(CLAUDE_DIR, "settings.json");
const HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop"];
export function install(opts) {
    if (!existsSync(opts.hookScriptPath)) {
        throw new Error(`Hook script not found at ${opts.hookScriptPath}`);
    }
    const cfg = { api_url: opts.apiUrl, api_key: opts.apiKey };
    writeConfig(cfg);
    if (!existsSync(CLAUDE_DIR))
        mkdirSync(CLAUDE_DIR, { recursive: true });
    let settings = {};
    if (existsSync(SETTINGS_PATH)) {
        try {
            settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
        }
        catch {
            const backup = `${SETTINGS_PATH}.backup-${Date.now()}`;
            writeFileSync(backup, readFileSync(SETTINGS_PATH));
            console.warn(`[install] existing settings.json was unparseable; backed up to ${backup}`);
        }
    }
    const hooks = (settings.hooks ?? {});
    for (const event of HOOK_EVENTS) {
        const list = hooks[event] ?? [];
        // Drop existing entries that point at the original solo hook OR a previous
        // install of our team hook — we replace them with the single unified entry below.
        const filtered = list.map((group) => ({
            ...group,
            hooks: group.hooks.filter((h) => {
                const cmd = String(h["command"] ?? "");
                return !cmd.includes("/.claude-pulse/hook.sh") && !cmd.includes("claude-pulse-team-hook.sh");
            }),
        })).filter((group) => group.hooks.length > 0);
        // Append the unified hook entry.
        const teamEntry = {
            type: "command",
            command: opts.hookScriptPath,
            timeout: event === "Stop" ? 10 : event === "SessionStart" ? 5 : 3,
            statusMessage: `Claude Pulse Team: ${event.toLowerCase()}…`,
        };
        if (event === "PostToolUse") {
            teamEntry.async = true;
        }
        if (event === "PostToolUse") {
            filtered.push({
                // Matcher field is required for PostToolUse to scope which tools fire it.
                // @ts-expect-error settings.json hook schema allows arbitrary fields
                matcher: "Write|Edit|Bash|Agent|Skill|Read|Glob|Grep|WebFetch|WebSearch|ToolSearch",
                hooks: [teamEntry],
            });
        }
        else {
            filtered.push({ hooks: [teamEntry] });
        }
        hooks[event] = filtered;
    }
    settings.hooks = hooks;
    const dir = dirname(SETTINGS_PATH);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    // Backup current settings before overwriting.
    if (existsSync(SETTINGS_PATH)) {
        const backup = `${SETTINGS_PATH}.backup-cpt-${Date.now()}`;
        writeFileSync(backup, readFileSync(SETTINGS_PATH));
        console.log(`[install] backed up existing settings to ${backup}`);
    }
    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    console.log(`[install] wrote ${SETTINGS_PATH}`);
    console.log(`[install] config at ${join(homedir(), ".claude-pulse-team", "config.json")}`);
    console.log(`[install] events will be sent to ${opts.apiUrl}`);
}
//# sourceMappingURL=install.js.map