#!/bin/zsh
# Scheduled deployment loop: fetch an eligible main SHA, then stage and promote it safely.

set -euo pipefail
source "${0:A:h}/lib.zsh"

[[ "$#" -eq 2 && "$1" == "--config" ]] || fail "Usage: $0 --config /absolute/path/to/config.zsh"
config_path="$2"
parse_config_argument --config "$config_path"
script_dir="${0:A:h}"

candidate_sha="$("$script_dir/poll.zsh" --config "$config_path")"
require_sha "$candidate_sha"

current_sha=""
if [[ -L "$MINI_FORK_STAGING_ROOT/current" ]]; then
  current_release="$(release_for_link "$MINI_FORK_STAGING_ROOT/current")"
  current_metadata="$(release_metadata "$current_release")"
  current_sha="${current_metadata%%$'\n'*}"
fi

if [[ "$current_sha" == "$candidate_sha" ]] && "$script_dir/validate.zsh" --config "$config_path" >/dev/null; then
  log "reconcile no-op healthy sha=$candidate_sha"
  print -r -- "healthy sha=$candidate_sha"
  exit 0
fi

"$script_dir/stage.zsh" --config "$config_path" --sha "$candidate_sha" >/dev/null
"$script_dir/promote.zsh" --config "$config_path" --sha "$candidate_sha"
log "reconcile completed sha=$candidate_sha"
