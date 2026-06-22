# Dryline — Market Read & Operation Home (Canonical Spec)

**This is the reference. Build from this, not from memory.** If a build decision isn't
answered here, stop and ask before guessing. Updated to capture the full plan — nothing
flattened.

---

## 0. North star

**"I make you money. I ask nothing of you."**

Three paychecks — the only reasons a feature ships:
1. **Money you're owed** — drought / LFP relief (home-county drought).
2. **Money from selling right** — the **Market Read** (a trusted interpretation, NEVER a
   sell/hold calculator).
3. **Money from doing right** — value-added program premiums.

**The hook is herd value, but it's a mix of the estimate and the money.** The making-money
*read* leads; the herd-value estimate is its foundation. (Dad settled this — see §1.)

**The moat** = trusted interpretation + a decision-and-outcome record that compounds every
season + a proprietary dataset from logged intentions/outcomes no competitor rebuilds from
public sources. Indispensability is *earned over seasons* ("the memory and judgment of your
operation"), never *claimed* on the landing page.

**Hard rule — no naked data entry, ever.** Every input pays the rancher back in that moment
(a number, a document, a sharper estimate). The record builds as a side effect of him
collecting paychecks. If a screen asks for something without paying back right there, it's
wrong.

---

## 1. Operation Home (the signed-in landing)

One screen = **the operation's money**, computed from two inputs: *what he runs* (herd) ×
*where he runs it* (county). Markets and herd are ENTANGLED — not two destinations, two
factors of one product (HerdEstimate = herd × cash; LFP = herd × county drought; Market
Read = herd × video/cycle/signals).

### Two zones
- **Operation zone (top) — constant, his.** The Market Read, herd value, LRP floors. Does
  NOT change when he looks at another county. His cattle didn't move.
- **Location zone (below) — county lens, defaults to home county.** Drought/LFP, deadlines,
  conditions, news. County selector lives *between* the zones; changing county updates ONLY
  the location zone.

### Sequence — DECISION-FORWARD (dad settled this)
Dad opens it for the *call*, not the number. He never reaches for "what's my herd worth";
he reads the field and forms a lean. So the **read leads; herd value is its foundation.**
1. **Market Read** — the risk-lean interpretation of the signal field for his situation,
   sale-window aware (§3). Lead surface. *Herd value sits beneath as the foundation the read
   is about (Value / Trend / Outlook = depth) — never a bare number on top with a separate
   "act" layer.*
2. **Money owed** — LFP relief (climbing-ladder tracker, serious-money display never a game);
   time-sensitive deadlines (FSA/RMA countdown).
3. **Conditions** — one map element, default USDM. All `layers.ts` layers = depth inside it
   (drought / LFP / LRP / hay / CPC / radar / wind). Weather lives here — it's conditions, it
   never shared a slot with news.
4. **News — dead last.** Highest volume, lowest decision value. Category filters within it.
   News never sits above his money.

### Principle: toggles are depth, not breadth
The default screen — zero taps — is the answer to "what's my situation." Every toggle is a
drill-down *within a card*, never a new destination. (Chime-style progressive disclosure.)

### Empty-herd state = onboarding = data flow
Herd is the *input*; a new user has no number yet.
- **No herd:** lead with "Add your first lot." Fill below with county-scoped things that work
  WITHOUT a herd (LFP, deadlines, conditions, news) — prove value before he invests anything.
- **Add a lot → operation zone wakes up.**

### Nav (deferred within Block 2, middleware-adjacent)
The operation home IS the herd, priced — so My Herd stops being a separate "go see your
value" destination. The herd tab becomes the **maintenance room** (add/edit lots, preg-check,
culls — editing inputs). Day-to-day he never navigates "to" his herd; he opens the app and
it's there. (Was buried far-left worst-thumb-reach; this fixes it.)

### HARD CONSTRAINT (from recon)
Dashboard is **public by design** (service-role reads, anonymous `?fips=` share links). So
the operation zone (Market Read + herd value) is an **auth-checked layer on top of a public
dashboard** — render it for signed-in users with lots; fall back to the county-scoped view +
sign-in CTA for everyone else. Do NOT auth-gate the dashboard. Do NOT break the middleware
redirect (`/` → `/dashboard?fips=<home>`). Reusable: `estimateHerd`/`buildTrend`/`buildOutlook`
in `lib/`, `HerdEstimatePanel` presentational/drop-in.

