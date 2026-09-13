# Block 12 — recon and proposals

Read-only, 2026-09-13. Proposals on 12.6, 12.7, 12.8, 12.9, 12.10, 12.13 for PK to rule on
before anything is built. Design notes on 12.2, 12.3, 12.4 (being built directly) so the
shape is on the record.

---

## 12.6 — Delete must recalculate: head-count-as-history

### What is true today

- `herd_lots.head_count` is a **stored number**. Twenty-five files read it; the heavy readers
  are Markets valuation (`herd-estimate`, `markets/series`, `MarketComparisons`,
  `HerdEstimatePanel`, `HerdValueCard`), LFP payment, three snapshot crons, `ranch-summary`,
  `HerdForm`, and the preg-check page.
- **A manual edit in HerdForm writes no ledger row.** `PATCH /api/herd/lots/[id]` changes the
  column and nothing else. So the history already has holes: only group actions record a
  change; edits are silent.
- A group action moves the count and records `head_before` / `head_after` (063). **Deleting
  it does not move the count back** — demonstrated on Test Ranch: AUDIT cows 25 → 9, event
  deleted, still 9.

### What "delete recalculates" actually requires

Not a rewrite of twenty-five readers. It requires that **every change to a head count be a
ledger row, and that the stored column be a projection the database rebuilds from those
rows** whenever one is added, removed, restored, corrected or voided.

### Proposal — the projection (rides in Block 12)

1. **Migration 065.** A new event type `head_count_set` — written by the lot POST (creation
   count) and by the lot PATCH whenever `head_count` changes — payload
   `{ lot_id, head_before, head_after, reason: 'edit' | 'created' }`. Backfill one
   `head_count_set` per existing lot from its current count, dated `created_at`, so every lot
   has an anchor.
2. **`rebuild_lot_head(lot_id)`** in SQL: the most recent *live* `head_count_set` for the
   lot, plus the signed deltas of every *live* `group_action` after it that names the lot as
   source (`stayed − head_before`) or as a result (`+head`). Writes the answer into
   `head_count`.
3. **A trigger on `events`** (insert, and update of `deleted_at` / `superseded_by` /
   `voided_at`) that calls `rebuild_lot_head` for every lot the row names when the type is
   `group_action` or `head_count_set`.
4. Readers untouched. 063/064's compare-and-set still works — it reads the column.

**Effects.** Delete a preg check → source and destination both recalculate. Restore it from
the trash → they recalculate back. Delete a group action whose destination it *created* →
that lot goes to 0 and stays (ruling: zero is a real state). Correct a group action through
054 → the superseded row stops counting, the correction counts.

**Cost.** One migration (function + trigger + backfill), one route change (PATCH/POST write
the set row), harness cases, an isolation check that a delete moves the count back. About a
day. **It rides in Block 12** because 12.4's trash is meaningless for cattle without it.

**What this is not.** It is not "derive everything at read time". That remains the long-run
shape, and this projection is a legal step toward it — every number needed to do it later is
now in the ledger.

---

## 12.7 — Ranch, reinvented

### Usage evidence — honest version

- **There is no per-page telemetry.** `lib/analytics.ts` tracks hay-marketplace and LFP
  events only; nothing fires on any Ranch section. Vercel Analytics records page views by
  path — PK can read `/ranch/*` view counts in the Vercel dashboard; I cannot from here.
- **Kiehl census, 30 Jul → 10 Sep (six weeks):** 13 manual entries on **4 active days**, 2
  recorders. 10 of 13 are `hay_fed`. 18 machine jobs, the last on Aug 27 (cutting is over).
  3 devices. 8 live places. One LFP alert a week.
- Test Ranch is where the walkthroughs happened; its numbers are audit traffic.

**Read:** real use has not started. Feeding season and Tuesday's preg check are the first
sustained use. So this is a design judgement, not a data one, and it should be revisited
against Vercel's `/ranch/*` views in December.

### What gets opened, and why (my read)

| section | how often | what for |
|---|---|---|
| Activity | daily, feeding season | did the hand do what I asked; what did I record |
| Cattle | weekly; daily around workings | head counts, preg check, later sorting/shipping |
| Hay | daily — **but on Today already** | on hand; `/ranch/hay` duplicates Today's tab |
| Places | rarely — when adding one | the map, boundaries |
| Devices | almost never | a device went quiet |
| Work | seasonal — cutting/baling | machine sessions; already rows in Activity since 6J |

