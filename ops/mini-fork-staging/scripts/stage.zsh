#!/bin/zsh
# Build an immutable release from one exact, previously fetched commit.

set -euo pipefail
source "${0:A:h}/lib.zsh"

[[ "$#" -eq 4 && "$1" == "--config" && "$3" == "--sha" ]] || fail "Usage: $0 --config /absolute/path/to/config.zsh --sha <40-character-sha>"
config_path="$2"
sha="$4"
parse_config_argument --config "$config_path"
require_sha "$sha"
acquire_lock
trap release_lock EXIT
trap 'release_lock; exit 130' INT TERM

verify_polled_candidate_sha "$sha"
mirror="$MINI_FORK_STAGING_ROOT/mirror.git"

release="$(release_path "$sha")"
release_is_immutable() {
  [[ -z "$(/usr/bin/find "$release" -perm -u+w -print -quit)" ]]
}

assert_release_immutable() {
  release_is_immutable || fail "Existing release is mutable; remove it manually before retrying."
}

if [[ -e "$release" ]]; then
  [[ -d "$release" ]] || fail "Release path exists but is not a directory."
  metadata="$(release_metadata "$release")"
  [[ "${metadata%%$'\n'*}" == "$sha" ]] || fail "Existing release metadata does not match its path."
  assert_release_immutable
  log "stage reused immutable sha=$sha"
  print -r -- "$release"
  exit 0
fi

temporary_release="$MINI_FORK_STAGING_ROOT/releases/.${sha}.staging.$$"
cleanup_staging() {
  [[ -d "$temporary_release" ]] && /bin/rm -rf "$temporary_release"
  release_lock
}
trap cleanup_staging EXIT
trap 'cleanup_staging; exit 130' INT TERM

"$MINI_FORK_STAGING_GIT" clone --no-checkout --no-local "$mirror" "$temporary_release" >/dev/null 2>&1 || fail "Could not create staging checkout."
(
  cd "$temporary_release"
  "$MINI_FORK_STAGING_GIT" checkout --detach "$sha" >/dev/null 2>&1 || exit 1
  actual_sha="$("$MINI_FORK_STAGING_GIT" rev-parse HEAD)"
  [[ "$actual_sha" == "$sha" ]] || exit 1
  configure_build_path
  "$MINI_FORK_STAGING_VP_BIN" install --frozen-lockfile >/dev/null 2>&1 || exit 1
  project_vp="$temporary_release/node_modules/.bin/vp"
  [[ -x "$project_vp" ]] || exit 1
  "$project_vp" run --filter @t3tools/web build >/dev/null 2>&1 || exit 1
  "$project_vp" run --filter t3 build >/dev/null 2>&1 || exit 1
) || fail "Staged build failed."

server_version="$("$MINI_FORK_STAGING_PYTHON" - "$temporary_release/apps/server/package.json" <<'PYTHON'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    version = json.load(handle).get("version")
if not isinstance(version, str) or not version.strip():
    raise SystemExit(1)
print(version)
PYTHON
)" || fail "Could not read staged server version."

"$MINI_FORK_STAGING_PYTHON" - "$temporary_release/release.json" "$sha" "$server_version" "$MINI_FORK_STAGING_OPS_VERSION" <<'PYTHON'
import json
import sys
from datetime import datetime, timezone

payload = {
    "schemaVersion": 1,
    "sha": sys.argv[2],
    "serverVersion": sys.argv[3],
    "opsVersion": sys.argv[4],
    "stagedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
}
with open(sys.argv[1], "w", encoding="utf-8") as handle:
    json.dump(payload, handle, sort_keys=True, separators=(",", ":"))
    handle.write("\n")
PYTHON

# The final rename must happen while the staging directory is writable. Only then freeze it.
/bin/mv "$temporary_release" "$release" || fail "Could not atomically promote the staged release."
if ! /bin/chmod -R a-w "$release" || ! release_is_immutable; then
  # A partial chmod can leave a mutable or unremovable tree. Try to restore ownership only
  # for deletion; if that fails, the next stage refuses this non-immutable release.
  /bin/chmod -R u+w "$release" 2>/dev/null || true
  /bin/rm -rf "$release" 2>/dev/null || true
  fail "Could not make the promoted release immutable."
fi
trap - EXIT INT TERM
release_lock
log "stage completed sha=$sha server_version=$server_version ops_version=$MINI_FORK_STAGING_OPS_VERSION"
print -r -- "$release"
