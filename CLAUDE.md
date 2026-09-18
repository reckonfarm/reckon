@AGENTS.md

# Dryline / Reckon — how this repo is worked

Ranch app for one operator (PK) and his hands: Next.js 16 App Router, TypeScript, Tailwind v4, Supabase/Postgres,
Vercel, an offline-first PWA opened from the phone's home screen in a corral with one bar of signal. Solo build:
one rancher, one AI. Recon → report → PK rules → build on a branch → suites once on the preview → merge on green.

## Words a person reads

- **The word is BUNCH** everywhere a person reads. The database stays `herd_lots`. "Lot" appears only on
  auction and market screens, where it is the sale barn's word.
- **Four save words, nothing else:** `Saved` · `Waiting for signal` · `Sent` · `Couldn't send`. No sentences
  explaining sync. A refused record reads "Couldn't send", the reason in plain words on one line, and one button: Fix.
- **Junior-high reading level.** Never `retire`, `archive`, `dismiss`, `revoke`, `provenance`, `superseded`,
  `conflict`, `sync` in anything a person sees.
- **Never a dead end:** a row that cannot be fixed or deleted shows a plain sentence saying why, never a greyed button.
- A bunch is never just a name: every chip, option and row reads name · class · head.

## How records behave

- **Never a retry button.** Records retry themselves on every wake (signal back, app to the front, app opened),
  forever. Nothing ages out. Unsent and failed outbox items never expire; the size cap trims sent items only.
- **Hold 400 ms → Fix / Delete.** No confirmation dialogs. Delete goes to the trash with a ten-second Undo strip.
  Removing a person is the one permanent delete, and the sheet says so before the tap.
- **Never lose your place:** after a save, edit or delete the list stays where it was, scrolled to the row you
  touched, lit for a moment.
- **A rule lives in ONE place. The database decides; routes relay.** Never copy a database rule into TypeScript —
  a route mirroring 069's refusal and the reconciliation caused two production failures (a real preg check refused in
  a corral after the migration that allowed it had been run).

## Screen rules

- 48 px tap targets, 17 px body, one column, Save full width at the bottom saying what it does ("Record feeding",
  "Add the bunch"), −/+ at 56 px for any number under about twenty with the keyboard still available, existing
  tokens only (forest green, cream, rust; Fraunces headings, DM Sans body). Take things away; don't invent.
- Sections with air; no helper text under fields. Sheets slide over the page and close by swipe down; edge-swipe
  goes back everywhere; pull down on a list refreshes it. Add is one button at the top: "New bunch", "New place",
  "New listing" — never a bare plus.
- Every current condition carries a visible as-of. A summary is never more confident than its detail.

## Standing rules for the AI

- **Probes are read-only.** Never call a function that can change state. **Never run a migration** — write it,
  validate it with `npx tsx scripts/migrate-local.ts supabase/migrations/NNN_name.sql`, and hand PK the line
  `cat supabase/migrations/NNN_name.sql | pbcopy`.
- **Suite tiers:** UI-only → daily loop once on the preview. Records or sync → all three once (isolation, daily loop,
  markets). RLS or scoping → all three, always. Suites run from the worktree (`scripts/suite-worktree.sh <sha>`,
  then from `~/reckon-wt` with `BASE=` the preview URL and `VERCEL_BYPASS` from `e2e/.env.e2e`). Never two daily
  loops at once. Local runs prove nothing the preview doesn't.
- **One build loop:** batch every check fix into one commit and one push. Never push-wait-fix-push.
- **Blocks are two or three rulings.** Split anything bigger yourself, ship the first slice, tell PK what's left.
- **A check proves what it is looking at before it reads anything from it.** Assert identity first — this is the page,
  this is the commit, this is the deploy — and only then assert content. Three checks have passed or nearly passed
  against the wrong surface: a collapsed `<details>` read with `innerText`, a sign-in page standing in for an authed
  page, a 404 standing in for a preview. A check that cannot confirm what it is looking at reports that it could not,
  and never a pass.
- **A check that can't pass is a capability gap:** report it by name every run, never a silent skip. The only named
  skips are the three flakes PK watched fail and recover: the force-quit receipt check, the 6B place-timeline check,
  the Weather day-chips check (`flaky()` in `scripts/smoke-daily-loop.ts`).
- **Default is merge on green** (`merge --no-ff`, push main; PK looks at production). **These stop for PK:**
  migrations that change how a record is written, refused or reconciled; changes or backfills to existing
  production rows; anything touching the outbox or sync; anything touching RLS or ranch isolation; deleting or
  retiring at scale. Say so at the top of the report, stop, and wait.
- Decide what you can decide; state the decision in the report. Save real questions for anything that changes
  what a record means.
- **Reports are short:** one paragraph on what changed, the suite counts, the tip, what to look at on production.
- **Known capability gaps to name every run:** the hay marketplace is off in production
  (`NEXT_PUBLIC_FEATURE_MARKETPLACE=false`, `/api/hay` answers 404, so the hay-listing hold check is red).

## Ground truth worth keeping

- Design tokens: forest-green `#1B4332`, cream `#FDFBF7`, rust `#8B3A2B`, USDM D0–D4 scale; Tailwind v4 CSS
  config in `app/globals.css`; containers `max-w-6xl` (ranch pages `max-w-2xl`).
- Membership is the sole RLS gate (`ranch_members`); `ranch_members` never gets a client write policy.
- Head counts are a projection: `head_count_set` anchors plus live `group_action` deltas (066/067). Every real bunch
  has an anchor; a fixture inserted by hand needs one too.
- Data sources: USDM county statistics, ACIS precip vs normal, NWS points/gridpoints, NOAA map services
  (obs/rfc_qpe, vector/precip/wpc_qpf, outlooks/*). FSA LFP tiers 1–6 (OBBBA, July 2025) verified against the NDMC
  tool; always say FSA makes the final determination.
- What not to build: no SMS before email proves demand, no payments or escrow in hay, no predictive engine without
  history, no equipment/seed/spray ledger before the hay network is live, no native app, no general farm-management
  sprawl.
