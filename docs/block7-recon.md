# Block 7 recon — trust fixes + Today

Read-only. Nothing built. Production `4a0dea9`, database has migrations through 057.

## Suite baselines — the order's numbers are stale

The order records **88 / 63 / 134+1**. That is the Block 6B-era baseline. Current, run against production at this commit earlier today:

| suite | order says | actual |
|---|---|---|
| isolation (`rls-test`) | 88 | **133** |
| daily loop | 63 | **109** |
| markets | 134 + 1 skip | **144 + 1 skip** |

All three green. Blocks 6C–6K, Block 7 Parts 1–3, places slice 1 and the place-correction slice all landed since 88/63/134.

---

## STOP conditions — none triggered

| condition | finding |
|---|---|
| sign-out flow is not what item 1 assumes | **assumption holds, and is worse than assumed** — see 1 |
| Count hay has real stack-level semantics | **it does not** — `place_id` is stored and ignored — see 4 |
| the gain line's cause is other than baseline/aggregation | **it is a baseline problem** — see 2 |
| Dec 1 contradicts `lib/programDates.ts` | **it does not** — see 7 |

Clear to proceed on PK's go.

---

## Part A

### 1. Sign-out

**One surface:** `app/account/SignOutButton.tsx`. There is no other sign-out and no account switcher (`InviteLanding.tsx` has a "sign out and use…" path that calls the same helper).

Current copy, verbatim, in a **native `window.confirm`**:

> Some entries have not synced to the ranch yet. Sign out anyway and lose them?

Then `signOutEverywhere()` (`lib/private-state.ts:60`): `auth.signOut()` → `clearPrivateState()` → `window.location.replace('/')`. `clearPrivateState()` removes every private key, clears `sessionStorage`, and calls `clearOutbox()`.

**No sync is attempted before sign-out.**

**The defect worth naming.** `hasUnsynced()` → `pendingCount()` → `read().filter(i => i.state === 'local' || i.state === 'queued')` (`lib/outbox.ts:128-132`). States are `'local' | 'queued' | 'synced' | 'failed'`. **`failed` is excluded.** A permanently rejected entry (non-transient, non-401 — `uploadOne` line 229) is unsynced work that `hasUnsynced()` reports as nothing, so the warning never appears and `clearOutbox()` deletes it silently. Item 7.1's "pending **or failed**" is exactly the gap.

| path | what happens to unsynced work |
|---|---|
| sign-out, `local`/`queued` present | native confirm, then discarded |
| sign-out, only `failed` present | **no warning at all**, discarded silently |
| account switch | `bindPrivateStateTo(uid)` (`private-state.ts:50-53`) — a different uid calls `clearPrivateState()` **with no warning and no prompt** |
| token expiry (401) | **safe** — `uploadOne` re-queues with `lastError: 'Signed out — sign in to sync'`, nothing is dropped |
| no network | **safe** — re-queued as `'No connection'` |

### 2. "▲ $481,564 since Sep 10"

`app/dashboard/components/HerdEstimatePanel.tsx:150-160` renders `trend.herd`, computed in `lib/trend.ts:97-104`:

```ts
if (herdHistory == null)        herd = { status: 'unavailable' }
else if (herdHistory.length < 2) herd = { status: 'accruing' }
else {
  const [cur, prior] = herdHistory
  const abs = cur.total_value - prior.total_value
  herd = { status: 'ready', abs, pct: prior.total_value > 0 ? (abs / prior.total_value) * 100 : null, sinceDate: prior.snapshot_date }
}
```

**Baseline** = the second-most-recent `herd_estimate_history` row, whatever it is. Test Ranch's actual rows:

| snapshot_date | total_value | lots_priced |
|---|---|---|
| 2026-09-11 | 481,564 | 2 |
| **2026-09-10** | **0** | **2** |
| 2026-09-09 | 88,800 | 2 |

The gain is `481564 − 0`. Sep 10 is an anomalous zero-value snapshot between two ~88k days.

