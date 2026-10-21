---
upstream: pingdotgg/t3code
sync_tags: v*-nightly.*
check: scripts/fork/check.sh
release: scripts/fork/release.sh
---

# T3 Code fork

Milad's fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code), rebuilt from upstream `v0.0.46-nightly.20261010.2908` on 2026-10-10. The pre-reset fork is archived on the `archive/fork-pre-reset-2026-10-10` branch.

Releases are built from `main` on the Mac Mini; installed fork apps pick them up through the in-app update button. The desktop app ships as "T3 Code (Fork)": its own bundle id, profile, `~/.t3-fork` state directory, and update feed (prereleases on mimen/t3code, built and signed on the Mac Mini by `scripts/fork/release.sh`). The nightly hub Updates job merges each new upstream nightly tag and releases. Rules for changing anything here: the `fork` skill.

| Path                                                                      | Why                                                                                                                   |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                               | fork block at the top                                                                                                 |
| `apps/desktop/src/app/DesktopStatePaths.ts`                               | default state directory from `FORK_IDENTITY`                                                                          |
| `apps/desktop/src/app/DesktopUserData.ts`                                 | Electron profile directory from `FORK_IDENTITY`                                                                       |
| `apps/desktop/src/app/DesktopEnvironment.ts`                              | packaged app display name from `FORK_IDENTITY`                                                                        |
| `apps/desktop/src/app/DesktopEnvironment.test.ts`                         | expects the fork's paths and name                                                                                     |
| `apps/desktop/src/app/DesktopUserData.test.ts`                            | expects the fork's profile directory                                                                                  |
| `scripts/build-desktop-artifact.ts`                                       | bundle id and nightly product name from `FORK_IDENTITY`                                                               |
| `scripts/build-desktop-artifact.test.ts`                                  | expects the fork's bundle id                                                                                          |
| `apps/desktop/src/app/DesktopAppIdentity.test.ts`                         | expects the fork's profile and name                                                                                   |
| `apps/desktop/src/app/DesktopClerk.test.ts`                               | expects the fork's profile directory                                                                                  |
| `packages/shared/package.json`                                            | one-shot: `./forkOneShot` subpath export                                                                              |
| `apps/server/src/orchestration-v2/ProviderTurnStartService.ts`            | one-shot: prepends the hidden instruction to the provider text; device-sender: carried upstream #20112, drop on merge |
| `apps/server/src/server.ts`                                               | one-shot: starts `ForkOneShotSettleReactor`                                                                           |
| `packages/contracts/src/orchestratorMcp.ts`                               | one-shot: `settleWhenDone` on `create_threads` entries                                                                |
| `apps/server/src/mcp/OrchestratorMcpService.ts`                           | one-shot: `create_threads` attaches the record                                                                        |
| `apps/server/src/mcp/toolkits/project/tools.ts`                           | one-shot: `settleWhenDone` on `t3_thread_launch`                                                                      |
| `apps/server/src/mcp/toolkits/project/handlers.ts`                        | one-shot: `t3_thread_launch` attaches the record                                                                      |
| `apps/web/src/components/chat/ChatComposer.tsx`                           | one-shot: renders the draft toggle and its overflow menu item                                                         |
| `apps/web/src/components/chat/CompactComposerControlsMenu.tsx`            | one-shot: slot for the toggle's overflow menu item                                                                    |
| `apps/web/src/components/ChatView.tsx`                                    | one-shot: send path adds the record to a first message                                                                |
| `apps/server/src/auth/EnvironmentAuth.ts`                                 | device-sender: carried upstream #20112, drop on merge                                                                 |
| `apps/server/src/auth/utils.ts`                                           | device-sender: carried upstream #20112, drop on merge                                                                 |
| `apps/server/src/orchestration-v2/EffectWorker.ts`                        | device-sender: carried upstream #20112, drop on merge                                                                 |
| `apps/server/src/orchestration-v2/Orchestrator.ts`                        | device-sender: carried upstream #20112, drop on merge                                                                 |
| `apps/server/src/orchestration-v2/ProviderTurnControlService.ts`          | device-sender: carried upstream #20112, drop on merge                                                                 |
| `apps/server/src/orchestration-v2/SteeringCompletion.integration.test.ts` | device-sender: carried upstream #20112, drop on merge                                                                 |
| `apps/server/src/orchestration-v2/ThreadLaunchService.ts`                 | device-sender: carried upstream #20112, drop on merge                                                                 |
| `apps/server/src/orchestration-v2/ThreadManagementService.ts`             | device-sender: carried upstream #20112, drop on merge                                                                 |
| `apps/server/src/preview/ServerBrowserStream.test.ts`                     | device-sender: carried upstream #20112, drop on merge                                                                 |
| `apps/server/src/ws.ts`                                                   | device-sender: carried upstream #20112, drop on merge                                                                 |
| `apps/server/src/ws.test.ts`                                              | device-sender: carried upstream #20112, drop on merge                                                                 |
| `packages/contracts/src/orchestrationV2.ts`                               | device-sender: carried upstream #20112, drop on merge                                                                 |
| `packages/provider-core/src/server/runtimeInstructions.test.ts`           | device-sender: carried #20112 tests; upstream deleted the file                                                        |
| `packages/provider-core/src/server/runtimeInstructions.ts`                | device-sender: carried upstream #20112, drop on merge                                                                 |
| `packages/contracts/src/git.ts`                                           | git-paths: keeps leading and trailing spaces in file paths (268aa41971)                                               |
| `packages/contracts/src/git.test.ts`                                      | git-paths: expects whitespace-preserving paths                                                                        |
| `apps/web/src/components/auth/PairingRouteSurface.tsx`                    | pairing-hash: submits a pairing token that arrives by hashchange (dada3d110b)                                         |
