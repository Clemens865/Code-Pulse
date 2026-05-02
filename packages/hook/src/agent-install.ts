// Persistent agent installer for macOS (launchd) and Linux (systemd user service).
// On macOS: writes ~/Library/LaunchAgents/com.claude-pulse-team.agent.plist and
// loads it via `launchctl load`.
// On Linux: writes ~/.config/systemd/user/claude-pulse-team-agent.service and
// runs `systemctl --user enable --now`.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, "..", "launchd"); // also ../systemd for linux
const TEAM_DIR = join(homedir(), ".claude-pulse-team");

const LAUNCHD_LABEL = "com.claude-pulse-team.agent";
const LAUNCHD_PATH = join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
const SYSTEMD_NAME = "claude-pulse-team-agent.service";
const SYSTEMD_PATH = join(homedir(), ".config", "systemd", "user", SYSTEMD_NAME);

export function installPersistentAgent(opts: { node: string; cliJs: string }): { ok: boolean; message: string } {
  if (!existsSync(TEAM_DIR)) mkdirSync(TEAM_DIR, { recursive: true });

  if (platform() === "darwin") {
    const tpl = readFileSync(join(TEMPLATES_DIR, "com.claude-pulse-team.agent.plist"), "utf-8");
    const out = tpl
      .replaceAll("__NODE__", escapeXml(opts.node))
      .replaceAll("__CLI_JS__", escapeXml(opts.cliJs))
      .replaceAll("__LOG_DIR__", escapeXml(TEAM_DIR))
      .replaceAll("__LABEL__", LAUNCHD_LABEL);

    if (!existsSync(dirname(LAUNCHD_PATH))) mkdirSync(dirname(LAUNCHD_PATH), { recursive: true });
    writeFileSync(LAUNCHD_PATH, out);

    // Reload if already loaded.
    try {
      execSync(`launchctl unload "${LAUNCHD_PATH}"`, { stdio: "pipe" });
    } catch {
      // not loaded yet — ignore.
    }
    execSync(`launchctl load "${LAUNCHD_PATH}"`, { stdio: "pipe" });

    return {
      ok: true,
      message: `installed launchd agent: ${LAUNCHD_PATH}\nlogs: ${TEAM_DIR}/agent.{out,err}.log`,
    };
  }

  if (platform() === "linux") {
    const systemdTpl = readFileSync(
      join(__dirname, "..", "systemd", SYSTEMD_NAME),
      "utf-8",
    );
    const out = systemdTpl
      .replaceAll("__NODE__", opts.node)
      .replaceAll("__CLI_JS__", opts.cliJs);
    if (!existsSync(dirname(SYSTEMD_PATH))) mkdirSync(dirname(SYSTEMD_PATH), { recursive: true });
    writeFileSync(SYSTEMD_PATH, out);
    execSync("systemctl --user daemon-reload");
    execSync(`systemctl --user enable --now ${SYSTEMD_NAME}`);
    return { ok: true, message: `installed systemd user service: ${SYSTEMD_PATH}` };
  }

  return { ok: false, message: `Persistent agent not supported on ${platform()} yet.` };
}

export function uninstallPersistentAgent(): { ok: boolean; message: string } {
  if (platform() === "darwin") {
    if (!existsSync(LAUNCHD_PATH)) return { ok: true, message: "no agent installed" };
    try {
      execSync(`launchctl unload "${LAUNCHD_PATH}"`, { stdio: "pipe" });
    } catch {
      // ignore — may already be unloaded.
    }
    unlinkSync(LAUNCHD_PATH);
    return { ok: true, message: `removed ${LAUNCHD_PATH}` };
  }
  if (platform() === "linux") {
    if (!existsSync(SYSTEMD_PATH)) return { ok: true, message: "no agent installed" };
    try {
      execSync(`systemctl --user disable --now ${SYSTEMD_NAME}`);
    } catch {
      // ignore
    }
    unlinkSync(SYSTEMD_PATH);
    execSync("systemctl --user daemon-reload");
    return { ok: true, message: `removed ${SYSTEMD_PATH}` };
  }
  return { ok: false, message: `Not supported on ${platform()}` };
}

export function agentStatus(): { ok: boolean; message: string } {
  if (platform() === "darwin") {
    if (!existsSync(LAUNCHD_PATH)) {
      return { ok: false, message: "agent: not installed (run `claude-pulse-team agent install`)" };
    }
    try {
      const out = execSync(`launchctl list ${LAUNCHD_LABEL}`, { stdio: ["ignore", "pipe", "pipe"] }).toString();
      // launchctl list output: "PID\tStatus\tLabel"
      const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
      const lastExit = /"LastExitStatus" = (\d+)/.exec(out)?.[1];
      const pidMatch = /"PID" = (\d+)/.exec(out);
      const running = !!pidMatch;
      const summary = `agent: ${running ? `running (pid ${pidMatch?.[1]})` : "loaded but not running"}; lastExit=${lastExit ?? "?"}`;
      return { ok: true, message: `${summary}\nplist: ${LAUNCHD_PATH}\n${lines.length} keys` };
    } catch {
      return { ok: false, message: `agent installed but launchctl list failed (try: launchctl load ${LAUNCHD_PATH})` };
    }
  }
  if (platform() === "linux") {
    if (!existsSync(SYSTEMD_PATH)) return { ok: false, message: "agent: not installed" };
    try {
      const out = execSync(`systemctl --user is-active ${SYSTEMD_NAME}`, { stdio: ["ignore", "pipe", "pipe"] })
        .toString()
        .trim();
      return { ok: out === "active", message: `agent: ${out}` };
    } catch (e) {
      return { ok: false, message: `agent inactive: ${(e as Error).message}` };
    }
  }
  return { ok: false, message: `Not supported on ${platform()}` };
}

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