---

## 2. The Market Read — the signal field (dad's full framework)

Dad doesn't compute. He reads a **field of signals**, locates the **cattle-cycle position**
(master switch), and forms a **risk lean**. The product is the market read of the sharpest
operator you know, on one screen, so a rancher who can't do what dad does gets his read.

### Master switch — cattle cycle position (sets the default lean)
- More heifers in the feedlot vs prior year = NOT a growth phase. Fewer heifers in =
  developing into mama cows = growth/rebuild phase.
- Source: USDA Cattle on Feed / heifer numbers (NASS). Cross-confirmed in Superior/NLV by
  more/fewer heifers offered and, by weight & presentation, whether they're headed to harvest
  or to development lots.
- Current: "not retaining heifers yet, good point in the cycle" → at record prices, lean is
  more downside than upside.

### Dad's complete decision process (in his order)
0. **GATE — feed/pasture.** Can I carry them to a saleable weight at all (Sept/Oct/Nov)? If
   no, the question's moot. Precondition, not a market signal.
1. **The feedlot's state of mind.** Are feeders long or short on corn? Anxious to fill pens or
   cautious? Interest rates, fuel — the buyer's cost of doing business and appetite. (This is
   the corn/feedlot-demand chain — see §4. CENTRAL.)
2. **Load-lot & destination.** Estimate weight, build truckload lots, pick states — weight
   limits differ (some take >60,000 lb loads, some don't); aim at states where corn is good
   (buyers there will bid).
3. **The boards (CME).** Corn, soy, wheat (grain drags grain; grain up → cattle down); live
   cattle (what feeders get for the finished product); feeder contracts (buyers hedge even
   though we're cash). Which board a buyer chases changes whether they want heavy or light
   calves.
4. **Heifers timing.** Sell later so developers (who buy heifers to develop into bred stock)
   are ready — later is when they buy, having a feel for next spring's bred market.
5. **Sentiment.** Bullish/Bearish Consensus ("cattle & corn," cattlerange.com) — past the red
   line = over-optimistic, a contrarian flag. Restaurant Performance Index = beef demand at
   the consumer end.
6. **Macro/headlines.** War, oil up/down, imports, **exports** (BIG — foreign beef loading in
   can kill it fast). All move the CME.
7. **Disease/supply headlines.** Screwworm (now); foot-and-mouth in competitor beef countries
   (South America, Australia, NZ, Europe).

### Dad's morning five (what he opens, in order)
1. **CME boards** — cattle first (live + feeder), up/down/sideways; grains underneath.
2. **Weather** — where's drought, where's moisture (= the feedlot-demand read, §4).
3. **Beef demand / consumer mood** — steak vs. trade-down to chicken/pork; economy, gas.
4. **Exports/imports** — "top part too."
5. **Disease/supply headlines** — screwworm, FMD.
With **cycle position** as the master switch above all five.

---

## 3. The Market Read as the lead surface — NOT a Sell Call, NOT a calculator

The lead surface is a **risk-lean interpretation** of the field for the rancher's situation.
It does NOT compute a sell/hold answer, does NOT pose "sell or hold?", does NOT predict a
price, does NOT recommend an action (no "lock part / ride part," no two-pan scale). It
surfaces the *read* and the rancher pulls the trigger.

### Honest output
"Here's the field, here's where we sit in the cycle, the risk this year leans [down/up]."
Dad's example output: record prices, more downside than upside, no reason to wait. A *lean* —
never the word "SELL," never a dollar verdict. Same honest-degradation rule as rainfall/USDM:
arm the judgment, never fake the answer. **Success = "it informed a real call on real
cattle," NOT "the screen made the call."** Do not reintroduce calculator behavior — that's
the thing we killed.

### Decision capture (the moat)
When the rancher acts on the read, the screen records what he held, the market, and what he
decided — never a data-entry chore, always a side effect. Next season it knows what he did and
whether it paid.

---

## 4. The corn / feedlot-demand chain (the heart — do NOT flatten to "weather")

Dad's feedlot-demand read is a **causal chain**, computable from data we already own:

> **Corn Belt moisture → big corn crop → cheap feed → feedlots flush, MUST fill pens →
> bullish for your calves.** Inverse: Corn Belt drought → short crop → dear feed → feedlots
> cautious → bearish. ("If they're getting a lot of rain, they're making a lot of corn, and
> they gotta feed that corn to something.")

Dad sources it from fertilizer/chemical dealers and feedlot contacts in the Corn Belt, but
LARGELY from watching weather: where drought is, where good moisture is, where good crop
numbers are — rainfall indexes for the areas where the feedlots are.

### THREE LEGS, sequenced by lead time (this sequence IS the read)
The chain decomposes into three data legs with different lead times. Don't pick one — show
all three, ordered leading → confirming → priced. When all three agree, high-confidence
lean; when they diverge, honest "mixed." (This RESOLVES the old open question of "rainfall
vs NASS condition": dad reads rainfall as the leading edge, condition confirms it a week or
two later, the board says what's already priced in. Sequence, don't choose.)

- **Leg 1 — Moisture (LEADING). We already own this. Zero new acquisition.** Our USDM drought
  layer + PRISM/ACIS precip-anomaly data are already national → re-aim the bounding box at the
  feeding states. "Is the Corn Belt making rain right now," the thing dad reads first. The
  east/west Corn Belt split is the signal (western CB dry vs eastern CB wet shows up directly
  in the precip layer).
- **Leg 2 — Crop condition (CONFIRMING). Free, and it's a MAP LAYER.** USDA NASS corn
  good+excellent %, via the **Quick Stats API** (free key, JSON — the SAME rail as the
  heifer-cycle data). Released ~4:00 PM the first business day of each week, **April–November
  only** (seasonal). Headline = good+excellent % with week-over-week and vs-last-year deltas
  (state-level: IA, IL, NE, etc.). PLUS a geospatial option: NASS **Crop Progress & Condition
  Gridded Layers** — 9km synthetic county-level corn condition, weekly geoTIFF, with a clean
  numeric index `Condition = (5·E + 4·G + 3·F + 2·P + VP)/100` (range 1–5). This is a
  CHOROPLETH — it drops into our existing `layers.ts` map registry exactly like a drought
  layer, aimed at the Corn Belt.
- **Leg 3 — Price (PRICED-IN). Free, on our existing cron rail.** Corn futures (ZC) daily
  settles — CME delayed settlement pages or Yahoo `ZC=F`. Fetch via GitHub Actions →
  Supabase, the EXACT pattern the news cron already uses. Daily settle is enough; no
  intraday, no paid tier.

### Bonus tie-in to our weather data: NASA soil moisture, gridded
**Crop-CASMA** serves NASA SMAP soil-moisture + MODIS vegetation as gridded layers for US
corn/soybeans — the literal made-visible bridge between "rain" (Leg 1) and "crop" (Leg 2).
Another raster layer next to our drought layer, same map engine. (Fast-follow, not v1.)

### How to SHOW it (the recommended design — read leads, map is depth)
NOT a corn dashboard. The same Zillow move as the herd anchor: one interpreted line on top,
evidence + map as depth.
- **Lead line (the read):** "Feed's getting cheap in the Corn Belt — that's pulling feeder
  demand up" / inverse / "mixed." Dad's interpretation, never a number, never a sell/hold.
- **Evidence chips beneath:** moisture / crop / price — each shows direction + freshness
  (e.g. "Corn Belt wetter than normal" · "corn 68% G/E, +1 wk / −4 yr" · "Dec corn soft").
- **Drill-down:** tapping opens the **re-aimed conditions map** — our existing map engine
  recentered on the Corn Belt, with corn-condition (and later SMAP soil-moisture) as new
  layers alongside the drought layer. The map is the proof a skeptic (dad) can open and check.

**Why this is the moat in one sentence:** two of the three legs are our existing data
re-pointed, and the third rides our existing cron — and nobody else interprets Iowa's rain as
Montana's calf price, because nobody else already has the map to show it.

### Honest degradation for the corn read
- Leg 2 (NASS) is seasonal (Apr–Nov). Off-season the read leans on moisture + price and SAYS
  so ("crop condition resumes in April"). Never fake a stale G/E number.
- Each leg shows its OWN freshness independently.
- When the three legs diverge, the read says "mixed" — never manufacture false confidence.

### v1 build (Slice 2) vs fast-follow
- **v1 (own-it-now):** Leg 1 (re-aimed moisture, existing data) + Leg 3 (ZC daily settle via
  existing cron) → a v1 lead line + two evidence chips. The corn-condition leg can start as
  the NASS good+excellent *number* (Quick Stats) even before the gridded choropleth layer.
- **Fast-follow:** NASS gridded corn-condition choropleth layer in the map; Crop-CASMA SMAP
  soil-moisture layer; richer week-over-week condition deltas.

### Feeding-country scope (RESOLVED by dad — the re-aim footprint)
Wider than the classic Corn Belt. Dad's read covers **wherever the feeders are**: Northern
Plains + Corn Belt + Colorado + into the Southern Plains. Concretely the re-aim bounding
box / NASS state list:
- **Northern Plains:** MT, ND, SD, NE, WY
- **Corn Belt:** IA, IL, IN, MN, MO, OH, KS
- **Colorado:** CO
- **Southern Plains (feedyard country):** OK, TX (Panhandle), and into eastern NM as relevant
This is the demand-region footprint for the moisture re-aim (the USDM/precip bounding box) AND
the NASS corn-condition state list. The read isn't "is Iowa wet" — it's "across feeder
country, where is feed cheap." Note many of these states overlap the home-county/LFP geography
(MT/ND/SD/NE/WY) — same data, different LENS: home county → money owed; feeding region →
feeder demand (§5). Do not conflate the two reads even though the map data overlaps.

---

## 5. Two droughts, two paychecks (do NOT conflate)

Same precip/USDM pipeline, two geographies, two completely different jobs:
- **Home-county drought** → **money owed** (LFP, his own pasture/grazing). Location zone.
- **Corn-Belt drought** → **selling right** (feeder demand, §4). Operation zone / Market Read.

I previously mushed these together. They are separate signals serving separate paychecks.

---

## 6. Program premiums — money from doing right (Phase 2)

Answers dad's "do these programs even do anything." KSU/Merck/Superior publish an annual
additive per-trait premium model off the Superior database (2024: 851,181 calves, avg
$2.94/lb) — traits sum.

Figures (with sources): VAC45 preconditioning ~$8.46/cwt (~$48/head on 570#) · NHTC ~$37/head
· GAP ~$25/head · age & source ~$1–2.75/cwt · uniformity "fairly even" +$1.14/cwt (~$25/head),
very uneven −$3.29/cwt · frame medium+ ~+$22/head · continental ~−$10/head vs English.

Feature: an additive "what's my program worth" calculator — rancher checks programs he runs/
could run → premium per cwt and per head. Then net against cost (NHTC/natural are costly,
not worth it for small herds that can't assemble a load lot). **Premium minus cost = advice,
not a brochure.** Moat: program flags are already in the Superior lot data we ingest → compute
own Region 1/2 premiums over seasons.

---

## 7. Video auction mechanics + PK's NLV situation

### PK's actual decision (context for why his read leans down — NOT a calculator)
NLV **Early Summer Special** (~June 19–20) vs **Summertime Classic** (~late July 21–23). Both
video, both forward for **fall delivery**. Free grass carry; ship date doesn't move; delivery
weight same in Sept either way; slide + weigh **identical** between the two → they cancel. So
the only variable is the $/cwt the hammer locks ~5 weeks apart — a pure price read. At record
highs with the cycle where it is, lean = more downside than upside.

### Momentum proxy
NLV is episodic. Use Superior Region 1/2 as the between-sales proxy: Corn Belt Classic
(Jun 16–17, ~74k head, summer launch) → Week in the Rockies (Jul 6–10, Region 1/2), plus NLV's
own narrative direction. Region 2 = MT, WY, ND, SD, NE, CO, UT (PK's geography = Region 1/2).

### Mechanics (for the Phase-2 consign-and-deliver helper)
Forward contract; at hammer the contract fixes base weight + price/cwt + slide + delivery
window + shrink. Slide ~$5–10/cwt, right-side (kicks in as cattle come heavier than base). Pay
weight = delivery scale weight − pencil shrink (2–4%). Weight stop = pounds over a cap are free
to buyer. Slide window = band around base where slide doesn't apply. NLV: $100/head down at
hammer, balance at delivery. Delivery weigh: on-site vs. haul to town (travel shrink cuts pay
weight — on-site protects pounds). Seller may watch the weigh, request reweigh/zero-check;
video scales tested twice yearly, legal-for-trade. Slide is fair when ≈ market discount for
heavier cattle (cost-of-gain test: add weight cheaper than the slide docks → slide's in your
favor). Three labeled price streams, never blended: `barn_spot`, `current_video`,
`forward_video` (~$5/cwt video uniformity premium over barn).

---

## 8. County "neighbor proof" (Phase 2)

Freight is ALREADY in the regional number (Region 1/2 = freight position) — county granularity
buys *neighbor proof*, not freight correction. Don't compute a county average (episodic sales →
2 lots or 0 → false precision). Surface actual nearby lots as proof: "a load of 550# steers out
of Lustre, 38 mi, brought $X." Lot-level city lives in Superior catalog/results (web), not the
clean MARS API; city→county mapping is trivial (Census table). Needs lot-level data within
Superior ToS.

---

## 9. Off-season value — the year-round spine

A seasonal product that goes dark in winter trains ranchers to forget it. The **herd record is
the persistent spine.** Spring/summer = sell-side intelligence; fall/winter flips to
*plan-and-prove*:
- **Banker package** — operating-loan renewals are winter; a clean herd + value + drought +
  production sheet for the lender. Recurring annual value.
- **Tax window** — they just cashed record checks; deferral, prepay, §179, retain-vs-sell. Give
  numbers (not advice) when they have money and time.
- **Hay & winter feeding** — winter IS hay season; the hay marketplace lives here.
- **Rebuild decisions** — retain heifers, buy bred cows; value bred females, model it.
- **Next-year risk & water** — snowpack, soil moisture, ENSO; LRP for the next calves.

Sticky habit = keeping the herd inventory current (preg-check, culls, retained heifers) = the
decision-capture data that sharpens next year's estimate. Off-season solves itself once the
herd record is the heartbeat.

---

## 10. Gettability (research, settled)

| Signal | Source | Status |
|---|---|---|
| Feedlot demand (corn chain, §4) | EXISTING precip/USDM re-aimed at feeding states | **OWN — SPRINT** |
| Market-mover news (exports/imports, disease, economy) | EXISTING news feed, curated/filtered | **OWN — SPRINT** |
| Corn crop condition | USDA NASS, free, same rail | FREE FAST-FOLLOW |
| Cattle cycle (heifers on feed) | USDA NASS Quick Stats API — free key, JSON, MARS-style | FREE FAST-FOLLOW |
| RPI (beef demand) | restaurant.org, free monthly headline, no API (paid TrendMapper for detail) | FREE FAST-FOLLOW |
| CME boards (LE, GF, ZC, ZS, ZW) | Barchart getQuote (free tier uncertain/likely paid) → fallback CME free 10-min delayed pages; **daily settles only** | FAST-FOLLOW |
| Bullish/Bearish Consensus | cattlerange.com — proprietary (The Cattle Range, Amarillo) | **WALLED OFF** — link/license/out-build |

---

## 11. Data architecture (existing rails — respect them)
- **MARS/USDA**: Basic-auth cron; `mars_price_history` append-only. Add `channel`
  (barn_spot/video_current/video_forward) + `region` tags.
- **News**: cron→Supabase via GitHub Actions (Vercel egress is bot-walled; Actions isn't),
  ~11 RSS feeds, `/api/news` reads table with live-fetch fallback. Locality is state/regional,
  not county.
- **Drought**: Thursday USDM cron. RLS enabled on all tables; service-role architecture.
- **Honest degradation everywhere**: external fetches (ACIS, NWS, maps, video) time out
  HONESTLY — "temporarily unavailable," NEVER a false empty/zero/deficit. Video data is
  episodic — in-season fresh, off-season shows last-sale date and steps back. NLV (slug 2772,
  ~98.6% MT) can't anchor the live-price card; a frequently-updating weekly/regional report is
  the primary anchor, NLV the seasonal secondary.

---

## 12. Homepage / beacon

Landing ≠ dashboard. Landing makes ONE promise + ONE action; dashboard shows everything. The
beacon: identity line → hook (county search / two-tap estimate) → sign in. "A second grader
could use it." Zillow model: the free public estimate is the wedge (give it away, bound it
honestly with "≈"/range); the precise *tracked* version is the signup unlock. Identity must say
operating system / profitability cockpit, not "herd calculator" — "what you have, what it's
worth, what you're owed, what to do next" (also the filter for every future feature).

**Block 1 — DONE on main, verified:** news off, drought map off, coming-soon section off (whole
section, not just the herd tile). **Driest-counties chips: LEFT AS-IS** (work for the actual
audience; logged future tweak = scope the national fallback to Cattle Country states). Front
door = headline → county search → chips → Example HerdEstimate → sign in.
**Parked:** signed-out hero (drought vs. herd-value lead) — for the text-wave audience,
post-sprint.

---

## 13. Build order

- **QA harness** — DONE (8/8; `/.qa/` seed-auth + screenshots, localhost storageState).
- **Spec** — this file.
- **Block 1 (homepage beacon)** — DONE on main.
- **Block 2 — Operation Home restructure** (rain-sprint centerpiece, middleware-adjacent).

  **Current dashboard IA (from live walkthrough of `/dashboard?fips=X`, public/anon):**
  Fixed top — county selector → county heading + Share / "Sign in to watch" → LFP status
  card → Insurance-deadlines card. Then a **breadth toggle, News-default**:
  • News (`view=news`): Cattle Country feed, All/Prices/Conditions/Herd filters, tiered local.
  • Weather (`view=drought`): Latest Reading + 3-yr drought ribbon → Rainfall-vs-Normal + YTD
    + honest station caveat → 7-day forecast carousel → map with 6 layers (Radar / Drought
    Monitor / Observed Rain / Forecast Rain / Rain Outlook / Drought Forecast).
  • Hay (`view=hay`): hay-score choropleth (Hay score / Drought Monitor) + marketplace.
  • Markets (`view=markets`): **LRP only today** — $/cwt floor, national-index caveat,
    sale-month endorsement-window selector. This is the slot the Market Read mounts into.
  The public dashboard IS the location zone already. No operation zone (herd value) exists
  on it yet — "Sign in to watch" is the un-built hook for exactly that.

  **The Zillow principle (the genius path, not a rewrite).** Zillow led with the Zestimate,
  then layered "is it a good time to sell" → comps → market temp ON TOP, over years, on one
  decision-sequenced page — never a "news view vs value view" toggle. Dad is the same: he
  opens it for the *call*, value is what the call is about. So: **the toggle survives as a
  MECHANIC (depth inside cards: Now/Trend/Outlook, the 6 map layers, news filters) and dies
  as an ARCHITECTURE (four peer destinations, news-default).** Breadth-toggle dissolves into
  the money sequence; depth-toggles stay everywhere. Do NOT bury the decision layer inside
  the Markets tab (buries dad behind tab 4 while News lands first). Do NOT big-bang rewrite
  the highest-blast-radius surface. Layer onto the working location zone the way Zillow
  layered onto a working Zestimate.

  **Three additive slices (commit order — each ships and earns its keep alone):**
  - **Slice 1 — mount the operation zone on top (keystone).** Signed-in user with a herd:
    render the herd-value anchor ABOVE the county results (reuse estimateHerd/buildTrend/
    buildOutlook + HerdEstimatePanel — already built). Auth-checked layer above the existing
    public path; do NOT touch middleware or the anonymous `?fips=` flow. This is the
    Zestimate moment — dashboard becomes "your operation, valued." Lean into "watch this
    herd" (= Zillow "track this home").
  - **Slice 2 — Market Read above the value.** v1 = cycle position (NASS) + feedlot-demand
    corn read (§4, existing drought data re-aimed at feeding states) + curated market-mover
    news, assembled as dad's risk lean (§3 — a read, never a sell/hold output). The
    interpretation layer on TOP of the number. The moat.
  - **Slice 3 — dissolve the breadth toggle into the sequence.** Location zone re-sequences:
    conditions = one card (6 layers as depth); the feedlot-demand half of weather pulls UP
    into the Market Read where it belongs; news drops to dead last; Markets/LRP folds into
    the value's Outlook. Four tabs → one money-sequenced scroll.

  Each slice: own recon, one change per commit, full smoke test, Vercel preview + proof.
  Preserves public-access + middleware-redirect contract throughout.
- **Block 3 — Market Read v1 (own-it only)**: the §4 corn/feedlot-demand chain (precip/USDM
  re-aimed at feeding states + corn crop condition + corn board) + curated market-mover news,
  assembled as the first Market Read section. Zero new data acquisition for the core.
- **Fast-follows**: corn crop condition (NASS) · heifer-cycle (NASS) · RPI headline · CME
  boards (Barchart key → CME scrape fallback, daily settles).
- **Phase 2**: Market Read v2 (regional video momentum + cycle woven into the read — still a
  read, never a sell/hold output) · consign-and-deliver slide helper (§7) · program-premium
  additive calculator (§6) · county neighbor-proof (§8) · off-season plan-and-prove surfaces
  (§9).
- **Blocked**: Bullish/Bearish Consensus (license / link / out-build own sentiment).

---

## 14. Governance (non-negotiable)
- **Recon first, always.** Then one change per commit + invariant smoke test (signed-in state
  everywhere · dashboard renders · marketplace opens · county search responsive — typing/
  selecting/Enter all navigate).
- **Vercel flow**: branch → push → PK verifies the preview → explicit go → Claude Code merges →
  **PROOF on every merge** (`git log origin/main | grep <hash>` present + grep the change is
  on main). Never trust a "done" message without proof.
- **High blast radius**: Auth / SiteHeader / Supabase / middleware. The
  createServerClient→getUser() block in middleware is load-bearing for session refresh; both
  redirect branches re-attach refreshed auth cookies — don't break that. PWA cold-launch lands
  on /dashboard via middleware.
- **Migrations**: PK runs ALL SQL himself; show full SQL first; non-orphaning, order-
  independent; flag code that ships new values before the migration runs.
- **Rollout rings**: nothing to the text wave until PK + dad + the build all agree. Guinea pig
  = PK's own ranch + a real lot first. Rings: small text wave (10–20 with the problem) →
  personal FB → ag/hay FB groups → wider. Don't skip a ring, don't blast wide, don't gate on
  building social handles. Recruit like a neighbor.
- **Feedback**: analytics = shallow (WHAT); conversation = deep (WHY). When PK refreshes a
  metric, redirect to talking to users.
- **The "one more fix" loop** is PK's failure mode (building to avoid users). THIS sprint is
  responsive to dad — the benchmark user, daily, on PK's own ranch — so it's real, not phantom.
  Don't claim "can't live without"; build the dependency and let it accrue.

---

## 15. Open questions (confirm with dad)
1. Corn read (§4): RESOLVED — sequence all three legs leading (moisture) → confirming (NASS
   condition) → priced (ZC); don't choose between rainfall and condition.
2. Feeding-country scope (§4): RESOLVED — wherever the feeders are: Northern Plains (MT/ND/
   SD/NE/WY) + Corn Belt (IA/IL/IN/MN/MO/OH/KS) + CO + Southern Plains (OK/TX Panhandle/E.NM).
   This is the re-aim bounding box + the NASS state list.
3. Anything else in our existing data already feeding the feedlot-demand read?
4. Sequencing confirmed decision-forward (read leads, value foundation) — re-confirm once he
   sees it live.

---

## 16. Housekeeping
- Dead branches to delete: `homepage-subtraction`, `homepage-2-remove-drought-map`,
  `homepage-3-remove-coming-soon` (merged), `homepage-3-remove-herdestimate-tile` (superseded).
- Pre-existing lint wart: `react-hooks/set-state-in-effect` in `MarketsComingSoon.tsx`
  (~line 52 on main), doesn't block builds — its own future dedicated cleanup commit, never
  bundled into another change.
