#!/usr/bin/env bash
# The fork's landing gate (FORK.md `check`). Fork smoke tests run first so a
# lost fork feature fails in seconds, before the full suite.
set -euo pipefail
cd "$(dirname "$0")/../.."

vp install
vp test run scripts/fork/smoke
vp run typecheck
vp run lint
vp run test
