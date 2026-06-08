@AGENTS.md

# Dryline — Project Bible

## What this is
Drought + FSA program dashboard for ranchers at dryline.farm.
Stack: Next.js 14, TypeScript, Tailwind v4, Supabase/Postgres, Vercel.
Solo build — one rancher, one AI, Claude Code. Research → Confirm → Build, one prompt at a time.

## The flywheel (the whole strategy in two sentences)
Engine A: Drought + money engine — knows per-county drought state, LFP tier, estimated FSA payment.
Engine B: Hay network — drought-aware two-sided marketplace, matched by haul distance.
The drought data feeds the hay matching. The hay network makes the product viral. They spin together.

## The four engines — build in this order
1. Money Engine (mostly built) — drought dashboard + LFP eligibility + push alerts. Finishing now.
2. Hay Network — lean listings + drought-driven matching + haul-distance ranking. No payments day one.
3. Operation Ledger — equipment (Fleet Command V9), seed (Seed Rate Bible), spray (Spray Rate Brain), payout history. Added after acquisition, as the switching-cost depth layer.
4. Insurance Brain — PRF rainfall-index grid modeling, rancher-facing.

## Current phase
Sprint 1 — COMPLETE
- Hay listing detail page at /hay/[id]
- Schema v2: cutting, bale type, bale weight, storage, forage
  test fields (protein, TDN, moisture, RFV)
- Richer listing cards with quality badges
- Expanded post form with forage test section
- Single listing API at /api/hay/[id]

Sprint 2 — COMPLETE
- Triggered dashboard banner (forest-green, payment estimate,
  FSA checklist scroll)
- Pulsing trigger indicator on LFP tier badge
- Hay nearby card on dashboard (haversine-filtered, D2+ context)
- Dynamic homepage chips showing top 6 driest counties live

Sprint 3 — Trust architecture (active)
- Verified phone for sellers (SMS verification before first post)
- Member since + listing count on seller profiles and detail pages
- Post-transaction buyer review system (1-5 stars)
- Hay test verified badge (seller uploaded lab results)
- Multi-county ops view on watchlist (combined payment estimate,
  sortable table, alert preferences per county)

## Weather + map sprint — COMPLETE (current state)

### Regional map layers (the toggle below the map)
- 6 layers in a clean 2×3 toggle grid (`grid grid-cols-3`, in RegionalMapClient): Radar · Drought Monitor · Observed Rain · Forecast Rain · Rain Outlook · Drought Forecast. (alerts is registered but `inToggle:false` — radar overlay only.)
- **RasterLayerView is the shared renderer** for all raster layers. Adding a raster layer = **+1 def in layers.ts + 1 `/api/layers/<id>` proxy**, 0 renderer changes. RasterWindow/RasterLayer support per-window `service` override, `defaultZoom`, `defaultWindow`, `legendTitle`, `asOfPrefix`, and per-horizon proxy metadata (`{issued, valid}` keyed by `window.key`).
- Export-tile path (`ArcgisExportTiles`): dynamic ArcGIS MapServers are export-only; we subclass L.TileLayer and build per-tile `export` URLs with `imageSR=3857`, so non-3857 services reproject server-side and align with the county grid. Tiles load `<img>` direct from NOAA; the proxy only returns availability + as-of/issued.
- The layers:
  - **Observed Rain = % OF NORMAL** (not raw inches): obs/rfc_qpe Image sublayers **227** (30-day) / **235** (90-day). Diverging legend, dry-at-top, EXACT service hex (warm=below normal/short, gray ≈100%, cool=above/surplus). Framing "Precip vs normal · % of normal · as of {date}". Tab still labeled "Observed Rain". (Inches sublayers 68/76 are no longer used.)
  - **Forecast Rain** = WPC QPF (vector/precip/wpc_qpf), windows Next 24hr/3-day/7-day (L1/9/11), inches.
  - **Rain Outlook** = CPC 6-10 day + monthly PRECIP tilt (outlooks/cpc_6_10_day_outlk L1, outlooks/cpc_mthly_precip_outlk L0). Seasonal precip excluded (≈98% equal-chances over MT = empty). Diverging tilt legend; EC = transparent (hollow swatch).
  - **Drought Forecast** = CPC monthly + seasonal DROUGHT direction (outlooks/cpc_drought_outlk L1 monthly / L4 seasonal). Categorical legend (Develops/Persists/Improves/Removal/No drought). fcst_date is "MM/DD/YYYY" (not epoch ms).
