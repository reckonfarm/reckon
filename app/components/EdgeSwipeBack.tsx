'use client'

import { useEffect, useState } from 'react'

// ─── Edge-swipe back, everywhere (Block 15, ruling 6) ────────────────────────
// The home-screen app has no browser chrome and, on iOS, no back gesture of its
// own. A swipe that starts at the left edge and travels right goes back one
// page — unless a sheet is open, where a swipe is the sheet's to handle. A
// chevron follows the finger so the gesture is seen before it fires.
const EDGE_PX = 24
const FIRE_PX = 80

export default function EdgeSwipeBack() {
  const [pull, setPull] = useState(0)
  useEffect(() => {
    let start: { x: number; y: number } | null = null
    const sheetOpen = () => !!document.querySelector('[role="dialog"][aria-modal="true"]')
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]
      start = t.clientX <= EDGE_PX && !sheetOpen() ? { x: t.clientX, y: t.clientY } : null
    }
    const onMove = (e: TouchEvent) => {
      if (!start) return
      const t = e.touches[0]
      const dx = t.clientX - start.x, dy = Math.abs(t.clientY - start.y)
      if (dy > 60) { start = null; setPull(0); return }
      setPull(Math.max(0, Math.min(dx, FIRE_PX + 20)))
    }
    const onEnd = (e: TouchEvent) => {
      const s = start
      start = null
      setPull(0)
      if (!s) return
      const t = e.changedTouches[0]
      const dx = t.clientX - s.x, dy = Math.abs(t.clientY - s.y)
      if (dx >= FIRE_PX && dy < 60 && window.history.length > 1) window.history.back()
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    window.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [])
  if (pull < 20) return null
  return (
    <div aria-hidden className="pointer-events-none fixed left-0 top-1/2 z-[80] -translate-y-1/2" style={{ transform: `translate(${Math.round(pull - 44)}px, -50%)`, opacity: Math.min(1, pull / FIRE_PX) }} data-audit="edge-back">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-forest-green text-[22px] text-cream shadow-pop">‹</span>
    </div>
  )
}
