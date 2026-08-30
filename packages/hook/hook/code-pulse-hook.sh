#!/usr/bin/env bash
# Code Pulse — unified hook
# - Receives Claude Code event JSON via stdin.
# - Dual-writes: appends to local single-user tracker.db (preserves the
#   existing solo dashboard) AND to ~/.code-pulse/outbox.db so the
#   sync daemon can ship events to the team API.
# - Must complete in <100ms p99. Never fail loudly.
# - Spawns `code-pulse sync &` as a fire-and-forget after writing the
#   outbox row, so events drain without a long-running daemon.
#
# This script is installed into ~/.claude/settings.json by `code-pulse init`.

set -euo pipefail
trap 'exit 0' ERR

# ───────────── dependencies ─────────────
command -v jq      >/dev/null 2>&1 || exit 0
command -v sqlite3 >/dev/null 2>&1 || exit 0

# ───────────── constants ─────────────
TEAM_DIR="$HOME/.code-pulse"
# One-time migration from the pre-rename data dir.
if [ ! -d "$TEAM_DIR" ] && [ -d "$HOME/.claude-pulse-team" ]; then
    mv "$HOME/.claude-pulse-team" "$TEAM_DIR" 2>/dev/null || true
fi
TEAM_OUTBOX="$TEAM_DIR/outbox.db"
TEAM_CONFIG="$TEAM_DIR/config.json"
SOLO_DIR="$HOME/.claude-pulse"          # original single-user pulse
SOLO_HOOK="$SOLO_DIR/hook.sh"

# ───────────── kill switches ─────────────
# Team capture is opt-out at three levels; the solo hook delegation below is
# unaffected (that's the user's own local tool).
#   1. env:      CODE_PULSE_DISABLED=1
#   2. machine:  `code-pulse pause` (creates ~/.code-pulse/paused)
#   3. repo:     .code-pulse.json with {"disabled": true} in the repo root
{ [ "${CODE_PULSE_DISABLED:-0}" = "1" ] || [ "${CLAUDE_PULSE_TEAM_DISABLED:-0}" = "1" ]; } && TEAM_DISABLED=1 || TEAM_DISABLED=0
[ -f "$TEAM_DIR/paused" ] && TEAM_DISABLED=1

# ───────────── stdin ─────────────
INPUT="$(cat)" || exit 0
[ -z "$INPUT" ] && exit 0

# ───────────── parse common fields ─────────────
HOOK_TYPE="$(echo "$INPUT" | jq -r '.hook_event_name // .hook_type // empty' 2>/dev/null)" || true
SESSION_ID="$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)" || true
CWD="$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)" || true
TOOL_NAME="$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)" || true
[ -z "$HOOK_TYPE" ] && exit 0

# ───────────── agent-worktree anchor + parent-session sentinel ─────────────
# Ruflo / Claude Agent SDK runs sub-agents in <parent>/.claude/worktrees/agent-*.
# We anchor project identity to the parent repo (so agents don't fragment the
# project list) and read a sentinel left by the orchestrator's SessionStart so
# this session can be recorded as a child of the orchestrator session.
AGENT_PARENT=""
PARENT_SESSION_ID=""
case "${CWD:-}" in
    */.claude/worktrees/agent-*)
        AGENT_PARENT_CANDIDATE="${CWD%/.claude/worktrees/agent-*}"
        if [ -d "$AGENT_PARENT_CANDIDATE" ]; then
            AGENT_PARENT="$AGENT_PARENT_CANDIDATE"
            CWD="$AGENT_PARENT"   # rewrite for all subsequent identity resolution
            if [ -f "$AGENT_PARENT/.claude/.pulse-session" ]; then
                PARENT_SESSION_ID="$(head -c 64 "$AGENT_PARENT/.claude/.pulse-session" 2>/dev/null | tr -d '[:space:]' || true)"
            fi
        fi
        ;;
esac

# Orchestrator/solo SessionStart: drop a sentinel so any sub-agents this
# session spawns can find their parent session_id.
if [ "$HOOK_TYPE" = "SessionStart" ] && [ -n "${SESSION_ID:-}" ] && [ -z "$AGENT_PARENT" ] && [ -n "${CWD:-}" ]; then
    if [ -d "$CWD/.claude" ]; then
        printf '%s' "$SESSION_ID" > "$CWD/.claude/.pulse-session" 2>/dev/null || true
    fi
