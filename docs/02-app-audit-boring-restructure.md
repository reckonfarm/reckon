# DRYLINE — APP AUDIT & THE BORING RESTRUCTURE (July 21, 2026)

**Full audit of dryline.farm against the three-noun hardware vision. Verdict: the bones are right — a pruning + two tables, not a rewrite. Recon-first: Claude Code walks the real repo before any cut executes.**

## KEEP (earns its screen)
- **Decision log** — intended as the events-ledger spine (NOTE per Jul 26 recon: not yet built; the events table becomes its first home). All hardware events merge into the Activity feed beside it.
- **LFP calculator + honesty model** — real, differentiated, drives push reports.
- **Market Read chips (4)** — calm one-glance judgment.
- **NWS weather carousel** (Haley's spec) — daily-use gravity.
- **Leaflet map platform** — PROMOTED: the drought-county map is the platform for ranch places, field polygons, device pins, bale dots. Biggest reuse win.
- Auth / middleware / Playwright suite — untouched, high blast radius, working.

## CUT / PARK (Elon deletions, via feature flags — disable, don't delete)
- **News pipeline** — demote to a 3-headline card; do NOT leave a blank default view (make Today the new landing).
- **Marketplace** (/hay/*, /radar, /sellers, /api/hay/*) — flag OFF, hide from nav.
- **Messages** (/messages, /api/threads/*, messaging-service, unread badges in SiteHeader + BottomTabBar) — flag OFF; this also silences the per-nav /api/threads/unread fetch.
- **Moisture tab sprawl** → ONE page (the Regional map's 6-layer toggle, already flagged "transitional scaffold" in CLAUDE.md).

## THE SHAPE — four tabs, forever
1. **Today** — chips + weather + glance + latest activity (LFP/tools as cards). THE NEW DEFAULT LANDING VIEW.
2. **Map** — counties + places + live device pins
3. **Activity** — merged ledger: decisions + hardware events + alerts, one feed
4. **Devices** — registry: every puck/tank/kit — battery, last-seen, calibrate
Every future product = a new device TYPE in the same four screens. The app never grows another tab.

## THE SCHEMA — three tables
- `devices` (id, type, name, place_id, battery, last_seen, fw_version)
- `events` (id, device_id, type, ts, lat/lng, payload jsonb, schema_version)
- `places` (polygons: fields, tanks, stackyards)
Tank webhook → one edge function → events. Courier → one insert → events. RLS per ranch. Missions table only when a machine exists. No new architecture per product, ever.
Existing analogues to mirror: operation_profiles (jsonb payload, promote to typed column only when queried) and herd_estimate_history (owner-read RLS, server-authoritative).

## THE COURIER (mobile, September)
Expo, THREE screens: Pair · Sync (background BLE → Supabase) · Feed Mode. No dashboards on the phone — the responsive web app is the phone view. Business logic never lives in the App Store.

## PURGE-FIRST SEQUENCE (framework before building)
Block 0 recon → Block 1 THE PURGE (flag marketplace + messages off, news → card + Today default, moisture → one page; one commit each, smoke test each) → S1 three-table schema (PK runs SQL) → S2 tank webhook + Devices v0 → S3 merged Activity feed → S4 Map places layer. Courier + Feed Mode = September.

## ELON VERDICT
Requirements less dumb (app = ledger + glance + courier, not portal) · parts deleted (news cron, marketplace, messages, tab sprawl) · radical reuse (map, auth, Supabase carry into the hardware era — pivot costs weeks) · automate last. The boring app was mostly already built — it was wearing four extra screens.
