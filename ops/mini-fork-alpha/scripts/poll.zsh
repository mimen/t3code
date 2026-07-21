#!/bin/zsh
# Fetch origin/main and record it only when the non-secret eligibility ref names the same commit.

set -euo pipefail
source "${0:A:h}/lib.zsh"
parse_config_argument "$@"
acquire_lock
trap release_lock EXIT
trap 'release_lock; exit 130' INT TERM

sha="$(fetch_and_record_eligible_candidate)"
log "poll recorded eligible candidate sha=$sha ops_version=$MINI_FORK_ALPHA_OPS_VERSION"
print -r -- "$sha"
