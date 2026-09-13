'use client'

import { useRef, useState } from 'react'
import { enqueue, newEventId } from '@/lib/outbox'
import { useWakeLock } from '@/lib/use-wake-lock'
import SaveStatus from '@/app/dashboard/components/SaveStatus'
import { GROUP_ACTION_TYPE, MAX_GROUP_NAME } from '@/lib/cattle/kinds'
import { warning } from '@/lib/brand-colors'

// ─── Preg check at the chute (Block 10) ───────────────────────────────────────
//
// Built for one hand, in the cold, on one bar. Two ways in, because PK will
// pick whichever fits the morning:
//
//   TALLY — one big Bred button, one big Open button, a tap per animal as they
//   come out. The count builds itself. This is how the work actually goes: he
//   is watching cows come out one at a time, not holding a total in his head.
//   A mis-tap at a chute is not a possibility, it is a certainty, so Undo is a
//   first-class control and names what it will take back.
//
//   TOTALS — the count through and the opens, with bred calculated. For when
//   the numbers come off the vet's sheet or the chute's own counter.
//
// BOTH MODES ARE THE SAME TWO NUMBERS. State is (counted, open) and bred is
// counted − open, in both:
//   · a Bred tap is counted + 1, open unchanged  → bred + 1
//   · an Open tap is counted + 1 and open + 1    → bred unchanged
// So switching modes mid-working carries everything across and loses nothing,
// and there is exactly one arithmetic on the screen rather than two that could
// drift apart.
//
// WHAT MAKES IT SAFE, and none of it is in this file:
//   · the outbox saves to the phone before the network is touched, mints the
//     event id here, and retries with that same id — so a double-tap or a
//     force-quit cannot make two workings (lib/outbox);
//   · reconciliation, the compare-and-set on the source count, and moving the
//     head counts all happen in one transaction inside 063's function, so
//     nothing can half-apply;
//   · the screen stays awake while this page is open, because there is no
//     service worker and a page iOS discards comes back by RELOADING, which
//     at a chute with no bars is the browser's offline error and not the app
//     (lib/use-wake-lock).

export interface ChuteLot { id: string; name: string; head: number; updatedAt: string }

type Mode = 'tally' | 'totals'
type Tap = 'bred' | 'open'

const STEP = [1, 5, 10] as const
const btn = 'inline-flex items-center justify-center rounded-xl font-dm-sans font-semibold'
const pad = `${btn} min-h-[64px] min-w-[64px] border border-control-border bg-surface text-[22px] text-ink active:bg-forest-green/10`
const field = 'block w-full min-h-[56px] rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[18px] text-ink'

