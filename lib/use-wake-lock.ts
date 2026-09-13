'use client'

import { useEffect, useState } from 'react'

// ─── Keep the screen awake while a working is being recorded (Block 10) ───────
//
// This is not a comfort feature. There is NO service worker in this app — the
// offline-first line in the project bible is not built — so the outbox can
// save without signal but the PAGE cannot reload without it. iOS discards
// backgrounded web views under memory pressure, and a discarded page comes
// back by reloading, which at a chute with no bars lands on the browser's
// offline error instead of the app.
//
// A screen that stays on keeps the page foregrounded, which is the single
// cheapest thing that stops that happening across a working morning. It does
// not make the app offline-capable and must never be described as if it does.
//
// Everything here is best-effort by construction: the API is absent on older
// iOS, the request is refused when the tab is not visible, and the lock is
// dropped by the system on backgrounding — so it is re-taken when the page
// comes back. A failure is reported, never thrown: losing the wake lock must
// not cost a person the entry they were recording.

export type WakeLockState = 'held' | 'unsupported' | 'refused' | 'off'

interface SentinelLike { released: boolean; release: () => Promise<void>; addEventListener: (t: string, f: () => void) => void }

export function useWakeLock(active: boolean): WakeLockState {
  const [state, setState] = useState<WakeLockState>('off')

  useEffect(() => {
    if (!active) { setState('off'); return }
    const api = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<SentinelLike> } }).wakeLock
    if (!api) { setState('unsupported'); return }

    let sentinel: SentinelLike | null = null
    let dropped = false

    const take = async () => {
      if (dropped || document.visibilityState !== 'visible') return
      try {
        sentinel = await api.request('screen')
        setState('held')
        // The system releases it on backgrounding; say so rather than keep
        // claiming the screen is being held awake when it is not.
        sentinel.addEventListener('release', () => { if (!dropped) setState('refused') })
      } catch {
        setState('refused')
      }
    }

    // Re-take when the page comes back: the lock does not survive a trip to
    // the home screen, and the walk back from the chute gate is exactly that.
    const onVisible = () => { if (document.visibilityState === 'visible') void take() }
    document.addEventListener('visibilitychange', onVisible)
    void take()

    return () => {
      dropped = true
      document.removeEventListener('visibilitychange', onVisible)
      void sentinel?.release().catch(() => {})
    }
  }, [active])

  return state
}
