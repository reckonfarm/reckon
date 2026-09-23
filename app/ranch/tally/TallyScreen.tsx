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
  total, undoTap, type Tally, type TapSize, saveTally } from '@/lib/tally'

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

export interface TallyPlace { id: string; name: string; kind: string }

export default function TallyScreen({ lots, initialLotId, initialToId = null, initialFromId = null, places = [] }: { lots: Lot[]; initialLotId: string | null; initialToId?: string | null; initialFromId?: string | null; places?: TallyPlace[] }) {
  const [mode, setMode] = useState<Mode>('idle')
  const [tally, setTally] = useState<Tally | null>(null)
  const [held, setHeld] = useState<Tally | null>(null)      // a count the phone was holding when this opened
  // A counter, not a clock: two taps of the same size in a row have to be two
  // different flashes, and reading the clock while rendering is not allowed.
  const flashSeq = useRef(0)
  const [flash, setFlash] = useState<{ size: TapSize | 'undo'; n: number } | null>(null)
  const [removed, setRemoved] = useState<TapSize | null>(null)
  const [refused, setRefused] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [ending, setEnding] = useState<Ending>('set_head')
  const [newName, setNewName] = useState('')
  const [changing, setChanging] = useState(false)   // Block 42: the top line opened to change bunch / from / to
  const eventId = useRef<string | null>(null)
  // Block 10's hook, unchanged: it takes the lock while a count is live and
  // gives it back when one is not. Declarative, so nothing here has to
  // remember to release it.
  const wake = useWakeLock(mode === 'counting')
  useOwnSaveStrip(mode === 'saved')

  const lotId = tally?.lotId ?? initialLotId
  const source = lots.find(l => l.id === lotId) ?? null
  // Block 42: where they are going (the pasture you stand in) and where they came from (the bunch's place).
  const toId = tally ? (tally.toPlaceId ?? null) : initialToId
  const fromId = tally ? (tally.fromPlaceId ?? null) : (initialFromId ?? source?.place_id ?? null)
  const placeName = (id: string | null) => (id ? places.find(pl => pl.id === id)?.name ?? null : null)
  const countingIn = !!toId
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
  }, [flash?.n, flash])

  const begin = useCallback((seed: Tally | null) => {
    const t = seed ?? startTally(initialLotId, initialFromId ?? lots.find(l => l.id === initialLotId)?.place_id ?? null, initialToId)
    setTally(t); setHeld(null); setRemoved(null); setRefused(false)
    setMode('counting')
  }, [initialLotId, initialFromId, initialToId, lots])

  function tap(size: TapSize) {
    if (!tally) return
    const r = addTap(tally, size)          // written FIRST — the screen follows the phone
    setTally(r.tally)
    setRefused(r.wrote !== 'kept')
    setRemoved(null)
    setFlash({ size, n: ++flashSeq.current })
    confirmTap(size)
  }

  function undo() {
    if (!tally) return
    const r = undoTap(tally)
    if (r.removed === null) return
    setTally(r.tally)
    setRefused(r.wrote !== 'kept')
    setRemoved(r.removed)
    setFlash({ size: 'undo', n: ++flashSeq.current })
    confirmUndo()
  }

  // Block 42: the line at the top changes the bunch, where from, where to — kept with the count.
  function retarget(next: { lotId?: string | null; fromPlaceId?: string | null; toPlaceId?: string | null }) {
    if (!tally) return
    const t: Tally = { ...tally, ...next }
    if ('lotId' in next && !('fromPlaceId' in next)) t.fromPlaceId = lots.find(l => l.id === next.lotId)?.place_id ?? null
    saveTally(t); setTally(t)
  }

  function throwAway() {
    clearTally(); setTally(null); setHeld(null); setLeaving(false); setMode('idle')
  }

  // ── Ruling 6: finishing chooses the meaning ────────────────────────────────
  function save() {
    if (!tally || !source && ending !== 'observation') { setSaveErr(countingIn ? 'Pick the bunch you counted.' : 'Pick what this count means.'); return }
    setSaveErr(null)
    const id = eventId.current ?? (eventId.current = newEventId())
    let body: Record<string, unknown>
    let label: string
    if (countingIn && source && toId) {
      // Block 42 (ruling 1): the count and the move are ONE record — the move's head is
      // what came through, and set_head makes the bunch read it, in the same act.
      body = { id, type: 'cattle_moved', head: through, herd_lot_id: source.id, from_place_id: fromId, to_place_id: toId, place_id: toId, set_head: true }
      label = `Counted ${through} into ${placeName(toId) ?? 'the pasture'} · ${lotLabel(source)} set to ${through}`
    } else if (ending === 'new_bunch' && source) {
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
  }

  // Only a lock that was HELD and then taken back interrupts the count screen.
  const note = wake === 'released' ? wakeNote(wake) : null
  const beforeNote = wake === 'released' ? null : wakeNote(wake)
  const kind = typeof window === 'undefined' ? 'none' : hapticKind()

  // ── A count the phone was holding, offered back (ruling 3) ─────────────────
  if (mode === 'idle' && held && held.taps.length > 0) {
    return (
      <Card className="mt-4 p-4 sm:p-5" data-audit="tally-held">
        <p className="font-dm-sans text-[17px] font-semibold text-ink">A count in progress</p>
        <p className="mt-1 type-main-number text-ink" data-audit="tally-held-total">{total(held.taps).toLocaleString('en-US')}</p>
        <p className="mt-1 font-dm-sans text-[16px] text-secondary-ink" data-audit="tally-held-note">
          {held.taps.length.toLocaleString('en-US')} {held.taps.length === 1 ? 'tap' : 'taps'}
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button type="button" onClick={() => begin(held)} className="min-h-[60px] rounded-lg bg-forest-green px-4 font-dm-sans text-[18px] font-semibold text-cream" data-audit="tally-held-keep">Keep counting</button>
          <button type="button" onClick={() => { setTally(held); setHeld(null); setMode('finish') }} className="min-h-[60px] rounded-lg border border-control-border bg-surface px-4 font-dm-sans text-[18px] font-semibold text-ink" data-audit="tally-held-finish">Finish this count</button>
          <button type="button" onClick={throwAway} className="min-h-[60px] rounded-lg border px-4 font-dm-sans text-[18px] font-semibold" style={{ color: warning, borderColor: warning }} data-audit="tally-held-discard">Throw it away</button>
        </div>
      </Card>
    )
  }

  if (mode === 'idle') {
    return (
      <Card className="mt-4 p-4 sm:p-5" data-audit="tally-start">
        {source && <p className="font-dm-sans text-[17px] font-semibold text-ink" data-audit="tally-subject">{lotLabel(source)} · {bunchDetail(source)}</p>}
        {initialToId && <p className="mt-1 font-dm-sans text-[17px] font-semibold text-ink" data-audit="tally-into">Into {placeName(initialToId) ?? 'the pasture'}</p>}
        <button type="button" onClick={() => begin(null)} className={`${source ? 'mt-4' : ''} min-h-[60px] w-full rounded-lg bg-forest-green px-4 font-dm-sans text-[18px] font-semibold text-cream`} data-audit="tally-begin">Start counting</button>
        {/* What this phone will do when a tap lands — said once, before he
            starts, so the counting screen carries nothing but the count. A
            phone that cannot buzz says so rather than letting him find out at
            the gate that nothing is confirming his thumb. */}
        <p className="mt-3 font-dm-sans text-[15px] text-secondary-ink" data-audit="tally-haptics">{HAPTIC_WORDS[kind]}</p>
        {beforeNote && <p className="mt-1 font-dm-sans text-[15px]" style={{ color: warning }} data-audit="tally-wake-before">{beforeNote}</p>}
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
  if (mode === 'finish' && tally && countingIn) {
    // Block 42: Save writes the move and the count together. One button.
    return (
      <Card className="mt-4 p-4 sm:p-5" data-audit="tally-finish">
        <p className="type-main-number text-ink" data-audit="tally-finish-total">{through.toLocaleString('en-US')}</p>
        <p className="mt-1 font-dm-sans text-[17px] text-ink" data-audit="tally-finish-line">{source ? lotLabel(source) : 'Pick the bunch'} · from {placeName(fromId) ?? '—'} → {placeName(toId) ?? '—'}</p>
        {saveErr && <p role="alert" className="mt-3 font-dm-sans text-[16px] font-semibold" style={{ color: warning }} data-audit="tally-save-error">{saveErr}</p>}
        <div className="mt-4 flex flex-col gap-2">
          <button type="button" onClick={save} className="min-h-[60px] w-full rounded-lg bg-forest-green px-4 font-dm-sans text-[18px] font-semibold text-cream" data-audit="tally-save">Save</button>
          <button type="button" onClick={() => setMode('counting')} className="min-h-[52px] font-dm-sans text-[17px] font-semibold text-secondary-ink underline underline-offset-2" data-audit="tally-back">Back</button>
        </div>
      </Card>
    )
  }

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
          <button type="button" onClick={() => setMode('counting')} className="min-h-[52px] font-dm-sans text-[17px] font-semibold text-secondary-ink underline underline-offset-2" data-audit="tally-back-to-counting">Back</button>
        </div>
      </Card>
    )
  }

  // ── Counting ───────────────────────────────────────────────────────────────
  // Doctrine: the four buttons, the total, the remainder, Undo. Nothing else.
  // Leaving and finishing are ACTIONS, so they are icons with a short word at
  // the top, out of the thumb's way. Nothing on this screen explains what a
  // control already says.
  const line = againstLine(through, against)
  const flashing = flash !== null
  return (
    <div data-audit="tally-counting">
      {/* Block 42 (ruling 2): one small line — which bunch, from where, to where — tap it
          to change any of them. Finish is the only other thing above the number. */}
      <div className="mt-2 flex items-center justify-between gap-3">
        <button type="button" onClick={() => setChanging(c => !c)} aria-expanded={changing}
          className="min-h-[48px] min-w-0 flex-1 truncate text-left font-dm-sans text-[16px] font-semibold text-ink underline decoration-dotted underline-offset-4"
          data-audit="tally-line">
          {source ? lotLabel(source) : 'Pick the bunch'}{countingIn ? ` · from ${placeName(fromId) ?? '—'} → ${placeName(toId) ?? '—'}` : ''}
        </button>
        <button type="button" onClick={() => setMode('finish')} className="inline-flex min-h-[48px] shrink-0 items-center gap-1.5 rounded-lg border border-forest-green px-4 font-dm-sans text-[16px] font-semibold text-forest-green" data-audit="tally-finish-open">
          <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
          Finish
        </button>
      </div>
      {changing && (
        <div className="mt-2 grid grid-cols-1 gap-2 rounded-lg border border-forest-green/15 bg-white p-3" data-audit="tally-change">
          <select value={lotId ?? ''} onChange={e => retarget({ lotId: e.target.value || null })} aria-label="Bunch" className="min-h-[48px] rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[17px] text-ink" data-audit="tally-change-bunch">
            <option value="">Pick the bunch</option>
            {lots.map(l => <option key={l.id} value={l.id}>{lotLabel(l)}</option>)}
          </select>
          <select value={fromId ?? ''} onChange={e => retarget({ fromPlaceId: e.target.value || null })} aria-label="From" className="min-h-[48px] rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[17px] text-ink" data-audit="tally-change-from">
            <option value="">From — no place</option>
            {places.map(pl => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
          </select>
          <select value={toId ?? ''} onChange={e => retarget({ toPlaceId: e.target.value || null })} aria-label="To" className="min-h-[48px] rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[17px] text-ink" data-audit="tally-change-to">
            <option value="">To — just a count</option>
            {places.map(pl => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
          </select>
        </div>
      )}

      {/* THE NUMBER, and under it what is still behind you. */}
      <div className="mt-2 rounded-xl border border-forest-green/15 bg-surface px-4 py-6 text-center transition-colors duration-100"
        style={flashing ? { backgroundColor: 'rgba(27,67,50,0.10)' } : undefined} data-audit="tally-total-box" data-flash={flashing ? 'true' : 'false'}>
        <p className="font-fraunces text-[104px] leading-none font-semibold tabular-nums text-forest-green" data-audit="tally-total">{through.toLocaleString('en-US')}</p>
        {line && <p className="mt-2 font-dm-sans text-[20px] text-ink" data-audit="tally-against">{line}</p>}
      </div>

      {/* A refusal, and a count the phone gave up: the two exceptions. */}
      {refused && (
        <p role="alert" className="mt-2 font-dm-sans text-[16px] font-semibold" style={{ color: warning }} data-audit="tally-refused">
          This phone is full, so the last tap was not kept. Free some space.
        </p>
      )}
      {tallyWasDropped() && (
        <p role="alert" className="mt-2 font-dm-sans text-[16px] font-semibold" style={{ color: warning }} data-audit="tally-taken">
          The phone made room for a record you saved and took this count. What is on screen is all that is left — finish it now.
        </p>
      )}
      {note && <p className="mt-2 font-dm-sans text-[15px]" style={{ color: warning }} data-audit="tally-wake">{note}</p>}
      {removed !== null && <p className="mt-2 font-dm-sans text-[18px] font-semibold text-ink" role="status" data-audit="tally-removed">Removed +{removed}</p>}

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

      {/* Ruling 5: a live count cannot be left by accident. */}
      {leaving && (
        <div className="mt-3 rounded-lg border p-3" style={{ borderColor: warning }} role="alert" data-audit="tally-leave-guard">
          <p className="font-dm-sans text-[17px] font-semibold text-ink">Leave a count of {through.toLocaleString('en-US')}?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setLeaving(false)} className="min-h-[52px] flex-1 rounded-lg bg-forest-green px-4 font-dm-sans text-[16px] font-semibold text-cream" data-audit="tally-stay">Keep going</button>
            <button type="button" onClick={() => { setLeaving(false); setMode('idle'); setHeld(loadTally()) }} className="min-h-[52px] rounded-lg border border-control-border px-4 font-dm-sans text-[16px] font-semibold text-ink" data-audit="tally-leave-keep">Leave it for later</button>
            <button type="button" onClick={throwAway} className="min-h-[52px] rounded-lg border px-4 font-dm-sans text-[16px] font-semibold" style={{ color: warning, borderColor: warning }} data-audit="tally-leave-discard">Throw it away</button>
          </div>
        </div>
      )}
    </div>
  )

}
