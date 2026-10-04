---
deployment_status: partial
deployment_last_assessed: 2026-10-03
deployment_targets:
  - component: apps/server (t3)
    where: mac-mini
    detail: Fork Alpha server under immutable releases; launchd com.mimen.t3code.fork-alpha on loopback port 8446
  - component: apps/web (@t3tools/web)
    where: mac-mini
    detail: Built browser client served by the Fork Alpha server on port 8446
  - component: ops/mini-fork-alpha
    where: mac-mini
    detail: Installed run-server.zsh and external config; reconcile poll LaunchAgent is disabled
---

# T3 fork deployment

This file records the fork's deployed components, not upstream T3 releases. The Mini runs the fork server under `~/Library/Application Support/t3code-fork-alpha/current`, pointing to an immutable release. `ops/mini-fork-alpha/README.md` documents staging, promotion, validation, and rollback. The server binds to `127.0.0.1:8446` and serves the built web client.

The installed `com.mimen.t3code.fork-alpha` LaunchAgent invokes `run-server.zsh` with an external config. The companion poll plist is disabled. The documented automatic update chain requires a signed eligibility artifact before reconciliation can stage and promote a commit.

The repository inherits npm, Vercel, Cloudflare, Electron, and EAS release configuration from upstream. No fork GitHub releases or successful recent relay deployments were found during this assessment. The Nightly apps installed on the fleet come from upstream and are not evidence that this fork ships through those channels.
