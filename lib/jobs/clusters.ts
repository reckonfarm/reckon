import type { TrackPoint } from './derive'

// ─── Work-area clustering — one algorithm, two consumers ───────────────────────
//
// Grid the positioned points into cells, union-find touching cells, and call
// each connected component a cluster. A transit line between fields is sparse
// (its cells miss the share floor), so fields stay separate clusters even
// though impacts occurred along the road.
//
// The DERIVER uses this to stamp the multi_field FACT on a job ("this session
// spans 2+ work areas ≥400 m apart"). The BOUNDARY layer uses the same
// clustering to SEGMENT such a job into per-field tracks so each field runs
// the full pipeline — loop finder, gates, grades, sweep — against its own
// points only. One algorithm in one module, so the fact and the segmentation
// can never disagree about where the fields are.
//
// Pure module, no I/O, no Date.now() — same doctrine as derive.ts.

export const CLUSTER_CONFIG = {
  cellM: 150,
  minShare: 0.05, // a substantial cluster holds at least this share of points…
  minPoints: 10, // …and never fewer than this many
  minSeparationM: 400, // two substantial clusters this far apart = multi-field
} as const

export type ClusterConfig = typeof CLUSTER_CONFIG

interface Cluster {
  count: number
  sx: number // Σ x·count over member cells (meters, arbitrary origin)
  sy: number
  idxs: number[] // indices into the input array, ascending
}

// Cells → union-find → clusters. Shared skeleton for the fact and the split.
function buildClusters(points: { lat: number; lng: number }[], cfg: ClusterConfig): Cluster[] {
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length
  const mPerLat = 111_132
  const mPerLng = 111_320 * Math.cos((lat0 * Math.PI) / 180)
  const cell = cfg.cellM

  const cells = new Map<string, { key: string; count: number; x: number; y: number; idxs: number[] }>()
  points.forEach((p, idx) => {
    const x = Math.floor((p.lng * mPerLng) / cell)
    const y = Math.floor((p.lat * mPerLat) / cell)
    const key = `${x}:${y}`
    const c = cells.get(key)
    if (c) {
      c.count++
      c.idxs.push(idx)
    } else {
      cells.set(key, { key, count: 1, x, y, idxs: [idx] })
    }
  })

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

  const clusters = new Map<string, Cluster>()
  for (const c of cells.values()) {
    const r = find(c.key)
    const cl = clusters.get(r) ?? { count: 0, sx: 0, sy: 0, idxs: [] }
    cl.count += c.count
    cl.sx += (c.x + 0.5) * cell * c.count
    cl.sy += (c.y + 0.5) * cell * c.count
    cl.idxs.push(...c.idxs)
    clusters.set(r, cl)
  }
  for (const cl of clusters.values()) cl.idxs.sort((a, b) => a - b)
  return [...clusters.values()]
}

function substantial(clusters: Cluster[], total: number, cfg: ClusterConfig): Cluster[] {
  const floor = Math.max(cfg.minPoints, Math.ceil(total * cfg.minShare))
  return clusters.filter(c => c.count >= floor)
}

/** The deriver's multi-field FACT: 2+ substantial clusters ≥ minSeparationM apart. */
export function detectMultiField(
  points: { lat: number; lng: number }[],
  cfg: ClusterConfig = CLUSTER_CONFIG,
): boolean {
  if (points.length < 2 * cfg.minPoints) return false
  const big = substantial(buildClusters(points, cfg), points.length, cfg)
  if (big.length < 2) return false
  for (let i = 0; i < big.length; i++) {
    for (let j = i + 1; j < big.length; j++) {
      const a = big[i]
      const b = big[j]
      const d = Math.hypot(a.sx / a.count - b.sx / b.count, a.sy / a.count - b.sy / b.count)
      if (d >= cfg.minSeparationM) return true
    }
  }
  return false
}

/**
 * Split a multi-field track into per-field tracks: every point (transit hops
 * and stray fixes included) goes to the NEAREST substantial cluster's
 * centroid, so no point silently vanishes and per-field explain-share is
 * judged against that field's whole story. Segments come back in TIME order
 * (order of each field's first point) with original point order preserved.
 *
 * Fewer than 2 substantial clusters → the track is one work area: [track].
 */
export function segmentWorkAreas(
  track: TrackPoint[],
  cfg: ClusterConfig = CLUSTER_CONFIG,
): TrackPoint[][] {
  if (track.length === 0) return []
  const big = substantial(buildClusters(track, cfg), track.length, cfg)
  if (big.length < 2) return [track]

  const lat0 = track.reduce((s, p) => s + p.lat, 0) / track.length
  const mPerLat = 111_132
  const mPerLng = 111_320 * Math.cos((lat0 * Math.PI) / 180)
  const centroids = big.map(c => ({ x: c.sx / c.count, y: c.sy / c.count }))

  const segments: TrackPoint[][] = big.map(() => [])
  track.forEach(p => {
    const x = p.lng * mPerLng
    const y = p.lat * mPerLat
    let bi = 0
    let bd = Infinity
    centroids.forEach((c, i) => {
      const d = Math.hypot(x - c.x, y - c.y)
      if (d < bd) {
        bd = d
        bi = i
      }
    })
    segments[bi].push(p)
  })

  return segments
    .filter(s => s.length > 0)
    .sort((a, b) => a[0].seq - b[0].seq)
}