fi

# ───────────── 1. Delegate to original hook for local SQLite write ─────────────
# This preserves the single-user dashboard and any context-injection it does.
# We re-pipe the original stdin into the solo hook and capture its stdout so
# we can return it to Claude Code (it may inject SessionStart context).
SOLO_OUT=""
if [ -x "$SOLO_HOOK" ]; then
    SOLO_OUT="$(printf '%s' "$INPUT" | "$SOLO_HOOK" 2>/dev/null || true)"
fi

# ───────────── 2. Resolve git remote URL for project identity ─────────────
# Resolution order (first non-empty wins):
#   1. CODE_PULSE_REMOTE_URL env var          — explicit override (e.g. ruflow
#                                                 sets this when spawning sub-agents)
#   2. .code-pulse.json walked up from   — project-pinned config file
#      cwd (looks for { "remote_url": "..." })   in the repo root
#   3. git config --get remote.origin.url       — from cwd, then OLDPWD
#   4. Cloud env vars (GitHub Codespaces / GitLab CI / Azure Pipelines)
#   5. local://<basename> synthetic              — last resort, fragments per dir

REMOTE_URL=""

# 1. Explicit env override.
[ -n "${CODE_PULSE_REMOTE_URL:-}" ] && REMOTE_URL="$CODE_PULSE_REMOTE_URL"
[ -z "$REMOTE_URL" ] && [ -n "${CLAUDE_PULSE_REMOTE_URL:-}" ] && REMOTE_URL="$CLAUDE_PULSE_REMOTE_URL"

# 2. Walk up from cwd looking for .code-pulse.json with a remote_url.
if [ -z "$REMOTE_URL" ] && [ -n "${CWD:-}" ]; then
    SCAN_DIR="$CWD"
    for _ in 1 2 3 4 5 6 7 8; do
        REPO_CFG=""
        [ -f "$SCAN_DIR/.code-pulse.json" ] && REPO_CFG="$SCAN_DIR/.code-pulse.json"
        [ -z "$REPO_CFG" ] && [ -f "$SCAN_DIR/.claude-pulse-team.json" ] && REPO_CFG="$SCAN_DIR/.claude-pulse-team.json"
        if [ -n "$REPO_CFG" ]; then
            if [ "$(jq -r '.disabled // false' "$REPO_CFG" 2>/dev/null)" = "true" ]; then
                TEAM_DISABLED=1
            fi
            CFG_URL="$(jq -r '.remote_url // empty' "$REPO_CFG" 2>/dev/null || true)"
            if [ -n "$CFG_URL" ]; then
                REMOTE_URL="$CFG_URL"
                break
            fi
        fi
        PARENT="$(dirname "$SCAN_DIR")"
        [ "$PARENT" = "$SCAN_DIR" ] && break
        SCAN_DIR="$PARENT"
    done
fi

# 3. git config from cwd, then from OLDPWD (parent shell's pwd, if exported).
if [ -z "$REMOTE_URL" ] && [ -n "${CWD:-}" ]; then
    REMOTE_URL="$(cd "$CWD" 2>/dev/null && git config --get remote.origin.url 2>/dev/null || true)"
fi
if [ -z "$REMOTE_URL" ] && [ -n "${OLDPWD:-}" ]; then
    REMOTE_URL="$(cd "$OLDPWD" 2>/dev/null && git config --get remote.origin.url 2>/dev/null || true)"
fi

# 4. Cloud env fast-path.
[ -z "$REMOTE_URL" ] && [ -n "${GITHUB_REPOSITORY:-}" ]   && REMOTE_URL="https://github.com/${GITHUB_REPOSITORY}.git"
[ -z "$REMOTE_URL" ] && [ -n "${CI_PROJECT_PATH:-}" ]     && REMOTE_URL="https://gitlab.com/${CI_PROJECT_PATH}.git"
[ -z "$REMOTE_URL" ] && [ -n "${BUILD_REPOSITORY_URI:-}" ] && REMOTE_URL="${BUILD_REPOSITORY_URI}"

