#!/bin/zsh
# Register or update the Mini-local claude-gpt provider through the installed release.

set -euo pipefail
source "${0:A:h}/lib.zsh"
parse_config_argument "$@"

: "${MINI_FORK_STAGING_CLAUDE_CLI_PATH:?Missing MINI_FORK_STAGING_CLAUDE_CLI_PATH}"
: "${MINI_FORK_STAGING_CLAUDE_CLI_SHA256:?Missing MINI_FORK_STAGING_CLAUDE_CLI_SHA256}"
: "${MINI_FORK_STAGING_CLAUDE_GPT_HOME_PATH:?Missing MINI_FORK_STAGING_CLAUDE_GPT_HOME_PATH}"
require_absolute_path "MINI_FORK_STAGING_CLAUDE_CLI_PATH" "$MINI_FORK_STAGING_CLAUDE_CLI_PATH"
require_absolute_path "MINI_FORK_STAGING_CLAUDE_GPT_HOME_PATH" "$MINI_FORK_STAGING_CLAUDE_GPT_HOME_PATH"
[[ "$MINI_FORK_STAGING_CLAUDE_CLI_SHA256" =~ '^[0-9a-f]{64}$' ]] || fail "Configured Claude CLI SHA-256 must be lowercase hexadecimal."

canonical_claude_cli_path="$(canonical_path "$MINI_FORK_STAGING_CLAUDE_CLI_PATH")"
[[ -f "$canonical_claude_cli_path" && -x "$canonical_claude_cli_path" ]] || fail "Configured Claude CLI path is not an executable file."
[[ "${canonical_claude_cli_path:t}" != "claude-gpt" ]] || fail "Configured CLI path must not resolve to the claude-gpt wrapper."
actual_claude_cli_sha256="$(/usr/bin/shasum -a 256 "$canonical_claude_cli_path" | /usr/bin/cut -d ' ' -f1)"
[[ "$actual_claude_cli_sha256" == "$MINI_FORK_STAGING_CLAUDE_CLI_SHA256" ]] || fail "Configured Claude CLI SHA-256 does not match its canonical executable."

release="$(release_for_link "$MINI_FORK_STAGING_ROOT/current")"
release_metadata "$release" >/dev/null
[[ -f "$release/apps/server/dist/bin.mjs" ]] || fail "Current release has no built server entrypoint."

integer server_needs_restart=0
restart_server_if_needed() {
  (( server_needs_restart )) || return 0
  restart_launch_agent || return 1
  server_needs_restart=0
}

finish() {
  local exit_code=$?
  if ! restart_server_if_needed; then
    print -u2 -r -- "Failed to restart the Mini server after claude-gpt configuration."
    exit_code=1
  fi
  release_lock
  trap - EXIT
  exit "$exit_code"
}

# Quiescing the launchd-owned server prevents an independent settings update from
# racing the read-modify-write operation below. The EXIT trap restores it on failure.
acquire_lock
trap finish EXIT
trap 'exit 130' INT TERM
server_needs_restart=1
quiesce_managed_release "$release"

# The gateway key is inherited solely as fd 0. Do not add a key flag, environment variable, or file input.
"$MINI_FORK_STAGING_NODE_BIN" "$release/apps/server/dist/bin.mjs" mini configure-claude-gpt \
  --base-dir "$MINI_FORK_STAGING_DATA_DIR" \
  --claude-cli-path "$canonical_claude_cli_path" \
  --claude-cli-sha256 "$MINI_FORK_STAGING_CLAUDE_CLI_SHA256" \
  --claude-home-path "$MINI_FORK_STAGING_CLAUDE_GPT_HOME_PATH" \
  --gateway-key-fd 0

restart_server_if_needed
