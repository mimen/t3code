# Mini Fork Alpha operations

Versioned, non-secret deployment operations for the Mini-local Fork Alpha server. This subtree is
an operational contract, not an installer: it never embeds credentials, contacts the Mini from CI,
or configures Tailscale.

## Runtime layout

The external config supplies absolute paths. The recommended layout below keeps mutable state out of
versioned releases:

```text
/Users/<mini-user>/Library/Application Support/t3code-fork-alpha/
  mirror.git/                 # local fetch mirror
  releases/<40-char-sha>/     # immutable staged checkouts
  current -> releases/<sha>   # active release
  previous -> releases/<sha>  # rollback target
  state/                      # lock and candidate SHA
  data/                       # T3CODE_HOME; persists across releases
/Users/<mini-user>/Library/Logs/t3code-fork-alpha/
```

Copy [`config.example.zsh`](./config.example.zsh) to an absolute path outside the checkout, replace
all placeholders, including `MINI_FORK_ALPHA_SERVER_PLIST_PATH` pointing to the rendered installed
server plist and the fixed `MINI_FORK_ALPHA_ELIGIBLE_REF`, and pass that path explicitly to every
script. Keep a repository URL without an embedded token; Git credential handling remains local to the
Mini user.

The wrapper binds only the configured fixed port, which is required to be `8446`. It rejects wildcard
hosts, disables Tailscale Serve, and launches with an explicit `T3CODE_HOME` so the environment ID,
pairing state, and other mutable state survive release swaps.

## Lifecycle

All lifecycle commands require an absolute config path and fail rather than guessing paths or
versions:

```zsh
ops/mini-fork-alpha/scripts/poll.zsh --config /absolute/path/config.zsh
ops/mini-fork-alpha/scripts/reconcile.zsh --config /absolute/path/config.zsh
ops/mini-fork-alpha/scripts/stage.zsh --config /absolute/path/config.zsh --sha <candidate-sha>
ops/mini-fork-alpha/scripts/promote.zsh --config /absolute/path/config.zsh --sha <staged-sha>
ops/mini-fork-alpha/scripts/rollback.zsh --config /absolute/path/config.zsh
```

The GitHub eligibility workflow publishes the fixed non-secret
`refs/heads/mini-fork-alpha/eligible` ref only after `ci-verify.zsh` succeeds for the exact `main` SHA.
It signs a canonical payload with an SSH Ed25519 private signing key supplied only to the publish job as
the `MINI_ELIGIBILITY_SIGNING_KEY` GitHub Actions secret. The unprotected eligibility ref carries only
the signed payload and detached signature; its Git integrity is intentionally irrelevant. Mini keeps its
separate read-only deploy key, reads a pinned allowed-signers public-key file outside the repository and
all releases, and verifies the signature, namespace, identity, canonical payload, and current `main` SHA
before recording a candidate. Neither side uses a GitHub API token or PAT. Missing, stale, malformed, or
invalidly signed eligibility artifacts fail closed.

`reconcile.zsh` is the scheduled entrypoint. It polls, no-ops when that eligible SHA is already healthy,
or stages and promotes the eligible SHA. `stage.zsh` and `promote.zsh` independently re-check that the
candidate, `origin/main`, and eligibility ref still match, so a ref change between lifecycle steps fails
closed. Staging builds the commit, writes `release.json` with the SHA and server version, then makes the
release read-only. Staging builds under an explicit minimal PATH that prepends the directory of the
configured `MINI_FORK_ALPHA_NODE_BIN`, so the configured Vite+ launcher never depends on launchd's
ambient PATH. `promote.zsh` atomically moves `current` and
`previous`, performs one launchd restart, and validates the active server. If descriptor validation
fails, it first unloads and quiesces the failed candidate while its SHA is still the active pointer,
then restores the previous symlink pair and restarts the previous release. An initial failed promotion
removes `current` only after the LaunchAgent and port have quiesced; otherwise it retains
state and reports the manual-recovery failure. A later promotion bootstraps the configured server plist
if an earlier failure unloaded it. `rollback.zsh` swaps the two immutable symlinks and applies the same
restart and validation rule.