# 5. Worktree fallback. If cwd is inside a git worktree of a repo that has no
#    remote configured, all worktrees would otherwise fragment per basename.
#    git rev-parse --git-common-dir returns the parent repo's .git path
#    (which is shared across worktrees), so its parent dir is a stable
#    canonical anchor — every worktree of /A/B/foo gets local:/A/B/foo.
if [ -z "$REMOTE_URL" ] && [ -n "${CWD:-}" ]; then
    COMMON_DIR="$(cd "$CWD" 2>/dev/null && git rev-parse --git-common-dir 2>/dev/null || true)"
    if [ -n "$COMMON_DIR" ]; then
        # Resolve to absolute and strip the trailing /.git
        case "$COMMON_DIR" in
          /*) ABS_COMMON="$COMMON_DIR" ;;
          *)  ABS_COMMON="$(cd "$CWD" 2>/dev/null && cd "$(dirname "$COMMON_DIR")" 2>/dev/null && pwd)/$(basename "$COMMON_DIR")" ;;
        esac
        PARENT_REPO_DIR="$(dirname "$ABS_COMMON")"
        if [ -d "$PARENT_REPO_DIR" ]; then
            REMOTE_URL="local:$PARENT_REPO_DIR"
        fi
    fi
fi

# 6. Last resort: synthetic local: key. Fragments per cwd basename — explicitly
#    bind via env or .code-pulse.json to avoid this when running tools
#    that spawn agents in temp directories (ruflow, etc.).
[ -z "$REMOTE_URL" ] && [ -n "${CWD:-}" ] && REMOTE_URL="local://$(basename "$CWD")"

# ───────────── 2b. Fingerprint vector ─────────────
# Collect every project-identity signal we can, independent of the REMOTE_URL
# chain's branching (so an env override or .code-pulse.json pin doesn't
# hide the filesystem signals). The server resolves projects via this whole
# vector and registers any new key as an alias — so when a directory later
# gains a git remote, the unchanged common_dir / basename keeps it on the
# same project instead of fragmenting into a new one.
FP_GIT_REMOTE=""
FP_COMMON_DIR=""
FP_BASENAME=""
if [ -n "${CWD:-}" ]; then
    FP_GIT_REMOTE="$(cd "$CWD" 2>/dev/null && git config --get remote.origin.url 2>/dev/null || true)"
    COMMON_DIR_RAW="$(cd "$CWD" 2>/dev/null && git rev-parse --git-common-dir 2>/dev/null || true)"
    if [ -n "$COMMON_DIR_RAW" ]; then
        case "$COMMON_DIR_RAW" in
          /*) ABS_COMMON="$COMMON_DIR_RAW" ;;
          *)  ABS_COMMON="$(cd "$CWD" 2>/dev/null && cd "$(dirname "$COMMON_DIR_RAW")" 2>/dev/null && pwd)/$(basename "$COMMON_DIR_RAW")" ;;
        esac
        FP_COMMON_DIR="$(dirname "$ABS_COMMON")"
    fi
    FP_BASENAME="$(basename "$CWD")"
fi

# ───────────── 3. Map Claude hook → API event_kind ─────────────
api_event_kind() {
    case "$1" in
        SessionStart)         echo "session.start" ;;
        UserPromptSubmit)     echo "prompt.submit" ;;
        Stop|StopFailure)     echo "turn.end" ;;
        SessionEnd)           echo "session.end" ;;
        PostToolUse)
            case "$TOOL_NAME" in
                Edit)        echo "tool.edit" ;;
                Write)       echo "tool.write" ;;
                Read)        echo "tool.read" ;;
                Bash)        echo "tool.bash" ;;
                Glob)        echo "tool.glob" ;;
                Grep)        echo "tool.grep" ;;
                Agent|Task)  echo "tool.agent" ;;
                Skill)       echo "tool.skill" ;;
                WebFetch)    echo "tool.web_fetch" ;;
                WebSearch)   echo "tool.web_search" ;;
                ToolSearch)  echo "tool.tool_search" ;;
                *)           echo "" ;;
            esac
            ;;
        *) echo "" ;;
    esac
}
EVENT_KIND="$(api_event_kind "$HOOK_TYPE")"

# ───────────── 4. Outbox append (only if config exists and event maps) ─────────────
if [ -n "$EVENT_KIND" ] && [ -f "$TEAM_CONFIG" ] && [ "$TEAM_DISABLED" != "1" ]; then
    mkdir -p "$TEAM_DIR" 2>/dev/null || true

    # Init outbox schema once. Redirect stdout too — PRAGMA journal_mode echoes
    # "wal" which would otherwise leak into the hook's JSON output.
    if [ ! -f "$TEAM_OUTBOX" ]; then
        sqlite3 "$TEAM_OUTBOX" <<'SCHEMA' >/dev/null 2>&1 || true
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS outbox (
    id           TEXT PRIMARY KEY,                     -- UUIDv4
    event_kind   TEXT NOT NULL,
    session_id   TEXT,
    remote_url   TEXT,
    hook_ts      TEXT NOT NULL,                        -- ISO 8601
    client_meta  TEXT NOT NULL DEFAULT '{}',
    payload      TEXT NOT NULL DEFAULT '{}',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    synced_at    TEXT,
    last_error   TEXT,
    retry_count  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS outbox_unsynced_idx ON outbox(synced_at) WHERE synced_at IS NULL;
SCHEMA
    fi

    # UUIDv4 (good enough for v1; spec calls for v7 but v4 is still globally unique).
    EVENT_ID="$(python3 -c 'import uuid;print(uuid.uuid4())' 2>/dev/null \
                || node -e 'console.log(crypto.randomUUID())' 2>/dev/null \
                || cat /proc/sys/kernel/random/uuid 2>/dev/null \
                || echo "")"
    HOOK_TS="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

    # Sensitive-path deny list: never ship the CONTENT of secret-bearing files,
    # even to our own server. The server redacts too (defense in depth), but
    # content of .env*, keys, and credential stores must not leave the machine.
    # File identity (path) is kept so activity still shows up.
    SENSITIVE_RE='(^|/)\.env(\.|$)|(^|/)\.env$|\.pem$|\.key$|(^|/)id_(rsa|ed25519|ecdsa)[^/]*$|(^|/)(credentials|\.netrc|\.npmrc|\.pypirc)$|\.p12$|\.pfx$|\.keystore$'
    TOOL_FILE_PATH="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
    if [ -n "$TOOL_FILE_PATH" ] && printf '%s' "$TOOL_FILE_PATH" | grep -qE "$SENSITIVE_RE"; then
        INPUT="$(printf '%s' "$INPUT" | jq -c '
          .tool_input |= (with_entries(select(.key as $k | ["content","new_string","old_string","new_str","old_str"] | index($k) | not))
                          + {sensitive_content_dropped: true})
          | del(.tool_response)' 2>/dev/null || printf '%s' "$INPUT")"
    fi

    # Build minimal payload — otherwise strip nothing client-side (server applies redaction).
    # Tool events: .tool_input / .tool_response are already objects, forward as-is.
    # Stop events: .last_assistant_message is a string — wrap as {summary: ...}
    # so deriveSessionEnd can populate sessions.summary. Without this wrap, sync's
    # normalizePayload buries it under {value: ...} and the summary column stays null.
    PAYLOAD="$(echo "$INPUT" | jq -c '
      if .tool_input then .tool_input
      elif .tool_response then .tool_response
      elif .last_assistant_message then {summary: .last_assistant_message, stop_hook_active: (.stop_hook_active // false)}
      elif .reason then {reason: .reason}
      else {} end' 2>/dev/null || echo '{}')"

    # Cloud env detection.
    CLOUD_ENV="local"
    [ -n "${CODESPACES:-}" ]            && CLOUD_ENV="codespaces"
    [ -n "${GITPOD_WORKSPACE_ID:-}" ]   && CLOUD_ENV="gitpod"
    [ -n "${GITLAB_CI:-}" ]             && CLOUD_ENV="gitlab_ci"
    [ -n "${TF_BUILD:-}" ]              && CLOUD_ENV="azure_pipelines"

    HOSTNAME_S="$(hostname -s 2>/dev/null || echo "")"
    OS_NAME="$(uname -s 2>/dev/null | tr '[:upper:]' '[:lower:]')"
    HOOK_VERSION="0.1.0"
    CLIENT_META="$(jq -nc \
        --arg hv "$HOOK_VERSION" \
        --arg os "$OS_NAME" \
        --arg ce "$CLOUD_ENV" \
        --arg hn "$HOSTNAME_S" \
        --arg ps "${PARENT_SESSION_ID:-}" \
        --arg fpg "${FP_GIT_REMOTE:-}" \
        --arg fpc "${FP_COMMON_DIR:-}" \
        --arg fpb "${FP_BASENAME:-}" \
        '{hook_version:$hv, os:$os, cloud_env:$ce, hostname:$hn}
         + (if $ps != "" then {parent_session_id:$ps} else {} end)
         + (
             ((if $fpg != "" then {git_remote:$fpg} else {} end)
              + (if $fpc != "" then {common_dir:$fpc} else {} end)
              + (if $fpb != "" then {basename:$fpb} else {} end)) as $fp
             | (if ($fp | length) > 0 then {fingerprint: $fp} else {} end)
           )' 2>/dev/null || echo '{}')"

    if [ -n "$EVENT_ID" ]; then
        # SQLite escape: bind via parameters using .read isn't easy here; quote the values inline.
        sql_escape() { printf '%s' "$1" | sed "s/'/''/g"; }
        sqlite3 "$TEAM_OUTBOX" "INSERT INTO outbox (id, event_kind, session_id, remote_url, hook_ts, client_meta, payload) VALUES (
            '$(sql_escape "$EVENT_ID")',
            '$(sql_escape "$EVENT_KIND")',
            '$(sql_escape "${SESSION_ID:-}")',
            '$(sql_escape "$REMOTE_URL")',
            '$(sql_escape "$HOOK_TS")',
            '$(sql_escape "$CLIENT_META")',
            '$(sql_escape "$PAYLOAD")'
        );" 2>/dev/null || true

        # Fire-and-forget sync. Detach so the hook returns fast.
        if command -v code-pulse >/dev/null 2>&1; then
            ( code-pulse sync >/dev/null 2>&1 & disown ) || true
        fi
    fi
fi

# ───────────── 5. On Stop, mirror OG-parsed insights into the team outbox ─────────────
# OG's hook prompts Claude with a PROGRESS/DECISION/BLOCKED format and parses
# the response into its own SQLite (~/.claude-pulse/tracker.db). We reuse that
# work — read the just-inserted insights for this session and emit them as
# insight.* events so the team API derivation pipeline picks them up.
#
# Idempotent: deterministic UUIDv5(og-insight:<id>) means re-running the hook
# never duplicates events. INSERT OR IGNORE in the outbox catches any escapes.
if [ -n "${SESSION_ID:-}" ] && [ -f "$SOLO_DIR/tracker.db" ] && [ -f "$TEAM_CONFIG" ] \
   && { [ "$HOOK_TYPE" = "Stop" ] || [ "$HOOK_TYPE" = "StopFailure" ]; }; then

    # Pull every insight for this session out of OG's tracker. Deterministic
    # UUIDv5 IDs + outbox INSERT OR IGNORE collapse re-emission, so we can
    # safely select all and let dedup do its work — sessions can produce
    # hundreds of insights (p95=367 in the imported data) and the prior
    # LIMIT 50 silently dropped older ones.
    OG_INSIGHTS="$(sqlite3 -separator $'\x1f' "$SOLO_DIR/tracker.db" \
        "SELECT id, type, content FROM insights WHERE session_id = '$(sql_escape "$SESSION_ID")' ORDER BY id DESC LIMIT 2000;" \
        2>/dev/null || true)"

    if [ -n "$OG_INSIGHTS" ]; then
        while IFS=$'\x1f' read -r OG_ID OG_TYPE OG_CONTENT; do
            [ -z "$OG_ID" ] && continue
            [ -z "$OG_TYPE" ] && continue

            # Map OG enum → schema enum.
            NEW_TYPE="$OG_TYPE"
            [ "$OG_TYPE" = "blocked" ] && NEW_TYPE="blocker"

            # Skip types not in the schema enum (defensive — OG schema has the same set).
            case "$NEW_TYPE" in
                progress|decision|blocker|pattern|fix|context) ;;
                *) continue ;;
            esac

            INSIGHT_KIND="insight.$NEW_TYPE"

            # Deterministic v5 UUID so re-emission of the same OG row collapses.
            INSIGHT_EVENT_ID="$(python3 -c "import uuid; print(uuid.uuid5(uuid.NAMESPACE_URL, 'og-insight:$OG_ID'))" 2>/dev/null \
                || node -e "const c=require('crypto');const h=c.createHash('sha1').update('6ba7b8109dad11d180b400c04fd430c8','hex' in c?'hex':undefined);h.update('og-insight:$OG_ID');const x=h.digest('hex');console.log(x.slice(0,8)+'-'+x.slice(8,12)+'-5'+x.slice(13,16)+'-8'+x.slice(17,20)+'-'+x.slice(20,32));" 2>/dev/null \
                || echo "")"
            [ -z "$INSIGHT_EVENT_ID" ] && continue

            # Build payload: first 80 chars of first line → title; full content → content.
            INSIGHT_PAYLOAD="$(jq -nc \
                --arg c "$OG_CONTENT" \
                '{title: ($c | split("\n")[0] | .[0:80]), content: $c}' \
                2>/dev/null || echo '{}')"

            INSIGHT_TS="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

            sqlite3 "$TEAM_OUTBOX" "INSERT OR IGNORE INTO outbox (id, event_kind, session_id, remote_url, hook_ts, client_meta, payload) VALUES (
                '$(sql_escape "$INSIGHT_EVENT_ID")',
                '$(sql_escape "$INSIGHT_KIND")',
                '$(sql_escape "$SESSION_ID")',
                '$(sql_escape "$REMOTE_URL")',
                '$(sql_escape "$INSIGHT_TS")',
                '$(sql_escape "$CLIENT_META")',
                '$(sql_escape "$INSIGHT_PAYLOAD")'
            );" 2>/dev/null || true
        done <<< "$OG_INSIGHTS"
    fi
fi

# ───────────── 5.5. Universal structured-summary block (Stop) ─────────────
# Force the PROGRESS/DECISION/BLOCKED block from THIS hook so it fires in
# every project — including claude-flow projects whose project-local
# settings.json adds extra Stop hooks that were causing Claude Code's
# resolver to ignore OG's delegated block decision (empirically:
# code-pulse 2.57 insights/prompt vs city-ai 0.44 / chrome 1.68).
#
# Anti-loop: stop_hook_active is true on the SECOND Stop fire (after Claude
# responds to the block prompt). We let that one through so the cycle
# terminates and the response gets recorded.
#
# Side effects above (outbox write, OG delegation, insight mirroring) have
# already run, so OG's tracker.db is up to date by the time we block.
if { [ "$HOOK_TYPE" = "Stop" ] || [ "$HOOK_TYPE" = "StopFailure" ]; } && [ "$TEAM_DISABLED" != "1" ]; then
    STOP_HOOK_ACTIVE="$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null || echo "false")"
    LAST_MSG="$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // empty' 2>/dev/null || true)"

    # Activity gate: only ask for a structured summary when real work happened
    # since the last summary in this session (>=1 new edit/write/bash event).
    # Trivial Q&A turns end silently instead of being interrogated.
    WORK_NOW=0
    if [ -f "$TEAM_OUTBOX" ] && [ -n "${SESSION_ID:-}" ]; then
        WORK_NOW="$(sqlite3 "$TEAM_OUTBOX" "SELECT count(*) FROM outbox WHERE session_id='$(sql_escape "$SESSION_ID")' AND event_kind IN ('tool.edit','tool.write','tool.bash');" 2>/dev/null || echo 0)"
    fi
    BLOCK_MARK="$TEAM_DIR/.blockmark-${SESSION_ID:-none}"
    WORK_LAST="$(cat "$BLOCK_MARK" 2>/dev/null || echo 0)"
    case "$WORK_LAST" in (*[!0-9]*) WORK_LAST=0;; esac

    if [ "$STOP_HOOK_ACTIVE" != "true" ] && [ -n "$LAST_MSG" ] && [ "$WORK_NOW" -gt "$WORK_LAST" ]; then
        printf '%s' "$WORK_NOW" > "$BLOCK_MARK" 2>/dev/null || true
        PROJECT_LABEL="$(basename "${CWD:-this project}" 2>/dev/null || echo "this project")"
        BLOCK_PROMPT="Session ending for ${PROJECT_LABEL}. Respond with ONLY these lines (skip empty categories):
PROGRESS: <what was accomplished, 1 line>
DECISION: <key choice and why> (repeat if multiple)
BLOCKED: <what is genuinely stuck: failing test, missing access, unanswered question — NOT next steps>
RESOLVED: <a previously reported blocker this session unblocked>"
        printf '%s' "$(jq -nc --arg r "$BLOCK_PROMPT" '{decision:"block", reason:$r}' 2>/dev/null)"
        exit 0
    fi
fi

# ───────────── 5.6. Parse the structured summary into insight events ─────────────
# On the SECOND Stop fire (stop_hook_active=true) the last assistant message IS
# the PROGRESS/DECISION/BLOCKED/RESOLVED block. Parse it right here and emit
# insight.* events — no dependency on the single-user tracker.db. When the solo
# tool is installed, its mirror in section 5 already captured richer rows for
# this session, so we skip to avoid double capture.
if { [ "$HOOK_TYPE" = "Stop" ] || [ "$HOOK_TYPE" = "StopFailure" ]; } \
   && [ "$TEAM_DISABLED" != "1" ] && [ ! -f "$SOLO_DIR/tracker.db" ] \
   && [ -f "$TEAM_CONFIG" ] && [ -n "${SESSION_ID:-}" ]; then
    SHA="$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)"
    SMSG="$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // empty' 2>/dev/null || true)"
    if [ "$SHA" = "true" ] && [ -n "$SMSG" ]; then
        printf '%s\n' "$SMSG" | grep -E '^(PROGRESS|DECISION|BLOCKED|RESOLVED):' 2>/dev/null | head -20 | \
        while IFS= read -r LINE; do
            KIND_RAW="${LINE%%:*}"
            CONTENT="$(printf '%s' "${LINE#*:}" | sed 's/^ *//')"
            [ -z "$CONTENT" ] && continue
            case "$KIND_RAW" in
                PROGRESS) IKIND="insight.progress" ;;
                DECISION) IKIND="insight.decision" ;;
                BLOCKED)  IKIND="insight.blocker" ;;
                RESOLVED) IKIND="insight.progress"; CONTENT="RESOLVED: $CONTENT" ;;
                *) continue ;;
            esac
            # Deterministic id: same session + same line never duplicates.
            LID="$(python3 -c "import uuid,sys; print(uuid.uuid5(uuid.NAMESPACE_URL, 'team-insight:' + sys.argv[1] + ':' + sys.argv[2]))" "$SESSION_ID" "$LINE" 2>/dev/null || echo "")"
            [ -z "$LID" ] && continue
            IPAYLOAD="$(jq -nc --arg c "$CONTENT" '{title: ($c | split("\n")[0] | .[0:80]), content: $c}' 2>/dev/null || echo '{}')"
            ITS="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
            sqlite3 "$TEAM_OUTBOX" "INSERT OR IGNORE INTO outbox (id, event_kind, session_id, remote_url, hook_ts, client_meta, payload) VALUES (
                '$(sql_escape "$LID")','$(sql_escape "$IKIND")','$(sql_escape "$SESSION_ID")','$(sql_escape "$REMOTE_URL")','$(sql_escape "$ITS")','$(sql_escape "$CLIENT_META")','$(sql_escape "$IPAYLOAD")');" 2>/dev/null || true
        done
        ( command -v code-pulse >/dev/null 2>&1 && code-pulse sync >/dev/null 2>&1 & ) 2>/dev/null || true
    fi
