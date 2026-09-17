// ─── Block 21 (rulings 4 + 5) harness — who gets the phone's shelf ───────────
//
// A record someone made outranks a draft of one they are still making, and
// "Couldn't send" is the network's word and nothing else's. Both rules are
// about a shelf that has run out of room, and a real browser will not run out
// of room on demand — its quota is large, varies by build, and accounts a
// rewrite by the delta, so a suite can fill it and still find the record
// simply written. That proves nothing at all, which is exactly what the first
// two runs of the browser checks did.
//
// So the shelf is a FAKE one here, with a quota this file sets, and the real
// lib/local-space, lib/places/ride-draft and lib/outbox are driven against it.
// The browser suite keeps the end-to-end words; the arithmetic of who gives
// way lives here, where it can be made exact.
//
//   npx tsx scripts/local-space-harness.ts
//
// Self-checking, nonzero exit on any failure (the capture-harness convention).

let failures = 0
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

// ── A shelf with a quota, refusing the way a browser refuses ─────────────────
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
    // A rewrite is accounted by what the shelf would hold AFTER it, which is
    // how browsers do it — and is why a "full" shelf can still take a small
    // growth. Getting this wrong is what made the browser checks vacuous.
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

// Imports are hoisted above this line, which is fine and is the point: none of
// these modules touches localStorage while it is being imported — they read it
// inside their functions — so the shelf below is in place before any of them
// is called. (lib/outbox's window wiring is skipped outside a browser.)
shelf(1_000_000)

import { RECORD_RESERVE_BYTES, roomLeftForRecords, makeRoomForRecords, draftDroppedForRecord, forgetDraftDropped, RIDE_DRAFT_KEY } from '../lib/local-space'
import { saveRideDraft, clearRideDraft, loadRideDraft } from '../lib/places/ride-draft'
import { enqueue, clearOutbox, getOutbox, storageIsFull } from '../lib/outbox'

const fixes = (n: number) => Array.from({ length: n }, (_, i) => ({ t: 1_700_000_000_000 + i * 1000, lat: 47.12 + i * 1e-6, lng: -108.43, acc: 3 }))
/** Fill the shelf so that exactly `headroom` bytes are left. */
function fillTo(s: FakeStorage, headroom: number): void {
  const k = '__filler__'
  const room = s.quota - s.bytes() - k.length - headroom
  if (room > 0) s.setItem(k, 'x'.repeat(room))
}

// ── 1. The reserve: a draft never sits on the room a record needs ────────────
{
  const s = shelf(1_000_000)
  forgetDraftDropped(); clearRideDraft()
  check('an empty shelf has room for a record', roomLeftForRecords(), `reserve ${RECORD_RESERVE_BYTES} of ${s.quota} bytes`)

  // A ride whose draft would leave less than the reserve gives way BY ITSELF,
  // before any record has had to ask for room.
  fillTo(s, RECORD_RESERVE_BYTES + 20_000)
  const before = s.bytes()
  const wrote = saveRideDraft(fixes(400), 1_700_000_000_000, true)
  check('a draft that would take the last of the reserve gives way by itself, and leaves no draft behind',
    wrote === 'yielded' && loadRideDraft() === null && !s.has(RIDE_DRAFT_KEY),
    `wrote "${wrote}" · shelf ${before} → ${s.bytes()} of ${s.quota}`)
  check('and a record can still be written afterwards — which is the whole point of the reserve',
    roomLeftForRecords(), `room for ${RECORD_RESERVE_BYTES} bytes: ${roomLeftForRecords()}`)
  check('having given way, the draft stands down for the rest of the ride rather than racing for the space it freed',
    draftDroppedForRecord() && saveRideDraft(fixes(10), 1, true) === 'yielded' && !s.has(RIDE_DRAFT_KEY),
    'still yielded on the next write')
  check('the next ride starts even — finishing or throwing away a ride clears the stand-down',
    (clearRideDraft(), !draftDroppedForRecord()), 'cleared')
}

// ── 2. A draft that fits is kept, in full ────────────────────────────────────
{
  const s = shelf(1_000_000)
  forgetDraftDropped(); clearRideDraft()
  const wrote = saveRideDraft(fixes(200), 1_700_000_000_000, true)
  const back = loadRideDraft()
  check('a ride that fits is kept whole, and comes back with every fix',
    wrote === 'kept' && back?.fixes.length === 200, `wrote "${wrote}" · read back ${back?.fixes.length ?? 0} of 200 · shelf ${s.bytes()} of ${s.quota}`)
}

