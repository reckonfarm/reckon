# Markets — inventory, proposed order, cut list

Block 7B.3. **Proposal only. No Markets code has been touched.**

Captured from the live preview signed in as Test Ranch, 390px wide, Sep 11 2026.
Page height **5,735px** at 390 and **6,995px** at 320 — roughly seven phone
screens. Every y-value below is a measured `getBoundingClientRect().top +
scrollY`, not a reading of the source.

---

## 1. What is there now

### Render order at 390px

| y | block | leads with |
|---|---|---|
| 161 | `markets-title` (h1) | Markets · Billings |
| 199 | `markets-report-dates` | Latest reports: Local Sep 10 · National Aug 31 · LRP Sep 11 |
| 302 | `selected-price` | **$403/cwt** |
| 350 | `selected-subject` | Steers · 500–599 lb |
| 378 | `selected-evidence` | Billings · Sep 10 · 132 head · Report ↗ |
| 428 | `selected-change` | ▲ Up $15.58/cwt since Sep 3 · one side a limited sample |
| 488 | `change-cattle` | *Change cattle ▾* |
| 544 | `compare-settings` | *Compare and settings ▾* |
| 604 | tab pair | *Chart* │ *Sales (6)* |
| 668 | `chart-title` | Steers · 500–599 lb · Local report — Billings · $/cwt |
| 716 | `chart` | the dot plot |
| 1040 | `selection-strip` | Slide or tap to pick a sale |
| 1092 | `dot-legend` | Each dot is a reported sale; open dots have fewer than 20 head |
| 1265 | `since-card` | Since you last checked |
| 1488 | `what-changed` | What changed for my cattle (3 lot rows) |
| 1905 | `herd-value-card` | *lot select*, then three `comparison-row`s |
| 2015 | `comparison-value` | **$397,564** · $401.58/cwt reported |
| 2231 | `sensitivity-line` | Every $1/cwt move is $990 on this lot. |
| 2279 | `lot-calculation` | *How this is figured ▾* |
| 2340 | `comparison-value` | **$84,000** · $350/cwt reported |
| 2549 | `comparison-value` | **$54,706** · $198.93/cwt reported |
| 2761 | `no-gross` | No gross total: a lot has no purpose set. |
| 3000 | **§ Price history** | 2 `spread-row`s + 3 `delta-row`s |
| 3491 | `sell-pin` | Preferred sale barn (*select*) |
| 3714 | `auction-card` | Other cattle markets · $/cwt |
| 3828 | `sale-detail` | *Sale detail ▾* — Sep 10, 378 head, ~95 mi |
| 4087 | `receipts-scope` | Receipts: 2,020 head across… |
| 3943 | `board-feeder-steers` | Steers 400–499 lb **$495.21/cwt** ▲ 13.4% |
| 4297 | `board-heifers` | Heifers 400–499 lb **$420.86/cwt** |
| 4352 | `board-feeder-bulls` | Feeder bulls 400–499 lb **$499.37/cwt** |
| 4600 | `board-cull-cows` | Breaking/boning — slaughter prices, not breeding value |
| 4859 | `board-slaughter-bulls` | Slaughter bulls |
| 5003 | **§ Price protection** | LRP references · Steer calves… |
| 5141 | `price-protection-more` | *Calculator and endorsements ▾* → LRP hero **$324.21/cwt**, term *select* |
| 5257 | **§ Broader context** | National markets and feed costs · fed steers **$219.25/cwt** |
| 5353 | `broader-context-more` | *National markets and feed costs ▾* → national beef, *Corn* │ *Cattle cycle*, *Compare with feeder cattle ▾*, corn chart |
| 6865 | `video-feed` | No sale-video feed connected. |

*(y-values above 5,735 sit inside a closed `<details>` — laid out and clipped,
which is native behaviour, not a bug.)*

### The thirteen controls

Share · Change cattle ▾ · Compare and settings ▾ · Chart / Sales (6) · lot
select · How this is figured ▾ · preferred-barn select · Sale detail ▾ ·
Calculator and endorsements ▾ · LRP term select · National markets and feed
costs ▾ · Corn / Cattle cycle · Compare with feeder cattle ▾.