fi

# Session cleanup: drop the per-session block marker when the session really ends.
if [ "$HOOK_TYPE" = "SessionEnd" ] && [ -n "${SESSION_ID:-}" ]; then
    rm -f "$TEAM_DIR/.blockmark-$SESSION_ID" 2>/dev/null || true
fi

# ───────────── 5.9. First-run consent notice (once per workstation) ─────────────
# People deserve to know a capture hook is running. Claude Code shows a hook's
# systemMessage to the user; we add it exactly once, on the first SessionStart
# after install, and record that it was shown.
NOTICE=""
if [ "$HOOK_TYPE" = "SessionStart" ] && [ -f "$TEAM_CONFIG" ] && [ "$TEAM_DISABLED" != "1" ] && [ ! -f "$TEAM_DIR/.notice-shown" ]; then
    date -u '+%Y-%m-%dT%H:%M:%SZ' > "$TEAM_DIR/.notice-shown" 2>/dev/null || true
    NOTICE="Code Pulse is capturing session activity (tool events, summaries, file paths — secrets and sensitive files are stripped) and sharing it with your team's Pulse server. Opt out: 'code-pulse pause', CODE_PULSE_DISABLED=1, or {\"disabled\": true} in .code-pulse.json. Remove fully: 'code-pulse uninstall'."
