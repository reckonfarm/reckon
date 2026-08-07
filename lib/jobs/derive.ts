// ─── The job deriver — seq-driven state machine over raw Scout events ──────────
//
// Impacts are events; running is a state. This module turns a device's raw
// bump stream into JOBS (work sessions) using the one signal the dumb device
// already emits perfectly: the monotonic seq counter.
//
// THE THREE-WAY GAP RULE (the heart of it — binary is provably wrong):
// for consecutive device-timed events A→B, generated-between g = seqB−seqA−1,
// gap = tB−tA, excess = gap − g×cadence:
//   1. g == 0, gap large            → GENUINE QUIET (machine sat silent)
//   2. g > 0, excess ≈ 0            → CONTINUOUS WORK, data lost to the queue
//   3. g > 0, excess large positive → BOTH: work lost AND a real pause hidden
//                                     inside the eviction block
// Aug 5 acceptance test: every eviction gap closes within ±1–2 min of
// g×cadence EXCEPT the 15:41 MDT coffee break (+~5.8 min excess, 161 m hop),
// which must surface as an inferred pause — a binary rule tunes it away.
//
// Pure module: no I/O, no Date.now(). scripts/derive-jobs.ts does the I/O.
// Any change to logic or thresholds = bump DERIVER_VERSION and re-derive;
// jobs are a rebuildable artifact, never source data.

export const DERIVER_VERSION = 'jobs-v1.0.0'

export const DERIVE_CONFIG = {
  // ts_source='server' means the ledger stamped receipt time, not event time —
  // untrusted for sequencing (a courier sync can be days late). Mirrors
  // MIN_CREDIBLE_UNIX_TIME in /api/ingest (2020-01-01Z).
  minCredibleUnixTime: 1577836800,
  // Fallback cadence when a stream is too short to measure its own (Aug 5
  // measured median: 3 s ≈ 20 events/min of sustained cutting).
  defaultCadenceS: 3,
  cadenceMaxSampleGapS: 30, // seq-adjacent pairs slower than this don't vote on cadence
  // Gap classification
  quietBoundaryS: 30 * 60, // genuine quiet (or excess) this long ends the job
  observedPauseMinS: 3 * 60, // shorter observed quiet is just work rhythm
  inferredPauseMinS: 3 * 60, // excess below this is cadence noise (±1–2 min closes clean)
  // Track drawing: a hop is 'solid' ONLY when seq-adjacent and quick — anything
  // else renders dashed. The map must never imply data we don't have.
  solidHopMaxS: 60,
  // Multi-field detection (grid clustering of positioned points)
  clusterCellM: 150,
  clusterMinShare: 0.05,
  clusterMinPoints: 10,
  multiFieldMinSeparationM: 400,
} as const

export interface RawEventInput {
  id: string
  seq: number
  unixTime: number // seconds; 0 / pre-2020 = no GPS clock
  serverTs: boolean // payload.ts_source === 'server'
  lat: number | null
  lng: number | null
  peakMg: number | null
  width: number | null
}

export interface TrackPoint {
  seq: number
  t: number // unix seconds, device GPS time
  lat: number
  lng: number
  mg: number | null
  w: number | null
  link: 'solid' | 'gap' // the hop FROM the previous track point ('gap' on the first)
}

export interface JobPause {
  afterSeq: number
  atIso: string // device time of the last event before the pause
  kind: 'observed' | 'inferred'
  durationS: number // observed: the whole gap; inferred: the excess only
  missing: number // evicted events inside the same gap (0 when observed)
}

export interface DerivedJob {
  seqStart: number
  seqEnd: number
  startedAt: string
  endedAt: string
  durationS: number
  eventCount: number // received in span: timed + untimed
  timedCount: number
  untimedCount: number
  evictedCount: number // span − received
  coverage: number // received / span
  centroidLat: number | null
  centroidLng: number | null
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number } | null
  track: TrackPoint[]
  pauses: JobPause[]
  multiField: boolean
  stats: {
    cadenceS: number
    positionedCount: number
    mgP50: number | null
    mgP95: number | null
    mgMax: number | null
    config: typeof DERIVE_CONFIG
  }
}

export interface DeriveResult {
  jobs: DerivedJob[]
  cadenceS: number
  timedCount: number
  untimedCount: number
  orphanUntimedSeqs: number[] // received but timeless AND outside every job span
  duplicateSeqsDropped: number
}

