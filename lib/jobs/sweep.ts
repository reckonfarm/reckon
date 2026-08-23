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
import {
  RENDER_CONFIG,
  morphClose,
  morphOpen,
  offsetRing,
  ringPerimeter,
  signedArea,
  smoothRing,
  traceMask,
  type MaskGrid,
} from './render-geometry'

// ─── Swept area — how much of the field the machine has actually covered ───────
//
// Rasterized, on purpose: mark every ~2.5 m grid cell within half a header of
// the track, count the marked cells inside the buffered field, divide by the
// cells inside the buffered field. Overlapping passes mark the same cell once,
// and cutting outside the loop falls out of the numerator by construction —
// the two classic ways a naive length×width sweep overshoots.
//
// SAME BUFFER ON BOTH SIDES of the ratio, deliberately: the denominator is
// the boundary interior EXTENDED by the same half-header the swath sweeps
// with, so "field size" and "acres cut" are measured with one ruler and a
// buffer error largely cancels in the percentage. The percent stays honest
// while the absolute acreage question (raw 2.29 vs buffered 2.55 vs the
// operator's 2.3) is still settling — consistency beats precision.
//
// THE RENDERING IS A SEPARATE CONCERN (computeSweepRender): the data is exact
// and chunky; the map is not. The picture is traced from these same masks,
// closed and smoothed into cartography, and held against the raster by the
// divergence guard (render-geometry.ts). Numbers never come from the picture.
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
}

interface SweepGrids extends MaskGrid {
  mPerLng: number
  inside: Uint8Array
  swept: Uint8Array
  boundaryCells: number
  sweptInside: number
}

function buildSweepGrids(
  track: TrackPoint[],
  boundary: BoundaryResult,
  endIdx?: number,
): SweepGrids | null {
  if (!boundaryQualified(boundary.status) || boundary.polygon == null) return null
  const pts = endIdx != null ? track.slice(0, endIdx + 1) : track
  if (pts.length < 2) return null

  // One projection for everything — anchored on the FULL track's mean latitude
  // so a prefix sweep and the full sweep measure the same ground.
  const lat0 = meanLat(track)
  const mPerLng = 111_320 * Math.cos((lat0 * Math.PI) / 180)
  const ring = projectXY(boundary.polygon, lat0)
  const xy = projectXY(pts, lat0)

  const cell = SWEEP_CONFIG.cellM
  const r = BOUNDARY_CONFIG.headerWidthM / 2
  const minX = Math.min(...ring.map(p => p.x)) - r - cell
  const maxX = Math.max(...ring.map(p => p.x)) + r + cell
  const minY = Math.min(...ring.map(p => p.y)) - r - cell
  const maxY = Math.max(...ring.map(p => p.y)) + r + cell
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell))
  const rows = Math.max(1, Math.ceil((maxY - minY) / cell))

  // Which cells are inside the FIELD — the ring interior plus the same
  // half-header buffer the swath sweeps with (one ruler for both sides of the
  // ratio). Cell centers; a 2.5 m quantization error at the edge is far below
  // the GPS scatter already priced in.
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

  // Paint the swath: cells within half a header of any cutting hop. Hops are
  // distance-limited, not link-limited — an evicted block mid-row leaves a
  // short 'gap' hop that was still real cutting, while a transit hop is long
  // and must not paint a swath across the field.
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

  return { cols, rows, cellM: cell, minX, minY, mask: inside, mPerLng, inside, swept, boundaryCells, sweptInside }
}

/**
 * Swept share of the boundary. endIdx limits the track to [0..endIdx] — the
 * ETA math uses it to ask "how much had swept as of a while ago". Returns null
 * unless the boundary qualified (confirmed or estimate): below the gates,
 * no percentage exists.
 */
export function computeSweep(
  track: TrackPoint[],
  boundary: BoundaryResult,
  endIdx?: number,
): SweepResult | null {
  const g = buildSweepGrids(track, boundary, endIdx)
  if (g == null) return null
  const cellArea = g.cellM * g.cellM
  const rawFraction = g.sweptInside / g.boundaryCells
  const stepped = Math.round((rawFraction * 100) / SWEEP_CONFIG.percentStep) * SWEEP_CONFIG.percentStep
  return {
    percentCut: Math.max(0, Math.min(100, stepped)),
    sweptInsideM2: g.sweptInside * cellArea,
    boundaryInsideM2: g.boundaryCells * cellArea,
    rawFraction,
  }
}

