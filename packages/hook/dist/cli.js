// CLI entrypoint for `code-pulse`.
// Subcommands: init, sync, doctor, version, help.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { sync as syncCmd } from "./sync.js";
import { doctor, renderDoctor } from "./doctor.js";
import { install } from "./install.js";
import { agent } from "./agent.js";
import { installPersistentAgent, uninstallPersistentAgent, agentStatus } from "./agent-install.js";
import { uninstall } from "./uninstall.js";
import { TEAM_DIR, ensureDir } from "./config.js";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
const HELP = `code-pulse v${PKG.version}

Usage:
  code-pulse <command> [options]

Commands:
  init --api-url URL --api-key KEY    Install the hook into ~/.claude/settings.json
  sync [--requeue-quarantined]        Drain the outbox once and POST to the API
  doctor                              Health checks
  agent                               Long-running drain loop (foreground)
  agent install                       Install persistent agent (launchd / systemd)
  agent uninstall                     Remove the persistent agent
  agent status                        Show agent install + run status
  pause                               Stop capturing on this machine (data stays)
  resume                              Resume capturing
  uninstall [--purge]                 Remove hook + agent; --purge also deletes
                                      ~/.code-pulse (outbox + API key)
  version                             Print version
  help                                This message
`;
function parseFlags(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a)
            continue;
        if (a.startsWith("--")) {
            const eq = a.indexOf("=");
            if (eq !== -1) {
                out[a.slice(2, eq)] = a.slice(eq + 1);
            }
            else {
                const next = argv[i + 1];
                if (next && !next.startsWith("--")) {
                    out[a.slice(2)] = next;
                    i++;
                }
                else {
                    out[a.slice(2)] = true;
                }
            }
        }
    }
    return out;
}
async function main() {
    const argv = process.argv.slice(2);
    const cmd = argv[0] ?? "help";
    const flags = parseFlags(argv.slice(1));
    switch (cmd) {
        case "init": {
            const apiUrl = String(flags["api-url"] ?? "");
            const apiKey = String(flags["api-key"] ?? "");
            if (!apiUrl || !apiKey) {
                console.error("Usage: code-pulse init --api-url URL --api-key KEY");
                process.exit(2);
            }
            const hookScriptPath = join(__dirname, "..", "hook", "code-pulse-hook.sh");
            install({ apiUrl, apiKey, hookScriptPath });
            return;
        }
        case "sync": {
            const r = await syncCmd({
                quiet: !flags["verbose"],
                requeueQuarantined: flags["requeue-quarantined"] === true,
            });
            console.log(`[sync] pending=${r.pending} accepted=${r.accepted} duplicates=${r.duplicates} rejected=${r.rejected} errors=${r.errors}`);
            return;
        }
        case "doctor": {
            const r = await doctor();
            console.log(renderDoctor(r));
            process.exit(r.ok ? 0 : 1);
        }
        case "agent": {
            const sub = argv[1];
            if (sub === "install") {
                const node = process.execPath;
                const cliJs = join(__dirname, "cli.js");
                const r = installPersistentAgent({ node, cliJs });
                console.log(r.message);
                return;
            }
            if (sub === "uninstall") {
                const r = uninstallPersistentAgent();
                console.log(r.message);
                return;
            }
            if (sub === "status") {
                const r = agentStatus();
                console.log(r.message);
                process.exit(r.ok ? 0 : 1);
            }
            // Foreground agent.
            await agent({ quiet: !flags["verbose"] });
            return;
        }
        case "pause": {
            ensureDir();
            writeFileSync(join(TEAM_DIR, "paused"), new Date().toISOString());
            console.log("[pause] capture paused on this machine. `code-pulse resume` to re-enable.");
            return;
        }
        case "resume": {
            const p = join(TEAM_DIR, "paused");
            if (existsSync(p))
                unlinkSync(p);
            console.log("[resume] capture resumed.");
            return;
        }
        case "uninstall": {
            uninstall({ purge: flags["purge"] === true });
            return;
        }
        case "version":
            console.log(PKG.version);
            return;
        case "help":
        case "--help":
        case "-h":
            console.log(HELP);
            return;
        default:
            console.error(`Unknown command: ${cmd}\n`);
            console.error(HELP);
            process.exit(2);
    }
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=cli.js.map