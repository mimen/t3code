#!/bin/zsh
# LaunchAgent entrypoint. It starts only the current immutable release on port 8446.

set -euo pipefail
source "${0:A:h}/lib.zsh"
parse_config_argument "$@"
prepare_local_directories

release="$(release_for_link "$MINI_FORK_ALPHA_ROOT/current")"
release_metadata "$release" >/dev/null
[[ -f "$release/apps/server/dist/bin.mjs" ]] || fail "Current release has no built server entrypoint."
[[ -d "$release/apps/web/dist" ]] || fail "Current release has no built web assets."

cd "$release"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export T3CODE_PORT="8446"
export T3CODE_HOST="$MINI_FORK_ALPHA_HOST"
export T3CODE_HOME="$MINI_FORK_ALPHA_DATA_DIR"
export T3CODE_NO_BROWSER="true"
export T3CODE_TAILSCALE_SERVE="false"

# `exec` makes launchd own exactly one server process. No arbitrary configured port is accepted.
exec "$MINI_FORK_ALPHA_NODE_BIN" "$release/apps/server/dist/bin.mjs" serve \
  --port 8446 \
  --host "$MINI_FORK_ALPHA_HOST" \
  --base-dir "$MINI_FORK_ALPHA_DATA_DIR" \
  --no-browser