// ─── The picture — cartography traced from the exact masks above ───────────────

export interface RenderedPolygon {
  outer: { lat: number; lng: number }[]
  holes: { lat: number; lng: number }[][]
}

export interface SweepRender {
  /** The drawn field edge — the BUFFERED field mask's contour, smoothed. This
   *  is the same region the field-size number counts, so the line and the
   *  acreage agree by construction (the old centerline ring under-drew the
   *  claimed field by half a header all the way around). */
  boundaryRing: { lat: number; lng: number }[]
  /** Cut ground: closed (dilate+erode), traced, smoothed, holes kept. Clipped
   *  to the field mask at the raster stage — it cannot spill outside. */
  fill: RenderedPolygon[]
  boundaryRenderedM2: number
  boundaryRasterM2: number
  boundaryDivergence: number
  fillRenderedM2: number
  fillRasterM2: number
  fillDivergence: number
  /** The rendered boundary sits within divergenceCap of its raster — the only
   *  condition under which the edge may be drawn. */
  boundaryOk: boolean
  /** The rendered fill sits within divergenceCap of its raster. When false the
   *  fill must NOT be drawn — the numbers still come from the raster and still
   *  show; only the shading goes quiet. This is the honest degrade for work
   *  patterns the close/hole-physics pipeline can't draw truthfully (spaced
   *  windrower rows: the width rule erases real uncut strips between passes,
   *  and no invisible offset can hand that area back). */
  fillOk: boolean
  /** The area-matching offset the reconciliation ASKED for, meters. */
  offsetNeededM: number
  /** The offset actually applied — by construction never above
   *  RENDER_CONFIG.offsetMaxM: a correction big enough to visibly distort the
   *  outline is SKIPPED (never applied silently), leaving the divergence to
   *  tell the truth and fillOk to suppress the picture. */
  offsetAppliedM: number
  /** Interior holes filled by the physics floor (narrower than a header). */
  holesSuppressed: number
}

