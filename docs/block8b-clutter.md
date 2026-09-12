# Block 8B.3 — clutter pass, screen by screen

**Proposal only. Nothing built. PK rules before any of this is touched.**

Measured on the block-8 preview, signed in as Test Ranch, 390px wide,
2026-09-12. Every number below is from the painted page.

| screen | height | controls | words | disclosures |
|---|---|---|---|---|
| Ranch (`/ranch`) | 1,218px | 9 | 90 | 0 |
| Place list (`/ranch/places`) | 1,230px | 8 | 136 | 0 |
| **Activity (`/ranch/activity`)** | **5,683px** | **55** | **829** | **0** |
| Today (`/today`) | 2,190px | 16 | 203 | 1 |

**Activity is the whole problem.** It is 4.7× the Ranch hub and carries more
controls than the other three screens combined. Everything else on this list
is already close to lean, and I would rather say so than invent work.

---

## Activity — 50 rows, 20 day groups, a 243px filter block

The shape: a filter block (Person · Place · Lot), then 20 day-grouped sections
holding 50 rows. No disclosures anywhere — every row is fully expanded, always.

**Proposed cuts, in order of what they buy:**

| cut | buys | reasoning |
|---|---|---|
| **Filters behind one tap** — a single "Filter" row that says the active filter, or nothing | **243px** | Three pickers sit above the record on every visit. Most visits filter nothing. A filter that is not being used should not cost a quarter of the first screen. The row states the active filter when there is one, so a filtered view never looks unfiltered. |
| **Collapse day groups older than the last 3 days** — "Sep 8 · 4 entries ▾" | **~2,900px** | 20 day headings for 50 rows means a heading every 2.5 rows. The recent days are what a person came for; the rest is a record you go looking through, and a dated summary line is a better index than a wall. |
| **One line per row, not two** — actor and entry on one line, time right-aligned | **~600px** | Rows are 56–94px. "Test Owner · Fed 2 bales" and "3:19 PM" fit one line at 390. |
| Load 20 rows, "Show 30 more" | ~1,400px | The 7B.2 pattern, already proven on the Ranch hub. |

Taken together: roughly **5,683 → 1,700px**, and the first screen becomes the
last three days rather than a filter panel.

**What I would NOT cut, and why:**

- **The correction markers.** "corrected" / "voided" / the struck original are
  6B's whole point. They cost pixels and they are the reason the record is
  trustworthy.
- **Who recorded it.** The handoff evidence is the feature, not decoration.
- **The day groupings themselves.** Collapse them, do not remove them — "by the
  day the work happened" is how a rancher looks for something.

---

## Place list — 1,230px, and the rows are honest

Four place rows at 95–117px, each carrying last work and last rain, then the
capture card (259px), Draw (56px) and Record here (56px).

**Proposed:**

| cut | buys | reasoning |
|---|---|---|
| Drop `place-last-rain` from the row; keep it on the place's own page | ~90px | Two "last …" lines per row is the second one competing with the first. Last work is the one that answers "have I been here". |
| Nothing else | — | 8B.4 already made the order useful, and four rows is not a wall. |

I would rather leave this screen alone than shave 90px. **Listing it as a
maybe, not a recommendation.**

---

## Ranch hub — already done, in 7B.2

1,218px, 9 controls, 90 words, two recent rows with the rest one tap away.
**Nothing proposed.** The clutter pass that would have applied here already
happened.

---

## Today — 2,190px, and the disclosure is in the right place

16 controls, one disclosure (`hay-details`), and the sections are the ones
7.7 settled: since-you-checked, repeat, Record work, Add a place, hay, news.

**Proposed:**

| cut | buys | reasoning |
|---|---|---|
| Nothing | — | 7.7 already cut this screen to work-only and measured CLS to 0.016. 8B.1 added one 97px row to it. Re-cutting it now would undo a settled decision. |

---

## The record sheet

Not measured here — it opens over another screen and the audit tooling reaches
it only mid-flow. **I have not proposed cuts to it because I have not measured
it**, and 7.5 explicitly ruled against adding a More expander to the five
forms. If you want it in scope, I will measure it properly first rather than
guess from source.

---

## Summary

One screen is the problem. **Activity: 5,683 → ~1,700px** with four cuts, the
biggest being collapsed day groups and filters behind a tap. The place list
offers 90px I would not bother with. Ranch and Today are already where the
last two blocks left them.

If the answer is "just do Activity", that is the honest scope.
