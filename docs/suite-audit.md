# The suite audit — recon and proposal

Ordered 2026-09-12 after Block 10; fourteen instances by the time it started, and
five more from Blocks 11–12 that fit the same shapes. PK's standard: **a rule per
instance, not a fix per instance.** Nothing is rewritten until he rules on this.

## The three suites, by the numbers

| suite | checks | `innerText` reads | `.first().click()` | `waitForTimeout` | literal-copy asserts | declared skips | outside data |
|---|---|---|---|---|---|---|---|
| `rls-test.ts` | 160 | 0 | 0 | 0 | 3 | 11 | none |
| `smoke-daily-loop.ts` | 158 | **68** | 17 | **60** | 28 | 10 | none |
| `smoke-markets.ts` | 94 | 30 | 9 | 6 | 20 | 8 | USDA MARS |

The isolation suite reads rows and status codes and has produced one instance
(#13 — and that was a missing check, not a wrong one). The two browser suites
produced the other eighteen. Every rule below is about the browser suites.

## The instances, grouped by what actually went wrong

Twenty, not fourteen: the seven PK counted, the five I logged in commit
messages (8–12), the two already written as rules (13–14), and five from Blocks
11–12 that nobody numbered but that belong here.

| # | check | what it named | why it was green or red |
|---|---|---|---|
| 1 | 6K grid-vs-station | "the footer says PRISM" | matched `/PRISM/` against a sentence naming PRISM *and* NOAA |
| 2 | 5D sign-out | "private text is gone" | matched `Synced to ranch`, also in landing-page copy; won a render race |
| 3 | A2 barn pin | "the pin resolves" | undeclared dependency on USDA's sale calendar; re-derived the 10-day rule with a noon anchor |
| 4 | 7D delete | "DELETE retires" | survived the verb being inverted — looked at a status and a column |
| 5 | 7D fixture | "the delete route exists" | posted through a route the suite cannot reach; read a 405 on a bad URL as "missing" |
| 6 | 7-3 places | "every place has a row" | the invariant 7D.4 removed |
| 7 | 7-3 log rain | crashed | tapped a row 7D.4 moved behind a picker |
| 8 | 7-2 rainfall | "the disclosure opens" | drove a disclosure 7D.5 deleted |
| 9 | `onHandNow` ×5 | "the balance moved / didn't" | navigated, read `innerText` on the next line — NaN, which fails every comparison silently |
| 10 | my fix for 9 | same | `waitFor()` defaults to *visible*; the equation is inside a closed `<details>` — burned 20 s and read nothing |
| 11 | hay-ledger-harness | 10 arithmetic checks | dead since 7D: imported through `schema-capability` → `server-only`, which plain `tsx` cannot resolve; nothing noticed for two blocks |
| 12 | chute check | "the working moved the bunch" | `.first()` picked the lot 6A had archived two thousand lines earlier; the app was right twice |
| 13 | 066 projection | (missing) | proven on its arithmetic, never on who could steer it — a permitted write on ranch B moved ranch A |
| 14 | `hasTrash()` probe | "065 is applied" | memoised `false` per serverless process; kept a live preview reporting "not switched on" after the migration ran |
| 15 | 11.4 overlap | "nothing sits over a control" | measured scroll position 0 — every fixed bar covers *something* at scroll 0; the defect is unreachability |
| 16 | 11.4 reserve | "the page reserves the bar" | reserved the CSS min-height (56); the bar *paints* at 64 |
| 17 | 6A/7B.2 hub, 6J section, 6B/6B-2 Today tab, 4A | (various) | measured surfaces PK ruled out of existence in 11.5 / 12.7 / 12.13 — six checks, one cause |
| 18 | three receipt checks | "the equation is on the receipt" | asserted the six-line shape 11.12 ruled away |
| 19 | the moving preview | (all of them) | pushed to the branch a suite was running against; the build changed under it |
| 20 | the R8 runner itself | "the new build is live" | hashed a public page's chunk URLs; content-hashed chunks do not change when that page's code did not — refused to run against a build GitHub showed deployed |

## The rules

Each one names the instances it would have prevented. Two are already written
and are kept as they stand.

### R1 — A check asserts a system guarantee, never a screen's shape *(PK's original rule; #6, 7, 8, 17, 18)*

Six of nineteen were checks that stopped being true the moment PK ruled a screen
different — and every one of them was written against the screen its author had
just built. **How to apply:** before writing `record(...)`, say the guarantee in
one sentence with no nouns from the layout in it. "A corrected entry is marked
the same way wherever it appears" is a guarantee; "the Today tab lists it" is a
shape. If the sentence needs a tab, a section, a row count or an order to be
true, it is a shape, and it belongs in the block's own phone-check, not in the
suite. A check that must name a surface names ONE, the one that owns the
guarantee, and says so.

### R2 — A check depends on outside data only through the app's own rule, and skips by name when the data cannot carry it *(PK's original rule; #3)*

**How to apply:** import the threshold (`FRESH_DAYS`, `ageDays`), never restate
it; when the live data falls outside the assertion's premise, `skip()` with the
premise and the datum ("Miles City's newest report is 11 days old, past the
10-day window") — never a green, never a red. The markets suite does this in 8
places now; the standard is that it is impossible to write a USDA-dependent
check without one.

### R3 — Measure the painted page, not the source, and read the DOM, not the render *(#1, 2, 9, 10, 16)*

Five instances are the same mistake in five clothes: reading `innerText` (layout-
aware, empty inside a closed `<details>`, races the stream), matching a phrase
that exists twice on the page, or trusting a CSS number over the painted box.
**How to apply:** read `textContent` and `data-audit` hooks; wait for
*attachment* and then assert; match a hook, not a phrase; when the thing under
test is a dimension, measure `getBoundingClientRect()` and assert against that.
The sixty-eight `innerText` reads in the daily loop are the backlog this rule
creates. `[[feedback_measure_the_painted_box]]` already says most of this; the
audit makes it the suite's law rather than a memory.

### R4 — A check addresses the row it seeded, never the first one offered *(#12, and the moving-target half of #17)*

**How to apply:** every fixture gets an id; every locator that acts on a fixture
uses that id (`[data-lot="${id}"]`, `li[data-id="${id}"]`). `.first()` is
allowed only on a list the check itself just created and knows to be one long.
A check that borrows a fixture from an earlier block owns nothing — it seeds its
own. The seventeen `.first().click()` sites in the daily loop are the backlog.

### R5 — A probe tests capability, and a probe that can go stale is deleted *(#5, 11, 14; `[[feedback_probe_capability_not_existence]]` is the first half)*

**How to apply:** a readiness or capability probe exercises the thing (`POST`
→ 401 proves a route handles POST; a compiled-CSS value proves a build), never a
200 on a page that the old build also served. A probe that memoises is a lie
waiting for its instance to live long enough — delete it the day the migration
it guards is applied, in the same commit that confirms the migration. And a
harness must fail loudly when it cannot run at all: the hay-ledger harness died
silently for two blocks because nothing asserted that it *ran*.

### R6 — Proving what a thing does is not proving who can do it *(PK's rule, written; #13)*

Kept as written in `feedback_suite_audit_after_block10.md`. Every SECURITY
DEFINER path, trigger or service-role write ships with the isolation check that
a permitted write on ranch B cannot move ranch A through it — in the same commit.

### R7 — A check that could pass for the wrong reason states the reason it passed *(#4, 5)*

The 7D delete check survived the verb being inverted; the fixture check read a
malformed 405 as "missing". **How to apply:** the `detail` string of every
`record()` carries the observed value, not a restatement of the assertion
("source 42 → 40 (stay 40)", not "moved correctly"); and a check whose fixture
could not be created says `FIXTURE NOT CREATED — the check proved nothing`
rather than recording either colour.

### R8 — A suite runs against a frozen build, and says which — and "which" is the deployment record, not a fingerprint *(#19, 20)*

**How to apply:** the runner asks GitHub for the Vercel deployment status of the
exact SHA (`gh api repos/…/commits/<sha>/status`) and refuses to start unless it
is `success`; it prints the SHA and the deployment id in its first line; no push
to that branch until it reports. A run whose build changed under it is void, not
"mostly fine".

**Why not a content fingerprint (#20):** the first R8 runner hashed the chunk
URLs a public page loads and waited for the hash to change. Next content-hashes
chunks, so a build that touched nothing that page loads produces the *same*
hash — the probe reported "stale" for 25 minutes on a build GitHub showed as
deployed, and the suites did not run. A build's identity is the deployment,
never a proxy for it.

## What the pass would do — for PK to rule on

Nothing below is done. Estimated in checks, from the inventory.

1. **Delete or rewrite under R1** — I count roughly **22 checks** across the two
   browser suites that name a tab, a section order, a row count or a heading's
   words as their assertion. Each becomes either a guarantee (rewritten) or a
   phone-check item (deleted from the suite, listed in the block that owns it).
   I will bring the list before touching it.
2. **R3 sweep** — the 68 + 30 `innerText` reads become `textContent`/hook reads
   with attachment waits. Mechanical; one commit per suite; every check re-run.
3. **R4 sweep** — the 26 `.first()` actions are audited: each either acts on a
   list the check created, or is re-pointed at a seeded id.
4. **R5** — the three harnesses (`hay-ledger`, `capture`, `migrate-local`) get a
   "ran at all" assertion in the daily loop (a nonzero check count), so a dead
   harness is a red, not a silence.
5. **R7** — every `record()` whose detail restates its assertion gets the
   observed value instead. I will count these on the first pass.
6. **R8** — `suite-worktree.sh` and the runner print the head and fingerprint,
   and refuse to start against a fingerprint that equals the previous run's when
   a push happened in between.

**What I would not do:** rewrite the isolation suite. Its shape — rows, status
codes, ids — is the shape the rules want the other two to have.

## The order I would go in

R8 first (it protects every later run), then R5 (so the harnesses cannot go dark
during the sweep), then R1 (the list, ruled on, then the deletions), then R3 and
R4 together suite by suite, then R7 as the last pass. Each step is one commit
per suite, three green runs before the next.
