#!/bin/zsh
# Static eligibility check. It intentionally performs no network, SSH, Tailscale, or Mini operation.

set -euo pipefail

ops_root="${0:A:h:h}"
repo_root="${ops_root:h:h}"
required_scripts=(
  lib.zsh
  poll.zsh
  reconcile.zsh
  stage.zsh
  validate.zsh
  promote.zsh
  rollback.zsh
  run-server.zsh
  ci-verify.zsh
)

[[ "$(<"$ops_root/VERSION")" == <-> ]] || {
  print -u2 -r -- "Mini ops VERSION must be a positive integer."
  exit 1
}

for script in $required_scripts; do
  script_path="$ops_root/scripts/$script"
  [[ -f "$script_path" && -x "$script_path" ]] || {
    print -u2 -r -- "Missing executable script: $script_path"
    exit 1
  }
  /usr/bin/env zsh -n "$script_path"
done
/usr/bin/env zsh -n "$ops_root/config.example.zsh"
test_path="$ops_root/tests/sha-eligibility.test.zsh"
[[ -f "$test_path" && -x "$test_path" ]] || {
  print -u2 -r -- "Missing executable SHA eligibility test."
  exit 1
}
/usr/bin/env zsh -n "$test_path"
/usr/bin/env zsh "$test_path"

[[ -f "$ops_root/config.example.zsh" ]] || exit 1
if /usr/bin/grep -Eq '(^|_)(TOKEN|SECRET|PASSWORD|PRIVATE_KEY)=' "$ops_root/config.example.zsh"; then
  print -u2 -r -- "The checked-in config example must not contain secret settings."
  exit 1
fi
/usr/bin/grep -qx 'MINI_FORK_ALPHA_PORT="8446"' "$ops_root/config.example.zsh"
/usr/bin/grep -qx 'MINI_FORK_ALPHA_HOST="127.0.0.1"' "$ops_root/config.example.zsh"
/usr/bin/grep -qx 'MINI_FORK_ALPHA_ELIGIBLE_REF="refs/heads/mini-fork-alpha/eligible"' "$ops_root/config.example.zsh"
/usr/bin/grep -qx 'MINI_FORK_ALPHA_ELIGIBILITY_ALLOWED_SIGNERS_PATH="/Users/REPLACE_ME/.config/t3code-fork-alpha/eligibility-allowed-signers"' "$ops_root/config.example.zsh"
/usr/bin/grep -qx 'MINI_FORK_ALPHA_SSH_KEYGEN_BIN="/usr/bin/ssh-keygen"' "$ops_root/config.example.zsh"
/usr/bin/grep -qx 'MINI_FORK_ALPHA_SERVER_PLIST_PATH="/Users/REPLACE_ME/Library/LaunchAgents/com.mimen.t3code.fork-alpha.plist"' "$ops_root/config.example.zsh"

/usr/bin/python3 - "$ops_root" <<'PYTHON'
from pathlib import Path
from xml.etree import ElementTree
import plistlib
import sys

ops_root = Path(sys.argv[1])
replacements = {
    "__OPS_ROOT__": "/Users/mini/Library/Application Support/t3code-fork-alpha/ops/mini-fork-alpha",
    "__CONFIG_PATH__": "/Users/mini/.config/t3code-fork-alpha/config.zsh",
    "__ROOT__": "/Users/mini/Library/Application Support/t3code-fork-alpha",
    "__LOG_DIR__": "/Users/mini/Library/Logs/t3code-fork-alpha",
    "__POLL_INTERVAL_SECONDS__": "300",
}
templates = {
    "com.mimen.t3code-fork-alpha.server.plist.template": [
        "com.mimen.t3code.fork-alpha",
        "__OPS_ROOT__/scripts/run-server.zsh",
        "__CONFIG_PATH__",
        "__ROOT__",
        "__LOG_DIR__/launchd-server.stdout.log",
        "__LOG_DIR__/launchd-server.stderr.log",
    ],
    "com.mimen.t3code-fork-alpha.poll.plist.template": [
        "com.mimen.t3code.fork-alpha.poll",
        "__OPS_ROOT__/scripts/reconcile.zsh",
        "__CONFIG_PATH__",
        "__POLL_INTERVAL_SECONDS__",
        "__LOG_DIR__/launchd-poll.stdout.log",
        "__LOG_DIR__/launchd-poll.stderr.log",
    ],
}
for filename, expected in templates.items():
    template_path = ops_root / "launchagents" / filename
    root = ElementTree.parse(template_path).getroot()
    values = [element.text for element in root.iter() if element.text]
    missing = [value for value in expected if value not in values]
    if missing:
        raise SystemExit(f"{filename} is missing {missing!r}")
    rendered = template_path.read_text(encoding="utf-8")
    for placeholder, value in replacements.items():
        rendered = rendered.replace(placeholder, value)
    if "__" in rendered:
        raise SystemExit(f"{filename} contains an unreplaced template placeholder")
    plistlib.loads(rendered.encode("utf-8"))