Thirteen groups, counting each paired toggle (Chart/Sales, Corn/Cattle cycle)
as the one control it is; fifteen individually clickable things.

### Measured repetition

- **"Billings" appears in 21 separate text nodes.** Of those, the *same fact* —
  Billings Livestock Commission, Sep 10, reference sale of N head — is restated
  as a full evidence line **6 times** (`report-evidence` at y=2111, 2388, 2621,
  2668, 2842, 3983), each with its own **Report ↗** link. There are **7**
  `report-link`s on the page, all pointing at the same Sep 10 report.
- The barn is also named in the h1, the selected-cattle evidence line, the chart
  title, both `changed-market` rows, the lot-calculation disclosure, both
  `spread-row`s, all three `delta-row`s, the sell-pin, and the auction-card
  title.
- **Markets CLS is 0.618 at 390 and 0.702 at 320** (report-only, out of Block 7's
  scope). Today's is 0.016 / 0.000 for comparison.

---

## 2. (a) The two headline numbers

**$403/cwt** (y=302) and **$397,564** (y=2015) answer the same question — *what
are my cattle worth today* — 1,700px and roughly two screens apart. One is the
per-hundredweight price of a reported sale of somebody's steers; the other is
that price applied to a specific lot of this rancher's steers.

**Proposal: $397,564 leads. $403/cwt goes directly under it as its unit.**

The reasoning is what Dryline is for. `$403/cwt` is a market fact that exists
whether or not this rancher owns a cow; `$397,564` is the answer to the question
that made him open the app. The whole ledger — lots, head, weights — exists so
the app can say the second number, and the page currently buries it under a
chart. Every other Dryline surface already leads with the ranch's own number and
puts the county or the national figure beneath it as context; Markets is the one
screen that inverts it.

Concretely, the top of the page becomes one card:

```
Steer calves · 180 head · 550 lb
$397,564
$401.58/cwt · Billings Livestock Commission · Sep 10 · 58 head · Report ↗
▲ Up $32.76/cwt since Sep 3 · one side a limited sample
Every $1/cwt move is $990 on this lot.
```

Two rulings this needs from you, because both are judgment calls, not
mechanics:

1. **`$403/cwt` and `$401.58/cwt` are not the same number today** — the hero
   reads the 500–599 lb steer class, the lot comparison reads the reference sale
   matched to that lot's actual weight. Merging them means the page shows one
   price per lot, and the class-level price disappears as a separate headline. I
   think that is correct (the class price with no lot attached is exactly the
   number a rancher cannot act on), but it removes a number that is on the page
   today.
2. **The no-gross rule stays.** Three lots means three of these cards; there is
   still no summed total, because a lot has no purpose set and 6B settled that
   an aggregate across unlike purposes is not honest. So the top of the page is
   *the selected lot*, with the lot select immediately under it — not a stack of
   three heroes.

## 3. (b) The Billings reference, stated once

**Proposal: one `Reported sale` block, directly beneath the hero, and nowhere
else on the page.**

```
Reported sale · Billings Livestock Commission · Sep 10, 2026
378 head · ~95 mi · Local report · Report ↗
Receipts: 2,020 head across slaughter cattle, replacement cattle, feeders
Scope: Local report · falls back to Regional reference, then National
```

Everything downstream then refers to it without restating it. A `delta-row`
becomes `Steer calves · 180 head · 550 lb · ▲ $32.76/cwt since Sep 3`, with no
trailing "at Billings Livestock Commission" — the page has one barn, named at
the top, and if the barn ever differs for a row *that* is the exception worth
printing.

What that cuts: **6 evidence lines → 1**, and **7 Report ↗ links → 1**. The
`sale-detail` disclosure disappears as a separate control because its contents
*are* this block, opened.

The one case that must survive: **a lot priced somewhere other than the pinned
barn.** 6I built that ("a lot priced elsewhere says so"), and collapsing the
evidence must not collapse that exception. The rule becomes: the reported-sale
block states the page's barn; any row whose price came from a different barn
names its own, and only those rows do.

## 4. Proposed order, top to bottom

