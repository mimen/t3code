# Copy this file outside the repository, restrict it to the Mini user, then pass its
# absolute path to every script with --config. This file deliberately contains no secrets.
#
# Do not use $HOME, ~, relative paths, or shell substitutions in these values.

MINI_FORK_STAGING_ROOT="/Users/REPLACE_ME/Library/Application Support/t3code-fork-staging"
MINI_FORK_STAGING_REPOSITORY_URL="git@github.com:REPLACE_ME/t3code.git"
MINI_FORK_STAGING_DATA_DIR="/Users/REPLACE_ME/Library/Application Support/t3code-fork-staging/data"
MINI_FORK_STAGING_LOG_DIR="/Users/REPLACE_ME/Library/Logs/t3code-fork-staging"
MINI_FORK_STAGING_HOST="127.0.0.1"
MINI_FORK_STAGING_PORT="8447"
MINI_FORK_STAGING_LAUNCH_AGENT_LABEL="com.mimen.t3code.fork-staging"
MINI_FORK_STAGING_ELIGIBLE_REF="refs/heads/mini-fork-staging/eligible"
MINI_FORK_STAGING_ELIGIBILITY_ALLOWED_SIGNERS_PATH="/Users/REPLACE_ME/.config/t3code-fork-staging/eligibility-allowed-signers"
MINI_FORK_STAGING_SSH_KEYGEN_BIN="/usr/bin/ssh-keygen"
MINI_FORK_STAGING_SERVER_PLIST_PATH="/Users/REPLACE_ME/Library/LaunchAgents/com.mimen.t3code.fork-staging.plist"
MINI_FORK_STAGING_POLL_INTERVAL_SECONDS="300"
MINI_FORK_STAGING_NODE_BIN="/opt/homebrew/bin/node"
MINI_FORK_STAGING_VP_BIN="/opt/homebrew/bin/vp"
# Used only by scripts/configure-claude-gpt.zsh. Point to the actual Claude Code CLI,
# never a gateway wrapper. The home path becomes this instance's CLAUDE_CONFIG_DIR and
# must not be the regular Claude CLI configuration directory.
MINI_FORK_STAGING_CLAUDE_CLI_PATH="/Users/REPLACE_ME/.local/bin/claude"
# Pin the SHA-256 of the canonical executable at the path above; this is non-secret.
MINI_FORK_STAGING_CLAUDE_CLI_SHA256="REPLACE_WITH_64_LOWERCASE_HEX_CHARACTERS"
MINI_FORK_STAGING_CLAUDE_GPT_HOME_PATH="/Users/REPLACE_ME/.config/t3code-fork-staging/claude-gpt"