PYTHON

# The staged checkout is self-contained; it must not depend on the mutable mirror's object store.
/usr/bin/grep -qx '"$MINI_FORK_ALPHA_GIT" clone --no-checkout --no-local "$mirror" "$temporary_release" >/dev/null 2>&1 || fail "Could not create staging checkout."' "$ops_root/scripts/stage.zsh"
/usr/bin/grep -qF 'os.replace(sys.argv[1], sys.argv[2])' "$ops_root/scripts/lib.zsh"
/usr/bin/grep -qx 'verify_polled_candidate_sha "$sha"' "$ops_root/scripts/stage.zsh"
/usr/bin/grep -qx '  configure_build_path' "$ops_root/scripts/stage.zsh"
/usr/bin/grep -qF 'configure_build_path()' "$ops_root/scripts/lib.zsh"
/usr/bin/grep -qF 'export PATH="$node_dir:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"' "$ops_root/scripts/lib.zsh"
/usr/bin/grep -qx 'verify_polled_candidate_sha "$candidate_sha"' "$ops_root/scripts/promote.zsh"
/usr/bin/grep -qF 'fetch_eligibility_refs()' "$ops_root/scripts/lib.zsh"
/usr/bin/grep -qF 'fetch_and_record_eligible_candidate()' "$ops_root/scripts/lib.zsh"
/usr/bin/grep -qF 'fetch_eligibility_refs' "$ops_root/scripts/lib.zsh"
/usr/bin/grep -qF 'verify_eligibility_attestation()' "$ops_root/scripts/lib.zsh"
/usr/bin/grep -qF 'canonical_eligibility_payload' "$ops_root/scripts/lib.zsh"
/usr/bin/grep -qF 'ssh-keygen binary is not executable.' "$ops_root/scripts/lib.zsh"
/usr/bin/grep -qx 'sha="$(fetch_and_record_eligible_candidate)"' "$ops_root/scripts/poll.zsh"
/usr/bin/grep -qx '"$script_dir/stage.zsh" --config "$config_path" --sha "$candidate_sha" >/dev/null' "$ops_root/scripts/reconcile.zsh"
/usr/bin/grep -qx '"$script_dir/promote.zsh" --config "$config_path" --sha "$candidate_sha"' "$ops_root/scripts/reconcile.zsh"
/usr/bin/grep -qF 'launch_agent_pid()' "$ops_root/scripts/lib.zsh"
/usr/bin/grep -qF '[[ "$pid" == "$service_pid" ]] || return 1' "$ops_root/scripts/lib.zsh"
/usr/bin/grep -qF 'process_has_open_path "$pid" cwd "$canonical_release"' "$ops_root/scripts/lib.zsh"
/usr/bin/grep -qF 'process_has_open_path "$pid" txt "$canonical_node"' "$ops_root/scripts/lib.zsh"
if /usr/bin/sed -n '/^assert_port_is_owned_by_releases()/,/^}/p' "$ops_root/scripts/lib.zsh" | /usr/bin/grep -q '/bin/ps'; then
  print -u2 -r -- "Port ownership must not trust process command-line arguments."
  exit 1
fi
/usr/bin/grep -qF 'quiesce_managed_release()' "$ops_root/scripts/lib.zsh"
/usr/bin/grep -qx '  quiesce_managed_release "$candidate"' "$ops_root/scripts/promote.zsh"

/usr/bin/python3 - "$ops_root" <<'PYTHON'
from pathlib import Path
import sys

ops_root = Path(sys.argv[1])
promote = (ops_root / "scripts" / "promote.zsh").read_text(encoding="utf-8")
restore_start = promote.index("restore_after_failed_promotion()")
restore_end = promote.index("\n}\n\nif [[ -n", restore_start)
restore_body = promote[restore_start:restore_end]
if restore_body.index('quiesce_managed_release "$candidate"') > restore_body.index('replace_symlink "$current_link" "$old_current"'):
    raise SystemExit("Failed candidate must quiesce before restoring pointers")

validate = (ops_root / "scripts" / "validate.zsh").read_text(encoding="utf-8")
if validate.index('port_is_owned_by_release "$release"') < validate.index("while (( attempt <= 30 )); do"):
    raise SystemExit("Validation must retry port ownership during its startup window")

stage = (ops_root / "scripts" / "stage.zsh").read_text(encoding="utf-8")
if stage.index("trap release_lock EXIT") > stage.index('verify_polled_candidate_sha "$sha"'):
    raise SystemExit("Stage must retain its lock before candidate verification")
if stage.index("trap release_lock EXIT") > stage.index('if [[ -e "$release" ]]; then'):
    raise SystemExit("Stage must retain its lock before immutable-release reuse")

