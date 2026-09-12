'use client'

import { useCallback, useRef, useState } from 'react'
import {
  GAP_AFTER_S, MAX_ACCURACY_M, SETTLE_MAX_ACC_M, SETTLE_RUNS,
  hasSettled, isOutlier, settledRun, type CaptureFix,
} from '@/lib/places/capture'

// ─── The capture session (Block 8.4 / 8.6) ────────────────────────────────────
//
// One hook owns the receiver, the wake lock and the honesty about both.
//
// 8.6 — RECORDING RUNS ONLY WHILE A CAPTURE IS ACTIVE. watchPosition starts on
// start() and is cleared on stop(), with no background path, no service worker
// and no upload. The fixes live in this component's state and reach the server
// only if the person saves a place, as the evidence behind that polygon. There
// is no code path here that records where anyone is at any other time.
//
// 8.4 — PK's probe settled this. Wake lock was GRANTED and then RELEASED the
// moment the screen went off, the page was hidden for 48 s, and ZERO fixes
// arrived in that window. So the requirement is screen-on and mounted, the gap
// is shown, and it is never bridged. The warning fires the instant the page
// hides rather than waiting to be discovered on return.

export type WakeState = 'unsupported' | 'idle' | 'held' | 'released' | 'refused'

export interface CaptureState {
  running: boolean
  fixes: CaptureFix[]
  /** True once accuracy has settled — nothing counts toward a shape before it. */
  settled: boolean
  settleProgress: number
  wake: WakeState
  /** Set the moment the page is hidden mid-capture, cleared on return. */
  hiddenNow: boolean
  /** Seconds lost to the last hide, so the return can say how much. */
  lastHiddenS: number | null
  rejected: number
  error: string | null
}

export function useCapture() {
  const [state, setState] = useState<CaptureState>({
    running: false, fixes: [], settled: false, settleProgress: 0,
    wake: 'idle', hiddenNow: false, lastHiddenS: null, rejected: 0, error: null,
  })
  const watchRef = useRef<number | null>(null)
  const sentinelRef = useRef<{ release: () => Promise<void> } | null>(null)
  const hiddenAtRef = useRef<number | null>(null)
  const visRef = useRef<(() => void) | null>(null)

  const push = useCallback((f: CaptureFix) => {
    setState(s => {
      const fixes = [...s.fixes, f]
      const usable = fixes.filter(x => !isOutlier(x))
      return {
        ...s,
        fixes,
        rejected: fixes.length - usable.length,
        settled: s.settled || hasSettled(fixes),
        settleProgress: Math.min(SETTLE_RUNS, settledRun(fixes)),
      }
    })
  }, [])

  const start = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState(s => ({ ...s, error: 'This phone will not give the app its position.' }))
      return
    }
    setState(s => ({ ...s, running: true, fixes: [], settled: false, settleProgress: 0, rejected: 0, error: null, hiddenNow: false, lastHiddenS: null }))

    try {
      const nav = navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void>; addEventListener: (e: string, f: () => void) => void }> } }
      if (nav.wakeLock) {
        const sentinel = await nav.wakeLock.request('screen')
        sentinelRef.current = sentinel
        setState(s => ({ ...s, wake: 'held' }))
        sentinel.addEventListener('release', () => setState(s => ({ ...s, wake: 'released' })))
      } else {
        setState(s => ({ ...s, wake: 'unsupported' }))
      }
    } catch {
      setState(s => ({ ...s, wake: 'refused' }))
    }

    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now()
        setState(s => ({ ...s, hiddenNow: true }))
      } else {
        const lost = hiddenAtRef.current ? (Date.now() - hiddenAtRef.current) / 1000 : null
        hiddenAtRef.current = null
        setState(s => ({ ...s, hiddenNow: false, lastHiddenS: lost }))
      }
    }
    visRef.current = onVis
    document.addEventListener('visibilitychange', onVis)

    watchRef.current = navigator.geolocation.watchPosition(
      p => push({ t: Date.now(), lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      e => setState(s => ({ ...s, error: e.message })),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    )
  }, [push])

  const stop = useCallback(async () => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current)
    watchRef.current = null
    if (visRef.current) document.removeEventListener('visibilitychange', visRef.current)
    visRef.current = null
    try { await sentinelRef.current?.release() } catch { /* already gone */ }
    sentinelRef.current = null
    setState(s => ({ ...s, running: false, wake: s.wake === 'held' ? 'idle' : s.wake }))
  }, [])

  return { ...state, start, stop, SETTLE_RUNS, SETTLE_MAX_ACC_M, MAX_ACCURACY_M, GAP_AFTER_S }
}
