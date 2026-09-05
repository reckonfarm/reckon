'use client'

import { useEffect } from 'react'

// Marks the visit (POST /api/seen) once the Today has actually been in front
// of the person: after DWELL_MS with the tab visible. A bounce does not count
// as having checked. Fire-and-forget; a failure just leaves last_seen where
// it was, and the block shows the same news next time.
const DWELL_MS = 4000

export default function LastSeenPing() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let done = false
    const arm = () => {
      if (done || document.visibilityState !== 'visible') return
      timer = setTimeout(() => { done = true; fetch('/api/seen', { method: 'POST' }).catch(() => {}) }, DWELL_MS)
    }
    const disarm = () => { if (timer) { clearTimeout(timer); timer = null } }
    const onVis = () => { if (document.visibilityState === 'visible') arm(); else disarm() }
    arm()
    document.addEventListener('visibilitychange', onVis)
    return () => { disarm(); document.removeEventListener('visibilitychange', onVis) }
  }, [])
  return null
}
