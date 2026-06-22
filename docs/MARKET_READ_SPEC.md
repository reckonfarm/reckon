# Dryline — Market Read & Operation Home

**Canonical build spec.** Everything below is the reference for the rain sprint. If a
build decision isn't answered here, stop and ask before guessing.

---

## 0. North star (every decision inherits this)

**"I make you money. I ask nothing of you."**

Three paychecks — the only reasons a feature ships:
1. **Money you're owed** — drought / LFP relief.
2. **Money from selling right** — sell timing & channel (the Sell Call).
3. **Money from doing right** — value-added program premiums.

**The moat:** a decision-and-outcome record that compounds every season. Hard rule that
makes "ask nothing" and "build the moat" both true: **no naked data entry, ever.** Every
input pays the rancher back *in that moment* — a number, a document, a sharper estimate.
The record builds as a side effect of him collecting paychecks.

---

## 1. Operation Home (the signed-in landing)

Not "dashboard vs. herd." One screen = **the operation's money**, computed from two inputs:
*what he runs* (herd) × *where he runs it* (county).

### Two zones
- **Operation zone (top) — constant, his.** Herd value, the sell decision, LRP floors.
  Does NOT change when he looks at another county. His cattle didn't move.
- **Location zone (below) — county lens, defaults to home county.** Drought/LFP,
  deadlines, conditions, news. The county selector lives *between* the zones. Changing
  county updates ONLY the location zone.

### Sequence (top → bottom, ordered by urgency × magnitude)
1. **Herd value** — his number, live off this week's cash. *(Value / Trend / Outlook =
   depth inside this card, not separate tabs.)*
2. **Act layer** — the herd-value card flips to **decision mode** when a sale is in the
   window (see §3); LFP money owed (climbing-ladder tracker); time-sensitive deadlines.
