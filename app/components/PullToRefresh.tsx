'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

// ─── Pull to refresh (Block 15, ruling 6) ────────────────────────────────────
// Every list is a server page; the home-screen app has no reload button. A
// pull down from the top of the page re-reads it. Nothing here blocks the
// browser's own scrolling, and a sheet that is open keeps the gesture.
const SHOW_PX = 24
const FIRE_PX = 72

export default function PullToRefresh() {
  const router = useRouter()
  const [pull, setPull] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let start: { x: number; y: number } | null = null
    const sheetOpen = () => !!document.querySelector('[role="dialog"][aria-modal="true"]')
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]
      start = window.scrollY <= 0 && !sheetOpen() ? { x: t.clientX, y: t.clientY } : null
    }
    const onMove = (e: TouchEvent) => {
      if (!start) return
      const t = e.touches[0]
      const dy = t.clientY - start.y, dx = Math.abs(t.clientX - start.x)
      if (dx > 40 || window.scrollY > 0) { start = null; setPull(0); return }
      setPull(Math.max(0, Math.min(dy, FIRE_PX + 24)))
    }
    const onEnd = (e: TouchEvent) => {
      const s = start
      start = null
      setPull(0)
      if (!s) return
      const t = e.changedTouches[0]
      if (t.clientY - s.y >= FIRE_PX && window.scrollY <= 0) {
        setBusy(true)
        router.refresh()
        setTimeout(() => setBusy(false), 900)
      }
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
  }, [router])
  if (!busy && pull < SHOW_PX) return null
  const text = busy ? 'Refreshing…' : pull >= FIRE_PX ? 'Let go to refresh' : 'Pull to refresh'
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed left-1/2 top-[calc(env(safe-area-inset-top,0px)+12px)] z-[80] -translate-x-1/2" data-audit="pull-refresh">
      <span className="rounded-full bg-forest-green px-4 py-2 font-dm-sans text-[15px] font-semibold text-cream shadow-pop">{text}</span>
    </div>
  )
}
