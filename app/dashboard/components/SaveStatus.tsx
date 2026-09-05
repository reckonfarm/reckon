'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useOutbox, cancel, retry, discard, flush, STATE_LABEL, type OutboxItem, type OutboxState } from '@/lib/outbox'

// ─── Save status — the honest answer to "did that save?" (Block 2A) ───────────
// Sits directly under Log it. Shows the most recent entry's state in the four
// words the outbox defines, never skipping one: each state is held on screen
// for at least MIN_SHOW_MS even when the network is fast, so "Saved on this
// phone → Waiting to sync → Synced to ranch" is always seen in order.
// Pending count when more than one is waiting; Retry / Discard on a refusal;
// Undo while an entry is still held on the phone (2B); the consequence lines
// once the server has said what the entry meant (2C). When the latest entry
// syncs, the page refreshes once so the ledgers below pick it up.

const MIN_SHOW_MS = 700
const ORDER: OutboxState[] = ['local', 'queued', 'synced']

function useSequenced(item: OutboxItem | null): OutboxState | null {
  const [shown, setShown] = useState<OutboxState | null>(null)
  const lastId = useRef<string | null>(null)
  const lastAt = useRef<number>(0)

  useEffect(() => {
    const target = item?.state ?? null
    const fresh = item?.id !== lastId.current
    const wait = fresh ? 0 : Math.max(0, MIN_SHOW_MS - (Date.now() - lastAt.current))
    const t = setTimeout(() => {
      lastId.current = item?.id ?? null
      lastAt.current = Date.now()
      setShown(prev => {
        if (target === null) return null
        // A fresh entry always opens on its first state, however fast the
        // network moved it on — the sequence is never skipped.
        if (fresh) return target === 'failed' ? 'failed' : 'local'
        if (prev === null || prev === target || target === 'failed' || prev === 'failed') return target
        // Advance one state at a time along local → queued → synced.
        const i = ORDER.indexOf(prev), j = ORDER.indexOf(target)
        return j > i ? ORDER[i + 1] : target
      })
    }, wait)
    return () => clearTimeout(t)
  }, [item, shown])

  return shown
}

const TONE: Record<OutboxState, string> = {
  local:  'bg-forest-green/[0.06] text-forest-green',
  queued: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200',
  synced: 'bg-forest-green/[0.06] text-forest-green',
  failed: 'bg-red-50 text-red-900 ring-1 ring-red-200',
}

function Dot({ state }: { state: OutboxState }) {
  const color = state === 'failed' ? 'bg-red-600' : state === 'queued' ? 'bg-amber-500' : 'bg-forest-green'
  return <span aria-hidden className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${color} ${state === 'queued' ? 'animate-pulse' : ''}`} />
}

// `itemId` pins the strip to one entry (Repeat last shows the entry it just
// made, with its undo, right where the tap happened); default = the latest.
export default function SaveStatus({ itemId }: { itemId?: string } = {}) {
  const router = useRouter()
  const items = useOutbox()
  const item = itemId ? items.find(i => i.id === itemId) ?? null : items.length ? items[items.length - 1] : null
  const shown = useSequenced(item)
  const refreshed = useRef<Set<string>>(new Set())
  const [now, setNow] = useState(0)

  // Refresh the server-rendered ledgers once per synced entry.
  useEffect(() => {
    for (const i of items) {
      if (i.state === 'synced' && !refreshed.current.has(i.id)) {
        refreshed.current.add(i.id)
        router.refresh()
      }
    }
  }, [items, router])

  // A clock, ticked in an effect (never read in render): drives the undo
  // countdown and the "old news" cutoff below.
  const holding = !!(item && item.holdUntil && item.state !== 'synced')
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const t = setInterval(tick, holding ? 250 : 30_000)
    const first = setTimeout(tick, 0)
    return () => { clearInterval(t); clearTimeout(first) }
  }, [holding, item?.id])
  const held = item && item.holdUntil && now > 0 && item.holdUntil > now && item.state !== 'synced' ? item : null

  if (!item || !shown) return null
  // A synced entry older than a few minutes has said its piece.
  if (item.state === 'synced' && item.syncedAt && now > 0 && now - item.syncedAt > 10 * 60 * 1000) return null

  const waiting = items.filter(i => i.state === 'local' || i.state === 'queued').length
  const secondsLeft = held ? Math.ceil((held.holdUntil! - now) / 1000) : 0

  return (
    <div role="status" aria-live="polite" className={`rounded-lg px-4 py-3 font-dm-sans ${TONE[shown]}`}>
      <div className="flex items-center gap-3">
        <Dot state={shown} />
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-semibold leading-snug">{STATE_LABEL[shown]}</p>
          <p className="mt-0.5 text-[15px] leading-snug opacity-80">
            {item.label}
            {shown === 'queued' && item.lastError ? ` · ${item.lastError}` : ''}
            {shown === 'failed' && item.lastError ? ` · ${item.lastError}` : ''}
            {waiting > 1 ? ` · ${waiting} waiting` : ''}
          </p>
        </div>
        {held && (
          <button
            type="button"
            onClick={() => { cancel(held.id) }}
            className="min-h-[48px] shrink-0 rounded-lg border border-forest-green/25 px-4 font-dm-sans text-[15px] font-semibold text-forest-green hover:bg-forest-green/5"
          >
            Undo · {secondsLeft}s
          </button>
        )}
        {shown === 'failed' && (
          <div className="flex shrink-0 flex-col gap-1">
            <button type="button" onClick={() => retry(item.id)} className="min-h-[48px] rounded-lg bg-forest-green px-4 font-dm-sans text-[15px] font-semibold text-white hover:bg-forest-green/90">Try again</button>
            <button type="button" onClick={() => discard(item.id)} className="px-2 font-dm-sans text-[13px] font-semibold text-red-900/70 hover:text-red-900">Discard</button>
          </div>
        )}
        {shown === 'queued' && !held && (
          <button type="button" onClick={() => void flush()} className="min-h-[48px] shrink-0 rounded-lg border border-amber-300 px-4 font-dm-sans text-[15px] font-semibold text-amber-900 hover:bg-amber-100">Sync now</button>
        )}
      </div>
      {shown === 'synced' && item.consequence && item.consequence.lines.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-forest-green/10 pt-3">
          {item.consequence.lines.map((l, i) => (
            <li key={i} className={i === 0 ? 'text-[17px] font-semibold text-forest-green' : 'text-[15px] text-forest-green/80'}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
