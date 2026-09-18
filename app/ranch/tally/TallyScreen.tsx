'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Card } from '@/app/components/ui/Card'
import SaveStatus from '@/app/dashboard/components/SaveStatus'
import { useOwnSaveStrip } from '@/app/dashboard/components/LogIt'
import { enqueue, newEventId } from '@/lib/outbox'
import { lotLabel, bunchDetail, type Lot } from '@/lib/herd'
import { splitBody, splitLabel, defaultSplitName, defaultSplitClass } from '@/lib/cattle/split'
import { todayKey as ranchToday } from '@/lib/jobs/format'
import { warning } from '@/lib/brand-colors'
import { useWakeLock, wakeNote } from '@/lib/use-wake-lock'
import { confirmTap, confirmUndo, hapticKind, HAPTIC_WORDS } from '@/lib/haptics'
import {
  TAP_SIZES, addTap, againstLine, clearTally, loadTally, startTally, tallyWasDropped,
  total, undoTap, type Tally, type TapSize,
} from '@/lib/tally'

// ─── The tally at the gate (Block 22) ────────────────────────────────────────
//
// A man stands at a gate with gloves on, watching cattle and not the screen,
// in sun or in the dark, with no signal. Everything here follows from that.
//
// FOUR BUTTONS, not a step size (ruling 1). Cattle do not come through in a
// consistent group: two, then one, then four. He picks as they pass. They are
// across the bottom where a thumb is, and the total is enormous and at the top
// where it can be read at arm's length in sun.
//
// EVERY TAP IS CONFIRMED (ruling 2, as amended). By feel where the phone can —
// the number of pulses matching the button — and ON SCREEN always: the button
// he pressed holds its lit state long enough to catch in peripheral vision and
// the total flashes with it. A phone that cannot buzz says so in one line
// rather than pretending. He must be able to tell a landed tap from a missed
// one without stopping to look.
//
// NOTHING IS EVER LOST (ruling 3). lib/tally.ts writes on every tap before the
// screen moves; the screen is held awake; and coming back to a count that was
// interrupted offers it back with its total and three plain choices.
//
// WHAT IT IS COUNTING AGAINST (ruling 7). Started from a bunch, it says what is
// through and what is left. Started cold, it says the total and nothing else.
// The remainder never constrains the count — counting past the bunch is allowed
// and shown, because the gate is what is true and the record is only what was
// written last.

type Mode = 'idle' | 'counting' | 'finish' | 'saved'
type Ending = 'set_head' | 'new_bunch' | 'observation'

const FLASH_MS = 260

