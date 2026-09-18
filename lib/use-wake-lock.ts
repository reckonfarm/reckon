'use client'

import { useEffect, useState } from 'react'

// ─── Keep the screen awake while a working is being recorded (Block 10) ───────
//
// This is not a comfort feature. iOS discards backgrounded web views under
// memory pressure, and a discarded page comes back by reloading. A screen that
// stays on keeps the page foregrounded, which is the single cheapest thing
// that stops that happening across a working morning.
//
// (Written at Block 10, when there was no service worker and a reload at a
// chute with no bars landed on the browser's offline error. Block 15 shipped
// one — public/sw.js — so a reload now finds the app shell. That makes this
// less load-bearing than it was; it does not make it pointless, because a
// reload still costs whatever the screen was holding that had not been
// written down.)
//
// Block 22 leans on it for a different reason: a man counting cattle at a gate
// cannot have the screen go dark between bunches with his thumb over a button
// he can no longer see.
//
// Everything here is best-effort by construction: the API is absent on older
// iOS, the request is refused when the tab is not visible, and the lock is
// dropped by the system on backgrounding — so it is re-taken when the page
// comes back. A failure is reported, never thrown: losing the wake lock must
// not cost a person the entry they were recording.

export type WakeLockState = 'held' | 'unsupported' | 'refused' | 'off'

interface SentinelLike { released: boolean; release: () => Promise<void>; addEventListener: (t: string, f: () => void) => void }

export function useWakeLock(active: boolean): WakeLockState {
  // 'off' is DERIVED from `active`, not written into state by the effect. An
  // effect whose whole body is a setState is a cascading render, and the
  // answer to "is a wake lock being held right now" when nothing asked for one
  // is simply no — it does not need to be stored to be true.
  const [held, setHeld] = useState<'off' | 'held' | 'refused'>('off')
  // Whether this browser HAS the API is not a fact about this component, so it
  // is read, not stored. (Server-side there is no navigator and this reads
  // false — which never shows, because nothing asks for a wake lock until a
  // person has started something.)
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator

  useEffect(() => {
    if (!active || !supported) return
    const api = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<SentinelLike> } }).wakeLock
    if (!api) return

    let sentinel: SentinelLike | null = null
    let dropped = false

    const take = async () => {
      if (dropped || document.visibilityState !== 'visible') return
      try {
        sentinel = await api.request('screen')
        setHeld('held')
        // The system releases it on backgrounding; say so rather than keep
        // claiming the screen is being held awake when it is not.
        sentinel.addEventListener('release', () => { if (!dropped) setHeld('refused') })
      } catch {
        setHeld('refused')
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
  }, [active, supported])

  if (!active) return 'off'
  if (!supported) return 'unsupported'
  return held
}

/**
 * The one sentence a screen says about it, or nothing when there is nothing to
 * say. Kept beside the states so two screens cannot describe them differently.
 */
export function wakeNote(state: WakeLockState): string | null {
  if (state === 'held' || state === 'off') return null
  if (state === 'refused') return 'The screen lock came back. Keep the phone awake.'
  return 'This phone will not let the app hold the screen awake — set the auto-lock long.'
}
