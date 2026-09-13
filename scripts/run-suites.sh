#!/bin/bash
# ─── Run the three standing suites against a branch's preview — R8 ─────────────
#
#   scripts/run-suites.sh <branch>            e.g. scripts/run-suites.sh block-12
#
# Rule R8 of the suite audit: a suite runs against a FROZEN, NEW build, and says
# which — and "which" is the DEPLOYMENT RECORD for the exact SHA, never a proxy.
#
#   #19  a push to the branch a suite was running against changed the build
#        under it; the results described two builds and neither.
#   #20  the first R8 runner used a content fingerprint of a public page's
#        chunk URLs as "new build is live". Next content-hashes chunks, so a
#        build that touched nothing that page loads produced the same hash — it
#        reported "stale" for 25 minutes on a build GitHub showed as deployed.
#
# So: read origin/<branch>'s SHA, poll GitHub for Vercel's status on THAT sha
# until it is success (or fails, or 20 minutes pass), print the sha and the
# deployment id as the first line, refresh the suite worktree to that sha and
# refuse to run if it does not match, then run all three and print the numbers
# under the head they were measured against. Do not push to <branch> while
# this runs; the first line tells you what a push would invalidate.
set -u
BRANCH="${1:?usage: scripts/run-suites.sh <branch>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="reckonfarm/reckon"
B="https://reckon-git-${BRANCH}-preston-kiehl-s-projects.vercel.app"
T=$(grep '^VERCEL_BYPASS=' "$ROOT/e2e/.env.e2e" | cut -d= -f2- | tr -d '"')

git -C "$ROOT" fetch -q origin "$BRANCH"
SHA=$(git -C "$ROOT" rev-parse "origin/$BRANCH")
STATE=""
for i in $(seq 1 60); do
  STATE=$(gh api "repos/$REPO/commits/$SHA/status" --jq '.statuses[] | select(.context=="Vercel") | .state' 2>/dev/null | head -1)
  case "$STATE" in success|failure|error) break;; esac
  sleep 20
done
DEP=$(gh api "repos/$REPO/deployments?sha=$SHA&per_page=1" --jq '.[0].id' 2>/dev/null)
echo "HEAD under test: ${SHA:0:7} (origin/$BRANCH) · Vercel: ${STATE:-none after 20 min} · deployment: ${DEP:-none}"
if [ "$STATE" != "success" ]; then echo "ABORT: no successful Vercel deployment for ${SHA:0:7}. Nothing ran."; exit 1; fi

"$ROOT/scripts/suite-worktree.sh" "origin/$BRANCH" >/dev/null 2>&1
WT="$HOME/reckon-wt"
WTSHA=$(git -C "$WT" rev-parse HEAD)
if [ "$WTSHA" != "$SHA" ]; then echo "ABORT: worktree is at ${WTSHA:0:7}, origin/$BRANCH is at ${SHA:0:7}. Nothing ran."; exit 1; fi

cd "$WT"
export BASE="$B" VERCEL_BYPASS="$T"
P="/tmp/suite-${SHA:0:7}"
npx tsx scripts/rls-test.ts        > "$P-rls.log"     2>&1; R=$?
npx tsx scripts/smoke-daily-loop.ts > "$P-daily.log"   2>&1; D=$?
npx tsx scripts/smoke-markets.ts    > "$P-markets.log" 2>&1; M=$?

n() { grep -oE '[0-9]+ PASS · [0-9]+ FAIL( · [0-9]+ SKIP)?' "$1" | tail -1; }
echo "── ${SHA:0:7} · deployment ${DEP:-?} ──"
echo "isolation:  $(n "$P-rls.log")";     grep "^FAIL" "$P-rls.log"     | cut -c1-220; grep "(skipped)" "$P-rls.log" | cut -c1-160
echo "daily loop: $(n "$P-daily.log")";   grep -E "^FAIL|^SKIP" "$P-daily.log" | cut -c1-240; grep -A2 "smoke crashed" "$P-daily.log" | cut -c1-200
echo "markets:    $(n "$P-markets.log")"; grep "^FAIL" "$P-markets.log" | cut -c1-220
echo "logs: $P-{rls,daily,markets}.log"
[ $R -eq 0 ] && [ $D -eq 0 ] && [ $M -eq 0 ] && echo "ALL GREEN at ${SHA:0:7}" || echo "NOT GREEN at ${SHA:0:7}"
