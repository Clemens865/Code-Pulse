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
REMOTE_URL=""
if [ -n "${CWD:-}" ]; then
    REMOTE_URL="$(cd "$CWD" 2>/dev/null && git config --get remote.origin.url 2>/dev/null || true)"
fi
# Cloud env fast-path: env vars often beat invoking git.
[ -z "$REMOTE_URL" ] && [ -n "${GITHUB_REPOSITORY:-}" ]   && REMOTE_URL="https://github.com/${GITHUB_REPOSITORY}.git"
[ -z "$REMOTE_URL" ] && [ -n "${CI_PROJECT_PATH:-}" ]     && REMOTE_URL="https://gitlab.com/${CI_PROJECT_PATH}.git"
[ -z "$REMOTE_URL" ] && [ -n "${BUILD_REPOSITORY_URI:-}" ] && REMOTE_URL="${BUILD_REPOSITORY_URI}"
# No remote → still try to record events; project resolution will need a manual bind.
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

    # Init outbox schema once.
    if [ ! -f "$TEAM_OUTBOX" ]; then
        sqlite3 "$TEAM_OUTBOX" <<'SCHEMA' 2>/dev/null || true
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

    # Pull the most-recent insights for this session out of OG's tracker.
    # Limit guards against runaway emission if a session somehow accumulated thousands.
    OG_INSIGHTS="$(sqlite3 -separator $'\x1f' "$SOLO_DIR/tracker.db" \
        "SELECT id, type, content FROM insights WHERE session_id = '$(sql_escape "$SESSION_ID")' ORDER BY id DESC LIMIT 50;" \
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

# ───────────── 6. Pass through whatever the solo hook output ─────────────
[ -n "$SOLO_OUT" ] && printf '%s' "$SOLO_OUT"
exit 0
