// ─── The bale detector — auto-calibrated gate-slam finder over one job ─────────
//
// Ground truth (Aug 8, 32 bales counted by the operator): the gate close IS
// the bale. The signature is an asymmetric pair — a small eject thunk, then
// ~7 s later a huge, wide tailgate slam — and the amplitude distribution of a
// baling job is cleanly bimodal: chatter below, slams above, with a real gap
// between the modes.
//
// DOCTRINE (decisions of 2026-08-09):
//   * NO HARDCODED THRESHOLD. The cut is discovered from the job's own
//     amplitude distribution (maximum between-class variance on log-mg).
//     A constant is right for exactly one baler.
//   * The discovered cut must pass a real EFFECT-SIZE test and the slam set
//     must look like a MECHANICAL CYCLE (regular, refractory-respecting) —
//     "no bale signature found" is a first-class result, not an error.
//     Amplitude alone cannot say "baler": the Aug 7 rake day carries
//     slam-class rock strikes (15,918 mg) and the Aug 5 swather day a smooth
//     5–7 g tail; both must come out no_signature.
//   * Every Aug 8 constant (precursor window, refractory, width split) enters
//     as EVIDENCE that moves confidence — never as a hard gate on a clear
//     slam. The only physics-derived floor is the refractory: a wrap-eject-
//     close cycle cannot complete twice in under ~45 s on any round baler.
//   * Confidence is explained: every detection stores the named evidence
//     behind its number. The marginal slam records visibly weaker.
//
// Pure module: no I/O, no Date.now(). lib/detections/run-detection.ts does
// the I/O. Any change here = bump BALE_DETECTOR_VERSION and re-run; detections
// are a rebuildable artifact, never source data.

export const BALE_DETECTOR = 'bale'
export const BALE_DETECTOR_VERSION = 'bale-v1.0.0'
// The machine kind (job_annotations.machine) whose confirmation this
// detector's results belong to.
export const BALE_MACHINE = 'baler'

export const BALE_CONFIG = {
  // ── Evidence floors ──
  // Below this many amplitude-carrying events a distribution can't show its
  // shape — the verdict is insufficient_evidence, stored, never guessed.
  minEvents: 20,
  // A "mode" of 1–2 points is an outlier, not a mode.
  minSlams: 3,
  // ── Signature acceptance (day-level, machine-agnostic process tests) ──
  // Separation between modes vs their pooled spread, on log amplitude
  // (impacts are multiplicative). Cohen's-d-shaped; 2.5 is far apart.
  minEffectSize: 2.5,
  // A gate cycle (wrap 20–40 s + eject + close) cannot complete twice in
  // under ~45 s on any round baler — physics, not an Aug 8 fit. Slam pairs
  // closer than this are echoes/noise, and a slam SET full of them is not a
  // baler at work.
  minRefractoryS: 45,
  maxRefractoryViolationShare: 0.15,
  // A mechanical cycle is regular; random strikes are not. Robust dispersion
  // of inter-slam intervals: (p75 − p25) / (p75 + p25), immune to one long
  // windrow move or a coffee break.
  maxIntervalDispersion: 0.6,
  // ── Per-detection evidence (Aug 8 observed; confidence only, never gates) ──
  precursorWindowS: 20, // eject thunk precedes the slam by ~7 s
  precursorMaxM: 30, //    …and lands within meters (machine is stationary)
  companionWindowS: 30, // any neighbor event this close marks stationarity
  slamWidthMin: 7, //      width axis: slams ran 7–14, everything else 1–6
  // ── Marginal admission (the 5,877 mg case) ──
  // Below the cut but within reach of it, an event may still be a bale — IF
  // enough independent evidence agrees. It records at low confidence.
  marginalFloorRatio: 0.7, // candidate band: [cut × ratio, cut)
  marginalMinEvidence: 3, //  of: width, precursor, rhythm slot, stationarity
  rhythmGapRatio: 1.5, //     a marginal must fill an anomalously long gap
} as const

export interface BaleEventInput {
  id: string
  seq: number
  t: number // unix seconds, device GPS time (only credible-timed events)
  lat: number | null
  lng: number | null
  mg: number // peak_mg (events without amplitude can't vote)
  w: number | null // width; null on pre-v0.3.0 firmware — abstains, never votes
}

interface SourceEvent {
  id: string
  seq: number
  mg: number
  w: number | null
}

