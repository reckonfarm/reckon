'use client'

import { useEffect, useState } from 'react'
import { useOutbox, cancel, STATE_LABEL, type OutboxState } from '@/lib/outbox'
import SaveReceipt from '@/app/components/SaveReceipt'
import FollowUpButton from '@/app/components/FollowUpButton'
import TakeBackButton from '@/app/components/TakeBackButton'

// ─── Save status — the honest answer to "did that save?" (Block 2A) ───────────
// Sits directly under Log it. Shows the most recent entry's state in the four
// words the outbox defines. The outbox holds each state for a minimum dwell,
// so "Saved on this phone → Waiting to sync → Synced to ranch" is always seen
// in order even on a fast network.
// Pending count when more than one is waiting; Retry / Discard on a refusal;
// Undo while an entry is still held on the phone (2B); the consequence lines
// once the server has said what the entry meant (2C).

// The outbox enforces the minimum dwell per state (MIN_DWELL_MS), so the
// strip is a pure function of the stored state — nothing to sequence here.

const TONE: Record<OutboxState, string> = {
  local:  'bg-forest-green/[0.06] text-forest-green',
  queued: 'bg-amber-50 text-amber-900 border border-amber-200',
  synced: 'bg-forest-green/[0.06] text-forest-green',
  failed: 'bg-red-50 text-red-900 ring-1 ring-red-200',
}

function Dot({ state }: { state: OutboxState }) {
  const color = state === 'failed' ? 'bg-red-600' : state === 'queued' ? 'bg-amber-500' : 'bg-forest-green'
  return <span aria-hidden className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${color} ${state === 'queued' ? 'animate-pulse' : ''}`} />
}

// `itemId` pins the strip to one entry (Repeat last shows the entry it just
// made, with its undo, right where the tap happened); default = the latest.
// `fadeAfterMs`: how long a synced receipt stays (Today's strip under Record:
// ten minutes; the global strip on every other page: a short while).
// The refresh of the server-rendered ledgers after a sync is NOT here — it is
// RecordSheetHost's SyncRefresh, once, on every page (Block 6D).
export default function SaveStatus({ itemId, fadeAfterMs = 10 * 60 * 1000 }: { itemId?: string; fadeAfterMs?: number } = {}) {
  const items = useOutbox()
  // Block 11 (P0): A SYNCED RECEIPT IS TRANSIENT AND BELONGS TO THIS VIEW.
  // The outbox lives in localStorage because unsynced work must survive a
  // reload — that is the whole offline promise. A receipt must not: on the
  // audit it survived navigation AND a full reload, still describing a
  // feeding that had since been deleted. So a synced entry is shown only if
  // it synced while THIS view was open. The component is keyed by pathname
  // where it is mounted globally, so a navigation remounts it and a reload
  // obviously does. Unsynced entries are untouched by this and still cross
  // reloads, because "you have work that has not reached the ranch" is not a
  // receipt, it is a warning.
  const [viewOpenedAt] = useState(() => Date.now())
  const item = itemId ? items.find(i => i.id === itemId) ?? null : items.length ? items[items.length - 1] : null
  const shown = item?.state ?? null
  const [now, setNow] = useState(0)

  // A clock, ticked in an effect (never read in render): drives the undo
  // countdown and the "old news" cutoff below.
  const holding = !!(item && item.undoable && item.holdUntil && item.state === 'local')
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const t = setInterval(tick, holding ? 250 : 30_000)
    const first = setTimeout(tick, 0)
    return () => { clearInterval(t); clearTimeout(first) }
  }, [holding, item?.id])
  const held = item && item.undoable && item.holdUntil && now > 0 && item.holdUntil > now && item.state === 'local' ? item : null

  if (!item || !shown) return null
  // Block 15 (ruling 2): a refused record is shown ONCE, in the waiting list
  // with its reason and Fix — never also here.
  if (item.state === 'failed') return null
  // Synced before this view existed → it is history, not a receipt.
  if (item.state === 'synced' && (!item.syncedAt || item.syncedAt < viewOpenedAt)) return null
  // And even within a view, a receipt has said its piece after a while.
  if (item.state === 'synced' && item.syncedAt && now > 0 && now - item.syncedAt > fadeAfterMs) return null

  const secondsLeft = held ? Math.ceil((held.holdUntil! - now) / 1000) : 0

  return (
    <div role="status" aria-live="polite" className={`rounded-lg px-4 py-3 font-dm-sans ${TONE[shown]}`}>
      {shown === 'synced' ? (
        // Block 5C — one receipt: what was recorded, what it meant, the exact entry.
        <div className="flex items-start gap-3">
          <Dot state={shown} />
          <div className="min-w-0 flex-1">
            <SaveReceipt headline={STATE_LABEL.synced} label={item.label} lines={item.consequence?.lines ?? []} eventId={item.serverId ?? item.id} href={item.link?.href} eventLabel={item.link?.label} tone="strip" />
            {/* Block 14: the one thing the server offered after the entry landed. */}
            {item.followUp && <div className="pointer-events-auto"><FollowUpButton itemId={item.id} followUp={item.followUp} /></div>}
            {/* Block 15 (ruling 3): a working — the check and its split — is one record with one Undo. */}
            {item.body.type === 'group_action' && <div className="pointer-events-auto"><TakeBackButton eventId={item.serverId ?? item.id} label={item.label} /></div>}
          </div>
        </div>
      ) : (
      <div className="flex items-center gap-3">
        <Dot state={shown} />
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-semibold leading-snug">{STATE_LABEL[shown]}</p>
          <p className="mt-0.5 text-[16px] leading-snug opacity-80">{item.label}</p>
        </div>
        {held && (
          <button
            type="button"
            onClick={() => { cancel(held.id) }}
            className="min-h-[48px] shrink-0 rounded-lg border border-forest-green/25 px-4 font-dm-sans text-[16px] font-semibold text-forest-green hover:bg-forest-green/5"
          >
            Undo · {secondsLeft}s
          </button>
        )}
      </div>
      )}
    </div>
  )
}