### Proposal — three things, not six

**Cattle** — the herd. Lots with head counts and last working; Preg check now; sort, ship,
death loss later on the same primitive. Number on the tile: head.

**Ground** — where things are. Places (map first), boundaries, and the devices that sit on
them (a device is *at* a place; it has no life of its own). Number on the tile: places.

**The record** — what happened. Activity, with machine work as the "Machines" filter it
already has (6J). Number on the tile: entries today.

Hay leaves the Ranch list: keep the route, drop the section — Today's Hay tab is the surface.
Work folds into the record. Devices fold under Ground. Recent activity moves to the top and
becomes 12.8's answer.

**Screen at 390:** heading, then "Today on the ranch" (12.8), then three tiles with their
numbers. Under 600px total. No blurbs (11.9).

---

## 12.8 — Recent activity on Ranch: what am I looking for?

Three questions, in this order:

1. **Did the hand do what I asked, today?** Who, what, when — per person, not per row.
2. **Anything I haven't looked at?** The 6H cursor already knows.
3. **Anything that needs me?** Failed syncs, a device gone quiet.

The current block answers none of them well: two rows of a mixed list, "Show 26 more".

### Proposal — "Today on the ranch"

- One line per person who recorded something today: *"Haley · fed 12 bales, moved 40 head ·
  last at 2:10 PM"*. Tapping opens Activity filtered to them, today.
- One line for the cursor: *"3 entries since you last checked"* with **Reviewed** (6H),
  or nothing if none.
- Needs-attention items, if any, as they are now.
- Quiet day: *"Nothing recorded today · last entry yesterday 4:12 PM by you."*

The full list lives in Activity. Nothing on Ranch scrolls.

---

## 12.9 — Alerts: what each says vs what it means

| surface | says now | actually telling you | proposed |
|---|---|---|---|
| **Activity record, LFP alert row** | `Alert` — the bare word. `describeBody` falls back because the payload has no `title`. (`ActivityFeed` had the full sentence; `lib/activity.ts` lost it.) | Petroleum County reached LFP Tier 2 this USDM week; 2 payments | *"LFP alert — Petroleum County at Tier 2 · 2 payments"* |
| **ActiveWarningCard (NWS)** | "Active warning · NWS" · event · `Moderate · until Sep 13, 3:00 PM · NWS Billings` · headline · Full alert | The hazard runs to Sep 14 12:00 AM. `expires` is the **bulletin** expiry; NWS's `ends` is the hazard end and is never parsed — **that is 11.6** | Parse `ends`, prefer it: *"Wind Advisory · ends Sun Sep 14, 12:00 AM"*. Drop "Moderate" — NWS severity jargon, not a fact a rancher acts on |
| **NeedsAttention (outbox)** | heading "Needs attention" · count · "They are saved on this phone and will go up on their own." | 3 entries have not reached the ranch | heading *"3 entries haven't reached the ranch"*; body as is |
| **DeviceAttention** | "Needs attention" · "Check device · Scout" · "Last collected Aug 27 · expected every day" | The Scout has been silent 17 days | *"Scout has not reported since Aug 27 — it should report daily"* |
| **ProgramAlerts** | heading "Changed" | USDA changed a program date/rule that affects this county | heading *"Program changes"* |
| **LfpAlertCard** | "Drought / LFP" · "Program status" · triggered / pending / building / unavailable | LFP payment status for the home county | eyebrow *"LFP payments · Petroleum County"*; states as they are (they are good) |
| **Inline errors** (`role="alert"`) | mostly specific ("That bunch now reads 188 head…") | — | fix the two vague ones: "Enter a number" → "Enter the bales"; "No connection — try again" → "No connection — the entry is unchanged" |

**Build note:** 11.6 rides with this row.

---

## 12.10 — Headings: current → proposed