interface TimedEvent extends RawEventInput {
  t: number
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

// ─── Multi-field: grid the positioned points, union-find touching cells, and
// flag when 2+ substantial clusters sit far apart. A transit line between
// fields is sparse (its cells miss the share floor), so the fields stay
// separate clusters even though impacts occurred along the road.
function detectMultiField(points: TrackPoint[], cfg: typeof DERIVE_CONFIG): boolean {
  if (points.length < 2 * cfg.clusterMinPoints) return false
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length
  const mPerLat = 111_132
  const mPerLng = 111_320 * Math.cos((lat0 * Math.PI) / 180)
  const cell = cfg.clusterCellM

  const cells = new Map<string, { key: string; count: number; x: number; y: number }>()
  for (const p of points) {
    const x = Math.floor((p.lng * mPerLng) / cell)
    const y = Math.floor((p.lat * mPerLat) / cell)
    const key = `${x}:${y}`
    const c = cells.get(key)
    if (c) c.count++
    else cells.set(key, { key, count: 1, x, y })
  }

  // Union-find over 8-neighbor cells
  const parent = new Map<string, string>()
  const find = (k: string): string => {
    let r = k
    while (parent.get(r) !== r) r = parent.get(r)!
    parent.set(k, r)
    return r
  }
  for (const k of cells.keys()) parent.set(k, k)
  for (const c of cells.values()) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nk = `${c.x + dx}:${c.y + dy}`
        if (nk !== c.key && cells.has(nk)) {
          const ra = find(c.key)
          const rb = find(nk)
          if (ra !== rb) parent.set(ra, rb)
        }
      }
    }
  }

  const clusters = new Map<string, { count: number; sx: number; sy: number }>()
  for (const c of cells.values()) {
    const r = find(c.key)
    const cl = clusters.get(r) ?? { count: 0, sx: 0, sy: 0 }
    cl.count += c.count
    cl.sx += (c.x + 0.5) * cell * c.count
    cl.sy += (c.y + 0.5) * cell * c.count
    clusters.set(r, cl)
  }

  const floor = Math.max(cfg.clusterMinPoints, Math.ceil(points.length * cfg.clusterMinShare))
  const big = [...clusters.values()].filter(c => c.count >= floor)
  if (big.length < 2) return false
  for (let i = 0; i < big.length; i++) {
    for (let j = i + 1; j < big.length; j++) {
      const a = big[i]
      const b = big[j]
      const d = Math.hypot(a.sx / a.count - b.sx / b.count, a.sy / a.count - b.sy / b.count)
      if (d >= cfg.multiFieldMinSeparationM) return true
    }
  }
  return false
}

function buildJob(
  segment: TimedEvent[],
  pauses: JobPause[],
  untimedBySeq: Map<number, RawEventInput>,
  cadenceS: number,
  cfg: typeof DERIVE_CONFIG
): DerivedJob {
  const seqStart = segment[0].seq
  const seqEnd = segment[segment.length - 1].seq
  let untimedCount = 0
  for (const seq of untimedBySeq.keys()) {
    if (seq > seqStart && seq < seqEnd) untimedCount++
  }
  const span = seqEnd - seqStart + 1
  const eventCount = segment.length + untimedCount

  // Track: positioned, timed points only; a hop is solid only when nothing was
  // generated between its endpoints and it happened at work rhythm.
  const track: TrackPoint[] = []
  for (const e of segment) {
    if (e.lat == null || e.lng == null) continue
    const prev = track[track.length - 1]
    const link: TrackPoint['link'] =
      prev && e.seq === prev.seq + 1 && e.t - prev.t <= cfg.solidHopMaxS ? 'solid' : 'gap'
    track.push({ seq: e.seq, t: e.t, lat: e.lat, lng: e.lng, mg: e.peakMg, w: e.width, link })
  }

  let bbox: DerivedJob['bbox'] = null
  let centroidLat: number | null = null
  let centroidLng: number | null = null
  if (track.length > 0) {
    bbox = {
      minLat: Math.min(...track.map(p => p.lat)),
      maxLat: Math.max(...track.map(p => p.lat)),
      minLng: Math.min(...track.map(p => p.lng)),
      maxLng: Math.max(...track.map(p => p.lng)),
    }
    centroidLat = track.reduce((s, p) => s + p.lat, 0) / track.length
    centroidLng = track.reduce((s, p) => s + p.lng, 0) / track.length
  }

  const mgs = segment.map(e => e.peakMg).filter((m): m is number => m != null).sort((a, b) => a - b)

  return {
    seqStart,
    seqEnd,
    startedAt: new Date(segment[0].t * 1000).toISOString(),
    endedAt: new Date(segment[segment.length - 1].t * 1000).toISOString(),
    durationS: segment[segment.length - 1].t - segment[0].t,
    eventCount,
    timedCount: segment.length,
    untimedCount,
    evictedCount: span - eventCount,
    coverage: eventCount / span,
    centroidLat,
    centroidLng,
    bbox,
    track,
    pauses,
    multiField: detectMultiField(track, cfg),
    stats: {
      cadenceS,
      positionedCount: track.length,
      mgP50: quantile(mgs, 0.5),
      mgP95: quantile(mgs, 0.95),
      mgMax: mgs.length ? mgs[mgs.length - 1] : null,
      config: cfg,
    },
  }
}

