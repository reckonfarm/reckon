#!/usr/bin/env bash
# Create or refresh the suite worktree at a ref, DETACHED (so no branch is ever "already
# checked out" elsewhere), with node_modules linked and the env files copied.
#   scripts/suite-worktree.sh origin/main
#   scripts/suite-worktree.sh origin/block-7-markets-hierarchy
#   WT=~/reckon-wt2 scripts/suite-worktree.sh <ref>     # a second worktree
set -euo pipefail
REF="${1:?usage: scripts/suite-worktree.sh <ref>}"
MAIN="$(git rev-parse --show-toplevel)"
WT="${WT:-$HOME/reckon-wt}"
git -C "$MAIN" fetch -q origin
if [ ! -d "$WT" ]; then git -C "$MAIN" worktree add -q --detach "$WT" "$REF"; else git -C "$WT" checkout -q --detach "$REF"; fi
[ -e "$WT/node_modules" ] || ln -s "$MAIN/node_modules" "$WT/node_modules"
cp "$MAIN/.env.local" "$WT/.env.local"
mkdir -p "$WT/e2e" && cp "$MAIN/e2e/.env.e2e" "$WT/e2e/.env.e2e"
echo "suite worktree $WT detached at $(git -C "$WT" log --oneline -1 | cut -c1-80)"
