#!/bin/zsh
# Regression test: only a fresh, correctly signed eligibility payload may select origin/main.

set -euo pipefail

ops_root="${0:A:h:h}"
source "$ops_root/scripts/lib.zsh"

test_root="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/mini-fork-alpha-sha-test.XXXXXX")"
cleanup() {
  /bin/rm -rf "$test_root"
}
trap cleanup EXIT INT TERM

source_repo="$test_root/source"
origin="$test_root/origin.git"
mirror="$test_root/runtime/mirror.git"
config_path="$test_root/config.zsh"
allowed_signers_path="$test_root/eligibility-allowed-signers"
fake_ssh_keygen="$test_root/fake-ssh-keygen"
attestation_dir="$test_root/attestation"
fake_node_dir="$test_root/fake-node"

/bin/mkdir -p "$fake_node_dir"
/bin/ln -s /usr/bin/true "$fake_node_dir/node"
print -r -- 'mini-fork-alpha-eligibility namespaces="mini-fork-alpha-eligibility" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' > "$allowed_signers_path"
cat > "$fake_ssh_keygen" <<'FAKE_SSH_KEYGEN'
#!/bin/zsh
set -euo pipefail
[[ "$1" == "-Y" && "$2" == "verify" ]] || exit 2
signature_path=""
while (( $# > 0 )); do
  if [[ "$1" == "-s" ]]; then
    signature_path="$2"
    break
  fi
  shift
done
[[ -n "$signature_path" && "$(<"$signature_path")" == "valid-signature" ]]
FAKE_SSH_KEYGEN
/bin/chmod 700 "$fake_ssh_keygen"

publish_attestation() {
  local sha="$1"
  local signature="$2"
  /bin/rm -rf "$attestation_dir"
  /bin/mkdir -p "$attestation_dir"
  "$MINI_FORK_ALPHA_GIT" -C "$attestation_dir" init -q
  "$MINI_FORK_ALPHA_GIT" -C "$attestation_dir" config user.name "Eligibility Test"
  "$MINI_FORK_ALPHA_GIT" -C "$attestation_dir" config user.email "eligibility-test@example.invalid"
  cat > "$attestation_dir/eligibility.payload" <<PAYLOAD
schema=1
namespace=mini-fork-alpha-eligibility
identity=mini-fork-alpha-eligibility
sha=$sha
PAYLOAD
  print -r -- "$signature" > "$attestation_dir/eligibility.payload.sig"
  "$MINI_FORK_ALPHA_GIT" -C "$attestation_dir" add eligibility.payload eligibility.payload.sig
  "$MINI_FORK_ALPHA_GIT" -C "$attestation_dir" commit -qm "attest $sha"
  "$MINI_FORK_ALPHA_GIT" -C "$attestation_dir" push -q --force "$origin" HEAD:refs/heads/mini-fork-alpha/eligible
}

/bin/mkdir -p "$source_repo"
"$MINI_FORK_ALPHA_GIT" -C "$source_repo" init -q
"$MINI_FORK_ALPHA_GIT" -C "$source_repo" config user.name "Mini Ops Test"
"$MINI_FORK_ALPHA_GIT" -C "$source_repo" config user.email "mini-ops-test@example.invalid"
print -r -- "first" > "$source_repo/release.txt"
"$MINI_FORK_ALPHA_GIT" -C "$source_repo" add release.txt
"$MINI_FORK_ALPHA_GIT" -C "$source_repo" commit -qm "first"
first_sha="$("$MINI_FORK_ALPHA_GIT" -C "$source_repo" rev-parse HEAD)"

"$MINI_FORK_ALPHA_GIT" init --bare -q "$origin"
"$MINI_FORK_ALPHA_GIT" -C "$source_repo" push -q "$origin" HEAD:refs/heads/main
publish_attestation "$first_sha" "valid-signature"
"$MINI_FORK_ALPHA_GIT" clone --mirror -q "$origin" "$mirror"

cat > "$config_path" <<CONFIG
MINI_FORK_ALPHA_ROOT="$test_root/runtime"
MINI_FORK_ALPHA_REPOSITORY_URL="file://$source_repo"
MINI_FORK_ALPHA_DATA_DIR="$test_root/data"
MINI_FORK_ALPHA_LOG_DIR="$test_root/logs"
MINI_FORK_ALPHA_HOST="127.0.0.1"
MINI_FORK_ALPHA_PORT="8446"
MINI_FORK_ALPHA_LAUNCH_AGENT_LABEL="com.mimen.t3code.fork-alpha"
MINI_FORK_ALPHA_ELIGIBLE_REF="refs/heads/mini-fork-alpha/eligible"
MINI_FORK_ALPHA_ELIGIBILITY_ALLOWED_SIGNERS_PATH="$allowed_signers_path"
MINI_FORK_ALPHA_SSH_KEYGEN_BIN="$fake_ssh_keygen"
MINI_FORK_ALPHA_SERVER_PLIST_PATH="$test_root/com.mimen.t3code.fork-alpha.plist"
MINI_FORK_ALPHA_POLL_INTERVAL_SECONDS="300"
MINI_FORK_ALPHA_NODE_BIN="$fake_node_dir/node"
MINI_FORK_ALPHA_VP_BIN="/usr/bin/true"
CONFIG

parse_config_argument --config "$config_path"
configure_build_path
[[ "$(command -v node)" == "$MINI_FORK_ALPHA_NODE_BIN" ]] || {
  print -u2 -r -- "Build PATH did not prioritize configured Node."
  exit 1
}
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

first_polled_sha="$(fetch_and_record_eligible_candidate)"
[[ "$first_polled_sha" == "$first_sha" ]] || {
  print -u2 -r -- "First signed eligibility reconciliation did not record main."
  exit 1
}
verify_polled_candidate_sha "$first_sha"

print -r -- "second" > "$source_repo/release.txt"
"$MINI_FORK_ALPHA_GIT" -C "$source_repo" add release.txt
"$MINI_FORK_ALPHA_GIT" -C "$source_repo" commit -qm "second"
second_sha="$("$MINI_FORK_ALPHA_GIT" -C "$source_repo" rev-parse HEAD)"
"$MINI_FORK_ALPHA_GIT" -C "$source_repo" push -q "$origin" HEAD:refs/heads/main

if (verify_polled_candidate_sha "$first_sha" >/dev/null 2>&1); then
  print -u2 -r -- "Stale candidate unexpectedly passed a refreshed validation."
  exit 1
fi
if (fetch_and_record_eligible_candidate >/dev/null 2>&1); then
  print -u2 -r -- "Stale signed payload unexpectedly produced a candidate."
  exit 1
fi

publish_attestation "$second_sha" "invalid-signature"
if (fetch_and_record_eligible_candidate >/dev/null 2>&1); then
  print -u2 -r -- "Invalid eligibility signature unexpectedly produced a candidate."
  exit 1
fi

publish_attestation "$second_sha" "valid-signature"
second_polled_sha="$(fetch_and_record_eligible_candidate)"
[[ "$second_polled_sha" == "$second_sha" ]] || {
  print -u2 -r -- "Signed eligibility reconciliation did not record the current main SHA."
  exit 1
}
verify_polled_candidate_sha "$second_sha"
print -r -- "Signed eligibility checks passed."