export default function PregCheck({ lots, today }: { lots: ChuteLot[]; today: string }) {
  const [mode, setMode] = useState<Mode>('tally')
  const [sourceId, setSourceId] = useState<string | null>(lots.length === 1 ? lots[0].id : null)
  const [counted, setCounted] = useState(0)
  const [open, setOpen] = useState(0)
  const [taps, setTaps] = useState<Tap[]>([])
  const [destId, setDestId] = useState<string>('')        // '' = a new group
  const [destName, setDestName] = useState(`Open cows ${today}`)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const eventId = useRef<string | null>(null)

  // Held for the whole page, not just while saving: the risk is the page being
  // discarded BETWEEN bunches, which is most of a working morning.
  const wake = useWakeLock(true)

  const source = lots.find(l => l.id === sourceId) ?? null
  const bred = Math.max(0, counted - open)
  const overOpen = open > counted
  const reconciles = counted > 0 && !overOpen
  const dest = lots.find(l => l.id === destId) ?? null

  function tap(which: Tap) {
    setCounted(c => c + 1)
    if (which === 'open') setOpen(o => o + 1)
    setTaps(t => [...t, which])
    setError(null)
  }

  function undo() {
    const last = taps[taps.length - 1]
    if (!last) return
    setCounted(c => Math.max(0, c - 1))
    if (last === 'open') setOpen(o => Math.max(0, o - 1))
    setTaps(t => t.slice(0, -1))
  }

  function reset() {
    setCounted(0); setOpen(0); setTaps([]); eventId.current = null
  }

  function save() {
    setError(null)
    if (!source) { setError('Pick the bunch you are working.'); return }
    if (!reconciles) { setError('The numbers do not add up yet.'); return }
    if (open > 0 && !destId && !destName.trim()) { setError('Name the group the opens go to.'); return }

    const id = eventId.current ?? (eventId.current = newEventId())
    const body: Record<string, unknown> = {
      id,
      type: GROUP_ACTION_TYPE,
      action: 'preg_check',
      source_lot_id: source.id,
      expected_head: source.head,
      counted,
      stay: bred,
      results: open > 0
        ? [destId ? { lot_id: destId, head: open } : { lot_id: null, name: destName.trim().slice(0, MAX_GROUP_NAME), head: open }]
        : [],
    }
    const where = open === 0 ? 'none open' : `${open} open to ${dest ? dest.name : destName.trim()}`
    try {
      enqueue(body, `Preg check · ${counted} counted · ${where}`)
    } catch {
      setError("Couldn't save — this phone refused to store it. Write it down.")
      return
    }
    setSaved(id)
    reset()
  }

  // ── Pick the bunch ──────────────────────────────────────────────────────────
  if (!source) {
    return (
      <div data-audit="preg-pick-lot">
        <p className="font-dm-sans text-[18px] text-ink">Which bunch are you working?</p>
        {lots.length === 0 && (
          <p className="mt-3 font-dm-sans text-[16px] text-ink" data-audit="preg-no-lots">
            There are no bunches on the ranch yet. Add one under Ranch → Cattle first — this screen moves head
            between bunches, so it needs one to move from.
          </p>
        )}
        <div className="mt-3 grid gap-3">
          {lots.map(l => (
            <button key={l.id} type="button" onClick={() => setSourceId(l.id)} data-audit="preg-lot-choice" data-lot={l.id}
              className={`${btn} min-h-[72px] w-full justify-between border border-control-border bg-surface px-5 text-[20px] text-ink`}>
              <span>{l.name}</span>
              <span className="text-secondary-ink">{l.head.toLocaleString()} head</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  const equation = counted === 0
    ? (mode === 'tally' ? 'Tap one for every cow as she comes out.' : 'Count them through first.')
    : overOpen
      ? `${open.toLocaleString()} open is more than the ${counted.toLocaleString()} counted — one of those is wrong.`
      : `${bred.toLocaleString()} bred + ${open.toLocaleString()} open = ${counted.toLocaleString()} counted`

  return (
    <div data-audit="preg-check" data-mode={mode}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-dm-sans text-[18px] font-semibold text-ink" data-audit="preg-source">
          {source.name} · {source.head.toLocaleString()} head
        </p>
        {lots.length > 1 && (
          <button type="button" onClick={() => { setSourceId(null); setSaved(null); reset() }} data-audit="preg-change-lot"
            className="font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2">
            Change
          </button>
        )}
      </div>

      {/* Both modes are the same two numbers, so switching carries everything
          across — no confirmation, no lost taps. */}
      <div className="mt-3 flex gap-2" role="group" aria-label="How to enter it" data-audit="preg-mode">
        {(['tally', 'totals'] as const).map(m => (
          <button key={m} type="button" onClick={() => setMode(m)} data-audit={`preg-mode-${m}`} aria-pressed={mode === m}
            className={`${btn} min-h-[48px] grow px-4 text-[17px] ${mode === m ? 'bg-brand text-cream' : 'border border-control-border bg-surface text-ink'}`}>
            {m === 'tally' ? 'Tap each one' : 'Type totals'}
          </button>
        ))}
      </div>

      {/* The running answer, big enough to read at arm's length. */}
      <div className="mt-5 text-center" data-audit="preg-running">
        <p className="type-main-number text-ink" data-audit="preg-counted-value">{counted.toLocaleString()}</p>
        <p className="font-dm-sans text-[16px] text-ink">counted through</p>
        <p className="mt-2 font-dm-sans text-[20px] font-semibold text-ink">
          <span data-audit="preg-bred-value">{bred.toLocaleString()}</span> bred
          {' · '}
          <span data-audit="preg-open-value">{open.toLocaleString()}</span> open
        </p>
      </div>

      {mode === 'tally' ? (
        <div className="mt-5" data-audit="preg-tally">
          {/* Thumb country: the two targets a person hits a hundred times are
              the biggest things on the screen, and Undo is deliberately not
              beside them. */}
          <div className="flex gap-3">
            <button type="button" onClick={() => tap('bred')} data-audit="preg-tap-bred"
              className={`${btn} min-h-[112px] grow bg-brand text-[26px] text-cream active:opacity-80`}>
              Bred
            </button>
            <button type="button" onClick={() => tap('open')} data-audit="preg-tap-open"
              className={`${btn} min-h-[112px] grow border-2 border-forest-green bg-surface text-[26px] text-ink active:bg-forest-green/10`}>
              Open
            </button>
          </div>
          <button type="button" onClick={undo} disabled={taps.length === 0} data-audit="preg-undo"
            className={`${btn} mt-3 min-h-[56px] w-full border border-control-border bg-surface px-4 text-[17px] text-ink disabled:opacity-40`}>
            {taps.length === 0 ? 'Nothing to undo' : `Undo that ${taps[taps.length - 1]} one`}
          </button>
        </div>
      ) : (
        <div className="mt-5" data-audit="preg-totals">
          <Stepper label="Counted through" value={counted} onChange={n => { setCounted(n); setTaps([]) }} audit="preg-counted" />
          <Stepper label="Open" value={open} onChange={n => { setOpen(n); setTaps([]) }} audit="preg-open" />
        </div>
      )}

      {/* The arithmetic, always on screen — never a surprise at Record it. */}
      <p className={`mt-4 font-dm-sans text-[17px] font-semibold ${reconciles || counted === 0 ? 'text-ink' : ''}`}
         style={reconciles || counted === 0 ? undefined : { color: warning }}
         data-audit="preg-equation" data-reconciles={reconciles ? 'true' : 'false'}>
        {equation}
      </p>
      {/* Ruling 1: the chute count is an observation of real animals; the
          stored number was an estimate. Say the difference, do not block on it. */}
      {counted > 0 && counted !== source.head && (
        <p className="mt-1 font-dm-sans text-[16px] text-ink" data-audit="preg-discrepancy">
          {source.name} said {source.head.toLocaleString()}. Going with the {counted.toLocaleString()} you counted — both go on the record.
        </p>
      )}

      {open > 0 && (
        <div className="mt-5" data-audit="preg-destination">
          <label className="block font-dm-sans text-[14px] font-medium text-secondary-ink" htmlFor="preg-dest">
            The {open.toLocaleString()} open go to
          </label>
          <select id="preg-dest" value={destId} onChange={e => setDestId(e.target.value)} data-audit="preg-dest-select" className={`mt-1 ${field}`}>
            <option value="">A new group</option>
            {lots.filter(l => l.id !== source.id).map(l => (
              <option key={l.id} value={l.id}>{l.name} ({l.head.toLocaleString()} head)</option>
            ))}
          </select>
          {!destId && (
            <input value={destName} onChange={e => setDestName(e.target.value)} maxLength={MAX_GROUP_NAME}
              className={`mt-2 ${field}`} aria-label="Name for the new group" data-audit="preg-dest-name" />
          )}
        </div>
      )}

      {error && (
        <p className="mt-4 font-dm-sans text-[17px] font-semibold" style={{ color: warning }} role="alert" data-audit="preg-error">{error}</p>
      )}

      <button type="button" onClick={save} disabled={!reconciles} data-audit="preg-save"
        className={`${btn} mt-5 min-h-[72px] w-full bg-brand px-5 text-[20px] text-cream disabled:opacity-50`}>
        Record it
      </button>

      {saved && <div className="mt-3"><SaveStatus itemId={saved} /></div>}

      {/* Honest about what the wake lock is and is not. It keeps the page in
          front so iOS does not discard it; it does not make the app work with
          no signal from a cold start, and must never be read that way. */}
      <p className="mt-5 font-dm-sans text-[14px] text-secondary-ink" data-audit="preg-wake" data-state={wake}>
        {wake === 'held'
          ? 'Screen staying on while this page is open, so the app is still here between bunches.'
          : wake === 'unsupported'
            ? 'This phone will not hold the screen on. Keep the app in front between bunches.'
            : 'Screen may sleep. Keep the app in front between bunches.'}
      </p>
    </div>
  )
}

function Stepper({ label, value, onChange, audit }: {
  label: string; value: number; onChange: (n: number) => void; audit: string
}) {
  return (
    <div className="mt-4" data-audit={audit}>
      <span className="font-dm-sans text-[18px] font-semibold text-ink">{label}</span>
      <div className="mt-2 flex gap-2">
        {STEP.map(s => (
          <button key={`-${s}`} type="button" className={pad} onClick={() => onChange(Math.max(0, value - s))} data-audit={`${audit}-minus-${s}`}>
            −{s}
          </button>
        ))}
        <span className="grow" />
        {STEP.map(s => (
          <button key={`+${s}`} type="button" className={pad} onClick={() => onChange(value + s)} data-audit={`${audit}-plus-${s}`}>
            +{s}
          </button>
        ))}
      </div>
      <input
        type="number" inputMode="numeric" min={0} value={value === 0 ? '' : String(value)} placeholder="0"
        onChange={e => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        className={`mt-2 ${field} text-[22px]`} aria-label={`${label} — type it`} data-audit={`${audit}-input`}
      />
    </div>
  )
}
