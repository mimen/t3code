#!/bin/zsh
# Record the exact origin/main commit that a human may stage later. Polling never stages or promotes.

set -euo pipefail
source "${0:A:h}/lib.zsh"
parse_config_argument "$@"
acquire_lock
trap release_lock EXIT
trap 'release_lock; exit 130' INT TERM

mirror="$MINI_FORK_ALPHA_ROOT/mirror.git"
if [[ ! -d "$mirror" ]]; then
  "$MINI_FORK_ALPHA_GIT" clone --mirror "$MINI_FORK_ALPHA_REPOSITORY_URL" "$mirror" >/dev/null 2>&1 || fail "Could not create the local mirror."
fi

"$MINI_FORK_ALPHA_GIT" --git-dir="$mirror" fetch --prune origin "+refs/heads/main:refs/remotes/origin/main" >/dev/null 2>&1 || fail "Could not fetch origin/main into the local mirror."
sha="$("$MINI_FORK_ALPHA_GIT" --git-dir="$mirror" rev-parse --verify refs/remotes/origin/main^{commit})"
require_sha "$sha"
"$MINI_FORK_ALPHA_GIT" --git-dir="$mirror" cat-file -e "${sha}^{commit}" || fail "Fetched main does not resolve to a commit."

candidate_path="$MINI_FORK_ALPHA_ROOT/state/candidate-sha"
print -r -- "$sha" > "$candidate_path"
/bin/chmod 600 "$candidate_path"
log "poll recorded candidate sha=$sha ops_version=$MINI_FORK_ALPHA_OPS_VERSION"
print -r -- "$sha"