3. **Conditions** — one map element, default USDM. *(All map layers from `layers.ts` =
   depth inside it: drought / LFP / LRP / hay / CPC / radar / wind. Weather lives here —
   it's conditions, it never shared a slot with news.)* Market trend sits beside it.
4. **News — dead last.** Highest volume, lowest decision value. Category filters
   (All/Prices/Conditions/Herd) live within it. **News never sits above his money.**

### Principle
**Toggles are depth, not breadth.** The default screen — zero taps — is the answer to
"what's my situation." Every toggle is a drill-down *within a card*, never a new
destination. (Chime-style progressive disclosure, extended to the whole home.)

### Empty-herd state = onboarding = data flow
Herd is the *input*, so a new user has no number yet.
- **No herd:** lead with "Add your first lot." Fill the space below with the
  county-scoped things that work WITHOUT a herd (LFP, deadlines, conditions, news) —
  prove value before he's invested anything.
- **Add a lot → operation zone wakes up.** The market data lights up the moment there's
  a herd to price.

### HARD CONSTRAINT (from recon)
The dashboard is **public by design** (service-role reads, serves anonymous `?fips=`
share links). So the operation zone's herd value is an **auth-checked layer on top of a
public dashboard** — render herd money for signed-in users with lots; fall back to the
county-scoped view + sign-in CTA for everyone else. Do NOT auth-gate the dashboard. Do
NOT break the middleware redirect (`/` → `/dashboard?fips=<home>`). The herd-estimate
logic is already reusable: `estimateHerd` / `buildTrend` / `buildOutlook` in `lib/`,
`HerdEstimatePanel` is presentational and drop-in.

---

## 2. Market Read — the signal field (dad's list, his order)

Not a calculator. A field of signals that arms the *judgment* a rancher makes, organized
the way the sharpest operator we know actually thinks. **Master switch on top; signals
below either confirm the lean or wave a flag.**

### Master switch — Cattle cycle position
- **Reads:** are we retaining heifers (growth/rebuild) or not (good time to sell)?
- **Source:** USDA NASS Quick Stats API — free key, HTTP GET, JSON (same pattern as MARS).
  Cattle on Feed monthly; steers/heifers class split quarterly. Cross-confirm against
  Superior/NLV heifer-offering counts already being ingested.
- **Status:** FREE FAST-FOLLOW.

### The five (in his morning order)
| # | Signal | Answers | Source | Status |
|---|--------|---------|--------|--------|
| 1 | **CME boards** (LE, GF, ZC, ZS, ZW) | up/down/sideways; grain drags cattle | Barchart `getQuote` (likely paid) OR CME free delayed pages — **daily settles only** | FAST-FOLLOW |
| 2 | **Weather / feedlot demand** | moisture in feeding country → cheap corn → feedlots must fill pens → bullish | **Existing precip/drought layer, re-aimed at Corn Belt feeding regions** | **OWN IT — SPRINT** |
| 3 | **Beef demand / consumer mood** | steak vs. trade-down to chicken/pork | RPI headline — restaurant.org, free, monthly, no API | FAST-FOLLOW |
| 4 | **Exports / imports** | foreign beef loading in can sink it fast | **Existing news feed, filtered** | **OWN IT — SPRINT** |
| 5 | **Disease / supply headlines** | screwworm, FMD in competitor countries | **Existing news feed, filtered** | **OWN IT — SPRINT** |

### Walled off — do NOT build on
- **Bullish/Bearish Consensus** (cattlerange.com) — proprietary (The Cattle Range,
  Amarillo). Link out, license, or out-build your own sentiment measure later. Not free
  to take.

---

## 3. The Sell Call (herd-value card, decision mode)

**Not a separate screen. Not a calculator. Not a prediction.** It's the herd-value card
when a sale enters the rancher's region window.

- **Resting:** "You're worth $X."
- **Sale in window:** "You're worth $X today — sell into the sale or hold? →"

### PK's operation (the model that's actually true for him)
NLV **Early Summer Special** (≈June) vs **Summertime Classic** (≈late July). Both video,
both forward contracts for **fall delivery**.
- Carry is ~free (cattle on grass he's already grazing).
- Ship date doesn't move; delivery weight is the same in September either way.
- Slide + delivery weigh are **identical** between the two sales → they **cancel**.
- **Therefore it's a pure price bet.** Only variable = the $/cwt the hammer locks, ~5
  weeks apart.

### Honest output (never says "SELL")
Three things + the master switch:
1. **Where the market is** — comparable Region 1/2 read for his cattle.
2. **Momentum** — last few sales up/down (Superior Corn Belt → Week in the Rockies as the
   Region 1/2 proxy between the two NLV dates; plus NLV's own narrative direction).
3. **Base rate** — what this specific ~5-week window did the last few years.
4. **Cycle position** sets the default lean.

Output is a **risk-lean read**: "here's the field, here's where we are in the cycle, the
risk this year leans [down/up]." His call, fully armed. Same honest-degradation rule as
rainfall/USDM — arm the judgment, never fake the answer.

### CFO layer (what makes it advisor, not calculator)
On a pure price bet at record highs, surface the **split**: "lock part now, ride part to
July." Certainty on some, upside on some, no all-or-nothing gut-punch.

### Decision capture
The act of weighing the call records what he held, the market, and what he decided.
Next season the screen knows what he did and whether it paid. That's the compounding moat
— and he never felt asked.

---

## 4. Build order

**Block 1 — homepage subtraction (safe, do first, any architecture).**
Isolated to `FrontDoor.tsx` + `MarketsComingSoon.tsx`. None touch the dashboard.
1. News off the homepage (lives on dashboard).
2. Drought map off the homepage.
3. Remove stale "Coming soon → HerdEstimate" tile (it's built).
4. Rescope/cut "Driest counties" (currently CO/NC — not Cattle Country).
One change per commit, screenshot + smoke test between each.

**Block 2 — Operation Home restructure (rain sprint centerpiece, middleware-adjacent).**
Auth-checked herd value on top → money sequence (§1). Careful: preserves public-access +
middleware-redirect contract. Own recon, full smoke test after every commit.

**Block 3 — Market Read v1 (own-it pieces only).**
Feedlot-demand weather reframe + curated market-mover news, assembled as the first Market
Read section on the operation home. Zero new data acquisition.

**Fast-follows (free, gettable, after the sprint):**
Heifer-cycle (NASS Quick Stats) · RPI headline (monthly) · CME boards (Barchart free key
test → fall back to CME delayed-page scrape; daily settles only).

**Phase 2:**
Sell Call decision mode (lean on Superior proxy until own sale-history accumulates) ·
consign-and-deliver slide helper (base weight, shrink, weigh on-site vs. town, slide
fairness vs. cost-of-gain) · program-premium additive calculator (KSU/Merck/Superior
table; then own Region 1/2 numbers) · county-level "neighbor proof" video lots (needs
lot-level data within Superior ToS).

**Blocked:** Bullish/Bearish Consensus (license / link / out-build).

---

## 5. Governance (non-negotiable)

- **One change per commit**, each followed by the invariant smoke test: signed-in state
  detected everywhere · dashboard renders · marketplace opens · county search responsive
  (typing/selecting/Enter all navigate — the core action).
- **High blast radius:** Auth / SiteHeader / Supabase / middleware. The
  createServerClient→getUser() block in middleware is load-bearing for session refresh;
  both redirect branches re-attach refreshed auth cookies — don't break that.
- **Migrations:** PK runs ALL SQL himself; show full SQL for review first. Non-orphaning,
  order-independent. Flag any code that ships new values before the migration runs.
- **Honest degradation everywhere:** external fetches (ACIS, NWS, maps, video data) time
  out HONESTLY — "temporarily unavailable," NEVER a false empty/zero/deficit. Video data
  is episodic; in-season it's fresh, off-season it shows last-sale date and steps back.
- **Rollout rings:** nothing goes to the text wave until PK, dad, AND the build all agree
  it's right. Guinea pig = PK's own ranch + a real lot first. Recruit like a neighbor.

---

## 6. Parked decisions

- **Signed-out homepage hero** (drought vs. herd-value lead) — parked for the text-wave
  audience, post-sprint. Identity line candidates land against §0.
- **CME data source** — Barchart free-key allowance vs. CME delayed-page scrape.
- **Consensus indicator** — license / link / out-build.
- **County "neighbor proof"** — confirm lot-level Superior data is reachable within ToS.