- The old static bottom "Forecast" accordion (CPC drought *images* from official_maps) was **REMOVED** — superseded by the Drought Forecast map layer. The official_maps cpc_monthly/cpc_seasonal rows + cron still ingest but are no longer rendered.

### Latest Reading card — unified timeline ribbon
- Rebuilt as one card (`LatestReadingCard.tsx`): **hero** (current category + one "% in drought" number, from reliable DB `latest`) + **weekly 3-year color ribbon** (USDM hex, 1-yr tick) + **one summary line** ("Worst: D{n} · {season year} · in drought N of last M months").
- `threeYearHistory` (weekly USDM API, statisticsType=2) feeds the ribbon; hero degrades **independently** of the ribbon (ribbon → "3-year history unavailable" on API fail, hero still renders).
- The old 52-week + 3-year history accordion/charts were removed (`DroughtTrendChart.tsx` + `DroughtHistoryChart.tsx` deleted). `history` (52-wk drought_data) still gates the lower dashboard.

### NOTE for future work
PK plans to eventually render the map from **RAW DATA with custom color scales** — the current toggle / layer registry / export-tile system is **TRANSITIONAL scaffold** that will be replaced. Don't over-invest in it (e.g. no toggle-grouping restructure; 6 flat tabs is an accepted temporary state).

## Acceptance criteria on every feature
- Works from the tractor cab on one bar of 3G. Required on every PR, not a someday project.
- Offline-first: service worker + local cache of operation profile, FIPS data, last-known county conditions. Sync deltas on reconnect.
- Every current condition carries a visible as-of timestamp. Stale cache never lies.
- Plain language, big tap targets, readable in direct sun.

## What not to build
- No SMS until email alerts prove demand.
- No payments or escrow in hay until listings + matching has real liquidity.
- No predictive engine until there is historical data to make it honest.
- No equipment/seed/spray ledger until hay network is live.
- No native app — offline-first PWA owns the cab.
- No general farm-management sprawl. Stay on drought-money + hay + operational-memory spine.

## Truth metrics
- Alert to action rate: of ranchers texted triggered + estimated payment, how many engage.
- Hay match rate: listings that result in a real buyer/seller connection.
- Counties watched per operation.

## Design system
Colors: forest-green #1B4332, cream #FDFBF7, rust #8B3A2B, USDM D0-D4 scale.
Fonts: Fraunces headings, DM Sans body.
Tailwind v4 CSS-based config in globals.css. All containers max-w-6xl.
Tone: plain-spoken, trusted neighbor. Not pitch language.

## Data sources confirmed working
- USDM consecutive weeks: usdmdataservices.unl.edu/api/ConsecutiveNonConsecutiveStatistics/GetConsecutiveWeeksCounty
- USDM 3-year history: usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent?statisticsType=2 (weekly; feeds the Latest Reading ribbon)
- ACIS precip vs normal: station-based (the rainfall-vs-normal *graph*; distinct from the map's % - of - normal raster)
- NWS Local Discussion: 2-step /points/{lat},{lon} then /products/types/AFD/locations/{cwa}/latest
- NWS 7-day forecast: lib/nws.ts getLocalForecast (points → gridpoint /forecast; parses temp + precipProbability + wind)
- Map raster services (NOAA mapservices.weather.noaa.gov, all export → imageSR=3857): obs/rfc_qpe (Observed Rain % of normal, L227/235), vector/precip/wpc_qpf (Forecast Rain), outlooks/cpc_6_10_day_outlk + cpc_mthly_precip_outlk (Rain Outlook), outlooks/cpc_drought_outlk (Drought Forecast)

## FSA LFP rules verified against NDMC FSA tool
- OBBBA tiers 1-6 active from July 2025.
- Tier 1: D2 4 or more consecutive weeks = 1 payment.
- Tier 2: D2 7 of any 8 consecutive weeks = 2 payments.
- Tier 3: D3 at any time = 3 payments.
- Tier 4: D3 4 or more weeks = 4 payments.
- Tier 5: D4 at any time = 4 payments.
- Tier 6: D4 4 or more weeks = 5 payments.
- Pre-period clipping fix is in and matches NDMC tool exactly.
- Always disclaim: FSA makes the final determination.
