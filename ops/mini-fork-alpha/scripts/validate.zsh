#!/bin/zsh
# Validate the active release with the server's existing descriptor endpoint.
# This deliberately does not depend on a new readiness API.

set -euo pipefail
source "${0:A:h}/lib.zsh"
parse_config_argument "$@"
prepare_local_directories

release="$(release_for_link "$MINI_FORK_ALPHA_ROOT/current")"
metadata="$(release_metadata "$release")"
expected_sha="${metadata%%$'\n'*}"
expected_version="${metadata#*$'\n'}"
require_sha "$expected_sha"
[[ -f "$release/apps/server/dist/bin.mjs" ]] || fail "Active release does not contain the server entrypoint."

endpoint="http://${MINI_FORK_ALPHA_HOST}:8446/.well-known/t3/environment"
descriptor_path="$MINI_FORK_ALPHA_ROOT/state/descriptor.$$.json"
cleanup_descriptor() {
  /bin/rm -f "$descriptor_path"
}
trap cleanup_descriptor EXIT INT TERM

integer attempt=1
while (( attempt <= 30 )); do
  if port_is_owned_by_release "$release" &&
    "$MINI_FORK_ALPHA_CURL" --fail --silent --show-error --connect-timeout 2 --max-time 4 "$endpoint" > "$descriptor_path" 2>/dev/null; then
    if "$MINI_FORK_ALPHA_PYTHON" - "$descriptor_path" "$expected_version" <<'PYTHON'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    descriptor = json.load(handle)
expected_version = sys.argv[2]
required = ("environmentId", "label", "platform", "serverVersion", "capabilities")
if any(key not in descriptor for key in required):
    raise SystemExit(1)
if descriptor["serverVersion"] != expected_version:
    raise SystemExit(1)
if not isinstance(descriptor["environmentId"], str) or not descriptor["environmentId"].strip():
    raise SystemExit(1)
if not isinstance(descriptor["label"], str) or not descriptor["label"].strip():
    raise SystemExit(1)
PYTHON
    then
      log "validate passed sha=$expected_sha server_version=$expected_version"
      print -r -- "validated sha=$expected_sha server_version=$expected_version"
      exit 0
    fi
  fi
  /bin/sleep 1
  (( attempt++ ))
done

fail "Descriptor validation failed after 30 seconds."
