'use client'

import { useRef } from 'react'
import type { TouchEvent } from 'react'

// ─── Sheets close by swipe down (Block 15, ruling 6) ─────────────────────────
// A pull of 80 px or more, mostly downward, on a sheet that is scrolled to its
// top closes it. The sheet's own scrolling is untouched: a touch that began
// while the content was scrolled is never a close, and nothing here calls
// preventDefault, so the browser keeps scrolling as it would.
const CLOSE_PX = 80

export function useSwipeDown(onClose: () => void, enabled = true) {
  const start = useRef<{ x: number; y: number; scrolled: boolean } | null>(null)
  return {
    onTouchStart: (e: TouchEvent<HTMLElement>) => {
      if (!enabled) return
      const t = e.touches[0]
      start.current = { x: t.clientX, y: t.clientY, scrolled: e.currentTarget.scrollTop > 0 }
    },
    onTouchEnd: (e: TouchEvent<HTMLElement>) => {
      const s = start.current
      start.current = null
      if (!s || s.scrolled) return
      const t = e.changedTouches[0]
      const dy = t.clientY - s.y, dx = Math.abs(t.clientX - s.x)
      if (dy >= CLOSE_PX && dy > dx * 2 && e.currentTarget.scrollTop <= 0) onClose()
    },
    onTouchCancel: () => { start.current = null },
  }
}
