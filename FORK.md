---
upstream: pingdotgg/t3code
sync_tags: v*-nightly.*
check: scripts/fork/check.sh
release: scripts/fork/release.sh
---

# T3 Code fork

Milad's fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code), rebuilt from upstream `v0.0.46-nightly.20261010.2908` on 2026-10-10. The pre-reset fork is archived on the `archive/fork-pre-reset-2026-10-10` branch.

Releases are built from `main` on the Mac Mini; installed fork apps pick them up through the in-app update button. The desktop app ships as "T3 Code (Fork)": its own bundle id, profile, `~/.t3-fork` state directory, and update feed (prereleases on mimen/t3code, built and signed on the Mac Mini by `scripts/fork/release.sh`). The nightly hub Updates job merges each new upstream nightly tag and releases. Rules for changing anything here: the `fork` skill.

| Path | Why |
|---|---|
| `AGENTS.md` | fork block at the top |
| `apps/desktop/src/app/DesktopStatePaths.ts` | default state directory from `FORK_IDENTITY` |
| `apps/desktop/src/app/DesktopUserData.ts` | Electron profile directory from `FORK_IDENTITY` |
| `apps/desktop/src/app/DesktopEnvironment.ts` | packaged app display name from `FORK_IDENTITY` |
| `apps/desktop/src/app/DesktopEnvironment.test.ts` | expects the fork's paths and name |
| `apps/desktop/src/app/DesktopUserData.test.ts` | expects the fork's profile directory |
| `scripts/build-desktop-artifact.ts` | bundle id and nightly product name from `FORK_IDENTITY` |
| `scripts/build-desktop-artifact.test.ts` | expects the fork's product name and bundle id |
| `apps/desktop/src/app/DesktopAppIdentity.test.ts` | expects the fork's profile and name |
| `apps/desktop/src/app/DesktopClerk.test.ts` | expects the fork's profile directory |
| `apps/desktop/src/app/DesktopEarlyElectronStartup.test.ts` | expects the fork's state directory |
| `apps/desktop/src/app/DesktopPreReadyFileSystem.test.ts` | expects the fork's profile directory |
| `apps/desktop/src/window/DesktopApplicationMenu.test.ts` | expects the fork's name in the menu |
