#!/usr/bin/env bash
# The gate every fork change and upstream sync must pass before landing.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
vp install
# Electron 44 has no install script; without this, desktop test files race to extract it in a fresh checkout.
vp run --filter @t3tools/desktop ensure:electron
vp run typecheck
vp lint --report-unused-disable-directives
# Upstream's cross-architecture Windows probe test fails on macOS hosts at the base tag too.
# The two Linux theme icon tests write T3Code.png and t3code.png, which are one file on macOS's case-insensitive filesystem.
vp test run apps/desktop/src scripts/build-desktop-artifact.test.ts scripts/lib \
  -t '^(?!.*(skips the primary native probe for cross-architecture Windows payloads|installs both app id spellings without creating an icon cache|replaces same-length stale icons and refreshes an existing cache once))'
