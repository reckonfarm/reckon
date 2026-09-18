// ─── Block 22 harness — the count at the gate survives everything ────────────
//
// PK's falsifier, run: if the tally is not durable, killing the app after 47
// taps returns a screen showing anything other than 47. If the sacrifice order
// is wrong, filling the phone during a live count loses the count instead of
// the ride draft.
//
// Same instrument as the local-space harness, for the same reason: a real
// browser will not run out of room on demand, and "app death" in a browser
// test is a page reload that a suite can only approximate. Here the shelf has
// a quota this file sets and app death is simply throwing the module state
// away and reading the shelf back — which is exactly what a cold start does.
//
//   npx tsx scripts/tally-harness.ts
//
// Self-checking, nonzero exit on any failure (the capture-harness convention).

let failures = 0
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

class FakeStorage {
  private map = new Map<string, string>()
  constructor(public quota: number) {}
  private used(skip?: string): number {
    let n = 0
    for (const [k, v] of this.map) if (k !== skip) n += k.length + v.length
    return n
  }
  getItem(k: string): string | null { return this.map.has(k) ? this.map.get(k)! : null }
  removeItem(k: string): void { this.map.delete(k) }
  setItem(k: string, v: string): void {
    if (this.used(k) + k.length + v.length > this.quota) {
      const e = new Error('quota') as Error & { name: string }
      e.name = 'QuotaExceededError'
      throw e
    }
    this.map.set(k, v)
  }
  get length(): number { return this.map.size }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null }
  clear(): void { this.map.clear() }
  bytes(): number { return this.used() }
  has(k: string): boolean { return this.map.has(k) }
}

function shelf(quota: number): FakeStorage {
  const s = new FakeStorage(quota)
  ;(globalThis as unknown as { localStorage: FakeStorage }).localStorage = s
  return s
}
shelf(1_000_000)

import { RIDE_DRAFT_KEY, TALLY_KEY, forgetDraftDropped, forgetTallyDropped, tallyDroppedForRecord, draftDroppedForRecord } from '../lib/local-space'
import { startTally, addTap, undoTap, loadTally, clearTally, saveTally, total, type TapSize } from '../lib/tally'
import { saveRideDraft, clearRideDraft } from '../lib/places/ride-draft'
import { enqueue, clearOutbox, getOutbox } from '../lib/outbox'
import type { CaptureFix } from '../lib/places/capture'

const fixes = (n: number): CaptureFix[] => Array.from({ length: n }, (_, i) => ({ t: 1_700_000_000_000 + i * 1000, lat: 47.12 + i * 1e-6, lng: -108.43, acc: 3 }))
function fillTo(s: FakeStorage, headroom: number): void {
  const k = '__filler__'
  const room = s.quota - s.bytes() - k.length - headroom
  if (room > 0) s.setItem(k, 'x'.repeat(room))
}
const reset = () => { forgetDraftDropped(); forgetTallyDropped(); clearRideDraft(); clearTally(); clearOutbox() }

// ── 1. THE FALSIFIER: 47 taps, then the app dies ─────────────────────────────
{
  const s = shelf(1_000_000)
  reset()
  // A real gate: ones, twos, threes and fours as the cattle come, not a
  // pattern anyone chose.
  const script: TapSize[] = [1, 2, 1, 3, 4, 2, 1, 1, 4, 3, 2, 2, 1, 4, 1, 3, 2, 1, 1, 2]
  let t = startTally(null)
  let wrote = 'kept'
  for (const n of script) { const r = addTap(t, n); t = r.tally; if (r.wrote !== 'kept') wrote = r.wrote }
  check('every tap lands and the total is the sum of the taps, not a counter kept beside them',
    total(t.taps) === 41 && t.taps.length === 20 && wrote === 'kept', `${t.taps.length} taps · total ${total(t.taps)}`)

  // Bring it to exactly 47 the way a gate would, then kill the app: every
  // module's memory goes, and all that is left is the shelf.
  t = addTap(t, 4).tally
  t = addTap(t, 2).tally
  check('the count reaches 47', total(t.taps) === 47, `total ${total(t.taps)}`)
  const onShelf = s.getItem(TALLY_KEY)
  const revived = loadTally()
  check('THE FALSIFIER: the app dies at 47 taps and the phone still has 47 — not a rounder number, not zero',
    revived !== null && total(revived.taps) === 47 && revived.taps.length === 22,
    `read back ${revived ? total(revived.taps) : 'nothing'} from ${onShelf ? `${onShelf.length} bytes on the shelf` : 'an empty shelf'}`)
  check('and it comes back as the TAPS, so the count can still be corrected after a restore',
    JSON.stringify(revived?.taps) === JSON.stringify([...script, 4, 2]), `${revived?.taps.length} taps in the same order`)
}

// ── 2. Undo removes the last TAP, including across app death (ruling 4) ──────
{
  shelf(1_000_000)
  reset()
  let t = startTally(null)
  for (const n of [1, 1, 4, 2, 3] as TapSize[]) t = addTap(t, n).tally
  const before = total(t.taps)
  const revived = loadTally()!           // app death, then undo
  const u = undoTap(revived)
  check('undo after a restore removes the tap that was actually last, and says which',
    u.removed === 3 && total(u.tally.taps) === before - 3 && u.wrote === 'kept',
    `removed +${u.removed} · ${before} → ${total(u.tally.taps)}`)
  const u2 = undoTap(u.tally)
  check('undo again takes the one before it — a tap, never an animal',
    u2.removed === 2 && total(u2.tally.taps) === before - 5, `removed +${u2.removed} · total ${total(u2.tally.taps)}`)
  check('the shelf agrees with the screen after an undo — the write happened, not just the render',
    total(loadTally()!.taps) === before - 5, `shelf says ${total(loadTally()!.taps)}`)
  let empty = startTally(null)
  const none = undoTap(empty)
  check('undo on an empty count removes nothing and says nothing was removed',
    none.removed === null && none.tally.taps.length === 0, 'nothing to remove')
  empty = none.tally
}

