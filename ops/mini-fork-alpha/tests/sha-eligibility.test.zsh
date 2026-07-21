#!/bin/zsh
# Regression test: staging and promotion must use the exact, currently polled origin/main SHA.

set -euo pipefail

ops_root="${0:A:h:h}"
source "$ops_root/scripts/lib.zsh"

test_root="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/mini-fork-alpha-sha-test.XXXXXX")"
cleanup() {
  /bin/rm -rf "$test_root"
}
trap cleanup EXIT INT TERM

source_repo="$test_root/source"
mirror="$test_root/runtime/mirror.git"
config_path="$test_root/config.zsh"
/bin/mkdir -p "$source_repo"
"$MINI_FORK_ALPHA_GIT" -C "$source_repo" init -q
"$MINI_FORK_ALPHA_GIT" -C "$source_repo" config user.name "Mini Ops Test"
"$MINI_FORK_ALPHA_GIT" -C "$source_repo" config user.email "mini-ops-test@example.invalid"
print -r -- "first" > "$source_repo/release.txt"
"$MINI_FORK_ALPHA_GIT" -C "$source_repo" add release.txt
"$MINI_FORK_ALPHA_GIT" -C "$source_repo" commit -qm "first"
first_sha="$("$MINI_FORK_ALPHA_GIT" -C "$source_repo" rev-parse HEAD)"

"$MINI_FORK_ALPHA_GIT" init --bare -q "$mirror"
"$MINI_FORK_ALPHA_GIT" -C "$source_repo" push -q "$mirror" HEAD:refs/heads/main
"$MINI_FORK_ALPHA_GIT" --git-dir="$mirror" update-ref refs/remotes/origin/main "$first_sha"

cat > "$config_path" <<CONFIG
MINI_FORK_ALPHA_ROOT="$test_root/runtime"
MINI_FORK_ALPHA_REPOSITORY_URL="file://$source_repo"
MINI_FORK_ALPHA_DATA_DIR="$test_root/data"
MINI_FORK_ALPHA_LOG_DIR="$test_root/logs"
MINI_FORK_ALPHA_HOST="127.0.0.1"
MINI_FORK_ALPHA_PORT="8446"
MINI_FORK_ALPHA_LAUNCH_AGENT_LABEL="com.mimen.t3code.fork-alpha"
MINI_FORK_ALPHA_SERVER_PLIST_PATH="$test_root/com.mimen.t3code.fork-alpha.plist"
MINI_FORK_ALPHA_POLL_INTERVAL_SECONDS="300"
MINI_FORK_ALPHA_NODE_BIN="/usr/bin/true"
MINI_FORK_ALPHA_VP_BIN="/usr/bin/true"
CONFIG

parse_config_argument --config "$config_path"
prepare_local_directories

acquire_lock
if (acquire_lock >/dev/null 2>&1); then
  print -u2 -r -- "Active operations lock unexpectedly allowed a concurrent acquisition."
  exit 1
fi
release_lock

/bin/mkdir "$MINI_FORK_ALPHA_ROOT/state/operations.lock"
print -r -- "999999|stale process" > "$MINI_FORK_ALPHA_ROOT/state/operations.lock/owner"
"$MINI_FORK_ALPHA_PYTHON" - "$MINI_FORK_ALPHA_ROOT/state/operations.lock" <<'PYTHON'
import os
import sys
import time

os.utime(sys.argv[1], (time.time() - 60, time.time() - 60))
PYTHON
acquire_lock
release_lock

print -r -- "$first_sha" > "$MINI_FORK_ALPHA_ROOT/state/candidate-sha"
verify_polled_candidate_sha "$first_sha"

print -r -- "second" > "$source_repo/release.txt"
"$MINI_FORK_ALPHA_GIT" -C "$source_repo" add release.txt
"$MINI_FORK_ALPHA_GIT" -C "$source_repo" commit -qm "second"
second_sha="$("$MINI_FORK_ALPHA_GIT" -C "$source_repo" rev-parse HEAD)"
"$MINI_FORK_ALPHA_GIT" -C "$source_repo" push -q "$mirror" HEAD:refs/heads/main
"$MINI_FORK_ALPHA_GIT" --git-dir="$mirror" update-ref refs/remotes/origin/main "$second_sha"

if (verify_polled_candidate_sha "$first_sha" >/dev/null 2>&1); then
  print -u2 -r -- "Stale candidate unexpectedly passed eligibility validation."
  exit 1
fi

print -r -- "$second_sha" > "$MINI_FORK_ALPHA_ROOT/state/candidate-sha"
verify_polled_candidate_sha "$second_sha"
print -r -- "SHA eligibility checks passed."
