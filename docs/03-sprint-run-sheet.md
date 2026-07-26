# DRYLINE — SPRINT RUN-SHEET (Purge-First Weekend + Finish Line)

**The execution order for the app's hardware-receiving core. Supersedes the annex's session order. Governance holds at sprint speed: recon first, one change per commit, smoke test each, PK runs ALL SQL, disable-don't-delete, honesty states (loading ≠ error ≠ empty).**

## BLOCK 0 — RECON (no edits)
Walk the real repo. Report to chat: routes, where the decision log lives (FINDING: not built — spec only), the real Supabase schema today, the Leaflet components, and everything referencing marketplace/messages/news. Flag high-blast-radius (auth, middleware, SiteHeader, Supabase clients, iOS standalone-nav). Change nothing until PK gives the go.

## BLOCK 1 — THE PURGE (one commit each, smoke test each)
1. Wire the existing lib/flags.ts consumers; set marketplace flag OFF (hide /hay/*, /radar, /sellers, nav links).
2. Set messaging flag OFF (hide /messages, unread badges; silences the per-nav /api/threads/unread fetch).
3. Demote news to a 3-headline card AND make **Today** the default landing view (don't leave a hole where the News default was).
4. Collapse the moisture 6-layer toggle to one page.
Smoke test after each: signed-in everywhere, dashboard renders, county search responsive, PWA opens to the right place.

## S1 — SCHEMA (PK runs the SQL)
Three tables: devices, events (payload jsonb + schema_version), places. Non-orphaning, order-independent. Mirror operation_profiles' jsonb-payload convention and per-ranch RLS. No decision-log data to migrate.

## S2 — THE RECEIVING DOCK
Tank webhook → edge function → writes one event. Bare Devices tab v0: list devices, type, battery, last-seen. This is the minimum for a tank node to report before the app is "done."

## S3 — ACTIVITY
One merged feed: decisions + hardware events + alerts, newest first, honest empty state.

## S4 — MAP PLACES
Places layer on the promoted Leaflet platform: draw fields/tanks/stackyards, pin devices.

## FINISH LINE
S1+S2 = hardware-ready dock (a tank node can report). S3+S4 = the human can see it. September = courier (Pair/Sync) + Feed Mode. The tank node deploys in early August needing only S1+S2 — it texts via webhook, no courier app required.