// ── 3. The sacrifice: a record outranks a draft ──────────────────────────────
{
  const s = shelf(1_000_000)
  forgetDraftDropped(); clearRideDraft(); clearOutbox()
  // A draft on the shelf, and then no room left at all — not even the growth
  // a record needs. The record must still be written, and the draft is what
  // goes: never the other way round.
  saveRideDraft(fixes(300), 1_700_000_000_000, true)
  const draftBytes = (s.getItem(RIDE_DRAFT_KEY) ?? '').length
  fillTo(s, 0)
  const tight = (() => { try { s.setItem('__probe__', 'y'.repeat(64)); s.removeItem('__probe__'); return false } catch { return true } })()
  let threw = false
  try { enqueue({ id: '11111111-1111-4111-8111-111111111111', type: 'hay_fed', bales: 2 }, 'Fed 2 bales') } catch { threw = true }
  check('with no room left, the record is written and the ride draft is what goes — never the other way round',
    tight && !threw && getOutbox().length === 1 && !s.has(RIDE_DRAFT_KEY) && draftBytes > 0,
    `shelf was full ${tight} · record written ${!threw} · outbox ${getOutbox().length} · draft (${draftBytes} bytes) gone ${!s.has(RIDE_DRAFT_KEY)}`)
  check('giving the draft up is recorded, so the ride screen can say the phone is no longer keeping it',
    draftDroppedForRecord(), 'noted')
}

// ── 4. Nothing else is ever sacrificed ───────────────────────────────────────
{
  const s = shelf(1_000_000)
  forgetDraftDropped(); clearRideDraft(); clearOutbox()
  // A shelf with no draft on it and no room: there is nothing a record is
  // allowed to outrank, so the save fails rather than taking something else.
  const other = { 'manual_log_draft_v1': 'someone half-typed this', 'dryline_session_uid': 'the signed-in person' }
  for (const [k, v] of Object.entries(other)) s.setItem(k, v)
  fillTo(s, 0)
  let threw = false
  try { enqueue({ id: '22222222-2222-4222-8222-222222222222', type: 'hay_fed', bales: 3 }, 'Fed 3 bales') } catch { threw = true }
  check('with nothing left to give up, the save fails — it never takes anything that is not a draft',
    threw && Object.keys(other).every(k => s.has(k)) && !makeRoomForRecords(),
    `refused ${threw} · other keys kept ${Object.keys(other).filter(k => s.has(k)).length} of ${Object.keys(other).length}`)
}

// ── 5. Ruling 5: a full phone is never a lost signal ─────────────────────────
{
  const s = shelf(1_000_000)
  forgetDraftDropped(); clearRideDraft(); clearOutbox()
  check('a phone with room is not reported as full', !storageIsFull(), 'quiet')
  // The record is on the shelf; now the shelf fills under it, so the phone can
  // no longer write down what happened to it. That is a storage problem, and
  // the outbox must keep it apart from a record that could not be sent.
  enqueue({ id: '33333333-3333-4333-8333-333333333333', type: 'hay_fed', bales: 4 }, 'Fed 4 bales')
  const item = getOutbox()[0]
  check('a record saved on a shelf with room is Saved, and nothing is marked as unsendable',
    item?.state === 'local' && !storageIsFull(), `state "${item?.state}" · full ${storageIsFull()}`)
  fillTo(s, 0)
  let threw2 = false
  try { enqueue({ id: '44444444-4444-4444-8444-444444444444', type: 'hay_fed', bales: 5 }, 'Fed 5 bales') } catch { threw2 = true }
  check('a second record that will not fit is refused outright, and the first is untouched — a full phone never rewrites what is already recorded',
    threw2 && getOutbox().length === 1 && getOutbox()[0].state === 'local',
    `refused ${threw2} · outbox ${getOutbox().length} · first still "${getOutbox()[0]?.state}"`)
  check('and the refusal is never written onto the record as "Couldn\'t send" — that word belongs to the network',
    getOutbox().every(i => i.state !== 'failed'),
    getOutbox().map(i => i.state).join(', '))
}

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all clear'}`)
process.exit(failures ? 1 : 0)