| where | now | proposed |
|---|---|---|
| Ranch | Recent activity / Sections | Today on the ranch / *(no "Sections" — the tiles are the page)* |
| Today | Recorded since you checked | keep |
| Today | Repeat last feeding | keep |
| Today ledger tabs | This season · Hay · Recently logged | Hay · This season *(Recently logged goes — see 12.13)* |
| Today | Needs attention | *"N entries haven't reached the ranch"* / *"Scout has not reported"* |
| Today/Programs | Changed | Program changes |
| Today | Drought / LFP | LFP payments · {county} |
| Markets | Your cattle / Reported sale / Price history / What changed / Broader context | Your cattle / Reported sale / Price history / **Changes since you checked** / **Beyond your barn** |
| Markets cards | "Cattle markets" on **two** cards (LRP, national beef) | **Price protection (LRP)** / **National prices** |
| Weather | 7-day forecast · NWS / County rainfall · {county} / Drought map | keep — these say what is under them |
| Place page | The ground / Recent here / Activity here / Connected devices | **Boundary and acres** / **Recorded here** *(one list, not two)* / Devices here |
| Activity | The record / The record · one entry / The record · machines | keep |
| Account | Signed in / Identity / Ranch settings / Crew and access / Preferences / Help / Share / Feedback / Sign out | **You** / Ranch / Crew / Preferences / Help / Share / Feedback / Sign out |
| Hay card | Hay | **Hay on hand** |
| Season card | This season | **Cut and baled this season** |

---

## 12.13 — Activity on Today

Today has **three** activity surfaces plus Needs attention:

1. *Recorded since you checked* (6H — the cursor, with Reviewed)
2. *Repeat last feeding* (an action wearing an activity face)
3. The *Recently logged* tab in the ledger strip (3 rows, no filter)

They overlap: Recently logged's three rows are a subset of since-you-checked or of the
record. Three lists is why it reads busy.

### Proposal — one

- Keep **Recorded since you checked** as the only activity block on Today. It answers the
  question Today is for.
- **Drop the Recently logged tab.** The ledger strip becomes **Hay · This season** — two tabs,
  which also helps 320px.
- **Repeat last feeding** stays, but styled as the action it is (a button with its receipt),
  not a card that looks like a list.

---

## Design notes on what is being built directly

### 12.1 — the pill, back under the 11.4 rule

Fixed bottom-right above the bar, as before. The rule is kept structurally: the phone body
now reserves **bar + pill zone** (56 + 72 px + safe area) rather than the bar alone, so
content can always scroll clear of it. The overlap check already iterates every fixed element
on the page and asks the browser what is on top at the centre of every control — the pill is
tested the moment it exists, on ten screens at 390 and 320. If it cannot pass, the bar stays.

### 12.2 — what the pill opens

Grouped by *what am I recording*, not by event type:

- **Work** — Feed hay · Add bales to a stack · Move cattle · Record cattle work · Record rain
- **Count** — Count hay · **Count livestock** *(new: writes a `head_count_set` for a lot —
  the same row 12.6 needs, so a count at the chute becomes ledger)* · Preg check
- **Ground** — Drop a point where you stand · Ride the perimeter · Draw a place

**Proposed additions, not built until ruled:** *Death loss* (a one-group group action — free
on the primitive); *A note* (free text on a day, no numbers — the thing a notebook does that
this app cannot).

### 12.3 — tap-and-hold, and desktop

Phone: press-and-hold 500 ms on any row (activity entry, place, lot, device) opens a bottom
sheet: **Open · Edit · Delete**. The same sheet everywhere; the row itself still taps to open.
Desktop: **right-click** opens the same three, and a **⋯** appears on hover at the row's
right edge for people who never right-click.

### 12.4 — the trash

- **Where:** `/account/trash`. Out of the way, per the ruling.
- **What goes in:** events (061 `deleted_at` exists), places, lots, devices — the last three
  need `deleted_at` (**retired** is a different state: out of the pickers, not in the trash).
  Devices hard-delete today; they stop.
- **Restore** clears `deleted_at`. For a group action that also rebuilds head counts (12.6).
  For a place, its entries kept naming it all along.
- **Purge:** a cron at 7 days hard-deletes anything with `deleted_at` older than that,
  through the same cascade rules 8B established.
- One migration (deleted_at on three tables + the purge function).

### 12.5 — "void" dies

The button went in 11.13. What remains: the *word* on row markers ("voided"), the chain
label ("What it voided"), and the void API route. Rows already voided keep counting for
nothing; they will read **"removed"** with the same chain. The route stays for the record's
sake and is offered nowhere.