export function deriveJobs(
  events: RawEventInput[],
  cfg: typeof DERIVE_CONFIG = DERIVE_CONFIG
): DeriveResult {
  // Order by seq — the one truth the device guarantees — and drop seq dupes
  // (dedupe upstream should make these impossible; count them anyway).
  const bySeq = new Map<number, RawEventInput>()
  let duplicateSeqsDropped = 0
  for (const e of events) {
    if (!Number.isInteger(e.seq) || e.seq < 0) continue
    if (bySeq.has(e.seq)) duplicateSeqsDropped++
    else bySeq.set(e.seq, e)
  }
  const ordered = [...bySeq.values()].sort((a, b) => a.seq - b.seq)

  const timed: TimedEvent[] = []
  const untimedBySeq = new Map<number, RawEventInput>()
  for (const e of ordered) {
    if (!e.serverTs && e.unixTime >= cfg.minCredibleUnixTime) {
      timed.push({ ...e, t: e.unixTime })
    } else {
      untimedBySeq.set(e.seq, e)
    }
  }

  // Cadence: median dt across seq-adjacent timed pairs at work rhythm.
  const dts: number[] = []
  for (let i = 1; i < timed.length; i++) {
    const dt = timed[i].t - timed[i - 1].t
    if (timed[i].seq === timed[i - 1].seq + 1 && dt > 0 && dt <= cfg.cadenceMaxSampleGapS) {
      dts.push(dt)
    }
  }
  const cadenceS = median(dts) ?? cfg.defaultCadenceS

  // The state machine: walk timed events, classify each gap, split on boundaries.
  const jobs: DerivedJob[] = []
  let segment: TimedEvent[] = []
  let pauses: JobPause[] = []

  const closeSegment = () => {
    if (segment.length > 0) {
      jobs.push(buildJob(segment, pauses, untimedBySeq, cadenceS, cfg))
    }
    segment = []
    pauses = []
  }

  for (const e of timed) {
    if (segment.length === 0) {
      segment.push(e)
      continue
    }
    const prev = segment[segment.length - 1]
    const gap = Math.max(0, e.t - prev.t)
    // Everything generated between the endpoints — received-untimed or evicted —
    // took ~cadence apiece to produce; both count toward expected duration.
    const genBetween = e.seq - prev.seq - 1
    let receivedBetween = 0
    for (let s = prev.seq + 1; s < e.seq; s++) if (untimedBySeq.has(s)) receivedBetween++
    const evictedBetween = genBetween - receivedBetween

    if (genBetween === 0) {
      // Nothing generated: any silence is genuine.
      if (gap >= cfg.quietBoundaryS) {
        closeSegment()
      } else if (gap >= cfg.observedPauseMinS) {
        pauses.push({
          afterSeq: prev.seq,
          atIso: new Date(prev.t * 1000).toISOString(),
          kind: 'observed',
          durationS: gap,
          missing: 0,
        })
      }
    } else {
      const excess = gap - genBetween * cadenceS
      if (excess >= cfg.quietBoundaryS) {
        // A boundary-sized silence hidden inside an eviction block: end the job.
        closeSegment()
      } else if (excess >= cfg.inferredPauseMinS) {
        // Case 3: work lost AND a real stop inside it. Report the excess only —
        // the machine worked ~genBetween×cadence of that gap.
        pauses.push({
          afterSeq: prev.seq,
          atIso: new Date(prev.t * 1000).toISOString(),
          kind: 'inferred',
          durationS: Math.round(excess),
          missing: evictedBetween,
        })
      }
      // else: case 2 — continuous work, data lost; nothing to record, the
      // job-level evicted_count/coverage carries it.
    }
    segment.push(e)
  }
  closeSegment()

  // Untimed events outside every job's span can't be placed — surfaced, not hidden.
  const orphanUntimedSeqs = [...untimedBySeq.keys()]
    .filter(seq => !jobs.some(j => seq > j.seqStart && seq < j.seqEnd))
    .sort((a, b) => a - b)

  return {
    jobs,
    cadenceS,
    timedCount: timed.length,
    untimedCount: untimedBySeq.size,
    orphanUntimedSeqs,
    duplicateSeqsDropped,
  }
}