export default function TallyScreen({ lots, initialLotId }: { lots: Lot[]; initialLotId: string | null }) {
  const [mode, setMode] = useState<Mode>('idle')
  const [tally, setTally] = useState<Tally | null>(null)
  const [held, setHeld] = useState<Tally | null>(null)      // a count the phone was holding when this opened
  const [flash, setFlash] = useState<{ size: TapSize | 'undo'; at: number } | null>(null)
  const [removed, setRemoved] = useState<TapSize | null>(null)
  const [refused, setRefused] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [ending, setEnding] = useState<Ending>('set_head')
  const [newName, setNewName] = useState('')
  const eventId = useRef<string | null>(null)
  const { wake, hold, let_go } = useWakeLock()
  useOwnSaveStrip(mode === 'saved')

  const lotId = tally?.lotId ?? initialLotId
  const source = lots.find(l => l.id === lotId) ?? null
  const through = tally ? total(tally.taps) : 0
  const against = source ? { name: lotLabel(source), head: source.head_count } : null

  // What the phone was holding when this screen opened (ruling 3).
  useEffect(() => {
    const t = setTimeout(() => setHeld(loadTally()), 0)
    return () => clearTimeout(t)
  }, [])

  // The flash is a moment, not a state: it clears itself.
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), FLASH_MS)
    return () => clearTimeout(t)
  }, [flash])

  const begin = useCallback(async (seed: Tally | null) => {
    const t = seed ?? startTally(initialLotId)
    setTally(t); setHeld(null); setRemoved(null); setRefused(false)
    setMode('counting')
    await hold()
  }, [initialLotId, hold])

  function tap(size: TapSize) {
    if (!tally) return
    const r = addTap(tally, size)          // written FIRST — the screen follows the phone
    setTally(r.tally)
    setRefused(r.wrote !== 'kept')
    setRemoved(null)
    setFlash({ size, at: Date.now() })
    confirmTap(size)
  }

  function undo() {
    if (!tally) return
    const r = undoTap(tally)
    if (r.removed === null) return
    setTally(r.tally)
    setRefused(r.wrote !== 'kept')
    setRemoved(r.removed)
    setFlash({ size: 'undo', at: Date.now() })
    confirmUndo()
  }

  function throwAway() {
    clearTally(); setTally(null); setHeld(null); setLeaving(false); setMode('idle')
    void let_go()
  }

  // ── Ruling 6: finishing chooses the meaning ────────────────────────────────
  function save() {
    if (!tally || !source && ending !== 'observation') { setSaveErr('Pick what this count means.'); return }
    setSaveErr(null)
    const id = eventId.current ?? (eventId.current = newEventId())
    let body: Record<string, unknown>
    let label: string
    if (ending === 'new_bunch' && source) {
      // One split implementation (Block 19): this calls the same builder the
      // split sheet and the preg check call, and 071 does the arithmetic.
      const name = (newName.trim() || defaultSplitName(source, ranchToday())).slice(0, 40)
      body = splitBody({ id, source, head: through, name, class: defaultSplitClass(source.class) })
      label = splitLabel(source, through, name)
    } else if (ending === 'set_head' && source) {
      body = { id, type: 'cattle_counted', counted: through, herd_lot_id: source.id, set_head: true }
      label = `Counted ${through} head of ${lotLabel(source)} · set the bunch to ${through}`
    } else {
      body = { id, type: 'cattle_counted', counted: through, ...(source ? { herd_lot_id: source.id } : {}) }
      label = `Counted ${through} head${source ? ` of ${lotLabel(source)}` : ''}`
    }
    try { enqueue(body, label) } catch {
      setSaveErr('This phone is full, so nothing was saved. Free some space on the phone, then record it again.')
      return
    }
    clearTally()
    setSavedId(id); setTally(null); setMode('saved')
    void let_go()
  }

  const note = wakeNote(wake)
  const kind = typeof window === 'undefined' ? 'none' : hapticKind()

  // ── A count the phone was holding, offered back (ruling 3) ─────────────────
  if (mode === 'idle' && held && held.taps.length > 0) {
    return (
      <Card className="mt-4 p-4 sm:p-5" data-audit="tally-held">
        <p className="font-dm-sans text-[17px] font-semibold text-ink">A count in progress</p>
        <p className="mt-1 type-main-number text-ink" data-audit="tally-held-total">{total(held.taps).toLocaleString('en-US')}</p>
        <p className="mt-1 font-dm-sans text-[16px] text-ink" data-audit="tally-held-note">
          {held.taps.length.toLocaleString('en-US')} {held.taps.length === 1 ? 'tap' : 'taps'}, kept on this phone. Nothing is lost.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button type="button" onClick={() => void begin(held)} className="min-h-[60px] rounded-lg bg-forest-green px-4 font-dm-sans text-[18px] font-semibold text-cream" data-audit="tally-held-keep">Keep counting</button>
          <button type="button" onClick={() => { setTally(held); setHeld(null); setMode('finish') }} className="min-h-[60px] rounded-lg border border-control-border bg-surface px-4 font-dm-sans text-[18px] font-semibold text-ink" data-audit="tally-held-finish">Finish this count</button>
          <button type="button" onClick={throwAway} className="min-h-[60px] rounded-lg border px-4 font-dm-sans text-[18px] font-semibold" style={{ color: warning, borderColor: warning }} data-audit="tally-held-discard">Throw it away</button>
        </div>
      </Card>
    )
  }

  if (mode === 'idle') {
    return (
      <Card className="mt-4 p-4 sm:p-5" data-audit="tally-start">
        <p className="font-dm-sans text-[17px] font-semibold text-ink">Count at a gate</p>
        <p className="mt-0.5 font-dm-sans text-[15px] text-secondary-ink">
          {source ? `Counting ${lotLabel(source)} · ${bunchDetail(source)}` : 'Tap as they come through. You choose what the count means at the end.'}
        </p>
        <button type="button" onClick={() => void begin(null)} className="mt-4 min-h-[60px] w-full rounded-lg bg-forest-green px-4 font-dm-sans text-[18px] font-semibold text-cream" data-audit="tally-begin">Start counting</button>
      </Card>
    )
  }

  if (mode === 'saved' && savedId) {
    return (
      <Card className="mt-4 p-4 sm:p-5" data-audit="tally-saved">
        <SaveStatus itemId={savedId} />
        <button type="button" onClick={() => { eventId.current = null; setSavedId(null); setMode('idle') }} className="mt-3 inline-flex min-h-[48px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2" data-audit="tally-again">Count another</button>
      </Card>
    )
  }

  // ── Finishing: what does this number mean? (ruling 6) ──────────────────────
  if (mode === 'finish' && tally) {
    const opts: { key: Ending; label: string; hint: string; can: boolean }[] = [
      { key: 'set_head', label: `Set ${source ? lotLabel(source) : 'the bunch'} to ${through.toLocaleString('en-US')}`, hint: source ? `It says ${source.head_count.toLocaleString('en-US')} now. The gate is what is true.` : 'Start the count from a bunch to use this.', can: !!source },
      { key: 'new_bunch', label: `Start a new bunch of ${through.toLocaleString('en-US')}`, hint: source ? `${through.toLocaleString('en-US')} leave ${lotLabel(source)} and become their own bunch.` : 'Start the count from a bunch to use this.', can: !!source },
      { key: 'observation', label: 'Just record the count', hint: 'Nothing changes. The number goes on the record.', can: true },
    ]
    return (
      <Card className="mt-4 p-4 sm:p-5" data-audit="tally-finish">
        <p className="type-main-number text-ink" data-audit="tally-finish-total">{through.toLocaleString('en-US')}</p>
        <p className="font-dm-sans text-[16px] text-secondary-ink">counted{source ? ` · ${lotLabel(source)}` : ''}</p>
        <p className="mt-4 font-dm-sans text-[16px] font-semibold text-ink" id="tally-ending-label">What does this count mean</p>
        <div className="mt-2 flex flex-col gap-2" role="radiogroup" aria-labelledby="tally-ending-label" data-audit="tally-ending">
          {opts.map(o => (
            <button key={o.key} type="button" role="radio" aria-checked={ending === o.key} disabled={!o.can} onClick={() => setEnding(o.key)}
              className={`min-h-[60px] rounded-lg border px-4 py-2 text-left font-dm-sans text-[17px] font-semibold disabled:opacity-40 ${ending === o.key ? 'border-forest-green bg-forest-green text-cream' : 'border-control-border bg-surface text-ink'}`}
              data-audit={`tally-ending-${o.key}`}>
              {o.label}
              <span className={`block text-[15px] font-normal ${ending === o.key ? 'opacity-90' : 'text-secondary-ink'}`}>{o.hint}</span>
            </button>
          ))}
        </div>
        {ending === 'new_bunch' && source && (
          <label className="mt-3 block font-dm-sans text-[16px] font-medium text-ink" htmlFor="tally-new-name">Name the new bunch
            <input id="tally-new-name" value={newName || defaultSplitName(source, ranchToday())} onChange={e => setNewName(e.target.value.slice(0, 40))} maxLength={40}
              className="mt-1 block w-full min-h-[52px] rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[17px] text-ink" data-audit="tally-new-name" />
          </label>
        )}
        {saveErr && <p role="alert" className="mt-3 font-dm-sans text-[16px] font-semibold" style={{ color: warning }} data-audit="tally-save-error">{saveErr}</p>}
        <div className="mt-4 flex flex-col gap-2">
          <button type="button" onClick={save} className="min-h-[60px] w-full rounded-lg bg-forest-green px-4 font-dm-sans text-[18px] font-semibold text-cream" data-audit="tally-save">Record the count</button>
          <button type="button" onClick={() => setMode('counting')} className="min-h-[52px] font-dm-sans text-[17px] font-semibold text-secondary-ink underline underline-offset-2" data-audit="tally-back-to-counting">Keep counting</button>
        </div>
      </Card>
    )
  }

  // ── Counting ───────────────────────────────────────────────────────────────
  const line = againstLine(through, against)
  const flashing = flash !== null
  return (
    <div data-audit="tally-counting">
      {/* THE NUMBER. Enormous, at the top, readable at arm's length in sun —
          and it flashes on every tap so a landed tap is visible without
          looking straight at it (ruling 2, as amended). */}
      <div className="mt-3 rounded-xl border border-forest-green/15 bg-surface px-4 py-6 text-center transition-colors duration-100"
        style={flashing ? { backgroundColor: 'rgba(27,67,50,0.10)' } : undefined} data-audit="tally-total-box" data-flash={flashing ? 'true' : 'false'}>
        <p className="font-fraunces text-[104px] leading-none font-semibold tabular-nums text-forest-green" data-audit="tally-total">{through.toLocaleString('en-US')}</p>
        {line && <p className="mt-2 font-dm-sans text-[20px] text-ink" data-audit="tally-against">{line}</p>}
      </div>

      {refused && (
        <p role="alert" className="mt-2 font-dm-sans text-[16px] font-semibold" style={{ color: warning }} data-audit="tally-refused">
          This phone is full, so the last tap was not kept. The count on screen is ahead of what the phone has — free some space.
        </p>
      )}
      {tallyWasDropped() && (
        <p role="alert" className="mt-2 font-dm-sans text-[16px] font-semibold" style={{ color: warning }} data-audit="tally-taken">
          The phone made room for a record you saved and this count was what it took. What is on screen is all that is left of it — finish it now.
        </p>
      )}
      {removed !== null && <p className="mt-2 font-dm-sans text-[18px] font-semibold text-ink" role="status" data-audit="tally-removed">Removed +{removed}</p>}
      {note && <p className="mt-2 font-dm-sans text-[15px]" style={{ color: warning }} data-audit="tally-wake">{note}</p>}
      <p className="mt-2 font-dm-sans text-[15px] text-secondary-ink" data-audit="tally-haptics">{HAPTIC_WORDS[kind]}</p>

      {/* UNDO — the largest control after the four (ruling 4). */}
      <button type="button" onClick={undo} disabled={through === 0}
        className="mt-3 min-h-[72px] w-full rounded-xl border-2 border-control-border bg-surface font-dm-sans text-[22px] font-semibold text-ink disabled:opacity-40"
        data-audit="tally-undo">Undo last tap</button>

      {/* THE FOUR. Across the bottom, thumb-sized, one per group size. */}
      <div className="mt-3 grid grid-cols-4 gap-2" data-audit="tally-buttons">
        {TAP_SIZES.map(n => (
          <button key={n} type="button" onClick={() => tap(n)}
            className="min-h-[96px] rounded-xl bg-forest-green font-fraunces text-[40px] font-semibold text-cream transition-transform duration-75 active:scale-95"
            style={flash?.size === n ? { backgroundColor: '#2D6A4F', transform: 'scale(0.96)' } : undefined}
            data-audit={`tally-plus-${n}`} data-lit={flash?.size === n ? 'true' : 'false'} aria-label={`Plus ${n}`}>+{n}</button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => setMode('finish')} className="min-h-[56px] flex-1 rounded-lg border border-forest-green px-4 font-dm-sans text-[17px] font-semibold text-forest-green" data-audit="tally-finish-open">Finish</button>
        <button type="button" onClick={() => setLeaving(true)} className="min-h-[56px] rounded-lg px-4 font-dm-sans text-[17px] font-semibold text-secondary-ink underline underline-offset-2" data-audit="tally-leave">Leave</button>
      </div>

      {/* Ruling 5: a live count cannot be left by accident. */}
      {leaving && (
        <div className="mt-3 rounded-lg border p-3" style={{ borderColor: warning }} role="alert" data-audit="tally-leave-guard">
          <p className="font-dm-sans text-[17px] font-semibold text-ink">Leave a count of {through.toLocaleString('en-US')}?</p>
          <p className="mt-1 font-dm-sans text-[15px] leading-snug text-secondary-ink">The phone keeps it either way — it will be here when you come back. Throwing it away cannot be undone.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setLeaving(false)} className="min-h-[52px] flex-1 rounded-lg bg-forest-green px-4 font-dm-sans text-[16px] font-semibold text-cream" data-audit="tally-stay">Keep counting</button>
            <button type="button" onClick={() => { setLeaving(false); void let_go(); setMode('idle'); setHeld(loadTally()) }} className="min-h-[52px] rounded-lg border border-control-border px-4 font-dm-sans text-[16px] font-semibold text-ink" data-audit="tally-leave-keep">Leave it for later</button>
            <button type="button" onClick={throwAway} className="min-h-[52px] rounded-lg border px-4 font-dm-sans text-[16px] font-semibold" style={{ color: warning, borderColor: warning }} data-audit="tally-leave-discard">Throw it away</button>
          </div>
        </div>
      )}
    </div>
  )
}
