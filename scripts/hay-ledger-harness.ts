// ─── Hay ledger harness — the correction rule, locked without a database ───────
//
//   npx tsx scripts/hay-ledger-harness.ts        (nonzero exit on any failure)
//
// The rule Block 5B calls out, the one a rancher catches in December: a
// correction dated BEFORE a physical count must not shift that count's
// consumption; a correction dated AFTER it must. The database side (054) is
// proven by execution in scripts/migrate-local.ts; the READ side is the
// effective-ledger filter (lib/ledger-effective) feeding summarizeHay, which
// is pure — so the arithmetic is locked here over the entries a reader would
// receive after the filter: the superseded line gone, its replacement present,
// a void gone. Cutoffs are ranch days (America/Denver), never UTC.

import { sinceCount, summarizeHay, type HayEntry } from '../lib/hay/queries'

let failures = 0
function check(name: string, pass: boolean, detail: string) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`)
  if (!pass) failures++
}

const NOW = new Date('2026-09-07T20:00:00Z').getTime()   // 2:00 PM MDT, Sep 7
const fed = (id: string, ts: string, bales: number, extra: Partial<HayEntry> = {}): HayEntry => ({ id, type: 'hay_fed', ts, bales, place_id: null, herd_lot_id: null, as_of: null, ...extra })
const count = (id: string, asOf: string, ts: string, bales: number): HayEntry => ({ id, type: 'hay_inventory', ts, bales, place_id: null, herd_lot_id: null, as_of: asOf })

// The stack: counted 40 on Sep 1 (ranch day). One feeding before it (Aug 30,
// 6 bales), one after it (Sep 3, 6 bales). Kiehl Ranch's shape (1 before / 8
// after) and Test Ranch's (21 before / 3 after) are the same rule at scale.
const BASE = [count('c', '2026-09-01', '2026-09-01T18:00:00Z', 40), fed('f1', '2026-08-30T18:00:00Z', 6), fed('f2', '2026-09-03T18:00:00Z', 6)]
const onHand = (entries: HayEntry[]) => summarizeHay(entries, NOW).onHand!.bales
const fedSince = (entries: HayEntry[]) => summarizeHay(entries, NOW).onHand!.fedSince

{
  const base = onHand(BASE)
  check('baseline: 40 counted Sep 1, 6 fed after → 34 on hand; the Aug 30 feeding is before the count', base === 34 && fedSince(BASE).entries === 1, `on hand ${base}, fed since ${fedSince(BASE).bales} (${fedSince(BASE).entries} line)`)

  // Correct the PRE-count feeding 6 → 4: the reader receives the correction in place of the original.
  const preCorrected = [BASE[0], fed('f1c', '2026-08-30T18:00:00Z', 4), BASE[2]]
  check('correct a feeding BEFORE the count (6 → 4): on hand does not move — pre-count consumption stays before the count', onHand(preCorrected) === 34, `on hand ${onHand(preCorrected)}`)

  // Correct the POST-count feeding 6 → 4: on hand adjusts by the difference.
  const postCorrected = [BASE[0], BASE[1], fed('f2c', '2026-09-03T18:00:00Z', 4)]
  check('correct a feeding AFTER the count (6 → 4): on hand adjusts 34 → 36', onHand(postCorrected) === 36, `on hand ${onHand(postCorrected)}`)

  // Wrong date: the post-count feeding really happened Aug 29 — before the count. It leaves the count's consumption.
  const redated = [BASE[0], BASE[1], fed('f2d', '2026-08-29T18:00:00Z', 6)]
  check('re-date the post-count feeding to before the count: on hand 34 → 40 (it no longer draws on this count)', onHand(redated) === 40, `on hand ${onHand(redated)}`)

  // A void of the post-count feeding: the reader receives neither the original nor the void row.
  const voided = [BASE[0], BASE[1]]
  check('void the post-count feeding: on hand 34 → 40, and the void row itself counts for nothing', onHand(voided) === 40, `on hand ${onHand(voided)}`)

  // A void of the pre-count feeding: nothing moves.
  const voidedPre = [BASE[0], BASE[2]]
  check('void the pre-count feeding: on hand stays 34', onHand(voidedPre) === 34, `on hand ${onHand(voidedPre)}`)

  // Never applied twice: if a reader ever handed both the original and its correction over, the number would be wrong — the filter is the guard, and this is what "wrong" looks like.
  const doubled = [...BASE, fed('f2c', '2026-09-03T18:00:00Z', 4)]
  check('sanity: original + correction together would read 30 — which is why the effective filter is the only read', onHand(doubled) === 30, `on hand ${onHand(doubled)}`)
}

{
  // Ranch-day cutoffs. The count is "as of Sep 1" (a ranch day). A feeding at
  // 11:30 PM MDT on Sep 1 is Sep 2 in UTC — it is ON the count day on the
  // ranch, so it counts as fed since. A feeding at 12:30 AM UTC on Sep 1 is
  // 6:30 PM MDT on Aug 31 — before the count on the ranch, so it does not.
  const lateOnCountDay = [count('c', '2026-09-01', '2026-09-01T18:00:00Z', 40), fed('x', '2026-09-02T05:30:00Z', 6)]
  check('ranch day, not UTC: 11:30 PM MDT on the count day (Sep 2 UTC) is fed since the count → 34', onHand(lateOnCountDay) === 34, `on hand ${onHand(lateOnCountDay)}`)
  const eveningBefore = [count('c', '2026-09-01', '2026-09-01T18:00:00Z', 40), fed('y', '2026-09-01T00:30:00Z', 6)]
  check('ranch day, not UTC: 12:30 AM UTC Sep 1 (6:30 PM MDT Aug 31) is before the count → 40', onHand(eveningBefore) === 40, `on hand ${onHand(eveningBefore)}`)
  // A correction whose work time is re-dated across that boundary follows the same rule.
  const redatedAcross = [count('c', '2026-09-01', '2026-09-01T18:00:00Z', 40), fed('yc', '2026-09-01T06:30:00Z', 6)]   // 12:30 AM MDT Sep 1 — on the count day
  check('re-dated correction lands by ranch day: 12:30 AM MDT on the count day counts → 34', onHand(redatedAcross) === 34, `on hand ${onHand(redatedAcross)}`)
}

{
  // An intervening count: feeding corrected to land between two counts must draw on the count it follows, not the later one.
  const two = [count('c1', '2026-08-20', '2026-08-20T18:00:00Z', 50), fed('a', '2026-08-25T18:00:00Z', 6), count('c2', '2026-09-01', '2026-09-01T18:00:00Z', 40), fed('b', '2026-09-03T18:00:00Z', 6)]
  check('two counts: the later count is the baseline; the Aug 25 feeding sits before it → 34', onHand(two) === 34 && summarizeHay(two, NOW).onHand!.baseline.asOf === '2026-09-01', `on hand ${onHand(two)}, baseline ${summarizeHay(two, NOW).onHand!.baseline.asOf}`)
  const movedPast = [two[0], fed('ac', '2026-09-02T18:00:00Z', 6), two[2], two[3]]   // the Aug 25 feeding corrected to Sep 2 — now after the later count
  check('a correction that moves a feeding past the intervening count draws on that count → 28', onHand(movedPast) === 28, `on hand ${onHand(movedPast)}`)
}

{
  // ── Block 9: the window is the count, not the calendar ──────────────────────
  // A winter operation, read on Jan 5. The count is a November one; the
  // feeding runs straight through the New Year. Every hay call site used to
  // floor the read at January 1, which kept the November count anchoring the
  // arithmetic while the November and December feeding it was supposed to be
  // reduced by disappeared. This is that ledger, both ways.
  const JAN5 = new Date('2027-01-05T18:00:00Z').getTime()
  const nov = count('c', '2026-11-15', '2026-11-15T18:00:00Z', 400)
  const winter = ['2026-11-20', '2026-11-27', '2026-12-04', '2026-12-11', '2026-12-18', '2026-12-25', '2026-12-30'].map(d => fed(d, `${d}T18:00:00Z`, 14))
  const january = ['2027-01-02', '2027-01-04'].map(d => fed(d, `${d}T18:00:00Z`, 5))
  const whole = summarizeHay(sinceCount([nov, ...winter, ...january], '2026-11-15'), JAN5)
  const jan1Floored = summarizeHay([nov, ...january], JAN5)   // what the old floor handed it
  check('the window is the count: a November count reads its own winter — 400 − 108 = 292 on hand, 9 feeding days',
    whole.onHand!.bales === 292 && whole.fed!.days === 9,
    `on hand ${whole.onHand!.bales} · fed ${whole.fed!.bales} on ${whole.fed!.days} days`)
  check('and the run-out date survives New Year — the 7-day gate is not re-armed by the calendar',
    !!whole.runOut.date, `runOut ${whole.runOut.date ?? whole.runOut.withheld}`)
  check('the January-1 floor is what wrong looks like: 98 bales of Nov–Dec feeding gone, on hand overstated, the date withheld',
    jan1Floored.onHand!.bales === 390 && jan1Floored.runOut.withheld === 'thin_feeding',
    `on hand ${jan1Floored.onHand!.bales} (overstated by ${jan1Floored.onHand!.bales - whole.onHand!.bales}) · runOut ${jan1Floored.runOut.date ?? jan1Floored.runOut.withheld}`)

  // The cut itself: everything before the count goes, the count never does —
  // including a count logged for a day earlier than its own timestamp.
  const older = count('old', '2026-10-01', '2026-10-01T18:00:00Z', 900)
  const before = fed('pre', '2026-11-01T18:00:00Z', 20)
  const cut = sinceCount([older, before, nov, ...january], '2026-11-15')
  check('the cut keeps every count and drops only work recorded before the anchor',
    cut.length === 4 && cut.filter(e => e.type === 'hay_inventory').length === 2 && !cut.some(e => e.id === 'pre'),
    `${cut.length} of 5 kept · counts ${cut.filter(e => e.type === 'hay_inventory').length} · pre-count feeding dropped ${!cut.some(e => e.id === 'pre')}`)
  check('with no count at all there is nothing to anchor to, and nothing is cut',
    sinceCount([before, ...january], null).length === 3, `${sinceCount([before, ...january], null).length} of 3 kept`)

  // The cut is a RANCH-day comparison, the same one the on-hand arithmetic
  // uses — so a feeding the equation counts is never dropped by the read.
  const lateOnCountDay = fed('late', '2026-11-16T05:30:00Z', 9)   // 10:30 PM MST Nov 15 — the count day on the ranch
  const withLate = sinceCount([nov, lateOnCountDay], '2026-11-15')
  check('a feeding at 10:30 PM on the count day is kept by the read and counted by the equation — they cannot disagree',
    withLate.length === 2 && summarizeHay(withLate, JAN5).onHand!.bales === 391,
    `kept ${withLate.length} of 2 · on hand ${summarizeHay(withLate, JAN5).onHand!.bales}`)
}

console.log(failures === 0 ? '\nhay-ledger-harness: all checks pass' : `\nhay-ledger-harness: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
