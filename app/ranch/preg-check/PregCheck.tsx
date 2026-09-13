'use client'

import { useMemo, useRef, useState } from 'react'
import { enqueue, newEventId } from '@/lib/outbox'
import { useWakeLock } from '@/lib/use-wake-lock'
import SaveStatus from '@/app/dashboard/components/SaveStatus'
import { GROUP_ACTION_TYPE, MAX_GROUP_NAME } from '@/lib/cattle/kinds'
import { warning } from '@/lib/brand-colors'

// ─── Preg check at the chute (Block 10) ───────────────────────────────────────
//
// Built for one hand, in the cold, on one bar. Everything on this screen is
// either a 64px target or a number big enough to read at arm's length, and the
// arithmetic is on screen at all times so it is never a surprise at Save.
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
//
// The reconciliation is stated as an equation, not as a validation error:
// "200 bred + 12 open = 212 · matches the 212 counted". PK counts out loud;
// the screen should agree with him out loud.

export interface ChuteLot { id: string; name: string; head: number; updatedAt: string }

const STEP = [1, 5, 10] as const
const btn = 'inline-flex items-center justify-center rounded-xl font-dm-sans font-semibold'
const pad = `${btn} min-h-[64px] min-w-[64px] border border-control-border bg-surface text-[22px] text-ink active:bg-forest-green/10`

function Counter({ label, value, onChange, audit }: {
  label: string; value: number; onChange: (n: number) => void; audit: string
}) {
  return (
    <div className="mt-4" data-audit={audit}>
      <div className="flex items-baseline justify-between">
        <span className="font-dm-sans text-[18px] font-semibold text-ink">{label}</span>
        <span className="type-main-number text-ink" data-audit={`${audit}-value`}>{value.toLocaleString()}</span>
      </div>
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
        className="mt-2 block w-full min-h-[56px] rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[22px] text-ink"
        aria-label={`${label} — type it`}
        data-audit={`${audit}-input`}
      />
    </div>
  )
}

export default function PregCheck({ lots, today }: { lots: ChuteLot[]; today: string }) {
  const [sourceId, setSourceId] = useState<string | null>(lots.length === 1 ? lots[0].id : null)
  const [counted, setCounted] = useState(0)
  const [open, setOpen] = useState(0)
  const [destId, setDestId] = useState<string>('')        // '' = a new group
  const [destName, setDestName] = useState(`Open cows ${today}`)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const eventId = useRef<string | null>(null)

  // Held for the whole page, not just while saving: the risk is the page being
  // discarded BETWEEN entries, which is most of a working morning.
  const wake = useWakeLock(true)

  const source = lots.find(l => l.id === sourceId) ?? null
  const bred = Math.max(0, counted - open)
  const reconciles = counted > 0 && open <= counted
  const dest = lots.find(l => l.id === destId) ?? null

  const equation = useMemo(() => {
    if (counted === 0) return 'Count them through first.'
    if (open > counted) return `${open.toLocaleString()} open is more than the ${counted.toLocaleString()} counted — one of those is wrong.`
    return `${bred.toLocaleString()} bred + ${open.toLocaleString()} open = ${counted.toLocaleString()} · matches the ${counted.toLocaleString()} counted`
  }, [bred, open, counted])

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
    eventId.current = null
    setCounted(0)
    setOpen(0)
  }

  // ── Pick the bunch ──────────────────────────────────────────────────────────
  if (!source) {
    return (
      <div data-audit="preg-pick-lot">
        <p className="font-dm-sans text-[18px] text-ink">Which bunch are you working?</p>
        {lots.length === 0 && (
          <p className="mt-3 font-dm-sans text-[16px] text-ink" data-audit="preg-no-lots">
            There are no bunches on the ranch yet. Add one under Ranch → Herd first — this screen moves head
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

  return (
    <div data-audit="preg-check">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-dm-sans text-[18px] font-semibold text-ink" data-audit="preg-source">
          {source.name} · {source.head.toLocaleString()} head
        </p>
        {lots.length > 1 && (
          <button type="button" onClick={() => { setSourceId(null); setSaved(null) }} data-audit="preg-change-lot"
            className="font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2">
            Change
          </button>
        )}
      </div>

      <Counter label="Counted through" value={counted} onChange={setCounted} audit="preg-counted" />
      <Counter label="Open" value={open} onChange={setOpen} audit="preg-open" />

      {/* The arithmetic, always on screen — never a surprise at Save. */}
      <p className={`mt-4 font-dm-sans text-[17px] font-semibold ${reconciles ? 'text-ink' : ''}`}
         style={reconciles ? undefined : { color: warning }} data-audit="preg-equation" data-reconciles={reconciles ? 'true' : 'false'}>
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
          <select id="preg-dest" value={destId} onChange={e => setDestId(e.target.value)} data-audit="preg-dest-select"
            className="mt-1 block w-full min-h-[56px] rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[18px] text-ink">
            <option value="">A new group</option>
            {lots.filter(l => l.id !== source.id).map(l => (
              <option key={l.id} value={l.id}>{l.name} ({l.head.toLocaleString()} head)</option>
            ))}
          </select>
          {!destId && (
            <input value={destName} onChange={e => setDestName(e.target.value)} maxLength={MAX_GROUP_NAME}
              className="mt-2 block w-full min-h-[56px] rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[18px] text-ink"
              aria-label="Name for the new group" data-audit="preg-dest-name" />
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
