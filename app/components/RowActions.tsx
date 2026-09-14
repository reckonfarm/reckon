'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

// ─── Tap-and-hold on any row → Open · Edit · Delete (Block 12, 12.3) ──────────
// One gesture everywhere: an activity entry, a place, a lot, a device. Hold a
// row for half a second and a sheet offers the three things a person does to
// a row. The row itself still taps to open, exactly as before — this wraps a
// row, it does not replace its link.
//
// Desktop equivalent (PK asked): RIGHT-CLICK opens the same sheet, and a ⋯
// button appears at the row's right edge on hover for people who never
// right-click. The three entries are the same three, in the same order.
//
// The row says what Edit and Delete mean for it by passing hrefs; this
// component owns the gesture and the sheet, nothing else. A row with no
// editHref shows no Edit.

const HOLD_MS = 500
const MOVE_TOLERANCE_PX = 10

export interface RowActionLinks {
  openHref: string
  editHref?: string | null
  deleteHref?: string | null
  /** Names the row in the sheet: "Fed 4 bales", "Watergap", "Cull cows". */
  label: string
}

export default function RowActions({ links, children, className = '' }: { links: RowActionLinks; children: ReactNode; className?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const timer = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)

  const clear = () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null } }

  // Hold, without drifting: a scroll is not a hold.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    fired.current = false
    start.current = { x: e.clientX, y: e.clientY }
    clear()
    timer.current = window.setTimeout(() => { fired.current = true; setOpen(true) }, HOLD_MS)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return
    if (Math.abs(e.clientX - start.current.x) > MOVE_TOLERANCE_PX || Math.abs(e.clientY - start.current.y) > MOVE_TOLERANCE_PX) clear()
  }
  const onPointerUp = () => { clear(); start.current = null }
  // A held row must not ALSO navigate when the finger lifts.
  const onClickCapture = (e: React.MouseEvent) => { if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false } }
  const onContextMenu = (e: React.MouseEvent) => { e.preventDefault(); setOpen(true) }

  useEffect(() => () => clear(), [])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const go = (href: string) => { setOpen(false); router.push(href) }

  return (
    <div
      className={`group relative ${className}`}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onClickCapture={onClickCapture} onContextMenu={onContextMenu}
      data-audit="row-actions"
    >
      {children}
      {/* Desktop: a ⋯ at the row's right edge on hover — the same sheet. */}
      <button
        type="button"
        onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(true) }}
        aria-label={`Actions for ${links.label}`}
        data-audit="row-more"
        className="absolute right-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-secondary-ink hover:bg-forest-green/5 md:group-hover:inline-flex"
      >
        ⋯
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label={`Actions for ${links.label}`} data-audit="row-actions-sheet">
          <div className="w-full max-w-md rounded-t-2xl bg-cream px-5 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] pt-4 sm:rounded-2xl sm:pb-5" onClick={e => e.stopPropagation()}>
            <p className="font-dm-sans text-[15px] text-secondary-ink">{links.label}</p>
            <div className="mt-3 grid gap-2">
              <button type="button" onClick={() => go(links.openHref)} className="min-h-[56px] rounded-lg border border-control-border bg-surface px-4 text-left font-dm-sans text-[17px] font-semibold text-ink" data-audit="row-action-open">Open</button>
              {links.editHref && (
                <button type="button" onClick={() => go(links.editHref!)} className="min-h-[56px] rounded-lg border border-control-border bg-surface px-4 text-left font-dm-sans text-[17px] font-semibold text-ink" data-audit="row-action-edit">Edit</button>
              )}
              {links.deleteHref && (
                <button type="button" onClick={() => go(links.deleteHref!)} className="min-h-[56px] rounded-lg border border-rust/40 bg-surface px-4 text-left font-dm-sans text-[17px] font-semibold text-rust" data-audit="row-action-delete">Delete</button>
              )}
              <button type="button" onClick={() => setOpen(false)} className="min-h-[48px] px-4 font-dm-sans text-[16px] font-semibold text-secondary-ink" data-audit="row-action-cancel">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