- **Does a missing or incomparable baseline become zero?** A *missing* one does not — `null` → "unavailable", `<2 rows` → "accruing" → "History begins {date}". An **incomparable** one is never detected. And the code already knows this baseline is unusable: `prior.total_value > 0` guards the percentage, so it suppresses the *percent* and prints the *absolute* anyway. That is the whole bug in one line.
- **Composition is never compared.** `lots_priced` is on the row and is not read. Here it is 2 on both days, so a `lots_priced` check alone would not have caught it.
- **Are unlike purposes summed?** Yes. `total_value` is the sum of every priced lot — Steer calves (purpose *Sale calves*) and Replacement heifers (purpose *Replacements*) are added together with no separation.

### 3. "Show carried-forward steps" — every file

| file | what it holds |
|---|---|
| `app/dashboard/components/MarketsCharts.tsx` | the toggle control and the dashed step rendering |
| `lib/markets/series.ts` | the series builder that produces carried-forward points |
| `scripts/smoke-markets.ts` | checks referencing the toggle |
| `scripts/audit-markets-mobile.ts` | the mobile audit's reference |

Nothing else in `app/` or `lib/` mentions it.

### 4. Count hay

- Picker subtitle (`LogIt.tsx:107`): "a count of the stack, as of a date".
- Form (`LogIt.tsx:571-572`): `On hand` (bales) + `Counted on` (date) + a line reading **"Count for: Entire ranch"** — the place select defaults to the ranch, not a stack.
- Saved payload (`lib/manual-log.ts`): `{ bales, as_of }` plus the standard `place_id`.

**What it actually does:** `lib/hay/queries.ts` parses `place_id` into `HayEntry` (line 138) and **never uses it**. The baseline is the latest `hay_inventory` event regardless of place; on-hand = `baseline + every bales_stacked since − every hay_fed since`, ranch-wide (lines 246-256). The hay page already says so out loud: *"across the ranch since that count — not any one stack's balance."*

**Stack-level counts do not exist anywhere in the schema.** No table, no column — only the ignored `place_id` in the jsonb payload. So the picker's word "stack" is the only thing that is wrong; the form and the effect already agree.

### 5. Record forms — occurred vs recorded

One control for all six types: a **"change time"** button revealing a single `datetime-local` **When** field (`LogIt.tsx:277`, `461`). Empty means now.

```ts
if (when) body.ts = new Date(when).toISOString()
```

`POST /api/log` writes that to `events.ts`; `events.ingested_at` defaults to server now. **Separate for every type** — there is no type that collapses them.

Verified end-to-end on Test Ranch during the walkthrough: a feeding backdated to Sep 10 07:00 stored `ts = 2026-09-10T13:00:00Z` (Sep 10, 7:00 AM Denver) and `ingested_at = 2026-09-11T18:16:03Z` (Sep 11, 12:16 PM) — 29 hours apart, and the entry page labels them **Work time** and **Recorded**.

Per type: all six offer `change time`. **Only `hay_fed` has a "More" expander and a Note field**; rain, bales_stacked, cattle_moved, cattle_worked and hay_inventory have no note input at all.

### 6. Dead routes

All four render the shared not-found page ("Page not found · This page does not exist."), via `flagDisabled('marketplace')` → `notFound()` (`app/weather/radar/page.tsx:10`, same pattern in the others). The `.env` flags `NEXT_PUBLIC_FEATURE_MARKETPLACE` and `NEXT_PUBLIC_FEATURE_MESSAGING` are off.

| route | inbound links |
|---|---|
| `/weather/radar` | `app/hay/page.tsx:1201` — itself dead |
| `/hay/map` | `app/hay/page.tsx:713` (dead) · **`app/components/HomeDroughtMap.tsx:35`** — component is an **orphan**, rendered nowhere |
| `/hay` | `app/messages/page.tsx:227` (dead) · `app/hay/map/HayMapClient.tsx:428` (dead) · `app/hay/[id]/page.tsx:348` (dead) |
| `/messages` | `app/hay/[id]/page.tsx:508` (dead) · **`app/account/page.tsx:49` — "Messages →", live and reachable** |

**One live link to a dead page: Account → Messages.** Everything else is dead-linking-to-dead, plus one orphan component.

### 7. Today's cards, and the Dec 1 deadline

| card | component | source |
|---|---|---|
| LFP status | `ProgramStatusRow` + LFP card in `DashboardShell`/`ViewBodies` | `lib/lfp-eligibility.ts` over `drought_data`, with `lib/grazing-window.ts` |
| "D2 Severe" drought | `LatestReadingCard` | USDM via `lib/drought-service.ts` (`drought_data`, weekly) |
| deadline strip | `ProgramStatusRow.deadlineQuietPreview` (line 28-33) | `lib/rma-deadline-service.ts` |