Only one operation can run because every mutating command acquires an atomic directory lock. The lock
records its PID and process start time. A later operation automatically recovers it only after the
owner is dead or its PID has been reused, and only after a 30-second initialization grace period.
Unexpected lock contents still fail closed for manual inspection. Operational logs record only SHA,
version, and operation state. Command output is suppressed and log text is redacted before it reaches
`ops.log`.

## Validation

There is intentionally no bespoke readiness API in this phase. After launchd restarts the server,
[`validate.zsh`](./scripts/validate.zsh) retries both listener ownership and descriptor retrieval for
30 seconds, then reads the existing
`/.well-known/t3/environment` descriptor from port `8446`. It accepts the release only when the
returned `serverVersion` equals the immutable release metadata and the descriptor includes its normal
environment identity fields. Before reading the descriptor, validation confirms the port listener's
actual working directory and Node executable through `lsof`, and verifies that the listener PID is the
one owned by the configured LaunchAgent. This matches the exact immutable release rather than trusting
command-line text.

## LaunchAgents

The two templates in [`launchagents`](./launchagents) are user LaunchAgents:

- `com.mimen.t3code-fork-alpha.server.plist.template` keeps the active release running.
- `com.mimen.t3code-fork-alpha.poll.plist.template` invokes `reconcile.zsh`: eligible SHA polling,
  idempotent health no-op, staging, and promotion.

Before installing either template, replace `__OPS_ROOT__`, `__CONFIG_PATH__`, `__ROOT__`,
`__LOG_DIR__`, and (for the poll template) `__POLL_INTERVAL_SECONDS__` with absolute config values.
Validate the rendered plist with `plutil -lint`, install it in the Mini user's `~/Library/LaunchAgents`,
and load it in that same user's `gui/<uid>` launchd domain. The scheduled reconciliation path never
uses a GitHub API credential or arbitrary Git ref: it proceeds only after the fixed eligibility ref and
`origin/main` name the same commit.

## Required eligibility signing setup

Before enabling the scheduler, complete these external prerequisites. Do not generate keys or set
secrets from repository automation.

1. Create one SSH Ed25519 signing keypair dedicated solely to Mini eligibility attestations.
2. Add its private half as the GitHub Actions secret `MINI_ELIGIBILITY_SIGNING_KEY`. The publish job
   writes it to a mode-`0600` runner-temp file, signs only the canonical four-line payload with
   `ssh-keygen -Y sign`, cleans it on exit, and emits no key material. A missing secret is a hard job
   failure; no new attestation is published.
3. On Mini, create an allowed-signers file outside the repository and versioned releases, then set
   `MINI_FORK_ALPHA_ELIGIBILITY_ALLOWED_SIGNERS_PATH` to its absolute path. It must contain exactly one
   line in this form, substituting the signing public key:

   ```text
   mini-fork-alpha-eligibility namespaces="mini-fork-alpha-eligibility" ssh-ed25519 <base64-public-key>
   ```

   The configuration rejects missing, malformed, multi-signer, wrong-identity, or wrong-namespace files.
   The Mini public key source must never be `main`, the eligibility ref, or a staged release.

The eligibility ref need not be protected: a direct writer may replace its commit, payload, or signature,
but cannot make Mini accept a SHA without the externally pinned signing key.

## CI eligibility gate

[`.github/workflows/mini-fork-alpha-eligibility.yml`](../../.github/workflows/mini-fork-alpha-eligibility.yml)
runs for pushes to `main`, relevant pull requests, or manual dispatch. It invokes `ci-verify.zsh`,
which syntax-checks all Zsh scripts, exercises stale-lock and SHA-eligibility regressions in isolated
temporary Git repositories, parses both plist templates, checks the non-secret config shape, and
confirms the sole server listener is port `8446`. After a successful `main` verification, its separate
publish job signs and publishes the canonical eligibility artifact with the configured signing secret.
It contains no Mini, Tailnet, GitHub API-token, or third-party action operation.
