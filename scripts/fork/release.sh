#!/usr/bin/env bash
# Build the fork's macOS desktop app on the Mac Mini, sign it, and publish it as a
# prerelease on mimen/t3code. Installed "T3 Code (Fork)" apps find it through their
# update check: the nightly channel reads nightly-mac.yml from the newest prerelease.
#
#   scripts/fork/release.sh [--dry-run] [<ref>]      default ref: origin/main
#
# Idempotent: exits 0 without building when the newest release already targets <ref>.
set -euo pipefail

REPO=mimen/t3code
IDENTITY="Apple Development: Created via API (5VG478JB32)"
KEYCHAIN="$HOME/Library/Keychains/fork-signing.keychain-db"
SIGNING_ITEM="op://Sol/T3 Code Fork Signing"
# Upstream's public client config, so T3 Connect pairing works as it does in upstream builds.
CLERK_PUBLISHABLE_KEY=pk_live_Y2xlcmsudDMuY29kZXMk
RELAY_URL=https://relay.t3.codes

dry_run=false
[[ "${1:-}" == "--dry-run" ]] && { dry_run=true; shift; }
ref="${1:-origin/main}"

root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
git -C "$root" fetch -q origin
git -C "$root" fetch -q --tags upstream
sha="$(git -C "$root" rev-parse --verify "$ref^{commit}")"

latest="$(gh release list -R "$REPO" --limit 1 --json tagName --jq '.[0].tagName // ""')"
if [[ -n "$latest" && "$(gh release view "$latest" -R "$REPO" --json targetCommitish --jq .targetCommitish)" == "$sha" ]]; then
  echo "release: $latest already targets $sha"
  exit 0
fi

upstream_tag="$(git -C "$root" tag --merged "$sha" -l 'v*-nightly.*' --sort=-creatordate | head -n 1)"
core="$(sed -E 's/^v([0-9]+\.[0-9]+\.[0-9]+).*/\1/' <<<"$upstream_tag")"
[[ "$core" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "release: no upstream nightly tag merged into $sha" >&2; exit 1; }
# The trailing number orders same-day builds; upstream uses its run number, the fork uses UTC HHMM.
version="$core-nightly.$(date -u +%Y%m%d).$((10#$(date -u +%H%M)))"

cache="$HOME/Library/Caches/t3code-fork-release"
work="$cache/src-$sha"
out="$cache/out-$sha"
if [[ ! -d "$work" ]]; then
  git -C "$root" worktree add -q --detach "$work" "$sha"
fi
trap 'git -C "$root" worktree remove --force "$work" >/dev/null 2>&1 || true' EXIT

security unlock-keychain -p "$(op read "$SIGNING_ITEM/keychain_password")" "$KEYCHAIN"

cd "$work"
vp install
rm -rf "$out"
CSC_NAME="$IDENTITY" CSC_KEYCHAIN="$KEYCHAIN" \
  T3CODE_DESKTOP_UPDATE_REPOSITORY="$REPO" \
  T3CODE_CLERK_PUBLISHABLE_KEY="$CLERK_PUBLISHABLE_KEY" T3CODE_RELAY_URL="$RELAY_URL" \
  vp run dist:desktop:artifact --platform mac --target dmg --arch arm64 \
  --build-version "$version" --output-dir "$out" ${T3CODE_FORK_RELEASE_VERBOSE:+--verbose}

grep -q "version: $version" "$out/nightly-mac.yml" || { echo "release: nightly-mac.yml does not name $version" >&2; exit 1; }
app_zip="$(ls "$out"/*.zip)"
check="$(mktemp -d)"
ditto -x -k "$app_zip" "$check"
codesign --verify --deep --strict "$check"/*.app
signature="$(codesign -dv "$check"/*.app 2>&1)"
[[ "$signature" == *"TeamIdentifier=458KZD965T"* ]] || { echo "release: app is not signed by team 458KZD965T" >&2; exit 1; }
rm -rf "$check"

if $dry_run; then
  echo "release: dry run, built $version from $sha into $out"
  exit 0
fi

gh release create "v$version" -R "$REPO" --target "$sha" --prerelease \
  --title "T3 Code (Fork) $version" \
  --notes "Fork build of $sha, upstream $upstream_tag." \
  "$out"/*.dmg "$out"/*.zip "$out"/*.blockmap "$out"/nightly-mac.yml
echo "release: https://github.com/$REPO/releases/tag/v$version"
