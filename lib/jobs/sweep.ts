import type { TrackPoint } from './derive'
import {
  BOUNDARY_CONFIG,
  M_PER_LAT,
  boundaryQualified,
  distToRing,
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
// SAME BUFFER ON BOTH SIDES of the ratio, deliberately: the denominator is
// the boundary interior EXTENDED by the same half-header the swath sweeps
// with, so "field size" and "acres cut" are measured with one ruler and a
// buffer error largely cancels in the percentage. The percent stays honest
// while the absolute acreage question (raw 2.29 vs buffered 2.55 vs the
// operator's 2.3) is still settling — consistency beats precision.
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
  /** Stepped to the nearest 5, capped at 100. */
  percentCut: number
  /** Acres cut — swept raster inside the buffered field. */
  sweptInsideM2: number
  /** Field size — the boundary interior plus the same half-header buffer. */
  boundaryInsideM2: number
  rawFraction: number
  /**
   * Row-merged rectangles of the swept cells, for the map's WORKING mode —
   * the fill on screen and the percent beside it are literally these cells.
   * Only populated when requested via withCells.
   */
  cells?: { minLat: number; minLng: number; maxLat: number; maxLng: number }[]
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
 * unless the boundary qualified (confirmed or estimate): below the gates,
 * no percentage exists. withCells additionally returns the row-merged swept
 * rectangles for rendering.
 */
export function computeSweep(
  track: TrackPoint[],
  boundary: BoundaryResult,
  endIdx?: number,
  withCells = false,
): SweepResult | null {
  if (!boundaryQualified(boundary.status) || boundary.polygon == null) return null
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

  // Which cells are inside the FIELD — the ring interior plus the same
  // half-header buffer the swath sweeps with (see header: one ruler for both
  // sides of the ratio). Cell centers; a 2.5 m quantization error at the edge
  // is far below the GPS scatter already priced in.
  const inside = new Uint8Array(cols * rows)
  let boundaryCells = 0
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const center: Pt = { x: minX + (cx + 0.5) * cell, y: minY + (cy + 0.5) * cell }
      if (pointInPolygon(center, ring) || distToRing(center, ring) <= r) {
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

  // Row-merge swept∩inside cells into horizontal strips — a few hundred
  // rectangles instead of thousands of cells, and still exactly the raster.
  let cells: SweepResult['cells']
  if (withCells) {
    const mPerLng = 111_320 * Math.cos((lat0 * Math.PI) / 180)
    cells = []
    for (let cy = 0; cy < rows; cy++) {
      let runStart = -1
      for (let cx = 0; cx <= cols; cx++) {
        const on = cx < cols && swept[cy * cols + cx] === 1 && inside[cy * cols + cx] === 1
        if (on && runStart === -1) runStart = cx
        if (!on && runStart !== -1) {
          cells.push({
            minLng: (minX + runStart * cell) / mPerLng,
            maxLng: (minX + cx * cell) / mPerLng,
            minLat: (minY + cy * cell) / M_PER_LAT,
            maxLat: (minY + (cy + 1) * cell) / M_PER_LAT,
          })
          runStart = -1
        }
      }
    }
  }

  const cellArea = cell * cell
  const rawFraction = sweptInside / boundaryCells
  const stepped = Math.round((rawFraction * 100) / SWEEP_CONFIG.percentStep) * SWEEP_CONFIG.percentStep
  return {
    percentCut: Math.max(0, Math.min(100, stepped)),
    sweptInsideM2: sweptInside * cellArea,
    boundaryInsideM2: boundaryCells * cellArea,
    rawFraction,
    ...(cells != null ? { cells } : {}),
  }
}