fi

# ───────────── 6. On SessionStart, fetch team context and merge with OG output ─────────────
# This is the moat — every Claude session opens with the project's open
# blockers / key decisions / hot files / patterns injected as system context.
# Latency budget: <500 ms p99 (curl --max-time 1 is the hard cap).
TEAM_CTX=""
if [ "$HOOK_TYPE" = "SessionStart" ] && [ -n "${REMOTE_URL:-}" ] && [ -f "$TEAM_CONFIG" ] && [ "$TEAM_DISABLED" != "1" ]; then
    API_URL="$(jq -r '.api_url // empty' "$TEAM_CONFIG" 2>/dev/null)"
    API_KEY="$(jq -r '.api_key // empty' "$TEAM_CONFIG" 2>/dev/null)"
    if [ -n "$API_URL" ] && [ -n "$API_KEY" ]; then
        TEAM_CTX="$(curl -fsS --max-time 1 \
            -H "Authorization: Bearer $API_KEY" \
            --get --data-urlencode "remote_url=$REMOTE_URL" --data-urlencode "format=text" \
            "$API_URL/v1/context" 2>/dev/null || true)"
    fi
fi

# Extract OG's additionalContext (if it produced any) so we can merge cleanly.
OG_CTX=""
if [ -n "$SOLO_OUT" ]; then
    OG_CTX="$(printf '%s' "$SOLO_OUT" | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null || true)"
