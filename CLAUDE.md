@AGENTS.md

# Dryline / Reckon — how this repo is worked

Ranch app for one operator (PK) and his hands: Next.js 16, TypeScript, Tailwind v4, Supabase, Vercel — offline-first,
opened from a phone's home screen in a corral with one bar. Recon → report → PK rules → branch → suites → merge.

## Words a person reads

- **The word is BUNCH.** The database stays `herd_lots`; "lot" is the sale barn's word and appears only on auction
  and market screens. A bunch is never just a name: every chip, option and row reads name · class · head.
- **Four save words, nothing else:** `Saved` · `Waiting for signal` · `Sent` · `Couldn't send` — the words as
  written, never transformed. No sentences explaining sync. "Couldn't send" is the network's word only; a phone
  that will not keep a record says what is actually wrong and what to do.
- **Junior-high reading level.** Never `retire`, `archive`, `dismiss`, `revoke`, `provenance`, `superseded`,
  `conflict`, `sync` where a person can see it.
- **A refusal explains itself and never dead-ends:** the reason in the ranch's own words on one line, and the one
  control that helps. Never a greyed button, never a control that does nothing when tapped.

## How records behave

- **A guard may refuse to interpret, grade or conclude. It may never discard what a person did.** Save the raw
  thing, downgrade the claim, say what is missing. Recording stops when the operator stops it, never on a failed
  guard.
- **A record someone made outranks work still being made.** Out of room, the order is pending record → live tally →
  ride draft, given up one at a time, cheapest first. `lib/local-space.ts` owns it and is the only thing that gives
  anything up; nothing else is ever sacrificed.
- **Never a retry button.** Records retry themselves on every wake, forever, and nothing ages out.
- **Hold 400 ms → Fix / Delete,** no confirmation dialogs. Delete goes to the trash with a ten-second Undo, and
  nothing may ever cover an Undo — every floating element yields to it. Removing a person is the one permanent
  delete; the sheet says so first. After any save, edit or delete the list stays put at the row you touched.
- **A rule lives in ONE place. The database decides; routes relay.** Never copy a database rule into TypeScript. A
  screen may show the ranch's own refusal for speed in a corral, pinned as below.

## Screens — a command center, not documentation

- **Show the answer. Reasons on tap. Records deeper. Never all three at once.** Icons carry actions; words carry
  numbers, names and outcomes. An icon may have a short word beside it; a number may never become an icon.
- **Delete any text that restates its control, explains an obvious field, or says what someone just did in more
  than one line.** Two exceptions: a refusal, and a number stating its scope, units and age when those change its
  meaning ("recorded 6 days ago", never a paragraph of caveats) — so every current condition carries a visible
  as-of, and a summary is never more confident than its detail.
- **Every UI work order answers:** what typing disappeared · what is visible immediately · what is on tap · what
  got deleted. Hiding something behind an icon is not simplification if the job got harder.
- 48 px targets, 17 px body, one column, existing tokens only. Save is full width at the bottom and says what it
  does; −/+ at 56 px under about twenty. Sheets close by swipe down, edge-swipe goes back, pull down refreshes.
  Add is one button at the top — "New bunch", never a bare plus.

## Standing rules for the AI

- **Probes are read-only; never run a migration.** Write it, validate it with `npx tsx scripts/migrate-local.ts
  supabase/migrations/NNN_name.sql`, and hand PK `cat supabase/migrations/NNN_name.sql | pbcopy`.
- **A check reads what is actually there — the right page, commit and deploy, and the text as PAINTED.** Identity
  first, then content; a check that cannot confirm its subject reports that, never a pass. Rendering changes what
  every reader receives, checks included: a transform that shouts a word makes it a different word to a person and
  to a check, so painted strings are pinned to their originals wherever they are shown.
  Every suite and harness prints its commit and BASE beside its counts on the summary line (`suiteIdentity()`), and
  counts without their commit are a partial, not a result — in the run's output and in the report to PK.
- **A check that can't pass is a capability gap:** name it every run, never a silent skip. Standing gap: the hay
  marketplace is off in production (`/api/hay` 404s). Only PK's three watched flakes may skip (`flaky()`).
- **Suite tiers:** UI-only → daily loop once on the preview. Records or sync → all three. RLS or scoping → all
  three, always. Run from a worktree (`scripts/suite-worktree.sh <sha>`, `BASE=` the preview, `VERCEL_BYPASS` from
  `e2e/.env.e2e`) — one worktree per run, never two daily loops at once, and local runs prove nothing.
- **One build loop, two or three rulings.** One commit and one push, never push-wait-fix-push; split anything
  bigger, ship the first slice, say what's left.
- **Default is merge on green** (`merge --no-ff`, push main). **These stop for PK:** migrations changing how a
  record is written, refused or reconciled; changes or backfills to existing production rows; anything touching the
  outbox, sync, RLS or ranch isolation; deleting or retiring at scale. Say so at the top of the report, and wait.
- **Decide what you can decide; state the decision.** Save real questions for anything that changes what a record
  means. **Reports are short:** what changed, the counts with their commit, the tip, what to check on production.
- **Adding a doctrine means merging or removing one. This file does not grow.** Read in full every session, so
  everything in it must still govern; how a rule was learned belongs in the commit that fixed it.

## Ground truth worth keeping

- Tokens: forest-green `#1B4332`, cream `#FDFBF7`, rust `#8B3A2B`, USDM D0–D4; Tailwind v4 config in
  `app/globals.css`; containers `max-w-6xl`, ranch `max-w-2xl`.
- Membership is the sole RLS gate (`ranch_members`), which never gets a client write policy.
- Head counts are a projection: `head_count_set` anchors plus live `group_action` deltas. Every bunch needs an
  anchor, a hand-inserted fixture too.
- Sources: USDM county statistics, ACIS precip vs normal, NWS, NOAA map services. FSA LFP tiers 1–6
  (OBBBA, July 2025) verified against the NDMC tool; always say FSA makes the final determination.
- Not to build: no SMS before email proves demand, no payments or escrow in hay, no predictive engine without
  history, no equipment ledger before hay, no native app, no farm-management sprawl.
