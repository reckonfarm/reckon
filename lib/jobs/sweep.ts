import type { TrackPoint } from './derive'
import {
  BOUNDARY_CONFIG,
  distToSegment,
  meanLat,
  pointInPolygon,
  projectXY,
  type BoundaryResult,
  type Pt,
} from './boundary'

// ─── Swept area — how much of the field the machine has actually covered ───────
//
// Rasterized, on purpose: mark every ~2.5 m grid cell within half a header of
// the track, count the marked cells inside the boundary, divide by the cells
// inside the boundary. Overlapping passes mark the same cell once, and cutting
// outside the loop falls out of the numerator by construction — the two
// classic ways a naive length×width sweep overshoots.
//
// Only plausible CUTTING hops sweep: consecutive points within maxSweepHopM.
// That is deliberately distance-based, not link-based — an evicted block mid-
// row leaves a short 'gap' hop that was still real cutting, while a transit
// hop between patches is long and must not paint a swath across the field.
//
// The result is approximate by design (GPS scatter ~3.7 m against a 4.9 m
// header) and is therefore only ever SPOKEN coarsely: nearest 5%, capped at
// 100. The word for this number is "cut" — never "coverage", which on these
// pages already means data received ÷ generated. Two numbers, two words.
//
// Pure module, no I/O, no Date.now() — computed at read time, nothing stored.

export const SWEEP_CONFIG = {
  cellM: 2.5, // raster cell ≈ half a header — finer buys nothing against 3.7 m scatter
  maxSweepHopM: 25, // hops longer than this are transit, not cutting
  percentStep: 5, // "About 60%", never 62.4%
} as const

export interface SweepResult {
  /** Stepped to the nearest 5, capped at 100. The only number the UI speaks. */
  percentCut: number
  sweptInsideM2: number
  boundaryInsideM2: number
  rawFraction: number
}

// The cutting segments of a track, split wherever a hop is too long to be
// cutting. Shared by the raster below and by the map's swath rendering, so the
// fill on screen and the percent beside it can never disagree about what swept.
export function sweepRuns(track: TrackPoint[]): TrackPoint[][] {
  if (track.length === 0) return []
  const lat0 = meanLat(track)
  const xy = projectXY(track, lat0)
  const runs: TrackPoint[][] = []
  let run: TrackPoint[] = [track[0]]
  for (let i = 1; i < track.length; i++) {
    const hop = Math.hypot(xy[i].x - xy[i - 1].x, xy[i].y - xy[i - 1].y)
    if (hop > SWEEP_CONFIG.maxSweepHopM) {
      if (run.length >= 2) runs.push(run)
      run = []
    }
    run.push(track[i])
  }
  if (run.length >= 2) runs.push(run)
  return runs
}

/**
 * Swept share of the boundary. endIdx limits the track to [0..endIdx] — the
 * ETA math uses it to ask "how much had swept as of a while ago". Returns null
 * unless the boundary's status is 'ok': a guard-failed boundary must never
 * produce a percentage.
 */
export function computeSweep(
  track: TrackPoint[],
  boundary: BoundaryResult,
  endIdx?: number,
): SweepResult | null {
  if (boundary.status !== 'ok' || boundary.polygon == null) return null
  const pts = endIdx != null ? track.slice(0, endIdx + 1) : track
  if (pts.length < 2) return null

  // One projection for everything — anchored on the FULL track's mean latitude
  // so a prefix sweep and the full sweep measure the same ground.
  const lat0 = meanLat(track)
  const ring = projectXY(boundary.polygon, lat0)
  const xy = projectXY(pts, lat0)

  const cell = SWEEP_CONFIG.cellM
  const r = BOUNDARY_CONFIG.headerWidthM / 2
  const minX = Math.min(...ring.map(p => p.x)) - r
  const maxX = Math.max(...ring.map(p => p.x)) + r
  const minY = Math.min(...ring.map(p => p.y)) - r
  const maxY = Math.max(...ring.map(p => p.y)) + r
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell))
  const rows = Math.max(1, Math.ceil((maxY - minY) / cell))

  // Which cells are inside the field. Cell centers; a 2.5 m quantization error
  // at the edge is far below the GPS scatter already priced in.
  const inside = new Uint8Array(cols * rows)
  let boundaryCells = 0
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const center: Pt = { x: minX + (cx + 0.5) * cell, y: minY + (cy + 0.5) * cell }
      if (pointInPolygon(center, ring)) {
        inside[cy * cols + cx] = 1
        boundaryCells++
      }
    }
  }
  if (boundaryCells === 0) return null

  // Paint the swath: cells within half a header of any cutting hop.
  const swept = new Uint8Array(cols * rows)
  const maxHop2 = SWEEP_CONFIG.maxSweepHopM ** 2
  for (let i = 1; i < xy.length; i++) {
    const a = xy[i - 1]
    const b = xy[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    if (dx * dx + dy * dy > maxHop2) continue
    const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - r - minX) / cell))
    const x1 = Math.min(cols - 1, Math.floor((Math.max(a.x, b.x) + r - minX) / cell))
    const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - r - minY) / cell))
    const y1 = Math.min(rows - 1, Math.floor((Math.max(a.y, b.y) + r - minY) / cell))
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const k = cy * cols + cx
        if (swept[k]) continue
        const center: Pt = { x: minX + (cx + 0.5) * cell, y: minY + (cy + 0.5) * cell }
        if (distToSegment(center, a, b) <= r) swept[k] = 1
      }
    }
  }

  let sweptInside = 0
  for (let k = 0; k < swept.length; k++) if (swept[k] && inside[k]) sweptInside++

  const cellArea = cell * cell
  const rawFraction = sweptInside / boundaryCells
  const stepped = Math.round((rawFraction * 100) / SWEEP_CONFIG.percentStep) * SWEEP_CONFIG.percentStep
  return {
    percentCut: Math.max(0, Math.min(100, stepped)),
    sweptInsideM2: sweptInside * cellArea,
    boundaryInsideM2: boundaryCells * cellArea,
    rawFraction,
  }
}