export interface BaleDetection {
  anchorSeq: number
  ts: string
  lat: number | null
  lng: number | null
  confidence: number
  source: {
    slam: SourceEvent
    precursor: SourceEvent | null
    echoes: SourceEvent[] // same-cycle slams merged into this one
  }
  evidence: {
    marginal: boolean // admitted from below the cut
    ampMargin: number // 0..1, depth above the cut toward the hi-mode median
    width: 'wide' | 'narrow' | 'unknown'
    precursor: boolean
    rhythm: boolean // ≥ refractory from the nearest other detection
    stationary: boolean
  }
}

export interface BaleRunMetrics {
  eventCount: number // amplitude-carrying, credibly-timed events considered
  cut: number | null // discovered amplitude threshold (raw mg)
  gapBelowMg: number | null // last lo-mode value under the cut
  gapAboveMg: number | null // first hi-mode value over it
  effectSize: number | null
  hiCount: number | null
  loCount: number | null
  medianIntervalS: number | null
  intervalDispersion: number | null
  refractoryViolationShare: number | null
  hiWidthMedian: number | null // null when the job pre-dates width firmware
  failedChecks: string[] // why the verdict is what it is
}

export interface BaleRunResult {
  outcome: 'detected' | 'no_signature' | 'insufficient_evidence'
  detections: BaleDetection[]
  metrics: BaleRunMetrics
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function quantileSorted(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
}

function distM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// ─── Cut discovery: maximum between-class variance (Otsu) on log amplitude.
// Returns the split index into the SORTED log array: [0, idx) = lo, [idx, n) = hi.
function otsuSplit(sortedLog: number[], minHi: number): number | null {
  const n = sortedLog.length
  const total = sortedLog.reduce((a, b) => a + b, 0)
  let bestIdx: number | null = null
  let bestVar = -1
  let loSum = 0
  for (let idx = 1; idx <= n - minHi; idx++) {
    loSum += sortedLog[idx - 1]
    if (sortedLog[idx] === sortedLog[idx - 1]) continue // not a real boundary
    const nLo = idx
    const nHi = n - idx
    const muLo = loSum / nLo
    const muHi = (total - loSum) / nHi
    const betweenVar = ((nLo * nHi) / (n * n)) * (muHi - muLo) ** 2
    if (betweenVar > bestVar) {
      bestVar = betweenVar
      bestIdx = idx
    }
  }
  return bestIdx
}

export function detectBales(
  events: BaleEventInput[],
  cfg: typeof BALE_CONFIG = BALE_CONFIG
): BaleRunResult {
  const metrics: BaleRunMetrics = {
    eventCount: events.length,
    cut: null,
    gapBelowMg: null,
    gapAboveMg: null,
    effectSize: null,
    hiCount: null,
    loCount: null,
    medianIntervalS: null,
    intervalDispersion: null,
    refractoryViolationShare: null,
    hiWidthMedian: null,
    failedChecks: [],
  }
  const done = (outcome: BaleRunResult['outcome'], detections: BaleDetection[] = []): BaleRunResult => ({
    outcome,
    detections,
    metrics,
  })

  const ordered = [...events].sort((a, b) => a.seq - b.seq)

  // ── Floor 1: enough data to have a shape at all ──
  if (ordered.length < cfg.minEvents) {
    metrics.failedChecks.push(`events ${ordered.length} < ${cfg.minEvents}`)
    return done('insufficient_evidence')
  }

  // ── Discover the cut on log amplitude ──
  const logs = ordered.map(e => Math.log(e.mg)).sort((a, b) => a - b)
  const splitIdx = otsuSplit(logs, cfg.minSlams)
  if (splitIdx === null) {
    metrics.failedChecks.push('no split point (uniform amplitudes)')
    return done('no_signature')
  }
  const loLogs = logs.slice(0, splitIdx)
  const hiLogs = logs.slice(splitIdx)
  metrics.gapBelowMg = Math.round(Math.exp(loLogs[loLogs.length - 1]))
  metrics.gapAboveMg = Math.round(Math.exp(hiLogs[0]))
  // The cut sits at the geometric middle of the empty gap between modes.
  const cut = Math.round(Math.exp((loLogs[loLogs.length - 1] + hiLogs[0]) / 2))
  metrics.cut = cut
  metrics.hiCount = hiLogs.length
  metrics.loCount = loLogs.length

  // ── Effect size: are these genuinely two modes, far apart vs their spread? ──
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const muLo = mean(loLogs)
  const muHi = mean(hiLogs)
  const sq = (xs: number[], mu: number) => xs.reduce((a, x) => a + (x - mu) ** 2, 0)
  const pooledStd = Math.sqrt((sq(loLogs, muLo) + sq(hiLogs, muHi)) / logs.length) || 1e-9
  metrics.effectSize = Number(((muHi - muLo) / pooledStd).toFixed(2))

  const slams = ordered.filter(e => e.mg >= cut)
  const hiWidths = slams.map(s => s.w).filter((w): w is number => w != null)
  metrics.hiWidthMedian = median(hiWidths)

  if (slams.length < cfg.minSlams) {
    metrics.failedChecks.push(`slams ${slams.length} < ${cfg.minSlams}`)
    return done('no_signature')
  }
  if (metrics.effectSize < cfg.minEffectSize) {
    metrics.failedChecks.push(`effect size ${metrics.effectSize} < ${cfg.minEffectSize}`)
    return done('no_signature')
  }

  // ── Cycle tests: does the slam set behave like a repeating mechanism? ──
  // Refractory violations are counted BEFORE echo-merging — a rake day's
  // rock-strike bursts must show up here, not be merged away.
  const rawIntervals: number[] = []
  for (let i = 1; i < slams.length; i++) rawIntervals.push(slams[i].t - slams[i - 1].t)
  const violations = rawIntervals.filter(iv => iv < cfg.minRefractoryS).length
  metrics.refractoryViolationShare = Number((violations / rawIntervals.length).toFixed(2))

  // Echo-merge for the interval-regularity test and for detection building:
  // slams inside one refractory window are one gate close (keep the biggest).
  const merged: { slam: BaleEventInput; echoes: BaleEventInput[] }[] = []
  for (const s of slams) {
    const last = merged[merged.length - 1]
    if (last && s.t - last.slam.t < cfg.minRefractoryS) {
      if (s.mg > last.slam.mg) {
        last.echoes.push(last.slam)
        last.slam = s
      } else {
        last.echoes.push(s)
      }
    } else {
      merged.push({ slam: s, echoes: [] })
    }
  }

  const intervals: number[] = []
  for (let i = 1; i < merged.length; i++) intervals.push(merged[i].slam.t - merged[i - 1].slam.t)
  const sortedIv = [...intervals].sort((a, b) => a - b)
  metrics.medianIntervalS = median(intervals)
  if (intervals.length >= 2) {
    const p25 = quantileSorted(sortedIv, 0.25)
    const p75 = quantileSorted(sortedIv, 0.75)
    metrics.intervalDispersion = Number(((p75 - p25) / (p75 + p25 || 1)).toFixed(2))
  }

  if (metrics.refractoryViolationShare > cfg.maxRefractoryViolationShare) {
    metrics.failedChecks.push(
      `refractory violations ${metrics.refractoryViolationShare} > ${cfg.maxRefractoryViolationShare}`
    )
  }
  if (metrics.intervalDispersion != null && metrics.intervalDispersion > cfg.maxIntervalDispersion) {
    metrics.failedChecks.push(
      `interval dispersion ${metrics.intervalDispersion} > ${cfg.maxIntervalDispersion}`
    )
  }
  if (metrics.failedChecks.length > 0) return done('no_signature')

  // ── Signature accepted: build detections ──
  const hiMedianMg = median(slams.map(s => s.mg))!
  const bySeqIdx = new Map(ordered.map((e, i) => [e.seq, i]))

  const findPrecursor = (slam: BaleEventInput): BaleEventInput | null => {
    const idx = bySeqIdx.get(slam.seq)!
    for (let i = idx - 1; i >= 0; i--) {
      const e = ordered[i]
      const dt = slam.t - e.t
      if (dt > cfg.precursorWindowS) break
      if (e.mg >= cut) continue // another slam is not a precursor
      const near =
        e.lat == null || e.lng == null || slam.lat == null || slam.lng == null
          ? true // no fix on one side — distance abstains
          : distM(e.lat, e.lng, slam.lat, slam.lng) <= cfg.precursorMaxM
      if (near) return e
    }
    return null
  }

  const hasCompanion = (ev: BaleEventInput): boolean =>
    ordered.some(e => {
      if (e.seq === ev.seq) return false
      if (Math.abs(e.t - ev.t) > cfg.companionWindowS) return false
      if (e.lat == null || e.lng == null || ev.lat == null || ev.lng == null) return true
      return distM(e.lat, e.lng, ev.lat, ev.lng) <= cfg.precursorMaxM
    })

  const toSource = (e: BaleEventInput): SourceEvent => ({ id: e.id, seq: e.seq, mg: e.mg, w: e.w })

  const detections: BaleDetection[] = merged.map(({ slam, echoes }) => {
    const precursor = findPrecursor(slam)
    const width: BaleDetection['evidence']['width'] =
      slam.w == null ? 'unknown' : slam.w >= cfg.slamWidthMin ? 'wide' : 'narrow'
    const ampMargin = Math.max(0, Math.min(1, (slam.mg - cut) / Math.max(1, hiMedianMg - cut)))
    return {
      anchorSeq: slam.seq,
      ts: new Date(slam.t * 1000).toISOString(),
      lat: slam.lat,
      lng: slam.lng,
      confidence: 0, // filled below, after rhythm is known against the final set
      source: { slam: toSource(slam), precursor: precursor ? toSource(precursor) : null, echoes: echoes.map(toSource) },
      evidence: {
        marginal: false,
        ampMargin: Number(ampMargin.toFixed(2)),
        width,
        precursor: precursor != null,
        rhythm: false,
        stationary: hasCompanion(slam),
      },
    }
  })

  // ── Marginal admission: below the cut, enough independent evidence agrees ──
  // (the 5,877 mg bale on Aug 8 — recorded, at visibly lower confidence)
  const marginalFloor = cut * cfg.marginalFloorRatio
  const medIv = metrics.medianIntervalS ?? Infinity
  for (const e of ordered) {
    if (e.mg >= cut || e.mg < marginalFloor) continue
    // Slot: between two accepted slams, filling an anomalously long gap,
    // a refractory away from both.
    const prev = [...merged].reverse().find(m => m.slam.t < e.t)
    const next = merged.find(m => m.slam.t > e.t)
    const rhythmSlot =
      prev != null &&
      next != null &&
      next.slam.t - prev.slam.t >= cfg.rhythmGapRatio * medIv &&
      e.t - prev.slam.t >= cfg.minRefractoryS &&
      next.slam.t - e.t >= cfg.minRefractoryS
    const precursor = findPrecursor(e)
    const widthWide = e.w != null && e.w >= cfg.slamWidthMin
    const stationary = hasCompanion(e)
    const score = [widthWide, precursor != null, rhythmSlot, stationary].filter(Boolean).length
    if (score < cfg.marginalMinEvidence) continue
    detections.push({
      anchorSeq: e.seq,
      ts: new Date(e.t * 1000).toISOString(),
      lat: e.lat,
      lng: e.lng,
      confidence: 0,
      source: { slam: toSource(e), precursor: precursor ? toSource(precursor) : null, echoes: [] },
      evidence: {
        marginal: true,
        ampMargin: 0,
        width: e.w == null ? 'unknown' : widthWide ? 'wide' : 'narrow',
        precursor: precursor != null,
        rhythm: rhythmSlot,
        stationary,
      },
    })
  }

  detections.sort((a, b) => a.anchorSeq - b.anchorSeq)

  // ── Rhythm + confidence, against the final set ──
  detections.forEach((d, i) => {
    const tsS = Date.parse(d.ts) / 1000
    const prevGap = i > 0 ? tsS - Date.parse(detections[i - 1].ts) / 1000 : Infinity
    const nextGap = i < detections.length - 1 ? Date.parse(detections[i + 1].ts) / 1000 - tsS : Infinity
    if (!d.evidence.marginal) d.evidence.rhythm = Math.min(prevGap, nextGap) >= cfg.minRefractoryS

    // Confidence = base by admission path + named evidence. Weights are
    // display calibration, not truth: the honest part is the stored breakdown.
    let c = d.evidence.marginal ? 0.3 : 0.55
    c += 0.15 * d.evidence.ampMargin
    if (d.evidence.width === 'wide') c += 0.1
    if (d.evidence.width === 'narrow') c -= 0.1 // high-mg narrow = rock-strike shaped
    if (d.evidence.precursor) c += 0.1
    if (d.evidence.rhythm) c += 0.05
    d.confidence = Number(Math.max(0.15, Math.min(0.98, c)).toFixed(2))
  })

  metrics.medianIntervalS = metrics.medianIntervalS == null ? null : Math.round(metrics.medianIntervalS)
  return done('detected', detections)
}
