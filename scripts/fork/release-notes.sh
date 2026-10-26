#!/usr/bin/env bash
# Print Markdown release notes for a fork build: fork commits and upstream commits since <prev>.
#
#   scripts/fork/release-notes.sh <prev-sha|""> <sha>
set -euo pipefail

prev="$1"
sha="$2"
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
g() { git -C "$root" "$@"; }
# The fork's own release tags share upstream's naming, so only tags upstream has count.
upstream_tags="$(g ls-remote --tags --refs upstream 'v*-nightly.*' | sed 's|.*refs/tags/||')"
upstream_at() {
  g tag --merged "$1" -l 'v*-nightly.*' --sort=-creatordate | grep -Fxf <(echo "$upstream_tags") | sed -n 1p
}

upstream="$(upstream_at "$sha")"
echo "Fork build of \`$sha\` on upstream \`$upstream\`."
[[ -n "$prev" ]] || exit 0

echo
echo "## Fork changes"
echo
fork="$(g log --no-merges --format='- %s (%h)' "$prev..$sha" "^$upstream")"
echo "${fork:-None.}"

prev_upstream="$(upstream_at "$prev")"
echo
echo "## Upstream"
echo
if [[ "$prev_upstream" == "$upstream" ]]; then
  echo "Unchanged."
  exit 0
fi
count="$(g rev-list --no-merges --count "$prev_upstream..$upstream")"
echo "\`$prev_upstream\` to \`$upstream\`, $count commits ([compare](https://github.com/pingdotgg/t3code/compare/$prev_upstream...$upstream))."
echo
g log --no-merges --format='- %s' "$prev_upstream..$upstream"
