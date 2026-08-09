#!/bin/zsh
# Static safety checks for the non-secret claude-gpt Mini operation.

set -euo pipefail

ops_root="${0:A:h:h}"
repo_root="${ops_root:h:h}"
wrapper="$ops_root/scripts/configure-claude-gpt.zsh"
cli="$repo_root/apps/server/src/cli/mini.ts"
provider="$repo_root/apps/server/src/miniOps/claudeGptProvider.ts"
adapter="$repo_root/apps/server/src/provider/Layers/ClaudeAdapter.ts"
probe="$repo_root/apps/server/src/provider/Layers/ClaudeProvider.ts"
text_generation="$repo_root/apps/server/src/textGeneration/ClaudeTextGeneration.ts"
integrity="$repo_root/apps/server/src/provider/Drivers/ClaudeBinaryIntegrity.ts"
config_example="$ops_root/config.example.zsh"

[[ -x "$wrapper" ]] || {
  print -u2 -r -- "claude-gpt operation wrapper must be executable."
  exit 1
}
/usr/bin/env zsh -n "$wrapper"
/usr/bin/grep -qx 'MINI_FORK_STAGING_CLAUDE_CLI_PATH="/Users/REPLACE_ME/.local/bin/claude"' "$config_example"
/usr/bin/grep -qx 'MINI_FORK_STAGING_CLAUDE_CLI_SHA256="REPLACE_WITH_64_LOWERCASE_HEX_CHARACTERS"' "$config_example"
if /usr/bin/grep -qF 'MINI_FORK_STAGING_CLAUDE_GPT_CLI_PATH=' "$config_example"; then
  print -u2 -r -- "Mini config must point to the actual Claude CLI, not claude-gpt."
  exit 1
fi

/usr/bin/grep -qFx '  --gateway-key-fd 0' "$wrapper"
/usr/bin/grep -qF '"$MINI_FORK_STAGING_NODE_BIN" "$release/apps/server/dist/bin.mjs" mini configure-claude-gpt' "$wrapper"
/usr/bin/grep -qF 'release_for_link "$MINI_FORK_STAGING_ROOT/current"' "$wrapper"
/usr/bin/grep -qF 'acquire_lock' "$wrapper"
/usr/bin/grep -qF 'quiesce_managed_release "$release"' "$wrapper"
/usr/bin/grep -qF 'restart_server_if_needed' "$wrapper"
/usr/bin/grep -qF 'canonical_path "$MINI_FORK_STAGING_CLAUDE_CLI_PATH"' "$wrapper"
/usr/bin/grep -qF '/usr/bin/shasum -a 256 "$canonical_claude_cli_path"' "$wrapper"
/usr/bin/grep -qF 'MINI_FORK_STAGING_CLAUDE_CLI_SHA256' "$wrapper"
/usr/bin/grep -qF -- '--base-dir "$MINI_FORK_STAGING_DATA_DIR"' "$wrapper"
/usr/bin/grep -qF -- '--claude-cli-path "$canonical_claude_cli_path"' "$wrapper"
/usr/bin/grep -qF -- '--claude-cli-sha256 "$MINI_FORK_STAGING_CLAUDE_CLI_SHA256"' "$wrapper"
/usr/bin/grep -qF -- '--claude-home-path "$MINI_FORK_STAGING_CLAUDE_GPT_HOME_PATH"' "$wrapper"
if /usr/bin/grep -Eq -- '--gateway-key($|[[:space:]])|ANTHROPIC_AUTH_TOKEN|gatewayKey=' "$wrapper"; then
  print -u2 -r -- "claude-gpt wrapper must accept the key only through fd 0."
  exit 1
fi

/usr/bin/grep -qF 'ServerSettings.layer' "$cli"
/usr/bin/grep -qF 'ServerSecretStore.layer' "$cli"
/usr/bin/grep -qF 'GATEWAY_KEY_FD_TIMEOUT_MS = 30_000' "$cli"
/usr/bin/grep -qF 'timeoutMs: GATEWAY_KEY_FD_TIMEOUT_MS' "$cli"
/usr/bin/grep -qF 'isForbiddenClaudeGptWrapperPath' "$cli"
/usr/bin/grep -qF 'claude-cli-sha256' "$cli"
/usr/bin/grep -qF 'configureClaudeGptProvider' "$cli"
/usr/bin/grep -qF 'ServerSettingsService' "$provider"
/usr/bin/grep -qF 'isForbiddenClaudeGptWrapperPath' "$provider"
/usr/bin/grep -qF 'serverSettings.updateSettings' "$provider"
/usr/bin/grep -qF 'binarySha256' "$provider"
/usr/bin/grep -qF 'verifyClaudeBinaryIntegrity' "$adapter"
/usr/bin/grep -qF 'verifyClaudeBinaryIntegrity' "$probe"
/usr/bin/grep -qF 'verifyClaudeBinaryIntegrity' "$text_generation"
/usr/bin/grep -qF 'createHash("sha256")' "$integrity"
/usr/bin/grep -qF 'claude-gpt provider requires a pinned Claude CLI SHA-256' "$integrity"
/usr/bin/grep -qF 'http://127.0.0.1:8317' "$provider"
/usr/bin/grep -qF 'iconKey: "openai"' "$provider"
for model in gpt-5.6-sol gpt-5.6-terra gpt-5.6-luna gpt-5.5; do
  /usr/bin/grep -qF -- "$model" "$provider"
done

print -r -- "Mini claude-gpt provider static checks passed."
