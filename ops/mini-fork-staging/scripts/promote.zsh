#!/bin/zsh
# Atomically promote one immutable release, restart the single LaunchAgent, then validate it.

set -euo pipefail
source "${0:A:h}/lib.zsh"

[[ "$#" -eq 4 && "$1" == "--config" && "$3" == "--sha" ]] || fail "Usage: $0 --config /absolute/path/to/config.zsh --sha <40-character-sha>"
config_path="$2"
candidate_sha="$4"
parse_config_argument --config "$config_path"
require_sha "$candidate_sha"
acquire_lock
trap release_lock EXIT
trap 'release_lock; exit 130' INT TERM

verify_polled_candidate_sha "$candidate_sha"
candidate="$(release_path "$candidate_sha")"
[[ -d "$candidate" ]] || fail "Candidate release is not staged."
[[ ! -w "$candidate/release.json" ]] || fail "Candidate release is mutable; refusing to promote it."
candidate_metadata="$(release_metadata "$candidate")"
[[ "${candidate_metadata%%$'\n'*}" == "$candidate_sha" ]] || fail "Candidate metadata SHA does not match the requested release."
[[ -f "$candidate/apps/server/dist/bin.mjs" && -d "$candidate/apps/web/dist" ]] || fail "Candidate release is incomplete."

current_link="$MINI_FORK_STAGING_ROOT/current"
previous_link="$MINI_FORK_STAGING_ROOT/previous"
old_current=""
old_previous=""
if [[ -e "$current_link" || -L "$current_link" ]]; then
  old_current="$(release_for_link "$current_link")"
fi
if [[ -e "$previous_link" || -L "$previous_link" ]]; then
  old_previous="$(release_for_link "$previous_link")"
fi

restore_after_failed_promotion() {
  # Candidate C still owns 8447. Quiesce it while C remains `current`, then
  # restore A/P and bootstrap/restart only after the port is vacant.
  quiesce_managed_release "$candidate"

  if [[ -n "$old_current" ]]; then
    replace_symlink "$current_link" "$old_current"
    if [[ -n "$old_previous" ]]; then
      replace_symlink "$previous_link" "$old_previous"
    else
      /bin/rm -f "$previous_link"
    fi
    restart_launch_agent || fail "Promotion failed and the previous release could not restart."
    "${0:A:h}/validate.zsh" --config "$config_path" || fail "Promotion failed and previous descriptor validation failed."
    fail "Promotion validation failed; previous release was restored."
  fi

  /bin/rm -f "$current_link"
  /bin/rm -f "$previous_link"
  fail "Initial promotion validation failed; the LaunchAgent was unloaded and current was removed."
}

if [[ -n "$old_current" ]]; then
  replace_symlink "$previous_link" "$old_current"
fi
replace_symlink "$current_link" "$candidate"
log "promote switched current sha=$candidate_sha"

if ! restart_launch_agent; then
  restore_after_failed_promotion
fi
if ! "${0:A:h}/validate.zsh" --config "$config_path"; then
  restore_after_failed_promotion
fi

log "promote completed sha=$candidate_sha"
print -r -- "promoted sha=$candidate_sha"