1. **Your cattle** — hero (§2), lot select, sensitivity line, *How this is figured ▾*
2. **Reported sale** — the one evidence block (§3)
3. **Price history** — the dot chart, selection strip, dot legend, and the
   spread/delta rows folded in beneath it. Points only, no lines between weekly
   points; thin samples stay marked as thin.
4. **What changed** — since-you-last-checked and the per-lot what-changed rows,
   merged into one section (see cut list)
5. **Other cattle markets** — the five boards
6. **Price protection** — LRP, behind its disclosure, no eligibility claim
7. **Broader context** — national, corn, cattle cycle, behind its disclosure
8. **Preferred sale barn** — the setting, at the bottom with the other settings

## 5. Cut list

| Cut | Reasoning |
|---|---|
| 5 of 6 `report-evidence` lines, 6 of 7 Report ↗ links | The same sale, restated six times. One canonical block (§3). |
| `sale-detail` disclosure | Its contents become the reported-sale block; a disclosure hiding the page's central evidence is backwards. |
| Barn name in `spread-row`, `delta-row`, `changed-market`, chart title, auction-card title | The page has one barn, named once at the top. Only an exception names its own. |
| `since-card` as a separate section | It and `what-changed` both answer "what moved since I last looked," 200px apart. Merge into one. |
| `markets-report-dates` strip | Three dates for three sections, none of them where the data is used. Each section carries its own as-of already. |
| The h1's "· Billings" | The reported-sale block names the barn; the h1 naming it too makes "Markets · Billings" read as a place rather than a page. |
| `video-feed` ("No sale-video feed connected.") | An empty state for a feature that does not exist. Nothing links to it, nothing can connect it. |
| *Compare and settings ▾* as a top-of-page control | It is a settings drawer sitting above the data. Move to the bottom with the preferred-barn select. |

**Controls: 13 → 9.**

Surviving (9): Share · Chart / Sales · lot select · *How this is figured ▾* ·
preferred-barn select · *Calculator and endorsements ▾* · LRP term select ·
*National markets and feed costs ▾* · Corn / Cattle cycle.

Cut or moved (4): *Change cattle ▾* — replaced by the lot select, which does the
same thing 1,400px lower. *Compare and settings ▾* — moved to the bottom; it is
a settings drawer sitting above the data. *Sale detail ▾* — becomes the
reported-sale block, unhidden. *Compare with feeder cattle ▾* — a comparison
inside a disclosure inside the last section, two taps deep in context nobody
reached.

## 6. What a rancher sees before any tap

At 390px the first screen is 844px tall, minus the header. Proposed:

```
Markets
Steer calves · 180 head · 550 lb
$397,564
$401.58/cwt · Billings Livestock Commission · Sep 10 · 58 head · Report ↗
▲ Up $32.76/cwt since Sep 3 · one side a limited sample
Every $1/cwt move is $990 on this lot.
[ Steer calves ▾ ]
Reported sale · Billings Livestock Commission · Sep 10, 2026
378 head · ~95 mi · Local report · Report ↗
```

One number, what it is worth per hundredweight, where that came from, which way
it moved, and what a dollar is worth on this lot. No tap required, and no claim
the page cannot support. Today the first screen ends in the middle of the
*Compare and settings* button, with the ranch's own money still three screens
down.

---

## 7. Open questions for your ruling

1. **Does the class price survive?** (§2 ruling 1) Leading with the lot value
   means `$403/cwt` for the 500–599 lb class stops being a headline. Keep it as
   a line somewhere, or let it go?
2. **Three lots, three heroes, or one selected?** I propose one selected lot with
   a select beneath it. The alternative is a short stack of all three, which
   restores a page that is a list rather than an answer — and edges back toward
   the aggregate the no-gross rule forbids.
3. **Markets CLS is 0.618 / 0.702.** Out of scope in Block 7 and untouched here.
   Any reorder makes it worse before it makes it better. Is fixing it part of the
   Markets build, or its own block?
4. **`what-changed` and `since-card` merge** — both are 6B/6I work with their own
   settled rules. Confirm the merge is wanted before I touch either.
