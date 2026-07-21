#!/bin/zsh
# Shared fail-closed helpers for the Mini Fork Alpha operations subtree.

set -euo pipefail

readonly MINI_FORK_ALPHA_OPS_VERSION="$(<"${0:A:h:h}/VERSION")"
readonly MINI_FORK_ALPHA_GIT="/usr/bin/git"
readonly MINI_FORK_ALPHA_CURL="/usr/bin/curl"
readonly MINI_FORK_ALPHA_LAUNCHCTL="/bin/launchctl"
readonly MINI_FORK_ALPHA_LSOF="/usr/sbin/lsof"
readonly MINI_FORK_ALPHA_PYTHON="/usr/bin/python3"
readonly MINI_FORK_ALPHA_ELIGIBILITY_NAMESPACE="mini-fork-alpha-eligibility"
readonly MINI_FORK_ALPHA_ELIGIBILITY_IDENTITY="mini-fork-alpha-eligibility"
readonly MINI_FORK_ALPHA_ELIGIBILITY_PAYLOAD_PATH="eligibility.payload"
readonly MINI_FORK_ALPHA_ELIGIBILITY_SIGNATURE_PATH="eligibility.payload.sig"

fail() {
  print -u2 -r -- "mini-fork-alpha: $*"
  exit 1
}

redact() {
  /usr/bin/sed -E \
    -e 's#(https?://)[^/@[:space:]]+@#\1[REDACTED]@#g' \
    -e 's#([Tt]oken|[Ss]ecret|[Pp]assword|[Aa]uthorization)[=:][^[:space:]]+#\1=[REDACTED]#g' \
    -e 's#([Aa]uthorization:).*#\1 [REDACTED]#g'
}

log() {
  local message="$*"
  local timestamp
  timestamp="$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ')"
  print -r -- "${timestamp} ${message}" | redact >> "$MINI_FORK_ALPHA_LOG_DIR/ops.log"
}

