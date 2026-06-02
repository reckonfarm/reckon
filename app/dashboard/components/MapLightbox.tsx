'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  src: string
  alt: string
}

const MAX_SCALE = 5
const SWIPE_CLOSE_PX = 110 // downward drag (un-zoomed) that dismisses

// Full-screen, mobile-grade image inspector shared by every dashboard map card.
// Pinch to zoom, drag to pan when zoomed, double-tap to toggle zoom, swipe down
// (or tap outside / X / Esc) to dismiss. Locks body scroll while open and
// restores it on close, so the page returns to the same scroll position.
export default function MapLightbox({ open, onClose, src, alt }: Props) {
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const [gesturing, setGesturing] = useState(false)

  const pts = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinch = useRef<{ dist: number; scale: number } | null>(null)
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const lastTap = useRef(0)

  // Reset transform whenever it opens.
  useEffect(() => {
    if (open) { setScale(1); setTx(0); setTy(0) }
  }, [open])

  // Lock background scroll without moving the page (overflow:hidden keeps the
  // current scroll position; restored exactly on close).
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  const dist = () => {
    const [a, b] = [...pts.current.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  function onPointerDown(e: React.PointerEvent) {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    setGesturing(true)
    if (pts.current.size === 2) {
      pinch.current = { dist: dist(), scale }
      drag.current = null
    } else if (pts.current.size === 1) {
      drag.current = { x: e.clientX, y: e.clientY, tx, ty }
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pts.current.has(e.pointerId)) return
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pts.current.size >= 2 && pinch.current) {
      const next = Math.min(MAX_SCALE, Math.max(1, pinch.current.scale * (dist() / pinch.current.dist)))
      setScale(next)
      if (next === 1) { setTx(0); setTy(0) }
      return
    }
    if (pts.current.size === 1 && drag.current) {
      const dx = e.clientX - drag.current.x
      const dy = e.clientY - drag.current.y
      if (scale > 1) { setTx(drag.current.tx + dx); setTy(drag.current.ty + dy) }
      else { setTy(dy) } // un-zoomed: track vertical for swipe-to-dismiss
    }
  }

  function endPointer(e: React.PointerEvent) {
    pts.current.delete(e.pointerId)

    if (pts.current.size === 0) {
      setGesturing(false)
      if (scale <= 1) {
        if (ty > SWIPE_CLOSE_PX) { onClose(); return }
        setTx(0); setTy(0) // snap back
        // double-tap toggle (quick tap, negligible drag)
        const now = Date.now()
        const moved = drag.current ? Math.hypot(e.clientX - drag.current.x, e.clientY - drag.current.y) : 0
        if (moved < 8) {
          if (now - lastTap.current < 300) { setScale(2.5) }
          lastTap.current = now
        }
      }
      drag.current = null
      pinch.current = null
    } else if (pts.current.size === 1) {
      // pinch → single-finger pan handoff
      const [p] = [...pts.current.entries()]
      drag.current = { x: p[1].x, y: p[1].y, tx, ty }
      pinch.current = null
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-2xl leading-none text-white backdrop-blur hover:bg-white/25"
      >
        ×
      </button>

      <div
        className="flex h-[100dvh] w-screen items-center justify-center overflow-hidden"
        style={{ touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          onClick={e => e.stopPropagation()}
          className="max-h-[92vh] max-w-[96vw] select-none object-contain"
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transition: gesturing ? 'none' : 'transform 0.2s ease',
          }}
        />
      </div>

      <p className="pointer-events-none absolute bottom-4 left-0 right-0 text-center text-xs text-white/60">
        Pinch or double-tap to zoom · swipe down or tap outside to close
      </p>
    </div>
  )
}
