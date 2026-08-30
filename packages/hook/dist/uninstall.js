// `code-pulse uninstall` — cleanly remove everything init/agent-install
// put on this machine.
//
//   code-pulse uninstall           remove hook entries + agent, keep data
//   code-pulse uninstall --purge   also delete ~/.code-pulse
//                                         (outbox, config with the API key)
//
// Repo-local `.claude/.pulse-session` sentinels are reported, not deleted —
// they sit inside repos we shouldn't touch wholesale.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { TEAM_DIR } from "./config.js";
import { uninstallPersistentAgent } from "./agent-install.js";
const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");
export function uninstall(opts = {}) {
    // 1. Remove our hook entries from ~/.claude/settings.json (other hooks stay).
    if (existsSync(SETTINGS_PATH)) {
        try {
            const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
            const hooks = (settings.hooks ?? {});
            let removed = 0;
            for (const event of Object.keys(hooks)) {
                const list = hooks[event] ?? [];
                const filtered = list
                    .map((group) => ({
                    ...group,
                    hooks: group.hooks.filter((h) => {
                        const cmd = String(h["command"] ?? "");
                        const hit = cmd.includes("code-pulse-hook.sh") || cmd.includes("claude-pulse-team-hook.sh");
                        if (hit)
                            removed++;
                        return !hit;
                    }),
                }))
                    .filter((group) => group.hooks.length > 0);
                if (filtered.length > 0)
                    hooks[event] = filtered;
                else
                    delete hooks[event];
            }
            settings.hooks = hooks;
            const backup = `${SETTINGS_PATH}.backup-cpt-uninstall-${Date.now()}`;
            writeFileSync(backup, readFileSync(SETTINGS_PATH));
            writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
            console.log(`[uninstall] removed ${removed} hook entr${removed === 1 ? "y" : "ies"} from ${SETTINGS_PATH} (backup: ${backup})`);
        }
        catch (e) {
            console.error(`[uninstall] could not edit ${SETTINGS_PATH}: ${e instanceof Error ? e.message : e}`);
        }
    }
    else {
        console.log("[uninstall] no ~/.claude/settings.json — nothing to unhook");
    }
    // 2. Persistent agent (launchd / systemd).
    const agent = uninstallPersistentAgent();
    console.log(`[uninstall] agent: ${agent.message}`);
    // 3. Data directory.
    if (opts.purge) {
        if (existsSync(TEAM_DIR)) {
            rmSync(TEAM_DIR, { recursive: true, force: true });
            console.log(`[uninstall] purged ${TEAM_DIR} (outbox + config + API key)`);
        }
    }
    else if (existsSync(TEAM_DIR)) {
        console.log(`[uninstall] kept ${TEAM_DIR} (outbox + config). Re-run with --purge to delete it.`);
    }
    console.log("[uninstall] note: repos may contain a .claude/.pulse-session sentinel file; it is inert without the hook and safe to delete.");
    console.log("[uninstall] your data on the team server is unaffected — ask an org admin to delete it.");
}
//# sourceMappingURL=uninstall.js.map