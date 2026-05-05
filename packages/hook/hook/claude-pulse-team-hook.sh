#!/usr/bin/env bash
# Claude Pulse Team — unified hook
# - Receives Claude Code event JSON via stdin.
# - Dual-writes: appends to local single-user tracker.db (preserves the
#   existing solo dashboard) AND to ~/.claude-pulse-team/outbox.db so the
#   sync daemon can ship events to the team API.
# - Must complete in <100ms p99. Never fail loudly.
# - Spawns `claude-pulse-team sync &` as a fire-and-forget after writing the
#   outbox row, so events drain without a long-running daemon.
#
# This script is installed into ~/.claude/settings.json by `claude-pulse-team init`.

set -euo pipefail
trap 'exit 0' ERR

# ───────────── dependencies ─────────────
command -v jq      >/dev/null 2>&1 || exit 0
command -v sqlite3 >/dev/null 2>&1 || exit 0

# ───────────── constants ─────────────
TEAM_DIR="$HOME/.claude-pulse-team"
TEAM_OUTBOX="$TEAM_DIR/outbox.db"
TEAM_CONFIG="$TEAM_DIR/config.json"
SOLO_DIR="$HOME/.claude-pulse"          # original single-user pulse
SOLO_HOOK="$SOLO_DIR/hook.sh"

# ───────────── stdin ─────────────
INPUT="$(cat)" || exit 0
[ -z "$INPUT" ] && exit 0

# ───────────── parse common fields ─────────────
HOOK_TYPE="$(echo "$INPUT" | jq -r '.hook_event_name // .hook_type // empty' 2>/dev/null)" || true
SESSION_ID="$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)" || true
CWD="$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)" || true
TOOL_NAME="$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)" || true
[ -z "$HOOK_TYPE" ] && exit 0

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
#   1. CLAUDE_PULSE_REMOTE_URL env var          — explicit override (e.g. ruflow
#                                                 sets this when spawning sub-agents)
#   2. .claude-pulse-team.json walked up from   — project-pinned config file
#      cwd (looks for { "remote_url": "..." })   in the repo root
#   3. git config --get remote.origin.url       — from cwd, then OLDPWD
#   4. Cloud env vars (GitHub Codespaces / GitLab CI / Azure Pipelines)
#   5. local://<basename> synthetic              — last resort, fragments per dir

REMOTE_URL=""

# 1. Explicit env override.
[ -n "${CLAUDE_PULSE_REMOTE_URL:-}" ] && REMOTE_URL="$CLAUDE_PULSE_REMOTE_URL"

# 2. Walk up from cwd looking for .claude-pulse-team.json with a remote_url.
if [ -z "$REMOTE_URL" ] && [ -n "${CWD:-}" ]; then
    SCAN_DIR="$CWD"
    for _ in 1 2 3 4 5 6 7 8; do
        if [ -f "$SCAN_DIR/.claude-pulse-team.json" ]; then
            CFG_URL="$(jq -r '.remote_url // empty' "$SCAN_DIR/.claude-pulse-team.json" 2>/dev/null || true)"
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
#    bind via env or .claude-pulse-team.json to avoid this when running tools
#    that spawn agents in temp directories (ruflow, etc.).
[ -z "$REMOTE_URL" ] && [ -n "${CWD:-}" ] && REMOTE_URL="local://$(basename "$CWD")"

# ───────────── 3. Map Claude hook → API event_kind ─────────────
api_event_kind() {
    case "$1" in
        SessionStart)         echo "session.start" ;;
        UserPromptSubmit)     echo "prompt.submit" ;;
        Stop|StopFailure)     echo "session.end" ;;
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
if [ -n "$EVENT_KIND" ] && [ -f "$TEAM_CONFIG" ]; then
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

    # Build minimal payload — strip nothing client-side (server applies redaction).
    PAYLOAD="$(echo "$INPUT" | jq -c '.tool_input // .tool_response // .last_assistant_message // {}' 2>/dev/null || echo '{}')"

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
        '{hook_version:$hv, os:$os, cloud_env:$ce, hostname:$hn}' 2>/dev/null || echo '{}')"

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
        if command -v claude-pulse-team >/dev/null 2>&1; then
            ( claude-pulse-team sync >/dev/null 2>&1 & disown ) || true
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

# ───────────── 6. On SessionStart, fetch team context and merge with OG output ─────────────
# This is the moat — every Claude session opens with the project's open
# blockers / key decisions / hot files / patterns injected as system context.
# Latency budget: <500 ms p99 (curl --max-time 1 is the hard cap).
TEAM_CTX=""
if [ "$HOOK_TYPE" = "SessionStart" ] && [ -n "${REMOTE_URL:-}" ] && [ -f "$TEAM_CONFIG" ]; then
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
if [ -n "$OG_CTX" ] || [ -n "$TEAM_CTX" ]; then
    COMBINED="$OG_CTX"
    if [ -n "$TEAM_CTX" ]; then
        if [ -n "$COMBINED" ]; then
            COMBINED="$COMBINED"$'\n\n'"$TEAM_CTX"
        else
            COMBINED="$TEAM_CTX"
        fi
    fi
    printf '%s' "$(jq -nc --arg ctx "$COMBINED" '{hookSpecificOutput: {additionalContext: $ctx}}' 2>/dev/null)"
    exit 0
fi

# Otherwise, pass through whatever OG output verbatim (e.g. for non-JSON
# fallbacks, or for non-SessionStart hooks where OG might still write).
[ -n "$SOLO_OUT" ] && printf '%s' "$SOLO_OUT"
exit 0