// ── 3. THE SACRIFICE ORDER: the ride draft goes, the count stays (ruling 3) ──
{
  const s = shelf(1_000_000)
  reset()
  // A live count AND a ride draft on the phone, then a record that will not fit.
  let t = startTally(null)
  for (let i = 0; i < 47; i++) t = addTap(t, 1).tally
  saveRideDraft(fixes(300), 1_700_000_000_000, true)
  const draftBytes = (s.getItem(RIDE_DRAFT_KEY) ?? '').length
  fillTo(s, 0)
  let threw = false
  try { enqueue({ id: '55555555-5555-4555-8555-555555555555', type: 'hay_fed', bales: 2 }, 'Fed 2 bales') } catch { threw = true }
  check('THE FALSIFIER: the phone fills during a live count and it is the RIDE DRAFT that goes — the count is untouched',
    !threw && getOutbox().length === 1 && !s.has(RIDE_DRAFT_KEY) && s.has(TALLY_KEY) && total(loadTally()!.taps) === 47,
    `record written ${!threw} · ride draft (${draftBytes} bytes) gone ${!s.has(RIDE_DRAFT_KEY)} · count still ${loadTally() ? total(loadTally()!.taps) : 'GONE'}`)
  check('and giving up the ride draft is noted, while the count is not marked as given up at all',
    draftDroppedForRecord() && !tallyDroppedForRecord(), `draft dropped ${draftDroppedForRecord()} · tally dropped ${tallyDroppedForRecord()}`)
}

// ── 4. A record still outranks the count when nothing else is left ───────────
{
  const s = shelf(1_000_000)
  reset()
  // A long gather — four hundred taps, which is a couple of kilobytes and
  // enough that giving it up genuinely makes room. A 47-tap count is barely a
  // hundred bytes; sacrificing it would free less than the record needs, and
  // the check would be watching arithmetic rather than the ruling.
  let t = startTally(null)
  for (let i = 0; i < 400; i++) t = addTap(t, 1).tally
  const tallyBytes = (s.getItem(TALLY_KEY) ?? '').length
  fillTo(s, 0)                      // no ride draft this time: the count is all there is
  let threw = false
  try { enqueue({ id: '66666666-6666-4666-8666-666666666666', type: 'hay_fed', bales: 3 }, 'Fed 3 bales') } catch { threw = true }
  check('with nothing else to give, a record someone already made still outranks a count still being made',
    !threw && getOutbox().length === 1 && !s.has(TALLY_KEY), `count was ${tallyBytes} bytes · record written ${!threw} · count given up ${!s.has(TALLY_KEY)}`)
  check('and THAT is remembered, so the screen can tell the operator his count was taken rather than lost',
    tallyDroppedForRecord(), 'noted')
}

// ── 5. A phone that will not keep a tap says so (Block 21, ruling 5) ─────────
{
  const s = shelf(1_000_000)
  reset()
  let t = startTally(null)
  for (let i = 0; i < 10; i++) t = addTap(t, 1).tally
  fillTo(s, 0)
  const r = addTap(t, 4)
  check('a tap the phone will not keep is reported as refused, never silently counted on screen',
    r.wrote === 'refused' && total(loadTally()!.taps) === 10,
    `wrote "${r.wrote}" · shelf still ${total(loadTally()!.taps)} · screen would have shown ${total(r.tally.taps)}`)
  // Rewriting the count SMALLER always fits — the shelf accounts a rewrite by
  // what it holds afterwards. What must never happen is a throw: a tap at a
  // gate cannot become an exception on the way up.
  const smaller = (() => { try { return saveTally({ startedAt: 1, savedAt: 1, taps: [1], lotId: null }) } catch { return 'THREW' } })()
  const s2 = shelf(2_000)
  fillTo(s2, 0)
  const cold = (() => { try { return saveTally({ startedAt: 1, savedAt: 1, taps: Array.from({ length: 200 }, () => 4 as TapSize), lotId: null }) } catch { return 'THREW' } })()
  check('saveTally never throws, whatever the phone does — it reports',
    smaller !== 'THREW' && cold === 'refused',
    `rewrite smaller on a full shelf: "${smaller}" · a count that cannot fit at all: "${cold}"`)
}

// ── 6. A count that fits is kept whole, and a finished one is cleared ────────
{
  shelf(1_000_000)
  reset()
  let t = startTally('11111111-1111-4111-8111-111111111111')
  for (const n of [4, 4, 4, 3] as TapSize[]) t = addTap(t, n).tally
  check('a count started from a bunch remembers which bunch it is about',
    loadTally()?.lotId === '11111111-1111-4111-8111-111111111111' && total(loadTally()!.taps) === 15,
    `lot ${loadTally()?.lotId?.slice(0, 8)} · total ${total(loadTally()!.taps)}`)
  clearTally()
  check('finishing or throwing away a count leaves nothing behind, and the next one starts even',
    loadTally() === null && !tallyDroppedForRecord(), 'cleared')
}

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all clear'}`)
process.exit(failures ? 1 : 0)