fi

# If we have either source, emit a combined hookSpecificOutput JSON. Team
# context goes after OG's so the team block is the most-recent thing the
# AI reads (most-recent context tends to weight higher).
# Note: Claude Code's hook schema requires hookEventName inside
# hookSpecificOutput — without it the runtime rejects the entire output
# with "Hook JSON output validation failed".
if [ -n "$OG_CTX" ] || [ -n "$TEAM_CTX" ]; then
    COMBINED="$OG_CTX"
    if [ -n "$TEAM_CTX" ]; then
        if [ -n "$COMBINED" ]; then
            COMBINED="$COMBINED"$'\n\n'"$TEAM_CTX"
        else
            COMBINED="$TEAM_CTX"
        fi
    fi
    printf '%s' "$(jq -nc \
        --arg ctx "$COMBINED" \
        --arg hen "$HOOK_TYPE" \
        --arg sm "${NOTICE:-}" \
        '{hookSpecificOutput: {hookEventName: $hen, additionalContext: $ctx}}
         + (if $sm != "" then {systemMessage: $sm} else {} end)' \
        2>/dev/null)"
    exit 0
fi

# Consent notice with no context to merge: emit it standalone.
if [ -n "${NOTICE:-}" ]; then
    printf '%s' "$(jq -nc --arg sm "$NOTICE" '{systemMessage: $sm}' 2>/dev/null)"
    exit 0
fi

# Otherwise, pass through whatever OG output verbatim (e.g. for non-JSON
# fallbacks, or for non-SessionStart hooks where OG might still write).
# If OG emitted hookSpecificOutput without hookEventName, inject it so
# Claude Code's stricter schema accepts the output.
if [ -n "$SOLO_OUT" ]; then
    HAS_HSO="$(printf '%s' "$SOLO_OUT" | jq -e 'has("hookSpecificOutput")' >/dev/null 2>&1 && echo y || echo n)"
    if [ "$HAS_HSO" = "y" ]; then
        HAS_HEN="$(printf '%s' "$SOLO_OUT" | jq -r '.hookSpecificOutput.hookEventName // empty' 2>/dev/null || true)"
        if [ -z "$HAS_HEN" ]; then
            FIXED="$(printf '%s' "$SOLO_OUT" | jq -c --arg hen "$HOOK_TYPE" '.hookSpecificOutput.hookEventName = $hen' 2>/dev/null || echo "")"
            [ -n "$FIXED" ] && printf '%s' "$FIXED" || printf '%s' "$SOLO_OUT"
        else
            printf '%s' "$SOLO_OUT"
        fi
    else
        printf '%s' "$SOLO_OUT"
    fi
fi
exit 0
