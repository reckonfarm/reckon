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

## The record sheet — measured 2026-09-12, and nothing proposed

Driven open the way the daily loop reaches it (the FAB is `md:hidden`, so the
VISIBLE entry point, not the first match), then measured from the Save button
outward rather than from a guessed wrapper. The first attempt measured
`document.body` — 844px, zero fields, identical for every type — because the
selector matched nothing and fell through.

| form | 390px | 320px | fields | controls | words |
|---|---|---|---|---|---|
| Rain | 362px | 418px | 2 | 7 | 31 |
| Hay fed | 516px | 572px | 3 | 9 | 46 |
| Cattle moved | 619px | 675px | 4 | 9 | 84 |

**Nothing proposed.** Two fields for rain, three for a feeding, four for a
move. There is no expander to add that would not cost a tap on the surface PK
touches most, and 7.5 already ruled against exactly that. Collapsing anything
here would be cutting for the sake of having cut something.

**Save is above the fold at both widths** — y=767 of 844 at 390, y=788 at 320.
That is the 7.5 requirement still holding, verified rather than assumed.

**One thing to watch, not to fix now.** Cattle moved at 320 puts Save at 788
with **56px of margin**. The walkthrough measured "Save hidden by the
keyboard" as a real failure mode, and 56px is the thinnest margin any form
has. It is fine today. It would stop being fine if that form gained a field or
a line of copy, so this is the number to check the next time anyone touches
it.

---

## Summary

One screen is the problem. **Activity: 5,683 → ~1,700px** with four cuts, the
biggest being collapsed day groups and filters behind a tap. The place list
offers 90px I would not bother with. Ranch and Today are already where the
last two blocks left them.

If the answer is "just do Activity", that is the honest scope.