**Dec 1, 2026 agrees with `lib/programDates.ts`.** `rma-deadline-service.ts:4,70` imports `PROGRAM_DATES` and overrides the table for every governed slug. `PROGRAM_DATES` holds LFP application `2027-03-01` and **PRF sales closing `2026-12-01`**. Dec 1 2026 is chronologically the next one, so the strip is right.

The one honesty gap: the strip renders `Next USDA deadline ${date} · ${N} days` and **never names the program**. `programDates.ts:16-18` is emphatic that "December 1 is a PRF date and belongs ONLY on PRF; it is not an LFP deadline" — but on Today, sitting directly beneath the LFP card, an unlabelled "Dec 1" reads as the LFP deadline.

### 8. Per-user seen / dismissed state

Two columns already exist on `ranch_members`, both per (ranch, user):

- `last_seen_at` (migration 044) — the ledger cursor behind "Recorded since you checked"
- `markets_seen_at` (migration 048) — the same treatment for Markets

Both are **single timestamps**, written server-side. They answer "what is new since you last looked".

**They cannot carry 7.9's dismissals.** A dismissal must be per *specific change* ("D2→D3 on Sep 8"), not per moment: a timestamp cursor would suppress a *later, different* change that happened before the cursor moved, and an unchanged weekly publication would need to not re-alert even though its row is newer. That needs a keyed record — a table (or a jsonb map) of `(user, alert kind, change identity)`. **A migration is required.** The order already anticipates this and requires the code to treat a missing table as "nothing dismissed".

---

## Part B — report only, build nothing

### 9. Cattle

- **`herd_lots.head_count` is a stored, editable integer**, not derived. Written by `updateLot` (`lib/herd-lots.ts:104-108`) behind an optimistic `updated_at` check; `herd_estimate_history` is a *weekly cron snapshot*, not an edit log.
- **A partial `cattle_moved` changes nothing about lots or locations.** Payload is `{ head, from_place_id, to_place_id, herd_lot_id }`; `manual-log.ts` comments it directly: *"6G: which bunch moved — optional, never changes a head count."* Confirmed live: moving 10 of 40 heifers left `/ranch/cattle` reading "40 head". No table records where a lot currently is — a place's page shows "10 head moved away" as an event line, and that is the only trace.
- **`cattle_worked` stores** `{ head, what, herd_lot_id }` — `what` is required free text, capped at 80 characters.
- **No shipment, preg, death, purchase or weigh schema exists**, exposed or unexposed. All 49 tables were enumerated; none of these appear.

### 10. Event types — one registry

`lib/manual-log.ts` is the single registry: `MANUAL_EVENT_TYPES` (line 10), `MANUAL_EVENT_LABELS` (24), `LIMITS` (37), and `buildManualPayload`'s switch, which is the only place payloads are shaped. `/api/log` and the correction routes both go through it. Forms in `LogIt.tsx` carry their own labels, and those are the one thing that drifts (see 4).

| type | label | payload beyond `{source, schema_version, place_id}` |
|---|---|---|
| `rain` | Rain | `inches` (0–30, 2dp) |
| `hay_fed` | Hay fed | `bales` (1–10000), `herd_lot_id?`, `note?` (200), `stock_place_id?` |
| `bales_stacked` | Bales stacked | `count` (1–10000) |
| `cattle_moved` | Cattle moved | `head` (1–20000), `from_place_id?`, `to_place_id?`, `herd_lot_id?` |
| `cattle_worked` | Cattle worked | `head`, `what` (required, ≤80), `herd_lot_id?` |
| `hay_inventory` | Bales on hand | `bales`, `as_of` (ranch day) |

Corrections may change any of these plus work time and a reason (054).

### 11. Turnout date

**Nothing.** No storage, no UI, no string. `grep -i "turnout\|turn-out"` across `app`, `lib`, `supabase` and `scripts` returns zero matches, and the walkthrough confirmed the word appears on no rendered screen. There is a run-out projection ("Runs out around Tue, Oct 13, 2026 at 8.1 bales/day") but no rancher-picked turnout date and no worst-case date/rate pair.
