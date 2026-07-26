# DRYLINE — NORTH STAR v3.0 (THE BORING BIBLE)

**July 21, 2026 · Supersedes DRYLINE BIBLE v1.0 AND NORTH STAR v2.0 — when any older doc disagrees, this wins.**
Founder: PK · Benchmark user: Dad · Wife/creative: Haley (ON BOARD) · CFO/engineer: Claude (chat) · Code agent: Claude Code.
Annexes: "App Audit & The Boring Restructure" (software) · Feedhand + Puck Bibles (hardware).

**The synthesis:** the software pivot (the sell decision) and the hardware ecosystem (Pucks, Sentinel, kit, machine) are ONE company: **Dryline is the ranch's brain; the hardware is its nervous system and hands.** GOVERNING STYLE LAW: **BE THE BORING COMPANY — "just plain works" is the moat; simple app, simple data, KISS.** Every feature, part, and screen answers one question: does this make it more boring or less?

## 1. MISSION
Judgment support, personalized: the ocean of data distilled to what THEIR operation needs, so PK's hours become every rancher's minutes. End state = the ranch's agent — knows the operation, watches the world, speaks first. The brain now has a body: devices that fill the ledger themselves.

## 2. THE TWO ENGINES
- **Engine 1 — THE DECISION (software flagship):** when and how to sell the calf crop. Herd profile + decision log + Market/Feed inputs + settlement-sheet ingestion wedge. v1 slice: retain-vs-sell timing & weight.
- **Engine 2 — THE LEDGER (the operating system):** three nouns — **DEVICES emit EVENTS at PLACES.** Puck (bales), Lite (dumps/Feed Mode), Tank Node (water), Bed Kit (grabs), the Machine (missions, later). Every product forever = a new device type + event types, ZERO new architecture.
- **How they're one:** the decision log IS the events ledger — decisions are events; hardware fills the same ledger Engine 1 reasons over. The hardware is how the ledger fills itself without a data-entry tax.
- **REPO REALITY (Jul 26 recon):** the decision log was spec'd but NEVER BUILT. The events table will be its first home — no legacy data to migrate.

## 3. FRAMING, NOT LEADING
Raw data = low value. Leading ("sell Oct 14") = never (wrong + liability). Framing = the product: their numbers stacked against the market until the answer is obvious TO THEM. Honest uncertainty, always.

## 4. TRUST & DATA
RLS on every user table VERIFIED before ingestion ships · plain-English promise (yours, never sold, aggregate-only) · instant total delete · attorney reviews privacy wording. DATA-NEVER-SOLD covers device data · RAW-DATA doctrine (full curves + schema_version) · one Dryline sub, no per-device nickel-diming (the anti-lockout company).

## 5. FUTURE-PROOFING
1. Bet on context, not models — own the ranch context; swappable brain. 2. Every surface agent-ready; the conversational agent stays BANKED — push-first AI is the shipped surface (plain-English reports + threshold texts). 3. The ledger is the crown jewel — self-filling via hardware. 4. Every device is a body for smarter minds — OTA everywhere. 5. Operator-independence tiering: the cheap one needs you; the good one doesn't.

## 6. THE APP SHAPE
**FOUR TABS FOREVER:** Today (chips + weather + glance + latest activity; LFP/tools as cards) · Map (counties + places + live device pins) · Activity (ONE merged feed: decisions + hardware events + alerts) · Devices (registry: battery, last-seen, calibrate). **THREE TABLES:** devices · events (payload jsonb, schema_version) · places. Tank webhook → edge function → events; courier → insert → events. **COURIER (mobile):** Expo, three screens ONLY — Pair · Sync · Feed Mode. No phone dashboards. **Demotions (flags, disable-don't-delete):** news → 3-headline hook inside Today · marketplace + messaging flagged OFF · moisture tabs → one page.

## 7. DOCTRINE
Recon real repo first → findings to chat → PK's go → work order → ONE change per commit → smoke test (signed-in everywhere; dashboard renders; county search fast) → diff → PK phone-verifies. Auth/SiteHeader/Supabase/middleware = high blast radius. Disable, don't delete. Honesty states: loading ≠ error ≠ empty; no fake zeros. PK runs ALL SQL; non-orphaning, order-independent. Engine before UI; root cause over symptoms. Scope gate until 50 paying users: bug fixes, features 20%+ ask for, revenue blockers only (hardware exempt — it IS the wedge). Dad's veto; "logger/beeper/alarm" vocabulary, never "robot." The Boring test on everything.

## 10. THE FAILURE MODE
The "one more fix" loop — building to dodge showing real users. The doc is not the work. Never confuse working on the destination with driving.