export function computeSweepRender(
  track: TrackPoint[],
  boundary: BoundaryResult,
): SweepRender | null {
  const g = buildSweepGrids(track, boundary)
  if (g == null) return null
  const cellArea = g.cellM * g.cellM
  const toLatLng = (p: Pt) => ({ lat: p.y / M_PER_LAT, lng: p.x / g.mPerLng })

  // The field edge: trace the buffered field mask, keep its largest outer
  // ring (the mask is a polygon interior plus a buffer — simply connected).
  const fieldRings = traceMask(g, g.inside).filter(r => r.area > 0)
  if (fieldRings.length === 0) return null
  fieldRings.sort((a, b) => b.area - a.area)
  const boundarySmooth = smoothRing(fieldRings[0].ring)
  const boundaryRenderedM2 = Math.abs(signedArea(boundarySmooth))
  const boundaryRasterM2 = g.boundaryCells * cellArea

  // Cut ground: swept ∧ inside, then the morphological close that turns
  // spotty into complete (pinholes, pass gaps), re-clipped to the field so
  // dilation can never leak past the edge.
  const fill = new Uint8Array(g.cols * g.rows)
  for (let k = 0; k < fill.length; k++) fill[k] = g.swept[k] && g.inside[k] ? 1 : 0
  const closedRaw = morphClose({ ...g, mask: fill }, RENDER_CONFIG.closeRadiusCells)
  const closed = new Uint8Array(g.cols * g.rows)
  for (let k = 0; k < closed.length; k++) closed[k] = closedRaw[k] && g.inside[k] ? 1 : 0

  // Obstacle physics, width leg: open the HOLE region so any unfilled feature
  // narrower than ~2 header widths — isolated pocket or narrow notch hanging
  // off the real uncut middle — renders as cut. A real obstacle is wider than
  // the header; these are scatter.
  const holeMask = new Uint8Array(g.cols * g.rows)
  for (let k = 0; k < holeMask.length; k++) holeMask[k] = g.inside[k] && !closed[k] ? 1 : 0
  const holesOpened = morphOpen({ ...g, mask: holeMask }, RENDER_CONFIG.holeOpenRadiusCells)
  for (let k = 0; k < closed.length; k++) closed[k] = g.inside[k] && !holesOpened[k] ? 1 : 0

  // Trace, drop speckles (under ~4 cells — sensor dust, not ground), smooth.
  // Holes survive only above the physics floor (RENDER_CONFIG.holeMinM2): a
  // real obstacle must be wider than the header, so an interior pocket
  // smaller than that is scatter, not ground that was driven around. The
  // uncut middle — the story — is orders of magnitude above the floor and
  // shrinks below it only when the field is essentially done.
  const MIN_RING_M2 = 25
  const rings = traceMask(g, closed).filter(r => Math.abs(r.area) >= MIN_RING_M2)
  const outers = rings.filter(r => r.area > 0)
  const holes = rings.filter(r => r.area < 0 && Math.abs(r.area) >= RENDER_CONFIG.holeMinM2)
  const holesSuppressed = rings.filter(r => r.area < 0 && Math.abs(r.area) < RENDER_CONFIG.holeMinM2).length

  const smoothOuters = outers.map(o => smoothRing(o.ring))
  const smoothHoles: { ring: Pt[]; ownerIdx: number }[] = []
  for (const h of holes) {
    // A hole belongs to the outer that contains it.
    const probe = h.ring[0]
    const ownerIdx = outers.findIndex(o => pointInPolygon(probe, o.ring))
    if (ownerIdx === -1) continue
    smoothHoles.push({ ring: smoothRing(h.ring), ownerIdx })
  }

  const fillRasterM2 = g.sweptInside * cellArea
  const areaOf = (os: Pt[][], hs: Pt[][]) =>
    os.reduce((s, o) => s + Math.abs(signedArea(o)), 0) -
    hs.reduce((s, h) => s + Math.abs(signedArea(h)), 0)

  // Area matching (render-geometry.ts header): the close bridged real gaps
  // and the physics floor filled false holes — hand the gained area back with
  // one uniform sub-metre offset (outers shrink, holes grow) so the
  // complete-looking picture carries the raster's area. First-order step; a
  // second pass would be overkill under the cap. The applied distance is
  // reported and capped (offsetMaxM): a correction big enough to visibly
  // distort the outline must fail loudly, never apply silently.
  let finalOuters = smoothOuters
  let finalHoles = smoothHoles.map(h => h.ring)
  let offsetNeededM = 0
  let offsetAppliedM = 0
  const excess = areaOf(finalOuters, finalHoles) - fillRasterM2
  const totalPerim =
    finalOuters.reduce((s, o) => s + ringPerimeter(o), 0) +
    finalHoles.reduce((s, h) => s + ringPerimeter(h), 0)
  if (totalPerim > 0 && Math.abs(excess) / Math.max(fillRasterM2, 1) > 0.02) {
    const d = Math.abs(excess) / totalPerim
    offsetNeededM = d
    // Apply only while invisible. A correction past offsetMaxM would visibly
    // distort the outline to hit the number — skip it and let the divergence
    // (and fillOk below) suppress the picture instead. Never distort, never
    // draw a lie: those are the only two branches.
    if (d <= RENDER_CONFIG.offsetMaxM) {
      const shrink = excess > 0 // too big → shrink fill; too small → grow it
      finalOuters = finalOuters.map(o => offsetRing(o, d, shrink))
      finalHoles = finalHoles.map(h => offsetRing(h, d, !shrink))
      offsetAppliedM = d
    }
  }

  let fillRenderedM2 = 0
  const polys: RenderedPolygon[] = finalOuters.map(o => {
    fillRenderedM2 += Math.abs(signedArea(o))
    return { outer: o.map(toLatLng), holes: [] }
  })
  finalHoles.forEach((h, i) => {
    fillRenderedM2 -= Math.abs(signedArea(h))
    polys[smoothHoles[i].ownerIdx].holes.push(h.map(toLatLng))
  })

  const boundaryDivergence = Math.abs(boundaryRenderedM2 - boundaryRasterM2) / boundaryRasterM2
  const fillDivergence = fillRasterM2 > 0 ? Math.abs(fillRenderedM2 - fillRasterM2) / fillRasterM2 : 0

  return {
    boundaryRing: boundarySmooth.map(toLatLng),
    fill: polys,
    boundaryRenderedM2,
    boundaryRasterM2,
    boundaryDivergence,
    fillRenderedM2,
    fillRasterM2,
    fillDivergence,
    boundaryOk: boundaryDivergence <= RENDER_CONFIG.divergenceCap,
    fillOk: fillDivergence <= RENDER_CONFIG.divergenceCap,
    offsetNeededM,
    offsetAppliedM,
    holesSuppressed,
  }
}