require_absolute_path() {
  local name="$1"
  local value="$2"
  [[ "$value" == /* ]] || fail "$name must be an absolute path."
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || fail "$name must not contain a newline."
}

require_sha() {
  local sha="$1"
  [[ "$sha" =~ '^[0-9a-f]{40}$' ]] || fail "Expected a lowercase, full 40-character commit SHA."
}

parse_config_argument() {
  [[ "$#" -eq 2 && "$1" == "--config" ]] || fail "Usage: $0 --config /absolute/path/to/config.zsh"
  local config_path="$2"
  require_absolute_path "Config path" "$config_path"
  [[ -f "$config_path" && -r "$config_path" ]] || fail "Config file is not readable."
  source "$config_path"
  validate_config
}

validate_eligibility_allowed_signers() {
  [[ -f "$MINI_FORK_ALPHA_ELIGIBILITY_ALLOWED_SIGNERS_PATH" && -r "$MINI_FORK_ALPHA_ELIGIBILITY_ALLOWED_SIGNERS_PATH" ]] || fail "Eligibility allowed-signers file is not readable."
  "$MINI_FORK_ALPHA_PYTHON" - "$MINI_FORK_ALPHA_ELIGIBILITY_ALLOWED_SIGNERS_PATH" <<'PYTHON'
import re
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    lines = [line.strip() for line in handle if line.strip() and not line.lstrip().startswith("#")]
pattern = re.compile(
    r'^mini-fork-alpha-eligibility namespaces="mini-fork-alpha-eligibility" ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\r\n]+)?$'
)
if len(lines) != 1 or pattern.fullmatch(lines[0]) is None:
    raise SystemExit("Allowed-signers file must contain exactly one pinned mini-fork-alpha-eligibility Ed25519 signer.")
PYTHON
}

validate_config() {
  : "${MINI_FORK_ALPHA_ROOT:?Missing MINI_FORK_ALPHA_ROOT}"
  : "${MINI_FORK_ALPHA_REPOSITORY_URL:?Missing MINI_FORK_ALPHA_REPOSITORY_URL}"
  : "${MINI_FORK_ALPHA_DATA_DIR:?Missing MINI_FORK_ALPHA_DATA_DIR}"
  : "${MINI_FORK_ALPHA_LOG_DIR:?Missing MINI_FORK_ALPHA_LOG_DIR}"
  : "${MINI_FORK_ALPHA_HOST:?Missing MINI_FORK_ALPHA_HOST}"
  : "${MINI_FORK_ALPHA_PORT:?Missing MINI_FORK_ALPHA_PORT}"
  : "${MINI_FORK_ALPHA_LAUNCH_AGENT_LABEL:?Missing MINI_FORK_ALPHA_LAUNCH_AGENT_LABEL}"
  : "${MINI_FORK_ALPHA_ELIGIBLE_REF:?Missing MINI_FORK_ALPHA_ELIGIBLE_REF}"
  : "${MINI_FORK_ALPHA_ELIGIBILITY_ALLOWED_SIGNERS_PATH:?Missing MINI_FORK_ALPHA_ELIGIBILITY_ALLOWED_SIGNERS_PATH}"
  : "${MINI_FORK_ALPHA_SSH_KEYGEN_BIN:?Missing MINI_FORK_ALPHA_SSH_KEYGEN_BIN}"
  : "${MINI_FORK_ALPHA_SERVER_PLIST_PATH:?Missing MINI_FORK_ALPHA_SERVER_PLIST_PATH}"
  : "${MINI_FORK_ALPHA_POLL_INTERVAL_SECONDS:?Missing MINI_FORK_ALPHA_POLL_INTERVAL_SECONDS}"
  : "${MINI_FORK_ALPHA_NODE_BIN:?Missing MINI_FORK_ALPHA_NODE_BIN}"
  : "${MINI_FORK_ALPHA_VP_BIN:?Missing MINI_FORK_ALPHA_VP_BIN}"

  require_absolute_path "MINI_FORK_ALPHA_ROOT" "$MINI_FORK_ALPHA_ROOT"
  require_absolute_path "MINI_FORK_ALPHA_DATA_DIR" "$MINI_FORK_ALPHA_DATA_DIR"
  require_absolute_path "MINI_FORK_ALPHA_LOG_DIR" "$MINI_FORK_ALPHA_LOG_DIR"
  require_absolute_path "MINI_FORK_ALPHA_ELIGIBILITY_ALLOWED_SIGNERS_PATH" "$MINI_FORK_ALPHA_ELIGIBILITY_ALLOWED_SIGNERS_PATH"
  require_absolute_path "MINI_FORK_ALPHA_SSH_KEYGEN_BIN" "$MINI_FORK_ALPHA_SSH_KEYGEN_BIN"
  require_absolute_path "MINI_FORK_ALPHA_SERVER_PLIST_PATH" "$MINI_FORK_ALPHA_SERVER_PLIST_PATH"
  require_absolute_path "MINI_FORK_ALPHA_NODE_BIN" "$MINI_FORK_ALPHA_NODE_BIN"
  require_absolute_path "MINI_FORK_ALPHA_VP_BIN" "$MINI_FORK_ALPHA_VP_BIN"
  [[ "$MINI_FORK_ALPHA_PORT" == "8446" ]] || fail "MINI_FORK_ALPHA_PORT must be 8446."
  [[ "$MINI_FORK_ALPHA_POLL_INTERVAL_SECONDS" == <-> ]] || fail "Poll interval must be an integer."
  (( MINI_FORK_ALPHA_POLL_INTERVAL_SECONDS >= 60 )) || fail "Poll interval must be at least 60 seconds."
  [[ "$MINI_FORK_ALPHA_LAUNCH_AGENT_LABEL" == "com.mimen.t3code.fork-alpha" ]] || fail "Unexpected LaunchAgent label."
  [[ "$MINI_FORK_ALPHA_ELIGIBLE_REF" == "refs/heads/mini-fork-alpha/eligible" ]] || fail "Unexpected eligibility ref."
  [[ -n "$MINI_FORK_ALPHA_HOST" && "$MINI_FORK_ALPHA_HOST" != "0.0.0.0" && "$MINI_FORK_ALPHA_HOST" != "::" ]] || fail "Host must be a specific interface."
  [[ -x "$MINI_FORK_ALPHA_NODE_BIN" ]] || fail "Configured Node binary is not executable."
  [[ -d "${MINI_FORK_ALPHA_NODE_BIN:h}" ]] || fail "Configured Node binary directory is missing."
  [[ -x "$MINI_FORK_ALPHA_VP_BIN" ]] || fail "Configured Vite+ binary is not executable."
  [[ -x "$MINI_FORK_ALPHA_SSH_KEYGEN_BIN" ]] || fail "Configured ssh-keygen binary is not executable."
  validate_eligibility_allowed_signers
}

configure_build_path() {
  local node_dir="${MINI_FORK_ALPHA_NODE_BIN:h}"
  [[ -d "$node_dir" ]] || fail "Configured Node binary directory is missing."
  export PATH="$node_dir:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
  [[ "$(command -v node)" == "$MINI_FORK_ALPHA_NODE_BIN" ]] || fail "Build PATH does not resolve the configured Node binary."
}

prepare_local_directories() {
  /bin/mkdir -p \
    "$MINI_FORK_ALPHA_ROOT/releases" \
    "$MINI_FORK_ALPHA_ROOT/state" \
    "$MINI_FORK_ALPHA_LOG_DIR" \
    "$MINI_FORK_ALPHA_DATA_DIR"
}

readonly MINI_FORK_ALPHA_LOCK_STALE_GRACE_SECONDS=30

lock_process_start() {
  local pid="$1"
  [[ "$pid" == <-> ]] || return 1
  /bin/ps -p "$pid" -o lstart= 2>/dev/null | /usr/bin/sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

lock_age_seconds() {
  local modified now
  modified="$("$MINI_FORK_ALPHA_PYTHON" - "$MINI_FORK_ALPHA_LOCK_DIR" <<'PYTHON'
import os
import sys
print(int(os.stat(sys.argv[1]).st_mtime))
PYTHON
)" || return 1
  now="$(/bin/date '+%s')"
  [[ "$modified" == <-> && "$now" == <-> ]] || return 1
  print -r -- $(( now - modified ))
}

remove_stale_lock() {
  local owner_path="$MINI_FORK_ALPHA_LOCK_DIR/owner"
  local age
  age="$(lock_age_seconds)" || fail "Could not determine operations lock age."
  (( age >= MINI_FORK_ALPHA_LOCK_STALE_GRACE_SECONDS )) || fail "Operations lock is being initialized; retry after ${MINI_FORK_ALPHA_LOCK_STALE_GRACE_SECONDS} seconds."

  if [[ -f "$owner_path" ]]; then
    local pid started current_started
    IFS='|' read -r pid started < "$owner_path" || true
    current_started="$(lock_process_start "$pid" 2>/dev/null || true)"
    if [[ -n "$current_started" && "$current_started" == "$started" ]]; then
      fail "Operations lock belongs to active PID $pid."
    fi
    /bin/rm -f "$owner_path"
  elif [[ -e "$owner_path" ]]; then
    fail "Operations lock has an unexpected owner entry; inspect it before removal."
  fi

  /bin/rmdir "$MINI_FORK_ALPHA_LOCK_DIR" 2>/dev/null || fail "Operations lock contains unexpected files; inspect it before removal."
  log "recovered stale operations lock"
}

write_lock_owner() {
  local started
  started="$(lock_process_start "$$")" || {
    /bin/rmdir "$MINI_FORK_ALPHA_LOCK_DIR" 2>/dev/null || true
    fail "Could not record operations lock owner."
  }
  [[ -n "$started" ]] || {
    /bin/rmdir "$MINI_FORK_ALPHA_LOCK_DIR" 2>/dev/null || true
    fail "Could not record operations lock owner."
  }
  print -r -- "$$|$started" > "$MINI_FORK_ALPHA_LOCK_DIR/owner"
  /bin/chmod 600 "$MINI_FORK_ALPHA_LOCK_DIR/owner"
}

acquire_lock() {
  prepare_local_directories
  MINI_FORK_ALPHA_LOCK_DIR="$MINI_FORK_ALPHA_ROOT/state/operations.lock"
  if ! /bin/mkdir "$MINI_FORK_ALPHA_LOCK_DIR" 2>/dev/null; then
    remove_stale_lock
    /bin/mkdir "$MINI_FORK_ALPHA_LOCK_DIR" 2>/dev/null || fail "Operations lock was acquired by another process."
  fi
  write_lock_owner
}

release_lock() {
  if [[ -n "${MINI_FORK_ALPHA_LOCK_DIR:-}" && -d "$MINI_FORK_ALPHA_LOCK_DIR" ]]; then
    /bin/rm -f "$MINI_FORK_ALPHA_LOCK_DIR/owner"
    /bin/rmdir "$MINI_FORK_ALPHA_LOCK_DIR" 2>/dev/null || true
  fi
}

fetch_eligibility_refs() {
  local mirror="$MINI_FORK_ALPHA_ROOT/mirror.git"
  local eligible_tracking_ref="refs/remotes/origin/${MINI_FORK_ALPHA_ELIGIBLE_REF#refs/heads/}"
  if [[ ! -d "$mirror" ]]; then
    "$MINI_FORK_ALPHA_GIT" clone --mirror "$MINI_FORK_ALPHA_REPOSITORY_URL" "$mirror" >/dev/null 2>&1 || fail "Could not create the local mirror."
  fi

  "$MINI_FORK_ALPHA_GIT" --git-dir="$mirror" fetch --prune origin \
    "+refs/heads/main:refs/remotes/origin/main" \
    "+${MINI_FORK_ALPHA_ELIGIBLE_REF}:${eligible_tracking_ref}" \
    >/dev/null 2>&1 || fail "Could not refresh origin/main and the eligibility ref into the local mirror."
}

canonical_eligibility_payload() {
  local sha="$1"
  require_sha "$sha"
  print -r -- "schema=1"
  print -r -- "namespace=$MINI_FORK_ALPHA_ELIGIBILITY_NAMESPACE"
  print -r -- "identity=$MINI_FORK_ALPHA_ELIGIBILITY_IDENTITY"
  print -r -- "sha=$sha"
}

verify_eligibility_attestation() {
  local sha="$1"
  require_sha "$sha"
  local mirror="$MINI_FORK_ALPHA_ROOT/mirror.git"
  local eligible_tracking_ref="refs/remotes/origin/${MINI_FORK_ALPHA_ELIGIBLE_REF#refs/heads/}"
  local payload_path="$MINI_FORK_ALPHA_ROOT/state/.eligibility.$$.payload"
  local signature_path="$MINI_FORK_ALPHA_ROOT/state/.eligibility.$$.sig"

  cleanup_eligibility_attestation() {
    /bin/rm -f "$payload_path" "$signature_path"
  }

  "$MINI_FORK_ALPHA_GIT" --git-dir="$mirror" show "${eligible_tracking_ref}:${MINI_FORK_ALPHA_ELIGIBILITY_PAYLOAD_PATH}" > "$payload_path" 2>/dev/null || {
    cleanup_eligibility_attestation
    fail "Eligibility ref is missing its canonical payload."
  }
  "$MINI_FORK_ALPHA_GIT" --git-dir="$mirror" show "${eligible_tracking_ref}:${MINI_FORK_ALPHA_ELIGIBILITY_SIGNATURE_PATH}" > "$signature_path" 2>/dev/null || {
    cleanup_eligibility_attestation
    fail "Eligibility ref is missing its detached signature."
  }
  canonical_eligibility_payload "$sha" | /usr/bin/cmp -s - "$payload_path" || {
    cleanup_eligibility_attestation
    fail "Eligibility payload is malformed or does not attest the current origin/main SHA."
  }
  "$MINI_FORK_ALPHA_SSH_KEYGEN_BIN" -Y verify \
    -f "$MINI_FORK_ALPHA_ELIGIBILITY_ALLOWED_SIGNERS_PATH" \
    -I "$MINI_FORK_ALPHA_ELIGIBILITY_IDENTITY" \
    -n "$MINI_FORK_ALPHA_ELIGIBILITY_NAMESPACE" \
    -s "$signature_path" < "$payload_path" >/dev/null 2>&1 || {
    cleanup_eligibility_attestation
    fail "Eligibility signature verification failed."
  }
  cleanup_eligibility_attestation
}

fetch_and_record_eligible_candidate() {
  fetch_eligibility_refs
  local mirror="$MINI_FORK_ALPHA_ROOT/mirror.git"
  local origin_main_sha
  origin_main_sha="$("$MINI_FORK_ALPHA_GIT" --git-dir="$mirror" rev-parse --verify refs/remotes/origin/main^{commit})"
  require_sha "$origin_main_sha"
  "$MINI_FORK_ALPHA_GIT" --git-dir="$mirror" cat-file -e "${origin_main_sha}^{commit}" || fail "Origin/main does not resolve to a commit."
  verify_eligibility_attestation "$origin_main_sha"

  local candidate_path="$MINI_FORK_ALPHA_ROOT/state/candidate-sha"
  print -r -- "$origin_main_sha" > "$candidate_path"
  /bin/chmod 600 "$candidate_path"
  print -r -- "$origin_main_sha"
}

verify_polled_candidate_sha() {
  local sha="$1"
  require_sha "$sha"
  local candidate_path="$MINI_FORK_ALPHA_ROOT/state/candidate-sha"
  [[ -f "$candidate_path" ]] || fail "Polled candidate is missing; run poll first."
  fetch_eligibility_refs
  local mirror="$MINI_FORK_ALPHA_ROOT/mirror.git"

  local candidate_sha origin_main_sha
  candidate_sha="$(<"$candidate_path")"
  require_sha "$candidate_sha"
  [[ "$candidate_sha" == "$sha" ]] || fail "Requested SHA does not match the polled candidate."
  "$MINI_FORK_ALPHA_GIT" --git-dir="$mirror" cat-file -e "${sha}^{commit}" || fail "Polled candidate is missing from the local mirror."
  origin_main_sha="$("$MINI_FORK_ALPHA_GIT" --git-dir="$mirror" rev-parse --verify refs/remotes/origin/main^{commit})"
  require_sha "$origin_main_sha"
  [[ "$origin_main_sha" == "$sha" ]] || fail "Polled candidate is no longer the current origin/main commit."
  verify_eligibility_attestation "$sha"
}

release_path() {
  local sha="$1"
  require_sha "$sha"
  print -r -- "$MINI_FORK_ALPHA_ROOT/releases/$sha"
}

release_metadata() {
  local release="$1"
  [[ -f "$release/release.json" ]] || fail "Release metadata is missing."
  "$MINI_FORK_ALPHA_PYTHON" - "$release/release.json" <<'PYTHON'
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    metadata = json.load(handle)

sha = metadata.get("sha")
version = metadata.get("serverVersion")
if not isinstance(sha, str) or re.fullmatch(r"[0-9a-f]{40}", sha) is None:
    raise SystemExit("Release metadata has an invalid SHA.")
if not isinstance(version, str) or not version.strip():
    raise SystemExit("Release metadata has an invalid server version.")
print(sha)
print(version)
PYTHON
}

release_for_link() {
  local link="$1"
  [[ -L "$link" ]] || fail "Expected symlink is missing: $link"
  local target
  target="$(/usr/bin/readlink "$link")"
  local sha="${target:t}"
  require_sha "$sha"
  [[ "$target" == "$MINI_FORK_ALPHA_ROOT/releases/$sha" && -d "$target" ]] || fail "Symlink target is outside the immutable releases directory."
  print -r -- "$target"
}

replace_symlink() {
  local link="$1"
  local target="$2"
  [[ -d "$target" ]] || fail "Cannot point symlink at a missing release."
  local temporary_link="${link}.next.$$"
  /bin/ln -s "$target" "$temporary_link"
  "$MINI_FORK_ALPHA_PYTHON" - "$temporary_link" "$link" <<'PYTHON'
import os
import sys

os.replace(sys.argv[1], sys.argv[2])
PYTHON
}

listener_pids() {
  "$MINI_FORK_ALPHA_LSOF" -nP -t -iTCP:"$MINI_FORK_ALPHA_PORT" -sTCP:LISTEN 2>/dev/null || true
}

canonical_path() {
  "$MINI_FORK_ALPHA_PYTHON" - "$1" <<'PYTHON'
import os
import sys
print(os.path.realpath(sys.argv[1]))
PYTHON
}

process_open_paths() {
  local pid="$1"
  local descriptor="$2"
  "$MINI_FORK_ALPHA_LSOF" -a -p "$pid" -d "$descriptor" -Fn 2>/dev/null | /usr/bin/sed -n 's/^n//p'
}

process_has_open_path() {
  local pid="$1"
  local descriptor="$2"
  local expected="$3"
  local candidate
  for candidate in ${(f)"$(process_open_paths "$pid" "$descriptor")"}; do
    [[ "$(canonical_path "$candidate")" == "$expected" ]] && return 0
  done
  return 1
}

launch_agent_pid() {
  local output
  output="$("$MINI_FORK_ALPHA_LAUNCHCTL" print "$(launch_agent_service)" 2>/dev/null)" || return 1
  local -a pids=("${(f)$(print -r -- "$output" | /usr/bin/sed -n 's/^[[:space:]]*pid = \([0-9][0-9]*\).*/\1/p')}")
  (( ${#pids[@]} == 1 )) || return 1
  [[ "$pids[1]" == <-> && "$pids[1]" != "0" ]] || return 1
  print -r -- "$pids[1]"
}

process_owns_release() {
  local pid="$1"
  local release="$2"
  local service_pid
  service_pid="$(launch_agent_pid)" || return 1
  [[ "$pid" == "$service_pid" ]] || return 1

  local canonical_release canonical_node
  canonical_release="$(canonical_path "$release")"
  canonical_node="$(canonical_path "$MINI_FORK_ALPHA_NODE_BIN")"
  process_has_open_path "$pid" cwd "$canonical_release" &&
    process_has_open_path "$pid" txt "$canonical_node"
}

assert_port_is_owned_by_releases() {
  local -a allowed_releases=("$@")
  local release
  for release in $allowed_releases; do
    [[ -d "$release" ]] || fail "Allowed release path is missing."
  done

  local pids
  pids="$(listener_pids)"
  [[ -n "$pids" ]] || fail "No process is listening on port 8446."

  local pid matched
  for pid in ${(f)pids}; do
    matched=false
    for release in $allowed_releases; do
      if process_owns_release "$pid" "$release"; then
        matched=true
        break
      fi
    done
    [[ "$matched" == true ]] || fail "Port 8446 is owned by an unrelated process; refusing to replace it."
  done
}

assert_port_is_unowned_or_current() {
  local -a allowed_releases
  local current_link="$MINI_FORK_ALPHA_ROOT/current"
  local previous_link="$MINI_FORK_ALPHA_ROOT/previous"
  if [[ -L "$current_link" ]]; then
    allowed_releases+=("$(release_for_link "$current_link")")
  fi
  # During promotion, `current` has already moved while launchd still owns the
  # prior process. `previous` is the only other release permitted to own 8446.
  if [[ -L "$previous_link" ]]; then
    allowed_releases+=("$(release_for_link "$previous_link")")
  fi

  local pids
  pids="$(listener_pids)"
  [[ -z "$pids" ]] && return 0
  (( ${#allowed_releases[@]} > 0 )) || fail "Port 8446 is occupied before an active release is configured."
  assert_port_is_owned_by_releases "${allowed_releases[@]}"
}

assert_port_is_owned_by_release() {
  local release="$1"
  assert_port_is_owned_by_releases "$release"
}

port_is_owned_by_release() {
  local release="$1"
  [[ -d "$release" ]] || return 1
  local pids pid
  pids="$(listener_pids)"
  [[ -n "$pids" ]] || return 1
  for pid in ${(f)pids}; do
    process_owns_release "$pid" "$release" || return 1
  done
}

launch_agent_domain() {
  print -r -- "gui/$(/usr/bin/id -u)"
}

launch_agent_service() {
  print -r -- "$(launch_agent_domain)/$MINI_FORK_ALPHA_LAUNCH_AGENT_LABEL"
}

launch_agent_is_loaded() {
  "$MINI_FORK_ALPHA_LAUNCHCTL" print "$(launch_agent_service)" >/dev/null 2>&1
}

ensure_launch_agent_loaded() {
  launch_agent_is_loaded && return 0
  [[ -f "$MINI_FORK_ALPHA_SERVER_PLIST_PATH" ]] || fail "Server LaunchAgent plist is missing."
  "$MINI_FORK_ALPHA_LAUNCHCTL" bootstrap "$(launch_agent_domain)" "$MINI_FORK_ALPHA_SERVER_PLIST_PATH" >/dev/null 2>&1 || fail "LaunchAgent bootstrap failed."
  launch_agent_is_loaded || fail "LaunchAgent did not load after bootstrap."
}

restart_launch_agent() {
  ensure_launch_agent_loaded
  assert_port_is_unowned_or_current
  "$MINI_FORK_ALPHA_LAUNCHCTL" kickstart -k "$(launch_agent_service)" >/dev/null 2>&1 || fail "LaunchAgent restart failed."
}

stop_launch_agent() {
  "$MINI_FORK_ALPHA_LAUNCHCTL" bootout "$(launch_agent_service)" >/dev/null 2>&1
}

quiesce_managed_release() {
  local release="$1"
  local pids
  pids="$(listener_pids)"
  if [[ -n "$pids" ]]; then
    assert_port_is_owned_by_release "$release"
  fi

  if launch_agent_is_loaded; then
    stop_launch_agent || fail "LaunchAgent could not be unloaded before release restoration."
  fi

  integer attempt=1
  while (( attempt <= 10 )); do
    if ! launch_agent_is_loaded && [[ -z "$(listener_pids)" ]]; then
      return 0
    fi
    /bin/sleep 1
    (( attempt++ ))
  done
  fail "LaunchAgent did not quiesce before release restoration."
}
