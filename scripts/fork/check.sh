#!/usr/bin/env bash
# The gate every fork change and upstream sync must pass before landing.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
vp install
vp run typecheck
vp lint --report-unused-disable-directives
# Upstream's cross-architecture Windows probe test fails on macOS hosts at the base tag too.
vp test run apps/desktop/src scripts/build-desktop-artifact.test.ts scripts/lib \
  -t '^(?!.*skips the primary native probe for cross-architecture Windows payloads)'
