'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

// ─── Keeping the screen awake while work is happening ────────────────────────
//
// Two surfaces need this and they need it for the same reason: a phone that
// sleeps stops doing the job. A perimeter ride stops recording fixes (Block 8
// measured it — the wake lock was granted, then released the moment the screen
// went off, and forty-eight seconds of ride went unrecorded). A gate tally goes
// dark between bunches with a man's thumb over a button he can no longer see.
//
// PK's ruling from Block 8 still governs what this can promise: the wake lock
// is RELEASED by the system whenever the page is hidden, and some phones will
// not give it at all. So this reports its state honestly and the screens say so
// — it is never treated as a guarantee that the screen will stay lit.
//
//   'unsupported'  this browser has no wake lock
//   'idle'         not asked for, or released on purpose
//   'held'         granted and held right now
//   'released'     granted, then taken back (the screen locked, or the page hid)
//   'refused'      asked for and denied

export type WakeState = 'unsupported' | 'idle' | 'held' | 'released' | 'refused'

interface Sentinel { release: () => Promise<void>; addEventListener: (e: string, f: () => void) => void }
interface WakeNav { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } }

export function useWakeLock(): { wake: WakeState; hold: () => Promise<void>; let_go: () => Promise<void> } {
  const [wake, setWake] = useState<WakeState>('idle')
  const ref = useRef<Sentinel | null>(null)

  const hold = useCallback(async () => {
    try {
      const nav = navigator as unknown as WakeNav
      if (!nav.wakeLock) { setWake('unsupported'); return }
      const sentinel = await nav.wakeLock.request('screen')
      ref.current = sentinel
      setWake('held')
      sentinel.addEventListener('release', () => setWake('released'))
    } catch {
      setWake('refused')
    }
  }, [])

  const let_go = useCallback(async () => {
    try { await ref.current?.release() } catch { /* already gone */ }
    ref.current = null
    setWake(w => (w === 'held' ? 'idle' : w))
  }, [])

  // The system takes the lock back whenever the page hides. Coming back to the
  // front is the moment to ask again, or the screen quietly stops staying lit
  // for the rest of the job.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible' && ref.current === null && wake === 'released') void hold() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [hold, wake])

  useEffect(() => () => { void ref.current?.release().catch(() => {}) }, [])

  return { wake, hold, let_go }
}

/** The one sentence a screen shows about it. Null when there is nothing to say. */
export function wakeNote(wake: WakeState): string | null {
  if (wake === 'held' || wake === 'idle') return null
  if (wake === 'released') return 'The screen lock came back. Keep the phone awake.'
  return 'This phone will not let the app hold the screen awake — set the auto-lock long.'
}
