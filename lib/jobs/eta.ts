import type { TrackPoint } from './derive'
import type { BoundaryResult } from './boundary'
import { computeSweep } from './sweep'

// ─── ETA — remaining area ÷ recent sweep rate ──────────────────────────────────
//
// The rate comes from a trailing window of WORKING time, never from:
//   · the whole-job average — poisoned by the outside rounds, which sweep the
//     same acreage at a much longer perimeter-per-acre;
//   · tick-to-tick deltas — poisoned by sync bursts, where thirty events land
//     in one cron tick and none in the next.
// Working time accumulates hop-by-hop with each hop capped at workingHopMaxS,
// so a coffee break contributes sixty seconds to the window, not twenty
// minutes — the window measures cutting, and pauses stretch it in wall-clock
// terms instead of diluting it.
//
// The doctrine is the same as percent-cut: coarse or absent, never precise and
// never clamped. "About 40 min left", rounded to 5. If the number would be
// negative, absurd, or built on less than one full window, there is no number.
// Hidden during pauses rather than counting up — a stopped machine has no ETA,
// it has a stop. Display-only: nothing stored, no schema.
//
// Rides every boundary guard by construction: no 'ok' boundary → computeSweep
// returns null → no ETA. Same two numbers, same honesty.

export const ETA_CONFIG = {
  windowWorkingS: 18 * 60, // trailing rate window, in working (not wall) time
  workingHopMaxS: 60, // a hop longer than this contributes only this much
  pauseHideAfterMs: 4 * 60 * 1000, // silence beyond this = paused → no ETA
  minRateM2PerS: 0.5, // ~0.45 ac/h — below this the window is noise, not work
  maxSaneEtaS: 12 * 3600, // longer than a long day = something's wrong → hide
  roundToMin: 5,
} as const

export interface EtaResult {
  /** Rounded to the nearest 5 min, never below 5. Null = show nothing. */
  minutes: number | null
}

export function computeEta(
  track: TrackPoint[],
  boundary: BoundaryResult,
  nowMs: number = Date.now(),
  cfg: typeof ETA_CONFIG = ETA_CONFIG,
): EtaResult {
  const none: EtaResult = { minutes: null }
  if (track.length < 2) return none

  // Paused (or finished): the last impact is too old. Hide, never count up.
  const lastMs = track[track.length - 1].t * 1000
  if (nowMs - lastMs > cfg.pauseHideAfterMs) return none

  // Walk back through working time until one full window is banked.
  let acc = 0
  let windowStart = track.length - 1
  while (windowStart > 0 && acc < cfg.windowWorkingS) {
    const dt = track[windowStart].t - track[windowStart - 1].t
    acc += Math.min(Math.max(dt, 0), cfg.workingHopMaxS)
    windowStart--
  }
  if (acc < cfg.windowWorkingS) return none // job younger than one window

  const now = computeSweep(track, boundary)
  const then = computeSweep(track, boundary, windowStart)
  if (now == null || then == null) return none

  const remainingM2 = now.boundaryInsideM2 - now.sweptInsideM2
  if (remainingM2 <= 0) return none // done (or overshot) — percent says 100

  const rate = (now.sweptInsideM2 - then.sweptInsideM2) / acc
  if (rate < cfg.minRateM2PerS) return none

  const etaS = remainingM2 / rate
  if (!Number.isFinite(etaS) || etaS <= 0 || etaS > cfg.maxSaneEtaS) return none

  const minutes = Math.max(cfg.roundToMin, Math.round(etaS / 60 / cfg.roundToMin) * cfg.roundToMin)
  return { minutes }
}
