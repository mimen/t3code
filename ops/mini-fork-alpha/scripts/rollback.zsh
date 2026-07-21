#!/bin/zsh
# Swap current and previous immutable releases, restart once, then validate the restored release.

set -euo pipefail
source "${0:A:h}/lib.zsh"

[[ "$#" -eq 2 && "$1" == "--config" ]] || fail "Usage: $0 --config /absolute/path/to/config.zsh"
config_path="$2"
parse_config_argument --config "$config_path"
acquire_lock
trap release_lock EXIT
trap 'release_lock; exit 130' INT TERM

current_link="$MINI_FORK_ALPHA_ROOT/current"
previous_link="$MINI_FORK_ALPHA_ROOT/previous"
old_current="$(release_for_link "$current_link")"
old_previous="$(release_for_link "$previous_link")"
release_metadata "$old_current" >/dev/null
release_metadata "$old_previous" >/dev/null

replace_symlink "$current_link" "$old_previous"
replace_symlink "$previous_link" "$old_current"
rollback_metadata="$(release_metadata "$old_previous")"
rollback_sha="${rollback_metadata%%$'\n'*}"
log "rollback switched current sha=$rollback_sha"

restore_after_failed_rollback() {
  replace_symlink "$current_link" "$old_current"
  replace_symlink "$previous_link" "$old_previous"
  restart_launch_agent || fail "Rollback failed and the original release could not restart."
  "${0:A:h}/validate.zsh" --config "$config_path" || fail "Rollback failed and original descriptor validation failed."
  fail "Rollback validation failed; original release was restored."
}

if ! restart_launch_agent; then
  restore_after_failed_rollback
fi
if ! "${0:A:h}/validate.zsh" --config "$config_path"; then
  restore_after_failed_rollback
fi

log "rollback completed sha=$rollback_sha"
print -r -- "rolled back to sha=$rollback_sha"
