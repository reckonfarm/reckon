'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUndo, runUndo, dismissUndo, UNDO_MS } from '@/lib/undo'

// ─── "Deleted · Undo" (Block 13) ──────────────────────────────────────────────
// Mounted once for a signed-in person, above the bottom bar, the same slot the
// save strip uses. Unlike the save strip this one TAKES A TAP — the whole point
// of it is the button — so it is narrow, and the layer around it stays
// pointer-events-none so it covers nothing else.
export default function UndoStrip() {
  const item = useUndo()
  const router = useRouter()
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!item) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [item])
  useEffect(() => {
    // The row is back: the server-rendered list behind the strip must show it.
    if (item?.state === 'undone') router.refresh()
  }, [item?.state, router])
  if (!item) return null
  // Read the clock from state only (ticked in the effect above); before the
  // first tick the strip shows the full ten seconds.
  const remaining = now === 0 ? UNDO_MS : Math.max(0, item.expiresAt - now)
  const left = Math.ceil(remaining / 1000)
  const pct = Math.max(0, Math.min(100, (remaining / UNDO_MS) * 100))
  return (
    <div className="pointer-events-none fixed inset-x-0 z-40 px-4" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 64px)' }} data-audit="undo-layer">
      <div className="pointer-events-auto mx-auto max-w-2xl overflow-hidden rounded-lg bg-ink text-cream shadow-lg" role="status" aria-live="polite" data-audit="undo-strip" data-state={item.state}>
        <div className="flex items-center gap-3 px-4 py-2">
          <p className="min-w-0 flex-1 font-dm-sans text-[17px] leading-snug">
            {item.state === 'undone' ? <><span className="font-semibold">Put back</span> · {item.label}</>
              : item.state === 'failed' ? <span className="font-semibold">{item.error ?? 'It could not be put back.'}</span>
              : <><span className="font-semibold">Deleted</span> · {item.label}</>}
          </p>
          {item.state === 'shown' && (
            <button type="button" onClick={() => void runUndo()} className="min-h-[56px] shrink-0 rounded-lg bg-cream px-5 font-dm-sans text-[17px] font-semibold text-ink" data-audit="undo-button">
              Undo{left > 0 ? ` · ${left}s` : ''}
            </button>
          )}
          {item.state === 'undoing' && <span className="shrink-0 font-dm-sans text-[16px] opacity-80">Putting it back…</span>}
          {item.state !== 'shown' && item.state !== 'undoing' && (
            <button type="button" onClick={dismissUndo} aria-label="Close" className="min-h-[48px] shrink-0 px-3 font-dm-sans text-[16px] opacity-80">OK</button>
          )}
        </div>
        {item.state === 'shown' && <div className="h-1 bg-cream/70 transition-[width] duration-200" style={{ width: `${pct}%` }} aria-hidden />}
      </div>
    </div>
  )
}
