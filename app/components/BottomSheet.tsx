'use client'
import React, { useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react'

// ─── The one bottom sheet (Block 26c) ────────────────────────────────────────
// Every sheet in the app is this. PK, after using the map on his phone: sheets
// behave the way the phone's own sheets do, and nothing else —
//   · a grabber bar at the top;
//   · swipe down to dismiss: the sheet FOLLOWS the finger, goes on a flick or
//     a long enough pull, snaps back otherwise. Only while the sheet's own
//     content is scrolled to its top, so scrolling a long sheet never closes it;
//   · tap the dimmed ground behind it to dismiss;
//   · no Close button — the two gestures are the close.
// On a wide screen it is a centred card and the same two gestures still work.
// Motion respects the phone's reduced-motion setting (the CSS does; the
// finger-follow is the finger, not motion).
const DISMISS_PX = 120           // a pull this long dismisses on its own
const FLICK_PX_PER_MS = 0.5      // or a short quick one

export default function BottomSheet({ open, onClose, label, children, z = 70, audit, panelAudit = 'bottom-sheet', maxHeight = '90vh', className = '', panelRef }: {
  open: boolean
  onClose: () => void
  /** The accessible name of the dialog — one short phrase. */
  label: string
  children: ReactNode
  z?: number
  audit?: string
  /** The panel's own data-audit (a suite reads the sheet by it). */
  panelAudit?: string
  maxHeight?: string
  className?: string
  panelRef?: React.RefObject<HTMLDivElement | null>
}) {
  const panel = useRef<HTMLDivElement | null>(null)
  const start = useRef<{ y: number; t: number; scrolled: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [dy, setDy] = useState(0)
  // The pull so far, readable the instant the finger lifts — a flick can start
  // and end inside one tick, before React has re-rendered the state.
  const pulled = useRef(0)
  const [leaving, setLeaving] = useState(false)
  // Every caller renders this under `open &&`, so a closed sheet is an unmounted one and state starts fresh.
  // A keyboard has no swipe: Escape is its pull-down.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null

  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    const t = e.touches[0]
    start.current = { y: t.clientY, t: Date.now(), scrolled: (panel.current?.scrollTop ?? 0) > 0 }
    setDragging(true)
  }
  const onTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    const s = start.current
    if (!s || s.scrolled) return
    const d = e.touches[0].clientY - s.y
    if (d > 0 && (panel.current?.scrollTop ?? 0) <= 0) { pulled.current = d; setDy(d) }
  }
  const onTouchEnd = () => {
    const s = start.current
    start.current = null
    setDragging(false)
    if (!s) return
    const d = pulled.current
    pulled.current = 0
    const v = d / Math.max(1, Date.now() - s.t)
    if (d >= DISMISS_PX || (d > 24 && v >= FLICK_PX_PER_MS)) { setLeaving(true); setTimeout(onClose, 120) }
    else setDy(0)
  }

  return (
    <div className="fixed inset-0 flex items-end justify-center bg-black/40 sm:items-center" style={{ zIndex: z }} onClick={onClose} role="dialog" aria-modal="true" aria-label={label} data-audit={audit}>
      <div
        ref={el => { panel.current = el; if (panelRef) panelRef.current = el }}
        onClick={e => e.stopPropagation()}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={() => { start.current = null; pulled.current = 0; setDragging(false); setDy(0) }}
        className={`sheet-in w-full max-w-md overflow-y-auto rounded-t-2xl bg-cream px-5 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] pt-3 sm:rounded-2xl sm:pb-5 ${className}`}
        style={{ maxHeight, transform: dy || leaving ? `translateY(${leaving ? '110%' : `${dy}px`})` : undefined, transition: dragging ? 'none' : 'transform 160ms ease-out' }}
        data-audit={panelAudit}
      >
        <div aria-hidden className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-forest-green/25" data-audit="sheet-grabber" />
        {children}
      </div>
    </div>
  )
}