lib = (ops_root / "scripts" / "lib.zsh").read_text(encoding="utf-8")
verify_start = lib.index("verify_polled_candidate_sha()")
verify_end = lib.index("\n}\n\nrelease_path()", verify_start)
if "fetch_eligibility_refs" not in lib[verify_start:verify_end]:
    raise SystemExit("Stage and promotion verification must refresh remote eligibility refs")
PYTHON

# Mutating operations retain their lock until process exit; stale owner metadata is recovered safely.
for operation in poll promote rollback; do
  /usr/bin/grep -qx 'trap release_lock EXIT' "$ops_root/scripts/$operation.zsh"
done
/usr/bin/grep -qF 'lock_process_start()' "$ops_root/scripts/lib.zsh"
/usr/bin/grep -qF 'print(int(os.stat(sys.argv[1]).st_mtime))' "$ops_root/scripts/lib.zsh"
/usr/bin/grep -qF 'remove_stale_lock()' "$ops_root/scripts/lib.zsh"
if /usr/bin/grep -qF '/usr/bin/stat -f' "$ops_root/scripts/lib.zsh"; then
  print -u2 -r -- "Lock aging must not depend on BSD stat."
  exit 1
fi
/usr/bin/grep -qF 'quiesce_managed_release "$candidate"' "$ops_root/scripts/promote.zsh"

# The pinned workflow signs only after verification; Mini trusts its pinned public signer, not ref integrity.
/usr/bin/grep -qx 'permissions:' "$repo_root/.github/workflows/mini-fork-alpha-eligibility.yml"
/usr/bin/grep -qx '  contents: read' "$repo_root/.github/workflows/mini-fork-alpha-eligibility.yml"
/usr/bin/grep -qx '  publish_eligible_ref:' "$repo_root/.github/workflows/mini-fork-alpha-eligibility.yml"
/usr/bin/grep -qx "    if: github.event_name == 'push' && github.ref == 'refs/heads/main'" "$repo_root/.github/workflows/mini-fork-alpha-eligibility.yml"
/usr/bin/grep -qx '      GITHUB_TOKEN: ${{ github.token }}' "$repo_root/.github/workflows/mini-fork-alpha-eligibility.yml"
/usr/bin/grep -qx '      MINI_ELIGIBILITY_SIGNING_KEY: ${{ secrets.MINI_ELIGIBILITY_SIGNING_KEY }}' "$repo_root/.github/workflows/mini-fork-alpha-eligibility.yml"
/usr/bin/grep -qx '      contents: write' "$repo_root/.github/workflows/mini-fork-alpha-eligibility.yml"
/usr/bin/grep -qx '    needs: verify' "$repo_root/.github/workflows/mini-fork-alpha-eligibility.yml"
/usr/bin/grep -qFx '          if [[ -z "${MINI_ELIGIBILITY_SIGNING_KEY:-}" ]]; then' "$repo_root/.github/workflows/mini-fork-alpha-eligibility.yml"
/usr/bin/grep -qFx '          [[ "$signer_public_key" == ssh-ed25519\ * ]] || {' "$repo_root/.github/workflows/mini-fork-alpha-eligibility.yml"
/usr/bin/grep -qFx '          if [[ "$current_main_sha" != "$GITHUB_SHA" ]]; then' "$repo_root/.github/workflows/mini-fork-alpha-eligibility.yml"
/usr/bin/grep -qx '          ssh-keygen -Y sign -f "$signing_key" -n mini-fork-alpha-eligibility "$payload_path" >/dev/null' "$repo_root/.github/workflows/mini-fork-alpha-eligibility.yml"
/usr/bin/grep -qx '          git -C "$publish_dir" push --force origin HEAD:refs/heads/mini-fork-alpha/eligible' "$repo_root/.github/workflows/mini-fork-alpha-eligibility.yml"
/usr/bin/grep -qx '        uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6' "$repo_root/.github/workflows/mini-fork-alpha-eligibility.yml"
/usr/bin/grep -qx 'export T3CODE_PORT="8446"' "$ops_root/scripts/run-server.zsh"
/usr/bin/grep -qx 'export T3CODE_TAILSCALE_SERVE="false"' "$ops_root/scripts/run-server.zsh"
/usr/bin/grep -qx '  --port 8446 \\' "$ops_root/scripts/run-server.zsh"
/usr/bin/grep -qF '## Required eligibility signing setup' "$ops_root/README.md"
/usr/bin/grep -qF 'MINI_ELIGIBILITY_SIGNING_KEY' "$ops_root/README.md"
/usr/bin/grep -qF 'MINI_FORK_ALPHA_ELIGIBILITY_ALLOWED_SIGNERS_PATH' "$ops_root/README.md"
/usr/bin/grep -qF 'The eligibility ref need not be protected' "$ops_root/README.md"

print -r -- "Mini Fork Alpha deployment eligibility checks passed."
