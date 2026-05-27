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
Phase 1 — COMPLETE
- Supabase magic-link auth, shared SiteHeader, profiles table
- Operation profiles with operations table
- Watchlist migrated to authenticated user_ids
- Push alerts via Resend with per-release dedup (alert_sent table)
- Cron scheduled Thursdays 17:00 UTC to match USDM release day
- vercel.json wired, all migrations run

Phase 2 — COMPLETE
- hay_listings table + hay_alert_sent dedup table (migration 003)
- GET/POST/DELETE /api/hay with auth, drought tier badge, mine flag
- /hay page: two-tab board (For Sale / Wanted), inline post form, county search, haversine distance
- checkHayMatchAlerts() in lib/hay-service.ts: D2+ detection, 200-mile haversine match, Resend plain-text alert, per-listing-user/county/week dedup
- Wired into Thursday cron via Promise.allSettled (non-fatal)
- Hay nav link in SiteHeader

Phase 3 — Operation Ledger (next)
- Port Fleet Command V9 equipment data into Dryline as the operation equipment ledger
- Service log per piece of equipment
- Seed Rate Bible and Spray Rate Brain as operational memory modules
- Payout history: record each LFP alert sent as a payout event on the operation
- The switching-cost depth layer — this is what makes leaving hurt

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
- USDM 3-year history: usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent?statisticsType=2
- ACIS precip vs normal: station-based
- NWS Local Discussion: 2-step /points/{lat},{lon} then /products/types/AFD/locations/{cwa}/latest

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
